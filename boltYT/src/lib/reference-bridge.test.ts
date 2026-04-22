/**
 * reference-bridge.ts 단위 테스트
 *
 * 모든 함수가 순수 함수 → 외부 의존 없음.
 */

import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import type { ReferencePreset } from "./reference-bridge";
import {
	buildScriptConstraint,
	enrichVisualPrompt,
	referenceToPreset,
} from "./reference-bridge";

function makeRef(
	overrides: Partial<ReferenceTemplate> = {},
): ReferenceTemplate {
	return {
		id: "ref-1",
		channel_id: "ch-1",
		name: "테스트 레퍼런스",
		source_type: "youtube",
		source_url: "",
		source_title: "",
		source_creator: "",
		thumbnail_url: "",
		duration_seconds: 60,
		dominant_colors: ["#000", "#fff"],
		visual_mood: "mystery",
		visual_prompt_template: "dark atmospheric scene",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "md",
		subtitle_bg_style: "pill",
		subtitle_accent_color: "#ff0000",
		scene_count: 8,
		avg_scene_duration: 4,
		hook_duration: 3,
		transition_style: "crossfade",
		pacing_preset: "fast",
		tts_voice_id: "",
		tts_provider: "openai",
		tts_speed: 1.0,
		tts_tone_keywords: ["긴장감", "몰입"],
		bgm_mood: "mysterious",
		bgm_keywords: ["mystery", "detective"],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [
			{ role: "hook", duration: 3, note: "강렬한 질문" },
			{ role: "body", duration: 30, note: "사건 전개" },
		],
		transcript: "",
		frame_urls: [],
		raw_analysis: {},
		analysis_status: "complete",
		analysis_error: "",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

// ─── referenceToPreset ────────────────────────────────────────────────────────
describe("referenceToPreset", () => {
	it("shorts 포맷 → isShorts=true 반영", () => {
		const preset = referenceToPreset(makeRef(), "shorts");
		expect(preset.composition.subtitleStyle.fontWeight).toBe(700);
		expect(preset.script.sceneCount).toBe(8);
	});

	it("longform 포맷 → fontWeight 600", () => {
		const preset = referenceToPreset(makeRef(), "longform");
		expect(preset.composition.subtitleStyle.fontWeight).toBe(600);
	});

	it("bgm_mood 매핑 → BgmMood 반환", () => {
		const preset = referenceToPreset(makeRef({ bgm_mood: "mysterious" }));
		expect(preset.bgm.mood).toBe("mysterious");
	});

	it("bgm_mood 별칭(suspense) → 'tense' 매핑", () => {
		const preset = referenceToPreset(makeRef({ bgm_mood: "suspense" }));
		expect(preset.bgm.mood).toBe("tense");
	});

	it("bgm_mood 알 수 없으면 빈 문자열", () => {
		const preset = referenceToPreset(makeRef({ bgm_mood: "unknown_mood" }));
		expect(preset.bgm.mood).toBe("");
	});

	it("subtitle_size_preset xs → 작은 폰트", () => {
		const preset = referenceToPreset(
			makeRef({ subtitle_size_preset: "xs" }),
			"shorts",
		);
		expect(preset.composition.subtitleStyle.fontSize).toBe(40);
	});

	it("subtitle_size_preset xl → 큰 폰트", () => {
		const preset = referenceToPreset(
			makeRef({ subtitle_size_preset: "xl" }),
			"shorts",
		);
		expect(preset.composition.subtitleStyle.fontSize).toBe(84);
	});

	it("transition_style hardcut → 'none'", () => {
		const preset = referenceToPreset(makeRef({ transition_style: "hardcut" }));
		expect(preset.composition.defaultTransition).toBe("none");
	});

	it("transition_style zoom → 'zoom'", () => {
		const preset = referenceToPreset(makeRef({ transition_style: "zoom" }));
		expect(preset.composition.defaultTransition).toBe("zoom");
	});

	it("scene_count 0 → 쇼츠 기본값 8", () => {
		const preset = referenceToPreset(makeRef({ scene_count: 0 }), "shorts");
		expect(preset.script.sceneCount).toBe(8);
	});

	it("tts 옵션 매핑", () => {
		const preset = referenceToPreset(makeRef());
		expect(preset.tts.toneKeywords).toContain("긴장감");
		expect(preset.tts.speed).toBe(1.0);
	});
});

// ─── enrichVisualPrompt ────────────────────────────────────────────────────────
describe("enrichVisualPrompt", () => {
	const preset = referenceToPreset(makeRef());

	it("씬 프롬프트 + 스타일 + 색상 + 조명 조합", () => {
		const result = enrichVisualPrompt("mysterious alley at night", preset);
		expect(result).toContain("mysterious alley at night");
		expect(result).toContain("dark atmospheric scene");
		expect(result).toContain("low-key dark lighting");
	});

	it("dominant_colors 없으면 색상 힌트 생략", () => {
		const noColorPreset = referenceToPreset(makeRef({ dominant_colors: [] }));
		const result = enrichVisualPrompt("scene", noColorPreset);
		expect(result).not.toContain("color palette");
	});

	it("lighting bright → 'bright high-key lighting'", () => {
		const brightPreset = referenceToPreset(
			makeRef({ lighting_style: "bright" }),
		);
		expect(enrichVisualPrompt("scene", brightPreset)).toContain(
			"bright high-key lighting",
		);
	});

	it("lighting mixed → 'dynamic contrast lighting'", () => {
		const mixedPreset = referenceToPreset(makeRef({ lighting_style: "mixed" }));
		expect(enrichVisualPrompt("scene", mixedPreset)).toContain(
			"dynamic contrast lighting",
		);
	});

	it("lighting natural → 'natural cinematic lighting'", () => {
		const naturalPreset = referenceToPreset(
			makeRef({ lighting_style: "natural" }),
		);
		expect(enrichVisualPrompt("scene", naturalPreset)).toContain(
			"natural cinematic lighting",
		);
	});
});

// ─── buildScriptConstraint ────────────────────────────────────────────────────
describe("buildScriptConstraint", () => {
	const preset = referenceToPreset(makeRef());

	it("씬 수 포함", () => {
		const result = buildScriptConstraint(preset);
		expect(result).toContain("씬 수: 8개");
	});

	it("훅 패턴 포함", () => {
		const result = buildScriptConstraint(preset);
		expect(result).toContain("훅 패턴: question");
	});

	it("톤 키워드 포함", () => {
		const result = buildScriptConstraint(preset);
		expect(result).toContain("긴장감");
	});

	it("script_structure 있으면 구조 출력", () => {
		const result = buildScriptConstraint(preset);
		expect(result).toContain("hook");
		expect(result).toContain("강렬한 질문");
	});

	it("script_structure 없으면 구조 섹션 생략", () => {
		const noStructurePreset: ReferencePreset = {
			...preset,
			script: { ...preset.script, structure: [] },
		};
		const result = buildScriptConstraint(noStructurePreset);
		expect(result).not.toContain("씬 구조");
	});

	it("toneKeywords 없으면 톤 섹션 생략", () => {
		const noTonePreset: ReferencePreset = {
			...preset,
			tts: { ...preset.tts, toneKeywords: [] },
		};
		const result = buildScriptConstraint(noTonePreset);
		expect(result).not.toContain("음성/톤 키워드");
	});

	it("hookPattern 없으면 훅 섹션 생략", () => {
		const noHookPreset: ReferencePreset = {
			...preset,
			script: { ...preset.script, hookPattern: "" },
		};
		const result = buildScriptConstraint(noHookPreset);
		expect(result).not.toContain("훅 패턴");
	});
});
