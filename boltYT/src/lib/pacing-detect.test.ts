import { describe, expect, it } from "vitest";
import { detectPacing, fillPacingForScenes } from "./pacing-detect";

describe("detectPacing", () => {
	it("한글 빠른 발화 → fast", () => {
		// 60자 / 5초 = 12 cps → fast (≥6)
		expect(
			detectPacing({
				narration: "가나다라마바사아자차카타파하".repeat(5),
				duration_seconds: 5,
			}),
		).toBe("fast");
	});

	it("한글 느린 발화 → slow", () => {
		// 8자 / 5초 = 1.6 cps → slow (≤3.2)
		expect(
			detectPacing({
				narration: "안녕하세요 반가워요",
				duration_seconds: 8,
			}),
		).toBe("slow");
	});

	it("한글 보통 → normal", () => {
		// 20자 / 5초 = 4 cps → normal
		expect(
			detectPacing({
				narration: "이것은 보통 속도의 한국어 나레이션입니다",
				duration_seconds: 5,
			}),
		).toBe("normal");
	});

	it("영어 빠른 → fast", () => {
		expect(
			detectPacing({
				narration: "this is a very fast english sentence with many words today",
				duration_seconds: 3,
			}),
		).toBe("fast");
	});

	it("영어 느린 → slow", () => {
		expect(
			detectPacing({
				narration: "slow speech here",
				duration_seconds: 8,
			}),
		).toBe("slow");
	});

	it("duration 0 이하 → normal", () => {
		expect(detectPacing({ duration_seconds: 0 })).toBe("normal");
	});
});

describe("fillPacingForScenes", () => {
	it("기존 pacing 보존, 빈 것만 채움", () => {
		const result = fillPacingForScenes([
			{ duration_seconds: 5, pacing: "slow" },
			{ narration: "긴 텍스트".repeat(20), duration_seconds: 5 },
		]);
		expect(result[0].pacing).toBe("slow");
		expect(result[1].pacing).toBe("fast");
	});
});
