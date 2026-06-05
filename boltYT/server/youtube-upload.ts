/**
 * YouTube 업로드 서버 — OAuth 2.0 + Data API v3
 *
 * 실행: npx tsx server/youtube-upload.ts
 *
 * 필요 환경변수:
 *   GOOGLE_CLIENT_ID      — Google Cloud Console에서 발급
 *   GOOGLE_CLIENT_SECRET   — Google Cloud Console에서 발급
 *
 * 엔드포인트:
 *   GET  /auth/url          — OAuth 인증 URL 생성
 *   GET  /auth/callback      — OAuth 콜백 (토큰 교환)
 *   GET  /auth/status        — 인증 상태 확인
 *   POST /auth/revoke        — 토큰 삭제
 *   POST /upload             — 영상 업로드
 *   POST /upload/schedule    — 예약 업로드
 *   GET  /analytics/:videoId — 영상 분석 데이터
 *   GET  /analytics/deep/:videoId — 심화 분석 데이터
 *   GET  /comments/:videoId  — 영상 댓글 데이터
 *   GET  /health             — 상태 확인
 */

import {
	createReadStream,
	existsSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { google } from "googleapis";
import { loadEnv, validateEnv } from "./lib/env.ts";
import { createLogger } from "./lib/logger.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";
import { escapeHtml } from "./lib/validate.ts";

const SERVICE = "youtube-upload";
const log = createLogger(SERVICE);

loadEnv();
validateEnv(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], SERVICE);

const PORT = Number(process.env.YT_PORT ?? 3457);
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const TOKEN_PATH = join(import.meta.dirname ?? ".", ".youtube-token.json");

// OAuth 클라이언트 설정
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

const SCOPES = [
	"https://www.googleapis.com/auth/youtube.upload",
	"https://www.googleapis.com/auth/youtube",
	"https://www.googleapis.com/auth/youtube.readonly",
	"https://www.googleapis.com/auth/yt-analytics.readonly",
];

function createOAuthClient() {
	return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

/** 저장된 토큰 로드 */
function loadToken(): Record<string, unknown> | null {
	if (!existsSync(TOKEN_PATH)) return null;
	try {
		return JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
	} catch {
		return null;
	}
}

/** 토큰 저장 */
function saveToken(token: Record<string, unknown>) {
	writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

/** 인증된 YouTube 클라이언트 생성 */
function getAuthenticatedAuth() {
	const token = loadToken();
	if (!token) return null;

	const auth = createOAuthClient();
	auth.setCredentials(token);
	return auth;
}

/** 인증된 YouTube 클라이언트 생성 */
function getAuthenticatedClient() {
	const auth = getAuthenticatedAuth();
	if (!auth) return null;
	return google.youtube({ version: "v3", auth });
}

const rateLimit = createRateLimiter({ windowMs: 60_000, max: 30 });

/** CORS 헤더 — localhost 전용 */
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

function cors(
	req: import("node:http").IncomingMessage,
	headers: Record<string, string> = {},
) {
	const origin = req.headers.origin ?? "";
	const baseHeaders = {
		...headers,
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		Vary: "Origin",
	};
	if (!ALLOWED_ORIGINS.has(origin)) return baseHeaders;
	return {
		...baseHeaders,
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Credentials": "true",
	};
}

/** 요청 바디 파싱 */
async function parseBody(
	req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch {
				resolve({});
			}
		});
		req.on("error", reject);
	});
}

/** multipart/form-data에서 파일 추출 (간단 구현) */
async function parseMultipart(
	req: import("node:http").IncomingMessage,
): Promise<{ fields: Record<string, string>; filePath?: string }> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const body = Buffer.concat(chunks);
			const contentType = req.headers["content-type"] ?? "";

			// JSON 바디인 경우 (filePath 전달 방식)
			if (contentType.includes("application/json")) {
				try {
					const parsed = JSON.parse(body.toString());
					resolve({ fields: parsed as Record<string, string> });
				} catch {
					resolve({ fields: {} });
				}
				return;
			}

			resolve({ fields: {} });
		});
		req.on("error", reject);
	});
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

