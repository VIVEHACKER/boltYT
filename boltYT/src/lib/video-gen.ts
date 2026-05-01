/**
 * 영상 생성 서비스 — fal.ai 기반 T2V / I2V 통합
 *
 * 흐름:
 * 1. visualPrompt(+ optional imageUrl) → 서버 /api/fal/video-gen 제출
 * 2. 서버가 fal.ai 큐 폴링 → 완료 시 video_url 반환
 * 3. 클라이언트가 video_url 다운로드 → IndexedDB → blob URL
 *
 * Provider 전략 (skill 추천):
 * - kling3   : 고품질 I2V (씬 메인 영상)
 * - wan26    : 가성비 I2V (배치 생성)
 * - klingO1  : 키프레임 보간 (씬 간 전환)
 * - hailuo   : T2V + 카메라 명령 (이미지 없이 직접 생성)
 * - ltx2     : 빠른 추론 (프리뷰/draft)
 */

import { storeLocalFile } from "./local-db";
import { getApiProxyUrl } from "./proxy";
import { supabase } from "./supabase";
import { extractLastFrameDataUrl } from "./video-frame-extract";

export type VideoGenProvider =
	| "kling3"
	| "wan26"
	| "klingO1"
	| "hailuo"
	| "ltx2";

export interface VideoGenStatus {
	available: boolean;
	active: VideoGenProvider;
}

/** 씬 한 개당 추정 비용 (USD) — 5초 기준 */
export const VIDEO_COST_PER_SCENE: Record<VideoGenProvider, number> = {
	kling3: 0.5, // 0.10 × 5s
	wan26: 0.25, // 0.05 × 5s
	klingO1: 0.55, // 0.11 × 5s (보간)
	hailuo: 0.45, // 0.09 × 5s
	ltx2: 0.25, // 0.05 × 5s
};

/** 서버에 fal.ai 키가 설정되어 있는지 확인 */
export async function detectVideoGen(): Promise<VideoGenStatus> {
	try {
		const proxy = getApiProxyUrl();
		const res = await fetch(`${proxy}/api/keys/status`, {
			signal: AbortSignal.timeout(2000),
		});
		if (res.ok) {
			const status = await res.json();
			const available = Boolean(status.fal);
			const active = getActiveVideoProvider();
			localStorage.setItem("video_gen_available", available ? "1" : "0");
			return { available, active };
		}
	} catch {
		// proxy not running
	}
	return { available: false, active: getActiveVideoProvider() };
}

export function getActiveVideoProvider(): VideoGenProvider {
	const stored = localStorage.getItem("video_gen_active");
	if (
		stored === "kling3" ||
		stored === "wan26" ||
		stored === "klingO1" ||
		stored === "hailuo" ||
		stored === "ltx2"
	) {
		return stored;
	}
	return "wan26"; // 기본: 가성비
}

export function setActiveVideoProvider(p: VideoGenProvider): void {
	localStorage.setItem("video_gen_active", p);
}

// ─── 프롬프트 보강 ───

const CINEMATIC_SUFFIX =
	"cinematic, 35mm film look, shallow depth of field, professional color grading, natural dynamic lighting, sharp focus, 4K";

const NEGATIVE_DEFAULTS =
	"low quality, blurry, watermark, text overlay, distorted faces, deformed limbs, jittery motion, oversaturated";

function enrichPrompt(prompt: string): string {
	const trimmed = prompt.trim();
	if (!trimmed) return CINEMATIC_SUFFIX;
	// 사용자 프롬프트가 이미 cinematic 키워드 포함하면 중복 방지
	if (/cinematic|film look|color grading/i.test(trimmed)) return trimmed;
	return `${trimmed}, ${CINEMATIC_SUFFIX}`;
}

// ─── fal.ai input builder (provider별 스키마 차이 흡수) ───

export type VideoAspectRatio = "9:16" | "16:9" | "1:1";

export interface BuildInputOptions {
	prompt: string;
	imageUrl?: string;
	endImageUrl?: string;
	duration?: number; // 초 (5 / 10)
	cameraCommands?: string[]; // hailuo: ["Push in", "Pan right"]
	negative?: string;
	seed?: number;
	/** 출력 종횡비. shorts=9:16, longform=16:9. 기본 16:9 */
	aspectRatio?: VideoAspectRatio;
}

