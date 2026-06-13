/**
 * 판정 엔진 코어 — 점수·verdict 는 항상 결정론(휴리스틱 신호 기반)이며,
 * LLM critic 은 findings/fix 힌트 보강만 한다(불변량 1 — score/verdict 변경 불가).
 *
 * - blocked 는 detectHardBlocks 결정론 규칙에서만 발생 — LLM 이 해제 불가(불변량 2).
 *   하드 블록 감지 시 LLM 콜 자체를 생략한다(비용 0 + 미검증이므로 heuristic_only 표기).
 * - LLM 부재/실패/타임아웃/비정형 응답 → heuristic_only 디그레이드:
 *   ship 금지 + requiresHumanReview=true (불변량 3, resolveVerdict 가 강제).
 * - 멱등(불변량 4): 같은 번들 + 같은 벤치마크 fingerprint → 같은 bundleHash →
 *   verdict 캐시 hit 즉시 반환. LLM 원응답도 bundleHash 키로 캐시.
 * - 롱폼: 챕터별 휴리스틱 + worst-chapter 지배 점수 + 전체 LLM 다이제스트 1패스.
 */

import { planAutoFixes } from "./auto-fix-planner";
import {
	type BundleScene,
	type ContentBundle,
	hashContentBundle,
	segmentBundleIntoChapters,
} from "./content-bundle";
import type { MarketBenchmark } from "./market-benchmark";
import {
	cacheVerdict,
	type FixHistoryEntry,
	loadCachedVerdict,
	type QualityHistoryStore,
} from "./quality-fix-history";
import {
	collectJudgeSignals,
	type JudgeSignals,
} from "./quality-judge-signals";
import {
	aggregateChapterVerdicts,
	aggregateDimensionScores,
	type ChapterVerdict,
	DEFAULT_FIX_BUDGET,
	type DimensionVerdict,
	type FixBudget,
	type HardBlockCode,
	type JudgeMode,
	type QualityDimension,
	type QualityVerdictReport,
	resolveVerdict,
} from "./quality-verdict";
import {
	isAllowedLongformDuration,
	SHORTS_MAX_DURATION_SECONDS,
} from "./reference-duration-policy";

export type LlmCritic = (
	systemPrompt: string,
	userPrompt: string,
	opts?: { jsonMode?: boolean; maxTokens?: number; timeoutMs?: number },
) => Promise<string>;

export interface JudgeOptions {
	llm?: LlmCritic;
	budget?: FixBudget;
	history?: FixHistoryEntry[];
	/** true 면 verdict/LLM 응답 캐시를 읽지 않는다 (쓰기는 수행 — 재판정 결과로 갱신) */
	skipCache?: boolean;
	store?: QualityHistoryStore;
	round?: number;
}

/** marketBar = BASE + confidence × SPAN — builtin(0.4)→70, learned(0.9)→82.5 */
const BASE_MARKET_BAR = 60;
const CONFIDENCE_BAR_SPAN = 25;
/** gap ≤ 이 값이면 below_bar, 초과 시 critical */
const BELOW_BAR_GAP_MAX = 15;
/** quality-judge-signals 의 BGM 만점 환산 기준(MIN_PROFESSIONAL_BGM_SCORE)과 동일 */
const BGM_QUALITY_FULL_CREDIT = 64;
/** BGM 품질 점수 미산출 시 보수 추정 — signals 모듈의 FALLBACK_BGM_QUALITY 와 동일 */
const FALLBACK_BGM_QUALITY = 55;
/** auto-fix-planner 의 BGM_SWAP_QUALITY_BAR 와 동일 — 미만이면 저품질 finding */
const BGM_LOW_QUALITY_BAR = 60;
/** auto-fix-planner 의 LUFS_TOLERANCE_DB 와 동일 — 초과 이탈부터 감점/finding */
const LUFS_TOLERANCE_DB = 2;
/** 허용 오차 초과 후 fit 이 0 까지 떨어지는 LUFS 폭(dB) */
const LUFS_FIT_SPAN_DB = 6;
/** TTS 배속 허용 오차 / 오차 초과 후 fit 0 까지의 폭 */
const TTS_SPEED_TOLERANCE = 0.05;
const TTS_SPEED_FIT_SPAN = 0.45;
/** 벤치마크에 chapterEverySec 가 없을 때 롱폼 챕터 분할 폴백(초) */
const FALLBACK_CHAPTER_EVERY_SEC = 150;
/** 챕터당 LLM 다이제스트 상한 — 80토큰 ≈ 대략 320자 컷 */
const LLM_DIGEST_CHAPTER_MAX_CHARS = 320;
/** LLM 보강 상한 — 폭주 응답이 리포트를 오염시키지 않도록 결정론 컷 */
const LLM_FINDINGS_PER_DIMENSION_MAX = 5;
const LLM_FINDING_MAX_CHARS = 240;
const LLM_FIX_HINTS_MAX = 3;
const CRITIC_MAX_TOKENS = 600;
const CRITIC_TIMEOUT_MS = 12_000;
/** LLM 원응답 캐시 키 — verdict 캐시(quality_verdict_)와 같은 store, 다른 네임스페이스 */
const LLM_RESPONSE_CACHE_PREFIX = "llm_critic_";
/** verdict 캐시 키 컨텍스트 구분자 */
const VERDICT_CTX_SEPARATOR = "_ctx_";

