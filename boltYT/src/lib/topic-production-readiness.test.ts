import { describe, expect, it } from "vitest";
import {
	analyzeTopicProductionReadiness,
	formatTopicProductionReadinessForPrompt,
} from "./topic-production-readiness";

describe("analyzeTopicProductionReadiness", () => {
	it("자료가 없으면 제작을 차단한다", () => {
		const report = analyzeTopicProductionReadiness({
			topicTitle: "미제 사건",
			format: "shorts",
			sources: [],
		});

		expect(report.status).toBe("blocked");
		expect(report.canGenerate).toBe(false);
		expect(report.issues.some((issue) => issue.code === "no_sources")).toBe(
			true,
		);
		expect(
			report.issues.some((issue) => issue.code === "no_factual_backbone"),
		).toBe(true);
	});

	it("본문 있는 기사와 시각 자료가 충분하면 롱폼까지 통과한다", () => {
		const longBody =
			"1991년 사건 발생 이후 수사 기록과 목격자 진술이 이어졌다. ".repeat(
				18,
			);
		const report = analyzeTopicProductionReadiness({
			topicTitle: "한강 실종 사건",
			format: "longform",
			sources: [
				{
					type: "article",
					title: "첫 보도",
					url: "https://news.example/a",
					publisher: "A일보",
					eventDate: "1991-01-29",
					bodyText: longBody,
				},
				{
					type: "article",
					title: "후속 보도",
					url: "https://news.example/b",
					publisher: "B뉴스",
					eventDate: "1991-01-30",
					bodyText: longBody,
				},
				{
					type: "video",
					title: "현장 뉴스 영상",
					url: "https://youtube.com/watch?v=abc",
					publisher: "방송사",
					description: longBody,
				},
				{
					type: "image",
					title: "현장 사진",
					url: "https://image.example/photo.jpg",
					publisher: "자료실",
					eventDate: "1991-01-29",
				},
			],
			researchBrief: {
				summary: "요약",
				timeline: [
					{ date: "1991-01-29", event: "실종" },
					{ date: "1991-01-30", event: "수색" },
					{ date: "1991-02-01", event: "보도" },
				],
				key_figures: [],
				facts: ["팩트1", "팩트2", "팩트3"],
				misconceptions: [],
				search_keywords: [],
			},
		});

		expect(report.status).toBe("ready");
		expect(report.canGenerate).toBe(true);
		expect(report.recommendedFormat).toBe("both");
		expect(report.metrics.longformReady).toBe(true);
		expect(report.score).toBeGreaterThanOrEqual(74);
	});

	it("자료는 있지만 롱폼 밀도가 부족하면 재기획을 권고한다", () => {
		const report = analyzeTopicProductionReadiness({
			topicTitle: "짧은 사건",
			format: "longform",
			sources: [
				{
					type: "article",
					title: "단일 기사",
					url: "https://news.example/a",
					publisher: "A일보",
					bodyText:
						"사건 개요와 날짜가 담긴 기사입니다. 구체 정보는 일부만 확인됩니다. 목격 기록, 최초 신고 시점, 현장 위치, 관계자 진술이 짧게 정리돼 있지만 롱폼 전체를 지탱할 만큼은 아닙니다. ".repeat(
							4,
						),
					eventDate: "2024-01-01",
				},
				{
					type: "image",
					title: "현장 사진",
					url: "https://image.example/photo.jpg",
					eventDate: "2024-01-01",
				},
			],
		});

		expect(report.status).toBe("needs_reframe");
		expect(report.canGenerate).toBe(true);
		expect(report.recommendedFormat).toBe("shorts");
		expect(
			report.issues.some(
				(issue) => issue.code === "longform_not_supported_by_sources",
			),
		).toBe(true);
		expect(report.reframeOptions.join(" ")).toContain("롱폼 대신");
	});

	it("프롬프트용 제작성 섹션을 만든다", () => {
		const report = analyzeTopicProductionReadiness({
			topicTitle: "사건 분석",
			format: "shorts",
			sources: [
				{
					type: "article",
					title: "기사",
					url: "https://news.example",
					description:
						"사건 발생 시점과 수사 경위가 설명된 기사 본문 일부입니다. 날짜와 장소가 확인됩니다.",
					eventDate: "2025-04-01",
				},
				{
					type: "video",
					title: "뉴스 영상",
					url: "https://youtube.com/watch?v=abc",
					description:
						"사건 현장과 관계자 인터뷰를 다룬 뉴스 영상 설명입니다.",
				},
			],
		});

		const prompt = formatTopicProductionReadinessForPrompt(report);

		expect(prompt).toContain("프리프로덕션 제작성 평가");
		expect(prompt).toContain("추천 각도");
		expect(prompt).toContain("제작 지시");
	});
});
