import type { MotionGraphicSpec } from "../types/database";
import type { SceneShot } from "./scene-shot-types";

export type RepairFormat = "shorts" | "longform" | "both" | string;

export interface ProductionRepairScene {
	scene_type?: string;
	type?: string;
	duration_seconds?: number;
	duration?: number;
	narration_text?: string;
	narration?: string;
	imageUrl?: string;
	videoUrl?: string;
	source_url?: string;
	sourceAttribution?: string;
	news_title?: string;
	newsTitle?: string;
	news_source?: string;
	newsSource?: string;
	transition?: string;
	shots?: SceneShot[];
	motion_graphics?: MotionGraphicSpec[];
	motionGraphics?: MotionGraphicSpec[];
}

export interface SceneRepairPatch {
	scene_type?: "image" | "video" | "text_emphasis" | "news_overlay";
	duration_seconds?: number;
	narration_text?: string;
	transition?: "crossfade" | "zoom_punch" | "light_leak";
	shots?: SceneShot[];
	motion_graphics?: MotionGraphicSpec[];
}

export interface MotionRepairOptions {
	dense?: boolean;
	forceMotion?: boolean;
	reason?: string;
	referenceGuidance?: ReferenceRepairGuidance;
}

export interface ReferenceRepairGuidance {
	cameraMode?: string;
	cutDensityPerMinute?: number;
	avgCutIntervalSeconds?: number;
	firstCutSeconds?: number;
	first3Motion?: number;
	transitionRules: string[];
	textSafeZones: string[];
	bgmMood?: string;
	bgmTempo?: string;
	integratedLufs?: number;
}

const ENDING_CUE = {
	shorts:
		"현재까지 확인된 것은 여기까지입니다. 남은 의문은 이 마지막 흐름이 왜 바뀌었는지입니다.",
	longform:
		"정리하면 현재까지 확인된 사실은 여기까지입니다. 남은 의문은 이 흐름이 왜 여기서 바뀌었는지, 그리고 다음 자료가 무엇을 설명할 수 있는지입니다.",
};

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string" && value.trim()
			? [value.trim()]
			: [];
}

function nestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function typeOf(scene: ProductionRepairScene): string {
	return scene.scene_type ?? scene.type ?? "";
}

function durationOf(scene: ProductionRepairScene): number {
	return Number(scene.duration_seconds ?? scene.duration ?? 0);
}

function hasVideoVisual(scene: ProductionRepairScene): boolean {
	if (normalizeText(scene.videoUrl)) return true;
	return Boolean(
		scene.shots?.some(
			(shot) =>
				(shot.media_type ?? "video") === "video" &&
				normalizeText(shot.source_url),
		),
	);
}

function baseShotFromScene(
	scene: ProductionRepairScene,
	index: number,
): SceneShot {
	const sourceUrl = normalizeText(scene.source_url) || normalizeText(scene.imageUrl);
	return {
		id: `repair-${index + 1}`,
		kind: index === 0 ? "establishing" : index === 1 ? "detail" : "punch",
		duration_seconds: Math.max(1, Math.min(4, durationOf(scene) / 3 || 2)),
		media_type: "image",
		source_url: sourceUrl || undefined,
		source_title: normalizeText(scene.news_title ?? scene.newsTitle) || undefined,
		visual_prompt:
			normalizeText(scene.news_title ?? scene.newsTitle) ||
			normalizeText(scene.narration_text ?? scene.narration) ||
			"documentary evidence insert",
		caption:
			normalizeText(scene.news_title ?? scene.newsTitle) ||
			normalizeText(scene.narration_text ?? scene.narration).slice(0, 60),
		motion:
			index % 4 === 0
				? "push_in"
				: index % 4 === 1
					? "pan_right"
					: index % 4 === 2
						? "slow_zoom_out"
						: "drift",
		crop: index === 0 ? "wide" : index === 1 ? "medium" : "detail",
		overlay: index === 2 ? "headline" : "context",
		visual_role: sourceUrl ? "archive" : "reconstruction",
		search_terms: [
			normalizeText(scene.news_title ?? scene.newsTitle),
			normalizeText(scene.narration_text ?? scene.narration).slice(0, 80),
			"documentary footage",
		].filter(Boolean),
		reject_terms: ["logo", "template", "poster", "meme", "generic stock"],
		source_confidence: sourceUrl ? 72 : 45,
	};
}

