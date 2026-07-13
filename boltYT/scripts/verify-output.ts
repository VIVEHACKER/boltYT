/**
 * 최종 산출물 검수 — 감자 파이프라인의 "최종 검수 + contact sheet" 단계.
 * 렌더 완료된 mp4 를 ffprobe 실측으로 검사한다:
 *   (a) 영상 길이 vs (인트로 카드 + 내레이션 합산 + 아웃트로 카드) ± tolerance
 *   (b) .srt 마지막 종료 타임스탬프가 영상 끝(아웃트로 제외 구간)에 정합하는지
 *   (c) 컷 수(.srt 큐 수) 일치 — 호출자가 cutCount 를 준 경우만
 *   (d) 평균 컷 길이 ≥ 2.0s (감자 규칙: 2~3초 잘게 썰기 금지 — 경고 수준)
 *   (+) contact sheet: ffmpeg tile 필터로 전체 컷 격자 1장 — 사람 눈 검수용. 실패해도 경고만.
 *
 * 길이 정합의 핵심 보정: remotion-vlog-render 는 인트로/아웃트로 카드
 * (TITLE_CARD_FRAMES/END_CARD_FRAMES)와 씬 전환 오버랩 패딩을 넣으므로 최종 영상
 * 길이 ≠ 오디오 합산. 오버랩 자체는 buildVlogRemotionScenes 의 반오버랩 패딩이 정확히
 * 상쇄하므로(ceil/floor 반분할 합 == 오버랩), 남는 오차는 컷당 프레임 라운딩 잔차뿐
 * (오디오 ceil 1f + 반분할 라운딩 1f ≤ 2f/컷). 기본 tolerance 가 이를 총합 보정한다.
 *
 * 실행: npx tsx scripts/verify-output.ts --video out.mp4 --srt out.srt \
 *         --audio-sec 612.4 --cuts 24 --intro-offset 3 --outro-sec 5 --contact-sheet
 * exit code: 통과 0 / 실패 1 / 인자 오류 2. in-process import(runVerifyOutput)용 export 유지.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { exec, log, parseArgs } from "./vlog-shared.ts";

/** 영상 확장자를 벗긴 stem(예: /a/out.mp4 → out). 산출물 파일명 유도 공통. */
function videoStem(videoPath: string): string {
	return basename(videoPath).replace(/\.[^.]+$/, "");
}

/**
 * 검수 리포트 기본 경로 — 영상 basename 파생(`<stem>.verify_report.json`).
 * 배치가 같은 디렉토리에 여러 영상을 렌더할 때 리포트가 서로 덮이지 않게 한다.
 */
export function defaultReportPath(videoPath: string): string {
	return join(dirname(videoPath), `${videoStem(videoPath)}.verify_report.json`);
}

/** 컨택트시트 기본 경로 — 영상 basename 파생(리포트와 동일 이유로 잡별 분리). */
export function defaultContactSheetPath(videoPath: string): string {
	return join(dirname(videoPath), `${videoStem(videoPath)}.contact_sheet.png`);
}

const FPS = 30;
/** 감자 규칙: 평균 컷 길이 하한(초). 미달은 경고 — 산출물 자체를 실패시키지 않는다. */
const MIN_AVG_CUT_SEC = 2.0;
/** 컷당 프레임 라운딩 잔차 상한 — 오디오 길이 ceil(1f) + 오버랩 반분할 ceil/floor(1f). */
const ROUNDING_FRAMES_PER_CUT = 2;
/** 경고 수준 체크 — 실패해도 report.ok 를 깎지 않는다(검수 결과에 warn 으로만 남김). */
export const WARN_CHECKS: ReadonlySet<string> = new Set([
	"avg-cut-length",
	"contact-sheet",
]);

/** 외부 프로세스 실행 인터페이스 — 테스트에서 ffmpeg/ffprobe 를 페이크로 주입. */
export type ExecFn = (
	cmd: string,
	args: string[],
) => Promise<{ stdout: string }>;

export interface VerifyCheck {
	name: string;
	ok: boolean;
	expected?: string;
	actual?: string;
	detail?: string;
}

export interface VerifyReport {
	ok: boolean;
	checks: VerifyCheck[];
	/** 실제 기록된 리포트 파일 경로 — 호출자 에러 메시지가 정확한 파일을 가리키게 한다. */
	reportPath: string;
}

