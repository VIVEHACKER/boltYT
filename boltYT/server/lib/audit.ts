/**
 * @AX:ANCHOR 감사 로그 (민감 액션)
 * @AX:REASON DIAG 명령, 에이전트 실행, 키 재로드, 파괴적 조작 → 누가/언제/무엇/결과 기록.
 *
 * 저장: 구조화 JSON 로그(stderr) + errors-buffer(audit 레벨 태그) 둘 다.
 * 파일 영속은 범위 밖(operational log 수집은 Phase 11 메트릭+버퍼로 충분).
 */

import { recordError } from "./errors-buffer.ts";
import { counter } from "./metrics.ts";

export interface AuditEntry {
	actor: string; // 호출자 IP 또는 토큰 해시 (식별 가능한 최소 정보)
	action: string; // 동사형: "reload-env" | "clear-cache" | "run-agent" ...
	resource?: string; // 대상 (target cache name 등)
	outcome: "ok" | "error" | "denied";
	service: string;
	details?: Record<string, unknown>;
}

export function recordAudit(entry: AuditEntry): void {
	const ts = new Date().toISOString();
	const line = {
		ts,
		level: "info",
		audit: true,
		service: entry.service,
		actor: entry.actor,
		action: entry.action,
		resource: entry.resource,
		outcome: entry.outcome,
		...(entry.details ?? {}),
	};
	process.stderr.write(`${JSON.stringify(line)}\n`);
	counter("audit_events_total", {
		service: entry.service,
		action: entry.action,
		outcome: entry.outcome,
	});
	if (entry.outcome === "denied") {
		recordError({
			service: entry.service,
			source: "server",
			level: "warn",
			message: `audit denied: ${entry.action}${entry.resource ? ` (${entry.resource})` : ""}`,
			context: {
				actor: entry.actor,
				action: entry.action,
				details: entry.details,
			},
		});
	}
}

export function actorFromReq(req: import("node:http").IncomingMessage): string {
	const forwarded = req.headers["x-forwarded-for"];
	const ip =
		(typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "") ||
		req.socket.remoteAddress ||
		"unknown";
	return ip;
}
