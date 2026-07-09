/**
 * make-economy-real  (real-source economy short — the anti-cartoon path)
 *
 * Proves the "실제 경제 유튜버 편집" look end-to-end by assembling a short from
 * REAL source material instead of AI cartoons:
 *   - real chart screen-recording (TradingView/네이버) via chart-screen-record
 *   - real press-article screenshot via article-screenshot
 *   - black-bg big-caption text cards (hook / payoff)
 *   - local MeloTTS voice + Remotion burned-in 강조 자막
 *
 * NOTE: the beat SCRIPT here is a hand-authored sample topic (삼성전자) to
 * validate the visual/edit style. The next integration step feeds this same
 * assembly from make-economy's RSS+Claude grounded script generator so the
 * narration and the on-screen data always match a real current news item.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { remotionMotionFor } from "../src/lib/camera-movements.ts";
import { captureArticle } from "./article-screenshot.ts";
import { recordChartClip } from "./chart-screen-record.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";

const exec = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MELO_TTS =
	process.env.MELO_TTS ?? "/Users/jjuni/AI/video-factory/bin/tts-melo.sh";

type Asset =
	| { kind: "chart"; source: "tradingview" | "naver"; symbol: string }
	| { kind: "article"; url: string }
	| { kind: "card" };

interface Beat {
	id: string;
	narration: string;
	asset: Asset;
	cameraMove: "slow-zoom-in" | "slider-right" | "crash-zoom-in" | "handheld";
}

// Hand-authored sample beats (삼성전자). Numbers are spoken as trend claims that
// the on-screen real chart literally shows — no invented figures.
const BEATS: Beat[] = [
	{
		id: "hook",
		narration:
			"삼성전자, 지금 사도 되는 걸까요? 결론부터 말하면, 차트를 보면 답이 보입니다.",
		asset: { kind: "card" },
		cameraMove: "crash-zoom-in",
	},
	{
		id: "evidence",
		narration:
			"최근 증권가에서는 삼성전자를 두고 의견이 크게 엇갈리고 있습니다. 실제 기사부터 같이 보시죠.",
		asset: { kind: "article", url: "" }, // filled at runtime with a real article
		cameraMove: "slow-zoom-in",
	},
	{
		id: "chart-samsung",
		narration:
			"지난 일 년 흐름입니다. 크게 올랐다가 조정을 받고, 다시 반등하는 전형적인 변동성 구간이죠.",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:005930" },
		cameraMove: "handheld",
	},
	{
		id: "chart-kospi",
		narration:
			"중요한 건 개별 종목만이 아닙니다. 코스피 지수 전체 흐름과 같이 봐야 방향이 보입니다.",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSPI" },
		cameraMove: "slider-right",
	},
	{
		id: "payoff",
		narration:
			"핵심은 타이밍이 아니라 방향입니다. 지수와 실적, 두 가지가 같이 오를 때가 진짜 기회입니다.",
		asset: { kind: "card" },
		cameraMove: "slow-zoom-in",
	},
];

async function poster(clip: string, out: string): Promise<string> {
	await exec("ffmpeg", ["-y", "-ss", "1", "-i", clip, "-frames:v", "1", out]);
	return out;
}

async function blackCard(out: string): Promise<string> {
	await exec("ffmpeg", [
		"-y",
		"-f",
		"lavfi",
		"-i",
		"color=c=0x0b1326:s=1080x1920:d=1",
		"-frames:v",
		"1",
		out,
	]);
	return out;
}

async function ttsLocal(text: string, wav: string, mp3: string) {
	if (!existsSync(MELO_TTS)) {
		throw new Error(
			"MeloTTS 스크립트를 찾을 수 없습니다: " +
				MELO_TTS +
				" — MELO_TTS 환경변수로 경로를 지정하세요.",
		);
	}
	await exec(MELO_TTS, [
		text,
		wav,
		"kr",
		String(Math.min(2, Math.max(0.5, Number(process.env.TTS_SPEED) || 1.1))),
	]);
	await exec("ffmpeg", [
		"-y",
		"-i",
		wav,
		"-c:a",
		"libmp3lame",
		"-q:a",
		"2",
		mp3,
	]);
}

async function dur(mp3: string): Promise<number> {
	const { stdout } = await exec("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		mp3,
	]);
	return Math.max(1.5, Number.parseFloat(stdout.trim()) || 3);
}

async function realSamsungArticleUrl(): Promise<string> {
	// Pull a real, current 삼성전자 article from Naver News search.
	try {
		const res = await fetch(
			"https://search.naver.com/search.naver?where=news&query=" +
				encodeURIComponent("삼성전자 주가"),
			{ headers: { "User-Agent": "Mozilla/5.0" } },
		);
		const html = await res.text();
		const m = html.match(
			/https:\/\/n\.news\.naver\.com\/mnews\/article\/\d+\/\d+/,
		);
		if (m) return m[0];
	} catch {
		/* fall through */
	}
	// Fallback: economy section top article. 네트워크 실패해도 기본 URL 반환 —
	// 이 함수의 예외가 전체 파이프라인을 중단시키지 않도록 fetch 를 감싼다.
	try {
		const res = await fetch("https://news.naver.com/section/101", {
			headers: { "User-Agent": "Mozilla/5.0" },
		});
		const html = await res.text();
		const m = html.match(
			/https:\/\/n\.news\.naver\.com\/mnews\/article\/\d+\/\d+/,
		);
		if (m) return m[0];
	} catch {
		/* 네트워크 실패 → 기본 섹션 URL 로 폴백 */
	}
	return "https://news.naver.com/section/101";
}

