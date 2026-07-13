/**
 * 자동 수정 플래너 — 차원별 gap → 우선순위 fix 액션 + FIX_COST_TABLE 정적 사전 견적
 * + 멱등키 dedup(이력 충돌 시 skippedDuplicateIds).
 *
 * 순수 결정론 모듈 — LLM 호출 없음. 같은 입력이면 항상 같은 plan (타임스탬프 미포함).
 * 예산 초과 시 requiresApproval 플래그만 세운다 — 실행 게이트는 orchestrator 가
 * fail-closed 로 담당한다(승인 콜백 부재 시 초과 plan 전부 skip).
 *
 * 액션 우선순위: critical 차원 먼저 → expectedScoreLift/cost 비율 내림차순.
 */

import type { BundleScene, ContentBundle } from "./content-bundle";
import { fnv1a32 } from "./hash-seed";
import type { MarketBenchmark } from "./market-benchmark";
import { type FixHistoryEntry, hasAppliedFix } from "./quality-fix-history";
import {
	type AutoFixAction,
	type AutoFixActionType,
	type AutoFixPlan,
	DEFAULT_FIX_BUDGET,
	type DimensionVerdict,
	type FixBudget,
	type FixCostEstimate,
	type QualityDimension,
} from "./quality-verdict";

export interface FixCostProfile {
	usd: number;
	llmCalls: number;
	/** 정의되면 문자(씬) 기반 비용 — usd/ttsChars 가 대상 씬 수에 비례 */
	ttsCharsPerScene?: number;
	bgmGenerations?: number;
}

/**
 * 액션별 정적 비용 추정치 — 실측 아님, 사전 견적용 보수 추정.
 * usd 는 1회 실행 기준. ttsCharsPerScene 이 있는 액션(tts_retake)은
 * "1씬 ≈ 200자 내레이션 재합성" 환산 단가로 대상 씬 수에 비례 과금.
 * bgm_swap 은 기존 트랙 재선택이라 신규 생성(bgmGenerations) 비용 없음.
 */
export const FIX_COST_TABLE: Record<AutoFixActionType, FixCostProfile> = {
	scene_density_patch: { usd: 0, llmCalls: 0 },
	opening_hook_rewrite: { usd: 0.02, llmCalls: 1 },
	ending_narration_patch: { usd: 0, llmCalls: 0 },
	tts_retake: { usd: 0.05, llmCalls: 0, ttsCharsPerScene: 200 },
	bgm_swap: { usd: 0, llmCalls: 0 },
	bgm_normalize: { usd: 0, llmCalls: 0 },
	bgm_cue_replan: { usd: 0, llmCalls: 0 },
	caption_density_patch: { usd: 0, llmCalls: 0 },
	chapter_restructure: { usd: 0.04, llmCalls: 1 },
};

/** 액션별 기대 점수 상승 상한 — lift = min(gap, cap) 으로 결정론 산출 */
const LIFT_CAP: Record<AutoFixActionType, number> = {
	scene_density_patch: 12,
	opening_hook_rewrite: 10,
	ending_narration_patch: 6,
	tts_retake: 14,
	bgm_swap: 10,
	bgm_normalize: 8,
	bgm_cue_replan: 6,
	caption_density_patch: 8,
	chapter_restructure: 9,
};

const MAX_ACTIONS_PER_DIMENSION = 2;
/** 0비용 액션의 lift/cost 비율 발산 방지 바닥값 (USD) */
const MIN_RATIO_COST_USD = 0.005;
/** 이 이상 LUFS 가 벤치마크에서 벗어나면 normalize 후보 생성 (dB) */
const LUFS_TOLERANCE_DB = 2;
/** BGM qualityScore 가 이 미만이면 트랙 교체 후보 생성 */
const BGM_SWAP_QUALITY_BAR = 60;

/** 차원 순회 고정 순서 — Record 키 삽입 순서와 무관한 결정론 보장 */
const DIMENSION_ORDER: QualityDimension[] = ["editing", "script", "bgm", "tts"];

/** 비결정 필드 — params 로 흘러들어와도 멱등키에서 영구 제외 */
const NON_DETERMINISTIC_KEYS = new Set([
	"updatedAt",
	"updated_at",
	"createdAt",
	"created_at",
	"judgedAt",
	"judged_at",
]);

/**
 * 키 정렬 stable-stringify — 객체 키 순서/undefined/비결정 키와 무관하게
 * 같은 내용이면 같은 문자열을 보장한다.
 */
