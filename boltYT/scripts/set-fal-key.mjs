#!/usr/bin/env node

// FAL_KEY 를 .env 에 안전하게 기록하는 CLI.
//
// 키 값을 채팅/소스에 남기지 않으려고 만든 도구. 동작:
//   1) 키를 받는다 (숨김 프롬프트 → 파이프 stdin → 환경변수 FAL_KEY 순서)
//      ※ 보안: 키를 명령행 위치인자로 받지 않는다 — argv 는 셸 히스토리·프로세스
//        목록(ps)에 노출되어 시크릿 안전 입력이라는 취지를 무력화하기 때문.
//   2) 실행 중인 api-proxy(3459) 의 /api/keys/save 로 전달
//      → 서버의 saveEnvValues 가 .env 에 기록 + reloadKeys 로 즉시 반영
//   3) /api/keys/status 로 fal 활성화 여부 확인 후 출력 (값은 마스킹)
//
// 사용:
//   node scripts/set-fal-key.mjs            # 숨김 프롬프트로 입력 (본인 터미널 권장)
//   echo "$KEY" | node scripts/set-fal-key.mjs   # 비대화형: stdin 파이프
//   FAL_KEY=<KEY> node scripts/set-fal-key.mjs   # 환경변수(시크릿 매니저/소스 파일)
//   node scripts/set-fal-key.mjs --status   # 현재 상태만 확인 (쓰기 없음)
//
// 프록시가 안 떠 있으면 안내만 하고 종료한다 (.env 경로를 추측해 직접 쓰지 않음 —
// 경로 결정은 서버 env.ts 가 단일 진실원).

import process from "node:process";
import { createInterface } from "node:readline";

// 끝 슬래시 제거 — `${PROXY}/api/...` 가 `//api/...` 가 되면 프록시 라우트가 안 맞음.
const PROXY = (process.env.API_PROXY_URL ?? "http://localhost:3459").replace(
	/\/+$/,
	"",
);

function mask(value) {
	if (!value) return "(빈 값)";
	if (value.length <= 8) return "****";
	return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
}

async function getStatus() {
	const res = await fetch(`${PROXY}/api/keys/status`, {
		signal: AbortSignal.timeout(5000),
	});
	if (!res.ok) throw new Error(`status ${res.status}`);
	return res.json();
}

// 에코를 끈 채로 한 줄 입력받는다 (터미널에서만 의미 있음).
function promptHidden(question) {
	return new Promise((resolve, reject) => {
		if (!process.stdin.isTTY) {
			reject(
				new Error(
					"대화형 입력이 불가능한 환경입니다. 키를 인자로 주세요: node scripts/set-fal-key.mjs <KEY>",
				),
			);
			return;
		}
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
			terminal: true,
		});
		process.stdout.write(question);
		// 입력 에코 차단
		rl._writeToOutput = () => {};
		rl.question("", (answer) => {
			rl.close();
			process.stdout.write("\n");
			resolve(answer);
		});
	});
}

// 파이프된 stdin 을 끝까지 읽는다(비대화형 자동화용).
function readStdin() {
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
	});
}

async function resolveKey() {
	// 입력 우선순위(문서와 일치): 명시적 입력(프롬프트/파이프) → 환경변수 폴백.
	// 명시적으로 준 키가 stale 한 FAL_KEY env 에 가려지지 않도록 env 는 마지막에만.
	if (process.stdin.isTTY) {
		return (
			await promptHidden("fal.ai 키를 붙여넣고 Enter (화면에 안 보입니다): ")
		).trim();
	}
	const piped = (await readStdin()).trim();
	if (piped) return piped;
	// 비대화형 + 파이프 입력 없음 → 환경변수(시크릿 매니저/소스된 파일) 폴백.
	if (process.env.FAL_KEY?.trim()) return process.env.FAL_KEY.trim();
	throw new Error(
		'키 입력이 없습니다. 키를 stdin 으로 파이프하거나(echo "$KEY" | ...) FAL_KEY 환경변수로 주세요. (보안상 명령행 인자로는 받지 않습니다)',
	);
}

async function main() {
	// 보안: 키를 명령행 위치인자로 넘기면 셸 히스토리·프로세스 목록에 노출된다. 거부.
	const positional = process.argv.slice(2).find((a) => a && !a.startsWith("--"));
	if (positional) {
		console.error(
			"✗ 보안: 키를 명령행 인자로 전달하지 마세요(히스토리/프로세스 노출).\n" +
				'  대신:  node scripts/set-fal-key.mjs  (숨김 프롬프트)  또는  echo "$KEY" | node scripts/set-fal-key.mjs',
		);
		process.exit(1);
	}

	// 프록시 생존 확인
	let before;
	try {
		before = await getStatus();
	} catch {
		console.error(
			`✗ api-proxy(${PROXY})에 연결할 수 없습니다.\n  먼저 프록시를 켜세요:  npm run api-proxy`,
		);
		process.exit(1);
	}

	if (process.argv.includes("--status")) {
		console.log(`현재 fal 상태: ${before.fal ? "configured ✓" : "missing ✗"}`);
		process.exit(0);
	}

	const key = await resolveKey();
	if (!key) {
		console.error("✗ 키가 비어 있습니다.");
		process.exit(1);
	}
	if (/[\r\n]/.test(key)) {
		console.error("✗ 키에 줄바꿈이 포함돼 있습니다. 한 줄로 붙여넣으세요.");
		process.exit(1);
	}

	const res = await fetch(`${PROXY}/api/keys/save`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ keys: { FAL_KEY: key } }),
		signal: AbortSignal.timeout(5000),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.ok) {
		console.error(
			`✗ 저장 실패 (${res.status}): ${body.error ?? "알 수 없는 오류"}`,
		);
		process.exit(1);
	}

	const after = body.status ?? (await getStatus());
	console.log(`✓ .env 에 FAL_KEY 기록 완료 — ${mask(key)}`);
	console.log(`  updated: ${(body.updated ?? []).join(", ") || "(없음)"}`);
	console.log(
		`  fal 상태: ${after.fal ? "configured ✓ (프록시 즉시 반영됨)" : "missing ✗ — 확인 필요"}`,
	);
	process.exit(after.fal ? 0 : 2);
}

main().catch((err) => {
	console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
