/**
 * chart-screen-record
 *
 * Records a REAL market chart as a screen-capture clip (the "자료화면" look real
 * faceless economy YouTubers use), instead of drawing a fake AI chart.
 *
 * Uses the TradingView embeddable Advanced Chart widget (no login, KRX symbols
 * supported) loaded in Playwright with recordVideo, then simulates a human
 * cursor moving across the latest candles, and finally muxes webm -> mp4.
 *
 * CLI:
 *   npx tsx scripts/chart-screen-record.ts --symbol KRX:005930 --seconds 8 \
 *     --out output/charts/samsung.mp4 --interval D --theme dark
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const exec = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface ChartClipOptions {
	/**
	 * For source="tradingview": a TradingView symbol, e.g. "KRX:005930"
	 * (삼성전자), "KRX:KOSPI", "FX_IDC:USDKRW".
	 * For source="naver": a 6-digit KRX code, e.g. "005930".
	 */
	symbol: string;
	/** Chart source. "naver" = 네이버 금융 (진짜 한국 자료화면), "tradingview" = 다크 캔들. */
	source?: "tradingview" | "naver";
	/** Seconds of footage to record (after the chart has settled). */
	seconds?: number;
	/** Output mp4 path. */
	outPath: string;
	/** Candle interval: "D" | "60" | "W" ... (TradingView interval codes). */
	interval?: string;
	/** "dark" | "light". */
	theme?: "dark" | "light";
	/** Portrait 9:16 (1080x1920) for shorts, else landscape 1920x1080. */
	orientation?: "portrait" | "landscape";
}

/** Seconds of lead-in (page load + modal dismiss + chart settle) trimmed off the front. */
const LEAD_IN_SEC = 6;

/** 실측 지수 시세(그라운디드 차트 씬 나레이션 근거용). */
export interface IndexQuote {
	/** 네이버 폴링 코드(KOSPI/KOSDAQ). */
	symbol: string;
	/** 한글 지수명(코스피/코스닥). */
	name: string;
	/** 종가/현재 지수값. */
	value: number;
	/** 전일 대비 등락률(%). 음수=하락. */
	changeRate: number;
	/** 방향(한글, 나레이션 검증용). */
	direction: "상승" | "하락" | "보합";
	/** 시세 시각(ISO, KST). */
	asOf: string;
	/** OPEN/CLOSE 등 시장 상태. */
	marketStatus: string;
}

/** TradingView 심볼(KRX:KOSPI) → 네이버 폴링 지수 코드(KOSPI). 지수만 지원. */
export function naverIndexCode(symbol: string): string | null {
	const upper = symbol.trim().toUpperCase();
	const bare = upper.replace(/^KRX:/, "");
	return bare === "KOSPI" || bare === "KOSDAQ" ? bare : null;
}

/** 네이버 폴링 응답 JSON → IndexQuote. 형식 오류/빈 데이터는 null(파괴적 실패 대신 폴백). */
export function parseIndexQuote(
	value: unknown,
	symbol: string,
): IndexQuote | null {
	if (!value || typeof value !== "object") return null;
	const datas = (value as { datas?: unknown }).datas;
	if (!Array.isArray(datas) || datas.length === 0) return null;
	const d = datas[0] as Record<string, unknown>;
	const num = (raw: unknown): number | null => {
		if (typeof raw !== "string" && typeof raw !== "number") return null;
		const parsed = Number.parseFloat(String(raw).replace(/,/g, ""));
		return Number.isFinite(parsed) ? parsed : null;
	};
	const val = num(d.closePriceRaw);
	const rate = num(d.fluctuationsRatioRaw);
	if (val === null || rate === null) return null;
	const dirText =
		typeof d.compareToPreviousPrice === "object" && d.compareToPreviousPrice
			? (d.compareToPreviousPrice as { text?: unknown }).text
			: undefined;
	const direction: IndexQuote["direction"] =
		rate > 0 || dirText === "상승"
			? "상승"
			: rate < 0 || dirText === "하락"
				? "하락"
				: "보합";
	return {
		symbol,
		name: typeof d.stockName === "string" ? d.stockName : symbol,
		value: val,
		changeRate: rate,
		direction,
		asOf: typeof d.localTradedAt === "string" ? d.localTradedAt : "",
		marketStatus: typeof d.marketStatus === "string" ? d.marketStatus : "",
	};
}

