import { describe, expect, it } from "vitest";
import { isLocalMediaUrl, pickPreviewSource, proxyUrlFor } from "./proxy-media";

describe("proxy-media", () => {
	it("isLocalMediaUrl — 로컬/외부 구분", () => {
		expect(isLocalMediaUrl("/media/clip.mp4")).toBe(true);
		expect(isLocalMediaUrl("/renders/abc-shorts.mp4")).toBe(true);
		expect(isLocalMediaUrl("blob:http://localhost/abc")).toBe(true);
		expect(isLocalMediaUrl("https://cdn.example.com/x.mp4")).toBe(false);
	});

	it("proxyUrlFor — 로컬 경로는 .proxy.mp4 치환", () => {
		expect(proxyUrlFor("/media/clip.mp4")).toBe("/media/clip.proxy.mp4");
		expect(proxyUrlFor("/media/clip.mov")).toBe("/media/clip.proxy.mp4");
		expect(proxyUrlFor("/renders/a-shorts.mp4?t=1")).toBe(
			"/renders/a-shorts.proxy.mp4?t=1",
		);
	});

	it("proxyUrlFor — 외부 URL 은 그대로", () => {
		expect(proxyUrlFor("https://cdn.example.com/x.mp4")).toBe(
			"https://cdn.example.com/x.mp4",
		);
	});

	it("proxyUrlFor — 확장자 없는 경로 → suffix 부여", () => {
		expect(proxyUrlFor("/media/stream")).toBe("/media/stream.proxy.mp4");
	});

	it("pickPreviewSource — render 는 항상 원본", () => {
		expect(pickPreviewSource("/media/x.mp4", true, "render")).toBe(
			"/media/x.mp4",
		);
	});

	it("pickPreviewSource — preview + 프록시 있음 → 프록시", () => {
		expect(pickPreviewSource("/media/x.mp4", true, "preview")).toBe(
			"/media/x.proxy.mp4",
		);
	});

	it("pickPreviewSource — preview + 프록시 없음 → 원본 fallback", () => {
		expect(pickPreviewSource("/media/x.mp4", false, "preview")).toBe(
			"/media/x.mp4",
		);
	});
});
