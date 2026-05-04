import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import type { NicheResearchHandoff } from "./niche-research";
import {
	buildContentRecommendationPlan,
	pickTopContentRecommendation,
} from "./content-recommendation-ranker";

function template(overrides: Partial<ReferenceTemplate> = {}): ReferenceTemplate {
	return {
		id: "builtin-auto-mystery-doc-test",
		channel_id: "__builtin_reference__",
		name: "미스터리 다큐",
		source_type: "youtube",
		source_url: "",
		source_title: "바다 왕릉 미스터리",
		source_creator: "",
		thumbnail_url: "",
		duration_seconds: 840,
		dominant_colors: ["#050505", "#f1c75b"],
		visual_mood: "mystery",
		visual_prompt_template: "",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "stroke",
		subtitle_accent_color: "#f1c75b",
		scene_count: 18,
		avg_scene_duration: 45,
		hook_duration: 3,
		transition_style: "hardcut",
		pacing_preset: "medium",
		tts_voice_id: "",
		tts_provider: "openai",
		tts_speed: 1,
		tts_tone_keywords: ["긴장", "분석"],
		bgm_mood: "tense",
		bgm_keywords: ["mystery"],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [{ role: "hook", duration: 8, note: "질문형 훅" }],
		transcript: "",
		frame_urls: [],
		raw_analysis: {},
		analysis_status: "complete",
		analysis_error: "",
		created_at: "",
		updated_at: "",
		...overrides,
	};
}

function handoff(): NicheResearchHandoff {
	return {
		id: "handoff-1",
		createdAt: "2026-05-05T00:00:00.000Z",
		topic: "바다 왕릉",
		summary: {
			query: "바다 왕릉 미스터리",
			score: 91,
			sampleSize: 12,
			uniqueChannelCount: 8,
			dominantChannelShare: 0.25,
			medianViews: 420000,
			medianViewsPerDay: 18000,
			medianDurationSeconds: 720,
			longformShare: 0.7,
			hiddenSubscriberShare: 0,
			topVideos: [],
			greenFlags: [],
			redFlags: [],
		},
		formatAnalysis: {
			query: "바다 왕릉 미스터리",
			sampleSeconds: 45,
			analyzedAt: "2026-05-05T00:00:00.000Z",
			videos: [],
			summary: {
				medianHookSeconds: 4,
				medianFirstCutSeconds: 2,
				medianCutsFirst10: 4,
				medianCutsFirst30: 11,
				medianTitleOpeningOverlap: 0.7,
				commonHookPattern: "question",
				rules: ["첫 4초 질문형 훅", "첫 30초 10컷 이상"],
				warnings: [],
			},
		},
		playbook: {
			query: "바다 왕릉 미스터리",
			decision: "scale",
			score: 92,
			headline: "증거형 미스터리로 확장 가능",
			rules: ["자료 앵커 유지"],
			openingFormula: ["첫 3초에 지도상 모순 제시", "첫 컷은 현장 클로즈업"],
			productionConstraints: ["출처 없는 단정 금지"],
			pilotPlan: [],
			pilotTopics: [],
			prompt: "",
		},
	};
}

describe("content-recommendation-ranker", () => {
	it("주제, 레퍼런스, 니치 데이터로 대본 추천 순위를 만든다", () => {
		const plan = buildContentRecommendationPlan({
			topicTitle: "한반도 바다 한가운데 잠든 왕릉의 미스터리",
			mode: "research",
			selectedFormat: "both",
			referenceTemplate: template(),
			nicheHandoff: handoff(),
			sources: [
				{ type: "article", title: "공식 기록", bodyText: "자료".repeat(1000) },
				{ type: "image", title: "현장 사진" },
				{ type: "video", title: "해안 영상" },
				{ type: "article", title: "지도 자료" },
				{ type: "image", title: "위성 이미지" },
			],
			performanceHistory: [
				{
					uploadId: "u1",
					title: "바다 왕릉 미스터리 지도 단서",
					format: "longform",
					durationSeconds: 780,
					metrics: {
						views: 220000,
						ctr: 7.4,
						avgWatchDuration: 310,
						avgViewPercentage: 52,
						likes: 9000,
						comments: 420,
					},
				},
			],
		});

		expect(plan.categoryId).toBe("mystery_doc");
		expect(plan.confidence).toBe("high");
		expect(plan.scripts[0].rank).toBe(1);
		expect(plan.scripts[0].score).toBeGreaterThanOrEqual(plan.scripts[1].score);
		expect(plan.scripts[0].reasons.join(" ")).toContain("니치 리서치");
		expect(plan.hooks[0].text).toContain("한반도");
		expect(plan.thumbnails[0].layout).toContain("문구");
		expect(plan.formats[0].score).toBeGreaterThanOrEqual(plan.formats[1].score);
		expect(plan.evidence.join(" ")).toContain("레퍼런스");
		expect(plan.performanceFeedback.sampleCount).toBe(1);
		expect(plan.evidence.join(" ")).toContain("성과 피드백");
	});

	it("레퍼런스가 없어도 주제 키워드로 카테고리와 상위 추천을 정한다", () => {
		const plan = buildContentRecommendationPlan({
			topicTitle: "AI 자동화로 두 번 실패하고 성공한 개발자의 워크플로우",
			mode: "ai",
			selectedFormat: "shorts",
		});

		expect(plan.categoryId).toBe("business");
		expect(pickTopContentRecommendation(plan)?.title).toContain("실패");
		expect(plan.confidence).toBe("medium");
		expect(plan.scripts[0].promptDirectives.join(" ")).toContain("훅");
	});

	it("업로드 성과 데이터가 강한 포맷과 유지율 리스크를 추천 점수에 반영한다", () => {
		const plan = buildContentRecommendationPlan({
			topicTitle: "해외 뉴스 댓글이 갈린 장면",
			mode: "research",
			selectedFormat: "both",
			performanceHistory: [
				{
					uploadId: "short-a",
					title: "해외 뉴스 댓글 논란 정리",
					format: "shorts",
					durationSeconds: 48,
					metrics: {
						views: 180000,
						ctr: 3.1,
						avgWatchDuration: 18,
						avgViewPercentage: 37,
						likes: 3000,
						comments: 600,
						retentionCurve: [
							{ elapsedVideoTimeRatio: 0.05, audienceWatchRatio: 0.55 },
							{ elapsedVideoTimeRatio: 0.3, audienceWatchRatio: 0.21 },
						],
					},
				},
				{
					uploadId: "short-b",
					title: "댓글이 갈린 해외 반응",
					format: "shorts",
					durationSeconds: 55,
					metrics: {
						views: 160000,
						ctr: 3.4,
						avgWatchDuration: 20,
						avgViewPercentage: 39,
					},
				},
			],
		});

		expect(plan.categoryId).toBe("social_clip");
		expect(plan.performanceFeedback.winningFormat).toBe("shorts");
		expect(plan.performanceFeedback.ctrRisk).toBe(true);
		expect(plan.qualityGates.join(" ")).toContain("CTR");
		expect(plan.formats[0].format).toBe("shorts");
		expect(plan.hooks[0].score).toBeGreaterThanOrEqual(90);
	});
});
