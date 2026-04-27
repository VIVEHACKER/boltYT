import { describe, expect, it } from "vitest";
import type { WordTiming } from "../remotion/types";
import { nudgeWordTimings } from "./word-timing-nudge";

const w = (word: string, s: number, e: number): WordTiming => ({
	word,
	startFrame: s,
	endFrame: e,
});

describe("nudgeWordTimings", () => {
	it("강한 구두점(.) 뒤 단어는 +6 프레임 시프트", () => {
		const out = nudgeWordTimings([w("안녕.", 0, 10), w("반가워", 11, 20)]);
		expect(out[0].startFrame).toBe(0);
		expect(out[1].startFrame).toBe(17);
	});

	it("약한 구두점(,) 뒤 단어는 +3 프레임 시프트", () => {
		const out = nudgeWordTimings([w("저는,", 0, 10), w("학생", 11, 20)]);
		expect(out[1].startFrame).toBe(14);
	});

	it("누적 시프트는 18 프레임을 초과하지 않음", () => {
		const out = nudgeWordTimings([
			w("a.", 0, 5),
			w("b.", 6, 11),
			w("c.", 12, 17),
			w("d.", 18, 23),
			w("e", 24, 29),
		]);
		// 4 strong = 24 → cap at 18
		const lastShift = out[4].startFrame - 24;
		expect(lastShift).toBeLessThanOrEqual(18);
	});

	it("구두점 없으면 시프트 없음", () => {
		const out = nudgeWordTimings([w("안녕", 0, 5), w("세상", 6, 11)]);
		expect(out[1].startFrame).toBe(6);
	});

	it("빈 배열 → 빈 배열 반환", () => {
		expect(nudgeWordTimings([])).toEqual([]);
	});
});
