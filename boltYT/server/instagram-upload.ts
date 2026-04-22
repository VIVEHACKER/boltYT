/**
 * Instagram Reels 업로드 서버 — Meta Graph API
 *
 * 실행: npx tsx server/instagram-upload.ts
 *
 * 필요 환경변수:
 *   META_APP_ID     — Meta Developer Portal에서 발급
 *   META_APP_SECRET — Meta Developer Portal에서 발급
 *
 * 엔드포인트:
 *   GET  /auth/url       — OAuth 인증 URL 생성
 *   GET  /auth/callback  — OAuth 콜백 (토큰 교환)
 *   GET  /auth/status    — 인증 상태 확인
 *   POST /auth/revoke    — 토큰 삭제
 *   POST /upload         — Reels 업로드 (VIDEO_URL 방식)
 *   GET  /health         — 상태 확인
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { loadEnv, validateEnv } from "./lib/env.ts";
import { createLogger } from "./lib/logger.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";

const SERVICE = "instagram-upload";
const log = createLogger(SERVICE);

loadEnv();
validateEnv(["META_APP_ID", "META_APP_SECRET"], SERVICE);

const PORT = Number(process.env.IG_PORT ?? 3462);
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const TOKEN_PATH = join(import.meta.dirname ?? ".", ".instagram-token.json");

const APP_ID = process.env.META_APP_ID ?? "";
const APP_SECRET = process.env.META_APP_SECRET ?? "";

const META_AUTH_URL = "https://www.facebook.com/v21.0/dialog/oauth";
const META_TOKEN_URL = "https://graph.facebook.com/v21.0/oauth/access_token";
const GRAPH_API = "https://graph.facebook.com/v21.0";

const SCOPES = [
	"instagram_basic",
	"instagram_content_publish",
	"pages_read_engagement",
].join(",");

interface MetaToken {
	access_token: string;
	ig_user_id: string;
	username: string;
	issued_at: number;
	// Long-lived token은 60일 유효 (초 단위)
	expires_in?: number;
}

function loadToken(): MetaToken | null {
	if (!existsSync(TOKEN_PATH)) return null;
	try {
		return JSON.parse(readFileSync(TOKEN_PATH, "utf-8")) as MetaToken;
	} catch {
		return null;
	}
}

function saveToken(token: MetaToken) {
	writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

function isTokenValid(token: MetaToken): boolean {
	if (!token.expires_in) return true; // 만료 없는 토큰
	const expiresAt = token.issued_at + token.expires_in * 1000;
	return Date.now() < expiresAt - 60_000;
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
	res.writeHead(status, cors(req, { "Content-Type": "application/json" }));
	res.end(JSON.stringify(body));
}

/** 단기 토큰 → 장기 토큰 교환 */
async function exchangeLongLived(shortToken: string): Promise<string> {
	const params = new URLSearchParams({
		grant_type: "fb_exchange_token",
		client_id: APP_ID,
		client_secret: APP_SECRET,
		fb_exchange_token: shortToken,
	});
	const res = await fetch(`${META_TOKEN_URL}?${params}`);
	const data = (await res.json()) as { access_token?: string };
	return data.access_token ?? shortToken;
}

