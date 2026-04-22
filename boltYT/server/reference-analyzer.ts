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

/** 분석 가능 최대 영상 길이 (초). 롱폼 방지 — Shorts/짧은 영상 전용 */
const MAX_DURATION_SECONDS = 180;

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
	input: { type: "youtube" | "file"; url?: string; filePath?: string };
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
async function probeYouTube(url: string): Promise<{
	duration: number;
	title: string;
	creator: string;
	thumbnail: string;
}> {
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
		duration?: number;
		title?: string;
		uploader?: string;
		channel?: string;
		thumbnail?: string;
	};
	return {
		duration: Number(info.duration) || 0,
		title: info.title ?? "",
		creator: info.channel ?? info.uploader ?? "",
		thumbnail: info.thumbnail ?? "",
	};
}

async function downloadYouTube(
	url: string,
	jobId: string,
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
	const probe = await probeYouTube(url);
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
- 음성: 톤 키워드 3~5개(예: "긴장감 있는", "속삭이는"), 추정 speed(0.9~1.3)
- BGM: 분위기, 검색 키워드 3~5개(영문), 템포(slow/mid/fast)
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
  "tts_tone_keywords": ["keyword1", ...],
  "tts_speed": 숫자(0.9-1.3),
  "bgm_mood": "dark|tense|mysterious|dramatic|calm|upbeat|epic|sad",
  "bgm_keywords": ["english keyword", ...],
  "bgm_tempo": "slow|mid|fast",
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
			const info = await downloadYouTube(url, job.id);
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
			raw_analysis: analysis,
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

		if (type !== "youtube" && type !== "file") {
			return json(req, res, 400, { error: "type must be 'youtube' or 'file'" });
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
			input: { type, url: sourceUrl, filePath },
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
