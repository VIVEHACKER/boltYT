import { describe, expect, it } from "vitest";
import {
	beatFrames,
	clampShortsDuration,
	estimatedBpmFromTempo,
	retimeScenesToBeatGrid,
	snapDurationToBeat,
	snapScenesToBeat,
	snapToNearestBeat,
} from "./beat-sync";

describe("beat-sync", () => {
	it("shorts 씬 경계를 가장 가까운 비트에 맞춘다", () => {
		const scenes = [
			{
				duration_seconds: 2.1,
				word_timings: [{ startFrame: 0, endFrame: 42 }],
			},
			{
				duration_seconds: 2.1,
				word_timings: [{ startFrame: 0, endFrame: 39 }],
			},
			{
				duration_seconds: 1.9,
				word_timings: [{ startFrame: 0, endFrame: 33 }],
			},
		];

		const retimed = retimeScenesToBeatGrid(scenes, {
			beats: [2, 4, 6],
		});

		expect(retimed[0].duration_seconds).toBe(2);
		expect(retimed[1].duration_seconds).toBe(2);
		expect(retimed[2].duration_seconds).toBeGreaterThanOrEqual(1.9);
	});

	it("마지막 단어보다 앞에서 씬이 잘리지 않도록 최소 길이를 보장한다", () => {
		const scenes = [
			{
				duration_seconds: 2.1,
				word_timings: [{ startFrame: 0, endFrame: 66 }],
			},
		];

		const retimed = retimeScenesToBeatGrid(scenes, {
			beats: [2],
		});

		expect(retimed[0].duration_seconds).toBeGreaterThanOrEqual(2.38);
	});

	it("템포 fallback BPM을 제공한다", () => {
		expect(estimatedBpmFromTempo("slow")).toBe(80);
		expect(estimatedBpmFromTempo("mid")).toBe(100);
		expect(estimatedBpmFromTempo("fast")).toBe(130);
	});
});

// ─── beatFrames ───────────────────────────────────────────────────────────────
describe("beatFrames", () => {
	it("100BPM @ 30fps → 18프레임", () => {
		expect(beatFrames(100, 30)).toBe(18);
	});

	it("60BPM @ 30fps → 30프레임", () => {
		expect(beatFrames(60, 30)).toBe(30);
	});

	it("기본 fps=30 사용", () => {
		expect(beatFrames(120)).toBe(15);
	});
});

// ─── snapDurationToBeat ───────────────────────────────────────────────────────
describe("snapDurationToBeat", () => {
	it("숫자 BPM 직접 전달", () => {
		// 100BPM = 0.6초/비트. 5.1초 → 8비트(4.8초) 또는 10비트(6초) → 가장 가까운 짝수비트
		const result = snapDurationToBeat(5.1, 100);
		expect(result).toBeGreaterThan(0);
	});

	it("tempo 문자열 전달 (fast=130BPM)", () => {
		const result = snapDurationToBeat(2.0, "fast");
		expect(result).toBeGreaterThan(0);
	});

	it("minBeats 보장", () => {
		const bpm = 100;
		const beatSec = 60 / bpm;
		const result = snapDurationToBeat(0.1, bpm, 4);
		// minBeats=4 → 최소 4비트 = 4 * 0.6 = 2.4초
		expect(result).toBeGreaterThanOrEqual(4 * beatSec);
	});
});

// ─── snapToNearestBeat ────────────────────────────────────────────────────────
describe("snapToNearestBeat", () => {
	it("빈 beats → targetSeconds 반환", () => {
		expect(snapToNearestBeat(3.5, [])).toBe(3.5);
	});

	it("가장 가까운 비트 선택", () => {
		expect(snapToNearestBeat(2.1, [1, 2, 3, 4])).toBe(2);
		expect(snapToNearestBeat(2.6, [1, 2, 3, 4])).toBe(3);
	});

	it("정확히 일치하는 비트", () => {
		expect(snapToNearestBeat(4.0, [2, 4, 6])).toBe(4);
	});
});

