import { describe, expect, it } from "vitest";
import { buildGrowthCommandCenter } from "./growth-command-center";
import {
	buildGrowthOperatingSystemPlan,
	mineCommentInsights,
} from "./growth-operating-system";

describe("growth-operating-system", () => {
	it("실험 백로그, 리텐션, 권리 장부, 자동 루틴을 생성", () => {
		const uploads = [
			{
				id: "u1",
				render_id: "r1",
				youtube_video_id: "yt1",
				title: "왕릉 미스터리 분석",
				description: "출처: https://example.com 기록 기반 해설과 반론",
				tags: ["미스터리"],
				status: "published",
				published_at: "2026-05-03T00:00:00.000Z",
				thumbnail_path: "thumb.jpg",
			},
		];
		const analyticsByUploadId = {
			u1: {
				upload_id: "u1",
				views: 1200,
				ctr: 2.1,
				avg_watch_duration: 38,
				avg_view_percentage: 32,
				retention_curve: [
					{ elapsedVideoTimeRatio: 0, audienceWatchRatio: 1 },
					{ elapsedVideoTimeRatio: 0.2, audienceWatchRatio: 0.72 },
					{ elapsedVideoTimeRatio: 0.35, audienceWatchRatio: 0.38 },
				],
			},
		};
		const rendersById = {
			r1: { id: "r1", format: "shorts", duration_seconds: 60 },
		};
		const center = buildGrowthCommandCenter({
			uploads,
			analyticsByUploadId,
			rendersById,
		});
		const plan = buildGrowthOperatingSystemPlan({
			center,
			uploads,
			analyticsByUploadId,
			rendersById,
			comments: [
				{
					id: "c1",
					video_id: "yt1",
					text: "왕릉 위치가 왜 바다 한가운데인가요?",
					like_count: 4,
				},
			],
		});

		expect(plan.analyticsSync[0].status).toBe("ready");
		expect(plan.experimentBacklog.length).toBeGreaterThan(0);
		expect(plan.retentionFindings[0].dropAtSeconds).toBeGreaterThan(0);
		expect(plan.rightsLedger[0].severity).toBe("good");
		expect(plan.commentInsights[0]).toMatchObject({
			sentiment: "question",
		});
		expect(plan.automationRoutines.some((routine) => routine.id === "daily-analytics-sync")).toBe(
			true,
		);
	});

	it("댓글 반복 질문을 주제 후보로 군집화", () => {
		const insights = mineCommentInsights([
			{ id: "a", video_id: "v", text: "왜 이 사건은 기록이 없나요?", like_count: 8 },
			{ id: "b", video_id: "v", text: "왜 지도에는 다르게 나오나요?", like_count: 2 },
			{ id: "c", video_id: "v", text: "다음에는 바다 왕릉도 해줘요", like_count: 5 },
		]);

		expect(insights[0].count).toBeGreaterThan(0);
		expect(insights.some((insight) => insight.sentiment === "request")).toBe(true);
		expect(insights[0].recommendedAction).toContain("다음");
	});
});
