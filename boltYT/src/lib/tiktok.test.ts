/**
 * tiktok.ts 단위 테스트
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	checkTikTokServer,
	getTikTokAuthStatus,
	revokeTikTokAuth,
	uploadToTikTok,
} from "./tiktok";

// ─── localStorage stub ────────────────────────────────────────────────────────
const _ls: Record<string, string> = {};
const mockStorage = {
	getItem: (k: string) => _ls[k] ?? null,
	setItem: (k: string, v: string) => { _ls[k] = v; },
	removeItem: (k: string) => { delete _ls[k]; },
	clear: () => { for (const k of Object.keys(_ls)) delete _ls[k]; },
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => {
	mockStorage.clear();
	vi.restoreAllMocks();
});

function okFetch(body: unknown) {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
	}));
	return fetch as unknown as ReturnType<typeof vi.fn>;
}

function failFetch(status: number, body?: unknown) {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
		ok: false,
		status,
		json: () => Promise.resolve(body ?? { error: { message: `HTTP ${status}` } }),
	}));
}

// ─── checkTikTokServer ────────────────────────────────────────────────────────
describe("checkTikTokServer", () => {
	it("서버 정상 → TikTokHealth 반환", async () => {
		okFetch({ ok: true, configured: true, authenticated: true });
		expect(await checkTikTokServer()).toEqual({
			ok: true,
			configured: true,
			authenticated: true,
		});
	});

	it("네트워크 오류 → { ok: false, ... }", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net fail")));
		expect(await checkTikTokServer()).toEqual({
			ok: false,
			configured: false,
			authenticated: false,
		});
	});

	it("localStorage tiktok_server_url 사용", async () => {
		mockStorage.setItem("tiktok_server_url", "http://custom:9998");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ ok: true, configured: false, authenticated: false }),
		});
		vi.stubGlobal("fetch", fetchMock);
		await checkTikTokServer();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain("custom:9998");
	});

	it("localStorage undefined → 기본 서버 URL", async () => {
		vi.stubGlobal("localStorage", undefined);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ ok: true, configured: false, authenticated: false }),
		});
		vi.stubGlobal("fetch", fetchMock);
		await checkTikTokServer();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain("localhost:3461");
		vi.stubGlobal("localStorage", mockStorage);
	});
});

// ─── getTikTokAuthStatus ──────────────────────────────────────────────────────
describe("getTikTokAuthStatus", () => {
	it("인증됨 → authenticated: true", async () => {
		okFetch({ authenticated: true, user: { openId: "tt-123", displayName: "유저", avatarUrl: "" } });
		const status = await getTikTokAuthStatus();
		expect(status.authenticated).toBe(true);
	});

	it("미인증 → authenticated: false", async () => {
		okFetch({ authenticated: false, user: null });
		expect((await getTikTokAuthStatus()).authenticated).toBe(false);
	});
});

// ─── revokeTikTokAuth ─────────────────────────────────────────────────────────
describe("revokeTikTokAuth", () => {
	it("POST /auth/revoke 호출", async () => {
		const fetchMock = okFetch({});
		await revokeTikTokAuth();
		expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("POST");
	});
});

// ─── uploadToTikTok ────────────────────────────────────────────────────────────
describe("uploadToTikTok", () => {
	it("성공 → TikTokUploadResult 반환", async () => {
		okFetch({ ok: true, publishId: "tt-pub-123" });
		const result = await uploadToTikTok({
			filePath: "/tmp/video.mp4",
			title: "테스트 영상",
		});
		expect(result.publishId).toBe("tt-pub-123");
	});

	it("실패 → error.message throw", async () => {
		failFetch(400, { error: { message: "TikTok 업로드 실패" } });
		await expect(uploadToTikTok({
			filePath: "/tmp/v.mp4",
			title: "테스트",
		})).rejects.toThrow("TikTok 업로드 실패");
	});

	it("error.message 없으면 기본 메시지 throw", async () => {
		failFetch(500, { error: {} });
		await expect(uploadToTikTok({
			filePath: "/tmp/v.mp4",
			title: "테스트",
		})).rejects.toThrow("TikTok 업로드 실패");
	});

	it("privacyLevel 지정 가능", async () => {
		const fetchMock = okFetch({ ok: true, publishId: "x" });
		await uploadToTikTok({
			filePath: "/tmp/v.mp4",
			title: "테스트",
			privacyLevel: "SELF_ONLY",
		});
		const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
		expect(body.privacyLevel).toBe("SELF_ONLY");
	});
});
