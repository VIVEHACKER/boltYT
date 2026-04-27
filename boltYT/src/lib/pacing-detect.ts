/**
 * Pacing detection — narration 길이/속도로 페이싱 자동 추정.
 * Scene.pacing 필드를 비워두면 이 helper 로 채울 수 있음.
 *
 * Korean speech: 평균 ~ 4.5 글자/초 (편안), 6+ = fast, < 3 = slow
 */

export type Pacing = "slow" | "normal" | "fast";

export interface PacingInput {
	narration?: string;
	duration_seconds: number;
	wordCount?: number;
}

const KOREAN_FAST_CPS = 6.0;
const KOREAN_SLOW_CPS = 3.2;

/**
 * 단일 씬의 페이싱 추정.
 * 한글이 포함되면 글자/초 기준, 아니면 단어/초 기준 (영문 평균 2.5 wps).
 */
export function detectPacing(scene: PacingInput): Pacing {
	if (scene.duration_seconds <= 0) return "normal";
	const text = scene.narration ?? "";
	const isKorean = /[\u3131-\uD79D]/u.test(text);
	if (isKorean) {
		// 공백/구두점 제외 글자수
		const charCount = text.replace(/[\s\p{P}]/gu, "").length;
		const cps = charCount / scene.duration_seconds;
		if (cps >= KOREAN_FAST_CPS) return "fast";
		if (cps <= KOREAN_SLOW_CPS) return "slow";
		return "normal";
	}
	// 영문 단어 수 기반
	const words = scene.wordCount ?? text.trim().split(/\s+/).filter(Boolean).length;
	const wps = words / scene.duration_seconds;
	if (wps >= 3.5) return "fast";
	if (wps <= 1.6) return "slow";
	return "normal";
}

/** 씬 배열 일괄 적용 — 기존 pacing 이 있으면 우선 */
export function fillPacingForScenes<
	T extends PacingInput & { pacing?: Pacing },
>(scenes: T[]): T[] {
	return scenes.map((s) => (s.pacing ? s : { ...s, pacing: detectPacing(s) }));
}
