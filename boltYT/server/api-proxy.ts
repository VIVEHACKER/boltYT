/**
 * 통합 API 프록시 서버 — 모든 외부 API 키를 서버사이드에서 관리
 *
 * 실행: npx tsx server/api-proxy.ts
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { actorFromReq, recordAudit } from "./lib/audit.ts";
import { createTtlCache } from "./lib/cache.ts";
import {
	checkServer,
	createCommandRegistry,
	type DiagHealthReport,
	runCommand,
} from "./lib/diag.ts";
import { runAgent } from "./lib/diag-agent.ts";
import {
	EDITABLE_ENV_KEYS,
	loadEnv,
	reloadEnv,
	saveEnvValues,
	validateEnv,
	watchEnv,
} from "./lib/env.ts";
import {
	clearErrors as clearErrorsBuffer,
	listErrors as listErrorsBuffer,
	recordError,
} from "./lib/errors-buffer.ts";
import {
	FAL_AUDIO_ENDPOINTS,
	FAL_ENDPOINTS,
	type FalAudioProvider,
	type FalProvider,
	submitFalAudio,
	submitFalVideo,
} from "./lib/fal-client.ts";
import { fetchWithRetry } from "./lib/fetch-retry.ts";
import { createLogger } from "./lib/logger.ts";
import { maskSecrets } from "./lib/mask.ts";
import {
	counter as metricCounter,
	snapshot as metricsSnapshot,
} from "./lib/metrics.ts";
import {
	getOpenAiRuntimeHealth,
	getOpenAiSkipReason,
	isOpenAiQuotaError,
	markOpenAiOk,
	markOpenAiQuotaBlocked,
} from "./lib/openai-runtime-health.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";
import {
	createTieredRateLimit,
	defaultTierForPath,
} from "./lib/tiered-limit.ts";
import { sanitizeInt, sanitizeString } from "./lib/validate.ts";

const SERVICE = "api-proxy";
const log = createLogger(SERVICE);
const execFileP = promisify(execFile);

loadEnv();

const PORT = Number(process.env.API_PROXY_PORT ?? 3459);

validateEnv(["OPENAI_API_KEY"], SERVICE);

const DIAG_TOKEN = process.env.DIAG_TOKEN ?? "";
const FORMAT_WORK_DIR = join(import.meta.dirname ?? ".", ".tmp/format");
if (!existsSync(FORMAT_WORK_DIR))
	mkdirSync(FORMAT_WORK_DIR, { recursive: true });

// ─── 환경변수에서 키 로드 (in-place mutation으로 .env 변경 시 재적용) ───

const KEYS = {
	openai: "",
	elevenlabs: "",
	pexels: "",
	pixabay: "",
	youtube: "",
	naverClientId: "",
	naverClientSecret: "",
	fal: "",
};

function reloadKeys() {
	reloadEnv();
	KEYS.openai = process.env.OPENAI_API_KEY ?? "";
	KEYS.elevenlabs = process.env.ELEVENLABS_API_KEY ?? "";
	KEYS.pexels = process.env.PEXELS_API_KEY ?? "";
	KEYS.pixabay = process.env.PIXABAY_API_KEY ?? "";
	KEYS.youtube = process.env.YOUTUBE_API_KEY ?? "";
	KEYS.naverClientId = process.env.NAVER_CLIENT_ID ?? "";
	KEYS.naverClientSecret = process.env.NAVER_CLIENT_SECRET ?? "";
	KEYS.fal = process.env.FAL_KEY ?? "";
}

function publicOpenAiRuntimeHealth() {
	const health = getOpenAiRuntimeHealth();
	return {
		quotaBlocked: health.quotaBlocked,
		quotaBlockedUntil: health.quotaBlockedUntil,
		lastQuotaAt: health.lastQuotaAt,
		lastQuotaSource: health.lastQuotaSource,
		lastOkAt: health.lastOkAt,
	};
}

function keyStatusPayload() {
	const editable = Object.fromEntries(
		EDITABLE_ENV_KEYS.map((key) => {
			const configured =
				key === "OPENAI_API_KEY"
					? Boolean(KEYS.openai)
					: key === "YOUTUBE_API_KEY"
						? Boolean(KEYS.youtube)
						: Boolean(process.env[key]);
			return [key, configured];
		}),
	);
	return {
		openai: Boolean(KEYS.openai),
		elevenlabs: Boolean(KEYS.elevenlabs),
		pexels: Boolean(KEYS.pexels),
		pixabay: Boolean(KEYS.pixabay),
		youtube: Boolean(KEYS.youtube),
		naver: Boolean(KEYS.naverClientId && KEYS.naverClientSecret),
		fal: Boolean(KEYS.fal),
		google: Boolean(
			process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
		),
		editable,
		openaiRuntime: publicOpenAiRuntimeHealth(),
	};
}

function configuredProviderNames(status = keyStatusPayload()): string[] {
	return [
		status.openai ? "openai" : "",
		status.elevenlabs ? "elevenlabs" : "",
		status.pexels ? "pexels" : "",
		status.pixabay ? "pixabay" : "",
		status.youtube ? "youtube" : "",
		status.naver ? "naver" : "",
		status.fal ? "fal" : "",
		status.google ? "google" : "",
	].filter(Boolean);
}

function missingProviderNames(status = keyStatusPayload()): string[] {
	return [
		!status.openai ? "openai" : "",
		!status.elevenlabs ? "elevenlabs" : "",
		!status.pexels ? "pexels" : "",
		!status.pixabay ? "pixabay" : "",
		!status.youtube ? "youtube" : "",
		!status.naver ? "naver" : "",
		!status.fal ? "fal" : "",
		!status.google ? "google" : "",
	].filter(Boolean);
}

reloadKeys();

// ─── 유틸리티 ───

const tieredLimit = createTieredRateLimit(SERVICE);

const ALLOWED_ORIGINS = new Set([
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:4173",
	"http://127.0.0.1:5173",
	"http://127.0.0.1:5174",
	"http://127.0.0.1:4173",
	`http://localhost:${PORT}`,
	`http://127.0.0.1:${PORT}`,
]);

// fetch-article은 임의 외부 URL로 GET — 크기 제한으로 SSRF·폭주 방지
// (로컬 대역 차단은 응용 계층에선 불완전하지만 최소 방어선)
function isSafeFetchUrl(rawUrl: string): boolean {
	try {
		const u = new URL(rawUrl);
		if (u.protocol !== "http:" && u.protocol !== "https:") return false;
		const host = u.hostname.toLowerCase();
		if (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1" ||
			host === "[::1]" ||
			host.endsWith(".local") ||
			host.endsWith(".internal") ||
			/^10\./.test(host) ||
			/^192\.168\./.test(host) ||
			/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
			/^169\.254\./.test(host) ||
			/^fe80:/i.test(host) ||
			/^fc00:/i.test(host) ||
			/^fd[0-9a-f]{2}:/i.test(host) ||
			/^0x/i.test(host)
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

function isLocalRequest(req: import("node:http").IncomingMessage): boolean {
	const address = req.socket.remoteAddress ?? "";
	return (
		address === "127.0.0.1" ||
		address === "::1" ||
		address === "::ffff:127.0.0.1" ||
		address === "localhost" ||
		address === ""
	);
}

function cors(
	req: import("node:http").IncomingMessage,
	headers: Record<string, string> = {},
) {
	const origin = req.headers.origin ?? "";
	const baseHeaders = {
		...headers,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		Vary: "Origin",
	};
	if (!ALLOWED_ORIGINS.has(origin)) return baseHeaders;
	return {
		...baseHeaders,
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Credentials": "true",
	};
}

function json(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	status: number,
	data: unknown,
) {
	res.writeHead(status, cors(req, { "Content-Type": "application/json" }));
	res.end(JSON.stringify(data));
}

function streamUpstreamBody(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	upstream: Response,
	contentType: string,
) {
	const headers: Record<string, string> = { "Content-Type": contentType };
	const cl = upstream.headers.get("content-length");
	if (cl) headers["Content-Length"] = cl;
	res.writeHead(200, cors(req, headers));
	if (upstream.body) {
		Readable.fromWeb(
			upstream.body as import("node:stream/web").ReadableStream,
		).pipe(res);
	} else {
		res.end();
	}
}

async function parseBody(
	req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const MAX_BODY = 1_048_576; // 1MB
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size <= MAX_BODY) chunks.push(chunk);
		});
		req.on("end", () => {
			if (size > MAX_BODY) {
				resolve(null);
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch {
				resolve({});
			}
		});
	});
}

function requireKey(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	key: string,
	name: string,
): boolean {
	if (!key) {
		json(req, res, 503, {
			error: `${name} API 키가 서버에 설정되지 않았습니다. .env 파일을 확인하세요.`,
		});
		return false;
	}
	return true;
}

function recordOpenAiResult(ok: boolean, errorText: string, source: string) {
	if (ok) {
		markOpenAiOk();
		return;
	}
	if (isOpenAiQuotaError(errorText)) {
		markOpenAiQuotaBlocked(errorText, source);
	}
}

function rejectOpenAiCooldown(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	source: string,
): boolean {
	const reason = getOpenAiSkipReason();
	if (!reason) return false;
	log.warn("OpenAI request skipped during quota cooldown", { source });
	json(req, res, 429, {
		error: reason,
		code: "openai_quota_cooldown",
		openaiRuntime: publicOpenAiRuntimeHealth(),
	});
	return true;
}

interface YouTubeSearchItem {
	id?: { videoId?: string };
}

interface YouTubeSearchResponse {
	items?: YouTubeSearchItem[];
}

interface YouTubeVideoItem {
	id: string;
	snippet?: {
		title?: string;
		description?: string;
		channelId?: string;
		channelTitle?: string;
		publishedAt?: string;
		thumbnails?: Record<string, { url?: string }>;
	};
	statistics?: {
		viewCount?: string;
		likeCount?: string;
		commentCount?: string;
	};
	contentDetails?: {
		duration?: string;
	};
}

interface YouTubeVideosResponse {
	items?: YouTubeVideoItem[];
}

interface YouTubeChannelItem {
	id: string;
	snippet?: {
		title?: string;
		thumbnails?: Record<string, { url?: string }>;
	};
	statistics?: {
		viewCount?: string;
		subscriberCount?: string;
		hiddenSubscriberCount?: boolean;
		videoCount?: string;
	};
}

interface YouTubeChannelsResponse {
	items?: YouTubeChannelItem[];
}

interface FormatAnalysisInputVideo {
	videoId: string;
	title?: string;
	durationSeconds?: number;
	viewCount?: number;
}

interface CaptionSegment {
	start: number;
	end: number;
	text: string;
}

interface YouTubeCaptionTrack {
	ext?: string;
	name?: string;
	url?: string;
}

interface YouTubeFormatMetadata {
	id?: string;
	title?: string;
	duration?: number;
	automatic_captions?: Record<string, YouTubeCaptionTrack[]>;
	subtitles?: Record<string, YouTubeCaptionTrack[]>;
}

interface FormatVideoAnalysis {
	videoId: string;
	title: string;
	url: string;
	durationSeconds: number;
	sampleSeconds: number;
	hookPattern: "question" | "shock" | "claim" | "story" | "unknown";
	hookDurationSeconds: number | null;
	firstCutSeconds: number | null;
	cutsFirst10: number;
	cutsFirst30: number;
	avgCutIntervalSeconds: number | null;
	titleOpeningOverlap: number;
	openingText: string;
	transcriptAvailable: boolean;
	cutDetectionAvailable: boolean;
	rules: string[];
	warnings: string[];
}

interface FormatAnalysisResponse {
	query: string;
	sampleSeconds: number;
	analyzedAt: string;
	videos: FormatVideoAnalysis[];
	summary: {
		medianHookSeconds: number | null;
		medianFirstCutSeconds: number | null;
		medianCutsFirst10: number;
		medianCutsFirst30: number;
		medianTitleOpeningOverlap: number;
		commonHookPattern: FormatVideoAnalysis["hookPattern"];
		rules: string[];
		warnings: string[];
	};
}

async function fetchYouTubeJson<T>(
	resource: string,
	params: URLSearchParams,
): Promise<T> {
	params.set("key", KEYS.youtube);
	const upstream = await fetchWithRetry(
		`https://www.googleapis.com/youtube/v3/${resource}?${params.toString()}`,
	);
	if (!upstream.ok) {
		throw new Error(`YouTube error: ${upstream.status}`);
	}
	return upstream.json() as Promise<T>;
}

async function buildYouTubeFormatAnalysis(input: {
	query: string;
	videos: FormatAnalysisInputVideo[];
	sampleSeconds: number;
}): Promise<FormatAnalysisResponse> {
	const videos: FormatVideoAnalysis[] = [];
	for (const video of input.videos.slice(0, 3)) {
		try {
			videos.push(await analyzeYouTubeFormatVideo(video, input.sampleSeconds));
		} catch (e) {
			videos.push(
				buildFailedFormatVideoAnalysis(
					video,
					input.sampleSeconds,
					e instanceof Error ? e.message : "format analysis failed",
				),
			);
		}
	}
	return {
		query: input.query,
		sampleSeconds: input.sampleSeconds,
		analyzedAt: new Date().toISOString(),
		videos,
		summary: summarizeFormatAnalysis(videos),
	};
}

function buildFailedFormatVideoAnalysis(
	video: FormatAnalysisInputVideo,
	sampleSeconds: number,
	error: string,
): FormatVideoAnalysis {
	return {
		videoId: video.videoId,
		title: video.title ?? "",
		url: `https://www.youtube.com/watch?v=${video.videoId}`,
		durationSeconds: Number(video.durationSeconds ?? 0),
		sampleSeconds,
		hookPattern: "unknown",
		hookDurationSeconds: null,
		firstCutSeconds: null,
		cutsFirst10: 0,
		cutsFirst30: 0,
		avgCutIntervalSeconds: null,
		titleOpeningOverlap: 0,
		openingText: "",
		transcriptAvailable: false,
		cutDetectionAvailable: false,
		rules: [],
		warnings: [`분석 실패: ${maskSecrets(error).slice(0, 120)}`],
	};
}

async function analyzeYouTubeFormatVideo(
	video: FormatAnalysisInputVideo,
	sampleSeconds: number,
): Promise<FormatVideoAnalysis> {
	const url = `https://www.youtube.com/watch?v=${video.videoId}`;
	const workDir = join(
		FORMAT_WORK_DIR,
		`${video.videoId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
	);
	mkdirSync(workDir, { recursive: true });

	try {
		const metadata = await fetchFormatMetadata(url);
		const title = metadata.title || video.title || "";
		const durationSeconds = Number(
			metadata.duration ?? video.durationSeconds ?? 0,
		);
		const captions = await fetchCaptionSegments(metadata, sampleSeconds);
		const clipPath = await downloadOpeningClip(url, workDir, sampleSeconds);
		const cutTimes = clipPath
			? await detectSceneCutTimes(clipPath, sampleSeconds)
			: [];
		const openingText = buildOpeningText(captions, 12);
		const hookPattern = detectFormatHookPattern(openingText || title);
		const hookDurationSeconds = captions.length
			? estimateHookDuration(captions, sampleSeconds)
			: null;
		const firstCutSeconds = cutTimes[0] ?? null;
		const cutsFirst10 = cutTimes.filter((t) => t <= 10).length;
		const cutsFirst30 = cutTimes.filter((t) => t <= 30).length;
		const avgCutIntervalSeconds = cutTimes.length
			? sampleSeconds / (cutTimes.length + 1)
			: null;
		const titleOpeningOverlap = openingText
			? overlapRatio(title, openingText)
			: 0;
		const rules = buildFormatVideoRules({
			hookPattern,
			hookDurationSeconds,
			firstCutSeconds,
			cutsFirst10,
			cutsFirst30,
			titleOpeningOverlap,
			captions,
		});
		const warnings = buildFormatVideoWarnings({
			hookDurationSeconds,
			firstCutSeconds,
			cutsFirst10,
			titleOpeningOverlap,
			transcriptAvailable: captions.length > 0,
			cutDetectionAvailable: cutTimes.length > 0,
		});

		return {
			videoId: video.videoId,
			title,
			url,
			durationSeconds,
			sampleSeconds,
			hookPattern,
			hookDurationSeconds,
			firstCutSeconds,
			cutsFirst10,
			cutsFirst30,
			avgCutIntervalSeconds,
			titleOpeningOverlap,
			openingText,
			transcriptAvailable: captions.length > 0,
			cutDetectionAvailable: cutTimes.length > 0,
			rules,
			warnings,
		};
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

async function fetchFormatMetadata(
	url: string,
): Promise<YouTubeFormatMetadata> {
	const { stdout } = await execFileP(
		"yt-dlp",
		[
			"--no-playlist",
			"--skip-download",
			"--dump-single-json",
			"--no-warnings",
			url,
		],
		{ timeout: 35_000, maxBuffer: 40 * 1024 * 1024 },
	);
	return JSON.parse(stdout) as YouTubeFormatMetadata;
}

async function fetchCaptionSegments(
	metadata: YouTubeFormatMetadata,
	sampleSeconds: number,
): Promise<CaptionSegment[]> {
	const track =
		selectCaptionTrack(metadata.subtitles) ??
		selectCaptionTrack(metadata.automatic_captions);
	if (!track?.url) return [];
	try {
		const res = await fetchWithRetry(track.url);
		if (!res.ok) return [];
		if (track.ext === "json3" || track.url.includes("fmt=json3")) {
			return parseJson3Captions(await res.json(), sampleSeconds);
		}
		return parseVttCaptions(await res.text(), sampleSeconds);
	} catch {
		return [];
	}
}

function selectCaptionTrack(
	groups?: Record<string, YouTubeCaptionTrack[]>,
): YouTubeCaptionTrack | null {
	if (!groups) return null;
	const languages = ["ko-orig", "ko", "en-orig", "en", ...Object.keys(groups)];
	for (const lang of languages) {
		const tracks = groups[lang] ?? [];
		const json3 = tracks.find((track) => track.ext === "json3" && track.url);
		if (json3) return json3;
		const vtt = tracks.find((track) => track.ext === "vtt" && track.url);
		if (vtt) return vtt;
	}
	return null;
}

function parseJson3Captions(
	raw: unknown,
	sampleSeconds: number,
): CaptionSegment[] {
	const events = (raw as { events?: unknown[] }).events ?? [];
	return events
		.map((event) => {
			const e = event as {
				tStartMs?: number;
				dDurationMs?: number;
				segs?: Array<{ utf8?: string }>;
			};
			const text = (e.segs ?? [])
				.map((seg) => seg.utf8 ?? "")
				.join("")
				.replace(/\s+/g, " ")
				.trim();
			const start = Number(e.tStartMs ?? 0) / 1000;
			const end = start + Number(e.dDurationMs ?? 0) / 1000;
			return { start, end, text };
		})
		.filter((segment) => segment.text && segment.start <= sampleSeconds)
		.slice(0, 80);
}

function parseVttCaptions(
	raw: string,
	sampleSeconds: number,
): CaptionSegment[] {
	const segments: CaptionSegment[] = [];
	const blocks = raw.split(/\n\s*\n/);
	for (const block of blocks) {
		const lines = block.split("\n").map((line) => line.trim());
		const timing = lines.find((line) => line.includes("-->"));
		if (!timing) continue;
		const [startRaw, endRaw] = timing.split("-->").map((part) => part.trim());
		const start = parseVttTimestamp(startRaw ?? "");
		const end = parseVttTimestamp((endRaw ?? "").split(/\s+/)[0] ?? "");
		if (start > sampleSeconds) continue;
		const text = lines
			.filter(
				(line) =>
					line &&
					!line.includes("-->") &&
					!/^WEBVTT|Kind:|Language:/i.test(line),
			)
			.join(" ")
			.replace(/<[^>]+>/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (text) segments.push({ start, end, text });
		if (segments.length >= 80) break;
	}
	return segments;
}

function parseVttTimestamp(raw: string): number {
	const parts = raw.replace(",", ".").split(":").map(Number);
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	return Number(raw) || 0;
}

async function downloadOpeningClip(
	url: string,
	workDir: string,
	sampleSeconds: number,
): Promise<string | null> {
	const outputTemplate = join(workDir, "clip.%(ext)s");
	try {
		await execFileP(
			"yt-dlp",
			[
				"-f",
				"best[height<=480][ext=mp4]/best[height<=480]/best",
				"--no-playlist",
				"--download-sections",
				`*0-${sampleSeconds}`,
				"--force-keyframes-at-cuts",
				"--output",
				outputTemplate,
				"--quiet",
				"--no-warnings",
				url,
			],
			{ timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
		);
		const file = readdirSync(workDir).find((name) =>
			/^clip\.(mp4|webm|mkv)$/i.test(name),
		);
		return file ? join(workDir, file) : null;
	} catch {
		return null;
	}
}

async function detectSceneCutTimes(
	clipPath: string,
	sampleSeconds: number,
): Promise<number[]> {
	try {
		const { stderr } = await execFileP(
			"ffmpeg",
			[
				"-i",
				clipPath,
				"-filter:v",
				"select='gt(scene,0.32)',showinfo",
				"-f",
				"null",
				"-",
			],
			{ timeout: 90_000, maxBuffer: 20 * 1024 * 1024 },
		);
		return [...stderr.matchAll(/pts_time:([0-9.]+)/g)]
			.map((match) => Number(match[1]))
			.filter(
				(time) => Number.isFinite(time) && time > 0 && time <= sampleSeconds,
			)
			.filter((time, index, arr) => index === 0 || time - arr[index - 1] > 0.45)
			.slice(0, 80);
	} catch {
		return [];
	}
}

function buildOpeningText(segments: CaptionSegment[], seconds: number): string {
	return segments
		.filter((segment) => segment.start <= seconds)
		.map((segment) => segment.text)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 420);
}

function estimateHookDuration(
	segments: CaptionSegment[],
	sampleSeconds: number,
): number {
	const maxHook = Math.min(18, sampleSeconds);
	let text = "";
	for (const segment of segments) {
		if (segment.start > maxHook) break;
		text = `${text} ${segment.text}`.trim();
		const enough = segment.end >= 2.5;
		const sentenceEnded = /[.?!。？！]|(다|요|죠|까|습니다)$/.test(text.trim());
		const transition =
			/(그런데|하지만|문제는|이유는|왜냐하면|그리고|이제|먼저|바로)/.test(
				segment.text,
			);
		if (enough && (sentenceEnded || transition)) {
			return round1(Math.min(segment.end, maxHook));
		}
	}
	const fallback = segments.find((segment) => segment.end >= 6)?.end ?? 6;
	return round1(Math.min(fallback, maxHook));
}

function detectFormatHookPattern(
	text: string,
): FormatVideoAnalysis["hookPattern"] {
	const value = text.trim();
	if (!value) return "unknown";
	if (/[?？]|^(왜|어떻게|무엇|언제|누가|어디서|정말|혹시)/.test(value)) {
		return "question";
	}
	if (
		/(충격|소름|불가능|풀리지 않는|미스터리|반전|숨겨진|실화|최초|경악|믿기지)/.test(
			value,
		)
	) {
		return "shock";
	}
	if (
		/(사실|진실|이유|핵심|절대|반드시|단 하나|전부|모든|방법|법칙)/.test(value)
	) {
		return "claim";
	}
	if (/(그날|어느 날|한때|이야기|사건은|시작됐)/.test(value)) {
		return "story";
	}
	return "unknown";
}

function overlapRatio(a: string, b: string): number {
	const aTokens = new Set(tokenizeForFormat(a));
	const bTokens = new Set(tokenizeForFormat(b));
	if (aTokens.size === 0 || bTokens.size === 0) return 0;
	let overlap = 0;
	for (const token of aTokens) {
		if (bTokens.has(token)) overlap += 1;
	}
	return round2(overlap / aTokens.size);
}

function tokenizeForFormat(value: string): string[] {
	const stopwords = new Set([
		"그리고",
		"하지만",
		"영상",
		"오늘",
		"입니다",
		"합니다",
		"있는",
		"없는",
		"the",
		"and",
		"for",
		"with",
		"this",
		"that",
	]);
	return value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2 && !stopwords.has(token));
}

function buildFormatVideoRules(input: {
	hookPattern: FormatVideoAnalysis["hookPattern"];
	hookDurationSeconds: number | null;
	firstCutSeconds: number | null;
	cutsFirst10: number;
	cutsFirst30: number;
	titleOpeningOverlap: number;
	captions: CaptionSegment[];
}): string[] {
	const rules: string[] = [];
	if (input.hookPattern !== "unknown") {
		rules.push(`오프닝 훅은 ${hookPatternLabel(input.hookPattern)} 패턴`);
	}
	if (input.hookDurationSeconds !== null) {
		rules.push(
			`첫 훅은 약 ${input.hookDurationSeconds.toFixed(1)}초 안에 닫힘`,
		);
	}
	if (input.firstCutSeconds !== null) {
		rules.push(`첫 화면 전환은 ${input.firstCutSeconds.toFixed(1)}초 부근`);
	}
	if (input.cutsFirst10 >= 2) {
		rules.push(`첫 10초 안에 컷 ${input.cutsFirst10}개로 초반 밀도 높음`);
	}
	if (input.cutsFirst30 >= 6) {
		rules.push(`첫 30초 컷 ${input.cutsFirst30}개로 반복 전환 사용`);
	}
	if (input.titleOpeningOverlap >= 0.24) {
		rules.push("제목 핵심어를 오프닝에서 바로 회수");
	}
	if (input.captions.length === 0) {
		rules.push("자막/전사 없음: 시각 컷 패턴 중심으로만 판단");
	}
	return rules.slice(0, 5);
}

function buildFormatVideoWarnings(input: {
	hookDurationSeconds: number | null;
	firstCutSeconds: number | null;
	cutsFirst10: number;
	titleOpeningOverlap: number;
	transcriptAvailable: boolean;
	cutDetectionAvailable: boolean;
}): string[] {
	const warnings: string[] = [];
	if (!input.transcriptAvailable)
		warnings.push("자막을 찾지 못해 훅 문장 추정 제한");
	if (!input.cutDetectionAvailable)
		warnings.push("장면 전환 감지가 약하거나 다운로드 실패");
	if (input.hookDurationSeconds !== null && input.hookDurationSeconds > 10) {
		warnings.push("훅이 10초를 넘어 느린 편");
	}
	if (input.firstCutSeconds !== null && input.firstCutSeconds > 8) {
		warnings.push("첫 컷 전환이 8초 이후라 초반 시각 변화가 느림");
	}
	if (input.cutsFirst10 === 0) warnings.push("첫 10초 컷 변화가 거의 없음");
	if (input.titleOpeningOverlap < 0.12) {
		warnings.push("제목과 오프닝 문장의 핵심어 연결이 약함");
	}
	return warnings.slice(0, 4);
}

function summarizeFormatAnalysis(
	videos: FormatVideoAnalysis[],
): FormatAnalysisResponse["summary"] {
	const hookValues = videos
		.map((video) => video.hookDurationSeconds)
		.filter((v): v is number => typeof v === "number");
	const firstCuts = videos
		.map((video) => video.firstCutSeconds)
		.filter((v): v is number => typeof v === "number");
	const commonHookPattern = mostCommonHookPattern(
		videos.map((video) => video.hookPattern),
	);
	const medianHookSeconds = nullableMedian(hookValues);
	const medianFirstCutSeconds = nullableMedian(firstCuts);
	const medianCutsFirst10 = medianNumber(
		videos.map((video) => video.cutsFirst10),
	);
	const medianCutsFirst30 = medianNumber(
		videos.map((video) => video.cutsFirst30),
	);
	const medianTitleOpeningOverlap = round2(
		medianNumber(videos.map((video) => video.titleOpeningOverlap)),
	);
	const warnings = [
		...new Set(videos.flatMap((video) => video.warnings)),
	].slice(0, 5);
	const rules: string[] = [];
	if (medianHookSeconds !== null) {
		rules.push(`대표 훅 길이: ${medianHookSeconds.toFixed(1)}초`);
	}
	if (medianFirstCutSeconds !== null) {
		rules.push(`대표 첫 컷: ${medianFirstCutSeconds.toFixed(1)}초`);
	}
	if (medianCutsFirst10 >= 2) {
		rules.push(`첫 10초 컷 밀도: 중앙 ${medianCutsFirst10}개`);
	}
	if (medianCutsFirst30 >= 5) {
		rules.push(`첫 30초 전환: 중앙 ${medianCutsFirst30}개`);
	}
	if (commonHookPattern !== "unknown") {
		rules.push(`반복 훅 패턴: ${hookPatternLabel(commonHookPattern)}`);
	}
	if (medianTitleOpeningOverlap >= 0.2) {
		rules.push("제목 핵심어를 오프닝에서 빠르게 회수");
	}
	return {
		medianHookSeconds,
		medianFirstCutSeconds,
		medianCutsFirst10,
		medianCutsFirst30,
		medianTitleOpeningOverlap,
		commonHookPattern,
		rules: rules.slice(0, 6),
		warnings,
	};
}

function mostCommonHookPattern(
	patterns: FormatVideoAnalysis["hookPattern"][],
): FormatVideoAnalysis["hookPattern"] {
	const counts = new Map<FormatVideoAnalysis["hookPattern"], number>();
	for (const pattern of patterns) {
		counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
}

function hookPatternLabel(pattern: FormatVideoAnalysis["hookPattern"]): string {
	const labels: Record<FormatVideoAnalysis["hookPattern"], string> = {
		question: "질문형",
		shock: "충격/미스터리형",
		claim: "주장/법칙형",
		story: "스토리형",
		unknown: "미확인",
	};
	return labels[pattern];
}

function nullableMedian(values: number[]): number | null {
	if (values.length === 0) return null;
	return round1(medianNumber(values));
}

function medianNumber(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
	return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

async function buildYouTubeNicheResearch(input: {
	query: string;
	maxResults: number;
	daysBack: number;
	order: "viewCount" | "date" | "relevance";
}) {
	const publishedAfter = new Date(
		Date.now() - input.daysBack * 86_400_000,
	).toISOString();
	const search = await fetchYouTubeJson<YouTubeSearchResponse>(
		"search",
		new URLSearchParams({
			part: "snippet",
			type: "video",
			q: input.query,
			maxResults: String(input.maxResults),
			regionCode: "KR",
			relevanceLanguage: "ko",
			order: input.order,
			publishedAfter,
		}),
	);
	const videoIds = [
		...new Set(
			(search.items ?? [])
				.map((item) => item.id?.videoId)
				.filter((id): id is string => Boolean(id)),
		),
	];
	if (videoIds.length === 0) {
		return {
			query: input.query,
			fetchedAt: new Date().toISOString(),
			order: input.order,
			daysBack: input.daysBack,
			videos: [],
		};
	}

	const videoDetails = await fetchYouTubeJson<YouTubeVideosResponse>(
		"videos",
		new URLSearchParams({
			part: "snippet,statistics,contentDetails",
			id: videoIds.join(","),
			maxResults: String(videoIds.length),
		}),
	);
	const videos = videoDetails.items ?? [];
	const channelIds = [
		...new Set(
			videos
				.map((item) => item.snippet?.channelId)
				.filter((id): id is string => Boolean(id)),
		),
	];
	const channelDetails =
		channelIds.length > 0
			? await fetchYouTubeJson<YouTubeChannelsResponse>(
					"channels",
					new URLSearchParams({
						part: "snippet,statistics",
						id: channelIds.join(","),
						maxResults: String(channelIds.length),
					}),
				)
			: { items: [] };
	const channels = new Map(
		(channelDetails.items ?? []).map((channel) => [channel.id, channel]),
	);

	return {
		query: input.query,
		fetchedAt: new Date().toISOString(),
		order: input.order,
		daysBack: input.daysBack,
		videos: videos.map((video) => {
			const channelId = video.snippet?.channelId ?? "";
			const channel = channels.get(channelId);
			const hiddenSubscriberCount = Boolean(
				channel?.statistics?.hiddenSubscriberCount,
			);
			return {
				videoId: video.id,
				title: video.snippet?.title ?? "",
				description: video.snippet?.description ?? "",
				thumbnail:
					video.snippet?.thumbnails?.maxres?.url ??
					video.snippet?.thumbnails?.high?.url ??
					video.snippet?.thumbnails?.medium?.url ??
					"",
				channelId,
				channelTitle:
					video.snippet?.channelTitle ?? channel?.snippet?.title ?? "",
				publishedAt: video.snippet?.publishedAt ?? "",
				durationSeconds: parseYouTubeDuration(
					video.contentDetails?.duration ?? "",
				),
				viewCount: numberFromStat(video.statistics?.viewCount),
				likeCount: numberFromStat(video.statistics?.likeCount),
				commentCount: numberFromStat(video.statistics?.commentCount),
				channelSubscriberCount: hiddenSubscriberCount
					? null
					: numberFromStat(channel?.statistics?.subscriberCount),
				channelVideoCount: numberFromStat(channel?.statistics?.videoCount),
				channelViewCount: numberFromStat(channel?.statistics?.viewCount),
				hiddenSubscriberCount,
			};
		}),
	};
}

function numberFromStat(value: string | undefined): number {
	const n = Number(value ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function parseYouTubeDuration(duration: string): number {
	const match = duration.match(
		/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
	);
	if (!match) return 0;
	const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
	return (
		Number(days) * 86_400 +
		Number(hours) * 3_600 +
		Number(minutes) * 60 +
		Number(seconds)
	);
}

// ─── 검색 API 캐시 (5분 TTL) ───
const searchCache = createTtlCache<string>(300_000);

// ─── 기사 본문 캐시 (30분 TTL) — 같은 URL 중복 스크래핑 방지 ───
const articleCache = createTtlCache<{
	title: string;
	body: string;
	publisher: string;
	thumbnail?: string;
	images?: string[];
}>(1_800_000);

/**
 * HTML에서 본문 텍스트 추출 — 외부 의존성 없이 readable content 근사.
 * script/style/nav/footer 제거 → article/main 우선 → 그 안의 <p>만 추출.
 */
