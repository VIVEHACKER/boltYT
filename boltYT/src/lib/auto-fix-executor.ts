/**
 * 자동 수정 실행기 — AutoFixPlan 의 액션을 기존 repair API 로 라우팅하는 어댑터.
 *
 * 시스템 불변량 (이 모듈이 집행):
 * - fail-closed 승인 게이트: plan.requiresApproval 이면 전부 needs-approval skip.
 *   실행기는 승인을 해제할 수 없다 (승인 콜백 부재 = 초과 plan 전부 skip).
 * - 적용 직전 멱등키 재확인: 이력 + 이번 실행 내 중복 모두 duplicate skip.
 * - 비용 fail-closed: 누적 비용이 DEFAULT_FIX_BUDGET 한도를 넘는 순간
 *   잔여 액션 전부 over-budget skip. 실패한 액션의 비용도 소모로 간주.
 * - 액션별 try/catch: 1액션 실패가 전체 실행을 중단시키지 않는다.
 * - dryRun: 라우팅/패치 계산은 전부 수행하되 ctx 콜백 호출만 생략 —
 *   결과(applied/historyEntries/costUsd)는 실제 실행과 동일하게 보고한다.
 */

import type { RemotionScene } from "../remotion/types";
import type { Scene } from "../types/database";
import { type BgmCuePlan, planBgmCuePlan } from "./bgm-cue-plan";
import { type FixHistoryEntry, hasAppliedFix } from "./quality-fix-history";
import {
	type AutoFixAction,
	type AutoFixPlan,
	DEFAULT_FIX_BUDGET,
	type FixBudget,
} from "./quality-verdict";
import { composeNarrationTtsOptions, type NarrationTtsSignal } from "./tts";
import {
	buildMotionRepairPatch,
	buildReferenceRepairGuidance,
	type ReferenceRepairGuidance,
	type SceneRepairPatch,
	strengthenEndingNarration,
} from "./youtube-production-repair";
import { strengthenOpeningRetention } from "./youtube-retention";

/**
 * BGM 정규화 게인 지시값 — 실제 게인 적용은 AudioBuffer 가 있는 렌더 시점에
 * normalizeBgmBuffer(buffer, targetDb) 로 수행한다 (node 에서 측정 불가).
 * currentLufs 를 알 때만 gainDb/gainLinear 를 미리 계산해 동봉한다.
 */
export interface BgmNormalizeDirective {
	targetDb: number;
	duckingDb?: number;
	gainDb?: number;
	gainLinear?: number;
}

export interface AutoFixContext {
	scenes: Scene[];
	applyScenePatch: (sceneId: string, patch: SceneRepairPatch) => void;
	replaceNarration: (sceneId: string, narration: string) => void;
	retakeTts?: (
		sceneIds: string[],
		options: Record<string, unknown>,
	) => Promise<void>;
	swapBgm?: (mood: string) => Promise<void>;
	/** bgm_normalize 게인 지시값 수신 콜백 — 부재 시 해당 액션은 unsupported skip */
	normalizeBgm?: (directive: BgmNormalizeDirective) => void | Promise<void>;
	/** bgm_cue_replan 재계산 결과 수신 콜백 — 부재 시 해당 액션은 unsupported skip */
	replanBgmCues?: (plan: BgmCuePlan) => void | Promise<void>;
	referenceDna?: unknown;
	/** 나레이션 보강 문구 선택용 — 미지정 시 shorts */
	format?: "shorts" | "longform";
	/** 오프닝 훅 앵커 폴백 (news_title 부재 시) */
	topicTitle?: string;
	/** historyEntries 에 기록할 번들 해시 — 미지정 시 "" */
	bundleHash?: string;
	/** historyEntries 에 기록할 라운드 — 미지정 시 1 */
	round?: number;
	dryRun?: boolean;
}

export type AutoFixSkipReason =
	| "duplicate"
	| "needs-approval"
	| "over-budget"
	| "unsupported";

export interface AutoFixExecutionResult {
	applied: AutoFixAction[];
	skipped: { action: AutoFixAction; reason: AutoFixSkipReason }[];
	failed: { action: AutoFixAction; error: string }[];
	historyEntries: FixHistoryEntry[];
	/** 적용 시도된 비용 합 (USD) — 실패한 액션도 소모로 간주 (fail-closed 과금) */
	costUsd: number;
}

