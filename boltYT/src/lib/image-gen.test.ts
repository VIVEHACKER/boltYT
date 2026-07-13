/**
 * image-gen.ts 단위 테스트
 *
 * getActiveProvider: localStorage 의존.
 * detectImageProviders: 복수 fetch 의존 → vi.stubGlobal.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3456" }));

const mockStoreLocalFile = vi.hoisted(() =>
	vi.fn().mockResolvedValue("blob://stored"),
);
const mockLoadLocalFileData = vi.hoisted(() =>
	vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7]).buffer),
);
vi.mock("./local-db", () => ({
	loadLocalFileData: mockLoadLocalFileData,
	storeLocalFile: mockStoreLocalFile,
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
vi.mock("./reference-bridge", () => ({
	enrichVisualPrompt: vi.fn((p: string) => p),
}));

import {
	detectImageProviders,
	generateImage,
	generateImageToPath,
	getActiveProvider,
} from "./image-gen";

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
	vi.restoreAllMocks();
});

// ─── getActiveProvider ────────────────────────────────────────────────────────
describe("getActiveProvider", () => {
	it("localStorage 없으면 기본값 'dalle'", () => {
		expect(getActiveProvider()).toBe("dalle");
	});

	it("localStorage 값 반환", () => {
		mockStorage.setItem("image_gen_active", "comfyui");
		expect(getActiveProvider()).toBe("comfyui");
	});

	it("'a1111' 반환", () => {
		mockStorage.setItem("image_gen_active", "a1111");
		expect(getActiveProvider()).toBe("a1111");
	});
});

// ─── detectImageProviders ─────────────────────────────────────────────────────
describe("detectImageProviders", () => {
	function makeFetch(
		comfyOk: boolean,
		a1111Ok: boolean,
		a1111Models: unknown[],
		dalleOk: boolean,
		dalleStatus = { openai: true },
	) {
		let callIdx = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() => {
				const idx = callIdx++;
				if (idx === 0) {
					// ComfyUI /system_stats
					return Promise.resolve({ ok: comfyOk });
				}
				if (idx === 1) {
					// A1111 /sdapi/v1/sd-models
					return Promise.resolve({
						ok: a1111Ok,
						json: () => Promise.resolve(a1111Models),
					});
				}
				// DALL-E /api/keys/status
				return Promise.resolve({
					ok: dalleOk,
					json: () => Promise.resolve(dalleStatus),
				});
			}),
		);
	}

	it("모두 실패 → available 빈 배열, active 'none'", async () => {
		makeFetch(false, false, [], false);
		const status = await detectImageProviders();
		expect(status.available).toEqual([]);
		expect(status.active).toBe("none");
	});

	it("DALL-E만 성공 → available ['dalle'], active 'dalle'", async () => {
		makeFetch(false, false, [], true);
		const status = await detectImageProviders();
		expect(status.available).toContain("dalle");
		expect(status.active).toBe("dalle");
	});

	it("ComfyUI 성공 → available에 'comfyui' 포함", async () => {
		makeFetch(true, false, [], false);
		const status = await detectImageProviders();
		expect(status.available).toContain("comfyui");
	});

	it("A1111 성공 (모델 있음) → available에 'a1111' 포함", async () => {
		makeFetch(false, true, [{ model_name: "sdxl" }], false);
		const status = await detectImageProviders();
		expect(status.available).toContain("a1111");
	});

	it("A1111 성공이지만 모델 없음 → 'a1111' 미포함", async () => {
		makeFetch(false, true, [], false);
		const status = await detectImageProviders();
		expect(status.available).not.toContain("a1111");
	});

	it("localStorage에 결과 캐시", async () => {
		makeFetch(false, false, [], true);
		await detectImageProviders();
		const cached = JSON.parse(
			mockStorage.getItem("image_gen_providers") ?? "[]",
		) as string[];
		expect(cached).toContain("dalle");
	});

	it("네트워크 오류 → throw 없이 빈 결과", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
		const status = await detectImageProviders();
		expect(status.available).toEqual([]);
	});
});

// ─── FAL 이미지 제공자 ─────────────────────────────────────────────────────────
describe("fal image provider", () => {
	it("detect: status.fal → 'fal' 포함, dalle보다 우선(active 'fal')", async () => {
		let idx = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() => {
				const i = idx++;
				if (i === 0) return Promise.resolve({ ok: false }); // comfyui
				if (i === 1)
					return Promise.resolve({
						ok: false,
						json: () => Promise.resolve([]),
					}); // a1111
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ openai: true, fal: true }),
				});
			}),
		);
		const status = await detectImageProviders();
		expect(status.available).toContain("fal");
		expect(status.available.indexOf("fal")).toBeLessThan(
			status.available.indexOf("dalle"),
		);
		expect(status.active).toBe("fal");
	});

	it("generate: active 'fal' → /api/fal/image-gen 호출 + url fetch, provider 'fal'", async () => {
		mockStorage.setItem("image_gen_active", "fal");
		const calls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation((u: string) => {
				calls.push(String(u));
				if (String(u).includes("/api/fal/image-gen")) {
					return Promise.resolve({
						ok: true,
						json: () =>
							Promise.resolve({ images: [{ url: "http://fal/img.png" }] }),
					});
				}
				return Promise.resolve({
					ok: true,
					arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
				});
			}),
		);
		const result = await generateImage("scene-fal", "ancient rome", "fal");
		expect(result.provider).toBe("fal");
		expect(result.url).toBe("blob://stored");
		expect(calls.some((c) => c.includes("/api/fal/image-gen"))).toBe(true);
	});

	it("generate: fal seed/aspectRatio → body.seed + image_size 전달", async () => {
		mockStorage.setItem("image_gen_active", "fal");
		const fetchMock = vi.fn().mockImplementation((u: string) => {
			if (String(u).includes("/api/fal/image-gen")) {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({ images: [{ url: "http://fal/i.png" }] }),
				});
			}
			return Promise.resolve({
				ok: true,
				arrayBuffer: () => Promise.resolve(new Uint8Array([1]).buffer),
			});
		});
		vi.stubGlobal("fetch", fetchMock);
		await generateImage("scene-fal", "prompt", "fal", undefined, {
			seed: 12345,
			aspectRatio: "9:16",
		});
		const falCall = fetchMock.mock.calls.find((c) =>
			String(c[0]).includes("/api/fal/image-gen"),
		);
		const body = JSON.parse(String(falCall?.[1]?.body));
		expect(body.seed).toBe(12345);
		expect(body.image_size).toBe("portrait_16_9");
	});

	it("DALL-E url 응답(b64_json 없음)도 처리 — url fetch (response_format 제거 대응)", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation((u: string) => {
				if (String(u).includes("/api/openai/images")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ data: [{ url: "http://x/y.png" }] }),
					});
				}
				return Promise.resolve({
					ok: true,
					arrayBuffer: () => Promise.resolve(new Uint8Array([5]).buffer),
				});
			}),
		);
		const result = await generateImage("scene-1", "prompt", "dalle");
		expect(result.provider).toBe("dalle");
	});
});

// ─── ComfyUI IP-Adapter face-lock ─────────────────────────────────────────────
describe("comfyui IP-Adapter face-lock", () => {
	it("referenceImagePath 있으면 업로드 + IPAdapterAdvanced 워크플로로 생성", async () => {
		mockStorage.setItem("image_gen_active", "comfyui");
		const calls: string[] = [];
		const fetchMock = vi.fn().mockImplementation((u: string) => {
			const s = String(u);
			calls.push(s);
			if (s.includes("/upload/image"))
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ name: "ipref_x.png" }),
				});
			if (s.includes("/prompt"))
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ prompt_id: "pid-ip" }),
				});
			if (s.includes("/history/pid-ip"))
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							"pid-ip": {
								outputs: {
									"9": {
										images: [
											{ filename: "o.png", subfolder: "", type: "output" },
										],
									},
								},
							},
						}),
				});
			if (s.includes("/view"))
				return Promise.resolve({
					ok: true,
					arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer),
				});
			return Promise.resolve({ ok: false, status: 404 });
		});
		vi.stubGlobal("fetch", fetchMock);
		const result = await generateImage(
			"scene-ip",
			"ancient rome forum",
			"comfyui",
			undefined,
			{
				referenceImagePath: "channels/c/host/h/reference-sheet.png",
				aspectRatio: "16:9",
			},
		);
		expect(result.provider).toBe("comfyui");
		expect(calls.some((c) => c.includes("/upload/image"))).toBe(true);
		const promptCall = fetchMock.mock.calls.find((c) =>
			String(c[0]).includes("/prompt"),
		);
		expect(String(promptCall?.[1]?.body)).toContain("IPAdapterAdvanced");
	});
});

// ─── generateImage / generateImageToPath ─────────────────────────────────────
describe("generateImage", () => {
	// 유효한 최소 base64 — atob 테스트용
	const fakeB64 = btoa("fake-image-data");

	it("DALL-E 성공 → url 반환, provider='dalle'", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
			}),
		);
		const result = await generateImage("scene-1", "dark alley at night");
		expect(result.provider).toBe("dalle");
		expect(result.url).toBe("blob://stored");
	});

	it("DALL-E HTTP 오류 → throw", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 500 }),
		);
		await expect(generateImage("scene-1", "prompt")).rejects.toThrow();
	});

	it("aspectRatio 9:16 → DALL-E size 1024x1792 (Shorts 세로)", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		await generateImage("scene-1", "prompt", "dalle", undefined, {
			aspectRatio: "9:16",
		});
		const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
		expect(body.size).toBe("1024x1792");
	});

	it("mood=news → DALL-E style 'natural' (과채도 방지), 기본은 'vivid'", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		const mk = () =>
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
			});
		const newsFetch = mk();
		vi.stubGlobal("fetch", newsFetch);
		await generateImage("s", "prompt", "dalle", undefined, { mood: "news" });
		expect(JSON.parse(String(newsFetch.mock.calls[0][1]?.body)).style).toBe(
			"natural",
		);

		const horrorFetch = mk();
		vi.stubGlobal("fetch", horrorFetch);
		await generateImage("s", "prompt", "dalle", undefined, { mood: "horror" });
		expect(JSON.parse(String(horrorFetch.mock.calls[0][1]?.body)).style).toBe(
			"vivid",
		);
	});

	it("provider='comfyui' 실패 → DALL-E fallback 성공", async () => {
		mockStorage.setItem("image_gen_active", "comfyui");
		let callCount = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					// ComfyUI queue → 실패
					return Promise.resolve({ ok: false, status: 500 });
				}
				// DALL-E fallback
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
				});
			}),
		);
		const result = await generateImage("scene-1", "prompt");
		expect(result.provider).toBe("dalle");
	});

	it("provider='a1111' 성공 → result.provider='a1111'", async () => {
		mockStorage.setItem("image_gen_active", "a1111");
		const fakeA1111B64 = btoa("a1111-image");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ images: [fakeA1111B64] }),
			}),
		);
		// A1111 성공 시 atob 필요
		vi.stubGlobal("atob", (b64: string) =>
			Buffer.from(b64, "base64").toString("binary"),
		);
		const result = await generateImage("scene-a1111", "bright day");
		expect(result.provider).toBe("a1111");
	});

	it("provider='a1111' 실패 → DALL-E fallback", async () => {
		mockStorage.setItem("image_gen_active", "a1111");
		const fakeB64 = btoa("fallback-data");
		let callCount = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					// A1111 → fail
					return Promise.resolve({ ok: false, status: 503 });
				}
				// DALL-E
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
				});
			}),
		);
		vi.stubGlobal("atob", (b64: string) =>
			Buffer.from(b64, "base64").toString("binary"),
		);
		const result = await generateImage("scene-fallback", "scene");
		expect(result.provider).toBe("dalle");
	});

	it("A1111 images 없음 → throw", async () => {
		mockStorage.setItem("image_gen_active", "a1111");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ images: [] }),
			}),
		);
		await expect(
			generateImage("scene-a1111-noimg", "prompt"),
		).rejects.toThrow();
	});

	it("sceneIdForAsset 지정 → supabase insert 호출", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		const fakeB64 = btoa("scene-asset-data");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
			}),
		);
		vi.stubGlobal("atob", (b64: string) =>
			Buffer.from(b64, "base64").toString("binary"),
		);
		const { generateImage: gi } = await import("./image-gen");
		await gi("scene-1", "dark alley", undefined, undefined);
		expect(mockSupabaseInsert).toHaveBeenCalled();
	});

	it("generateImageToPath → storeLocalFile에 지정된 경로 사용", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
			}),
		);
		await generateImageToPath("custom/path/image.png", "bright sky");
		expect(mockStoreLocalFile).toHaveBeenCalledWith(
			"custom/path/image.png",
			expect.any(Uint8Array),
			"image/png",
		);
	});

	it("애니메이션 프롬프트에는 실사 시네마틱 접두어를 붙이지 않는다", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ data: [{ b64_json: fakeB64 }] }),
		});
		vi.stubGlobal("fetch", fetchMock);

		await generateImageToPath(
			"scripts/s1/animation/character-sheet.png",
			"consistent 2D animation character sheet, blue robot",
		);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.prompt).toContain("animated keyframe");
		expect(body.prompt).not.toContain("Photorealistic cinematic still frame");
	});

	it("로컬 생성기에는 고정 시드와 애니메이션 negative prompt를 전달한다", async () => {
		mockStorage.setItem("image_gen_active", "a1111");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ images: [btoa("seeded-image")] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("atob", (b64: string) =>
			Buffer.from(b64, "base64").toString("binary"),
		);

		await generateImageToPath(
			"scenes/s1/shot.png",
			"animated keypose of a robot",
			"a1111",
			undefined,
			{ styleMode: "animation", seed: 123456 },
		);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.seed).toBe(123456);
		expect(body.negative_prompt).toContain("photorealistic");
		expect(body.prompt).toContain("animated keyframe");
	});

	it("referenceImagePath가 있으면 A1111 img2img를 우선 사용한다", async () => {
		mockStorage.setItem("image_gen_active", "dalle");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ images: [btoa("reference-conditioned")] }),
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("atob", (b64: string) =>
			Buffer.from(b64, "base64").toString("binary"),
		);

		const result = await generateImageToPath(
			"scenes/s1/shot.png",
			"animated keypose of a robot",
			undefined,
			undefined,
			{
				styleMode: "animation",
				seed: 42,
				referenceImagePath: "scripts/s1/animation/character-sheet.png",
				referenceStrength: 0.38,
			},
		);

		const [url, request] = fetchMock.mock.calls[0];
		const body = JSON.parse(request.body);
		expect(String(url)).toContain("/sdapi/v1/img2img");
		expect(mockLoadLocalFileData).toHaveBeenCalledWith(
			"scripts/s1/animation/character-sheet.png",
		);
		expect(body.init_images[0]).toBeTruthy();
		expect(body.denoising_strength).toBe(0.38);
		expect(result.provider).toBe("a1111");
	});

	it("provider='comfyui' 폴링 성공 → provider='comfyui' 반환", async () => {
		mockStorage.setItem("image_gen_active", "comfyui");
		vi.useFakeTimers();
		const fakeImageBuf = new Uint8Array([1, 2, 3]).buffer;
		let callIdx = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation((url: string) => {
				const u = typeof url === "string" ? url : String(url);
				if (u.includes("/prompt")) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve({ prompt_id: "pid-1" }),
					});
				}
				if (u.includes("/history/pid-1")) {
					callIdx++;
					if (callIdx === 1) {
						// 첫 폴링: 결과 없음
						return Promise.resolve({
							ok: true,
							json: () => Promise.resolve({}),
						});
					}
					// 두 번째 폴링: 완료
					return Promise.resolve({
						ok: true,
						json: () =>
							Promise.resolve({
								"pid-1": {
									outputs: {
										"9": {
											images: [
												{
													filename: "img.png",
													subfolder: "",
													type: "output",
												},
											],
										},
									},
								},
							}),
					});
				}
				if (u.includes("/view")) {
					return Promise.resolve({
						ok: true,
						arrayBuffer: () => Promise.resolve(fakeImageBuf),
					});
				}
				return Promise.resolve({ ok: false });
			}),
		);
		vi.stubGlobal("atob", (b64: string) =>
			Buffer.from(b64, "base64").toString("binary"),
		);

		const promise = generateImage("scene-comfy", "bright sky prompt");
		// 타이머 실행 (1000ms 단위 폴링 2회)
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result.provider).toBe("comfyui");
		vi.useRealTimers();
	});
});
