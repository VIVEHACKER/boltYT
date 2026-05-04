import { describe, expect, it } from "vitest";
import type {
	Brief,
	ReferenceTemplate,
	Render,
	Scene,
	Script,
	Topic,
	Upload,
} from "../types/database";
import {
	evaluateProductionPipeline,
	PRODUCTION_PIPELINE_GATES,
	type ProductionPipelineInput,
} from "./production-pipeline-guard";

function topic(): Partial<Topic> {
	return {
		id: "topic-1",
		channel_id: "channel-1",
		title: "바다 한가운데 잠든 왕릉의 미스터리",
		status: "active",
		source: "manual",
	};
}

function brief(): Partial<Brief> {
	return {
		id: "brief-1",
		topic_id: "topic-1",
		core_message: "기록과 현장 자료의 빈틈을 따라 미스터리를 해설한다.",
		target_audience: "미스터리 다큐 시청자",
		cautions: "단정 표현 금지",
	};
}

function script(overrides: Partial<Script> = {}): Partial<Script> {
	return {
		id: "script-1",
		brief_id: "brief-1",
		format: "longform",
		content_json: {
			format_selection: "longform",
			shorts_script:
				"바다 한가운데 잠든 왕릉은 왜 기록과 다르게 남아 있을까요? 단서를 따라가며 가장 설득력 있는 해석을 확인합니다.",
			longform_scenes: [{ narration: "첫 단서" }, { narration: "두 번째 단서" }],
			story_edit: {
				hook: "바다 한가운데 잠든 왕릉은 왜 기록과 다를까요?",
				storyAngle: "기록, 지도, 반론을 순서대로 회수",
				viewerQuestion: "아직 설명되지 않은 단서는 무엇인가?",
				endingBeat: "가장 강한 가설과 남은 의문을 함께 남긴다.",
			},
		},
		status: "approved",
		version: 1,
		reference_template_id: "ref-1",
		...overrides,
	};
}

function scenes(overrides: Array<Partial<Scene>> = []): Array<Partial<Scene>> {
	const base: Array<Partial<Scene>> = [
		{
			id: "scene-1",
			script_id: "script-1",
			order_index: 0,
			narration_text: "첫 단서입니다.",
			scene_type: "news_overlay",
			visual_prompt: "official document close-up with map overlay",
			duration_seconds: 20,
			source_index: 0,
			shots: [{ id: "shot-1", kind: "evidence", duration_seconds: 8 }],
		},
		{
			id: "scene-2",
			script_id: "script-1",
			order_index: 1,
			narration_text: "두 번째 단서입니다.",
			scene_type: "image",
			visual_prompt: "cinematic shoreline evidence photo composition",
			duration_seconds: 22,
			source_index: 1,
			shots: [{ id: "shot-2", kind: "detail", duration_seconds: 8 }],
		},
		{
			id: "scene-3",
			script_id: "script-1",
			order_index: 2,
			narration_text: "마지막 반론입니다.",
			scene_type: "video",
			visual_prompt: "slow documentary drone footage over dark sea",
			duration_seconds: 18,
			source_index: 2,
			shots: [{ id: "shot-3", kind: "context", duration_seconds: 8 }],
		},
	];
	return base.map((scene, index) => ({ ...scene, ...(overrides[index] ?? {}) }));
}

function render(overrides: Partial<Render> = {}): Partial<Render> {
	return {
		id: "render-1",
		script_id: "script-1",
		format: "longform",
		aspect_ratio: "16:9",
		storage_path: "renders/video.mp4",
		duration_seconds: 60,
		status: "completed",
		qc_result_json: { passed: true, score: 92 },
		...overrides,
	};
}

function upload(overrides: Partial<Upload> = {}): Partial<Upload> {
	return {
		id: "upload-1",
		render_id: "render-1",
		platform: "youtube",
		title: "바다 한가운데 잠든 왕릉의 미스터리",
		description:
			"기록과 현장 자료를 바탕으로 바다 한가운데 잠든 왕릉의 의문을 해설합니다. 출처와 반론을 함께 정리합니다.",
		tags: ["미스터리", "다큐", "왕릉"],
		thumbnail_path: "thumbnails/upload-1.jpg",
		status: "queued",
		...overrides,
	};
}

function referenceTemplate(overrides: Partial<ReferenceTemplate> = {}): ReferenceTemplate {
	return {
		id: "ref-1",
		channel_id: "channel-1",
		name: "미스터리 다큐 레퍼런스",
		source_type: "youtube",
		source_url: "https://youtube.com/watch?v=ref",
		source_title: "Reference",
		source_creator: "creator",
		thumbnail_url: "",
		duration_seconds: 840,
		dominant_colors: ["#050505", "#f1c75b"],
		visual_mood: "mystery",
		visual_prompt_template: "dark cinematic documentary",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "stroke",
		subtitle_accent_color: "#f1c75b",
		scene_count: 18,
		avg_scene_duration: 46,
		hook_duration: 3,
		transition_style: "hardcut",
		pacing_preset: "medium",
		tts_voice_id: "voice",
		tts_provider: "openai",
		tts_speed: 1,
		tts_tone_keywords: ["긴장", "분석"],
		bgm_mood: "tense",
		bgm_keywords: ["mystery", "documentary"],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [
			{ role: "hook", duration: 12, note: "질문형 훅" },
			{ role: "context", duration: 80, note: "맥락" },
			{ role: "evidence", duration: 240, note: "증거" },
			{ role: "ending", duration: 60, note: "정리" },
		],
		transcript: "전사 ".repeat(500),
		frame_urls: [],
		raw_analysis: {
			analysis_depth: "pixel_frame_audio_edit",
			source_duration_seconds: 840,
			production_dna: {
				analysisDepth: "pixel_frame_audio_edit",
				pixelPrecisionAvailable: true,
				frames: Array.from({ length: 12 }, (_, index) => ({ index })),
				camera: { sceneCutTimes: [0, 3, 8, 12, 18, 25, 31] },
				audio: { integratedLufs: -15, volumeMeanDb: -20 },
				copyBoundary: { rawAssetsReusable: false },
			},
			production_method: {
				rules: ["질문형 훅", "자료 컷", "반론", "결론"],
				referenceSources: ["frame", "audio"],
			},
		},
		analysis_status: "complete",
		analysis_error: "",
		created_at: "",
		updated_at: "",
		...overrides,
	};
}

