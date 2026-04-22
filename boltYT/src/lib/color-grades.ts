/**
 * LUT-style 색보정 프리셋 — SVG feColorMatrix 기반 (Remotion/Chromium 안전)
 *
 * 각 프리셋은 4x5 색 행렬 (RGBA):
 *   [Rr, Rg, Rb, Ra, Ro,
 *    Gr, Gg, Gb, Ga, Go,
 *    Br, Bg, Bb, Ba, Bo,
 *    Ar, Ag, Ab, Aa, Ao]
 *
 * GPU 가속, 런타임 비용 <2%.
 */

export type ColorGradePreset =
	| "none"
	| "teal-orange"
	| "warm-film"
	| "cold-noir"
	| "vibrant-pop"
	| "muted-doc"
	| "retro-vhs";

/** 4x5 행렬 (20개 값) */
export type ColorMatrix = readonly [
	number,
	number,
	number,
	number,
	number, // R row
	number,
	number,
	number,
	number,
	number, // G row
	number,
	number,
	number,
	number,
	number, // B row
	number,
	number,
	number,
	number,
	number, // A row
];

/**
 * Teal & Orange — 시네마틱 블록버스터 룩.
 * 섀도우 teal, 하이라이트 orange. Mystery/Horror 씬에 적합.
 */
const TEAL_ORANGE: ColorMatrix = [
	1.15, 0.0, -0.1, 0, -0.02, 0.0, 1.05, 0.0, 0, -0.01, -0.15, 0.0, 1.1, 0, 0.03,
	0, 0, 0, 1, 0,
];

/** Warm Film — 35mm 필름 룩, 따뜻한 톤. */
const WARM_FILM: ColorMatrix = [
	1.1, 0.05, 0.0, 0, 0.03, 0.02, 1.0, 0.0, 0, 0.01, -0.05, 0.02, 0.9, 0, 0.0, 0,
	0, 0, 1, 0,
];

/** Cold Noir — 탈색 + 블루 shift. Horror에 적합. */
const COLD_NOIR: ColorMatrix = [
	0.85, 0.05, 0.1, 0, -0.04, 0.05, 0.85, 0.1, 0, -0.03, 0.1, 0.1, 1.0, 0, 0.02,
	0, 0, 0, 1, 0,
];

/** Vibrant Pop — 채도 +30%, contrast +10%. Upbeat/Warm에 적합. */
const VIBRANT_POP: ColorMatrix = [
	1.3, -0.1, -0.1, 0, 0.0, -0.1, 1.3, -0.1, 0, 0.0, -0.1, -0.1, 1.3, 0, 0.0, 0,
	0, 0, 1, 0,
];

/** Muted Doc — 채도 -20%, contrast -5%. News/다큐에 적합. */
const MUTED_DOC: ColorMatrix = [
	0.85, 0.075, 0.075, 0, 0.02, 0.075, 0.85, 0.075, 0, 0.02, 0.075, 0.075, 0.85,
	0, 0.02, 0, 0, 0, 1, 0,
];

/** Retro VHS — 마젠타/그린 shift. 복고/드라마. */
const RETRO_VHS: ColorMatrix = [
	1.08, 0.15, 0.0, 0, 0.01, -0.05, 1.05, 0.05, 0, 0.0, 0.1, 0.0, 1.05, 0, -0.02,
	0, 0, 0, 1, 0,
];

export const COLOR_MATRICES: Record<
	Exclude<ColorGradePreset, "none">,
	ColorMatrix
> = {
	"teal-orange": TEAL_ORANGE,
	"warm-film": WARM_FILM,
	"cold-noir": COLD_NOIR,
	"vibrant-pop": VIBRANT_POP,
	"muted-doc": MUTED_DOC,
	"retro-vhs": RETRO_VHS,
};

export const COLOR_GRADE_LABELS: Record<ColorGradePreset, string> = {
	none: "원본",
	"teal-orange": "시네마틱 (Teal & Orange)",
	"warm-film": "따뜻한 필름",
	"cold-noir": "차가운 느와르",
	"vibrant-pop": "선명한 팝",
	"muted-doc": "다큐 중립",
	"retro-vhs": "복고 VHS",
};

/** 매트릭스를 SVG feColorMatrix values 속성 형식 문자열로 */
export function matrixToSvgValues(m: ColorMatrix): string {
	return m.join(" ");
}

/**
 * 레퍼런스 템플릿 visual_mood → 추천 color grade 프리셋.
 */
export function suggestColorGrade(
	mood: string,
	lighting?: string,
): ColorGradePreset {
	const key = `${mood}:${lighting ?? ""}`;
	// 우선 조합 기반
	if (mood === "horror" && lighting === "dark") return "cold-noir";
	if (mood === "horror") return "teal-orange";
	if (mood === "mystery") return "teal-orange";
	if (mood === "warm") return "warm-film";
	if (mood === "news") return "muted-doc";
	if (mood === "neutral" && lighting === "bright") return "vibrant-pop";
	void key;
	return "none";
}
