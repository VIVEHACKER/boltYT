/**
 * vlog:batch — 장르무관 양산 오케스트레이터.
 *
 * vlog:make(make-vlog.ts)를 잡(job)당 "서브프로세스로" 호출한다 — 영상마다 프로세스를 새로 띄워
 * SDXL+IPAdapter 의 wired 메모리(알려진 thrash/누수)를 잡 사이에 완전 회수하고, 한 잡이 죽어도
 * 배치 전체가 멈추지 않게 실패를 격리한다.
 *
 * 기능(확정 스펙):
 *  - 배치 실행: topics(매니페스트) → 한 번에 N편 순차 생성(메모리 제약상 병렬 안 함)
 *  - 이어하기·중복스킵: crash-safe 레저(잡마다 즉시 저장) → 완료 스킵, 실패는 재시도(maxAttempts 한도)
 *  - AI 토픽 보충: 백로그가 --target 미만이면 LLM 으로 토픽 아이디어 보충(topics.generated.json 에 영속)
 *  - 스케줄링: 멱등 재실행(cron 이 같은 명령을 반복 호출해도 완료분은 건너뜀). 래퍼: vlog-batch-cron.sh
 *
 * 장르무관: 현재 make-vlog 는 history(시대 기반)만 지원. JobSpec.genre 는 미래(경제 등) 플러그인용
 * 태그이며, jobToArgs 가 history 외 장르는 명시적으로 막는다(후속 추가 시 여기만 확장).
 *
 * 전제(history): ComfyUI(8188) + api-proxy(3459, LLM_BACKEND=claude + ELEVENLABS) 가 떠 있어야 함.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEra } from "../src/lib/historical-vlog-format.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMFY = process.env.COMFY_URL ?? "http://localhost:8188";
const PROXY = process.env.API_PROXY_URL ?? "http://localhost:3459";

export const DEFAULT_GENRE = "history";
export const DEFAULT_MAX_ATTEMPTS = 3;
export const LEDGER_VERSION = 1;
// make-vlog.ts 의 기본값/클램프와 반드시 일치해야 중복스킵이 정확하다(변경 시 동기 필요).
const MV_DEFAULT_CHANNEL = "my-history";
const MV_DEFAULT_SCENES = 4;
const clampScenes = (n: number) => Math.max(2, Math.min(8, n));

export interface JobSpec {
	era: string;
	/** "history"(현재) | 미래 "economy" 등. jobToArgs 가 지원 장르를 강제. */
	genre: string;
	minutes?: number;
	scenes?: number;
	channel?: string;
	ffmpeg?: boolean;
}

export interface LedgerEntry {
	spec: JobSpec;
	status: "done" | "failed";
	attempts: number;
	outPath?: string;
	error?: string;
	updatedAt: number;
}

export interface Ledger {
	version: number;
	jobs: Record<string, LedgerEntry>;
}

export interface PlanOpts {
	max?: number;
	maxAttempts?: number;
	/** parked(실패 한도 초과) 잡도 다시 시도 */
	retryFailed?: boolean;
}

export interface BatchPlan {
	/** 이번 실행에서 돌릴 잡(--max 로 캡) */
	pending: JobSpec[];
	/** 캡 적용 전 대기 잡 총수 */
	pendingTotal: number;
	doneCount: number;
	/** 실패 한도 초과로 보류된 잡 수 */
	parkedCount: number;
}

// ── 순수 헬퍼 ───────────────────────────────────────────────────────────────
const pick = <T>(...vals: (T | undefined)[]): T | undefined =>
	vals.find((v) => v !== undefined);

const numOrUndef = (v: unknown): number | undefined => {
	const n =
		typeof v === "number"
			? v
			: typeof v === "string" && v.trim() !== ""
				? Number(v)
				: Number.NaN;
	return Number.isFinite(n) ? n : undefined;
};
const strOrUndef = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
const boolOrUndef = (v: unknown): boolean | undefined =>
	typeof v === "boolean"
		? v
		: v === "true"
			? true
			: v === "false"
				? false
				: undefined;

// ── 순수 로직(테스트 대상) ───────────────────────────────────────────────────