export interface VerifyOutputOpts {
	videoPath: string;
	srtPath?: string;
	/** 내레이션 합산 초(카드/전환 제외 순수 오디오). 없으면 길이 체크 스킵. */
	audioSecTotal?: number;
	cutCount?: number;
	/** 인트로 카드 초(예: TITLE_CARD_FRAMES/30 = 3s). 기본 0. */
	introOffsetSec?: number;
	/** 아웃트로 카드 초(예: END_CARD_FRAMES/30 = 5s). 기본 0. */
	outroSec?: number;
	/** 기본: computeToleranceSec(cutCount) = 1.0 + 컷당 라운딩 잔차 총합. */
	toleranceSec?: number;
	contactSheet?: boolean;
	/** 기본: 영상 옆 verify_report.json */
	reportPath?: string;
	execFn?: ExecFn;
}

/**
 * 기본 tolerance(초) = 1.0 + Σ(컷당 프레임 라운딩 잔차).
 * 전환 오버랩 총량은 렌더러 패딩이 상쇄하므로 더하지 않는다 — 오버랩만큼 짧아진
 * 영상(패딩 미적용 구버전 산출물)은 진짜 결함이라 tolerance 로 흡수하면 안 된다.
 */
export function computeToleranceSec(cutCount?: number, fps = FPS): number {
	const cuts = Math.max(0, cutCount ?? 0);
	return 1.0 + (cuts * ROUNDING_FRAMES_PER_CUT) / fps;
}

/** 컨택트시트 격자 치수 — cols=ceil(sqrt(n)), rows 는 n 을 담는 최소 행 수. */
export function gridDims(n: number): { cols: number; rows: number } {
	const count = Math.max(1, Math.floor(n));
	const cols = Math.ceil(Math.sqrt(count));
	return { cols, rows: Math.ceil(count / cols) };
}

/** SRT 타임스탬프(HH:MM:SS,mmm — '.' 구분도 허용) → 초. 형식 불일치 시 null. */
export function srtTimeToSec(ts: string): number | null {
	const m = /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(ts.trim());
	if (!m) return null;
	return (
		Number(m[1]) * 3600 +
		Number(m[2]) * 60 +
		Number(m[3]) +
		Number(m[4].padEnd(3, "0")) / 1000
	);
}

export interface SrtStats {
	cueCount: number;
	/** 모든 큐 종료 시각의 최댓값 — 큐가 정렬 안 돼 있어도 안전. */
	lastEndSec: number;
}

/** SRT 본문에서 큐 수 + 마지막 종료 타임스탬프 추출. 큐 0개면 null(파싱 실패 취급). */
export function parseSrtStats(text: string): SrtStats | null {
	const re =
		/(\d{2,}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{1,3})/g;
	let cueCount = 0;
	let lastEndSec = 0;
	for (const m of text.matchAll(re)) {
		const end = srtTimeToSec(m[2]);
		if (end === null) continue;
		cueCount++;
		if (end > lastEndSec) lastEndSec = end;
	}
	return cueCount === 0 ? null : { cueCount, lastEndSec };
}

export interface CheckInput {
	videoSec: number;
	audioSecTotal?: number;
	srt?: SrtStats;
	cutCount?: number;
	introOffsetSec: number;
	outroSec: number;
	toleranceSec: number;
}

