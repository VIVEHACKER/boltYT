/**
 * article-screenshot
 *
 * Captures a REAL press-article page as a screenshot (the "증거화면" beat real
 * economy YouTubers use), then returns the image path. A later Remotion overlay
 * draws the red-underline / yellow-highlighter on the key sentence.
 *
 * This deliberately screenshots the actual 언론사 page (real fonts, real layout,
 * publisher chrome) rather than re-rendering a fake headline card — that
 * heterogeneous "real source" texture is a core authenticity signal.
 *
 * CLI:
 *   npx tsx scripts/article-screenshot.ts --url "https://n.news.naver.com/..." \
 *     --out output/shots/article.png
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface ArticleShotOptions {
	url: string;
	outPath: string;
	/** Portrait crop for shorts (1080 wide). Height auto from captured region. */
	width?: number;
	/** Capture the whole page (true) or just the above-the-fold headline region. */
	fullPage?: boolean;
}

export async function captureArticle(o: ArticleShotOptions): Promise<string> {
	const width = o.width ?? 1080;
	mkdirSync(dirname(o.outPath), { recursive: true });

	const browser = await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({
			viewport: { width, height: 1600 },
			deviceScaleFactor: 2, // crisp text
			locale: "ko-KR",
			userAgent:
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
		});
		const page = await context.newPage();
		await page.goto(o.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
		await page.waitForTimeout(2500);

		// Dismiss common consent/app-open banners that dirty the shot.
		for (const sel of [
			"button:has-text('동의')",
			"button:has-text('확인')",
			"button:has-text('닫기')",
			".u_cbox_close",
		]) {
			await page
				.locator(sel)
				.first()
				.click({ timeout: 1200 })
				.catch(() => {});
		}
		await page.waitForTimeout(400);

		// Prefer the article body element when present (naver news / common CMS),
		// else fall back to the above-the-fold region.
		const target = page
			.locator("#dic_area, #newsct_article, article, #articleBodyContents")
			.first();
		const hasTarget = await target
			.count()
			.then((c) => c > 0)
			.catch(() => false);
		if (hasTarget && !o.fullPage) {
			await target.screenshot({ path: o.outPath }).catch(async () => {
				await page.screenshot({ path: o.outPath, fullPage: false });
			});
		} else {
			await page.screenshot({ path: o.outPath, fullPage: !!o.fullPage });
		}
		return o.outPath;
	} finally {
		await browser.close();
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
	? process.argv[1].endsWith("article-screenshot.ts")
	: false;

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	if (!args.url) {
		process.stderr.write("ERROR: --url required\n");
		process.exit(1);
	}
	captureArticle({
		url: args.url,
		outPath: args.out ?? join(PROJECT_ROOT, "output", "shots", "article.png"),
		fullPage: args.fullPage === "true",
	})
		.then((p) => process.stdout.write(`\n${p}\n`))
		.catch((e) => {
			process.stderr.write(`ERROR: ${e instanceof Error ? e.stack : e}\n`);
			process.exit(1);
		});
}
