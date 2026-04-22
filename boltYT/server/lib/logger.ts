/**
 * 구조화된 JSON 로거 — 프로덕션 로깅
 *
 * 출력: JSON Lines → stderr (stdout은 응답 전용)
 * 레벨: debug < info < warn < error
 * warn/error 는 자동으로 errors-buffer 에 ring 기록 → /api/errors 에서 조회.
 */

import { recordError } from "./errors-buffer.ts";
import { maskObject, maskSecrets } from "./mask.ts";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function shouldLog(level: LogLevel): boolean {
	return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function write(
	level: LogLevel,
	service: string,
	msg: string,
	extra?: Record<string, unknown>,
) {
	if (!shouldLog(level)) return;
	const safeExtra = extra ? maskObject(extra) : undefined;
	const entry = {
		ts: new Date().toISOString(),
		level,
		service,
		msg: maskSecrets(msg),
		...safeExtra,
	};
	process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function stackOf(extra?: Record<string, unknown>): string | undefined {
	const s = extra?.stack;
	return typeof s === "string" ? s : undefined;
}

export function createLogger(service: string) {
	return {
		debug: (msg: string, extra?: Record<string, unknown>) =>
			write("debug", service, msg, extra),
		info: (msg: string, extra?: Record<string, unknown>) =>
			write("info", service, msg, extra),
		warn: (msg: string, extra?: Record<string, unknown>) => {
			write("warn", service, msg, extra);
			const safe = extra
				? (maskObject(extra) as Record<string, unknown>)
				: undefined;
			recordError({
				service,
				source: "server",
				level: "warn",
				message: maskSecrets(msg),
				stack: stackOf(safe),
				context: safe,
			});
		},
		error: (msg: string, extra?: Record<string, unknown>) => {
			write("error", service, msg, extra);
			const safe = extra
				? (maskObject(extra) as Record<string, unknown>)
				: undefined;
			recordError({
				service,
				source: "server",
				level: "error",
				message: maskSecrets(msg),
				stack: stackOf(safe),
				context: safe,
			});
		},
	};
}
