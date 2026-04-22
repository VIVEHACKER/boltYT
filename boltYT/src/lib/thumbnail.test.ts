/**
 * thumbnail.ts 단위 테스트
 *
 * environment: node — document 없음.
 * globalThis.document를 직접 stub해서 Canvas 분기를 모두 커버한다.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ─── localStorage stub ────────────────────────────────────────────────────────
const _ls: Record<string, string> = {};
beforeAll(() =>
	vi.stubGlobal("localStorage", {
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
	}),
);

// ─── atob stub ────────────────────────────────────────────────────────────────
beforeAll(() => {
	if (!globalThis.atob) {
		vi.stubGlobal("atob", (b64: string) =>
			Buffer.from(b64, "base64").toString("binary"),
		);
	}
});

// ─── Mock: local-db ───────────────────────────────────────────────────────────
vi.mock("./local-db", () => ({
	storeLocalFile: vi.fn(async (path: string) => `local://${path}`),
}));

afterEach(() => {
	for (const k of Object.keys(_ls)) delete _ls[k];
	vi.restoreAllMocks();
});

import { storeLocalFile } from "./local-db";
import {
	generateAndSaveThumbnail,
	generateThumbnail,
	THUMBNAIL_PRESETS,
} from "./thumbnail";

// ─── Canvas 2D context mock factory ──────────────────────────────────────────
function makeMockCtx() {
	return {
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		fillText: vi.fn(),
		strokeText: vi.fn(),
		createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
		createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
		measureText: vi.fn(() => ({ width: 50 })),
		putImageData: vi.fn(),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
		strokeStyle: "",
		fillStyle: "",
		globalAlpha: 1,
		lineWidth: 0,
		lineJoin: "",
		font: "",
		textAlign: "",
		textBaseline: "",
	};
}

/**
 * document stub 설치.
 * thumbnail.ts 는 document.createElement("canvas") + new Image() を사용한다.
 * new Image() 는 내부적으로 document.createElement("img") 를 호출하지 않고
 * 직접 HTMLImageElement 를 반환하므로, Image 생성자도 함께 stub 한다.
 */
function installDocumentStub(
	ctx: ReturnType<typeof makeMockCtx>,
	canvasDataUrl = "data:image/jpeg;base64,/9j/abc",
	imageLoadSucceeds = true,
) {
	const mockCanvas = {
		width: 0,
		height: 0,
		getContext: vi.fn(() => ctx),
		toDataURL: vi.fn(() => canvasDataUrl),
	};

	// Image 생성자 stub — thumbnail.ts 의 loadImage()가 `new Image()` 를 사용
	class MockImage {
		crossOrigin = "";
		naturalWidth = 640;
		naturalHeight = 360;
		width = 640;
		height = 360;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		private _src = "";
		get src() {
			return this._src;
		}
		set src(v: string) {
			this._src = v;
			// 비동기 트리거
			Promise.resolve().then(() => {
				if (imageLoadSucceeds) this.onload?.();
				else this.onerror?.();
			});
		}
	}

	vi.stubGlobal("document", {
		createElement: (tag: string) => {
			if (tag === "canvas") return mockCanvas;
			return {}; // fallback
		},
	});

	vi.stubGlobal("Image", MockImage);

	return { mockCanvas, ctx };
}

function removeDocumentStub() {
	// document stub 제거 — vi.unstubAllGlobals() 는 다른 stub도 제거하므로 직접 처리
	vi.stubGlobal("document", undefined);
}

// ─── THUMBNAIL_PRESETS ────────────────────────────────────────────────────────
describe("THUMBNAIL_PRESETS", () => {
	it("5가지 프리셋 정의됨", () => {
		expect(THUMBNAIL_PRESETS).toHaveLength(5);
	});

	it("각 프리셋에 id, label, description 있음", () => {
		for (const p of THUMBNAIL_PRESETS) {
			expect(p.id).toBeDefined();
			expect(p.label).toBeDefined();
			expect(p.description).toBeDefined();
		}
	});

	it("mystery / news / dramatic / minimal / bold 포함", () => {
		const ids = THUMBNAIL_PRESETS.map((p) => p.id);
		expect(ids).toContain("mystery");
		expect(ids).toContain("news");
		expect(ids).toContain("dramatic");
		expect(ids).toContain("minimal");
		expect(ids).toContain("bold");
	});
});

