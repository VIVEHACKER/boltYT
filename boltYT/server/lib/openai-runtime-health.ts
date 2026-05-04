import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const STATE_DIR = resolve(import.meta.dirname ?? ".", "../.tmp");
const STATE_PATH = join(STATE_DIR, "openai-runtime-health.json");
const DEFAULT_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

export interface OpenAiRuntimeHealth {
	quotaBlocked: boolean;
	quotaBlockedUntil?: string;
	lastQuotaAt?: string;
	lastQuotaSource?: string;
	lastQuotaError?: string;
	lastOkAt?: string;
}

interface StoredOpenAiRuntimeHealth {
	quotaBlockedUntilMs?: number;
	lastQuotaAt?: string;
	lastQuotaSource?: string;
	lastQuotaError?: string;
	lastOkAt?: string;
}

function readStoredHealth(): StoredOpenAiRuntimeHealth {
	try {
		if (!existsSync(STATE_PATH)) return {};
		const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as StoredOpenAiRuntimeHealth)
			: {};
	} catch {
		return {};
	}
}

function writeStoredHealth(state: StoredOpenAiRuntimeHealth) {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function quotaCooldownMs(): number {
	const raw = Number(process.env.OPENAI_QUOTA_COOLDOWN_MS);
	return Number.isFinite(raw) && raw >= 30_000 ? raw : DEFAULT_QUOTA_COOLDOWN_MS;
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return "";
	}
}

export function isOpenAiQuotaError(error: unknown): boolean {
	const text = errorText(error).toLowerCase();
	return (
		text.includes("insufficient_quota") ||
		text.includes("exceeded your current quota") ||
		text.includes("check your plan and billing")
	);
}

export function markOpenAiQuotaBlocked(error: unknown, source: string) {
	const now = Date.now();
	const previous = readStoredHealth();
	writeStoredHealth({
		...previous,
		quotaBlockedUntilMs: now + quotaCooldownMs(),
		lastQuotaAt: new Date(now).toISOString(),
		lastQuotaSource: source,
		lastQuotaError: errorText(error).slice(0, 600),
	});
}

export function markOpenAiOk() {
	const previous = readStoredHealth();
	writeStoredHealth({
		...previous,
		quotaBlockedUntilMs: undefined,
		lastOkAt: new Date().toISOString(),
	});
}

export function getOpenAiRuntimeHealth(): OpenAiRuntimeHealth {
	const stored = readStoredHealth();
	const blockedUntilMs = Number(stored.quotaBlockedUntilMs) || 0;
	const quotaBlocked = blockedUntilMs > Date.now();
	return {
		quotaBlocked,
		quotaBlockedUntil: quotaBlocked
			? new Date(blockedUntilMs).toISOString()
			: undefined,
		lastQuotaAt: stored.lastQuotaAt,
		lastQuotaSource: stored.lastQuotaSource,
		lastQuotaError: stored.lastQuotaError,
		lastOkAt: stored.lastOkAt,
	};
}

export function getOpenAiSkipReason(): string | null {
	const health = getOpenAiRuntimeHealth();
	if (!health.quotaBlocked) return null;
	return `OpenAI quota cooldown active until ${health.quotaBlockedUntil}`;
}
