/**
 * Diagnostics pipeline (클라이언트측)
 *
 * - 전역 에러 싱크 (window error, unhandledrejection, fetch 4xx/5xx)
 * - 서버 진단 호출 (/api/diag/health, /api/diag/command)
 * - 자연어 오더 파서 — 간단한 키워드 매핑
 */

import { getApiProxyUrl } from "./proxy";
import { installTelemetryFlushers, queueTelemetry } from "./telemetry-sink";

const isDev = import.meta.env.DEV;
const dbg = isDev ? console.log.bind(console) : () => {};

// ─── 타입 ───

export interface DiagError {
	id: string;
	timestamp: number;
	source: "window" | "unhandledrejection" | "fetch" | "manual";
	message: string;
	detail?: string;
	url?: string;
	status?: number;
}

export interface CommandResult {
	ok: boolean;
	message: string;
	data?: unknown;
}

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
	apiProxy: { uptimeSeconds: number; startedAt: string };
	keys: { configured: string[]; missing: string[] };
	servers: ServerHealth[];
	caches: Record<string, { size?: number }>;
}

// ─── 에러 싱크 (모듈 싱글톤) ───

const listeners = new Set<(e: DiagError) => void>();
const errors: DiagError[] = [];
const MAX_ERRORS = 200;

function push(error: DiagError) {
	errors.unshift(error);
	if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;
	for (const l of listeners) l(error);
	// 서버 에러 버퍼로도 업로드 (beacon 배치)
	queueTelemetry({
		service: "browser",
		level: error.source === "fetch" && !error.status ? "warn" : "error",
		message: error.message,
		stack: error.detail,
		url: error.url,
		status: error.status,
	});
}

export function subscribeErrors(cb: (e: DiagError) => void): () => void {
	listeners.add(cb);
	return () => {
		listeners.delete(cb);
	};
}

export function listErrors(): DiagError[] {
	return errors.slice();
}

export function clearErrors(): void {
	errors.length = 0;
}

export function reportError(
	message: string,
	detail?: string,
	extra: Partial<DiagError> = {},
): DiagError {
	const err: DiagError = {
		id: crypto.randomUUID(),
		timestamp: Date.now(),
		source: extra.source ?? "manual",
		message,
		detail,
		url: extra.url,
		status: extra.status,
	};
	push(err);
	return err;
}

let installed = false;

/** 전역 에러 캡처 — App 부팅 시 1회 호출 */
export function installErrorSink(): void {
	if (installed) return;
	installed = true;

	installTelemetryFlushers();

	window.addEventListener("error", (e) => {
		push({
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			source: "window",
			message: e.message,
			detail: e.error?.stack,
			url: e.filename,
		});
	});

	window.addEventListener("unhandledrejection", (e) => {
		const reason = e.reason;
		const message =
			reason instanceof Error
				? reason.message
				: typeof reason === "string"
					? reason
					: "Unhandled promise rejection";
		push({
			id: crypto.randomUUID(),
			timestamp: Date.now(),
			source: "unhandledrejection",
			message,
			detail: reason instanceof Error ? reason.stack : JSON.stringify(reason),
		});
	});

	// fetch wrapper — 4xx/5xx 자동 수집 (본문은 스킵, URL만)
	const origFetch = window.fetch.bind(window);
	window.fetch = async (...args: Parameters<typeof fetch>) => {
		try {
			const res = await origFetch(...args);
			if (!res.ok && res.status >= 400) {
				const url =
					typeof args[0] === "string"
						? args[0]
						: args[0] instanceof URL
							? args[0].toString()
							: args[0].url;
				push({
					id: crypto.randomUUID(),
					timestamp: Date.now(),
					source: "fetch",
					message: `${res.status} ${res.statusText}`,
					url,
					status: res.status,
				});
			}
			return res;
		} catch (err) {
			const url =
				typeof args[0] === "string"
					? args[0]
					: args[0] instanceof URL
						? args[0].toString()
						: args[0].url;
			push({
				id: crypto.randomUUID(),
				timestamp: Date.now(),
				source: "fetch",
				message: err instanceof Error ? err.message : "fetch failed",
				url,
			});
			throw err;
		}
	};
}

// ─── 서버 호출 ───

function diagHeaders(): Record<string, string> {
	const token = localStorage.getItem("diag_token") ?? "";
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) headers["X-Diag-Token"] = token;
	return headers;
}

