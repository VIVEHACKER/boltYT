/**
 * RGB 채널별 히스토그램 + 간이 파레이드 지원 데이터.
 *
 * 입력: Uint8ClampedArray (canvas getImageData().data — RGBA 1-byte per channel).
 * 출력: bins 개 구간 카운트 배열 (R, G, B 각각).
 */

export interface RgbHistogram {
	r: Uint32Array;
	g: Uint32Array;
	b: Uint32Array;
	bins: number;
	samples: number;
}

/** 0-255 → 0-(bins-1) 매핑 카운트. bins 기본 64 (렌더 캔버스 너비 고려). */
export function computeHistogram(
	data: Uint8ClampedArray,
	bins = 64,
): RgbHistogram {
	const r = new Uint32Array(bins);
	const g = new Uint32Array(bins);
	const b = new Uint32Array(bins);
	const scale = bins / 256;
	let samples = 0;
	for (let i = 0; i < data.length; i += 4) {
		const ri = Math.min(bins - 1, Math.floor(data[i] * scale));
		const gi = Math.min(bins - 1, Math.floor(data[i + 1] * scale));
		const bi = Math.min(bins - 1, Math.floor(data[i + 2] * scale));
		r[ri]++;
		g[gi]++;
		b[bi]++;
		samples++;
	}
	return { r, g, b, bins, samples };
}

/** 히스토그램 정규화 — 채널별 최대값 기준 0-1. */
export function normalizeHistogram(h: RgbHistogram): {
	r: Float32Array;
	g: Float32Array;
	b: Float32Array;
} {
	function norm(arr: Uint32Array): Float32Array {
		let max = 1;
		for (const v of arr) if (v > max) max = v;
		const out = new Float32Array(arr.length);
		for (let i = 0; i < arr.length; i++) out[i] = arr[i] / max;
		return out;
	}
	return { r: norm(h.r), g: norm(h.g), b: norm(h.b) };
}

/**
 * 파레이드 — 수평 x 축 = 이미지 컬럼, 수직 y 축 = 해당 컬럼 밝기 분포.
 * 간이 구현: 이미지 너비를 cols 개 버킷으로 나눠 각 컬럼별 R/G/B 평균 반환.
 */
export function computeParade(
	data: Uint8ClampedArray,
	width: number,
	height: number,
	cols = 128,
): { r: Float32Array; g: Float32Array; b: Float32Array } {
	const r = new Float32Array(cols);
	const g = new Float32Array(cols);
	const b = new Float32Array(cols);
	const counts = new Uint32Array(cols);
	const colStep = width / cols;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const col = Math.min(cols - 1, Math.floor(x / colStep));
			const i = (y * width + x) * 4;
			r[col] += data[i];
			g[col] += data[i + 1];
			b[col] += data[i + 2];
			counts[col]++;
		}
	}
	for (let c = 0; c < cols; c++) {
		if (counts[c] > 0) {
			r[c] /= counts[c] * 255;
			g[c] /= counts[c] * 255;
			b[c] /= counts[c] * 255;
		}
	}
	return { r, g, b };
}