function stableStringify(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "number") {
		return Number.isFinite(value) ? JSON.stringify(value) : "null";
	}
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item ?? null)).join(",")}]`;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const parts = Object.keys(record)
			.filter(
				(key) => record[key] !== undefined && !NON_DETERMINISTIC_KEYS.has(key),
			)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
		return `{${parts.join(",")}}`;
	}
	// undefined/function/symbol 등 JSON 비호환 값
	return "null";
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/** USD 합산 부동소수점 노이즈 제거 — 견적 결정론 보장 */
function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}

/**
 * fix 멱등키 — 같은 type+대상+params 면 라운드와 무관하게 항상 같은 키.
 * 대상 씬 순서/params 키 순서는 정렬로 정규화한다 (영구 중복 차단의 기반).
 */
export function buildFixIdempotencyKey(
	type: AutoFixActionType,
	targetSceneIds: string[],
	params: Record<string, unknown>,
): string {
	const payload = stableStringify({
		params,
		targetSceneIds: [...targetSceneIds].sort(),
		type,
	});
	return `${type}:${fnv1a32(payload).toString(16).padStart(8, "0")}`;
}

function estimateActionCost(
	type: AutoFixActionType,
	targetSceneIds: string[],
	budget: FixBudget,
): FixCostEstimate {
	const profile = FIX_COST_TABLE[type];
	const charDriven = profile.ttsCharsPerScene !== undefined;
	const usd = round4(
		charDriven ? profile.usd * targetSceneIds.length : profile.usd,
	);
	return {
		usd,
		llmCalls: profile.llmCalls,
		ttsChars: (profile.ttsCharsPerScene ?? 0) * targetSceneIds.length,
		bgmGenerations: profile.bgmGenerations ?? 0,
		withinBudget:
			usd <= budget.maxUsdPerLoop &&
			profile.llmCalls <= budget.maxLlmCallsPerJudgement,
	};
}

/** 액션 비용 합산 — withinBudget 은 usd/llmCalls 두 한도 동시 충족일 때만 */
export function estimateFixCost(
	actions: AutoFixAction[],
	budget?: FixBudget,
): FixCostEstimate {
	const b = budget ?? DEFAULT_FIX_BUDGET;
	let usd = 0;
	let llmCalls = 0;
	let ttsChars = 0;
	let bgmGenerations = 0;
	for (const action of actions) {
		usd += action.estimatedCost.usd;
		llmCalls += action.estimatedCost.llmCalls;
		ttsChars += action.estimatedCost.ttsChars;
		bgmGenerations += action.estimatedCost.bgmGenerations;
	}
	usd = round4(usd);
	return {
		usd,
		llmCalls,
		ttsChars,
		bgmGenerations,
		withinBudget:
			usd <= b.maxUsdPerLoop && llmCalls <= b.maxLlmCallsPerJudgement,
	};
}

interface FixCandidate {
	type: AutoFixActionType;
	targetSceneIds: string[];
	params: Record<string, unknown>;
}

/** 입력 배열 순서가 plan 에 영향 주지 않도록 결정론 정렬 (content-bundle 과 동일 규칙) */
function sortScenes(scenes: BundleScene[]): BundleScene[] {
	return [...scenes].sort(
		(a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
	);
}

function editingCandidates(
	scenes: BundleScene[],
	benchmark: MarketBenchmark,
): FixCandidate[] {
	const cutDensitySec = benchmark.editing.cutDensitySec;
	const out: FixCandidate[] = [];

	// 벤치마크 컷 밀도보다 긴 씬만 분할 대상 — 대상이 없으면 액션 자체를 생성하지 않는다.
	// (빈 targetSceneIds 를 executor 가 "전체 씬"으로 해석하는 버그 방지)
	const densityTargets = scenes
		.filter((s) => s.durationSec > cutDensitySec)
		.map((s) => s.id);
	if (densityTargets.length > 0) {
		out.push({
			type: "scene_density_patch",
			targetSceneIds: densityTargets,
			params: { targetCutDensitySec: cutDensitySec },
		});
	}

	// caption_density_patch 의 빈 대상은 "전체 씬에 적용" 의도이므로 그대로 유지
	out.push({
		type: "caption_density_patch",
		targetSceneIds: [],
		params: { targetCaptionsPerMin: benchmark.editing.captionsPerMin },
	});

	return out;
}

function scriptCandidates(
	scenes: BundleScene[],
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
): FixCandidate[] {
	const out: FixCandidate[] = [];
	const first = scenes.at(0);
	if (first) {
		out.push({
			type: "opening_hook_rewrite",
			targetSceneIds: [first.id],
			params: { maxHookSec: benchmark.script.hookSec },
		});
	}
	const last = scenes.at(-1);
	if (last) {
		out.push({
			type: "ending_narration_patch",
			targetSceneIds: [last.id],
			params: { structureRoles: [...benchmark.script.structureRoles] },
		});
	}
	if (
		bundle.format === "longform" &&
		benchmark.script.chapterEverySec !== undefined &&
		scenes.length > 0
	) {
		out.push({
			type: "chapter_restructure",
			targetSceneIds: scenes.map((s) => s.id),
			params: { chapterEverySec: benchmark.script.chapterEverySec },
		});
	}
	return out;
}

function ttsCandidates(
	scenes: BundleScene[],
	benchmark: MarketBenchmark,
): FixCandidate[] {
	if (scenes.length === 0) return [];
	const missing = scenes.filter((s) => !s.hasWordTimings).map((s) => s.id);
	// word timing 누락 씬만 재합성 — 전부 정상이면 프로파일 불일치로 보고 전체 재합성
	const targetSceneIds = missing.length > 0 ? missing : scenes.map((s) => s.id);
	return [
		{
			type: "tts_retake",
			targetSceneIds,
			params: { profile: benchmark.tts.profile, speed: benchmark.tts.speed },
		},
	];
}

function bgmCandidates(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
): FixCandidate[] {
	const out: FixCandidate[] = [];
	const lufs = bundle.bgm.lufsEstimate;
	if (
		typeof lufs === "number" &&
		Math.abs(lufs - benchmark.bgm.integratedLufs) > LUFS_TOLERANCE_DB
	) {
		out.push({
			type: "bgm_normalize",
			targetSceneIds: [],
			params: {
				targetLufs: benchmark.bgm.integratedLufs,
				duckingDb: benchmark.bgm.duckingDb,
			},
		});
	}
	const moodMismatch =
		typeof bundle.bgm.mood === "string" &&
		bundle.bgm.mood !== benchmark.bgm.mood;
	const lowQuality =
		typeof bundle.bgm.qualityScore === "number" &&
		bundle.bgm.qualityScore < BGM_SWAP_QUALITY_BAR;
	if (moodMismatch || lowQuality) {
		out.push({
			type: "bgm_swap",
			targetSceneIds: [],
			params: { targetMood: benchmark.bgm.mood },
		});
	}
	if (!bundle.bgm.hasBeatGrid || benchmark.bgm.cueEverySec !== undefined) {
		out.push({
			type: "bgm_cue_replan",
			targetSceneIds: [],
			params:
				benchmark.bgm.cueEverySec !== undefined
					? { cueEverySec: benchmark.bgm.cueEverySec }
					: {},
		});
	}
	if (out.length === 0) {
		// 세부 신호 없이 bar 미달 — 트랙 교체가 가장 일반적인 복구 경로 (fallback)
		out.push({
			type: "bgm_swap",
			targetSceneIds: [],
			params: { targetMood: benchmark.bgm.mood },
		});
	}
	return out;
}

function buildCandidates(
	dimension: QualityDimension,
	scenes: BundleScene[],
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
): FixCandidate[] {
	switch (dimension) {
		case "editing":
			return editingCandidates(scenes, benchmark);
		case "script":
			return scriptCandidates(scenes, bundle, benchmark);
		case "tts":
			return ttsCandidates(scenes, benchmark);
		case "bgm":
			return bgmCandidates(bundle, benchmark);
	}
}

interface RankedAction {
	action: AutoFixAction;
	ratio: number;
	lift: number;
	gapValue: number;
	/** critical=0, below_bar=1 — plan 전역 정렬에서 critical 차원 우선 */
	criticalRank: 0 | 1;
}

function toRanked(
	candidate: FixCandidate,
	verdict: DimensionVerdict,
	gapValue: number,
	budget: FixBudget,
): RankedAction {
	const lift = round2(Math.min(gapValue, LIFT_CAP[candidate.type]));
	const estimatedCost = estimateActionCost(
		candidate.type,
		candidate.targetSceneIds,
		budget,
	);
	return {
		action: {
			id: `${verdict.dimension}:${candidate.type}`,
			type: candidate.type,
			dimension: verdict.dimension,
			targetSceneIds: candidate.targetSceneIds,
			params: candidate.params,
			estimatedCost,
			expectedScoreLift: lift,
			idempotencyKey: buildFixIdempotencyKey(
				candidate.type,
				candidate.targetSceneIds,
				candidate.params,
			),
		},
		ratio: lift / Math.max(estimatedCost.usd, MIN_RATIO_COST_USD),
		lift,
		gapValue,
		criticalRank: verdict.status === "critical" ? 0 : 1,
	};
}

/** 차원 내 후보 선별 순서 — 비율 ↓, lift ↓, type 사전순 (완전 결정론) */
function compareWithinDimension(a: RankedAction, b: RankedAction): number {
	if (b.ratio !== a.ratio) return b.ratio - a.ratio;
	if (b.lift !== a.lift) return b.lift - a.lift;
	return a.action.type.localeCompare(b.action.type);
}

/** plan 전역 순서 — critical 먼저, 이후 비율 ↓ (동률은 lift/gap/이름 순) */
function comparePlanOrder(a: RankedAction, b: RankedAction): number {
	if (a.criticalRank !== b.criticalRank) return a.criticalRank - b.criticalRank;
	if (b.ratio !== a.ratio) return b.ratio - a.ratio;
	if (b.lift !== a.lift) return b.lift - a.lift;
	if (b.gapValue !== a.gapValue) return b.gapValue - a.gapValue;
	if (a.action.dimension !== b.action.dimension) {
		return a.action.dimension.localeCompare(b.action.dimension);
	}
	return a.action.type.localeCompare(b.action.type);
}

/**
 * 차원별 verdict → 자동 수정 plan.
 *
 * - below_bar/critical 차원만 대상, 차원당 최대 2액션
 * - 이력(history)에 같은 멱등키가 있으면 액션 제외 + skippedDuplicateIds 기록
 *   (중복은 차원당 캡을 소모하지 않아 차순위 후보가 올라온다)
 * - 예산 초과 시 requiresApproval=true + approvalReason — 액션은 그대로 유지,
 *   실행 차단은 orchestrator 의 fail-closed 게이트가 담당
 */
export function planAutoFixes(i: {
	dimensions: Record<QualityDimension, DimensionVerdict>;
	bundle: ContentBundle;
	benchmark: MarketBenchmark;
	history: FixHistoryEntry[];
	budget?: FixBudget;
}): AutoFixPlan {
	const budget = i.budget ?? DEFAULT_FIX_BUDGET;
	const scenes = sortScenes(i.bundle.scenes);
	const ranked: RankedAction[] = [];
	const skipped = new Set<string>();

	for (const dimension of DIMENSION_ORDER) {
		const verdict = i.dimensions[dimension];
		if (verdict.status === "pass") continue;
		// gap 부호 규약(bar-score vs score-bar)이 어긋나도 방어적으로 양수 gap 산출
		const gapValue = Math.max(0, verdict.gap, verdict.bar - verdict.score);
		const candidates = buildCandidates(dimension, scenes, i.bundle, i.benchmark)
			.map((candidate) => toRanked(candidate, verdict, gapValue, budget))
			.sort(compareWithinDimension);

		let taken = 0;
		for (const candidate of candidates) {
			if (taken >= MAX_ACTIONS_PER_DIMENSION) break;
			if (hasAppliedFix(i.history, candidate.action.idempotencyKey)) {
				skipped.add(candidate.action.idempotencyKey);
				continue;
			}
			ranked.push(candidate);
			taken += 1;
		}
	}

	ranked.sort(comparePlanOrder);
	const actions = ranked.map((r) => r.action);
	const totalCost = estimateFixCost(actions, budget);

	const reasons: string[] = [];
	if (totalCost.usd > budget.maxUsdPerLoop) {
		reasons.push(`예상 $${totalCost.usd} > 한도 $${budget.maxUsdPerLoop}`);
	}
	if (totalCost.llmCalls > budget.maxLlmCallsPerJudgement) {
		reasons.push(
			`LLM ${totalCost.llmCalls}회 > 한도 ${budget.maxLlmCallsPerJudgement}회`,
		);
	}
	const requiresApproval = reasons.length > 0;

	return {
		actions,
		totalCost,
		requiresApproval,
		...(requiresApproval
			? {
					approvalReason: `예산 초과 — orchestrator 승인 필요: ${reasons.join(", ")}`,
				}
			: {}),
		skippedDuplicateIds: [...skipped],
	};
}