/** 순수 판정 로직 — I/O 없이 실측값만 받아 체크 목록 생성(단위 테스트 대상). */
export function buildChecks(input: CheckInput): VerifyCheck[] {
	const { videoSec, srt, cutCount, introOffsetSec, outroSec, toleranceSec } =
		input;
	const checks: VerifyCheck[] = [];

	// (a) 영상 길이 = 인트로 + 내레이션 합산 + 아웃트로 ± tolerance
	if (input.audioSecTotal !== undefined) {
		const expected = introOffsetSec + input.audioSecTotal + outroSec;
		const diff = Math.abs(videoSec - expected);
		checks.push({
			name: "video-duration",
			ok: diff <= toleranceSec,
			expected: `${expected.toFixed(2)}s ±${toleranceSec.toFixed(2)}s`,
			actual: `${videoSec.toFixed(2)}s`,
			detail: `오차 ${diff.toFixed(2)}s`,
		});
	}

	// (b) 마지막 자막이 영상 안에서 끝나고, 아웃트로 직전까지는 도달해야 함
	if (srt) {
		const lowerBound = videoSec - toleranceSec - outroSec;
		checks.push({
			name: "srt-tail",
			ok: srt.lastEndSec <= videoSec && srt.lastEndSec >= lowerBound,
			expected: `[${lowerBound.toFixed(2)}s, ${videoSec.toFixed(2)}s]`,
			actual: `${srt.lastEndSec.toFixed(2)}s`,
			detail:
				srt.lastEndSec > videoSec
					? "자막이 영상보다 늦게 끝남(영상 잘림 의심)"
					: srt.lastEndSec < lowerBound
						? "자막이 너무 일찍 끝남(뒷부분 무음/누락 의심)"
						: undefined,
		});
	}

	// (c) 컷 수 일치 — srt 큐는 씬당 1개(make-vlog/economy)라 큐 수 == 컷 수
	if (cutCount !== undefined && srt) {
		checks.push({
			name: "cut-count",
			ok: srt.cueCount === cutCount,
			expected: String(cutCount),
			actual: String(srt.cueCount),
		});
	}

	// (d) 평균 컷 길이 — 감자 규칙(잘게 썰기 금지). 경고 수준.
	if (cutCount !== undefined && cutCount > 0) {
		const bodySec = Math.max(0, videoSec - introOffsetSec - outroSec);
		const avg = bodySec / cutCount;
		checks.push({
			name: "avg-cut-length",
			ok: avg >= MIN_AVG_CUT_SEC,
			expected: `>=${MIN_AVG_CUT_SEC.toFixed(1)}s`,
			actual: `${avg.toFixed(2)}s`,
			detail:
				avg < MIN_AVG_CUT_SEC
					? "WARN: 평균 컷이 짧음 — 잘게 썬 편집은 시청 유지율을 깎는다"
					: undefined,
		});
	}

	return checks;
}

/** 전체 판정 — 경고 수준(WARN_CHECKS) 실패는 무시하고 나머지가 전부 ok 여야 통과. */
export function summarizeChecks(checks: VerifyCheck[]): boolean {
	return checks.every((c) => c.ok || WARN_CHECKS.has(c.name));
}

/**
 * 컨택트시트 ffmpeg 인자(순수 빌더) — 컷수 기반 격자에 균등 간격 샘플링.
 * select='not(mod(n,STEP))' 로 STEP 프레임마다 1장 → 320px 축소 → tile 격자 1장.
 */
export function contactSheetArgs(
	videoPath: string,
	outPath: string,
	cutCount: number | undefined,
	videoSec: number,
	fps = FPS,
): string[] {
	const { cols, rows } = gridDims(cutCount ?? 12);
	const tiles = cols * rows;
	const totalFrames = Math.max(1, Math.floor(videoSec * fps));
	const step = Math.max(1, Math.floor(totalFrames / tiles));
	return [
		"-y",
		"-i",
		videoPath,
		"-vf",
		`select='not(mod(n,${step}))',scale=320:-1,tile=${cols}x${rows}`,
		"-frames:v",
		"1",
		"-vsync",
		"vfr",
		outPath,
	];
}

/** ffprobe 로 영상 길이(초). vlog-shared.dur 과 달리 하한 보정 없이 실측 그대로(검수용). */
export async function probeDurationSec(
	file: string,
	execFn: ExecFn = exec,
): Promise<number> {
	const { stdout } = await execFn("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		file,
	]);
	const d = Number.parseFloat(stdout.trim());
	if (!Number.isFinite(d) || d <= 0)
		throw new Error(`ffprobe 길이 파싱 실패: ${file} → "${stdout.trim()}"`);
	return d;
}

