import { describe, expect, it } from "vitest";
import { analyzeImageData, suggestColorBoost } from "./image-color-analysis";

function makeImageData(rgbaPixels: number[]): ImageData {
	const data = new Uint8ClampedArray(rgbaPixels);
	return {
		data,
		width: rgbaPixels.length / 4,
		height: 1,
		colorSpace: "srgb" as PredefinedColorSpace,
	};
}

describe("analyzeImageData", () => {
	it("회색 이미지 → 채도 0", () => {
		const px: number[] = [];
		for (let i = 0; i < 16; i++) px.push(128, 128, 128, 255);
		const stats = analyzeImageData(makeImageData(px));
		expect(stats.avgSaturation).toBe(0);
		expect(stats.avgBrightness).toBeCloseTo(128, 0);
	});

	it("순수 빨강 이미지 → 채도 1", () => {
		const px: number[] = [];
		for (let i = 0; i < 16; i++) px.push(255, 0, 0, 255);
		const stats = analyzeImageData(makeImageData(px));
		expect(stats.avgSaturation).toBeCloseTo(1, 1);
	});
});

describe("suggestColorBoost", () => {
	it("탁한 색상 → +30% 채도 제안", () => {
		const r = suggestColorBoost({
			avgBrightness: 130,
			avgSaturation: 0.1,
			stdDev: 50,
			sampleCount: 100,
		});
		expect(r.saturation).toBeCloseTo(0.3, 5);
	});

	it("낮은 대비 → contrast +0.15", () => {
		const r = suggestColorBoost({
			avgBrightness: 130,
			avgSaturation: 0.5,
			stdDev: 20,
			sampleCount: 100,
		});
		expect(r.contrast).toBeCloseTo(0.15, 5);
	});

	it("정상 이미지 → 보정 불필요", () => {
		const r = suggestColorBoost({
			avgBrightness: 130,
			avgSaturation: 0.5,
			stdDev: 60,
			sampleCount: 100,
		});
		expect(r.saturation).toBe(0);
		expect(r.contrast).toBe(0);
		expect(r.exposure).toBe(0);
	});

	it("어두운 이미지 → +0.2 노출", () => {
		const r = suggestColorBoost({
			avgBrightness: 40,
			avgSaturation: 0.5,
			stdDev: 50,
			sampleCount: 100,
		});
		expect(r.exposure).toBeCloseTo(0.2, 5);
	});
});
