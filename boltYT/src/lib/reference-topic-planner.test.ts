import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import {
	buildReferenceTopicContentUrl,
	buildReferenceTopicPlan,
	inferCategoryProfile,
} from "./reference-topic-planner";

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
		duration_seconds: 62,
		dominant_colors: [],
		visual_mood: "mystery",
		visual_prompt_template: "",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "stroke",
		subtitle_accent_color: "#ffffff",
		scene_count: 8,
		avg_scene_duration: 8,
		hook_duration: 3,
		transition_style: "hardcut",
		pacing_preset: "fast",
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

describe("reference-topic-planner", () => {
	it("레퍼런스 카테고리에 맞는 성장 주제 플랜을 만든다", () => {
		const plan = buildReferenceTopicPlan(template());

		expect(plan.ideas.length).toBeGreaterThan(0);
		expect(plan.ideas[0].score).toBeGreaterThan(80);
		expect(plan.weeklyPlan).toHaveLength(3);
		expect(plan.strategy[0]).toContain("편집 문법");
		expect(plan.domainKnowledge.enforcementSummary.join(" ")).toContain("Q3");
		expect(plan.ideas[0].durationRange).toContain("목표");
		expect(plan.ideas[0].domainSignals.length).toBeGreaterThan(0);
	});

	it("사용자가 입력한 주제로 변주 아이디어를 만든다", () => {
		const plan = buildReferenceTopicPlan(template(), "한반도 바다 왕릉");

		expect(plan.defaultTopic).toBe("한반도 바다 왕릉");
		expect(plan.ideas[0].title).toContain("한반도 바다 왕릉");
		expect(plan.ideas.some((idea) => idea.title.includes("3가지"))).toBe(true);
	});

	it("드라마/비즈니스/애니메이션 카테고리를 추론한다", () => {
		expect(
			inferCategoryProfile(
				template({ id: "builtin-drama-recap-longform", name: "드라마 몰아보기" }),
			).id,
		).toBe("drama_recap");
		expect(
			inferCategoryProfile(
				template({
					name: "미스터리/사건 다큐",
					source_title: "저격 사건 분석 영상",
				}),
			).id,
		).toBe("mystery_doc");
		expect(
			inferCategoryProfile(
				template({
					id: "business-template",
					name: "automation money workflow",
					source_title: "creator business workflow",
				}),
			).id,
		).toBe("business");
		expect(
			inferCategoryProfile(
				template({
					id: "animation-template",
					name: "animation cartoon",
					source_title: "character animation",
				}),
			).id,
		).toBe("animation");
	});

	it("주제 포함 콘텐츠 생성 URL을 만든다", () => {
		const url = buildReferenceTopicContentUrl({
			template: template({ id: "ref1", channel_id: "ch1" }),
			topic: "테스트 주제",
		});

		expect(url).toContain("template=ref1");
		expect(url).toContain("source=reference_topic");
		expect(url).toContain("title=");
		expect(url).toContain("channel=ch1");
	});
});
