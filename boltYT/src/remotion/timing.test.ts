import { describe, expect, it } from "vitest";
import { buildSceneTimeline, getSceneAudioWindow } from "./timing";
import type { RemotionScene } from "./types";

function scene(
	audioUrl: string,
	durationInFrames = 100,
	transition: RemotionScene["transition"] = "crossfade",
): RemotionScene {
	return {
		type: "video",
		imageUrl: "",
		videoUrl: "",
		audioUrl,
		narration: "",
		durationInFrames,
		transition,
	};
}

describe("remotion timing", () => {
	it("단독 씬 오디오는 J/L-cut 여유 프레임까지 덕킹 윈도우에 포함한다", () => {
		const scenes = [scene("voice-a")];

		expect(getSceneAudioWindow(scenes, 0, 30, 130, 200)).toEqual({
			from: 26,
			to: 136,
		});
	});

	it("인접 TTS는 트랜지션 중간점에서 맞물리도록 오디오 윈도우를 clamp한다", () => {
		const scenes = [scene("voice-a"), scene("voice-b", 100, "whip_left")];
		const timeline = buildSceneTimeline(scenes, 0, 188);

		expect(timeline[0]).toMatchObject({
			from: 0,
			to: 100,
			audioFrom: 0,
			audioTo: 94,
		});
		expect(timeline[1]).toMatchObject({
			from: 88,
			to: 188,
			audioFrom: 94,
			audioTo: 188,
		});
		expect(timeline[0].audioTo).toBe(timeline[1].audioFrom);
	});
});