export function buildFalInput(
	provider: VideoGenProvider,
	opts: BuildInputOptions,
): Record<string, unknown> {
	const enriched = enrichPrompt(opts.prompt);
	const negative = opts.negative ?? NEGATIVE_DEFAULTS;
	const duration = Math.max(3, Math.min(10, Math.floor(opts.duration ?? 5)));

	const aspectField = opts.aspectRatio ?? "16:9";

	switch (provider) {
		case "kling3":
		case "wan26": {
			if (!opts.imageUrl) {
				throw new Error(`${provider}: imageUrl 필수 (image-to-video)`);
			}
			return {
				prompt: enriched,
				image_url: opts.imageUrl,
				duration: String(duration),
				negative_prompt: negative,
				aspect_ratio: aspectField,
				...(opts.seed !== undefined ? { seed: opts.seed } : {}),
			};
		}
		case "klingO1": {
			if (!opts.imageUrl || !opts.endImageUrl) {
				throw new Error("klingO1: imageUrl + endImageUrl 필수 (보간)");
			}
			return {
				prompt: enriched,
				start_image_url: opts.imageUrl,
				end_image_url: opts.endImageUrl,
				duration: String(duration),
				negative_prompt: negative,
				aspect_ratio: aspectField,
			};
		}
		case "ltx2": {
			if (!opts.imageUrl) {
				throw new Error("ltx2: imageUrl 필수 (image-to-video)");
			}
			return {
				prompt: enriched,
				image_url: opts.imageUrl,
				num_frames: duration * 24,
				negative_prompt: negative,
				aspect_ratio: aspectField,
				...(opts.seed !== undefined ? { seed: opts.seed } : {}),
			};
		}
		case "hailuo": {
			const cameraPrefix =
				opts.cameraCommands && opts.cameraCommands.length > 0
					? `${opts.cameraCommands
							.slice(0, 3)
							.map((c) => `[${c}]`)
							.join("")} `
					: "";
			return {
				prompt: `${cameraPrefix}${enriched}`,
				duration,
				aspect_ratio: aspectField,
				...(opts.seed !== undefined ? { seed: opts.seed } : {}),
			};
		}
	}
}

// ─── 핵심 생성 함수 ───

export interface GenerateVideoOptions extends BuildInputOptions {
	provider?: VideoGenProvider;
	/** 서버 폴링 타임아웃 ms (기본 5분) */
	timeoutMs?: number;
	/**
	 * 이전 씬의 비디오 URL. 지정 시 마지막 프레임 추출 → imageUrl 대체
	 * (last-frame chaining: 씬 간 시각 연속성).
	 * imageUrl 과 chainFromVideoUrl 둘 다 있으면 chainFromVideoUrl 우선.
	 */
	chainFromVideoUrl?: string;
}

export interface GenerateVideoResult {
	url: string;
	provider: VideoGenProvider;
	requestId: string;
	storagePath: string;
}

/** 내부: storagePath를 명시적으로 지정 */
async function generateVideoInternal(
	storagePath: string,
	opts: GenerateVideoOptions,
	sceneIdForAsset?: string,
): Promise<GenerateVideoResult> {
	const provider = opts.provider ?? getActiveVideoProvider();

	// chainFromVideoUrl 지정 시 마지막 프레임을 추출하여 imageUrl 로 사용 (씬 연속성)
	let effectiveOpts: BuildInputOptions = opts;
	if (opts.chainFromVideoUrl) {
		try {
			const frame = await extractLastFrameDataUrl(opts.chainFromVideoUrl, {
				mimeType: "image/jpeg",
				quality: 0.9,
				maxWidth: 1280,
			});
			effectiveOpts = { ...opts, imageUrl: frame.dataUrl };
		} catch (e) {
			console.warn(
				"[video-gen] chainFromVideoUrl 실패 → 원본 imageUrl 사용:",
				(e as Error).message,
			);
		}
	}

	const input = buildFalInput(provider, effectiveOpts);
	const proxy = getApiProxyUrl();

	const submitRes = await fetch(`${proxy}/api/fal/video-gen`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			provider,
			input,
			timeout_ms: opts.timeoutMs ?? 300_000,
		}),
		// 클라 측 abort: 서버 timeout + 30s 여유
		signal: AbortSignal.timeout((opts.timeoutMs ?? 300_000) + 30_000),
	});

	if (!submitRes.ok) {
		const err = await submitRes.text().catch(() => "");
		throw new Error(
			`영상 생성 실패 (${submitRes.status}): ${err.slice(0, 200)}`,
		);
	}

	const data = (await submitRes.json()) as {
		video_url?: string;
		request_id?: string;
	};
	if (!data.video_url || !data.request_id) {
		throw new Error("영상 생성 응답에 video_url/request_id 없음");
	}

	// 결과 영상 다운로드 (fal CDN)
	const dlRes = await fetch(data.video_url, {
		signal: AbortSignal.timeout(120_000),
	});
	if (!dlRes.ok) {
		throw new Error(`영상 다운로드 실패: ${dlRes.status}`);
	}
	const buffer = await dlRes.arrayBuffer();
	const ct = dlRes.headers.get("content-type") ?? "video/mp4";

	const url = await storeLocalFile(storagePath, new Uint8Array(buffer), ct);

	if (sceneIdForAsset) {
		await supabase.from("media_assets").insert({
			scene_id: sceneIdForAsset,
			type: "video",
			storage_path: storagePath,
			status: "complete",
			generation_params: {
				provider,
				request_id: data.request_id,
				prompt: opts.prompt,
				duration: opts.duration ?? 5,
			},
		});
	}

	return { url, provider, requestId: data.request_id, storagePath };
}

/** scene_id 기준 표준 경로로 영상 생성 */
export async function generateSceneVideo(
	sceneId: string,
	opts: GenerateVideoOptions,
): Promise<GenerateVideoResult> {
	const storagePath = `scenes/${sceneId}/visual.mp4`;
	return generateVideoInternal(storagePath, opts, sceneId);
}

/** 임의 storagePath로 영상 생성 (체이닝 등) */
export async function generateVideoToPath(
	storagePath: string,
	opts: GenerateVideoOptions,
): Promise<GenerateVideoResult> {
	return generateVideoInternal(storagePath, opts);
}
