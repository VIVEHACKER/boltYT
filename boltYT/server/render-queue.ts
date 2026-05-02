/**
 * 렌더 큐 서버 — HTTP 라우터 + 엔트리포인트.
 *
 * 실행: npx tsx server/render-queue.ts
 *
 * 엔드포인트:
 *   POST /render              — 렌더 작업 추가
 *   GET  /render/:id          — 렌더 상태 조회
 *   POST /render/:id/cancel   — 렌더 취소
 *   GET  /renders             — 전체 큐 조회
 *   GET  /health              — 상태 확인
 *   POST /asset               — 에셋 업로드
 *   GET  /assets/*            — 에셋 서빙
 */

import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	statSync,
} from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import type { RenderOptionsInput } from "../src/lib/render-options.js";
import { loadEnv } from "./lib/env.js";
import type { RenderJob } from "./lib/job-manager.js";
import { createJobManager, VALID_FORMATS } from "./lib/job-manager.js";
import { createLogger } from "./lib/logger.js";
import { createRateLimiter } from "./lib/rate-limit.js";
import { checkApiKey } from "./lib/render-auth.js";
import { createRenderer } from "./lib/renderer.js";
import { trackRequest } from "./lib/request-metrics.js";
import { initSentryServer } from "./lib/sentry-server.js";
import { setupGracefulShutdown } from "./lib/shutdown.js";

const SERVICE = "render-queue";
const log = createLogger(SERVICE);

loadEnv();
initSentryServer(SERVICE);

const PORT = Number(process.env.RENDER_PORT ?? 3458);
const RENDERS_DIR = join(import.meta.dirname ?? ".", "../renders");
if (!existsSync(RENDERS_DIR)) mkdirSync(RENDERS_DIR, { recursive: true });
const RENDER_ASSET_DIR = join(RENDERS_DIR, "_assets");
if (!existsSync(RENDER_ASSET_DIR))
	mkdirSync(RENDER_ASSET_DIR, { recursive: true });

const RENDER_CONCURRENCY = Math.max(
	1,
	Math.min(
		4,
		Number(process.env.RENDER_QUEUE_CONCURRENCY) ||
			Math.max(1, Math.floor(os.cpus().length / 2)),
	),
);
const RENDER_API_KEY = process.env.RENDER_API_KEY ?? "";

// ─── 의존성 조립 ──────────────────────────────────────────────────────────────

const jm = createJobManager(RENDERS_DIR);
const renderer = createRenderer({
	queue: jm.queue,
	saveQueue: jm.saveQueue,
	rendersDir: RENDERS_DIR,
	renderAssetDir: RENDER_ASSET_DIR,
	port: PORT,
	concurrency: RENDER_CONCURRENCY,
});

// 시작 시 queued 잡 복원
for (const j of jm.queue) {
	if (j.status === "queued") renderer.enqueueRender(j);
}

// ─── HTTP 헬퍼 ───────────────────────────────────────────────────────────────

const rateLimit = createRateLimiter({ windowMs: 60_000, max: 30 });

const ALLOWED_ORIGINS = new Set([
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:4173",
	`http://localhost:${PORT}`,
]);

function cors(
	req: import("node:http").IncomingMessage,
	headers: Record<string, string> = {},
) {
	const origin = req.headers.origin ?? "";
	return {
		...headers,
		"Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
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

function contentTypeFromPath(filePath: string): string {
	switch (extname(filePath).toLowerCase()) {
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		case ".mp4":
			return "video/mp4";
		case ".webm":
			return "video/webm";
		case ".mp3":
			return "audio/mpeg";
		case ".wav":
			return "audio/wav";
		case ".ogg":
			return "audio/ogg";
		default:
			return "application/octet-stream";
	}
}

function resolveAssetPath(rawPath: string): string | null {
	const decoded = rawPath
		.split("/")
		.map((s) => decodeURIComponent(s))
		.join("/");
	const safe = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
	const filePath = join(RENDER_ASSET_DIR, safe);
	return filePath.startsWith(RENDER_ASSET_DIR) ? filePath : null;
}

async function writeAssetStream(
	req: import("node:http").IncomingMessage,
	filePath: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		mkdirSync(dirname(filePath), { recursive: true });
		const out = createWriteStream(filePath);
		req.pipe(out);
		req.on("error", reject);
		out.on("error", reject);
		out.on("finish", resolve);
	});
}

