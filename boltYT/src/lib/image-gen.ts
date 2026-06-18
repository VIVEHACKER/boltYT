/**
 * 이미지 생성 서비스 — 로컬 모델 우선, API fallback
 *
 * 우선순위:
 * 1. ComfyUI (localhost:8188) — 로컬 SDXL
 * 2. Automatic1111 (localhost:7860) — 로컬 SD
 * 3. DALL-E 3 API (프록시 경유) — 클라우드 fallback
 */

import { loadLocalFileData, storeLocalFile } from "./local-db";
import { getApiProxyUrl } from "./proxy";
import { enrichVisualPrompt, type ReferencePreset } from "./reference-bridge";
import { supabase } from "./supabase";

export type ImageGenProvider = "comfyui" | "a1111" | "fal" | "dalle" | "none";

export type ImageAspectRatio = "16:9" | "9:16" | "1:1";

export interface ImageGenerationOptions {
	seed?: number;
	styleMode?: "auto" | "animation" | "photo";
	negativePrompt?: string;
	referenceImagePath?: string;
	referenceStrength?: number;
	/** 출력 종횡비. Shorts=9:16, 롱폼=16:9. 미지정 시 16:9. 영상 프레이밍과 일치시켜 크롭 방지. */
	aspectRatio?: ImageAspectRatio;
	/** 씬 mood — moodVisualIntensity 시네마틱 디스크립터 주입(영상 경로와 톤 일치). */
	mood?: string;
}

/** 종횡비 → SDXL/A1111 권장 해상도(픽셀). */
function imageDims(ratio?: ImageAspectRatio): {
	width: number;
	height: number;
} {
	if (ratio === "9:16") return { width: 768, height: 1344 };
	if (ratio === "1:1") return { width: 1024, height: 1024 };
	return { width: 1344, height: 768 }; // 16:9 기본
}

/** 종횡비 → DALL-E 3 허용 사이즈 문자열. */
function dalleSize(ratio?: ImageAspectRatio): string {
	if (ratio === "9:16") return "1024x1792";
	if (ratio === "1:1") return "1024x1024";
	return "1792x1024"; // 16:9 기본
}

/** 종횡비 → fal.ai flux image_size enum. */
function falImageSize(ratio?: ImageAspectRatio): string {
	if (ratio === "9:16") return "portrait_16_9";
	if (ratio === "1:1") return "square_hd";
	return "landscape_16_9"; // 16:9 기본
}

interface ImageGenStatus {
	available: ImageGenProvider[];
	active: ImageGenProvider;
}

/** 사용 가능한 이미지 생성 서비스 감지 */
export async function detectImageProviders(): Promise<ImageGenStatus> {
	const available: ImageGenProvider[] = [];

	// ComfyUI 감지
	try {
		const res = await fetch("http://localhost:8188/system_stats", {
			signal: AbortSignal.timeout(2000),
		});
		if (res.ok) available.push("comfyui");
	} catch {
		// not running
	}

	// Automatic1111 감지
	try {
		const res = await fetch("http://localhost:7860/sdapi/v1/sd-models", {
			signal: AbortSignal.timeout(2000),
		});
		if (res.ok) {
			const models = await res.json();
			if (Array.isArray(models) && models.length > 0) {
				available.push("a1111");
			}
		}
	} catch {
		// not running
	}

	// DALL-E (프록시 키 확인)
	try {
		const proxy = getApiProxyUrl();
		const res = await fetch(`${proxy}/api/keys/status`, {
			signal: AbortSignal.timeout(2000),
		});
		if (res.ok) {
			const status = await res.json();
			// FAL 우선(영상과 같은 예산·seed 지원으로 일관성↑), 그다음 DALL-E.
			if (status.fal) available.push("fal");
			if (status.openai) available.push("dalle");
		}
	} catch {
		// proxy not running
	}

	const active = available[0] ?? "none";

	// 캐시
	localStorage.setItem("image_gen_providers", JSON.stringify(available));
	localStorage.setItem("image_gen_active", active);

	return { available, active };
}

/** 캐시된 활성 프로바이더 */
export function getActiveProvider(): ImageGenProvider {
	return (
		(localStorage.getItem("image_gen_active") as ImageGenProvider) ?? "dalle"
	);
}

