/**
 * Resilient Fetch — 자동 재시도 + exponential backoff
 *
 * 모든 외부 API 호출을 래핑하여 일시적 네트���크 오류를 자동 복구합니다.
 * - 429 (Rate Limit) → backoff 후 재시도
 * - 500-503 (서버 오류) → 재시도
 * - 네트워크 끊김 → 재시도
 * - 400/401/403/404 → 즉시 실패 (재시도 불가)
 */

interface RetryOptions {
	/** 최대 재시도 횟수 (기본 3) */
	maxRetries?: number;
	/** 초기 대기 시간 ms (기본 1000) */
	initialDelay?: number;
	/** 최대 대기 시간 ms (기본 10000) */
	maxDelay?: number;
	/** 재시도 가능한 상태 코드 (기본: 429, 500, 502, 503) */
	retryableStatuses?: number[];
	/** 재시도 시 호출되는 콜백 */
	onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_RETRYABLE = [429, 500, 502, 503, 504];

function isRetryable(status: number, retryableStatuses: number[]): boolean {
	return retryableStatuses.includes(status);
}

function getDelay(attempt: number, initial: number, max: number): number {
	// exponential backoff + jitter
	const exp = initial * 2 ** attempt;
	const jitter = exp * 0.2 * Math.random();
	return Math.min(exp + jitter, max);
}

/**
 * fetch() 래퍼 — 자동 재시도
 *
 * 사용법: `resilientFetch(url, init)` — `fetch(url, init)`와 동일한 시그니처
 */
export async function resilientFetch(
	input: RequestInfo | URL,
	init?: RequestInit & { retry?: RetryOptions },
): Promise<Response> {
	const opts = init?.retry ?? {};
	const maxRetries = opts.maxRetries ?? 3;
	const initialDelay = opts.initialDelay ?? 1000;
	const maxDelay = opts.maxDelay ?? 10000;
	const retryableStatuses = opts.retryableStatuses ?? DEFAULT_RETRYABLE;

	// retry 옵션은 fetch에 전달하면 안 됨
	const fetchInit = init ? { ...init } : undefined;
	if (fetchInit) delete (fetchInit as Record<string, unknown>).retry;

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const res = await fetch(input, fetchInit);

			if (res.ok || !isRetryable(res.status, retryableStatuses)) {
				return res;
			}

			// 재시도 가능한 에러
			lastError = new Error(`HTTP ${res.status}`);

			if (attempt < maxRetries) {
				const delay = getDelay(attempt, initialDelay, maxDelay);
				opts.onRetry?.(attempt + 1, lastError, delay);
				console.warn(
					`[resilient-fetch] ${res.status}, retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`,
				);
				await new Promise((r) => setTimeout(r, delay));
			}
		} catch (err) {
			// 네트워크 오류 (오프라인, DNS 실패, 타���아웃 등)
			lastError = err instanceof Error ? err : new Error("Network error");

			if (attempt < maxRetries) {
				const delay = getDelay(attempt, initialDelay, maxDelay);
				opts.onRetry?.(attempt + 1, lastError, delay);
				console.warn(
					`[resilient-fetch] Network error, retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`,
				);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}

	throw lastError ?? new Error("resilientFetch: all retries exhausted");
}

/**
 * JSON API ��출 편의 함수
 */
export async function resilientJson<T>(
	url: string,
	init?: RequestInit & { retry?: RetryOptions },
): Promise<T> {
	const res = await resilientFetch(url, init);
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`API error ${res.status}: ${body}`);
	}
	return res.json();
}
