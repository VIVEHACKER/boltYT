import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limit";

function makeReq(ip: string, forwarded?: string): IncomingMessage {
	return {
		headers: forwarded ? { "x-forwarded-for": forwarded } : {},
		socket: { remoteAddress: ip },
	} as unknown as IncomingMessage;
}

describe("createRateLimiter", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("한도 내 요청 모두 허용", () => {
		const check = createRateLimiter({ max: 3, windowMs: 60_000 });
		const req = makeReq("1.2.3.4");
		expect(check(req).allowed).toBe(true);
		expect(check(req).allowed).toBe(true);
		expect(check(req).allowed).toBe(true);
	});

	it("한도 초과 시 차단", () => {
		const check = createRateLimiter({ max: 2, windowMs: 60_000 });
		const req = makeReq("1.2.3.4");
		check(req);
		check(req);
		const result = check(req);
		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(0);
	});

	it("윈도우 만료 후 카운터 리셋", () => {
		const check = createRateLimiter({ max: 1, windowMs: 1000 });
		const req = makeReq("1.2.3.4");
		check(req);
		expect(check(req).allowed).toBe(false);
		vi.advanceTimersByTime(1001);
		expect(check(req).allowed).toBe(true);
	});

	it("IP별 독립적 카운터", () => {
		const check = createRateLimiter({ max: 1, windowMs: 60_000 });
		expect(check(makeReq("1.1.1.1")).allowed).toBe(true);
		expect(check(makeReq("2.2.2.2")).allowed).toBe(true);
		expect(check(makeReq("1.1.1.1")).allowed).toBe(false); // 두 번째 호출 차단
		expect(check(makeReq("2.2.2.2")).allowed).toBe(false);
	});

	it("x-forwarded-for 헤더 우선 사용", () => {
		const check = createRateLimiter({ max: 1, windowMs: 60_000 });
		const req = makeReq("10.0.0.1", "5.5.5.5, 10.0.0.1");
		check(req);
		expect(check(req).allowed).toBe(false);
		// socket IP는 별도 추적
		expect(check(makeReq("10.0.0.1")).allowed).toBe(true);
	});

	it("remaining 카운트 정확성", () => {
		const check = createRateLimiter({ max: 5, windowMs: 60_000 });
		const req = makeReq("1.2.3.4");
		expect(check(req).remaining).toBe(4);
		expect(check(req).remaining).toBe(3);
		expect(check(req).remaining).toBe(2);
	});

	it("resetAt이 미래 시각", () => {
		const check = createRateLimiter({ max: 5, windowMs: 60_000 });
		const before = Date.now();
		const result = check(makeReq("1.2.3.4"));
		expect(result.resetAt).toBeGreaterThan(before);
	});

	it("소켓 IP fallback — remoteAddress 사용", () => {
		const check = createRateLimiter({ max: 1, windowMs: 60_000 });
		const req = {
			headers: {},
			socket: { remoteAddress: "7.7.7.7" },
		} as unknown as IncomingMessage;
		check(req);
		expect(check(req).allowed).toBe(false);
	});

	it("unknown IP fallback — 헤더/소켓 모두 없음", () => {
		const check = createRateLimiter({ max: 1, windowMs: 60_000 });
		const req = { headers: {}, socket: {} } as unknown as IncomingMessage;
		check(req);
		expect(check(req).allowed).toBe(false);
	});

	it("5분 setInterval cleanup — 만료 엔트리 삭제", () => {
		const check = createRateLimiter({ max: 10, windowMs: 1000 });
		const req = makeReq("1.2.3.4");
		check(req);
		// 윈도우 만료 후 cleanup 인터벌 실행 → 엔트리 제거
		vi.advanceTimersByTime(1001);
		vi.advanceTimersByTime(300_000);
		// cleanup 후 새 엔트리 생성 → remaining=9
		expect(check(req).remaining).toBe(9);
	});

	it("5분 cleanup — 아직 만료 안 된 엔트리는 유지", () => {
		const check = createRateLimiter({ max: 10, windowMs: 600_000 });
		const req = makeReq("9.9.9.9");
		check(req);
		// 인터벌 실행 시점에 윈도우 아직 유효 → 엔트리 보존
		vi.advanceTimersByTime(300_000);
		// 엔트리가 살아있으므로 remaining=8
		expect(check(req).remaining).toBe(8);
	});
});