// ─── ComfyUI 이미지 생성 ───

const COMFYUI_WORKFLOW = {
	"3": {
		class_type: "KSampler",
		inputs: {
			seed: 0,
			steps: 35,
			cfg: 7,
			sampler_name: "dpmpp_2m",
			scheduler: "karras",
			denoise: 1,
			model: ["4", 0],
			positive: ["6", 0],
			negative: ["7", 0],
			latent_image: ["5", 0],
		},
	},
	"4": {
		class_type: "CheckpointLoaderSimple",
		inputs: { ckpt_name: "sd_xl_base_1.0.safetensors" },
	},
	"5": {
		class_type: "EmptyLatentImage",
		inputs: { width: 1344, height: 768, batch_size: 1 },
	},
	"6": {
		class_type: "CLIPTextEncode",
		inputs: { text: "", clip: ["4", 1] },
	},
	"7": {
		class_type: "CLIPTextEncode",
		inputs: {
			text: "ugly, blurry, low quality, watermark, text, logo, bad anatomy, deformed, disfigured, poorly drawn, extra limbs, mutation, artifacts, jpeg artifacts, oversaturated, pixelated, noise, lowres, duplicate, cropped",
			clip: ["4", 1],
		},
	},
	"8": {
		class_type: "VAEDecode",
		inputs: { samples: ["3", 0], vae: ["4", 2] },
	},
	"9": {
		class_type: "SaveImage",
		inputs: { filename_prefix: "boltyt", images: ["8", 0] },
	},
};

const DEFAULT_NEGATIVE_PROMPT =
	"ugly, blurry, low quality, watermark, text, logo, bad anatomy, deformed, disfigured, poorly drawn, extra limbs, mutation, artifacts, jpeg artifacts, oversaturated, pixelated, noise, lowres, duplicate, cropped";

const ANIMATION_NEGATIVE_PROMPT = `${DEFAULT_NEGATIVE_PROMPT}, photorealistic, live action, real person, realistic skin texture, news photo, documentary photo, CCTV, screenshot`;

function normalizeSeed(seed?: number): number {
	if (typeof seed === "number" && Number.isFinite(seed)) {
		return Math.abs(Math.floor(seed)) % 2 ** 32;
	}
	return Math.floor(Math.random() * 2 ** 32);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

async function generateWithComfyUI(
	prompt: string,
	options?: ImageGenerationOptions,
): Promise<ArrayBuffer> {
	const workflow = JSON.parse(JSON.stringify(COMFYUI_WORKFLOW));
	workflow["6"].inputs.text = prompt;
	workflow["7"].inputs.text =
		options?.negativePrompt ??
		(isAnimationPrompt(prompt)
			? ANIMATION_NEGATIVE_PROMPT
			: DEFAULT_NEGATIVE_PROMPT);
	workflow["3"].inputs.seed = normalizeSeed(options?.seed);
	// 종횡비 반영 — Shorts(9:16) 컷 크롭 방지.
	const dims = imageDims(options?.aspectRatio);
	workflow["5"].inputs.width = dims.width;
	workflow["5"].inputs.height = dims.height;
	// 디테일↑·과대비 인공물↓: steps 40, cfg 6.5. 체크포인트는 설정으로 교체 가능.
	workflow["3"].inputs.steps = 40;
	workflow["3"].inputs.cfg = 6.5;
	const ckpt = localStorage.getItem("comfyui_ckpt");
	if (ckpt) workflow["4"].inputs.ckpt_name = ckpt;

	return runComfyUIWorkflow(workflow);
}

/** ComfyUI 워크플로 제출 → 완료 폴링 → 이미지 ArrayBuffer. (txt2img·IP-Adapter 공통) */
async function runComfyUIWorkflow(
	workflow: Record<string, unknown>,
): Promise<ArrayBuffer> {
	const queueRes = await fetch("http://localhost:8188/prompt", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ prompt: workflow }),
	});
	if (!queueRes.ok) throw new Error(`ComfyUI queue failed: ${queueRes.status}`);
	const { prompt_id } = await queueRes.json();

	// 완료 대기 (폴링) — IP-Adapter 포함 SDXL 은 최대 ~3분.
	for (let i = 0; i < 180; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		const histRes = await fetch(`http://localhost:8188/history/${prompt_id}`);
		if (!histRes.ok) continue;
		const hist = await histRes.json();
		const result = hist[prompt_id];
		if (!result?.outputs) continue;
		const output = Object.values(result.outputs)[0] as {
			images?: Array<{ filename: string; subfolder: string; type: string }>;
		};
		if (output?.images?.[0]) {
			const img = output.images[0];
			const imgRes = await fetch(
				`http://localhost:8188/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`,
			);
			if (imgRes.ok) return imgRes.arrayBuffer();
		}
	}
	throw new Error("ComfyUI generation timed out (180s)");
}

