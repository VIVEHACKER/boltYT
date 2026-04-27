/**
 * instagram.ts 단위 테스트
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	checkInstagramServer,
	getIgAuthStatus,
	revokeIgAuth,
	uploadToInstagram,
} from "./instagram";

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
afterEach(() => {
	mockStorage.clear();
	vi.restoreAllMocks();
});

function okFetch(body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve(body),
		}),
	);
	return fetch as unknown as ReturnType<typeof vi.fn>;
}

function failFetch(status: number, body?: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: false,
			status,
			json: () =>
				Promise.resolve(body ?? { error: { message: `HTTP ${status}` } }),
		}),
	);
}

// ─── checkInstagramServer ────────────────────────────────────────────────────
describe("checkInstagramServer", () => {
	it("서버 정상 → IgHealth 반환", async () => {
		okFetch({ ok: true, configured: true, authenticated: true });
		expect(await checkInstagramServer()).toEqual({
			ok: true,
			configured: true,
			authenticated: true,
		});
	});

	it("네트워크 오류 → { ok: false, ... }", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net fail")));
		expect(await checkInstagramServer()).toEqual({
			ok: false,
			configured: false,
			authenticated: false,
		});
	});

	it("localStorage instagram_server_url 사용", async () => {
		mockStorage.setItem("instagram_server_url", "http://custom:9999");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({ ok: true, configured: false, authenticated: false }),
		});
		vi.stubGlobal("fetch", fetchMock);
		await checkInstagramServer();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain("custom:9999");
	});

	it("localStorage undefined → 기본 서버 URL", async () => {
		vi.stubGlobal("localStorage", undefined);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({ ok: true, configured: false, authenticated: false }),
		});
		vi.stubGlobal("fetch", fetchMock);
		await checkInstagramServer();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain(
			"localhost:3462",
		);
		vi.stubGlobal("localStorage", mockStorage);
	});
});

// ─── getIgAuthStatus ──────────────────────────────────────────────────────────
describe("getIgAuthStatus", () => {
	it("인증됨 → authenticated: true", async () => {
		okFetch({
			authenticated: true,
			user: { igUserId: "123", username: "testuser" },
		});
		const status = await getIgAuthStatus();
		expect(status.authenticated).toBe(true);
	});

	it("미인증 → authenticated: false", async () => {
		okFetch({ authenticated: false, user: null });
		const status = await getIgAuthStatus();
		expect(status.authenticated).toBe(false);
	});
});

// ─── revokeIgAuth ─────────────────────────────────────────────────────────────
describe("revokeIgAuth", () => {
	it("POST /auth/revoke 호출", async () => {
		const fetchMock = okFetch({});
		await revokeIgAuth();
		expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe(
			"POST",
		);
	});
});

// ─── uploadToInstagram ────────────────────────────────────────────────────────
describe("uploadToInstagram", () => {
	it("성공 → IgUploadResult 반환", async () => {
		okFetch({ ok: true, mediaId: "ig-media-123" });
		const result = await uploadToInstagram({
			videoUrl: "https://example.com/video.mp4",
			caption: "테스트 영상",
		});
		expect(result.mediaId).toBe("ig-media-123");
	});

	it("실패 → error.message throw", async () => {
		failFetch(400, { error: { message: "업로드 실패" } });
		await expect(
			uploadToInstagram({
				videoUrl: "https://example.com/video.mp4",
				caption: "테스트",
			}),
		).rejects.toThrow("업로드 실패");
	});

	it("error.message 없으면 기본 메시지 throw", async () => {
		failFetch(500, { error: {} });
		await expect(
			uploadToInstagram({
				videoUrl: "https://example.com/v.mp4",
				caption: "테스트",
			}),
		).rejects.toThrow("Instagram 업로드 실패");
	});
});
