import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupGracefulShutdown } from "./shutdown";

function makeServer() {
	return {
		close: vi.fn((cb?: () => void) => cb?.()),
	} as unknown as Server;
}

afterEach(() => {
	// 프로세스에 등록된 임시 리스너 정리
	process.removeAllListeners("SIGTERM");
	process.removeAllListeners("SIGINT");
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("setupGracefulShutdown", () => {
	it("SIGTERM 수신 → server.close 호출", async () => {
		const server = makeServer();
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		vi.useFakeTimers();

		setupGracefulShutdown(server, "test-svc");
		process.emit("SIGTERM");
		await Promise.resolve();

		expect(server.close).toHaveBeenCalled();
	});

	it("SIGINT 수신 → server.close 호출", async () => {
		const server = makeServer();
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		vi.useFakeTimers();

		setupGracefulShutdown(server, "test-svc");
		process.emit("SIGINT");
		await Promise.resolve();

		expect(server.close).toHaveBeenCalled();
	});

	it("cleanup 함수 호출", async () => {
		const server = makeServer();
		const cleanup = vi.fn().mockResolvedValue(undefined);
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		vi.useFakeTimers();

		setupGracefulShutdown(server, "test-svc", cleanup);
		process.emit("SIGTERM");
		await vi.runAllTimersAsync();

		expect(cleanup).toHaveBeenCalled();
	});

	it("중복 신호 → 한 번만 처리", async () => {
		const server = makeServer();
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		vi.useFakeTimers();

		setupGracefulShutdown(server, "test-svc");
		process.emit("SIGTERM");
		process.emit("SIGTERM");
		await Promise.resolve();

		expect(server.close).toHaveBeenCalledTimes(1);
	});

	it("10초 후 강제 종료", async () => {
		const server = makeServer();
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		vi.useFakeTimers();

		setupGracefulShutdown(server, "test-svc");
		process.emit("SIGTERM");
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(10_001);

		expect(exitSpy).toHaveBeenCalledWith(1);
	});

	it("cleanup 오류는 무시 (no throw)", async () => {
		const server = makeServer();
		const cleanup = vi.fn().mockRejectedValue(new Error("cleanup fail"));
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		vi.useFakeTimers();

		setupGracefulShutdown(server, "test-svc", cleanup);
		process.emit("SIGTERM");
		await vi.runAllTimersAsync();

		expect(server.close).toHaveBeenCalled();
	});
});
