import { execFile } from "node:child_process";

const DEFAULT_WINDOW_SECONDS = 10;
const SAMPLE_FPS = 2;
const SAMPLE_SIZE = 32;
const FRAME_BYTES = SAMPLE_SIZE * SAMPLE_SIZE * 3;

export interface RenderOutputQcReport {
	file: string;
	score: number;
	verdict: "pass" | "revise" | "fail";
	passed: boolean;
	metrics: {
		durationSeconds: number;
		sizeBytes: number;
		bitRate: number;
		video: {
			codec?: string;
			width: number;
			height: number;
			fps: number;
			frames: number;
			bitRate: number;
		} | null;
		audio: {
			codec?: string;
			channels: number;
			sampleRate: number;
			bitRate: number;
		} | null;
		volume: {
			meanDb: number | null;
			maxDb: number | null;
		};
		loudness: LoudnessMetrics;
		visualRegion: DiffMetrics;
		fullFrame: DiffMetrics;
		sceneCuts: {
			selectedFrames: number;
			estimatedCuts: number;
			times: number[];
		};
		black: {
			segments: Array<{ start: number; end: number; duration: number }>;
			count: number;
		};
	};
	referenceComparison?: RenderReferenceComparison;
	strengths: string[];
	issues: string[];
	requiredActions: string[];
}

export interface DiffMetrics {
	frameCount: number;
	avgDiff: number;
	maxDiff: number;
	meaningfulDiffs: number;
	strongDiffs: number;
	first3AvgDiff: number;
	diffSeries?: Array<{ timeSeconds: number; diff: number }>;
}

export interface LoudnessMetrics {
	integratedLufs: number | null;
	loudnessRangeLu: number | null;
	truePeakDbfs: number | null;
}

export interface SceneCutMetrics {
	selectedFrames: number;
	estimatedCuts: number;
	times: number[];
}

export interface RenderReferenceProfile {
	durationSeconds: number;
	width: number;
	height: number;
	aspectRatio: number;
	fps: number;
	visualRegion: DiffMetrics;
	fullFrame: DiffMetrics;
	sceneCuts: SceneCutMetrics;
	cutDensityPerMinute: number;
	avgCutIntervalSeconds: number | null;
	volume?: {
		meanDb: number | null;
		maxDb: number | null;
	};
	loudness?: LoudnessMetrics;
}

export interface RenderReferenceComparison {
	score: number;
	passed: boolean;
	issues: string[];
	requiredActions: string[];
	metrics: {
		cutDensityRatio: number;
		visualMotionRatio: number;
		hookMotionRatio: number;
		strongDiffRatio: number;
		aspectDelta: number;
		loudnessDeltaLufs: number | null;
		referenceCutDensityPerMinute: number;
		generatedCutDensityPerMinute: number;
		referenceAvgCutIntervalSeconds: number | null;
		generatedAvgCutIntervalSeconds: number | null;
	};
}

interface ProbeStream {
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
	avg_frame_rate?: string;
	r_frame_rate?: string;
	duration?: string;
	nb_frames?: string;
	bit_rate?: string;
	channels?: number;
	sample_rate?: string;
}

interface ProbeJson {
	format?: {
		duration?: string;
		size?: string;
		bit_rate?: string;
	};
	streams?: ProbeStream[];
}

