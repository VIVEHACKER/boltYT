import { describe, expect, it } from "vitest";
import { splitLongScene, splitLongScenes } from "./scene-splitter";

describe("splitLongScene", () => {
	it("threshold 미만 → 그대로", () => {
		const s = { narration: "짧은 씬.", duration_seconds: 5 };
		expect(splitLongScene(s)).toEqual([s]);
	});

	it("threshold 초과 + 강한 구두점 있음 → 2개로 분할", () => {
		const s = {
			narration:
				"이것은 첫 번째 문장입니다. 그리고 이것은 두 번째 문장입니다.",
			duration_seconds: 14,
		};
		const result = splitLongScene(s);
		expect(result).toHaveLength(2);
		expect(result[0].narration).toContain("첫 번째");
		expect(result[1].narration).toContain("두 번째");
	});

	it("text_emphasis 씬은 분할하지 않음", () => {
		const s = {
			narration: "긴 강조 텍스트 입니다. 분할 하지 않아야 합니다.",
			duration_seconds: 16,
			scene_type: "text_emphasis",
		};
		expect(splitLongScene(s)).toEqual([s]);
	});

	it("narration 없으면 그대로", () => {
		const s = { duration_seconds: 20 };
		expect(splitLongScene(s)).toEqual([s]);
	});

	it("강한 구두점 없으면 그대로", () => {
		const s = {
			narration: "구두점 없이 이어지는 긴 텍스트 한 줄짜리 문장",
			duration_seconds: 14,
		};
		expect(splitLongScene(s)).toEqual([s]);
	});

	it("partition 너무 치우치면 분할 거부", () => {
		const s = {
			narration: "짧! 매우 매우 매우 매우 매우 긴 두 번째 부분입니다",
			duration_seconds: 14,
		};
		const result = splitLongScene(s);
		// 좌측이 minPart 미만이라 split 거부
		expect(result.length).toBe(1);
	});
});

describe("splitLongScenes", () => {
	it("배열 통째로 분할 처리", () => {
		const scenes = [
			{ narration: "짧음.", duration_seconds: 4 },
			{
				narration:
					"긴 씬의 첫 번째 부분 입니다. 그리고 이것은 두 번째 긴 부분입니다. 마무리 문장.",
				duration_seconds: 14,
			},
		];
		const result = splitLongScenes(scenes);
		expect(result.length).toBeGreaterThan(scenes.length);
	});
});
