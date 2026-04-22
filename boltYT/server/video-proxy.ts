/**
 * 로컬 비디오 프록시 — YouTube 영상을 yt-dlp로 다운로드하여 제공
 *
 * 실행: npm run proxy
 * 필요: yt-dlp (brew install yt-dlp), ffmpeg (brew install ffmpeg)
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	createReadStream,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import {
	buildProxyArgs,
	hasValidProxy,
	isPathInAllowedRoots,
	proxyPathFor,
} from "./lib/proxy-file.ts";
import { trackRequest } from "./lib/request-metrics.ts";
import { setupGracefulShutdown } from "./lib/shutdown.ts";
import { createWorkerPool } from "./lib/worker-pool.ts";

const SERVICE = "video-proxy";

const PORT = Number(process.env.PROXY_PORT ?? 3456);
const TEMP_DIR = join(import.meta.dirname ?? ".", ".tmp");
if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

// 시작 시 고아 temp 파일 정리
for (const f of readdirSync(TEMP_DIR)) {
	if (f.endsWith(".mp4")) {
		try {
			unlinkSync(join(TEMP_DIR, f));
		} catch {
			/* ignore */
		}
	}
}

const MAX_CONCURRENT_DOWNLOADS = 3;
let activeDownloads = 0;

// ─── Proxy build (Phase 16) ───
// 프록시 빌드 허용 루트. 프로젝트 내부 경로만 받아 LFI/경로 우회 차단.
const BOLT_ROOT = resolve(import.meta.dirname ?? ".", "..");
const PROXY_ALLOWED_ROOTS = [
	resolve(BOLT_ROOT, "renders"),
	resolve(BOLT_ROOT, "server/.tmp/reference"),
	resolve(BOLT_ROOT, "public/generated"),
];
const PROXY_BUILD_CONCURRENCY = Math.max(
	1,
	Math.min(4, Number(process.env.PROXY_BUILD_CONCURRENCY) || 2),
);
const proxyPool = createWorkerPool({
	name: "proxy-build",
	maxConcurrent: PROXY_BUILD_CONCURRENCY,
	onError: (err, jobId) => {
		process.stderr.write(
			`${JSON.stringify({
				ts: new Date().toISOString(),
				level: "error",
				service: SERVICE,
				msg: "proxy build failed",
				jobId,
				error: err instanceof Error ? err.message : String(err),
			})}\n`,
		);
	},
});

