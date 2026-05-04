import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import type { ReferenceChannelCandidate } from "./reference-channel-scout";
import {
	buildChannelStrategyPlan,
	CHANNEL_STRATEGY_REFRESH_INTERVAL_MS,
} from "./channel-strategy-ranker";

function template(overrides: Partial<ReferenceTemplate> = {}): ReferenceTemplate {
	return {
		id: "builtin-auto-mystery-doc-test",
		channel_id: "__builtin_reference__",
		name: "미스터리 다큐",
		source_type: "youtube",
		source_url: "",
		source_title: "Mystery documentary reference",
		source_creator: "",
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
		transition_style: "hardcut",
		pacing_preset: "medium",
		tts_voice_id: "",
		tts_provider: "openai",
		tts_speed: 1,
		tts_tone_keywords: [],
		bgm_mood: "tense",
		bgm_keywords: [],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [],
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

function liveCandidate(overrides: Partial<ReferenceChannelCandidate> = {}): ReferenceChannelCandidate {
	return {
		id: "automation_business:ch1",
		categoryId: "automation_business",
		categoryLabel: "AI/비즈니스 자동화",
		channelId: "ch1",
		channelTitle: "Workflow Lab",
		channelSubscriberCount: 12000,
		channelVideoCount: 80,
		channelViewCount: 4_000_000,
		hiddenSubscriberCount: false,
		score: 96,
		videoCount: 4,
		totalViews: 1_600_000,
		avgViewsPerDay: 48_000,
		longformShare: 0.7,
		sourceQueries: ["AI 비즈니스 자동화"],
		representativeVideo: {
			videoId: "v1",
			title: "AI automation workflow",
			description: "",
			thumbnail: "",
			channelId: "ch1",
			channelTitle: "Workflow Lab",
			publishedAt: "2026-04-01T00:00:00.000Z",
			durationSeconds: 620,
			viewCount: 900_000,
			likeCount: 30_000,
			commentCount: 1600,
			channelSubscriberCount: 12000,
			channelVideoCount: 80,
			channelViewCount: 4_000_000,
			hiddenSubscriberCount: false,
			ageDays: 30,
			viewsPerDay: 30_000,
			engagementRate: 0.036,
			viewSubscriberRatio: 75,
			score: 96,
			scoreParts: {
				velocity: 1,
				leverage: 1,
				engagement: 0.8,
				longform: 1,
				freshness: 0.9,
			},
		},
		topVideos: [],
		representativeUrl: "https://www.youtube.com/watch?v=v1",
		suggestedMode: "longform",
		...overrides,
	};
}

describe("channel-strategy-ranker", () => {
	it("현재 레퍼런스와 공개 데이터 근거로 채널 카테고리 순위를 만든다", () => {
		const plan = buildChannelStrategyPlan(template());

		expect(plan.rankings).toHaveLength(5);
		expect(plan.rankings[0].rank).toBe(1);
		expect(plan.rankings[0].score).toBeGreaterThanOrEqual(plan.rankings[1].score);
		expect(plan.rankings[0].nameCandidates.length).toBeGreaterThan(0);
		expect(plan.rankings[0].scoreFactors.every((factor) => factor.weight > 0)).toBe(true);
		expect(plan.sourceNotes.join(" ")).toContain("실측");
		expect(CHANNEL_STRATEGY_REFRESH_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
		expect(plan.evidenceSources.some((source) => source.kind === "official")).toBe(true);
		expect(plan.rankings[0].dataBasis.join(" ")).toContain("카테고리 쿼리");
		expect(plan.rankings[0].evidenceSources.length).toBeGreaterThan(0);
	});

	it("실측 후보 채널이 있으면 해당 카테고리 점수와 confidence를 올린다", () => {
		const plan = buildChannelStrategyPlan(template(), {
			automation_business: [
				liveCandidate(),
				liveCandidate({ id: "automation_business:ch2", channelId: "ch2", channelTitle: "AI Ops" }),
				liveCandidate({ id: "automation_business:ch3", channelId: "ch3", channelTitle: "NoCode Lab" }),
			],
		});

		const automation = plan.rankings.find(
			(item) => item.categoryId === "automation_business",
		);

		expect(automation?.confidence).toBe("live");
		expect(automation?.liveCandidateCount).toBe(3);
		expect(automation?.scoreFactors.some((factor) => factor.key === "live")).toBe(true);
		expect(automation?.liveEvidence.join(" ")).toContain("일평균");
		expect(automation?.evidenceSources.some((source) => source.kind === "live_api")).toBe(true);
	});
});
