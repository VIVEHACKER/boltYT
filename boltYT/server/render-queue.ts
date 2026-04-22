/**
 * 렌더 큐 서버 — 백그라운드 영상 렌더링
 *
 * ��행: npx tsx server/render-queue.ts
 *
 * 엔드포인트:
 *   POST /render          — 렌더 작업 추가
 *   GET  /render/:id      — 렌더 상태 조회
 *   GET  /renders         — 전체 큐 조회
 *   POST /render/:id/cancel — 렌더 취소
 *   GET  /health          — 상태 확인
 */

import { execFile } from "node:child_process";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import {
	type RenderOptionsInput,
	resolveRenderOptions,
	toRemotionCliArgs,
} from "../src/lib/render-options.ts";
import { loadEnv } from "./lib/env.ts";
import { createLogger } from "./lib/logger.ts";
import { enqueueProxyBuildBackground } from "./lib/proxy-enqueue.ts";
import { createRateLimiter } from "./lib/rate-limit.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";
import { createWorkerPool } from "./lib/worker-pool.ts";

const SERVICE = "render-queue";
const log = createLogger(SERVICE);

loadEnv();

const PORT = Number(process.env.RENDER_PORT ?? 3458);
const RENDERS_DIR = join(import.meta.dirname ?? ".", "../renders");
if (!existsSync(RENDERS_DIR)) mkdirSync(RENDERS_DIR, { recursive: true });
const RENDER_ASSET_DIR = join(RENDERS_DIR, "_assets");
if (!existsSync(RENDER_ASSET_DIR)) {
	mkdirSync(RENDER_ASSET_DIR, { recursive: true });
}

// ─── 큐 타입 ───

interface RenderJob {
	id: string;
	scriptId: string;
	format: "shorts" | "longform";
	status: "queued" | "rendering" | "complete" | "failed" | "cancelled";
	progress: number;
	outputPath: string;
	error?: string;
	/** 실패 원인 분류: timeout | oom | file_not_found | unknown */
	errorCategory?: "timeout" | "oom" | "file_not_found" | "unknown";
	retryCount?: number;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	/** Remotion에 전달할 props (scenes, narrationUrl 등) */
	props?: Record<string, unknown>;
	/** 렌더 옵션 (codec/crf/bitrate/preset) — 없으면 기본 high */
	renderOptions?: RenderOptionsInput;
	/** 렌더 타임아웃 (ms) — 없으면 30분 기본 */
	timeoutMs?: number;
	/** 체크포인트: 마지막으로 성공한 Remotion 프레임 번호 */
	lastFrame?: number;
}

const VALID_FORMATS = new Set(["shorts", "longform"]);

// ─── 영속 큐 (JSON 파일 저장) ───

const QUEUE_FILE = join(RENDERS_DIR, ".queue.json");

function loadQueue(): RenderJob[] {
	try {
		if (!existsSync(QUEUE_FILE)) return [];
		const data = JSON.parse(readFileSync(QUEUE_FILE, "utf-8")) as RenderJob[];
		// 중단된 rendering 작업을 queued로 복원
		return data.map((job) =>
			job.status === "rendering"
				? { ...job, status: "queued" as const, progress: 0 }
				: job,
		);
	} catch {
		return [];
	}
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function saveQueue(): void {
	// debounce: 100ms 내 연속 호출 시 마지막만 실행
	if (saveTimeout) clearTimeout(saveTimeout);
	saveTimeout = setTimeout(() => {
		writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2)).catch(() => {
			// 저장 실패는 non-critical
		});
	}, 100);
}

/** 즉시 저장 (shutdown 등) */
function saveQueueSync(): void {
	try {
		writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
	} catch {
		/* ignore */
	}
}

const queue: RenderJob[] = loadQueue();

/**
 * 동시 렌더 수. 기본: CPU 코어 절반 (최소 1, 최대 4).
 * RENDER_QUEUE_CONCURRENCY env 로 수동 조정 가능.
 */
