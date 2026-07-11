/**
 * Reference Template → 파이프라인 프리셋 변환
 *
 * ReferenceTemplate을 ai/tts/image-gen/bgm/remotion 각 단계가 소비 가능한
 * 프리셋 객체로 변환.
 */

import type {
	CaptionStyle,
	LayoutVariant,
	SceneMood,
	SubtitleStyle,
	TransitionType,
} from "../remotion/types";
import { captionStyleFor } from "../remotion/typography";
import type { ReferenceTemplate } from "../types/database";
import type { BgmMood } from "./bgm";
import {
	buildKnowledgePrompt,
	buildReferenceKnowledgeProfile,
	type ProductionKnowledgeProfile,
} from "./knowledge-system";
import { LONGFORM_MAX_DURATION_SECONDS } from "./reference-duration-policy";
import {
	finalizeReferenceThumbnailDna,
	type ReferenceThumbnailDna,
} from "./thumbnail-intelligence";
import type { TtsOptions } from "./tts";
import { buildDomainKnowledgePrompt } from "./youtube-domain-intelligence";

export interface ReferencePreset {
	// 스크립트 생성 힌트
	script: {
		sceneCount: number;
		avgSceneDuration: number;
		hookDuration: number;
		targetDuration: number;
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
		sceneLayout?: LayoutVariant;
	};
	// 레퍼런스 분석기가 저장한 픽셀/오디오/편집 DNA 원본.
	// 렌더러가 직접 복제하지 않고, 프롬프트/자동편집 힌트로만 소비한다.
	productionDna?: Record<string, unknown>;
	// 명시지/암묵지/성과지를 합친 생성 지식 프로필.
	knowledgeProfile?: ProductionKnowledgeProfile;
	// 제목/썸네일 역할, 문구 길이, 텍스트 안전 영역을 담은 클릭 패키징 DNA.
	thumbnailDna?: ReferenceThumbnailDna;
}

// ─── 매핑 헬퍼 ───

// 자막 크기 스케일(xs~xl)은 typography.ts 의 CAPTION_SIZE_SCALE 단일 소스로 이관.
// 최종 자막 스타일은 captionStyleFor(format, preset) 로 파생한다(아래 referenceToPreset).

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