function extractReadableText(html: string): { title: string; body: string } {
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const ogTitle = html.match(
		/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
	);
	const title = (ogTitle?.[1] ?? titleMatch?.[1] ?? "")
		.replace(/\s+/g, " ")
		.trim();

	// 불필요 블록 제거
	let cleaned = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<nav[\s\S]*?<\/nav>/gi, " ")
		.replace(/<footer[\s\S]*?<\/footer>/gi, " ")
		.replace(/<header[\s\S]*?<\/header>/gi, " ")
		.replace(/<aside[\s\S]*?<\/aside>/gi, " ")
		.replace(/<form[\s\S]*?<\/form>/gi, " ");

	// 본문 영역 좁히기 (article > main > body 순)
	const article = cleaned.match(/<article[\s\S]*?<\/article>/i);
	const main = cleaned.match(/<main[\s\S]*?<\/main>/i);
	if (article) cleaned = article[0];
	else if (main) cleaned = main[0];

	// <p> 태그 내용만 수집 (기사 본문은 대부분 <p>)
	const paragraphs: string[] = [];
	const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
	let match: RegExpExecArray | null;
	while (true) {
		match = pRegex.exec(cleaned);
		if (match === null) break;
		const text = match[1]
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			.replace(/\s+/g, " ")
			.trim();
		if (text.length > 20) paragraphs.push(text);
	}

	let body = paragraphs.join("\n\n");
	// fallback: <p>가 부실하면 전체 스트립
	if (body.length < 200) {
		body = cleaned
			.replace(/<[^>]+>/g, " ")
			.replace(/&nbsp;/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	// 과도하게 긴 본문은 12KB로 자름 (토큰 절약)
	if (body.length > 12000) body = `${body.slice(0, 12000)}…`;

	return { title, body };
}

function extractArticleMedia(
	html: string,
	baseUrl: string,
): { thumbnail?: string; images: string[] } {
	function absolutize(raw?: string): string {
		if (!raw) return "";
		try {
			const resolved = new URL(raw, baseUrl).href;
			return isSafeFetchUrl(resolved) ? resolved : "";
		} catch {
			return "";
		}
	}

	const ogImage =
		html.match(
			/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
		)?.[1] ??
		html.match(
			/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
		)?.[1] ??
		"";

	const imageUrls: string[] = [];
	const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
	for (const match of html.matchAll(imgRegex)) {
		const abs = absolutize(match[1]);
		if (!abs) continue;
		if (
			!/\.(png|jpe?g|webp)(\?|#|$)/i.test(abs) &&
			!/\/image|\/img/i.test(abs)
		) {
			continue;
		}
		imageUrls.push(abs);
		if (imageUrls.length >= 8) break;
	}

	const deduped = [
		...new Set([absolutize(ogImage), ...imageUrls].filter(Boolean)),
	];
	return {
		thumbnail: deduped[0],
		images: deduped.slice(0, 6),
	};
}

function extractPublisher(rawUrl: string): string {
	try {
		const host = new URL(rawUrl).hostname.replace(/^www\./, "");
		return host;
	} catch {
		return "";
	}
}

// ─── HTTP 서버 ───

const startedAt = new Date().toISOString();

// 진단용 시스템 상태 생성기 — /api/diag/health와 /api/diag/agent에서 공통 사용
async function buildHealthReport(): Promise<DiagHealthReport> {
	const serverResults = await Promise.all([
		checkServer("video-proxy", 3456),
		checkServer("youtube-upload", 3457),
		checkServer("render-queue", 3458),
		checkServer("tiktok-upload", 3461),
		checkServer("instagram-upload", 3462),
	]);
	return {
		timestamp: new Date().toISOString(),
		apiProxy: {
			uptimeSeconds: Math.floor(process.uptime()),
			startedAt,
		},
		keys: {
			configured: Object.entries(KEYS)
				.filter(([, v]) => Boolean(v))
				.map(([k]) => k),
			missing: Object.entries(KEYS)
				.filter(([, v]) => !v)
				.map(([k]) => k),
		},
		servers: [
			{
				name: "api-proxy",
				port: PORT,
				url: `http://localhost:${PORT}/health`,
				ok: true,
				statusCode: 200,
				latencyMs: 0,
			},
			...serverResults,
		],
		caches: {
			search: { size: searchCache.size },
			article: { size: articleCache.size },
		},
	};
}

const server = createServer(async (req, res) => {
	trackRequest(req, res, SERVICE);
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

	if (req.method === "OPTIONS") {
		res.writeHead(204, cors(req));
		res.end();
		return;
	}

	// Rate limiting (티어별 차등; health/metrics/errors 는 bypass)
	const tier = defaultTierForPath(url.pathname);
	if (tier !== "bypass") {
		const rl = tieredLimit.check(tier, req);
		res.setHeader("X-RateLimit-Tier", rl.tier);
		res.setHeader("X-RateLimit-Remaining", String(rl.remaining));
		res.setHeader("X-RateLimit-Reset", String(rl.resetAt));
		if (!rl.allowed) {
			log.warn("Rate limit exceeded", {
				ip: req.socket.remoteAddress,
				tier: rl.tier,
				path: url.pathname,
			});
			json(req, res, 429, {
				error: `요청이 너무 많습니다 (tier: ${rl.tier}). 잠시 후 다시 시도하세요.`,
			});
			return;
		}
	}

	// ─── Health ───
	if (url.pathname === "/health") {
		const keyStatus = keyStatusPayload();
		json(req, res, 200, {
			ok: true,
			service: SERVICE,
			uptime: process.uptime(),
			startedAt,
			configured: configuredProviderNames(keyStatus),
			missing: missingProviderNames(keyStatus),
			openaiRuntime: keyStatus.openaiRuntime,
		});
		return;
	}

	// ─── 키 상태 확인 (키 자체는 노출하지 않음) ───
	if (url.pathname === "/api/keys/status" && req.method === "GET") {
		json(req, res, 200, keyStatusPayload());
		return;
	}

	// ─── .env 강제 재로드 후 키 상태 반환 (키 자체는 노출하지 않음) ───
	if (url.pathname === "/api/keys/reload" && req.method === "POST") {
		reloadKeys();
		json(req, res, 200, keyStatusPayload());
		return;
	}

	// ─── .env 키 저장 (값은 응답/로그에 절대 노출하지 않음) ───
	if (url.pathname === "/api/keys/save" && req.method === "POST") {
		if (!isLocalRequest(req)) {
			json(req, res, 403, { error: "local requests only" });
			return;
		}
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}
		const keys = body.keys;
		if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
			json(req, res, 400, { error: "keys object가 필요합니다." });
			return;
		}
		try {
			const saved = saveEnvValues(keys as Record<string, unknown>);
			reloadKeys();
			log.info("API keys saved via settings", {
				updated: saved.updated,
				ignored: saved.ignored,
			});
			json(req, res, 200, {
				ok: true,
				updated: saved.updated,
				ignored: saved.ignored,
				status: keyStatusPayload(),
			});
		} catch (error) {
			json(req, res, 400, {
				error:
					error instanceof Error
						? error.message
						: "키 저장 중 오류가 발생했습니다.",
			});
		}
		return;
	}

	// ─── OpenAI Chat Completions ───
	if (url.pathname === "/api/openai/chat" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.openai, "OpenAI")) return;
		if (rejectOpenAiCooldown(req, res, "api-proxy:chat")) return;
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}

		try {
			const upstream = await fetchWithRetry(
				"https://api.openai.com/v1/chat/completions",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${KEYS.openai}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				// 장편 대본은 max_tokens 8000~12000 으로 생성 시간이 길어 120s 로 상향.
				{ timeout: 120_000 },
			);

			if (!upstream.ok) {
				const err = await upstream.text();
				recordOpenAiResult(false, err, "api-proxy:chat");
				log.error("OpenAI chat error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}
			recordOpenAiResult(true, "", "api-proxy:chat");

			const data = await upstream.json();
			json(req, res, 200, data);
		} catch (e) {
			log.error("OpenAI chat exception", { error: (e as Error).message });
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "OpenAI proxy error",
			});
		}
		return;
	}

	// ─── OpenAI Image Generation (DALL-E) ───
	if (url.pathname === "/api/openai/images" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.openai, "OpenAI")) return;
		if (rejectOpenAiCooldown(req, res, "api-proxy:images")) return;
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}

		try {
			const upstream = await fetchWithRetry(
				"https://api.openai.com/v1/images/generations",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${KEYS.openai}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				{ timeout: 60_000 },
			);

			if (!upstream.ok) {
				const err = await upstream.text();
				recordOpenAiResult(false, err, "api-proxy:images");
				log.error("DALL-E error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}
			recordOpenAiResult(true, "", "api-proxy:images");

			const data = await upstream.json();
			json(req, res, 200, data);
		} catch (e) {
			log.error("DALL-E exception", { error: (e as Error).message });
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "DALL-E proxy error",
			});
		}
		return;
	}

	// ─── FAL 이미지 생성 (flux, 동기 fal.run) ───
	if (url.pathname === "/api/fal/image-gen" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.fal, "FAL")) return;
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}
		try {
			const upstream = await fetchWithRetry(
				"https://fal.run/fal-ai/flux/dev",
				{
					method: "POST",
					headers: {
						Authorization: `Key ${KEYS.fal}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				{ timeout: 120_000 },
			);
			if (!upstream.ok) {
				const err = await upstream.text();
				log.error("FAL image error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}
			const data = await upstream.json();
			json(req, res, 200, data);
		} catch (e) {
			log.error("FAL image exception", { error: (e as Error).message });
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "FAL image proxy error",
			});
		}
		return;
	}

	// ─── OpenAI TTS ───
	if (url.pathname === "/api/openai/tts" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.openai, "OpenAI")) return;
		if (rejectOpenAiCooldown(req, res, "api-proxy:tts")) return;
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}

		try {
			const upstream = await fetchWithRetry(
				"https://api.openai.com/v1/audio/speech",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${KEYS.openai}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				{ timeout: 60_000 },
			);

			if (!upstream.ok) {
				const err = await upstream.text();
				recordOpenAiResult(false, err, "api-proxy:tts");
				log.error("TTS error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}
			recordOpenAiResult(true, "", "api-proxy:tts");

			streamUpstreamBody(req, res, upstream, "audio/mpeg");
		} catch (e) {
			log.error("TTS exception", { error: (e as Error).message });
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "TTS proxy error",
			});
		}
		return;
	}

	// ─── OpenAI Whisper 전사 (단어별 타이밍) ───
	if (url.pathname === "/api/openai/transcribe" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.openai, "OpenAI")) return;
		if (rejectOpenAiCooldown(req, res, "api-proxy:transcribe")) return;

		try {
			// 요청 body는 multipart/form-data로 받아 그대로 upstream에 전달
			// Node http IncomingMessage를 그대로 body stream으로 사용
			const contentType = req.headers["content-type"];
			if (!contentType?.includes("multipart/form-data")) {
				json(req, res, 400, {
					error: "Content-Type must be multipart/form-data",
				});
				return;
			}

			// 최대 25MB (Whisper 한도)
			const MAX = 25 * 1024 * 1024;
			const chunks: Buffer[] = [];
			let size = 0;
			await new Promise<void>((resolve, reject) => {
				req.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX) {
						reject(new Error("body too large (max 25MB)"));
						return;
					}
					chunks.push(chunk);
				});
				req.on("end", resolve);
				req.on("error", reject);
			});

			const bodyBuffer = Buffer.concat(chunks);

			const upstream = await fetchWithRetry(
				"https://api.openai.com/v1/audio/transcriptions",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${KEYS.openai}`,
						"Content-Type": contentType,
					},
					body: bodyBuffer,
				},
				{ timeout: 120_000 },
			);

			if (!upstream.ok) {
				const err = await upstream.text();
				recordOpenAiResult(false, err, "api-proxy:transcribe");
				log.error("Whisper error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}
			recordOpenAiResult(true, "", "api-proxy:transcribe");

			const data = await upstream.json();
			json(req, res, 200, data);
		} catch (e) {
			log.error("Whisper exception", { error: (e as Error).message });
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "Whisper proxy error",
			});
		}
		return;
	}

	// ─── ElevenLabs TTS ───
	const elevenLabsMatch = url.pathname.match(
		/^\/api\/elevenlabs\/tts\/([a-zA-Z0-9]+)$/,
	);
	if (elevenLabsMatch && req.method === "POST") {
		if (!requireKey(req, res, KEYS.elevenlabs, "ElevenLabs")) return;
		const voiceId = elevenLabsMatch[1];
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}

		try {
			const upstream = await fetchWithRetry(
				`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
				{
					method: "POST",
					headers: {
						"xi-api-key": KEYS.elevenlabs,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				{ timeout: 60_000 },
			);

			if (!upstream.ok) {
				const err = await upstream.text();
				log.error("ElevenLabs error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}

			streamUpstreamBody(req, res, upstream, "audio/mpeg");
		} catch (e) {
			log.error("ElevenLabs exception", { error: (e as Error).message });
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "ElevenLabs proxy error",
			});
		}
		return;
	}

	// ─── fal.ai 영상 생성 (T2V / I2V) ───
	if (url.pathname === "/api/fal/video-gen" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.fal, "fal.ai")) return;
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}

		const providerStr = sanitizeString(body.provider, 32);
		if (!providerStr || !(providerStr in FAL_ENDPOINTS)) {
			json(req, res, 400, {
				error: `provider 누락 또는 잘못됨. 허용: ${Object.keys(FAL_ENDPOINTS).join(", ")}`,
			});
			return;
		}
		const provider = providerStr as FalProvider;

		const input = (body.input ?? {}) as Record<string, unknown>;
		if (!input || typeof input !== "object") {
			json(req, res, 400, { error: "input 객체가 필요합니다" });
			return;
		}

		const timeoutMs = sanitizeInt(body.timeout_ms, 10_000, 600_000, 300_000);

		try {
			recordAudit({
				actor: actorFromReq(req),
				action: "fal.video-gen.submit",
				resource: provider,
				outcome: "ok",
				service: SERVICE,
				details: { promptLen: String(input.prompt ?? "").length },
			});
			const result = await submitFalVideo({
				apiKey: KEYS.fal,
				provider,
				input,
				timeoutMs,
				onLog: (m) => log.info("fal status", { provider, m }),
			});
			metricCounter("fal_video_gen_total", { provider, outcome: "ok" });
			json(req, res, 200, {
				video_url: result.video_url,
				request_id: result.request_id,
				provider: result.provider,
				endpoint: result.endpoint,
			});
		} catch (e) {
			metricCounter("fal_video_gen_total", { provider, outcome: "error" });
			const msg = e instanceof Error ? e.message : "fal proxy error";
			recordError({
				service: SERVICE,
				source: "server",
				level: "error",
				message: maskSecrets(msg),
				context: { route: "/api/fal/video-gen", provider },
			});
			log.error("fal video-gen exception", {
				provider,
				error: maskSecrets(msg),
			});
			json(req, res, 500, { error: maskSecrets(msg) });
		}
		return;
	}

	if (url.pathname === "/api/fal/audio-gen" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.fal, "fal.ai")) return;
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}

		const providerStr = sanitizeString(body.provider, 48) || "stableAudio25";
		if (!(providerStr in FAL_AUDIO_ENDPOINTS)) {
			json(req, res, 400, {
				error: `provider 잘못됨. 허용: ${Object.keys(FAL_AUDIO_ENDPOINTS).join(", ")}`,
			});
			return;
		}
		const provider = providerStr as FalAudioProvider;

		const input = (body.input ?? {}) as Record<string, unknown>;
		const prompt = sanitizeString(input.prompt, 2000);
		if (!input || typeof input !== "object" || !prompt) {
			json(req, res, 400, { error: "input.prompt 가 필요합니다" });
			return;
		}
		// 길이 제한된 프롬프트로 교체해 과도한 업스트림 요청 방지
		input.prompt = prompt;

		const timeoutMs = sanitizeInt(body.timeout_ms, 10_000, 600_000, 300_000);

		try {
			recordAudit({
				actor: actorFromReq(req),
				action: "fal.audio-gen.submit",
				resource: provider,
				outcome: "ok",
				service: SERVICE,
				details: { promptLen: String(input.prompt ?? "").length },
			});
			const result = await submitFalAudio({
				apiKey: KEYS.fal,
				provider,
				input,
				timeoutMs,
				onLog: (m) => log.info("fal audio status", { provider, m }),
			});
			metricCounter("fal_audio_gen_total", { provider, outcome: "ok" });
			json(req, res, 200, {
				audio_url: result.audio_url,
				request_id: result.request_id,
				provider: result.provider,
				endpoint: result.endpoint,
			});
		} catch (e) {
			metricCounter("fal_audio_gen_total", { provider, outcome: "error" });
			const msg = e instanceof Error ? e.message : "fal proxy error";
			recordError({
				service: SERVICE,
				source: "server",
				level: "error",
				message: maskSecrets(msg),
				context: { route: "/api/fal/audio-gen", provider },
			});
			log.error("fal audio-gen exception", {
				provider,
				error: maskSecrets(msg),
			});
			json(req, res, 500, { error: maskSecrets(msg) });
		}
		return;
	}

	// ─── 검색 캐시 헬퍼 ───
	async function cachedSearch(
		cacheKey: string,
		fetcher: () => Promise<Response>,
		provider: string,
	) {
		const cached = searchCache.get(cacheKey);
		if (cached) {
			res.writeHead(
				200,
				cors(req, {
					"Content-Type": "application/json",
					"Cache-Control": "public, max-age=300",
					"X-Cache": "HIT",
				}),
			);
			res.end(cached);
			return;
		}
		try {
			const upstream = await fetcher();
			if (!upstream.ok) {
				json(req, res, upstream.status, {
					error: `${provider} error: ${upstream.status}`,
				});
				return;
			}
			const text = await upstream.text();
			searchCache.set(cacheKey, text);
			res.writeHead(
				200,
				cors(req, {
					"Content-Type": "application/json",
					"Cache-Control": "public, max-age=300",
					"X-Cache": "MISS",
				}),
			);
			res.end(text);
		} catch (e) {
			json(req, res, 500, {
				error: e instanceof Error ? e.message : `${provider} proxy error`,
			});
		}
	}

	// ─── Pexels 영상 검색 ───
	if (url.pathname === "/api/pexels/videos" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.pexels, "Pexels")) return;
		const query = sanitizeString(url.searchParams.get("query"), 200);
		const perPage = sanitizeInt(url.searchParams.get("per_page"), 1, 50, 8);
		const size = sanitizeString(url.searchParams.get("size") ?? "medium", 20);
		const key = `pexels-v:${query}:${perPage}:${size}`;

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&size=${size}`,
					{ headers: { Authorization: KEYS.pexels } },
				),
			"Pexels",
		);
		return;
	}

	// ─── Pexels 이미지 검색 ───
	if (url.pathname === "/api/pexels/images" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.pexels, "Pexels")) return;
		const query = sanitizeString(url.searchParams.get("query"), 200);
		const perPage = sanitizeInt(url.searchParams.get("per_page"), 1, 50, 8);
		const key = `pexels-i:${query}:${perPage}`;

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`,
					{ headers: { Authorization: KEYS.pexels } },
				),
			"Pexels",
		);
		return;
	}

	// ─── Pixabay 이미지 검색 ───
	if (url.pathname === "/api/pixabay/images" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.pixabay, "Pixabay")) return;
		const query = sanitizeString(url.searchParams.get("q"), 200);
		const perPage = sanitizeInt(url.searchParams.get("per_page"), 1, 50, 8);
		const key = `pixabay-i:${query}:${perPage}`;

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://pixabay.com/api/?key=${KEYS.pixabay}&q=${encodeURIComponent(query)}&per_page=${perPage}&image_type=photo&safesearch=true`,
				),
			"Pixabay",
		);
		return;
	}

	// ─── Wikimedia Commons 이미지 검색 ───
	if (url.pathname === "/api/wikimedia/images" && req.method === "GET") {
		const query = sanitizeString(url.searchParams.get("query"), 200);
		const limit = sanitizeInt(url.searchParams.get("limit"), 1, 30, 8);
		const key = `wikimedia-i:${query}:${limit}`;
		const params = new URLSearchParams({
			action: "query",
			format: "json",
			generator: "search",
			gsrnamespace: "6",
			gsrlimit: String(limit),
			gsrsearch: `${query} filetype:bitmap`,
			prop: "imageinfo",
			iiprop: "url|size|mime|extmetadata",
			iiurlwidth: "1400",
			origin: "*",
		});

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://commons.wikimedia.org/w/api.php?${params.toString()}`,
					{
						headers: {
							"User-Agent":
								"boltYT-local-video-generator/0.1 (local personal use)",
						},
					},
				),
			"Wikimedia",
		);
		return;
	}

	// ─── Pixabay 영상 검색 ───
	if (url.pathname === "/api/pixabay/videos" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.pixabay, "Pixabay")) return;
		const query = sanitizeString(url.searchParams.get("q"), 200);
		const perPage = sanitizeInt(url.searchParams.get("per_page"), 1, 50, 8);
		const key = `pixabay-v:${query}:${perPage}`;

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://pixabay.com/api/videos/?key=${KEYS.pixabay}&q=${encodeURIComponent(query)}&per_page=${perPage}&safesearch=true`,
				),
			"Pixabay",
		);
		return;
	}

	// ─── Pixabay 음악 검색 ───
	if (url.pathname === "/api/pixabay/music" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.pixabay, "Pixabay")) return;
		const query = sanitizeString(url.searchParams.get("q"), 200);
		const perPage = sanitizeInt(url.searchParams.get("per_page"), 1, 50, 20);
		const minDur = sanitizeInt(
			url.searchParams.get("min_duration"),
			0,
			3600,
			0,
		);
		const maxDur = sanitizeInt(
			url.searchParams.get("max_duration"),
			0,
			3600,
			300,
		);
		const orderRaw = sanitizeString(url.searchParams.get("order"), 20);
		const order =
			orderRaw === "popular" || orderRaw === "latest" ? orderRaw : "";
		const editorRaw = sanitizeString(url.searchParams.get("editors_choice"), 5);
		const editorsChoice = editorRaw === "true";
		const key = `pixabay-m:${query}:${perPage}:${minDur}:${maxDur}:${order}:${editorsChoice}`;

		const params = new URLSearchParams({
			key: KEYS.pixabay,
			q: query,
			per_page: String(perPage),
		});
		if (minDur) params.set("min_duration", String(minDur));
		if (maxDur) params.set("max_duration", String(maxDur));
		if (order) params.set("order", order);
		if (editorsChoice) params.set("editors_choice", "true");

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://pixabay.com/api/videos/music/?${params.toString()}`,
				),
			"Pixabay",
		);
		return;
	}

	// ─── YouTube 영상 검색 ───
	if (url.pathname === "/api/youtube/search" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.youtube, "YouTube")) return;
		const query = sanitizeString(url.searchParams.get("q"), 200);
		const maxResults = sanitizeInt(
			url.searchParams.get("maxResults"),
			1,
			50,
			8,
		);
		const key = `yt:${query}:${maxResults}`;

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&regionCode=KR&relevanceLanguage=ko&key=${KEYS.youtube}`,
				),
			"YouTube",
		);
		return;
	}

	// ─── YouTube 니치 리서치: 검색 결과 + 공개 성과 지표 병합 ───
	if (url.pathname === "/api/youtube/niche-research" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.youtube, "YouTube")) return;
		const query = sanitizeString(url.searchParams.get("q"), 200);
		if (!query) {
			json(req, res, 400, { error: "q 파라미터가 필요합니다." });
			return;
		}
		const maxResults = sanitizeInt(
			url.searchParams.get("maxResults"),
			1,
			25,
			12,
		);
		const daysBack = sanitizeInt(
			url.searchParams.get("daysBack"),
			7,
			3650,
			365,
		);
		const orderRaw = sanitizeString(url.searchParams.get("order"), 20);
		const order =
			orderRaw === "date" || orderRaw === "relevance" ? orderRaw : "viewCount";
		const key = `yt-niche:${query}:${maxResults}:${daysBack}:${order}`;
		const cached = searchCache.get(key);
		if (cached) {
			res.writeHead(
				200,
				cors(req, {
					"Content-Type": "application/json",
					"Cache-Control": "public, max-age=300",
					"X-Cache": "HIT",
				}),
			);
			res.end(cached);
			return;
		}

		try {
			const payload = await buildYouTubeNicheResearch({
				query,
				maxResults,
				daysBack,
				order,
			});
			const text = JSON.stringify(payload);
			searchCache.set(key, text);
			res.writeHead(
				200,
				cors(req, {
					"Content-Type": "application/json",
					"Cache-Control": "public, max-age=300",
					"X-Cache": "MISS",
				}),
			);
			res.end(text);
		} catch (e) {
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "YouTube niche proxy error",
			});
		}
		return;
	}

	// ─── YouTube 포맷 법칙 분석: 상위 영상 앞부분의 훅/컷/오프닝 패턴 추정 ───
	if (
		url.pathname === "/api/youtube/format-analysis" &&
		req.method === "POST"
	) {
		const body = await parseBody(req);
		if (!body) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 1MB)" });
			return;
		}
		const query = sanitizeString(String(body.query ?? ""), 200);
		const sampleSeconds = sanitizeInt(
			String(body.sampleSeconds ?? ""),
			30,
			120,
			90,
		);
		const rawVideos = Array.isArray(body.videos) ? body.videos : [];
		const videos = rawVideos
			.slice(0, 3)
			.map((item) => item as Record<string, unknown>)
			.map((item) => ({
				videoId: sanitizeString(String(item.videoId ?? ""), 20),
				title: sanitizeString(String(item.title ?? ""), 200),
				durationSeconds: Number(item.durationSeconds ?? 0),
				viewCount: Number(item.viewCount ?? 0),
			}))
			.filter((item) => /^[A-Za-z0-9_-]{11}$/.test(item.videoId));

		if (videos.length === 0) {
			json(req, res, 400, { error: "분석할 videoId가 필요합니다." });
			return;
		}

		try {
			const payload = await buildYouTubeFormatAnalysis({
				query,
				videos,
				sampleSeconds,
			});
			json(req, res, 200, payload);
		} catch (e) {
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "YouTube format analysis error",
			});
		}
		return;
	}

	// ─── 네이버 뉴스 검색 ───
	if (url.pathname === "/api/naver/news" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.naverClientId, "네이버")) return;
		const query = sanitizeString(url.searchParams.get("query"), 200);
		const display = sanitizeInt(url.searchParams.get("display"), 1, 100, 10);
		const rawSort = url.searchParams.get("sort") ?? "sim";
		const sort = rawSort === "date" ? "date" : "sim";
		const key = `naver-n:${query}:${display}:${sort}`;

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://openapi.naver.com/v1/search/news?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`,
					{
						headers: {
							"X-Naver-Client-Id": KEYS.naverClientId,
							"X-Naver-Client-Secret": KEYS.naverClientSecret,
						},
					},
				),
			"네이버",
		);
		return;
	}

	// ─── 네이버 이미지 검색 ───
	if (url.pathname === "/api/naver/images" && req.method === "GET") {
		if (!requireKey(req, res, KEYS.naverClientId, "네이버")) return;
		const query = sanitizeString(url.searchParams.get("query"), 200);
		const display = sanitizeInt(url.searchParams.get("display"), 1, 100, 12);
		const rawImgSort = url.searchParams.get("sort") ?? "sim";
		const sort = rawImgSort === "date" ? "date" : "sim";
		const key = `naver-i:${query}:${display}:${sort}`;

		await cachedSearch(
			key,
			() =>
				fetchWithRetry(
					`https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(query)}&display=${display}&sort=${sort}`,
					{
						headers: {
							"X-Naver-Client-Id": KEYS.naverClientId,
							"X-Naver-Client-Secret": KEYS.naverClientSecret,
						},
					},
				),
			"네이버",
		);
		return;
	}

	// ─── Diagnostics/관측 엔드포인트 공통 인증 (DIAG_TOKEN 설정 시 활성) ───
	if (
		url.pathname.startsWith("/api/diag/") ||
		url.pathname === "/api/metrics" ||
		url.pathname === "/api/errors"
	) {
		if (DIAG_TOKEN && req.headers["x-diag-token"] !== DIAG_TOKEN) {
			json(req, res, 401, {
				error: "인증 토큰이 필요합니다 (X-Diag-Token 헤더).",
			});
			return;
		}
	}

	// ─── 메트릭 스냅샷 ───
	if (url.pathname === "/api/metrics" && req.method === "GET") {
		json(req, res, 200, metricsSnapshot());
		return;
	}

	// ─── 에러 ring buffer 조회/초기화 ───
	if (url.pathname === "/api/errors") {
		if (req.method === "DELETE") {
			clearErrorsBuffer();
			json(req, res, 200, { ok: true });
			return;
		}
		if (req.method === "GET") {
			const service =
				sanitizeString(url.searchParams.get("service"), 64) || undefined;
			const sourceRaw = url.searchParams.get("source");
			const levelRaw = url.searchParams.get("level");
			const source =
				sourceRaw === "server" || sourceRaw === "client"
					? sourceRaw
					: undefined;
			const level =
				levelRaw === "error" || levelRaw === "warn" ? levelRaw : undefined;
			const limit = sanitizeInt(url.searchParams.get("limit"), 1, 200) ?? 200;
			const errors = listErrorsBuffer({ service, source, level, limit });
			json(req, res, 200, { errors });
			return;
		}
	}

	// ─── 클라이언트 telemetry 수집 (토큰 없이 허용, rate-limit 적용) ───
	if (url.pathname === "/api/telemetry" && req.method === "POST") {
		const body = await parseBody(req);
		const rawEvents =
			body && Array.isArray((body as { events?: unknown }).events)
				? ((body as { events: unknown[] }).events as unknown[])
				: null;
		if (!rawEvents) {
			json(req, res, 400, { error: "events array required" });
			return;
		}
		let accepted = 0;
		for (const raw of rawEvents.slice(0, 100)) {
			if (!raw || typeof raw !== "object") continue;
			const e = raw as Record<string, unknown>;
			const message =
				typeof e.message === "string" ? e.message.slice(0, 500) : "";
			if (!message) continue;
			const level: "error" | "warn" = e.level === "warn" ? "warn" : "error";
			const service =
				(typeof e.service === "string" ? sanitizeString(e.service, 64) : "") ||
				"browser";
			recordError({
				service,
				source: "client",
				level,
				message: maskSecrets(message),
				stack:
					typeof e.stack === "string"
						? maskSecrets(e.stack.slice(0, 2000))
						: undefined,
				url:
					typeof e.url === "string"
						? maskSecrets(e.url.slice(0, 512))
						: undefined,
				status: typeof e.status === "number" ? e.status : undefined,
			});
			metricCounter("client_errors_total", { service, level });
			accepted++;
		}
		json(req, res, 200, { accepted });
		return;
	}

	// ─── Diagnostics: 시스템 상태 리포트 ───
	if (url.pathname === "/api/diag/health" && req.method === "GET") {
		json(req, res, 200, await buildHealthReport());
		return;
	}

	// ─── Diagnostics: Agent (LLM tool-use) ───
	if (url.pathname === "/api/diag/agent" && req.method === "POST") {
		log.info("agent endpoint hit", { method: req.method });
		if (!requireKey(req, res, KEYS.openai, "OpenAI")) {
			log.warn("agent blocked: OpenAI key missing");
			recordAudit({
				actor: actorFromReq(req),
				action: "run-agent",
				outcome: "denied",
				service: SERVICE,
				details: { reason: "OpenAI key missing" },
			});
			return;
		}
		const body = await parseBody(req);
		if (!body) {
			log.warn("agent blocked: payload too large or parse failed");
			json(req, res, 413, { ok: false, message: "payload too large" });
			return;
		}
		log.info("agent body parsed", {
			goalType: typeof body.goal,
			goalLength: typeof body.goal === "string" ? body.goal.length : 0,
			maxIterations: body.maxIterations,
		});
		const goal =
			typeof body.goal === "string" ? sanitizeString(body.goal, 1000) : "";
		if (!goal) {
			log.warn("agent blocked: empty goal");
			json(req, res, 400, { ok: false, message: "goal required" });
			return;
		}
		const maxIterations =
			typeof body.maxIterations === "number"
				? Math.max(1, Math.min(10, body.maxIterations))
				: 5;

		try {
			log.info("agent starting runAgent", {
				goal: goal.slice(0, 80),
				maxIterations,
			});
			const result = await runAgent({
				goal,
				apiKey: KEYS.openai,
				maxIterations,
				getHealth: buildHealthReport,
				ctx: {
					clearCache: (target) => {
						if (target === "search") return searchCache.clear();
						if (target === "article") return articleCache.clear();
						return searchCache.clear() + articleCache.clear();
					},
					reloadKeys: () => {
						reloadKeys();
						return Object.entries(KEYS)
							.filter(([, v]) => Boolean(v))
							.map(([k]) => k);
					},
				},
			});
			log.info("agent run complete", {
				goal: goal.slice(0, 80),
				resolved: result.resolved,
				iterations: result.iterations,
				traceSteps: result.trace.length,
			});
			recordAudit({
				actor: actorFromReq(req),
				action: "run-agent",
				outcome: "ok",
				service: SERVICE,
				details: {
					goal: goal.slice(0, 160),
					resolved: result.resolved,
					iterations: result.iterations,
				},
			});
			json(req, res, 200, result);
		} catch (err) {
			const message = err instanceof Error ? err.message : "agent failed";
			const stack =
				err instanceof Error
					? err.stack?.split("\n").slice(0, 5).join("\n")
					: undefined;
			log.error("agent error", { error: message, stack });
			json(req, res, 500, { ok: false, message });
		}
		return;
	}

	// ─── Diagnostics: 명령 실행 (화이트리스트) ───
	if (url.pathname === "/api/diag/command" && req.method === "POST") {
		const body = await parseBody(req);
		if (!body) {
			json(req, res, 413, { ok: false, message: "payload too large" });
			return;
		}
		const name =
			typeof body.name === "string" ? sanitizeString(body.name, 64) : "";
		if (!name) {
			json(req, res, 400, { ok: false, message: "name required" });
			return;
		}
		const args =
			body.args && typeof body.args === "object"
				? (body.args as Record<string, unknown>)
				: {};

		const registry = createCommandRegistry();
		const result = await runCommand(registry, name, args, {
			clearCache: (target) => {
				if (target === "search") return searchCache.clear();
				if (target === "article") return articleCache.clear();
				return searchCache.clear() + articleCache.clear();
			},
			reloadKeys: () => {
				reloadKeys();
				return Object.entries(KEYS)
					.filter(([, v]) => Boolean(v))
					.map(([k]) => k);
			},
		});
		log.info("diag command", { name, ok: result.ok });
		recordAudit({
			actor: actorFromReq(req),
			action: `diag-command:${name}`,
			resource:
				typeof args.target === "string" ? String(args.target) : undefined,
			outcome: result.ok ? "ok" : "error",
			service: SERVICE,
		});
		json(req, res, result.ok ? 200 : 400, result);
		return;
	}

	// ─── 기사 본문 스크래핑 ───
	// GET /api/fetch-article?url=https://... → { title, body, publisher }
	if (url.pathname === "/api/fetch-article" && req.method === "GET") {
		const targetUrl = sanitizeString(url.searchParams.get("url"), 2048);
		if (!targetUrl || !isSafeFetchUrl(targetUrl)) {
			json(req, res, 400, { error: "유효한 url 파라미터가 필요합니다." });
			return;
		}

		const cacheKey = `article:${targetUrl}`;
		const cached = articleCache.get(cacheKey);
		if (cached) {
			json(req, res, 200, cached);
			return;
		}

		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15_000);
			const upstream = await fetch(targetUrl, {
				headers: {
					// 일부 언론사는 User-Agent 없으면 403
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml",
					"Accept-Language": "ko,en;q=0.8",
				},
				signal: controller.signal,
				redirect: "manual",
			}).finally(() => clearTimeout(timeout));

			// 리다이렉트 시 최종 URL SSRF 재검증
			if (upstream.status >= 300 && upstream.status < 400) {
				const location = upstream.headers.get("location") ?? "";
				const resolvedUrl = location ? new URL(location, targetUrl).href : "";
				if (!resolvedUrl || !isSafeFetchUrl(resolvedUrl)) {
					json(req, res, 403, {
						error: "리다이렉트 대상이 허용되지 않는 주소입니다.",
						title: "",
						body: "",
						publisher: extractPublisher(targetUrl),
					});
					return;
				}
				// 안전한 리다이렉트 → 재요청
				const rController = new AbortController();
				const rTimeout = setTimeout(() => rController.abort(), 15_000);
				const redirected = await fetch(resolvedUrl, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
						Accept: "text/html,application/xhtml+xml",
						"Accept-Language": "ko,en;q=0.8",
					},
					signal: rController.signal,
					redirect: "manual",
				}).finally(() => clearTimeout(rTimeout));
				if (!redirected.ok) {
					json(req, res, 502, {
						error: `upstream ${redirected.status}`,
						title: "",
						body: "",
						publisher: extractPublisher(targetUrl),
					});
					return;
				}
				const rCt = redirected.headers.get("content-type") ?? "";
				if (!rCt.includes("text/") && !rCt.includes("html")) {
					json(req, res, 415, {
						error: "HTML이 아닙니다.",
						title: "",
						body: "",
						publisher: extractPublisher(targetUrl),
					});
					return;
				}
				const rHtml = await redirected.text();
				const rResult = extractReadableText(rHtml);
				const rMedia = extractArticleMedia(rHtml, resolvedUrl);
				const rPayload = {
					title: rResult.title,
					body: rResult.body,
					publisher: extractPublisher(resolvedUrl),
					thumbnail: rMedia.thumbnail,
					images: rMedia.images,
				};
				articleCache.set(cacheKey, rPayload);
				json(req, res, 200, rPayload);
				return;
			}

			if (!upstream.ok) {
				json(req, res, 502, {
					error: `upstream ${upstream.status}`,
					title: "",
					body: "",
					publisher: extractPublisher(targetUrl),
				});
				return;
			}

			const contentType = upstream.headers.get("content-type") ?? "";
			if (!contentType.includes("text/") && !contentType.includes("html")) {
				json(req, res, 415, {
					error: "HTML이 아닙니다.",
					title: "",
					body: "",
					publisher: extractPublisher(targetUrl),
				});
				return;
			}

			const html = await upstream.text();
			const { title, body } = extractReadableText(html);
			const media = extractArticleMedia(html, targetUrl);
			const publisher = extractPublisher(targetUrl);
			const payload = {
				title,
				body,
				publisher,
				thumbnail: media.thumbnail,
				images: media.images,
			};
			articleCache.set(cacheKey, payload);
			json(req, res, 200, payload);
		} catch (err) {
			const message = err instanceof Error ? err.message : "unknown";
			log.warn("fetch-article failed", { url: targetUrl, message });
			json(req, res, 500, {
				error: message,
				title: "",
				body: "",
				publisher: extractPublisher(targetUrl),
			});
		}
		return;
	}

	json(req, res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
	log.info("Server started", {
		port: PORT,
		configured: Object.entries(KEYS)
			.filter(([, v]) => Boolean(v))
			.map(([k]) => k),
		missing: Object.entries(KEYS)
			.filter(([, v]) => !v)
			.map(([k]) => k),
	});
});

// .env 파일 변경 시 자동으로 키 재로드 — 서버 재시작 불필요
watchEnv(() => {
	reloadKeys();
	log.info(".env reloaded", {
		configured: Object.entries(KEYS)
			.filter(([, v]) => Boolean(v))
			.map(([k]) => k),
	});
});

setupGracefulShutdown(server, SERVICE);
