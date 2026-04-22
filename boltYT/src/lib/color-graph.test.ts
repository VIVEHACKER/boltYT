import { describe, expect, it } from "vitest";
import {
	applyNode,
	type ColorGraph,
	evaluateGraph,
	hslToRgb,
	qualifierMask,
	rgbToHsl,
} from "./color-graph";

describe("rgb/hsl 변환", () => {
	it("rgbToHsl — gray", () => {
		const hsl = rgbToHsl({ r: 0.5, g: 0.5, b: 0.5 });
		expect(hsl.s).toBe(0);
		expect(hsl.l).toBeCloseTo(0.5);
	});

	it("rgbToHsl — 빨강 hue ≈ 0", () => {
		const hsl = rgbToHsl({ r: 1, g: 0, b: 0 });
		expect(hsl.h).toBeCloseTo(0);
		expect(hsl.s).toBeCloseTo(1);
	});

	it("rgbToHsl ↔ hslToRgb 왕복 (초록)", () => {
		const hsl = rgbToHsl({ r: 0, g: 1, b: 0 });
		const back = hslToRgb(hsl.h, hsl.s, hsl.l);
		expect(back.r).toBeCloseTo(0, 5);
		expect(back.g).toBeCloseTo(1, 5);
		expect(back.b).toBeCloseTo(0, 5);
	});
});

describe("applyNode", () => {
	it("exposure +1ev 은 ×2", () => {
		const out = applyNode(
			{ r: 0.3, g: 0.3, b: 0.3 },
			{ kind: "exposure", ev: 1 },
		);
		expect(out.r).toBeCloseTo(0.6);
	});

	it("exposure 상한 1.0 clamp", () => {
		const out = applyNode(
			{ r: 0.8, g: 0.8, b: 0.8 },
			{ kind: "exposure", ev: 2 },
		);
		expect(out.r).toBe(1);
	});

	it("contrast +1 은 0.5 중심 확장", () => {
		const out = applyNode(
			{ r: 0.75, g: 0.25, b: 0.5 },
			{ kind: "contrast", amount: 1 },
		);
		expect(out.r).toBe(1); // 0.75 → 1
		expect(out.g).toBe(0); // 0.25 → 0
		expect(out.b).toBeCloseTo(0.5);
	});

	it("saturation +1 은 채도 두 배", () => {
		const out = applyNode(
			{ r: 0.5, g: 0.25, b: 0.25 },
			{ kind: "saturation", amount: 1 },
		);
		const hsl = rgbToHsl(out);
		expect(hsl.s).toBeGreaterThan(0.5);
	});

	it("temp+ 은 R↑ B↓", () => {
		const out = applyNode(
			{ r: 0.5, g: 0.5, b: 0.5 },
			{ kind: "temp-tint", temperature: 50, tint: 0 },
		);
		expect(out.r).toBeGreaterThan(0.5);
		expect(out.b).toBeLessThan(0.5);
	});
});

describe("hsl-qualifier", () => {
	const q = {
		kind: "hsl-qualifier" as const,
		hue: 120, // green
		range: 30,
		feather: 15,
		satMin: 0.2,
		satMax: 1,
		saturationDelta: -0.5,
	};

	it("qualifierMask — 중심 hue 는 1", () => {
		expect(qualifierMask({ r: 0, g: 1, b: 0 }, q)).toBe(1);
	});

	it("qualifierMask — 범위 밖 빨강은 0", () => {
		expect(qualifierMask({ r: 1, g: 0, b: 0 }, q)).toBe(0);
	});

	it("qualifierMask — feather 구간 선형", () => {
		// 빨강-초록 사이 (hue=90) → range 경계에서 feather 내부
		const mid = qualifierMask({ r: 0.5, g: 1, b: 0.5 }, q);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThanOrEqual(1);
	});

	it("qualifierMask — satMin 미만은 0", () => {
		// 회색 (s=0) 은 hue 여도 satMin(0.2) 미만 → 마스크 0
		expect(qualifierMask({ r: 0.5, g: 0.5, b: 0.5 }, q)).toBe(0);
	});

	it("applyNode qualifier — 마스크 0 인 픽셀은 그대로", () => {
		const red = { r: 1, g: 0, b: 0 };
		const out = applyNode(red, q);
		expect(out).toEqual(red);
	});

	it("applyNode qualifier — 초록은 saturation 감소 (desaturate)", () => {
		const green = { r: 0, g: 1, b: 0 };
		const out = applyNode(green, q);
		const satBefore = rgbToHsl(green).s;
		const satAfter = rgbToHsl(out).s;
		expect(satAfter).toBeLessThan(satBefore);
	});
});

describe("evaluateGraph", () => {
	it("체인 순서 유지 — exposure 후 contrast", () => {
		const graph: ColorGraph = [
			{ kind: "exposure", ev: -1 },
			{ kind: "contrast", amount: 0.5 },
		];
		const out = evaluateGraph({ r: 0.8, g: 0.8, b: 0.8 }, graph);
		// 0.8 → 0.4 (-1ev) → (0.4-0.5)*1.5+0.5 = 0.35
		expect(out.r).toBeCloseTo(0.35, 2);
	});

	it("빈 그래프는 원본 반환", () => {
		expect(evaluateGraph({ r: 0.1, g: 0.2, b: 0.3 }, [])).toEqual({
			r: 0.1,
			g: 0.2,
			b: 0.3,
		});
	});
});
