import { describe, expect, it } from "vitest";
import type { ColorGraph } from "./color-graph";
import { compileColorGraphToCss } from "./color-graph-css";

describe("compileColorGraphToCss", () => {
	it("빈 그래프 → 'none'", () => {
		const r = compileColorGraphToCss([]);
		expect(r.css).toBe("none");
		expect(r.skipped).toEqual([]);
	});

	it("exposure ev=1 → brightness(2)", () => {
		const r = compileColorGraphToCss([{ kind: "exposure", ev: 1 }]);
		expect(r.css).toMatch(/^brightness\(2\.0+\)$/);
	});

	it("contrast +0.5 → contrast(1.5)", () => {
		const r = compileColorGraphToCss([{ kind: "contrast", amount: 0.5 }]);
		expect(r.css).toMatch(/^contrast\(1\.5/);
	});

	it("saturation -0.5 → saturate(0.5)", () => {
		const r = compileColorGraphToCss([{ kind: "saturation", amount: -0.5 }]);
		expect(r.css).toMatch(/^saturate\(0\.5/);
	});

	it("temp-tint 조합 → hue-rotate 단일 값", () => {
		const r = compileColorGraphToCss([
			{ kind: "temp-tint", temperature: 50, tint: 0 },
		]);
		// temperature=50 → -15deg (왜냐하면 -50*0.3=-15)
		expect(r.css).toMatch(/^hue-rotate\(-15\.00deg\)$/);
	});

	it("체인 순서 보존", () => {
		const graph: ColorGraph = [
			{ kind: "exposure", ev: 0.5 },
			{ kind: "contrast", amount: 0.2 },
			{ kind: "saturation", amount: -0.1 },
		];
		const r = compileColorGraphToCss(graph);
		const parts = r.css.split(" ");
		expect(parts[0]).toMatch(/^brightness/);
		expect(parts[1]).toMatch(/^contrast/);
		expect(parts[2]).toMatch(/^saturate/);
	});

	it("hsl-qualifier 는 skipped 에 기록, CSS 에서는 제외", () => {
		const r = compileColorGraphToCss([
			{ kind: "exposure", ev: 0.2 },
			{
				kind: "hsl-qualifier",
				hue: 120,
				range: 30,
				feather: 15,
				satMin: 0.2,
				satMax: 1,
				saturationDelta: -0.3,
			},
		]);
		expect(r.skipped).toEqual(["hsl-qualifier"]);
		expect(r.css).toMatch(/^brightness\(/);
		expect(r.css).not.toMatch(/hsl/);
	});
});