const CUE_PLAN_FPS = 30;
/** computeBgmNormalizeGain(bgm-loudness)과 동일한 게인 클램프 (dB) */
const BGM_GAIN_MIN_DB = -24;
const BGM_GAIN_MAX_DB = 18;
/** bgm-loudness 의 기본 타깃과 동일 */
const BGM_DEFAULT_TARGET_DB = -23;

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}

function numberParam(
	params: Record<string, unknown>,
	key: string,
): number | undefined {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function stringParam(
	params: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = params[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 입력 배열 순서와 무관한 결정론 정렬 (content-bundle/planner 와 동일 규칙) */
function sortScenes(scenes: Scene[]): Scene[] {
	return [...scenes].sort(
		(a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id),
	);
}

function findScene(scenes: Scene[], sceneId: string): Scene {
	const found = scenes.find((s) => s.id === sceneId);
	if (!found) {
		throw new Error(`대상 씬 없음: ${sceneId}`);
	}
	return found;
}

/** 명시 대상이 없으면 전체 씬 대상 (caption_density_patch 등 전역 패치) */
function resolveTargets(action: AutoFixAction, sorted: Scene[]): string[] {
	return action.targetSceneIds.length > 0
		? action.targetSceneIds
		: sorted.map((s) => s.id);
}

/**
 * bgm_normalize 게인 지시값 계산 — 순수/결정론.
 * gainDb 클램프는 computeBgmNormalizeGain 과 동일(-24..+18dB).
 */
export function buildBgmNormalizeDirective(
	params: Record<string, unknown>,
): BgmNormalizeDirective {
	const targetDb = numberParam(params, "targetLufs") ?? BGM_DEFAULT_TARGET_DB;
	const duckingDb = numberParam(params, "duckingDb");
	const currentLufs = numberParam(params, "currentLufs");
	const directive: BgmNormalizeDirective = { targetDb };
	if (duckingDb !== undefined) {
		directive.duckingDb = duckingDb;
	}
	if (currentLufs !== undefined) {
		const gainDb = Math.max(
			BGM_GAIN_MIN_DB,
			Math.min(BGM_GAIN_MAX_DB, targetDb - currentLufs),
		);
		directive.gainDb = round2(gainDb);
		directive.gainLinear = round4(10 ** (gainDb / 20));
	}
	return directive;
}

/** 큐 플랜 계산용 최소 RemotionScene 합성 — 시각 자산 URL 은 플랜에 불필요 */
function toRemotionScenes(sorted: Scene[]): RemotionScene[] {
	return sorted.map((s) => ({
		imageUrl: "",
		audioUrl: "",
		narration: s.narration_text,
		durationInFrames: Math.max(
			0,
			Math.round(
				(Number.isFinite(s.duration_seconds) ? s.duration_seconds : 0) *
					CUE_PLAN_FPS,
			),
		),
		type: s.scene_type,
		mood: s.mood,
	}));
}

function runScenePatch(
	action: AutoFixAction,
	ctx: AutoFixContext,
	sorted: Scene[],
	guidance: ReferenceRepairGuidance | undefined,
	dryRun: boolean,
): void {
	const targets = resolveTargets(action, sorted);
	if (targets.length === 0) {
		throw new Error(`${action.type}: 패치 대상 씬 없음`);
	}
	for (const sceneId of targets) {
		const index = sorted.findIndex((s) => s.id === sceneId);
		if (index < 0) {
			throw new Error(`대상 씬 없음: ${sceneId}`);
		}
		const patch = buildMotionRepairPatch(sorted[index], index, {
			dense: true,
			referenceGuidance: guidance,
		});
		if (!dryRun) {
			ctx.applyScenePatch(sceneId, patch);
		}
	}
}

function runOpeningHookRewrite(
	ctx: AutoFixContext,
	sorted: Scene[],
	dryRun: boolean,
): void {
	const first = sorted.at(0);
	if (!first) {
		throw new Error("opening_hook_rewrite: 씬 없음");
	}
	const retentionInput = sorted.map((s) => ({
		narration: s.narration_text,
		news_title: s.news_title,
		scene_type: s.scene_type,
		duration_seconds: s.duration_seconds,
	}));
	const strengthened = strengthenOpeningRetention(retentionInput, {
		format: ctx.format ?? "shorts",
		topicTitle: ctx.topicTitle,
	});
	const next = strengthened.at(0)?.narration ?? "";
	// 이미 강한 훅이면 원문 그대로 — no-op 도 정상 적용(멱등)으로 기록해 재시도 루프 차단
	if (next && next !== first.narration_text && !dryRun) {
		ctx.replaceNarration(first.id, next);
	}
}

function runEndingNarrationPatch(
	action: AutoFixAction,
	ctx: AutoFixContext,
	sorted: Scene[],
	dryRun: boolean,
): void {
	const targetId = action.targetSceneIds.at(-1) ?? sorted.at(-1)?.id;
	if (!targetId) {
		throw new Error("ending_narration_patch: 씬 없음");
	}
	const scene = findScene(sorted, targetId);
	const next = strengthenEndingNarration(
		scene.narration_text,
		ctx.format ?? "shorts",
	);
	if (next !== scene.narration_text && !dryRun) {
		ctx.replaceNarration(targetId, next);
	}
}

async function runTtsRetake(
	action: AutoFixAction,
	ctx: AutoFixContext,
	sorted: Scene[],
	dryRun: boolean,
): Promise<void> {
	const targets = resolveTargets(action, sorted);
	if (targets.length === 0) {
		throw new Error("tts_retake: 대상 씬 없음");
	}
	const signals: NarrationTtsSignal[] = targets.map((id) => {
		const scene = findScene(sorted, id);
		return {
			narration: scene.narration_text,
			mood: scene.mood,
			type: scene.scene_type,
		};
	});
	const speed = numberParam(action.params, "speed");
	const composed = composeNarrationTtsOptions(
		signals,
		speed !== undefined ? { speed } : {},
	);
	// planner params(profile/speed)가 합성 옵션을 덮어쓴다 — 벤치마크 지시가 우선
	const options: Record<string, unknown> = { ...composed, ...action.params };
	if (!dryRun) {
		await ctx.retakeTts?.(targets, options);
	}
}

async function runBgmSwap(
	action: AutoFixAction,
	ctx: AutoFixContext,
	dryRun: boolean,
): Promise<void> {
	const mood =
		stringParam(action.params, "targetMood") ??
		stringParam(action.params, "mood");
	if (!mood) {
		throw new Error("bgm_swap: targetMood 파라미터 없음");
	}
	if (!dryRun) {
		await ctx.swapBgm?.(mood);
	}
}

/** unsupported 게이트 — 1차 미지원 액션 + 필요한 ctx 콜백 부재 */
function isUnsupported(action: AutoFixAction, ctx: AutoFixContext): boolean {
	switch (action.type) {
		case "chapter_restructure":
			// 1차 미지원 — 챕터 재구성은 LLM 대본 재작성이 필요해 후속 단계에서 지원
			return true;
		case "tts_retake":
			return ctx.retakeTts === undefined;
		case "bgm_swap":
			return ctx.swapBgm === undefined;
		case "bgm_normalize":
			return ctx.normalizeBgm === undefined;
		case "bgm_cue_replan":
			return ctx.replanBgmCues === undefined;
		default:
			return false;
	}
}

async function runAction(
	action: AutoFixAction,
	ctx: AutoFixContext,
	sorted: Scene[],
	guidance: ReferenceRepairGuidance | undefined,
	dryRun: boolean,
): Promise<void> {
	switch (action.type) {
		case "scene_density_patch":
		case "caption_density_patch":
			runScenePatch(action, ctx, sorted, guidance, dryRun);
			return;
		case "opening_hook_rewrite":
			runOpeningHookRewrite(ctx, sorted, dryRun);
			return;
		case "ending_narration_patch":
			runEndingNarrationPatch(action, ctx, sorted, dryRun);
			return;
		case "tts_retake":
			await runTtsRetake(action, ctx, sorted, dryRun);
			return;
		case "bgm_swap":
			await runBgmSwap(action, ctx, dryRun);
			return;
		case "bgm_normalize": {
			const directive = buildBgmNormalizeDirective(action.params);
			if (!dryRun) {
				await ctx.normalizeBgm?.(directive);
			}
			return;
		}
		case "bgm_cue_replan": {
			const cuePlan = planBgmCuePlan(toRemotionScenes(sorted), {
				fps: CUE_PLAN_FPS,
			});
			if (!dryRun) {
				await ctx.replanBgmCues?.(cuePlan);
			}
			return;
		}
		case "chapter_restructure":
			// isUnsupported 게이트에서 걸러져 도달 불가 — 방어
			throw new Error("chapter_restructure 는 1차 미지원");
	}
}

/**
 * plan 실행. 액션 순서는 plan 순서(planner 가 이미 우선순위 정렬)를 따른다.
 *
 * 액션별 게이트 순서: duplicate → over-budget → unsupported → 실행.
 * 누적 비용이 budget 한도를 넘는 순간 잔여 액션은 전부 over-budget skip.
 * budget 미지정 시 DEFAULT_FIX_BUDGET 사용.
 */
export async function executeAutoFixPlan(
	plan: AutoFixPlan,
	ctx: AutoFixContext,
	history: FixHistoryEntry[],
	budget: FixBudget = DEFAULT_FIX_BUDGET,
): Promise<AutoFixExecutionResult> {
	const result: AutoFixExecutionResult = {
		applied: [],
		skipped: [],
		failed: [],
		historyEntries: [],
		costUsd: 0,
	};

	// fail-closed: 승인 필요 plan 은 실행기가 해제 불가 — 전부 skip
	if (plan.requiresApproval) {
		result.skipped = plan.actions.map((action) => ({
			action,
			reason: "needs-approval" as const,
		}));
		return result;
	}
	// 방어: planner 가 승인 플래그를 빠뜨려도 총 견적이 예산 밖이면 전부 skip
	if (!plan.totalCost.withinBudget) {
		result.skipped = plan.actions.map((action) => ({
			action,
			reason: "over-budget" as const,
		}));
		return result;
	}

	const dryRun = ctx.dryRun === true;
	const sorted = sortScenes(ctx.scenes);
	const guidance = buildReferenceRepairGuidance(ctx.referenceDna);
	const appliedKeys = new Set<string>();
	let cumulativeUsd = 0;
	let cumulativeLlmCalls = 0;
	let budgetExhausted = false;

	for (const action of plan.actions) {
		// 적용 직전 멱등키 재확인 — 이력 + 이번 실행 내 중복 모두 영구 차단
		if (
			hasAppliedFix(history, action.idempotencyKey) ||
			appliedKeys.has(action.idempotencyKey)
		) {
			result.skipped.push({ action, reason: "duplicate" });
			continue;
		}

		const nextUsd = round4(cumulativeUsd + action.estimatedCost.usd);
		const nextLlmCalls = cumulativeLlmCalls + action.estimatedCost.llmCalls;
		if (
			budgetExhausted ||
			nextUsd > budget.maxUsdPerLoop ||
			nextLlmCalls > budget.maxLlmCallsPerJudgement
		) {
			budgetExhausted = true;
			result.skipped.push({ action, reason: "over-budget" });
			continue;
		}

		if (isUnsupported(action, ctx)) {
			result.skipped.push({ action, reason: "unsupported" });
			continue;
		}

		try {
			await runAction(action, ctx, sorted, guidance, dryRun);
			cumulativeUsd = nextUsd;
			cumulativeLlmCalls = nextLlmCalls;
			appliedKeys.add(action.idempotencyKey);
			result.applied.push(action);
			result.historyEntries.push({
				idempotencyKey: action.idempotencyKey,
				actionType: action.type,
				bundleHash: ctx.bundleHash ?? "",
				round: ctx.round ?? 1,
				appliedAt: new Date().toISOString(),
			});
		} catch (error) {
			// 실패해도 비용은 소모된 것으로 간주 (fail-closed 과금) — 나머지는 계속
			cumulativeUsd = nextUsd;
			cumulativeLlmCalls = nextLlmCalls;
			result.failed.push({ action, error: errorMessage(error) });
		}
	}

	result.costUsd = round4(cumulativeUsd);
	return result;
}
