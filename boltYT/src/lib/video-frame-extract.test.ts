/**
 * video-frame-extract 단위 테스트
 *
 * vitest node env. document 전역을 vi.stubGlobal 로 모킹.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __test, extractLastFrameDataUrl } from "./video-frame-extract";

interface ListenerStore {
	on: Map<string, Set<() => void>>;
	add(type: string, fn: () => void): void;
	remove(type: string, fn: () => void): void;
	emit(type: string): void;
}
const makeListenerStore = (): ListenerStore => {
	const map = new Map<string, Set<() => void>>();
	return {
		on: map,
		add(type, fn) {
			if (!map.has(type)) map.set(type, new Set());
			map.get(type)!.add(fn);
		},
		remove(type, fn) {
			map.get(type)?.delete(fn);
		},
		emit(type) {
			const fns = map.get(type);
			if (!fns) return;
			for (const fn of fns) fn();
		},
	};
};

const makeFakeVideo = (
	overrides: {
		duration?: number;
		videoWidth?: number;
		videoHeight?: number;
		failLoad?: boolean;
		failSeek?: boolean;
	} = {},
) => {
	const listeners = makeListenerStore();
	let _src = "";
	const video = {
		muted: false,
		playsInline: false,
		preload: "",
		crossOrigin: null as string | null,
		currentTime: 0,
		duration: overrides.duration ?? 5,
		videoWidth: overrides.videoWidth ?? 1280,
		videoHeight: overrides.videoHeight ?? 720,
		get src() {
			return _src;
		},
		set src(v: string) {
			_src = v;
			if (!v) return;
			queueMicrotask(() => {
				listeners.emit(overrides.failLoad ? "error" : "loadeddata");
			});
		},
		addEventListener(type: string, fn: () => void) {
			listeners.add(type, fn);
			if (type === "seeked") {
				queueMicrotask(() => {
					listeners.emit(overrides.failSeek ? "error" : "seeked");
				});
			}
		},
		removeEventListener(type: string, fn: () => void) {
			listeners.remove(type, fn);
		},
	};
	return video;
};

const makeFakeCanvas = (failToDataURL = false) => {
	const ctx = {
		drawImage: vi.fn(),
	};
	return {
		width: 0,
		height: 0,
		getContext: () => ctx,
		toDataURL: (mime?: string) => {
			if (failToDataURL)
				throw new Error("Tainted canvases may not be exported.");
			return `data:${mime ?? "image/jpeg"};base64,FAKE_BYTES`;
		},
	};
};

let videoOverrides: Parameters<typeof makeFakeVideo>[0] = {};
let canvasFailToDataURL = false;

beforeEach(() => {
	videoOverrides = {};
	canvasFailToDataURL = false;
	const fakeDocument = {
		createElement: (tag: string) => {
			if (tag === "video") return makeFakeVideo(videoOverrides);
			if (tag === "canvas") return makeFakeCanvas(canvasFailToDataURL);
			return {};
		},
	};
	vi.stubGlobal("document", fakeDocument);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("clamp01", () => {
	it("범위 내 값 그대로", () => {
		expect(__test.clamp01(0.5)).toBe(0.5);
	});
	it("1 초과 → 1", () => {
		expect(__test.clamp01(2)).toBe(1);
	});
	it("음수 → 0", () => {
		expect(__test.clamp01(-1)).toBe(0);
	});
	it("NaN → 0.92 (기본 quality fallback)", () => {
		expect(__test.clamp01(Number.NaN)).toBe(0.92);
	});
});

describe("extractLastFrameDataUrl", () => {
	it("빈 URL throw", async () => {
		await expect(extractLastFrameDataUrl("")).rejects.toThrow(/비어있음/);
	});

	it("정상 흐름: dataUrl + 해상도 반환", async () => {
		videoOverrides = { duration: 10, videoWidth: 1920, videoHeight: 1080 };
		const result = await extractLastFrameDataUrl("blob:test/abc");
		expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
		expect(result.width).toBe(1920);
		expect(result.height).toBe(1080);
		expect(result.durationSec).toBe(10);
		expect(result.mimeType).toBe("image/jpeg");
	});

	it("maxWidth 다운스케일 비율 유지", async () => {
		videoOverrides = { duration: 5, videoWidth: 1920, videoHeight: 1080 };
		const result = await extractLastFrameDataUrl("blob:x", { maxWidth: 960 });
		expect(result.width).toBe(960);
		expect(result.height).toBe(540);
	});

	it("png 옵션 → mime image/png", async () => {
		const result = await extractLastFrameDataUrl("blob:x", {
			mimeType: "image/png",
		});
		expect(result.mimeType).toBe("image/png");
		expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
	});

	it("로드 실패 시 throw", async () => {
		videoOverrides = { failLoad: true };
		await expect(extractLastFrameDataUrl("blob:bad")).rejects.toThrow(
			/비디오 로드 실패/,
		);
	});

	it("CORS taint 시 toDataURL 실패 → throw with 안내", async () => {
		canvasFailToDataURL = true;
		await expect(
			extractLastFrameDataUrl("https://external.example/v.mp4"),
		).rejects.toThrow(/CORS/);
	});

	it("DOM 없는 환경에서 throw", async () => {
		vi.unstubAllGlobals(); // document 제거
		await expect(extractLastFrameDataUrl("blob:abc")).rejects.toThrow(
			/DOM 환경/,
		);
	});
});
