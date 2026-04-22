/**
 * resilient-fetch.ts 단위 테스트
 *
 * initialDelay:0 으로 setTimeout 지연 없이 빠른 재시도 검증.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { resilientFetch, resilientJson } from "./resilient-fetch";

afterEach(() => vi.restoreAllMocks());

// ─── resilientFetch ───────────────────────────────────────────────────────────
describe("resilientFetch", () => {
	it("첫 번째 시도 성공 → 응답 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200 }),
		);
		const res = await resilientFetch("https://api.example.com/data", {
			retry: { initialDelay: 0 },
		});
		expect(res.ok).toBe(true);
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
	});

	it("400 → 재시도 없이 즉시 반환 (4xx는 retryable 아님)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 400 }),
		);
		const res = await resilientFetch("https://api.example.com", {
			retry: { initialDelay: 0 },
		});
		expect(res.status).toBe(400);
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
	});

	it("404 → 재시도 없이 즉시 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 404 }),
		);
		await resilientFetch("https://api.example.com", {
			retry: { initialDelay: 0 },
		});
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
	});

	it("500 → maxRetries 횟수만큼 재시도 후 throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		await expect(
			resilientFetch("https://api.example.com", {
				retry: { maxRetries: 2, initialDelay: 0 },
			}),
		).rejects.toThrow("HTTP 500");
		// 첫 시도 + 2번 재시도 = 3번
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
	});

	it("429 → 재시도", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: false, status: 429 })
				.mockResolvedValueOnce({ ok: true, status: 200 }),
		);
		const res = await resilientFetch("https://api.example.com", {
			retry: { maxRetries: 1, initialDelay: 0 },
		});
		expect(res.ok).toBe(true);
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
	});

	it("네트워크 오류 → 재시도 후 throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Network error")),
		);
		await expect(
			resilientFetch("https://api.example.com", {
				retry: { maxRetries: 1, initialDelay: 0 },
			}),
		).rejects.toThrow("Network error");
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
	});

	it("네트워크 오류 후 성공 → 응답 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockRejectedValueOnce(new Error("timeout"))
				.mockResolvedValueOnce({ ok: true, status: 200 }),
		);
		const res = await resilientFetch("https://api.example.com", {
			retry: { maxRetries: 1, initialDelay: 0 },
		});
		expect(res.ok).toBe(true);
	});

	it("onRetry 콜백 호출", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: false, status: 503 })
				.mockResolvedValueOnce({ ok: true }),
		);
		const onRetry = vi.fn();
		await resilientFetch("https://api.example.com", {
			retry: { maxRetries: 1, initialDelay: 0, onRetry },
		});
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(
			1,
			expect.any(Error),
			expect.any(Number),
		);
	});

	it("maxRetries:0 → 재시도 없이 throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		await expect(
			resilientFetch("https://api.example.com", {
				retry: { maxRetries: 0, initialDelay: 0 },
			}),
		).rejects.toThrow();
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
	});
});

// ─── resilientJson ────────────────────────────────────────────────────────────
describe("resilientJson", () => {
	it("성공 → JSON 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ result: "ok" }),
			}),
		);
		const data = await resilientJson<{ result: string }>(
			"https://api.example.com/json",
		);
		expect(data.result).toBe("ok");
	});

	it("HTTP 오류 → throw with status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				text: () => Promise.resolve("Forbidden"),
			}),
		);
		await expect(
			resilientJson("https://api.example.com/json", {
				retry: { maxRetries: 0 },
			}),
		).rejects.toThrow("403");
	});
});
