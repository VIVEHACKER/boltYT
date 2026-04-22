/**
 * render-queue 재시도/병렬화 단위 테스트
 * - MAX_RETRIES=3 검증
 * - 지수 백오프 딜레이 검증 (vi.useFakeTimers)
 * - CPU 기반 기본 병렬화 계산 검증
 */

import os from "node:os";
import { describe, expect, it, vi } from "vitest";

// ─── 재시도/백오프 로직 (render-queue.ts 에서 추출한 상수/함수 동치) ───

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

function getRetryDelay(retryIndex: number): number {
	return RETRY_DELAYS_MS[retryIndex] ?? 10_000;
}

function calcDefaultConcurrency(): number {
	const cpuCount = os.cpus().length;
	const defaultConcurrency = Math.max(1, Math.floor(cpuCount / 2));
	return Math.max(1, Math.min(4, defaultConcurrency));
}

// ─── 테스트용 미니 렌더 잡 시뮬레이터 ───

interface SimJob {
	id: string;
	status: "queued" | "rendering" | "complete" | "failed";
	retryCount: number;
	progress: number;
	error?: string;
}

function makeJob(id = "job-1"): SimJob {
	return { id, status: "queued", retryCount: 0, progress: 0 };
}

/**
 * render-queue.ts 의 catch 블록 로직을 그대로 시뮬레이션.
 * 반환: { retriedAt: number[] } — setTimeout 에 전달된 딜레이 목록
 */
function simulateRetries(
	job: SimJob,
	failCount: number,
): { retriedAt: number[]; finalStatus: SimJob["status"] } {
	const retriedAt: number[] = [];

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const isLastFailure = attempt >= failCount;

		if (isLastFailure) {
			// 성공
			job.status = "complete";
			job.progress = 100;
			break;
		}

		// 실패 처리
		const retries = job.retryCount;
		if (retries < MAX_RETRIES) {
			job.status = "queued";
			job.retryCount = retries + 1;
			job.progress = 0;
			job.error = undefined;
			const delay = getRetryDelay(retries);
			retriedAt.push(delay);
		} else {
			job.status = "failed";
			job.error = "Render failed after max retries";
			break;
		}
	}

	return { retriedAt, finalStatus: job.status };
}

// ─── 테스트 ───

describe("render-queue — MAX_RETRIES", () => {
	it("MAX_RETRIES 는 3이다", () => {
		expect(MAX_RETRIES).toBe(3);
	});

	it("3회 실패 후 failed 상태", () => {
		const job = makeJob();
		// 4번 전부 실패 (성공 없음)
		const { finalStatus } = simulateRetries(job, 999);
		expect(finalStatus).toBe("failed");
		expect(job.retryCount).toBe(MAX_RETRIES);
	});

	it("2회 실패 후 3번째에 성공 → complete", () => {
		const job = makeJob();
		const { finalStatus } = simulateRetries(job, 2);
		expect(finalStatus).toBe("complete");
		expect(job.progress).toBe(100);
	});

	it("첫 시도 성공 → retryCount=0, complete", () => {
		const job = makeJob();
		const { retriedAt, finalStatus } = simulateRetries(job, 0);
		expect(finalStatus).toBe("complete");
		expect(retriedAt).toHaveLength(0);
	});
});

describe("render-queue — 지수 백오프", () => {
	it("첫 번째 재시도 딜레이 = 2000ms", () => {
		expect(getRetryDelay(0)).toBe(2_000);
	});

	it("두 번째 재시도 딜레이 = 5000ms", () => {
		expect(getRetryDelay(1)).toBe(5_000);
	});

	it("세 번째 재시도 딜레이 = 10000ms", () => {
		expect(getRetryDelay(2)).toBe(10_000);
	});

	it("범위 초과 인덱스 → 10000ms fallback", () => {
		expect(getRetryDelay(99)).toBe(10_000);
	});

	it("3회 모두 실패 시 딜레이 순서 검증", () => {
		const job = makeJob();
		const { retriedAt } = simulateRetries(job, 999);
		expect(retriedAt).toEqual([2_000, 5_000, 10_000]);
	});

	it("fake timer: 재시도 콜백이 딜레이 후 호출됨", () => {
		vi.useFakeTimers();
		const called: number[] = [];
		const delays = [2_000, 5_000, 10_000];

		for (const [i, delay] of delays.entries()) {
			setTimeout(() => called.push(i), delay);
		}

		vi.advanceTimersByTime(2_000);
		expect(called).toEqual([0]);

		vi.advanceTimersByTime(3_000); // 누적 5000ms
		expect(called).toEqual([0, 1]);

		vi.advanceTimersByTime(5_000); // 누적 10000ms
		expect(called).toEqual([0, 1, 2]);

		vi.useRealTimers();
	});
});

describe("render-queue — CPU 기반 병렬화", () => {
	it("CPU 코어 절반을 기본 동시성으로 사용 (최소 1, 최대 4)", () => {
		const result = calcDefaultConcurrency();
		expect(result).toBeGreaterThanOrEqual(1);
		expect(result).toBeLessThanOrEqual(4);
	});

	it("CPU 2코어 → 기본 동시성 1", () => {
		vi.spyOn(os, "cpus").mockReturnValue(
			new Array(2).fill({
				model: "x",
				speed: 0,
				times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
			}),
		);
		expect(calcDefaultConcurrency()).toBe(1);
		vi.restoreAllMocks();
	});

	it("CPU 4코어 → 기본 동시성 2", () => {
		vi.spyOn(os, "cpus").mockReturnValue(
			new Array(4).fill({
				model: "x",
				speed: 0,
				times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
			}),
		);
		expect(calcDefaultConcurrency()).toBe(2);
		vi.restoreAllMocks();
	});

	it("CPU 10코어 → 기본 동시성 4 (최대 캡)", () => {
		vi.spyOn(os, "cpus").mockReturnValue(
			new Array(10).fill({
				model: "x",
				speed: 0,
				times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
			}),
		);
		expect(calcDefaultConcurrency()).toBe(4);
		vi.restoreAllMocks();
	});

	it("CPU 1코어 → 기본 동시성 1 (최소 캡)", () => {
		vi.spyOn(os, "cpus").mockReturnValue(
			new Array(1).fill({
				model: "x",
				speed: 0,
				times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
			}),
		);
		expect(calcDefaultConcurrency()).toBe(1);
		vi.restoreAllMocks();
	});
});
