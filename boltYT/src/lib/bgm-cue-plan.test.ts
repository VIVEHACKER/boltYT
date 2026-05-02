import { describe, expect, it } from "vitest";
import type { RemotionScene } from "../remotion/types";
import { planBgmCuePlan } from "./bgm-cue-plan";

function scene(
	durationInFrames: number,
	overrides: Partial<RemotionScene> = {},
): RemotionScene {
	return {
		imageUrl: "",
		audioUrl: "",
		narration: "",
		durationInFrames,
		type: "image",
		...overrides,
	} as RemotionScene;
}

describe("planBgmCuePlan", () => {
	it("첫 비트가 늦으면 BGM 시작점을 자동으로 앞당긴다", () => {
		const plan = planBgmCuePlan(
			[
				scene(72, { type: "video", hookBoost: true }),
				scene(84, { type: "video", mood: "mystery" }),
				scene(90, { type: "image", mood: "news" }),
			],
			{
				beats: [0.64, 1.24, 1.84, 2.44, 3.04],
				fps: 30,
			},
		);

		expect(plan.startFromFrame).toBeGreaterThan(0);
		expect(plan.bursts.length).toBeGreaterThanOrEqual(1);
	});

	it("hook/climax/resolve cue를 비트 그리드에 맞춰 계산한다", () => {
		const plan = planBgmCuePlan(
			[
				scene(60, { type: "video", hookBoost: true, mood: "mystery" }),
				scene(72, { type: "video", pacing: "fast" }),
				scene(78, { type: "text_emphasis", mood: "horror" }),
				scene(96, { type: "image", mood: "warm" }),
			],
			{
				beats: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5],
				fps: 30,
			},
		);

		expect(plan.bursts).toHaveLength(2);
		expect(plan.bursts[0].frame % 15).toBe(0);
		expect(plan.resolveFrame).toBeGreaterThan(plan.bursts[1].frame);
	});

	it("비트 정보가 없어도 장면 구조만으로 큐를 만든다", () => {
		const plan = planBgmCuePlan(
			[
				scene(75, { type: "video", hookBoost: true }),
				scene(90, { type: "image", mood: "news" }),
				scene(105, { type: "video", mood: "mystery" }),
			],
			{
				fps: 30,
			},
		);

		expect(plan.startFromFrame).toBe(0);
		expect(plan.bursts.length).toBeGreaterThan(0);
		expect(plan.resolveFrame).toBeGreaterThan(0);
	});
});