// ─── ComfyUI + IP-Adapter face-lock (호스트 얼굴 고정, 무료 로컬) ───
// 검증된 설정: weight 0.6 / end_at 0.7 / "ease in-out" → 얼굴 고정 + 씬은 프롬프트가 주도.

const IPADAPTER_DEFAULTS = {
	ipadapterFile: "sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
	clipVision: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
	weight: 0.6,
	endAt: 0.7,
	weightType: "ease in-out",
};

/** IndexedDB 의 레퍼런스 이미지를 ComfyUI input 으로 업로드 → 업로드된 파일명 반환. */
async function uploadReferenceToComfyUI(
	referenceImagePath: string,
): Promise<string> {
	const bytes = await loadLocalFileData(referenceImagePath);
	if (!bytes) throw new Error(`reference image not found: ${referenceImagePath}`);
	const name = `ipref_${referenceImagePath.replace(/[^a-zA-Z0-9]+/g, "_").slice(-80)}.png`;
	const form = new FormData();
	form.append("image", new Blob([bytes], { type: "image/png" }), name);
	form.append("overwrite", "true");
	const res = await fetch("http://localhost:8188/upload/image", {
		method: "POST",
		body: form,
	});
	if (!res.ok) throw new Error(`ComfyUI upload failed: ${res.status}`);
	const data = await res.json();
	return (data.name as string) ?? name;
}

async function generateWithComfyUIIPAdapter(
	prompt: string,
	options: ImageGenerationOptions,
): Promise<ArrayBuffer> {
	if (!options.referenceImagePath) {
		throw new Error("IP-Adapter requires referenceImagePath");
	}
	const imageName = await uploadReferenceToComfyUI(options.referenceImagePath);
	const dims = imageDims(options.aspectRatio);
	const ckpt =
		localStorage.getItem("comfyui_ckpt") ?? "sd_xl_base_1.0.safetensors";
	const weight = Number(
		localStorage.getItem("ipadapter_weight") ?? IPADAPTER_DEFAULTS.weight,
	);
	const endAt = Number(
		localStorage.getItem("ipadapter_end_at") ?? IPADAPTER_DEFAULTS.endAt,
	);
	const weightType =
		localStorage.getItem("ipadapter_weight_type") ??
		IPADAPTER_DEFAULTS.weightType;
	const negative =
		options.negativePrompt ??
		`${DEFAULT_NEGATIVE_PROMPT}, multiple people, different face`;

	const workflow: Record<string, unknown> = {
		"4": {
			class_type: "CheckpointLoaderSimple",
			inputs: { ckpt_name: ckpt },
		},
		"10": {
			class_type: "IPAdapterModelLoader",
			inputs: {
				ipadapter_file:
					localStorage.getItem("ipadapter_file") ??
					IPADAPTER_DEFAULTS.ipadapterFile,
			},
		},
		"11": {
			class_type: "CLIPVisionLoader",
			inputs: {
				clip_name:
					localStorage.getItem("comfyui_clip_vision") ??
					IPADAPTER_DEFAULTS.clipVision,
			},
		},
		"12": { class_type: "LoadImage", inputs: { image: imageName } },
		"13": {
			class_type: "IPAdapterAdvanced",
			inputs: {
				model: ["4", 0],
				ipadapter: ["10", 0],
				image: ["12", 0],
				clip_vision: ["11", 0],
				weight,
				weight_type: weightType,
				combine_embeds: "concat",
				start_at: 0.0,
				end_at: endAt,
				embeds_scaling: "V only",
			},
		},
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: dims.width, height: dims.height, batch_size: 1 },
		},
		"6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } },
		"7": {
			class_type: "CLIPTextEncode",
			inputs: { text: negative, clip: ["4", 1] },
		},
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: normalizeSeed(options.seed),
				steps: 40,
				cfg: 6.5,
				sampler_name: "dpmpp_2m",
				scheduler: "karras",
				denoise: 1,
				model: ["13", 0],
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
		"9": {
			class_type: "SaveImage",
			inputs: { filename_prefix: "boltyt_host", images: ["8", 0] },
		},
	};
	return runComfyUIWorkflow(workflow);
}

