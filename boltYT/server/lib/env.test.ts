/**
 * env.ts 단위 테스트
 *
 * validateEnv: process.env 의존 (순수 로직).
 * loadEnv: fs 의존 → 부재 시 skip (기본값 커버).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		watchFile: vi.fn(),
		unwatchFile: vi.fn(),
	};
});

import { unwatchFile, watchFile } from "node:fs";
import { loadEnv, validateEnv, watchEnv } from "./env.ts";

const originalEnv = { ...process.env };

afterEach(() => {
	// restore process.env
	for (const k of Object.keys(process.env)) {
		if (!(k in originalEnv)) delete process.env[k];
	}
	for (const [k, v] of Object.entries(originalEnv)) {
		process.env[k] = v;
	}
	vi.restoreAllMocks();
});

// ─── validateEnv ──────────────────────────────────────────────────────────────
describe("validateEnv", () => {
	beforeEach(() => {
		delete process.env.TEST_KEY_A;
		delete process.env.TEST_KEY_B;
	});

	it("모든 키 존재 → ok true, missing 빈 배열", () => {
		process.env.TEST_KEY_A = "val1";
		process.env.TEST_KEY_B = "val2";
		const result = validateEnv(["TEST_KEY_A", "TEST_KEY_B"], "test-service");
		expect(result.ok).toBe(true);
		expect(result.missing).toEqual([]);
	});

	it("일부 키 없음 → ok false, missing 배열 반환", () => {
		process.env.TEST_KEY_A = "val1";
		const result = validateEnv(["TEST_KEY_A", "TEST_KEY_B"], "test-service");
		expect(result.ok).toBe(false);
		expect(result.missing).toContain("TEST_KEY_B");
	});

	it("모든 키 없음 → missing 배열에 모두 포함", () => {
		const result = validateEnv(["TEST_KEY_A", "TEST_KEY_B"], "svc");
		expect(result.missing).toEqual(["TEST_KEY_A", "TEST_KEY_B"]);
	});

	it("빈 required 배열 → ok true", () => {
		const result = validateEnv([], "svc");
		expect(result.ok).toBe(true);
		expect(result.missing).toEqual([]);
	});

	it("누락 키 → stderr 경고 출력", () => {
		const spy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		validateEnv(["MISSING_KEY_XYZ"], "svc");
		expect(spy).toHaveBeenCalled();
	});
});

// ─── loadEnv ──────────────────────────────────────────────────────────────────
describe("loadEnv", () => {
	it(".env 없어도 throw 없음", () => {
		expect(() => loadEnv()).not.toThrow();
	});
});

// ─── watchEnv ─────────────────────────────────────────────────────────────────
describe("watchEnv", () => {
	it("watchFile 등록, cleanup 반환", () => {
		const cb = vi.fn();
		const cleanup = watchEnv(cb);
		expect(vi.mocked(watchFile)).toHaveBeenCalled();
		expect(typeof cleanup).toBe("function");
	});

	it("cleanup 호출 시 unwatchFile 실행", () => {
		const cleanup = watchEnv(vi.fn());
		cleanup();
		expect(vi.mocked(unwatchFile)).toHaveBeenCalled();
	});

	it("mtime 변경 시 콜백 호출 (타이머 사용)", () => {
		vi.useFakeTimers();
		const cb = vi.fn();
		let watchCallback:
			| ((curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void)
			| null = null;

		vi.mocked(watchFile).mockImplementation((_path, _opts, listener) => {
			watchCallback = listener as typeof watchCallback;
			return {} as ReturnType<typeof import("node:fs").watchFile>;
		});

		watchEnv(cb);

		// mtime이 변경됐을 때
		if (watchCallback) {
			watchCallback({ mtimeMs: 2000 }, { mtimeMs: 1000 });
		}
		vi.runAllTimers();

		// callback이 호출됐어야 함
		expect(cb).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("mtime 동일하면 콜백 미호출", () => {
		vi.useFakeTimers();
		const cb = vi.fn();
		let watchCallback:
			| ((curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void)
			| null = null;

		vi.mocked(watchFile).mockImplementation((_path, _opts, listener) => {
			watchCallback = listener as typeof watchCallback;
			return {} as ReturnType<typeof import("node:fs").watchFile>;
		});

		watchEnv(cb);
		if (watchCallback) {
			watchCallback({ mtimeMs: 1000 }, { mtimeMs: 1000 });
		}
		vi.runAllTimers();
		expect(cb).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
