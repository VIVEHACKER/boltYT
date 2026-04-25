/**
 * TimelineEditor E2E — /content/:id/editor 핵심 경로 검증.
 *
 * DEMO_MODE: supabase = localStorage 기반 local-db.
 * page.evaluate()로 `db:scenes` / `db:scripts` 를 시딩해 에디터를 풀 렌더한다.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const SCRIPT_ID = "e2e-test-script-001";
const EDITOR_URL = `/content/${SCRIPT_ID}/editor`;

function trackErrors(page: Page) {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
	});
	return () =>
		errors.filter(
			(e) =>
				!/favicon|manifest\.json|Failed to load resource|DevTools|React DevTools/i.test(
					e,
				),
		);
}

/** 최소 Scene 1개를 localStorage에 시딩 */
async function seedScene(page: Page) {
	await page.evaluate((scriptId: string) => {
		const scene = {
			id: "scene-e2e-01",
			script_id: scriptId,
			order_index: 0,
			narration_text: "E2E 테스트 씬",
			scene_type: "image",
			visual_prompt: "test",
			duration_seconds: 3,
		};
		const script = { id: scriptId, format: "longform" };
		localStorage.setItem("db:scenes", JSON.stringify([scene]));
		localStorage.setItem("db:scripts", JSON.stringify([script]));
		localStorage.setItem("db:media_assets", JSON.stringify([]));
	}, SCRIPT_ID);
}

/** localStorage 시딩 데이터 제거 */
async function clearSeed(page: Page) {
	await page.evaluate(() => {
		localStorage.removeItem("db:scenes");
		localStorage.removeItem("db:scripts");
		localStorage.removeItem("db:media_assets");
	});
}

// ─── 빈 상태 ─────────────────────────────────────────────────────────────────

test.describe("에디터 — 빈 상태 (씬 없음)", () => {
	test("smoke: 런타임 에러 없이 로드", async ({ page }) => {
		const getCritical = trackErrors(page);
		const resp = await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
		expect(resp?.ok()).toBeTruthy();
		await page.waitForLoadState("networkidle", { timeout: 20_000 });
		expect(getCritical()).toEqual([]);
	});

	test("씬 없음 → 안내 메시지 + 되돌아가기 버튼", async ({ page }) => {
		await page.goto(EDITOR_URL, { waitUntil: "networkidle" });
		await expect(page.getByText("씬이 없습니다")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByText("되돌아가기")).toBeVisible();
	});

	test("되돌아가기 버튼 → 스크립트 상세 페이지 이동", async ({ page }) => {
		await page.goto(EDITOR_URL, { waitUntil: "networkidle" });
		await page.getByText("되돌아가기").click();
		await expect(page).toHaveURL(new RegExp(`/content/${SCRIPT_ID}`), {
			timeout: 10_000,
		});
	});
});

// ─── 에디터 풀 렌더 (씬 시딩) ────────────────────────────────────────────────

test.describe("에디터 — 풀 렌더 (씬 1개 시딩)", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
		await seedScene(page);
		await page.goto(EDITOR_URL, { waitUntil: "networkidle" });
		// 스피너 사라질 때까지 대기
		await page
			.waitForSelector("[data-testid='timeline-loading']", {
				state: "hidden",
				timeout: 15_000,
			})
			.catch(() => {
				// spinner 없어도 계속 진행
			});
	});

	test.afterEach(async ({ page }) => {
		await clearSeed(page);
	});

	test("헤딩 '타임라인 편집기 V2' 렌더", async ({ page }) => {
		await expect(page.getByText("타임라인 편집기 V2")).toBeVisible({
			timeout: 10_000,
		});
	});

	test("툴바: Undo / Redo 버튼 존재", async ({ page }) => {
		await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
	});

	test("툴바: Zoom in / Zoom out 버튼 존재", async ({ page }) => {
		await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
	});

	test("툴바: 저장 버튼 존재", async ({ page }) => {
		await expect(page.getByText("저장")).toBeVisible();
	});

	test("Zoom in 클릭 → 배율 표시 변경", async ({ page }) => {
		const zoomBefore = await page
			.locator("span.font-mono")
			.first()
			.innerText()
			.catch(() => "");
		await page.getByRole("button", { name: "Zoom in" }).click();
		const zoomAfter = await page
			.locator("span.font-mono")
			.first()
			.innerText()
			.catch(() => "");
		expect(zoomBefore).not.toBe(zoomAfter);
	});

	test("Color Grading 버튼 클릭 → 패널 토글 (런타임 에러 없음)", async ({
		page,
	}) => {
		const getCritical = trackErrors(page);
		await page.getByTitle("Color Grading").click();
		await page.waitForTimeout(300);
		expect(getCritical()).toEqual([]);
	});

	test("Audio FX 버튼 클릭 → 패널 토글 (런타임 에러 없음)", async ({
		page,
	}) => {
		const getCritical = trackErrors(page);
		await page.getByTitle(/Audio FX/).click();
		await page.waitForTimeout(300);
		expect(getCritical()).toEqual([]);
	});

	test("Scopes 버튼 클릭 → 패널 토글 (런타임 에러 없음)", async ({ page }) => {
		const getCritical = trackErrors(page);
		await page.getByTitle(/Scopes/).click();
		await page.waitForTimeout(300);
		expect(getCritical()).toEqual([]);
	});

	test("돌아가기 버튼 → /content/:id 로 이동", async ({ page }) => {
		await page.getByText("돌아가기").first().click();
		await expect(page).toHaveURL(new RegExp(`/content/${SCRIPT_ID}`), {
			timeout: 10_000,
		});
	});
});
