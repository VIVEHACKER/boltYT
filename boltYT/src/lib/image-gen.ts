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

export type ImageGenProvider = "comfyui" | "a1111" | "dalle" | "none";

export interface ImageGenerationOptions {
	seed?: number;
	styleMode?: "auto" | "animation" | "photo";
	negativePrompt?: string;
	referenceImagePath?: string;
	referenceStrength?: number;
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
		(isAnimationPrompt(prompt) ? ANIMATION_NEGATIVE_PROMPT : DEFAULT_NEGATIVE_PROMPT);
	workflow["3"].inputs.seed = normalizeSeed(options?.seed);

	// 프롬프트 제출
	const queueRes = await fetch("http://localhost:8188/prompt", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ prompt: workflow }),
	});

	if (!queueRes.ok) throw new Error(`ComfyUI queue failed: ${queueRes.status}`);
	const { prompt_id } = await queueRes.json();

	// 완료 대기 (폴링)
	for (let i = 0; i < 120; i++) {
		await new Promise((r) => setTimeout(r, 1000));

		const histRes = await fetch(`http://localhost:8188/history/${prompt_id}`);
		if (!histRes.ok) continue;

		const hist = await histRes.json();
		const result = hist[prompt_id];
		if (!result?.outputs) continue;

		// 이미지 추출
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

	throw new Error("ComfyUI generation timed out (120s)");
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
			steps: 35,
			cfg_scale: 7,
			seed: normalizeSeed(options?.seed),
			width: 1344,
			height: 768,
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
		throw new Error(
			`Reference image not found: ${options.referenceImagePath}`,
		);
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
			steps: 35,
			cfg_scale: 7,
			denoising_strength: clamp(options.referenceStrength ?? 0.42, 0.2, 0.75),
			seed: normalizeSeed(options.seed),
			width: 1344,
			height: 768,
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

async function generateWithDalle(prompt: string): Promise<ArrayBuffer> {
	const proxy = getApiProxyUrl();
	const res = await fetch(`${proxy}/api/openai/images`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "dall-e-3",
			prompt,
			n: 1,
			size: "1792x1024",
			quality: "hd",
			style: "vivid",
			response_format: "b64_json",
		}),
	});

	if (!res.ok) throw new Error(`DALL-E error: ${res.status}`);

	const data = await res.json();
	const b64 = data.data[0].b64_json;
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
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
		if (provider === "comfyui") return ["a1111", "comfyui", "dalle"];
		if (provider === "a1111") return ["a1111", "dalle"];
		if (provider === "dalle") return ["a1111", "dalle"];
		return ["a1111", "dalle"];
	}
	if (provider === "dalle") return ["dalle"];
	if (provider === "comfyui") return ["comfyui", "dalle"];
	if (provider === "a1111") return ["a1111", "dalle"];
	return ["dalle"];
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
	// 레퍼런스 프리셋이 있으면 visualPrompt에 스타일 DNA(프롬프트 템플릿 + 컬러 + 조명) 주입
	const styledPrompt = referencePreset
		? enrichVisualPrompt(visualPrompt, referencePreset)
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
					buffer = await generateWithComfyUI(promptStyle, options);
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
				case "dalle":
					buffer = await generateWithDalle(promptStyle);
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