function unique(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))];
}

export function buildReferenceRepairGuidance(
	productionDna: unknown,
): ReferenceRepairGuidance | undefined {
	if (!isRecord(productionDna)) return undefined;
	const camera = nestedRecord(productionDna, "camera");
	const transitions = nestedRecord(productionDna, "transitions");
	const layout = nestedRecord(productionDna, "layout");
	const audio = nestedRecord(productionDna, "audio");
	const guidance: ReferenceRepairGuidance = {
		cameraMode: stringField(camera?.mode),
		cutDensityPerMinute: numberField(camera?.cutDensityPerMinute),
		avgCutIntervalSeconds: numberField(camera?.avgCutIntervalSeconds),
		firstCutSeconds: numberField(camera?.firstCutSeconds),
		first3Motion: numberField(camera?.first3Motion),
		transitionRules: stringArray(transitions?.rules).slice(0, 4),
		textSafeZones: stringArray(layout?.textSafeZones).slice(0, 4),
		bgmMood: stringField(audio?.bgmMood),
		bgmTempo: stringField(audio?.bgmTempo),
		integratedLufs: numberField(audio?.integratedLufs),
	};
	const hasGuidance =
		Boolean(guidance.cameraMode) ||
		typeof guidance.cutDensityPerMinute === "number" ||
		typeof guidance.avgCutIntervalSeconds === "number" ||
		typeof guidance.first3Motion === "number" ||
		guidance.transitionRules.length > 0;
	return hasGuidance ? guidance : undefined;
}

function preferredShotDurationFromGuidance(
	guidance?: ReferenceRepairGuidance,
): number | undefined {
	if (!guidance?.avgCutIntervalSeconds) return undefined;
	return clamp(guidance.avgCutIntervalSeconds, 0.8, 3.2);
}

function targetShotCountFromGuidance(
	sceneDuration: number,
	index: number,
	baseTarget: number,
	options: MotionRepairOptions,
): number {
	const guidance = options.referenceGuidance;
	if (!guidance || sceneDuration <= 0) return baseTarget;
	const preferredDuration = preferredShotDurationFromGuidance(guidance);
	const byInterval = preferredDuration
		? Math.ceil(sceneDuration / preferredDuration)
		: 0;
	const highCutDensity =
		(guidance.cutDensityPerMinute ?? 0) >= 14 ||
		guidance.cameraMode === "cut_driven";
	const openingNeedsMotion =
		index === 0 &&
		((guidance.firstCutSeconds ?? 99) <= 2.2 ||
			(guidance.first3Motion ?? 0) >= 0.42);
	const guidedMinimum = Math.max(
		baseTarget,
		byInterval,
		highCutDensity ? (index === 0 ? 5 : 4) : 0,
		openingNeedsMotion ? 5 : 0,
	);
	const cap = index === 0 || options.dense ? 6 : 5;
	return clamp(guidedMinimum, baseTarget, cap);
}

function guidedTransition(
	index: number,
	guidance?: ReferenceRepairGuidance,
): SceneRepairPatch["transition"] {
	const rules = guidance?.transitionRules.join(" ").toLowerCase() ?? "";
	if (
		guidance?.cameraMode === "cut_driven" ||
		(guidance?.cutDensityPerMinute ?? 0) >= 14 ||
		/zoom|punch|hard cut|hardcut/.test(rules)
	) {
		return "zoom_punch";
	}
	if (/light|flash|leak/.test(rules)) return "light_leak";
	if (/crossfade|fade/.test(rules)) return "crossfade";
	return index % 4 === 0
		? "zoom_punch"
		: index % 4 === 1
			? "light_leak"
			: "crossfade";
}

