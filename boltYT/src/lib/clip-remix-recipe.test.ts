import { describe, expect, it } from "vitest";
import { buildSourceCommentaryShortRecipe } from "./clip-remix-recipe";

describe("clip-remix-recipe", () => {
	it("builds a source-commentary short structure", () => {
		const recipe = buildSourceCommentaryShortRecipe({
			sourceUrl: "https://www.youtube.com/shorts/ClEzbmmZOAc",
			sourceTitle: "방안에 반도체 공장 차려버린 K고딩. 될놈이다 ㅋㅋㅋㅋ",
			sourceCreator: "따봉햄찌",
			topic: "방 안에서 반도체 실험을 한 고등학생",
			targetDurationSeconds: 33,
			sourceClipSeconds: 11,
			rightsBasis: "permission",
		});

		expect(recipe.format).toBe("source_commentary_short");
		expect(recipe.targetDurationSeconds).toBe(33);
		expect(recipe.sourceClipRatio).toBeLessThan(0.5);
		expect(recipe.policy.verdict).toBe("cleared");
		expect(recipe.beats.map((beat) => beat.kind)).toEqual([
			"hook",
			"source_context",
			"evidence_clip",
			"commentary",
			"takeaway",
			"attribution",
		]);
		expect(recipe.renderRules.reframe).toBe("vertical_fill_blur");
		expect(recipe.descriptionCredit).toContain("Original URL");
	});

	it("carries policy blocking for uncleared standard YouTube sources", () => {
		const recipe = buildSourceCommentaryShortRecipe({
			sourceUrl: "https://www.youtube.com/shorts/ClEzbmmZOAc",
			sourceTitle: "Example",
			sourceCreator: "Other Channel",
			topic: "example topic",
			rightsBasis: "standard_youtube_license",
		});

		expect(recipe.policy.verdict).toBe("blocked");
		expect(recipe.policy.canFetchSourceClip).toBe(false);
	});

	it("caps requested source usage to the target duration", () => {
		const recipe = buildSourceCommentaryShortRecipe({
			sourceUrl: "https://youtu.be/source",
			sourceTitle: "Source",
			sourceCreator: "Creator",
			topic: "topic",
			targetDurationSeconds: 30,
			sourceClipSeconds: 999,
			rightsBasis: "licensed",
		});

		expect(recipe.sourceClipSeconds).toBe(30);
		expect(recipe.sourceClipRatio).toBe(1);
		expect(recipe.policy.verdict).toBe("cleared");
	});
});
