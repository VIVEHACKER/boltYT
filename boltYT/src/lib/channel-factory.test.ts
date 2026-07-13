import { describe, expect, it } from "vitest";
import {
	assessBatchVariation,
	planChannelFactoryBatch,
} from "./channel-factory";

describe("assessBatchVariation", () => {
	it("rates distinct topics as diverse with a high score", () => {
		const topics = [
			"조선 왕릉에 숨겨진 미스터리",
			"아폴로 11호 달 착륙 음모론",
			"심해 6000미터 생물 다큐",
		];
		const report = assessBatchVariation(topics);
		expect(report.verdict).toBe("diverse");
		expect(report.score).toBeGreaterThanOrEqual(90);
		expect(report.similarPairs).toHaveLength(0);
	});

	it("flags near-duplicate topics as templated_risk", () => {
		const topics = ["AI로 월 1000만원 버는 법", "AI로 월 1000만원 버는 법"];
		const report = assessBatchVariation(topics);
		expect(report.verdict).toBe("templated_risk");
		expect(report.warnings.join(" ")).toContain("inauthentic");
		expect(report.similarPairs[0].similarity).toBeCloseTo(1, 2);
	});

	it("flags partially overlapping topics as watch with a similar pair", () => {
		const topics = ["주식 투자 기초 가이드", "주식 투자 심화 가이드"];
		const report = assessBatchVariation(topics);
		expect(report.verdict).toBe("watch");
		expect(report.similarPairs).toHaveLength(1);
		expect(report.similarPairs[0]).toMatchObject({ a: 0, b: 1 });
	});

	it("treats a single topic as trivially diverse", () => {
		const report = assessBatchVariation(["하나뿐인 주제"]);
		expect(report.score).toBe(100);
		expect(report.verdict).toBe("diverse");
	});

	it("warns when the batch has no topics", () => {
		const report = assessBatchVariation([]);
		expect(report.warnings.join(" ")).toContain("주제가 없");
	});
});

describe("planChannelFactoryBatch", () => {
	it("builds one production plan per topic and drops empty topics", () => {
		const plan = planChannelFactoryBatch({
			topics: ["조선 왕릉 미스터리", "아폴로 달 착륙 음모론", "   "],
			format: "shorts",
		});
		expect(plan.items).toHaveLength(2);
		expect(plan.items[0].topicTitle).toBe("조선 왕릉 미스터리");
		expect(plan.items[0].plan).toBeTruthy();
		expect(plan.items[0].plan.topicTitle).toBe("조선 왕릉 미스터리");
		expect(plan.warnings.join(" ")).toContain("빈 주제");
		expect(plan.estimatedOutputs).toBe(2);
	});

	it("composes localization per item and counts variant outputs", () => {
		const plan = planChannelFactoryBatch({
			topics: ["조선 왕릉 미스터리", "아폴로 달 착륙 음모론"],
			format: "longform",
			localization: {
				sourceLocale: "ko-KR",
				targetLocales: ["en-US", "en-GB"],
				hasMultiAudioAccess: true,
			},
		});
		expect(plan.items[0].localization).not.toBeNull();
		expect(plan.items[0].localization?.variants).toHaveLength(2);
		// 2 topics × (1 원본 + 2 현지화) = 6
		expect(plan.estimatedOutputs).toBe(6);
	});

	it("reports batch variation for distinct topics as diverse", () => {
		const plan = planChannelFactoryBatch({
			topics: [
				"조선 왕릉에 숨겨진 미스터리",
				"심해 6000미터 생물 다큐",
				"아폴로 11호 달 착륙 음모론",
			],
			format: "shorts",
		});
		expect(plan.variation.verdict).toBe("diverse");
	});

	it("returns an empty plan with a warning when no topics are valid", () => {
		const plan = planChannelFactoryBatch({ topics: ["", "  "] });
		expect(plan.items).toHaveLength(0);
		expect(plan.estimatedOutputs).toBe(0);
		expect(plan.warnings.join(" ")).toContain("유효한 주제가 없");
	});
});
