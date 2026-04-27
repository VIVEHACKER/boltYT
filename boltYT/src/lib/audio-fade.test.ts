import { describe, expect, it } from "vitest";
import {
	fadeEnvelope,
	linearFadeIn,
	linearFadeOut,
	smoothFadeIn,
	smoothFadeOut,
} from "./audio-fade";

describe("linearFadeIn", () => {
	it("frame 0 → 0", () => expect(linearFadeIn(0, 10)).toBe(0));
	it("frame == duration → 1", () => expect(linearFadeIn(10, 10)).toBe(1));
	it("frame 5 of 10 → 0.5", () =>
		expect(linearFadeIn(5, 10)).toBeCloseTo(0.5, 5));
	it("duration 0 → 1", () => expect(linearFadeIn(0, 0)).toBe(1));
});

describe("linearFadeOut", () => {
	it("frame 0 → 1", () => expect(linearFadeOut(0, 100, 10)).toBe(1));
	it("frame at end → 0", () => expect(linearFadeOut(100, 100, 10)).toBe(0));
	it("mid fade", () => expect(linearFadeOut(95, 100, 10)).toBeCloseTo(0.5, 5));
});

describe("smoothFadeIn", () => {
	it("smoothstep at 0.5 → 0.5", () =>
		expect(smoothFadeIn(5, 10)).toBeCloseTo(0.5, 5));
	it("0 → 0", () => expect(smoothFadeIn(0, 10)).toBe(0));
	it("end → 1", () => expect(smoothFadeIn(10, 10)).toBe(1));
});

describe("fadeEnvelope", () => {
	it("envelope 항상 0~1 사이", () => {
		for (let f = 0; f <= 100; f += 5) {
			const v = fadeEnvelope(f, 100, 10, 10);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThanOrEqual(1);
		}
	});

	it("smooth curve 와 linear 둘 다 작동", () => {
		expect(fadeEnvelope(50, 100, 10, 10, "linear")).toBe(1);
		expect(fadeEnvelope(50, 100, 10, 10, "smooth")).toBe(1);
	});
});

describe("smoothFadeOut", () => {
	it("end at 0", () => expect(smoothFadeOut(100, 100, 10)).toBe(0));
});
