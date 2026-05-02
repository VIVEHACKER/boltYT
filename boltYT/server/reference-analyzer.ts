/**
 * Reference Analyzer — 영상/쇼츠 URL 또는 파일을 분석해 스타일 템플릿 JSON 생성
 *
 * 실행: npx tsx server/reference-analyzer.ts
 *
 * 엔드포인트:
 *   POST /api/reference/analyze     — URL 또는 파일 경로로 분석 시작
 *   GET  /api/reference/job/:id     — 분석 상태/결과 조회
 *   GET  /health                    — 상태
 *
 * 파이프라인:
 *   1. yt-dlp: YouTube Shorts 다운로드 (또는 기존 파일)
 *   2. ffmpeg: 8장 균등 프레임 추출 + 오디오 분리 + 파형 샘플
 *   3. OpenAI Whisper: 스크립트+단어 타이밍
 *   4. OpenAI GPT-4o Vision: 프레임+스크립트 → 스타일 JSON
 *   5. 프레임 color quantization → 도미넌트 컬러
 */

import { execFile } from "node:child_process";
import {
	createReadStream,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { readFile, rm } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { loadEnv, validateEnv } from "./lib/env.ts";
import { createLogger } from "./lib/logger.ts";
import { enqueueProxyBuildBackground } from "./lib/proxy-enqueue.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";
import {
	analyzeReferenceProductionDna,
	buildMetadataProductionDna,
} from "./lib/reference-production-dna.ts";
import {
	evaluateRenderOutput,
	profileFromRenderOutputQc,
} from "./lib/render-output-qc.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";
import { createWorkerPool } from "./lib/worker-pool.ts";

const SERVICE = "reference-analyzer";
const log = createLogger(SERVICE);

loadEnv();
validateEnv(["OPENAI_API_KEY"], SERVICE);

const PORT = Number(process.env.REFERENCE_PORT ?? 3460);
const WORK_DIR = join(import.meta.dirname ?? ".", ".tmp/reference");
if (!existsSync(WORK_DIR)) mkdirSync(WORK_DIR, { recursive: true });

// REFERENCE_ALLOWED_DIR 이 설정되면 그 디렉터리 내 파일만 분석 허용.
// 미설정 시 임의 경로 허용 (localhost-only 서버이므로 기본값은 관대하게 유지).
const REFERENCE_ALLOWED_DIR = process.env.REFERENCE_ALLOWED_DIR
	? resolve(process.env.REFERENCE_ALLOWED_DIR)
	: null;

/** 정밀 분석 가능 최대 영상 길이 (초). 프레임+Whisper+Vision 분석 전용 */
const MAX_DURATION_SECONDS = 180;

/** 다운로드 없이 메타데이터 기반으로 레퍼런스화할 수 있는 롱폼 최대 길이 */
const MAX_LONGFORM_REFERENCE_SECONDS = 3 * 60 * 60;

/** 긴 레퍼런스 deep 분석 시 실제로 뜯을 대표 구간 수와 구간 길이 */
const DEEP_SAMPLE_SEGMENT_SECONDS = Math.max(
	8,
	Math.min(45, Number(process.env.REFERENCE_DEEP_SAMPLE_SECONDS) || 24),
);
const DEEP_SAMPLE_SEGMENTS = Math.max(
	2,
	Math.min(8, Number(process.env.REFERENCE_DEEP_SAMPLE_SEGMENTS) || 5),
);

/** 분석 가능 최대 파일 크기 (바이트, 파일 업로드 시) */
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

/**
 * 동시 실행 가능한 분석 작업 수.
 * yt-dlp+ffmpeg+Whisper+GPT-4o 는 대부분 IO-bound 라 2-3 병렬 이점이 큼.
 * CPU 밀도 높은 워크로드면 REFERENCE_ANALYZER_CONCURRENCY env 로 낮춘다.
 */
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = Math.max(
	1,
	Math.min(
		8,
		Number(process.env.REFERENCE_ANALYZER_CONCURRENCY) || DEFAULT_CONCURRENCY,
	),
);

/** 전체 대기 가능한 최대 잡 수 (큐 오버플로우 방지) */
const MAX_QUEUE_SIZE = 20;

const execFileP = promisify(execFile);

// ─── 잡 큐 (메모리 + 디스크 영속) ───

type ReferenceAnalysisMode = "auto" | "shortform" | "longform" | "deep";

interface YouTubeChapter {
	start_time: number;
	end_time?: number;
	title: string;
}

interface YouTubeHeatmapPoint {
	start_time: number;
	end_time?: number;
	value: number;
}

interface YouTubeProbe {
	id: string;
	webpageUrl: string;
	duration: number;
	title: string;
	creator: string;
	thumbnail: string;
	description: string;
	categories: string[];
	tags: string[];
	chapters: YouTubeChapter[];
	heatmap: YouTubeHeatmapPoint[];
	subtitleLanguages: string[];
	automaticCaptionLanguages: string[];
}

interface DeepSampleWindow {
	index: number;
	start: number;
	end: number;
	reason: "hook" | "heatmap" | "chapter";
	score: number;
}

interface AnalysisJob {
	id: string;
	status:
		| "queued"
		| "downloading"
		| "extracting"
		| "transcribing"
		| "analyzing"
		| "complete"
		| "failed";
	progress: number;
	input: {
		type: "youtube" | "file";
		url?: string;
		filePath?: string;
		mode?: ReferenceAnalysisMode;
	};
	result?: ReferenceTemplateResult;
	error?: string;
	createdAt: string;
	completedAt?: string;
}

export interface ReferenceTemplateResult {
	source_type: "youtube" | "file";
	source_url: string;
	source_title: string;
	source_creator: string;
	thumbnail_url: string;
	duration_seconds: number;

	dominant_colors: string[];
	visual_mood: "horror" | "mystery" | "news" | "neutral" | "warm";
	visual_prompt_template: string;
	lighting_style: "dark" | "natural" | "bright" | "mixed";

	subtitle_position: "top" | "center" | "bottom" | "dynamic";
	subtitle_size_preset: "xs" | "sm" | "md" | "lg" | "xl";
	subtitle_bg_style: "none" | "pill" | "block" | "stroke" | "glow";
	subtitle_accent_color: string;

	scene_count: number;
	avg_scene_duration: number;
	hook_duration: number;
	transition_style: "hardcut" | "crossfade" | "zoom" | "mixed";
	pacing_preset: "fast" | "medium" | "slow";

	tts_voice_id: string;
	tts_provider: "openai" | "elevenlabs";
	tts_speed: number;
	tts_tone_keywords: string[];

	bgm_mood: string;
	bgm_keywords: string[];
	bgm_tempo: "slow" | "mid" | "fast";

	hook_pattern: "question" | "shock" | "claim" | "story";
	script_structure: Array<{ role: string; duration: number; note: string }>;

	transcript: string;
	frame_urls: string[];
	raw_analysis: Record<string, unknown>;
}

const QUEUE_FILE = join(WORK_DIR, ".jobs.json");
const jobs = new Map<string, AnalysisJob>();

function loadJobs() {
	try {
		if (!existsSync(QUEUE_FILE)) return;
		const raw = JSON.parse(readFileSync(QUEUE_FILE, "utf-8")) as AnalysisJob[];
		for (const j of raw) {
			// 중단된 작업은 failed 처리 (복구 복잡도 회피)
			if (j.status !== "complete" && j.status !== "failed") {
				j.status = "failed";
				j.error = "Server restarted mid-analysis";
			}
			jobs.set(j.id, j);
		}
	} catch {
		/* empty */
	}
}

let saveTimer: NodeJS.Timeout | null = null;
function saveJobs() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			writeFileSync(QUEUE_FILE, JSON.stringify([...jobs.values()], null, 2));
		} catch {
			/* empty */
		}
	}, 100);
}

loadJobs();