/**
 * KOSPI/KOSDAQ 실측 시세를 네이버 폴링 API에서 취득한다(로그인·키 불필요).
 * 지수가 아니거나 취득 실패 시 null → 호출부는 실측 없이 중립 프레이밍으로 폴백한다.
 */
export async function fetchIndexQuote(
	symbol: string,
	fetchFn: typeof fetch = fetch,
): Promise<IndexQuote | null> {
	const code = naverIndexCode(symbol);
	if (!code) return null;
	try {
		const res = await fetchFn(
			`https://polling.finance.naver.com/api/realtime/domestic/index/${code}`,
			{
				headers: {
					"User-Agent": "Mozilla/5.0",
					Referer: "https://finance.naver.com/",
				},
				signal: AbortSignal.timeout(10_000),
			},
		);
		if (!res.ok) return null;
		return parseIndexQuote(await res.json(), code);
	} catch {
		return null;
	}
}

function tvWidgetUrl(o: ChartClipOptions): string {
	const params = new URLSearchParams({
		symbol: o.symbol,
		interval: o.interval ?? "D",
		theme: o.theme ?? "dark",
		style: "1", // candles
		timezone: "Asia/Seoul",
		locale: "kr",
		hideideas: "1",
		hidesidetoolbar: "0",
		symboledit: "0",
		saveimage: "0",
		withdateranges: "1",
		allow_symbol_change: "0",
	});
	return `https://s.tradingview.com/widgetembed/?${params.toString()}`;
}

function naverFchartUrl(code: string): string {
	// 네이버는 순수 6자리 종목코드만 받는다. TradingView 스타일 "KRX:005930" 같은
	// 거래소 접두어/비숫자를 제거해 기본 심볼(KRX:005930)로도 네이버 소스가 동작하게 정규화.
	const naverCode = code.replace(/[^0-9]/g, "");
	if (!/^\d{6}$/.test(naverCode)) {
		throw new Error(
			`네이버 차트는 6자리 종목코드만 지원합니다(입력: "${code}"). 지수/비종목 심볼은 source="tradingview"를 쓰세요.`,
		);
	}
	// The dedicated interactive candle chart page (pure chart, no site chrome).
	return `https://finance.naver.com/item/fchart.naver?code=${naverCode}`;
}

/** Dismiss the TradingView "심볼 제공" 알림 modal (and any consent dialog). */
async function dismissModals(page: import("playwright").Page): Promise<void> {
	const clickers = [
		() =>
			page
				.getByRole("button", { name: /확인|OK|Accept|Got it|동의|Agree/ })
				.first()
				.click({ timeout: 2500 }),
		() =>
			page
				.locator(".tv-dialog__close, button[data-name='close']")
				.first()
				.click({ timeout: 2000 }),
		() => page.keyboard.press("Escape"),
	];
	for (const c of clickers) {
		await c().catch(() => {});
	}
}

