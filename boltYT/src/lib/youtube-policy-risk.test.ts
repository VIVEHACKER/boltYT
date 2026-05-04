import { describe, expect, it } from "vitest";
import { analyzeYouTubePolicyRisk } from "./youtube-policy-risk";

describe("analyzeYouTubePolicyRisk", () => {
	it("출처 없는 AI 재구성을 실제 CCTV처럼 말하면 critical", () => {
		const report = analyzeYouTubePolicyRisk({
			title: "실제 CCTV에 찍힌 마지막 장면",
			scenes: [
				{
					narration_text: "이것은 실제 CCTV 영상입니다.",
					scene_type: "video",
					shots: [
						{
							visual_role: "reconstruction",
							selection_provider: "ai",
						},
					],
				},
			],
		});

		expect(report.passed).toBe(false);
		expect(
			report.issues.some(
				(issue) => issue.code === "synthetic_claimed_as_real",
			),
		).toBe(true);
	});

	it("AI 재구성 장면은 고지 액션을 요구한다", () => {
		const report = analyzeYouTubePolicyRisk({
			title: "사건 타임라인 분석",
			description: "자료 기반 다큐",
			scenes: [
				{
					narration_text: "당시 상황을 재구성하면 이렇습니다.",
					scene_type: "image",
					shots: [
						{
							visual_role: "reconstruction",
							selection_provider: "ai",
						},
					],
				},
			],
		});

		expect(report.disclosureRequired).toBe(true);
		expect(
			report.issues.some((issue) => issue.code === "missing_synthetic_disclosure"),
		).toBe(true);
		expect(report.requiredActions.join(" ")).toContain("AI 재구성");
	});

	it("설명에 재구성 고지가 있으면 disclosure warning을 내지 않는다", () => {
		const report = analyzeYouTubePolicyRisk({
			title: "사건 타임라인 분석",
			description: "일부 장면은 이해를 돕기 위한 AI 재구성입니다.",
			scenes: [
				{
					narration_text: "당시 상황을 재구성합니다.",
					scene_type: "image",
					shots: [
						{
							visual_role: "reconstruction",
							selection_provider: "ai",
						},
					],
				},
			],
		});

		expect(
			report.issues.some((issue) => issue.code === "missing_synthetic_disclosure"),
		).toBe(false);
	});

	it("출처 없는 단정 표현은 warning", () => {
		const report = analyzeYouTubePolicyRisk({
			scenes: [
				{
					narration_text: "범인은 확실히 증거를 은폐했다.",
					scene_type: "image",
					shots: [{ visual_role: "reconstruction" }],
				},
			],
		});

		expect(
			report.issues.some((issue) => issue.code === "unsupported_absolute_claim"),
		).toBe(true);
	});

	it("출처 앵커가 약한 씬이 많으면 대량 저품질 위험을 경고한다", () => {
		const report = analyzeYouTubePolicyRisk({
			scenes: Array.from({ length: 8 }, (_, index) => ({
				narration_text: `사건 흐름 ${index + 1}`,
				scene_type: "image",
				shots: [
					{
						visual_role: "reconstruction",
						selection_provider: "ai",
					},
				],
			})),
		});

		expect(
			report.issues.some((issue) => issue.code === "low_source_anchor_ratio"),
		).toBe(true);
	});

	it("업로드 메타데이터만 있어도 실제 영상 주장 확인 경고를 낸다", () => {
		const report = analyzeYouTubePolicyRisk({
			title: "실제 CCTV로 본 마지막 5분",
			description: "사건 분석",
			scenes: [],
		});

		expect(
			report.issues.some(
				(issue) => issue.code === "metadata_real_footage_claim_requires_source",
			),
		).toBe(true);
	});

	it("외부 유도/수익 보장 문구는 계정 삭제형 critical 리스크로 본다", () => {
		const report = analyzeYouTubePolicyRisk({
			title: "텔레그램 입장하면 수익 보장",
			description: "원본 풀영상 download now",
			scenes: [],
		});

		expect(report.passed).toBe(false);
		expect(
			report.issues.some(
				(issue) => issue.code === "deceptive_spam_language",
			),
		).toBe(true);
		expect(report.requiredActions.join(" ")).toContain("외부 링크");
	});
});