async function main() {
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
	const workDir = join(PROJECT_ROOT, "output", "economy-real", `sam-${stamp}`);
	mkdirSync(workDir, { recursive: true });

	// Resolve the runtime article URL.
	const articleUrl = await realSamsungArticleUrl();
	process.stdout.write(`article: ${articleUrl}\n`);
	for (const b of BEATS)
		if (b.asset.kind === "article") b.asset.url = articleUrl;

	const made: {
		imageUrl: string;
		videoUrl?: string;
		audioUrl: string;
		narration: string;
		durationSec: number;
		cameraMove: ReturnType<typeof remotionMotionFor>;
	}[] = [];

	for (let i = 0; i < BEATS.length; i++) {
		const b = BEATS[i];
		process.stdout.write(
			`\n[${i + 1}/${BEATS.length}] ${b.id} (${b.asset.kind})\n`,
		);
		let imageUrl = "";
		let videoUrl: string | undefined;

		if (b.asset.kind === "chart") {
			const clip = join(workDir, `${b.id}.mp4`);
			if (!existsSync(clip))
				await recordChartClip({
					symbol: b.asset.symbol,
					source: b.asset.source,
					seconds: 7,
					orientation: "portrait",
					outPath: clip,
				});
			videoUrl = clip;
			imageUrl = await poster(clip, join(workDir, `${b.id}.png`));
		} else if (b.asset.kind === "article") {
			imageUrl = join(workDir, `${b.id}.png`);
			if (!existsSync(imageUrl))
				await captureArticle({ url: b.asset.url, outPath: imageUrl });
		} else {
			imageUrl = await blackCard(join(workDir, `${b.id}.png`));
		}

		const wav = join(workDir, `${b.id}.wav`);
		const mp3 = join(workDir, `${b.id}.mp3`);
		if (!existsSync(mp3)) await ttsLocal(b.narration, wav, mp3);

		made.push({
			imageUrl,
			videoUrl,
			audioUrl: mp3,
			narration: b.narration,
			durationSec: await dur(mp3),
			cameraMove: remotionMotionFor(b.cameraMove),
		});
	}

	const outPath = join(workDir, "economy-real-short.mp4");
	process.stdout.write("\nRemotion Shorts render...\n");
	await renderVlogRemotion({
		scenes: made,
		outPath,
		projectRoot: PROJECT_ROOT,
		compositionId: "YouTubeShorts",
		runId: `economy-real-${stamp}`,
		onProgress: (pct) => process.stdout.write(`\rrender ${pct}%`),
	});
	process.stdout.write("\n");

	writeFileSync(
		join(workDir, "manifest.json"),
		JSON.stringify(
			{
				title: "삼성전자, 지금 사도 될까?",
				output: outPath,
				articleUrl,
				beats: made,
			},
			null,
			2,
		),
	);
	process.stdout.write(`\n${outPath}\n`);
}

main().catch((e) => {
	process.stderr.write(`ERROR: ${e instanceof Error ? e.stack : e}\n`);
	process.exit(1);
});
