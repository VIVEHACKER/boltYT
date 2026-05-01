/**
 * fal.ai Queue API 클라이언트
 *
 * - submit: POST {endpoint} → request_id
 * - poll: GET {endpoint}/requests/{id}/status (1.5s 간격)
 * - fetch: GET {endpoint}/requests/{id} → 결과
 *
 * 영상 생성은 짧으면 30초, 길면 5분+ 소요. 클라이언트 timeout 차단을
 * 피하기 위해 서버에서 동기 폴링 후 결과 반환.
 */

import { fetchWithRetry } from "./fetch-retry.ts";

export const FAL_ENDPOINTS = {
	/** Kling 3.0 image-to-video — 고품질 모션 ($0.07~0.10/sec) */
	kling3: "fal-ai/kling-video/v3.0/image-to-video",
	/** Wan 2.6 image-to-video — 가성비 ($0.05/sec) */
	wan26: "fal-ai/wan/v2.6/image-to-video",
	/** Kling O1 keyframe interpolation (start+end) */
	klingO1: "fal-ai/kling-video/o1/image-to-video",
	/** LTX Video v2 image-to-video — 빠른 추론 */
	ltx2: "fal-ai/ltx-video/v2/image-to-video",
	/** Hailuo-02 text-to-video — 카메라 명령 지원 */
	hailuo: "fal-ai/minimax/hailuo-02/standard/text-to-video",
} as const;

export type FalProvider = keyof typeof FAL_ENDPOINTS;

const QUEUE_BASE = "https://queue.fal.run";

interface SubmitResponse {
	request_id: string;
	status_url?: string;
	response_url?: string;
	cancel_url?: string;
}

interface StatusResponse {
	status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;
	logs?: Array<{ message: string; timestamp?: string }>;
	queue_position?: number;
}

export interface FalVideoResult {
	video_url: string;
	request_id: string;
	provider: FalProvider;
	endpoint: string;
	raw: Record<string, unknown>;
}

/** fal.ai 결과 객체에서 video URL 추출 */
function extractVideoUrl(result: unknown): string | null {
	if (!result || typeof result !== "object") return null;
	const obj = result as Record<string, unknown>;

	// 표준 형태: { video: { url } } 또는 { video: { ..., url } }
	const videoField = obj.video;
	if (videoField && typeof videoField === "object") {
		const url = (videoField as Record<string, unknown>).url;
		if (typeof url === "string" && url) return url;
	}

	// 일부 모델: { videos: [{ url }] }
	const videosField = obj.videos;
	if (Array.isArray(videosField) && videosField.length > 0) {
		const first = videosField[0];
		if (first && typeof first === "object") {
			const url = (first as Record<string, unknown>).url;
			if (typeof url === "string" && url) return url;
		}
	}

	// fallback: 최상위 url 필드
	if (typeof obj.url === "string" && obj.url) return obj.url;

	return null;
}

export interface SubmitFalOptions {
	apiKey: string;
	provider: FalProvider;
	input: Record<string, unknown>;
	/** 폴링 간격 ms (기본 1500) */
	pollIntervalMs?: number;
	/** 전체 타임아웃 ms (기본 5분) */
	timeoutMs?: number;
	/** 디버그 로거 */
	onLog?: (msg: string) => void;
}

/**
 * fal.ai 큐에 작업 제출 → 완료까지 폴링 → video URL 반환.
 *
 * 호출자는 timeoutMs 내에서 결과를 기다린다. 타임아웃 시 큐 작업은
 * fal.ai 측에서 계속 진행되지만 클라이언트는 에러를 받는다.
 */
export async function submitFalVideo(
	opts: SubmitFalOptions,
): Promise<FalVideoResult> {
	const endpoint = FAL_ENDPOINTS[opts.provider];
	if (!endpoint) {
		throw new Error(`Unknown fal provider: ${opts.provider}`);
	}
	if (!opts.apiKey) {
		throw new Error("FAL_KEY is required");
	}

	const headers = {
		Authorization: `Key ${opts.apiKey}`,
		"Content-Type": "application/json",
	};

	// 1. 제출
	const submitRes = await fetchWithRetry(
		`${QUEUE_BASE}/${endpoint}`,
		{
			method: "POST",
			headers,
			body: JSON.stringify(opts.input),
		},
		{ timeout: 30_000 },
	);

	if (!submitRes.ok) {
		const text = await submitRes.text();
		throw new Error(`fal submit failed: ${submitRes.status} ${text}`);
	}

	const submitJson = (await submitRes.json()) as SubmitResponse;
	const requestId = submitJson.request_id;
	if (!requestId) {
		throw new Error("fal submit returned no request_id");
	}

	const statusUrl =
		submitJson.status_url ??
		`${QUEUE_BASE}/${endpoint}/requests/${requestId}/status`;
	const responseUrl =
		submitJson.response_url ??
		`${QUEUE_BASE}/${endpoint}/requests/${requestId}`;

	// 2. 폴링
	const pollIntervalMs = Math.max(10, opts.pollIntervalMs ?? 1500);
	const timeoutMs = Math.max(100, opts.timeoutMs ?? 300_000);
	const deadline = Date.now() + timeoutMs;

	let lastStatus = "IN_QUEUE";
	while (Date.now() < deadline) {
		await sleep(pollIntervalMs);

		const statusRes = await fetchWithRetry(
			statusUrl,
			{ headers },
			{
				timeout: 15_000,
			},
		);
		if (!statusRes.ok) {
			// 일시적 장애로 보고 계속 폴링 (deadline 까지)
			opts.onLog?.(`status http ${statusRes.status}`);
			continue;
		}
		const status = (await statusRes.json()) as StatusResponse;
		lastStatus = status.status;
		opts.onLog?.(`status=${status.status} q=${status.queue_position ?? "-"}`);

		if (status.status === "COMPLETED") break;
		if (status.status === "FAILED") {
			throw new Error(
				`fal job FAILED: ${status.logs?.map((l) => l.message).join(" | ") ?? "unknown"}`,
			);
		}
	}

	if (lastStatus !== "COMPLETED") {
		throw new Error(
			`fal job timeout after ${timeoutMs}ms (last=${lastStatus})`,
		);
	}

	// 3. 결과 가져오기
	const resultRes = await fetchWithRetry(
		responseUrl,
		{ headers },
		{
			timeout: 30_000,
		},
	);
	if (!resultRes.ok) {
		throw new Error(`fal result fetch failed: ${resultRes.status}`);
	}
	const raw = (await resultRes.json()) as Record<string, unknown>;
	const videoUrl = extractVideoUrl(raw);
	if (!videoUrl) {
		throw new Error("fal result has no video URL");
	}

	return {
		video_url: videoUrl,
		request_id: requestId,
		provider: opts.provider,
		endpoint,
		raw,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Test-only export */
export const __test = { extractVideoUrl };
