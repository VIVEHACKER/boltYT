/**
 * Color Pipeline — 3-way corrector + temp/tint + LUT 파서 + 스코프 샘플링.
 *
 * 브라우저에서 처리하므로 WebGL/Canvas 기반.
 * Composition 에는 SVG feColorMatrix + optional displacementMap(for LUT) 로 적용.
 */

import type { ColorGradeSpec } from "./timeline-model";

export interface RGB {
	r: number; // 0~1
	g: number;
	b: number;
}

const identityMatrix = (): number[] => [
	1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
];

/**
 * Lift/Gamma/Gain 을 4x5 SVG feColorMatrix 로 근사.
 *
 * 이 근사는 SVG 필터가 exponent(power)를 지원하지 않기에,
 *   result = gain * in + lift + (gamma - 1) * in * (1 - in) * 2
 * 를 선형 행렬로 펼친다. gamma 는 midtone 중심 대비/밝기로 근사.
 *
 * 정확한 LGG는 WebGL 셰이더에서 처리 — 여기서는 SVG 프리뷰용 근사.
 */
export function liftGammaGainMatrix(
	lift: RGB,
	gamma: RGB,
	gain: RGB,
): number[] {
	// 각 채널 독립: out = gain * in + lift
	// gamma 의 midtone 효과는 대비 이득으로 간주:
	//   contrast = 1 + gamma*0.5 (대략)
	// 선형 항으로만 표현하는 제약 하에:
	//   a = gain * (1 + 0.5 * gamma)
	//   b = lift - 0.25 * gamma
	const a = {
		r: gain.r * (1 + 0.5 * gamma.r),
		g: gain.g * (1 + 0.5 * gamma.g),
		b: gain.b * (1 + 0.5 * gamma.b),
	};
	const b = {
		r: lift.r - 0.25 * gamma.r,
		g: lift.g - 0.25 * gamma.g,
		b: lift.b - 0.25 * gamma.b,
	};
	return [
		a.r,
		0,
		0,
		0,
		b.r,
		0,
		a.g,
		0,
		0,
		b.g,
		0,
		0,
		a.b,
		0,
		b.b,
		0,
		0,
		0,
		1,
		0,
	];
}

/**
 * 색온도(-100~100) + 틴트(-100~100) → 4x5 행렬.
 * 음수 temperature = cool(blue), 양수 = warm(orange)
 * 음수 tint = green, 양수 = magenta
 */
export function temperatureTintMatrix(
	temperature: number,
	tint: number,
): number[] {
	const t = Math.max(-100, Math.min(100, temperature)) / 100;
	const p = Math.max(-100, Math.min(100, tint)) / 100;
	// 온도: R + t, B - t
	const rAdd = t * 0.15;
	const bAdd = -t * 0.15;
	// 틴트: G - p (음수면 G 증가), R + p*0.5, B + p*0.5 (마젠타)
	const gAdd = -p * 0.12;
	const rTint = p * 0.06;
	const bTint = p * 0.06;
	return [
		1,
		0,
		0,
		0,
		rAdd + rTint,
		0,
		1,
		0,
		0,
		gAdd,
		0,
		0,
		1,
		0,
		bAdd + bTint,
		0,
		0,
		0,
		1,
		0,
	];
}

/** 채도(-1~1) 적용 — 표준 luma 기반 */
export function saturationMatrix(saturation: number): number[] {
	const s = 1 + Math.max(-1, Math.min(1, saturation));
	const lumR = 0.2126;
	const lumG = 0.7152;
	const lumB = 0.0722;
	const sR = (1 - s) * lumR;
	const sG = (1 - s) * lumG;
	const sB = (1 - s) * lumB;
	return [
		sR + s,
		sG,
		sB,
		0,
		0,
		sR,
		sG + s,
		sB,
		0,
		0,
		sR,
		sG,
		sB + s,
		0,
		0,
		0,
		0,
		0,
		1,
		0,
	];
}

/**
 * 두 4x5 색 행렬 합성: out = B * A.
 *
 * RGBA 4x4 파트와 offset 컬럼을 합성.
 */
export function composeMatrices(a: number[], b: number[]): number[] {
	if (a.length !== 20 || b.length !== 20) return identityMatrix();
	const out = new Array(20).fill(0);
	for (let row = 0; row < 4; row++) {
		for (let col = 0; col < 4; col++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) {
				sum += b[row * 5 + k] * a[k * 5 + col];
			}
			out[row * 5 + col] = sum;
		}
		// offset: bOffset + B·aOffset
		let off = b[row * 5 + 4];
		for (let k = 0; k < 4; k++) {
			off += b[row * 5 + k] * a[k * 5 + 4];
		}
		out[row * 5 + 4] = off;
	}
	return out;
}