function generateJobId(): string {
	return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── yt-dlp: YouTube 다운로드 ───

/**
 * 메타데이터만 먼저 가져와 duration 등 조기 검증.
 * 다운로드 없이 메모리에서 JSON만 반환.
 */
async function probeYouTube(url: string): Promise<YouTubeProbe> {
	const { stdout } = await execFileP(
		"yt-dlp",
		[
			"--no-playlist",
			"--skip-download",
			"--dump-single-json",
			"--no-warnings",
			url,
		],
		{ timeout: 30_000, maxBuffer: 20 * 1024 * 1024 },
	);
	const info = JSON.parse(stdout) as {
		id?: string;
		webpage_url?: string;
		duration?: number;
		title?: string;
		uploader?: string;
		channel?: string;
		thumbnail?: string;
		description?: string;
		categories?: string[];
		tags?: string[];
		chapters?: Array<{
			start_time?: number;
			end_time?: number;
			title?: string;
		}>;
		heatmap?: Array<{
			start_time?: number;
			end_time?: number;
			value?: number;
		}>;
		subtitles?: Record<string, unknown>;
		automatic_captions?: Record<string, unknown>;
	};
	return {
		id: info.id ?? "",
		webpageUrl: info.webpage_url ?? url,
		duration: Number(info.duration) || 0,
		title: info.title ?? "",
		creator: info.channel ?? info.uploader ?? "",
		thumbnail: info.thumbnail ?? "",
		description: info.description ?? "",
		categories: Array.isArray(info.categories) ? info.categories : [],
		tags: Array.isArray(info.tags) ? info.tags : [],
		chapters: Array.isArray(info.chapters)
			? info.chapters
					.map((chapter) => ({
						start_time: Number(chapter.start_time) || 0,
						end_time:
							typeof chapter.end_time === "number"
								? chapter.end_time
								: undefined,
						title: chapter.title ?? "",
					}))
					.filter((chapter) => chapter.title.trim().length > 0)
			: [],
		heatmap: Array.isArray(info.heatmap)
			? info.heatmap
					.map((point) => ({
						start_time: Number(point.start_time) || 0,
						end_time:
							typeof point.end_time === "number" ? point.end_time : undefined,
						value: Number(point.value) || 0,
					}))
					.filter((point) => point.value > 0)
			: [],
		subtitleLanguages: info.subtitles ? Object.keys(info.subtitles) : [],
		automaticCaptionLanguages: info.automatic_captions
			? Object.keys(info.automatic_captions)
			: [],
	};
}

async function downloadYouTube(
	url: string,
	jobId: string,
	knownProbe?: YouTubeProbe,
): Promise<{
	filePath: string;
	title: string;
	creator: string;
	thumbnail: string;
	duration: number;
}> {
	const outDir = join(WORK_DIR, jobId);
	mkdirSync(outDir, { recursive: true });

	// 1. Duration guard (다운로드 전 조기 실패)
	const probe = knownProbe ?? (await probeYouTube(url));
	if (probe.duration <= 0) {
		throw new Error("영상 길이를 확인할 수 없습니다 (URL 또는 권한 확인)");
	}
	if (probe.duration > MAX_DURATION_SECONDS) {
		throw new Error(
			`영상이 너무 깁니다 (${Math.round(probe.duration)}초). 최대 ${MAX_DURATION_SECONDS}초까지만 분석 가능합니다.`,
		);
	}

	const outputTemplate = join(outDir, "video.%(ext)s");
	const metadataPath = join(outDir, "metadata.json");

	// 2. 본 다운로드: 720p mp4 최대, 메타데이터 포함
	await execFileP(
		"yt-dlp",
		[
			"-f",
			"best[height<=720][ext=mp4]/best[height<=720]/best",
			"--no-playlist",
			"--write-info-json",
			"--no-write-thumbnail",
			"--output",
			outputTemplate,
			"--quiet",
			"--no-warnings",
			url,
		],
		{ timeout: 180_000 },
	);

	// yt-dlp가 info.json을 video.info.json으로 저장
	const infoFile = join(outDir, "video.info.json");
	if (!existsSync(infoFile)) {
		// fallback: 디렉토리에서 .info.json 찾기
		throw new Error("yt-dlp did not produce info.json");
	}

	const info = JSON.parse(readFileSync(infoFile, "utf-8")) as {
		title?: string;
		uploader?: string;
		channel?: string;
		thumbnail?: string;
		duration?: number;
		_filename?: string;
	};

	// 실제 비디오 파일 확장자 확인
	const ext = ["mp4", "webm", "mkv"].find((e) =>
		existsSync(join(outDir, `video.${e}`)),
	);
	if (!ext) throw new Error("Downloaded video file not found");

	// metadata 저장 (디버깅용)
	writeFileSync(metadataPath, JSON.stringify(info, null, 2));

	return {
		filePath: join(outDir, `video.${ext}`),
		title: info.title ?? "",
		creator: info.channel ?? info.uploader ?? "",
		thumbnail: info.thumbnail ?? "",
		duration: info.duration ?? 0,
	};
}

function formatSectionTime(seconds: number): string {
	const safe = Math.max(0, seconds);
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const wholeSeconds = Math.floor(safe % 60);
	return [hours, minutes, wholeSeconds]
		.map((part) => part.toString().padStart(2, "0"))
		.join(":");
}

function clampSampleWindow(
	centerSeconds: number,
	durationSeconds: number,
	reason: DeepSampleWindow["reason"],
	score: number,
): Omit<DeepSampleWindow, "index"> {
	const segment = Math.min(DEEP_SAMPLE_SEGMENT_SECONDS, durationSeconds);
	const maxStart = Math.max(0, durationSeconds - segment);
	const start = Math.max(0, Math.min(maxStart, centerSeconds - segment / 2));
	return {
		start: Math.round(start * 100) / 100,
		end: Math.round(Math.min(durationSeconds, start + segment) * 100) / 100,
		reason,
		score,
	};
}

function selectDeepSampleWindows(probe: YouTubeProbe): DeepSampleWindow[] {
	const candidates: Array<Omit<DeepSampleWindow, "index">> = [
		{
			start: 0,
			end: Math.min(DEEP_SAMPLE_SEGMENT_SECONDS, probe.duration),
			reason: "hook",
			score: 1,
		},
	];
	for (const point of topHeatmapPeaks(probe.heatmap).slice(0, 6)) {
		candidates.push(
			clampSampleWindow(point.start_time, probe.duration, "heatmap", point.value),
		);
	}
	for (const [index, chapter] of probe.chapters.slice(0, 8).entries()) {
		candidates.push(
			clampSampleWindow(
				chapter.start_time,
				probe.duration,
				"chapter",
				0.75 - index * 0.03,
			),
		);
	}

	const deduped: Array<Omit<DeepSampleWindow, "index">> = [];
	for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
		if (candidate.end - candidate.start < 4) continue;
		const overlaps = deduped.some(
			(existing) =>
				Math.abs(existing.start - candidate.start) <
				DEEP_SAMPLE_SEGMENT_SECONDS * 0.7,
		);
		if (!overlaps) deduped.push(candidate);
		if (deduped.length >= DEEP_SAMPLE_SEGMENTS) break;
	}

	return deduped
		.sort((a, b) => a.start - b.start)
		.map((window, index) => ({ ...window, index: index + 1 }));
}

