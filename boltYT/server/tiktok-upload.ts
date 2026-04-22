/**
 * TikTok 업로드 서버 — Content Posting API v2
 *
 * 실행: npx tsx server/tiktok-upload.ts
 *
 * 필요 환경변수:
 *   TIKTOK_CLIENT_KEY    — TikTok Developer Portal에서 발급
 *   TIKTOK_CLIENT_SECRET — TikTok Developer Portal에서 발급
 *
 * 엔드포인트:
 *   GET  /auth/url       — OAuth 인증 URL 생성
 *   GET  /auth/callback  — OAuth 콜백 (토큰 교환)
 *   GET  /auth/status    — 인증 상태 확인
 *   POST /auth/revoke    — 토큰 삭제
 *   POST /upload         — 영상 업로드 (FILE_UPLOAD 방식)
 *   GET  /health         — 상태 확인
 */

import {
	createReadStream,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { loadEnv, validateEnv } from "./lib/env.ts";
import { createLogger } from "./lib/logger.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";

const SERVICE = "tiktok-upload";
const log = createLogger(SERVICE);

loadEnv();
validateEnv(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], SERVICE);

const PORT = Number(process.env.TIKTOK_PORT ?? 3461);
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const TOKEN_PATH = join(import.meta.dirname ?? ".", ".tiktok-token.json");

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY ?? "";
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET ?? "";

const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

const SCOPES = ["user.info.basic", "video.upload", "video.publish"].join(",");

interface TikTokToken {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	open_id: string;
	issued_at: number;
}

function loadToken(): TikTokToken | null {
	if (!existsSync(TOKEN_PATH)) return null;
	try {
		return JSON.parse(readFileSync(TOKEN_PATH, "utf-8")) as TikTokToken;
	} catch {
		return null;
	}
}

function saveToken(token: TikTokToken) {
	writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

function isTokenValid(token: TikTokToken): boolean {
	const expiresAt = token.issued_at + token.expires_in * 1000;
	return Date.now() < expiresAt - 60_000;
}

async function refreshToken(token: TikTokToken): Promise<TikTokToken | null> {
	const res = await fetch(TIKTOK_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_key: CLIENT_KEY,
			client_secret: CLIENT_SECRET,
			grant_type: "refresh_token",
			refresh_token: token.refresh_token,
		}),
	});
	if (!res.ok) return null;
	const data = (await res.json()) as { data?: Partial<TikTokToken> };
	if (!data.data?.access_token) return null;
	const refreshed: TikTokToken = {
		...(data.data as TikTokToken),
		issued_at: Date.now(),
	};
	saveToken(refreshed);
	return refreshed;
}

async function getValidToken(): Promise<TikTokToken | null> {
	let token = loadToken();
	if (!token) return null;
	if (!isTokenValid(token)) {
		token = await refreshToken(token);
	}
	return token;
}

const rateLimit = createRateLimiter({ windowMs: 60_000, max: 20 });

const ALLOWED_ORIGINS = new Set([
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:4173",
	`http://localhost:${PORT}`,
]);

function cors(
	req: import("node:http").IncomingMessage,
	extra: Record<string, string> = {},
) {
	const origin = req.headers.origin ?? "";
	return {
		...extra,
		"Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		Vary: "Origin",
	};
}

async function parseBody(
	req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (c) => chunks.push(c));
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

