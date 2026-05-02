import { execFile } from "node:child_process";
import type {
	RenderOutputQcReport,
	RenderReferenceProfile,
} from "./render-output-qc.ts";

const SAMPLE_SIZE = 48;
const SAMPLE_BYTES = SAMPLE_SIZE * SAMPLE_SIZE * 3;

export type ReferenceAnalysisDepth =
	| "pixel_frame_audio_edit"
	| "metadata_only";

export type ReferenceCameraMode =
	| "static"
	| "slow_push"
	| "handheld"
	| "cut_driven"
	| "mixed";

export type SubtitleCollisionRisk = "low" | "medium" | "high";

export interface ReferencePixelFrameMetrics {
	index: number;
	path: string;
	brightness: number;
	contrast: number;
	saturation: number;
	warmth: number;
	edgeDensity: number;
	subjectZone: string;
	dominantTone: string;
	subtitleBandRisk: SubtitleCollisionRisk;
	cellMap: Array<{
		zone: string;
		brightness: number;
		saturation: number;
		edgeDensity: number;
	}>;
}

export interface ReferenceProductionDna {
	version: "production-dna-v1";
	analysisDepth: ReferenceAnalysisDepth;
	pixelPrecisionAvailable: boolean;
	mood: {
		visualMood: string;
		atmosphere: string[];
		lightingStyle: string;
	};
	color: {
		dominantColors: string[];
		brightness: number;
		contrast: number;
		saturation: number;
		warmth: number;
		temperature: "cool" | "neutral" | "warm";
	};
	layout: {
		frameSize: { width: number; height: number } | null;
		aspectRatio: number | null;
		compositionPattern: string;
		subjectZone: string;
		textSafeZones: string[];
		subtitleCollisionRisk: SubtitleCollisionRisk;
	};
	camera: {
		mode: ReferenceCameraMode;
		motionIntensity: number;
		first3Motion: number;
		cutDensityPerMinute: number;
		avgCutIntervalSeconds: number | null;
		firstCutSeconds: number | null;
		sceneCutTimes: number[];
	};
	transitions: {
		style: string;
		density: "sparse" | "medium" | "dense";
		firstCutSeconds: number | null;
		cutTimes: number[];
		rules: string[];
	};
	subtitles: {
		position: string;
		sizePreset: string;
		backgroundStyle: string;
		accentColor: string;
		safeZone: string;
		collisionRisk: SubtitleCollisionRisk;
	};
	audio: {
		voiceToneKeywords: string[];
		ttsSpeed: number;
		bgmMood: string;
		bgmKeywords: string[];
		bgmTempo: string;
		volumeMeanDb: number | null;
		volumeMaxDb: number | null;
		integratedLufs: number | null;
		loudnessRangeLu: number | null;
	};
	frames: ReferencePixelFrameMetrics[];
	copyBoundary: {
		rawAssetsReusable: false;
		allowedUse: string;
	};
}

export interface ProductionDnaAnalysisFields {
	dominant_colors?: unknown;
	visual_mood?: unknown;
	lighting_style?: unknown;
	subtitle_position?: unknown;
	subtitle_size_preset?: unknown;
	subtitle_bg_style?: unknown;
	subtitle_accent_color?: unknown;
	transition_style?: unknown;
	tts_tone_keywords?: unknown;
	tts_speed?: unknown;
	bgm_mood?: unknown;
	bgm_keywords?: unknown;
	bgm_tempo?: unknown;
	camera_mode?: unknown;
	camera_motion?: unknown;
	layout_pattern?: unknown;
	subject_placement?: unknown;
	text_zones?: unknown;
	transition_rules?: unknown;
	voice_delivery?: unknown;
}

export interface AnalyzeReferenceProductionDnaParams {
	framePaths: string[];
	durationSeconds: number;
	analysis: ProductionDnaAnalysisFields;
	frameProfile: RenderReferenceProfile | null;
	frameQcReport: RenderOutputQcReport | null;
}

