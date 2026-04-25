import {
	getComponentChunkLinks,
	getFontFaceStyles,
	getFontLinks,
	getIconLinks,
	getInitialStyles,
	getMetaTagsAndIconLinks,
} from "@porsche-design-system/components-react/partials";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const transformIndexHtmlPlugin = () => {
	return {
		name: "html-transform",
		transformIndexHtml(html: string) {
			const headPartials = [
				getInitialStyles(),
				getFontFaceStyles(),
				getFontLinks({ weights: ["regular", "semi-bold", "bold"] }),
				getComponentChunkLinks(),
				getIconLinks(),
				getMetaTagsAndIconLinks({ appTitle: "Porsche Design System" }),
			].join("");

			return html.replace(/<\/head>/, `${headPartials}</head>`);
		},
	};
};

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		transformIndexHtmlPlugin(),
		// 소스맵을 Sentry에 업로드 — CI에서만 실행 (SENTRY_AUTH_TOKEN 필요)
		sentryVitePlugin({
			authToken: process.env.SENTRY_AUTH_TOKEN,
			org: process.env.SENTRY_ORG,
			project: process.env.SENTRY_PROJECT,
			disable: !process.env.SENTRY_AUTH_TOKEN,
			telemetry: false,
		}),
	],
	build: {
		sourcemap: true,
	},
});