function baseInput(overrides: Partial<ProductionPipelineInput> = {}): ProductionPipelineInput {
	return {
		topic: topic(),
		brief: brief(),
		script: script(),
		scenes: scenes(),
		render: render(),
		upload: upload(),
		referenceTemplate: referenceTemplate(),
		sources: [
			{ id: "src-1", type: "article", title: "공식 기록", url: "https://example.com/a" },
			{ id: "src-2", type: "image", title: "현장 사진", url: "https://example.com/b.jpg" },
			{ id: "src-3", type: "video", title: "해안 영상", url: "https://example.com/c.mp4" },
		],
		...overrides,
	};
}

describe("production-pipeline-guard", () => {
	it("10개 제작 파이프라인 게이트를 고정한다", () => {
		const gateIds = PRODUCTION_PIPELINE_GATES.map((gate) => gate.id);

		expect(PRODUCTION_PIPELINE_GATES).toHaveLength(10);
		expect(new Set(gateIds).size).toBe(gateIds.length);
		expect(gateIds).toEqual([
			"topic-brief-contract",
			"script-format-contract",
			"script-content-floor",
			"story-edit-contract",
			"scene-timeline-integrity",
			"source-index-integrity",
			"shot-coverage-contract",
			"reference-quality-contract",
			"render-qc-contract",
			"upload-readiness-contract",
		]);
		expect(evaluateProductionPipeline({}).results.map((result) => result.id)).toEqual(gateIds);
	});

	it("완성된 제작 파이프라인은 ready로 통과한다", () => {
		const report = evaluateProductionPipeline(baseInput());

		expect(report.verdict).toBe("ready");
		expect(report.score).toBe(100);
		expect(report.passedCount).toBe(10);
		expect(report.nextActions.join(" ")).toContain("10개");
	});

	it("대본/포맷/타임라인/렌더/업로드 충돌을 blocking으로 잡는다", () => {
		const report = evaluateProductionPipeline(
			baseInput({
				topic: { ...topic(), title: "" },
				script: script({
					format: "shorts",
					content_json: {
						format_selection: "longform",
						shorts_script: "짧음",
						longform_scenes: [],
					},
				}),
				scenes: scenes([
					{ duration_seconds: 0 },
					{ order_index: 0, source_index: 9 },
				]),
				render: render({
					format: "longform",
					status: "failed",
					qc_result_json: { passed: false, score: 40 },
				}),
				upload: upload({ title: "", description: "", thumbnail_path: "" }),
				referenceTemplate: referenceTemplate({
					duration_seconds: 2000,
					raw_analysis: { analysis_depth: "metadata_only" },
				}),
			}),
		);

		expect(report.verdict).toBe("blocked");
		expect(report.blockers.length).toBeGreaterThanOrEqual(6);
		expect(report.results.find((item) => item.id === "topic-brief-contract")?.status).toBe(
			"fail",
		);
		expect(report.results.find((item) => item.id === "script-format-contract")?.status).toBe(
			"fail",
		);
		expect(report.results.find((item) => item.id === "scene-timeline-integrity")?.status).toBe(
			"fail",
		);
		expect(report.results.find((item) => item.id === "reference-quality-contract")?.status).toBe(
			"fail",
		);
		expect(report.results.find((item) => item.id === "render-qc-contract")?.status).toBe(
			"fail",
		);
		expect(report.results.find((item) => item.id === "upload-readiness-contract")?.status).toBe(
			"fail",
		);
	});

	it("비차단 품질 저하는 review로 남기고 구체 액션을 제안한다", () => {
		const report = evaluateProductionPipeline(
			baseInput({
				script: script({
					content_json: {
						format_selection: "longform",
						shorts_script:
							"바다 한가운데 잠든 왕릉은 왜 기록과 다르게 남아 있을까요? 단서를 따라가며 가장 설득력 있는 해석을 확인합니다.",
						longform_scenes: [{ narration: "첫 단서" }],
						story_edit: { hook: "" },
					},
				}),
				scenes: scenes([{ shots: [], visual_prompt: "" }]),
			}),
		);

		expect(report.verdict).toBe("review");
		expect(report.blockers).toHaveLength(0);
		expect(report.warnings.some((warning) => warning.id === "story-edit-contract")).toBe(true);
		expect(report.warnings.some((warning) => warning.id === "shot-coverage-contract")).toBe(true);
		expect(report.nextActions.join(" ")).toContain("스토리");
	});
});
