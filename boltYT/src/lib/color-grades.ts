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
	| "retro-vhs"
	| "cinematic-bleach"
	| "sunset-glow"
	| "arctic"
	| "k-drama-soft"
	| "true-crime-noir"
	| "nature-doc";

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

/** Cinematic Bleach — 채도 -25% + 살짝 따뜻한 하이라이트. 미니멀 시네마. */
const CINEMATIC_BLEACH: ColorMatrix = [
	0.95, 0.04, 0.04, 0, 0.02, 0.04, 0.92, 0.04, 0, 0.01, 0.04, 0.04, 0.85, 0,
	-0.01, 0, 0, 0, 1, 0,
];

/** Sunset Glow — 강한 오렌지/핑크 하이라이트, 따뜻한 골든 아워. */
const SUNSET_GLOW: ColorMatrix = [
	1.18, 0.05, 0.0, 0, 0.06, 0.05, 1.0, 0.0, 0, 0.02, -0.05, 0.0, 0.85, 0, 0.0,
	0, 0, 0, 1, 0,
];

/** Arctic — 차가운 화이트 + 시안. 추운 분위기, 미니멀 다큐. */
const ARCTIC: ColorMatrix = [
	0.92, 0.05, 0.08, 0, 0.04, 0.05, 1.02, 0.05, 0, 0.04, 0.08, 0.08, 1.12, 0,
	0.05, 0, 0, 0, 1, 0,
];

/** K-Drama Soft — 부드러운 톤, 살짝 핑크, 채도 +5%. 로맨스/감성. */
const K_DRAMA_SOFT: ColorMatrix = [
	1.08, 0.05, 0.05, 0, 0.04, 0.0, 1.02, 0.05, 0, 0.02, 0.0, 0.05, 1.0, 0, 0.03,
	0, 0, 0, 1, 0,
];

/** True Crime Noir — 어둡고 콘트라스트 강한 모노톤 + 살짝 황색. 범죄/탐사. */
const TRUE_CRIME_NOIR: ColorMatrix = [
	0.78, 0.18, 0.04, 0, -0.05, 0.18, 0.74, 0.04, 0, -0.05, 0.04, 0.04, 0.62, 0,
	-0.04, 0, 0, 0, 1, 0,
];

/** Nature Doc — 녹색/청색 강조, 채도 +15%. 자연 다큐. */
const NATURE_DOC: ColorMatrix = [
	1.0, -0.02, -0.02, 0, 0.0, -0.05, 1.18, -0.05, 0, 0.02, -0.02, 0.0, 1.1, 0,
	0.0, 0, 0, 0, 1, 0,
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
	"cinematic-bleach": CINEMATIC_BLEACH,
	"sunset-glow": SUNSET_GLOW,
	arctic: ARCTIC,
	"k-drama-soft": K_DRAMA_SOFT,
	"true-crime-noir": TRUE_CRIME_NOIR,
	"nature-doc": NATURE_DOC,
};

export const COLOR_GRADE_LABELS: Record<ColorGradePreset, string> = {
	none: "원본",
	"teal-orange": "시네마틱 (Teal & Orange)",
	"warm-film": "따뜻한 필름",
	"cold-noir": "차가운 느와르",
	"vibrant-pop": "선명한 팝",
	"muted-doc": "다큐 중립",
	"retro-vhs": "복고 VHS",
	"cinematic-bleach": "시네마틱 블리치",
	"sunset-glow": "선셋 글로우",
	arctic: "아크틱",
	"k-drama-soft": "K-드라마 소프트",
	"true-crime-noir": "트루 크라임 느와르",
	"nature-doc": "자연 다큐",
};

/** 매트릭스를 SVG feColorMatrix values 속성 형식 문자열로 */
export function matrixToSvgValues(m: ColorMatrix): string {
	return m.join(" ");
}

/** Identity matrix — 색 변화 없음 */
const IDENTITY: ColorMatrix = [
	1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
];

/**
 * 두 프리셋 사이 t∈[0,1] 보간된 행렬 반환.
 * 씬 시작 시 from → 끝에 to 로 변환되는 시네마틱 그레이딩 트랜지션에 사용.
 * "none" 은 IDENTITY 로 처리 → from="none" to="cold-noir" 면 깨끗한 이미지에서 차가운 톤으로.
 */
export function interpolateColorMatrices(
	from: ColorGradePreset,
	to: ColorGradePreset,
	t: number,
): ColorMatrix {
	const a = from === "none" ? IDENTITY : COLOR_MATRICES[from];
	const b = to === "none" ? IDENTITY : COLOR_MATRICES[to];
	const clamped = Math.max(0, Math.min(1, t));
	const out = new Array(20) as number[];
	for (let i = 0; i < 20; i++) out[i] = a[i] * (1 - clamped) + b[i] * clamped;
	return out as unknown as ColorMatrix;
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
	if (mood === "horror" && lighting === "dark") return "true-crime-noir";
	if (mood === "horror") return "cold-noir";
	if (mood === "mystery") return "teal-orange";
	if (mood === "warm" && lighting === "golden") return "sunset-glow";
	if (mood === "warm") return "warm-film";
	if (mood === "news") return "muted-doc";
	if (mood === "neutral" && lighting === "bright") return "vibrant-pop";
	if (mood === "neutral" && lighting === "cold") return "arctic";
	if (mood === "soft") return "k-drama-soft";
	if (mood === "nature") return "nature-doc";
	void key;
	return "none";
}