/** 검수 실행 — 실측(ffprobe/srt) 수집 → 순수 판정 → verify_report.json 기록. */
export async function runVerifyOutput(
	opts: VerifyOutputOpts,
): Promise<VerifyReport> {
	const execFn = opts.execFn ?? exec;
	const introOffsetSec = opts.introOffsetSec ?? 0;
	const outroSec = opts.outroSec ?? 0;
	const toleranceSec = opts.toleranceSec ?? computeToleranceSec(opts.cutCount);
	const reportPath = opts.reportPath ?? defaultReportPath(opts.videoPath);
	const checks: VerifyCheck[] = [];

	const writeReport = (): VerifyReport => {
		const report: VerifyReport = {
			ok: summarizeChecks(checks),
			checks,
			reportPath,
		};
		writeFileSync(reportPath, `${JSON.stringify(report, null, "\t")}\n`);
		return report;
	};

	// 1) 영상 길이 실측 — 실패하면 나머지 체크가 무의미하므로 즉시 실패 보고
	let videoSec: number;
	try {
		videoSec = await probeDurationSec(opts.videoPath, execFn);
	} catch (e) {
		checks.push({ name: "ffprobe", ok: false, detail: String(e) });
		return writeReport();
	}

	// 2) srt 실측 — 파일이 주어졌는데 못 읽으면 하드 실패(검수 대상 누락)
	let srt: SrtStats | undefined;
	if (opts.srtPath) {
		try {
			const stats = parseSrtStats(readFileSync(opts.srtPath, "utf8"));
			if (stats) srt = stats;
			else
				checks.push({
					name: "srt-parse",
					ok: false,
					detail: "큐 0개 — 타임스탬프 파싱 실패",
				});
		} catch (e) {
			checks.push({ name: "srt-parse", ok: false, detail: String(e) });
		}
	}

	// 3) 순수 판정
	checks.push(
		...buildChecks({
			videoSec,
			audioSecTotal: opts.audioSecTotal,
			srt,
			cutCount: opts.cutCount,
			introOffsetSec,
			outroSec,
			toleranceSec,
		}),
	);

	// 4) contact sheet — 사람 눈 검수 보조. 실패해도 warn 만(판정 불변).
	if (opts.contactSheet) {
		const sheetPath = defaultContactSheetPath(opts.videoPath);
		try {
			await execFn(
				"ffmpeg",
				contactSheetArgs(opts.videoPath, sheetPath, opts.cutCount, videoSec),
			);
			checks.push({ name: "contact-sheet", ok: true, actual: sheetPath });
		} catch (e) {
			checks.push({
				name: "contact-sheet",
				ok: false,
				detail: `WARN: 컨택트시트 생성 실패 — ${String(e)}`,
			});
		}
	}

	return writeReport();
}

/** CLI 숫자 인자 파싱 — 없거나 숫자 아니면 undefined(기본값 위임). */
function numArg(v: string | undefined): number | undefined {
	if (v === undefined) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

if (process.argv[1]?.endsWith("verify-output.ts")) {
	const args = parseArgs(process.argv.slice(2));
	if (!args.video) {
		log(
			"사용법: npx tsx scripts/verify-output.ts --video out.mp4 [--srt out.srt] [--audio-sec 612.4] [--cuts 24] [--intro-offset 3] [--outro-sec 5] [--tolerance 2.5] [--contact-sheet] [--report verify_report.json]",
		);
		process.exit(2);
	}
	runVerifyOutput({
		videoPath: args.video,
		srtPath: args.srt,
		audioSecTotal: numArg(args["audio-sec"]),
		cutCount: numArg(args.cuts),
		introOffsetSec: numArg(args["intro-offset"]),
		outroSec: numArg(args["outro-sec"]),
		toleranceSec: numArg(args.tolerance),
		contactSheet: args["contact-sheet"] === "true",
		reportPath: args.report,
	})
		.then((report) => {
			for (const c of report.checks) {
				const mark = c.ok ? "✓" : WARN_CHECKS.has(c.name) ? "⚠" : "✗";
				const parts = [
					c.expected ? `기대=${c.expected}` : "",
					c.actual ? `실측=${c.actual}` : "",
					c.detail ?? "",
				]
					.filter(Boolean)
					.join(" · ");
				log(`${mark} ${c.name}${parts ? ` — ${parts}` : ""}`);
			}
			log(report.ok ? "✅ 검수 통과" : "❌ 검수 실패");
			process.exit(report.ok ? 0 : 1);
		})
		.catch((e) => {
			log(`검수 오류: ${e}`);
			process.exit(1);
		});
}
