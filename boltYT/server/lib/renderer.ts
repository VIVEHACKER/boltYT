/**
 * Renderer — Remotion CLI 실행, 프로세스 관리, 재시도 로직.
 *
 * createRenderer(opts) 팩토리로 인스턴스 생성.
 * queue 소유권은 JobManager에 있으며 renderer는 참조만 보유한다.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	resolveRenderOptions,
	toRemotionCliArgs,
} from "../../src/lib/render-options.js";
import type { TimelineProject } from "../../src/lib/timeline-model.js";
import { preprocessProjectAudio } from "./audio-effects-ffmpeg.js";
import type { RenderJob } from "./job-manager.js";
import { createLogger } from "./logger.js";
import { enqueueProxyBuildBackground } from "./proxy-enqueue.js";
import { checkFfmpegAvailability } from "./render-auth.js";
import { createWorkerPool } from "./worker-pool.js";

const log = createLogger("renderer");

// ─── 상수 ────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface RendererOptions {
	queue: RenderJob[];
	saveQueue: () => void;
	rendersDir: string;
	renderAssetDir: string;
	port: number;
	concurrency: number;
}

export interface Renderer {
	enqueueRender(job: RenderJob): void;
	cancelJob(jobId: string): boolean;
	poolStats(): ReturnType<ReturnType<typeof createWorkerPool>["stats"]>;
	checkFfmpeg(): void;
	isffmpegAvailable(): boolean;
}

// ─── 팩토리 ──────────────────────────────────────────────────────────────────

export function createRenderer(opts: RendererOptions): Renderer {
	const { saveQueue, rendersDir, renderAssetDir, port, concurrency } = opts;

	const pool = createWorkerPool({
		name: "renderer",
		maxConcurrent: concurrency,
		onError: (err, jobId) => {
			log.error("render pool job failed", {
				jobId,
				error: err instanceof Error ? err.message : String(err),
			});
		},
	});

	const activeProcs = new Map<
		string,
		import("node:child_process").ChildProcess
	>();
	let ffmpegAvailable = false;

	function enqueueRender(job: RenderJob): void {
		pool.submit(job.id, () => runRenderJob(job));
	}

	async function runRenderJob(job: RenderJob): Promise<void> {
		job.status = "rendering";
		job.startedAt = new Date().toISOString();
		job.progress = 0;
		saveQueue();

		log.info("Render started", { scriptId: job.scriptId, format: job.format });

		const RENDER_TIMEOUT_MS = job.timeoutMs ?? 30 * 60 * 1_000;

		try {
			const compositionId =
				job.format === "shorts" ? "YouTubeShorts" : "YouTubeVideo";
			const outputPath = join(rendersDir, `${job.scriptId}-${job.format}.mp4`);
			job.outputPath = outputPath;

			// audioEffects 클립 → ffmpeg 전처리
			const audioFxSubDir = `audio-fx-${job.id}`;
			const audioServeBase = `http://localhost:${port}/assets/${audioFxSubDir}`;
			let processedProps = job.props ?? {};
			const rawProject = processedProps.project as TimelineProject | undefined;
			if (
				ffmpegAvailable &&
				rawProject?.clips?.some((c) => c.audioEffects?.length)
			) {
				try {
					const updated = await preprocessProjectAudio(
						rawProject,
						renderAssetDir,
						audioFxSubDir,
						audioServeBase,
					);
					processedProps = { ...processedProps, project: updated };
					log.info("Audio effects preprocessed", { jobId: job.id });
				} catch (e) {
					log.warn("Audio effects preprocess failed — using original URLs", {
						jobId: job.id,
						error: e instanceof Error ? e.message : String(e),
					});
				}
			}

			await new Promise<void>((resolve, reject) => {
				const renderProps = { scriptId: job.scriptId, ...processedProps };
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

				const proc = execFile(
					"npx",
					args,
					{ cwd: join(import.meta.dirname ?? ".", "../..") },
					(err, _stdout, stderr) => {
						clearTimeout(timeoutId);
						activeProcs.delete(job.id);
						if (err) reject(new Error(stderr || err.message));
						else resolve();
					},
				);

				const timeoutId = setTimeout(() => {
					proc.kill("SIGKILL");
					log.error("Render timeout — process killed", {
						jobId: job.id,
						timeoutMs: RENDER_TIMEOUT_MS,
					});
					reject(new Error(`timeout after ${RENDER_TIMEOUT_MS}ms`));
				}, RENDER_TIMEOUT_MS);

				activeProcs.set(job.id, proc);

				proc.stdout?.on("data", (chunk: Buffer) => {
					const frameMatch = /Rendering frame (\d+)\/(\d+)/.exec(
						chunk.toString(),
					);
					if (frameMatch) {
						job.lastFrame = Number(frameMatch[1]);
						const total = Number(frameMatch[2]);
						job.progress = Math.round((job.lastFrame / total) * 100);
						if (job.lastFrame % 10 === 0) saveQueue();
					}
				});

				proc.stderr?.on("data", (data: Buffer) => {
					const match = data.toString().match(/(\d+)%/);
					if (match) job.progress = Number(match[1]);
					process.stderr.write(data);
				});
			});

			job.status = "complete";
			job.progress = 100;
			job.completedAt = new Date().toISOString();
			saveQueue();
			log.info("Render complete", { outputPath });
			enqueueProxyBuildBackground(outputPath, (r) => {
				if (!r.ok)
					log.warn("proxy enqueue failed", { outputPath, error: r.error });
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Render failed";
			const retries = job.retryCount ?? 0;

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
				// timeout 카테고리는 다음 시도에서 timeoutMs 1.5x 늘림 (점진적 여유)
				if (errorCategory === "timeout" && job.timeoutMs) {
					job.timeoutMs = Math.min(
						3 * 60 * 60 * 1000, // 3시간 cap
						Math.round(job.timeoutMs * 1.5),
					);
					log.info("Extended timeout for retry", {
						jobId: job.id,
						newTimeoutMs: job.timeoutMs,
					});
				}
				job.errorCategory = undefined;
				const delay = RETRY_DELAYS_MS[retries] ?? 10_000;
				log.warn("Render failed, retrying", {
					error: msg,
					retry: retries + 1,
					lastFrame: job.lastFrame,
					delay,
				});
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
			const cleanupDir = join(renderAssetDir, `audio-fx-${job.id}`);
			if (existsSync(cleanupDir)) {
				import("node:fs").then(({ rmSync }) => {
					try {
						rmSync(cleanupDir, { recursive: true, force: true });
					} catch {
						/* ignore */
					}
				});
			}
		}
	}

	function cancelJob(jobId: string): boolean {
		const proc = activeProcs.get(jobId);
		if (!proc) return false;
		proc.kill("SIGTERM");
		activeProcs.delete(jobId);
		return true;
	}

	function checkFfmpeg(): void {
		checkFfmpegAvailability((available) => {
			if (!available) {
				log.warn("ffmpeg not found — audio effects will be skipped", {
					hint: "Install ffmpeg: brew install ffmpeg",
				});
			} else {
				ffmpegAvailable = true;
				log.info("ffmpeg ready");
			}
		});
	}

	return {
		enqueueRender,
		cancelJob,
		poolStats: () => pool.stats(),
		checkFfmpeg,
		isffmpegAvailable: () => ffmpegAvailable,
	};
}