function referenceSearchTerms(
	guidance: ReferenceRepairGuidance | undefined,
): string[] {
	if (!guidance) return [];
	return unique([
		guidance.cameraMode ? `${guidance.cameraMode} camera reference` : "",
		guidance.bgmMood ? `${guidance.bgmMood} documentary b-roll` : "",
		...guidance.transitionRules.map((rule) => `${rule} footage rhythm`),
		...guidance.textSafeZones.map((zone) => `${zone} safe composition`),
	]).slice(0, 4);
}

export function strengthenEndingNarration(
	current: string,
	format: RepairFormat,
): string {
	const normalized = normalizeText(current);
	const ending = format === "shorts" ? ENDING_CUE.shorts : ENDING_CUE.longform;
	if (!normalized) return ending;
	if (/현재까지|정리하면|남은 의문|확인된 것은|여기까지/.test(normalized)) {
		return normalized;
	}
	return `${normalized} ${ending}`;
}

export function buildMotionRepairPatch(
	scene: ProductionRepairScene,
	index: number,
	options: MotionRepairOptions = {},
): SceneRepairPatch {
	const seededShots =
		scene.shots && scene.shots.length > 0 ? scene.shots : [];
	const sceneDuration = durationOf(scene);
	const baseTargetShotCount =
		index === 0 && sceneDuration >= 5 ? 4 : sceneDuration >= 5 ? 3 : 2;
	const denseTargetShotCount =
		index === 0 && sceneDuration >= 5
			? 5
			: sceneDuration >= 8
				? 4
				: 3;
	const baseTarget = options.dense
		? Math.max(baseTargetShotCount, denseTargetShotCount)
		: baseTargetShotCount;
	const targetShotCount = targetShotCountFromGuidance(
		sceneDuration,
		index,
		baseTarget,
		options,
	);
	const existingShots =
		seededShots.length >= targetShotCount
			? seededShots
			: [
					...seededShots,
					...Array.from(
						{ length: targetShotCount - seededShots.length },
						(_, shotIndex) =>
							baseShotFromScene(scene, seededShots.length + shotIndex),
					),
				];
	const motionCycle: NonNullable<SceneShot["motion"]>[] = [
		"push_in",
		"pan_left",
		"slow_zoom_out",
		"pan_right",
		"drift",
		"slow_zoom_in",
	];
	const cropCycle: NonNullable<SceneShot["crop"]>[] = [
		"wide",
		"medium",
		"close",
		"detail",
		"medium",
	];
	const kindCycle: NonNullable<SceneShot["kind"]>[] = [
		"establishing",
		"detail",
		"evidence",
		"punch",
		"context",
	];
	const sfxCycle: Array<NonNullable<SceneShot["sfx_cue"]>["category"]> = [
		"whoosh",
		"reveal",
		"tension_rise",
		"impact",
	];
	const preferredShotDuration = preferredShotDurationFromGuidance(
		options.referenceGuidance,
	);
	const referenceTerms = referenceSearchTerms(options.referenceGuidance);
	const sfxBoost = clamp(
		((options.referenceGuidance?.first3Motion ?? 0) * 0.22) +
			((options.referenceGuidance?.cutDensityPerMinute ?? 0) / 160),
		0,
		0.24,
	);
	const fallbackGuidedShotDuration =
		sceneDuration / Math.max(existingShots.length, 1) || 1.4;
	const shots = existingShots.map((shot, shotIndex) => ({
		...shot,
		kind: options.dense
			? kindCycle[(index + shotIndex) % kindCycle.length]
			: shot.kind,
		duration_seconds:
			options.dense || preferredShotDuration
				? Math.max(
						0.8,
						Math.min(
							index === 0 ? 1.7 : 2.8,
							preferredShotDuration ?? fallbackGuidedShotDuration,
						),
					)
				: shot.duration_seconds && shot.duration_seconds > 0
				? shot.duration_seconds
				: Math.max(1, Math.min(4, sceneDuration / existingShots.length || 2)),
		motion:
			!options.forceMotion &&
			!options.dense &&
			shot.motion &&
			shot.motion !== "static" &&
			shot.motion !== "slow_zoom_in"
				? shot.motion
				: motionCycle[(index + shotIndex) % motionCycle.length],
		crop: options.dense
			? cropCycle[(index + shotIndex) % cropCycle.length]
			: (shot.crop ?? (shotIndex === 0 ? "wide" : "medium")),
		overlay: options.dense
			? shotIndex % 3 === 0
				? "headline"
				: shotIndex % 3 === 1
					? "evidence"
					: "context"
			: (shot.overlay ?? (shot.kind === "quote" ? "quote" : "context")),
		sfx_cue:
			options.dense
				? {
						category: sfxCycle[(index + shotIndex) % sfxCycle.length],
						intensity: Math.max(
							shot.sfx_cue?.intensity ?? 0,
							clamp(
								shotIndex === 0
									? 0.78 + sfxBoost
									: shotIndex === existingShots.length - 1
										? 0.74 + sfxBoost
										: 0.58 + sfxBoost,
								0,
								1,
							),
						),
						reason:
							options.reason ??
							(options.referenceGuidance
								? "레퍼런스 DNA 기반 렌더 QC 보강: 컷 밀도, 초반 모션, 전환 리듬 보강"
								: "렌더 산출물 QC 보강: 컷 밀도와 화면 변화량 강제 보강"),
					}
				: shot.sfx_cue ??
			{
				category: sfxCycle[(index + shotIndex) % sfxCycle.length],
				intensity: clamp(
					shotIndex === existingShots.length - 1
						? 0.72 + sfxBoost
						: 0.48 + sfxBoost,
					0,
					1,
				),
				reason: options.referenceGuidance
					? "레퍼런스 DNA 기반 자동 품질 보강: 샷 리듬과 컷 밀도 보강"
					: "자동 품질 보강: 샷 리듬과 컷 밀도 보강",
			},
		search_terms:
			referenceTerms.length > 0
				? unique([...(shot.search_terms ?? []), ...referenceTerms])
				: shot.search_terms,
		visual_role:
			shot.visual_role ??
			(shot.source_url ? "archive" : "reconstruction"),
		source_confidence:
			typeof shot.source_confidence === "number"
				? shot.source_confidence
				: shot.source_url
					? 70
					: 45,
		qc_issues: options.dense
			? unique([...(shot.qc_issues ?? []), "render_output_motion_repair"])
			: shot.qc_issues,
	}));
	const firstTitle =
		normalizeText(scene.news_title ?? scene.newsTitle) ||
		normalizeText(scene.sourceAttribution) ||
		"확인된 자료";
	const motionGraphics: MotionGraphicSpec[] =
		scene.motion_graphics ?? scene.motionGraphics ?? [];
	const hasLowerThird = motionGraphics.some((graphic) => graphic.type === "lower_third");
	return {
		transition: guidedTransition(index, options.referenceGuidance),
		shots,
		motion_graphics: hasLowerThird
			? motionGraphics
			: [
					...motionGraphics,
					{
						type: "lower_third",
						startFrame: 8,
						duration: 58,
						params: {
							title: firstTitle,
							subtitle: normalizeText(scene.news_source ?? scene.newsSource),
						},
					},
				],
		...(options.dense
			? {
					motion_graphics: [
						...(hasLowerThird
							? motionGraphics
							: [
									...motionGraphics,
									{
										type: "lower_third",
										startFrame: 8,
										duration: 58,
										params: {
											title: firstTitle,
											subtitle: normalizeText(scene.news_source ?? scene.newsSource),
										},
									},
								]),
						{
							type: "progress_bar",
							startFrame: 6,
							duration: Math.max(42, Math.round((sceneDuration || 3) * 20)),
							params: {
								target: 100,
								label: "",
								position: "top",
								color: "#FFD166",
							},
						},
					] as MotionGraphicSpec[],
				}
			: {}),
	};
}

