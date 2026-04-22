import { describe, expect, it } from "vitest";
import { getNarrationCaptionMotionTheme } from "./narration-caption-motion";

describe("narration-caption-motion", () => {
	it("news_overlay witness는 왼쪽 pull 계열 진입을 쓴다", () => {
		const theme = getNarrationCaptionMotionTheme({
			sceneType: "news_overlay",
			tone: "witness",
			hookBoost: true,
		});

		expect(theme.enterFromX).toBeLessThan(0);
		expect(theme.exitToX).toBeLessThan(0);
		expect(theme.enterDurationFrames).toBeLessThanOrEqual(5);
	});

	it("evidence는 아래에서 stamp처럼 올라오는 진입을 쓴다", () => {
		const theme = getNarrationCaptionMotionTheme({
			sceneType: "image",
			tone: "evidence",
		});

		expect(theme.enterFromY).toBeGreaterThan(12);
		expect(theme.enterFromScale).toBeLessThan(0.95);
	});

	it("timeline은 오른쪽 sweep 진입을 쓴다", () => {
		const theme = getNarrationCaptionMotionTheme({
			sceneType: "video",
			tone: "timeline",
		});

		expect(theme.enterFromX).toBeGreaterThan(0);
		expect(theme.exitToX).toBeGreaterThan(0);
	});
});