/** 문자열(시대명) 또는 객체를 정규화된 JobSpec 으로. 누락 옵션은 defaults 로 채움. */
export function normalizeJob(
	raw: unknown,
	defaults: Partial<JobSpec> = {},
): JobSpec {
	const base = typeof raw === "string" ? { era: raw } : raw;
	if (!base || typeof base !== "object")
		throw new Error(`잡 형식 오류: ${JSON.stringify(raw)}`);
	const o = base as Record<string, unknown>;
	const era = strOrUndef(o.era);
	if (!era) throw new Error(`잡에 era(시대/주제) 누락: ${JSON.stringify(raw)}`);
	const job: JobSpec = {
		era,
		genre: strOrUndef(o.genre) ?? defaults.genre ?? DEFAULT_GENRE,
	};
	const minutes = numOrUndef(pick(o.minutes, defaults.minutes));
	const scenes = numOrUndef(pick(o.scenes, defaults.scenes));
	const channel = strOrUndef(pick(o.channel, defaults.channel));
	const ffmpeg = boolOrUndef(pick(o.ffmpeg, defaults.ffmpeg));
	if (minutes !== undefined) job.minutes = minutes;
	if (scenes !== undefined) job.scenes = scenes;
	if (channel !== undefined) job.channel = channel;
	if (ffmpeg !== undefined) job.ffmpeg = ffmpeg;
	return job;
}

/** 매니페스트 JSON(문자열) → JobSpec[]. 배열(문자열/객체 혼용) 허용. */
export function parseManifest(
	raw: string,
	defaults: Partial<JobSpec> = {},
): JobSpec[] {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch (e) {
		throw new Error(`매니페스트 JSON 파싱 실패: ${e}`);
	}
	if (!Array.isArray(data))
		throw new Error(
			'매니페스트는 JSON 배열이어야 함 (예: ["고대 로마", {"era":"조선","minutes":10}])',
		);
	return data.map((d) => normalizeJob(d, defaults));
}

/**
 * make-vlog 가 "실제로 사용할" 정규화된 렌더 식별자(중복스킵 키의 근거).
 * make-vlog 와 동일하게: era→resolveEra(별칭 "로마"="고대 로마"=ancient-rome-44ad),
 * channel 기본 my-history, minutes 우선(있으면 scenes 무시), 없으면 scenes 기본 4·[2,8] 클램프.
 * 이렇게 안 하면 별칭/기본값 차이만으로 같은 영상이 중복 렌더된다(Codex P2).
 */
export function canonicalRenderKey(job: JobSpec): string {
	const useMinutes = job.minutes !== undefined && job.minutes > 0;
	const era =
		job.genre === "history"
			? resolveEra(job.era).id
			: job.era.trim().toLowerCase();
	const minutes = useMinutes ? Math.max(1, job.minutes as number) : "";
	const scenes = useMinutes ? "" : clampScenes(job.scenes ?? MV_DEFAULT_SCENES);
	return [
		job.genre,
		era,
		minutes,
		scenes,
		job.channel ?? MV_DEFAULT_CHANNEL,
		job.ffmpeg ? 1 : 0,
	].join("|");
}

/** 잡의 안정적 ID — 정규화 렌더 식별자(canonicalRenderKey)의 sha1. 동일 산출물이면 동일 ID. */
export function jobId(job: JobSpec): string {
	return createHash("sha1")
		.update(canonicalRenderKey(job))
		.digest("hex")
		.slice(0, 12);
}

/** 매니페스트 + 레저 → 이번 실행 계획. 완료 스킵 / 실패 재시도(한도 내) / never-seen 대기. */
export function computePlan(
	jobs: JobSpec[],
	ledger: Ledger,
	opts: PlanOpts = {},
): BatchPlan {
	const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const seen = new Set<string>();
	const pending: JobSpec[] = [];
	let doneCount = 0;
	let parkedCount = 0;
	for (const job of jobs) {
		const id = jobId(job);
		if (seen.has(id)) continue; // 매니페스트 내 중복 제거
		seen.add(id);
		const entry = ledger.jobs[id];
		if (entry?.status === "done") {
			doneCount++;
			continue;
		}
		if (
			entry?.status === "failed" &&
			entry.attempts >= maxAttempts &&
			!opts.retryFailed
		) {
			parkedCount++;
			continue;
		}
		pending.push(job);
	}
	const pendingTotal = pending.length;
	const capped =
		opts.max !== undefined && opts.max >= 0
			? pending.slice(0, opts.max)
			: pending;
	return { pending: capped, pendingTotal, doneCount, parkedCount };
}

