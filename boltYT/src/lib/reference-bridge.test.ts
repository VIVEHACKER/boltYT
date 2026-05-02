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
		expect(preset.script.targetDuration).toBe(32);
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

	it("인터뷰/클립 큐레이션형 레퍼런스 → social_clip_card 레이아웃", () => {
		const preset = referenceToPreset(
			makeRef({
				source_url: "https://www.youtube.com/shorts/hmDt88ANJMI",
				source_creator: "@ssulply",
				source_title: "요즘 MZ들의 신박한 헌팅 방법",
				visual_prompt_template:
					"street interview footage inside a curated social clip card",
			}),
			"shorts",
		);
		expect(preset.composition.sceneLayout).toBe("social_clip_card");
	});

	it("raw_analysis.production_method.sceneLayout → 명시 레이아웃 우선 적용", () => {
		const preset = referenceToPreset(
			makeRef({
				source_title: "일반 제목",
				raw_analysis: {
					production_method: {
						sceneLayout: "social_clip_card",
					},
				},
			}),
			"shorts",
		);
		expect(preset.composition.sceneLayout).toBe("social_clip_card");
	});

	it("롱폼에서는 social_clip_card를 그대로 강제하지 않음", () => {
		const preset = referenceToPreset(
			makeRef({
				raw_analysis: {
					production_method: {
						sceneLayout: "social_clip_card",
					},
				},
			}),
			"longform",
		);
		expect(preset.composition.sceneLayout).toBeUndefined();
	});

	it("format별 sceneLayouts가 있으면 롱폼 레이아웃을 우선 적용", () => {
		const preset = referenceToPreset(
			makeRef({
				raw_analysis: {
					production_method: {
						sceneLayout: "social_clip_card",
						sceneLayouts: {
							shorts: "social_clip_card",
							longform: "full",
						},
					},
				},
			}),
			"longform",
		);
		expect(preset.composition.sceneLayout).toBe("full");
	});

	it("formatProfiles가 있으면 포맷별 길이/씬 힌트를 우선 적용", () => {
		const preset = referenceToPreset(
			makeRef({
				raw_analysis: {
					production_method: {
						formatProfiles: {
							longform: {
								durationSeconds: 240,
								sceneCount: 12,
								avgSceneDuration: 20,
								hookDuration: 10,
							},
						},
					},
				},
			}),
			"longform",
		);
		expect(preset.script.targetDuration).toBe(240);
		expect(preset.script.sceneCount).toBe(12);
		expect(preset.script.avgSceneDuration).toBe(20);
		expect(preset.script.hookDuration).toBe(10);
	});

	it("raw_analysis.production_dna → 프리셋에 보존", () => {
		const preset = referenceToPreset(
			makeRef({
				raw_analysis: {
					production_dna: {
						version: "production-dna-v1",
						camera: { mode: "cut_driven", cutDensityPerMinute: 24 },
					},
				},
			}),
			"shorts",
		);
		expect(preset.productionDna?.version).toBe("production-dna-v1");
		expect((preset.productionDna?.camera as { mode?: string }).mode).toBe(
			"cut_driven",
		);
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

	it("production_dna가 있으면 이미지 프롬프트에 카메라/배치 힌트 주입", () => {
		const dnaPreset = referenceToPreset(
			makeRef({
				raw_analysis: {
					production_dna: {
						layout: {
							compositionPattern: "rule_of_thirds",
							subjectZone: "middle_right",
							subtitleCollisionRisk: "high",
						},
						camera: { mode: "handheld", motionIntensity: 0.62 },
						color: { temperature: "warm" },
					},
				},
			}),
		);
		const result = enrichVisualPrompt("scene", dnaPreset);
		expect(result).toContain("camera mode: handheld");
		expect(result).toContain("rule_of_thirds");
		expect(result).toContain("subtitle collision risk: high");
	});
});

// ─── buildScriptConstraint ────────────────────────────────────────────────────
describe("buildScriptConstraint", () => {
	const preset = referenceToPreset(makeRef());

	it("씬 수 포함", () => {
		const result = buildScriptConstraint(preset);
		expect(result).toContain("씬 수: 8개");
	});

	it("목표 길이 포함", () => {
		const result = buildScriptConstraint(preset);
		expect(result).toContain("목표 길이: 32초");
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

	it("production_dna가 있으면 스크립트 제약에 컷/카메라/전환 규칙 포함", () => {
		const dnaPreset = referenceToPreset(
			makeRef({
				raw_analysis: {
					production_dna: {
						camera: {
							mode: "cut_driven",
							cutDensityPerMinute: 18.5,
							avgCutIntervalSeconds: 3.2,
							firstCutSeconds: 1.4,
							first3Motion: 0.58,
						},
						layout: {
							compositionPattern: "top_title_card",
							subjectZone: "center",
							textSafeZones: ["bottom_center_with_stroke"],
						},
						subtitles: { collisionRisk: "medium" },
						transitions: {
							rules: ["첫 문장 끝에서 hard cut", "반전 전 punch zoom"],
						},
						audio: { bgmMood: "tense", bgmTempo: "fast", integratedLufs: -14.2 },
					},
				},
			}),
		);
		const result = buildScriptConstraint(dnaPreset);
		expect(result).toContain("제작 DNA");
		expect(result).toContain("카메라 모드: cut_driven");
		expect(result).toContain("컷 밀도: 분당 18.5컷 기준");
		expect(result).toContain("평균 컷 간격: 3.2초");
		expect(result).toContain("첫 컷: 1.4초");
		expect(result).toContain("초반 3초 모션 강도: 0.58");
		expect(result).toContain("레퍼런스 LUFS -14.2");
		expect(result).toContain("첫 문장 끝에서 hard cut");
	});
});
