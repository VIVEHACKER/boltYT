/**
 * 비주얼 소스 모드 — 씬 이미지/영상의 기본 생성 경로.
 *
 * 근거(제작 수준 감사 2026-06): 기본 경로가 "웹 스톡 검색 → 하드컷 짜깁기"라
 * 출처 제각각 클립이 이어붙어 "싸구려·따로 노는" 결과를 냈다(사용자 보고와 일치).
 * 그래서 기본값을 "ai"(AI 생성 우선, 고유·일관된 스타일)로 둔다. AI 생성 실패 시
 * 스톡 검색으로 자동 폴백하므로 무회귀이며, 비용을 아끼려면 "search"로 되돌릴 수 있다.
 */

export type VisualSourceMode = "ai" | "search";

const VISUAL_SOURCE_MODE_KEY = "visual_source_mode";

/** 기본 "ai" — 명시적으로 "search"일 때만 스톡 검색 우선. */
export function getVisualSourceMode(): VisualSourceMode {
	try {
		return localStorage.getItem(VISUAL_SOURCE_MODE_KEY) === "search"
			? "search"
			: "ai";
	} catch {
		return "ai";
	}
}

export function setVisualSourceMode(mode: VisualSourceMode): void {
	try {
		localStorage.setItem(VISUAL_SOURCE_MODE_KEY, mode);
	} catch {
		// localStorage 불가 환경 무시
	}
}
