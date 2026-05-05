import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const DEFAULT_URL =
	"http://127.0.0.1:5174/content/new?template=builtin-auto-mystery-doc-aukyaprdjc&mode=research&source=reference_topic&title=%EA%B8%B0%EB%A1%9D%EC%97%90%EB%8A%94+%EB%82%A8%EC%95%98%EC%A7%80%EB%A7%8C+%EC%84%A4%EB%AA%85%EB%90%98%EC%A7%80+%EC%95%8A%EC%9D%80+%ED%95%9C%EA%B5%AD%EC%9D%98+%EB%AF%B8%EC%8A%A4%ED%84%B0%EB%A6%AC+%EC%9E%A5%EC%86%8C";

const url = process.argv.find((arg) => arg.startsWith("http")) ?? DEFAULT_URL;
const screenshotPath = resolve(
	process.cwd(),
	"test-screenshots/content-production-flow-preflight.png",
);

const requiredTexts = [
	"제작 파이프라인",
	"레퍼런스 적용 중",
	"이 주제로 추천되는 대본 방향",
	"AI 추천 주제",
	"다음: 브리프 생성",
];

async function visibleTextMissing() {
	const missing: string[] = [];
	for (const needle of requiredTexts) {
		const visible = await page
			.getByText(needle, { exact: false })
			.first()
			.isVisible({ timeout: 500 })
			.catch(() => false);
		if (!visible) missing.push(needle);
	}
	return missing;
}

async function verifyMainScrollContainer() {
	const before = await page.evaluate(() => {
		const main = document.querySelector("main");
		return {
			mainScrollTop: main?.scrollTop ?? 0,
			mainScrollHeight: main?.scrollHeight ?? 0,
			mainClientHeight: main?.clientHeight ?? 0,
			windowScrollY: window.scrollY,
		};
	});
	if (before.mainScrollHeight <= before.mainClientHeight + 40) {
		return {
			ok: false,
			reason: "main is not the vertical scroll container",
			before,
			after: before,
		};
	}

	await page.locator("main").hover();
	await page.mouse.wheel(0, 700);
	await page.waitForTimeout(250);

	const after = await page.evaluate(() => {
		const main = document.querySelector("main");
		return {
			mainScrollTop: main?.scrollTop ?? 0,
			mainScrollHeight: main?.scrollHeight ?? 0,
			mainClientHeight: main?.clientHeight ?? 0,
			windowScrollY: window.scrollY,
		};
	});
	await page.evaluate(() => {
		const main = document.querySelector("main");
		if (main) main.scrollTop = 0;
		window.scrollTo(0, 0);
	});

	return {
		ok: after.mainScrollTop > before.mainScrollTop && after.windowScrollY === 0,
		reason:
			after.mainScrollTop > before.mainScrollTop
				? ""
				: "wheel did not move main scrollTop",
		before,
		after,
	};
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors: string[] = [];
page.on("console", (message) => {
	if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
for (let attempt = 0; attempt < 45; attempt += 1) {
	const text = await page.locator("body").innerText().catch(() => "");
	const ready = (await visibleTextMissing()).length === 0;
	const settled = !text.includes("채널에 맞는 주제를 추천 중");
	if (ready && settled) break;
	await page.waitForTimeout(1000);
}

mkdirSync(dirname(screenshotPath), { recursive: true });
const scrollCheck = await verifyMainScrollContainer();
await page.screenshot({ path: screenshotPath, fullPage: false });
const missing = await visibleTextMissing();
await browser.close();
const unexpectedErrors = errors.filter(
	(error) =>
		!/React DevTools|favicon|Failed to load resource: net::ERR_ABORTED/.test(error),
);

const summary = {
	ok: missing.length === 0 && unexpectedErrors.length === 0 && scrollCheck.ok,
	url,
	screenshotPath,
	missing,
	scrollCheck,
	errors: unexpectedErrors.slice(-10),
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