export function selectHeroVideoRepairIndexes(
	scenes: ProductionRepairScene[],
	format: RepairFormat,
	maxClips = format === "shorts" ? 1 : 4,
): number[] {
	if (maxClips <= 0) return [];
	const visualIndexes = scenes
		.map((scene, index) => ({ scene, index }))
		.filter(({ scene }) => typeOf(scene) !== "text_emphasis");
	const existingVideoCount = visualIndexes.filter(({ scene }) =>
		hasVideoVisual(scene),
	).length;
	if (existingVideoCount > 0) return [];

	return visualIndexes
		.sort((a, b) => {
			const aScore =
				(a.index === 0 ? 50 : 0) +
				(a.index < 3 ? 20 : 0) +
				(typeOf(a.scene) === "video" ? 20 : 0) +
				(normalizeText(a.scene.news_title ?? a.scene.newsTitle) ? 10 : 0);
			const bScore =
				(b.index === 0 ? 50 : 0) +
				(b.index < 3 ? 20 : 0) +
				(typeOf(b.scene) === "video" ? 20 : 0) +
				(normalizeText(b.scene.news_title ?? b.scene.newsTitle) ? 10 : 0);
			return bScore - aScore;
		})
		.slice(0, maxClips)
		.map(({ index }) => index);
}