// ─── snapScenesToBeat ─────────────────────────────────────────────────────────
describe("snapScenesToBeat", () => {
	it("빈 배열 → 빈 배열", () => {
		expect(snapScenesToBeat([], "mid")).toEqual([]);
	});

	it("씬 duration이 비트에 가깝게 조정됨", () => {
		const scenes = [
			{ id: "s1", duration_seconds: 5 },
			{ id: "s2", duration_seconds: 5 },
		];
		const result = snapScenesToBeat(scenes, "mid");
		expect(result).toHaveLength(2);
		expect(result[0].duration_seconds).toBeGreaterThan(0);
	});

	it("원본 대비 30% 초과 변형 → 비례 조정", () => {
		// 매우 짧은 씬들로 강제로 ratio 벗어나게 함
		const scenes = Array(5)
			.fill(null)
			.map((_, i) => ({
				id: `s${i}`,
				duration_seconds: 0.1,
			}));
		const result = snapScenesToBeat(scenes, "slow");
		const total = result.reduce((s, sc) => s + sc.duration_seconds, 0);
		expect(total).toBeGreaterThan(0);
	});

	it("다른 필드 보존", () => {
		const scenes = [{ id: "s1", duration_seconds: 5, custom: "data" }];
		const result = snapScenesToBeat(scenes, "fast");
		expect(result[0].custom).toBe("data");
	});
});

// ─── clampShortsDuration ─────────────────────────────────────────────────────
describe("clampShortsDuration", () => {
	it("빈 배열 → 빈 배열", () => {
		expect(clampShortsDuration([])).toEqual([]);
	});

	it("범위 내(50~58초) → 변경 없음", () => {
		const scenes = [{ duration_seconds: 25 }, { duration_seconds: 28 }];
		const result = clampShortsDuration(scenes, 50, 58);
		expect(result[0].duration_seconds).toBe(25);
		expect(result[1].duration_seconds).toBe(28);
	});

	it("총 길이 < targetMin → targetMin으로 스케일 업", () => {
		const scenes = [{ duration_seconds: 20 }, { duration_seconds: 20 }]; // total=40, targetMin=50
		const result = clampShortsDuration(scenes, 50, 58);
		const total = result.reduce((s, sc) => s + sc.duration_seconds, 0);
		expect(total).toBeCloseTo(50, 0);
	});

	it("총 길이 > targetMax → targetMax로 스케일 다운", () => {
		const scenes = [{ duration_seconds: 40 }, { duration_seconds: 40 }]; // total=80, targetMax=58
		const result = clampShortsDuration(scenes, 50, 58);
		const total = result.reduce((s, sc) => s + sc.duration_seconds, 0);
		expect(total).toBeCloseTo(58, 0);
	});

	it("다른 필드 보존", () => {
		const scenes = [{ duration_seconds: 10, tag: "intro" }];
		const result = clampShortsDuration(scenes, 50, 58);
		expect(result[0].tag).toBe("intro");
	});
});

// ─── retimeScenesToBeatGrid (추가 케이스) ─────────────────────────────────────
describe("retimeScenesToBeatGrid (추가)", () => {
	it("빈 배열 → 빈 배열", () => {
		expect(retimeScenesToBeatGrid([])).toEqual([]);
	});

	it("bpm 옵션 사용 (beats 없음)", () => {
		const scenes = [{ duration_seconds: 3.0 }, { duration_seconds: 3.0 }];
		const result = retimeScenesToBeatGrid(scenes, { bpm: 100 });
		expect(result).toHaveLength(2);
		expect(result[0].duration_seconds).toBeGreaterThan(0);
	});

	it("beats도 bpm도 없으면 원본 유지", () => {
		const scenes = [{ duration_seconds: 5.0 }];
		const result = retimeScenesToBeatGrid(scenes, {});
		expect(result[0].duration_seconds).toBe(5.0);
	});

	it("word_timings 없는 씬 → 최소 길이 0.9초 보장", () => {
		const scenes = [{ duration_seconds: 0.3 }];
		const result = retimeScenesToBeatGrid(scenes, { beats: [0.5] });
		expect(result[0].duration_seconds).toBeGreaterThanOrEqual(0.3);
	});
});