function decodeThumbnailDataUrl(dataUrl: string): {
	buffer: Buffer;
	mimeType: "image/jpeg" | "image/png";
	ext: "jpg" | "png";
} {
	const match = /^data:(image\/(?:jpeg|jpg|png));base64,([A-Za-z0-9+/=]+)$/i.exec(
		dataUrl,
	);
	if (!match) {
		throw new Error("썸네일은 JPEG 또는 PNG data URL이어야 합니다.");
	}
	const rawMime = match[1].toLowerCase();
	const mimeType = rawMime === "image/png" ? "image/png" : "image/jpeg";
	const buffer = Buffer.from(match[2], "base64");
	if (buffer.length > 2 * 1024 * 1024) {
		throw new Error("썸네일 파일은 2MB 이하여야 합니다.");
	}
	return {
		buffer,
		mimeType,
		ext: mimeType === "image/png" ? "png" : "jpg",
	};
}

type AnalyticsCell = string | number | null | undefined;

interface AnalyticsReport {
	columnHeaders?: Array<{ name?: string | null }>;
	rows?: AnalyticsCell[][];
}

function analyticsDateRange(days: number) {
	const safeDays = Math.max(1, Math.min(90, Math.round(days || 28)));
	const end = new Date();
	end.setUTCDate(end.getUTCDate() - 1);
	const start = new Date(end);
	start.setUTCDate(start.getUTCDate() - safeDays + 1);
	return {
		startDate: start.toISOString().slice(0, 10),
		endDate: end.toISOString().slice(0, 10),
	};
}

function reportRows(report: AnalyticsReport | null | undefined): Record<string, AnalyticsCell>[] {
	const headers = report?.columnHeaders?.map((header) => header.name ?? "") ?? [];
	return (report?.rows ?? []).map((row) => {
		const record: Record<string, AnalyticsCell> = {};
		headers.forEach((header, index) => {
			record[header] = row[index];
		});
		return record;
	});
}

function num(value: AnalyticsCell): number {
	const parsed = Number(value ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

async function queryAnalyticsReport(
	auth: ReturnType<typeof createOAuthClient>,
	params: {
		startDate: string;
		endDate: string;
		metrics: string;
		dimensions?: string;
		filters?: string;
		sort?: string;
		maxResults?: number;
	},
): Promise<AnalyticsReport> {
	const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth });
	const response = await youtubeAnalytics.reports.query({
		ids: "channel==MINE",
		startDate: params.startDate,
		endDate: params.endDate,
		metrics: params.metrics,
		dimensions: params.dimensions,
		filters: params.filters,
		sort: params.sort,
		maxResults: params.maxResults,
	});
	return response.data as AnalyticsReport;
}