/** AI 토픽(문자열) → 새 JobSpec[]. seenIds(매니페스트+레저 완료분) 및 내부 중복 제거. */
export function mergeTopupTopics(
	topics: string[],
	defaults: Partial<JobSpec>,
	seenIds: Set<string>,
): JobSpec[] {
	const out: JobSpec[] = [];
	const local = new Set<string>(seenIds);
	for (const t of topics) {
		const era = typeof t === "string" ? t.trim() : "";
		if (!era) continue;
		const job = normalizeJob(era, defaults);
		const id = jobId(job);
		if (local.has(id)) continue;
		local.add(id);
		out.push(job);
	}
	return out;
}

/** JobSpec → make-vlog argv. 장르무관 골격이지만 현재 지원 장르(history)만 통과. */
export function jobToArgs(job: JobSpec, outDir: string): string[] {
	if (job.genre !== "history")
		throw new Error(
			`'${job.genre}' 장르는 vlog:batch(시대=영구 dedup) 대상 아님. economy 는 기사 단위 dedup 이라 별도 CLI: npm run vlog:economy (cron: economy-cron.sh).`,
		);
	const a = ["--era", job.era];
	if (job.minutes !== undefined && job.minutes > 0)
		a.push("--minutes", String(job.minutes));
	else if (job.scenes !== undefined && job.scenes > 0)
		a.push("--scenes", String(job.scenes));
	if (job.channel) a.push("--channel", job.channel);
	if (job.ffmpeg) a.push("--ffmpeg", "true");
	a.push("--out", outDir);
	return a;
}

// ── IO 셸 ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
	const o: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		const k = argv[i].slice(2);
		const v = argv[i + 1];
		if (v === undefined || v.startsWith("--")) o[k] = "true";
		else {
			o[k] = v;
			i++;
		}
	}
	return o;
}

const log = (m: string) => process.stdout.write(`${m}\n`);

function loadLedger(path: string): Ledger {
	if (!existsSync(path)) return { version: LEDGER_VERSION, jobs: {} };
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as Ledger;
		return data && typeof data === "object" && data.jobs
			? { version: data.version ?? LEDGER_VERSION, jobs: data.jobs }
			: { version: LEDGER_VERSION, jobs: {} };
	} catch (e) {
		log(`⚠ 레저 파싱 실패(${e}) — 새로 시작`);
		return { version: LEDGER_VERSION, jobs: {} };
	}
}

function saveLedger(path: string, ledger: Ledger): void {
	// 원자적 쓰기(Codex P2): 잡마다 갱신되는 crash-safe 레저라 in-place 쓰기 중 죽으면 손상→전체 재렌더.
	// 같은 디렉토리 temp 에 쓰고 rename(동일 FS 원자적)으로 교체.
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(ledger, null, 2));
	renameSync(tmp, path);
}

/** make-vlog 를 서브프로세스로 실행(메모리 격리). stdout 실시간 표시 + tail 보관. */
function runJob(
	args: string[],
): Promise<{ ok: boolean; outPath?: string; tail: string }> {
	return new Promise((resolve) => {
		const child = spawn("npx", ["tsx", "scripts/make-vlog.ts", ...args], {
			cwd: PROJECT_ROOT,
			env: process.env,
		});
		let buf = "";
		const onData = (d: Buffer) => {
			const s = d.toString();
			process.stdout.write(s);
			buf += s;
			if (buf.length > 12000) buf = buf.slice(-12000);
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);
		child.on("close", (code) => {
			const m = buf.match(/완성:\s*(\S+)/);
			resolve({ ok: code === 0, outPath: m?.[1], tail: buf.slice(-1500) });
		});
		child.on("error", (e) => resolve({ ok: false, tail: `spawn 실패: ${e}` }));
	});
}