const CPU_DEFAULT_CONCURRENCY = Math.max(1, Math.floor(os.cpus().length / 2));
const RENDER_CONCURRENCY = Math.max(
	1,
	Math.min(
		4,
		Number(process.env.RENDER_QUEUE_CONCURRENCY) || CPU_DEFAULT_CONCURRENCY,
	),
);

/** 재시도 최대 횟수 */
const MAX_RETRIES = 3;

/** 재시도 딜레이 (지수 백오프): 2s → 5s → 10s */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

const activeProcs = new Map<
	string,
	import("node:child_process").ChildProcess
>();

// 24시간 이상 된 완료/실패 작업 자동 정리
function cleanupOldJobs() {
	const cutoff = Date.now() - 24 * 60 * 60 * 1000;
	const before = queue.length;
	for (let i = queue.length - 1; i >= 0; i--) {
		const job = queue[i];
		if (
			(job.status === "complete" ||
				job.status === "failed" ||
				job.status === "cancelled") &&
			job.completedAt &&
			new Date(job.completedAt).getTime() < cutoff
		) {
			queue.splice(i, 1);
		}
	}
	if (queue.length !== before) saveQueue();
}
cleanupOldJobs();
setInterval(cleanupOldJobs, 60 * 60 * 1000).unref();

function generateId(): string {
	return `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * props를 결정적 문자열로 직렬화(키 정렬 포함).
 * 중복 잡 dedup 시 props 변경 감지용.
 */
function propsFingerprint(
	props: Record<string, unknown> | undefined | null,
): string {
	if (!props) return "";
	const keys = Object.keys(props).sort();
	if (keys.length === 0) return "";
	const ordered: Record<string, unknown> = {};
	for (const k of keys) ordered[k] = props[k];
	try {
		return JSON.stringify(ordered);
	} catch {
		return "";
	}
}

// ─── 큐 처리 (워커풀) ───

const pool = createWorkerPool({
	name: SERVICE,
	maxConcurrent: RENDER_CONCURRENCY,
	onError: (err, jobId) => {
		log.error("render pool job failed", {
			jobId,
			error: err instanceof Error ? err.message : String(err),
		});
	},
});

function enqueueRender(job: RenderJob): void {
	pool.submit(job.id, () => runRenderJob(job));
}

async function runRenderJob(job: RenderJob): Promise<void> {
	job.status = "rendering";
	job.startedAt = new Date().toISOString();
	job.progress = 0;
	saveQueue();

	log.info("Render started", { scriptId: job.scriptId, format: job.format });

	const RENDER_TIMEOUT_MS = job.timeoutMs ?? 30 * 60 * 1_000; // 기본 30분

	try {
		const compositionId =
			job.format === "shorts" ? "YouTubeShorts" : "YouTubeVideo";
		const outputPath = join(RENDERS_DIR, `${job.scriptId}-${job.format}.mp4`);
		job.outputPath = outputPath;

		await new Promise<void>((resolve, reject) => {
			const renderProps = {
				scriptId: job.scriptId,
				...(job.props ?? {}),
			};

			const resolved = resolveRenderOptions(job.renderOptions ?? {});
			const args = [
				"remotion",
				"render",
				"src/remotion/index.ts",
				compositionId,
				outputPath,
				"--props",
				JSON.stringify(renderProps),
				...toRemotionCliArgs(resolved),
			];
			log.info("Render options resolved", {
				preset: resolved.preset,
				codec: resolved.codec,
				crf: resolved.crf,
				videoBitrate: resolved.videoBitrate,
			});

			// execFile timeout 은 사용하지 않고 수동 타임아웃으로 SIGKILL 제어
			const proc = execFile(
				"npx",
				args,
				{ cwd: join(import.meta.dirname ?? ".", "..") },
				(err, _stdout, stderr) => {
					clearTimeout(timeoutId);
					activeProcs.delete(job.id);
					if (err) {
						reject(new Error(stderr || err.message));
					} else {
						resolve();
					}
				},
			);

			// 수동 타임아웃: hang 시 SIGKILL
			const timeoutId = setTimeout(() => {
				proc.kill("SIGKILL");
				log.error("Render timeout — process killed", {
					jobId: job.id,
					timeoutMs: RENDER_TIMEOUT_MS,
				});
				reject(new Error(`timeout after ${RENDER_TIMEOUT_MS}ms`));
			}, RENDER_TIMEOUT_MS);

			activeProcs.set(job.id, proc);

			// 체크포인트: stdout 에서 Remotion 프레임 진행 파싱
			proc.stdout?.on("data", (chunk: Buffer) => {
				const frameMatch = /Rendering frame (\d+)\/(\d+)/.exec(
					chunk.toString(),
				);
				if (frameMatch) {
					job.lastFrame = Number(frameMatch[1]);
					const total = Number(frameMatch[2]);
					job.progress = Math.round((job.lastFrame / total) * 100);
					// I/O 절약: 10프레임마다만 저장
					if (job.lastFrame % 10 === 0) saveQueue();
				}
			});

			// 진행률 파싱 (Remotion stderr % 출력)
			proc.stderr?.on("data", (data: Buffer) => {
				const line = data.toString();
				const match = line.match(/(\d+)%/);
				if (match) {
					job.progress = Number(match[1]);
				}
				process.stderr.write(data);
			});
		});

		job.status = "complete";
		job.progress = 100;
		job.completedAt = new Date().toISOString();
		saveQueue();
		log.info("Render complete", { outputPath });
		// 백그라운드 proxy 빌드 — video-proxy 가 renders/ allowlist 안이라 수락
		enqueueProxyBuildBackground(outputPath, (r) => {
			if (!r.ok)
				log.warn("proxy enqueue failed", { outputPath, error: r.error });
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Render failed";
		const retries = job.retryCount ?? 0;

		// 실패 원인 분류
		const errorCategory: RenderJob["errorCategory"] =
			msg.includes("timeout") || msg.includes("SIGKILL")
				? "timeout"
				: msg.includes("memory") || msg.includes("OOM")
					? "oom"
					: msg.includes("ENOENT")
						? "file_not_found"
						: "unknown";

		if (retries < MAX_RETRIES) {
			job.status = "queued";
			job.retryCount = retries + 1;
			job.progress = 0;
			job.error = undefined;
			job.errorCategory = undefined;
			const delay = RETRY_DELAYS_MS[retries] ?? 10_000;
			log.warn("Render failed, retrying", {
				error: msg,
				retry: retries + 1,
				lastFrame: job.lastFrame,
				delay,
			});
			// 재큐: pool 은 동일 jobId 를 다시 받아 재실행 (이전 실행이 완료되어 active/queue 에 없음)
			setTimeout(() => enqueueRender(job), delay);
		} else {
			job.status = "failed";
			job.error = msg;
			job.errorCategory = errorCategory;
			job.completedAt = new Date().toISOString();
			log.error("Render failed", {
				error: msg,
				category: errorCategory,
				jobId: job.id,
			});
		}
		saveQueue();
	} finally {
		activeProcs.delete(job.id);
	}
}

// 서버 시작 시 queued 잡 복원 enqueue
for (const j of queue) {
	if (j.status === "queued") enqueueRender(j);
}

// ─── HTTP 서버 ───

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
		.map((segment) => decodeURIComponent(segment))
		.join("/");
	const safePath = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
	const filePath = join(RENDER_ASSET_DIR, safePath);
	if (!filePath.startsWith(RENDER_ASSET_DIR)) return null;
	return filePath;
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
		out.on("finish", () => resolve());
	});
}

async function parseBody(
	req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown> | null> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let size = 0;
		const MAX_BODY = 16 * 1_048_576; // 16MB
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
		const active = queue.find((j) => j.status === "rendering");
		const pending = queue.filter((j) => j.status === "queued").length;
		const poolStats = pool.stats();
		json(req, res, 200, {
			ok: true,
			service: SERVICE,
			processing: Boolean(active),
			pendingJobs: pending,
			totalJobs: queue.length,
			uptime: process.uptime(),
			pool: poolStats,
		});
		return;
	}

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
				url: `http://localhost:${PORT}/assets/${assetPath
					.split("/")
					.map((segment) => encodeURIComponent(segment))
					.join("/")}`,
			});
		} catch (error) {
			json(req, res, 500, {
				error:
					error instanceof Error ? error.message : "자산 저장에 실패했습니다.",
			});
		}
		return;
	}

	if (url.pathname.startsWith("/assets/") && req.method === "GET") {
		const rawAssetPath = url.pathname.replace(/^\/assets\//, "");
		const filePath = resolveAssetPath(rawAssetPath);
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

	// ─── 렌더 작업 추가 ───
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

		// 중복 체크 — props + renderOptions 지문(fingerprint)으로 비교.
		// props/options 가 다르면 "새로운 렌더 요청"으로 간주
		const incomingFingerprint = `${propsFingerprint(props)}|${propsFingerprint(renderOptions as Record<string, unknown> | undefined)}`;
		const existing = queue.find(
			(j) =>
				j.scriptId === scriptId &&
				j.format === format &&
				`${propsFingerprint(j.props)}|${propsFingerprint(j.renderOptions as Record<string, unknown> | undefined)}` ===
					incomingFingerprint &&
				(j.status === "queued" || j.status === "rendering"),
		);
		if (existing) {
			// 동일 요청 — 기존 잡 반환
			json(req, res, 200, { job: existing });
			return;
		}

		// 같은 (scriptId, format)이지만 props가 다른 queued 잡은 취소 (stale)
		for (const j of queue) {
			if (
				j.scriptId === scriptId &&
				j.format === format &&
				j.status === "queued"
			) {
				j.status = "cancelled";
				j.completedAt = new Date().toISOString();
				j.error = "Superseded by new render request with updated props";
				log.info("Render superseded", {
					oldJobId: j.id,
					reason: "new props",
				});
			}
		}

		const job: RenderJob = {
			id: generateId(),
			scriptId,
			format: format as "shorts" | "longform",
			status: "queued",
			progress: 0,
			outputPath: "",
			createdAt: new Date().toISOString(),
			props,
			renderOptions,
		};

		queue.push(job);
		saveQueue();
		json(req, res, 201, { job });

		enqueueRender(job);
		return;
	}

	// ─── 렌더 상태 조회 ───
	const renderMatch = url.pathname.match(/^\/render\/([^/]+)$/);
	if (renderMatch && req.method === "GET") {
		const jobId = renderMatch[1];
		const job = queue.find((j) => j.id === jobId);
		if (!job) {
			json(req, res, 404, { error: "작업을 찾을 수 없습니다." });
			return;
		}
		json(req, res, 200, { job });
		return;
	}

	// ─── 렌더 취소 ───
	const cancelMatch = url.pathname.match(/^\/render\/([^/]+)\/cancel$/);
	if (cancelMatch && req.method === "POST") {
		const jobId = cancelMatch[1];
		const job = queue.find((j) => j.id === jobId);
		if (!job) {
			json(req, res, 404, { error: "작업을 찾을 수 없습니다." });
			return;
		}
		if (job.status === "queued") {
			pool.cancelQueued(job.id);
			job.status = "cancelled";
			job.completedAt = new Date().toISOString();
			saveQueue();
			json(req, res, 200, { job });
		} else if (job.status === "rendering") {
			const proc = activeProcs.get(job.id);
			if (proc) {
				proc.kill("SIGTERM");
				activeProcs.delete(job.id);
			}
			job.status = "cancelled";
			job.completedAt = new Date().toISOString();
			saveQueue();
			log.info("Render cancelled (killed process)", { jobId: job.id });
			json(req, res, 200, { job });
		} else {
			json(req, res, 400, {
				error: "완료된 작업은 취소할 수 없습니다.",
			});
		}
		return;
	}

	// ─── 전체 큐 조회 ───
	if (url.pathname === "/renders" && req.method === "GET") {
		json(req, res, 200, { jobs: queue });
		return;
	}

	json(req, res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
	log.info("Server started", { port: PORT, rendersDir: RENDERS_DIR });
});

setupGracefulShutdown(server, SERVICE, () => {
	saveQueueSync();
});