/** 차원 순회 고정 순서 — Record 키 삽입 순서와 무관한 결정론 보장 */
const DIMENSION_ORDER: QualityDimension[] = ["editing", "script", "bgm", "tts"];

const CRITIC_SYSTEM_PROMPT = [
	"너는 유튜브 콘텐츠 품질 비평가다.",
	"점수와 verdict 는 시스템이 휴리스틱 신호로 이미 결정론 산출했다 — 너는 절대 바꿀 수 없다.",
	"메트릭 다이제스트만 보고 차원별 개선 findings 와 fixHints 를 한국어로 제안하라.",
	'출력은 JSON 객체 1개만: {"findings":{"editing":[],"script":[],"bgm":[],"tts":[]},"fixHints":[]}',
].join("\n");

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value) || value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

/** 차원 공통 bar — 벤치마크 신뢰도가 높을수록 시장 바가 올라간다 */
function marketBarFor(benchmark: MarketBenchmark): number {
	const confidence = clamp01(benchmark.confidence);
	return round2(BASE_MARKET_BAR + confidence * CONFIDENCE_BAR_SPAN);
}

function toDimensionVerdict(
	dimension: QualityDimension,
	score: number,
	bar: number,
	findings: string[],
): DimensionVerdict {
	const clamped = round2(Math.min(Math.max(score, 0), 100));
	const gap = round2(bar - clamped);
	const status =
		gap <= 0 ? "pass" : gap <= BELOW_BAR_GAP_MAX ? "below_bar" : "critical";
	return { dimension, score: clamped, bar, gap, status, findings, fixIds: [] };
}

/** 편집 점수 — 신호 모듈의 3개 합성 점수 가중 평균 (LLM 무관, 결정론) */
export function scoreEditing(
	s: JudgeSignals,
	bar: MarketBenchmark,
): DimensionVerdict {
	const e = s.editing;
	const score =
		e.editorialDensityScore * 0.4 +
		e.premiumFloorScore * 0.3 +
		e.openingRetentionScore * 0.3;
	return toDimensionVerdict("editing", score, marketBarFor(bar), [...e.issues]);
}

function normalizeRole(role: string): string {
	return role.trim().toLowerCase();
}

/** 대본 점수 — 훅 시점 35 / 구조 역할 25 / 빈 나레이션 20 / 페이싱 10 / 챕터 10 */
export function scoreScript(
	s: JudgeSignals,
	bar: MarketBenchmark,
): DimensionVerdict {
	const sc = s.script;
	const barHookSec = bar.script.hookSec;
	const hookFit =
		sc.hookSec <= barHookSec
			? 1
			: barHookSec > 0
				? clamp01(barHookSec / sc.hookSec)
				: 0;
	const required = bar.script.structureRoles
		.map(normalizeRole)
		.filter((role) => role.length > 0);
	const actual = new Set(sc.structureRoles.map(normalizeRole));
	const structureFit =
		required.length === 0
			? 1
			: required.filter((role) => actual.has(role)).length / required.length;
	const emptyFit = Math.max(0, 1 - sc.emptyNarrationCount * 0.25);
	const pacingFit = sc.pacing === "slow" ? 0.5 : 1;
	const chapterFit =
		bar.script.chapterEverySec === undefined
			? 1
			: sc.chapterCount >= 2
				? 1
				: 0.5;

	const findings: string[] = [];
	if (hookFit < 1) findings.push("hook_after_bar");
	if (structureFit < 1) findings.push("structure_roles_missing");
	if (sc.emptyNarrationCount > 0) findings.push("empty_narration_scenes");
	if (sc.pacing === "slow") findings.push("pacing_slow");
	if (chapterFit < 1) findings.push("chapter_count_below_expectation");

	const score =
		hookFit * 35 +
		structureFit * 25 +
		emptyFit * 20 +
		pacingFit * 10 +
		chapterFit * 10;
	return toDimensionVerdict("script", score, marketBarFor(bar), findings);
}

