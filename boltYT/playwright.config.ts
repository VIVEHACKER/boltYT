import { defineConfig, devices } from "@playwright/test";

/**
 * 프로덕션 빌드(vite preview 4173)에 대한 E2E smoke 테스트 설정.
 * 로컬에서는 reuseExistingServer=true 로 두 번째 실행부터 재사용.
 */
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [["github"], ["list"]] : "list",
	use: {
		baseURL: "http://localhost:4173",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
		viewport: { width: 1400, height: 900 },
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "npm run build && npx vite preview --port 4173 --strictPort",
		url: "http://localhost:4173",
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "ignore",
		stderr: "pipe",
	},
});
