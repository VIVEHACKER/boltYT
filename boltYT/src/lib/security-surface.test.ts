import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..");

function walk(dir: string, exts: string[]): string[] {
	const out: string[] = [];
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		const s = statSync(p);
		if (s.isDirectory()) {
			if (f === "node_modules" || f === "dist") continue;
			out.push(...walk(p, exts));
		} else if (exts.some((e) => f.endsWith(e))) {
			out.push(p);
		}
	}
	return out;
}

const sourceFiles = walk(SRC_ROOT, [".ts", ".tsx"]).filter(
	(p) => !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"),
);

// 파일을 한 번만 읽어 캐싱 — 3개 테스트가 각각 재읽기하면 5초 타임아웃 초과
const fileContents: Map<string, string> = new Map(
	sourceFiles.map((f) => [f, readFileSync(f, "utf-8")]),
);

describe("security surface — 클라 번들에 시크릿이 들어가지 않는다", () => {
	it("서버 전용 환경변수를 클라가 직접 참조하지 않음", () => {
		const sensitive =
			/process\.env\.(OPENAI|ELEVENLABS|PEXELS|PIXABAY|YOUTUBE|NAVER_CLIENT_(ID|SECRET)|DIAG_TOKEN)/;
		const offenders = sourceFiles.filter((f) =>
			sensitive.test(fileContents.get(f)!),
		);
		expect(offenders).toEqual([]);
	});

	it("클라 번들에 프로바이더 접두 토큰 하드코드 없음", () => {
		// 문자열 조각 조립으로 secret-scan 훅 오탐 방지
		const pat = new RegExp(
			`["']${["s", "k"].join("")}-[a-zA-Z0-9_\\-]{16,}["']`,
		);
		const offenders = sourceFiles.filter((f) => pat.test(fileContents.get(f)!));
		expect(offenders).toEqual([]);
	});

	it("Authorization: Bearer 헤더를 클라가 직접 설정하지 않음 (서버 경유)", () => {
		const pat = /Authorization['"`]?\s*:\s*['"`]Bearer /;
		const offenders = sourceFiles
			.filter((f) => !f.endsWith("proxy.ts"))
			.filter((f) => pat.test(fileContents.get(f)!));
		expect(offenders).toEqual([]);
	});
});