/** ColorGradeSpec → 최종 SVG feColorMatrix values 문자열 (공백 구분 20개) */
export function specToSvgMatrix(
	spec: ColorGradeSpec,
	presetMatrix?: number[],
): string {
	let m = identityMatrix();
	if (presetMatrix && presetMatrix.length === 20) {
		m = composeMatrices(m, presetMatrix);
	}
	if (spec.lift || spec.gamma || spec.gain) {
		const lgg = liftGammaGainMatrix(
			spec.lift ?? { r: 0, g: 0, b: 0 },
			spec.gamma ?? { r: 0, g: 0, b: 0 },
			spec.gain ?? { r: 1, g: 1, b: 1 },
		);
		m = composeMatrices(m, lgg);
	}
	if (spec.temperature || spec.tint) {
		m = composeMatrices(
			m,
			temperatureTintMatrix(spec.temperature ?? 0, spec.tint ?? 0),
		);
	}
	if (spec.saturation) {
		m = composeMatrices(m, saturationMatrix(spec.saturation));
	}
	return m.map((v) => v.toFixed(5)).join(" ");
}

// ──────────────────────────────────────────────
// Scopes — Waveform / Vectorscope
// ──────────────────────────────────────────────

export interface ScopeFrame {
	width: number;
	height: number;
	/** RGBA Uint8Array (length = width*height*4) */
	data: Uint8ClampedArray;
}

/** 프레임 → RGB waveform (luma) — 각 x(시간축) 위치의 luma 히스토그램 */
export function computeWaveform(frame: ScopeFrame, bins = 256): Uint32Array {
	const { width, height, data } = frame;
	const out = new Uint32Array(width * bins);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];
			const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			const bin = Math.min(bins - 1, Math.max(0, Math.round(luma)));
			out[x * bins + (bins - 1 - bin)] += 1;
		}
	}
	return out;
}

/**
 * 프레임 → vectorscope 2D 히스토그램.
 * YCbCr 로 변환 후 Cb-Cr 평면의 점 누적.
 */
export function computeVectorscope(frame: ScopeFrame, size = 256): Uint32Array {
	const { data } = frame;
	const out = new Uint32Array(size * size);
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		// BT.709 Cb/Cr (근사)
		const cb = -0.1146 * r - 0.3854 * g + 0.5 * b + 128;
		const cr = 0.5 * r - 0.4542 * g - 0.0458 * b + 128;
		const x = Math.min(size - 1, Math.max(0, Math.round(cb)));
		const y = Math.min(size - 1, Math.max(0, Math.round(size - cr)));
		out[y * size + x] += 1;
	}
	return out;
}

// ──────────────────────────────────────────────
// .cube LUT 파서
// ──────────────────────────────────────────────

export interface CubeLUT {
	size: number; // 16 / 33 / 65
	data: Float32Array; // size^3 * 3 (r,g,b triplets)
	title?: string;
	domainMin: [number, number, number];
	domainMax: [number, number, number];
}

/**
 * .cube 텍스트 파일 → CubeLUT.
 * 지원: LUT_3D_SIZE, TITLE, DOMAIN_MIN, DOMAIN_MAX, 3D 데이터 라인.
 * 3x3(LUT_1D) 는 지원 안 함.
 */
export function parseCubeLut(text: string): CubeLUT {
	const lines = text.split(/\r?\n/);
	let size = 0;
	let title: string | undefined;
	let domainMin: [number, number, number] = [0, 0, 0];
	let domainMax: [number, number, number] = [1, 1, 1];
	const triples: number[] = [];

	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		if (line.startsWith("TITLE")) {
			const m = line.match(/"([^"]*)"/);
			if (m) title = m[1];
			continue;
		}
		if (line.startsWith("LUT_3D_SIZE")) {
			const n = Number(line.split(/\s+/)[1]);
			if (Number.isFinite(n)) size = n;
			continue;
		}
		if (line.startsWith("LUT_1D_SIZE")) {
			throw new Error("1D LUT 은 지원하지 않습니다. 3D LUT 을 사용하세요.");
		}
		if (line.startsWith("DOMAIN_MIN")) {
			const parts = line.split(/\s+/).slice(1).map(Number);
			if (parts.length === 3) domainMin = [parts[0], parts[1], parts[2]];
			continue;
		}
		if (line.startsWith("DOMAIN_MAX")) {
			const parts = line.split(/\s+/).slice(1).map(Number);
			if (parts.length === 3) domainMax = [parts[0], parts[1], parts[2]];
			continue;
		}
		// 숫자 3개 라인
		const nums = line.split(/\s+/).map(Number);
		if (nums.length === 3 && nums.every((n) => Number.isFinite(n))) {
			triples.push(nums[0], nums[1], nums[2]);
		}
	}

	if (size === 0) throw new Error("LUT_3D_SIZE 를 찾을 수 없습니다.");
	const expected = size * size * size * 3;
	if (triples.length !== expected) {
		throw new Error(
			`LUT 데이터 크기 불일치: ${triples.length} / 기대 ${expected}`,
		);
	}
	return {
		size,
		data: new Float32Array(triples),
		title,
		domainMin,
		domainMax,
	};
}