function findDownloadedSegment(outDir: string, prefix: string): string | null {
	const extensions = ["mp4", "webm", "mkv", "mov", "m4v"];
	for (const ext of extensions) {
		const candidate = join(outDir, `${prefix}.${ext}`);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

async function downloadYouTubeSection(
	url: string,
	jobId: string,
	window: DeepSampleWindow,
): Promise<string | null> {
	const outDir = join(WORK_DIR, jobId, "deep-samples");
	mkdirSync(outDir, { recursive: true });
	const prefix = `sample_${window.index.toString().padStart(2, "0")}`;
	const outputTemplate = join(outDir, `${prefix}.%(ext)s`);
	const section = `*${formatSectionTime(window.start)}-${formatSectionTime(window.end)}`;
	try {
		await execFileP(
			"yt-dlp",
			[
				"-f",
				"bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]/best",
				"--no-playlist",
				"--download-sections",
				section,
				"--force-keyframes-at-cuts",
				"--output",
				outputTemplate,
				"--quiet",
				"--no-warnings",
				url,
			],
			{ timeout: 180_000 },
		);
		return findDownloadedSegment(outDir, prefix);
	} catch (error) {
		log.warn("Deep sample section download failed", {
			jobId,
			window,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

function concatListLine(filePath: string): string {
	return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

async function buildDeepSampleCompilation(
	url: string,
	jobId: string,
	probe: YouTubeProbe,
): Promise<{ filePath: string; windows: DeepSampleWindow[]; duration: number }> {
	const windows = selectDeepSampleWindows(probe);
	const downloaded: Array<{ window: DeepSampleWindow; filePath: string }> = [];
	for (const window of windows) {
		const filePath = await downloadYouTubeSection(url, jobId, window);
		if (filePath) downloaded.push({ window, filePath });
	}
	if (downloaded.length === 0) {
		throw new Error("대표 구간 샘플을 다운로드하지 못했습니다.");
	}
	if (downloaded.length === 1) {
		const duration = await getVideoDuration(downloaded[0].filePath);
		return {
			filePath: downloaded[0].filePath,
			windows: [downloaded[0].window],
			duration,
		};
	}

	const outDir = join(WORK_DIR, jobId, "deep-samples");
	const concatPath = join(outDir, "concat.txt");
	const outputPath = join(outDir, "sample-compilation.mp4");
	writeFileSync(
		concatPath,
		downloaded.map(({ filePath }) => concatListLine(filePath)).join("\n"),
	);
	await execFileP(
		"ffmpeg",
		[
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			concatPath,
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"23",
			"-c:a",
			"aac",
			"-movflags",
			"+faststart",
			outputPath,
		],
		{ timeout: 120_000 },
	);
	const duration = await getVideoDuration(outputPath);
	return {
		filePath: outputPath,
		windows: downloaded.map(({ window }) => window),
		duration,
	};
}

// ─── ffmpeg: 프레임 + 오디오 + 파형 ───

async function getVideoDuration(filePath: string): Promise<number> {
	const { stdout } = await execFileP(
		"ffprobe",
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			filePath,
		],
		{ timeout: 10_000 },
	);
	return Number(stdout.trim()) || 0;
}

async function extractFrames(
	filePath: string,
	jobId: string,
	count = 8,
): Promise<string[]> {
	const outDir = join(WORK_DIR, jobId, "frames");
	mkdirSync(outDir, { recursive: true });

	const duration = await getVideoDuration(filePath);
	if (duration <= 0) throw new Error("Could not determine video duration");

	const frames: string[] = [];
	// 균등 분포 + 첫/끝 여백
	const step = duration / (count + 1);

	for (let i = 1; i <= count; i++) {
		const ts = step * i;
		const framePath = join(
			outDir,
			`frame_${i.toString().padStart(2, "0")}.jpg`,
		);
		await execFileP(
			"ffmpeg",
			[
				"-y",
				"-ss",
				ts.toFixed(2),
				"-i",
				filePath,
				"-frames:v",
				"1",
				"-q:v",
				"2",
				"-vf",
				"scale=1280:-2",
				framePath,
			],
			{ timeout: 30_000 },
		);
		if (existsSync(framePath)) frames.push(framePath);
	}

	return frames;
}

async function extractAudio(filePath: string, jobId: string): Promise<string> {
	const outPath = join(WORK_DIR, jobId, "audio.mp3");
	await execFileP(
		"ffmpeg",
		[
			"-y",
			"-i",
			filePath,
			"-vn",
			"-acodec",
			"libmp3lame",
			"-ab",
			"128k",
			"-ar",
			"44100",
			outPath,
		],
		{ timeout: 60_000 },
	);
	if (!existsSync(outPath)) throw new Error("Audio extraction failed");
	return outPath;
}

// ─── OpenAI Whisper: 전사 ───

async function transcribeAudio(audioPath: string): Promise<{
	text: string;
	segments: Array<{ start: number; end: number; text: string }>;
}> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) throw new Error("OPENAI_API_KEY not set");

	const audioBuffer = await readFile(audioPath);
	const form = new FormData();
	form.append(
		"file",
		new Blob([audioBuffer], { type: "audio/mpeg" }),
		"audio.mp3",
	);
	form.append("model", "whisper-1");
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "segment");

	const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
		method: "POST",
		headers: { Authorization: `Bearer ${key}` },
		body: form,
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`Whisper error ${res.status}: ${err}`);
	}

	const data = (await res.json()) as {
		text: string;
		segments?: Array<{ start: number; end: number; text: string }>;
	};

	return {
		text: data.text ?? "",
		segments: data.segments ?? [],
	};
}

// ─── 색상 추출: ffmpeg palette ───

async function extractDominantColors(framePaths: string[]): Promise<string[]> {
	if (framePaths.length === 0) return [];
	const outDir = join(framePaths[0], "..");
	const palettePath = join(outDir, "palette.png");

	// 중간 프레임 1장에서 팔레트 추출 (모든 프레임 평균도 가능하지만 단순화)
	const midFrame = framePaths[Math.floor(framePaths.length / 2)];

	try {
		await execFileP(
			"ffmpeg",
			[
				"-y",
				"-i",
				midFrame,
				"-vf",
				"scale=160:-1,palettegen=max_colors=6:reserve_transparent=0",
				palettePath,
			],
			{ timeout: 15_000 },
		);

		if (!existsSync(palettePath)) return [];

		// palette.png를 읽어서 픽셀 색상 추출 (간단히 ffprobe로)
		const { stdout } = await execFileP(
			"ffprobe",
			[
				"-v",
				"error",
				"-select_streams",
				"v:0",
				"-show_entries",
				"stream=width,height",
				"-of",
				"json",
				palettePath,
			],
			{ timeout: 5_000 },
		);

		void stdout; // ffprobe 검증만 — 실제 색상은 GPT-Vision에서 추출

		// palette.png는 참고용으로만 저장, 색상은 Vision이 JSON에 포함
		return [];
	} catch {
		return [];
	}
}

// ─── GPT-4o Vision: 종합 스타일 분석 ───

async function analyzeWithVision(params: {
	framePaths: string[];
	transcript: string;
	segments: Array<{ start: number; end: number; text: string }>;
	duration: number;
	title: string;
}): Promise<Record<string, unknown>> {
	const key = process.env.OPENAI_API_KEY;
	if (!key) throw new Error("OPENAI_API_KEY not set");

	// 프레임을 base64로 인코딩
	const frameImages = await Promise.all(
		params.framePaths.map(async (p) => {
			const buf = await readFile(p);
			return `data:image/jpeg;base64,${buf.toString("base64")}`;
		}),
	);

	const systemPrompt = `당신은 YouTube Shorts 영상 스타일 분석 전문가입니다.
주어진 프레임 이미지와 전사 스크립트를 분석하여 이 영상의 "복제 가능한" 스타일 템플릿을 JSON으로 추출하세요.

분석 관점:
- 시각: 도미넌트 색상 5~6개(hex), 조명 스타일, 시각적 무드
- 자막: 화면상 위치(top/center/bottom/dynamic), 상대 크기(xs~xl), 배경 스타일(없음/pill/블록/스트로크/글로우), 강조색
- 페이싱: 추정 씬 수, 평균 씬 길이, 훅(초반 3초) 길이, 전환 스타일
- 화면/카메라: 피사체 배치, 텍스트 안전영역, 카메라 모드(static/slow_push/handheld/cut_driven/mixed), 줌/팬/핸드헬드 느낌
- 음성: 톤 키워드 3~5개(예: "긴장감 있는", "속삭이는"), 추정 speed(0.9~1.3)
- BGM: 분위기, 검색 키워드 3~5개(영문), 템포(slow/mid/fast)
- 편집법: 화면 전환 규칙, 컷이 발생해야 하는 문장/정보 단위, BGM 에너지 곡선
- 훅 패턴: question/shock/claim/story 중 하나
- 스크립트 구조: 씬별 역할(hook/context/reveal/climax/cta)과 예상 길이

반드시 JSON으로만 응답하세요. 프레임을 직접 본 것처럼 구체적으로 작성하세요.`;

	const userParts: Array<Record<string, unknown>> = [
		{
			type: "text",
			text: `영상 제목: ${params.title}
총 길이: ${params.duration.toFixed(1)}초
전사 스크립트:
${params.transcript || "(음성 없음 또는 전사 실패)"}

세그먼트 타이밍:
${params.segments
	.slice(0, 20)
	.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.text}`)
	.join("\n")}

응답 JSON 형식:
{
  "dominant_colors": ["#RRGGBB", ...],
  "visual_mood": "horror|mystery|news|neutral|warm",
  "visual_prompt_template": "이 영상 스타일의 이미지를 생성할 때 쓸 영문 프롬프트 템플릿. 예: 'Dark cinematic night scene, moody blue lighting, cinematic depth of field, high contrast...'",
  "lighting_style": "dark|natural|bright|mixed",
  "subtitle_position": "top|center|bottom|dynamic",
  "subtitle_size_preset": "xs|sm|md|lg|xl",
  "subtitle_bg_style": "none|pill|block|stroke|glow",
  "subtitle_accent_color": "#RRGGBB",
  "scene_count": 숫자,
  "avg_scene_duration": 숫자(초),
  "hook_duration": 숫자(초),
  "transition_style": "hardcut|crossfade|zoom|mixed",
  "pacing_preset": "fast|medium|slow",
  "camera_mode": "static|slow_push|handheld|cut_driven|mixed",
  "camera_motion": ["slow push-in", "handheld shake", "static crop", ...],
  "layout_pattern": "center_weighted_subject|rule_of_thirds|top_title_card|split_card|full_frame_editorial",
  "subject_placement": "top_left|top_center|top_right|middle_left|center|middle_right|bottom_left|bottom_center|bottom_right",
  "text_zones": ["top_center", "bottom_center_with_stroke", ...],
  "transition_rules": ["컷/화면전환을 넣어야 하는 구체적 조건", ...],
  "tts_tone_keywords": ["keyword1", ...],
  "tts_speed": 숫자(0.9-1.3),
  "voice_delivery": ["나레이션 전달 방식", ...],
  "bgm_mood": "dark|tense|mysterious|dramatic|calm|upbeat|epic|sad",
  "bgm_keywords": ["english keyword", ...],
  "bgm_tempo": "slow|mid|fast",
  "bgm_energy_curve": "초반/중반/후반 에너지 변화 설명",
  "hook_pattern": "question|shock|claim|story",
  "script_structure": [
    {"role": "hook", "duration": 3, "note": "어떤 내용"},
    ...
  ]
}`,
		},
	];

	// 프레임 이미지 첨부 (최대 8장)
	for (const img of frameImages.slice(0, 8)) {
		userParts.push({
			type: "image_url",
			image_url: { url: img, detail: "low" },
		});
	}

	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${key}`,
		},
		body: JSON.stringify({
			model: "gpt-4o",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userParts },
			],
			temperature: 0.3,
			response_format: { type: "json_object" },
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`GPT-4o Vision error ${res.status}: ${err}`);
	}

	const data = (await res.json()) as {
		choices: Array<{ message: { content: string } }>;
	};
	const content = data.choices[0]?.message.content ?? "{}";
	return JSON.parse(content);
}

