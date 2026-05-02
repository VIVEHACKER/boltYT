/**
 * video-gen.ts 단위 테스트
 *
 * - buildFalInput: provider별 입력 스키마 검증 (순수 함수)
 * - getActiveVideoProvider: localStorage 의존
 * - detectVideoGen / generateSceneVideo: fetch 의존 → vi.stubGlobal
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3459" }));

const mockStoreLocalFile = vi.hoisted(() =>
	vi.fn().mockResolvedValue("blob://stored"),
);
vi.mock("./local-db", () => ({ storeLocalFile: mockStoreLocalFile }));

const mockExtractLastFrame = vi.hoisted(() => vi.fn());
vi.mock("./video-frame-extract", () => ({
	extractLastFrameDataUrl: mockExtractLastFrame,
}));

const mockSupabaseInsert = vi.hoisted(() =>
	vi.fn().mockResolvedValue({ error: null }),
);
vi.mock("./supabase", () => ({
	supabase: {
		storage: { from: vi.fn() },
		from: vi.fn(() => ({ insert: mockSupabaseInsert })),
	},
}));

import {
	buildFalInput,
	detectVideoGen,
	generateSceneVideo,
	getActiveVideoProvider,
	setActiveVideoProvider,
	VIDEO_COST_PER_SCENE,
	type VideoGenProvider,
} from "./video-gen";

// ─── localStorage stub ────────────────────────────────────────────────────────
const _ls: Record<string, string> = {};
const mockStorage = {
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
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => {
	mockStorage.clear();
	mockStoreLocalFile.mockClear();
	mockSupabaseInsert.mockClear();
	mockExtractLastFrame.mockReset();
	vi.restoreAllMocks();
});

// ─── getActiveVideoProvider ───────────────────────────────────────────────────
describe("getActiveVideoProvider", () => {
	it("localStorage 없으면 기본값 'wan26' (선택 보강용)", () => {
		expect(getActiveVideoProvider()).toBe("wan26");
	});

	it("localStorage 값 반환", () => {
		mockStorage.setItem("video_gen_active", "kling3");
		expect(getActiveVideoProvider()).toBe("kling3");
	});

	it("불명 값은 fallback wan26", () => {
		mockStorage.setItem("video_gen_active", "invalid");
		expect(getActiveVideoProvider()).toBe("wan26");
	});
});

describe("setActiveVideoProvider", () => {
	it("저장 후 즉시 조회 가능", () => {
		setActiveVideoProvider("hailuo");
		expect(getActiveVideoProvider()).toBe("hailuo");
	});
});

// ─── VIDEO_COST_PER_SCENE ─────────────────────────────────────────────────────
describe("VIDEO_COST_PER_SCENE", () => {
	it("5개 provider 모두 양의 비용 정의", () => {
		const providers: VideoGenProvider[] = [
			"kling3",
			"wan26",
			"klingO1",
			"hailuo",
			"ltx2",
		];
		for (const p of providers) {
			expect(VIDEO_COST_PER_SCENE[p]).toBeGreaterThan(0);
			expect(VIDEO_COST_PER_SCENE[p]).toBeLessThan(2); // 씬당 < $2 sanity
		}
	});

	it("wan26 가성비, kling3 고품질", () => {
		expect(VIDEO_COST_PER_SCENE.wan26).toBeLessThan(
			VIDEO_COST_PER_SCENE.kling3,
		);
	});
});

// ─── buildFalInput ────────────────────────────────────────────────────────────
describe("buildFalInput", () => {
	const baseImg = "https://cdn.example.com/img.png";

	it("kling3: imageUrl 없으면 throw", () => {
		expect(() => buildFalInput("kling3", { prompt: "ocean" })).toThrow(
			/imageUrl 필수/,
		);
	});

	it("wan26: image_url + duration 문자열", () => {
		const input = buildFalInput("wan26", {
			prompt: "ocean waves",
			imageUrl: baseImg,
			duration: 7,
		});
		expect(input.image_url).toBe(baseImg);
		expect(input.duration).toBe("7");
		expect(input.prompt).toMatch(/cinematic/i);
	});

	it("duration clamp 3~10", () => {
		const tooShort = buildFalInput("wan26", {
			prompt: "x",
			imageUrl: baseImg,
			duration: 1,
		});
		expect(tooShort.duration).toBe("3");

		const tooLong = buildFalInput("wan26", {
			prompt: "x",
			imageUrl: baseImg,
			duration: 30,
		});
		expect(tooLong.duration).toBe("10");
	});

	it("klingO1: end_image_url 누락 시 throw", () => {
		expect(() =>
			buildFalInput("klingO1", { prompt: "x", imageUrl: baseImg }),
		).toThrow(/endImageUrl/);
	});

	it("klingO1: 보간 입력 (start + end)", () => {
		const input = buildFalInput("klingO1", {
			prompt: "transition",
			imageUrl: baseImg,
			endImageUrl: "https://cdn.example.com/end.png",
		});
		expect(input.start_image_url).toBe(baseImg);
		expect(input.end_image_url).toBe("https://cdn.example.com/end.png");
	});

	it("ltx2: num_frames = duration * 24", () => {
		const input = buildFalInput("ltx2", {
			prompt: "x",
			imageUrl: baseImg,
			duration: 5,
		});
		expect(input.num_frames).toBe(120);
	});

	it("hailuo: 카메라 명령 [Push in][Pan right] prefix", () => {
		const input = buildFalInput("hailuo", {
			prompt: "barista coffee",
			cameraCommands: ["Push in", "Pan right"],
		});
		expect(input.prompt).toMatch(/^\[Push in\]\[Pan right\]/);
	});

	it("hailuo: 카메라 명령 최대 3개 (4번째 무시)", () => {
		const input = buildFalInput("hailuo", {
			prompt: "x",
			cameraCommands: ["Push in", "Pan right", "Tilt up", "Zoom out"],
		});
		const promptStr = String(input.prompt);
		expect(promptStr).toMatch(/\[Push in\]\[Pan right\]\[Tilt up\]/);
		expect(promptStr).not.toMatch(/Zoom out/);
	});

	it("이미 cinematic 키워드 있으면 중복 안 붙음", () => {
		const input = buildFalInput("wan26", {
			prompt: "cinematic shot of waves",
			imageUrl: baseImg,
		});
		const matches = String(input.prompt).match(/cinematic/gi);
		expect(matches?.length).toBe(1);
	});

	it("seed 전달", () => {
		const input = buildFalInput("wan26", {
			prompt: "x",
			imageUrl: baseImg,
			seed: 42,
		});
		expect(input.seed).toBe(42);
	});

	it("aspectRatio: shorts → 9:16", () => {
		const input = buildFalInput("wan26", {
			prompt: "x",
			imageUrl: baseImg,
			aspectRatio: "9:16",
		});
		expect(input.aspect_ratio).toBe("9:16");
	});

	it("aspectRatio 미지정 → 기본 16:9", () => {
		const input = buildFalInput("kling3", {
			prompt: "x",
			imageUrl: baseImg,
		});
		expect(input.aspect_ratio).toBe("16:9");
	});

	it("hailuo도 aspect_ratio 전달", () => {
		const input = buildFalInput("hailuo", {
			prompt: "x",
			aspectRatio: "9:16",
		});
		expect(input.aspect_ratio).toBe("9:16");
	});
});

// ─── detectVideoGen ───────────────────────────────────────────────────────────
describe("detectVideoGen", () => {
	it("fal 키 있으면 available=true", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ fal: true, openai: true }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const status = await detectVideoGen();
		expect(status.available).toBe(true);
	});

	it("fal 키 없으면 available=false", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ fal: false }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const status = await detectVideoGen();
		expect(status.available).toBe(false);
	});

	it("프록시 미응답 시 available=false (graceful)", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		vi.stubGlobal("fetch", fetchMock);

		const status = await detectVideoGen();
		expect(status.available).toBe(false);
	});
});

// ─── generateSceneVideo ───────────────────────────────────────────────────────
describe("generateSceneVideo", () => {
	it("성공 흐름: submit → 다운로드 → IndexedDB 저장 → media_assets insert", async () => {
		const fakeMp4 = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]); // ftyp magic
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					video_url: "https://fal.cdn/result.mp4",
					request_id: "req-abc",
					provider: "wan26",
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				headers: new Map([["content-type", "video/mp4"]]) as unknown as Headers,
				arrayBuffer: async () => fakeMp4.buffer,
			});
		// Map.get 시뮬레이션 (Headers와 호환)
		(fetchMock.mock.results[1] as unknown) ??= {};
		vi.stubGlobal("fetch", fetchMock);

		const result = await generateSceneVideo("scene-1", {
			provider: "wan26",
			prompt: "ocean waves",
			imageUrl: "https://cdn.example.com/img.png",
			duration: 5,
		});

		expect(result.url).toBe("blob://stored");
		expect(result.provider).toBe("wan26");
		expect(result.requestId).toBe("req-abc");
		expect(result.storagePath).toBe("scenes/scene-1/visual.mp4");

		// 첫 호출 = 서버 프록시
		expect(fetchMock.mock.calls[0][0]).toBe(
			"http://localhost:3459/api/fal/video-gen",
		);
		const body = JSON.parse(
			(fetchMock.mock.calls[0][1] as { body: string }).body,
		);
		expect(body.provider).toBe("wan26");
		expect(body.input.image_url).toBe("https://cdn.example.com/img.png");

		// 두 번째 호출 = fal CDN 다운로드
		expect(fetchMock.mock.calls[1][0]).toBe("https://fal.cdn/result.mp4");

		// IndexedDB 저장
		expect(mockStoreLocalFile).toHaveBeenCalledWith(
			"scenes/scene-1/visual.mp4",
			expect.any(Uint8Array),
			"video/mp4",
		);

		// media_assets 기록
		expect(mockSupabaseInsert).toHaveBeenCalledWith(
			expect.objectContaining({
				scene_id: "scene-1",
				type: "video",
				storage_path: "scenes/scene-1/visual.mp4",
				status: "complete",
				generation_params: expect.objectContaining({ provider: "wan26" }),
			}),
		);
	});

	it("서버 5xx 시 throw", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 503,
			text: async () => "FAL_KEY 미설정",
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			generateSceneVideo("scene-2", {
				provider: "wan26",
				prompt: "x",
				imageUrl: "https://cdn.example.com/x.png",
			}),
		).rejects.toThrow(/영상 생성 실패/);
	});

	it("chainFromVideoUrl 지정 시 마지막 프레임을 imageUrl 로 사용", async () => {
		mockExtractLastFrame.mockResolvedValue({
			dataUrl: "data:image/jpeg;base64,EXTRACTED",
			width: 1280,
			height: 720,
			durationSec: 5,
			mimeType: "image/jpeg",
		});

		const fakeMp4 = new Uint8Array([0]);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					video_url: "https://fal.cdn/chained.mp4",
					request_id: "req-chain",
					provider: "wan26",
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				headers: new Map([["content-type", "video/mp4"]]) as unknown as Headers,
				arrayBuffer: async () => fakeMp4.buffer,
			});
		vi.stubGlobal("fetch", fetchMock);

		await generateSceneVideo("scene-2", {
			provider: "wan26",
			prompt: "x",
			imageUrl: "https://fallback/img.png",
			chainFromVideoUrl: "blob:prev-scene",
		});

		expect(mockExtractLastFrame).toHaveBeenCalledWith(
			"blob:prev-scene",
			expect.objectContaining({ mimeType: "image/jpeg" }),
		);
		const submitBody = JSON.parse(
			(fetchMock.mock.calls[0][1] as { body: string }).body,
		);
		expect(submitBody.input.image_url).toBe("data:image/jpeg;base64,EXTRACTED");
	});

	it("chainFromVideoUrl 추출 실패 시 fallback imageUrl 사용", async () => {
		mockExtractLastFrame.mockRejectedValue(new Error("CORS"));
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const fakeMp4 = new Uint8Array([0]);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					video_url: "https://fal.cdn/x.mp4",
					request_id: "req-fb",
					provider: "wan26",
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				headers: new Map([["content-type", "video/mp4"]]) as unknown as Headers,
				arrayBuffer: async () => fakeMp4.buffer,
			});
		vi.stubGlobal("fetch", fetchMock);

		await generateSceneVideo("scene-3", {
			provider: "wan26",
			prompt: "x",
			imageUrl: "https://fallback/img.png",
			chainFromVideoUrl: "blob:bad",
		});

		const submitBody = JSON.parse(
			(fetchMock.mock.calls[0][1] as { body: string }).body,
		);
		expect(submitBody.input.image_url).toBe("https://fallback/img.png");
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("chainFromVideoUrl 실패"),
			expect.any(String),
		);
	});

	it("video_url 누락 시 throw", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ request_id: "abc" }), // video_url 없음
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			generateSceneVideo("scene-3", {
				provider: "wan26",
				prompt: "x",
				imageUrl: "https://cdn.example.com/x.png",
			}),
		).rejects.toThrow(/video_url/);
	});
});
