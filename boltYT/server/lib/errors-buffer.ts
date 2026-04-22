/**
 * @AX:ANCHOR 서버측 에러 ring buffer (최근 200)
 * @AX:REASON /api/errors, 대시보드, 테스트, 클라 telemetry 싱크가 공통 사용.
 */

export type ErrorSource = "server" | "client";
export type ErrorLevel = "error" | "warn";

export interface ErrorRecord {
	id: string;
	ts: number;
	service: string;
	source: ErrorSource;
	level: ErrorLevel;
	message: string;
	stack?: string;
	url?: string;
	status?: number;
	context?: Record<string, unknown>;
}

const MAX = 200;
const buffer: ErrorRecord[] = [];

function randomId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function recordError(
	input: Omit<ErrorRecord, "id" | "ts"> & { ts?: number },
): ErrorRecord {
	const record: ErrorRecord = {
		...input,
		id: randomId(),
		ts: input.ts ?? Date.now(),
	};
	buffer.unshift(record);
	if (buffer.length > MAX) buffer.length = MAX;
	return record;
}

export interface ErrorFilter {
	service?: string;
	source?: ErrorSource;
	level?: ErrorLevel;
	since?: number;
	limit?: number;
}

export function listErrors(filter: ErrorFilter = {}): ErrorRecord[] {
	const { service, source, level, since, limit = MAX } = filter;
	const out: ErrorRecord[] = [];
	for (const r of buffer) {
		if (service && r.service !== service) continue;
		if (source && r.source !== source) continue;
		if (level && r.level !== level) continue;
		if (since !== undefined && r.ts < since) continue;
		out.push(r);
		if (out.length >= limit) break;
	}
	return out;
}

export function clearErrors(): void {
	buffer.length = 0;
}

export function countErrors(): number {
	return buffer.length;
}

export const MAX_ERRORS = MAX;
