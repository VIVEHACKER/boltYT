/**
 * color-pipeline 단위 테스트.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	applyCubeLutToImageData,
	composeMatrices,
	computeVectorscope,
	computeWaveform,
	liftGammaGainMatrix,
	parseCubeLut,
	saturationMatrix,
	specToSvgMatrix,
	temperatureTintMatrix,
} from "./color-pipeline";
import type { ScopeFrame } from "./color-pipeline";

// ImageData polyfill (Node 환경)
class ImageDataMock {
	data: Uint8ClampedArray;
	width: number;
	height: number;
	constructor(data: Uint8ClampedArray, w: number, h: number) {
		this.data = data;
		this.width = w;
		this.height = h;
	}
}
beforeAll(() => vi.stubGlobal("ImageData", ImageDataMock));

describe("color matrices", () => {
	it("liftGammaGainMatrix neutral returns gain-as-diagonal, lift-as-offset", () => {
		const m = liftGammaGainMatrix(
			{ r: 0, g: 0, b: 0 },
			{ r: 0, g: 0, b: 0 },
			{ r: 1, g: 1, b: 1 },
		);
		expect(m[0]).toBeCloseTo(1);
		expect(m[6]).toBeCloseTo(1);
		expect(m[12]).toBeCloseTo(1);
		expect(m[4]).toBeCloseTo(0);
		expect(m[9]).toBeCloseTo(0);
		expect(m[14]).toBeCloseTo(0);
	});

	it("temperatureTintMatrix neutral identity offsets", () => {
		const m = temperatureTintMatrix(0, 0);
		expect(m[4]).toBeCloseTo(0);
		expect(m[9]).toBeCloseTo(0);
		expect(m[14]).toBeCloseTo(0);
	});

	it("saturationMatrix 0 equals identity", () => {
		const m = saturationMatrix(0);
		expect(m[0]).toBeCloseTo(1);
		expect(m[6]).toBeCloseTo(1);
		expect(m[12]).toBeCloseTo(1);
	});

	it("composeMatrices identity stays identity", () => {
		const id = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
		const m = composeMatrices(id, id);
		for (let i = 0; i < 20; i++) expect(m[i]).toBeCloseTo(id[i]);
	});

	it("specToSvgMatrix returns 20 numeric values", () => {
		const s = specToSvgMatrix({
			preset: "none",
			temperature: 20,
			tint: -10,
			saturation: 0.2,
		});
		const nums = s.split(" ");
		expect(nums).toHaveLength(20);
		for (const n of nums) expect(Number.isFinite(Number(n))).toBe(true);
	});

	it("specToSvgMatrix with presetMatrix (length 20) → compose", () => {
		const presetMatrix = Array(20).fill(0);
		presetMatrix[0] = 1;
		presetMatrix[6] = 1;
		presetMatrix[12] = 1;
		presetMatrix[18] = 1;
		const s = specToSvgMatrix({ preset: "none" }, presetMatrix);
		expect(s.split(" ")).toHaveLength(20);
	});

	it("specToSvgMatrix with lift/gamma/gain → compose", () => {
		const s = specToSvgMatrix({
			preset: "none",
			lift: { r: 0.1, g: 0, b: 0 },
			gamma: { r: 0, g: 0.1, b: 0 },
			gain: { r: 1, g: 1, b: 1.1 },
		});
		expect(s.split(" ")).toHaveLength(20);
	});

	it("specToSvgMatrix temperature만 있을 때", () => {
		const s = specToSvgMatrix({ preset: "none", temperature: 30 });
		expect(s.split(" ")).toHaveLength(20);
	});

	it("specToSvgMatrix tint만 있을 때", () => {
		const s = specToSvgMatrix({ preset: "none", tint: -15 });
		expect(s.split(" ")).toHaveLength(20);
	});

	it("specToSvgMatrix 모든 필드 없음 → 항등 행렬", () => {
		const s = specToSvgMatrix({ preset: "none" });
		expect(s.split(" ")).toHaveLength(20);
	});
});

describe("cube LUT parser", () => {
	it("parses a tiny 2x2x2 LUT", () => {
		const text = `TITLE "Test"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
		const lut = parseCubeLut(text);
		expect(lut.size).toBe(2);
		expect(lut.title).toBe("Test");
		expect(lut.data.length).toBe(2 * 2 * 2 * 3);
	});

	it("throws on wrong data count", () => {
		const text = `LUT_3D_SIZE 2\n0 0 0\n1 0 0\n`;
		expect(() => parseCubeLut(text)).toThrow();
	});

	it("throws on 1D LUT", () => {
		const text = `LUT_1D_SIZE 2\n0 0 0\n1 1 1\n`;
		expect(() => parseCubeLut(text)).toThrow();
	});

	it("DOMAIN_MIN / DOMAIN_MAX 파싱", () => {
		const text = `LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
		const lut = parseCubeLut(text);
		expect(lut.domainMin).toEqual([0, 0, 0]);
		expect(lut.domainMax).toEqual([1, 1, 1]);
	});

	it("# 주석 + 빈 줄 무시", () => {
		const text = `# comment
LUT_3D_SIZE 2

0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
		expect(() => parseCubeLut(text)).not.toThrow();
	});
});

// ─── computeWaveform ──────────────────────────────────────────────────────────
describe("computeWaveform", () => {
	function makeFrame(w: number, h: number, fill: number): ScopeFrame {
		const data = new Uint8ClampedArray(w * h * 4);
		for (let i = 0; i < data.length; i += 4) {
			data[i] = fill;
			data[i + 1] = fill;
			data[i + 2] = fill;
			data[i + 3] = 255;
		}
		return { width: w, height: h, data };
	}

	it("출력 배열 길이 = width × bins", () => {
		const frame = makeFrame(4, 4, 128);
		const out = computeWaveform(frame, 256);
		expect(out.length).toBe(4 * 256);
	});

	it("단색 프레임 → 단일 luma 빈에 집중", () => {
		const frame = makeFrame(2, 2, 200);
		const out = computeWaveform(frame, 256);
		const total = out.reduce((s, v) => s + v, 0);
		expect(total).toBe(4); // 2×2 = 4 픽셀
	});

	it("검정 프레임 → luma 0 빈", () => {
		const frame = makeFrame(2, 2, 0);
		const out = computeWaveform(frame, 256);
		const total = out.reduce((s, v) => s + v, 0);
		expect(total).toBe(4);
	});
});

// ─── computeVectorscope ───────────────────────────────────────────────────────
describe("computeVectorscope", () => {
	it("출력 배열 길이 = size × size", () => {
		const data = new Uint8ClampedArray(4 * 4);
		data.fill(128);
		const frame: ScopeFrame = { width: 1, height: 1, data };
		const out = computeVectorscope(frame, 64);
		expect(out.length).toBe(64 * 64);
	});

	it("픽셀 합계 = 픽셀 수", () => {
		const w = 2;
		const h = 2;
		const data = new Uint8ClampedArray(w * h * 4);
		for (let i = 0; i < data.length; i += 4) {
			data[i] = 100;
			data[i + 1] = 150;
			data[i + 2] = 200;
			data[i + 3] = 255;
		}
		const frame: ScopeFrame = { width: w, height: h, data };
		const out = computeVectorscope(frame, 256);
		const total = out.reduce((s, v) => s + v, 0);
		expect(total).toBe(w * h);
	});
});

// ─── applyCubeLutToImageData ──────────────────────────────────────────────────
describe("applyCubeLutToImageData", () => {
	function makeIdentityLut(size = 2) {
		const text = [
			`LUT_3D_SIZE ${size}`,
			...Array.from({ length: size ** 3 }, (_, i) => {
				const n = size - 1;
				const r = (i % size) / n;
				const g = (Math.floor(i / size) % size) / n;
				const b = Math.floor(i / (size * size)) / n;
				return `${r} ${g} ${b}`;
			}),
		].join("\n");
		return parseCubeLut(text);
	}

	it("identity LUT → 픽셀 변화 없음", () => {
		const lut = makeIdentityLut(2);
		const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
		const image = new ImageDataMock(data, 2, 1) as unknown as ImageData;
		const out = applyCubeLutToImageData(image, lut, 1);
		expect(out.data[0]).toBeCloseTo(255, -1);
		expect(out.data[4]).toBeCloseTo(0, -1);
	});

	it("amount=0 → 원본 픽셀 유지", () => {
		const lut = makeIdentityLut(2);
		const data = new Uint8ClampedArray([100, 150, 200, 255]);
		const image = new ImageDataMock(data, 1, 1) as unknown as ImageData;
		const out = applyCubeLutToImageData(image, lut, 0);
		expect(out.data[0]).toBe(100);
		expect(out.data[1]).toBe(150);
		expect(out.data[2]).toBe(200);
		expect(out.data[3]).toBe(255); // alpha 보존
	});

	it("알파 채널 보존", () => {
		const lut = makeIdentityLut(2);
		const data = new Uint8ClampedArray([128, 128, 128, 200]);
		const image = new ImageDataMock(data, 1, 1) as unknown as ImageData;
		const out = applyCubeLutToImageData(image, lut, 1);
		expect(out.data[3]).toBe(200);
	});
});
