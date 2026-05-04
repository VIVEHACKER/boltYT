import { describe, expect, it } from "vitest";
import {
	assessEnforcementSignals,
	buildDomainKnowledgePrompt,
	getYouTubeDomainIntelligence,
	recommendDurationBand,
} from "./youtube-domain-intelligence";

describe("youtube-domain-intelligence", () => {
	it("계정 삭제 수치와 트렌드 클러스터를 제공한다", () => {
		const intel = getYouTubeDomainIntelligence({
			categoryId: "mystery_doc",
			format: "longform",
		});

		expect(
			intel.enforcementMetrics.some(
				(metric) => metric.id === "terminated-q3-2025" && metric.value > 7_000_000,
			),
		).toBe(true);
		expect(intel.trendClusters[0].score).toBeGreaterThan(80);
		expect(intel.productionRules.join(" ")).toContain("90-150초");
	});

	it("형식과 목표에 따라 추천 길이 밴드를 고른다", () => {
		const shorts = recommendDurationBand({
			categoryId: "mystery_doc",
			format: "shorts",
			goal: "new_viewers",
		});
		const longform = recommendDurationBand({
			categoryId: "drama_recap",
			format: "longform",
			goal: "subscriber_conversion",
		});

		expect(shorts.maxSeconds).toBeLessThanOrEqual(35);
		expect(longform.maxSeconds).toBe(1200);
	});

	it("스팸/기만성 문구와 약한 출처 신호를 리스크로 감지한다", () => {
		const result = assessEnforcementSignals({
			title: "텔레그램 입장하면 수익 보장",
			description: "원본 풀영상 download now",
			sceneCount: 8,
			sourceAnchorRatio: 0.25,
			repetitionRatio: 0.4,
		});

		expect(result.score).toBeLessThan(60);
		expect(result.issues.some((issue) => issue.severity === "critical")).toBe(true);
		expect(result.requiredActions.join(" ")).toContain("외부 링크");
	});

	it("생성 프롬프트에 정책/트렌드/길이 지식을 압축한다", () => {
		const prompt = buildDomainKnowledgePrompt({
			categoryId: "social_clip",
			format: "shorts",
		});

		expect(prompt).toContain("삭제/제재 핵심");
		expect(prompt).toContain("추천 길이");
		expect(prompt).toContain("트렌드 클러스터");
	});
});