/** Facebook 페이지 토큰 → Instagram Business Account ID 조회 */
async function getIgUserId(
	accessToken: string,
): Promise<{ igUserId: string; username: string } | null> {
	const meRes = await fetch(
		`${GRAPH_API}/me/accounts?fields=instagram_business_account&access_token=${accessToken}`,
	);
	const meData = (await meRes.json()) as {
		data?: { instagram_business_account?: { id?: string } }[];
	};
	const igId = meData.data?.[0]?.instagram_business_account?.id;
	if (!igId) return null;

	const igRes = await fetch(
		`${GRAPH_API}/${igId}?fields=username&access_token=${accessToken}`,
	);
	const igData = (await igRes.json()) as { username?: string };
	return { igUserId: igId, username: igData.username ?? "" };
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
			configured: Boolean(APP_ID && APP_SECRET),
			authenticated: token !== null && isTokenValid(token),
		});
		return;
	}

	// GET /auth/url
	if (method === "GET" && url.pathname === "/auth/url") {
		const params = new URLSearchParams({
			client_id: APP_ID,
			redirect_uri: REDIRECT_URI,
			scope: SCOPES,
			response_type: "code",
		});
		json(req, res, 200, { url: `${META_AUTH_URL}?${params}` });
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

		// 단기 토큰 발급
		const params = new URLSearchParams({
			client_id: APP_ID,
			client_secret: APP_SECRET,
			redirect_uri: REDIRECT_URI,
			code,
		});
		const shortRes = await fetch(`${META_TOKEN_URL}?${params}`);
		const shortData = (await shortRes.json()) as {
			access_token?: string;
			error?: unknown;
		};
		if (!shortData.access_token) {
			log.error("Short token failed", { error: shortData.error });
			json(req, res, 502, {
				error: { code: "TOKEN_FAILED", message: "토큰 발급 실패" },
			});
			return;
		}

		// 장기 토큰으로 교환
		const longToken = await exchangeLongLived(shortData.access_token);

		// Instagram 계정 정보 조회
		const igInfo = await getIgUserId(longToken);
		if (!igInfo) {
			json(req, res, 502, {
				error: {
					code: "NO_IG_ACCOUNT",
					message: "연결된 Instagram 비즈니스 계정이 없습니다.",
				},
			});
			return;
		}

		const token: MetaToken = {
			access_token: longToken,
			ig_user_id: igInfo.igUserId,
			username: igInfo.username,
			issued_at: Date.now(),
			expires_in: 60 * 24 * 60 * 60, // 60일
		};
		saveToken(token);
		log.info("Instagram authenticated", { username: igInfo.username });

		const html = `<html><body><script>window.close();</script><p>인증 완료. 창을 닫으세요.</p></body></html>`;
		res.writeHead(200, cors(req, { "Content-Type": "text/html" }));
		res.end(html);
		return;
	}

	// GET /auth/status
	if (method === "GET" && url.pathname === "/auth/status") {
		const token = loadToken();
		if (!token || !isTokenValid(token)) {
			json(req, res, 200, { authenticated: false });
			return;
		}
		json(req, res, 200, {
			authenticated: true,
			user: { igUserId: token.ig_user_id, username: token.username },
		});
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
	// Instagram Reels는 공개 URL 방식만 지원 (로컬 파일 직접 업로드 불가)
	// videoUrl: Supabase Storage 공개 URL 또는 CDN URL 필요
	if (method === "POST" && url.pathname === "/upload") {
		const token = loadToken();
		if (!token || !isTokenValid(token)) {
			json(req, res, 401, {
				error: {
					code: "UNAUTHENTICATED",
					message: "Instagram 인증이 필요합니다.",
				},
			});
			return;
		}

		const body = await parseBody(req);
		const videoUrl = String(body.videoUrl ?? "");
		const caption = String(body.caption ?? "").slice(0, 2200);
		const coverUrl = body.coverUrl ? String(body.coverUrl) : undefined;

		if (!videoUrl.startsWith("http")) {
			json(req, res, 400, {
				error: {
					code: "INVALID_URL",
					message: "videoUrl은 공개 접근 가능한 URL이어야 합니다.",
				},
			});
			return;
		}

		// 1단계: 미디어 컨테이너 생성
		const containerParams = new URLSearchParams({
			media_type: "REELS",
			video_url: videoUrl,
			caption,
			share_to_feed: "true",
			access_token: token.access_token,
		});
		if (coverUrl) containerParams.set("cover_url", coverUrl);

		const containerRes = await fetch(`${GRAPH_API}/${token.ig_user_id}/media`, {
			method: "POST",
			body: containerParams,
		});
		const containerData = (await containerRes.json()) as {
			id?: string;
			error?: { message?: string };
		};

		if (!containerData.id) {
			log.error("Container creation failed", { error: containerData.error });
			json(req, res, 502, {
				error: {
					code: "CONTAINER_FAILED",
					message: containerData.error?.message ?? "미디어 컨테이너 생성 실패",
				},
			});
			return;
		}

		const containerId = containerData.id;

		// 2단계: 처리 완료 대기 (최대 2분, 5초 간격 폴링)
		let status = "IN_PROGRESS";
		for (let i = 0; i < 24 && status === "IN_PROGRESS"; i++) {
			await new Promise((r) => setTimeout(r, 5_000));
			const statusRes = await fetch(
				`${GRAPH_API}/${containerId}?fields=status_code&access_token=${token.access_token}`,
			);
			const statusData = (await statusRes.json()) as { status_code?: string };
			status = statusData.status_code ?? "IN_PROGRESS";
		}

		if (status !== "FINISHED") {
			json(req, res, 502, {
				error: {
					code: "PROCESSING_FAILED",
					message: `미디어 처리 실패: ${status}`,
				},
			});
			return;
		}

		// 3단계: 게시
		const publishParams = new URLSearchParams({
			creation_id: containerId,
			access_token: token.access_token,
		});
		const publishRes = await fetch(
			`${GRAPH_API}/${token.ig_user_id}/media_publish`,
			{ method: "POST", body: publishParams },
		);
		const publishData = (await publishRes.json()) as {
			id?: string;
			error?: { message?: string };
		};

		if (!publishData.id) {
			log.error("Publish failed", { error: publishData.error });
			json(req, res, 502, {
				error: {
					code: "PUBLISH_FAILED",
					message: publishData.error?.message ?? "게시 실패",
				},
			});
			return;
		}

		log.info("Instagram Reels published", { mediaId: publishData.id });
		json(req, res, 200, { ok: true, mediaId: publishData.id });
		return;
	}

	json(req, res, 404, { error: { code: "NOT_FOUND", message: "Not found" } });
});

setupGracefulShutdown(server, SERVICE);
server.listen(PORT, () => {
	log.info(`${SERVICE} listening`, { port: PORT });
});