async function parseBody(
	req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const MAX = 16 * 1_048_576;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size <= MAX) chunks.push(chunk);
		});
		req.on("end", () => {
			if (size > MAX) {
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

// ─── HTTP 서버 ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
	trackRequest(req, res, SERVICE);
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

	if (req.method === "OPTIONS") {
		res.writeHead(204, cors(req));
		res.end();
		return;
	}

	const isRenderAssetRead =
		req.method === "GET" && url.pathname.startsWith("/assets/");
	if (url.pathname !== "/health" && !isRenderAssetRead) {
		const rl = rateLimit(req);
		if (!rl.allowed) {
			log.warn("Rate limit exceeded", { ip: req.socket.remoteAddress });
			json(req, res, 429, { error: "요청이 너무 많습니다." });
			return;
		}
	}

	if (req.method === "POST") {
		if (!checkApiKey(req.headers.authorization, RENDER_API_KEY)) {
			log.warn("Unauthorized request", { ip: req.socket.remoteAddress });
			json(req, res, 401, { error: "인증이 필요합니다." });
			return;
		}
	}

	// ─── Health ───
	if (url.pathname === "/health") {
		json(req, res, 200, {
			ok: true,
			service: SERVICE,
			processing: jm.queue.some((j) => j.status === "rendering"),
			pendingJobs: jm.queue.filter((j) => j.status === "queued").length,
			totalJobs: jm.queue.length,
			uptime: process.uptime(),
			pool: renderer.poolStats(),
			ffmpegAvailable: renderer.isffmpegAvailable(),
		});
		return;
	}

	// ─── Asset upload ───
	if (url.pathname === "/asset" && req.method === "POST") {
		const assetPath = url.searchParams.get("path") ?? "";
		const filePath = resolveAssetPath(assetPath);
		if (!assetPath || !filePath) {
			json(req, res, 400, { error: "유효한 asset path가 필요합니다." });
			return;
		}
		try {
			await writeAssetStream(req, filePath);
			json(req, res, 200, {
				ok: true,
				url: `http://localhost:${PORT}/assets/${assetPath.split("/").map(encodeURIComponent).join("/")}`,
			});
		} catch (e) {
			json(req, res, 500, {
				error: e instanceof Error ? e.message : "자산 저장에 실패했습니다.",
			});
		}
		return;
	}

	// ─── Asset serve ───
	if (url.pathname.startsWith("/assets/") && req.method === "GET") {
		const filePath = resolveAssetPath(url.pathname.replace(/^\/assets\//, ""));
		if (!filePath || !existsSync(filePath)) {
			json(req, res, 404, { error: "자산을 찾을 수 없습니다." });
			return;
		}
		const stat = statSync(filePath);
		res.writeHead(
			200,
			cors(req, {
				"Content-Type": contentTypeFromPath(filePath),
				"Content-Length": String(stat.size),
				"Cache-Control": "public, max-age=3600",
			}),
		);
		createReadStream(filePath).pipe(res);
		return;
	}

	// ─── POST /render ───
	if (url.pathname === "/render" && req.method === "POST") {
		const body = await parseBody(req);
		if (body === null) {
			json(req, res, 413, { error: "요청 본문이 너무 큽니다 (최대 16MB)" });
			return;
		}

		const scriptId = body.scriptId as string;
		const format = (body.format as string) ?? "longform";
		const props = body.props as Record<string, unknown> | undefined;
		const renderOptions = body.renderOptions as RenderOptionsInput | undefined;

		if (!scriptId) {
			json(req, res, 400, { error: "scriptId가 필요합니다." });
			return;
		}
		if (!/^[a-zA-Z0-9_-]{1,64}$/.test(scriptId)) {
			json(req, res, 400, { error: "scriptId 형식이 올바르지 않습니다." });
			return;
		}
		if (!VALID_FORMATS.has(format)) {
			json(req, res, 400, {
				error: `format은 shorts 또는 longform이어야 합니다. (받은 값: ${format})`,
			});
			return;
		}

		const fp = (p: Record<string, unknown> | undefined) =>
			`${jm.propsFingerprint(p)}`;
		const incomingFp = `${fp(props)}|${fp(renderOptions as Record<string, unknown> | undefined)}`;

		const existing = jm.queue.find(
			(j) =>
				j.scriptId === scriptId &&
				j.format === format &&
				`${fp(j.props)}|${fp(j.renderOptions as Record<string, unknown> | undefined)}` ===
					incomingFp &&
				(j.status === "queued" || j.status === "rendering"),
		);
		if (existing) {
			json(req, res, 200, { job: existing });
			return;
		}

		for (const j of jm.queue) {
			if (
				j.scriptId === scriptId &&
				j.format === format &&
				j.status === "queued"
			) {
				j.status = "cancelled";
				j.completedAt = new Date().toISOString();
				j.error = "Superseded by new render request with updated props";
				log.info("Render superseded", { oldJobId: j.id });
			}
		}

		const job: RenderJob = {
			id: jm.generateId(),
			scriptId,
			format: format as "shorts" | "longform",
			status: "queued",
			progress: 0,
			outputPath: "",
			createdAt: new Date().toISOString(),
			props,
			renderOptions,
		};
		jm.queue.push(job);
		jm.saveQueue();
		json(req, res, 201, { job });
		renderer.enqueueRender(job);
		return;
	}

	// ─── GET /render/:id ───
	const renderMatch = url.pathname.match(/^\/render\/([^/]+)$/);
	if (renderMatch && req.method === "GET") {
		const job = jm.queue.find((j) => j.id === renderMatch[1]);
		if (!job) {
			json(req, res, 404, { error: "작업을 찾을 수 없습니다." });
			return;
		}
		json(req, res, 200, { job });
		return;
	}

	// ─── POST /render/:id/cancel ───
	const cancelMatch = url.pathname.match(/^\/render\/([^/]+)\/cancel$/);
	if (cancelMatch && req.method === "POST") {
		const job = jm.queue.find((j) => j.id === cancelMatch[1]);
		if (!job) {
			json(req, res, 404, { error: "작업을 찾을 수 없습니다." });
			return;
		}

		if (job.status === "queued") {
			job.status = "cancelled";
			job.completedAt = new Date().toISOString();
			jm.saveQueue();
			json(req, res, 200, { job });
		} else if (job.status === "rendering") {
			renderer.cancelJob(job.id);
			job.status = "cancelled";
			job.completedAt = new Date().toISOString();
			jm.saveQueue();
			log.info("Render cancelled", { jobId: job.id });
			json(req, res, 200, { job });
		} else {
			json(req, res, 400, { error: "완료된 작업은 취소할 수 없습니다." });
		}
		return;
	}

	// ─── GET /renders ───
	if (url.pathname === "/renders" && req.method === "GET") {
		json(req, res, 200, { jobs: jm.queue });
		return;
	}

	json(req, res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
	log.info("Server started", { port: PORT, rendersDir: RENDERS_DIR });
	renderer.checkFfmpeg();
});

setupGracefulShutdown(server, SERVICE, () => {
	jm.saveQueueSync();
});