function run(
	command: string,
	args: string[],
	options: { encoding?: BufferEncoding | "buffer"; maxBuffer?: number } = {},
): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{
				encoding: options.encoding === "buffer" ? "buffer" : (options.encoding ?? "utf8"),
				maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${command} failed: ${stderr || error.message}`));
					return;
				}
				resolve({ stdout, stderr });
			},
		);
	});
}

function parseRational(value: string | undefined): number {
	const [a, b] = String(value ?? "0/1").split("/").map(Number);
	if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
	return a / b;
}

function average(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function safeRatio(numerator: number, denominator: number): number {
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 1;
	if (denominator <= 0) return numerator > 0 ? 1 : 1;
	return numerator / denominator;
}

function boundedRatioScore(ratio: number, fullAt = 1): number {
	return clamp(Math.round((ratio / fullAt) * 100), 0, 100);
}

function cutDensityPerMinute(cuts: number, durationSeconds: number): number {
	if (durationSeconds <= 0) return 0;
	return round((Math.max(0, cuts) / durationSeconds) * 60, 2);
}

function avgCutIntervalSeconds(cuts: number, durationSeconds: number): number | null {
	if (cuts <= 0 || durationSeconds <= 0) return null;
	return round(durationSeconds / cuts, 2);
}

async function probe(file: string) {
	const { stdout } = await run("ffprobe", [
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_format",
		"-show_streams",
		file,
	]);
	const parsed = JSON.parse(String(stdout)) as ProbeJson;
	const streams = parsed.streams ?? [];
	const video = streams.find((stream) => stream.codec_type === "video");
	const audio = streams.find((stream) => stream.codec_type === "audio");
	const duration =
		Number(parsed.format?.duration) ||
		Number(video?.duration) ||
		Number(audio?.duration) ||
		0;
	const fps = parseRational(video?.avg_frame_rate || video?.r_frame_rate);

	return {
		duration,
		sizeBytes: Number(parsed.format?.size) || 0,
		bitRate: Number(parsed.format?.bit_rate) || 0,
		video: video
			? {
					codec: video.codec_name,
					width: Number(video.width) || 0,
					height: Number(video.height) || 0,
					fps,
					frames: Number(video.nb_frames) || Math.round(duration * fps),
					bitRate: Number(video.bit_rate) || 0,
				}
			: null,
		audio: audio
			? {
					codec: audio.codec_name,
					channels: Number(audio.channels) || 0,
					sampleRate: Number(audio.sample_rate) || 0,
					bitRate: Number(audio.bit_rate) || 0,
				}
			: null,
	};
}

async function sampleDiffs(
	file: string,
	windowSeconds: number,
	visualOnly: boolean,
): Promise<DiffMetrics> {
	const vf = visualOnly
		? `fps=${SAMPLE_FPS},crop=iw:trunc(ih*0.62):0:0,scale=${SAMPLE_SIZE}:${SAMPLE_SIZE},format=rgb24`
		: `fps=${SAMPLE_FPS},scale=${SAMPLE_SIZE}:${SAMPLE_SIZE},format=rgb24`;
	const { stdout } = await run(
		"ffmpeg",
		[
			"-v",
			"error",
			"-t",
			String(windowSeconds),
			"-i",
			file,
			"-vf",
			vf,
			"-an",
			"-sn",
			"-dn",
			"-f",
			"rawvideo",
			"pipe:1",
		],
		{ encoding: "buffer" },
	);
	const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
	const frameCount = Math.floor(buffer.length / FRAME_BYTES);
	const diffs: number[] = [];
	for (let frameIndex = 1; frameIndex < frameCount; frameIndex++) {
		const prevOffset = (frameIndex - 1) * FRAME_BYTES;
		const nextOffset = frameIndex * FRAME_BYTES;
		let sum = 0;
		for (let i = 0; i < FRAME_BYTES; i++) {
			sum += Math.abs(buffer[prevOffset + i] - buffer[nextOffset + i]);
		}
		diffs.push(sum / FRAME_BYTES / 255);
	}
	return {
		frameCount,
		avgDiff: round(average(diffs), 5),
		maxDiff: round(diffs.length ? Math.max(...diffs) : 0, 5),
		meaningfulDiffs: diffs.filter((diff) => diff >= 0.035).length,
		strongDiffs: diffs.filter((diff) => diff >= 0.075).length,
		first3AvgDiff: round(
			average(diffs.slice(0, Math.max(1, SAMPLE_FPS * 3 - 1))),
			5,
		),
		diffSeries: diffs.map((diff, index) => ({
			timeSeconds: round((index + 1) / SAMPLE_FPS, 2),
			diff: round(diff, 5),
		})),
	};
}

async function detectSceneCuts(file: string, windowSeconds: number) {
	const { stderr } = await run("ffmpeg", [
		"-v",
		"info",
		"-t",
		String(windowSeconds),
		"-i",
		file,
		"-filter:v",
		"select='gt(scene,0.035)',showinfo",
		"-an",
		"-f",
		"null",
		"-",
	]);
	const times = [...String(stderr).matchAll(/pts_time:([0-9.]+)/g)].map((match) =>
		Number(match[1]),
	);
	return {
		selectedFrames: times.length,
		estimatedCuts: Math.max(0, times.length - 1),
		times,
	};
}

async function detectBlack(file: string) {
	const { stderr } = await run("ffmpeg", [
		"-v",
		"info",
		"-i",
		file,
		"-vf",
		"blackdetect=d=0.3:pix_th=0.10",
		"-an",
		"-f",
		"null",
		"-",
	]);
	const segments = [
		...String(stderr).matchAll(
			/black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g,
		),
	].map((match) => ({
		start: Number(match[1]),
		end: Number(match[2]),
		duration: Number(match[3]),
	}));
	return { segments, count: segments.length };
}

async function detectVolume(file: string) {
	const { stderr } = await run("ffmpeg", [
		"-v",
		"info",
		"-i",
		file,
		"-af",
		"volumedetect",
		"-vn",
		"-sn",
		"-dn",
		"-f",
		"null",
		"-",
	]);
	const text = String(stderr);
	return {
		meanDb: parseDb(text, /mean_volume:\s*(-?[0-9.]+)\s*dB/),
		maxDb: parseDb(text, /max_volume:\s*(-?[0-9.]+)\s*dB/),
	};
}

async function detectLoudness(file: string): Promise<LoudnessMetrics> {
	const { stderr } = await run("ffmpeg", [
		"-v",
		"info",
		"-i",
		file,
		"-filter_complex",
		"ebur128=peak=true",
		"-vn",
		"-sn",
		"-dn",
		"-f",
		"null",
		"-",
	]);
	const text = String(stderr);
	const summary = text.slice(Math.max(0, text.lastIndexOf("Summary:")));
	return {
		integratedLufs: parseDb(summary, /I:\s*(-?[0-9.]+)\s*LUFS/),
		loudnessRangeLu: parseDb(summary, /LRA:\s*([0-9.]+)\s*LU/),
		truePeakDbfs: parseDb(summary, /Peak:\s*(-?[0-9.]+)\s*dBFS/),
	};
}

function parseDb(text: string, regex: RegExp): number | null {
	const match = text.match(regex);
	return match ? Number(match[1]) : null;
}

function verdictFor(score: number, issues: string[]): RenderOutputQcReport["verdict"] {
	if (score >= 85 && issues.length === 0) return "pass";
	return score >= 65 ? "revise" : "fail";
}

export function profileFromRenderOutputQc(
	report: Pick<RenderOutputQcReport, "metrics">,
): RenderReferenceProfile {
	const video = report.metrics.video;
	const width = video?.width ?? 0;
	const height = video?.height ?? 0;
	const durationSeconds = report.metrics.durationSeconds;
	const cuts = report.metrics.sceneCuts.estimatedCuts;
	return {
		durationSeconds,
		width,
		height,
		aspectRatio: height > 0 ? round(width / height, 4) : 0,
		fps: video?.fps ?? 0,
		visualRegion: report.metrics.visualRegion,
		fullFrame: report.metrics.fullFrame,
		sceneCuts: report.metrics.sceneCuts,
		cutDensityPerMinute: cutDensityPerMinute(cuts, durationSeconds),
		avgCutIntervalSeconds: avgCutIntervalSeconds(cuts, durationSeconds),
		volume: report.metrics.volume,
		loudness: report.metrics.loudness,
	};
}

export function isRenderReferenceProfile(
	value: unknown,
): value is RenderReferenceProfile {
	if (!value || typeof value !== "object") return false;
	const profile = value as Partial<RenderReferenceProfile>;
	return (
		typeof profile.durationSeconds === "number" &&
		typeof profile.cutDensityPerMinute === "number" &&
		typeof profile.visualRegion?.avgDiff === "number" &&
		typeof profile.visualRegion?.first3AvgDiff === "number" &&
		typeof profile.sceneCuts?.estimatedCuts === "number"
	);
}

export function compareRenderToReference(
	generated: RenderReferenceProfile,
	reference: RenderReferenceProfile,
): RenderReferenceComparison {
	const cutDensityRatio = safeRatio(
		generated.cutDensityPerMinute,
		reference.cutDensityPerMinute,
	);
	const visualMotionRatio = safeRatio(
		generated.visualRegion.avgDiff,
		reference.visualRegion.avgDiff,
	);
	const hookMotionRatio = safeRatio(
		generated.visualRegion.first3AvgDiff,
		reference.visualRegion.first3AvgDiff,
	);
	const strongDiffRatio = safeRatio(
		generated.visualRegion.strongDiffs,
		reference.visualRegion.strongDiffs,
	);
	const aspectDelta = Math.abs(generated.aspectRatio - reference.aspectRatio);
	const loudnessDeltaLufs =
		generated.loudness?.integratedLufs !== null &&
		generated.loudness?.integratedLufs !== undefined &&
		reference.loudness?.integratedLufs !== null &&
		reference.loudness?.integratedLufs !== undefined
			? round(
					Math.abs(
						generated.loudness.integratedLufs -
							reference.loudness.integratedLufs,
					),
					2,
				)
			: null;

	const issues: string[] = [];
	const referenceTooStatic =
		reference.cutDensityPerMinute < 3 &&
		reference.visualRegion.avgDiff < 0.012 &&
		reference.visualRegion.first3AvgDiff < 0.012;
	if (referenceTooStatic) {
		issues.push("reference_profile_too_static");
	}
	if (reference.cutDensityPerMinute >= 6 && cutDensityRatio < 0.7) {
		issues.push("reference_cut_density_gap");
	}
	if (reference.visualRegion.first3AvgDiff >= 0.02 && hookMotionRatio < 0.72) {
		issues.push("reference_hook_motion_gap");
	}
	if (reference.visualRegion.avgDiff >= 0.025 && visualMotionRatio < 0.72) {
		issues.push("reference_visual_motion_gap");
	}
	if (reference.visualRegion.strongDiffs >= 2 && strongDiffRatio < 0.55) {
		issues.push("reference_strong_cut_gap");
	}
	if (reference.aspectRatio > 0 && generated.aspectRatio > 0 && aspectDelta > 0.08) {
		issues.push("reference_aspect_mismatch");
	}
	if (loudnessDeltaLufs !== null && loudnessDeltaLufs > 4) {
		issues.push("reference_audio_loudness_gap");
	}

	const cutScore = boundedRatioScore(cutDensityRatio, 0.95);
	const hookScore = boundedRatioScore(hookMotionRatio, 0.95);
	const motionScore = boundedRatioScore(visualMotionRatio, 0.95);
	const strongScore = boundedRatioScore(strongDiffRatio, 0.8);
	const aspectScore = aspectDelta <= 0.08 ? 100 : clamp(Math.round(100 - aspectDelta * 300), 0, 100);
	const loudnessScore =
		loudnessDeltaLufs === null ? 80 : clamp(Math.round(100 - loudnessDeltaLufs * 12), 0, 100);
	const rawScore = Math.round(
		cutScore * 0.26 +
			hookScore * 0.24 +
			motionScore * 0.2 +
			strongScore * 0.12 +
			aspectScore * 0.1 +
			loudnessScore * 0.08,
	);
	const score = referenceTooStatic ? Math.min(rawScore, 60) : rawScore;
	const required = referenceRequiredActions(issues);

	return {
		score,
		passed: score >= 82 && issues.length === 0,
		issues,
		requiredActions: required,
		metrics: {
			cutDensityRatio: round(cutDensityRatio, 3),
			visualMotionRatio: round(visualMotionRatio, 3),
			hookMotionRatio: round(hookMotionRatio, 3),
			strongDiffRatio: round(strongDiffRatio, 3),
			aspectDelta: round(aspectDelta, 4),
			loudnessDeltaLufs,
			referenceCutDensityPerMinute: reference.cutDensityPerMinute,
			generatedCutDensityPerMinute: generated.cutDensityPerMinute,
			referenceAvgCutIntervalSeconds: reference.avgCutIntervalSeconds,
			generatedAvgCutIntervalSeconds: generated.avgCutIntervalSeconds,
		},
	};
}

function referenceRequiredActions(issues: string[]): string[] {
	const actions: string[] = [];
	if (issues.includes("reference_cut_density_gap")) {
		actions.push("레퍼런스 대비 컷 밀도가 낮습니다. 기준 영상의 컷/분에 맞춰 샷 수를 늘리고 1~3초 단위 삽입 컷을 추가하세요.");
	}
	if (issues.includes("reference_hook_motion_gap")) {
		actions.push("첫 3초 변화량이 레퍼런스보다 약합니다. 시작부에 현장 영상, 문서 클로즈업, 지도 줌인 중 2개 이상을 배치하세요.");
	}
	if (issues.includes("reference_visual_motion_gap")) {
		actions.push("전체 프레임 변화량이 레퍼런스보다 낮습니다. 정지 이미지 유지 시간을 줄이고 pan/zoom/trimmed video 컷을 더 촘촘히 섞으세요.");
	}
	if (issues.includes("reference_strong_cut_gap")) {
		actions.push("강한 전환/큰 화면 변화가 부족합니다. 반전 지점마다 hard cut, punch zoom, source card reveal을 추가하세요.");
	}
	if (issues.includes("reference_aspect_mismatch")) {
		actions.push("레퍼런스와 화면비가 다릅니다. 같은 주제 비교는 쇼츠 9:16끼리, 롱폼 16:9끼리 맞춰 분석하세요.");
	}
	if (issues.includes("reference_audio_loudness_gap")) {
		actions.push("레퍼런스와 라우드니스 차이가 큽니다. TTS/BGM/SFX 버스를 기준 영상 LUFS에 더 가깝게 재믹스하세요.");
	}
	if (issues.includes("reference_profile_too_static")) {
		actions.push("이 레퍼런스는 프레임 변화량과 컷 밀도가 너무 낮아 기준 영상으로 부적합합니다. 실제 성공 쇼츠/롱폼처럼 컷 전환과 화면 변화가 있는 영상을 다시 선택하세요.");
	}
	return actions;
}

export function applyReferenceComparisonToReport(
	report: RenderOutputQcReport,
	referenceProfile?: RenderReferenceProfile,
): RenderOutputQcReport {
	if (!referenceProfile) return report;
	const comparison = compareRenderToReference(
		profileFromRenderOutputQc(report),
		referenceProfile,
	);
	const comparisonPenalty =
		comparison.score >= 82 ? 0 : Math.round((82 - comparison.score) * 0.35);
	const issuePenalty =
		comparison.issues.length > 0
			? Math.min(12, comparison.issues.length * 4)
			: 0;
	const score = clamp(
		report.score - Math.max(comparisonPenalty, issuePenalty),
		0,
		100,
	);
	const issues = [...new Set([...report.issues, ...comparison.issues])];
	const mergedRequiredActions = [
		...new Set([
			...report.requiredActions,
			...comparison.requiredActions,
			...requiredActions(comparison.issues),
		]),
	];
	const verdict = verdictFor(score, issues);
	return {
		...report,
		score,
		verdict,
		passed: verdict === "pass",
		referenceComparison: comparison,
		issues,
		requiredActions: mergedRequiredActions,
	};
}

export function buildRenderOutputQcReport(params: {
	file: string;
	meta: Awaited<ReturnType<typeof probe>>;
	visualDiff: DiffMetrics;
	fullDiff: DiffMetrics;
	sceneCuts: Awaited<ReturnType<typeof detectSceneCuts>>;
	black: Awaited<ReturnType<typeof detectBlack>>;
	volume: Awaited<ReturnType<typeof detectVolume>>;
	loudness?: LoudnessMetrics;
}): RenderOutputQcReport {
	const {
		file,
		meta,
		visualDiff,
		fullDiff,
		sceneCuts,
		black,
		volume,
		loudness = {
			integratedLufs: null,
			loudnessRangeLu: null,
			truePeakDbfs: null,
		},
	} = params;
	const issues: string[] = [];
	const strengths: string[] = [];
	const vertical = meta.video?.width === 1080 && meta.video?.height === 1920;
	const horizontal = meta.video?.width === 1920 && meta.video?.height === 1080;
	const supportedCanvas = vertical || horizontal;
	const fpsOk = Boolean(meta.video && meta.video.fps >= 23.9 && meta.video.fps <= 60.1);
	const hasAudio = Boolean(meta.audio);
	const audioLevelOk =
		hasAudio &&
		volume.meanDb !== null &&
		volume.meanDb >= -28 &&
		volume.meanDb <= -12 &&
		volume.maxDb !== null &&
		volume.maxDb <= -1;
	const loudnessMeasured = loudness.integratedLufs !== null;
	const loudnessOk =
		!loudnessMeasured ||
		(loudness.integratedLufs !== null &&
			loudness.integratedLufs >= -21 &&
			loudness.integratedLufs <= -13.5);
	const truePeakOk =
		loudness.truePeakDbfs === null || loudness.truePeakDbfs <= -1;
	const dynamicRangeOk =
		loudness.loudnessRangeLu === null || loudness.loudnessRangeLu <= 14;
	const visualDynamic =
		visualDiff.avgDiff >= 0.028 ||
		visualDiff.strongDiffs >= 2 ||
		sceneCuts.estimatedCuts >= 2;
	const hookDynamic =
		visualDiff.first3AvgDiff >= 0.026 ||
		fullDiff.first3AvgDiff >= 0.035 ||
		sceneCuts.times.some((time) => time > 0.4 && time <= 3.2);
	const pacingOk =
		sceneCuts.estimatedCuts >= Math.max(1, Math.floor(Math.min(meta.duration, 10) / 4)) ||
		visualDiff.meaningfulDiffs >= Math.max(3, Math.floor(visualDiff.frameCount / 3));
	const noBlack = black.count === 0;

	let score = 0;
	score += supportedCanvas ? 15 : 5;
	score += fpsOk ? 8 : 2;
	score += meta.duration >= 4 ? 7 : 2;
	score += hasAudio ? 10 : 0;
	score += audioLevelOk ? 10 : hasAudio ? 5 : 0;
	score += loudnessMeasured
		? loudnessOk && truePeakOk && dynamicRangeOk
			? 5
			: hasAudio
				? 1
				: 0
		: 0;
	score += noBlack ? 10 : 0;
	score += visualDynamic ? 18 : clamp(Math.round(visualDiff.avgDiff * 350), 0, 10);
	score += hookDynamic ? 14 : clamp(Math.round(visualDiff.first3AvgDiff * 260), 0, 7);
	score += pacingOk ? 8 : clamp(sceneCuts.estimatedCuts * 2 + visualDiff.meaningfulDiffs, 0, 5);

	if (supportedCanvas) strengths.push("platform_canvas_ok");
	else issues.push("canvas_not_platform_ready");
	if (!fpsOk) issues.push("fps_out_of_range");
	if (!hasAudio) issues.push("missing_audio");
	else if (audioLevelOk && loudnessOk && truePeakOk && dynamicRangeOk) {
		strengths.push("audio_stream_and_level_ok");
	} else issues.push("audio_level_needs_mix");
	if (hasAudio && loudnessMeasured && !loudnessOk) {
		issues.push("audio_loudness_needs_master");
	}
	if (hasAudio && !truePeakOk) issues.push("audio_true_peak_too_hot");
	if (hasAudio && !dynamicRangeOk) issues.push("audio_too_dynamic_for_mobile");
	if (!noBlack) issues.push("black_segment_detected");
	if (!visualDynamic) issues.push("low_visual_variation");
	if (!hookDynamic) issues.push("weak_opening_hook");
	if (!pacingOk) issues.push("low_cut_density");

	const roundedScore = clamp(Math.round(score), 0, 100);
	const verdict = verdictFor(roundedScore, issues);

	return {
		file,
		score: roundedScore,
		verdict,
		passed: verdict === "pass",
		metrics: {
			durationSeconds: round(meta.duration, 3),
			sizeBytes: meta.sizeBytes,
			bitRate: meta.bitRate,
			video: meta.video,
			audio: meta.audio,
			volume,
			loudness,
			visualRegion: visualDiff,
			fullFrame: fullDiff,
			sceneCuts,
			black,
		},
		strengths,
		issues,
		requiredActions: requiredActions(issues),
	};
}

function requiredActions(issues: string[]): string[] {
	const actions: string[] = [];
	if (issues.includes("low_visual_variation")) {
		actions.push("첫 10초에 서로 다른 원본 영상/이미지/문서 컷을 최소 3개 이상 배치하세요.");
	}
	if (issues.includes("weak_opening_hook")) {
		actions.push("첫 3초에 후킹 컷, 증거 컷, 지도/문서 컷 중 최소 2개 비트를 넣으세요.");
	}
	if (issues.includes("low_cut_density")) {
		actions.push("컷 간격을 2~4초로 줄이고 punch/reveal/whoosh SFX 큐와 컷을 맞추세요.");
	}
	if (issues.includes("missing_audio")) {
		actions.push("연속 TTS, BGM, 컷 SFX를 렌더 입력에 포함하세요.");
	}
	if (issues.includes("audio_level_needs_mix")) {
		actions.push("TTS 평균 -22~-16 LUFS 상당, 피크 -3~-1 dB 근처로 재믹스하세요.");
	}
	if (issues.includes("audio_loudness_needs_master")) {
		actions.push("최종 믹스를 통합 라우드니스 -18~-14 LUFS 근처로 맞추고 BGM은 음성보다 뒤에 배치하세요.");
	}
	if (issues.includes("audio_true_peak_too_hot")) {
		actions.push("마스터 리미터를 적용해 True Peak를 -1 dBFS 이하로 제한하세요.");
	}
	if (issues.includes("audio_too_dynamic_for_mobile")) {
		actions.push("모바일 시청 기준으로 음성 압축/덕킹을 보강해 LRA를 14 LU 이하로 줄이세요.");
	}
	if (issues.includes("black_segment_detected")) {
		actions.push("빈 asset/fallback/엔딩 fade 구간을 확인하고 검은 화면 지속 시간을 0.3초 미만으로 줄이세요.");
	}
	actions.push(...referenceRequiredActions(issues));
	return actions;
}

export async function evaluateRenderOutput(
	file: string,
	options: {
		windowSeconds?: number;
		referenceProfile?: RenderReferenceProfile;
	} = {},
): Promise<RenderOutputQcReport> {
	const meta = await probe(file);
	const windowSeconds = Math.min(
		options.windowSeconds ?? DEFAULT_WINDOW_SECONDS,
		Math.max(meta.duration, 0.1),
	);
	const [visualDiff, fullDiff, sceneCuts, black, volume, loudness] =
		await Promise.all([
			sampleDiffs(file, windowSeconds, true),
			sampleDiffs(file, windowSeconds, false),
			detectSceneCuts(file, windowSeconds),
			detectBlack(file),
			detectVolume(file).catch(() => ({ meanDb: null, maxDb: null })),
			detectLoudness(file).catch(() => ({
				integratedLufs: null,
				loudnessRangeLu: null,
				truePeakDbfs: null,
			})),
		]);
	const report = buildRenderOutputQcReport({
		file,
		meta,
		visualDiff,
		fullDiff,
		sceneCuts,
		black,
		volume,
		loudness,
	});
	return applyReferenceComparisonToReport(report, options.referenceProfile);
}
