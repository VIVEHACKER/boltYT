import {
	LONGFORM_MAX_DURATION_SECONDS,
	isAllowedLongformDuration,
	isShortsDuration,
} from "./reference-duration-policy";

export type ReferenceQualityGrade = "S" | "A" | "B" | "C" | "D";

export interface ReferenceQualityReport {
	score: number;
	grade: ReferenceQualityGrade;
	label: string;
	deep: boolean;
	sourceDurationOk: boolean;
	outputDurationOk: boolean;
	signals: {
		depth: number;
		pixel: number;
		edit: number;
		audio: number;
		transcript: number;
		method: number;
		duration: number;
		copyBoundary: number;
	};
	strengths: string[];
	gaps: string[];
}

export interface ReferenceQualityInput {
	duration_seconds?: number;
	scene_count?: number;
	avg_scene_duration?: number;
	hook_duration?: number;
	bgm_keywords?: unknown;
	tts_tone_keywords?: unknown;
	script_structure?: unknown;
	transcript?: string;
	raw_analysis?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
}

function numberField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function clampScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function gradeForScore(score: number): ReferenceQualityGrade {
	if (score >= 92) return "S";
	if (score >= 82) return "A";
	if (score >= 70) return "B";
	if (score >= 58) return "C";
	return "D";
}

function labelForGrade(grade: ReferenceQualityGrade): string {
	if (grade === "S") return "production-ready";
	if (grade === "A") return "strong";
	if (grade === "B") return "usable";
	if (grade === "C") return "needs review";
	return "weak";
}

function durationPolicyOk(durationSeconds: number): boolean {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
	return isShortsDuration(durationSeconds) || isAllowedLongformDuration(durationSeconds);
}

export function scoreReferenceQuality(
	template: ReferenceQualityInput,
): ReferenceQualityReport {
	const raw = isRecord(template.raw_analysis) ? template.raw_analysis : {};
	const dna = nestedRecord(raw, "production_dna");
	const method = nestedRecord(raw, "production_method");
	const camera = nestedRecord(dna, "camera");
	const transitions = nestedRecord(dna, "transitions");
	const audio = nestedRecord(dna, "audio");
	const copyBoundary =
		nestedRecord(raw, "copy_boundary") ?? nestedRecord(dna, "copyBoundary");

	const analysisMode = stringField(raw.analysis_mode);
	const analysisDepth =
		stringField(raw.analysis_depth) || stringField(dna?.analysisDepth);
	const deep =
		analysisDepth === "pixel_frame_audio_edit" ||
		analysisMode === "deep_vision_shortform" ||
		analysisMode === "deep_sampled_longform";
	const metadataOnly =
		analysisDepth === "metadata_only" || analysisMode.startsWith("metadata_");

	const frames = arrayLength(dna?.frames);
	const pixelPrecision =
		dna?.pixelPrecisionAvailable === true || frames >= 4 || deep;
	const cutTimes =
		arrayLength(camera?.sceneCutTimes) ||
		arrayLength(transitions?.cutTimes) ||
		arrayLength(raw.chapters);
	const sceneCount = numberField(template.scene_count) ?? 0;
	const structureCount = arrayLength(template.script_structure);
	const transcriptLength = stringField(template.transcript).length;
	const bgmKeywords = arrayLength(template.bgm_keywords);
	const voiceKeywords = arrayLength(template.tts_tone_keywords);
	const audioMetrics =
		numberField(audio?.volumeMeanDb) !== undefined ||
		numberField(audio?.integratedLufs) !== undefined ||
		numberField(audio?.volumeMaxDb) !== undefined;
	const methodRules = arrayLength(method?.rules);
	const methodSources = arrayLength(method?.referenceSources);

	const sourceDuration =
		numberField(raw.source_duration_seconds) ??
		numberField(template.duration_seconds) ??
		0;
	const outputDuration = numberField(template.duration_seconds) ?? 0;
	const generated = raw.generated_reference === true;
	const sourceDurationOk = generated
		? durationPolicyOk(sourceDuration)
		: sourceDuration > 0 && sourceDuration <= LONGFORM_MAX_DURATION_SECONDS;
	const outputDurationOk = outputDuration > 0 && outputDuration <= LONGFORM_MAX_DURATION_SECONDS;

	const signals = {
		depth: deep ? 25 : metadataOnly ? 12 : methodRules >= 2 ? 10 : 4,
		pixel: pixelPrecision ? (frames >= 12 ? 15 : 12) : metadataOnly ? 4 : 0,
		edit:
			cutTimes >= 6
				? 15
				: cutTimes >= 2 || sceneCount >= 8 || structureCount >= 4
					? 11
					: 4,
		audio: audioMetrics ? 12 : bgmKeywords >= 2 && voiceKeywords >= 2 ? 9 : 4,
		transcript:
			transcriptLength >= 1200
				? 12
				: transcriptLength >= 400
					? 8
					: transcriptLength > 0
						? 4
						: 0,
		method: methodRules >= 4 && methodSources > 0 ? 10 : methodRules >= 2 ? 7 : 3,
		duration: sourceDurationOk && outputDurationOk ? 8 : -16,
		copyBoundary:
			copyBoundary?.rawAssetsReusable === false ||
			nestedRecord(dna, "copyBoundary")?.rawAssetsReusable === false
				? 3
				: 0,
	};
	const score = clampScore(Object.values(signals).reduce((sum, value) => sum + value, 0));
	const grade = gradeForScore(score);
	const strengths: string[] = [];
	const gaps: string[] = [];

	if (deep) strengths.push("프레임/오디오/편집 DNA");
	else gaps.push("deep 분석 미적용");
	if (pixelPrecision) strengths.push("픽셀/구도 신호");
	else gaps.push("픽셀 구도 신호 부족");
	if (cutTimes >= 2 || structureCount >= 4) strengths.push("컷/구조 신호");
	else gaps.push("컷 구조 신호 부족");
	if (audioMetrics || (bgmKeywords >= 2 && voiceKeywords >= 2)) strengths.push("음성/BGM 신호");
	else gaps.push("음성/BGM 신호 부족");
	if (transcriptLength >= 400) strengths.push("전사 기반 대본 신호");
	else gaps.push("전사량 부족");
	if (sourceDurationOk && outputDurationOk) strengths.push("20분 정책 통과");
	else gaps.push("20분 정책 확인 필요");

	return {
		score,
		grade,
		label: labelForGrade(grade),
		deep,
		sourceDurationOk,
		outputDurationOk,
		signals,
		strengths: strengths.slice(0, 4),
		gaps: gaps.slice(0, 4),
	};
}
