import { describe, expect, it } from "vitest";
import type { WordTiming } from "../remotion/types";
import { cleanupWordTimings } from "./word-timing-cleanup";

const w = (word: string, s: number, e: number): WordTiming => ({
	word,
	startFrame: s,
	endFrame: e,
});

describe("cleanupWordTimings", () => {
	it("orphan punctuation 병합", () => {
		const out = cleanupWordTimings([w("안녕", 0, 5), w(".", 6, 7)]);
		expect(out).toHaveLength(1);
		expect(out[0].word).toBe("안녕.");
		expect(out[0].endFrame).toBe(7);
	});

	it("한국어 종결어미 병합", () => {
		const out = cleanupWordTimings([w("좋아", 0, 5), w("요", 6, 8)]);
		expect(out).toHaveLength(1);
		expect(out[0].word).toBe("좋아요");
	});

	it("gap 너무 크면 병합 안 함", () => {
		const out = cleanupWordTimings([w("좋아", 0, 5), w("요", 30, 35)]);
		expect(out).toHaveLength(2);
	});

	it("중복 timestamp 보정", () => {
		const out = cleanupWordTimings([w("a", 0, 10), w("b", 5, 12)]);
		expect(out[1].startFrame).toBeGreaterThan(out[0].endFrame);
	});

	it("빈 배열 → 빈 배열", () => {
		expect(cleanupWordTimings([])).toEqual([]);
	});
});
