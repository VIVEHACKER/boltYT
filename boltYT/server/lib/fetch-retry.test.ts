import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./fetch-retry";

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => vi.stubGlobal("fetch", mockFetch));
afterEach(() => {
	vi.restoreAllMocks();
	mockFetch.mockReset();
});

describe("fetchWithRetry", () => {
	it("첫 번째 시도 성공 → 즉시 반환", async () => {
		mockFetch.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const res = await fetchWithRetry("http://example.com");
		expect(res.status).toBe(200);
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("retryOn 미포함 에러 코드(404) → 재시도 없이 반환", async () => {
		mockFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
		const res = await fetchWithRetry("http://example.com");
		expect(res.status).toBe(404);
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("500 후 성공 → 2회 호출", async () => {
		vi.useFakeTimers();
		mockFetch
			.mockResolvedValueOnce(new Response("err", { status: 500 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const promise = fetchWithRetry("http://example.com", undefined, {
			retries: 2,
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(200);
		expect(mockFetch).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it("재시도 소진 후 마지막 503 응답 반환", async () => {
		vi.useFakeTimers();
		mockFetch.mockResolvedValue(new Response("err", { status: 503 }));
		const promise = fetchWithRetry("http://example.com", undefined, {
			retries: 1,
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(503);
		expect(mockFetch).toHaveBeenCalledTimes(2); // 초기 1 + 재시도 1
		vi.useRealTimers();
	});

	it("429 Retry-After 헤더 대기 후 재시도", async () => {
		vi.useFakeTimers();
		mockFetch
			.mockResolvedValueOnce(
				new Response("rate limited", {
					status: 429,
					headers: { "retry-after": "1" },
				}),
			)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const promise = fetchWithRetry("http://example.com", undefined, {
			retries: 1,
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(200);
		vi.useRealTimers();
	});

	it("AbortError(타임아웃) → 재시도 후 성공", async () => {
		vi.useFakeTimers();
		const abortErr = Object.assign(new Error("aborted"), {
			name: "AbortError",
		});
		mockFetch
			.mockRejectedValueOnce(abortErr)
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const promise = fetchWithRetry("http://example.com", undefined, {
			retries: 1,
			timeout: 100,
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(200);
		vi.useRealTimers();
	});

	it("네트워크 외 에러 → 재시도 없이 즉시 throw", async () => {
		mockFetch.mockRejectedValueOnce(new Error("JSON parse failed"));
		await expect(
			fetchWithRetry("http://example.com", undefined, { retries: 2 }),
		).rejects.toThrow("JSON parse failed");
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("사용자 정의 retryOn 목록 적용", async () => {
		vi.useFakeTimers();
		mockFetch
			.mockResolvedValueOnce(new Response("err", { status: 422 }))
			.mockResolvedValueOnce(new Response("ok", { status: 200 }));
		const promise = fetchWithRetry("http://example.com", undefined, {
			retries: 1,
			retryOn: [422],
		});
		await vi.runAllTimersAsync();
		const res = await promise;
		expect(res.status).toBe(200);
		vi.useRealTimers();
	});
});
