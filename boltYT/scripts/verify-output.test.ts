import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildChecks,
	computeToleranceSec,
	contactSheetArgs,
	type ExecFn,
	gridDims,
	parseSrtStats,
	runVerifyOutput,
	srtTimeToSec,
	summarizeChecks,
	type VerifyCheck,
} from "./verify-output.ts";

describe("computeToleranceSec", () => {
	it("컷 수 없으면 기본 1.0s", () => {
		expect(computeToleranceSec()).toBe(1.0);
		expect(computeToleranceSec(0)).toBe(1.0);
	});

	it("컷당 라운딩 잔차 2f/30fps 를 총합 보정", () => {
		// 30컷 → 1.0 + 30*2/30 = 3.0
		expect(computeToleranceSec(30)).toBeCloseTo(3.0);
		// 6컷 → 1.0 + 6*2/30 = 1.4
		expect(computeToleranceSec(6)).toBeCloseTo(1.4);
	});

	it("fps 주입 가능(비결정 상수 의존 없음)", () => {
		expect(computeToleranceSec(10, 60)).toBeCloseTo(1.0 + (10 * 2) / 60);
	});
});

describe("gridDims", () => {
	it("cols=ceil(sqrt(n)) 격자", () => {
		expect(gridDims(1)).toEqual({ cols: 1, rows: 1 });
		expect(gridDims(4)).toEqual({ cols: 2, rows: 2 });
		expect(gridDims(5)).toEqual({ cols: 3, rows: 2 });
		expect(gridDims(12)).toEqual({ cols: 4, rows: 3 });
		expect(gridDims(17)).toEqual({ cols: 5, rows: 4 });
	});

	it("0/음수/소수도 최소 1x1 보장", () => {
		expect(gridDims(0)).toEqual({ cols: 1, rows: 1 });
		expect(gridDims(-3)).toEqual({ cols: 1, rows: 1 });
		expect(gridDims(2.7)).toEqual({ cols: 2, rows: 1 });
	});
});

describe("srtTimeToSec", () => {
	it("HH:MM:SS,mmm → 초", () => {
		expect(srtTimeToSec("00:01:02,345")).toBeCloseTo(62.345);
		expect(srtTimeToSec("01:00:00,000")).toBe(3600);
	});

	it("'.' 구분자·짧은 ms 도 허용", () => {
		expect(srtTimeToSec("00:00:01.5")).toBeCloseTo(1.5);
	});

	it("형식 불일치는 null", () => {
		expect(srtTimeToSec("1:2:3")).toBeNull();
		expect(srtTimeToSec("garbage")).toBeNull();
	});
});

describe("parseSrtStats", () => {
	const SRT = [
		"1",
		"00:00:03,000 --> 00:00:08,500",
		"첫 씬",
		"",
		"2",
		"00:00:08,500 --> 00:00:15,200",
		"둘째 씬",
		"",
		"3",
		"00:00:15,200 --> 00:00:21,000",
		"셋째 씬",
		"",
	].join("\n");

	it("큐 수 + 마지막 종료 타임스탬프", () => {
		expect(parseSrtStats(SRT)).toEqual({ cueCount: 3, lastEndSec: 21.0 });
	});

	it("큐 순서가 뒤섞여도 종료 최댓값 사용", () => {
		const shuffled = [
			"1",
			"00:00:15,200 --> 00:00:21,000",
			"뒤 큐가 먼저",
			"",
			"2",
			"00:00:03,000 --> 00:00:08,500",
			"앞 큐가 나중",
			"",
		].join("\n");
		expect(parseSrtStats(shuffled)?.lastEndSec).toBe(21.0);
	});

	it("타임스탬프 없는 본문은 null", () => {
		expect(parseSrtStats("")).toBeNull();
		expect(parseSrtStats("자막 아님\n그냥 텍스트")).toBeNull();
	});
});