function json(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	status: number,
	body: unknown,
) {
	const headers = cors(req, { "Content-Type": "application/json" });
	res.writeHead(status, headers);
	res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
	const method = req.method ?? "GET";
	const ip = req.socket.remoteAddress ?? "unknown";

	trackRequest(SERVICE, method, url.pathname);

	if (method === "OPTIONS") {
		res.writeHead(204, cors(req));
		res.end();
		return;
	}

	if (!rateLimit.check(ip)) {
		json(req, res, 429, {
			error: { code: "RATE_LIMITED", message: "Too many requests" },
		});
		return;
	}

	// GET /health
	if (method === "GET" && url.pathname === "/health") {
		const token = loadToken();
		json(req, res, 200, {
			ok: true,
			service: SERVICE,
			configured: Boolean(CLIENT_KEY && CLIENT_SECRET),
			authenticated: token !== null && isTokenValid(token),
		});
		return;
	}

	// GET /auth/url
	if (method === "GET" && url.pathname === "/auth/url") {
		const csrfState = Math.random().toString(36).slice(2);
		const params = new URLSearchParams({
			client_key: CLIENT_KEY,
			scope: SCOPES,
			response_type: "code",
			redirect_uri: REDIRECT_URI,
			state: csrfState,
		});
		json(req, res, 200, { url: `${TIKTOK_AUTH_URL}?${params}` });
		return;
	}

	// GET /auth/callback
	if (method === "GET" && url.pathname === "/auth/callback") {
		const code = url.searchParams.get("code");
		if (!code) {
			json(req, res, 400, {
				error: { code: "NO_CODE", message: "인증 코드가 없습니다." },
			});
			return;
		}
		const tokenRes = await fetch(TIKTOK_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_key: CLIENT_KEY,
				client_secret: CLIENT_SECRET,
				code,
				grant_type: "authorization_code",
				redirect_uri: REDIRECT_URI,
			}),
		});
		const tokenData = (await tokenRes.json()) as {
			data?: Partial<TikTokToken>;
			error?: string;
		};
		if (!tokenRes.ok || !tokenData.data?.access_token) {
			log.error("Token exchange failed", { error: tokenData.error });
			json(req, res, 502, {
				error: { code: "TOKEN_EXCHANGE_FAILED", message: "토큰 교환 실패" },
			});
			return;
		}
		const token: TikTokToken = {
			...(tokenData.data as TikTokToken),
			issued_at: Date.now(),
		};
		saveToken(token);
		log.info("TikTok authenticated", { open_id: token.open_id });
		const html = `<html><body><script>window.close();</script><p>인증 완료. 창을 닫으세요.</p></body></html>`;
		res.writeHead(200, cors(req, { "Content-Type": "text/html" }));
		res.end(html);
		return;
	}

	// GET /auth/status
	if (method === "GET" && url.pathname === "/auth/status") {
		const token = await getValidToken();
		if (!token) {
			json(req, res, 200, { authenticated: false });
			return;
		}
		// 사용자 정보 조회
		try {
			const userRes = await fetch(
				`${TIKTOK_API_BASE}/user/info/?fields=display_name,avatar_url`,
				{
					headers: { Authorization: `Bearer ${token.access_token}` },
				},
			);
			const userData = (await userRes.json()) as {
				data?: { user?: { display_name?: string; avatar_url?: string } };
			};
			json(req, res, 200, {
				authenticated: true,
				user: {
					openId: token.open_id,
					displayName: userData.data?.user?.display_name ?? "",
					avatarUrl: userData.data?.user?.avatar_url ?? "",
				},
			});
		} catch {
			json(req, res, 200, {
				authenticated: true,
				user: { openId: token.open_id },
			});
		}
		return;
	}

	// POST /auth/revoke
	if (method === "POST" && url.pathname === "/auth/revoke") {
		if (existsSync(TOKEN_PATH)) {
			const { unlinkSync } = await import("node:fs");
			unlinkSync(TOKEN_PATH);
		}
		json(req, res, 200, { ok: true });
		return;
	}

	// POST /upload
	if (method === "POST" && url.pathname === "/upload") {
		const token = await getValidToken();
		if (!token) {
			json(req, res, 401, {
				error: {
					code: "UNAUTHENTICATED",
					message: "TikTok 인증이 필요합니다.",
				},
			});
			return;
		}

		const body = await parseBody(req);
		const filePath = String(body.filePath ?? "");
		const title = String(body.title ?? "").slice(0, 150);
		const privacyLevel = String(body.privacyLevel ?? "SELF_ONLY") as
			| "PUBLIC_TO_EVERYONE"
			| "MUTUAL_FOLLOW_FRIENDS"
			| "FOLLOWER_OF_CREATOR"
			| "SELF_ONLY";

		if (!filePath || !existsSync(filePath)) {
			json(req, res, 400, {
				error: { code: "NO_FILE", message: "파일 경로가 유효하지 않습니다." },
			});
			return;
		}

		const { statSync } = await import("node:fs");
		const fileSize = statSync(filePath).size;

		// 1단계: 업로드 초기화
		const initRes = await fetch(`${TIKTOK_API_BASE}/post/video/init/`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token.access_token}`,
				"Content-Type": "application/json; charset=UTF-8",
			},
			body: JSON.stringify({
				post_info: {
					title,
					privacy_level: privacyLevel,
					disable_duet: false,
					disable_comment: false,
					disable_stitch: false,
				},
				source_info: {
					source: "FILE_UPLOAD",
					video_size: fileSize,
					chunk_size: fileSize,
					total_chunk_count: 1,
				},
			}),
		});

		const initData = (await initRes.json()) as {
			data?: { publish_id?: string; upload_url?: string };
			error?: { code?: string; message?: string };
		};

		if (!initRes.ok || !initData.data?.publish_id) {
			log.error("Upload init failed", { error: initData.error });
			json(req, res, 502, {
				error: {
					code: "UPLOAD_INIT_FAILED",
					message: initData.error?.message ?? "업로드 초기화 실패",
				},
			});
			return;
		}

		const { publish_id, upload_url } = initData.data;

		// 2단계: 파일 업로드
		const fileStream = createReadStream(filePath);
		const uploadRes = await fetch(upload_url!, {
			method: "PUT",
			headers: {
				"Content-Type": "video/mp4",
				"Content-Range": `bytes 0-${fileSize - 1}/${fileSize}`,
				"Content-Length": String(fileSize),
			},
			// @ts-expect-error Node fetch supports ReadableStream from createReadStream
			body: fileStream,
			duplex: "half",
		});

		if (!uploadRes.ok) {
			json(req, res, 502, {
				error: { code: "UPLOAD_FAILED", message: "파일 업로드 실패" },
			});
			return;
		}

		log.info("TikTok upload complete", { publish_id });
		json(req, res, 200, { ok: true, publishId: publish_id });
		return;
	}

	json(req, res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
});

setupGracefulShutdown(server, SERVICE);
server.listen(PORT, () => {
	log.info(`${SERVICE} listening`, { port: PORT });
});