function cors(headers: Record<string, string>) {
	return {
		...headers,
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

async function readJsonBody(
	req: import("node:http").IncomingMessage,
	maxBytes = 8 * 1024,
): Promise<Record<string, unknown> | null> {
	return new Promise((resolvePromise) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let rejected = false;
		req.on("data", (c: Buffer) => {
			size += c.length;
			if (size > maxBytes) {
				rejected = true;
				return;
			}
			chunks.push(c);
		});
		req.on("end", () => {
			if (rejected) {
				resolvePromise(null);
				return;
			}
			try {
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
				resolvePromise(
					parsed && typeof parsed === "object"
						? (parsed as Record<string, unknown>)
						: null,
				);
			} catch {
				resolvePromise(null);
			}
		});
		req.on("error", () => resolvePromise(null));
	});
}

function runFfmpegProxy(inputPath: string, outputPath: string): Promise<void> {
	return new Promise((resolveProc, rejectProc) => {
		const args = buildProxyArgs(inputPath, outputPath);
		execFile(
			"ffmpeg",
			args,
			{ timeout: 300_000, maxBuffer: 4 * 1024 * 1024 },
			(err, _stdout, stderr) => {
				if (err) rejectProc(new Error(stderr || err.message));
				else resolveProc();
			},
		);
	});
}

const server = createServer(async (req, res) => {
	trackRequest(req, res, SERVICE);
	const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

	if (req.method === "OPTIONS") {
		res.writeHead(204, cors({}));
		res.end();
		return;
	}

	if (url.pathname === "/health") {
		res.writeHead(200, cors({ "Content-Type": "application/json" }));
		res.end(JSON.stringify({ ok: true }));
		return;
	}

	if (url.pathname === "/download") {
		const videoUrl = url.searchParams.get("url");
		const maxDuration = Number(url.searchParams.get("maxDuration") ?? 30);

		if (!videoUrl) {
			res.writeHead(400, cors({ "Content-Type": "text/plain" }));
			res.end("Missing ?url= parameter");
			return;
		}

		// YouTube URL만 허용 (SSRF 방지)
		const ALLOWED_HOSTS = [
			"www.youtube.com",
			"youtube.com",
			"youtu.be",
			"m.youtube.com",
		];
		try {
			const parsed = new URL(videoUrl);
			if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
				res.writeHead(400, cors({ "Content-Type": "text/plain" }));
				res.end("Only YouTube URLs are allowed");
				return;
			}
		} catch {
			res.writeHead(400, cors({ "Content-Type": "text/plain" }));
			res.end("Invalid URL");
			return;
		}

		if (
			!Number.isFinite(maxDuration) ||
			maxDuration <= 0 ||
			maxDuration > 300
		) {
			res.writeHead(400, cors({ "Content-Type": "text/plain" }));
			res.end("maxDuration must be 1-300");
			return;
		}

		// 동시 다운로드 제한
		if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
			res.writeHead(429, cors({ "Content-Type": "text/plain" }));
			res.end("Too many concurrent downloads. Please try again later.");
			return;
		}
		activeDownloads++;

		const id = randomUUID();
		const outputPath = join(TEMP_DIR, `${id}.mp4`);

		try {
			process.stderr.write(`[download] ${videoUrl} (max ${maxDuration}s)\n`);

			// yt-dlp로 다운로드 (720p, maxDuration 제한)
			await new Promise<void>((resolve, reject) => {
				const args = [
					"-f",
					"bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best",
					"--merge-output-format",
					"mp4",
					"--no-playlist",
					"-o",
					outputPath,
				];

				// duration 제한: yt-dlp의 download-sections 사용
				if (maxDuration > 0) {
					args.push(
						"--download-sections",
						`*0-${maxDuration}`,
						"--force-keyframes-at-cuts",
					);
				}

				args.push(videoUrl);

				execFile(
					"yt-dlp",
					args,
					{ timeout: 120_000 },
					(err, _stdout, stderr) => {
						if (err) {
							console.error("[yt-dlp error]", stderr || err.message);
							reject(new Error(stderr || err.message));
						} else {
							resolve();
						}
					},
				);
			});

			if (!existsSync(outputPath)) {
				throw new Error("yt-dlp output file not found");
			}

			const fileStat = statSync(outputPath);
			process.stderr.write(
				`[done] ${(fileStat.size / 1024 / 1024).toFixed(1)}MB → ${id}\n`,
			);

			res.writeHead(
				200,
				cors({
					"Content-Type": "video/mp4",
					"Content-Length": String(fileStat.size),
				}),
			);

			const stream = createReadStream(outputPath);
			stream.pipe(res);
			stream.on("close", () => {
				try {
					unlinkSync(outputPath);
				} catch {
					/* ignore */
				}
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Download failed";
			process.stderr.write(`[error] ${msg}\n`);
			res.writeHead(500, cors({ "Content-Type": "text/plain" }));
			res.end("Video download failed");

			try {
				unlinkSync(outputPath);
			} catch {
				// cleanup failure is non-critical
			}
		} finally {
			activeDownloads--;
		}

		return;
	}

	// ─── 프록시 빌드 (Phase 16.5) ───
	// POST /build-proxy { path } → { ok, proxyPath, alreadyExists?, queued?, active? }
	if (url.pathname === "/build-proxy" && req.method === "POST") {
		const body = await readJsonBody(req);
		const pathInput = typeof body?.path === "string" ? body.path : "";
		if (!pathInput) {
			res.writeHead(400, cors({ "Content-Type": "application/json" }));
			res.end(JSON.stringify({ error: "path required" }));
			return;
		}
		// 비디오 확장자 사전 확인 (저비용 검증)
		if (!/\.(mp4|mov|avi|mkv|webm|m4v|flv)$/i.test(pathInput)) {
			res.writeHead(400, cors({ "Content-Type": "application/json" }));
			res.end(JSON.stringify({ error: "video extension required" }));
			return;
		}
		// realpath 해소 + allowlist — 심볼릭 링크·상대경로 우회 차단
		let real: string;
		try {
			real = realpathSync(resolve(pathInput));
		} catch {
			res.writeHead(404, cors({ "Content-Type": "application/json" }));
			res.end(JSON.stringify({ error: "path not found" }));
			return;
		}
		if (!isPathInAllowedRoots(real, PROXY_ALLOWED_ROOTS)) {
			res.writeHead(403, cors({ "Content-Type": "application/json" }));
			res.end(JSON.stringify({ error: "path outside allowed roots" }));
			return;
		}
		let lstat: ReturnType<typeof lstatSync>;
		try {
			lstat = lstatSync(real);
		} catch {
			res.writeHead(404, cors({ "Content-Type": "application/json" }));
			res.end(JSON.stringify({ error: "stat failed" }));
			return;
		}
		if (!lstat.isFile()) {
			res.writeHead(400, cors({ "Content-Type": "application/json" }));
			res.end(JSON.stringify({ error: "regular file required" }));
			return;
		}

		const proxyPath = proxyPathFor(real);
		if (hasValidProxy(real)) {
			res.writeHead(200, cors({ "Content-Type": "application/json" }));
			res.end(JSON.stringify({ ok: true, proxyPath, alreadyExists: true }));
			return;
		}

		const jobId = real;
		if (proxyPool.isActive(jobId) || proxyPool.isQueued(jobId)) {
			res.writeHead(202, cors({ "Content-Type": "application/json" }));
			res.end(
				JSON.stringify({
					ok: true,
					proxyPath,
					alreadyExists: false,
					queued: true,
					pool: proxyPool.stats(),
				}),
			);
			return;
		}

		proxyPool.submit(jobId, () => runFfmpegProxy(real, proxyPath));
		res.writeHead(202, cors({ "Content-Type": "application/json" }));
		res.end(
			JSON.stringify({
				ok: true,
				proxyPath,
				alreadyExists: false,
				queued: true,
				pool: proxyPool.stats(),
			}),
		);
		return;
	}

	res.writeHead(404, cors({ "Content-Type": "text/plain" }));
	res.end("Not found");
});

server.listen(PORT, () => {
	process.stderr.write(`Video proxy running on http://localhost:${PORT}\n`);
	process.stderr.write("Endpoints:\n");
	process.stderr.write("  GET  /health              — 상태 확인\n");
	process.stderr.write(
		"  GET  /download?url=...    — YouTube 영상 다운로드 (maxDuration=30)\n",
	);
	process.stderr.write(
		"  POST /build-proxy         — 프로젝트 내부 비디오 → 720p proxy 렌더 enqueue\n",
	);
});

setupGracefulShutdown(server, "video-proxy", () => {
	// temp 파일 정리
	for (const f of readdirSync(TEMP_DIR)) {
		if (f.endsWith(".mp4")) {
			try {
				unlinkSync(join(TEMP_DIR, f));
			} catch {
				/* ignore */
			}
		}
	}
});
