/**
 * Visual regression — 핵심 화면의 스냅샷 비교.
 *
 * 첫 실행 시 베이스라인 생성:
 *   npx playwright test e2e/visual.spec.ts --update-snapshots
 *
 * CI에서는 베이스라인과 비교하여 픽셀 차이 임계값 초과 시 실패.
 * threshold: 0.1 (10%) — 폰트 렌더링 차이를 허용.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const SCRIPT_ID = "e2e-visual-script-001";
const EDITOR_URL = `/content/${SCRIPT_ID}/editor`;

async function stabilizeVisualState(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem("onboarding_done_v1", "1");
	});
}

async function seedScene(page: Page) {
	await page.evaluate((scriptId: string) => {
		const scene = {
			id: "scene-vis-01",
			script_id: scriptId,
			order_index: 0,
			narration_text: "Visual regression 테스트 씬",
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

async function clearSeed(page: Page) {
	await page.evaluate(() => {
		localStorage.removeItem("db:scenes");
		localStorage.removeItem("db:scripts");
		localStorage.removeItem("db:media_assets");
	});
}

test.describe("visual regression", () => {
	test("dashboard 스냅샷", async ({ page }) => {
		await stabilizeVisualState(page);
		await page.goto("/dashboard", { waitUntil: "networkidle" });
		await expect(page).toHaveScreenshot("dashboard.png", {
			threshold: 0.1,
			animations: "disabled",
		});
	});

	test("에디터 — 타임라인 풀 렌더 스냅샷", async ({ page }) => {
		await stabilizeVisualState(page);
		await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
		await seedScene(page);
		await page.goto(EDITOR_URL, { waitUntil: "networkidle" });
		// 스피너 또는 로딩 완료 대기
		await page
			.waitForSelector("[data-testid='timeline-loading']", {
				state: "hidden",
				timeout: 15_000,
			})
			.catch(() => {});
		await page.waitForTimeout(500); // 캔버스 렌더 완료 여유

		await expect(page).toHaveScreenshot("editor-timeline.png", {
			threshold: 0.1,
			animations: "disabled",
		});

		await clearSeed(page);
	});

	test("에디터 — 단축키 모달 스냅샷", async ({ page }) => {
		await stabilizeVisualState(page);
		await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
		await seedScene(page);
		await page.goto(EDITOR_URL, { waitUntil: "networkidle" });
		await page
			.waitForSelector("[data-testid='timeline-loading']", {
				state: "hidden",
				timeout: 15_000,
			})
			.catch(() => {});

		// '?' 키로 단축키 모달 열기
		await page.keyboard.press("?");
		await expect(
			page.getByRole("dialog", { name: "키보드 단축키" }),
		).toBeVisible({ timeout: 3_000 });

		await expect(page).toHaveScreenshot("editor-shortcuts-modal.png", {
			threshold: 0.1,
			animations: "disabled",
		});

		await clearSeed(page);
	});
});
