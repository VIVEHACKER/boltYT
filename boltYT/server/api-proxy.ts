/**
 * 통합 API 프록시 서버 — 모든 외부 API 키를 서버사이드에서 관리
 *
 * 실행: npx tsx server/api-proxy.ts
 */

import { createServer } from "node:http";
import { Readable } from "node:stream";
import { actorFromReq, recordAudit } from "./lib/audit.ts";
import { createTtlCache } from "./lib/cache.ts";
import {
	checkServer,
	createCommandRegistry,
	type DiagHealthReport,
	runCommand,
} from "./lib/diag.ts";
import { runAgent } from "./lib/diag-agent.ts";
import { loadEnv, validateEnv, watchEnv } from "./lib/env.ts";
import {
	clearErrors as clearErrorsBuffer,
	listErrors as listErrorsBuffer,
	recordError,
} from "./lib/errors-buffer.ts";
import {
	FAL_ENDPOINTS,
	type FalProvider,
	submitFalVideo,
} from "./lib/fal-client.ts";
import { fetchWithRetry } from "./lib/fetch-retry.ts";
import { createLogger } from "./lib/logger.ts";
import { maskSecrets } from "./lib/mask.ts";
import {
	counter as metricCounter,
	snapshot as metricsSnapshot,
} from "./lib/metrics.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";
import {
	createTieredRateLimit,
	defaultTierForPath,
} from "./lib/tiered-limit.ts";
import { sanitizeInt, sanitizeString } from "./lib/validate.ts";

const SERVICE = "api-proxy";
const log = createLogger(SERVICE);

loadEnv();

const PORT = Number(process.env.API_PROXY_PORT ?? 3459);

validateEnv(["OPENAI_API_KEY"], SERVICE);

const DIAG_TOKEN = process.env.DIAG_TOKEN ?? "";

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
	KEYS.openai = process.env.OPENAI_API_KEY ?? "";
	KEYS.elevenlabs = process.env.ELEVENLABS_API_KEY ?? "";
	KEYS.pexels = process.env.PEXELS_API_KEY ?? "";
	KEYS.pixabay = process.env.PIXABAY_API_KEY ?? "";
	KEYS.youtube = process.env.YOUTUBE_API_KEY ?? "";
	KEYS.naverClientId = process.env.NAVER_CLIENT_ID ?? "";
	KEYS.naverClientSecret = process.env.NAVER_CLIENT_SECRET ?? "";
	KEYS.fal = process.env.FAL_KEY ?? "";
}

reloadKeys();

// ─── 유틸리티 ───

const tieredLimit = createTieredRateLimit(SERVICE);

const ALLOWED_ORIGINS = new Set([
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:4173",
	`http://localhost:${PORT}`,
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

function cors(
	req: import("node:http").IncomingMessage,
	headers: Record<string, string> = {},
) {
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

// ─── 검색 API 캐시 (5분 TTL) ───
const searchCache = createTtlCache<string>(300_000);

// ─── 기사 본문 캐시 (30분 TTL) — 같은 URL 중복 스크래핑 방지 ───
const articleCache = createTtlCache<{
	title: string;
	body: string;
	publisher: string;
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
		json(req, res, 200, {
			ok: true,
			service: SERVICE,
			uptime: process.uptime(),
			startedAt,
		});
		return;
	}

	// ─── 키 상태 확인 (키 자체는 노출하지 않음) ───
	if (url.pathname === "/api/keys/status" && req.method === "GET") {
		json(req, res, 200, {
			openai: Boolean(KEYS.openai),
			elevenlabs: Boolean(KEYS.elevenlabs),
			pexels: Boolean(KEYS.pexels),
			pixabay: Boolean(KEYS.pixabay),
			youtube: Boolean(KEYS.youtube),
			naver: Boolean(KEYS.naverClientId && KEYS.naverClientSecret),
			fal: Boolean(KEYS.fal),
		});
		return;
	}

	// ─── OpenAI Chat Completions ───
	if (url.pathname === "/api/openai/chat" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.openai, "OpenAI")) return;
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
				{ timeout: 60_000 },
			);

			if (!upstream.ok) {
				const err = await upstream.text();
				log.error("OpenAI chat error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}

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
				log.error("DALL-E error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}

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

	// ─── OpenAI TTS ───
	if (url.pathname === "/api/openai/tts" && req.method === "POST") {
		if (!requireKey(req, res, KEYS.openai, "OpenAI")) return;
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
				log.error("TTS error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}

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
				log.error("Whisper error", { status: upstream.status });
				json(req, res, upstream.status, { error: err });
				return;
			}

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
			log.error("fal video-gen exception", { provider, error: msg });
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
				const rPayload = {
					title: rResult.title,
					body: rResult.body,
					publisher: extractPublisher(resolvedUrl),
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
			const publisher = extractPublisher(targetUrl);
			const payload = { title, body, publisher };
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