// ─── Automatic1111 이미지 생성 ───

async function generateWithA1111(
	prompt: string,
	options?: ImageGenerationOptions,
): Promise<ArrayBuffer> {
	const res = await fetch("http://localhost:7860/sdapi/v1/txt2img", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			prompt,
			negative_prompt:
				options?.negativePrompt ??
				(isAnimationPrompt(prompt)
					? ANIMATION_NEGATIVE_PROMPT
					: DEFAULT_NEGATIVE_PROMPT),
			steps: 40,
			cfg_scale: 6.5,
			seed: normalizeSeed(options?.seed),
			...imageDims(options?.aspectRatio),
			sampler_index: "DPM++ 2M Karras",
		}),
	});

	if (!res.ok) throw new Error(`A1111 error: ${res.status}`);

	const data = await res.json();
	const b64 = data.images?.[0];
	if (!b64) throw new Error("A1111 returned no images");

	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

async function generateWithA1111Img2Img(
	prompt: string,
	options: ImageGenerationOptions,
): Promise<ArrayBuffer> {
	if (!options.referenceImagePath) {
		throw new Error("A1111 img2img requires referenceImagePath");
	}
	const referenceData = await loadLocalFileData(options.referenceImagePath);
	if (!referenceData) {
		throw new Error(`Reference image not found: ${options.referenceImagePath}`);
	}
	const res = await fetch("http://localhost:7860/sdapi/v1/img2img", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			init_images: [arrayBufferToBase64(referenceData)],
			prompt,
			negative_prompt:
				options.negativePrompt ??
				(isAnimationPrompt(prompt)
					? ANIMATION_NEGATIVE_PROMPT
					: DEFAULT_NEGATIVE_PROMPT),
			steps: 40,
			cfg_scale: 6.5,
			denoising_strength: clamp(options.referenceStrength ?? 0.42, 0.2, 0.75),
			seed: normalizeSeed(options.seed),
			...imageDims(options.aspectRatio),
			sampler_index: "DPM++ 2M Karras",
		}),
	});

	if (!res.ok) throw new Error(`A1111 img2img error: ${res.status}`);

	const data = await res.json();
	const b64 = data.images?.[0];
	if (!b64) throw new Error("A1111 img2img returned no images");

	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

// ─── DALL-E API 이미지 생성 ───

async function generateWithDalle(
	prompt: string,
	options?: ImageGenerationOptions,
): Promise<ArrayBuffer> {
	const proxy = getApiProxyUrl();
	// 뉴스/정보/다큐 톤은 'natural'(과채도·합성사진 방지), 미스터리/호러/드라마는 'vivid'.
	const naturalMood = /news|neutral|proof|evidence|document/i.test(
		options?.mood ?? "",
	);
	const style =
		options?.styleMode === "photo" || naturalMood ? "natural" : "vivid";
	// DALL-E는 negative_prompt 미지원 → 스타일은 긍정 지시로, 결함은 avoid 절로 분리.
	const isAnimation =
		options?.styleMode === "animation" || isAnimationPrompt(prompt);
	// 애니메이션은 "flat 2D illustration"을 *원하는 스타일*로 지시(긍정), photorealism/live action만 회피.
	const styleDirective = isAnimation
		? " Render as a flat 2D animated illustration."
		: "";
	const animationAvoid = isAnimation
		? " photorealism, live action, realistic photo,"
		: "";
	const dallePrompt =
		`${prompt}${styleDirective}\n\nAvoid:${animationAvoid} on-screen text, watermark, logo, distorted faces, extra fingers, oversaturation.`.slice(
			0,
			3900,
		);
	const res = await fetch(`${proxy}/api/openai/images`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "dall-e-3",
			prompt: dallePrompt,
			n: 1,
			size: dalleSize(options?.aspectRatio),
			quality: "hd",
			style,
			// response_format 은 2026 OpenAI images API 에서 제거됨 — 보내면 400.
			// 응답은 b64_json 또는 url 로 올 수 있어 아래에서 양쪽 처리.
		}),
	});

	if (!res.ok) throw new Error(`DALL-E error: ${res.status}`);

	const data = await res.json();
	return decodeImageResponse(data.data?.[0]);
}