// ─── 롱폼 자동 레퍼런스: 다운로드 없이 메타데이터 기반 구조 분석 ───

const ANALYSIS_MODES = new Set<ReferenceAnalysisMode>([
	"auto",
	"shortform",
	"longform",
	"deep",
]);

type LongformFamily =
	| "drama_recap"
	| "documentary"
	| "news"
	| "interview"
	| "tutorial"
	| "generic";

function parseAnalysisMode(value: unknown): ReferenceAnalysisMode | null {
	if (value === undefined || value === null || value === "") return "auto";
	if (typeof value !== "string") return null;
	return ANALYSIS_MODES.has(value as ReferenceAnalysisMode)
		? (value as ReferenceAnalysisMode)
		: null;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function roundToMinute(seconds: number): number {
	return Math.round(seconds / 60) * 60;
}

function estimateLongformProfile(durationSeconds: number): {
	durationSeconds: number;
	sceneCount: number;
	avgSceneDuration: number;
	hookDuration: number;
} {
	const target = clampNumber(
		roundToMinute(durationSeconds),
		10 * 60,
		MAX_LONGFORM_REFERENCE_SECONDS,
	);
	const sceneCount =
		target >= 80 * 60
			? 64
			: target >= 55 * 60
				? 54
				: target >= 30 * 60
					? 36
					: clampNumber(Math.round(target / 75), 18, 72);
	return {
		durationSeconds: target,
		sceneCount,
		avgSceneDuration: Math.round(target / sceneCount),
		hookDuration: target >= 40 * 60 ? 18 : 12,
	};
}

function textFingerprint(probe: YouTubeProbe): string {
	return [
		probe.title,
		probe.creator,
		probe.description,
		...probe.categories,
		...probe.tags.slice(0, 30),
	]
		.join(" ")
		.toLowerCase();
}

function inferLongformFamily(probe: YouTubeProbe): LongformFamily {
	const text = textFingerprint(probe);
	if (
		/(드라마|영화|결말|몰아보기|정주행|줄거리|리뷰|해석|recap|ending explained|movie|drama|series)/i.test(
			text,
		)
	) {
		return "drama_recap";
	}
	if (/(뉴스|속보|정치|경제|사회|현장|news|breaking|report)/i.test(text)) {
		return "news";
	}
	if (/(다큐|사건|미스터리|범죄|역사|documentary|mystery|crime|history)/i.test(
		text,
	)) {
		return "documentary";
	}
	if (/(인터뷰|대담|토크|interview|podcast|talk)/i.test(text)) {
		return "interview";
	}
	if (/(강의|튜토리얼|방법|공략|tutorial|lecture|how to|guide)/i.test(text)) {
		return "tutorial";
	}
	return "generic";
}

function longformFamilySettings(family: LongformFamily): Pick<
	ReferenceTemplateResult,
	| "dominant_colors"
	| "visual_mood"
	| "visual_prompt_template"
	| "lighting_style"
	| "subtitle_position"
	| "subtitle_size_preset"
	| "subtitle_bg_style"
	| "subtitle_accent_color"
	| "transition_style"
	| "pacing_preset"
	| "tts_speed"
	| "tts_tone_keywords"
	| "bgm_mood"
	| "bgm_keywords"
	| "bgm_tempo"
	| "hook_pattern"
> {
	switch (family) {
		case "drama_recap":
			return {
				dominant_colors: ["#090A0F", "#1C2230", "#C9A45C", "#F3E8D0"],
				visual_mood: "mystery",
				visual_prompt_template:
					"cinematic drama recap frame, emotionally tense composition, moody contrast, subtle film grain, warm highlights, shallow depth of field, no text",
				lighting_style: "mixed",
				subtitle_position: "bottom",
				subtitle_size_preset: "md",
				subtitle_bg_style: "stroke",
				subtitle_accent_color: "#E6B35A",
				transition_style: "crossfade",
				pacing_preset: "medium",
				tts_speed: 1.04,
				tts_tone_keywords: ["몰입감 있는", "차분한", "긴장감 있는", "해설형"],
				bgm_mood: "dramatic",
				bgm_keywords: ["cinematic suspense", "emotional tension", "dark drama"],
				bgm_tempo: "mid",
				hook_pattern: "story",
			};
		case "news":
			return {
				dominant_colors: ["#101820", "#FFFFFF", "#D61F2C", "#1E5AA8"],
				visual_mood: "news",
				visual_prompt_template:
					"editorial news recap visual, documentary realism, clean contrast, newsroom-grade composition, source-aware b-roll style, no text",
				lighting_style: "natural",
				subtitle_position: "bottom",
				subtitle_size_preset: "md",
				subtitle_bg_style: "block",
				subtitle_accent_color: "#D61F2C",
				transition_style: "hardcut",
				pacing_preset: "fast",
				tts_speed: 1.08,
				tts_tone_keywords: ["명료한", "분석적인", "속도감 있는", "리포트형"],
				bgm_mood: "tense",
				bgm_keywords: ["news tension", "investigative pulse", "urgent underscore"],
				bgm_tempo: "mid",
				hook_pattern: "claim",
			};
		case "documentary":
			return {
				dominant_colors: ["#0D0F12", "#374151", "#B08D57", "#E5E1D8"],
				visual_mood: "mystery",
				visual_prompt_template:
					"documentary explainer visual, archive-inspired realism, restrained cinematic lighting, investigative mood, layered b-roll composition, no text",
				lighting_style: "mixed",
				subtitle_position: "bottom",
				subtitle_size_preset: "md",
				subtitle_bg_style: "stroke",
				subtitle_accent_color: "#B08D57",
				transition_style: "crossfade",
				pacing_preset: "medium",
				tts_speed: 1.03,
				tts_tone_keywords: ["탐사적인", "차분한", "신뢰감 있는", "미스터리"],
				bgm_mood: "mysterious",
				bgm_keywords: ["documentary mystery", "investigative ambience", "slow tension"],
				bgm_tempo: "slow",
				hook_pattern: "question",
			};
		case "interview":
			return {
				dominant_colors: ["#111111", "#F2F2F2", "#D7B46A", "#5C6670"],
				visual_mood: "neutral",
				visual_prompt_template:
					"premium interview recap visual, realistic people-focused b-roll, clean editorial framing, warm practical lighting, no text",
				lighting_style: "natural",
				subtitle_position: "bottom",
				subtitle_size_preset: "md",
				subtitle_bg_style: "stroke",
				subtitle_accent_color: "#D7B46A",
				transition_style: "mixed",
				pacing_preset: "medium",
				tts_speed: 1.05,
				tts_tone_keywords: ["대화형", "자연스러운", "관찰적인", "요약형"],
				bgm_mood: "calm",
				bgm_keywords: ["warm documentary", "human story", "subtle pulse"],
				bgm_tempo: "mid",
				hook_pattern: "claim",
			};
		case "tutorial":
			return {
				dominant_colors: ["#0E1117", "#F7F7F2", "#38BDF8", "#F59E0B"],
				visual_mood: "neutral",
				visual_prompt_template:
					"clear educational longform visual, step-by-step explainer composition, crisp lighting, clean overlays implied but no readable text",
				lighting_style: "bright",
				subtitle_position: "bottom",
				subtitle_size_preset: "md",
				subtitle_bg_style: "block",
				subtitle_accent_color: "#38BDF8",
				transition_style: "hardcut",
				pacing_preset: "medium",
				tts_speed: 1.07,
				tts_tone_keywords: ["명확한", "친절한", "구조적인", "강의형"],
				bgm_mood: "calm",
				bgm_keywords: ["clean tutorial", "focused minimal", "light pulse"],
				bgm_tempo: "mid",
				hook_pattern: "claim",
			};
		default:
			return {
				dominant_colors: ["#101010", "#EDEDED", "#8A8A8A", "#C9A45C"],
				visual_mood: "neutral",
				visual_prompt_template:
					"cinematic longform explainer visual, coherent b-roll sequence, realistic editorial composition, controlled contrast, no text",
				lighting_style: "mixed",
				subtitle_position: "bottom",
				subtitle_size_preset: "md",
				subtitle_bg_style: "stroke",
				subtitle_accent_color: "#C9A45C",
				transition_style: "crossfade",
				pacing_preset: "medium",
				tts_speed: 1.05,
				tts_tone_keywords: ["차분한", "설명형", "몰입감 있는", "정리된"],
				bgm_mood: "dramatic",
				bgm_keywords: ["cinematic explainer", "subtle tension", "documentary bed"],
				bgm_tempo: "mid",
				hook_pattern: "story",
			};
	}
}

function buildLongformScriptStructure(
	family: LongformFamily,
	targetSeconds: number,
	chapters: YouTubeChapter[],
): ReferenceTemplateResult["script_structure"] {
	const chapterTitles = chapters.slice(0, 8).map((chapter) => chapter.title);
	const base =
		family === "drama_recap"
			? [
					["hook", "핵심 갈등과 결말 궁금증을 먼저 제시"],
					["world_setup", "작품 배경, 인물 관계, 사건의 출발점 정리"],
					["act_1", "초반 전개를 원인-결과 중심으로 압축"],
					["turning_point", "첫 반전과 주인공 선택의 의미 해설"],
					["act_2", "중반 갈등과 숨은 복선 회수"],
					["climax", "절정 구간을 감정선과 사건선으로 교차 설명"],
					["ending_explained", "결말, 해석, 남은 의문 정리"],
					["takeaway", "시청자가 기억할 관전 포인트와 다음 시청 유도"],
				]
			: [
					["hook", "가장 강한 사실, 질문, 주장으로 시청 이유 제시"],
					["context", "배경과 이해에 필요한 전제 정리"],
					["chapter_1", "핵심 흐름 1단계"],
					["chapter_2", "핵심 흐름 2단계"],
					["chapter_3", "갈등, 반전, 데이터 또는 증거 확장"],
					["deep_dive", "중요 사례와 해석을 길게 전개"],
					["synthesis", "앞선 내용을 연결해 결론 구조화"],
					["takeaway", "핵심 요약과 후속 행동 유도"],
				];
	const weights = [0.04, 0.1, 0.16, 0.12, 0.18, 0.18, 0.16, 0.06];
	let allocated = 0;
	return base.map(([role, note], index) => {
		const isLast = index === base.length - 1;
		const duration = isLast
			? Math.max(60, targetSeconds - allocated)
			: Math.max(60, Math.round(targetSeconds * (weights[index] ?? 0.1)));
		allocated += duration;
		const chapterHint = chapterTitles[index]
			? ` 참고 챕터: ${chapterTitles[index]}`
			: "";
		return { role, duration, note: `${note}.${chapterHint}` };
	});
}

function topHeatmapPeaks(points: YouTubeHeatmapPoint[]): YouTubeHeatmapPoint[] {
	return [...points]
		.sort((a, b) => b.value - a.value)
		.slice(0, 8)
		.sort((a, b) => a.start_time - b.start_time);
}

function buildMetadataTranscript(probe: YouTubeProbe): string {
	const description = probe.description.replace(/\s+/g, " ").trim();
	const chapters = probe.chapters
		.slice(0, 12)
		.map((chapter) => `${Math.round(chapter.start_time)}s ${chapter.title}`)
		.join(" / ");
	return [
		`제목: ${probe.title}`,
		probe.creator ? `채널: ${probe.creator}` : "",
		description ? `설명 요약: ${description.slice(0, 900)}` : "",
		chapters ? `챕터: ${chapters}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function buildLongformReferenceResult(
	job: AnalysisJob,
	probe: YouTubeProbe,
	sourceUrl: string,
): ReferenceTemplateResult {
	const family = inferLongformFamily(probe);
	const profile = estimateLongformProfile(probe.duration);
	const settings = longformFamilySettings(family);
	const peaks = topHeatmapPeaks(probe.heatmap);
	const scriptStructure = buildLongformScriptStructure(
		family,
		profile.durationSeconds,
		probe.chapters,
	);
	const chapterCutTimes =
		probe.chapters.length > 0
			? probe.chapters
					.map((chapter) => chapter.start_time)
					.filter((time) => time > 0)
			: peaks.map((peak) => peak.start_time).filter((time) => time > 0);
	const productionDna = buildMetadataProductionDna({
		durationSeconds: profile.durationSeconds,
		sceneCount: profile.sceneCount,
		avgSceneDuration: profile.avgSceneDuration,
		hookDuration: profile.hookDuration,
		chapterCutTimes,
		analysis: {
			...settings,
			layout_pattern:
				family === "interview"
					? "full_frame_editorial_interview"
					: "full_frame_editorial_broll",
			subject_placement: "inferred_center",
			text_zones: ["bottom_center_with_stroke", "top_center_title_safe"],
			camera_mode:
				family === "tutorial" || family === "news" ? "cut_driven" : "mixed",
			camera_motion:
				family === "drama_recap"
					? ["slow push-in", "cutaway close-up", "archive b-roll"]
					: ["chapter cut", "source b-roll", "documentary push"],
			transition_rules: [
				"챕터 전환은 발화가 끝난 뒤 hard cut 또는 짧은 crossfade로 처리",
				"인기 구간과 반전 지점은 자료 컷, 클로즈업, 제목 카드 중 하나를 반드시 삽입",
				"문장 중간에서 영상을 끊지 않고 문단/씬 단위로 자동 편집",
			],
			voice_delivery: settings.tts_tone_keywords,
		},
	});

	return {
		source_type: "youtube",
		source_url: sourceUrl,
		source_title: probe.title,
		source_creator: probe.creator,
		thumbnail_url: probe.thumbnail,
		duration_seconds: probe.duration,

		...settings,
		scene_count: profile.sceneCount,
		avg_scene_duration: profile.avgSceneDuration,
		hook_duration: profile.hookDuration,

		tts_voice_id: "",
		tts_provider: "openai",

		script_structure: scriptStructure,
		transcript: buildMetadataTranscript(probe),
		frame_urls: [],
		raw_analysis: {
			analysis_depth: "metadata_only",
			analysis_mode: "longform_auto",
			longform_reference: true,
			job_id: job.id,
			youtube_id: probe.id,
			source_duration_seconds: probe.duration,
			source_webpage_url: probe.webpageUrl,
			inferred_family: family,
			categories: probe.categories,
			tags: probe.tags.slice(0, 30),
			chapters: probe.chapters.slice(0, 24),
			heatmap_peaks: peaks,
			subtitle_languages: probe.subtitleLanguages,
			automatic_caption_languages: probe.automaticCaptionLanguages,
			analysis_limits: {
				full_video_downloaded: false,
				audio_transcribed: false,
				frames_extracted: false,
				reason:
					"Longform references are converted from public metadata, chapters, heatmap and description to avoid expensive full-video copying.",
			},
			production_dna: productionDna,
			production_method: {
				id: `auto-longform-${family}`,
				label: "자동 롱폼 레퍼런스",
				description:
					"긴 유튜브 영상을 통째로 복사하지 않고 길이, 챕터, 제목, 설명, 인기 구간을 분석해 대본/TTS/BGM/편집 규칙으로 변환합니다.",
				recommendedMode: "research",
				supportedFormats: ["longform"],
				formatProfiles: {
					longform: {
						durationSeconds: profile.durationSeconds,
						sceneCount: profile.sceneCount,
						avgSceneDuration: profile.avgSceneDuration,
						hookDuration: profile.hookDuration,
					},
				},
				sceneLayout: "full",
				sceneLayouts: { longform: "full" },
				manualVideoInsert: true,
				clipControls: ["trim_start", "duration_seconds", "crop"],
				referenceSources: [
					{
						url: sourceUrl,
						purpose:
							"롱폼 구조, 페이싱, 챕터 설계, BGM/TTS 톤만 참조. 원본 영상/음악/대사 재사용 금지.",
					},
				],
				rules: [
					"원본 영상, 음악, 대사를 그대로 재사용하지 말고 사용자 보유/라이선스/공개 사용 가능 소재로 대체한다.",
					"작품/주제 입력 후 별도 조사 자료를 모아 새로운 해설 대본을 생성한다.",
					"도입부는 12-20초 안에 핵심 궁금증과 시청 보상을 제시한다.",
					"롱폼은 말이 끊기지 않도록 챕터 단위로 씬을 묶고, TTS 문장 단위에서 컷을 정렬한다.",
					"BGM은 원곡 복제가 아니라 mood/tempo/keyword 기반으로 새 트랙을 선택한다.",
				],
			},
		},
	};
}

function stringArrayField(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function deepAnalysisLimits(
	sample: {
		windows: DeepSampleWindow[];
		duration: number;
	},
	flags: { audioTranscribed: boolean; visionAnalyzed: boolean },
) {
	return {
		full_video_downloaded: false,
		sampled_video_downloaded: true,
		audio_transcribed: flags.audioTranscribed,
		vision_analyzed: flags.visionAnalyzed,
		frames_extracted: true,
		sample_duration_seconds: Math.round(sample.duration),
		sample_windows: sample.windows,
		raw_assets_reusable: false,
		reason:
			"Longform deep references analyze representative sampled sections only and store numeric/style DNA, not reusable source assets.",
	};
}

async function runDeepSampledLongformAnalysis(
	job: AnalysisJob,
	probe: YouTubeProbe,
	sourceUrl: string,
): Promise<void> {
	if (probe.duration <= 0) {
		throw new Error("영상 길이를 확인할 수 없습니다 (URL 또는 권한 확인)");
	}
	if (probe.duration > MAX_LONGFORM_REFERENCE_SECONDS) {
		throw new Error(
			`롱폼 레퍼런스가 너무 깁니다 (${Math.round(probe.duration / 60)}분). 최대 ${Math.round(MAX_LONGFORM_REFERENCE_SECONDS / 60)}분까지만 자동 레퍼런스화합니다.`,
		);
	}

	job.status = "downloading";
	job.progress = 18;
	saveJobs();

	const sample = await buildDeepSampleCompilation(sourceUrl, job.id, probe);
	enqueueProxyBuildBackground(sample.filePath, (r) => {
		if (!r.ok)
			log.warn("proxy enqueue failed", { filePath: sample.filePath, error: r.error });
	});

	job.status = "extracting";
	job.progress = 35;
	saveJobs();

	const framePaths = await extractFrames(sample.filePath, job.id, 12);
	const audioPath = await extractAudio(sample.filePath, job.id);
	await extractDominantColors(framePaths);
	const frameQcReport = await evaluateRenderOutput(sample.filePath, {
		windowSeconds: Math.min(sample.duration || MAX_DURATION_SECONDS, 60),
	}).catch((error) => {
		log.warn("Deep sample frame profile extraction failed, continuing without", {
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	});
	const frameProfile = frameQcReport
		? profileFromRenderOutputQc(frameQcReport)
		: null;

	job.status = "transcribing";
	job.progress = 58;
	saveJobs();

	let transcript = "";
	let segments: Array<{ start: number; end: number; text: string }> = [];
	let audioTranscribed = false;
	try {
		const t = await transcribeAudio(audioPath);
		transcript = t.text;
		segments = t.segments;
		audioTranscribed = true;
	} catch (e) {
		log.warn("Deep sample transcription failed, continuing without", {
			error: (e as Error).message,
		});
	}

	job.status = "analyzing";
	job.progress = 82;
	saveJobs();

	const metadataResult = buildLongformReferenceResult(job, probe, sourceUrl);
	let visionAnalyzed = false;
	let analysis: Record<string, unknown> = {
		dominant_colors: metadataResult.dominant_colors,
		visual_mood: metadataResult.visual_mood,
		visual_prompt_template: metadataResult.visual_prompt_template,
		lighting_style: metadataResult.lighting_style,
		subtitle_position: metadataResult.subtitle_position,
		subtitle_size_preset: metadataResult.subtitle_size_preset,
		subtitle_bg_style: metadataResult.subtitle_bg_style,
		subtitle_accent_color: metadataResult.subtitle_accent_color,
		transition_style: metadataResult.transition_style,
		pacing_preset: metadataResult.pacing_preset,
		tts_tone_keywords: metadataResult.tts_tone_keywords,
		tts_speed: metadataResult.tts_speed,
		bgm_mood: metadataResult.bgm_mood,
		bgm_keywords: metadataResult.bgm_keywords,
		bgm_tempo: metadataResult.bgm_tempo,
		hook_pattern: metadataResult.hook_pattern,
		layout_pattern: "sampled_longform_frame_dna",
		subject_placement: "sampled_inferred",
		text_zones: ["bottom_center_with_stroke", "top_center_title_safe"],
		transition_rules: [
			"대표 샘플에서 감지한 컷 밀도와 문장 단위를 기준으로 컷 정렬",
			"원본 컷이나 화면을 재사용하지 않고 같은 리듬의 대체 자료 컷 사용",
		],
	};
	try {
		analysis = await analyzeWithVision({
			framePaths,
			transcript,
			segments,
			duration: sample.duration,
			title: `${probe.title} (sampled deep reference)`,
		});
		visionAnalyzed = true;
	} catch (e) {
		log.warn("Deep sample vision analysis failed, using frame QC fallback", {
			error: (e as Error).message,
		});
	}
	const productionDna = await analyzeReferenceProductionDna({
		framePaths,
		durationSeconds: sample.duration,
		analysis,
		frameProfile,
		frameQcReport,
	});
	const metadataRaw = metadataResult.raw_analysis;
	const result: ReferenceTemplateResult = {
		...metadataResult,
		dominant_colors:
			stringArrayField(analysis.dominant_colors).length > 0
				? stringArrayField(analysis.dominant_colors)
				: metadataResult.dominant_colors,
		visual_mood:
			(analysis.visual_mood as ReferenceTemplateResult["visual_mood"]) ??
			metadataResult.visual_mood,
		visual_prompt_template:
			(analysis.visual_prompt_template as string) ??
			metadataResult.visual_prompt_template,
		lighting_style:
			(analysis.lighting_style as ReferenceTemplateResult["lighting_style"]) ??
			metadataResult.lighting_style,
		subtitle_position:
			(analysis.subtitle_position as ReferenceTemplateResult["subtitle_position"]) ??
			metadataResult.subtitle_position,
		subtitle_size_preset:
			(analysis.subtitle_size_preset as ReferenceTemplateResult["subtitle_size_preset"]) ??
			metadataResult.subtitle_size_preset,
		subtitle_bg_style:
			(analysis.subtitle_bg_style as ReferenceTemplateResult["subtitle_bg_style"]) ??
			metadataResult.subtitle_bg_style,
		subtitle_accent_color:
			(analysis.subtitle_accent_color as string) ??
			metadataResult.subtitle_accent_color,
		transition_style:
			(analysis.transition_style as ReferenceTemplateResult["transition_style"]) ??
			metadataResult.transition_style,
		pacing_preset:
			(analysis.pacing_preset as ReferenceTemplateResult["pacing_preset"]) ??
			metadataResult.pacing_preset,
		tts_speed: Number(analysis.tts_speed) || metadataResult.tts_speed,
		tts_tone_keywords:
			stringArrayField(analysis.tts_tone_keywords).length > 0
				? stringArrayField(analysis.tts_tone_keywords)
				: metadataResult.tts_tone_keywords,
		bgm_mood: (analysis.bgm_mood as string) ?? metadataResult.bgm_mood,
		bgm_keywords:
			stringArrayField(analysis.bgm_keywords).length > 0
				? stringArrayField(analysis.bgm_keywords)
				: metadataResult.bgm_keywords,
		bgm_tempo:
			(analysis.bgm_tempo as ReferenceTemplateResult["bgm_tempo"]) ??
			metadataResult.bgm_tempo,
		hook_pattern:
			(analysis.hook_pattern as ReferenceTemplateResult["hook_pattern"]) ??
			metadataResult.hook_pattern,
		transcript: transcript || metadataResult.transcript,
		frame_urls: framePaths.map(
			(p) => `/api/reference/frame?path=${encodeURIComponent(p)}`,
		),
		raw_analysis: {
			...metadataRaw,
			...analysis,
			analysis_depth: "pixel_frame_audio_edit",
			analysis_mode: "deep_sampled_longform",
			longform_reference: true,
			sampled_deep_reference: true,
			analysis_limits: deepAnalysisLimits(sample, {
				audioTranscribed,
				visionAnalyzed,
			}),
			production_dna: productionDna,
			production_method: metadataRaw.production_method,
			frame_profile: frameProfile,
			frame_qc: frameQcReport
				? {
						score: frameQcReport.score,
						verdict: frameQcReport.verdict,
						issues: frameQcReport.issues,
						requiredActions: frameQcReport.requiredActions,
					}
				: null,
		},
	};

	job.status = "complete";
	job.progress = 100;
	job.result = result;
	job.completedAt = new Date().toISOString();
	saveJobs();

	log.info("Deep sampled longform reference analysis complete", {
		jobId: job.id,
		title: probe.title,
		duration: probe.duration,
		sampleDuration: sample.duration,
		sampleWindows: sample.windows.length,
	});
}

// ─── 동시성 제어 (공통 워커풀) ───

const pool = createWorkerPool({
	name: SERVICE,
	maxConcurrent: MAX_CONCURRENCY,
	onError: (err, jobId) => {
		log.error("pool job failed", {
			jobId,
			error: err instanceof Error ? err.message : String(err),
		});
	},
});

function enqueueAnalysis(job: AnalysisJob): void {
	pool.submit(job.id, () => runAnalysis(job));
}

// ─── 메인 파이프라인 ───

async function runAnalysis(job: AnalysisJob): Promise<void> {
	try {
		// 1. 다운로드 (YouTube) 또는 기존 파일
		job.status = "downloading";
		job.progress = 10;
		saveJobs();

		let filePath: string;
		let title = "";
		let creator = "";
		let thumbnail = "";
		let duration = 0;

		if (job.input.type === "youtube") {
			const url = job.input.url;
			if (!url) throw new Error("URL required");
			const mode = job.input.mode ?? "auto";
			const probe = await probeYouTube(url);
			const useDeepSampling =
				mode === "deep" && probe.duration > MAX_DURATION_SECONDS;
			const useLongform =
				mode === "longform" ||
				(mode === "auto" && probe.duration > MAX_DURATION_SECONDS);

			if (useDeepSampling) {
				await runDeepSampledLongformAnalysis(job, probe, url);
				return;
			}

			if (useLongform) {
				if (probe.duration <= 0) {
					throw new Error("영상 길이를 확인할 수 없습니다 (URL 또는 권한 확인)");
				}
				if (probe.duration > MAX_LONGFORM_REFERENCE_SECONDS) {
					throw new Error(
						`롱폼 레퍼런스가 너무 깁니다 (${Math.round(probe.duration / 60)}분). 최대 ${Math.round(MAX_LONGFORM_REFERENCE_SECONDS / 60)}분까지만 자동 레퍼런스화합니다.`,
					);
				}

				job.status = "extracting";
				job.progress = 40;
				saveJobs();

				job.status = "analyzing";
				job.progress = 75;
				saveJobs();

				const result = buildLongformReferenceResult(job, probe, url);
				job.status = "complete";
				job.progress = 100;
				job.result = result;
				job.completedAt = new Date().toISOString();
				saveJobs();

				log.info("Longform reference analysis complete", {
					jobId: job.id,
					title: probe.title,
					duration: probe.duration,
				});
				return;
			}

			const info = await downloadYouTube(url, job.id, probe);
			filePath = info.filePath;
			title = info.title;
			creator = info.creator;
			thumbnail = info.thumbnail;
			duration = info.duration;
			// 다운로드 직후 proxy 빌드 백그라운드 제출 (server/.tmp/reference allowlist)
			enqueueProxyBuildBackground(filePath, (r) => {
				if (!r.ok)
					log.warn("proxy enqueue failed", { filePath, error: r.error });
			});
		} else {
			const p = job.input.filePath;
			if (!p || !existsSync(p)) throw new Error("File not found");
			filePath = p;
			duration = await getVideoDuration(filePath);
			if (duration > MAX_DURATION_SECONDS) {
				throw new Error(
					`영상이 너무 깁니다 (${Math.round(duration)}초). 최대 ${MAX_DURATION_SECONDS}초까지만 분석 가능합니다.`,
				);
			}
		}

		// 2. 프레임/오디오 추출
		job.status = "extracting";
		job.progress = 30;
		saveJobs();

		const framePaths = await extractFrames(filePath, job.id, 8);
		const audioPath = await extractAudio(filePath, job.id);
		await extractDominantColors(framePaths);
		const frameQcReport = await evaluateRenderOutput(filePath, {
			windowSeconds: Math.min(duration || MAX_DURATION_SECONDS, 30),
		}).catch((error) => {
			log.warn("Frame profile extraction failed, continuing without", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		});
		const frameProfile = frameQcReport
			? profileFromRenderOutputQc(frameQcReport)
			: null;

		// 3. Whisper 전사
		job.status = "transcribing";
		job.progress = 55;
		saveJobs();

		let transcript = "";
		let segments: Array<{ start: number; end: number; text: string }> = [];
		try {
			const t = await transcribeAudio(audioPath);
			transcript = t.text;
			segments = t.segments;
		} catch (e) {
			log.warn("Transcription failed, continuing without", {
				error: (e as Error).message,
			});
		}

		// 4. GPT-4o Vision 분석
		job.status = "analyzing";
		job.progress = 80;
		saveJobs();

		const analysis = await analyzeWithVision({
			framePaths,
			transcript,
			segments,
			duration,
			title,
		});
		const productionDna = await analyzeReferenceProductionDna({
			framePaths,
			durationSeconds: duration,
			analysis,
			frameProfile,
			frameQcReport,
		});

		// 5. 결과 조립
		const result: ReferenceTemplateResult = {
			source_type: job.input.type,
			source_url: job.input.url ?? "",
			source_title: title,
			source_creator: creator,
			thumbnail_url: thumbnail,
			duration_seconds: duration,

			dominant_colors: (analysis.dominant_colors as string[]) ?? [],
			visual_mood:
				(analysis.visual_mood as ReferenceTemplateResult["visual_mood"]) ??
				"neutral",
			visual_prompt_template: (analysis.visual_prompt_template as string) ?? "",
			lighting_style:
				(analysis.lighting_style as ReferenceTemplateResult["lighting_style"]) ??
				"natural",

			subtitle_position:
				(analysis.subtitle_position as ReferenceTemplateResult["subtitle_position"]) ??
				"bottom",
			subtitle_size_preset:
				(analysis.subtitle_size_preset as ReferenceTemplateResult["subtitle_size_preset"]) ??
				"lg",
			subtitle_bg_style:
				(analysis.subtitle_bg_style as ReferenceTemplateResult["subtitle_bg_style"]) ??
				"pill",
			subtitle_accent_color:
				(analysis.subtitle_accent_color as string) ?? "#FFD700",

			scene_count: Number(analysis.scene_count) || 0,
			avg_scene_duration: Number(analysis.avg_scene_duration) || 0,
			hook_duration: Number(analysis.hook_duration) || 3,
			transition_style:
				(analysis.transition_style as ReferenceTemplateResult["transition_style"]) ??
				"mixed",
			pacing_preset:
				(analysis.pacing_preset as ReferenceTemplateResult["pacing_preset"]) ??
				"medium",

			tts_voice_id: "",
			tts_provider: "openai",
			tts_speed: Number(analysis.tts_speed) || 1.0,
			tts_tone_keywords: (analysis.tts_tone_keywords as string[]) ?? [],

			bgm_mood: (analysis.bgm_mood as string) ?? "",
			bgm_keywords: (analysis.bgm_keywords as string[]) ?? [],
			bgm_tempo:
				(analysis.bgm_tempo as ReferenceTemplateResult["bgm_tempo"]) ?? "mid",

			hook_pattern:
				(analysis.hook_pattern as ReferenceTemplateResult["hook_pattern"]) ??
				"story",
			script_structure:
				(analysis.script_structure as ReferenceTemplateResult["script_structure"]) ??
				[],

			transcript,
			frame_urls: framePaths.map(
				(p) => `/api/reference/frame?path=${encodeURIComponent(p)}`,
			),
			raw_analysis: {
				...analysis,
				analysis_depth: "pixel_frame_audio_edit",
				production_dna: productionDna,
				frame_profile: frameProfile,
				frame_qc: frameQcReport
					? {
							score: frameQcReport.score,
							verdict: frameQcReport.verdict,
							issues: frameQcReport.issues,
							requiredActions: frameQcReport.requiredActions,
						}
					: null,
			},
		};

		job.status = "complete";
		job.progress = 100;
		job.result = result;
		job.completedAt = new Date().toISOString();
		saveJobs();

		log.info("Analysis complete", { jobId: job.id, title });
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Analysis failed";
		job.status = "failed";
		job.error = msg;
		job.completedAt = new Date().toISOString();
		saveJobs();
		log.error("Analysis failed", { jobId: job.id, error: msg });
	}
}

// ─── HTTP 서버 ───

const rateLimit = createRateLimiter({ windowMs: 60_000, max: 20 });

const ALLOWED_ORIGINS = new Set([
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:4173",
	`http://localhost:${PORT}`,
	"http://127.0.0.1:5173",
	"http://127.0.0.1:5174",
	"http://127.0.0.1:4173",
	`http://127.0.0.1:${PORT}`,
]);

function cors(req: IncomingMessage, headers: Record<string, string> = {}) {
	const origin = req.headers.origin ?? "";
	const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "";
	return {
		...headers,
		"Access-Control-Allow-Origin": allowedOrigin,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		Vary: "Origin",
	};
}

function json(
	req: IncomingMessage,
	res: ServerResponse,
	status: number,
	data: unknown,
) {
	res.writeHead(status, cors(req, { "Content-Type": "application/json" }));
	res.end(JSON.stringify(data));
}

async function parseBody(
	req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const MAX_BODY = 1_048_576; // 1MB (URL만 받으니 충분)
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size <= MAX_BODY) chunks.push(chunk);
		});
		req.on("end", () => {
			if (size > MAX_BODY) return resolve(null);
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch {
				resolve({});
			}
		});
	});
}

