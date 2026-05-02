import { describe, expect, it } from "vitest";
import type { SceneShot } from "../lib/scene-shot-types";
import { buildShotTimeline } from "./shot-timing";
import type { WordTiming } from "./types";

function shot(id: string, duration_seconds = 1): SceneShot {
	return {
		id,
		kind: "context",
		duration_seconds,
		media_type: "video",
	};
}

describe("buildShotTimeline", () => {
	it("keeps proportional timing when no speech timings exist", () => {
		const timeline = buildShotTimeline([shot("a", 1), shot("b", 2)], 90);

		expect(timeline).toEqual([
			{ shot: expect.objectContaining({ id: "a" }), from: 0, durationInFrames: 30 },
			{
				shot: expect.objectContaining({ id: "b" }),
				from: 30,
				durationInFrames: 60,
			},
		]);
	});

	it("moves a cut away from the middle of an active spoken word", () => {
		const words: WordTiming[] = [
			{ word: "그런데", startFrame: 0, endFrame: 24 },
			{ word: "사람들이", startFrame: 25, endFrame: 78 },
			{ word: "봤습니다.", startFrame: 82, endFrame: 108 },
		];

		const timeline = buildShotTimeline([shot("a"), shot("b")], 120, {
			wordTimings: words,
		});

		expect(timeline[0].durationInFrames).toBeGreaterThanOrEqual(81);
		expect(timeline[1].from).toBe(timeline[0].durationInFrames);
		expect(timeline[1].from).not.toBeLessThanOrEqual(78);
	});

	it("prefers a nearby sentence boundary over a raw proportional cut", () => {
		const words: WordTiming[] = [
			{ word: "첫", startFrame: 0, endFrame: 12 },
			{ word: "단서입니다.", startFrame: 14, endFrame: 44 },
			{ word: "다음", startFrame: 54, endFrame: 72 },
			{ word: "장면", startFrame: 74, endFrame: 96 },
		];

		const timeline = buildShotTimeline([shot("a"), shot("b")], 120, {
			wordTimings: words,
		});

		expect(timeline[0].durationInFrames).toBe(47);
		expect(timeline[1].from).toBe(47);
	});

	it("preserves total duration while enforcing viable shot lengths", () => {
		const timeline = buildShotTimeline(
			[shot("a", 0.4), shot("b", 0.4), shot("c", 0.4)],
			45,
			{
				wordTimings: [
					{ word: "짧은", startFrame: 0, endFrame: 12 },
					{ word: "문장입니다.", startFrame: 15, endFrame: 40 },
				],
			},
		);

		expect(timeline[0].from).toBe(0);
		expect(timeline.reduce((sum, entry) => sum + entry.durationInFrames, 0)).toBe(
			45,
		);
		expect(timeline.every((entry) => entry.durationInFrames >= 1)).toBe(true);
	});
});
