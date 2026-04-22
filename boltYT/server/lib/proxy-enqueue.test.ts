import { afterEach, describe, expect, it, vi } from "vitest";
import { enqueueProxyBuild } from "./proxy-enqueue";

const originalFetch = globalThis.fetch;

function mockFetch(response: { status: number } | { reject: unknown }) {
	globalThis.fetch = vi.fn(async () => {
		if ("reject" in response) throw response.reject;
		return new Response("{}", {
			status: response.status,
			headers: { "Content-Type": "application/json" },
		});
	}) as typeof fetch;
}

describe("enqueueProxyBuild", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("200 → ok true", async () => {
		mockFetch({ status: 200 });
		const r = await enqueueProxyBuild("/a/b.mp4");
		expect(r.ok).toBe(true);
		expect(r.status).toBe(200);
	});

	it("202 queued → ok true (res.ok 는 2xx 전부)", async () => {
		mockFetch({ status: 202 });
		const r = await enqueueProxyBuild("/a/b.mp4");
		expect(r.ok).toBe(true);
		expect(r.status).toBe(202);
	});

	it("403 → ok false", async () => {
		mockFetch({ status: 403 });
		const r = await enqueueProxyBuild("/etc/passwd");
		expect(r.ok).toBe(false);
		expect(r.status).toBe(403);
	});

	it("네트워크 실패 → ok false + error", async () => {
		mockFetch({ reject: new Error("ECONNREFUSED") });
		const r = await enqueueProxyBuild("/a/b.mp4");
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/ECONNREFUSED/);
	});
});