const server = createServer(async (req, res) => {
	trackRequest(req, res, SERVICE);
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

	if (req.method === "OPTIONS") {
		res.writeHead(204, cors(req));
		res.end();
		return;
	}

	if (url.pathname !== "/health") {
		const rl = rateLimit(req);
		if (!rl.allowed) return json(req, res, 429, { error: "rate limit" });
	}

	// Health
	if (url.pathname === "/health") {
		return json(req, res, 200, {
			ok: true,
			service: SERVICE,
			jobs: jobs.size,
			uptime: process.uptime(),
		});
	}

	// Analyze
	if (url.pathname === "/api/reference/analyze" && req.method === "POST") {
		const body = await parseBody(req);
		if (!body) return json(req, res, 413, { error: "body too large" });

		const type = body.type as string;
		const sourceUrl = body.url as string | undefined;
		const filePath = body.filePath as string | undefined;
		const mode = parseAnalysisMode(body.mode);

		if (type !== "youtube" && type !== "file") {
			return json(req, res, 400, { error: "type must be 'youtube' or 'file'" });
		}
			if (!mode) {
				return json(req, res, 400, {
					error: "mode must be 'auto', 'shortform', 'longform', or 'deep'",
				});
			}
		if (type === "youtube") {
			if (!sourceUrl)
				return json(req, res, 400, { error: "url required for youtube type" });
			// video-proxy 와 동일한 허용 호스트 세트 (모바일/단축 포함).
			// URL.hostname 기반이라 경로/쿼리에 'youtube.com' 을 숨긴 IDN/쿼리 우회 불가.
			const ALLOWED_HOSTS = new Set([
				"www.youtube.com",
				"youtube.com",
				"m.youtube.com",
				"youtu.be",
			]);
			try {
				const parsed = new URL(sourceUrl);
				if (
					(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
					!ALLOWED_HOSTS.has(parsed.hostname)
				) {
					return json(req, res, 400, { error: "YouTube URL만 허용됩니다." });
				}
			} catch {
				return json(req, res, 400, { error: "유효한 URL이 아닙니다." });
			}
		}
		if (type === "file") {
				if (mode === "longform") {
					return json(req, res, 400, {
						error: "롱폼 자동 레퍼런스는 YouTube URL만 지원합니다.",
					});
				}
			if (!filePath)
				return json(req, res, 400, {
					error: "filePath required for file type",
				});
			// 비디오 확장자 사전 확인
			if (!/\.(mp4|mov|avi|mkv|webm|m4v|flv)$/i.test(filePath)) {
				return json(req, res, 400, { error: "비디오 파일만 허용됩니다." });
			}
			// lstatSync: 심볼릭 링크·디렉터리·디바이스·FIFO 거부 (regular file만 허용)
			let lstat: ReturnType<typeof lstatSync>;
			try {
				lstat = lstatSync(filePath);
			} catch {
				return json(req, res, 400, { error: "파일을 찾을 수 없습니다." });
			}
			if (!lstat.isFile()) {
				return json(req, res, 400, {
					error: "일반 파일만 허용됩니다 (심볼릭 링크/디렉터리/디바이스 불허).",
				});
			}
			if (lstat.size > MAX_FILE_SIZE_BYTES) {
				return json(req, res, 413, {
					error: `파일이 너무 큽니다 (최대 ${Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB).`,
				});
			}
			// realpathSync: 심볼릭 링크 완전 해소 + REFERENCE_ALLOWED_DIR 범위 검증
			let resolvedPath: string;
			try {
				resolvedPath = realpathSync(filePath);
			} catch {
				return json(req, res, 400, { error: "경로를 확인할 수 없습니다." });
			}
			if (
				REFERENCE_ALLOWED_DIR !== null &&
				!resolvedPath.startsWith(REFERENCE_ALLOWED_DIR + "/") &&
				resolvedPath !== REFERENCE_ALLOWED_DIR
			) {
				return json(req, res, 400, {
					error: `파일은 허용된 디렉터리(${REFERENCE_ALLOWED_DIR}) 내에 있어야 합니다.`,
				});
			}
			(body as Record<string, unknown>).filePath = resolvedPath;
		}

		// 큐 오버플로우 방지
		const activeOrQueued = [...jobs.values()].filter(
			(j) =>
				j.status === "queued" ||
				(j.status !== "complete" && j.status !== "failed"),
		).length;
		if (activeOrQueued >= MAX_QUEUE_SIZE) {
			return json(req, res, 429, {
				error: `분석 큐가 가득 찼습니다 (최대 ${MAX_QUEUE_SIZE}). 잠시 후 다시 시도하세요.`,
			});
		}

		const job: AnalysisJob = {
			id: generateJobId(),
			status: "queued",
			progress: 0,
			input: { type, url: sourceUrl, filePath, mode },
			createdAt: new Date().toISOString(),
		};
		jobs.set(job.id, job);
		saveJobs();

		// 워커풀로 enqueue — maxConcurrent 이하면 즉시 실행, 초과하면 대기
		enqueueAnalysis(job);

		return json(req, res, 201, { job });
	}

	// Job 조회
	const jobMatch = url.pathname.match(/^\/api\/reference\/job\/([^/]+)$/);
	if (jobMatch && req.method === "GET") {
		const job = jobs.get(jobMatch[1]);
		if (!job) return json(req, res, 404, { error: "job not found" });
		return json(req, res, 200, { job });
	}

	// 프레임 서빙 (결과 미리보기용)
	if (url.pathname === "/api/reference/frame" && req.method === "GET") {
		const requested = url.searchParams.get("path") ?? "";
		const workRoot = resolve(WORK_DIR);
		const resolved = resolve(requested);
		const rel = relative(workRoot, resolved);
		const insideWorkDir =
			rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
		if (!insideWorkDir || !existsSync(resolved)) {
			return json(req, res, 404, { error: "frame not found" });
		}
		res.writeHead(200, cors(req, { "Content-Type": "image/jpeg" }));
		createReadStream(resolved).pipe(res);
		return;
	}

	// 작업 정리 (디스크 절약)
	const cleanMatch = url.pathname.match(
		/^\/api\/reference\/job\/([^/]+)\/cleanup$/,
	);
	if (cleanMatch && req.method === "POST") {
		const job = jobs.get(cleanMatch[1]);
		if (!job) return json(req, res, 404, { error: "job not found" });
		const workPath = join(WORK_DIR, job.id);
		if (existsSync(workPath)) {
			await rm(workPath, { recursive: true, force: true });
		}
		return json(req, res, 200, { ok: true });
	}

	return json(req, res, 404, { error: "not found" });
});

server.listen(PORT, () => {
	log.info("Server started", { port: PORT, workDir: WORK_DIR });
});

setupGracefulShutdown(server, SERVICE, () => {
	saveJobs();
});
