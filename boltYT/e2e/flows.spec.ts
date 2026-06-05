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

const TEST_CHANNELS = [
	{
		id: "ch-alpha",
		user_id: "local-user",
		name: "알파 채널",
		description: "기술 자동화 채널",
		language: "ko",
		category: "기술",
		tone: "전문적",
		forbidden_words: [],
		default_cta: "구독",
		visibility_policy: "public",
		created_at: "2026-05-01T00:00:00.000Z",
		updated_at: "2026-05-01T00:00:00.000Z",
	},
	{
		id: "ch-beta",
		user_id: "local-user",
		name: "베타 채널",
		description: "드라마/영화 해설 채널",
		language: "ko",
		category: "드라마",
		tone: "몰입감 있는",
		forbidden_words: [],
		default_cta: "다음 해설도 이어보기",
		visibility_policy: "public",
		created_at: "2026-05-01T00:00:00.000Z",
		updated_at: "2026-05-01T00:00:00.000Z",
	},
];

const DRAMA_REFERENCE = {
	id: "ref-drama-e2e",
	channel_id: "ch-beta",
	name: "E2E 드라마 리캡 레퍼런스",
	source_type: "youtube",
	source_url: "https://www.youtube.com/watch?v=e2e",
	source_title: "결말 해석형 드라마 리캡",
	source_creator: "E2E",
	thumbnail_url: "",
	duration_seconds: 720,
	dominant_colors: ["#101010", "#f1c75b"],
	visual_mood: "dramatic",
	visual_prompt_template: "",
	lighting_style: "cinematic",
	subtitle_position: "bottom",
	subtitle_size_preset: "lg",
	subtitle_bg_style: "stroke",
	subtitle_accent_color: "#f1c75b",
	scene_count: 16,
	avg_scene_duration: 45,
	hook_duration: 4,
	transition_style: "hardcut",
	pacing_preset: "medium",
	tts_voice_id: "",
	tts_provider: "openai",
	tts_speed: 1,
	tts_tone_keywords: ["긴장", "해설"],
	bgm_mood: "tense",
	bgm_keywords: ["drama", "recap"],
	bgm_tempo: "mid",
	bgm_reference_url: "",
	hook_pattern: "question",
	script_structure: [{ role: "hook", duration: 8, note: "결말 질문형 훅" }],
	transcript: "드라마 결말과 복선을 해설하는 레퍼런스",
	frame_urls: [],
	raw_analysis: {},
	analysis_status: "complete",
	analysis_error: "",
	created_at: "2026-05-01T00:00:00.000Z",
	updated_at: "2026-05-01T00:00:00.000Z",
};

async function seedWizardChannels(page: Page) {
	await page.addInitScript(
		({ channels, reference }) => {
			localStorage.setItem("onboarding_done_v1", "1");
			localStorage.setItem("db:channels", JSON.stringify(channels));
			localStorage.setItem("db:reference_templates", JSON.stringify([reference]));
		},
		{ channels: TEST_CHANNELS, reference: DRAMA_REFERENCE },
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

	test("모바일 단계 표시 — 단계명이 세로로 쪼개지지 않음", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
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
		const labels = page.locator("[aria-label='콘텐츠 생성 단계'] p-text");
		await expect(labels.first()).toBeVisible({ timeout: 5_000 });
		const boxes = await labels.evaluateAll((nodes) =>
			nodes.map((node) => {
				const rect = node.getBoundingClientRect();
				return { width: rect.width, height: rect.height };
			}),
		);
		expect(boxes.length).toBeGreaterThanOrEqual(5);
		for (const box of boxes) {
			expect(box.width).toBeGreaterThan(30);
			expect(box.height).toBeLessThanOrEqual(28);
		}
	});

	test("채널 URL 파라미터와 채널 변경이 위저드 상태에 반영됨", async ({
		page,
	}) => {
		await seedWizardChannels(page);
		await page.goto(
			"/content/new?mode=ai&channel=ch-beta&title=AI%20자동화%20실패담",
			{ waitUntil: "networkidle" },
		);

		const channelSelect = page.locator('p-select[name="channel"]');
		await expect(channelSelect).toHaveJSProperty("value", "ch-beta");

		await channelSelect.evaluate((element) => {
			(element as HTMLInputElement).value = "ch-alpha";
			element.dispatchEvent(
				new CustomEvent("update", {
					bubbles: true,
					detail: { value: "ch-alpha" },
				}),
			);
		});

		await expect(channelSelect).toHaveJSProperty("value", "ch-alpha");
	});

	test("저장된 레퍼런스를 원하는 주제로 변환해 추천 패널에 반영", async ({
		page,
	}) => {
		await seedWizardChannels(page);
		await page.goto(
			"/content/new?mode=research&channel=ch-beta&template=ref-drama-e2e&title=%EA%B2%B0%EB%A7%90%EC%9D%84%20%EC%95%8C%EA%B3%A0%20%EB%8B%A4%EC%8B%9C%20%EB%B3%B4%EB%A9%B4%20%EB%8B%AC%EB%9D%BC%EC%A7%80%EB%8A%94%20%EB%93%9C%EB%9D%BC%EB%A7%88%20%EB%B3%B5%EC%84%A0",
			{ waitUntil: "networkidle" },
		);

		await expect(page.getByText("선택 레퍼런스 적용")).toBeVisible({
			timeout: 10_000,
		});
		await expect(
			page.getByText("E2E 드라마 리캡 레퍼런스", { exact: true }).first(),
		).toBeVisible();
		await expect(
			page.getByText("저장된 레퍼런스의 편집 문법을 현재 주제로 변환해 추천합니다."),
		).toBeVisible();
	});

	test("레퍼런스가 달라도 추천 방향은 사용자가 입력한 주제를 따른다", async ({
		page,
	}) => {
		await seedWizardChannels(page);
		await page.goto(
			"/content/new?mode=research&channel=ch-beta&template=ref-drama-e2e&title=AI%20%EC%9E%90%EB%8F%99%ED%99%94%EB%A1%9C%20%EB%91%90%20%EB%B2%88%20%EC%8B%A4%ED%8C%A8%ED%95%98%EA%B3%A0%20%EC%84%B1%EA%B3%B5%ED%95%9C%20%EA%B0%9C%EB%B0%9C%EC%9E%90%EC%9D%98%20%EC%9B%8C%ED%81%AC%ED%94%8C%EB%A1%9C%EC%9A%B0",
			{ waitUntil: "networkidle" },
		);

		await expect(page.getByText("선택 레퍼런스 적용")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByText(/카테고리 비즈니스\/자동화/)).toBeVisible();
		await expect(page.getByText("실패 원인 해부형")).toBeVisible();
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