export interface BuildProductionDnaParams {
	analysisDepth: ReferenceAnalysisDepth;
	pixelPrecisionAvailable: boolean;
	durationSeconds: number;
	analysis: ProductionDnaAnalysisFields;
	frameProfile: RenderReferenceProfile | null;
	frameQcReport: RenderOutputQcReport | null;
	frames: ReferencePixelFrameMetrics[];
	fallbackCutTimes?: number[];
}

export function inferReferenceCameraMode(input: {
	cutDensityPerMinute: number;
	avgDiff: number;
	first3AvgDiff: number;
}): ReferenceCameraMode {
	const cutDensity = input.cutDensityPerMinute;
	const avgDiff = input.avgDiff;
	const hookDiff = input.first3AvgDiff;
	if (cutDensity >= 18) return "cut_driven";
	if (avgDiff < 0.012 && hookDiff < 0.012 && cutDensity < 4) return "static";
	if (avgDiff >= 0.05 && cutDensity < 10) return "handheld";
	if (avgDiff >= 0.018 && cutDensity < 8) return "slow_push";
	if (cutDensity >= 8 || hookDiff >= 0.035) return "mixed";
	return "static";
}

export function buildReferenceProductionDna(
	params: BuildProductionDnaParams,
): ReferenceProductionDna {
	const profile = params.frameProfile;
	const metrics = params.frameQcReport?.metrics;
	const avgFrame = averageFrameMetrics(params.frames);
	const cutTimes =
		profile?.sceneCuts.times.slice(0, 40) ??
		params.fallbackCutTimes?.slice(0, 40) ??
		[];
	const cutDensity =
		profile?.cutDensityPerMinute ??
		estimateCutDensity(cutTimes.length, params.durationSeconds);
	const avgCutInterval =
		profile?.avgCutIntervalSeconds ??
		(cutTimes.length > 0
			? round(params.durationSeconds / cutTimes.length, 2)
			: null);
	const avgDiff = profile?.fullFrame.avgDiff ?? 0;
	const first3AvgDiff = profile?.fullFrame.first3AvgDiff ?? 0;
	const cameraMode = inferReferenceCameraMode({
		cutDensityPerMinute: cutDensity,
		avgDiff,
		first3AvgDiff,
	});
	const collisionRisk = maxCollisionRisk(
		params.frames.map((frame) => frame.subtitleBandRisk),
	);
	const dominantSubject = mostFrequent(
		params.frames.map((frame) => frame.subjectZone),
		"inferred_center",
	);
	const subjectPlacement =
		stringField(params.analysis.subject_placement) || dominantSubject;
	const textSafeZones = stringArray(params.analysis.text_zones);
	const transitionRules = stringArray(params.analysis.transition_rules);
	const transitionStyle =
		stringField(params.analysis.transition_style) || inferTransitionStyle(cutDensity);
	const subtitlePosition =
		stringField(params.analysis.subtitle_position) || "bottom";

	return {
		version: "production-dna-v1",
		analysisDepth: params.analysisDepth,
		pixelPrecisionAvailable: params.pixelPrecisionAvailable,
		mood: {
			visualMood: stringField(params.analysis.visual_mood) || "neutral",
			atmosphere: [
				...stringArray(params.analysis.voice_delivery),
				...stringArray(params.analysis.camera_motion),
			].slice(0, 6),
			lightingStyle: stringField(params.analysis.lighting_style) || "natural",
		},
		color: {
			dominantColors: stringArray(params.analysis.dominant_colors).slice(0, 8),
			brightness: avgFrame.brightness,
			contrast: avgFrame.contrast,
			saturation: avgFrame.saturation,
			warmth: avgFrame.warmth,
			temperature:
				avgFrame.warmth >= 0.56
					? "warm"
					: avgFrame.warmth <= 0.46
						? "cool"
						: "neutral",
		},
		layout: {
			frameSize: profile
				? { width: profile.width, height: profile.height }
				: metrics?.video
					? { width: metrics.video.width, height: metrics.video.height }
					: null,
			aspectRatio:
				profile?.aspectRatio ??
				(metrics?.video?.height
					? round(metrics.video.width / metrics.video.height, 4)
					: null),
			compositionPattern:
				stringField(params.analysis.layout_pattern) ||
				compositionPatternFromZone(subjectPlacement),
			subjectZone: subjectPlacement,
			textSafeZones:
				textSafeZones.length > 0
					? textSafeZones
					: inferTextSafeZones(subjectPlacement, subtitlePosition, collisionRisk),
			subtitleCollisionRisk: collisionRisk,
		},
		camera: {
			mode: stringToCameraMode(params.analysis.camera_mode) ?? cameraMode,
			motionIntensity: round(clamp(avgDiff * 18, 0, 1), 3),
			first3Motion: round(clamp(first3AvgDiff * 18, 0, 1), 3),
			cutDensityPerMinute: round(cutDensity, 2),
			avgCutIntervalSeconds: avgCutInterval,
			firstCutSeconds: cutTimes[0] ?? null,
			sceneCutTimes: cutTimes,
		},
		transitions: {
			style: transitionStyle,
			density:
				cutDensity >= 18 ? "dense" : cutDensity >= 7 ? "medium" : "sparse",
			firstCutSeconds: cutTimes[0] ?? null,
			cutTimes,
			rules:
				transitionRules.length > 0
					? transitionRules
					: defaultTransitionRules(transitionStyle, cutDensity),
		},
		subtitles: {
			position: subtitlePosition,
			sizePreset: stringField(params.analysis.subtitle_size_preset) || "md",
			backgroundStyle: stringField(params.analysis.subtitle_bg_style) || "stroke",
			accentColor: stringField(params.analysis.subtitle_accent_color) || "#FFD700",
			safeZone: subtitleSafeZone(subtitlePosition, collisionRisk),
			collisionRisk,
		},
		audio: {
			voiceToneKeywords: stringArray(params.analysis.tts_tone_keywords),
			ttsSpeed: numberField(params.analysis.tts_speed, 1),
			bgmMood: stringField(params.analysis.bgm_mood) || "",
			bgmKeywords: stringArray(params.analysis.bgm_keywords),
			bgmTempo: stringField(params.analysis.bgm_tempo) || "mid",
			volumeMeanDb: profile?.volume?.meanDb ?? metrics?.volume.meanDb ?? null,
			volumeMaxDb: profile?.volume?.maxDb ?? metrics?.volume.maxDb ?? null,
			integratedLufs:
				profile?.loudness?.integratedLufs ??
				metrics?.loudness.integratedLufs ??
				null,
			loudnessRangeLu:
				profile?.loudness?.loudnessRangeLu ??
				metrics?.loudness.loudnessRangeLu ??
				null,
		},
		frames: params.frames,
		copyBoundary: {
			rawAssetsReusable: false,
			allowedUse:
				"Use only layout, pacing, camera, subtitle, voice and BGM rules. Do not reuse source frames, music, speech, or exact script.",
		},
	};
}

