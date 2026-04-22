/**
 * User-journey flow tests — DEMO_MODE (no backend required)
 *
 * Smoke 테스트(라우트 로드 확인)를 넘어 실제 사용자 플로우를 검증:
 * - 버튼 클릭 → 라우트 전환
 * - 빈 상태 CTA 체인
 * - 폼 렌더 및 유효성 검증
 *
 * 전제: DEMO_MODE=true, 로컬 IndexedDB에 채널 미리 없음 (클린 환경)
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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

// ─── 대시보드 네비게이션 플로우 ───────────────────────────────────────────

test.describe("대시보드 네비게이션 플로우", () => {
	test("새 콘텐츠 버튼 클릭 → /content/new 이동", async ({ page }) => {
		const getCritical = trackErrors(page);
		await page.goto("/dashboard", { waitUntil: "networkidle" });

		await page.locator("p-button", { hasText: "새 콘텐츠" }).click();
		await expect(page).toHaveURL(/\/content\/new/, { timeout: 10_000 });

		expect(getCritical()).toEqual([]);
	});

	test("채널 전체 보기 클릭 → /channels 이동", async ({ page }) => {
		const getCritical = trackErrors(page);
		await page.goto("/dashboard", { waitUntil: "networkidle" });

		await page.locator("p-button", { hasText: "전체 보기" }).first().click();
		await expect(page).toHaveURL(/\/channels$/, { timeout: 10_000 });

		expect(getCritical()).toEqual([]);
	});

	test("스탯 카드 4개 모두 렌더", async ({ page }) => {
		await page.goto("/dashboard", { waitUntil: "networkidle" });
		const body = await page.locator("body").innerText();
		expect(body).toContain("채널 수");
		expect(body).toContain("콘텐츠 주제");
		expect(body).toContain("업로드");
		expect(body).toContain("이번 주 조회수");
	});

	test("대시보드 heading 및 부제목 렌더", async ({ page }) => {
		await page.goto("/dashboard", { waitUntil: "networkidle" });
		const body = await page.locator("body").innerText();
		expect(body).toContain("대시보드");
		expect(body).toContain("유튜브 자동화");
	});
});

// ─── 콘텐츠 위저드 플로우 ────────────────────────────────────────────────

test.describe("콘텐츠 위저드 플로우", () => {
	test("채널 없음 → 빈 상태 메시지 표시", async ({ page }) => {
		await page.goto("/content/new", { waitUntil: "networkidle" });
		const body = await page.locator("body").innerText();
		// DEMO_MODE + 빈 로컬 DB → 항상 빈 상태 or 모드 선택
		const hasEmpty = /채널을 생성해주세요/.test(body);
		const hasModeSelect = /AI 자동 생성|자료 기반 제작/.test(body);
		expect(
			hasEmpty || hasModeSelect,
			"위저드가 유효한 상태를 표시해야 함",
		).toBeTruthy();
	});

	test("빈 상태 채널 만들기 CTA → /channels/new 이동", async ({ page }) => {
		await page.goto("/content/new", { waitUntil: "networkidle" });
		const channelBtn = page.locator("p-button", { hasText: "채널 만들기" });

		// 채널이 없을 때만 실행 (DEMO 클린 환경)
		const visible = await channelBtn
			.isVisible({ timeout: 3_000 })
			.catch(() => false);
		if (!visible) {
			test.skip();
			return;
		}

		await channelBtn.click();
		await expect(page).toHaveURL(/\/channels\/new/, { timeout: 10_000 });
	});

	test("모드 선택 — AI 자동 생성 클릭 → 주제 입력 스텝", async ({ page }) => {
		await page.goto("/content/new", { waitUntil: "networkidle" });
		const aiBtn = page.locator("button", { hasText: "AI 자동 생성" });

		const visible = await aiBtn
			.isVisible({ timeout: 3_000 })
			.catch(() => false);
		if (!visible) {
			test.skip();
			return;
		}

		await aiBtn.click();
		// 모드 선택 후 위저드 스텝 진입 확인 — PDS heading은 shadow DOM이므로
		// "모드 변경" 버튼 + 스텝 번호(1-5) 존재로 진입 검증
		const body = await page.locator("body").innerText();
		expect(body).toContain("모드 변경");
		expect(body).toMatch(/1\s/);
	});

	test("모드 선택 — 자료 기반 제작 클릭 → 자료 수집 스텝", async ({ page }) => {
		await page.goto("/content/new", { waitUntil: "networkidle" });
		const researchBtn = page.locator("button", { hasText: "자료 기반 제작" });

		const visible = await researchBtn
			.isVisible({ timeout: 3_000 })
			.catch(() => false);
		if (!visible) {
			test.skip();
			return;
		}

		await researchBtn.click();
		const body = await page.locator("body").innerText();
		expect(body).toMatch(/주제|단계|자료/);
	});
});

// ─── 채널 생성 폼 ─────────────────────────────────────────────────────────

test.describe("채널 생성 폼", () => {
	test("/channels/new — 폼 제목 및 필드 렌더", async ({ page }) => {
		await page.goto("/channels/new", { waitUntil: "networkidle" });
		const body = await page.locator("body").innerText();
		expect(body).toContain("새 채널 만들기");
		// PInputText/PTextarea label은 shadow DOM 안 — form 존재 + 버튼 텍스트로 검증
		expect(body).toContain("채널 만들기"); // submit button
		await expect(page.locator("form")).toBeVisible();
	});

	test("빈 채널명 제출 → 유효성 오류 메시지", async ({ page }) => {
		await page.goto("/channels/new", { waitUntil: "networkidle" });

		// 폼 submit 이벤트 발생 (채널명 미입력)
		await page.locator("form").evaluate((form: HTMLFormElement) => {
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		await page.waitForTimeout(200);
		const body = await page.locator("body").innerText();
		expect(body).toContain("채널명을 입력해주세요");
	});
});

// ─── 레퍼런스 임포트 폼 ───────────────────────────────────────────────────

test.describe("레퍼런스 임포트 폼", () => {
	test("/references/import — 폼 및 URL 입력 필드 렌더", async ({ page }) => {
		await page.goto("/references/import", { waitUntil: "networkidle" });
		const body = await page.locator("body").innerText();
		expect(body.length).toBeGreaterThan(20);
		// URL 입력 필드 최소 1개
		await expect(page.locator("p-input-text").first()).toBeVisible();
	});
});

// ─── 추가 라우트 smoke (기존 4개 외) ─────────────────────────────────────

test.describe("추가 라우트 smoke", () => {
	const EXTRA_ROUTES = [
		{ path: "/channels", label: "채널 목록" },
		{ path: "/channels/new", label: "채널 생성" },
		{ path: "/content", label: "콘텐츠 목록" },
		{ path: "/uploads", label: "업로드" },
		{ path: "/settings", label: "설정" },
		{ path: "/analytics", label: "분석" },
	];

	for (const r of EXTRA_ROUTES) {
		test(`smoke: ${r.label} (${r.path})`, async ({ page }) => {
			const getCritical = trackErrors(page);

			const resp = await page.goto(r.path, { waitUntil: "domcontentloaded" });
			expect(resp?.ok()).toBeTruthy();

			await page.waitForLoadState("networkidle", { timeout: 20_000 });
			await expect(page).toHaveURL(new RegExp(r.path));

			const body = await page.locator("body").innerText();
			expect(body.length).toBeGreaterThan(10);

			expect(
				getCritical(),
				`${r.label} 런타임 에러\n${getCritical().join("\n")}`,
			).toEqual([]);
		});
	}
});