/** BGM 점수 — 품질 35 / 무드 25 / 큐 플랜 25 / LUFS 15. claimBlocked 는 0점 fail-closed */
export function scoreBgm(
	s: JudgeSignals,
	bar: MarketBenchmark,
): DimensionVerdict {
	const b = s.bgm;
	const barScore = marketBarFor(bar);
	if (b.claimBlocked) {
		// 저작권 클레임 차단 트랙 — 하드 블록과 별개로 차원 점수도 바닥
		return toDimensionVerdict("bgm", 0, barScore, ["bgm_claim_blocked"]);
	}
	const qualityFit = clamp01(
		(b.qualityScore ?? FALLBACK_BGM_QUALITY) / BGM_QUALITY_FULL_CREDIT,
	);
	const moodFit = b.moodMatched ? 1 : 0;
	const lufsOff =
		b.lufsDelta !== undefined && Math.abs(b.lufsDelta) > LUFS_TOLERANCE_DB;
	// 측정치 부재는 결측(0.5) — 정상도 이탈도 단정하지 않는다
	const lufsFit =
		b.lufsDelta === undefined
			? 0.5
			: lufsOff
				? Math.max(
						0,
						1 - (Math.abs(b.lufsDelta) - LUFS_TOLERANCE_DB) / LUFS_FIT_SPAN_DB,
					)
				: 1;
	const cueFit = b.hasCuePlan ? 1 : 0;

	const findings: string[] = [];
	if (!b.moodMatched) findings.push("bgm_mood_mismatch");
	if (lufsOff) findings.push("bgm_lufs_off_target");
	if (!b.hasCuePlan) findings.push("bgm_no_cue_plan");
	if (b.qualityScore !== undefined && b.qualityScore < BGM_LOW_QUALITY_BAR) {
		findings.push("bgm_low_quality_score");
	}

	const score = qualityFit * 35 + moodFit * 25 + cueFit * 25 + lufsFit * 15;
	return toDimensionVerdict("bgm", score, barScore, findings);
}

/** TTS 점수 — 커버리지 40 / 워드타이밍 25 / 배속 20 / 프로파일 15 */
export function scoreTts(
	s: JudgeSignals,
	bar: MarketBenchmark,
): DimensionVerdict {
	const t = s.tts;
	const coverageFit = clamp01(t.coverageRatio);
	const timingFit = clamp01(t.wordTimingCoverage);
	const speedOff = Math.abs(t.speedDelta) > TTS_SPEED_TOLERANCE;
	const speedFit = speedOff
		? Math.max(
				0,
				1 - (Math.abs(t.speedDelta) - TTS_SPEED_TOLERANCE) / TTS_SPEED_FIT_SPAN,
			)
		: 1;
	const profileFit = t.profileMatched ? 1 : 0;

	const findings: string[] = [];
	if (t.coverageRatio <= 0) findings.push("tts_zero_coverage");
	else if (t.coverageRatio < 1) findings.push("tts_partial_coverage");
	if (t.coverageRatio > 0 && t.wordTimingCoverage < 1) {
		findings.push("tts_word_timing_gaps");
	}
	if (speedOff) findings.push("tts_speed_off_bar");
	if (!t.profileMatched) findings.push("tts_profile_mismatch");

	const score =
		coverageFit * 40 + timingFit * 25 + speedFit * 20 + profileFit * 15;
	return toDimensionVerdict("tts", score, marketBarFor(bar), findings);
}

