import { describe, expect, it } from "vitest";
import { assessReferenceApplicationScore } from "./reference-application-score";
import type { ReferenceTemplate } from "../types/database";

const reference = {
	id: "ref-1",
	name: "Mystery Reference",
	source_title: "Mystery Reference",
	source_url: "https://youtube.com/shorts/example",
	duration_seconds: 54,
	scene_count: 10,
	avg_scene_duration: 5,
	hook_duration: 3,
	hook_pattern: "question",
	pacing_preset: "fast",
	script_structure: [],
	visual_mood: "mystery",
	visual_prompt_template: "cinematic evidence",
	dominant_colors: ["#111111"],
	lighting_style: "dark",
	bgm_mood: "mysterious",
	bgm_tempo: "fast",
	tts_tone_keywords: ["low", "tense"],
	tts_provider: "openai",
	tts_voice_id: "",
	tts_speed: 1,
	subtitle_position: "bottom",
	subtitle_bg_style: "none",
	subtitle_size_preset: "md",
	subtitle_accent_color: "#f59e0b",
	transition_style: "mixed",
	raw_analysis: {
		production_dna: {
			camera: { cutDensityPerMinute: 12 },
		},
	},
} as unknown as ReferenceTemplate;

describe("reference-application-score", () => {
	it("scores a source-backed dynamic plan as passing", () => {
		const report = assessReferenceApplicationScore({
			referenceTemplate: reference,
			format: "shorts",
			topicTitle: "기록에는 남았지만 설명되지 않은 미스터리",
			sourceCount: 4,
			scenes: Array.from({ length: 10 }, (_, index) => ({
				narration: index === 0 ? "왜 이 기록은 아직 설명되지 않았을까요?" : "증거를 확인합니다.",
				type: "video",
				duration: index === 0 ? 3 : 5,
				shots: [
					{
						id: `shot-${index}`,
						kind: "context",
						media_type: "video",
						duration_seconds: 2.5,
						source_url: `https://example.com/${index}.mp4`,
						selection_provider: "direct",
						visual_role: "evidence",
						motion: "push_in",
					},
				],
			})),
		});

		expect(report.passed).toBe(true);
		expect(report.score).toBeGreaterThanOrEqual(72);
	});

	it("flags missing source anchors and weak hook", () => {
		const report = assessReferenceApplicationScore({
			referenceTemplate: reference,
			format: "shorts",
			scenes: [
				{
					narration: "일반적인 도입입니다.",
					type: "image",
					duration: 12,
					shots: [
						{
							id: "s1",
							kind: "context",
							duration_seconds: 12,
							motion: "static",
						},
					],
				},
			],
		});

		expect(report.passed).toBe(false);
		expect(report.issues.map((issue) => issue.code)).toContain(
			"weak_reference_hook",
		);
		expect(report.issues.map((issue) => issue.code)).toContain(
			"source_anchor_gap",
		);
	});
});
