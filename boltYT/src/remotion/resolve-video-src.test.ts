import { describe, expect, it, vi } from "vitest";
import { resolveVideoSrc } from "./resolve-video-src";

describe("resolveVideoSrc", () => {
	const staticFile = vi.fn((p: string) => `/static/${p}`);

	it("빈 값 / null / undefined → 빈 문자열", () => {
		expect(resolveVideoSrc(null, staticFile)).toBe("");
		expect(resolveVideoSrc(undefined, staticFile)).toBe("");
		expect(resolveVideoSrc("", staticFile)).toBe("");
	});

	it("data:/http/blob: URL 은 그대로 반환 (staticFile 미호출)", () => {
		const sf = vi.fn((p: string) => `/static/${p}`);
		expect(resolveVideoSrc("data:video/mp4;base64,xxx", sf)).toBe(
			"data:video/mp4;base64,xxx",
		);
		expect(resolveVideoSrc("http://cdn/a.mp4", sf)).toBe("http://cdn/a.mp4");
		expect(resolveVideoSrc("https://cdn/a.mp4", sf)).toBe("https://cdn/a.mp4");
		expect(resolveVideoSrc("blob:http://localhost/abc", sf)).toBe(
			"blob:http://localhost/abc",
		);
		expect(sf).not.toHaveBeenCalled();
	});

	it("상대 경로는 staticFile 로 해소", () => {
		const sf = vi.fn((p: string) => `/static/${p}`);
		expect(resolveVideoSrc("media/clip.mp4", sf)).toBe(
			"/static/media/clip.mp4",
		);
		expect(sf).toHaveBeenCalledWith("media/clip.mp4");
	});

	it("render usage (기본) — proxyAvailable 있어도 원본 유지", () => {
		expect(
			resolveVideoSrc("/media/clip.mp4", staticFile, {
				usage: "render",
				proxyAvailable: true,
			}),
		).toBe("/static//media/clip.mp4");
	});

	it("preview usage + proxyAvailable=true → .proxy.mp4 URL 로 스왑", () => {
		const sf = vi.fn((p: string) => `/static/${p}`);
		expect(
			resolveVideoSrc("/media/clip.mp4", sf, {
				usage: "preview",
				proxyAvailable: true,
			}),
		).toBe("/static//media/clip.proxy.mp4");
	});

	it("preview usage + proxyAvailable=false → 원본 유지", () => {
		const sf = vi.fn((p: string) => `/static/${p}`);
		expect(
			resolveVideoSrc("/media/clip.mp4", sf, {
				usage: "preview",
				proxyAvailable: false,
			}),
		).toBe("/static//media/clip.mp4");
	});

	it("preview + proxyAvailable + 외부 http → proxyUrlFor 가 그대로 → staticFile 미호출 (http 분기)", () => {
		const sf = vi.fn((p: string) => `/static/${p}`);
		expect(
			resolveVideoSrc("https://cdn/x.mp4", sf, {
				usage: "preview",
				proxyAvailable: true,
			}),
		).toBe("https://cdn/x.mp4");
		expect(sf).not.toHaveBeenCalled();
	});
});
