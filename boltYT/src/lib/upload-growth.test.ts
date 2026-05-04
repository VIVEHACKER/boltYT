import { describe, expect, it } from "vitest";
import {
	buildUploadGrowthPlan,
	recommendKeywords,
	recommendPublishWindows,
	recommendLength,
} from "./upload-growth";

describe("upload-growth", () => {
	it("성과가 높은 업로드의 제목/태그 키워드를 우선 추천", () => {
		const keywords = recommendKeywords(
			[
				{
					id: "a",
					title: "왕릉 미스터리 바다 유적",
					description: "왕릉 미스터리의 단서",
					tags: ["왕릉", "미스터리"],
				},
				{
					id: "b",
					title: "일상 브이로그",
					description: "가벼운 이야기",
					tags: ["일상"],
				},
			],
			{
				a: { upload_id: "a", views: 1000, likes: 50, comments: 10 },
				b: { upload_id: "b", views: 10 },
			},
		);

		expect(keywords[0].keyword).toBe("왕릉");
		expect(keywords.some((item) => item.keyword === "미스터리")).toBe(true);
	});

	it("성과 게시 시간이 충분하면 히스토리 기반 시간대를 추천", () => {
		const windows = recommendPublishWindows(
			[
				{
					id: "a",
					published_at: "2026-05-05T11:00:00.000Z",
				},
				{
					id: "b",
					published_at: "2026-05-07T12:00:00.000Z",
				},
			],
			{
				a: { upload_id: "a", views: 1000 },
				b: { upload_id: "b", views: 800 },
			},
		);

		expect(windows[0].source).toBe("history");
		expect(windows[0].score).toBeGreaterThan(0);
	});

	it("성과 게시 시간이 부족하면 기본 실험 슬롯을 추천", () => {
		const windows = recommendPublishWindows([], {});

		expect(windows).toHaveLength(3);
		expect(windows.every((window) => window.source === "fallback")).toBe(true);
	});

	it("렌더 길이 중앙값으로 길이 가이드를 계산", () => {
		const length = recommendLength(
			[
				{ id: "a", render_id: "r1" },
				{ id: "b", render_id: "r2" },
				{ id: "c", render_id: "r3" },
			],
			{
				r1: { id: "r1", format: "shorts", duration_seconds: 42 },
				r2: { id: "r2", format: "shorts", duration_seconds: 58 },
				r3: { id: "r3", format: "longform", duration_seconds: 900 },
			},
		);

		expect(length.currentShortsMedianSeconds).toBe(50);
		expect(length.currentLongformMedianSeconds).toBe(900);
	});

	it("성장 플랜에 다음 액션과 낮은/높은 신뢰도를 포함", () => {
		const plan = buildUploadGrowthPlan({
			uploads: [
				{
					id: "a",
					title: "미스터리 사건",
					description: "미스터리 사건 분석",
					tags: ["미스터리"],
					status: "queued",
				},
			],
			now: new Date("2026-05-04T00:00:00.000Z"),
		});

		expect(plan.confidence).toBe("low");
		expect(plan.nextActions.length).toBeGreaterThan(0);
		expect(plan.cadence.targetPerWeek).toBeGreaterThan(0);
		expect(plan.thumbnailActions.length).toBeGreaterThan(0);
		expect(plan.domainMetrics.length).toBeGreaterThan(0);
		expect(plan.domainActions.join(" ")).toContain("대량 삭제");
		expect(plan.trendSignals.length).toBeGreaterThan(0);
	});
});
