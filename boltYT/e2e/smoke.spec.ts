import { expect, test } from "@playwright/test";

/**
 * API 키 없이 DEMO_MODE 에서 각 주요 라우트가 런타임 에러 없이 로드되는지 검증.
 *
 * DEMO_MODE (src/lib/supabase.ts) 가 true 이므로 useAuth 가 DEMO_SESSION 을 돌려줌
 * → AppLayout 의 login redirect 우회됨. localStorage seeding 불필요.
 */
const ROUTES: Array<{ path: string; label: string; selectorHint?: RegExp }> = [
	{ path: "/dashboard", label: "Dashboard" },
	{ path: "/content/new", label: "Content Wizard" },
	{ path: "/references", label: "References" },
	{ path: "/diagnostics", label: "Diagnostics" },
];

for (const r of ROUTES) {
	test(`smoke: ${r.label} (${r.path}) 로드 및 런타임 에러 없음`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
		page.on("console", (msg) => {
			if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
		});

		const resp = await page.goto(r.path, { waitUntil: "domcontentloaded" });
		expect(resp?.ok()).toBeTruthy();

		// SPA 초기 렌더 완료 대기
		await page.waitForLoadState("networkidle", { timeout: 20_000 });

		// URL 이 SPA 라우트로 유지되는지
		await expect(page).toHaveURL(new RegExp(r.path));

		// body 가 비어있지 않음 (최소 어떤 DOM 은 렌더)
		const bodyText = await page.locator("body").innerText();
		expect(bodyText.length).toBeGreaterThan(10);

		// 치명적 런타임 에러만 — UI 크래시 검증이 목적이라 백엔드 없음(api-proxy 등)으로 인한
		// 404/500 네트워크 리소스 실패는 허용.
		const critical = errors.filter(
			(e) =>
				!/favicon/.test(e) &&
				!/manifest\.json/.test(e) &&
				!/Failed to load resource/i.test(e) &&
				!/\b(DevTools|Download the React DevTools)\b/.test(e),
		);
		expect(critical, `\n${critical.join("\n")}`).toEqual([]);
	});
}
