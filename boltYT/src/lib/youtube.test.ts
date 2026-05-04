/**
 * youtube.ts 단위 테스트
 *
 * 모든 함수가 외부 HTTP 서버(3457)에 의존하므로 fetch를 vi.stubGlobal로 대체한다.
 * openAuthPopup은 window.open/addEventListener 의존 → 제외.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	checkYouTubeServer,
	getAuthStatus,
	getAuthUrl,
	getChannelVideos,
	getDeepVideoAnalytics,
	getVideoAnalytics,
	getVideoComments,
	openAuthPopup,
	revokeAuth,
	scheduleVideo,
	uploadVideo,
} from "./youtube";

// ─── localStorage stub ────────────────────────────────────────────────────────
const _ls: Record<string, string> = {};
const mockStorage = {
	getItem: (k: string) => _ls[k] ?? null,
	setItem: (k: string, v: string) => {
		_ls[k] = v;
	},
	removeItem: (k: string) => {
		delete _ls[k];
	},
	clear: () => {
		for (const k of Object.keys(_ls)) delete _ls[k];
	},
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => mockStorage.clear());

// ─── fetch stub helpers ───────────────────────────────────────────────────────
function okFetch(body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			json: () => Promise.resolve(body),
		}),
	);
	return fetch as unknown as ReturnType<typeof vi.fn>;
}

function failFetch(status: number, errBody?: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: false,
			status,
			statusText: "Error",
			json: () => Promise.resolve(errBody ?? { error: `HTTP ${status}` }),
		}),
	);
}

function networkErrorFetch(msg = "network error") {
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(msg)));
}

// ─── checkYouTubeServer ───────────────────────────────────────────────────────
describe("checkYouTubeServer", () => {
	it("서버 정상 → HealthResponse 반환", async () => {
		okFetch({ ok: true, configured: true, authenticated: true });
		expect(await checkYouTubeServer()).toEqual({
			ok: true,
			configured: true,
			authenticated: true,
		});
	});

	it("네트워크 오류 → { ok: false, configured: false, authenticated: false }", async () => {
		networkErrorFetch();
		expect(await checkYouTubeServer()).toEqual({
			ok: false,
			configured: false,
			authenticated: false,
		});
	});

	it("HTTP 500 → { ok: false, ... }", async () => {
		failFetch(500);
		expect(await checkYouTubeServer()).toEqual({
			ok: false,
			configured: false,
			authenticated: false,
		});
	});

	it("localStorage youtube_server_url 사용", async () => {
		mockStorage.setItem("youtube_server_url", "http://custom:9999");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({ ok: true, configured: false, authenticated: false }),
		});
		vi.stubGlobal("fetch", fetchMock);
		await checkYouTubeServer();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
			"http://custom:9999/health",
		);
	});
});

// ─── getAuthUrl ───────────────────────────────────────────────────────────────
describe("getAuthUrl", () => {
	it("url 필드 반환", async () => {
		okFetch({ url: "https://accounts.google.com/o/oauth2/auth?scope=..." });
		const url = await getAuthUrl();
		expect(url).toContain("https://accounts.google.com");
	});

	it("서버 오류 → 예외 throw", async () => {
		failFetch(401, { error: "Unauthorized" });
		await expect(getAuthUrl()).rejects.toThrow();
	});
});

// ─── getAuthStatus ────────────────────────────────────────────────────────────
describe("getAuthStatus", () => {
	it("인증됨 → authenticated: true + channel 정보", async () => {
		const status = {
			authenticated: true,
			channel: { id: "UC123", title: "My Channel", thumbnail: "https://img" },
		};
		okFetch(status);
		expect(await getAuthStatus()).toEqual(status);
	});

	it("미인증 → authenticated: false", async () => {
		okFetch({ authenticated: false, channel: null });
		const r = await getAuthStatus();
		expect(r.authenticated).toBe(false);
	});
});

// ─── revokeAuth ───────────────────────────────────────────────────────────────
describe("revokeAuth", () => {
	it("POST /auth/revoke 호출 후 undefined 반환", async () => {
		const fetchMock = okFetch({});
		await expect(revokeAuth()).resolves.toBeUndefined();
		const call = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(call[0]).toContain("/auth/revoke");
		expect(call[1].method).toBe("POST");
	});
});

// ─── uploadVideo ──────────────────────────────────────────────────────────────
describe("uploadVideo", () => {
	it("성공 → UploadResult 반환", async () => {
		const result = {
			ok: true,
			videoId: "abc123",
			url: "https://youtu.be/abc123",
		};
		okFetch(result);
		expect(
			await uploadVideo({
				filePath: "/tmp/video.mp4",
				title: "테스트",
				description: "설명",
				tags: ["test"],
				privacyStatus: "unlisted",
			}),
		).toEqual(result);
	});

	it("privacyStatus 미전달 → 기본값 'private'", async () => {
		const fetchMock = okFetch({ ok: true, videoId: "x", url: "" });
		await uploadVideo({
			filePath: "/f.mp4",
			title: "T",
			description: "D",
			tags: [],
		});
		const call = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
		expect(body.privacyStatus).toBe("private");
	});

	it("tags 배열 → 콤마 구분 문자열", async () => {
		const fetchMock = okFetch({ ok: true, videoId: "y", url: "" });
		await uploadVideo({
			filePath: "/f.mp4",
			title: "T",
			description: "D",
			tags: ["a", "b", "c"],
		});
		const call = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
		expect(body.tags).toBe("a,b,c");
	});

	it("thumbnailDataUrl 전달 시 업로드 요청 본문에 포함", async () => {
		const fetchMock = okFetch({
			ok: true,
			videoId: "thumb",
			url: "",
			thumbnailSet: true,
		});
		await uploadVideo({
			filePath: "/f.mp4",
			title: "T",
			description: "D",
			tags: [],
			thumbnailDataUrl: "data:image/jpeg;base64,abc",
		});
		const call = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
		expect(body.thumbnailDataUrl).toBe("data:image/jpeg;base64,abc");
	});

	it("서버 오류 → 예외 throw", async () => {
		failFetch(500);
		await expect(
			uploadVideo({
				filePath: "/f.mp4",
				title: "T",
				description: "D",
				tags: [],
			}),
		).rejects.toThrow();
	});
});

// ─── scheduleVideo ────────────────────────────────────────────────────────────
describe("scheduleVideo", () => {
	it("POST /upload/schedule — videoId·scheduledAt 전송", async () => {
		const fetchMock = okFetch({});
		await scheduleVideo("vid-001", "2026-05-01T10:00:00Z");
		const call = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(call[0]).toContain("/upload/schedule");
		const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
		expect(body).toEqual({
			videoId: "vid-001",
			scheduledAt: "2026-05-01T10:00:00Z",
		});
	});
});

// ─── getVideoAnalytics ────────────────────────────────────────────────────────
describe("getVideoAnalytics", () => {
	it("videoId 포함 URL 호출 → 분석 데이터 반환", async () => {
		const analytics = {
			videoId: "vid-1",
			title: "제목",
			views: 1000,
			likes: 50,
			comments: 10,
			favorites: 5,
		};
		const fetchMock = okFetch(analytics);
		expect(await getVideoAnalytics("vid-1")).toEqual(analytics);
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain(
			"/analytics/vid-1",
		);
	});
});

describe("getDeepVideoAnalytics", () => {
	it("days 쿼리와 함께 심화 분석 엔드포인트 호출", async () => {
		const analytics = {
			videoId: "vid-1",
			title: "제목",
			views: 1000,
			likes: 50,
			comments: 10,
			favorites: 0,
			averageViewDuration: 42,
			averageViewPercentage: 58,
			trafficSources: [{ source: "YT_SEARCH", views: 120 }],
			retentionCurve: [{ elapsedVideoTimeRatio: 0.2, audienceWatchRatio: 0.7 }],
			warnings: ["impressions metric unavailable"],
		};
		const fetchMock = okFetch(analytics);
		expect(await getDeepVideoAnalytics("vid-1", 14)).toEqual(analytics);
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain(
			"/analytics/deep/vid-1?days=14",
		);
	});
});

describe("getVideoComments", () => {
	it("댓글 엔드포인트를 maxResults와 함께 호출", async () => {
		const payload = {
			videoId: "vid-1",
			comments: [
				{
					id: "c1",
					videoId: "vid-1",
					author: "A",
					text: "왜 그런가요?",
					likeCount: 3,
					publishedAt: "2026-05-01T00:00:00Z",
				},
			],
		};
		const fetchMock = okFetch(payload);
		expect(await getVideoComments("vid-1", 25)).toEqual(payload);
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain(
			"/comments/vid-1?maxResults=25",
		);
	});
});

// ─── getChannelVideos ─────────────────────────────────────────────────────────
describe("getChannelVideos", () => {
	it("videos 배열 반환", async () => {
		const videos = [
			{
				videoId: "v1",
				title: "영상 1",
				thumbnail: "https://t1",
				publishedAt: "2026-01-01",
			},
			{
				videoId: "v2",
				title: "영상 2",
				thumbnail: "https://t2",
				publishedAt: "2026-01-02",
			},
		];
		okFetch({ videos });
		expect(await getChannelVideos()).toEqual(videos);
	});

	it("빈 채널 → 빈 배열", async () => {
		okFetch({ videos: [] });
		expect(await getChannelVideos()).toEqual([]);
	});
});

// ─── openAuthPopup (error path) ───────────────────────────────────────────────
describe("openAuthPopup", () => {
	it("getAuthUrl 실패(네트워크 오류) → false 반환", async () => {
		networkErrorFetch();
		const result = await openAuthPopup();
		expect(result).toBe(false);
	});

	it("getAuthUrl 실패(HTTP 오류) → false 반환", async () => {
		failFetch(500);
		const result = await openAuthPopup();
		expect(result).toBe(false);
	});

	it("localStorage undefined → 기본 서버 URL 사용", async () => {
		vi.stubGlobal("localStorage", undefined);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({ ok: true, configured: true, authenticated: false }),
		});
		vi.stubGlobal("fetch", fetchMock);
		await checkYouTubeServer();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain(
			"localhost:3457",
		);
		vi.stubGlobal("localStorage", mockStorage);
	});

	it("팝업 열린 후 auth-success 메시지 → true 반환", async () => {
		// 첫 번째 fetch: getAuthUrl 성공
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({ url: "https://accounts.google.com/auth" }),
			}),
		);

		const eventHandlers: Record<string, ((e: MessageEvent) => void)[]> = {};
		const mockPopup = { closed: false };

		vi.stubGlobal("window", {
			location: { origin: "http://localhost:5173" },
			open: () => mockPopup,
			addEventListener: (event: string, cb: (e: MessageEvent) => void) => {
				(eventHandlers[event] ??= []).push(cb);
			},
			removeEventListener: () => {},
		});
		vi.stubGlobal("setInterval", (_cb: () => void) => {
			// do not fire automatically
			return 999;
		});
		vi.stubGlobal("clearInterval", () => {});

		const popupPromise = openAuthPopup();

		// 다음 tick에서 메시지 전달
		await new Promise((r) => setTimeout(r, 0));
		const handlers = eventHandlers["message"] ?? [];
		for (const h of handlers) {
			h(
				new MessageEvent("message", {
					origin: "http://localhost:5173",
					data: { type: "youtube-auth-success" },
				}),
			);
		}

		const result = await popupPromise;
		expect(result).toBe(true);

		vi.stubGlobal("window", undefined);
		vi.stubGlobal("setInterval", undefined);
		vi.stubGlobal("clearInterval", undefined);
	}, 10000);

	it("팝업 닫힘 → getAuthStatus 호출 → authenticated: false 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ url: "https://auth.google.com" }),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () => Promise.resolve({ authenticated: false }),
				}),
		);

		const mockPopup = { closed: false };
		let intervalCb: (() => void) | null = null;

		vi.stubGlobal("window", {
			location: { origin: "http://localhost:5173" },
			open: () => mockPopup,
			addEventListener: () => {},
			removeEventListener: () => {},
		});
		vi.stubGlobal("setInterval", (cb: () => void) => {
			intervalCb = cb;
			return 42;
		});
		vi.stubGlobal("clearInterval", () => {});

		const popupPromise = openAuthPopup();

		await new Promise((r) => setTimeout(r, 0));
		mockPopup.closed = true;
		if (intervalCb) (intervalCb as () => void)();

		const result = await popupPromise;
		expect(result).toBe(false);

		vi.stubGlobal("window", undefined);
		vi.stubGlobal("setInterval", undefined);
		vi.stubGlobal("clearInterval", undefined);
	});

	it("fetchYT 에러 응답에 error 필드 없으면 HTTP status 코드 throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 403,
				statusText: "Forbidden",
				json: () => Promise.resolve({}), // error 필드 없음
			}),
		);
		await expect(getAuthUrl()).rejects.toThrow("HTTP 403");
	});

	it("fetchYT 에러 응답 json 파싱 실패 → statusText throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Server Error",
				json: () => Promise.reject(new Error("not json")),
			}),
		);
		await expect(getAuthUrl()).rejects.toThrow("Server Error");
	});
});
