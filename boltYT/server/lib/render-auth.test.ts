/**
 * render-auth 테스트 — checkApiKey / checkFfmpegAvailability 순수 로직 검증.
 */

import { describe, expect, it, vi } from "vitest";
import { checkApiKey, checkFfmpegAvailability } from "./render-auth.js";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(
		(
			_cmd: string,
			_args: string[],
			_opts: unknown,
			cb: (err: Error | null) => void,
		) => {
			cb(null);
			return { kill: vi.fn() };
		},
	),
}));

import { execFile } from "node:child_process";

const mockExec = vi.mocked(execFile);

// ─── checkApiKey ──────────────────────────────────────────────────────────────

describe("checkApiKey", () => {
	it("apiKey 빈 문자열 → 항상 true (개발 모드)", () => {
		expect(checkApiKey(undefined, "")).toBe(true);
		expect(checkApiKey("", "")).toBe(true);
		expect(checkApiKey("wrong", "")).toBe(true);
	});

	it("올바른 Bearer 토큰 → true", () => {
		expect(checkApiKey("Bearer secret123", "secret123")).toBe(true);
	});

	it("토큰 없음 → false", () => {
		expect(checkApiKey(undefined, "secret123")).toBe(false);
	});

	it("잘못된 토큰 → false", () => {
		expect(checkApiKey("Bearer wrong", "secret123")).toBe(false);
	});

	it("Bearer 접두사 없음 → false", () => {
		expect(checkApiKey("secret123", "secret123")).toBe(false);
	});

	it("대소문자 구분 — 'bearer' 소문자 → false", () => {
		expect(checkApiKey("bearer secret123", "secret123")).toBe(false);
	});

	it("공백 포함 토큰 불일치 → false", () => {
		expect(checkApiKey("Bearer secret123 ", "secret123")).toBe(false);
	});
});

// ─── checkFfmpegAvailability ─────────────────────────────────────────────────

describe("checkFfmpegAvailability", () => {
	it("ffmpeg 성공 → available=true 콜백", async () => {
		mockExec.mockClear();
		const result = await new Promise<boolean>((resolve) => {
			checkFfmpegAvailability(resolve);
		});
		expect(result).toBe(true);
		expect(mockExec).toHaveBeenCalledWith(
			"ffmpeg",
			["-version"],
			{ timeout: 5_000 },
			expect.any(Function),
		);
	});

	it("ffmpeg 실패(에러) → available=false 콜백", async () => {
		mockExec.mockImplementationOnce(
			(
				_cmd: string,
				_args: string[],
				_opts: unknown,
				cb: (err: Error | null) => void,
			) => {
				cb(new Error("ffmpeg not found"));
				return { kill: vi.fn() };
			},
		);
		const result = await new Promise<boolean>((resolve) => {
			checkFfmpegAvailability(resolve);
		});
		expect(result).toBe(false);
	});
});