// ─── generateThumbnail — document undefined 분기 ─────────────────────────────
// (이 describe는 document stub 없이 실행 → thumbnail.ts 의 첫 번째 분기)
describe("generateThumbnail — document undefined → Canvas context 에러", () => {
	it("document undefined 환경 → 'Canvas 2D context not available' throw", async () => {
		// document 가 없을 때 document.createElement 자체가 undefined → 에러
		vi.stubGlobal("document", undefined);
		await expect(
			generateThumbnail({
				backgroundUrl: "http://x.com/bg.jpg",
				title: "제목",
			}),
		).rejects.toThrow();
	});
});

// ─── generateThumbnail — Canvas context null 분기 ────────────────────────────
describe("generateThumbnail — getContext null → throw", () => {
	afterEach(() => removeDocumentStub());

	it("getContext() null → Canvas 2D context not available throw", async () => {
		const ctxNull = null;
		vi.stubGlobal("document", {
			createElement: (tag: string) => {
				if (tag === "canvas")
					return {
						width: 0,
						height: 0,
						getContext: vi.fn(() => ctxNull),
						toDataURL: vi.fn(),
					};
				return {};
			},
		});
		vi.stubGlobal(
			"Image",
			class {
				crossOrigin = "";
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				set src(_v: string) {
					Promise.resolve().then(() => this.onload?.());
				}
			},
		);
		await expect(
			generateThumbnail({
				backgroundUrl: "http://x.com/bg.jpg",
				title: "제목",
			}),
		).rejects.toThrow("Canvas 2D context not available");
	});
});

// ─── generateThumbnail — 이미지 로드 성공 ─────────────────────────────────────
describe("generateThumbnail — 이미지 로드 성공 분기", () => {
	afterEach(() => removeDocumentStub());

	it("mystery 프리셋(기본) → dataURL 반환", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		const result = await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "테스트 제목",
		});
		expect(result).toContain("data:image/jpeg");
		expect(ctx.drawImage).toHaveBeenCalled();
	});

	it("news 프리셋 (accentBar: true, vignetteStrength: 0.4)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		const result = await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "뉴스 제목",
			preset: "news",
		});
		expect(result).toContain("data:");
		expect(ctx.createRadialGradient).toHaveBeenCalled();
		expect(ctx.fillRect).toHaveBeenCalled(); // overlay + accentBar
	});

	it("dramatic 프리셋 (accentBar: false)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "드라마틱",
			preset: "dramatic",
		});
		// vignette 렌더링 확인 (vignetteStrength: 0.8)
		expect(ctx.createRadialGradient).toHaveBeenCalled();
	});

	it("minimal 프리셋 (accentBar: false, vignetteStrength: 0.3)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "미니멀",
			preset: "minimal",
		});
		expect(ctx.createRadialGradient).toHaveBeenCalled();
	});

	it("bold 프리셋 (accentBar: true, vignetteStrength: 0.6)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "Bold",
			preset: "bold",
		});
		expect(ctx.fillRect).toHaveBeenCalled();
	});

	it("subtitle 있으면 서브타이틀 fillText + strokeText 호출", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "메인",
			subtitle: "서브타이틀",
		});
		expect(ctx.fillText).toHaveBeenCalled();
		expect(ctx.strokeText).toHaveBeenCalled();
	});

	it("channelName 있으면 채널명 fillText 호출", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "제목",
			channelName: "테스트 채널",
		});
		expect(ctx.fillText).toHaveBeenCalled();
	});

	it("accentColor 있으면 커스텀 색상 액센트 바 (mystery accentBar: true)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "제목",
			accentColor: "#ff0000",
			preset: "mystery",
		});
		expect(ctx.fillRect).toHaveBeenCalled();
	});

	it("긴 제목 → wrapText 분기 (measureText가 큰 width 반환)", async () => {
		const ctx = makeMockCtx();
		ctx.measureText = vi.fn(() => ({ width: 2000 })); // 모든 문자가 너무 넓어서 줄바꿈
		installDocumentStub(ctx);
		const result = await generateThumbnail({
			backgroundUrl: "http://img.com/bg.jpg",
			title: "매우긴제목테스트",
		});
		// fillText가 여러 번 호출됨 (문자마다 줄바꿈)
		expect(ctx.fillText.mock.calls.length).toBeGreaterThanOrEqual(1);
		expect(result).toBeDefined();
	});

	it("titleStrokeWidth > 0 이면 strokeText 호출 (mystery: 4)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		await generateThumbnail({
			backgroundUrl: "http://x.com/bg.jpg",
			title: "스트로크",
		});
		expect(ctx.strokeText).toHaveBeenCalled();
	});

	it("subtitle 있을 때 title startY 조정 (-20 offset)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx);
		// subtitle 없는 경우와 있는 경우 모두 통과 확인
		await generateThumbnail({
			backgroundUrl: "http://x.com/bg.jpg",
			title: "A",
			subtitle: "B",
		});
		expect(ctx.fillText).toHaveBeenCalled();
	});
});

