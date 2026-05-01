/**
 * fal-client.ts 단위 테스트
 *
 * - extractVideoUrl: 다양한 결과 형태에서 URL 추출 (순수)
 * - submitFalVideo: submit → poll → result 흐름 (fetch mock)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { __test, FAL_ENDPOINTS, submitFalVideo } from "./fal-client.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("FAL_ENDPOINTS", () => {
	it("5개 provider 정의", () => {
		expect(Object.keys(FAL_ENDPOINTS).sort()).toEqual([
			"hailuo",
			"kling3",
			"klingO1",
			"ltx2",
			"wan26",
		]);
	});

	it("모든 endpoint는 fal-ai/ prefix", () => {
		for (const ep of Object.values(FAL_ENDPOINTS)) {
			expect(ep).toMatch(/^fal-ai\//);
		}
	});
});

describe("extractVideoUrl", () => {
	const { extractVideoUrl } = __test;

	it("표준 형태 { video: { url } }", () => {
		expect(
			extractVideoUrl({ video: { url: "https://cdn/v.mp4", file_size: 100 } }),
		).toBe("https://cdn/v.mp4");
	});

	it("배열 형태 { videos: [{ url }] }", () => {
		expect(extractVideoUrl({ videos: [{ url: "https://cdn/a.mp4" }] })).toBe(
			"https://cdn/a.mp4",
		);
	});

	it("최상위 url fallback", () => {
		expect(extractVideoUrl({ url: "https://cdn/top.mp4" })).toBe(
			"https://cdn/top.mp4",
		);
	});

	it("URL 없으면 null", () => {
		expect(extractVideoUrl({ status: "ok" })).toBeNull();
		expect(extractVideoUrl({ video: {} })).toBeNull();
		expect(extractVideoUrl(null)).toBeNull();
		expect(extractVideoUrl("string")).toBeNull();
	});

	it("video.url 우선 (videos 배열보다)", () => {
		expect(
			extractVideoUrl({
				video: { url: "https://main.mp4" },
				videos: [{ url: "https://alt.mp4" }],
			}),
		).toBe("https://main.mp4");
	});
});

describe("submitFalVideo", () => {
	function makeRes(
		status: number,
		body: unknown,
		headers: Record<string, string> = {},
	): Response {
		return new Response(
			typeof body === "string" ? body : JSON.stringify(body),
			{
				status,
				headers: { "Content-Type": "application/json", ...headers },
			},
		);
	}

	it("apiKey 누락 시 throw", async () => {
		await expect(
			submitFalVideo({
				apiKey: "",
				provider: "wan26",
				input: { prompt: "x" },
			}),
		).rejects.toThrow(/FAL_KEY/);
	});

	it("unknown provider 시 throw", async () => {
		await expect(
			submitFalVideo({
				apiKey: "test-key",
				// @ts-expect-error unknown provider
				provider: "unknown",
				input: { prompt: "x" },
			}),
		).rejects.toThrow(/Unknown fal provider/);
	});

	it("성공: submit → IN_PROGRESS → COMPLETED → 결과 반환", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				makeRes(200, {
					request_id: "req-1",
					status_url: "https://queue.fal.run/x/requests/req-1/status",
					response_url: "https://queue.fal.run/x/requests/req-1",
				}),
			)
			.mockResolvedValueOnce(makeRes(200, { status: "IN_PROGRESS" }))
			.mockResolvedValueOnce(makeRes(200, { status: "COMPLETED" }))
			.mockResolvedValueOnce(
				makeRes(200, { video: { url: "https://fal.cdn/v.mp4" } }),
			);
		vi.stubGlobal("fetch", fetchMock);

		const result = await submitFalVideo({
			apiKey: "test-key",
			provider: "wan26",
			input: { prompt: "ocean", image_url: "https://x/img.png" },
			pollIntervalMs: 10,
			timeoutMs: 5000,
		});

		expect(result.video_url).toBe("https://fal.cdn/v.mp4");
		expect(result.request_id).toBe("req-1");
		expect(result.provider).toBe("wan26");
		expect(result.endpoint).toBe(FAL_ENDPOINTS.wan26);

		// submit 호출 검증 (Authorization header)
		const submitCall = fetchMock.mock.calls[0];
		const init = submitCall[1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Key test-key",
		);
	}, 10_000);

	it("FAILED status 시 throw with logs", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(makeRes(200, { request_id: "req-2" }))
			.mockResolvedValueOnce(
				makeRes(200, {
					status: "FAILED",
					logs: [{ message: "out of memory" }],
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			submitFalVideo({
				apiKey: "k",
				provider: "wan26",
				input: { prompt: "x" },
				pollIntervalMs: 10,
				timeoutMs: 2000,
			}),
		).rejects.toThrow(/FAILED.*out of memory/);
	}, 5000);

	it("submit 4xx 시 throw", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(makeRes(401, "unauthorized"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			submitFalVideo({
				apiKey: "k",
				provider: "wan26",
				input: { prompt: "x" },
				pollIntervalMs: 10,
				timeoutMs: 1000,
			}),
		).rejects.toThrow(/fal submit failed: 401/);
	});

	it("타임아웃 시 throw", async () => {
		// Response body는 한 번만 읽을 수 있으므로 매 호출마다 새 Response 생성
		let callCount = 0;
		const fetchMock = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) {
				return Promise.resolve(makeRes(200, { request_id: "req-3" }));
			}
			return Promise.resolve(makeRes(200, { status: "IN_PROGRESS" }));
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			submitFalVideo({
				apiKey: "k",
				provider: "wan26",
				input: { prompt: "x" },
				pollIntervalMs: 10,
				timeoutMs: 100,
			}),
		).rejects.toThrow(/timeout/);
	}, 5000);

	it("결과에 video URL 없으면 throw", async () => {
		// 매 호출마다 새 Response (body 한 번만 읽기 가능)
		let callCount = 0;
		const fetchMock = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1)
				return Promise.resolve(makeRes(200, { request_id: "req-4" }));
			if (callCount === 2)
				return Promise.resolve(makeRes(200, { status: "COMPLETED" }));
			return Promise.resolve(makeRes(200, { just: "no-video-here" }));
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			submitFalVideo({
				apiKey: "k",
				provider: "wan26",
				input: { prompt: "x" },
				pollIntervalMs: 10,
				timeoutMs: 2000,
			}),
		).rejects.toThrow(/no video URL/);
	}, 5000);
});
