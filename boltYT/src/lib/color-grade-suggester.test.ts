import { describe, expect, it } from "vitest";
import { suggestColorGradeFromColors } from "./color-grade-suggester";

describe("suggestColorGradeFromColors", () => {
	it("빈 배열 → none", () => {
		expect(suggestColorGradeFromColors([])).toBe("none");
	});

	it("매우 어두운 차가운 톤 → true-crime-noir", () => {
		expect(suggestColorGradeFromColors(["#0a0a1a", "#101020"])).toBe(
			"true-crime-noir",
		);
	});

	it("밝은 차가운 톤 → arctic", () => {
		expect(suggestColorGradeFromColors(["#aae0ff", "#cce8f5"])).toBe("arctic");
	});

	it("녹색 우세 → nature-doc", () => {
		expect(suggestColorGradeFromColors(["#3b8a3b", "#5cb05c"])).toBe(
			"nature-doc",
		);
	});

	it("따뜻한 채도 높음 → sunset-glow", () => {
		expect(suggestColorGradeFromColors(["#ff8a3a", "#ffb060"])).toBe(
			"sunset-glow",
		);
	});

	it("핑크/마젠타 → k-drama-soft", () => {
		expect(suggestColorGradeFromColors(["#ffaad4", "#ff99c4"])).toBe(
			"k-drama-soft",
		);
	});

	it("회색 톤 → cinematic-bleach 또는 muted-doc", () => {
		const r = suggestColorGradeFromColors(["#888888", "#777777"]);
		expect(["cinematic-bleach", "muted-doc"]).toContain(r);
	});
});
