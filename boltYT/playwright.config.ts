import { defineConfig, devices } from "@playwright/test";

/**
 * 프로덕션 빌드(vite preview)에 대한 E2E smoke 테스트 설정.
 * 백엔드 개발 서버가 4173 같은 프론트엔드 포트를 점유하면 Playwright가
 * 잘못된 서버를 재사용해 SPA 라우트가 JSON 404로 열릴 수 있다.
 */
const e2ePort = Number(process.env.E2E_PORT ?? 44173);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	use: {
		baseURL: e2eBaseUrl,
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		viewport: { width: 1400, height: 900 },
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: `npm run build && npx vite preview --host 127.0.0.1 --port ${e2ePort} --strictPort`,
		url: e2eBaseUrl,
		reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
		timeout: 180_000,
		stdout: "ignore",
		stderr: "pipe",
	},
});
