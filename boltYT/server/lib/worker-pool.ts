/**
 * @AX:ANCHOR 공통 워커풀 — reference-analyzer / render-queue 공용
 * @AX:REASON 동시성 전략 변경 시 단일 지점. 메트릭/백프레셔/에러도 여기서 통일.
 *
 * 특징:
 * - maxConcurrent N 개 잡을 동시 실행 (enqueue 시 즉시 시도)
 * - 같은 jobId 중복 submit 시 무시 (idempotent)
 * - 잡 실행 메트릭 자동 기록 (counter/gauge/histogram)
 * - drain() 은 큐+활성이 모두 0 이 될 때까지 await
 */

import { counter, gauge, histogram } from "./metrics.ts";

export interface WorkerPoolOptions {
	name: string;
	maxConcurrent: number;
	onError?: (err: unknown, jobId: string) => void;
}

interface QueueItem {
	jobId: string;
	run: () => Promise<void>;
}

export interface WorkerPoolStats {
	name: string;
	maxConcurrent: number;
	active: number;
	queued: number;
	started: number;
	completed: number;
	failed: number;
}

export interface WorkerPool {
	submit(jobId: string, run: () => Promise<void>): boolean;
	cancelQueued(jobId: string): boolean;
	stats(): WorkerPoolStats;
	setMaxConcurrent(n: number): void;
	drain(): Promise<void>;
	isActive(jobId: string): boolean;
	isQueued(jobId: string): boolean;
}

export function createWorkerPool(opts: WorkerPoolOptions): WorkerPool {
	const name = opts.name;
	let max = Math.max(1, Math.floor(opts.maxConcurrent));
	const queue: QueueItem[] = [];
	const active = new Set<string>();
	let started = 0;
	let completed = 0;
	let failed = 0;
	const waiters: Array<() => void> = [];

	function emitGauges() {
		gauge("pool_active", active.size, { pool: name });
		gauge("pool_queued", queue.length, { pool: name });
		gauge("pool_max_concurrent", max, { pool: name });
	}
	emitGauges();

	function tryRun() {
		while (active.size < max && queue.length > 0) {
			const item = queue.shift();
			if (!item) break;
			active.add(item.jobId);
			started += 1;
			counter("pool_jobs_started_total", { pool: name });
			emitGauges();
			const startTs = performance.now();
			// 독립 태스크 — 호출자 제어로 돌아가도록 microtask로 시작
			void Promise.resolve()
				.then(() => item.run())
				.then(
					() => {
						completed += 1;
						counter("pool_jobs_completed_total", { pool: name });
						histogram("pool_job_duration_ms", performance.now() - startTs, {
							pool: name,
							outcome: "ok",
						});
					},
					(err) => {
						failed += 1;
						counter("pool_jobs_failed_total", { pool: name });
						histogram("pool_job_duration_ms", performance.now() - startTs, {
							pool: name,
							outcome: "error",
						});
						opts.onError?.(err, item.jobId);
					},
				)
				.finally(() => {
					active.delete(item.jobId);
					emitGauges();
					tryRun();
					if (active.size === 0 && queue.length === 0) {
						for (const w of waiters.splice(0)) w();
					}
				});
		}
	}

	return {
		submit(jobId, run) {
			if (active.has(jobId) || queue.some((q) => q.jobId === jobId))
				return false;
			queue.push({ jobId, run });
			counter("pool_jobs_enqueued_total", { pool: name });
			emitGauges();
			tryRun();
			return true;
		},
		cancelQueued(jobId) {
			const idx = queue.findIndex((q) => q.jobId === jobId);
			if (idx === -1) return false;
			queue.splice(idx, 1);
			counter("pool_jobs_cancelled_total", { pool: name });
			emitGauges();
			return true;
		},
		stats() {
			return {
				name,
				maxConcurrent: max,
				active: active.size,
				queued: queue.length,
				started,
				completed,
				failed,
			};
		},
		setMaxConcurrent(n) {
			max = Math.max(1, Math.floor(n));
			emitGauges();
			tryRun();
		},
		drain() {
			if (active.size === 0 && queue.length === 0) return Promise.resolve();
			return new Promise((resolve) => waiters.push(resolve));
		},
		isActive(jobId) {
			return active.has(jobId);
		},
		isQueued(jobId) {
			return queue.some((q) => q.jobId === jobId);
		},
	};
}
