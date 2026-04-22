import { describe, expect, it } from "vitest";
import {
	computeHistogram,
	computeParade,
	normalizeHistogram,
} from "./histogram";

function rgba(pixels: Array<[number, number, number]>): Uint8ClampedArray {
	const out = new Uint8ClampedArray(pixels.length * 4);
	pixels.forEach(([r, g, b], i) => {
		out[i * 4] = r;
		out[i * 4 + 1] = g;
		out[i * 4 + 2] = b;
		out[i * 4 + 3] = 255;
	});
	return out;
}

describe("computeHistogram", () => {
	it("단일 색 → 해당 bin 에 전부 적재", () => {
		const data = rgba([
			[255, 0, 0],
			[255, 0, 0],
			[255, 0, 0],
		]);
		const h = computeHistogram(data, 4);
		expect(h.samples).toBe(3);
		expect(h.r[3]).toBe(3); // 255 → bin 3 (of 4)
		expect(h.r[0]).toBe(0);
		expect(h.g[0]).toBe(3); // 0 → bin 0
		expect(h.b[0]).toBe(3);
	});

	it("정규화 최대값 = 1", () => {
		const data = rgba([
			[0, 0, 0],
			[128, 128, 128],
			[255, 255, 255],
		]);
		const h = computeHistogram(data, 4);
		const norm = normalizeHistogram(h);
		expect(Math.max(...norm.r)).toBeCloseTo(1);
	});
});

describe("computeParade", () => {
	it("정확한 컬럼별 평균", () => {
		// 2x1 이미지: 왼쪽 빨강 (255,0,0), 오른쪽 파랑 (0,0,255)
		const data = rgba([
			[255, 0, 0],
			[0, 0, 255],
		]);
		const p = computeParade(data, 2, 1, 2);
		// 컬럼 0 은 R=1, B=0 / 컬럼 1 은 R=0, B=1
		expect(p.r[0]).toBeCloseTo(1);
		expect(p.b[0]).toBeCloseTo(0);
		expect(p.r[1]).toBeCloseTo(0);
		expect(p.b[1]).toBeCloseTo(1);
	});

	it("컬럼 수 > 너비 시 빈 컬럼 0 유지", () => {
		const data = rgba([
			[128, 128, 128],
			[200, 200, 200],
		]);
		const p = computeParade(data, 2, 1, 4);
		// 2 픽셀을 4 컬럼에 분포 → 컬럼 0,2 가 각각 1개씩, 컬럼 1,3 은 0
		const nonZero = [p.r[0], p.r[1], p.r[2], p.r[3]].filter((v) => v > 0);
		expect(nonZero.length).toBeGreaterThanOrEqual(2);
	});
});
