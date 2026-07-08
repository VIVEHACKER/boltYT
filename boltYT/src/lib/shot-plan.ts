/**
 * Shot-plan-first + visual-length→script-length + story-sync-audit.
 *
 * 출처: reference-ai-drama-codex-pipeline (감자 블로그 "Codex로 AI 롱폼 영상 자동화").
 * 장르무관 순수 로직 — make-economy/make-vlog 공용. 부수효과/외부의존 없음(테스트 가능).
 *
 * 설계 의도:
 *  1) buildShotPlan  — scenes 를 컷별 구조(블록/등장인물/금지장소/예상길이/대응대본 idx)로 정규화.
 *  2) visual↔script 예산 — estimateSpeakingSeconds / budgetNarrationChars / recommendSceneCount
 *     (고정 SEC_PER_SCENE 대신 "시각길이→대본분량" 또는 "측정평균→씬수"로 자연 페이싱).
 *  3) auditStorySync — 컷별 싱크 감사(금지장소·페이스·빈값·텍스트요청·인물누락) → 재생성 대상 산출.
 *
 * 비파괴 advisory 로 쓰는 게 기본(파이프라인 동작 불변). 게이트 ON 일 때만 재계획에 반영.
 */

/** VlogScene/Scene 호환 최소 형태. */
export interface PlanScene {
	narration: string;
	visual: string;
}

export type ShotPurpose = "a-roll" | "b-roll";

export interface ShotCut {
	cut: number; // 1-based
	cutId: string; // "CUT_001"
	sceneIdx: number;
	block: string; // 챕터/비트 라벨
	narration: string;
	visual: string;
	characters: string[];
	forbiddenLocations: string[];
	purpose: ShotPurpose;
	expectedSec: number; // 내레이션 자연 발화 예상 길이
	cameraMove?: string; // 배정된 카메라 무빙 id (camera-movements.ts CAMERA_MOVES)
}

export interface BuildShotPlanOpts {
	blockStarts?: number[]; // chapterStarts/beatStarts (scene index 경계, 오름차순)
	blockLabels?: string[]; // 각 블록 라벨(roles/beat keys). 길이 부족 시 "B##" 자동
	forbiddenLocations?: string[]; // 전역 금지 장소(소문자 비교)
	requiredCharacters?: string[]; // 전역 등장 인물(visual 매칭)
	charsPerSec?: number; // 한국어 발화 속도(예상길이 추정)
}

/** 기본 한국어 발화 속도(문자/초). dur() 하한 1.5s 와 정합. 채널별 env 로 조정 가능. */
export const DEFAULT_CHARS_PER_SEC = 5.5;
const MIN_SEC = 1.5;

/** 컷 번호 → 0패딩 ID. */
export function cutId(n: number): string {
	return `CUT_${String(Math.max(0, Math.trunc(n))).padStart(3, "0")}`;
}

/** 텍스트 자연 발화 예상 길이(초). 공백 제외 문자수 / 속도, 하한 MIN_SEC. */
export function estimateSpeakingSeconds(
	text: string,
	charsPerSec = DEFAULT_CHARS_PER_SEC,
): number {
	const chars = (text ?? "").replace(/\s+/g, "").length;
	const rate = charsPerSec > 0 ? charsPerSec : DEFAULT_CHARS_PER_SEC;
	return Math.max(MIN_SEC, Math.round((chars / rate) * 10) / 10);
}

/** 목표 시각 길이(초) → 권장 내레이션 문자수(자연 속도 유지용). visual-length→script-length 핵심. */
export function budgetNarrationChars(
	targetSec: number,
	charsPerSec = DEFAULT_CHARS_PER_SEC,
): number {
	const rate = charsPerSec > 0 ? charsPerSec : DEFAULT_CHARS_PER_SEC;
	return Math.max(0, Math.round(Math.max(0, targetSec) * rate));
}

/**
 * 측정 평균 기반 권장 씬수 — 고정 SEC_PER_SCENE 대체.
 * @param targetTotalSec 목표 총 길이
 * @param measuredAvgSec  지금까지 측정된 씬 평균 길이(>0). 없으면 fallbackSec.
 */
