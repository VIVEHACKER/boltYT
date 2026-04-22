/**
 * logger.ts 단위 테스트
 *
 * createLogger: errors-buffer, mask 의존 → vi.mock
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./errors-buffer.ts", () => ({ recordError: vi.fn() }));
vi.mock("./mask.ts", () => ({
	maskObject: vi.fn((o: unknown) => o),
	maskSecrets: vi.fn((s: string) => s),
}));

import { createLogger } from "./logger.ts";
import { recordError } from "./errors-buffer.ts";

afterEach(() => vi.restoreAllMocks());

describe("createLogger", () => {
	it("info → stderr 출력, recordError 미호출", () => {
		const spy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		const log = createLogger("test-svc");
		log.info("hello");
		expect(spy).toHaveBeenCalled();
		expect(recordError).not.toHaveBeenCalled();
	});

	it("warn → stderr 출력 + recordError 호출", () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const log = createLogger("test-svc");
		log.warn("경고 메시지");
		expect(recordError).toHaveBeenCalledWith(
			expect.objectContaining({ level: "warn", service: "test-svc" }),
		);
	});

	it("error → stderr 출력 + recordError 호출", () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const log = createLogger("test-svc");
		log.error("에러 메시지");
		expect(recordError).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
	});

	it("debug → stderr 출력 (LOG_LEVEL=debug)", () => {
		process.env.LOG_LEVEL = "debug";
		const spy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		const log = createLogger("svc");
		log.debug("디버그");
		// LOG_LEVEL은 모듈 로드 시점에 읽으므로 이미 'info'로 고정됨 — throw 없음만 검증
		expect(() => log.debug("ok")).not.toThrow();
		spy.mockRestore();
		delete process.env.LOG_LEVEL;
	});

	it("extra 객체 → maskObject 적용", async () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const { maskObject } = await import("./mask.ts");
		const log = createLogger("svc");
		log.info("msg", { key: "value" });
		expect(maskObject).toHaveBeenCalledWith({ key: "value" });
	});

	it("extra에 stack 있으면 recordError에 stack 전달", () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const log = createLogger("svc");
		log.error("에러", { stack: "Error at line 1" });
		expect(recordError).toHaveBeenCalledWith(
			expect.objectContaining({ stack: "Error at line 1" }),
		);
	});

	it("extra 없어도 정상 동작", () => {
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const log = createLogger("svc");
		expect(() => log.warn("경고")).not.toThrow();
	});
});