export function shouldRepairNarrationEnding(issueCodes: string[]): boolean {
	return issueCodes.some((code) =>
		[
			"thin_ending_narration",
			"abrupt_ending_duration",
			"missing_ending_cue",
		].includes(code),
	);
}

export function shouldRepairMotionDesign(issueCodes: string[]): boolean {
	return issueCodes.some((code) =>
		[
			"low_motion_ratio",
			"high_text_scene_ratio",
			"low_source_anchor_ratio",
			"high_low_confidence_ratio",
			"high_generic_stock_ratio",
			"elevated_generic_stock_ratio",
			"low_designed_visual_ratio",
			"video_scene_without_video",
			"weak_visual_scene",
			"very_low_quality_shot",
			"large_quality_gap",
			"single_long_still_scene",
			"motion_monotony",
			"low_editorial_density",
			"low_motion_video_scene",
			"high_low_motion_video_ratio",
			"low_opening_visual_density",
		].includes(code),
	);
}

const RENDER_OUTPUT_TO_PRODUCTION_ISSUES: Record<string, string[]> = {
	low_visual_variation: [
		"low_editorial_density",
		"motion_monotony",
		"single_long_still_scene",
	],
	weak_opening_hook: ["low_opening_visual_density"],
	low_cut_density: ["low_editorial_density"],
	black_segment_detected: ["missing_visual", "weak_visual_scene"],
	reference_cut_density_gap: ["low_editorial_density"],
	reference_hook_motion_gap: ["low_opening_visual_density"],
	reference_visual_motion_gap: ["motion_monotony", "single_long_still_scene"],
	reference_strong_cut_gap: ["low_editorial_density", "motion_monotony"],
};

export function renderOutputIssueCodesToProductionIssueCodes(
	issueCodes: string[],
): string[] {
	return unique(
		issueCodes.flatMap(
			(code) => RENDER_OUTPUT_TO_PRODUCTION_ISSUES[code] ?? [],
		),
	);
}

export function shouldRepairRenderOutput(issueCodes: string[]): boolean {
	return renderOutputIssueCodesToProductionIssueCodes(issueCodes).some((code) =>
		shouldRepairMotionDesign([code]),
	);
}