export function recommendSceneCount(
	targetTotalSec: number,
	measuredAvgSec: number,
	opts: { cap?: number; min?: number; fallbackSec?: number } = {},
): number {
	const { cap = 60, min = 8, fallbackSec = 16 } = opts;
	const avg = measuredAvgSec > 0 ? measuredAvgSec : fallbackSec;
	const raw = Math.round(Math.max(0, targetTotalSec) / avg);
	return Math.min(cap, Math.max(min, raw));
}

/** scene index 가 속한 블록 라벨. */
export function blockFor(
	idx: number,
	blockStarts: number[] = [],
	blockLabels: string[] = [],
): string {
	let b = 0;
	for (let i = 0; i < blockStarts.length; i++) {
		if (idx >= blockStarts[i]) b = i;
		else break;
	}
	return blockLabels[b] ?? `B${String(b + 1).padStart(2, "0")}`;
}

/** visual 텍스트에서 등장 인물 매칭(전역 목록 부분일치, 소문자). */
function matchCharacters(visual: string, required: string[]): string[] {
	const v = (visual ?? "").toLowerCase();
	return required.filter((c) => c && v.includes(c.toLowerCase()));
}

/** scenes → 컷별 shot plan. */
export function buildShotPlan(
	scenes: PlanScene[],
	opts: BuildShotPlanOpts = {},
): ShotCut[] {
	const {
		blockStarts = [],
		blockLabels = [],
		forbiddenLocations = [],
		requiredCharacters = [],
		charsPerSec = DEFAULT_CHARS_PER_SEC,
	} = opts;
	return scenes.map((s, i) => ({
		cut: i + 1,
		cutId: cutId(i + 1),
		sceneIdx: i,
		block: blockFor(i, blockStarts, blockLabels),
		narration: s.narration ?? "",
		visual: s.visual ?? "",
		characters: matchCharacters(s.visual ?? "", requiredCharacters),
		forbiddenLocations,
		purpose: (s.narration ?? "").trim() ? "a-roll" : "b-roll",
		expectedSec: estimateSpeakingSeconds(s.narration ?? "", charsPerSec),
	}));
}

// ── Story-sync audit ─────────────────────────────────────────────────────────
export interface AuditCut {
	cutId: string;
	narration: string;
	visual: string;
	expectedSec?: number; // 자연 발화 예상
	measuredSec?: number; // 실제 TTS 길이(dur())
	forbiddenLocations?: string[];
	requiredCharacters?: string[];
}

export type IssueSeverity = "error" | "warn";
export interface SyncIssue {
	cutId: string;
	severity: IssueSeverity;
	code:
		| "empty-narration"
		| "empty-visual"
		| "forbidden-location"
		| "pace-mismatch"
		| "text-in-visual"
		| "missing-character";
	detail: string;
}

/** visual 프롬프트가 화면 텍스트/로고를 요청하는지(렌더 시 글자 박힘 위험). */
const TEXT_TOKENS = [
	"text",
	"letters",
	"caption",
	"subtitle",
	"logo",
	"watermark",
	"글자",
	"자막",
	"로고",
	"워터마크",
];

/**
 * 컷별 싱크 감사. error 가 하나라도 있으면 재생성 권장.
 * paceTolerance: |measured-expected|/expected 가 이 값 초과면 pace-mismatch(warn).
 */
