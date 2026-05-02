/**
 * render-queue.ts 단위 테스트
 *
 * fetch 의존 → vi.stubGlobal.
 * pollRenderProgress → fake timers 사용.
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	cancelRender,
	checkRenderServer,
	getRenderQueue,
	getRenderStatus,
	isRenderJobError,
	pollRenderProgress,
	submitRender,
} from "./render-queue";

// ─── localStorage stub ────────────────────────────────────────────────────────
const _ls: Record<string, string> = {};
const mockStorage = {
	getItem: (k: string) => _ls[k] ?? null,
	setItem: (k: string, v: string) => {
		_ls[k] = v;
	},
	removeItem: (k: string) => {
		delete _ls[k];
	},
	clear: () => {
		for (const k of Object.keys(_ls)) delete _ls[k];
	},
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => mockStorage.clear());

// ─── fetch helpers ────────────────────────────────────────────────────────────
function okFetch(body: unknown) {
	const mock = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
	});
	vi.stubGlobal("fetch", mock);
	return mock;
}

function failFetch(status = 500, errBody?: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: false,
			status,
			statusText: "Error",
			json: () => Promise.resolve(errBody ?? { error: `HTTP ${status}` }),
		}),
	);
}

function networkErrorFetch() {
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
}

// ─── checkRenderServer ────────────────────────────────────────────────────────
describe("checkRenderServer", () => {
	it("정상 → QueueHealth 반환", async () => {
		okFetch({ ok: true, processing: true, pendingJobs: 2, totalJobs: 5 });
		expect(await checkRenderServer()).toEqual({
			ok: true,
			processing: true,
			pendingJobs: 2,
			totalJobs: 5,
		});
	});

	it("네트워크 오류 → { ok: false, ... }", async () => {
		networkErrorFetch();
		expect(await checkRenderServer()).toEqual({
			ok: false,
			processing: false,
			pendingJobs: 0,
			totalJobs: 0,
		});
	});

	it("HTTP 500 → { ok: false, ... }", async () => {
		failFetch(500);
		expect(await checkRenderServer()).toEqual({
			ok: false,
			processing: false,
			pendingJobs: 0,
			totalJobs: 0,
		});
	});

	it("localStorage render_server_url 사용", async () => {
		mockStorage.setItem("render_server_url", "http://custom:9000");
		const fetchMock = okFetch({
			ok: true,
			processing: false,
			pendingJobs: 0,
			totalJobs: 0,
		});
		await checkRenderServer();
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
			"http://custom:9000/health",
		);
	});
});

// ─── submitRender ─────────────────────────────────────────────────────────────
describe("submitRender", () => {
	const job = {
		id: "job-1",
		scriptId: "script-abc",
		format: "longform",
		status: "queued",
		progress: 0,
		outputPath: "",
		createdAt: "2026-01-01T00:00:00Z",
	};

	it("성공 → RenderJob 반환", async () => {
		okFetch({ job });
		expect(await submitRender("script-abc")).toEqual(job);
	});

	it("format 기본값 'longform'", async () => {
		const fetchMock = okFetch({ job });
		await submitRender("s-1");
		const body = JSON.parse(
			(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
		) as Record<string, unknown>;
		expect(body.format).toBe("longform");
	});

	it("HTTP 오류 → 예외 throw", async () => {
		failFetch(500);
		await expect(submitRender("s-1", "shorts")).rejects.toThrow();
	});
});

// ─── getRenderStatus ──────────────────────────────────────────────────────────
describe("getRenderStatus", () => {
	it("jobId 포함 URL 호출 → RenderJob 반환", async () => {
		const job = {
			id: "job-42",
			status: "rendering",
			progress: 60,
			scriptId: "s",
			format: "longform",
			outputPath: "",
			createdAt: "",
		};
		const fetchMock = okFetch({ job });
		expect(await getRenderStatus("job-42")).toEqual(job);
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain(
			"/render/job-42",
		);
	});
});

// ─── cancelRender ─────────────────────────────────────────────────────────────
describe("cancelRender", () => {
	it("POST /render/:id/cancel 호출", async () => {
		const job = {
			id: "job-1",
			status: "cancelled",
			progress: 30,
			scriptId: "s",
			format: "longform",
			outputPath: "",
			createdAt: "",
		};
		const fetchMock = okFetch({ job });
		const result = await cancelRender("job-1");
		expect(result.status).toBe("cancelled");
		const call = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(call[0]).toContain("/render/job-1/cancel");
		expect(call[1].method).toBe("POST");
	});
});

// ─── getRenderQueue ───────────────────────────────────────────────────────────
describe("getRenderQueue", () => {
	it("jobs 배열 반환", async () => {
		const jobs = [
			{
				id: "j1",
				scriptId: "s1",
				format: "longform",
				status: "queued",
				progress: 0,
				outputPath: "",
				createdAt: "",
			},
		];
		okFetch({ jobs });
		expect(await getRenderQueue()).toEqual(jobs);
	});

	it("빈 큐 → 빈 배열", async () => {
		okFetch({ jobs: [] });
		expect(await getRenderQueue()).toEqual([]);
	});
});

// ─── pollRenderProgress ───────────────────────────────────────────────────────
describe("pollRenderProgress", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function makeJob(
		status: string,
		progress = 100,
		error?: string,
		extra: Record<string, unknown> = {},
	): Record<string, unknown> {
		return {
			job: {
				id: "j1",
				scriptId: "s1",
				format: "longform",
				status,
				progress,
				outputPath: "/out.mp4",
				createdAt: "",
				error,
				...extra,
			},
		};
	}

	it("complete 상태 → resolve", async () => {
		okFetch(makeJob("complete", 100));
		const onProgress = vi.fn();
		const promise = pollRenderProgress("j1", onProgress, 1000);
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result.status).toBe("complete");
		expect(onProgress).toHaveBeenCalled();
	});

	it("failed 상태 → reject", async () => {
		okFetch(
			makeJob("failed", 50, "render error", {
				errorCategory: "quality_gate",
				qcResult: { score: 63, passed: false },
			}),
		);
		const promise = pollRenderProgress("j1", vi.fn(), 1000);
		promise.catch(() => {}); // unhandled rejection 방지
		await vi.runAllTimersAsync();
		let caught: unknown;
		await promise.catch((error) => {
			caught = error;
		});
		expect(isRenderJobError(caught)).toBe(true);
		if (isRenderJobError(caught)) {
			expect(caught.job.errorCategory).toBe("quality_gate");
			expect((caught.job.qcResult as { score?: number }).score).toBe(63);
		}
	});

	it("cancelled 상태 → reject", async () => {
		okFetch(makeJob("cancelled", 20));
		const promise = pollRenderProgress("j1", vi.fn(), 1000);
		promise.catch(() => {}); // unhandled rejection 방지
		await vi.runAllTimersAsync();
		await expect(promise).rejects.toThrow();
	});

	it("타임아웃 → reject", async () => {
		okFetch(makeJob("rendering", 30));
		const promise = pollRenderProgress("j1", vi.fn(), 1000, 500);
		promise.catch(() => {}); // unhandled rejection 방지
		await vi.advanceTimersByTimeAsync(600);
		await expect(promise).rejects.toThrow("타임아웃");
	});

	it("fetch 오류 → reject", async () => {
		networkErrorFetch();
		const promise = pollRenderProgress("j1", vi.fn(), 1000);
		promise.catch(() => {}); // unhandled rejection 방지
		await vi.runAllTimersAsync();
		await expect(promise).rejects.toThrow();
	});
});
