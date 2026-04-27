/**
 * 레퍼런스 색상 → ColorGrade preset 자동 매칭.
 * 도미넌트 색의 RGB 평균 + saturation/temp 휴리스틱.
 */

import type { ColorGradePreset } from "./color-grades";

interface RgbLike {
	r: number;
	g: number;
	b: number;
}

function hexToRgb(hex: string): RgbLike | null {
	const h = hex.replace("#", "");
	if (h.length !== 6) return null;
	return {
		r: Number.parseInt(h.slice(0, 2), 16),
		g: Number.parseInt(h.slice(2, 4), 16),
		b: Number.parseInt(h.slice(4, 6), 16),
	};
}

function avgRgb(colors: string[]): RgbLike | null {
	const rgbs = colors.map(hexToRgb).filter((c): c is RgbLike => Boolean(c));
	if (rgbs.length === 0) return null;
	const sum = rgbs.reduce(
		(acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
		{ r: 0, g: 0, b: 0 },
	);
	return {
		r: sum.r / rgbs.length,
		g: sum.g / rgbs.length,
		b: sum.b / rgbs.length,
	};
}

/** RGB → 색온도 추정 (-1 = 차가움 ~ +1 = 따뜻함) — 채널 비율 기반 */
function colorTemperature(rgb: RgbLike): number {
	const total = Math.max(1, rgb.r + rgb.g + rgb.b);
	// (r+g) vs 2b 비율 — 어둡든 밝든 ratio 일관
	return (rgb.r + rgb.g - 2 * rgb.b) / total;
}

function colorSaturation(rgb: RgbLike): number {
	const max = Math.max(rgb.r, rgb.g, rgb.b);
	const min = Math.min(rgb.r, rgb.g, rgb.b);
	return max === 0 ? 0 : (max - min) / max;
}

/**
 * 도미넌트 색 배열 → 가장 잘 어울리는 preset 반환.
 *
 * 휴리스틱:
 *  - 차가움 + 어둠 → cold-noir / true-crime-noir
 *  - 차가움 + 밝음 → arctic
 *  - 따뜻함 + 채도 높음 → sunset-glow / warm-film
 *  - 채도 낮음 + 중성 → muted-doc / cinematic-bleach
 *  - 녹색 우세 → nature-doc
 *  - 핑크/마젠타 → k-drama-soft
 */
export function suggestColorGradeFromColors(
	dominantColors: string[],
): ColorGradePreset {
	const rgb = avgRgb(dominantColors);
	if (!rgb) return "none";

	const temp = colorTemperature(rgb);
	const sat = colorSaturation(rgb);
	const brightness = (rgb.r + rgb.g + rgb.b) / 3 / 255;
	const greenDominance = rgb.g - (rgb.r + rgb.b) / 2;
	const magentaDominance = (rgb.r + rgb.b) / 2 - rgb.g;

	// 녹색 우세 → 자연
	if (greenDominance > 30 && sat > 0.3) return "nature-doc";
	// 핑크/마젠타 우세 → K-drama
	if (magentaDominance > 25 && sat > 0.3 && temp > 0) return "k-drama-soft";
	// 차가움
	if (temp < -0.08) {
		if (brightness < 0.35) return "true-crime-noir";
		if (brightness < 0.55) return "cold-noir";
		return "arctic";
	}
	// 따뜻함
	if (temp > 0.1) {
		if (sat > 0.5 && brightness > 0.5) return "sunset-glow";
		return "warm-film";
	}
	// 중성
	if (sat < 0.2) {
		if (brightness > 0.6) return "cinematic-bleach";
		return "muted-doc";
	}
	if (sat > 0.5) return "vibrant-pop";
	return "teal-orange";
}
