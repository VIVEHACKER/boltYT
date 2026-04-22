/**
 * Graceful shutdown — SIGTERM/SIGINT 핸들러
 */

import type { Server } from "node:http";

export function setupGracefulShutdown(
	server: Server,
	service: string,
	cleanup?: () => Promise<void> | void,
) {
	let shuttingDown = false;

	async function shutdown(signal: string) {
		if (shuttingDown) return;
		shuttingDown = true;

		process.stderr.write(
			`${JSON.stringify({
				ts: new Date().toISOString(),
				level: "info",
				service,
				msg: `${signal} received, shutting down gracefully`,
			})}\n`,
		);

		// 새 요청 거부
		server.close(() => {
			process.stderr.write(
				`${JSON.stringify({
					ts: new Date().toISOString(),
					level: "info",
					service,
					msg: "Server closed",
				})}\n`,
			);
		});

		try {
			if (cleanup) await cleanup();
		} catch {
			// cleanup 실패는 무시
		}

		// 기존 연결 종료 대기 (최대 10초)
		setTimeout(() => {
			process.stderr.write(
				`${JSON.stringify({
					ts: new Date().toISOString(),
					level: "warn",
					service,
					msg: "Forced shutdown after timeout",
				})}\n`,
			);
			process.exit(1);
		}, 10_000).unref();
	}

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
}