/**
 * 결정론 하드 블록 — blocked 는 오직 이 규칙들에서만 발생한다(불변량 2).
 * LLM 이 해제할 수 없고, heuristic_only 모드에서도 동일하게 발생한다.
 */
export function detectHardBlocks(
	bundle: ContentBundle,
	signals: JudgeSignals,
): HardBlockCode[] {
	const blocks: HardBlockCode[] = [];
	const sceneCount = bundle.scenes.length;
	if (
		sceneCount > 0 &&
		bundle.scenes.every((scene) => scene.narration.trim().length === 0)
	) {
		blocks.push("empty_narration");
	}
	if (sceneCount === 0) {
		blocks.push("zero_scenes");
	}
	if (
		bundle.format === "shorts" &&
		bundle.durationSec > SHORTS_MAX_DURATION_SECONDS
	) {
		blocks.push("format_duration_violation");
	}
	if (
		bundle.format === "longform" &&
		!isAllowedLongformDuration(bundle.durationSec)
	) {
		blocks.push("format_duration_violation");
	}
	if (sceneCount > 0 && signals.tts.coverageRatio <= 0) {
		blocks.push("tts_zero_coverage");
	}
	if (signals.bgm.claimBlocked) {
		blocks.push("bgm_claim_blocked");
	}
	return blocks;
}

function scoreAllDimensions(
	signals: JudgeSignals,
	benchmark: MarketBenchmark,
): Record<QualityDimension, DimensionVerdict> {
	return {
		editing: scoreEditing(signals, benchmark),
		script: scoreScript(signals, benchmark),
		bgm: scoreBgm(signals, benchmark),
		tts: scoreTts(signals, benchmark),
	};
}

function worstDimensionOf(
	dimensions: Record<QualityDimension, DimensionVerdict>,
): QualityDimension {
	let worst: QualityDimension = DIMENSION_ORDER[0];
	for (const dimension of DIMENSION_ORDER) {
		if (dimensions[dimension].score < dimensions[worst].score) {
			worst = dimension;
		}
	}
	return worst;
}

function chapterSubBundle(
	bundle: ContentBundle,
	scenes: BundleScene[],
): ContentBundle {
	return {
		contentId: bundle.contentId,
		format: bundle.format,
		durationSec: round2(
			scenes.reduce((sum, scene) => sum + scene.durationSec, 0),
		),
		scriptStructure: [...bundle.scriptStructure],
		scenes,
		// tts/bgm 은 번들 전역 신호 — 챕터에도 동일하게 적용된다
		tts: { ...bundle.tts },
		bgm: { ...bundle.bgm },
	};
}

function buildChapterVerdicts(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
): ChapterVerdict[] {
	const everySec =
		benchmark.script.chapterEverySec ?? FALLBACK_CHAPTER_EVERY_SEC;
	return segmentBundleIntoChapters(bundle, everySec).map((chapter) => {
		const sub = chapterSubBundle(bundle, chapter.scenes);
		const signals = collectJudgeSignals(sub, benchmark);
		const dimensions = scoreAllDimensions(signals, benchmark);
		// 챕터는 정의상 전체 포맷 길이보다 짧다 — 길이 규칙은 전체 번들에서만 판정
		const blockedReasons = detectHardBlocks(sub, signals).filter(
			(code) => code !== "format_duration_violation",
		);
		return {
			index: chapter.index,
			startSec: round2(chapter.startSec),
			endSec: round2(chapter.endSec),
			score: aggregateDimensionScores(dimensions),
			worstDimension: worstDimensionOf(dimensions),
			blockedReasons,
		};
	});
}

function dedupeBlocks(codes: HardBlockCode[]): HardBlockCode[] {
	const out: HardBlockCode[] = [];
	const seen = new Set<HardBlockCode>();
	for (const code of codes) {
		if (!seen.has(code)) {
			seen.add(code);
			out.push(code);
		}
	}
	return out;
}

/** 판정의 결정론 코어 — LLM 과 완전히 무관하게 산출되는 모든 것 */
interface JudgeCore {
	signals: JudgeSignals;
	dimensions: Record<QualityDimension, DimensionVerdict>;
	marketBar: number;
	overallScore: number;
	hardBlocks: HardBlockCode[];
	chapters?: ChapterVerdict[];
}