export function auditStorySync(
	cuts: AuditCut[],
	opts: { paceTolerance?: number } = {},
): SyncIssue[] {
	const { paceTolerance = 0.4 } = opts;
	const issues: SyncIssue[] = [];
	for (const c of cuts) {
		const visual = (c.visual ?? "").toLowerCase();
		if (!(c.narration ?? "").trim())
			issues.push({
				cutId: c.cutId,
				severity: "warn",
				code: "empty-narration",
				detail: "내레이션 비어있음",
			});
		if (!(c.visual ?? "").trim())
			issues.push({
				cutId: c.cutId,
				severity: "error",
				code: "empty-visual",
				detail: "visual 프롬프트 비어있음",
			});

		for (const fl of c.forbiddenLocations ?? [])
			if (fl && visual.includes(fl.toLowerCase()))
				issues.push({
					cutId: c.cutId,
					severity: "error",
					code: "forbidden-location",
					detail: `금지 장소 '${fl}' 등장`,
				});

		for (const rc of c.requiredCharacters ?? [])
			if (rc && !visual.includes(rc.toLowerCase()))
				issues.push({
					cutId: c.cutId,
					severity: "warn",
					code: "missing-character",
					detail: `필수 인물 '${rc}' 누락`,
				});

		for (const t of TEXT_TOKENS)
			if (visual.includes(t)) {
				issues.push({
					cutId: c.cutId,
					severity: "warn",
					code: "text-in-visual",
					detail: `visual 이 화면 텍스트 요청('${t}')`,
				});
				break;
			}

		if (
			typeof c.expectedSec === "number" &&
			typeof c.measuredSec === "number" &&
			c.expectedSec > 0
		) {
			const variance = Math.abs(c.measuredSec - c.expectedSec) / c.expectedSec;
			if (variance > paceTolerance)
				issues.push({
					cutId: c.cutId,
					severity: "warn",
					code: "pace-mismatch",
					detail: `페이스 불일치(예상 ${c.expectedSec}s vs 측정 ${c.measuredSec}s, ${Math.round(variance * 100)}%)`,
				});
		}
	}
	return issues;
}

/** error 심각도 이슈가 있는 컷 ID(재생성 대상, 중복 제거). */
export function cutsNeedingRegen(issues: SyncIssue[]): string[] {
	return [
		...new Set(
			issues.filter((i) => i.severity === "error").map((i) => i.cutId),
		),
	];
}

/** 감사 요약(로그/아티팩트용). */
export function summarizeAudit(issues: SyncIssue[]): {
	total: number;
	errors: number;
	warns: number;
	regenCuts: string[];
} {
	return {
		total: issues.length,
		errors: issues.filter((i) => i.severity === "error").length,
		warns: issues.filter((i) => i.severity === "warn").length,
		regenCuts: cutsNeedingRegen(issues),
	};
}

// ── Active rebudget (visual-length→script-length) ────────────────────────────
export interface RebudgetItem {
	index: number;
	currentSec: number; // 현재 내레이션 예상 발화 길이
	targetSec: number; // 목표(컷 시각 길이)
	targetChars: number; // 목표 문자수(LLM 재작성 가이드)
	direction: "expand" | "trim";
}

/**
 * 목표 총 길이를 컷 수로 균등 분배(클램프). totalTargetSec<=0 이면 defaultPerCut 균일.
 * i2v 고정 컷길이가 있으면 그 배열을 직접 targetSecs 로 넣어 planRebudget 에 써도 된다.
 */
export function targetSecondsPerCut(
	totalTargetSec: number,
	sceneCount: number,
	opts: { min?: number; max?: number; defaultPerCut?: number } = {},
): number[] {
	const { min = 4, max = 20, defaultPerCut = 10 } = opts;
	if (sceneCount <= 0) return [];
	const per = totalTargetSec > 0 ? totalTargetSec / sceneCount : defaultPerCut;
	const clamped = Math.min(max, Math.max(min, Math.round(per * 10) / 10));
	return Array.from({ length: sceneCount }, () => clamped);
}

/**
 * 예상 발화 길이가 target 과 tolerance 이상 어긋난 컷만 재작성 대상으로 선별(=churn/비용 최소화).
 * direction: 현재가 target 보다 길면 trim, 짧으면 expand. targetChars = 자연 속도 유지 권장 문자수.
 */
export function planRebudget(
	narrations: string[],
	targetSecs: number[],
	opts: { tolerance?: number; charsPerSec?: number } = {},
): RebudgetItem[] {
	const { tolerance = 0.35, charsPerSec = DEFAULT_CHARS_PER_SEC } = opts;
	const items: RebudgetItem[] = [];
	for (let i = 0; i < narrations.length; i++) {
		const target = targetSecs[i] ?? targetSecs[targetSecs.length - 1] ?? 0;
		if (target <= 0) continue;
		const currentSec = estimateSpeakingSeconds(
			narrations[i] ?? "",
			charsPerSec,
		);
		const variance = Math.abs(currentSec - target) / target;
		if (variance > tolerance)
			items.push({
				index: i,
				currentSec,
				targetSec: target,
				targetChars: budgetNarrationChars(target, charsPerSec),
				direction: currentSec > target ? "trim" : "expand",
			});
	}
	return items;
}
