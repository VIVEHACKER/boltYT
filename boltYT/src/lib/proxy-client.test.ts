import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestProxyBuild, shouldUseProxy } from "./proxy-client";

const originalFetch = globalThis.fetch;

function mockFetch(
	response: { status: number; body: unknown } | { reject: unknown },
) {
	globalThis.fetch = vi.fn(async () => {
		if ("reject" in response) throw response.reject;
		return new Response(JSON.stringify(response.body), {
			status: response.status,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
}

describe("requestProxyBuild", () => {
	beforeEach(() => {
		// each test mocks its own
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("200 alreadyExists=true → ok + alreadyExists", async () => {
		mockFetch({
			status: 200,
			body: { ok: true, proxyPath: "/a/b.proxy.mp4", alreadyExists: true },
		});
		const r = await requestProxyBuild("/a/b.mp4");
		expect(r.ok).toBe(true);
		expect(r.alreadyExists).toBe(true);
		expect(r.proxyPath).toBe("/a/b.proxy.mp4");
	});

	it("202 queued=true → ok + queued", async () => {
		mockFetch({
			status: 202,
			body: { ok: true, proxyPath: "/a/b.proxy.mp4", queued: true },
		});
		const r = await requestProxyBuild("/a/b.mp4");
		expect(r.ok).toBe(true);
		expect(r.queued).toBe(true);
	});

	it("403 allowlist 거부 → ok=false + error", async () => {
		mockFetch({
			status: 403,
			body: { error: "path outside allowed roots" },
		});
		const r = await requestProxyBuild("/etc/passwd");
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/allowed/);
	});

	it("네트워크 실패 → ok=false + error message", async () => {
		mockFetch({ reject: new Error("ECONNREFUSED") });
		const r = await requestProxyBuild("/a/b.mp4");
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/ECONNREFUSED/);
	});
});

describe("shouldUseProxy", () => {
	it("alreadyExists=true 만 true", () => {
		expect(shouldUseProxy({ ok: true, alreadyExists: true })).toBe(true);
		expect(shouldUseProxy({ ok: true, queued: true })).toBe(false);
		expect(shouldUseProxy({ ok: false, error: "x" })).toBe(false);
		expect(shouldUseProxy({ ok: true })).toBe(false);
	});
});
