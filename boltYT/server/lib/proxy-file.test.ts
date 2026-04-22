import { describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn<(p: string) => boolean>());
const mockStatSync = vi.hoisted(() => vi.fn<(p: string) => { size: number }>());
vi.mock("node:fs", () => ({
	existsSync: mockExistsSync,
	statSync: mockStatSync,
}));

import {
	buildProxyArgs,
	hasValidProxy,
	isPathInAllowedRoots,
	proxyPathFor,
} from "./proxy-file.ts";

describe("proxy-file", () => {
	it("proxyPathFor — 확장자 치환 + 같은 디렉토리", () => {
		expect(proxyPathFor("/tmp/clips/input.mp4")).toBe(
			"/tmp/clips/input.proxy.mp4",
		);
		expect(proxyPathFor("/tmp/clips/input.mov")).toBe(
			"/tmp/clips/input.proxy.mp4",
		);
		expect(proxyPathFor("/a/b/long.name.with.dots.mp4")).toBe(
			"/a/b/long.name.with.dots.proxy.mp4",
		);
	});

	it("buildProxyArgs — 기본 인자", () => {
		const args = buildProxyArgs("/in.mp4", "/out.mp4");
		expect(args[0]).toBe("-y");
		expect(args).toContain("-i");
		expect(args.indexOf("/in.mp4")).toBe(args.indexOf("-i") + 1);
		expect(args[args.length - 1]).toBe("/out.mp4");
		expect(args).toContain("libx264");
		expect(args).toContain("veryfast");
		expect(args).toContain("30");
		expect(args.some((a) => a.includes("scale=-2:'min(720,ih)'"))).toBe(true);
	});

	it("buildProxyArgs — mute=true 는 -an", () => {
		const args = buildProxyArgs("/i.mp4", "/o.mp4", { mute: true });
		expect(args).toContain("-an");
		expect(args).not.toContain("aac");
	});

	it("buildProxyArgs — 커스텀 height/crf/preset 반영", () => {
		const args = buildProxyArgs("/i.mp4", "/o.mp4", {
			height: 540,
			crf: 28,
			preset: "fast",
		});
		expect(args.some((a) => a.includes("scale=-2:'min(540,ih)'"))).toBe(true);
		expect(args).toContain("28");
		expect(args).toContain("fast");
	});

	it("buildProxyArgs — yuv420p + faststart 고정 (플레이어 호환성)", () => {
		const args = buildProxyArgs("/i.mp4", "/o.mp4");
		expect(args).toContain("yuv420p");
		expect(args).toContain("+faststart");
	});

	it("hasValidProxy — 파일 없으면 false", () => {
		mockExistsSync.mockReturnValue(false);
		expect(hasValidProxy("/tmp/clip.mp4")).toBe(false);
	});

	it("hasValidProxy — 파일 있고 size > 0 이면 true", () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockReturnValue({ size: 1024 });
		expect(hasValidProxy("/tmp/clip.mp4")).toBe(true);
	});

	it("hasValidProxy — statSync 예외 → false", () => {
		mockExistsSync.mockReturnValue(true);
		mockStatSync.mockImplementation(() => { throw new Error("EACCES"); });
		expect(hasValidProxy("/tmp/clip.mp4")).toBe(false);
	});

	it("isPathInAllowedRoots — 정확한 경계 (prefix 우회 차단)", () => {
		const roots = ["/app/renders", "/app/tmp"];
		expect(isPathInAllowedRoots("/app/renders/a.mp4", roots)).toBe(true);
		expect(isPathInAllowedRoots("/app/renders", roots)).toBe(true);
		expect(isPathInAllowedRoots("/app/tmp/sub/b.mp4", roots)).toBe(true);
		// prefix 로 같지만 직계 하위 아님
		expect(isPathInAllowedRoots("/app/rendersEXTRA/x.mp4", roots)).toBe(false);
		expect(isPathInAllowedRoots("/other/renders/a.mp4", roots)).toBe(false);
		expect(isPathInAllowedRoots("/app", roots)).toBe(false);
	});
});