export async function analyzeReferenceProductionDna(
	params: AnalyzeReferenceProductionDnaParams,
): Promise<ReferenceProductionDna> {
	const frames = (
		await Promise.all(
			params.framePaths.map((framePath, index) =>
				analyzePixelFrame(framePath, index + 1),
			),
		)
	).filter((frame): frame is ReferencePixelFrameMetrics => Boolean(frame));
	return buildReferenceProductionDna({
		analysisDepth: "pixel_frame_audio_edit",
		pixelPrecisionAvailable: frames.length > 0,
		durationSeconds: params.durationSeconds,
		analysis: params.analysis,
		frameProfile: params.frameProfile,
		frameQcReport: params.frameQcReport,
		frames,
	});
}

export function buildMetadataProductionDna(params: {
	durationSeconds: number;
	sceneCount: number;
	avgSceneDuration: number;
	hookDuration: number;
	analysis: ProductionDnaAnalysisFields;
	chapterCutTimes?: number[];
}): ReferenceProductionDna {
	const cutTimes = params.chapterCutTimes?.slice(0, 40) ?? [];
	return buildReferenceProductionDna({
		analysisDepth: "metadata_only",
		pixelPrecisionAvailable: false,
		durationSeconds: params.durationSeconds,
		analysis: {
			...params.analysis,
			layout_pattern:
				params.analysis.layout_pattern ?? "metadata_inferred_full_frame",
			subject_placement:
				params.analysis.subject_placement ?? "inferred_center",
			transition_rules:
				params.analysis.transition_rules ??
				[
					"챕터 전환은 문장 끝에서 hard cut 또는 짧은 crossfade",
					"인기 구간 전후에는 자료 컷 밀도를 높임",
					"롱폼은 발화 중간 컷 금지, 문장/문단 단위로 컷 정렬",
				],
		},
		frameProfile: {
			durationSeconds: params.durationSeconds,
			width: 1920,
			height: 1080,
			aspectRatio: 1.7778,
			fps: 30,
			visualRegion: {
				frameCount: 0,
				avgDiff: 0.02,
				maxDiff: 0.04,
				meaningfulDiffs: 0,
				strongDiffs: 0,
				first3AvgDiff: 0.018,
			},
			fullFrame: {
				frameCount: 0,
				avgDiff: 0.02,
				maxDiff: 0.04,
				meaningfulDiffs: 0,
				strongDiffs: 0,
				first3AvgDiff: 0.018,
			},
			sceneCuts: {
				selectedFrames: params.sceneCount,
				estimatedCuts: params.sceneCount,
				times: cutTimes,
			},
			cutDensityPerMinute: estimateCutDensity(
				params.sceneCount,
				params.durationSeconds,
			),
			avgCutIntervalSeconds: params.avgSceneDuration,
		},
		frameQcReport: null,
		frames: [],
		fallbackCutTimes: cutTimes,
	});
}

