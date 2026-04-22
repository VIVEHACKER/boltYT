import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		setupFiles: ["src/test-setup/web-audio-mock.ts"],
		include: ["src/**/*.test.ts", "server/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/lib/**/*.ts", "server/lib/**/*.ts"],
			exclude: ["src/lib/local-db.ts", "src/lib/supabase.ts"],
			all: true,
		},
	},
});
