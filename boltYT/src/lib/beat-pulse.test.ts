import { describe, expect, it } from "vitest";
import { computeBeatPulseScale } from "./beat-pulse";

describe("computeBeatPulseScale", () => {
	it("비트 배열 비어있으면 1 반환", () => {
		expect(
			computeBeatPulseScale({
				sceneStartFrame: 0,
				frame: 30,
				beatTimes: [],
			}),
		).toBe(1);
	});

	it("비트 정확히 일치 → intensity 값 반환", () => {
		// frame 30 @ 30fps = 1.0초, beatTime 1.0 일치
		const s = computeBeatPulseScale({
			sceneStartFrame: 0,
			frame: 30,
			beatTimes: [1.0],
			intensity: 1.05,
		});
		expect(s).toBeCloseTo(1.05, 3);
	});

	it("윈도우 밖이면 1", () => {
		const s = computeBeatPulseScale({
			sceneStartFrame: 0,
			frame: 0,
			beatTimes: [10.0], // 10초 떨어짐
			pulseWidthFrames: 6,
		});
		expect(s).toBe(1);
	});

	it("윈도우 중간 → 보간된 값", () => {
		// frame=33 (1.1초), beat=1.0초, distance=3 frames, width=6
		const s = computeBeatPulseScale({
			sceneStartFrame: 0,
			frame: 33,
			beatTimes: [1.0],
			pulseWidthFrames: 6,
			intensity: 1.1,
		});
		// ratio = 1 - 3/6 = 0.5 → 1 + 0.1*0.5 = 1.05
		expect(s).toBeCloseTo(1.05, 2);
	});

	it("여러 비트 중 가장 가까운 것 선택", () => {
		const s = computeBeatPulseScale({
			sceneStartFrame: 0,
			frame: 30,
			beatTimes: [0.5, 1.0, 1.5],
			intensity: 1.05,
		});
		expect(s).toBeCloseTo(1.05, 3);
	});
});
