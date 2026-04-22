/**
 * .env 로더 + 시작 시 필수 키 검증 + 런타임 파일 감시
 */

import { readFileSync, unwatchFile, watchFile } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_URL = new URL("../../.env", import.meta.url);
const ENV_PATH = fileURLToPath(ENV_URL);

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