/**
 * 이미지 응답 1건 → ArrayBuffer. b64_json 이면 디코드, url 이면 fetch.
 * (OpenAI/현 API·FAL 등 응답 형태 차이를 흡수.)
 */
async function decodeImageResponse(
	item: { b64_json?: string; url?: string } | undefined,
): Promise<ArrayBuffer> {
	if (item?.b64_json) {
		const binary = atob(item.b64_json);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes.buffer;
	}
	if (item?.url) {
		const imgRes = await fetch(item.url);
		if (!imgRes.ok) throw new Error(`image fetch failed: ${imgRes.status}`);
		return imgRes.arrayBuffer();
	}
	throw new Error("image response has neither b64_json nor url");
}

// ─── fal.ai (flux) 이미지 생성 — 영상과 같은 예산, seed 지원으로 일관성↑ ───

async function generateWithFal(
	prompt: string,
	options?: ImageGenerationOptions,
): Promise<ArrayBuffer> {
	const proxy = getApiProxyUrl();
	const falPrompt =
		`${prompt}\n\nAvoid: on-screen text, watermark, logo, distorted faces, extra fingers, oversaturation.`.slice(
			0,
			3900,
		);
	const body: Record<string, unknown> = {
		prompt: falPrompt,
		image_size: falImageSize(options?.aspectRatio),
		num_images: 1,
		num_inference_steps: 28,
		guidance_scale: 3.5,
		enable_safety_checker: true,
	};
	if (typeof options?.seed === "number" && Number.isFinite(options.seed)) {
		// flux 는 seed 를 따른다 → 같은 호스트 시드 + 외형 프롬프트 = 에피소드 간 일관성.
		body.seed = Math.abs(Math.floor(options.seed)) % 2 ** 31;
	}
	const res = await fetch(`${proxy}/api/fal/image-gen`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`FAL image error: ${res.status}`);
	const data = await res.json();
	const img = Array.isArray(data.images) ? data.images[0] : data.image;
	return decodeImageResponse(img);
}

function isAnimationPrompt(prompt: string): boolean {
	return /\b(animation|animated|cartoon|2d|3d|anime|storybook|whiteboard|infographic|motion graphic|keypose|character sheet|reference sheet|sprite|cutout|illustration|illustrated)\b/i.test(
		prompt,
	);
}

function animationPromptStyle(
	prompt: string,
	styleMode: ImageGenerationOptions["styleMode"] = "auto",
): string {
	const shouldUseAnimation =
		styleMode === "animation" ||
		(styleMode !== "photo" && isAnimationPrompt(prompt));
	if (shouldUseAnimation) {
		return `High-quality animated keyframe, consistent character design, clean readable silhouette, polished illustration, coherent color palette, professional animation art direction, no text, no watermark: ${prompt}`;
	}
	return `Photorealistic cinematic still frame, 35mm film look, shallow depth of field, professional color grading, natural dynamic lighting, sharp focus, high detail, 8K resolution, award-winning cinematography: ${prompt}`;
}

function providerFallbackOrder(
	provider: ImageGenProvider,
	options?: ImageGenerationOptions,
): ImageGenProvider[] {
	const needsReference = Boolean(options?.referenceImagePath);
	if (needsReference) {
		// 레퍼런스 face-lock: ComfyUI(IP-Adapter, 무료·검증됨) 우선 → A1111 img2img → FAL(seed)→DALL-E.
		// comfyui 가 active 일 때만 선두(아니면 미실행 가능성 → 헛시도 방지).
		if (provider === "comfyui") return ["comfyui", "a1111", "fal", "dalle"];
		if (provider === "a1111") return ["a1111", "fal", "dalle"];
		return ["a1111", "fal", "dalle"];
	}
	if (provider === "dalle") return ["dalle"];
	if (provider === "fal") return ["fal", "dalle"];
	if (provider === "comfyui") return ["comfyui", "fal", "dalle"];
	if (provider === "a1111") return ["a1111", "fal", "dalle"];
	// 클라우드 기본: FAL 우선(예산·seed), DALL-E 폴백.
	return ["fal", "dalle"];
}

