import { describe, expect, it } from "vitest";
import { buildGrowthCommandCenter } from "./growth-command-center";

describe("growth-command-center", () => {
	it("업로드/분석/렌더 데이터를 운영 지휘실로 집계", () => {
		const center = buildGrowthCommandCenter({
			now: new Date("2026-05-04T00:00:00.000Z"),
			uploads: [
				{
					id: "u1",
					render_id: "r1",
					title: "왕릉 미스터리의 결정적 단서",
					description: "기록과 지도를 비교한 미스터리 분석",
					tags: ["미스터리", "왕릉"],
					status: "published",
					published_at: "2026-05-03T11:00:00.000Z",
					thumbnail_path: "thumbs/u1.jpg",
				},
				{
					id: "u2",
					render_id: "r2",
					title: "바다 한가운데 남은 왕릉 #shorts",
					description: "쇼츠로 보는 왕릉 미스터리",
					tags: ["왕릉", "shorts"],
					status: "queued",
				},
			],
			analyticsByUploadId: {
				u1: {
					upload_id: "u1",
					views: 12000,
					ctr: 8.2,
					avg_watch_duration: 42,
					likes: 350,
					comments: 40,
					subscribers_gained: 80,
				},
			},
			rendersById: {
				r1: { id: "r1", format: "shorts", duration_seconds: 58 },
				r2: { id: "r2", format: "shorts", duration_seconds: 62 },
			},
		});

		expect(center.kpis.some((kpi) => kpi.id === "analytics-loop")).toBe(true);
		expect(center.primaryObjective).toContain("승자 포맷");
		expect(center.experiments[0].type).toBe("title_thumbnail");
		expect(center.scaleDecisions[0]).toMatchObject({
			uploadId: "u1",
			kind: "scale",
		});
		expect(center.missingData.some((item) => item.id === "thumbnails")).toBe(true);
	});

	it("CTR이 낮으면 스케일 대신 패키징 수정 판단을 우선", () => {
		const center = buildGrowthCommandCenter({
			uploads: [
				{
					id: "low-ctr",
					render_id: "r1",
					title: "좋은 소재지만 클릭이 약한 영상",
					description: "설명",
					status: "published",
					published_at: "2026-05-02T11:00:00.000Z",
				},
			],
			analyticsByUploadId: {
				"low-ctr": {
					upload_id: "low-ctr",
					views: 300,
					ctr: 1.8,
					avg_watch_duration: 120,
				},
			},
			rendersById: {
				r1: { id: "r1", format: "longform", duration_seconds: 600 },
			},
		});

		expect(center.scaleDecisions[0]).toMatchObject({
			kind: "fix_packaging",
		});
		expect(center.experiments.some((item) => item.id === "title-thumbnail-lab")).toBe(
			true,
		);
	});

	it("critical 정책 문구가 있으면 운영 목표를 리스크 제거로 전환", () => {
		const center = buildGrowthCommandCenter({
			uploads: [
				{
					id: "risky",
					title: "원본 풀영상 download now",
					description: "telegram 링크로 이동",
					status: "queued",
				},
			],
		});

		expect(center.primaryObjective).toContain("정책");
		expect(center.riskControls.some((risk) => risk.severity === "blocked")).toBe(
			true,
		);
		expect(center.commandScore).toBeLessThan(70);
	});
});
