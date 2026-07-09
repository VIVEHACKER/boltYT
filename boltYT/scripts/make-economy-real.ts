/**
 * make-economy-real  (real-source economy short — the anti-cartoon path)
 *
 * "실제 경제 유튜버 편집" 룩을 REAL 소재로 조립하는 세로 숏폼:
 *   - real chart screen-recording (TradingView 지수) via chart-screen-record
 *   - real press-article screenshot via article-screenshot
 *   - black-bg big-caption text cards (hook / payoff)
 *   - local MeloTTS voice + Remotion burned-in 강조 자막
 *
 * 기본 = grounded: make-economy 의 RSS→기사선택→Claude 해설 파이프라인(export 재사용)으로
 * 실제 현재 뉴스 기사에 근거해 나레이션을 생성한다. 화면의 기사 스크린샷·지수 차트가
 * 나레이션과 일치한다. 지수 방향/수치는 단정하지 않는다(화면의 실제 차트가 값을 보여주므로 —
 * 하드코딩 방향 주장 회귀 방지). YMYL 안전: ECON_SYSTEM + looksLikeAdvice 사후 게이트(fail-closed).
 *
 * --sample: 백엔드(api-proxy) 없이 시각/편집 스타일만 검증하는 하드코딩 삼성전자 샘플 경로.
 *
 * 전제(grounded): api-proxy(:3459, LLM_BACKEND=claude) + MeloTTS + ffmpeg + Playwright chromium + 네트워크.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { remotionMotionFor } from "../src/lib/camera-movements.ts";
import { captureArticle } from "./article-screenshot.ts";
import { recordChartClip } from "./chart-screen-record.ts";
import {
	DEFAULT_FEEDS,
	ECON_SYSTEM,
	fetchArticleBody,
	fetchFeed,
	type Grounding,
	groundingContext,
	pickArticle,
	publisherFromUrl,
	relatedArticles,
} from "./make-economy.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";
import { proxyChatJSON } from "./vlog-shared.ts";

const exec = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MELO_TTS =
	process.env.MELO_TTS ?? "/Users/jjuni/AI/video-factory/bin/tts-melo.sh";

// 하드 YMYL 게이트(fail-closed)는 '권유·예측' 어투만 잡는다. make-economy 의
// containsInvestmentAdvice 는 bare 매수|매도 를 매칭해 사실 서술형 수급 용어(순매수/매도세/
// 외국인 매수)에 오탐하므로, 여기선 권유·예측 문맥만 좁게 잡는 전용 패턴을 쓴다.
const ADVICE_RE =
	/사세요|파세요|사야\s*(합니다|해요|한다|된다|됩니다|겠)|팔아야|담으세요|담아라|손절|익절|목표\s*주?가|저점\s*매수|고점\s*매도|불타기|물타기|추천\s*종목|유망\s*종목|수익\s*(을|률)?\s*보장|반드시\s*(오른|내린|상승|하락)|지금\s*(사|들어가|매수|매도)|매수\s*(하세요|추천|타이밍|기회|시점|의견)|매도\s*(하세요|추천|신호|타이밍|시점|의견)|(오를|내릴|상승할|하락할)\s*(것|가능성|전망)|비중\s*(확대|축소)|사면\s*(됩니다|된다|돼)|보유해도\s*(됩니다|된다|좋)|장기\s*보유\s*(하|추천|권)|(상승|하락|강세|약세)\s*전망|투자\s*의견/;
function looksLikeAdvice(text: string): boolean {
	return ADVICE_RE.test(text);
}

// 지수(KOSPI/KOSDAQ) 차트 비트가 기사 주제와 어긋나지 않도록 증시·시장 관련 기사만 후보로.
const MARKET_RE =
	/증시|코스피|코스닥|주가|증권|시장|지수|환율|금리|채권|외국인|기관|상장|실적|반도체|수출|무역|경기|성장률|물가|인플레|투자심리|나스닥|다우|국채/;

type Asset =
	| { kind: "chart"; source: "tradingview" | "naver"; symbol: string }
	| { kind: "article"; url: string }
	| { kind: "card" };

type CameraMove =
	| "slow-zoom-in"
	| "slider-right"
	| "crash-zoom-in"
	| "handheld";

interface Beat {
	id: string;
	narration: string;
	asset: Asset;
	cameraMove: CameraMove;
}

// 비트 골격(역할/자산/카메라무빙) — narration 은 grounded LLM 이 채운다. 지수 차트는
// KOSPI/KOSDAQ(시장 전체 지수)만 사용: 항상 사실적으로 유효 + 종목→티커 매핑 불필요 +
// 개별종목 방향 단정 회피(YMYL). 역할 문자열은 LLM 프롬프트에 그대로 들어간다.
const GROUNDED_PLAN: {
	id: string;
	role: string;
	asset: Asset;
	cameraMove: CameraMove;
}[] = [
	{
		id: "hook",
		role: "hook: 숫자나 반전으로 강하게 시작해 0~3초 이탈을 막는 훅 한 문장",
		asset: { kind: "card" },
		cameraMove: "crash-zoom-in",
	},
	{
		id: "evidence",
		role: "evidence: '실제 기사를 보자'는 흐름으로 이 뉴스가 왜 중요한지 한 문장",
		asset: { kind: "article", url: "" },
		cameraMove: "slow-zoom-in",
	},
	{
		id: "chart-kospi",
		role: "market_kospi: 코스피(시장 전체) 지수를 왜 같이 봐야 하는지. 지수의 방향·수치는 단정하지 말 것(화면 차트가 실제 값을 보여준다)",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSPI" },
		cameraMove: "handheld",
	},
	{
		id: "chart-kosdaq",
		role: "market_kosdaq: 코스닥(성장주 시장)까지 넓혀 보는 맥락. 역시 방향·수치 단정 금지",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSDAQ" },
		cameraMove: "slider-right",
	},
	{
		id: "payoff",
		role: "payoff: 투자 조언 없이 이 뉴스를 어떻게 바라보면 좋을지 관점으로 마무리",
		asset: { kind: "card" },
		cameraMove: "slow-zoom-in",
	},
];

// --sample: 백엔드 없이 시각/편집 스타일만 검증하는 하드코딩 삼성전자 경로(방향 주장은 샘플용).
const SAMPLE_BEATS: Beat[] = [
	{
		id: "hook",
		narration:
			"삼성전자를 두고 시장의 시선이 엇갈립니다. 차트부터 같이 보시죠.",
		asset: { kind: "card" },
		cameraMove: "crash-zoom-in",
	},
	{
		id: "evidence",
		narration:
			"최근 증권가에서는 삼성전자를 두고 의견이 크게 엇갈리고 있습니다. 실제 기사부터 같이 보시죠.",
		asset: { kind: "article", url: "" },
		cameraMove: "slow-zoom-in",
	},
	{
		id: "chart-kospi",
		narration:
			"개별 종목만이 아닙니다. 코스피 지수 흐름과 같이 봐야 시장 전체 분위기가 보입니다.",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSPI" },
		cameraMove: "handheld",
	},
	{
		id: "chart-kosdaq",
		narration:
			"코스닥까지 넓혀 보면 성장주 시장의 온도까지 함께 읽을 수 있습니다.",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSDAQ" },
		cameraMove: "slider-right",
	},
	{
		id: "payoff",
		narration:
			"핵심은 타이밍이 아니라 방향입니다. 지수와 실적을 같이 보는 습관이 먼저입니다.",
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
	// --sample 전용: 실제 현재 삼성전자 기사를 네이버 뉴스 검색에서 1건.
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

/**
 * grounded 나레이션 — 실제 기사(grounding)에 근거해 GROUNDED_PLAN 역할별 문장 생성.
 * YMYL: ECON_SYSTEM(투자조언 금지) + looksLikeAdvice 사후 게이트(권유·예측 어투만 좁게 잡음).
 * 개수 미달·YMYL 위반 시 1회 재생성 후에도 불만족이면 fail-closed(throw → 격리).
 */