async function fetchDeepAnalytics(input: {
	auth: ReturnType<typeof createOAuthClient>;
	videoId: string;
	days: number;
	baseStats: {
		videoId: string;
		title: string;
		views: number;
		likes: number;
		comments: number;
		favorites: number;
	};
}) {
	const { auth, videoId, days, baseStats } = input;
	const { startDate, endDate } = analyticsDateRange(days);
	const warnings: string[] = [];
	const filters = `video==${videoId}`;
	let summary: Record<string, AnalyticsCell> = {};
	let dailyRows: Record<string, AnalyticsCell>[] = [];
	let trafficRows: Record<string, AnalyticsCell>[] = [];
	let retentionRows: Record<string, AnalyticsCell>[] = [];

	try {
		const report = await queryAnalyticsReport(auth, {
			startDate,
			endDate,
			filters,
			metrics:
				"views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost",
		});
		summary = reportRows(report)[0] ?? {};
	} catch (error) {
		warnings.push(
			`summary analytics unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
		);
	}

	try {
		const report = await queryAnalyticsReport(auth, {
			startDate,
			endDate,
			filters,
			dimensions: "day",
			metrics:
				"views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost",
			sort: "day",
		});
		dailyRows = reportRows(report);
	} catch (error) {
		warnings.push(
			`daily analytics unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
		);
	}

	try {
		const report = await queryAnalyticsReport(auth, {
			startDate,
			endDate,
			filters,
			dimensions: "insightTrafficSourceType",
			metrics: "views,estimatedMinutesWatched,averageViewDuration",
			sort: "-views",
			maxResults: 12,
		});
		trafficRows = reportRows(report);
	} catch (error) {
		warnings.push(
			`traffic source analytics unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
		);
	}

	try {
		const report = await queryAnalyticsReport(auth, {
			startDate,
			endDate,
			filters,
			dimensions: "elapsedVideoTimeRatio",
			metrics: "audienceWatchRatio,relativeRetentionPerformance",
			sort: "elapsedVideoTimeRatio",
		});
		retentionRows = reportRows(report);
	} catch (error) {
		warnings.push(
			`retention analytics unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
		);
	}

	return {
		...baseStats,
		dateRange: { startDate, endDate },
		views: num(summary.views) || baseStats.views,
		likes: num(summary.likes) || baseStats.likes,
		comments: num(summary.comments) || baseStats.comments,
		estimatedMinutesWatched: num(summary.estimatedMinutesWatched),
		averageViewDuration: num(summary.averageViewDuration),
		averageViewPercentage: num(summary.averageViewPercentage),
		subscribersGained: num(summary.subscribersGained),
		subscribersLost: num(summary.subscribersLost),
		shares: num(summary.shares),
		impressions: null,
		impressionCtr: null,
		trafficSources: trafficRows.map((row) => ({
			source: String(row.insightTrafficSourceType ?? "UNKNOWN"),
			views: num(row.views),
			estimatedMinutesWatched: num(row.estimatedMinutesWatched),
			averageViewDuration: num(row.averageViewDuration),
		})),
		retentionCurve: retentionRows.map((row) => ({
			elapsedVideoTimeRatio: num(row.elapsedVideoTimeRatio),
			audienceWatchRatio: num(row.audienceWatchRatio),
			relativeRetentionPerformance:
				row.relativeRetentionPerformance === undefined
					? null
					: num(row.relativeRetentionPerformance),
		})),
		dailyRows: dailyRows.map((row) => ({
			day: String(row.day ?? ""),
			views: num(row.views),
			estimatedMinutesWatched: num(row.estimatedMinutesWatched),
			averageViewDuration: num(row.averageViewDuration),
			averageViewPercentage: num(row.averageViewPercentage),
			likes: num(row.likes),
			comments: num(row.comments),
			shares: num(row.shares),
			subscribersGained: num(row.subscribersGained),
			subscribersLost: num(row.subscribersLost),
		})),
		warnings: [
			...warnings,
			"impressions/CTR are shown in YouTube Studio; this endpoint stores them as null unless a supported API report is available.",
		],
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

	// Rate limiting (health 제외)
	if (url.pathname !== "/health") {
		const rl = rateLimit(req);
		if (!rl.allowed) {
			log.warn("Rate limit exceeded", { ip: req.socket.remoteAddress });
			json(req, res, 429, { error: "요청이 너무 많습니다." });
			return;
		}
	}

	// ─── Health ───
	if (url.pathname === "/health") {
		const hasCredentials = Boolean(CLIENT_ID && CLIENT_SECRET);
		const hasToken = loadToken() !== null;
		json(req, res, 200, {
			ok: true,
			service: SERVICE,
			configured: hasCredentials,
			authenticated: hasToken,
			uptime: process.uptime(),
		});
		return;
	}

	// ─── OAuth: 인증 URL 생성 ───
	if (url.pathname === "/auth/url" && req.method === "GET") {
		if (!CLIENT_ID || !CLIENT_SECRET) {
			json(req, res, 400, {
				error: "GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET 환경변수를 설정하세요.",
			});
			return;
		}

		const auth = createOAuthClient();
		const authUrl = auth.generateAuthUrl({
			access_type: "offline",
			scope: SCOPES,
			prompt: "consent",
		});

		json(req, res, 200, { url: authUrl });
		return;
	}

	// ─── OAuth: 콜백 (토큰 교환) ───
	if (url.pathname === "/auth/callback" && req.method === "GET") {
		const code = url.searchParams.get("code");
		if (!code) {
			res.writeHead(400, { "Content-Type": "text/html" });
			res.end("<h1>인증 실패</h1><p>code 파라미터가 없습니다.</p>");
			return;
		}

		try {
			const auth = createOAuthClient();
			const { tokens } = await auth.getToken(code);
			saveToken(tokens as Record<string, unknown>);

			// 브라우저에서 보이는 성공 페이지
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(`
				<!DOCTYPE html>
				<html><head><title>YouTube 연동 완료</title></head>
				<body style="font-family:sans-serif;text-align:center;padding:60px">
					<h1>YouTube 연동 완료!</h1>
					<p>이 창을 닫고 boltYT로 돌아가세요.</p>
					<script>
						if(window.opener){window.opener.postMessage({type:'youtube-auth-success'},window.opener.location.origin);setTimeout(()=>window.close(),1500)}
					</script>
				</body></html>
			`);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Token exchange failed";
			log.error("OAuth token exchange failed", { error: msg });
			res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
			res.end(`<h1>인증 실패</h1><p>${escapeHtml(msg)}</p>`);
		}
		return;
	}

	// ─── OAuth: 인증 상태 ───
	if (url.pathname === "/auth/status" && req.method === "GET") {
		const token = loadToken();
		if (!token) {
			json(req, res, 200, { authenticated: false });
			return;
		}

		try {
			const youtube = getAuthenticatedClient();
			if (!youtube) {
				json(req, res, 200, { authenticated: false });
				return;
			}

			const channelRes = await youtube.channels.list({
				part: ["snippet"],
				mine: true,
			});

			const channel = channelRes.data.items?.[0];
			json(req, res, 200, {
				authenticated: true,
				channel: channel
					? {
							id: channel.id,
							title: channel.snippet?.title,
							thumbnail: channel.snippet?.thumbnails?.default?.url,
						}
					: null,
			});
		} catch {
			// 토큰 만료 등
			json(req, res, 200, { authenticated: false, expired: true });
		}
		return;
	}

	// ─── OAuth: 토큰 삭제 ───
	if (url.pathname === "/auth/revoke" && req.method === "POST") {
		try {
			const token = loadToken();
			if (token) {
				const auth = createOAuthClient();
				auth.setCredentials(token);
				await auth.revokeCredentials();
			}
		} catch {
			// revoke 실패해도 로컬 토큰은 삭제
		}

		try {
			const { unlinkSync } = await import("node:fs");
			unlinkSync(TOKEN_PATH);
		} catch {
			// 파일 없으면 무시
		}

		json(req, res, 200, { ok: true });
		return;
	}

	// ─── 영상 업로드 ───
	if (url.pathname === "/upload" && req.method === "POST") {
		const youtube = getAuthenticatedClient();
		if (!youtube) {
			json(req, res, 401, { error: "YouTube 인증이 필요합니다." });
			return;
		}

		const { fields } = await parseMultipart(req);
		const rawFilePath = fields.filePath as string;
		const title = (fields.title as string) || "Untitled";
		const description = (fields.description as string) || "";
		const tags = fields.tags
			? typeof fields.tags === "string"
				? fields.tags.split(",")
				: (fields.tags as unknown as string[])
			: [];
		const thumbnailDataUrl =
			typeof fields.thumbnailDataUrl === "string"
				? fields.thumbnailDataUrl
				: "";
		const privacyStatus = (fields.privacyStatus as string) || "private";
		const scheduledAt = fields.scheduledAt as string | undefined;

		// 보안: 렌더 출력 디렉토리로 경로 제한
		if (!rawFilePath) {
			json(req, res, 400, { error: "파일 경로가 비어있습니다." });
			return;
		}
		const RENDERS_DIR = resolve(import.meta.dirname ?? ".", "../renders");
		const filePath = resolve(rawFilePath);
		if (!filePath.startsWith(RENDERS_DIR)) {
			json(req, res, 403, {
				error:
					"허용되지 않은 파일 경로입니다. renders/ 디렉토리만 접근 가능합니다.",
			});
			return;
		}

		if (!existsSync(filePath)) {
			json(req, res, 400, {
				error: `영상 파일을 찾을 수 없습니다: ${filePath}`,
			});
			return;
		}

		try {
			log.info("Upload started", { title });

			const publishAt =
				privacyStatus === "private" && scheduledAt
					? new Date(scheduledAt).toISOString()
					: undefined;

			const uploadRes = await youtube.videos.insert({
				part: ["snippet", "status"],
				requestBody: {
					snippet: {
						title,
						description,
						tags,
						defaultLanguage: "ko",
						defaultAudioLanguage: "ko",
					},
					status: {
						privacyStatus: publishAt ? "private" : privacyStatus,
						publishAt: publishAt || undefined,
						selfDeclaredMadeForKids: false,
					},
				},
				media: {
					body: createReadStream(filePath),
				},
			});

			const videoId = uploadRes.data.id;
			log.info("Upload complete", { videoId });

			let thumbnailSet = false;
			let thumbnailError = "";
			if (videoId && thumbnailDataUrl) {
				let thumbnailFile = "";
				try {
					const decoded = decodeThumbnailDataUrl(thumbnailDataUrl);
					thumbnailFile = join(
						tmpdir(),
						`boltyt-thumbnail-${videoId}.${decoded.ext}`,
					);
					writeFileSync(thumbnailFile, decoded.buffer);
					await youtube.thumbnails.set({
						videoId,
						media: {
							mimeType: decoded.mimeType,
							body: createReadStream(thumbnailFile),
						},
					});
					thumbnailSet = true;
					log.info("Thumbnail set", { videoId });
				} catch (e) {
					thumbnailError =
						e instanceof Error ? e.message : "Thumbnail upload failed";
					log.warn("Thumbnail upload failed", {
						videoId,
						error: thumbnailError,
					});
				} finally {
					if (thumbnailFile) {
						try {
							unlinkSync(thumbnailFile);
						} catch {
							// temp cleanup failure is non-fatal
						}
					}
				}
			}

			json(req, res, 200, {
				ok: true,
				videoId,
				url: `https://youtu.be/${videoId}`,
				thumbnailSet,
				thumbnailError: thumbnailError || undefined,
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Upload failed";
			log.error("Upload failed", { error: msg });
			json(req, res, 500, { error: msg });
		}
		return;
	}

	// ─── 예약 업로드 ───
	if (url.pathname === "/upload/schedule" && req.method === "POST") {
		const youtube = getAuthenticatedClient();
		if (!youtube) {
			json(req, res, 401, { error: "YouTube 인증이 필요합니다." });
			return;
		}

		const body = await parseBody(req);
		const videoId = body.videoId as string;
		const scheduledAt = body.scheduledAt as string;

		if (!videoId || !scheduledAt) {
			json(req, res, 400, { error: "videoId와 scheduledAt이 필요합니다." });
			return;
		}

		try {
			await youtube.videos.update({
				part: ["status"],
				requestBody: {
					id: videoId,
					status: {
						privacyStatus: "private",
						publishAt: new Date(scheduledAt).toISOString(),
					},
				},
			});

			json(req, res, 200, { ok: true, videoId, scheduledAt });
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Schedule failed";
			json(req, res, 500, { error: msg });
		}
		return;
	}

	// ─── 심화 분석 데이터 조회 ───
	if (url.pathname.startsWith("/analytics/deep/") && req.method === "GET") {
		const auth = getAuthenticatedAuth();
		const youtube = auth ? google.youtube({ version: "v3", auth }) : null;
		if (!auth || !youtube) {
			json(req, res, 401, { error: "YouTube 인증이 필요합니다." });
			return;
		}

		const videoId = url.pathname.split("/analytics/deep/")[1];
		const days = Number(url.searchParams.get("days") ?? 28);
		if (!videoId) {
			json(req, res, 400, { error: "videoId가 필요합니다." });
			return;
		}

		try {
			const videoRes = await youtube.videos.list({
				part: ["statistics", "snippet"],
				id: [videoId],
			});
			const video = videoRes.data.items?.[0];
			if (!video) {
				json(req, res, 404, { error: "영상을 찾을 수 없습니다." });
				return;
			}

			const stats = video.statistics;
			const baseStats = {
				videoId,
				title: video.snippet?.title ?? "",
				views: Number(stats?.viewCount ?? 0),
				likes: Number(stats?.likeCount ?? 0),
				comments: Number(stats?.commentCount ?? 0),
				favorites: Number(stats?.favoriteCount ?? 0),
			};
			const deep = await fetchDeepAnalytics({
				auth,
				videoId,
				days,
				baseStats,
			});
			json(req, res, 200, deep);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Deep analytics fetch failed";
			json(req, res, 500, { error: msg });
		}
		return;
	}

	// ─── 댓글 데이터 조회 ───
	if (url.pathname.startsWith("/comments/") && req.method === "GET") {
		const youtube = getAuthenticatedClient();
		if (!youtube) {
			json(req, res, 401, { error: "YouTube 인증이 필요합니다." });
			return;
		}

		const videoId = url.pathname.split("/comments/")[1];
		const maxResults = Math.max(
			1,
			Math.min(100, Number(url.searchParams.get("maxResults") ?? 100)),
		);
		if (!videoId) {
			json(req, res, 400, { error: "videoId가 필요합니다." });
			return;
		}

		try {
			const commentsRes = await youtube.commentThreads.list({
				part: ["snippet", "replies"],
				videoId,
				maxResults,
				order: "relevance",
				textFormat: "plainText",
			});
			const comments = (commentsRes.data.items ?? []).map((item) => {
				const snippet = item.snippet?.topLevelComment?.snippet;
				return {
					id: item.id ?? "",
					videoId,
					author: snippet?.authorDisplayName ?? "",
					text: snippet?.textDisplay ?? snippet?.textOriginal ?? "",
					likeCount: Number(snippet?.likeCount ?? 0),
					publishedAt: snippet?.publishedAt ?? "",
					updatedAt: snippet?.updatedAt ?? "",
					replyCount: Number(item.snippet?.totalReplyCount ?? 0),
				};
			});
			json(req, res, 200, { videoId, comments });
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Comments fetch failed";
			json(req, res, 500, { error: msg });
		}
		return;
	}

	// ─── 분석 데이터 조회 ───
	if (url.pathname.startsWith("/analytics/") && req.method === "GET") {
		const youtube = getAuthenticatedClient();
		if (!youtube) {
			json(req, res, 401, { error: "YouTube 인증이 필요합니다." });
			return;
		}

		const videoId = url.pathname.split("/analytics/")[1];
		if (!videoId) {
			json(req, res, 400, { error: "videoId가 필요합니다." });
			return;
		}

		try {
			const [videoRes] = await Promise.all([
				youtube.videos.list({
					part: ["statistics", "snippet"],
					id: [videoId],
				}),
				// YouTube Analytics API (별도 스코프 필요 — 기본 statistics로 대체)
				Promise.resolve(null),
			]);

			const video = videoRes.data.items?.[0];
			if (!video) {
				json(req, res, 404, { error: "영상을 찾을 수 없습니다." });
				return;
			}

			const stats = video.statistics;
			json(req, res, 200, {
				videoId,
				title: video.snippet?.title,
				views: Number(stats?.viewCount ?? 0),
				likes: Number(stats?.likeCount ?? 0),
				comments: Number(stats?.commentCount ?? 0),
				favorites: Number(stats?.favoriteCount ?? 0),
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Analytics fetch failed";
			json(req, res, 500, { error: msg });
		}
		return;
	}

	// ─── 채널 영상 목록 ───
	if (url.pathname === "/videos" && req.method === "GET") {
		const youtube = getAuthenticatedClient();
		if (!youtube) {
			json(req, res, 401, { error: "YouTube 인증이 필요합니다." });
			return;
		}

		try {
			const listRes = await youtube.search.list({
				part: ["snippet"],
				forMine: true,
				type: ["video"],
				maxResults: 20,
				order: "date",
			});

			json(req, res, 200, {
				videos: (listRes.data.items ?? []).map((v) => ({
					videoId: v.id?.videoId,
					title: v.snippet?.title,
					thumbnail: v.snippet?.thumbnails?.medium?.url,
					publishedAt: v.snippet?.publishedAt,
				})),
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "List failed";
			json(req, res, 500, { error: msg });
		}
		return;
	}

	json(req, res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
	log.info("Server started", {
		port: PORT,
		configured: Boolean(CLIENT_ID && CLIENT_SECRET),
		authenticated: loadToken() !== null,
	});
});

setupGracefulShutdown(server, SERVICE);