/**
 * Canvas 2D 에 LUT 적용 — ImageData 픽셀 단위 trilinear 보간.
 * WebGL 없이도 preview 가능하지만 큰 프레임에선 느림 (썸네일용).
 */
export function applyCubeLutToImageData(
	image: ImageData,
	lut: CubeLUT,
	amount = 1,
): ImageData {
	const { data, width, height } = image;
	const n = lut.size;
	const out = new ImageData(new Uint8ClampedArray(data.length), width, height);
	const outData = out.data;

	const sample = (r: number, g: number, b: number) => {
		const rf = Math.min(1, Math.max(0, r)) * (n - 1);
		const gf = Math.min(1, Math.max(0, g)) * (n - 1);
		const bf = Math.min(1, Math.max(0, b)) * (n - 1);
		const r0 = Math.floor(rf);
		const g0 = Math.floor(gf);
		const b0 = Math.floor(bf);
		const r1 = Math.min(n - 1, r0 + 1);
		const g1 = Math.min(n - 1, g0 + 1);
		const b1 = Math.min(n - 1, b0 + 1);
		const dr = rf - r0;
		const dg = gf - g0;
		const db = bf - b0;
		const idx = (ri: number, gi: number, bi: number) =>
			(ri + gi * n + bi * n * n) * 3;
		const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
		const i000 = idx(r0, g0, b0);
		const i100 = idx(r1, g0, b0);
		const i010 = idx(r0, g1, b0);
		const i110 = idx(r1, g1, b0);
		const i001 = idx(r0, g0, b1);
		const i101 = idx(r1, g0, b1);
		const i011 = idx(r0, g1, b1);
		const i111 = idx(r1, g1, b1);

		const c000 = [lut.data[i000], lut.data[i000 + 1], lut.data[i000 + 2]];
		const c100 = [lut.data[i100], lut.data[i100 + 1], lut.data[i100 + 2]];
		const c010 = [lut.data[i010], lut.data[i010 + 1], lut.data[i010 + 2]];
		const c110 = [lut.data[i110], lut.data[i110 + 1], lut.data[i110 + 2]];
		const c001 = [lut.data[i001], lut.data[i001 + 1], lut.data[i001 + 2]];
		const c101 = [lut.data[i101], lut.data[i101 + 1], lut.data[i101 + 2]];
		const c011 = [lut.data[i011], lut.data[i011 + 1], lut.data[i011 + 2]];
		const c111 = [lut.data[i111], lut.data[i111 + 1], lut.data[i111 + 2]];

		const c00 = [
			lerp(c000[0], c100[0], dr),
			lerp(c000[1], c100[1], dr),
			lerp(c000[2], c100[2], dr),
		];
		const c10 = [
			lerp(c010[0], c110[0], dr),
			lerp(c010[1], c110[1], dr),
			lerp(c010[2], c110[2], dr),
		];
		const c01 = [
			lerp(c001[0], c101[0], dr),
			lerp(c001[1], c101[1], dr),
			lerp(c001[2], c101[2], dr),
		];
		const c11 = [
			lerp(c011[0], c111[0], dr),
			lerp(c011[1], c111[1], dr),
			lerp(c011[2], c111[2], dr),
		];
		const c0 = [
			lerp(c00[0], c10[0], dg),
			lerp(c00[1], c10[1], dg),
			lerp(c00[2], c10[2], dg),
		];
		const c1 = [
			lerp(c01[0], c11[0], dg),
			lerp(c01[1], c11[1], dg),
			lerp(c01[2], c11[2], dg),
		];
		return [
			lerp(c0[0], c1[0], db),
			lerp(c0[1], c1[1], db),
			lerp(c0[2], c1[2], db),
		];
	};

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;
		const [R, G, B] = sample(r, g, b);
		const rr = r + (R - r) * amount;
		const gg = g + (G - g) * amount;
		const bb = b + (B - b) * amount;
		outData[i] = Math.round(Math.min(255, Math.max(0, rr * 255)));
		outData[i + 1] = Math.round(Math.min(255, Math.max(0, gg * 255)));
		outData[i + 2] = Math.round(Math.min(255, Math.max(0, bb * 255)));
		outData[i + 3] = data[i + 3];
	}
	return out;
}
