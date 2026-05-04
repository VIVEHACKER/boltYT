/**
 * Diagnostics & command pipeline (서버측)
 *
 * - 상태: 모든 키/서버/캐시 상태를 한 번에 조회
 * - 명령: 화이트리스트 기반. 자유 실행 금지 (보안).
 */

import { loadEnv } from "./env.ts";

export interface ServerHealth {
	name: string;
	port: number;
	url: string;
	ok: boolean;
	statusCode?: number;
	error?: string;
	latencyMs?: number;
}

export interface DiagHealthReport {
	timestamp: string;
	apiProxy: {
		uptimeSeconds: number;
		startedAt: string;
		rateLimitRemaining?: number;
	};
	keys: {
		configured: string[];
		missing: string[];
	};
	servers: ServerHealth[];
	caches: Record<string, { size?: number; hits?: number }>;
}

export async function checkServer(
	name: string,
	port: number,
	timeoutMs = 2000,
): Promise<ServerHealth> {
	const url = `http://localhost:${port}/health`;
	const start = Date.now();
	try {
		const controller = new AbortController();
		const t = setTimeout(() => controller.abort(), timeoutMs);
		const res = await fetch(url, { signal: controller.signal }).finally(() =>
			clearTimeout(t),
		);
		return {
			name,
			port,
			url,
			ok: res.ok,
			statusCode: res.status,
			latencyMs: Date.now() - start,
		};
	} catch (err) {
		return {
			name,
			port,
			url,
			ok: false,
			error: err instanceof Error ? err.message : "unknown",
			latencyMs: Date.now() - start,
		};
	}
}

// ─── 명령 레지스트리 ───

export interface CommandContext {
	clearCache: (name?: string) => number;
	reloadKeys: () => string[];
}

export interface CommandResult {
	ok: boolean;
	message: string;
	data?: unknown;
}

export type CommandHandler = (
	args: Record<string, unknown>,
	ctx: CommandContext,
) => Promise<CommandResult> | CommandResult;

/** 화이트리스트 — 이 셋 밖의 명령은 거부 */
export function createCommandRegistry(): Record<string, CommandHandler> {
	return {
		"reload-env": async (_args, ctx) => {
			loadEnv();
			const configured = ctx.reloadKeys();
			return {
				ok: true,
				message: ".env 다시 읽음, 키 재로드 완료",
				data: { configured },
			};
		},

		"clear-cache": (args, ctx) => {
			const target = typeof args?.target === "string" ? args.target : undefined;
			const cleared = ctx.clearCache(target);
			return {
				ok: true,
				message: `${cleared}개 캐시 엔트리 삭제${target ? ` (target: ${target})` : ""}`,
				data: { cleared },
			};
		},

		"ping-servers": async () => {
			const results = await Promise.all([
				checkServer("video-proxy", 3456),
				checkServer("youtube-upload", 3457),
				checkServer("render-queue", 3458),
				checkServer("api-proxy", 3459),
				checkServer("tiktok-upload", 3461),
				checkServer("instagram-upload", 3462),
			]);
			const down = results.filter((r) => !r.ok);
			return {
				ok: down.length === 0,
				message:
					down.length === 0
						? "6개 서버 모두 정상"
						: `${down.length}개 서버 미응답: ${down.map((r) => r.name).join(", ")}`,
				data: { results },
			};
		},

		"check-keys": (_args, ctx) => {
			const configured = ctx.reloadKeys();
			return {
				ok: true,
				message: `${configured.length}개 키 활성`,
				data: { configured },
			};
		},
	};
}

/** 명령 실행 — 미등록이면 거부 */
export async function runCommand(
	registry: Record<string, CommandHandler>,
	name: string,
	args: Record<string, unknown>,
	ctx: CommandContext,
): Promise<CommandResult> {
	const handler = registry[name];
	if (!handler) {
		return {
			ok: false,
			message: `등록되지 않은 명령: ${name}. 사용 가능: ${Object.keys(registry).join(", ")}`,
		};
	}
	try {
		return await handler(args, ctx);
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : "명령 실행 실패",
		};
	}
}