export async function recordChartClip(o: ChartClipOptions): Promise<string> {
	const seconds = o.seconds ?? 8;
	const width = o.orientation === "landscape" ? 1920 : 1080;
	const height = o.orientation === "landscape" ? 1080 : 1920;

	mkdirSync(dirname(o.outPath), { recursive: true });
	const chartsDir = join(PROJECT_ROOT, "output", "charts");
	mkdirSync(chartsDir, { recursive: true });
	// 병렬 배치에서 같은 ms Date.now() 충돌로 서로의 webm 을 지우지 않도록 충돌 불가 임시 디렉토리 사용.
	const tmpDir = mkdtempSync(join(chartsDir, "_rec-"));

	try {
		const browser = await chromium.launch({ headless: true });
		let webm = "";
		try {
			const context = await browser.newContext({
				viewport: { width, height },
				deviceScaleFactor: 1,
				recordVideo: { dir: tmpDir, size: { width, height } },
			});
			const page = await context.newPage();
			const source = o.source ?? "tradingview";
			const url =
				source === "naver" ? naverFchartUrl(o.symbol) : tvWidgetUrl(o);
			await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
			await page.waitForTimeout(1500);
			// TradingView shows a "심볼 제공" 알림 modal that covers the chart; dismiss it.
			if (source === "tradingview") await dismissModals(page);
			// Let the chart draw candles + axes + ticker chrome (part of LEAD_IN, trimmed).
			await page.waitForTimeout(LEAD_IN_SEC * 1000 - 1500);

			// Simulate a human reading the chart: sweep the cursor across the most
			// recent candles (right side), pausing on the last price. This gives the
			// crosshair/cursor motion that reads as a real screen recording.
			const steps = Math.max(6, Math.round((seconds * 1000) / 550));
			const y = Math.round(
				height * (o.orientation === "landscape" ? 0.45 : 0.4),
			);
			for (let i = 0; i < steps; i++) {
				const t = i / (steps - 1);
				// move from ~60% to ~92% width (recent candles), then settle on last.
				const x = Math.round(width * (0.6 + 0.32 * t));
				await page.mouse.move(x, y + Math.round(Math.sin(t * Math.PI) * 40));
				await page.waitForTimeout(Math.round((seconds * 1000) / steps));
			}
			await page.waitForTimeout(500);

			const video = page.video();
			await context.close(); // finalizes the video file
			webm = video ? await video.path() : "";
		} finally {
			await browser.close();
		}

		if (!webm || !existsSync(webm)) {
			throw new Error("Playwright did not produce a video file");
		}

		// webm -> mp4 at exact target size. Trim the LEAD_IN off the front.
		// ALL-INTRA (-g 1) + constant 30fps + faststart so Remotion's frame-accurate
		// seeking during render is instant — sparse keyframes make <Html5Video> time
		// out (delayRender not cleared). yuv420p + high profile for broad decode.
		await exec("ffmpeg", [
			"-y",
			"-ss",
			String(LEAD_IN_SEC),
			"-i",
			webm,
			"-vf",
			`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuv420p`,
			"-r",
			"30",
			"-c:v",
			"libx264",
			"-preset",
			"medium",
			"-crf",
			"20",
			"-g",
			"1",
			"-keyint_min",
			"1",
			"-profile:v",
			"high",
			"-movflags",
			"+faststart",
			"-an",
			o.outPath,
		]);

		return o.outPath;
	} finally {
		// tmp 원본 webm 정리 — 성공/실패 무관(예외 경로에서 _rec-* 디렉토리 누수 방지).
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) out[key] = "true";
		else {
			out[key] = next;
			i++;
		}
	}
	return out;
}

const isMain = process.argv[1]
	? fileURLToPath(import.meta.url) === process.argv[1] ||
		process.argv[1].endsWith("chart-screen-record.ts")
	: false;

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	const symbol = args.symbol ?? "KRX:005930";
	const outPath =
		args.out ?? join(PROJECT_ROOT, "output", "charts", "sample-chart.mp4");
	recordChartClip({
		symbol,
		source: (args.source as "tradingview" | "naver") ?? "tradingview",
		seconds: args.seconds ? Number(args.seconds) : 8,
		outPath,
		interval: args.interval,
		theme: (args.theme as "dark" | "light") ?? "dark",
		orientation: (args.orientation as "portrait" | "landscape") ?? "portrait",
	})
		.then((p) => process.stdout.write(`\n${p}\n`))
		.catch((e) => {
			process.stderr.write(`ERROR: ${e instanceof Error ? e.stack : e}\n`);
			process.exit(1);
		});
}