/** LLM 토픽 보충(history). PROXY /api/openai/chat (make-vlog 와 동일 백엔드). */
async function aiTopupTopics(genre: string, count: number): Promise<string[]> {
	if (count <= 0) return [];
	const usr = `${genre === "history" ? "한국·세계사 시간여행 1인칭 브이로그" : genre}로 만들 흥미롭고 조회수 잘 나올 만한 서로 다른 시대/사건 ${count}개. 유명하고 시각적으로 강렬한 것 위주. JSON: {"topics":["고대 로마","조선 시대",...]}`;
	const cr = await fetch(`${PROXY}/api/openai/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [
				{ role: "system", content: "유튜브 콘텐츠 기획자. JSON만 출력." },
				{ role: "user", content: usr },
			],
			response_format: { type: "json_object" },
		}),
	});
	if (!cr.ok) throw new Error(`토픽 보충 ${cr.status} (api-proxy 확인)`);
	const parsed = JSON.parse((await cr.json()).choices[0].message.content);
	const topics = Array.isArray(parsed.topics) ? parsed.topics : [];
	return topics.filter((t: unknown): t is string => typeof t === "string");
}

async function preflight(): Promise<string[]> {
	const problems: string[] = [];
	const ping = async (url: string, name: string) => {
		try {
			const r = await fetch(url, {
				signal: AbortSignal.timeout(3000),
			});
			if (!r.ok) problems.push(`${name} 응답 ${r.status}`);
		} catch {
			problems.push(`${name} 응답 없음 (${url})`);
		}
	};
	await ping(`${COMFY}/system_stats`, "ComfyUI(8188)");
	await ping(`${PROXY}/health`, "api-proxy(3459)");
	return problems;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const cwd = process.cwd();
	const outDir = args.out ?? join(cwd, "renders");
	mkdirSync(outDir, { recursive: true });
	const manifestPath = args.manifest ?? join(cwd, "topics.json");
	const generatedPath = join(dirname(manifestPath), "topics.generated.json");
	const statePath = args.state ?? join(outDir, "batch-state.json");

	const defaults: Partial<JobSpec> = {
		genre: args.genre ?? DEFAULT_GENRE,
	};
	const dm = numOrUndef(args.minutes);
	const ds = numOrUndef(args.scenes);
	if (dm !== undefined) defaults.minutes = dm;
	if (ds !== undefined) defaults.scenes = ds;
	if (args.channel) defaults.channel = args.channel;
	if (args.ffmpeg === "true") defaults.ffmpeg = true;

	const max = numOrUndef(args.max) ?? 3;
	const target = numOrUndef(args.target);
	const maxAttempts = numOrUndef(args["max-attempts"]) ?? DEFAULT_MAX_ATTEMPTS;
	const dryRun = args["dry-run"] === "true";
	const retryFailed = args["retry-failed"] === "true";

	// 1) 매니페스트(수동) + 생성분(AI) 로드
	const jobs: JobSpec[] = [];
	for (const p of [manifestPath, generatedPath]) {
		if (existsSync(p))
			jobs.push(...parseManifest(readFileSync(p, "utf8"), defaults));
	}
	const ledger = loadLedger(statePath);

	// 2) AI 토픽 보충 — 대기 잡이 target 미만이면 보충(생성분에 영속)
	let topupFailed = false;
	if (target !== undefined) {
		const planNow = computePlan(jobs, ledger, { maxAttempts, retryFailed });
		const need = target - planNow.pendingTotal;
		if (need > 0) {
			log(
				`🔎 대기 ${planNow.pendingTotal} < 목표 ${target} → AI 토픽 ${need}개 보충...`,
			);
			const seenIds = new Set<string>([
				...jobs.map(jobId),
				...Object.keys(ledger.jobs),
			]);
			try {
				const topics = await aiTopupTopics(
					defaults.genre ?? DEFAULT_GENRE,
					need,
				);
				// LLM 이 need 보다 많이 반환해도 부족분만큼만 채택(백로그 무한 증식 방지, Codex P2).
				const fresh = mergeTopupTopics(topics, defaults, seenIds).slice(
					0,
					need,
				);
				if (fresh.length) {
					const prevGen = existsSync(generatedPath)
						? parseManifest(readFileSync(generatedPath, "utf8"), defaults)
						: [];
					writeFileSync(
						generatedPath,
						JSON.stringify([...prevGen, ...fresh], null, 2),
					);
					jobs.push(...fresh);
					log(`   +${fresh.length}개: ${fresh.map((j) => j.era).join(", ")}`);
				} else log("   (중복 제외 후 신규 토픽 0개)");
			} catch (e) {
				topupFailed = true;
				log(`   ⚠ 토픽 보충 실패(${e}) — 기존 매니페스트로 진행`);
			}
		}
	}

	// 3) 계획
	const plan = computePlan(jobs, ledger, { max, maxAttempts, retryFailed });
	log(
		`\n📋 계획: 대기 ${plan.pendingTotal}(이번 ${plan.pending.length}) · 완료 ${plan.doneCount} · 보류 ${plan.parkedCount} · 총 잡 ${jobs.length}`,
	);
	if (plan.pending.length === 0) {
		// 대기 잡 "자체"가 0인지(pendingTotal)로 판정 — --max 0(백로그 점검)은 pending 만 비고 백로그는 있음(Codex P3).
		if (plan.pendingTotal === 0) {
			// --target 인데 백로그가 0이면 목표 미달 → cron 이 "성공"으로 오인하지 않게 비정상 종료(Codex P2).
			// 원인 구분: 보충 실패(인프라) vs 신규 토픽 고갈/중복(백로그 소진).
			if (target !== undefined) {
				log(
					`❌ --target ${target} 인데 대기 잡 0 — 백로그 목표 미달${
						topupFailed
							? "(토픽 보충 실패: api-proxy/LLM 점검)"
							: "(신규 토픽 고갈/중복: topics.json 보강)"
					}.`,
				);
				process.exit(3);
			}
			log(
				"✅ 생성할 잡 없음(모두 완료/보류). topics.json 추가 또는 --target 으로 보충.",
			);
			return;
		}
		// 백로그는 있으나 --max 로 이번 실행분이 0편 — 에러 아님(백로그 점검 용도).
		log(`ℹ 대기 ${plan.pendingTotal}편 있으나 --max 로 이번 실행분 0편.`);
		return;
	}
	for (const j of plan.pending)
		log(
			`   • ${j.era}${j.minutes ? ` (${j.minutes}분)` : j.scenes ? ` (${j.scenes}씬)` : ""} [${j.genre}]`,
		);
	if (dryRun) {
		log("\n(dry-run — 렌더 안 함)");
		return;
	}

	// 4) 프리플라이트(서비스 떠 있나)
	const problems = await preflight();
	if (problems.length) {
		log(`\n❌ 사전 점검 실패:\n   - ${problems.join("\n   - ")}`);
		log("   ComfyUI 켜기 + `npm run api-proxy`(LLM_BACKEND=claude) 후 재시도.");
		process.exit(2);
	}

	// 5) 배치 실행(순차, 잡당 서브프로세스 → 메모리 격리, 잡마다 레저 즉시 저장)
	let ok = 0;
	let fail = 0;
	for (let i = 0; i < plan.pending.length; i++) {
		const job = plan.pending[i];
		const id = jobId(job);
		const prev = ledger.jobs[id];
		log(
			`\n━━ [${i + 1}/${plan.pending.length}] ${job.era} (시도 ${(prev?.attempts ?? 0) + 1}) ━━`,
		);
		const res = await runJob(jobToArgs(job, outDir));
		ledger.jobs[id] = {
			spec: job,
			status: res.ok ? "done" : "failed",
			attempts: (prev?.attempts ?? 0) + 1,
			outPath: res.ok ? res.outPath : prev?.outPath,
			error: res.ok ? undefined : res.tail,
			updatedAt: Math.floor(Date.now() / 1000),
		};
		saveLedger(statePath, ledger);
		if (res.ok) {
			ok++;
			log(`✓ 완료: ${res.outPath ?? "(경로 미검출)"}`);
		} else {
			fail++;
			log(`✗ 실패 — 다음 잡 계속. tail:\n${res.tail.slice(-400)}`);
		}
	}

	log(
		`\n🏁 배치 종료: 성공 ${ok} · 실패 ${fail}. 레저: ${statePath}\n   재실행하면 완료분은 건너뛰고 실패분만 재시도(한도 ${maxAttempts}).`,
	);
	if (fail > 0 && ok === 0) process.exit(1);
}

// 직접 실행 시에만 main (테스트 import 시엔 순수 함수만 사용)
if (process.argv[1]?.endsWith("vlog-batch.ts")) {
	main().catch((e) => {
		process.stderr.write(`ERROR: ${e}\n`);
		process.exit(1);
	});
}
