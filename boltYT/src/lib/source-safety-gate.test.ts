import { describe, expect, it } from "vitest";
import { analyzeSourceSafety } from "./source-safety-gate";

describe("source-safety-gate", () => {
	it("passes sourced article/video scenes", () => {
		const report = analyzeSourceSafety(
			[
				{ type: "article", title: "기사", url: "https://news.example/a", publisher: "뉴스" },
				{ type: "video", title: "현장 영상", url: "https://youtube.com/watch?v=1", publisher: "채널" },
			],
			[
				{ sourceIndex: 0, scene_type: "image", news_source: "뉴스" },
				{ sourceIndex: 1, scene_type: "video", news_source: "채널" },
			],
		);
		expect(report.passed).toBe(true);
		expect(report.score).toBeGreaterThan(80);
	});

	it("blocks low source ratio in sourced production", () => {
		const report = analyzeSourceSafety(
			[],
			Array.from({ length: 5 }, () => ({
				scene_type: "image",
				shots: [
					{
						id: "s",
						kind: "context",
						duration_seconds: 4,
						selection_provider: "ai",
						visual_role: "reconstruction",
					},
				],
			})),
		);
		expect(report.passed).toBe(false);
		expect(report.issues.map((issue) => issue.code)).toContain(
			"low_scene_source_ratio",
		);
		expect(report.disclosureRequired).toBe(true);
	});
});
