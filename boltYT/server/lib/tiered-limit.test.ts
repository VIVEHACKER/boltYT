/**
 * tiered-limit.ts 단위 테스트
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("./metrics.ts", () => ({ counter: vi.fn() }));
vi.mock("./rate-limit.ts", () => ({
	createRateLimiter: vi.fn(() =>
		vi.fn(() => ({
			allowed: true,
			remaining: 10,
			resetAt: Date.now() + 60000,
		})),
	),
}));

import { counter } from "./metrics.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createTieredRateLimit, defaultTierForPath } from "./tiered-limit.ts";

describe("defaultTierForPath", () => {
	it("/health → bypass", () => {
		expect(defaultTierForPath("/health")).toBe("bypass");
	});

	it("/api/metrics → bypass", () => {
		expect(defaultTierForPath("/api/metrics")).toBe("bypass");
	});

	it("/api/errors → bypass", () => {
		expect(defaultTierForPath("/api/errors")).toBe("bypass");
	});

	it("/api/openai/* → costly", () => {
		expect(defaultTierForPath("/api/openai/chat")).toBe("costly");
		expect(defaultTierForPath("/api/openai/tts")).toBe("costly");
	});

	it("/api/elevenlabs/* → costly", () => {
		expect(defaultTierForPath("/api/elevenlabs/tts")).toBe("costly");
	});

	it("/api/fetch-article → heavy", () => {
		expect(defaultTierForPath("/api/fetch-article")).toBe("heavy");
	});

	it("/api/telemetry → lightweight", () => {
		expect(defaultTierForPath("/api/telemetry")).toBe("lightweight");
	});

	it("기타 경로 → standard", () => {
		expect(defaultTierForPath("/api/search")).toBe("standard");
		expect(defaultTierForPath("/api/videos")).toBe("standard");
		expect(defaultTierForPath("/unknown")).toBe("standard");
	});
});

// ─── createTieredRateLimit ────────────────────────────────────────────────────
describe("createTieredRateLimit", () => {
	it("check allowed → tier 포함 반환", () => {
		const limiter = createTieredRateLimit("test-service");
		const req = {} as import("node:http").IncomingMessage;
		const result = limiter.check("standard", req);
		expect(result.tier).toBe("standard");
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(10);
	});

	it("check not allowed → counter 호출", () => {
		vi.mocked(createRateLimiter).mockReturnValue(
			vi.fn(() => ({
				allowed: false,
				remaining: 0,
				resetAt: Date.now() + 1000,
			})),
		);
		const limiter = createTieredRateLimit("svc");
		const req = {} as import("node:http").IncomingMessage;
		limiter.check("costly", req);
		expect(vi.mocked(counter)).toHaveBeenCalledWith(
			"rate_limit_rejected_total",
			{ service: "svc", tier: "costly" },
		);
	});

	it("4개 tier 모두 체커 생성 (4회 호출)", () => {
		vi.mocked(createRateLimiter).mockClear();
		createTieredRateLimit("svc2");
		expect(vi.mocked(createRateLimiter)).toHaveBeenCalledTimes(4);
	});
});
