/**
 * Reference Template → 파이프라인 프리셋 변환
 *
 * ReferenceTemplate을 ai/tts/image-gen/bgm/remotion 각 단계가 소비 가능한
 * 프리셋 객체로 변환.
 */

import type {
	CaptionStyle,
	SceneMood,
	SubtitleStyle,
	TransitionType,
} from "../remotion/types";
import type { ReferenceTemplate } from "../types/database";
import type { BgmMood } from "./bgm";
import type { TtsOptions } from "./tts";

export interface ReferencePreset {
	// 스크립트 생성 힌트
	script: {
		sceneCount: number;
		avgSceneDuration: number;
		hookDuration: number;
		hookPattern: ReferenceTemplate["hook_pattern"];
		pacing: ReferenceTemplate["pacing_preset"];
		structure: ReferenceTemplate["script_structure"];
		mood: SceneMood;
	};
	// 이미지 생성
	image: {
		promptTemplate: string;
		mood: SceneMood;
		dominantColors: string[];
		lighting: ReferenceTemplate["lighting_style"];
	};
	// TTS
	tts: TtsOptions & {
		toneKeywords: string[];
	};
	// BGM
	bgm: {
		mood: BgmMood | "";
		keywords: string[];
		tempo: ReferenceTemplate["bgm_tempo"];
	};
	// Remotion 컴포지션
	composition: {
		subtitleStyle: Required<SubtitleStyle>;
		captionStyle: CaptionStyle;
		subtitlePosition: ReferenceTemplate["subtitle_position"];
		subtitleBgStyle: ReferenceTemplate["subtitle_bg_style"];
		defaultTransition: TransitionType;
	};
}

// ─── 매핑 헬퍼 ───

const SIZE_FONT_MAP: Record<
	ReferenceTemplate["subtitle_size_preset"],
	{ regular: number; emphasis: number; shorts: number; shortsEmphasis: number }
> = {
	xs: { regular: 32, emphasis: 52, shorts: 40, shortsEmphasis: 64 },
	sm: { regular: 40, emphasis: 64, shorts: 48, shortsEmphasis: 76 },
	md: { regular: 46, emphasis: 76, shorts: 56, shortsEmphasis: 88 },
	lg: { regular: 56, emphasis: 88, shorts: 68, shortsEmphasis: 104 },
	xl: { regular: 68, emphasis: 104, shorts: 84, shortsEmphasis: 128 },
};

const TRANSITION_MAP: Record<
	ReferenceTemplate["transition_style"],
	TransitionType
> = {
	hardcut: "none",
	crossfade: "crossfade",
	zoom: "zoom",
	mixed: "crossfade", // 시작값만; AI가 씬별로 변주
};

const BGM_MOOD_MAP: Record<string, BgmMood> = {
	dark: "dark",
	tense: "tense",
	mysterious: "mysterious",
	dramatic: "dramatic",
	calm: "calm",
	upbeat: "upbeat",
	epic: "epic",
	sad: "sad",
	// 별칭
	suspense: "tense",
	mystery: "mysterious",
	horror: "dark",
	cinematic: "dramatic",
};

export function referenceToPreset(
	ref: ReferenceTemplate,
	format: "shorts" | "longform" = "shorts",
): ReferencePreset {
	const fontSizes = SIZE_FONT_MAP[ref.subtitle_size_preset] ?? SIZE_FONT_MAP.md;
	const isShorts = format === "shorts";
	const fontSize = isShorts ? fontSizes.shorts : fontSizes.regular;
	const emphasisFontSize = isShorts
		? fontSizes.shortsEmphasis
		: fontSizes.emphasis;

	const bgmMoodKey = ref.bgm_mood.toLowerCase().trim();
	const bgmMood = BGM_MOOD_MAP[bgmMoodKey] ?? "";

	return {
		script: {
			sceneCount: ref.scene_count || (isShorts ? 8 : 10),
			avgSceneDuration: ref.avg_scene_duration || (isShorts ? 4 : 10),
			hookDuration: ref.hook_duration || 3,
			hookPattern: ref.hook_pattern,
			pacing: ref.pacing_preset,
			structure: ref.script_structure,
			mood: ref.visual_mood,
		},
		image: {
			promptTemplate: ref.visual_prompt_template,
			mood: ref.visual_mood,
			dominantColors: ref.dominant_colors,
			lighting: ref.lighting_style,
		},
		tts: {
			voice: ref.tts_voice_id || undefined,
			provider: ref.tts_provider,
			speed: ref.tts_speed || 1.0,
			toneKeywords: ref.tts_tone_keywords,
		},
		bgm: {
			mood: bgmMood,
			keywords: ref.bgm_keywords,
			tempo: ref.bgm_tempo,
		},
		composition: {
			subtitleStyle: {
				fontSize,
				emphasisFontSize,
				fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
				fontWeight: isShorts ? 700 : 600,
				color: "#ffffff",
			},
			captionStyle: "chunked",
			subtitlePosition: ref.subtitle_position,
			subtitleBgStyle: ref.subtitle_bg_style,
			defaultTransition: TRANSITION_MAP[ref.transition_style] ?? "crossfade",
		},
	};
}

/**
 * 씬별 visual_prompt에 템플릿의 시각 스타일 DNA를 주입.
 * 원본 prompt는 WHAT(내용), 템플릿은 HOW(스타일).
 */
export function enrichVisualPrompt(
	sceneVisualPrompt: string,
	preset: ReferencePreset,
): string {
	const style = preset.image.promptTemplate.trim();
	const colorHint =
		preset.image.dominantColors.length > 0
			? `color palette: ${preset.image.dominantColors.slice(0, 4).join(", ")}`
			: "";
	const lightingHint =
		preset.image.lighting === "dark"
			? "low-key dark lighting"
			: preset.image.lighting === "bright"
				? "bright high-key lighting"
				: preset.image.lighting === "mixed"
					? "dynamic contrast lighting"
					: "natural cinematic lighting";

	const parts = [sceneVisualPrompt, style, colorHint, lightingHint].filter(
		Boolean,
	);
	return parts.join(", ");
}

/**
 * 스크립트 생성 프롬프트에 끼워넣을 "레퍼런스 준수 지시" 문자열.
 */
export function buildScriptConstraint(preset: ReferencePreset): string {
	const s = preset.script;
	const structureStr =
		s.structure.length > 0
			? `\n씬 구조(레퍼런스 참조):\n${s.structure
					.map(
						(row, i) =>
							`  ${i + 1}. [${row.role}] ${row.duration}초 — ${row.note}`,
					)
					.join("\n")}`
			: "";

	const toneStr =
		preset.tts.toneKeywords.length > 0
			? `\n음성/톤 키워드: ${preset.tts.toneKeywords.join(", ")} (나레이션 문체에 반영)`
			: "";

	const hookStr = s.hookPattern
		? `\n훅 패턴: ${s.hookPattern} (첫 ${s.hookDuration}초에 이 패턴 사용)`
		: "";

	return `
=== 레퍼런스 스타일 준수 ===
- 씬 수: ${s.sceneCount}개 (±1 허용)
- 평균 씬 길이: ${s.avgSceneDuration}초
- 페이싱: ${s.pacing}
- 무드: ${s.mood}${hookStr}${toneStr}${structureStr}
`.trim();
}
