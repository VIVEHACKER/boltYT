import { beforeEach, describe, expect, it } from "vitest";
import { reset as resetMetrics, snapshot } from "./metrics.ts";
import { createWorkerPool } from "./worker-pool.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("worker-pool", () => {
	beforeEach(() => resetMetrics());

	it("submit → drain 완료, 동시 실행 max 준수", async () => {
		const pool = createWorkerPool({ name: "t1", maxConcurrent: 2 });
		let peak = 0;
		let inFlight = 0;
		for (let i = 0; i < 6; i++) {
			pool.submit(`j${i}`, async () => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await tick(10);
				inFlight--;
			});
		}
		expect(pool.stats().queued).toBeGreaterThan(0);
		await pool.drain();
		expect(peak).toBeLessThanOrEqual(2);
		expect(pool.stats()).toMatchObject({
			active: 0,
			queued: 0,
			completed: 6,
			failed: 0,
		});
	});

	it("중복 jobId submit 무시 (idempotent)", async () => {
		const pool = createWorkerPool({ name: "t2", maxConcurrent: 1 });
		let runs = 0;
		const run = async () => {
			runs++;
			await tick(5);
		};
		expect(pool.submit("same", run)).toBe(true);
		expect(pool.submit("same", run)).toBe(false);
		await pool.drain();
		expect(runs).toBe(1);
	});

	it("실패 잡은 failed 로 집계, 다른 잡 계속 실행", async () => {
		const errors: string[] = [];
		const pool = createWorkerPool({
			name: "t3",
			maxConcurrent: 1,
			onError: (_e, id) => errors.push(id),
		});
		pool.submit("bad", async () => {
			throw new Error("boom");
		});
		pool.submit("good", async () => {
			await tick(2);
		});
		await pool.drain();
		expect(errors).toEqual(["bad"]);
		expect(pool.stats()).toMatchObject({
			completed: 1,
			failed: 1,
		});
	});

	it("cancelQueued 는 큐에 있는 잡만 취소, 이미 실행 중이면 false", async () => {
		const pool = createWorkerPool({ name: "t4", maxConcurrent: 1 });
		let fired = false;
		pool.submit("running", async () => {
			await tick(30);
		});
		pool.submit("queued", async () => {
			fired = true;
		});
		// running 은 이미 active, queued 만 취소 가능
		await tick(1);
		expect(pool.cancelQueued("queued")).toBe(true);
		expect(pool.cancelQueued("running")).toBe(false);
		await pool.drain();
		expect(fired).toBe(false);
	});

	it("setMaxConcurrent 확장 시 대기 중 잡 즉시 실행", async () => {
		const pool = createWorkerPool({ name: "t5", maxConcurrent: 1 });
		let peak = 0;
		let running = 0;
		for (let i = 0; i < 4; i++) {
			pool.submit(`j${i}`, async () => {
				running++;
				peak = Math.max(peak, running);
				await tick(15);
				running--;
			});
		}
		await tick(2);
		pool.setMaxConcurrent(3);
		await pool.drain();
		expect(peak).toBeGreaterThanOrEqual(2);
	});

	it("메트릭 기록 (started/completed/failed)", async () => {
		const pool = createWorkerPool({ name: "metrics-t", maxConcurrent: 2 });
		pool.submit("a", async () => {
			await tick(2);
		});
		pool.submit("b", async () => {
			throw new Error("x");
		});
		await pool.drain();
		const snap = snapshot();
		const started = snap.counters.find((c) =>
			c.key.startsWith("pool_jobs_started_total|"),
		);
		const completed = snap.counters.find((c) =>
			c.key.startsWith("pool_jobs_completed_total|"),
		);
		const failedC = snap.counters.find((c) =>
			c.key.startsWith("pool_jobs_failed_total|"),
		);
		expect(started?.value).toBe(2);
		expect(completed?.value).toBe(1);
		expect(failedC?.value).toBe(1);
	});
});
