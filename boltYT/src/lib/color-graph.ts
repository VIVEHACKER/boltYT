/**
 * @AX:ANCHOR 노드 그래프 색보정 모델
 * @AX:REASON LUT/프리셋/3-way 를 넘어 matchbox 스타일 직렬 파이프라인 제공.
 *
 * 파이프라인: 각 노드는 RGB (0-1) 픽셀을 받아 새 RGB 반환.
 * HSL qualifier 는 마스크(0-1) 를 반환해 다음 노드의 영향력 스케일링.
 */

export interface ColorPixel {
	r: number;
	g: number;
	b: number;
}

export type ColorNode =
	| { kind: "exposure"; ev: number }
	| { kind: "contrast"; amount: number }
	| { kind: "saturation"; amount: number }
	| { kind: "temp-tint"; temperature: number; tint: number }
	| {
			kind: "hsl-qualifier";
			/** 중심 hue (0-360 degrees) */
			hue: number;
			/** 허용 반경 (degrees) */
			range: number;
			/** 페더링 (degrees) */
			feather: number;
			satMin: number;
			satMax: number;
			/** 마스크 곱해질 값 (노드 효과 축소) */
			saturationDelta?: number;
			lightnessDelta?: number;
			hueDelta?: number;
	  }
	| { kind: "sharpen"; amount: number }
	| { kind: "bloom"; threshold: number; intensity: number };

export type ColorGraph = ColorNode[];

// ─── RGB ↔ HSL ───

export function rgbToHsl(px: ColorPixel): {
	h: number;
	s: number;
	l: number;
} {
	const { r, g, b } = px;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
	else if (max === g) h = ((b - r) / d + 2) * 60;
	else h = ((r - g) / d + 4) * 60;
	return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): ColorPixel {
	if (s === 0) return { r: l, g: l, b: l };
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hk = (((h % 360) + 360) % 360) / 360;
	const convert = (t: number) => {
		let u = t;
		if (u < 0) u += 1;
		if (u > 1) u -= 1;
		if (u < 1 / 6) return p + (q - p) * 6 * u;
		if (u < 1 / 2) return q;
		if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
		return p;
	};
	return { r: convert(hk + 1 / 3), g: convert(hk), b: convert(hk - 1 / 3) };
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

function hueDistance(a: number, b: number): number {
	const d = Math.abs(((a - b + 180) % 360) - 180);
	return d;
}

/** HSL qualifier 마스크 (0-1) — 중심 hue 에 가깝고 sat 범위 안이면 1, 바깥이면 0, feather 구간은 선형. */
export function qualifierMask(
	px: ColorPixel,
	q: Extract<ColorNode, { kind: "hsl-qualifier" }>,
): number {
	const { h, s } = rgbToHsl(px);
	const dh = hueDistance(h, q.hue);
	let hueMask = 0;
	if (dh <= q.range) hueMask = 1;
	else if (dh <= q.range + q.feather) {
		hueMask = 1 - (dh - q.range) / Math.max(1e-6, q.feather);
	}
	let satMask = 1;
	if (s < q.satMin) satMask = 0;
	else if (s > q.satMax) satMask = 0;
	return clamp01(hueMask * satMask);
}

// ─── 노드 평가 ───

export function applyNode(px: ColorPixel, node: ColorNode): ColorPixel {
	switch (node.kind) {
		case "exposure": {
			const k = 2 ** node.ev;
			return {
				r: clamp01(px.r * k),
				g: clamp01(px.g * k),
				b: clamp01(px.b * k),
			};
		}
		case "contrast": {
			const c = node.amount;
			return {
				r: clamp01((px.r - 0.5) * (1 + c) + 0.5),
				g: clamp01((px.g - 0.5) * (1 + c) + 0.5),
				b: clamp01((px.b - 0.5) * (1 + c) + 0.5),
			};
		}
		case "saturation": {
			const hsl = rgbToHsl(px);
			const s = clamp01(hsl.s * (1 + node.amount));
			return hslToRgb(hsl.h, s, hsl.l);
		}
		case "temp-tint": {
			// 간이 white balance: temp+ = warm (R ↑, B ↓), tint+ = magenta (G ↓)
			const t = node.temperature / 100;
			const n = node.tint / 100;
			return {
				r: clamp01(px.r + 0.15 * t),
				g: clamp01(px.g - 0.05 * n),
				b: clamp01(px.b - 0.15 * t + 0.05 * n),
			};
		}
		case "hsl-qualifier": {
			const mask = qualifierMask(px, node);
			if (mask <= 0) return px;
			const hsl = rgbToHsl(px);
			const out = hslToRgb(
				hsl.h + (node.hueDelta ?? 0) * mask,
				clamp01(hsl.s + (node.saturationDelta ?? 0) * mask),
				clamp01(hsl.l + (node.lightnessDelta ?? 0) * mask),
			);
			return out;
		}
		case "sharpen": {
			// 픽셀 단위 sharpen 는 의미 없음 — 컴파일 시 CSS contrast 로 근사 (CSS 경로)
			// 또는 WebGL 샤더에서 unsharp mask. 평가 단계에서는 패스스루.
			return px;
		}
		case "bloom": {
			// Bloom 도 인접 픽셀 정보 필요 → 픽셀 단위 평가에서는 brightness boost 로만 근사
			const luma = 0.299 * px.r + 0.587 * px.g + 0.114 * px.b;
			if (luma < node.threshold) return px;
			const k = 1 + node.intensity * (luma - node.threshold);
			return {
				r: clamp01(px.r * k),
				g: clamp01(px.g * k),
				b: clamp01(px.b * k),
			};
		}
	}
}

export function evaluateGraph(px: ColorPixel, graph: ColorGraph): ColorPixel {
	let out = px;
	for (const node of graph) out = applyNode(out, node);
	return out;
}