function buildJudgeCore(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
	chapterMode: boolean,
): JudgeCore {
	const signals = collectJudgeSignals(bundle, benchmark);
	const dimensions = scoreAllDimensions(signals, benchmark);
	const core: JudgeCore = {
		signals,
		dimensions,
		marketBar: marketBarFor(benchmark),
		overallScore: aggregateDimensionScores(dimensions),
		hardBlocks: detectHardBlocks(bundle, signals),
	};
	if (chapterMode) {
		const chapters = buildChapterVerdicts(bundle, benchmark);
		const agg = aggregateChapterVerdicts(chapters);
		core.chapters = chapters;
		// worst-chapter 지배 — 평균이 망가진 챕터를 가리지 못한다
		core.overallScore = agg.score;
		core.hardBlocks = dedupeBlocks([...core.hardBlocks, ...agg.hardBlocks]);
	}
	return core;
}

/** LLM 보강물 — findings 문자열만 운반한다. 점수·verdict 필드는 존재하지 않는다 */
interface LlmCritique {
	findings: Partial<Record<QualityDimension, string[]>>;
	fixHints: string[];
}

function stripCodeFence(raw: string): string {
	const trimmed = raw.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	return fenced?.[1] ?? trimmed;
}

function sanitizeTexts(value: unknown, max: number): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((text) => text.trim())
		.filter((text) => text.length > 0)
		.slice(0, max)
		.map((text) => text.slice(0, LLM_FINDING_MAX_CHARS));
}

/** 비정형 응답은 throw — 호출부가 heuristic_only 로 디그레이드한다 */
function parseCritique(raw: string): LlmCritique {
	const parsed: unknown = JSON.parse(stripCodeFence(raw));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("llm_critique_not_object");
	}
	const record = parsed as Record<string, unknown>;
	const findings: Partial<Record<QualityDimension, string[]>> = {};
	const rawFindings = record.findings;
	if (
		typeof rawFindings === "object" &&
		rawFindings !== null &&
		!Array.isArray(rawFindings)
	) {
		const findingsRecord = rawFindings as Record<string, unknown>;
		for (const dimension of DIMENSION_ORDER) {
			const texts = sanitizeTexts(
				findingsRecord[dimension],
				LLM_FINDINGS_PER_DIMENSION_MAX,
			);
			if (texts.length > 0) findings[dimension] = texts;
		}
	}
	return {
		findings,
		fixHints: sanitizeTexts(record.fixHints, LLM_FIX_HINTS_MAX),
	};
}

