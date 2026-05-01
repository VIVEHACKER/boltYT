/**
 * 비디오 마지막 프레임 추출 — last-frame chaining 용.
 *
 * 흐름: HTMLVideoElement load → seek to (duration - epsilon) → seeked 이벤트 →
 * canvas.drawImage → toDataURL(image/jpeg).
 *
 * 사용처: 씬 N의 video URL을 받아서 마지막 프레임을 dataURL 로 반환,
 * 씬 N+1 의 fal.ai imageUrl 입력으로 사용 (시각 연속성).
 *
 * 제약: blob: URL 또는 same-origin URL 만 안정적. 외부 도메인은 CORS 필요.
 */

const DEFAULT_EPSILON = 0.05; // 끝에서 50ms 전 프레임 (정확히 duration 시 끝나는 영상이 많음)
const LOAD_TIMEOUT_MS = 15_000;
const SEEK_TIMEOUT_MS = 5_000;

export interface ExtractFrameOptions {
	/** 끝에서 떨어진 시간(초). 기본 0.05 */
	epsilon?: number;
	/** 출력 포맷. 기본 image/jpeg (PNG 보다 base64 사이즈 작음) */
	mimeType?: "image/jpeg" | "image/png" | "image/webp";
	/** JPEG/WEBP 품질 0~1. 기본 0.92 */
	quality?: number;
	/** 추출 시 최대 너비 (다운스케일). 기본 원본 해상도 유지 */
	maxWidth?: number;
}

export interface FrameExtractResult {
	dataUrl: string;
	width: number;
	height: number;
	durationSec: number;
	mimeType: string;
}

/**
 * 비디오 URL(blob: 또는 http) 의 마지막 프레임을 dataURL 로 추출.
 * @throws videoUrl 빈 값, 로드 실패, seek 실패, draw 실패 시
 */
export async function extractLastFrameDataUrl(
	videoUrl: string,
	options: ExtractFrameOptions = {},
): Promise<FrameExtractResult> {
	if (!videoUrl) throw new Error("videoUrl 비어있음");
	if (typeof document === "undefined") {
		throw new Error("DOM 환경에서만 동작 (브라우저 전용)");
	}

	const epsilon = Math.max(0, options.epsilon ?? DEFAULT_EPSILON);
	const mimeType = options.mimeType ?? "image/jpeg";
	const quality = clamp01(options.quality ?? 0.92);

	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	// blob: 는 same-origin. 외부 URL 은 anonymous 시도 (실패 시 throw)
	if (!videoUrl.startsWith("blob:") && !videoUrl.startsWith("data:")) {
		video.crossOrigin = "anonymous";
	}
	video.src = videoUrl;

	try {
		await waitForEvent(video, "loadeddata", LOAD_TIMEOUT_MS);
	} catch (e) {
		video.src = "";
		throw new Error(`비디오 로드 실패: ${(e as Error).message}`);
	}

	const duration = Number.isFinite(video.duration) ? video.duration : 0;
	const targetTime = Math.max(0, duration - epsilon);

	video.currentTime = targetTime;
	try {
		await waitForEvent(video, "seeked", SEEK_TIMEOUT_MS);
	} catch (e) {
		video.src = "";
		throw new Error(
			`seek 실패 (${targetTime.toFixed(2)}s): ${(e as Error).message}`,
		);
	}

	const srcW = video.videoWidth || 1280;
	const srcH = video.videoHeight || 720;
	const scale =
		options.maxWidth && srcW > options.maxWidth ? options.maxWidth / srcW : 1;
	const w = Math.round(srcW * scale);
	const h = Math.round(srcH * scale);

	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		video.src = "";
		throw new Error("canvas 2d context 사용 불가");
	}
	ctx.drawImage(video, 0, 0, w, h);

	let dataUrl: string;
	try {
		dataUrl = canvas.toDataURL(mimeType, quality);
	} catch (e) {
		video.src = "";
		throw new Error(
			`canvas.toDataURL 실패 (CORS 가능성): ${(e as Error).message}`,
		);
	}

	// 비디오 리소스 해제
	video.src = "";

	return {
		dataUrl,
		width: w,
		height: h,
		durationSec: duration,
		mimeType,
	};
}

function waitForEvent(
	target: HTMLElement,
	event: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const onErr = (e?: Event) => {
			cleanup();
			const msg =
				(e as ErrorEvent | undefined)?.message ?? e?.type ?? "load error";
			reject(new Error(`event=${event} → error: ${msg}`));
		};
		const onOk = () => {
			cleanup();
			resolve();
		};
		const t = setTimeout(() => {
			cleanup();
			reject(new Error(`timeout ${timeoutMs}ms waiting for ${event}`));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(t);
			target.removeEventListener(event, onOk);
			target.removeEventListener("error", onErr);
		};
		target.addEventListener(event, onOk, { once: true });
		target.addEventListener("error", onErr, { once: true });
	});
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0.92;
	return Math.max(0, Math.min(1, n));
}

/** Test-only export for waitForEvent / clamp01 */
export const __test = { clamp01, waitForEvent };
