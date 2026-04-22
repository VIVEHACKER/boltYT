import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { chromium } from "playwright";

const BASE = "http://localhost:5174";
const TOPIC = "미스테리 살인 사건";
const KEYS_FILE = "/Users/jjuni/bolt/boltYT/.api-keys.json";

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
function ask(q) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((r) =>
		rl.question(q, (a) => {
			rl.close();
			r(a.trim());
		}),
	);
}

async function clickBtn(page, text) {
	for (const btn of await page.locator("p-button, button").all()) {
		const t = (await btn.textContent().catch(() => "")).trim();
		if (t.includes(text)) {
			await btn.click();
			return true;
		}
	}
	return false;
}

(async () => {
	// API 키 로드 또는 입력
	let apiKeys = {};
	if (existsSync(KEYS_FILE)) {
		apiKeys = JSON.parse(readFileSync(KEYS_FILE, "utf8"));
		console.log("저장된 API 키 로드 완료");
	}
	if (!apiKeys.openai) {
		apiKeys.openai = await ask("OpenAI API 키: ");
		apiKeys.naverId = await ask("네이버 Client ID (없으면 Enter): ");
		apiKeys.naverSecret = await ask("네이버 Client Secret (없으면 Enter): ");
		(await import("node:fs")).writeFileSync(KEYS_FILE, JSON.stringify(apiKeys));
		console.log(`키 저장 완료 → ${KEYS_FILE}`);
	}

	const browser = await chromium.launch({ headless: false, slowMo: 150 });
	const ctx = await browser.newContext({
		viewport: { width: 1400, height: 900 },
	});
	const page = await ctx.newPage();

	// localStorage에 키 주입
	await page.goto(BASE);
	await sleep(1000);
	await page.evaluate((keys) => {
		localStorage.setItem("openai_api_key", keys.openai);
		if (keys.naverId) localStorage.setItem("naver_client_id", keys.naverId);
		if (keys.naverSecret)
			localStorage.setItem("naver_client_secret", keys.naverSecret);
	}, apiKeys);
	console.log("✅ API 키 주입 완료\n");

	// 콘텐츠 생성
	await page.goto(`${BASE}/content/new`);
	await sleep(2000);

	console.log("[모드] 자료 기반 제작...");
	await page
		.getByText("자료 기반 제작")
		.click()
		.catch(() => {});
	await sleep(2000);

	console.log(`[Step1] 주제: ${TOPIC}`);
	for (const inp of await page.locator("input").all()) {
		if (await inp.isVisible().catch(() => false)) {
			await inp.fill(TOPIC);
			break;
		}
	}
	await clickBtn(page, "다음");
	await sleep(3000);

	console.log("[Step2] 검색...");
	for (const inp of await page.locator("input").all()) {
		if (await inp.isVisible().catch(() => false)) {
			await inp.fill(TOPIC);
			break;
		}
	}
	await clickBtn(page, "검색");
	await sleep(10000);
	await page.screenshot({ path: "test-screenshots/search.png" });

	let added = 0;
	for (const btn of await page.locator("p-button, button").all()) {
		const t = (await btn.textContent().catch(() => "")).trim();
		if (t.includes("추가") && added < 5) {
			await btn.click();
			added++;
			await sleep(500);
		}
	}
	console.log(`  소스 ${added}개 추가`);
	await clickBtn(page, "다음");
	await sleep(3000);

	console.log("[Step3] 브리프...");
	await clickBtn(page, "생성");
	await sleep(25000);
	await page.screenshot({ path: "test-screenshots/brief.png" });
	await clickBtn(page, "다음");
	await sleep(3000);

	console.log("[Step4] 스크립트...");
	await clickBtn(page, "생성");
	for (let i = 0; i < 18; i++) {
		await sleep(5000);
		if ((await page.textContent("body").catch(() => "")).includes("씬")) break;
	}
	await page.screenshot({ path: "test-screenshots/script.png" });
	await clickBtn(page, "다음");
	await sleep(3000);

	console.log("[Step5] 미디어 생성...");
	(await clickBtn(page, "일괄")) || (await clickBtn(page, "미디어"));
	for (let i = 0; i < 30; i++) {
		await sleep(10000);
		if (
			(await page.textContent("body").catch(() => "")).includes(
				"모든 미디어 생성 완료",
			)
		) {
			console.log("  ✅ 미디어 완료!");
			break;
		}
		if (i % 3 === 0) console.log(`  진행중... ${i * 10}초`);
	}
	await page.screenshot({ path: "test-screenshots/media-done.png" });
	await clickBtn(page, "다음");
	await sleep(5000);

	console.log("[Step6] 미리보기!");
	await page.screenshot({ path: "test-screenshots/preview.png" });
	console.log("\n✅ 완료! 브라우저에서 확인하세요.");
	await sleep(600000);
	await browser.close();
})();
