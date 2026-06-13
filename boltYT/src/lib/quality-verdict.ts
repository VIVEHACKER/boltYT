/**
 * 품질 판정 공유 타입 허브 + 순수 판정 정책.
 *
 * judge ↔ planner 순환 import 차단용 — 이 파일은 다른 신규 모듈을 import하지 않는다.
 *
 * 시스템 불변량 (이 파일이 함수로 고정):
 * 1. heuristic_only(LLM 부재/실패) 모드는 ship 금지 → improve + requiresHumanReview 강등
 * 2. blocked는 결정론 HardBlockCode에서만 발생 — LLM이 해제 불가, heuristic_only에서도 발생
 * 3. 기존 verdict 체계와 합성 시 blocked=합집합, ship=교집합
 */

export type QualityDimension = "editing" | "bgm" | "tts" | "script";

export type QualityVerdict = "ship" | "improve" | "blocked";

export type JudgeMode = "llm_assisted" | "heuristic_only";

/** 결정론 하드 블록 코드 — 이 코드들만 blocked를 만들 수 있다 */
export type HardBlockCode =
	| "empty_narration"
	| "zero_scenes"
	| "format_duration_violation"
	| "tts_zero_coverage"
	| "copy_boundary_violation"
	| "bgm_claim_blocked";

export interface DimensionVerdict {
	dimension: QualityDimension;
	score: number;
	bar: number;
	gap: number;
	status: "pass" | "below_bar" | "critical";
	findings: string[];
	fixIds: string[];
}

export type AutoFixActionType =
	| "scene_density_patch"
	| "opening_hook_rewrite"
	| "ending_narration_patch"
	| "tts_retake"
	| "bgm_swap"
	| "bgm_normalize"
	| "bgm_cue_replan"
	| "caption_density_patch"
	| "chapter_restructure";

export interface FixCostEstimate {
	usd: number;
	llmCalls: number;
	ttsChars: number;
	bgmGenerations: number;
	withinBudget: boolean;
}

export interface AutoFixAction {
	id: string;
	type: AutoFixActionType;
	dimension: QualityDimension;
	targetSceneIds: string[];
	params: Record<string, unknown>;
	estimatedCost: FixCostEstimate;
	expectedScoreLift: number;
	/** 같은 키의 fix는 중복 적용 영구 차단 */
	idempotencyKey: string;
}

export interface AutoFixPlan {
	actions: AutoFixAction[];
	totalCost: FixCostEstimate;
	requiresApproval: boolean;
	approvalReason?: string;
	skippedDuplicateIds: string[];
}

export interface FixBudget {
	maxUsdPerLoop: number;
	maxLlmCallsPerJudgement: number;
	maxRounds: number;
}

/** 비용 fail-closed 기본 예산 — 승인 콜백 부재 시 초과 plan은 전부 skip */
export const DEFAULT_FIX_BUDGET: FixBudget = {
	maxUsdPerLoop: 0.5,
	maxLlmCallsPerJudgement: 2,
	maxRounds: 2,
};

export interface ChapterVerdict {
	index: number;
	startSec: number;
	endSec: number;
	score: number;
	worstDimension: QualityDimension;
	blockedReasons: HardBlockCode[];
}

export interface QualityVerdictReport {
	verdict: QualityVerdict;
	overallScore: number;
	marketBar: number;
	judgeMode: JudgeMode;
	requiresHumanReview: boolean;
	hardBlocks: HardBlockCode[];
	bundleHash: string;
	benchmarkFingerprint: string;
	round: number;
	dimensions: Record<QualityDimension, DimensionVerdict>;
	chapters?: ChapterVerdict[];
	autoFixPlan: AutoFixPlan;
	estimatedFixCost: FixCostEstimate;
	judgedAt: string;
}

/** 차원별 기본 가중치 — 합 1.0 */
export const DEFAULT_WEIGHTS: Record<QualityDimension, number> = {
	editing: 0.34,
	script: 0.3,
	bgm: 0.18,
	tts: 0.18,
};

/** worst 챕터가 평균을 끌어내리는 허용 폭 (점) */
const WORST_CHAPTER_TOLERANCE = 12;

