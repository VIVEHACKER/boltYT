import { describe, expect, it } from "vitest";
import { floatSeed, fnv1a32, modSeed } from "./hash-seed";

describe("fnv1a32", () => {
	it("같은 입력 → 같은 hash", () => {
		expect(fnv1a32("hello")).toBe(fnv1a32("hello"));
	});

	it("다른 입력 → 다른 hash (대부분)", () => {
		expect(fnv1a32("hello")).not.toBe(fnv1a32("world"));
	});

	it("빈 문자열 → FNV offset", () => {
		expect(fnv1a32("")).toBe(2166136261);
	});

	it("결과는 항상 uint32 양의 정수", () => {
		const inputs = ["a", "abc", "긴 한글 문자열", "12345"];
		for (const i of inputs) {
			const h = fnv1a32(i);
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThan(2 ** 32);
			expect(Number.isInteger(h)).toBe(true);
		}
	});
});

describe("modSeed", () => {
	it("modulus 0 → 0", () => {
		expect(modSeed("test", 0)).toBe(0);
	});

	it("modulus 5 → 0~4 범위", () => {
		for (const s of ["a", "b", "c", "long string", "한글"]) {
			const r = modSeed(s, 5);
			expect(r).toBeGreaterThanOrEqual(0);
			expect(r).toBeLessThan(5);
		}
	});
});

describe("floatSeed", () => {
	it("0 ~ 1 범위", () => {
		for (const s of ["a", "test", "긴 텍스트"]) {
			const r = floatSeed(s);
			expect(r).toBeGreaterThanOrEqual(0);
			expect(r).toBeLessThan(1);
		}
	});
});