const LAYOUT_VARIANTS: LayoutVariant[] = [
	"full",
	"split",
	"letterbox",
	"social_clip_card",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLayoutVariant(value: unknown): value is LayoutVariant {
	return (
		typeof value === "string" &&
		LAYOUT_VARIANTS.includes(value as LayoutVariant)
	);
}

function numericField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

function finiteNumberField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function clampTargetDuration(
	durationSeconds: number,
	format: "shorts" | "longform",
): number {
	if (format !== "longform") return durationSeconds;
	return Math.min(durationSeconds, LONGFORM_MAX_DURATION_SECONDS);
}

function formatNumber(value: number, decimals = 1): string {
	const rounded = Number(value.toFixed(decimals));
	return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

function productionDnaFromRaw(
	ref: ReferenceTemplate,
): Record<string, unknown> | undefined {
	const raw = isRecord(ref.raw_analysis) ? ref.raw_analysis : undefined;
	const dna = isRecord(raw?.production_dna) ? raw.production_dna : undefined;
	return dna;
}

function nestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
}

function explicitFormatProfile(
	ref: ReferenceTemplate,
	format: "shorts" | "longform",
):
	| {
			durationSeconds?: number;
			sceneCount?: number;
			avgSceneDuration?: number;
			hookDuration?: number;
	  }
	| undefined {
	const raw = isRecord(ref.raw_analysis) ? ref.raw_analysis : undefined;
	const method = isRecord(raw?.production_method)
		? raw.production_method
		: undefined;
	const profiles = isRecord(method?.formatProfiles)
		? method.formatProfiles
		: undefined;
	const profile = isRecord(profiles?.[format]) ? profiles[format] : undefined;
	if (!profile) return undefined;
	return {
		durationSeconds: numericField(profile.durationSeconds),
		sceneCount: numericField(profile.sceneCount),
		avgSceneDuration: numericField(profile.avgSceneDuration),
		hookDuration: numericField(profile.hookDuration),
	};
}

function explicitSceneLayout(
	ref: ReferenceTemplate,
	format: "shorts" | "longform",
): LayoutVariant | undefined {
	const raw = isRecord(ref.raw_analysis) ? ref.raw_analysis : undefined;
	const method = isRecord(raw?.production_method)
		? raw.production_method
		: undefined;
	const sceneLayouts = isRecord(method?.sceneLayouts)
		? method.sceneLayouts
		: undefined;
	const candidate =
		sceneLayouts?.[format] ??
		method?.sceneLayout ??
		method?.layoutVariant ??
		raw?.sceneLayout;
	if (format === "longform" && candidate === "social_clip_card") {
		return undefined;
	}
	return isLayoutVariant(candidate) ? candidate : undefined;
}

function inferSceneLayout(
	ref: ReferenceTemplate,
	format: "shorts" | "longform",
): LayoutVariant | undefined {
	const explicit = explicitSceneLayout(ref, format);
	if (explicit) return explicit;

	const fingerprint = [
		ref.name,
		ref.source_title,
		ref.source_creator,
		ref.source_url,
		ref.visual_prompt_template,
		ref.transcript,
		JSON.stringify(ref.raw_analysis ?? {}),
	]
		.join(" ")
		.toLowerCase();

	if (
		format === "shorts" &&
		[
			"ssulply",
			"썰플리",
			"street interview",
			"interview footage",
			"live interview",
			"social clip",
			"clip curation",
			"헌팅",
			"hmDt88ANJMI".toLowerCase(),
		].some((needle) => fingerprint.includes(needle))
	) {
		return "social_clip_card";
	}

	return undefined;
}

export function referenceToPreset(
	ref: ReferenceTemplate,
	format: "shorts" | "longform" = "shorts",
): ReferencePreset {
	const isShorts = format === "shorts";

	const bgmMoodKey = ref.bgm_mood.toLowerCase().trim();
	const bgmMood = BGM_MOOD_MAP[bgmMoodKey] ?? "";
	const formatProfile = explicitFormatProfile(ref, format);
	const rawSceneCount =
		(formatProfile?.sceneCount ?? ref.scene_count) || (isShorts ? 8 : 10);
	const rawAvgSceneDuration =
		(formatProfile?.avgSceneDuration ?? ref.avg_scene_duration) ||
		(isShorts ? 4 : 10);
	const hookDuration = (formatProfile?.hookDuration ?? ref.hook_duration) || 3;
	const rawTargetDuration =
		formatProfile?.durationSeconds ??
		Math.round(rawSceneCount * rawAvgSceneDuration);
	const targetDuration = clampTargetDuration(rawTargetDuration, format);
	const sceneCount =
		!isShorts && rawTargetDuration > LONGFORM_MAX_DURATION_SECONDS
			? Math.max(12, Math.min(36, Math.round(targetDuration / 40)))
			: rawSceneCount;
	const avgSceneDuration =
		!isShorts && rawTargetDuration > LONGFORM_MAX_DURATION_SECONDS
			? Math.max(12, Math.round(targetDuration / sceneCount))
			: rawAvgSceneDuration;
	const productionDna = productionDnaFromRaw(ref);
	const knowledgeProfile = buildReferenceKnowledgeProfile(ref);
	const thumbnailDna = finalizeReferenceThumbnailDna(ref);

	return {
		script: {
			sceneCount,
			avgSceneDuration,
			hookDuration,
			targetDuration,
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
			// 자막 크기/글씨체/굵기/색은 typography.ts 단일 소스에서 파생 (포맷 + 크기 프리셋)
			subtitleStyle: captionStyleFor(format, ref.subtitle_size_preset),
			captionStyle: "chunked",
			subtitlePosition: ref.subtitle_position,
			subtitleBgStyle: ref.subtitle_bg_style,
			defaultTransition: TRANSITION_MAP[ref.transition_style] ?? "crossfade",
			sceneLayout: inferSceneLayout(ref, format),
		},
		productionDna,
		knowledgeProfile,
		thumbnailDna,
	};
}

/**
 * Mood → cinematic descriptor 매핑 (이미지 prompt 인텐시티 부스트).
 */
export function moodVisualIntensity(mood?: string): string {
	switch (mood) {
		case "horror":
			return "high contrast, deep shadows, cold blue accents, ominous atmosphere";
		case "mystery":
			return "moody chiaroscuro, amber backlighting, fog particles, shallow depth of field";
		case "warm":
			return "soft golden hour, warm saturated tones, gentle bokeh";
		case "news":
			return "neutral journalistic lighting, sharp focus, documentary realism";
		case "neutral":
			return "balanced cinematic exposure, natural color grading";
		default:
			return "";
	}
}

/**
 * 씬별 visual_prompt에 템플릿의 시각 스타일 DNA를 주입.
 * 원본 prompt는 WHAT(내용), 템플릿은 HOW(스타일).
 * mood 가 주어지면 mood 기반 cinematic descriptor 도 추가.
 */
export function enrichVisualPrompt(
	sceneVisualPrompt: string,
	preset: ReferencePreset,
	mood?: string,
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
	const moodHint = moodVisualIntensity(mood);
	const dnaHint = buildProductionDnaVisualHint(preset.productionDna);

	const parts = [
		sceneVisualPrompt,
		style,
		colorHint,
		lightingHint,
		moodHint,
		dnaHint,
	].filter(Boolean);
	return parts.join(", ");
}

function buildProductionDnaVisualHint(
	dna: Record<string, unknown> | undefined,
): string {
	if (!dna) return "";
	const layout = nestedRecord(dna, "layout");
	const camera = nestedRecord(dna, "camera");
	const color = nestedRecord(dna, "color");
	const layoutParts = [
		stringField(layout?.compositionPattern),
		stringField(layout?.subjectZone),
		stringField(layout?.subtitleCollisionRisk)
			? `subtitle collision risk: ${stringField(layout?.subtitleCollisionRisk)}`
			: "",
	].filter(Boolean);
	const cameraMode = stringField(camera?.mode);
	const motionIntensity =
		typeof camera?.motionIntensity === "number"
			? `motion intensity ${camera.motionIntensity}`
			: "";
	const temperature = stringField(color?.temperature);
	const parts = [
		layoutParts.length > 0 ? `reference layout: ${layoutParts.join(", ")}` : "",
		cameraMode ? `camera mode: ${cameraMode}` : "",
		motionIntensity,
		temperature ? `color temperature: ${temperature}` : "",
	].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : "";
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
	const dnaStr = buildProductionDnaScriptConstraint(preset.productionDna);
	const thumbnailStr = buildThumbnailDnaConstraint(preset.thumbnailDna);
	const knowledgeStr = buildKnowledgePrompt(preset.knowledgeProfile);
	const domainKnowledgeStr = buildDomainKnowledgePrompt({
		format: s.targetDuration > 180 ? "longform" : "shorts",
	});

	return `
	=== 레퍼런스 스타일 준수 ===
- 씬 수: ${s.sceneCount}개 (±1 허용)
- 목표 길이: ${s.targetDuration}초
- 평균 씬 길이: ${s.avgSceneDuration}초
- 페이싱: ${s.pacing}
- 무드: ${s.mood}${hookStr}${toneStr}${thumbnailStr}${dnaStr}${knowledgeStr ? `\n${knowledgeStr}` : ""}${domainKnowledgeStr ? `\n${domainKnowledgeStr}` : ""}${structureStr}
	`.trim();
}

function buildThumbnailDnaConstraint(
	dna: ReferenceThumbnailDna | undefined,
): string {
	if (!dna) return "";
	const variants = dna.generation.variants
		.slice(0, 3)
		.map((variant) => `${variant.titlePattern}(${variant.testGoal})`)
		.join(" / ");
	const lines = [
		`썸네일 역할: ${dna.clickPackaging.titleThumbnailRelationship}`,
		`썸네일 문구: ${dna.text.titleFormula}, 최대 ${dna.text.maxWords}단어/${dna.text.maxChars}자`,
		`썸네일 배치: 텍스트 ${dna.layout.textZone}, 피사체 ${dna.layout.subjectZone}, 악센트 ${dna.color.accentColor}`,
		variants ? `CTR 실험안: ${variants}` : "",
	].filter(Boolean);
	return `\n썸네일 DNA:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function buildProductionDnaScriptConstraint(
	dna: Record<string, unknown> | undefined,
): string {
	if (!dna) return "";
	const camera = nestedRecord(dna, "camera");
	const transitions = nestedRecord(dna, "transitions");
	const layout = nestedRecord(dna, "layout");
	const subtitles = nestedRecord(dna, "subtitles");
	const audio = nestedRecord(dna, "audio");
	const transitionRules = stringArray(transitions?.rules);
	const textSafeZones = stringArray(layout?.textSafeZones);
	const cutDensity = finiteNumberField(camera?.cutDensityPerMinute);
	const avgCutInterval = finiteNumberField(camera?.avgCutIntervalSeconds);
	const firstCut = finiteNumberField(camera?.firstCutSeconds);
	const first3Motion = finiteNumberField(camera?.first3Motion);
	const integratedLufs = finiteNumberField(audio?.integratedLufs);
	const volumeMeanDb = finiteNumberField(audio?.volumeMeanDb);
	const lines = [
		stringField(camera?.mode)
			? `카메라 모드: ${stringField(camera?.mode)}`
			: "",
		cutDensity !== undefined
			? `컷 밀도: 분당 ${formatNumber(cutDensity)}컷 기준`
			: "",
		avgCutInterval !== undefined
			? `평균 컷 간격: ${formatNumber(avgCutInterval)}초 단위로 말이 끝나는 지점에 컷 정렬`
			: "",
		firstCut !== undefined
			? `첫 컷: ${formatNumber(firstCut)}초 전후에 화면 변화를 넣어 초반 정체를 피함`
			: "",
		first3Motion !== undefined
			? `초반 3초 모션 강도: ${formatNumber(first3Motion, 2)} 기준으로 훅 구간에 줌/자료컷/클로즈업을 배치`
			: "",
		stringField(layout?.compositionPattern)
			? `배치: ${stringField(layout?.compositionPattern)} / 피사체 ${stringField(layout?.subjectZone)}`
			: "",
		textSafeZones.length > 0
			? `텍스트 안전영역: ${textSafeZones.join(", ")}`
			: "",
		stringField(subtitles?.collisionRisk)
			? `자막 충돌 위험: ${stringField(subtitles?.collisionRisk)}`
			: "",
		transitionRules.length > 0
			? `전환 규칙: ${transitionRules.slice(0, 3).join(" / ")}`
			: "",
		stringField(audio?.bgmTempo) || stringField(audio?.bgmMood)
			? `BGM 기준: ${stringField(audio?.bgmMood)} ${stringField(audio?.bgmTempo)}`
			: "",
		integratedLufs !== undefined
			? `오디오 믹스: 레퍼런스 LUFS ${formatNumber(integratedLufs)} 근처로 TTS/BGM을 덕킹`
			: volumeMeanDb !== undefined
				? `오디오 믹스: 평균 볼륨 ${formatNumber(volumeMeanDb)}dB 근처로 TTS/BGM을 덕킹`
				: "",
	].filter(Boolean);
	return lines.length > 0
		? `\n제작 DNA(픽셀/오디오/편집 분석):\n${lines
				.map((line) => `- ${line}`)
				.join("\n")}`
		: "";
}