// ─── 통합 이미지 생성 ───

/**
 * 이미지 생성 — 로컬 모델 우선, API fallback
 * @returns IndexedDB blob URL
 */
async function generateImageInternal(
	storagePath: string,
	visualPrompt: string,
	preferredProvider?: ImageGenProvider,
	referencePreset?: ReferencePreset,
	sceneIdForAsset?: string,
	options?: ImageGenerationOptions,
): Promise<{ url: string; provider: ImageGenProvider }> {
	// 레퍼런스 프리셋이 있으면 visualPrompt에 스타일 DNA(프롬프트 템플릿 + 컬러 + 조명 + mood) 주입
	const styledPrompt = referencePreset
		? enrichVisualPrompt(visualPrompt, referencePreset, options?.mood)
		: visualPrompt;
	const promptStyle = animationPromptStyle(styledPrompt, options?.styleMode);
	const provider = preferredProvider ?? getActiveProvider();

	const tryProviders = providerFallbackOrder(provider, options);

	let lastError: Error | null = null;
	let usedProvider: ImageGenProvider = "none";

	for (const p of tryProviders) {
		try {
			let buffer: ArrayBuffer;
			switch (p) {
				case "comfyui":
					// 레퍼런스(호스트 시트) 있으면 IP-Adapter face-lock, 없으면 일반 txt2img.
					buffer = options?.referenceImagePath
						? await generateWithComfyUIIPAdapter(promptStyle, options)
						: await generateWithComfyUI(promptStyle, options);
					break;
				case "a1111":
					if (options?.referenceImagePath) {
						try {
							buffer = await generateWithA1111Img2Img(promptStyle, options);
						} catch (err) {
							const error = err instanceof Error ? err : new Error(String(err));
							console.warn(
								`[image-gen] A1111 img2img failed, falling back to txt2img: ${error.message}`,
							);
							buffer = await generateWithA1111(promptStyle, options);
						}
					} else {
						buffer = await generateWithA1111(promptStyle, options);
					}
					break;
				case "fal":
					buffer = await generateWithFal(promptStyle, options);
					break;
				case "dalle":
					buffer = await generateWithDalle(promptStyle, options);
					break;
				default:
					continue;
			}

			usedProvider = p;
			const bytes = new Uint8Array(buffer);
			const url = await storeLocalFile(storagePath, bytes, "image/png");

			if (sceneIdForAsset) {
				await supabase.from("media_assets").insert({
					scene_id: sceneIdForAsset,
					type: "image",
					storage_path: storagePath,
					status: "complete",
					generation_params: {
						provider: p,
						prompt: visualPrompt,
						seed: options?.seed,
						styleMode: options?.styleMode,
						referenceImagePath: options?.referenceImagePath,
						referenceStrength: options?.referenceStrength,
					},
				});
			}

			return { url, provider: usedProvider };
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			console.warn(`[image-gen] ${p} failed:`, lastError.message);
		}
	}

	throw lastError ?? new Error("No image generation provider available");
}

export async function generateImage(
	sceneId: string,
	visualPrompt: string,
	preferredProvider?: ImageGenProvider,
	referencePreset?: ReferencePreset,
	options?: ImageGenerationOptions,
): Promise<{ url: string; provider: ImageGenProvider }> {
	return generateImageInternal(
		`scenes/${sceneId}/visual.png`,
		visualPrompt,
		preferredProvider,
		referencePreset,
		sceneId,
		options,
	);
}

export async function generateImageToPath(
	storagePath: string,
	visualPrompt: string,
	preferredProvider?: ImageGenProvider,
	referencePreset?: ReferencePreset,
	options?: ImageGenerationOptions,
): Promise<{ url: string; provider: ImageGenProvider }> {
	return generateImageInternal(
		storagePath,
		visualPrompt,
		preferredProvider,
		referencePreset,
		undefined,
		options,
	);
}
