import { describe, expect, it } from "vitest";
import { detectLanguage } from "./lang-detect";

describe("detectLanguage", () => {
	it("순수 한글 → ko", () => {
		expect(detectLanguage("안녕하세요 반가워요")).toBe("ko");
	});

	it("순수 영문 → en", () => {
		expect(detectLanguage("hello world this is english")).toBe("en");
	});

	it("일본어 가나 → ja", () => {
		expect(detectLanguage("こんにちは ありがとう")).toBe("ja");
	});

	it("중국어 한자만 → zh", () => {
		expect(detectLanguage("你好世界")).toBe("zh");
	});

	it("일본 한자 + 가나 → ja (zh 우선 회피)", () => {
		expect(detectLanguage("私は学生です")).toBe("ja");
	});

	it("빈 문자열 → und", () => {
		expect(detectLanguage("")).toBe("und");
	});

	it("숫자/기호만 → und", () => {
		expect(detectLanguage("123 !@#")).toBe("und");
	});

	it("한글이 dominant 인 mixed → ko", () => {
		expect(detectLanguage("안녕하세요 오늘 정말 반가워요 hello")).toBe("ko");
	});
});
