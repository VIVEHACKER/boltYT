/**
 * validate.ts 단위 테스트 — 순수 함수, 외부 의존 없음
 */

import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeInt, sanitizeString } from "./validate.ts";

// ─── sanitizeString ───────────────────────────────────────────────────────────
describe("sanitizeString", () => {
	it("문자열 그대로 반환", () => {
		expect(sanitizeString("hello")).toBe("hello");
	});

	it("비문자열 → 빈 문자열", () => {
		expect(sanitizeString(42)).toBe("");
		expect(sanitizeString(null)).toBe("");
		expect(sanitizeString(undefined)).toBe("");
		expect(sanitizeString({})).toBe("");
	});

	it("maxLength 초과 → 잘림", () => {
		expect(sanitizeString("abcdef", 3)).toBe("abc");
	});

	it("기본 maxLength 500 적용", () => {
		const long = "a".repeat(600);
		expect(sanitizeString(long)).toHaveLength(500);
	});

	it("제어문자 제거 (탭·개행 제외)", () => {
		// \x07 (BEL) 제거, \t (탭) · \n (개행) 보존
		expect(sanitizeString("ab\x07cd")).toBe("abcd");
		expect(sanitizeString("ab\tcd")).toBe("ab\tcd");
		expect(sanitizeString("ab\ncd")).toBe("ab\ncd");
	});

	it("\\x0B (VT) 제거", () => {
		expect(sanitizeString("a\x0Bb")).toBe("ab");
	});

	it("\\x7F (DEL) 제거", () => {
		expect(sanitizeString("a\x7Fb")).toBe("ab");
	});

	it("빈 문자열 → 빈 문자열", () => {
		expect(sanitizeString("")).toBe("");
	});

	it("한국어 문자열 보존", () => {
		expect(sanitizeString("안녕하세요")).toBe("안녕하세요");
	});
});

// ─── sanitizeInt ──────────────────────────────────────────────────────────────
describe("sanitizeInt", () => {
	it("범위 내 정수 → 반환", () => {
		expect(sanitizeInt(5, 1, 10, 0)).toBe(5);
	});

	it("범위 내 숫자형 문자열 → 변환 후 반환", () => {
		expect(sanitizeInt("7", 1, 10, 0)).toBe(7);
	});

	it("min 경계값 → 허용", () => {
		expect(sanitizeInt(1, 1, 10, 0)).toBe(1);
	});

	it("max 경계값 → 허용", () => {
		expect(sanitizeInt(10, 1, 10, 0)).toBe(10);
	});

	it("min 미만 → fallback", () => {
		expect(sanitizeInt(0, 1, 10, 99)).toBe(99);
	});

	it("max 초과 → fallback", () => {
		expect(sanitizeInt(11, 1, 10, 99)).toBe(99);
	});

	it("NaN → fallback", () => {
		expect(sanitizeInt("abc", 1, 10, 42)).toBe(42);
	});

	it("Infinity → fallback", () => {
		expect(sanitizeInt(Infinity, 1, 100, 5)).toBe(5);
	});

	it("소수점 → floor 처리", () => {
		expect(sanitizeInt(4.9, 1, 10, 0)).toBe(4);
	});

	it("null → fallback", () => {
		expect(sanitizeInt(null, 1, 10, 7)).toBe(7);
	});
});

// ─── escapeHtml ───────────────────────────────────────────────────────────────
describe("escapeHtml", () => {
	it("& → &amp;", () => {
		expect(escapeHtml("a & b")).toBe("a &amp; b");
	});

	it("< → &lt;", () => {
		expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
	});

	it("> → &gt;", () => {
		expect(escapeHtml("a > b")).toBe("a &gt; b");
	});

	it('" → &quot;', () => {
		expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
	});

	it("' → &#39;", () => {
		expect(escapeHtml("it's")).toBe("it&#39;s");
	});

	it("복합 문자열 이스케이프", () => {
		expect(escapeHtml('<a href="test">it\'s & fun</a>')).toBe(
			"&lt;a href=&quot;test&quot;&gt;it&#39;s &amp; fun&lt;/a&gt;",
		);
	});

	it("특수문자 없으면 그대로", () => {
		expect(escapeHtml("hello world")).toBe("hello world");
	});

	it("빈 문자열 → 빈 문자열", () => {
		expect(escapeHtml("")).toBe("");
	});
});
