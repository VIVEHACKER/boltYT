import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import {
	assessThumbnailReadiness,
	buildThumbnailPlanFromReference,
	finalizeReferenceThumbnailDna,
} from "./thumbnail-intelligence";

function makeReference(
	overrides: Partial<ReferenceTemplate> = {},
): ReferenceTemplate {
	return {
		id: "ref-thumb",
		channel_id: "ch-1",
		name: "미스터리 다큐 레퍼런스",
		source_type: "youtube",
		source_url: "https://www.youtube.com/watch?v=ref",
		source_title: "바다 한가운데 잠든 왕릉의 미스터리",
		source_creator: "creator",
		thumbnail_url: "https://img.youtube.com/vi/ref/maxresdefault.jpg",
		duration_seconds: 840,
		dominant_colors: ["#050505", "#f1c75b", "#ffffff"],
		visual_mood: "mystery",
		visual_prompt_template: "dark cinematic mystery",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "block",
		subtitle_accent_color: "#f1c75b",
		scene_count: 16,
		avg_scene_duration: 42,
		hook_duration: 7,
		transition_style: "mixed",
		pacing_preset: "medium",
		tts_voice_id: "",
		tts_provider: "openai",
		tts_speed: 1,
		tts_tone_keywords: ["긴장", "분석"],
		bgm_mood: "mysterious",
		bgm_keywords: ["documentary", "mystery"],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [],
		transcript: "",
		frame_urls: [],
		raw_analysis: {
			analysis_depth: "pixel_frame_audio_edit",
			production_dna: {
				analysisDepth: "pixel_frame_audio_edit",
			},
		},
		analysis_status: "complete",
		analysis_error: "",
		created_at: "2026-05-01T00:00:00.000Z",
		updated_at: "2026-05-01T00:00:00.000Z",
		...overrides,
	};
}

describe("thumbnail-intelligence", () => {
	it("레퍼런스 썸네일을 deep DNA와 실험 변형으로 구조화", () => {
		const dna = finalizeReferenceThumbnailDna(makeReference());

		expect(dna.version).toBe("thumbnail-dna-v1");
		expect(dna.analysisDepth).toBe("deep_structured");
		expect(dna.quality.score).toBeGreaterThanOrEqual(80);
		expect(dna.generation.variants).toHaveLength(3);
		expect(dna.clickPackaging.titleThumbnailRelationship).toContain("반복");
	});

	it("주제만 바꿔도 레퍼런스 레이아웃과 클릭 패키징을 유지", () => {
		const plan = buildThumbnailPlanFromReference({
			topicTitle: "한국 바다 유적의 풀리지 않은 기록",
			fallbackTitle: "바다 유적",
			isShorts: false,
			referenceTemplate: makeReference(),
		});

		expect(plan.title).toContain("한국");
		expect(plan.badgeText).toBeTruthy();
		expect(plan.referenceDna.source.templateId).toBe("ref-thumb");
		expect(plan.variants[0].testGoal).toContain("CTR");
	});

	it("업로드 전 썸네일 파일과 계획 유무를 준비도로 판단", () => {
		const warning = assessThumbnailReadiness({
			title: "짧은 제목",
			description: "설명",
		});
		expect(warning.level).toBe("warning");
		expect(warning.warnings.join(" ")).toContain("썸네일 파일");

		const plan = buildThumbnailPlanFromReference({
			topicTitle: "바다 왕릉 미스터리",
			fallbackTitle: "왕릉",
			isShorts: false,
			referenceTemplate: makeReference(),
		});
		const ready = assessThumbnailReadiness({
			title: "바다 왕릉 미스터리의 풀리지 않은 기록",
			description: "자료 기반 설명",
			thumbnailPath: "scripts/a/thumbnail.jpg",
			thumbnailPlan: plan,
		});

		expect(ready.level).toBe("ready");
		expect(ready.score).toBeGreaterThanOrEqual(78);
	});
});
