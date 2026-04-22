import { afterEach, describe, expect, it, vi } from "vitest";
import { applyGraphToImage, transformImageData } from "./color-graph-canvas";

function makeRgba(
	pixels: Array<[number, number, number, number]>,
): Uint8ClampedArray {
	const out = new Uint8ClampedArray(pixels.length * 4);
	pixels.forEach(([r, g, b, a], i) => {
		out[i * 4] = r;
		out[i * 4 + 1] = g;
		out[i * 4 + 2] = b;
		out[i * 4 + 3] = a;
	});
	return out;
}

describe("transformImageData", () => {
	it("빈 그래프 → 원본 복사본", () => {
		const src = makeRgba([[100, 150, 200, 255]]);
		const out = transformImageData(src, []);
		expect(out).not.toBe(src);
		expect(Array.from(out)).toEqual(Array.from(src));
	});

	it("exposure ev=1 → 밝기 2배 (clamp 포함)", () => {
		const src = makeRgba([
			[50, 50, 50, 255],
			[200, 200, 200, 255],
		]);
		const out = transformImageData(src, [{ kind: "exposure", ev: 1 }]);
		// 50*2=100
		expect(out[0]).toBe(100);
		// 200*2=400 → clamp 255
		expect(out[4]).toBe(255);
	});

	it("alpha 채널 보존", () => {
		const src = makeRgba([[100, 100, 100, 128]]);
		const out = transformImageData(src, [{ kind: "saturation", amount: 1 }]);
		expect(out[3]).toBe(128);
	});

	it("hsl-qualifier 초록만 desaturate, 빨강 그대로", () => {
		const src = makeRgba([
			[0, 255, 0, 255], // 초록
			[255, 0, 0, 255], // 빨강
		]);
		const out = transformImageData(src, [
			{
				kind: "hsl-qualifier",
				hue: 120,
				range: 30,
				feather: 15,
				satMin: 0.2,
				satMax: 1,
				saturationDelta: -1,
			},
		]);
		// 빨강은 유지
		expect(out[4]).toBe(255);
		expect(out[5]).toBe(0);
		expect(out[6]).toBe(0);
		// 초록은 desaturate → R/G/B 값이 비슷해짐 (gray)
		const g = { r: out[0], g: out[1], b: out[2] };
		expect(Math.abs(g.r - g.g)).toBeLessThan(30);
		expect(Math.abs(g.g - g.b)).toBeLessThan(30);
	});

	it("출력 길이 = 입력 길이", () => {
		const src = makeRgba([
			[1, 2, 3, 4],
			[5, 6, 7, 8],
			[9, 10, 11, 12],
		]);
		const out = transformImageData(src, [{ kind: "contrast", amount: 0.1 }]);
		expect(out.length).toBe(src.length);
	});
});

// ─── applyGraphToImage ────────────────────────────────────────────────────────
// Node 환경(environment: "node")에서 실행 — document/Image는 globalThis stub으로 설치
describe("applyGraphToImage", () => {
	it("빈 그래프 → 원본 URL 즉시 반환 (document 참조 없음)", async () => {
		const result = await applyGraphToImage("http://example.com/img.png", []);
		expect(result).toBe("http://example.com/img.png");
	});

	it("document undefined → 원본 URL 반환 (SSR 환경)", async () => {
		vi.stubGlobal("document", undefined);
		try {
			const result = await applyGraphToImage("http://img.com/x.png", [
				{ kind: "exposure", ev: 1 },
			]);
			expect(result).toBe("http://img.com/x.png");
		} finally {
			vi.stubGlobal("document", undefined); // 원래도 없었음
		}
	});

	// document + Image + Canvas를 모두 stub해서 Canvas 처리 경로 테스트
	describe("Canvas 처리 경로 (document + Image stub)", () => {
		function makeCtx() {
			return {
				drawImage: vi.fn(),
				getImageData: vi.fn(() => ({
					data: new Uint8ClampedArray([100, 100, 100, 255]),
					width: 1,
					height: 1,
				})),
				putImageData: vi.fn(),
			};
		}

		function setupMocks(imageSucceeds = true, ctxOverride?: unknown) {
			const ctx = makeCtx();
			const mockCanvas = {
				width: 0,
				height: 0,
				getContext: vi.fn(() =>
					ctxOverride !== undefined ? ctxOverride : ctx,
				),
				toDataURL: vi.fn(() => "data:image/png;base64,abc"),
			};

			class MockImage {
				crossOrigin = "";
				naturalWidth = 100;
				naturalHeight = 80;
				width = 100;
				height = 80;
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				private _src = "";
				get src() {
					return this._src;
				}
				set src(v: string) {
					this._src = v;
					Promise.resolve().then(() => {
						if (imageSucceeds) this.onload?.();
						else this.onerror?.();
					});
				}
			}

			vi.stubGlobal("document", {
				createElement: (tag: string) => {
					if (tag === "canvas") return mockCanvas;
					return {};
				},
			});
			vi.stubGlobal("Image", MockImage);

			return { ctx, mockCanvas };
		}

		afterEach(() => {
			vi.stubGlobal("document", undefined);
			vi.stubGlobal("Image", undefined);
		});

		it("이미지 로드 성공 → Canvas 처리 → dataURL 반환", async () => {
			setupMocks(true);
			const result = await applyGraphToImage("http://ok.com/img.png", [
				{ kind: "exposure", ev: 0 },
			]);
			expect(result).toBe("data:image/png;base64,abc");
		});

		it("이미지 로드 실패 → catch 분기 → 원본 URL 반환", async () => {
			setupMocks(false);
			const result = await applyGraphToImage("http://fail.com/img.png", [
				{ kind: "exposure", ev: 1 },
			]);
			expect(result).toBe("http://fail.com/img.png");
		});

		it("getContext null → 원본 URL 반환", async () => {
			setupMocks(true, null); // ctx = null
			const result = await applyGraphToImage("http://noctx.com/img.png", [
				{ kind: "saturation", amount: 0.5 },
			]);
			expect(result).toBe("http://noctx.com/img.png");
		});

		it("naturalWidth 0이면 img.width 사용 (분기 커버)", async () => {
			// naturalWidth = 0 인 Image stub
			class MockImageNoNatural {
				crossOrigin = "";
				naturalWidth = 0;
				naturalHeight = 0;
				width = 320;
				height = 240;
				onload: (() => void) | null = null;
				onerror: (() => void) | null = null;
				private _src = "";
				get src() {
					return this._src;
				}
				set src(v: string) {
					this._src = v;
					Promise.resolve().then(() => this.onload?.());
				}
			}
			const ctx = makeCtx();
			const mockCanvas = {
				width: 0,
				height: 0,
				getContext: vi.fn(() => ctx),
				toDataURL: vi.fn(() => "data:image/png;base64,abc"),
			};
			vi.stubGlobal("document", {
				createElement: (tag: string) => (tag === "canvas" ? mockCanvas : {}),
			});
			vi.stubGlobal("Image", MockImageNoNatural);

			const result = await applyGraphToImage("http://nw.com/img.png", [
				{ kind: "contrast", amount: 0.1 },
			]);
			// width/height를 img.width/height로 설정 → 정상 처리
			expect(result).toBe("data:image/png;base64,abc");
		});
	});
});
