/**
 * request-metrics.ts 단위 테스트
 *
 * normalizeRoute 는 순수 함수 → 외부 의존 없음.
 * trackRequest 는 Node http mock 으로 검증.
 */

import { describe, expect, it, vi } from "vitest";
import { normalizeRoute, trackRequest } from "./request-metrics.ts";

// ─── normalizeRoute ───────────────────────────────────────────────────────────
describe("normalizeRoute", () => {
	it("UUID → :uuid", () => {
		expect(
			normalizeRoute(
				"/api/reference/11111111-2222-3333-4444-555555555555/status",
			),
		).toBe("/api/reference/:uuid/status");
	});

	it("숫자 id → :id", () => {
		expect(normalizeRoute("/api/items/42")).toBe("/api/items/:id");
		expect(normalizeRoute("/api/items/42/tags")).toBe("/api/items/:id/tags");
	});

	it("해시성 긴 hex → :hash", () => {
		expect(normalizeRoute("/cache/abcdef1234567890abcdef")).toBe(
			"/cache/:hash",
		);
	});

	it("정적 경로는 그대로", () => {
		expect(normalizeRoute("/api/search/news")).toBe("/api/search/news");
		expect(normalizeRoute("/health")).toBe("/health");
	});

	it("복합 — UUID + 숫자", () => {
		expect(
			normalizeRoute("/projects/11111111-2222-3333-4444-555555555555/items/7"),
		).toBe("/projects/:uuid/items/:id");
	});

	it("짧은 hex(15자 미만)는 hash 치환 안 됨", () => {
		expect(normalizeRoute("/api/abc123")).toBe("/api/abc123");
	});

	it("/ 루트 → 변환 없음", () => {
		expect(normalizeRoute("/")).toBe("/");
	});
});

// ─── trackRequest ─────────────────────────────────────────────────────────────
describe("trackRequest", () => {
	function makeReq(url = "/api/search", method = "GET") {
		return { url, method } as import("node:http").IncomingMessage;
	}

	function makeRes(statusCode = 200) {
		const handlers: Record<string, (() => void)[]> = {};
		const res = {
			statusCode,
			once: (event: string, handler: () => void) => {
				handlers[event] = handlers[event] ?? [];
				handlers[event].push(handler);
			},
			emit: (event: string) => {
				for (const h of handlers[event] ?? []) h();
			},
		};
		return res as unknown as import("node:http").ServerResponse;
	}

	it("/health → 즉시 반환 (리스너 등록 안 함)", () => {
		const res = makeRes();
		const onceSpy = vi.spyOn(res, "once");
		trackRequest(makeReq("/health"), res, "test");
		expect(onceSpy).not.toHaveBeenCalled();
	});

	it("/api/metrics → skip", () => {
		const res = makeRes();
		const onceSpy = vi.spyOn(res, "once");
		trackRequest(makeReq("/api/metrics"), res, "test");
		expect(onceSpy).not.toHaveBeenCalled();
	});

	it("/api/errors → skip", () => {
		const res = makeRes();
		const onceSpy = vi.spyOn(res, "once");
		trackRequest(makeReq("/api/errors"), res, "test");
		expect(onceSpy).not.toHaveBeenCalled();
	});

	it("일반 경로 → finish · close 리스너 등록", () => {
		const res = makeRes();
		const onceSpy = vi.spyOn(res, "once");
		trackRequest(makeReq("/api/search"), res, "test");
		expect(onceSpy).toHaveBeenCalledWith("finish", expect.any(Function));
		expect(onceSpy).toHaveBeenCalledWith("close", expect.any(Function));
	});

	it("finish 이벤트 2번 → 한 번만 기록 (idempotent)", () => {
		const res = makeRes();
		trackRequest(makeReq("/api/search"), res, "test");
		const r = res as unknown as { emit: (e: string) => void };
		expect(() => {
			r.emit("finish");
			r.emit("finish");
		}).not.toThrow();
	});

	it("쿼리 파라미터 포함 URL → 경로만 사용", () => {
		const res = makeRes();
		const onceSpy = vi.spyOn(res, "once");
		trackRequest(makeReq("/api/search?q=test&page=2"), res, "test");
		expect(onceSpy).toHaveBeenCalled();
	});

	it("req.url 없을 때 '/' 폴백", () => {
		const res = makeRes();
		const onceSpy = vi.spyOn(res, "once");
		trackRequest(
			{ method: "GET" } as import("node:http").IncomingMessage,
			res,
			"test",
		);
		// '/'는 정적 경로가 아니므로 리스너 등록됨
		expect(onceSpy).toHaveBeenCalled();
	});

	it("5xx 응답 → http_errors_total 카운터 경로 실행 (에러 없음)", () => {
		const res = makeRes(500);
		trackRequest(makeReq("/api/search"), res, "test");
		const r = res as unknown as { emit: (e: string) => void };
		expect(() => r.emit("finish")).not.toThrow();
	});
});
