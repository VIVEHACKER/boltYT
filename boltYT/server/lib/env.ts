/**
 * .env 로더 + 시작 시 필수 키 검증 + 런타임 파일 감시
 */

import { existsSync, readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_URL = new URL("../../.env", import.meta.url);
const ENV_PATH = fileURLToPath(ENV_URL);
const ENV_ALIASES: Record<string, string[]> = {
	OPENAI_API_KEY: ["VITE_OPENAI_API_KEY"],
	YOUTUBE_API_KEY: ["VITE_YOUTUBE_API_KEY"],
};
export const EDITABLE_ENV_KEYS = [
	"OPENAI_API_KEY",
	"ELEVENLABS_API_KEY",
	"PEXELS_API_KEY",
	"PIXABAY_API_KEY",
	"YOUTUBE_API_KEY",
	"NAVER_CLIENT_ID",
	"NAVER_CLIENT_SECRET",
	"FAL_KEY",
	"GOOGLE_CLIENT_ID",
	"GOOGLE_CLIENT_SECRET",
] as const;

const EDITABLE_ENV_KEY_SET = new Set<string>(EDITABLE_ENV_KEYS);

function applyAliases(overwrite: boolean): string[] {
	const applied: string[] = [];
	for (const [target, aliases] of Object.entries(ENV_ALIASES)) {
		if (!overwrite && process.env[target]) continue;
		if (process.env[target]) continue;
		const alias = aliases.find((key) => process.env[key]);
		if (!alias) continue;
		process.env[target] = process.env[alias];
		applied.push(target);
	}
	return applied;
}

function parseAndApply(overwrite: boolean): string[] {
	const applied: string[] = [];
	try {
		const content = readFileSync(ENV_PATH, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIdx = trimmed.indexOf("=");
			if (eqIdx === -1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			const val = trimmed
				.slice(eqIdx + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
			if (overwrite || !process.env[key]) {
				process.env[key] = val;
				applied.push(key);
			}
		}
	} catch {
		// .env 없으면 스킵
	}
	return applied;
}

export function loadEnv() {
	parseAndApply(false);
	applyAliases(false);
}

export function reloadEnv(): string[] {
	const applied = parseAndApply(true);
	return [...applied, ...applyAliases(true)];
}

function envValue(value: string): string {
	if (/^[^\s"'#]+$/.test(value)) return value;
	return JSON.stringify(value);
}

function parseEnvKey(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return null;
	const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(trimmed);
	return match?.[1] ?? null;
}

export function saveEnvValues(
	values: Record<string, unknown>,
): { updated: string[]; ignored: string[]; path: string } {
	const nextValues = new Map<string, string>();
	const ignored: string[] = [];
	for (const [key, rawValue] of Object.entries(values)) {
		if (!EDITABLE_ENV_KEY_SET.has(key)) {
			ignored.push(key);
			continue;
		}
		if (typeof rawValue !== "string") {
			ignored.push(key);
			continue;
		}
		const value = rawValue.trim();
		if (!value) continue;
		if (/[\r\n]/.test(value)) {
			throw new Error(`${key} contains a newline`);
		}
		nextValues.set(key, value);
	}

	if (nextValues.size === 0) return { updated: [], ignored, path: ENV_PATH };

	const lines = existsSync(ENV_PATH)
		? readFileSync(ENV_PATH, "utf-8").split(/\r?\n/)
		: ["# Local API keys for boltYT", ""];
	const seen = new Set<string>();
	const nextLines = lines.map((line) => {
		const key = parseEnvKey(line);
		if (!key || !nextValues.has(key)) return line;
		seen.add(key);
		return `${key}=${envValue(nextValues.get(key) ?? "")}`;
	});

	for (const [key, value] of nextValues.entries()) {
		if (!seen.has(key)) nextLines.push(`${key}=${envValue(value)}`);
		process.env[key] = value;
	}

	const content = `${nextLines.join("\n").replace(/\n+$/g, "")}\n`;
	writeFileSync(ENV_PATH, content, "utf-8");
	return { updated: [...nextValues.keys()], ignored, path: ENV_PATH };
}

/**
 * .env 파일을 감시하다가 변경되면 process.env에 덮어쓰기 후 콜백 호출.
 * - watchFile(폴링) 사용: 에디터의 atomic save(rename)에도 안정적
 * - 폴링 간격 1s, 디바운스 200ms (연속 저장 대비)
 */
export function watchEnv(onChange: (appliedKeys: string[]) => void) {
	let timer: NodeJS.Timeout | null = null;
	watchFile(ENV_PATH, { interval: 1000 }, (curr, prev) => {
		if (curr.mtimeMs === prev.mtimeMs) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			const applied = parseAndApply(true);
			onChange(applied);
		}, 200);
	});
	return () => unwatchFile(ENV_PATH);
}

export function validateEnv(
	required: string[],
	service: string,
): { ok: boolean; missing: string[] } {
	const missing = required.filter((k) => !process.env[k]);
	if (missing.length > 0) {
		process.stderr.write(
			`${JSON.stringify({
				ts: new Date().toISOString(),
				level: "warn",
				service,
				msg: `Missing env vars: ${missing.join(", ")}`,
			})}\n`,
		);
	}
	return { ok: missing.length === 0, missing };
}
