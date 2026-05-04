import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import { buildChannelStrategyPlan } from "./channel-strategy-ranker";
import type { AnalysisJobResult } from "./reference-import";
import type { ReferenceChannelCandidate } from "./reference-channel-scout";
import {
	attachTrendReferenceLearningToAnalysisResult,
	buildTrendReferenceLearningPlan,
} from "./trend-reference-learning";

function template(overrides: Partial<ReferenceTemplate> = {}): ReferenceTemplate {
	return {
		id: "ref-trend-learning",
		channel_id: "channel-1",
		name: "미스터리 레퍼런스",
		source_type: "youtube",
		source_url: "https://youtu.be/ref",
		source_title: "Mystery reference",
		source_creator: "Creator",
		thumbnail_url: "",
		duration_seconds: 840,
		dominant_colors: [],
		visual_mood: "mystery",
		visual_prompt_template: "",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "stroke",
		subtitle_accent_color: "#ffffff",
		scene_count: 18,
		avg_scene_duration: 47,
		hook_duration: 3,
		transition_style: "mixed",
		pacing_preset: "medium",
		tts_voice_id: "",
		tts_provider: "openai",
		tts_speed: 1,
		tts_tone_keywords: ["긴장"],
		bgm_mood: "tense",
		bgm_keywords: ["pulse"],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [],
		transcript: "자료 기반 나레이션 ".repeat(80),
		frame_urls: [],
		raw_analysis: {},
		analysis_status: "complete",
		analysis_error: "",
		created_at: "",
		updated_at: "",
		...overrides,
	};
}

function candidate(overrides: Partial<ReferenceChannelCandidate> = {}): ReferenceChannelCandidate {
	return {
		id: "mystery_doc:trend-channel",
		categoryId: "mystery_doc",
		categoryLabel: "미스터리/사건 다큐",
		channelId: "trend-channel",
		channelTitle: "Trend Mystery",
		channelSubscriberCount: 320000,
		channelVideoCount: 120,
		channelViewCount: 90_000_000,
		hiddenSubscriberCount: false,
		score: 96,
		videoCount: 5,
		totalViews: 3_200_000,
		avgViewsPerDay: 72_000,
		longformShare: 0.8,
		sourceQueries: ["미제사건 다큐", "사건 타임라인 분석"],
		representativeVideo: {
			videoId: "trend-1",
			title: "모두가 놓친 사건의 결정적 장면",
			description: "",
			thumbnail: "",
			channelId: "trend-channel",
			channelTitle: "Trend Mystery",
			publishedAt: "2026-04-20T00:00:00.000Z",
			durationSeconds: 780,
			viewCount: 1_600_000,
			likeCount: 60_000,
			commentCount: 2400,
			channelSubscriberCount: 320000,
			channelVideoCount: 120,
			channelViewCount: 90_000_000,
			hiddenSubscriberCount: false,
			ageDays: 14,
			viewsPerDay: 114_000,
			engagementRate: 0.039,
			viewSubscriberRatio: 5,
			score: 97,
			scoreParts: {
				velocity: 1,
				leverage: 0.9,
				engagement: 0.9,
				longform: 1,
				freshness: 0.92,
			},
		},
		topVideos: [],
		representativeUrl: "https://www.youtube.com/watch?v=trend-1",
		suggestedMode: "longform",
		...overrides,
	};
}

function analysisResult(): AnalysisJobResult {
	return {
		source_type: "youtube",
		source_url: "https://www.youtube.com/watch?v=trend-1",
		source_title: "모두가 놓친 사건의 결정적 장면",
		source_creator: "Trend Mystery",
		thumbnail_url: "",
		duration_seconds: 780,
		dominant_colors: [],
		visual_mood: "mystery",
		visual_prompt_template: "",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "stroke",
		subtitle_accent_color: "#ffffff",
		scene_count: 14,
		avg_scene_duration: 55,
		hook_duration: 4,
		transition_style: "mixed",
		pacing_preset: "medium",
		tts_voice_id: "",
		tts_provider: "openai",
		tts_speed: 1,
		tts_tone_keywords: [],
		bgm_mood: "tense",
		bgm_keywords: [],
		bgm_tempo: "mid",
		hook_pattern: "question",
		script_structure: [],
		transcript: "",
		frame_urls: [],
		raw_analysis: {},
	};
}

describe("trend-reference-learning", () => {
	it("실측 트렌드 후보를 별도 레퍼런스 학습 대상으로 승격한다", () => {
		const ref = template();
		const candidatesByCategory = { mystery_doc: [candidate()] };
		const strategyPlan = buildChannelStrategyPlan(ref, candidatesByCategory);
		const learningPlan = buildTrendReferenceLearningPlan({
			template: ref,
			strategyPlan,
			candidatesByCategory,
		});

		expect(learningPlan.videoTargets.length).toBeGreaterThan(0);
		expect(learningPlan.videoTargets[0].priority).toBe("separate_reference");
		expect(learningPlan.videoTargets[0].suggestedMode).toBe("deep");
		expect(learningPlan.videoTargets[0].sourceUrl).toContain("trend-1");
		expect(learningPlan.learningRules.join(" ")).toContain("컷 밀도");
	});

	it("자동 레퍼런스 저장 결과에 트렌드 학습 메타데이터를 남긴다", () => {
		const enriched = attachTrendReferenceLearningToAnalysisResult(
			analysisResult(),
			candidate(),
		);

		expect(enriched.raw_analysis.trend_reference_learning).toMatchObject({
			source: "trend-reference-scout",
			representativeUrl: "https://www.youtube.com/watch?v=trend-1",
		});
		expect(enriched.raw_analysis.copy_boundary).toMatchObject({
			rawAssetsReusable: false,
			musicReusable: false,
		});
		expect(
			(enriched.raw_analysis.production_method as { rules: string[] }).rules.join(" "),
		).toContain("원본 자산");
	});
});