describe("buildChecks", () => {
	const BASE = {
		videoSec: 100,
		introOffsetSec: 3,
		outroSec: 5,
		toleranceSec: 2,
	};

	it("(a) 길이 정합: 인트로+오디오+아웃트로 ± tolerance", () => {
		// 기대 3 + 92 + 5 = 100 → 정확히 일치
		const ok = buildChecks({ ...BASE, audioSecTotal: 92 });
		expect(ok.find((c) => c.name === "video-duration")?.ok).toBe(true);
		// 기대 3 + 88 + 5 = 96, 실측 100 → 오차 4 > tol 2
		const bad = buildChecks({ ...BASE, audioSecTotal: 88 });
		expect(bad.find((c) => c.name === "video-duration")?.ok).toBe(false);
	});

	it("(a) audioSecTotal 없으면 길이 체크 스킵", () => {
		const checks = buildChecks(BASE);
		expect(checks.find((c) => c.name === "video-duration")).toBeUndefined();
	});

	it("(b) srt 꼬리: [영상길이-tol-outro, 영상길이] 안이면 통과", () => {
		// 하한 100 - 2 - 5 = 93
		const inRange = buildChecks({
			...BASE,
			srt: { cueCount: 10, lastEndSec: 94 },
		});
		expect(inRange.find((c) => c.name === "srt-tail")?.ok).toBe(true);
		// 영상보다 늦게 끝남 → 실패
		const over = buildChecks({
			...BASE,
			srt: { cueCount: 10, lastEndSec: 100.5 },
		});
		expect(over.find((c) => c.name === "srt-tail")?.ok).toBe(false);
		// 너무 일찍 끝남 → 실패
		const early = buildChecks({
			...BASE,
			srt: { cueCount: 10, lastEndSec: 80 },
		});
		expect(early.find((c) => c.name === "srt-tail")?.ok).toBe(false);
	});

	it("(c) 컷 수: srt 큐 수와 일치해야 통과, 둘 다 있어야 실행", () => {
		const match = buildChecks({
			...BASE,
			cutCount: 10,
			srt: { cueCount: 10, lastEndSec: 94 },
		});
		expect(match.find((c) => c.name === "cut-count")?.ok).toBe(true);
		const mismatch = buildChecks({
			...BASE,
			cutCount: 12,
			srt: { cueCount: 10, lastEndSec: 94 },
		});
		expect(mismatch.find((c) => c.name === "cut-count")?.ok).toBe(false);
		// srt 없으면 스킵
		const noSrt = buildChecks({ ...BASE, cutCount: 10 });
		expect(noSrt.find((c) => c.name === "cut-count")).toBeUndefined();
	});

	it("(d) 평균 컷 길이: (영상-카드)/컷수 >= 2.0s, 미달은 WARN detail", () => {
		// 본문 92s / 10컷 = 9.2s → 통과
		const ok = buildChecks({ ...BASE, cutCount: 10 });
		expect(ok.find((c) => c.name === "avg-cut-length")?.ok).toBe(true);
		// 본문 92s / 60컷 ≈ 1.53s → 미달
		const short = buildChecks({ ...BASE, cutCount: 60 });
		const check = short.find((c) => c.name === "avg-cut-length");
		expect(check?.ok).toBe(false);
		expect(check?.detail).toMatch(/^WARN:/);
	});
});

describe("summarizeChecks", () => {
	it("경고 수준(avg-cut-length/contact-sheet) 실패는 전체 판정 불변", () => {
		const checks: VerifyCheck[] = [
			{ name: "video-duration", ok: true },
			{ name: "avg-cut-length", ok: false },
			{ name: "contact-sheet", ok: false },
		];
		expect(summarizeChecks(checks)).toBe(true);
	});

	it("에러 수준 체크 실패는 전체 실패", () => {
		expect(
			summarizeChecks([
				{ name: "video-duration", ok: false },
				{ name: "avg-cut-length", ok: true },
			]),
		).toBe(false);
	});

	it("체크 0개면 통과(검사할 것 없음)", () => {
		expect(summarizeChecks([])).toBe(true);
	});
});

describe("contactSheetArgs", () => {
	it("컷수 기반 격자 + 균등 STEP 샘플링 + 1프레임 출력", () => {
		// 9컷 → 3x3 격자, 90s*30fps=2700f / 9타일 = step 300
		const args = contactSheetArgs("in.mp4", "sheet.png", 9, 90);
		expect(args).toContain("in.mp4");
		expect(args).toContain("sheet.png");
		const vf = args[args.indexOf("-vf") + 1];
		expect(vf).toBe("select='not(mod(n,300))',scale=320:-1,tile=3x3");
		expect(args[args.indexOf("-frames:v") + 1]).toBe("1");
	});

	it("cutCount 없으면 기본 12타일(4x3), 초단편도 step 최소 1", () => {
		const args = contactSheetArgs("in.mp4", "sheet.png", undefined, 0.1);
		const vf = args[args.indexOf("-vf") + 1];
		expect(vf).toContain("tile=4x3");
		expect(vf).toContain("mod(n,1)");
	});
});

