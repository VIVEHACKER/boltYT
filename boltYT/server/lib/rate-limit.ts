/**
 * 인메모리 슬라이딩 윈도우 Rate Limiter
 */

interface RateLimitOpts {
	/** 윈도우 크기 ms (기본 60초) */
	windowMs?: number;
	/** 윈도우 내 최대 요청 수 (기본 60) */
	max?: number;
}

interface Entry {
	count: number;
	resetAt: number;
}

export function createRateLimiter(opts?: RateLimitOpts) {
	const windowMs = opts?.windowMs ?? 60_000;
	const max = opts?.max ?? 60;
	const store = new Map<string, Entry>();

	// 만료 엔트리 정리 (5분마다)
	setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			if (entry.resetAt <= now) store.delete(key);
		}
	}, 300_000).unref();

	return function check(req: import("node:http").IncomingMessage): {
		allowed: boolean;
		remaining: number;
		resetAt: number;
	} {
		const ip =
			(req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
			req.socket.remoteAddress ??
			"unknown";

		const now = Date.now();
		let entry = store.get(ip);

		if (!entry || entry.resetAt <= now) {
			entry = { count: 0, resetAt: now + windowMs };
			store.set(ip, entry);
		}

		entry.count++;

		return {
			allowed: entry.count <= max,
			remaining: Math.max(0, max - entry.count),
			resetAt: entry.resetAt,
		};
	};
}
