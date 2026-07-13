import { describe, expect, it } from "vitest";
import { analyzeSourceSafety } from "./source-safety-gate";

describe("source-safety-gate", () => {
	it("passes sourced article/video scenes", () => {
		const report = analyzeSourceSafety(
			[
				{
					type: "article",
					title: "기사",
					url: "https://news.example/a",
					publisher: "뉴스",
				},
				{
					type: "video",
					title: "현장 영상",
					url: "https://youtube.com/watch?v=1",
					publisher: "채널",
				},
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

	it("blocks pure repackaging — 불펌 외부 영상+내레이션, 원본·출처·기사 없음", () => {
		const report = analyzeSourceSafety(
			[],
			Array.from({ length: 5 }, () => ({
				scene_type: "video",
				source_url: "https://youtube.com/watch?v=scrape",
				// 출처 표시 없음, AI 생성/재구성 컷 없음
			})),
		);
		expect(report.passed).toBe(false);
		expect(report.issues.map((issue) => issue.code)).toContain(
			"pure_repackaging",
		);
	});

	it("무관한 기사 1개가 있어도 미귀속 외부 영상 재포장은 차단된다", () => {
		const report = analyzeSourceSafety(
			[
				{
					type: "article",
					title: "무관한 기사",
					url: "https://news.example/x",
				},
			],
			Array.from({ length: 5 }, () => ({
				scene_type: "video",
				source_url: "https://youtube.com/watch?v=scrape",
				// 영상 씬은 기사와 무관하고 출처 표시 없음
			})),
		);
		expect(report.issues.map((issue) => issue.code)).toContain(
			"pure_repackaging",
		);
	});

	it("원본 AI 재구성 컷이 있으면 재포장으로 차단하지 않는다", () => {
		const report = analyzeSourceSafety(
			[],
			Array.from({ length: 5 }, () => ({
				scene_type: "video",
				source_url: "https://youtube.com/watch?v=x",
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
		expect(report.issues.map((issue) => issue.code)).not.toContain(
			"pure_repackaging",
		);
	});
});
