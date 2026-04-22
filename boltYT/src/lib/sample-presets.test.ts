import { describe, expect, it } from "vitest";
import { findPreset, SAMPLE_PRESETS } from "./sample-presets";

describe("sample-presets", () => {
	it("프리셋 3종 존재, id 유니크", () => {
		expect(SAMPLE_PRESETS).toHaveLength(3);
		const ids = SAMPLE_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(3);
	});

	it("모든 프리셋 필수 필드 채워져 있음", () => {
		for (const p of SAMPLE_PRESETS) {
			expect(p.title).toBeTruthy();
			expect(p.description).toBeTruthy();
			expect(p.topic).toBeTruthy();
			expect(["shorts", "longform"]).toContain(p.format);
			expect(["calm", "energetic", "serious"]).toContain(p.tone);
			expect(["ko", "en"]).toContain(p.language);
			expect(p.styleHints.length).toBeGreaterThan(0);
		}
	});

	it("findPreset — 존재/미존재 분기", () => {
		expect(findPreset("news-shorts")?.format).toBe("shorts");
		expect(findPreset("does-not-exist")).toBeUndefined();
	});
});