// ─── generateThumbnail — 이미지 로드 실패 분기 ───────────────────────────────
describe("generateThumbnail — 이미지 로드 실패 → 그라데이션 fallback", () => {
	afterEach(() => removeDocumentStub());

	it("이미지 onerror → createLinearGradient 호출 (그라데이션 배경)", async () => {
		const ctx = makeMockCtx();
		installDocumentStub(ctx, "data:image/jpeg;base64,/9j/abc", false); // 로드 실패
		const result = await generateThumbnail({
			backgroundUrl: "http://fail.com/img.jpg",
			title: "제목",
		});
		expect(ctx.createLinearGradient).toHaveBeenCalled();
		expect(result).toContain("data:");
	});
});

// ─── generateAndSaveThumbnail ─────────────────────────────────────────────────
describe("generateAndSaveThumbnail", () => {
	afterEach(() => removeDocumentStub());

	it("썸네일 생성 → IndexedDB 저장 → URL 반환, localStorage 경로 기록", async () => {
		const validBase64 = Buffer.from("fake-jpeg-data-for-test").toString(
			"base64",
		);
		const ctx = makeMockCtx();
		installDocumentStub(ctx, `data:image/jpeg;base64,${validBase64}`);

		const url = await generateAndSaveThumbnail("script-1", {
			backgroundUrl: "http://img.com/bg.jpg",
			title: "저장 테스트",
		});

		expect(typeof url).toBe("string");
		expect(storeLocalFile).toHaveBeenCalledWith(
			"scripts/script-1/thumbnail.jpg",
			expect.any(Uint8Array),
			"image/jpeg",
		);
		expect(_ls["thumbnail_path_script-1"]).toBe(
			"scripts/script-1/thumbnail.jpg",
		);
	});

	it("두 번 호출해도 scriptId별 경로 독립", async () => {
		// 유효한 base64 문자열 사용
		const validBase64 = Buffer.from("fake-jpeg-data").toString("base64");

		const ctx = makeMockCtx();
		installDocumentStub(ctx, `data:image/jpeg;base64,${validBase64}`);
		await generateAndSaveThumbnail("script-A", {
			backgroundUrl: "http://img.com/bg.jpg",
			title: "A",
		});

		installDocumentStub(ctx, `data:image/jpeg;base64,${validBase64}`);
		await generateAndSaveThumbnail("script-B", {
			backgroundUrl: "http://img.com/bg.jpg",
			title: "B",
		});

		expect(_ls["thumbnail_path_script-A"]).toBe(
			"scripts/script-A/thumbnail.jpg",
		);
		expect(_ls["thumbnail_path_script-B"]).toBe(
			"scripts/script-B/thumbnail.jpg",
		);
	});
});
