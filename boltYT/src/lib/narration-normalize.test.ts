import { describe, expect, it } from "vitest";
import { normalizeNarration } from "./narration-normalize";

describe("normalizeNarration", () => {
	it("양 끝 공백 trim + 중복 공백 제거", () => {
		expect(normalizeNarration("  안녕   세상  ")).toBe("안녕 세상");
	});

	it("스마트 따옴표 → 곧은 따옴표", () => {
		expect(normalizeNarration("그가 \u201C안녕\u201D 했다")).toBe(
			'그가 "안녕" 했다',
		);
	});

	it("트리플 마침표 → ellipsis", () => {
		expect(normalizeNarration("음... 그래요")).toBe("음… 그래요");
	});

	it("이중 구두점 단일화", () => {
		expect(normalizeNarration("정말?? 진짜!!")).toBe("정말? 진짜!");
	});

	it("영문 i 단독 → I", () => {
		expect(normalizeNarration("i think i can")).toBe("I think I can");
	});

	it("빈 문자열 → 빈 문자열", () => {
		expect(normalizeNarration("")).toBe("");
	});

	it("fixIsolatedI false → i 유지", () => {
		expect(normalizeNarration("i think", { fixIsolatedI: false })).toBe(
			"i think",
		);
	});
});
