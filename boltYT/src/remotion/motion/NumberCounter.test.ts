import { describe, expect, it } from "vitest";
import { formatCounterValue } from "./NumberCounter";

describe("formatCounterValue (소수 보존 — YMYL 조작 방지)", () => {
	it("소수 목표는 반올림하지 않고 자릿수 유지", () => {
		// 회귀 방지: 예전엔 Math.round → 3.5%가 '4'로 표시되던 치명 버그.
		expect(formatCounterValue(3.5, 3.5)).toBe("3.5");
		expect(formatCounterValue(0.25, 0.25)).toBe("0.25");
		expect(formatCounterValue(0.1, 0.1)).toBe("0.1");
	});
	it("정수 목표는 정수로(기존 동작 불변)", () => {
		expect(formatCounterValue(3, 3)).toBe("3");
		expect(formatCounterValue(2650, 2650)).toBe("2650");
	});
	it("카운트업 중간값도 목표 자릿수로 포맷", () => {
		// eased 중간: 목표 3.5(1자리) → 중간값 1.75 는 "1.8"(1자리 반올림 표시)
		expect(formatCounterValue(1.75, 3.5)).toBe("1.8");
		expect(formatCounterValue(1.5, 3)).toBe("2"); // 목표 정수 → 0자리
	});
	it("comma 포맷은 천단위 구분 + 목표 소수 자릿수", () => {
		expect(formatCounterValue(2650, 2650, "comma")).toBe("2,650");
		expect(formatCounterValue(1234.5, 1234.5, "comma")).toBe("1,234.5");
	});
});
