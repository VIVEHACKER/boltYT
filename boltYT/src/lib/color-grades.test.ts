/**
 * color-grades.ts 단위 테스트 — 순수 함수 + 상수 구조 검증
 */

import { describe, expect, it } from "vitest";
import {
	COLOR_GRADE_LABELS,
	COLOR_MATRICES,
	matrixToSvgValues,
	suggestColorGrade,
} from "./color-grades";

// ─── COLOR_MATRICES 구조 검증 ─────────────────────────────────────────────────
describe("COLOR_MATRICES", () => {
	it("6개 프리셋 정의", () => {
		expect(Object.keys(COLOR_MATRICES)).toHaveLength(6);
	});

	it("각 행렬은 정확히 20개 값", () => {
		for (const m of Object.values(COLOR_MATRICES)) {
			expect(m).toHaveLength(20);
		}
	});

	it("모든 값이 숫자", () => {
		for (const m of Object.values(COLOR_MATRICES)) {
			expect(m.every((v) => typeof v === "number")).toBe(true);
		}
	});
});

// ─── COLOR_GRADE_LABELS 구조 검증 ─────────────────────────────────────────────
describe("COLOR_GRADE_LABELS", () => {
	it("'none' 포함 7개 레이블", () => {
		expect(Object.keys(COLOR_GRADE_LABELS)).toHaveLength(7);
		expect(COLOR_GRADE_LABELS.none).toBe("원본");
	});

	it("모든 값이 비어 있지 않은 문자열", () => {
		for (const v of Object.values(COLOR_GRADE_LABELS)) {
			expect(typeof v).toBe("string");
			expect(v.length).toBeGreaterThan(0);
		}
	});
});

// ─── matrixToSvgValues ────────────────────────────────────────────────────────
describe("matrixToSvgValues", () => {
	it("20개 숫자를 공백 구분 문자열로 반환", () => {
		const result = matrixToSvgValues(COLOR_MATRICES["teal-orange"]);
		const parts = result.split(" ");
		expect(parts).toHaveLength(20);
	});

	it("반환값이 문자열", () => {
		expect(typeof matrixToSvgValues(COLOR_MATRICES["warm-film"])).toBe(
			"string",
		);
	});

	it("단순 배열도 정상 변환", () => {
		const m = [
			1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
		] as const;
		expect(matrixToSvgValues(m)).toBe(
			"1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0",
		);
	});
});

// ─── suggestColorGrade ────────────────────────────────────────────────────────
describe("suggestColorGrade", () => {
	it("horror + dark → cold-noir", () => {
		expect(suggestColorGrade("horror", "dark")).toBe("cold-noir");
	});

	it("horror (lighting 없음) → teal-orange", () => {
		expect(suggestColorGrade("horror")).toBe("teal-orange");
	});

	it("mystery → teal-orange", () => {
		expect(suggestColorGrade("mystery")).toBe("teal-orange");
	});

	it("warm → warm-film", () => {
		expect(suggestColorGrade("warm")).toBe("warm-film");
	});

	it("news → muted-doc", () => {
		expect(suggestColorGrade("news")).toBe("muted-doc");
	});

	it("neutral + bright → vibrant-pop", () => {
		expect(suggestColorGrade("neutral", "bright")).toBe("vibrant-pop");
	});

	it("알 수 없는 mood → none", () => {
		expect(suggestColorGrade("unknown")).toBe("none");
	});

	it("neutral + dark → none (bright 아닌 경우)", () => {
		expect(suggestColorGrade("neutral", "dark")).toBe("none");
	});
});