export async function getHealth(): Promise<DiagHealthReport | null> {
	try {
		const res = await fetch(`${getApiProxyUrl()}/api/diag/health`, {
			headers: diagHeaders(),
			signal: AbortSignal.timeout(5_000),
		});
		if (!res.ok) return null;
		return (await res.json()) as DiagHealthReport;
	} catch {
		return null;
	}
}

// ─── 메트릭/에러 버퍼 조회 ───

export interface MetricsHistogram {
	key: string;
	count: number;
	mean: number;
	p50: number;
	p95: number;
	p99: number;
	min: number;
	max: number;
}

export interface MetricsSnapshot {
	ts: number;
	counters: Array<{ key: string; value: number }>;
	histograms: MetricsHistogram[];
	gauges: Array<{ key: string; value: number }>;
}

export async function getMetrics(): Promise<MetricsSnapshot | null> {
	try {
		const res = await fetch(`${getApiProxyUrl()}/api/metrics`, {
			headers: diagHeaders(),
			signal: AbortSignal.timeout(5_000),
		});
		if (!res.ok) return null;
		return (await res.json()) as MetricsSnapshot;
	} catch {
		return null;
	}
}

export interface ServerErrorRecord {
	id: string;
	ts: number;
	service: string;
	source: "server" | "client";
	level: "error" | "warn";
	message: string;
	stack?: string;
	url?: string;
	status?: number;
	context?: Record<string, unknown>;
}

export async function getServerErrors(
	opts: {
		service?: string;
		source?: "server" | "client";
		level?: "error" | "warn";
		limit?: number;
	} = {},
): Promise<ServerErrorRecord[]> {
	const params = new URLSearchParams();
	if (opts.service) params.set("service", opts.service);
	if (opts.source) params.set("source", opts.source);
	if (opts.level) params.set("level", opts.level);
	if (opts.limit) params.set("limit", String(opts.limit));
	const qs = params.toString() ? `?${params.toString()}` : "";
	try {
		const res = await fetch(`${getApiProxyUrl()}/api/errors${qs}`, {
			headers: diagHeaders(),
			signal: AbortSignal.timeout(5_000),
		});
		if (!res.ok) return [];
		const data = (await res.json()) as { errors?: ServerErrorRecord[] };
		return data.errors ?? [];
	} catch {
		return [];
	}
}

