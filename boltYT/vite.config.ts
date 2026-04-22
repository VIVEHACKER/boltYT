import {
	getComponentChunkLinks,
	getFontFaceStyles,
	getFontLinks,
	getIconLinks,
	getInitialStyles,
	getMetaTagsAndIconLinks,
} from "@porsche-design-system/components-react/partials";
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
	plugins: [react(), tailwindcss(), transformIndexHtmlPlugin()],
});
