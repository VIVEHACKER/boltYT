import type { RemotionScene } from "../remotion/types";
import type { NewsSurfaceTone } from "./news-surface-theme";

export interface NarrationCaptionMotionTheme {
	enterStartOffsetFrames: number;
	enterDurationFrames: number;
	exitLeadFrames: number;
	exitDurationFrames: number;
	enterFromX: number;
	enterFromY: number;
	enterFromScale: number;
	exitToX: number;
	exitToY: number;
	exitToScale: number;
	activeWordScale: number;
}

export function getNarrationCaptionMotionTheme(params: {
	sceneType?: RemotionScene["type"];
	tone?: NewsSurfaceTone;
	hookBoost?: boolean;
}): NarrationCaptionMotionTheme {
	const { sceneType = "image", tone = "generic", hookBoost = false } = params;

	const base: NarrationCaptionMotionTheme = {
		enterStartOffsetFrames: 2,
		enterDurationFrames: hookBoost ? 5 : 6,
		exitLeadFrames: hookBoost ? 3 : 2,
		exitDurationFrames: hookBoost ? 5 : 6,
		enterFromX: 0,
		enterFromY: 12,
		enterFromScale: hookBoost ? 0.96 : 0.98,
		exitToX: 0,
		exitToY: -4,
		exitToScale: 0.985,
		activeWordScale: hookBoost ? 1.05 : 1.03,
	};

	if (sceneType === "news_overlay") {
		base.enterDurationFrames = hookBoost ? 4 : 5;
		base.exitDurationFrames = 4;
		base.enterFromScale = 0.94;
		base.activeWordScale += 0.01;
	}

	switch (tone) {
		case "witness":
			return {
				...base,
				enterFromX: sceneType === "news_overlay" ? -22 : -16,
				enterFromY: 8,
				exitToX: -10,
				exitToY: -2,
				activeWordScale: base.activeWordScale + 0.01,
			};
		case "evidence":
			return {
				...base,
				enterFromX: 0,
				enterFromY: 18,
				enterFromScale: 0.93,
				exitToX: 0,
				exitToY: -8,
				exitToScale: 0.97,
				activeWordScale: base.activeWordScale + 0.015,
			};
		case "timeline":
			return {
				...base,
				enterFromX: sceneType === "news_overlay" ? 28 : 18,
				enterFromY: 4,
				enterDurationFrames: hookBoost ? 4 : 5,
				exitToX: 16,
				exitToY: -2,
				exitToScale: 0.99,
				activeWordScale: base.activeWordScale + 0.005,
			};
		default:
			return base;
	}
}
