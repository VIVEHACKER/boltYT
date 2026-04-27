/**
 * JobManager — 렌더 큐 상태 소유 및 영속성.
 *
 * createJobManager(rendersDir) 팩토리로 인스턴스 생성.
 * queue 배열을 단일 소유자로 관리하고 saveQueue/cleanup을 제공한다.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RenderOptionsInput } from "../../src/lib/render-options.js";

// ─── 타입 ────────────────────────────────────────────────────────────────────

export type RenderJobPriority = "high" | "normal" | "low";

export interface RenderJob {
	id: string;
	scriptId: string;
	format: "shorts" | "longform";
	status: "queued" | "rendering" | "complete" | "failed" | "cancelled";
	progress: number;
	outputPath: string;
	error?: string;
	errorCategory?: "timeout" | "oom" | "file_not_found" | "unknown";
	retryCount?: number;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	props?: Record<string, unknown>;
	renderOptions?: RenderOptionsInput;
	timeoutMs?: number;
	lastFrame?: number;
	/** high → 큐 head 로 점프, low → tail 로. 기본 normal (FIFO). */
	priority?: RenderJobPriority;
}

/** 우선순위 weight (정렬용) */
export function priorityWeight(p?: RenderJobPriority): number {
	if (p === "high") return 0;
	if (p === "low") return 2;
	return 1;
}

/**
 * 큐를 priority 기반으로 안정 정렬 — high 먼저, normal 다음, low 마지막.
 * 같은 priority 안에서는 createdAt 순서 유지 (stable).
 */
export function sortByPriority(jobs: RenderJob[]): RenderJob[] {
	return [...jobs].sort((a, b) => {
		const pa = priorityWeight(a.priority);
		const pb = priorityWeight(b.priority);
		if (pa !== pb) return pa - pb;
		// stable: createdAt asc
		return (a.createdAt || "").localeCompare(b.createdAt || "");
	});
}

export const VALID_FORMATS = new Set(["shorts", "longform"]);

// ─── 팩토리 ──────────────────────────────────────────────────────────────────

export interface JobManager {
	queue: RenderJob[];
	saveQueue(): void;
	saveQueueSync(): void;
	cleanupOldJobs(): void;
	generateId(): string;
	propsFingerprint(props: Record<string, unknown> | undefined | null): string;
}

function loadQueueFromFile(queueFile: string): RenderJob[] {
	try {
		if (!existsSync(queueFile)) return [];
		const data = JSON.parse(readFileSync(queueFile, "utf-8")) as RenderJob[];
		return data.map((job) =>
			job.status === "rendering"
				? { ...job, status: "queued" as const, progress: 0 }
				: job,
		);
	} catch {
		return [];
	}
}

export function createJobManager(rendersDir: string): JobManager {
	const QUEUE_FILE = join(rendersDir, ".queue.json");
	const queue: RenderJob[] = loadQueueFromFile(QUEUE_FILE);

	let saveTimeout: ReturnType<typeof setTimeout> | null = null;

	function saveQueue(): void {
		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => {
			writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2)).catch(() => {});
		}, 100);
	}

	function saveQueueSync(): void {
		try {
			writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
		} catch {
			/* ignore */
		}
	}

	function cleanupOldJobs(): void {
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

	function generateId(): string {
		return `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

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

	cleanupOldJobs();
	setInterval(cleanupOldJobs, 60 * 60 * 1000).unref();

	return {
		queue,
		saveQueue,
		saveQueueSync,
		cleanupOldJobs,
		generateId,
		propsFingerprint,
	};
}
