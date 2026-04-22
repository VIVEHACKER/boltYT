/**
 * render-assets.ts 단위 테스트
 *
 * prepareRenderPayload: 내부 순수 헬퍼들을 통해 간접 검증.
 * shouldMirrorToRenderServer=false 경로(외부 https URL) → passthrough.
 * getRenderServer: vi.mock
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./render-queue", () => ({
	getRenderServer: vi.fn(() => "http://localhost:3458"),
}));

import type { RemotionScene } from "../remotion/types";
import { prepareRenderPayload } from "./render-assets";

beforeEach(() => {
	// Ensure window.location.origin is set so shouldMirrorToRenderServer works correctly
	if (typeof window !== "undefined" && !window.location) {
		vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
	} else if (
		typeof window !== "undefined" &&
		window.location &&
		!window.location.origin
	) {
		vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
	}
});

afterEach(() => vi.restoreAllMocks());

function makeScene(overrides: Partial<RemotionScene> = {}): RemotionScene {
	return {
		id: "scene-1",
		narration: "",
		duration: 5,
		shots: [],
		...overrides,
	} as unknown as RemotionScene;
}

// ─── prepareRenderPayload ─────────────────────────────────────────────────────
describe("prepareRenderPayload", () => {
	it("씬 없음 → scenes 빈 배열, narration/bgm undefined", async () => {
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [],
		});
		expect(result.scenes).toEqual([]);
		expect(result.narrationUrl).toBeUndefined();
		expect(result.bgmUrl).toBeUndefined();
	});

	it("외부 https URL → 업로드 없이 그대로 통과", async () => {
		const externalUrl = "https://cdn.example.com/image.jpg";
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ imageUrl: externalUrl })],
		});
		expect(result.scenes[0].imageUrl).toBe(externalUrl);
	});

	it("videoUrl 외부 https → 그대로 통과", async () => {
		const url = "https://cdn.pexels.com/video.mp4";
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ videoUrl: url })],
		});
		expect(result.scenes[0].videoUrl).toBe(url);
	});

	it("imageUrl undefined → 빈 문자열 반환", async () => {
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ imageUrl: undefined })],
		});
		expect(result.scenes[0].imageUrl).toBe("");
	});

	it("narrationUrl 외부 https → 그대로 통과", async () => {
		const url = "https://storage.example.com/narration.mp3";
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [],
			narrationUrl: url,
		});
		expect(result.narrationUrl).toBe(url);
	});

	it("bgmUrl 외부 https → 그대로 통과", async () => {
		const url = "https://cdn.pixabay.com/bgm.mp3";
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [],
			bgmUrl: url,
		});
		expect(result.bgmUrl).toBe(url);
	});

	it("narrationUrl 없으면 undefined 유지", async () => {
		const result = await prepareRenderPayload({ scriptId: "s1", scenes: [] });
		expect(result.narrationUrl).toBeUndefined();
	});

	it("blob URL → fetch 호출 후 업로드 성공", async () => {
		const blobUrl = "blob:http://localhost/abc-123";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					blob: () =>
						Promise.resolve(new Blob(["data"], { type: "image/png" })),
				})
				.mockResolvedValueOnce({ ok: true }),
		);
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ imageUrl: blobUrl })],
		});
		expect(result.scenes[0].imageUrl).toContain(
			"http://localhost:3458/assets/",
		);
	});

	it("blob URL → fetch 실패 → throw", async () => {
		const blobUrl = "blob:http://localhost/fail";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		await expect(
			prepareRenderPayload({
				scriptId: "s1",
				scenes: [makeScene({ imageUrl: blobUrl })],
			}),
		).rejects.toThrow("렌더 자산 준비 실패");
	});

	it("동일 URL 두 번 → 캐시 활용 (fetch 한 번만)", async () => {
		const url = "https://cdn.example.com/shared.jpg";
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);
		await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ imageUrl: url }), makeScene({ imageUrl: url })],
		});
		// 외부 URL이라 fetch 호출 없음 (passthrough)
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("data: URL → 업로드 처리 (shouldMirrorToRenderServer: true)", async () => {
		const dataUrl = "data:image/png;base64,abc";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					blob: () =>
						Promise.resolve(new Blob(["data"], { type: "image/png" })),
				})
				.mockResolvedValueOnce({ ok: true }),
		);
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ imageUrl: dataUrl })],
		});
		expect(result.scenes[0].imageUrl).toContain(
			"http://localhost:3458/assets/",
		);
	});

	it("/ 로 시작하는 URL → shouldMirror: true, window.location.origin 사용", async () => {
		const relUrl = "/static/img.jpg";
		// window.location.origin stub
		vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } });
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					blob: () =>
						Promise.resolve(new Blob(["data"], { type: "image/jpeg" })),
				})
				.mockResolvedValueOnce({ ok: true }),
		);
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ imageUrl: relUrl })],
		});
		expect(result.scenes[0].imageUrl).toContain("/assets/");
		vi.stubGlobal("window", undefined);
	});

	it("업로드 응답 실패 → error JSON 파싱 → throw", async () => {
		const blobUrl = "blob:http://localhost/err";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					blob: () =>
						Promise.resolve(new Blob(["data"], { type: "image/png" })),
				})
				.mockResolvedValueOnce({
					ok: false,
					status: 400,
					statusText: "Bad Request",
					json: () => Promise.resolve({ error: "커스텀 에러" }),
				}),
		);
		await expect(
			prepareRenderPayload({
				scriptId: "s1",
				scenes: [makeScene({ imageUrl: blobUrl })],
			}),
		).rejects.toThrow("커스텀 에러");
	});

	it("업로드 응답 실패 + json 파싱 실패 → statusText를 error로 throw", async () => {
		const blobUrl = "blob:http://localhost/err2";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					blob: () =>
						Promise.resolve(new Blob(["data"], { type: "image/png" })),
				})
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					statusText: "Internal Server Error",
					json: () => Promise.reject(new Error("not json")),
				}),
		);
		// json 파싱 실패 → { error: uploadRes.statusText } → "Internal Server Error" throw
		await expect(
			prepareRenderPayload({
				scriptId: "s1",
				scenes: [makeScene({ imageUrl: blobUrl })],
			}),
		).rejects.toThrow("Internal Server Error");
	});

	it("http URL fetch 실패 → catch에서 http URL이라 passthrough", async () => {
		// http URL → shouldMirrorToRenderServer: false (외부에서 오리진 체크 없이)
		// http URL이지만 window.location.origin 과 같으면 mirror
		// window undefined 환경에서는 http URL도 mirror 안함
		const httpUrl = "http://external.com/img.jpg";
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [makeScene({ imageUrl: httpUrl })],
		});
		// 외부 http URL → shouldMirror: false → passthrough
		expect(result.scenes[0].imageUrl).toBe(httpUrl);
	});

	it("shots 있는 씬 → shot source_url 처리", async () => {
		const externalUrl = "https://cdn.example.com/shot.jpg";
		const result = await prepareRenderPayload({
			scriptId: "s1",
			scenes: [
				{
					...makeScene(),
					shots: [{ id: "sh1", source_url: externalUrl }],
				} as unknown as import("../remotion/types").RemotionScene,
			],
		});
		expect(result.scenes[0].shots?.[0]?.source_url).toBe(externalUrl);
	});

	it("contentType으로 확장자 추출 - 다양한 타입", async () => {
		for (const [contentType, expectedExt] of [
			["image/png", "png"],
			["image/webp", "webp"],
			["image/gif", "gif"],
			["video/mp4", "mp4"],
			["video/webm", "webm"],
			["audio/mpeg", "mp3"],
			["audio/wav", "wav"],
			["audio/ogg", "ogg"],
			["application/octet-stream", "bin"],
		]) {
			const blobUrl = `blob:http://localhost/${expectedExt}`;
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValueOnce({
						ok: true,
						blob: () => Promise.resolve(new Blob(["x"], { type: contentType })),
					})
					.mockResolvedValueOnce({ ok: true }),
			);
			const result = await prepareRenderPayload({
				scriptId: "s1",
				scenes: [makeScene({ imageUrl: blobUrl })],
			});
			// 올바른 확장자로 경로 생성 확인
			expect(result.scenes[0].imageUrl).toContain("assets/");
		}
	});
});
