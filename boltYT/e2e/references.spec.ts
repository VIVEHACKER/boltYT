import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

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

test.describe("레퍼런스 보관함", () => {
	test("자동 생성 레퍼런스 카테고리 커버리지를 화면에 노출", async ({
		page,
	}) => {
		const getCritical = trackErrors(page);

		await page.goto("/references", { waitUntil: "networkidle" });

		const coverage = page.getByTestId("generated-reference-coverage");
		await expect(coverage).toBeVisible();
		await expect(coverage).toContainText(/자동 생성 레퍼런스 \d+개/);
		await expect(coverage).toContainText("5/5 완료");
		await expect(coverage).toContainText("드라마/영화");
		await expect(coverage).toContainText("미스터리/사건");
		await expect(coverage).toContainText("뉴스/이슈");
		await expect(coverage).toContainText("AI/비즈니스");
		await expect(coverage).toContainText("돈/심리");

		expect(getCritical()).toEqual([]);
	});
});