describe("runVerifyOutput (페이크 exec 주입)", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "verify-output-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** ffprobe 는 durationSec 반환, ffmpeg 은 호출 기록만 남기는 페이크. */
	function fakeExec(
		durationSec: string,
		calls: { cmd: string; args: string[] }[],
	): ExecFn {
		return async (cmd, args) => {
			calls.push({ cmd, args });
			if (cmd === "ffprobe") return { stdout: `${durationSec}\n` };
			return { stdout: "" };
		};
	}

	it("정상 산출물: 전 체크 통과 + verify_report.json 기록", async () => {
		const srtPath = join(dir, "out.srt");
		// 3씬, 인트로 3s 오프셋, 마지막 종료 21s (make-economy .srt 형식)
		writeFileSync(
			srtPath,
			"1\n00:00:03,000 --> 00:00:09,000\nA\n\n2\n00:00:09,000 --> 00:00:15,000\nB\n\n3\n00:00:15,000 --> 00:00:21,000\nC\n",
		);
		const calls: { cmd: string; args: string[] }[] = [];
		// 영상 26s = 인트로 3 + 오디오 18 + 아웃트로 5
		const report = await runVerifyOutput({
			videoPath: join(dir, "out.mp4"),
			srtPath,
			audioSecTotal: 18,
			cutCount: 3,
			introOffsetSec: 3,
			outroSec: 5,
			execFn: fakeExec("26.0", calls),
		});
		expect(report.ok).toBe(true);
		expect(report.checks.map((c) => c.name)).toEqual([
			"video-duration",
			"srt-tail",
			"cut-count",
			"avg-cut-length",
		]);
		expect(report.checks.every((c) => c.ok)).toBe(true);
		// 보고서 파일이 영상 basename 파생 경로에 기록됨(배치 잡 간 충돌 방지)
		expect(report.reportPath).toBe(join(dir, "out.verify_report.json"));
		const written = JSON.parse(readFileSync(report.reportPath, "utf8"));
		expect(written.ok).toBe(true);
	});

	it("길이 불일치: report.ok=false + exit 대상", async () => {
		const calls: { cmd: string; args: string[] }[] = [];
		// 기대 3+18+5=26s 인데 실측 40s → tolerance(3컷=1.2s) 밖
		const report = await runVerifyOutput({
			videoPath: join(dir, "out.mp4"),
			audioSecTotal: 18,
			cutCount: 3,
			introOffsetSec: 3,
			outroSec: 5,
			execFn: fakeExec("40.0", calls),
		});
		expect(report.ok).toBe(false);
		expect(report.checks.find((c) => c.name === "video-duration")?.ok).toBe(
			false,
		);
	});

	it("contactSheet: ffmpeg 호출 인자 검증, 실패해도 warn 만", async () => {
		const calls: { cmd: string; args: string[] }[] = [];
		const report = await runVerifyOutput({
			videoPath: join(dir, "out.mp4"),
			audioSecTotal: 18,
			introOffsetSec: 3,
			outroSec: 5,
			contactSheet: true,
			execFn: fakeExec("26.0", calls),
		});
		const ffmpeg = calls.find((c) => c.cmd === "ffmpeg");
		expect(ffmpeg?.args).toContain(join(dir, "out.contact_sheet.png"));
		expect(report.checks.find((c) => c.name === "contact-sheet")?.ok).toBe(
			true,
		);

		// ffmpeg 이 던져도 전체 판정은 통과 유지
		const failing: ExecFn = async (cmd, _args) => {
			if (cmd === "ffmpeg") throw new Error("no ffmpeg");
			return { stdout: "26.0" };
		};
		const warned = await runVerifyOutput({
			videoPath: join(dir, "out.mp4"),
			audioSecTotal: 18,
			introOffsetSec: 3,
			outroSec: 5,
			contactSheet: true,
			execFn: failing,
		});
		expect(warned.ok).toBe(true);
		const sheet = warned.checks.find((c) => c.name === "contact-sheet");
		expect(sheet?.ok).toBe(false);
		expect(sheet?.detail).toMatch(/^WARN:/);
	});

	it("ffprobe 실패: 즉시 실패 보고(다른 체크 스킵) + 보고서 기록", async () => {
		const failing: ExecFn = async () => {
			throw new Error("ffprobe not found");
		};
		const reportPath = join(dir, "custom_report.json");
		const report = await runVerifyOutput({
			videoPath: join(dir, "out.mp4"),
			audioSecTotal: 18,
			execFn: failing,
			reportPath,
		});
		expect(report.ok).toBe(false);
		expect(report.checks).toHaveLength(1);
		expect(report.checks[0].name).toBe("ffprobe");
		expect(JSON.parse(readFileSync(reportPath, "utf8")).ok).toBe(false);
	});

	it("srt 파싱 실패(큐 0개): 하드 실패", async () => {
		const srtPath = join(dir, "broken.srt");
		writeFileSync(srtPath, "타임스탬프 없는 파일");
		const calls: { cmd: string; args: string[] }[] = [];
		const report = await runVerifyOutput({
			videoPath: join(dir, "out.mp4"),
			srtPath,
			execFn: fakeExec("26.0", calls),
		});
		expect(report.ok).toBe(false);
		expect(report.checks.find((c) => c.name === "srt-parse")?.ok).toBe(false);
	});
});