export async function clearServerErrors(): Promise<boolean> {
	try {
		const res = await fetch(`${getApiProxyUrl()}/api/errors`, {
			method: "DELETE",
			headers: diagHeaders(),
			signal: AbortSignal.timeout(5_000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

// ─── Agent 호출 ───

export type AgentTraceStep =
	| { kind: "think"; content: string }
	| {
			kind: "tool";
			name: string;
			args: Record<string, unknown>;
			result: CommandResult | DiagHealthReport;
	  }
	| { kind: "finish"; resolved: boolean; summary: string; reason: string };

export interface AgentResult {
	goal: string;
	resolved: boolean;
	summary: string;
	trace: AgentTraceStep[];
	iterations: number;
}

export async function runAgent(
	goal: string,
	maxIterations = 5,
): Promise<AgentResult | { error: string }> {
	const url = `${getApiProxyUrl()}/api/diag/agent`;
	dbg("[diag-agent-client] REQUEST", { url, goal, maxIterations });
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: diagHeaders(),
			body: JSON.stringify({ goal, maxIterations }),
			signal: AbortSignal.timeout(120_000), // 최대 2분
		});
		dbg("[diag-agent-client] RESPONSE", {
			status: res.status,
			ok: res.ok,
		});
		if (!res.ok) {
			const txt = await res.text();
			console.error("[diag-agent-client] HTTP_ERROR", {
				status: res.status,
				body: txt.slice(0, 500),
			});
			return { error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
		}
		const data = (await res.json()) as AgentResult;
		dbg("[diag-agent-client] RESULT", {
			resolved: data.resolved,
			iterations: data.iterations,
			traceSteps: data.trace?.length,
			summary: data.summary?.slice(0, 100),
		});
		return data;
	} catch (err) {
		console.error("[diag-agent-client] FETCH_ERROR", {
			error: err instanceof Error ? err.message : err,
			name: err instanceof Error ? err.name : undefined,
		});
		return {
			error: err instanceof Error ? err.message : "agent call failed",
		};
	}
}

export async function runServerCommand(
	name: string,
	args: Record<string, unknown> = {},
): Promise<CommandResult> {
	try {
		const res = await fetch(`${getApiProxyUrl()}/api/diag/command`, {
			method: "POST",
			headers: diagHeaders(),
			body: JSON.stringify({ name, args }),
			signal: AbortSignal.timeout(10_000),
		});
		return (await res.json()) as CommandResult;
	} catch (err) {
		return {
			ok: false,
			message: err instanceof Error ? err.message : "명령 실행 실패",
		};
	}
}

// ─── 자연어 오더 파서 ───
// 간단한 키워드 매핑. 복잡한 NLP 필요 없음 — 확실한 의도만 매칭.

export interface ParsedCommand {
	/** 서버 명령이면 name, 클라이언트 전용이면 `client:${action}` */
	target: string;
	args: Record<string, unknown>;
	label: string;
}

export function parseOrder(input: string): ParsedCommand | null {
	const lower = input.toLowerCase().trim();
	if (!lower) return null;

	// env/환경/키 재로드
	if (/(env|환경|\.env).*(reload|재로드|다시|갱신)/.test(lower)) {
		return { target: "reload-env", args: {}, label: ".env 재로드" };
	}
	if (/reload.*env|env.*reload/.test(lower)) {
		return { target: "reload-env", args: {}, label: ".env 재로드" };
	}

	// 캐시
	if (/(cache|캐시).*(clear|비우|삭제|clean)/.test(lower)) {
		const target = /article|기사/.test(lower)
			? "article"
			: /search|검색/.test(lower)
				? "search"
				: undefined;
		return {
			target: "clear-cache",
			args: target ? { target } : {},
			label: `캐시 비우기${target ? ` (${target})` : ""}`,
		};
	}

	// 서버 상태
	if (/(ping|상태|check|확인).*(서버|server|4|all)/.test(lower)) {
		return { target: "ping-servers", args: {}, label: "서버 상태 확인" };
	}

	// 키 상태
	if (/(키|key).*(check|확인|상태)/.test(lower)) {
		return { target: "check-keys", args: {}, label: "API 키 확인" };
	}

	// 클라이언트 전용: localStorage 청소
	if (/(localstorage|로컬.*스토리지).*(clear|비우|삭제|reset)/.test(lower)) {
		return {
			target: "client:clear-localstorage",
			args: {},
			label: "localStorage 초기화",
		};
	}

	// 클라이언트 전용: 에러 로그 클리어
	if (/(에러|error|로그).*(clear|비우|삭제)/.test(lower)) {
		return {
			target: "client:clear-errors",
			args: {},
			label: "에러 로그 비우기",
		};
	}

	return null;
}

export async function dispatchOrder(
	cmd: ParsedCommand,
): Promise<CommandResult> {
	if (cmd.target === "client:clear-localstorage") {
		try {
			localStorage.clear();
			return {
				ok: true,
				message: "localStorage 전체 삭제. 새로고침 권장.",
			};
		} catch (err) {
			return {
				ok: false,
				message: err instanceof Error ? err.message : "localStorage 삭제 실패",
			};
		}
	}
	if (cmd.target === "client:clear-errors") {
		clearErrors();
		return { ok: true, message: "에러 로그 비움" };
	}
	return runServerCommand(cmd.target, cmd.args);
}

// ─── 자동 해결 규칙 ───
// 감지된 증상 → 자동 fix 매핑. 안전한 것만 자동 실행.

export interface AutoFixRule {
	id: string;
	description: string;
	/** health 리포트를 보고 문제 존재 여부 판단 */
	matches: (report: DiagHealthReport) => boolean;
	/** 자동 실행할 명령(들) */
	commands: Array<{ target: string; args?: Record<string, unknown> }>;
}

export const AUTO_FIX_RULES: AutoFixRule[] = [
	{
		id: "missing-openai",
		description: "OpenAI 키 누락 — .env 재로드 시도",
		matches: (r) => r.keys.missing.includes("openai"),
		commands: [{ target: "reload-env" }],
	},
];

export async function runAutoFixes(
	report: DiagHealthReport,
): Promise<Array<{ rule: AutoFixRule; results: CommandResult[] }>> {
	const applied: Array<{ rule: AutoFixRule; results: CommandResult[] }> = [];
	for (const rule of AUTO_FIX_RULES) {
		if (!rule.matches(report)) continue;
		const results: CommandResult[] = [];
		for (const cmd of rule.commands) {
			results.push(await runServerCommand(cmd.target, cmd.args ?? {}));
		}
		applied.push({ rule, results });
	}
	return applied;
}
