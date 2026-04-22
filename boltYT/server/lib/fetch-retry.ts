/**
 * fetch with timeout + exponential backoff retry
 */

interface FetchRetryOpts {
	/** 타임아웃 ms (기본 30초) */
	timeout?: number;
	/** 최대 재시도 횟수 (기본 2) */
	retries?: number;
	/** 재시도할 HTTP 상태 코드 (기본 [429, 500, 502, 503, 504]) */
	retryOn?: number[];
}

const DEFAULT_RETRY_ON = [429, 500, 502, 503, 504];

export async function fetchWithRetry(
	url: string,
	init?: RequestInit,
	opts?: FetchRetryOpts,
): Promise<Response> {
	const timeout = opts?.timeout ?? 30_000;
	const maxRetries = opts?.retries ?? 2;
	const retryOn = opts?.retryOn ?? DEFAULT_RETRY_ON;

	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);

		try {
			const res = await fetch(url, {
				...init,
				signal: controller.signal,
			});

			clearTimeout(timer);

			if (!retryOn.includes(res.status) || attempt === maxRetries) {
				return res;
			}

			// 429 Retry-After 헤더 존재 시 대기
			const retryAfter = res.headers.get("retry-after");
			const delay = retryAfter
				? Math.min(Number(retryAfter) * 1000, 30_000)
				: Math.min(1000 * 2 ** attempt, 10_000);

			await sleep(delay);
		} catch (e) {
			clearTimeout(timer);
			lastError = e instanceof Error ? e : new Error(String(e));

			if (attempt === maxRetries) break;

			// 네트워크 에러/타임아웃만 재시도
			if (
				lastError.name === "AbortError" ||
				lastError.message.includes("fetch failed")
			) {
				await sleep(Math.min(1000 * 2 ** attempt, 10_000));
				continue;
			}

			throw lastError;
		}
	}

	throw lastError ?? new Error("fetch failed after retries");
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