async function runLlmCritique(i: {
	llm: LlmCritic;
	bundleHash: string;
	digest: string;
	store?: QualityHistoryStore;
	skipCache: boolean;
}): Promise<LlmCritique> {
	const cacheKey = `${LLM_RESPONSE_CACHE_PREFIX}${i.bundleHash}`;
	let raw: string | null = null;
	if (!i.skipCache) {
		const cached = loadCachedVerdict<unknown>(cacheKey, i.store);
		if (typeof cached === "string") raw = cached;
	}
	if (raw === null) {
		raw = await i.llm(CRITIC_SYSTEM_PROMPT, i.digest, {
			jsonMode: true,
			maxTokens: CRITIC_MAX_TOKENS,
			timeoutMs: CRITIC_TIMEOUT_MS,
		});
		// 파싱 전 캐시 — 비정형 응답도 재호출 비용 없이 결정론 디그레이드 유지
		cacheVerdict(cacheKey, raw, i.store);
	}
	return parseCritique(raw);
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function cloneDimensions(
	dimensions: Record<QualityDimension, DimensionVerdict>,
): Record<QualityDimension, DimensionVerdict> {
	const out = {} as Record<QualityDimension, DimensionVerdict>;
	for (const dimension of DIMENSION_ORDER) {
		const verdict = dimensions[dimension];
		out[dimension] = {
			...verdict,
			findings: [...verdict.findings],
			fixIds: [...verdict.fixIds],
		};
	}
	return out;
}

/** LLM 보강 적용 — findings 문자열만 증분. score/bar/gap/status 는 절대 불변(불변량 1) */
function applyCritique(
	dimensions: Record<QualityDimension, DimensionVerdict>,
	critique: LlmCritique,
): Record<QualityDimension, DimensionVerdict> {
	const out = cloneDimensions(dimensions);
	for (const dimension of DIMENSION_ORDER) {
		const additions = (critique.findings[dimension] ?? []).map(
			(text) => `llm: ${text}`,
		);
		if (additions.length > 0) {
			out[dimension].findings = dedupeStrings([
				...out[dimension].findings,
				...additions,
			]);
		}
	}
	if (critique.fixHints.length > 0) {
		// fix 힌트는 가장 점수가 낮은 미통과 차원에 귀속 — 전부 pass 면 버린다
		let target: QualityDimension | undefined;
		for (const dimension of DIMENSION_ORDER) {
			if (out[dimension].status === "pass") continue;
			if (target === undefined || out[dimension].score < out[target].score) {
				target = dimension;
			}
		}
		if (target !== undefined) {
			out[target].findings = dedupeStrings([
				...out[target].findings,
				...critique.fixHints.map((hint) => `llm_fix_hint: ${hint}`),
			]);
		}
	}
	return out;
}

function finalizeReport(i: {
	bundle: ContentBundle;
	benchmark: MarketBenchmark;
	core: JudgeCore;
	judgeMode: JudgeMode;
	critique?: LlmCritique;
	history: FixHistoryEntry[];
	budget: FixBudget;
	round: number;
	bundleHash: string;
}): QualityVerdictReport {
	const dimensions = i.critique
		? applyCritique(i.core.dimensions, i.critique)
		: cloneDimensions(i.core.dimensions);
	const { verdict, requiresHumanReview } = resolveVerdict({
		overallScore: i.core.overallScore,
		marketBar: i.core.marketBar,
		hardBlocks: i.core.hardBlocks,
		judgeMode: i.judgeMode,
	});
	const autoFixPlan = planAutoFixes({
		dimensions,
		bundle: i.bundle,
		benchmark: i.benchmark,
		history: i.history,
		budget: i.budget,
	});
	for (const dimension of DIMENSION_ORDER) {
		dimensions[dimension].fixIds = autoFixPlan.actions
			.filter((action) => action.dimension === dimension)
			.map((action) => action.id);
	}
	const report: QualityVerdictReport = {
		verdict,
		overallScore: i.core.overallScore,
		marketBar: i.core.marketBar,
		judgeMode: i.judgeMode,
		requiresHumanReview,
		hardBlocks: [...i.core.hardBlocks],
		bundleHash: i.bundleHash,
		benchmarkFingerprint: i.benchmark.fingerprint,
		round: i.round,
		dimensions,
		autoFixPlan,
		estimatedFixCost: autoFixPlan.totalCost,
		judgedAt: new Date().toISOString(),
	};
	if (i.core.chapters !== undefined) {
		report.chapters = i.core.chapters.map((chapter) => ({
			...chapter,
			blockedReasons: [...chapter.blockedReasons],
		}));
	}
	return report;
}

function isQualityVerdictReport(value: unknown): value is QualityVerdictReport {
	if (typeof value !== "object" || value === null) return false;
	const r = value as Record<string, unknown>;
	if (
		r.verdict !== "ship" &&
		r.verdict !== "improve" &&
		r.verdict !== "blocked"
	) {
		return false;
	}
	if (r.judgeMode !== "llm_assisted" && r.judgeMode !== "heuristic_only") {
		return false;
	}
	const dimensions = r.dimensions;
	if (typeof dimensions !== "object" || dimensions === null) return false;
	const dimensionRecord = dimensions as Record<string, unknown>;
	for (const dimension of DIMENSION_ORDER) {
		const entry = dimensionRecord[dimension];
		if (typeof entry !== "object" || entry === null) return false;
	}
	return (
		typeof r.overallScore === "number" &&
		typeof r.marketBar === "number" &&
		typeof r.requiresHumanReview === "boolean" &&
		Array.isArray(r.hardBlocks) &&
		typeof r.bundleHash === "string" &&
		typeof r.benchmarkFingerprint === "string" &&
		typeof r.round === "number" &&
		typeof r.autoFixPlan === "object" &&
		r.autoFixPlan !== null &&
		typeof r.judgedAt === "string"
	);
}

/**
 * 동기 디그레이드·테스트·CI 게이트 경로 — LLM 없이 순수 결정론 판정.
 * heuristic_only 이므로 ship 은 절대 나오지 않는다(불변량 3).
 * 롱폼은 동일하게 챕터별 휴리스틱 + worst-chapter 지배 점수를 적용한다.
 */
export function judgeContentBundleHeuristic(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
	history?: FixHistoryEntry[],
): QualityVerdictReport {
	const core = buildJudgeCore(bundle, benchmark, bundle.format === "longform");
	return finalizeReport({
		bundle,
		benchmark,
		core,
		judgeMode: "heuristic_only",
		history: history ?? [],
		budget: DEFAULT_FIX_BUDGET,
		round: 0,
		bundleHash: hashContentBundle(bundle, benchmark.fingerprint),
	});
}

/**
 * FNV-1a 32bit — verdict 캐시 컨텍스트 키 파생용 비암호화 해시.
 * 점수/verdict 결정에 영향 없음; 캐시 격리 목적으로만 사용.
 */
function fnv1a32(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

/**
 * verdict 캐시 키 = bundleHash + "_ctx_" + fnv1a32(컨텍스트 직렬화).
 * 컨텍스트 = llm 가용성(boolean) + maxLlmCallsPerJudgement + maxUsdPerLoop + history idempotencyKey 정렬 합본.
 * maxUsdPerLoop 는 autoFixPlan.requiresApproval / estimatedFixCost.withinBudget 에 직접 영향 —
 * 다른 예산으로 캐시된 리포트의 승인 플래그가 재사용되는 것을 막는다.
 * maxRounds 는 orchestrator 전용(planner/judge 출력 무관)이므로 포함하지 않는다.
 * LLM 원응답 캐시(llm_critic_ 프리픽스)는 bundleHash 기반 유지 — 변경 없음.
 */
function buildVerdictCacheKey(
	bundleHash: string,
	options: JudgeOptions,
): string {
	const budget = options.budget ?? DEFAULT_FIX_BUDGET;
	const hasLlm = options.llm !== undefined ? "1" : "0";
	const maxCalls = String(budget.maxLlmCallsPerJudgement);
	const maxUsd = String(budget.maxUsdPerLoop);
	const historyKeys = (options.history ?? [])
		.map((e) => e.idempotencyKey)
		.sort()
		.join(",");
	const ctx = `${hasLlm}|${maxCalls}|${maxUsd}|${historyKeys}`;
	return `${bundleHash}${VERDICT_CTX_SEPARATOR}${fnv1a32(ctx)}`;
}

async function judgeWithOptions(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
	options: JudgeOptions,
	chapterMode: boolean,
): Promise<QualityVerdictReport> {
	const bundleHash = hashContentBundle(bundle, benchmark.fingerprint);
	const verdictCacheKey = buildVerdictCacheKey(bundleHash, options);
	const skipCache = options.skipCache === true;
	if (!skipCache) {
		const cached = loadCachedVerdict<unknown>(verdictCacheKey, options.store);
		if (isQualityVerdictReport(cached) && cached.bundleHash === bundleHash) {
			// 멱등: 같은 번들+벤치마크+판정 컨텍스트 → 같은 판정 즉시 반환 (LLM 재호출 0)
			return cached;
		}
	}

	const core = buildJudgeCore(bundle, benchmark, chapterMode);
	const budget = options.budget ?? DEFAULT_FIX_BUDGET;
	const base = {
		bundle,
		benchmark,
		core,
		history: options.history ?? [],
		budget,
		round: options.round ?? 0,
		bundleHash,
	};

	let report: QualityVerdictReport;
	if (
		!options.llm ||
		budget.maxLlmCallsPerJudgement <= 0 ||
		core.hardBlocks.length > 0
	) {
		// LLM 부재 / 예산상 호출 불가(fail-closed) / 하드 블록(LLM 해제 불가, 콜 낭비 차단)
		report = finalizeReport({ ...base, judgeMode: "heuristic_only" });
	} else {
		try {
			// 쇼츠·롱폼 모두 다이제스트 합본 1콜 — 상한(maxLlmCallsPerJudgement) 항상 준수
			const critique = await runLlmCritique({
				llm: options.llm,
				bundleHash,
				digest: buildLlmDigest(bundle, benchmark, core.chapters),
				...(options.store !== undefined ? { store: options.store } : {}),
				skipCache,
			});
			report = finalizeReport({
				...base,
				judgeMode: "llm_assisted",
				critique,
			});
		} catch {
			// LLM 실패/타임아웃/비정형 응답 — heuristic_only 디그레이드(불변량 3)
			report = finalizeReport({ ...base, judgeMode: "heuristic_only" });
		}
	}

	cacheVerdict(verdictCacheKey, report, options.store);
	return report;
}

/**
 * 판정 엔진 진입점 — verdict 캐시 hit 즉시 반환(멱등),
 * format longform 이면 챕터 판정으로 위임, LLM 실패는 heuristic_only 디그레이드.
 */
export async function judgeContentBundle(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
	options: JudgeOptions = {},
): Promise<QualityVerdictReport> {
	return judgeWithOptions(
		bundle,
		benchmark,
		options,
		bundle.format === "longform",
	);
}

/**
 * 롱폼 챕터 판정 — chapterEverySec(결측 시 150초) 기준 분할 → 챕터별 휴리스틱 →
 * worst-chapter 지배 집계 → LLM 다이제스트 합본 정확히 1콜.
 */
export async function judgeLongformByChapters(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
	options: JudgeOptions = {},
): Promise<QualityVerdictReport> {
	return judgeWithOptions(bundle, benchmark, options, true);
}

/**
 * LLM critic 입력 다이제스트 — 스크립트 전문은 절대 포함하지 않고
 * 메트릭 요약만 담는다. 챕터 라인은 320자(≈80토큰) 컷.
 */
export function buildLlmDigest(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
	chapters?: ChapterVerdict[],
): string {
	const s = collectJudgeSignals(bundle, benchmark);
	const lines: string[] = [
		"=== 품질 판정 다이제스트 (메트릭 요약 — 스크립트 전문 미포함) ===",
		`format=${bundle.format} duration=${round2(bundle.durationSec)}s scenes=${bundle.scenes.length}`,
		`benchmark=${benchmark.id} bar(cut=${benchmark.editing.cutDensitySec}s hook=${benchmark.script.hookSec}s captions/min=${benchmark.editing.captionsPerMin} motion=${benchmark.editing.motionRatio} lufs=${benchmark.bgm.integratedLufs} mood=${benchmark.bgm.mood} tts=${benchmark.tts.profile}@${benchmark.tts.speed})`,
		`editing: density=${s.editing.editorialDensityScore} premiumFloor=${s.editing.premiumFloorScore} retention=${s.editing.openingRetentionScore} avgCut=${s.editing.avgCutSec}s motion=${s.editing.motionRatio} captions/min=${s.editing.captionsPerMin} issues=${s.editing.issues.join("|") || "-"}`,
		`script: hookPattern=${s.script.hookPattern || "-"} hookSec=${s.script.hookSec} pacing=${s.script.pacing} emptyNarration=${s.script.emptyNarrationCount} chapters=${s.script.chapterCount} roles=${s.script.structureRoles.join(",") || "-"}`,
		`bgm: quality=${s.bgm.qualityScore ?? "-"} moodMatched=${s.bgm.moodMatched} lufsDelta=${s.bgm.lufsDelta ?? "-"} cuePlan=${s.bgm.hasCuePlan} claimBlocked=${s.bgm.claimBlocked}`,
		`tts: coverage=${s.tts.coverageRatio} wordTiming=${s.tts.wordTimingCoverage} speedDelta=${s.tts.speedDelta} profileMatched=${s.tts.profileMatched}`,
	];
	if (chapters !== undefined) {
		for (const chapter of chapters) {
			const line = `[chapter ${chapter.index}] ${chapter.startSec}-${chapter.endSec}s score=${chapter.score} worst=${chapter.worstDimension} blocked=${chapter.blockedReasons.join("|") || "-"}`;
			lines.push(line.slice(0, LLM_DIGEST_CHAPTER_MAX_CHARS));
		}
	}
	lines.push(
		'응답은 JSON 객체 1개만: {"findings":{"editing":[],"script":[],"bgm":[],"tts":[]},"fixHints":[]}',
	);
	return lines.join("\n");
}
