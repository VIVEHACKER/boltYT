/**
 * 렌더 큐 클라이언트 — 서버(3458)와 통신
 */

import type { RenderOptionsInput } from "./render-options";

export function getRenderServer() {
	if (typeof localStorage !== "undefined") {
		return localStorage.getItem("render_server_url") ?? "http://localhost:3458";
	}
	return "http://localhost:3458";
}

interface RenderJob {
	id: string;
	scriptId: string;
	format: "shorts" | "longform";
	status: "queued" | "rendering" | "complete" | "failed" | "cancelled";
	progress: number;
	outputPath: string;
	error?: string;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
}

interface QueueHealth {
	ok: boolean;
	processing: boolean;
	pendingJobs: number;
	totalJobs: number;
}

async function fetchQueue<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${getRenderServer()}${path}`, {
		...options,
		headers: { "Content-Type": "application/json", ...options?.headers },
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
	}
	return res.json() as Promise<T>;
}

/** 서버 상태 확인 */
export async function checkRenderServer(): Promise<QueueHealth> {
	try {
		return await fetchQueue<QueueHealth>("/health");
	} catch {
		return { ok: false, processing: false, pendingJobs: 0, totalJobs: 0 };
	}
}

/** 렌더 작업 추가 */
export async function submitRender(
	scriptId: string,
	format: "shorts" | "longform" = "longform",
	props?: Record<string, unknown>,
	renderOptions?: RenderOptionsInput,
): Promise<RenderJob> {
	const { job } = await fetchQueue<{ job: RenderJob }>("/render", {
		method: "POST",
		body: JSON.stringify({ scriptId, format, props, renderOptions }),
	});
	return job;
}

/** 렌더 상태 조회 */
export async function getRenderStatus(jobId: string): Promise<RenderJob> {
	const { job } = await fetchQueue<{ job: RenderJob }>(`/render/${jobId}`);
	return job;
}

/** 렌더 취소 */
export async function cancelRender(jobId: string): Promise<RenderJob> {
	const { job } = await fetchQueue<{ job: RenderJob }>(
		`/render/${jobId}/cancel`,
		{ method: "POST" },
	);
	return job;
}

/** 전체 큐 조회 */
export async function getRenderQueue(): Promise<RenderJob[]> {
	const { jobs } = await fetchQueue<{ jobs: RenderJob[] }>("/renders");
	return jobs;
}

/**
 * 렌더 진행률 폴링
 * 콜백으로 진행률 업데이트, 완료/실패 시 resolve
 */
export function pollRenderProgress(
	jobId: string,
	onProgress: (progress: number, status: string) => void,
	intervalMs = 2000,
	timeoutMs = 720_000, // 12분 타임아웃
): Promise<RenderJob> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			clearInterval(poll);
			reject(new Error("렌더링 타임아웃 (12분 초과)"));
		}, timeoutMs);

		const poll = setInterval(async () => {
			try {
				const job = await getRenderStatus(jobId);
				onProgress(job.progress, job.status);

				if (job.status === "complete") {
					clearTimeout(timeout);
					clearInterval(poll);
					resolve(job);
				} else if (job.status === "failed" || job.status === "cancelled") {
					clearTimeout(timeout);
					clearInterval(poll);
					reject(new Error(job.error ?? `Render ${job.status}`));
				}
			} catch (e) {
				clearTimeout(timeout);
				clearInterval(poll);
				reject(e);
			}
		}, intervalMs);
	});
}
