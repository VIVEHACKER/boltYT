import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actorFromReq, recordAudit } from "./audit.ts";
import { clearErrors, listErrors } from "./errors-buffer.ts";
import { reset as resetMetrics, snapshot } from "./metrics.ts";

describe("audit", () => {
	beforeEach(() => {
		resetMetrics();
		clearErrors();
		vi.spyOn(process.stderr, "write").mockReturnValue(true as never);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("recordAudit 메트릭 증가 + stderr 기록", () => {
		recordAudit({
			actor: "127.0.0.1",
			action: "reload-env",
			outcome: "ok",
			service: "api-proxy",
		});
		const snap = snapshot();
		const key = snap.counters.find((c) =>
			c.key.startsWith("audit_events_total|"),
		);
		expect(key?.value).toBe(1);
		expect(process.stderr.write).toHaveBeenCalled();
	});

	it("denied 결과는 errors-buffer 에도 warn 기록", () => {
		recordAudit({
			actor: "1.2.3.4",
			action: "clear-cache",
			resource: "article",
			outcome: "denied",
			service: "api-proxy",
		});
		const errs = listErrors({ level: "warn" });
		expect(errs).toHaveLength(1);
		expect(errs[0].message).toContain("clear-cache");
		expect(errs[0].message).toContain("article");
	});

	it("ok/error 결과는 errors-buffer 에 기록 안 함", () => {
		recordAudit({
			actor: "x",
			action: "ping",
			outcome: "ok",
			service: "t",
		});
		recordAudit({
			actor: "x",
			action: "ping",
			outcome: "error",
			service: "t",
		});
		expect(listErrors()).toHaveLength(0);
	});

	it("actorFromReq — x-forwarded-for 우선", () => {
		const req = {
			headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
			socket: { remoteAddress: "10.0.0.1" },
		} as unknown as import("node:http").IncomingMessage;
		expect(actorFromReq(req)).toBe("203.0.113.5");
	});

	it("actorFromReq — forwarded 없으면 socket", () => {
		const req = {
			headers: {},
			socket: { remoteAddress: "192.168.1.10" },
		} as unknown as import("node:http").IncomingMessage;
		expect(actorFromReq(req)).toBe("192.168.1.10");
	});

	it("actorFromReq — 헤더/소켓 모두 없으면 unknown", () => {
		const req = {
			headers: {},
			socket: {},
		} as unknown as import("node:http").IncomingMessage;
		expect(actorFromReq(req)).toBe("unknown");
	});

	it("denied + resource 없으면 괄호 없는 메시지", () => {
		recordAudit({
			actor: "1.2.3.4",
			action: "delete",
			outcome: "denied",
			service: "svc",
		});
		const errs = listErrors({ level: "warn" });
		expect(errs[0].message).not.toContain("(");
	});

	it("denied + details 있으면 context에 포함", () => {
		recordAudit({
			actor: "1.2.3.4",
			action: "upload",
			outcome: "denied",
			service: "svc",
			details: { reason: "quota exceeded" },
		});
		const errs = listErrors({ level: "warn" });
		expect(errs).toHaveLength(1);
	});
});
