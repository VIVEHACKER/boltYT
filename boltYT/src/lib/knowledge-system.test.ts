import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import {
	buildKnowledgePrompt,
	buildReferenceKnowledgeProfile,
	buildRenderKnowledgeEvent,
	compactKnowledgeProfile,
} from "./knowledge-system";
import type { ProductionQualityReport } from "./youtube-production-quality";

function makeTemplate(overrides: Partial<ReferenceTemplate> = {}): ReferenceTemplate {
	return {
		id: "ref-knowledge",
		channel_id: "ch-1",
		name: "Knowledge Ref",
		source_type: "youtube",
		source_url: "https://youtu.be/ref",
		source_title: "Reference Video",
		source_creator: "Creator",
		thumbnail_url: "",
		duration_seconds: 900,
		dominant_colors: ["#111111", "#eeeeee"],
		visual_mood: "mystery",
		visual_prompt_template: "cinematic mystery layout",
		lighting_style: "mixed",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "block",
		subtitle_accent_color: "#f1c75b",
		scene_count: 18,
		avg_scene_duration: 50,
		hook_duration: 8,
		transition_style: "mixed",
		pacing_preset: "medium",
		tts_voice_id: "",
		tts_provider: "openai",
		tts_speed: 1,
		tts_tone_keywords: ["긴장", "분석"],
		bgm_mood: "mysterious",
		bgm_keywords: ["pulse", "documentary"],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [
			{ role: "hook", duration: 8, note: "질문" },
			{ role: "setup", duration: 80, note: "배경" },
			{ role: "turn", duration: 120, note: "반전" },
			{ role: "payoff", duration: 90, note: "결론" },
		],
		transcript: "자료 기반 나레이션 ".repeat(120),
		frame_urls: [],
		raw_analysis: {
			analysis_depth: "pixel_frame_audio_edit",
			analysis_mode: "deep_sampled_longform",
			generated_reference: true,
			source_duration_seconds: 900,
			production_method: {
				rules: ["원본 금지", "문장 끝 컷", "BGM 새 선택", "자료 우선"],
				referenceSources: [{ url: "https://youtu.be/ref" }],
			},
			production_dna: {
				analysisDepth: "pixel_frame_audio_edit",
				pixelPrecisionAvailable: true,
				frames: Array.from({ length: 12 }, (_, index) => ({ index })),
				camera: {
					mode: "documentary push-in",
					firstCutSeconds: 1.8,
					cutDensityPerMinute: 18,
					first3Motion: 0.72,
					sceneCutTimes: [2, 7, 13, 21, 34, 55],
				},
				layout: {
					compositionPattern: "center subject with lower subtitle",
					subtitleCollisionRisk: "medium",
					textSafeZones: ["bottom 24%"],
				},
				transitions: {
					rules: ["첫 문장 끝 hard cut", "반전 전 punch zoom"],
					cutTimes: [2, 7, 13, 21, 34, 55],
				},
				audio: {
					bgmMood: "mysterious",
					bgmTempo: "mid",
					integratedLufs: -16,
				},
				color: { temperature: "cool amber" },
				copyBoundary: { rawAssetsReusable: false },
			},
		},
		analysis_status: "complete",
		analysis_error: "",
		created_at: "2026-05-01T00:00:00.000Z",
		updated_at: "2026-05-01T00:00:00.000Z",
		...overrides,
	};
}

function makeReport(overrides: Partial<ProductionQualityReport> = {}): ProductionQualityReport {
	return {
		passed: true,
		score: 91,
		issues: [],
		requiredActions: [],
		metrics: {
			sceneCount: 12,
			totalDurationSeconds: 64,
			videoSceneRatio: 0.5,
			motionVisualRatio: 0.8,
			sourceAnchorRatio: 0.75,
			lowConfidenceShotRatio: 0,
			genericStockShotRatio: 0,
			reconstructionShotRatio: 0.1,
			textEmphasisRatio: 0,
			designedVisualRatio: 0.9,
			captionSyncRatio: 0.8,
			averageNarrationCharsPerSecond: 5.2,
			averageShotsPerVisualScene: 2,
			openingShotCount: 3,
			openingDynamicBeatCount: 2,
			lowMotionVideoShotRatio: 0.1,
			visualDiversityScore: 88,
			motionDiversityScore: 90,
			editorialDensityScore: 89,
			premiumFloorScore: 91,
			hasNarration: true,
			hasBgm: true,
			hasThumbnail: true,
			hasEndingCue: true,
		},
		...overrides,
	};
}

describe("knowledge-system", () => {
	it("명시지와 암묵지를 하나의 지식 프로필로 만든다", () => {
		const profile = buildReferenceKnowledgeProfile(makeTemplate());

		expect(profile.explicit.length).toBeGreaterThanOrEqual(6);
		expect(profile.tacit.length).toBeGreaterThanOrEqual(6);
		expect(profile.maturity).toBe("analysis-ready");
		expect(profile.score).toBeGreaterThanOrEqual(85);
		expect(buildKnowledgePrompt(profile)).toContain("명시지");
		expect(buildKnowledgePrompt(profile)).toContain("암묵지");
		expect(buildKnowledgePrompt(profile)).toContain("썸네일");
	});

	it("트렌드 레퍼런스 학습 규칙을 다음 생성 명시지로 반영한다", () => {
		const profile = buildReferenceKnowledgeProfile(
			makeTemplate({
				raw_analysis: {
					trend_reference_learning: {
						representativeUrl: "https://www.youtube.com/watch?v=trend",
						learningDirectives: [
							"트렌드 영상은 별도 deep 레퍼런스로 분석해 컷 호흡만 학습한다.",
						],
						safeTransformRules: ["원본 자산은 재사용하지 않는다."],
					},
				},
			}),
		);

		expect(
			profile.explicit.some((item) => item.label.startsWith("트렌드 레퍼런스 학습")),
		).toBe(true);
		expect(buildKnowledgePrompt(profile)).toContain("트렌드 영상은 별도");
	});

	it("렌더 결과를 성과지 이벤트로 변환하고 프로필에 반영", () => {
		const template = makeTemplate();
		const event = buildRenderKnowledgeEvent({
			referenceTemplate: template,
			productionReport: makeReport(),
			format: "shorts",
			renderOutputQc: {
				score: 88,
				passed: true,
				issues: [],
				requiredActions: [],
				metrics: { visualVariation: 0.8 },
			},
		});

		expect(event).not.toBeNull();
		expect(event?.learnedRules.join(" ")).toContain("QC");
		const profile = buildReferenceKnowledgeProfile(template, {
			events: event ? [event] : [],
		});
		expect(profile.maturity).toBe("outcome-calibrated");
		expect(profile.performance.length).toBeGreaterThan(0);
		expect(compactKnowledgeProfile(profile).performanceCount).toBeGreaterThan(0);
	});

	it("실패 이슈는 다음 생성 회피 규칙으로 남긴다", () => {
		const event = buildRenderKnowledgeEvent({
			referenceTemplate: makeTemplate(),
			productionReport: makeReport({
				passed: false,
				score: 62,
				issues: [
					{
						severity: "critical",
						code: "low_visual_variation",
						message: "정적 화면 반복",
					},
				],
				requiredActions: ["컷 밀도 보강"],
			}),
			format: "longform",
			repaired: true,
		});

		expect(event?.avoidRules.join(" ")).toContain("정적 이미지 반복");
		expect(event?.avoidRules.join(" ")).toContain("컷 밀도");
	});
});