/** 부동소수점 노이즈 제거 — 점수 결정론(불변량 4) 보장 */
function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * 최종 verdict 결정 — 순수 결정론 정책.
 *
 * 우선순위:
 * 1. hardBlocks 존재 → 무조건 blocked (score 무관, heuristic_only에서도 동일)
 * 2. heuristic_only → ship 절대 금지. score>=bar여도 improve + review:true 강등
 * 3. llm_assisted && score>=bar → ship
 * 4. 그 외 → improve
 *
 * requiresHumanReview는 heuristic_only 모드면 항상 true (LLM 검증 부재 보상).
 */
export function resolveVerdict(i: {
	overallScore: number;
	marketBar: number;
	hardBlocks: HardBlockCode[];
	judgeMode: JudgeMode;
}): { verdict: QualityVerdict; requiresHumanReview: boolean } {
	const requiresHumanReview = i.judgeMode === "heuristic_only";

	if (i.hardBlocks.length > 0) {
		return { verdict: "blocked", requiresHumanReview };
	}

	if (i.overallScore >= i.marketBar) {
		if (i.judgeMode === "heuristic_only") {
			// 불변량: heuristic_only는 ship 금지 → improve 강등
			return { verdict: "improve", requiresHumanReview: true };
		}
		return { verdict: "ship", requiresHumanReview: false };
	}

	return { verdict: "improve", requiresHumanReview };
}

/**
 * 차원별 점수 가중 평균. 커스텀 가중치는 합으로 정규화한다 (합 1.0 강제 아님).
 */
export function aggregateDimensionScores(
	d: Record<QualityDimension, DimensionVerdict>,
	w?: Record<QualityDimension, number>,
): number {
	const weights = w ?? DEFAULT_WEIGHTS;
	let weightedSum = 0;
	let weightTotal = 0;
	for (const dimension of Object.keys(d) as QualityDimension[]) {
		const weight = weights[dimension] ?? 0;
		weightedSum += d[dimension].score * weight;
		weightTotal += weight;
	}
	if (weightTotal <= 0) return 0;
	return round2(weightedSum / weightTotal);
}

/**
 * 챕터 verdict 집계 — worst-chapter 지배.
 *
 * score = min(mean, worst + 12): 한 챕터만 망가져도 평균으로 가려지지 않는다.
 * hardBlocks = 전 챕터 blockedReasons 합집합 (첫 등장 순서, 중복 제거).
 */
export function aggregateChapterVerdicts(chapters: ChapterVerdict[]): {
	score: number;
	hardBlocks: HardBlockCode[];
} {
	if (chapters.length === 0) {
		return { score: 0, hardBlocks: [] };
	}

	let sum = 0;
	let worst = Number.POSITIVE_INFINITY;
	const hardBlocks: HardBlockCode[] = [];
	const seen = new Set<HardBlockCode>();

	for (const chapter of chapters) {
		sum += chapter.score;
		if (chapter.score < worst) worst = chapter.score;
		for (const code of chapter.blockedReasons) {
			if (!seen.has(code)) {
				seen.add(code);
				hardBlocks.push(code);
			}
		}
	}

	const mean = sum / chapters.length;
	const score = round2(Math.min(mean, worst + WORST_CHAPTER_TOLERANCE));
	return { score, hardBlocks };
}

/**
 * 기존 verdict 체계('ready'|'review' 포함)와 시장 판정 합성.
 *
 * blocked = 합집합: 하나라도 blocked면 blocked.
 * ship = 교집합: market이 ship이고 기존이 전부 ship/ready일 때만 ship.
 * 그 외 = improve.
 */
export function combineWithExistingVerdicts(
	market: QualityVerdict,
	existing: Array<"ship" | "improve" | "blocked" | "ready" | "review">,
): QualityVerdict {
	if (market === "blocked" || existing.includes("blocked")) {
		return "blocked";
	}
	const allShippable = existing.every((v) => v === "ship" || v === "ready");
	if (market === "ship" && allShippable) {
		return "ship";
	}
	return "improve";
}