function execFileBuffer(command: string, args: string[]): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{
				encoding: "buffer",
				maxBuffer: 4 * 1024 * 1024,
				timeout: 15_000,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${command} failed: ${String(stderr || error.message)}`));
					return;
				}
				resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
			},
		);
	});
}

async function analyzePixelFrame(
	framePath: string,
	index: number,
): Promise<ReferencePixelFrameMetrics | null> {
	try {
		const buffer = await execFileBuffer("ffmpeg", [
			"-v",
			"error",
			"-i",
			framePath,
			"-vf",
			`scale=${SAMPLE_SIZE}:${SAMPLE_SIZE},format=rgb24`,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"pipe:1",
		]);
		if (buffer.length < SAMPLE_BYTES) return null;
		return computeFrameMetrics(buffer.subarray(0, SAMPLE_BYTES), framePath, index);
	} catch {
		return null;
	}
}

function computeFrameMetrics(
	buffer: Buffer,
	path: string,
	index: number,
): ReferencePixelFrameMetrics {
	const cells = Array.from({ length: 9 }, (_, cellIndex) => ({
		zone: zoneName(cellIndex),
		brightness: 0,
		saturation: 0,
		edgeDensity: 0,
		count: 0,
	}));
	const luminance = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE);
	let brightnessSum = 0;
	let saturationSum = 0;
	let warmthSum = 0;
	for (let y = 0; y < SAMPLE_SIZE; y++) {
		for (let x = 0; x < SAMPLE_SIZE; x++) {
			const pixelIndex = y * SAMPLE_SIZE + x;
			const offset = pixelIndex * 3;
			const r = buffer[offset] ?? 0;
			const g = buffer[offset + 1] ?? 0;
			const b = buffer[offset + 2] ?? 0;
			const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
			const max = Math.max(r, g, b);
			const min = Math.min(r, g, b);
			const saturation = max === 0 ? 0 : (max - min) / max;
			const warmth = (r - b + 255) / 510;
			luminance[pixelIndex] = lum;
			brightnessSum += lum;
			saturationSum += saturation;
			warmthSum += warmth;
			const cell = cells[cellIndexFor(x, y)];
			cell.brightness += lum;
			cell.saturation += saturation;
			cell.count += 1;
		}
	}
	let contrastSum = 0;
	let edgeSum = 0;
	let edgeCount = 0;
	const brightness = brightnessSum / (SAMPLE_SIZE * SAMPLE_SIZE);
	for (let y = 0; y < SAMPLE_SIZE; y++) {
		for (let x = 0; x < SAMPLE_SIZE; x++) {
			const pixelIndex = y * SAMPLE_SIZE + x;
			const lum = luminance[pixelIndex] ?? 0;
			contrastSum += (lum - brightness) ** 2;
			if (x < SAMPLE_SIZE - 1) {
				const diff = Math.abs(lum - (luminance[pixelIndex + 1] ?? lum));
				edgeSum += diff;
				cells[cellIndexFor(x, y)].edgeDensity += diff;
				edgeCount += 1;
			}
			if (y < SAMPLE_SIZE - 1) {
				const diff = Math.abs(lum - (luminance[pixelIndex + SAMPLE_SIZE] ?? lum));
				edgeSum += diff;
				cells[cellIndexFor(x, y)].edgeDensity += diff;
				edgeCount += 1;
			}
		}
	}
	const cellMap = cells.map((cell) => ({
		zone: cell.zone,
		brightness: round(cell.count ? cell.brightness / cell.count : 0, 3),
		saturation: round(cell.count ? cell.saturation / cell.count : 0, 3),
		edgeDensity: round(cell.count ? cell.edgeDensity / cell.count : 0, 3),
	}));
	const avgEdge = edgeCount ? edgeSum / edgeCount : 0;
	const subjectCell = [...cellMap].sort(
		(a, b) =>
			cellAttentionScore(b, brightness, avgEdge) -
			cellAttentionScore(a, brightness, avgEdge),
	)[0];
	return {
		index,
		path,
		brightness: round(brightness, 3),
		contrast: round(Math.sqrt(contrastSum / (SAMPLE_SIZE * SAMPLE_SIZE)), 3),
		saturation: round(saturationSum / (SAMPLE_SIZE * SAMPLE_SIZE), 3),
		warmth: round(warmthSum / (SAMPLE_SIZE * SAMPLE_SIZE), 3),
		edgeDensity: round(avgEdge, 3),
		subjectZone: subjectCell?.zone ?? "center",
		dominantTone: dominantTone(brightness),
		subtitleBandRisk: subtitleBandRisk(cellMap),
		cellMap,
	};
}

function cellIndexFor(x: number, y: number): number {
	const col = Math.min(2, Math.floor((x / SAMPLE_SIZE) * 3));
	const row = Math.min(2, Math.floor((y / SAMPLE_SIZE) * 3));
	return row * 3 + col;
}

function zoneName(index: number): string {
	return [
		"top_left",
		"top_center",
		"top_right",
		"middle_left",
		"center",
		"middle_right",
		"bottom_left",
		"bottom_center",
		"bottom_right",
	][index] ?? "center";
}

function cellAttentionScore(
	cell: { brightness: number; saturation: number; edgeDensity: number },
	avgBrightness: number,
	avgEdge: number,
): number {
	return (
		cell.edgeDensity * 0.58 +
		cell.saturation * 0.28 +
		Math.abs(cell.brightness - avgBrightness) * 0.14 +
		(avgEdge > 0 && cell.edgeDensity > avgEdge * 1.2 ? 0.08 : 0)
	);
}

function subtitleBandRisk(
	cellMap: Array<{ zone: string; brightness: number; saturation: number; edgeDensity: number }>,
): SubtitleCollisionRisk {
	const bottom = cellMap.filter((cell) => cell.zone.startsWith("bottom"));
	const avgEdge = average(cellMap.map((cell) => cell.edgeDensity));
	const bottomEdge = average(bottom.map((cell) => cell.edgeDensity));
	const bottomSat = average(bottom.map((cell) => cell.saturation));
	if (bottomEdge > avgEdge * 1.35 || bottomSat > 0.48) return "high";
	if (bottomEdge > avgEdge * 1.05 || bottomSat > 0.34) return "medium";
	return "low";
}

function averageFrameMetrics(frames: ReferencePixelFrameMetrics[]) {
	return {
		brightness: round(average(frames.map((frame) => frame.brightness)), 3),
		contrast: round(average(frames.map((frame) => frame.contrast)), 3),
		saturation: round(average(frames.map((frame) => frame.saturation)), 3),
		warmth: round(average(frames.map((frame) => frame.warmth)), 3),
	};
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

function mostFrequent(values: string[], fallback: string): string {
	const counts = new Map<string, number>();
	for (const value of values.filter(Boolean)) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return (
		[...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback
	);
}

function dominantTone(brightness: number): string {
	if (brightness < 0.28) return "low_key_dark";
	if (brightness > 0.72) return "high_key_bright";
	return "balanced_midtone";
}

function maxCollisionRisk(values: SubtitleCollisionRisk[]): SubtitleCollisionRisk {
	if (values.includes("high")) return "high";
	if (values.includes("medium")) return "medium";
	return "low";
}

function estimateCutDensity(cuts: number, durationSeconds: number): number {
	if (durationSeconds <= 0) return 0;
	return (cuts / durationSeconds) * 60;
}

function inferTransitionStyle(cutDensity: number): string {
	if (cutDensity >= 18) return "hardcut";
	if (cutDensity >= 7) return "mixed";
	return "crossfade";
}

function stringToCameraMode(value: unknown): ReferenceCameraMode | null {
	if (
		value === "static" ||
		value === "slow_push" ||
		value === "handheld" ||
		value === "cut_driven" ||
		value === "mixed"
	) {
		return value;
	}
	return null;
}

function compositionPatternFromZone(zone: string): string {
	if (zone.includes("top")) return "top_weighted_subject";
	if (zone.includes("bottom")) return "lower_third_subject";
	if (zone.includes("left") || zone.includes("right")) return "rule_of_thirds";
	return "center_weighted_subject";
}

function inferTextSafeZones(
	subjectZone: string,
	subtitlePosition: string,
	risk: SubtitleCollisionRisk,
): string[] {
	if (subtitlePosition === "top") return ["bottom_center", "middle_center"];
	if (risk === "high" && subjectZone.startsWith("bottom")) {
		return ["top_center", "middle_center"];
	}
	if (subjectZone === "center") return ["bottom_center_with_stroke"];
	return ["bottom_center", "top_center"];
}

function subtitleSafeZone(
	subtitlePosition: string,
	risk: SubtitleCollisionRisk,
): string {
	if (risk === "high" && subtitlePosition === "bottom") {
		return "raise_to_middle_or_use_strong_stroke";
	}
	if (subtitlePosition === "dynamic") return "avoid_subject_zone_per_scene";
	return `${subtitlePosition}_safe_area`;
}

function defaultTransitionRules(style: string, cutDensity: number): string[] {
	const rules = [
		"컷은 발화 중간이 아니라 문장 끝, 반전, 새 단서 등장 지점에 배치",
		"첫 3초 안에 제목/핵심 화면 변화가 최소 1번 발생해야 함",
	];
	if (style === "hardcut" || cutDensity >= 18) {
		rules.push("정보 전환은 hard cut 중심, 불필요한 crossfade 금지");
	} else if (style === "crossfade") {
		rules.push("감정/회상 전환은 8-14프레임 짧은 crossfade 사용");
	} else {
		rules.push("강조 지점은 punch zoom, 설명 지점은 hard cut/crossfade 혼합");
	}
	return rules;
}