async function groundedNarrations(g: Grounding): Promise<string[]> {
	const roles = GROUNDED_PLAN.map((b, i) => `${i + 1}. ${b.role}`).join("\n");
	const usr = `${groundingContext(g)}\n\n위 자료의 '사실에만' 근거해, 세로 숏폼 경제 뉴스 해설의 ${GROUNDED_PLAN.length}개 씬 나레이션을 쓴다. 각 씬은 한국어 1문장, 짧고 임팩트 있는 구어체(숏폼 템포). 아래 역할·순서를 그대로 따르고 각 항목 1문장씩:\n${roles}\n투자 조언·종목 추천·매수매도 권유·가격 예측·기사에 없는 수치 창작 절대 금지(YMYL).\nJSON: {"beats":[{"narration":"..."}]}`;
	const attempt = async (): Promise<string[]> => {
		const parsed = (await proxyChatJSON(ECON_SYSTEM, usr)) as {
			beats?: { narration?: string }[];
		};
		return (Array.isArray(parsed.beats) ? parsed.beats : [])
			.map((b) => (b?.narration ?? "").trim())
			.filter(Boolean);
	};
	const bad = (ls: string[]) =>
		ls.length < GROUNDED_PLAN.length ||
		ls.slice(0, GROUNDED_PLAN.length).some(looksLikeAdvice);

	let lines = await attempt();
	if (bad(lines)) {
		process.stdout.write("   grounded 나레이션 재생성(개수/YMYL 미달)...\n");
		const retry = await attempt();
		if (!bad(retry)) lines = retry;
	}
	if (lines.length < GROUNDED_PLAN.length)
		throw new Error(
			`grounded 나레이션 불완전(${lines.length}/${GROUNDED_PLAN.length}씬) — 재실행 권장`,
		);
	const flagged = lines
		.slice(0, GROUNDED_PLAN.length)
		.findIndex(looksLikeAdvice);
	if (flagged >= 0)
		throw new Error(
			`YMYL 위반 나레이션(씬 ${flagged + 1}) — 재실행 권장(fail-closed)`,
		);
	return lines.slice(0, GROUNDED_PLAN.length);
}

