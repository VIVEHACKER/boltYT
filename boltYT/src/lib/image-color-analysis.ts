/**
 * 이미지 빠른 색상 분석 — Canvas 기반 ImageData 통계.
 * washed-out / dull 이미지를 감지하여 적절한 saturation/contrast 부스트를 제안.
 */

export interface ImageColorStats {
	/** 평균 밝기 0-255 */
	avgBrightness: number;
	/** 평균 채도 0-1 (HSL) */
	avgSaturation: number;
	/** 표준편차 (대비 척도) */
	stdDev: number;
	/** 픽셀 개수 */
	sampleCount: number;
}

export interface ColorBoostSuggestion {
	saturation: number; // -1 ~ 1
	contrast: number;
	exposure: number;
	reason: string;
}

/** RGB → HSL 의 saturation 컴포넌트만 계산 (0-1) */
function rgbSaturation(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b) / 255;
	const min = Math.min(r, g, b) / 255;
	const l = (max + min) / 2;
	if (max === min) return 0;
	const d = max - min;
	return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

/**
 * ImageData → 통계. 4픽셀 마다 샘플링 (100 만 픽셀이라도 250K 만 처리).
 */
export function analyzeImageData(data: ImageData): ImageColorStats {
	const px = data.data;
	let sumBright = 0;
	let sumSat = 0;
	let sumSquared = 0;
	let count = 0;
	for (let i = 0; i < px.length; i += 16) {
		// stride 16 = 4픽셀 마다
		const r = px[i];
		const g = px[i + 1];
		const b = px[i + 2];
		const bright = (r + g + b) / 3;
		sumBright += bright;
		sumSat += rgbSaturation(r, g, b);
		sumSquared += bright * bright;
		count++;
	}
	const avgBright = count === 0 ? 0 : sumBright / count;
	const variance = count === 0 ? 0 : sumSquared / count - avgBright * avgBright;
	return {
		avgBrightness: avgBright,
		avgSaturation: count === 0 ? 0 : sumSat / count,
		stdDev: Math.sqrt(Math.max(0, variance)),
		sampleCount: count,
	};
}

/**
 * 통계 → 색보정 제안.
 * - 채도 < 0.18 → +30% saturation boost
 * - 채도 < 0.30 → +15%
 * - 대비 stdDev < 35 → +0.15 contrast
 * - 너무 어두움 < 60 → +0.2 exposure
 * - 너무 밝음 > 200 → -0.1 exposure
 */
export function suggestColorBoost(
	stats: ImageColorStats,
): ColorBoostSuggestion {
	const reasons: string[] = [];
	let saturation = 0;
	let contrast = 0;
	let exposure = 0;

	if (stats.avgSaturation < 0.18) {
		saturation = 0.3;
		reasons.push("매우 탁한 색상 → +30% 채도");
	} else if (stats.avgSaturation < 0.3) {
		saturation = 0.15;
		reasons.push("낮은 채도 → +15% 채도");
	}

	if (stats.stdDev < 35) {
		contrast = 0.15;
		reasons.push(`낮은 대비 (σ=${stats.stdDev.toFixed(0)}) → +15% 대비`);
	}

	if (stats.avgBrightness < 60) {
		exposure = 0.2;
		reasons.push("어두운 이미지 → +0.2 노출");
	} else if (stats.avgBrightness > 200) {
		exposure = -0.1;
		reasons.push("밝은 이미지 → -0.1 노출");
	}

	return {
		saturation,
		contrast,
		exposure,
		reason: reasons.length > 0 ? reasons.join(", ") : "보정 불필요",
	};
}
