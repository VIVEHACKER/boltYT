/**
 * diag.ts 단위 테스트
 *
 * checkServer: fetch 의존 → vi.stubGlobal
 * createCommandRegistry / runCommand: 순수 로직 + CommandContext mock
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.ts", () => ({ loadEnv: vi.fn() }));

import { checkServer, createCommandRegistry, runCommand } from "./diag.ts";

afterEach(() => vi.restoreAllMocks());

// ─── checkServer ──────────────────────────────────────────────────────────────
describe("checkServer", () => {
	it("성공 응답 → ok true, statusCode 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200 }),
		);
		const result = await checkServer("test-server", 3456);
		expect(result.ok).toBe(true);
		expect(result.statusCode).toBe(200);
		expect(result.name).toBe("test-server");
		expect(result.port).toBe(3456);
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("HTTP 오류 응답 → ok false", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 503 }),
		);
		const result = await checkServer("bad-server", 9999);
		expect(result.ok).toBe(false);
		expect(result.statusCode).toBe(503);
	});

	it("네트워크 오류 → ok false, error 메시지 포함", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("connection refused")),
		);
		const result = await checkServer("down-server", 1234);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("connection refused");
	});
});

// ─── createCommandRegistry ────────────────────────────────────────────────────
describe("createCommandRegistry", () => {
	it("reload-env 명령 존재", () => {
		const reg = createCommandRegistry();
		expect(reg).toHaveProperty("reload-env");
	});

	it("clear-cache 명령 존재", () => {
		const reg = createCommandRegistry();
		expect(reg).toHaveProperty("clear-cache");
	});

	it("ping-servers 명령 존재", () => {
		const reg = createCommandRegistry();
		expect(reg).toHaveProperty("ping-servers");
	});

	it("check-keys 명령 존재", () => {
		const reg = createCommandRegistry();
		expect(reg).toHaveProperty("check-keys");
	});
});

// ─── runCommand ────────────────────────────────────────────────────────────────
describe("runCommand", () => {
	const ctx = {
		clearCache: vi.fn(() => 5),
		reloadKeys: vi.fn(() => ["OPENAI_KEY", "NAVER_KEY"]),
	};

	it("미등록 명령 → ok false", async () => {
		const reg = createCommandRegistry();
		const result = await runCommand(reg, "unknown-cmd", {}, ctx);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("등록되지 않은 명령");
	});

	it("reload-env → ok true", async () => {
		const reg = createCommandRegistry();
		const result = await runCommand(reg, "reload-env", {}, ctx);
		expect(result.ok).toBe(true);
	});

	it("clear-cache (target 없음) → ok true, cleared 반환", async () => {
		const reg = createCommandRegistry();
		const result = await runCommand(reg, "clear-cache", {}, ctx);
		expect(result.ok).toBe(true);
		expect((result.data as { cleared: number }).cleared).toBe(5);
	});

	it("clear-cache (target 있음) → message에 target 포함", async () => {
		const reg = createCommandRegistry();
		const result = await runCommand(
			reg,
			"clear-cache",
			{ target: "search" },
			ctx,
		);
		expect(result.ok).toBe(true);
		expect(result.message).toContain("search");
	});

	it("check-keys → configured 배열 반환", async () => {
		const reg = createCommandRegistry();
		const result = await runCommand(reg, "check-keys", {}, ctx);
		expect(result.ok).toBe(true);
		expect((result.data as { configured: string[] }).configured).toContain(
			"OPENAI_KEY",
		);
	});

	it("핸들러 throw → ok false, error 메시지 반환", async () => {
		const reg: Record<string, () => never> = {
			"bad-cmd": () => {
				throw new Error("명령 실패");
			},
		};
		const result = await runCommand(
			reg as Parameters<typeof runCommand>[0],
			"bad-cmd",
			{},
			ctx,
		);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("명령 실패");
	});

	it("ping-servers — 모두 정상이면 ok true", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200 }),
		);
		const reg = createCommandRegistry();
		const result = await runCommand(reg, "ping-servers", {}, ctx);
		expect(result.ok).toBe(true);
		expect(result.message).toContain("4개 서버 모두 정상");
	});

	it("ping-servers — 일부 서버 다운이면 ok false", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockRejectedValueOnce(new Error("connection refused"))
				.mockResolvedValue({ ok: true, status: 200 }),
		);
		const reg = createCommandRegistry();
		const result = await runCommand(reg, "ping-servers", {}, ctx);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("미응답");
	});
});