/** grounded 비트 조립 — 역할 골격 + LLM 나레이션 + 실제 기사 URL. */
function buildGroundedBeats(narrations: string[], articleUrl: string): Beat[] {
	return GROUNDED_PLAN.map((p, i) => ({
		id: p.id,
		narration: narrations[i],
		asset:
			p.asset.kind === "article" ? { ...p.asset, url: articleUrl } : p.asset,
		cameraMove: p.cameraMove,
	}));
}

async function main() {
	const sample = process.argv.slice(2).includes("--sample");
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
	const workDir = join(
		PROJECT_ROOT,
		"output",
		"economy-real",
		`${sample ? "sam" : "eco"}-${stamp}`,
	);
	mkdirSync(workDir, { recursive: true });

	let beats: Beat[];
	let title: string;
	let attribution = "";
	let articleUrl: string;

	if (sample) {
		process.stdout.write("모드: --sample (하드코딩 삼성전자, 백엔드 불필요)\n");
		articleUrl = await realSamsungArticleUrl();
		beats = SAMPLE_BEATS.map((b) =>
			b.asset.kind === "article"
				? { ...b, asset: { ...b.asset, url: articleUrl } }
				: b,
		);
		title = "삼성전자, 지금 시장은 어떻게 볼까?";
	} else {
		process.stdout.write("1) 경제 RSS 수집 + 기사 선택...\n");
		const items = await fetchFeed(DEFAULT_FEEDS);
		if (items.length === 0)
			throw new Error("RSS 수집 실패 (네트워크/피드 확인)");
		// YMYL: 목표가·투자의견 등 금칙 어투가 제목/요약에 있는 기사는 후보에서 제외
		// (기사 스크린샷 자체가 가격 예측을 노출하지 않도록). 그다음 지수 차트 비트와
		// 주제가 어긋나지 않게 증시·시장 관련을 우선하되, 없거나 모두 unusable 이면 안전 기사 전체로 폴백.
		const safeItems = items.filter(
			(it) => !looksLikeAdvice(`${it.title} ${it.description ?? ""}`),
		);
		const marketItems = safeItems.filter((it) =>
			MARKET_RE.test(`${it.title} ${it.description ?? ""}`),
		);
		const article =
			pickArticle(marketItems, new Set<string>()) ??
			pickArticle(safeItems, new Set<string>());
		if (!article) throw new Error("영상화 가능한 미사용(비-조언) 기사 없음");
		articleUrl = article.link;
		attribution = publisherFromUrl(article.link);
		title = article.title;
		process.stdout.write(`   선택: ${article.title}\n`);

		process.stdout.write(
			"2) 본문 + 관련 보도 + grounded 나레이션(Claude)...\n",
		);
		const body = await fetchArticleBody(article.link);
		const related = relatedArticles(items, article, new Set<string>());
		const grounding: Grounding = { primary: article, body, related };
		const narrations = await groundedNarrations(grounding);
		beats = buildGroundedBeats(narrations, articleUrl);
	}

	process.stdout.write(`article: ${articleUrl}\n`);

	// 최종 YMYL 게이트(grounded/sample 공통, fail-closed) — 나레이션·제목의 권유·예측 어투 차단.
	const adviceIdx = beats.findIndex((b) => looksLikeAdvice(b.narration));
	if (adviceIdx >= 0)
		throw new Error(
			`YMYL 위반 나레이션(씬 ${adviceIdx + 1}: "${beats[adviceIdx].narration}") — 재실행/샘플 수정 필요`,
		);
	if (looksLikeAdvice(title)) throw new Error(`YMYL 위반 제목: "${title}"`);

	const made: {
		imageUrl: string;
		videoUrl?: string;
		audioUrl: string;
		narration: string;
		durationSec: number;
		cameraMove: ReturnType<typeof remotionMotionFor>;
	}[] = [];

	for (let i = 0; i < beats.length; i++) {
		const b = beats[i];
		process.stdout.write(
			`\n[${i + 1}/${beats.length}] ${b.id} (${b.asset.kind})\n`,
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
				grounded: !sample,
				title,
				attribution,
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
