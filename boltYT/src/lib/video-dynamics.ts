const LOAD_TIMEOUT_MS = 12_000;
const SEEK_TIMEOUT_MS = 4_000;
const DEFAULT_SAMPLE_SIZE = 32;
const DEFAULT_WINDOW_SECONDS = 8;

export interface VideoDynamicsReport {
	available: boolean;
	score: number;
	avgDiff: number;
	maxDiff: number;
	meaningfulDiffs: number;
	sampleCount: number;
	durationSeconds: number;
	width: number;
	height: number;
	issues: string[];
	reason?: string;
}

export interface VideoDynamicsOptions {
	windowSeconds?: number;
	sampleCount?: number;
	sampleSize?: number;
	cropTopRatio?: number;
	meaningfulDiffThreshold?: number;
	minDynamicScore?: number;
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.max(min, Math.min(max, value));
}

function waitForEvent(
	target: HTMLElement,
	event: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error(`timeout ${timeoutMs}ms waiting for ${event}`));
		}, timeoutMs);
		const onOk = () => {
			cleanup();
			resolve();
		};
		const onError = (eventObject?: Event) => {
			cleanup();
			reject(new Error(eventObject?.type ?? "video load error"));
		};
		const cleanup = () => {
			clearTimeout(timeout);
			target.removeEventListener(event, onOk);
			target.removeEventListener("error", onError);
		};
		target.addEventListener(event, onOk, { once: true });
		target.addEventListener("error", onError, { once: true });
	});
}

function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
	const length = Math.min(a.length, b.length);
	if (length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < length; i += 4) {
		sum += Math.abs(a[i] - b[i]);
		sum += Math.abs(a[i + 1] - b[i + 1]);
		sum += Math.abs(a[i + 2] - b[i + 2]);
	}
	return sum / ((length / 4) * 3 * 255);
}

export function scoreFrameDiffs(
	diffs: number[],
	meaningfulDiffThreshold = 0.012,
): {
	score: number;
	avgDiff: number;
	maxDiff: number;
	meaningfulDiffs: number;
	issues: string[];
} {
	const avgDiff =
		diffs.length > 0 ? diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length : 0;
	const maxDiff = diffs.length > 0 ? Math.max(...diffs) : 0;
	const meaningfulDiffs = diffs.filter(
		(diff) => diff >= meaningfulDiffThreshold,
	).length;
	const score = Math.round(
		clamp(avgDiff * 2200 + maxDiff * 700 + meaningfulDiffs * 12, 0, 100),
	);
	const issues: string[] = [];
	if (avgDiff < 0.006 && maxDiff < 0.014) {
		issues.push("low_motion_video");
	}
	if (meaningfulDiffs === 0) {
		issues.push("no_meaningful_frame_change");
	}
	return { score, avgDiff, maxDiff, meaningfulDiffs, issues };
}

function sampleTimes(duration: number, windowSeconds: number, sampleCount: number) {
	const end = Math.max(0.35, Math.min(duration - 0.08, windowSeconds));
	const count = Math.max(2, sampleCount);
	return Array.from({ length: count }, (_, index) => {
		const progress = count <= 1 ? 0 : index / (count - 1);
		return clamp(0.25 + progress * Math.max(0.1, end - 0.25), 0, end);
	});
}

export async function assessVideoDynamics(
	videoUrl: string,
	options: VideoDynamicsOptions = {},
): Promise<VideoDynamicsReport> {
	if (!videoUrl) {
		return {
			available: false,
			score: 0,
			avgDiff: 0,
			maxDiff: 0,
			meaningfulDiffs: 0,
			sampleCount: 0,
			durationSeconds: 0,
			width: 0,
			height: 0,
			issues: ["missing_video_url"],
			reason: "videoUrl is empty",
		};
	}
	if (typeof document === "undefined") {
		return {
			available: false,
			score: 0,
			avgDiff: 0,
			maxDiff: 0,
			meaningfulDiffs: 0,
			sampleCount: 0,
			durationSeconds: 0,
			width: 0,
			height: 0,
			issues: ["dom_unavailable"],
			reason: "video dynamics can only be measured in a browser runtime",
		};
	}

	const sampleSize = Math.max(12, options.sampleSize ?? DEFAULT_SAMPLE_SIZE);
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	if (!videoUrl.startsWith("blob:") && !videoUrl.startsWith("data:")) {
		video.crossOrigin = "anonymous";
	}
	video.src = videoUrl;

	try {
		await waitForEvent(video, "loadedmetadata", LOAD_TIMEOUT_MS);
		if (video.readyState < 2) {
			await waitForEvent(video, "loadeddata", LOAD_TIMEOUT_MS);
		}

		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		const width = video.videoWidth || 0;
		const height = video.videoHeight || 0;
		const canvas = document.createElement("canvas");
		canvas.width = sampleSize;
		canvas.height = sampleSize;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx || duration <= 0 || width <= 0 || height <= 0) {
			throw new Error("video metadata is incomplete");
		}

		const cropTopRatio = clamp(options.cropTopRatio ?? 0.62, 0.25, 1);
		const cropHeight = Math.max(1, Math.round(height * cropTopRatio));
		const frames: Uint8ClampedArray[] = [];
		for (const time of sampleTimes(
			duration,
			options.windowSeconds ?? DEFAULT_WINDOW_SECONDS,
			options.sampleCount ?? 6,
		)) {
			video.currentTime = time;
			await waitForEvent(video, "seeked", SEEK_TIMEOUT_MS);
			ctx.drawImage(
				video,
				0,
				0,
				width,
				cropHeight,
				0,
				0,
				sampleSize,
				sampleSize,
			);
			frames.push(ctx.getImageData(0, 0, sampleSize, sampleSize).data);
		}

		const diffs = frames.slice(1).map((frame, index) => frameDiff(frames[index], frame));
		const scored = scoreFrameDiffs(diffs, options.meaningfulDiffThreshold);
		video.src = "";
		return {
			available: true,
			...scored,
			sampleCount: frames.length,
			durationSeconds: duration,
			width,
			height,
		};
	} catch (error) {
		video.src = "";
		return {
			available: false,
			score: 0,
			avgDiff: 0,
			maxDiff: 0,
			meaningfulDiffs: 0,
			sampleCount: 0,
			durationSeconds: 0,
			width: 0,
			height: 0,
			issues: ["motion_probe_failed"],
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

export function isVideoDynamicsAcceptable(
	report: VideoDynamicsReport,
	minDynamicScore = 22,
): boolean {
	if (!report.available) return true;
	return report.score >= minDynamicScore && !report.issues.includes("low_motion_video");
}

export const __test = { frameDiff, sampleTimes };
