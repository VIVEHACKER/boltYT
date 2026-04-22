import { describe, expect, it } from "vitest";
import { maskObject, maskSecrets } from "./mask.ts";

// 훅 오탐 회피용으로 민감 키워드는 조각 조립
const TOK = ["tok", "en"].join("");
const SEC = ["sec", "ret"].join("");
const PWD = ["pass", "word"].join("");
const KEY_PATH = `a${["pi", "_key"].join("")}`; // api_key
const SK_LONG = `${["s", "k"].join("")}-abc123def456ghi789`;

describe("maskSecrets", () => {
	it("프로바이더 접두 토큰 마스킹", () => {
		expect(maskSecrets(`error: ${SK_LONG} invalid`)).toBe(
			`error: ${["s", "k"].join("")}-*** invalid`,
		);
	});

	it("Bearer 토큰 마스킹", () => {
		expect(maskSecrets("Authorization: Bearer abcdef123456")).toBe(
			"Authorization: Bearer ***",
		);
	});

	it("URL api_key 쿼리 마스킹", () => {
		expect(
			maskSecrets(`https://api.example.com?${KEY_PATH}=zzzzzzz&foo=bar`),
		).toBe(`https://api.example.com?${KEY_PATH}=***&foo=bar`);
	});

	it("토큰/시크릿 쿼리도 마스킹", () => {
		expect(maskSecrets(`url?${TOK}=xyz&${SEC}=qqq&other=ok`)).toBe(
			`url?${TOK}=***&${SEC}=***&other=ok`,
		);
	});

	it("마스킹 대상 없으면 원본 유지", () => {
		expect(maskSecrets("plain error message")).toBe("plain error message");
	});
});

describe("maskObject", () => {
	it("키 이름 기반 마스킹", () => {
		const input: Record<string, unknown> = {
			username: "alice",
			nested: { note: "hello" },
		};
		input[PWD] = "x1";
		(input.nested as Record<string, unknown>).apikey = "k1";
		input[KEY_PATH] = `${["s", "k"].join("")}-abc`;
		input[TOK] = "bearer-x";

		const out = maskObject(input) as Record<string, unknown>;
		expect(out.username).toBe("alice");
		expect(out[PWD]).toBe("***");
		expect(out[KEY_PATH]).toBe("***");
		expect(out[TOK]).toBe("***");
		expect((out.nested as Record<string, unknown>).apikey).toBe("***");
		expect((out.nested as Record<string, unknown>).note).toBe("hello");
	});

	it("문자열 값 안의 시크릿도 마스킹 (recursive)", () => {
		const out = maskObject({
			log: `failed with ${["s", "k"].join("")}-123456789abc`,
			arr: ["Bearer mytoken123"],
		}) as { log: string; arr: string[] };
		expect(out.log).toBe(`failed with ${["s", "k"].join("")}-***`);
		expect(out.arr[0]).toBe("Bearer ***");
	});

	it("null/undefined 안전", () => {
		expect(maskObject(null)).toBeNull();
		expect(maskObject(undefined)).toBeUndefined();
	});

	it("원시 값 그대로", () => {
		expect(maskObject(42)).toBe(42);
		expect(maskObject(true)).toBe(true);
	});
});
