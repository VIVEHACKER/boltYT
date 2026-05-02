import { describe, expect, it } from "vitest";
import {
	isVideoDynamicsAcceptable,
	scoreFrameDiffs,
	type VideoDynamicsReport,
} from "./video-dynamics";

function report(partial: Partial<VideoDynamicsReport>): VideoDynamicsReport {
	return {
		available: true,
		score: 0,
		avgDiff: 0,
		maxDiff: 0,
		meaningfulDiffs: 0,
		sampleCount: 6,
		durationSeconds: 8,
		width: 1280,
		height: 720,
		issues: [],
		...partial,
	};
}

describe("video-dynamics", () => {
	it("거의 같은 프레임만 있으면 저동작 영상으로 분류한다", () => {
		const scored = scoreFrameDiffs([0.0001, 0.0002, 0.0001, 0.0003]);

		expect(scored.score).toBeLessThan(5);
		expect(scored.issues).toContain("low_motion_video");
		expect(scored.issues).toContain("no_meaningful_frame_change");
	});

	it("의미 있는 프레임 변화가 있으면 통과 가능한 점수를 만든다", () => {
		const scored = scoreFrameDiffs([0.018, 0.026, 0.014, 0.04]);

		expect(scored.score).toBeGreaterThanOrEqual(70);
		expect(scored.issues).not.toContain("low_motion_video");
	});

	it("브라우저에서 측정할 수 없는 환경은 차단하지 않는다", () => {
		expect(
			isVideoDynamicsAcceptable(
				report({
					available: false,
					issues: ["dom_unavailable"],
				}),
			),
		).toBe(true);
	});

	it("측정된 저동작 영상은 입력 품질 게이트에서 제외한다", () => {
		expect(
			isVideoDynamicsAcceptable(
				report({
					score: 6,
					avgDiff: 0.002,
					maxDiff: 0.006,
					issues: ["low_motion_video"],
				}),
			),
		).toBe(false);
	});
});
