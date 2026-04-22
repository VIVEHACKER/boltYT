/**
 * 엔드포인트 비용 티어별 rate-limit.
 *
 * costly(ai): 분당 30 — OpenAI/ElevenLabs 등 사용당 $$$
 * heavy(scrape): 분당 20 — 외부 사이트 스크래핑
 * standard(api): 분당 120 — 일반 검색/조회
 * lightweight: 분당 300 — 텔레메트리 등 사용자 이벤트 배치
 */

import { counter } from "./metrics.ts";
import { createRateLimiter } from "./rate-limit.ts";

export type LimiterTier = "lightweight" | "standard" | "costly" | "heavy";

const LIMITS: Record<LimiterTier, { max: number }> = {
	lightweight: { max: 300 },
	standard: { max: 120 },
	costly: { max: 30 },
	heavy: { max: 20 },
};

export interface TieredLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt: number;
	tier: LimiterTier;
}

export function createTieredRateLimit(service: string) {
	const checkers: Record<
		LimiterTier,
		(req: import("node:http").IncomingMessage) => {
			allowed: boolean;
			remaining: number;
			resetAt: number;
		}
	> = {
		lightweight: createRateLimiter({
			windowMs: 60_000,
			max: LIMITS.lightweight.max,
		}),
		standard: createRateLimiter({ windowMs: 60_000, max: LIMITS.standard.max }),
		costly: createRateLimiter({ windowMs: 60_000, max: LIMITS.costly.max }),
		heavy: createRateLimiter({ windowMs: 60_000, max: LIMITS.heavy.max }),
	};

	return {
		check(
			tier: LimiterTier,
			req: import("node:http").IncomingMessage,
		): TieredLimitResult {
			const r = checkers[tier](req);
			if (!r.allowed) {
				counter("rate_limit_rejected_total", { service, tier });
			}
			return { ...r, tier };
		},
	};
}

/**
 * 경로 → 티어 기본 매핑. 서비스마다 override 가능.
 * bypass 반환 시 rate-limit 자체 적용 안 함 (health/metrics/errors).
 */
export function defaultTierForPath(pathname: string): LimiterTier | "bypass" {
	if (
		pathname === "/health" ||
		pathname === "/api/metrics" ||
		pathname === "/api/errors"
	) {
		return "bypass";
	}
	if (
		pathname.startsWith("/api/openai/") ||
		pathname.startsWith("/api/elevenlabs/")
	) {
		return "costly";
	}
	if (pathname === "/api/fetch-article") return "heavy";
	if (pathname === "/api/telemetry") return "lightweight";
	return "standard";
}
