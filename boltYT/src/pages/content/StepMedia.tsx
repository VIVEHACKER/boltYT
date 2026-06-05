import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	generateImage as aiGenerateImage,
	generateImageToPath as aiGenerateImageToPath,
	generateTts as aiGenerateTts,
	generateContinuousNarration,
} from "../../lib/ai";
import {
	applyAnimationContinuityToShots,
	buildAnimationAssetManifest,
	buildAnimationCharacterReferencePrompt,
	enrichAnimationPromptWithContinuity,
	isAnimationProductionFamily,
	repairAnimationScenesForQuality,
	scoreAnimationProductionQuality,
	type AnimationAssetManifest,
	type AnimationBible,
	type AnimationProductionFamily,
	type AnimationProductionQualityReport,
} from "../../lib/animation-production";
import {
	planSceneDirectives,
	planSceneVisuals,
	type ResearchBrief,
	type SceneDirective,
	verifySceneQuality,
} from "../../lib/ai-agents";
import { autoPickBgm, inferAutoBgmPreset } from "../../lib/bgm";
import { ensureBlobUrls, storeLocalFile } from "../../lib/local-db";
import {
	downloadImageToLocal,
	downloadImageToPath,
	downloadThumbnailToLocal,
	downloadVideoToLocal,
	downloadVideoToPath,
	downloadYouTubeVideo,
	downloadYouTubeVideoToPath,
	resetUsedVideoIds,
	searchAndDownloadImage,
	searchAndDownloadImageToPath,
	searchAndDownloadVideo,
	searchAndDownloadVideoToPath,
	type MediaSearchOptions,
} from "../../lib/media-download";
import {
	referenceToPreset,
	type ReferencePreset,
} from "../../lib/reference-bridge";
import {
	buildSceneImagePrompt,
	buildSceneSearchQueries,
	buildShotImagePrompt,
	buildShotSearchQueries,
	isDirectImageUrl,
	isDirectVideoUrl,
} from "../../lib/scene-media";
import type { SceneShot } from "../../lib/scene-shot-types";
import {
	canUseSourceCard,
	generateSourceCardToPath,
} from "../../lib/source-card";
import { supabase } from "../../lib/supabase";
import {
	composeNarrationTtsOptions,
	getDefaultVoice,
	hasStoredTtsSettings,
	inferNarrationTtsOptions,
	type TtsOptions,
} from "../../lib/tts";
import {
	detectVideoGen,
	generateSceneVideo,
	getActiveVideoProvider,
	setActiveVideoProvider,
	VIDEO_COST_PER_SCENE,
	type VideoGenProvider,
} from "../../lib/video-gen";
import {
	deriveLockedSeed,
	enrichVideoPrompt,
	type ScriptFormat,
} from "../../lib/video-prompt-enrich";
import type { ReferenceTemplate, Scene } from "../../types/database";
import type { CollectedSource, ContentMode } from "./ContentWizardPage";

interface StepMediaProps {
	scriptId: string;
	mode?: ContentMode;
	sources?: CollectedSource[];
	referenceTemplate?: ReferenceTemplate | null;
	onNext: () => void;
	onBack: () => void;
}

type MediaStatus =
	| "pending"
	| "generating"
	| "complete"
	| "error"
	| "not_needed";

type SceneWithMedia = Scene & {
	imageStatus: MediaStatus;
	ttsStatus: MediaStatus;
	videoStatus: MediaStatus;
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
	sourceUrl?: string;
	errorMsg?: string;
	searchQueryKo?: string;
	/** Pexels/Pixabay용 영어 검색 쿼리 (Scene Director 생성) */
	searchQueryEn?: string;
	/** 채널 언어 기반 검색 소스 우선순위 */
	locale?: "ko" | "en";
};

type ProductionType = "standard" | "documentary" | "animation";

const MAX_MANUAL_VIDEO_BYTES = 250 * 1024 * 1024;
const VIDEO_CROP_OPTIONS: Array<{
	value: NonNullable<SceneShot["crop"]>;
	label: string;
	description: string;
}> = [
	{ value: "full", label: "전체", description: "원본 비율 유지" },
	{ value: "wide", label: "와이드", description: "살짝 채움" },
	{ value: "medium", label: "미디엄", description: "기본 쇼츠 크롭" },
	{ value: "close", label: "클로즈", description: "인물/반응 강조" },
	{ value: "detail", label: "디테일", description: "강한 확대" },
];

function isLocalMediaPath(value?: string): boolean {
	return Boolean(value?.startsWith("scenes/"));
}

function isYouTubeVideoUrl(value?: string): boolean {
	return /youtu\.be|youtube\.com/i.test(value ?? "");
}

function getShotVideoDurationSeconds(shot: SceneShot): number {
	const rawDuration = Number(shot.duration_seconds);
	const duration =
		Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 8;
	return Math.min(30, Math.max(8, Math.ceil(duration) + 4));
}

function getShotClipStartSeconds(shot: SceneShot, shotIndex: number): number {
	const normalized =
		typeof shot.trim_start === "number" && Number.isFinite(shot.trim_start)
			? shot.trim_start
			: (shotIndex % 4) * 0.18;
	return Math.round(Math.max(0, Math.min(0.8, normalized)) * 60);
}

function getVideoReuseKey(
	sourceUrl: string,
	shot: SceneShot,
	shotIndex: number,
): string {
	if (!isYouTubeVideoUrl(sourceUrl)) return sourceUrl;
	const start = getShotClipStartSeconds(shot, shotIndex);
	const duration = getShotVideoDurationSeconds(shot);
	return `${sourceUrl}#clip=${start}-${duration}`;
}

function sanitizeFileStem(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/\.[a-z0-9]+$/i, "")
			.replace(/[^a-z0-9가-힣_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 54) || "manual-video"
	);
}

function videoExtensionFromFile(file: File): "mp4" | "webm" | "mov" {
	const lowerName = file.name.toLowerCase();
	if (lowerName.endsWith(".webm") || file.type === "video/webm") return "webm";
	if (lowerName.endsWith(".mov") || file.type === "video/quicktime")
		return "mov";
	return "mp4";
}

function isSupportedManualVideo(file: File): boolean {
	if (file.type.startsWith("video/")) return true;
	return /\.(mp4|webm|mov)$/i.test(file.name);
}

function sanitizeClipSeconds(
	value: number,
	fallback: number,
	min: number,
	max: number,
) {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}

function qualityScoreToConfidence(
	qualityScore: number | undefined,
	fallback = 58,
): number {
	if (typeof qualityScore !== "number" || !Number.isFinite(qualityScore)) {
		return fallback;
	}
	return Math.min(96, Math.max(35, Math.round(qualityScore + 48)));
}

function strictImageMinScore(shot: SceneShot): number | undefined {
	if (shot.visual_role === "evidence" || shot.visual_role === "document") {
		return 32;
	}
	if (
		shot.visual_role === "archive" ||
		shot.visual_role === "map" ||
		shot.visual_role === "data"
	) {
		return 28;
	}
	return undefined;
}

function strictVideoMinScore(shot: SceneShot): number | undefined {
	if (shot.visual_role === "evidence" || shot.visual_role === "archive") {
		return 40;
	}
	return undefined;
}

function strictMinRelevance(shot: SceneShot): number | undefined {
	if (
		shot.visual_role === "evidence" ||
		shot.visual_role === "document" ||
		shot.visual_role === "archive" ||
		shot.visual_role === "map" ||
		shot.visual_role === "data"
	) {
		return 7;
	}
	if (shot.visual_role === "context" || shot.visual_role === "transition") {
		return 3;
	}
	return 4;
}

function maxDefined(...values: Array<number | undefined>): number | undefined {
	const finite = values.filter(
		(value): value is number =>
			typeof value === "number" && Number.isFinite(value),
	);
	return finite.length > 0 ? Math.max(...finite) : undefined;
}

function uniqueTerms(values: Array<string | undefined>): string[] {
	return [
		...new Set(values.filter((value): value is string => Boolean(value))),
	];
}

function nestedReferenceRecord(
	preset: ReferencePreset | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const dna = preset?.productionDna;
	if (!dna || typeof dna !== "object") return undefined;
	const value = dna[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function referenceNumber(
	preset: ReferencePreset | undefined,
	section: string,
	key: string,
): number | undefined {
	const value = nestedReferenceRecord(preset, section)?.[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function referenceString(
	preset: ReferencePreset | undefined,
	section: string,
	key: string,
): string {
	const value = nestedReferenceRecord(preset, section)?.[key];
	return typeof value === "string" ? value : "";
}

function referenceMediaSearchOptions(
	referencePreset: ReferencePreset | undefined,
	shot: SceneShot,
	media: "image" | "video",
	base: MediaSearchOptions = {},
): MediaSearchOptions {
	const cameraMode = referenceString(referencePreset, "camera", "mode");
	const cutDensity = referenceNumber(
		referencePreset,
		"camera",
		"cutDensityPerMinute",
	);
	const first3Motion = referenceNumber(
		referencePreset,
		"camera",
		"first3Motion",
	);
	const pixelPrecision =
		referencePreset?.productionDna?.analysisDepth === "pixel_frame_audio_edit";
	const evidenceLike =
		shot.visual_role === "evidence" ||
		shot.visual_role === "document" ||
		shot.visual_role === "archive";
	const needsDynamicVideo =
		media === "video" &&
		(cameraMode === "cut_driven" ||
			(cutDensity ?? 0) >= 12 ||
			(first3Motion ?? 0) >= 0.38);
	const referenceMinScore =
		media === "video"
			? needsDynamicVideo
				? evidenceLike
					? 48
					: 44
				: evidenceLike
					? 42
					: pixelPrecision
						? 34
						: undefined
			: evidenceLike
				? pixelPrecision
					? 38
					: 34
				: pixelPrecision
					? 28
					: undefined;
	return {
		...base,
		rejectTerms: uniqueTerms([
			...(base.rejectTerms ?? []),
			"logo",
			"template",
			"meme",
			"poster",
			"lyrics",
			"reaction",
			"gameplay",
			"로고",
			"템플릿",
			"리액션",
			"게임",
		]),
		minScore: maxDefined(base.minScore, referenceMinScore),
		minDynamicScore:
			media === "video"
				? maxDefined(
						base.minDynamicScore,
						needsDynamicVideo ? 34 : evidenceLike ? 28 : undefined,
					)
				: base.minDynamicScore,
	};
}

function requiredShotConfidence(shot: SceneShot): number {
	if (shot.visual_role === "reconstruction") return 0;
	if (
		shot.visual_role === "evidence" ||
		shot.visual_role === "document" ||
		shot.visual_role === "archive" ||
		shot.visual_role === "map" ||
		shot.visual_role === "data"
	) {
		return 66;
	}
	if (shot.visual_role === "context" || shot.visual_role === "transition") {
		return 52;
	}
	return 58;
}

function requiredShotQuality(shot: SceneShot): number {
	if (
		shot.visual_role === "evidence" ||
		shot.visual_role === "document" ||
		shot.visual_role === "archive" ||
		shot.visual_role === "map" ||
		shot.visual_role === "data"
	) {
		return 22;
	}
	if (shot.visual_role === "context" || shot.visual_role === "transition") {
		return 10;
	}
	return 14;
}

function isGenericStockShot(shot: SceneShot): boolean {
	return (
		(shot.selection_provider === "pexels" ||
			shot.selection_provider === "pixabay") &&
		shot.visual_role !== "context" &&
		shot.visual_role !== "transition"
	);
}

function shouldRepairSelectedShot(shot: SceneShot): boolean {
	if (shot.selection_provider === "animation") return false;
	if (
		shot.selection_provider === "ai" ||
		shot.visual_role === "reconstruction"
	) {
		return false;
	}
	if (!shot.source_url) return true;
	if (shot.rejection_reason) return true;
	if (isGenericStockShot(shot)) return true;
	if (
		typeof shot.source_confidence === "number" &&
		shot.source_confidence < requiredShotConfidence(shot)
	) {
		return true;
	}
	if (
		typeof shot.quality_score === "number" &&
		shot.quality_score < requiredShotQuality(shot)
	) {
		return true;
	}
	if (
		(shot.media_type ?? "video") === "video" &&
		((typeof shot.dynamic_score === "number" && shot.dynamic_score < 22) ||
			(shot.dynamic_issues ?? []).includes("low_motion_video"))
	) {
		return true;
	}
	return false;
}

function sourceCardInput(scene: SceneWithMedia, shot: SceneShot) {
	return {
		title: shot.source_title || scene.news_title || scene.visual_prompt,
		source: scene.news_source,
		date: scene.news_date,
		caption: shot.caption || shot.visual_prompt,
		narration: scene.narration_text,
		visualRole: shot.visual_role,
		locale: scene.locale,
	};
}

function markShotSelected(
	shot: SceneShot,
	meta: {
		provider?: string;
		qualityScore?: number;
		dynamicScore?: number;
		dynamicIssues?: string[];
		sourceConfidence?: number;
		sourceTitle?: string;
		rejectionReason?: string;
	},
) {
	shot.selection_provider = meta.provider ?? shot.selection_provider;
	shot.quality_score = meta.qualityScore ?? shot.quality_score;
	shot.dynamic_score = meta.dynamicScore ?? shot.dynamic_score;
	shot.dynamic_issues = meta.dynamicIssues ?? shot.dynamic_issues;
	shot.source_title = meta.sourceTitle ?? shot.source_title;
	shot.source_confidence =
		meta.sourceConfidence ??
		qualityScoreToConfidence(meta.qualityScore, shot.source_confidence ?? 58);
	shot.rejection_reason = meta.rejectionReason;
}

function markShotGeneratedFallback(shot: SceneShot, reason: string) {
	shot.selection_provider = "ai";
	shot.quality_score = undefined;
	shot.source_confidence = Math.min(45, shot.source_confidence ?? 45);
	shot.visual_role = shot.visual_role ?? "reconstruction";
	shot.rejection_reason = reason;
}

function isAnimationShot(shot: SceneShot): boolean {
	return shot.selection_provider === "animation";
}

function getSceneShots(
	scene: Pick<Scene, "shots"> | Record<string, unknown>,
): SceneShot[] {
	return (
		((scene as Record<string, unknown>).shots as SceneShot[] | undefined) ?? []
	).map((shot) => ({ ...shot }));
}

function getVideoShots(
	scene: Pick<Scene, "shots"> | Record<string, unknown>,
): SceneShot[] {
	return getSceneShots(scene).filter(
		(shot) => (shot.media_type ?? "video") === "video",
	);
}

function buildSocialClipVideoShot(
	scene: Scene & { searchQueryKo?: string; searchQueryEn?: string },
): SceneShot {
	const duration = Math.max(
		2.2,
		Math.min(4.2, Number(scene.duration_seconds) || 3),
	);
	const caption =
		(scene.narration_text ?? "").replace(/\s+/g, " ").trim() ||
		scene.news_title ||
		scene.visual_prompt ||
		"인터뷰 클립";
	const baseKo = [
		scene.searchQueryKo,
		scene.news_title,
		scene.visual_prompt,
		scene.narration_text,
		"길거리 인터뷰 반응 술집 사람 대화",
	]
		.filter(Boolean)
		.join(" ");
	const baseEn = [
		scene.searchQueryEn,
		"street interview people talking nightlife reaction",
		scene.visual_prompt,
		scene.news_title,
	]
		.filter(Boolean)
		.join(" ");

	return {
		id: `social-video-${scene.id}`,
		kind: "context",
		duration_seconds: duration,
		media_type: "video",
		visual_prompt:
			scene.visual_prompt ||
			"street interview clip, people talking in a busy nightlife setting",
		caption,
		motion: "slow_zoom_in",
		crop: "medium",
		overlay: "none",
		visual_role: "context",
		search_terms: [
			baseKo,
			baseEn,
			"street interview",
			"nightlife conversation",
		].filter(Boolean),
		reject_terms: [
			"static",
			"slideshow",
			"podcast",
			"logo only",
			"screen recording",
		],
		source_confidence: 0,
	};
}

function buildManualVideoShot(scene: SceneWithMedia): SceneShot {
	const duration = Math.max(
		2.2,
		Math.min(8, Number(scene.duration_seconds) || 4),
	);
	return {
		id: `manual-video-${scene.id}`,
		kind: "context",
		duration_seconds: duration,
		media_type: "video",
		visual_prompt:
			scene.visual_prompt || scene.news_title || "manual inserted video clip",
		caption:
			(scene.narration_text ?? "").replace(/\s+/g, " ").trim() ||
			scene.news_title ||
			"직접 삽입한 영상",
		motion: "push_in",
		crop: "medium",
		overlay: "none",
		visual_role: "context",
		source_confidence: 0,
	};
}

function ensureSocialClipVideoSlot(
	scene: Scene & { searchQueryKo?: string; searchQueryEn?: string },
): {
	shots: SceneShot[];
	changed: boolean;
} {
	const shots = getSceneShots(scene);
	const hasVideoShot = shots.some(
		(shot) => (shot.media_type ?? "video") === "video",
	);
	if (hasVideoShot) return { shots, changed: false };
	return {
		shots: [buildSocialClipVideoShot(scene), ...shots],
		changed: true,
	};
}

function resolveShotUrl(
	shot: SceneShot,
	blobUrls: Map<string, string>,
): string {
	if (!shot.source_url) return "";
	return isLocalMediaPath(shot.source_url)
		? (blobUrls.get(shot.source_url) ?? "")
		: shot.source_url;
}

function getShotStoragePaths(scene: Scene): string[] {
	const shots = getSceneShots(scene);
	return shots
		.map((shot) => shot.source_url)
		.filter(
			(value): value is string =>
				typeof value === "string" && isLocalMediaPath(value),
		);
}

function parseAnimationBible(value: unknown): AnimationBible | undefined {
	const bible = value as AnimationBible | undefined;
	return bible && Array.isArray(bible.characters) ? bible : undefined;
}

function parseAnimationQualityReport(
	value: unknown,
): AnimationProductionQualityReport | null {
	const report = value as AnimationProductionQualityReport | undefined;
	return typeof report?.score === "number" && typeof report.passed === "boolean"
		? report
		: null;
}

function animationImageOptions(
	manifest: AnimationAssetManifest,
	options?: { useReferenceImage?: boolean },
) {
	return {
		styleMode: "animation" as const,
		seed: manifest.styleSeed,
		negativePrompt:
			"photorealistic, live action, real person, realistic skin, documentary photo, news photo, CCTV, screenshot, watermark, logo, text, blurry, low quality, inconsistent face, different outfit, different color palette",
		...(options?.useReferenceImage === false
			? {}
			: {
					referenceImagePath: manifest.referenceSheetPath,
					referenceStrength: 0.42,
				}),
	};
}

export default function StepMedia({
	scriptId,
	mode: _mode = "ai",
	sources = [],
	referenceTemplate,
	onNext,
	onBack,
}: StepMediaProps) {
	const [scriptFormat, setScriptFormat] = useState<ScriptFormat>("shorts");
	const referencePreset = useMemo(
		() =>
			referenceTemplate
				? referenceToPreset(
						referenceTemplate,
						scriptFormat === "longform" ? "longform" : "shorts",
					)
				: undefined,
		[referenceTemplate, scriptFormat],
	);
	const requiresRealClipVideo =
		referencePreset?.composition.sceneLayout === "social_clip_card";
	const ttsOptions = useMemo<TtsOptions | undefined>(
		() => (referencePreset ? { ...referencePreset.tts } : undefined),
		[referencePreset],
	);
	const [scenes, setScenes] = useState<SceneWithMedia[]>([]);
	const scriptContentJsonRef = useRef<Record<string, unknown>>({});
	const animationAssetManifestRef = useRef<AnimationAssetManifest | null>(null);
	const [animationReferenceSheetPath, setAnimationReferenceSheetPath] =
		useState("");
	const [animationQcReport, setAnimationQcReport] =
		useState<AnimationProductionQualityReport | null>(null);
	const ttsSignals = useMemo(
		() =>
			scenes.map((scene) => ({
				narration: scene.narration_text,
				mood: scene.mood,
				type: scene.scene_type,
			})),
		[scenes],
	);
	const effectiveTtsOptions = useMemo<TtsOptions | undefined>(() => {
		if (ttsOptions) {
			return composeNarrationTtsOptions(ttsSignals, ttsOptions);
		}
		if (hasStoredTtsSettings()) {
			return composeNarrationTtsOptions(ttsSignals, getDefaultVoice());
		}
		return composeNarrationTtsOptions(
			ttsSignals,
			inferNarrationTtsOptions(ttsSignals),
		);
	}, [ttsOptions, ttsSignals]);
	const [bgmAutoPicked, setBgmAutoPicked] = useState<string>("");
	const scenesRef = useRef<SceneWithMedia[]>([]);
	useEffect(() => {
		scenesRef.current = scenes;
	}, [scenes]);
	const [loading, setLoading] = useState(true);
	const [generating, setGenerating] = useState(false);
	const [narrationStatus, setNarrationStatus] = useState<
		"idle" | "generating" | "complete" | "error"
	>("idle");
	const [narrationError, setNarrationError] = useState("");
	const [aiVideoAvailable, setAiVideoAvailable] = useState(false);
	const [aiVideoProvider, setAiVideoProvider] = useState<VideoGenProvider>(
		getActiveVideoProvider(),
	);
	const [productionType, setProductionType] = useState<ProductionType>(
		_mode === "animation"
			? "animation"
			: _mode === "research"
				? "documentary"
				: "standard",
	);
	const [aiVideoBatch, setAiVideoBatch] = useState<{
		current: number;
		total: number;
	} | null>(null);
	const [manualVideoUrls, setManualVideoUrls] = useState<
		Record<string, string>
	>({});
	const [manualVideoBusy, setManualVideoBusy] = useState<
		Record<string, boolean>
	>({});
	useEffect(() => {
		detectVideoGen()
			.then((s) => setAiVideoAvailable(s.available))
			.catch(() => setAiVideoAvailable(false));
	}, []);
	useEffect(() => {
		(async () => {
			try {
				const { data } = await supabase
					.from("scripts")
					.select("format, content_json")
					.eq("id", scriptId)
					.maybeSingle();
				const script = data as {
					format?: string;
					content_json?: Record<string, unknown>;
				} | null;
				scriptContentJsonRef.current = script?.content_json ?? {};
				const fmt = script?.format;
				if (fmt === "longform" || fmt === "shorts") setScriptFormat(fmt);
				const rawProductionType = script?.content_json?.production_type;
				if (rawProductionType === "animation") {
					setProductionType("animation");
				} else if (rawProductionType === "documentary") {
					setProductionType("documentary");
				}
				const animationAssets = script?.content_json?.animation_assets as
					| Partial<AnimationAssetManifest>
					| undefined;
				if (typeof animationAssets?.referenceSheetPath === "string") {
					setAnimationReferenceSheetPath(animationAssets.referenceSheetPath);
				}
				setAnimationQcReport(
					parseAnimationQualityReport(script?.content_json?.animation_qc),
				);
			} catch {
				// ignore — 기본 shorts 유지
			}
		})();
	}, [scriptId]);

	const loadScenes = useCallback(async () => {
		resetUsedVideoIds();
		const { data: sceneData } = await supabase
			.from("scenes")
			.select("*")
			.eq("script_id", scriptId)
			.order("order_index");

		const scenesRaw = sceneData ?? [];

		const { data: existingAssets } = await supabase
			.from("media_assets")
			.select("scene_id, storage_path, status, type")
			.in(
				"scene_id",
				scenesRaw.map((s) => s.id),
			);

		// IndexedDB에서 blob URL 일괄 복원
		const assetPaths = (existingAssets ?? [])
			.map((a) => (a as { storage_path: string }).storage_path)
			.filter((p: string) => p?.startsWith("scenes/"));
		const shotPaths = scenesRaw.flatMap((scene) =>
			getShotStoragePaths(scene as Scene),
		);
		const storagePaths = [...new Set([...assetPaths, ...shotPaths])];
		const blobUrls = await ensureBlobUrls(storagePaths);

		type AssetInfo = { storage_path: string; status: string };
		const imageMap = new Map<string, AssetInfo>();
		const videoMap = new Map<string, AssetInfo>();
		const ttsMap = new Map<string, AssetInfo>();
		for (const a of existingAssets ?? []) {
			if (a.type === "tts_audio") ttsMap.set(a.scene_id, a);
			else if (a.type === "video") videoMap.set(a.scene_id, a);
			else if (a.type === "image") imageMap.set(a.scene_id, a);
		}

		const socialClipShotUpdates: Array<{
			sceneId: string;
			shots: SceneShot[];
		}> = [];
		const mapped: SceneWithMedia[] = scenesRaw.map((s) => {
			const normalizedScene = s as Scene & {
				searchQueryKo?: string;
				searchQueryEn?: string;
			};
			const socialSlot = requiresRealClipVideo
				? ensureSocialClipVideoSlot(normalizedScene)
				: { shots: getSceneShots(normalizedScene), changed: false };
			if (socialSlot.changed) {
				socialClipShotUpdates.push({
					sceneId: String(s.id),
					shots: socialSlot.shots,
				});
			}
			const imgAsset = imageMap.get(s.id as string);
			const vidAsset = videoMap.get(s.id as string);
			const ttsAsset = ttsMap.get(s.id as string);
			const sceneType = s.scene_type as string;
			const sourceUrl = s.source_url as string | undefined;
			const shots = socialSlot.shots;
			const imageShots = shots.filter((shot) => shot.media_type === "image");
			const videoShots = shots.filter(
				(shot) => (shot.media_type ?? "video") === "video",
			);
			const firstShotUrl = shots
				.map((shot) => resolveShotUrl(shot, blobUrls))
				.find(Boolean);
			const allShotImagesReady =
				imageShots.length > 0 &&
				imageShots.every((shot) => Boolean(resolveShotUrl(shot, blobUrls)));
			const allShotVideosReady =
				videoShots.length > 0 &&
				videoShots.every((shot) => Boolean(resolveShotUrl(shot, blobUrls)));

			// --- 영상 상태 ---
			let videoStatus: MediaStatus = "not_needed";
			let videoUrl: string | undefined;
			if (sceneType === "video" || videoShots.length > 0) {
				if (allShotVideosReady) {
					videoStatus = "complete";
					videoUrl = resolveShotUrl(videoShots[0], blobUrls) || undefined;
				} else if (
					vidAsset?.status === "complete" &&
					vidAsset.storage_path?.startsWith("scenes/")
				) {
					videoStatus = "complete";
					videoUrl = blobUrls.get(vidAsset.storage_path) ?? "";
				} else if (
					videoShots.length > 0 ||
					(sceneType === "video" && sourceUrl)
				) {
					videoStatus = "pending";
				}
			}

			// --- 이미지 상태 ---
			let imageStatus: MediaStatus = "pending";
			let imageUrl: string | undefined;

			if (sceneType === "video") {
				if (allShotImagesReady) {
					imageStatus = "complete";
					imageUrl = firstShotUrl || undefined;
				} else if (imageShots.length > 0) {
					imageStatus = "pending";
				} else {
					imageStatus = "not_needed";
				}
				if (
					imgAsset?.status === "complete" &&
					imgAsset.storage_path?.startsWith("scenes/")
				) {
					imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
				}
			} else if (sceneType === "text_emphasis") {
				if (
					imgAsset?.status === "complete" &&
					imgAsset.storage_path?.startsWith("scenes/")
				) {
					imageStatus = "complete";
					imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
				} else {
					imageStatus = "not_needed";
				}
			} else if (sceneType === "news_overlay") {
				// 이미 IndexedDB에 이미지가 있으면 사용, 아니면 생성 필요
				if (
					imgAsset?.status === "complete" &&
					imgAsset.storage_path?.startsWith("scenes/")
				) {
					imageStatus = "complete";
					imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
				} else {
					imageStatus = "pending";
				}
			} else if (
				imgAsset?.status === "complete" &&
				imgAsset.storage_path?.startsWith("scenes/")
			) {
				imageStatus = "complete";
				imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
			} else if (imageShots.length === 0 && videoShots.length > 0) {
				imageStatus = "not_needed";
			} else if (allShotImagesReady) {
				imageStatus = "complete";
				imageUrl = firstShotUrl || undefined;
			} else if (sourceUrl) {
				// 외부 이미지 URL — 다운로드 필요
				imageStatus = "pending";
			}

			// --- TTS 상태 ---
			let ttsStatus: MediaStatus = "pending";
			let audioUrl: string | undefined;
			if (
				ttsAsset?.status === "complete" &&
				ttsAsset.storage_path?.startsWith("scenes/")
			) {
				ttsStatus = "complete";
				audioUrl = blobUrls.get(ttsAsset.storage_path) ?? "";
			}

			return {
				...s,
				imageStatus,
				ttsStatus,
				videoStatus,
				imageUrl,
				videoUrl,
				audioUrl,
				sourceUrl,
				shots,
			};
		});

		if (socialClipShotUpdates.length > 0) {
			await Promise.all(
				socialClipShotUpdates.map(({ sceneId, shots }) =>
					persistSceneShots(sceneId, shots),
				),
			);
		}

		setScenes(mapped);

		// 연속 나레이션 존재 여부 확인
		const narPath = localStorage.getItem(`narration_path_${scriptId}`);
		if (narPath) setNarrationStatus("complete");

		setLoading(false);
	}, [scriptId, requiresRealClipVideo]);

	useEffect(() => {
		void loadScenes();
	}, [loadScenes]);

	// 레퍼런스 템플릿 있으면 BGM 자동 배정 (한 번만)
	// — URL은 항상 script-scoped 키(`bgm_url_<scriptId>`)에 저장하여 리로드 후에도 복원 가능
	useEffect(() => {
		if (!referencePreset || bgmAutoPicked) return;
		const existingPath = localStorage.getItem(`bgm_path_${scriptId}`);
		let cancelled = false;

		void (async () => {
			// 이미 이 스크립트용 BGM이 할당되어 있으면 URL만 복원
			if (existingPath) {
				try {
					// 정적 경로(public/bgm/...)면 그대로 사용
					if (existingPath.startsWith("/")) {
						if (!cancelled) {
							localStorage.setItem(`bgm_url_${scriptId}`, existingPath);
							setBgmAutoPicked("restored_static");
						}
						return;
					}
					// IndexedDB path는 blob URL 재생성
					const blobMap = await ensureBlobUrls([existingPath]);
					const url = blobMap.get(existingPath);
					if (url && !cancelled) {
						localStorage.setItem(`bgm_url_${scriptId}`, url);
						setBgmAutoPicked("restored_indexeddb");
					}
				} catch (e) {
					console.warn("BGM restore failed:", e);
				}
				return;
			}

			// 최초 자동 선택
			try {
				const result = await autoPickBgm(scriptId, referencePreset.bgm);
				if (!cancelled && result) {
					localStorage.setItem(`bgm_url_${scriptId}`, result.url);
					setBgmAutoPicked(result.source);
				}
			} catch (e) {
				console.warn("BGM auto-pick failed:", e);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [scriptId, referencePreset, bgmAutoPicked]);

	function updateScene(index: number, patch: Partial<SceneWithMedia>) {
		setScenes((prev) => {
			const next = prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
			scenesRef.current = next;
			return next;
		});
	}

	async function persistScriptContentPatch(patch: Record<string, unknown>) {
		const nextContent = {
			...scriptContentJsonRef.current,
			...patch,
		};
		scriptContentJsonRef.current = nextContent;
		const { error } = await supabase
			.from("scripts")
			.update({ content_json: nextContent })
			.eq("id", scriptId);
		if (error) throw error;
	}

	function resolveAnimationFamilyFromContent(
		contentJson: Record<string, unknown>,
	): AnimationProductionFamily | undefined {
		return isAnimationProductionFamily(contentJson.production_family)
			? contentJson.production_family
			: undefined;
	}

	async function ensureAnimationAssetManifest(
		contentJson: Record<string, unknown>,
	): Promise<AnimationAssetManifest | null> {
		const rawProductionType = contentJson.production_type;
		if (rawProductionType !== "animation" && productionType !== "animation") {
			return null;
		}
		const manifest = buildAnimationAssetManifest({
			scriptId,
			bible: parseAnimationBible(contentJson.animation_bible),
			productionFamily: resolveAnimationFamilyFromContent(contentJson),
			scenes: scenesRef.current.map((scene) => ({
				id: scene.id,
				order_index: scene.order_index,
				narration_text: scene.narration_text,
				scene_type: scene.scene_type,
				visual_prompt: scene.visual_prompt,
				duration_seconds: Number(scene.duration_seconds),
				shots: getSceneShots(scene),
			})),
		});
		animationAssetManifestRef.current = manifest;

		const existing = await ensureBlobUrls([manifest.referenceSheetPath]);
		let referenceSheetUrl = existing.get(manifest.referenceSheetPath) ?? "";
		if (!referenceSheetUrl) {
			referenceSheetUrl = await aiGenerateImageToPath(
				manifest.referenceSheetPath,
				buildAnimationCharacterReferencePrompt(manifest),
				referencePreset,
				animationImageOptions(manifest, { useReferenceImage: false }),
			);
		}
		setAnimationReferenceSheetPath(manifest.referenceSheetPath);
		await persistScriptContentPatch({
			animation_assets: manifest,
			animation_reference_sheet_path: manifest.referenceSheetPath,
		});

		return manifest;
	}

	async function applyAnimationContinuityToAllScenes(
		manifest: AnimationAssetManifest,
	) {
		const nextScenes = repairAnimationScenesForQuality(
			scenesRef.current.map((scene) => ({
				...scene,
				shots: applyAnimationContinuityToShots(getSceneShots(scene), manifest),
			})),
			manifest,
		) as SceneWithMedia[];
		scenesRef.current = nextScenes;
		setScenes(nextScenes);
		await Promise.all(
			nextScenes.map((scene) =>
				persistSceneShots(scene.id, getSceneShots(scene)),
			),
		);
	}

	async function persistAnimationQualityReport(
		contentJson: Record<string, unknown>,
		manifest: AnimationAssetManifest | null,
	) {
		if (!manifest && contentJson.production_type !== "animation") return;
		if (manifest) {
			const repairedScenes = repairAnimationScenesForQuality(
				scenesRef.current,
				manifest,
			) as SceneWithMedia[];
			scenesRef.current = repairedScenes;
			setScenes(repairedScenes);
			await Promise.all(
				repairedScenes.map((scene) =>
					persistSceneShots(scene.id, getSceneShots(scene)),
				),
			);
		}
		const report = scoreAnimationProductionQuality({
			scenes: scenesRef.current.map((scene) => ({
				id: scene.id,
				order_index: scene.order_index,
				narration_text: scene.narration_text,
				scene_type: scene.scene_type,
				visual_prompt: scene.visual_prompt,
				duration_seconds: Number(scene.duration_seconds),
				shots: getSceneShots(scene),
			})),
			bible: parseAnimationBible(contentJson.animation_bible),
			productionFamily: manifest?.productionFamily,
			referenceSheetPath: manifest?.referenceSheetPath,
		});
		setAnimationQcReport(report);
		await persistScriptContentPatch({ animation_qc: report });
		setScenes((latest) => {
			const next = latest.map((scene) => ({ ...scene }));
			if (!report.passed) {
				for (const issue of report.issues.filter(
					(item) => item.severity === "critical",
				)) {
					if (next[0] && !next[0].errorMsg) next[0].errorMsg = issue.message;
				}
			}
			scenesRef.current = next;
			return next;
		});
	}

	async function persistSceneShots(sceneId: string, shots: SceneShot[]) {
		const { error } = await supabase
			.from("scenes")
			.update({ shots })
			.eq("id", sceneId);
		if (error) throw error;
	}

	async function applyManualVideoToScene(
		sceneIndex: number,
		input: {
			storagePath: string;
			url: string;
			title: string;
			provider: "manual_upload" | "manual_url";
		},
	) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		const videoShotIndex = shots.findIndex(
			(shot) => (shot.media_type ?? "video") === "video",
		);
		const targetShot =
			videoShotIndex >= 0 ? shots[videoShotIndex] : buildManualVideoShot(scene);
		const nextShot: SceneShot = {
			...targetShot,
			media_type: "video",
			source_url: input.storagePath,
			source_title: input.title,
			trim_start: undefined,
			trim_end: undefined,
			rejection_reason: undefined,
		};
		markShotSelected(nextShot, {
			provider: input.provider,
			sourceConfidence: 98,
			qualityScore: 70,
			sourceTitle: input.title,
		});

		const nextShots =
			videoShotIndex >= 0
				? shots.map((shot, index) =>
						index === videoShotIndex ? nextShot : shot,
					)
				: [nextShot, ...shots];
		await persistSceneShots(scene.id, nextShots);

		const allVideoShotsReady = nextShots
			.filter((shot) => (shot.media_type ?? "video") === "video")
			.every((shot) => Boolean(shot.source_url));
		updateScene(sceneIndex, {
			shots: nextShots,
			videoStatus: allVideoShotsReady ? "complete" : "pending",
			videoUrl: input.url,
			errorMsg: undefined,
		});
	}

	async function updatePrimaryVideoShot(
		sceneIndex: number,
		patch: Partial<
			Pick<SceneShot, "trim_start" | "trim_end" | "duration_seconds" | "crop">
		>,
	) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		const videoShotIndex = shots.findIndex(
			(shot) => (shot.media_type ?? "video") === "video",
		);
		const targetShot =
			videoShotIndex >= 0 ? shots[videoShotIndex] : buildManualVideoShot(scene);
		const nextShot: SceneShot = {
			...targetShot,
			...patch,
			media_type: "video",
		};
		const nextShots =
			videoShotIndex >= 0
				? shots.map((shot, index) =>
						index === videoShotIndex ? nextShot : shot,
					)
				: [nextShot, ...shots];
		const sceneDuration =
			typeof patch.duration_seconds === "number" &&
			Number.isFinite(patch.duration_seconds)
				? patch.duration_seconds
				: undefined;
		const updatePayload: Record<string, unknown> = { shots: nextShots };
		if (sceneDuration !== undefined) {
			updatePayload.duration_seconds = sceneDuration;
		}
		const { error } = await supabase
			.from("scenes")
			.update(updatePayload)
			.eq("id", scene.id);
		if (error) throw error;
		updateScene(sceneIndex, {
			shots: nextShots,
			...(sceneDuration !== undefined
				? { duration_seconds: sceneDuration }
				: {}),
			videoStatus: nextShot.source_url ? "complete" : "pending",
			errorMsg: undefined,
		});
	}

	function primaryVideoShot(scene: SceneWithMedia): SceneShot | undefined {
		return getVideoShots(scene)[0];
	}

	async function handleInsertVideoFile(sceneIndex: number, file?: File) {
		if (!file) return;
		const scene = scenesRef.current[sceneIndex];
		if (!isSupportedManualVideo(file)) {
			updateScene(sceneIndex, {
				videoStatus: "error",
				errorMsg: "mp4, webm, mov 형식의 영상 파일만 삽입할 수 있습니다.",
			});
			return;
		}
		if (file.size > MAX_MANUAL_VIDEO_BYTES) {
			updateScene(sceneIndex, {
				videoStatus: "error",
				errorMsg:
					"영상 파일이 250MB를 초과합니다. 짧은 클립으로 잘라 넣으세요.",
			});
			return;
		}

		setManualVideoBusy((prev) => ({ ...prev, [scene.id]: true }));
		updateScene(sceneIndex, { videoStatus: "generating", errorMsg: undefined });
		try {
			const extension = videoExtensionFromFile(file);
			const stem = sanitizeFileStem(file.name);
			const storagePath = `scenes/${scene.id}/manual/${Date.now()}-${stem}.${extension}`;
			const buffer = await file.arrayBuffer();
			const url = await storeLocalFile(
				storagePath,
				new Uint8Array(buffer),
				file.type || `video/${extension}`,
			);
			await applyManualVideoToScene(sceneIndex, {
				storagePath,
				url,
				title: file.name,
				provider: "manual_upload",
			});
		} catch (err) {
			updateScene(sceneIndex, {
				videoStatus: "error",
				errorMsg:
					err instanceof Error ? err.message : "영상 파일 삽입에 실패했습니다.",
			});
		} finally {
			setManualVideoBusy((prev) => ({ ...prev, [scene.id]: false }));
		}
	}

	async function handleInsertVideoUrl(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		const inputUrl = (manualVideoUrls[scene.id] ?? "").trim();
		if (!inputUrl) {
			updateScene(sceneIndex, {
				videoStatus: "error",
				errorMsg: "삽입할 영상 URL을 입력하세요.",
			});
			return;
		}
		if (!isDirectVideoUrl(inputUrl)) {
			updateScene(sceneIndex, {
				videoStatus: "error",
				errorMsg: "YouTube URL 또는 mp4/webm/mov 직접 URL만 지원합니다.",
			});
			return;
		}

		setManualVideoBusy((prev) => ({ ...prev, [scene.id]: true }));
		updateScene(sceneIndex, { videoStatus: "generating", errorMsg: undefined });
		try {
			const shot = getVideoShots(scene)[0] ?? buildManualVideoShot(scene);
			const storagePath = `scenes/${scene.id}/manual/${Date.now()}-${shot.id}.mp4`;
			const downloaded = isYouTubeVideoUrl(inputUrl)
				? await downloadYouTubeVideoToPath(
						storagePath,
						inputUrl,
						getShotVideoDurationSeconds(shot),
						getShotClipStartSeconds(shot, 0),
					)
				: await downloadVideoToPath(storagePath, inputUrl);
			await applyManualVideoToScene(sceneIndex, {
				storagePath: downloaded.storagePath,
				url: downloaded.url,
				title: inputUrl,
				provider: "manual_url",
			});
			setManualVideoUrls((prev) => ({ ...prev, [scene.id]: "" }));
		} catch (err) {
			updateScene(sceneIndex, {
				videoStatus: "error",
				errorMsg:
					err instanceof Error ? err.message : "영상 URL 삽입에 실패했습니다.",
			});
		} finally {
			setManualVideoBusy((prev) => ({ ...prev, [scene.id]: false }));
		}
	}

	async function generateShotImages(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		if (shots.length === 0 || scene.scene_type === "text_emphasis") {
			return false;
		}
		const imageShots = shots.filter((shot) => shot.media_type === "image");
		if (imageShots.length === 0 && scene.scene_type === "video") return false;

		let previewImageUrl = scene.imageUrl;
		let changed = false;
		const sharedImageSources = new Map<
			string,
			{ storagePath: string; url: string }
		>();

		for (const shot of shots) {
			if (shot.media_type === "video") continue;

			const storagePath = `scenes/${scene.id}/shots/${shot.id}.png`;
			const queries = buildShotSearchQueries(scene, shot);
			const imagePrompt = buildShotImagePrompt(scene, shot);

			if (isLocalMediaPath(shot.source_url)) {
				const localPath = shot.source_url!;
				if (!previewImageUrl) {
					const blobMap = await ensureBlobUrls([localPath]);
					previewImageUrl = blobMap.get(localPath) ?? previewImageUrl;
				}
				continue;
			}

			let url = "";
			if (productionType === "animation" || isAnimationShot(shot)) {
				const manifest = animationAssetManifestRef.current;
				const animationPrompt = manifest
					? enrichAnimationPromptWithContinuity(imagePrompt, manifest, shot)
					: imagePrompt;
				url = await aiGenerateImageToPath(
					storagePath,
					animationPrompt,
					referencePreset,
					buildSceneImageGenOptions(scene.mood, manifest),
				);
				shot.source_url = storagePath;
				shot.media_type = "image";
				if (manifest) {
					shot.reference_image_path = manifest.referenceSheetPath;
					shot.animation_family = manifest.productionFamily;
					shot.continuity_key =
						shot.continuity_key ?? `${manifest.productionFamily}-${shot.id}`;
					shot.source_title =
						shot.source_title ?? manifest.productionFamilyLabel;
				}
				markShotSelected(shot, {
					provider: "animation",
					qualityScore: 58,
					sourceConfidence: Math.max(shot.source_confidence ?? 0, 84),
				});
			} else if (isDirectImageUrl(shot.source_url)) {
				const sharedKey = shot.source_url!;
				const reused = sharedImageSources.get(sharedKey);
				if (reused) {
					url = reused.url;
					shot.source_url = reused.storagePath;
					markShotSelected(shot, {
						provider: "direct",
						sourceConfidence: Math.max(shot.source_confidence ?? 0, 88),
					});
				} else {
					const downloaded = await downloadImageToPath(
						storagePath,
						shot.source_url!,
					);
					url = downloaded.url;
					shot.source_url = downloaded.storagePath;
					markShotSelected(shot, {
						provider: "direct",
						sourceConfidence: Math.max(shot.source_confidence ?? 0, 88),
					});
					sharedImageSources.set(sharedKey, downloaded);
				}
			} else {
				const searched = await searchAndDownloadImageToPath(
					storagePath,
					queries.queryEn,
					queries.queryKo,
					queries.locale,
					referenceMediaSearchOptions(referencePreset, shot, "image", {
						rejectTerms: shot.reject_terms,
						minScore: strictImageMinScore(shot),
						minRelevance: strictMinRelevance(shot),
					}),
				);
				if (searched) {
					url = searched.url;
					shot.source_url = searched.storagePath;
					markShotSelected(shot, {
						provider: searched.provider,
						qualityScore: searched.qualityScore,
						sourceTitle: searched.sourceTitle,
					});
				} else if (canUseSourceCard(shot)) {
					const cardPath = storagePath.replace(/\.[a-z0-9]+$/i, ".svg");
					url = await generateSourceCardToPath(
						cardPath,
						sourceCardInput(scene, shot),
					);
					shot.source_url = cardPath;
					shot.media_type = "image";
					markShotSelected(shot, {
						provider: "source_card",
						qualityScore: 72,
						sourceConfidence: Math.max(shot.source_confidence ?? 0, 72),
						sourceTitle: shot.source_title || scene.news_title,
					});
				} else {
					url = await aiGenerateImageToPath(
						storagePath,
						imagePrompt,
						referencePreset,
						buildSceneImageGenOptions(scene.mood),
					);
					shot.source_url = storagePath;
					markShotGeneratedFallback(
						shot,
						"검색 후보가 샷 의도 품질 게이트를 통과하지 못해 AI 재구성으로 대체됨",
					);
				}
			}

			if (!previewImageUrl) previewImageUrl = url;
			changed = true;
		}

		if (
			!shots.every(
				(shot) => shot.media_type === "video" || Boolean(shot.source_url),
			)
		) {
			return false;
		}

		if (changed) {
			await persistSceneShots(scene.id, shots);
		}

		updateScene(sceneIndex, {
			shots,
			imageStatus: "complete",
			imageUrl: previewImageUrl,
		});
		return true;
	}

	// 모든 AI 이미지 생성(씬·샷)에 공통 적용할 옵션:
	// 종횡비(영상과 일치, Shorts 9:16 크롭 방지) + mood(시네마틱 톤) + 시드(컷 간 톤 일관성).
	// 애니메이션 manifest 가 있으면 styleSeed/styleMode/네거티브가 우선하고 종횡비·mood 는 base 에서 온다.
	function buildSceneImageGenOptions(
		mood?: string,
		manifest?: AnimationAssetManifest | null,
	) {
		const base = {
			aspectRatio: (scriptFormat === "longform" ? "16:9" : "9:16") as
				| "16:9"
				| "9:16",
			mood,
			seed: deriveLockedSeed(scriptId),
		};
		return manifest ? { ...base, ...animationImageOptions(manifest) } : base;
	}

	async function generateFallbackSceneImage(
		scene: SceneWithMedia,
		imagePrompt: string,
	): Promise<string> {
		const isAnimationScene =
			productionType === "animation" ||
			scriptContentJsonRef.current.production_type === "animation";
		const manifest = isAnimationScene
			? (animationAssetManifestRef.current ??
				(await ensureAnimationAssetManifest(scriptContentJsonRef.current)))
			: null;
		const prompt = manifest
			? enrichAnimationPromptWithContinuity(imagePrompt, manifest)
			: imagePrompt;
		return aiGenerateImage(
			scene.id,
			prompt,
			referencePreset,
			buildSceneImageGenOptions(scene.mood, manifest),
		);
	}

	async function fallbackVideoShotsToImages(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		if (shots.length === 0) return false;

		let previewImageUrl = scene.imageUrl;
		let changed = false;

		for (const shot of shots) {
			if ((shot.media_type ?? "video") !== "video") continue;
			if (
				shot.source_url &&
				!isDirectVideoUrl(shot.source_url) &&
				!isLocalMediaPath(shot.source_url)
			) {
				continue;
			}
			if (shot.source_url && isLocalMediaPath(shot.source_url)) continue;
			const storagePath = `scenes/${scene.id}/shots/${shot.id}.png`;
			const queries = buildShotSearchQueries(scene, shot);
			const imagePrompt = buildShotImagePrompt(scene, shot);
			const searched = await searchAndDownloadImageToPath(
				storagePath,
				queries.queryEn,
				queries.queryKo,
				queries.locale,
				referenceMediaSearchOptions(referencePreset, shot, "image", {
					rejectTerms: shot.reject_terms,
					minScore: strictImageMinScore(shot),
					minRelevance: strictMinRelevance(shot),
				}),
			);
			if (searched) {
				shot.media_type = "image";
				shot.source_url = searched.storagePath;
				shot.trim_start = undefined;
				shot.trim_end = undefined;
				markShotSelected(shot, {
					provider: searched.provider,
					qualityScore: searched.qualityScore,
					sourceTitle: searched.sourceTitle,
				});
				if (!previewImageUrl) previewImageUrl = searched.url;
				changed = true;
				continue;
			}

			if (canUseSourceCard(shot)) {
				const cardPath = storagePath.replace(/\.[a-z0-9]+$/i, ".svg");
				const cardUrl = await generateSourceCardToPath(
					cardPath,
					sourceCardInput(scene, shot),
				);
				shot.media_type = "image";
				shot.source_url = cardPath;
				shot.trim_start = undefined;
				shot.trim_end = undefined;
				markShotSelected(shot, {
					provider: "source_card",
					qualityScore: 72,
					sourceConfidence: Math.max(shot.source_confidence ?? 0, 72),
					sourceTitle: shot.source_title || scene.news_title,
				});
				if (!previewImageUrl) previewImageUrl = cardUrl;
				changed = true;
				continue;
			}

			const generatedUrl = await aiGenerateImageToPath(
				storagePath,
				imagePrompt,
				referencePreset,
				buildSceneImageGenOptions(scene.mood),
			);
			shot.media_type = "image";
			shot.source_url = storagePath;
			shot.trim_start = undefined;
			shot.trim_end = undefined;
			markShotGeneratedFallback(
				shot,
				"영상 후보가 없어 이미지 AI 재구성으로 폴백됨",
			);
			if (!previewImageUrl) previewImageUrl = generatedUrl;
			changed = true;
		}

		if (!changed) return false;
		await persistSceneShots(scene.id, shots);
		updateScene(sceneIndex, {
			shots,
			videoStatus: "not_needed",
			imageStatus: "complete",
			imageUrl: previewImageUrl,
		});
		return true;
	}

	async function repairWeakSceneShots(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		if (!scene || scene.scene_type === "text_emphasis") return false;
		const shots = getSceneShots(scene);
		if (shots.length === 0) return false;

		let previewImageUrl = scene.imageUrl;
		let previewVideoUrl = scene.videoUrl;
		let changed = false;

		for (const [shotIndex, shot] of shots.entries()) {
			if (!shouldRepairSelectedShot(shot)) continue;

			const queries = buildShotSearchQueries(scene, shot);
			const imagePrompt = buildShotImagePrompt(scene, shot);
			const mediaType = shot.media_type ?? "video";

			if (mediaType === "video") {
				const searchedVideo = await searchAndDownloadVideoToPath(
					`scenes/${scene.id}/shots/${shot.id}-repair.mp4`,
					queries.queryEn,
					queries.queryKo,
					getShotVideoDurationSeconds(shot),
					queries.locale,
					referenceMediaSearchOptions(referencePreset, shot, "video", {
						rejectTerms: shot.reject_terms,
						minScore: Math.max(strictVideoMinScore(shot) ?? 0, 42),
						minRelevance: strictMinRelevance(shot),
					}),
				);
				if (searchedVideo) {
					shot.source_url = searchedVideo.storagePath;
					shot.media_type = "video";
					markShotSelected(shot, {
						provider: searchedVideo.provider,
						qualityScore: searchedVideo.qualityScore,
						dynamicScore: searchedVideo.dynamicScore,
						dynamicIssues: searchedVideo.dynamicIssues,
						sourceTitle: searchedVideo.sourceTitle,
					});
					if (!previewVideoUrl) previewVideoUrl = searchedVideo.videoUrl;
					changed = true;
					continue;
				}
				shot.media_type = "image";
				shot.trim_start = undefined;
				shot.trim_end = undefined;
			}

			const searchedImage = await searchAndDownloadImageToPath(
				`scenes/${scene.id}/shots/${shot.id}-repair.png`,
				queries.queryEn,
				queries.queryKo,
				queries.locale,
				referenceMediaSearchOptions(referencePreset, shot, "image", {
					rejectTerms: shot.reject_terms,
					minScore: Math.max(strictImageMinScore(shot) ?? 0, 34),
					minRelevance: strictMinRelevance(shot),
				}),
			);
			if (searchedImage) {
				shot.media_type = "image";
				shot.source_url = searchedImage.storagePath;
				shot.trim_start = undefined;
				shot.trim_end = undefined;
				markShotSelected(shot, {
					provider: searchedImage.provider,
					qualityScore: searchedImage.qualityScore,
					sourceTitle: searchedImage.sourceTitle,
				});
				if (!previewImageUrl) previewImageUrl = searchedImage.url;
				changed = true;
				continue;
			}

			if (canUseSourceCard(shot)) {
				const cardPath = `scenes/${scene.id}/shots/${shot.id}-repair.svg`;
				const cardUrl = await generateSourceCardToPath(
					cardPath,
					sourceCardInput(scene, shot),
				);
				shot.media_type = "image";
				shot.source_url = cardPath;
				shot.trim_start = undefined;
				shot.trim_end = undefined;
				markShotSelected(shot, {
					provider: "source_card",
					qualityScore: 72,
					sourceConfidence: Math.max(shot.source_confidence ?? 0, 72),
					sourceTitle: shot.source_title || scene.news_title,
				});
				if (!previewImageUrl) previewImageUrl = cardUrl;
				changed = true;
				continue;
			}

			const generatedUrl = await aiGenerateImageToPath(
				`scenes/${scene.id}/shots/${shot.id}-repair.png`,
				imagePrompt,
				referencePreset,
				buildSceneImageGenOptions(scene.mood),
			);
			shot.media_type = "image";
			shot.source_url = `scenes/${scene.id}/shots/${shot.id}-repair.png`;
			shot.trim_start = undefined;
			shot.trim_end = undefined;
			markShotGeneratedFallback(
				shot,
				"검색/영상 후보가 품질 기준을 통과하지 못해 샷 의도 기반 AI 재구성으로 대체됨",
			);
			if (!previewImageUrl) previewImageUrl = generatedUrl;
			changed = true;

			if (shotIndex > 0 && previewImageUrl && !scene.imageUrl) {
				previewImageUrl = generatedUrl;
			}
		}

		if (!changed) return false;
		await persistSceneShots(scene.id, shots);
		const remainingVideoShots = getVideoShots({ shots });
		updateScene(sceneIndex, {
			shots,
			imageStatus: previewImageUrl ? "complete" : scene.imageStatus,
			videoStatus:
				remainingVideoShots.length === 0
					? "not_needed"
					: remainingVideoShots.every((shot) => shot.source_url)
						? "complete"
						: "pending",
			imageUrl: previewImageUrl,
			videoUrl: previewVideoUrl,
			errorMsg: undefined,
		});
		return true;
	}

	async function generateShotVideos(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		const videoShots = shots.filter(
			(shot) => (shot.media_type ?? "video") === "video",
		);
		if (videoShots.length === 0) return false;

		let previewVideoUrl = scene.videoUrl;
		let changed = false;
		const sharedVideoSources = new Map<
			string,
			{ storagePath: string; url: string }
		>();

		for (const [shotIndex, shot] of videoShots.entries()) {
			if (isLocalMediaPath(shot.source_url)) {
				const localPath = shot.source_url!;
				if (!previewVideoUrl) {
					const blobMap = await ensureBlobUrls([localPath]);
					previewVideoUrl = blobMap.get(localPath) ?? previewVideoUrl;
				}
				continue;
			}
			if (isDirectVideoUrl(shot.source_url)) {
				const isYouTube = isYouTubeVideoUrl(shot.source_url);
				const sharedKey = getVideoReuseKey(shot.source_url!, shot, shotIndex);
				const reused = sharedVideoSources.get(sharedKey);
				if (reused) {
					shot.source_url = reused.storagePath;
					if (isYouTube) {
						shot.trim_start = undefined;
						shot.trim_end = undefined;
					}
					markShotSelected(shot, {
						provider: isYouTube ? "youtube" : "direct",
						sourceConfidence: Math.max(shot.source_confidence ?? 0, 90),
					});
					if (!previewVideoUrl) previewVideoUrl = reused.url;
					changed = true;
					continue;
				}
				const storagePath = `scenes/${scene.id}/shots/${shot.id}.mp4`;
				const downloaded = isYouTube
					? await downloadYouTubeVideoToPath(
							storagePath,
							shot.source_url!,
							getShotVideoDurationSeconds(shot),
							getShotClipStartSeconds(shot, shotIndex),
						)
					: await downloadVideoToPath(storagePath, shot.source_url!);
				shot.source_url = downloaded.storagePath;
				if (isYouTube) {
					shot.trim_start = undefined;
					shot.trim_end = undefined;
				}
				markShotSelected(shot, {
					provider: isYouTube ? "youtube" : "direct",
					sourceConfidence: Math.max(shot.source_confidence ?? 0, 90),
				});
				sharedVideoSources.set(sharedKey, downloaded);
				if (!previewVideoUrl) previewVideoUrl = downloaded.url;
				changed = true;
				continue;
			}

			const indexedSource =
				typeof shot.source_index === "number" && shot.source_index >= 0
					? sources[shot.source_index]
					: undefined;
			if (indexedSource?.url && isDirectVideoUrl(indexedSource.url)) {
				const isYouTube = isYouTubeVideoUrl(indexedSource.url);
				const sharedKey = getVideoReuseKey(indexedSource.url, shot, shotIndex);
				const reused = sharedVideoSources.get(sharedKey);
				if (reused) {
					shot.source_url = reused.storagePath;
					if (isYouTube) {
						shot.trim_start = undefined;
						shot.trim_end = undefined;
					}
					markShotSelected(shot, {
						provider: isYouTube ? "youtube" : "direct",
						sourceConfidence: Math.max(shot.source_confidence ?? 0, 90),
					});
					if (!previewVideoUrl) previewVideoUrl = reused.url;
					changed = true;
					continue;
				}
				const storagePath = `scenes/${scene.id}/shots/${shot.id}.mp4`;
				const downloaded = isYouTube
					? await downloadYouTubeVideoToPath(
							storagePath,
							indexedSource.url,
							getShotVideoDurationSeconds(shot),
							getShotClipStartSeconds(shot, shotIndex),
						)
					: await downloadVideoToPath(storagePath, indexedSource.url);
				shot.source_url = downloaded.storagePath;
				if (isYouTube) {
					shot.trim_start = undefined;
					shot.trim_end = undefined;
				}
				markShotSelected(shot, {
					provider: isYouTube ? "youtube" : "direct",
					sourceConfidence: Math.max(shot.source_confidence ?? 0, 90),
				});
				sharedVideoSources.set(sharedKey, downloaded);
				if (!previewVideoUrl) previewVideoUrl = downloaded.url;
				changed = true;
				continue;
			}

			const queries = buildShotSearchQueries(scene, shot);
			const searched = await searchAndDownloadVideoToPath(
				`scenes/${scene.id}/shots/${shot.id}.mp4`,
				queries.queryEn,
				queries.queryKo,
				getShotVideoDurationSeconds(shot),
				queries.locale,
				referenceMediaSearchOptions(referencePreset, shot, "video", {
					rejectTerms: shot.reject_terms,
					minScore: strictVideoMinScore(shot),
					minRelevance: strictMinRelevance(shot),
				}),
			);
			if (searched) {
				shot.source_url = searched.storagePath;
				markShotSelected(shot, {
					provider: searched.provider,
					qualityScore: searched.qualityScore,
					dynamicScore: searched.dynamicScore,
					dynamicIssues: searched.dynamicIssues,
					sourceTitle: searched.sourceTitle,
				});
				if (!previewVideoUrl) previewVideoUrl = searched.videoUrl;
				changed = true;
			}
		}

		if (changed) {
			await persistSceneShots(scene.id, shots);
		}

		const allResolved = shots
			.filter((shot) => (shot.media_type ?? "video") === "video")
			.every((shot) => Boolean(shot.source_url));
		updateScene(sceneIndex, {
			shots,
			videoStatus: allResolved ? "complete" : "pending",
			videoUrl: previewVideoUrl,
		});
		return allResolved;
	}

	async function generateImage(sceneIndex: number, retryCount = 0) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { imageStatus: "generating", errorMsg: undefined });

		try {
			const usedShotImages = await generateShotImages(sceneIndex);
			if (usedShotImages) return;

			let url: string;
			const { queryKo, queryEn, locale } = buildSceneSearchQueries(scene);
			const imagePrompt = buildSceneImagePrompt(scene);

			if (isDirectImageUrl(scene.sourceUrl)) {
				url = await downloadImageToLocal(scene.id, scene.sourceUrl!);
			} else {
				// 1순위: 이미지 검색
				url = await searchAndDownloadImage(scene.id, queryEn, queryKo, locale);

				// 2순위: AI 이미지 생성
				if (!url) {
					url = await generateFallbackSceneImage(scene, imagePrompt);
				}
			}
			updateScene(sceneIndex, { imageStatus: "complete", imageUrl: url });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";

			// 자가 복구: 최대 2회 자동 재시도
			if (retryCount < 2) {
				const isRateLimit = msg.includes("429");
				const delay = isRateLimit ? 15000 : 3000;
				updateScene(sceneIndex, {
					errorMsg: `자동 복구 중 (${retryCount + 1}/2)...`,
				});
				await new Promise((r) => setTimeout(r, delay));

				// 수집 자료 실패 시 → AI 생성으로 전환
				if (scene.sourceUrl?.startsWith("http") && retryCount === 1) {
					updateScene(sceneIndex, { sourceUrl: undefined });
				}

				return generateImage(sceneIndex, retryCount + 1);
			}

			updateScene(sceneIndex, { imageStatus: "error", errorMsg: msg });
		}
	}

	async function generateVideo(sceneIndex: number, retryCount = 0) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { videoStatus: "generating", errorMsg: undefined });

		try {
			await generateShotImages(sceneIndex);
			const latestScene = scenesRef.current[sceneIndex];
			const { queryKo, queryEn, locale } = buildSceneSearchQueries(latestScene);
			const imagePrompt = buildSceneImagePrompt(latestScene);
			const videoShots = getVideoShots(latestScene);
			if (videoShots.length === 0) {
				updateScene(sceneIndex, { videoStatus: "not_needed" });
				return;
			}
			const shotVideosReady = await generateShotVideos(sceneIndex);
			if (shotVideosReady) return;
			const refreshedScene = scenesRef.current[sceneIndex];
			const unresolvedVideoShots = getVideoShots(refreshedScene).filter(
				(shot) => !shot.source_url,
			);
			if (unresolvedVideoShots.length === 0) {
				updateScene(sceneIndex, { videoStatus: "complete" });
				return;
			}
			const maxDuration = Math.min(
				40,
				Math.max(8, Math.ceil(Number(scene.duration_seconds)) + 4),
			);

			if (isDirectVideoUrl(latestScene.sourceUrl)) {
				const isYouTube = isYouTubeVideoUrl(latestScene.sourceUrl);
				const url = isYouTube
					? await downloadYouTubeVideo(
							latestScene.id,
							latestScene.sourceUrl!,
							maxDuration,
						)
					: await downloadVideoToLocal(latestScene.id, latestScene.sourceUrl!);
				updateScene(sceneIndex, { videoStatus: "complete", videoUrl: url });

				// 썸네일도 fallback으로 저장
				const thumbnailUrl =
					sources.find((src) => src.url === latestScene.sourceUrl)?.thumbnail ??
					"";
				if (thumbnailUrl) {
					const imgUrl = await downloadThumbnailToLocal(
						latestScene.id,
						thumbnailUrl,
					);
					if (imgUrl) {
						updateScene(sceneIndex, {
							imageStatus: "complete",
							imageUrl: latestScene.imageUrl || imgUrl,
						});
					}
				}
				return;
			}

			const { videoUrl, thumbnailUrl } = await searchAndDownloadVideo(
				latestScene.id,
				queryEn,
				queryKo,
				maxDuration,
				locale,
			);
			if (videoUrl) {
				updateScene(sceneIndex, {
					videoStatus: "complete",
					videoUrl,
					imageStatus:
						latestScene.imageStatus === "complete"
							? "complete"
							: thumbnailUrl
								? "complete"
								: latestScene.imageStatus,
					imageUrl:
						latestScene.imageUrl || thumbnailUrl || latestScene.imageUrl,
				});
				return;
			}

			if (requiresRealClipVideo) {
				updateScene(sceneIndex, {
					videoStatus: "error",
					errorMsg:
						"이 레퍼런스는 실제 클립 영상이 필수입니다. 사용 가능한 영상 후보가 없어서 이미지 폴백을 막았습니다. 직접 영상 소스를 추가하거나 검색어를 더 구체화하세요.",
				});
				return;
			}

			const converted = await fallbackVideoShotsToImages(sceneIndex);
			if (converted) return;

			const fallbackImage =
				(await searchAndDownloadImage(
					latestScene.id,
					queryEn,
					queryKo,
					locale,
				)) || (await generateFallbackSceneImage(latestScene, imagePrompt));
			updateScene(sceneIndex, {
				videoStatus: "not_needed",
				imageStatus: "complete",
				imageUrl: latestScene.imageUrl || fallbackImage,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";

			if (retryCount < 2) {
				const delay = msg.includes("429") ? 15000 : 3000;
				updateScene(sceneIndex, {
					errorMsg: `영상 자동 복구 중 (${retryCount + 1}/2)...`,
				});
				await new Promise((r) => setTimeout(r, delay));
				return generateVideo(sceneIndex, retryCount + 1);
			}

			updateScene(sceneIndex, { videoStatus: "error", errorMsg: msg });
		}
	}

	/** scenes 테이블에 directives 일괄 update — 페이지 리로드 후에도 재사용 */
	async function persistDirectivesToDb(
		currentScenes: SceneWithMedia[],
		directiveMap: Map<number, SceneDirective>,
	) {
		const updates: Array<PromiseLike<unknown>> = [];
		for (let i = 0; i < currentScenes.length; i++) {
			const directive = directiveMap.get(i);
			if (!directive) continue;
			updates.push(
				supabase
					.from("scenes")
					.update({
						shot_type: directive.shot_type,
						camera_motion: directive.camera_motion,
						scene_bgm_mood: directive.bgm_mood,
						pacing: directive.pacing,
					})
					.eq("id", currentScenes[i].id),
			);
		}
		try {
			await Promise.all(updates);
		} catch (err) {
			// 컬럼 없거나 RLS 차단 시 — 비치명. 다음 세션 재계산.
			console.warn(
				"[directives persist] supabase update 실패:",
				(err as Error).message,
			);
		}
	}

	async function generateAiVideo(
		sceneIndex: number,
		options: { chainFromVideoUrl?: string } = {},
		retryCount = 0,
	) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { videoStatus: "generating", errorMsg: undefined });

		try {
			// 이미지가 없으면 먼저 생성
			let imageUrl = scene.imageUrl;
			if (!imageUrl) {
				const imagePrompt = buildSceneImagePrompt(scene);
				imageUrl = await generateFallbackSceneImage(scene, imagePrompt);
				updateScene(sceneIndex, {
					imageStatus: "complete",
					imageUrl,
				});
			}

			const rawPrompt = buildSceneImagePrompt(scene);
			const duration = Math.min(
				10,
				Math.max(3, Math.ceil(Number(scene.duration_seconds) || 5)),
			);

			// referencePreset.image: { mood, lighting, dominantColors, promptTemplate }
			// 우선순위: scene 고유값 > ref. directives 는 [key:string]:unknown 으로 저장됨.
			const refImage = referencePreset?.image;
			const sceneShotType = scene.shot_type as
				| SceneDirective["shot_type"]
				| undefined;
			const sceneCameraMotion = scene.camera_motion as
				| SceneDirective["camera_motion"]
				| undefined;
			const sceneLighting = scene.lighting_style as
				| "dark"
				| "natural"
				| "bright"
				| "mixed"
				| undefined;
			const enriched = enrichVideoPrompt({
				rawPrompt,
				mood: scene.mood ?? refImage?.mood,
				lighting: sceneLighting ?? refImage?.lighting,
				shotType: sceneShotType,
				cameraMotion: sceneCameraMotion,
				dominantColors: refImage?.dominantColors,
				stylePromptTemplate: refImage?.promptTemplate,
				format: scriptFormat,
			});

			const { url } = await generateSceneVideo(scene.id, {
				provider: aiVideoProvider,
				quality: "final",
				prompt: enriched.prompt,
				imageUrl,
				duration,
				aspectRatio: enriched.aspectRatio,
				cameraCommands: enriched.cameraCommands,
				// 씬마다 다른 시드 → I2V 모션 정체/드리프트 방지 (인물 일관성은 init image·네거티브가 담당).
				seed: deriveLockedSeed(scriptId, sceneIndex),
				chainFromVideoUrl: options.chainFromVideoUrl,
			});

			updateScene(sceneIndex, { videoStatus: "complete", videoUrl: url });
			return url;
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			if (retryCount < 1) {
				updateScene(sceneIndex, {
					errorMsg: `AI 영상 자동 복구 중 (${retryCount + 1}/1)...`,
				});
				await new Promise((r) => setTimeout(r, 5000));
				return generateAiVideo(sceneIndex, options, retryCount + 1);
			}
			updateScene(sceneIndex, { videoStatus: "error", errorMsg: msg });
			return undefined;
		}
	}

	/**
	 * 모든 씬 AI 영상 일괄 생성 — 순차 처리 + last-frame chaining.
	 * 이전 씬의 결과 비디오 마지막 프레임이 다음 씬의 init_image 가 되어
	 * 시각 연속성 확보 (스톱 모션 같은 끊김 방지).
	 */
	async function handleGenerateAllAiVideos() {
		setGenerating(true);
		const eligible = scenesRef.current.filter(
			(s) => s.scene_type !== "text_emphasis",
		).length;
		setAiVideoBatch({ current: 0, total: eligible });
		try {
			// directives 누락 시 lazy 계산 (촬영지시 → enrichVideoPrompt 활용 극대화)
			const hasAnyDirective = scenesRef.current.some(
				(s) => s.camera_motion || s.shot_type,
			);
			if (!hasAnyDirective) {
				try {
					const briefStub = {
						summary: "",
						timeline: [],
						key_figures: [],
						facts: [],
						misconceptions: [],
						search_keywords: [],
					};
					const directives = await planSceneDirectives(
						scenesRef.current.map((s, i) => ({
							narration: s.narration_text,
							type: s.scene_type,
							index: i,
						})),
						briefStub,
						"",
					);
					const dirMap = new Map(directives.map((d) => [d.index, d]));
					setScenes((prev) => {
						const next = prev.map((s, i) => {
							const d = dirMap.get(i);
							if (!d) return s;
							return {
								...s,
								shot_type: d.shot_type,
								camera_motion: d.camera_motion,
								scene_bgm_mood: d.bgm_mood,
								pacing: d.pacing,
							};
						});
						scenesRef.current = next;
						return next;
					});
					await persistDirectivesToDb(scenesRef.current, dirMap);
				} catch (err) {
					console.warn(
						"[ai-video] directives lazy 계산 실패 — mood만 사용:",
						(err as Error).message,
					);
				}
			}

			let prevVideoUrl: string | undefined;
			let processed = 0;
			for (let i = 0; i < scenesRef.current.length; i++) {
				const scene = scenesRef.current[i];
				if (scene.scene_type === "text_emphasis") continue;
				processed++;
				setAiVideoBatch({ current: processed, total: eligible });
				const url = await generateAiVideo(i, {
					chainFromVideoUrl: prevVideoUrl,
				});
				if (url) prevVideoUrl = url;
			}
		} finally {
			setAiVideoBatch(null);
			setGenerating(false);
		}
	}

	async function generateTts(sceneIndex: number, retryCount = 0) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { ttsStatus: "generating", errorMsg: undefined });

		try {
			const { url, duration } = await aiGenerateTts(
				scene.id,
				scene.narration_text,
				effectiveTtsOptions,
			);
			updateScene(sceneIndex, {
				ttsStatus: "complete",
				audioUrl: url,
				duration_seconds: duration,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";

			// 자가 복구: 최대 2회 자동 재시도
			if (retryCount < 2) {
				const delay = msg.includes("429") ? 15000 : 3000;
				updateScene(sceneIndex, {
					errorMsg: `TTS 자동 복구 중 (${retryCount + 1}/2)...`,
				});
				await new Promise((r) => setTimeout(r, delay));
				return generateTts(sceneIndex, retryCount + 1);
			}

			updateScene(sceneIndex, { ttsStatus: "error", errorMsg: msg });
		}
	}

	async function handleGenerateNarration() {
		setNarrationStatus("generating");
		setNarrationError("");
		try {
			const sceneData = scenesRef.current.map((s) => ({
				id: s.id,
				narration_text: s.narration_text,
			}));
			const { sceneDurations } = await generateContinuousNarration(
				scriptId,
				sceneData,
				effectiveTtsOptions,
			);
			// 씬 duration 업데이트 + TTS 상태 완료 처리
			setScenes((prev) =>
				prev.map((s, i) => ({
					...s,
					duration_seconds: sceneDurations[i] ?? s.duration_seconds,
					ttsStatus: "complete" as MediaStatus,
				})),
			);
			setNarrationStatus("complete");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setNarrationError(msg);
			setNarrationStatus("error");
		}
	}

	async function handleGenerateAll() {
		setGenerating(true);
		resetUsedVideoIds();

		// 스크립트 → 채널 언어 + 리서치 키워드 조회
		let locale: "ko" | "en" = "ko";
		let researchKeywords: string[] = [];
		let visualPlan: Awaited<ReturnType<typeof planSceneVisuals>> | null = null;
		let directivePlan: SceneDirective[] | null = null;
		let contentJson: Record<string, unknown> = scriptContentJsonRef.current;
		let animationManifest: AnimationAssetManifest | null = null;
		try {
			const { data: scriptData } = await supabase
				.from("scripts")
				.select("*, content_json, briefs(*, topics(title, channels(language)))")
				.eq("id", scriptId)
				.maybeSingle();
			const sd = scriptData as Record<string, unknown> | null;
			const briefs = sd?.briefs as Record<string, unknown> | undefined;
			const topics = briefs?.topics as Record<string, unknown> | undefined;
			const channels = topics?.channels as Record<string, string> | undefined;
			const topicTitle = (topics?.title as string) ?? "";
			locale = channels?.language === "en" ? "en" : "ko";
			contentJson =
				(sd?.content_json as Record<string, unknown> | undefined) ??
				scriptContentJsonRef.current;
			scriptContentJsonRef.current = contentJson;
			const rawProductionType = contentJson?.production_type;
			const currentProductionType: ProductionType =
				rawProductionType === "animation"
					? "animation"
					: rawProductionType === "documentary"
						? "documentary"
						: productionType;
			setProductionType(currentProductionType);
			researchKeywords = Array.isArray(contentJson?.search_keywords)
				? (contentJson.search_keywords as string[])
				: [];

			if (currentProductionType === "animation") {
				animationManifest = await ensureAnimationAssetManifest(contentJson);
				if (animationManifest) {
					await applyAnimationContinuityToAllScenes(animationManifest);
					contentJson = scriptContentJsonRef.current;
				}
			}

			if (topicTitle && currentProductionType !== "animation") {
				// Scene Director: 씬별 최적 검색쿼리 생성
				visualPlan = await planSceneVisuals(
					scenesRef.current.map((s) => ({
						narration: s.narration_text,
						type: s.scene_type,
						sourceTitle: s.news_title,
						sourceDate: s.news_date,
					})),
					topicTitle,
					researchKeywords,
				);

				// Scene Director: 샷/카메라무브/BGM 무드 배정 (brief 있을 때만)
				if (contentJson?.summary) {
					const brief: ResearchBrief = {
						summary: (contentJson.summary as string) ?? "",
						timeline: (contentJson.timeline as ResearchBrief["timeline"]) ?? [],
						key_figures:
							(contentJson.key_figures as ResearchBrief["key_figures"]) ?? [],
						facts: (contentJson.facts as string[]) ?? [],
						misconceptions: (contentJson.misconceptions as string[]) ?? [],
						search_keywords: researchKeywords,
					};
					try {
						directivePlan = await planSceneDirectives(
							scenesRef.current.map((s, i) => ({
								narration: s.narration_text,
								type: s.scene_type,
								index: i,
							})),
							brief,
							topicTitle,
						);
					} catch {
						// 촬영 지시 실패해도 기본값으로 진행
					}
				}
			}
		} catch {
			// Scene Director 실패해도 기본 쿼리로 진행
		}

		// Scene Director 검색쿼리 + 촬영 지시 + locale → 즉시 반영용 패치맵 + state 업데이트
		const planMap = new Map(
			(visualPlan?.scenes ?? []).map((p) => [p.index - 1, p]),
		);
		const directiveMap = new Map(
			(directivePlan ?? []).map((d) => [d.index, d]),
		);
		const patchMap = new Map<number, Partial<SceneWithMedia>>();
		for (const [idx, plan] of planMap) {
			if (idx >= 0 && idx < scenes.length) {
				const directive = directiveMap.get(idx);
				patchMap.set(idx, {
					searchQueryKo: plan.search_query_ko,
					searchQueryEn: plan.search_query_en,
					locale,
					...(directive
						? {
								camera_motion: directive.camera_motion,
								bgm_mood: directive.bgm_mood,
								pacing: directive.pacing,
								shot_type: directive.shot_type,
							}
						: {}),
				});
			}
		}
		for (let i = 0; i < scenes.length; i++) {
			if (!patchMap.has(i)) {
				const directive = directiveMap.get(i);
				patchMap.set(i, {
					locale,
					...(directive
						? {
								camera_motion: directive.camera_motion,
								bgm_mood: directive.bgm_mood,
								pacing: directive.pacing,
								shot_type: directive.shot_type,
							}
						: {}),
				});
			}
		}
		// state + ref를 한 번에 동기 반영
		setScenes(() => {
			const next = scenesRef.current.map((s, i) => ({
				...s,
				...(patchMap.get(i) ?? {}),
			}));
			scenesRef.current = next;
			return next;
		});

		// directives DB 영속화 (페이지 리로드 후 재계산 비용 절약)
		await persistDirectivesToDb(scenesRef.current, directiveMap);

		const existingBgm =
			localStorage.getItem(`bgm_path_${scriptId}`) ??
			localStorage.getItem(`bgm_url_${scriptId}`);
		if (!existingBgm) {
			try {
				const bgmPreset =
					referencePreset?.bgm ??
					inferAutoBgmPreset(
						scenesRef.current.map((scene) => ({
							mood: scene.mood,
							durationSeconds: Number(scene.duration_seconds),
							sceneType: scene.scene_type,
						})),
					);
				const bgmResult = await autoPickBgm(scriptId, bgmPreset);
				if (bgmResult) {
					localStorage.setItem(`bgm_url_${scriptId}`, bgmResult.url);
					setBgmAutoPicked(bgmResult.source);
				}
			} catch (error) {
				console.warn("BGM auto-pick failed during generation:", error);
			}
		}

		// 이미지/영상 생성 (동시 3씬, patchMap으로 최신 값 보장)
		const CONCURRENCY = 3;
		const pending: Array<{ idx: number; tasks: Promise<void>[] }> = [];
		for (let i = 0; i < scenesRef.current.length; i++) {
			const s = { ...scenesRef.current[i], ...(patchMap.get(i) ?? {}) };
			const tasks: Promise<void>[] = [];
			if (s.imageStatus === "pending") tasks.push(generateImage(i));
			if (s.videoStatus === "pending") tasks.push(generateVideo(i));
			if (tasks.length > 0) pending.push({ idx: i, tasks });
		}
		for (let i = 0; i < pending.length; i += CONCURRENCY) {
			const batch = pending.slice(i, i + CONCURRENCY);
			await Promise.all(batch.flatMap((b) => b.tasks));
		}

		for (let i = 0; i < scenesRef.current.length; i++) {
			await repairWeakSceneShots(i);
		}

		await persistAnimationQualityReport(
			scriptContentJsonRef.current,
			animationManifest ?? animationAssetManifestRef.current,
		);

		// 연속 나레이션 생성
		if (narrationStatus !== "complete") {
			await handleGenerateNarration();
		}

		setGenerating(false);

		// QC Director: 품질 검증 (functional state update로 최신 state 보장)
		setScenes((latest) => {
			const qc = verifySceneQuality(latest);
			if (!qc.passed) {
				return latest.map((s, i) => {
					const issue = qc.issues.find(
						(iss) => iss.scene_index === i + 1 && iss.severity === "critical",
					);
					return issue ? { ...s, errorMsg: issue.message } : s;
				});
			}
			return latest;
		});
	}

	async function handleRunAnimationQc() {
		setGenerating(true);
		try {
			const manifest = await ensureAnimationAssetManifest(
				scriptContentJsonRef.current,
			);
			if (manifest) {
				await applyAnimationContinuityToAllScenes(manifest);
			}
			await persistAnimationQualityReport(
				scriptContentJsonRef.current,
				manifest ?? animationAssetManifestRef.current,
			);
		} finally {
			setGenerating(false);
		}
	}

	if (loading) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg text-center py-fluid-lg">
				<PSpinner size="medium" />
			</div>
		);
	}

	const isDone = (st: MediaStatus) => st === "complete" || st === "not_needed";
	const allComplete =
		narrationStatus === "complete" &&
		scenes.every((s) => isDone(s.imageStatus) && isDone(s.videoStatus));
	const animationQcReady =
		productionType !== "animation" || animationQcReport?.passed === true;
	const canProceed = allComplete && animationQcReady;
	const imageCount = scenes.filter((s) => isDone(s.imageStatus)).length;
	const videoRequiredCount = scenes.filter(
		(s) => s.scene_type === "video" || getVideoShots(s).length > 0,
	).length;
	const videoCount = scenes.filter(
		(s) =>
			(s.scene_type === "video" || getVideoShots(s).length > 0) &&
			isDone(s.videoStatus),
	).length;
	const totalDuration = scenes.reduce(
		(sum, s) => sum + Number(s.duration_seconds),
		0,
	);

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<PHeading size="medium" tag="h2" className="mb-static-sm">
				4단계: 미디어 생성
			</PHeading>
			<PText size="small" color="contrast-medium" className="mb-static-md">
				각 씬의 AI 이미지와 나레이션 음성을 생성합니다.
			</PText>

			<div className="flex items-center gap-static-md mb-static-lg flex-wrap">
				<PText size="small">{scenes.length}개 씬</PText>
				<PText size="small" color="contrast-medium">
					총 {Math.round(totalDuration)}초
				</PText>
				<PText size="small" color="contrast-medium">
					이미지 {imageCount}/{scenes.length}
				</PText>
				{videoRequiredCount > 0 && (
					<PText size="small" color="contrast-medium">
						영상 {videoCount}/{videoRequiredCount}
					</PText>
				)}
				{narrationStatus === "complete" ? (
					<PTag color="notification-success-soft">연속 나레이션 완료</PTag>
				) : narrationStatus === "generating" ? (
					<PTag color="notification-info-soft">나레이션 생성중...</PTag>
				) : (
					<PText size="small" color="contrast-medium">
						나레이션 대기
					</PText>
				)}
				{!generating && !allComplete && (
					<PButton compact onClick={handleGenerateAll}>
						미디어 일괄 생성
					</PButton>
				)}
				{!generating &&
					allComplete &&
					productionType === "animation" &&
					!animationQcReady && (
						<PButton compact variant="secondary" onClick={handleRunAnimationQc}>
							애니 QC 실행
						</PButton>
					)}
				{!generating &&
					narrationStatus !== "complete" &&
					narrationStatus !== "generating" && (
						<PButton
							compact
							variant="secondary"
							onClick={handleGenerateNarration}
						>
							나레이션만 생성
						</PButton>
					)}
				{allComplete && (
					<PTag color="notification-success-soft">모든 미디어 생성 완료</PTag>
				)}
				{productionType === "animation" && animationReferenceSheetPath && (
					<PTag color="notification-info-soft">캐릭터 시트 연결</PTag>
				)}
				{productionType === "animation" && animationQcReport && (
					<PTag
						color={
							animationQcReport.passed
								? "notification-success-soft"
								: "notification-warning-soft"
						}
					>
						애니 QC {animationQcReport.score}/100
					</PTag>
				)}
			</div>

			<div className="flex items-center gap-static-sm mb-static-md flex-wrap p-static-sm bg-canvas rounded-[4px] border border-[var(--p-color-state-base)]">
				<PText size="small" color="contrast-high">
					✂️ 편집 우선 제작
				</PText>
				<PText size="x-small" color="contrast-medium">
					외부 영상/뉴스/이미지/문서 자료를 샷 단위로 재구성하고, 컷
					리듬·줌·자막·SFX·BGM으로 완성합니다. AI 영상 모델은 필요할 때만 쓰는
					선택 보강입니다.
				</PText>
			</div>

			{aiVideoAvailable && (
				<div className="flex items-center gap-static-sm mb-static-md flex-wrap p-static-sm bg-canvas rounded-[4px]">
					<PText size="small" color="contrast-high">
						🎬 선택 보강: AI 영상 모델
					</PText>
					<select
						className="bg-surface text-[12px] rounded-[4px] px-static-xs py-[4px] border border-[var(--p-color-state-base)]"
						value={aiVideoProvider}
						onChange={(e) => {
							const next = e.target.value as VideoGenProvider;
							setAiVideoProvider(next);
							setActiveVideoProvider(next);
						}}
					>
						<option value="kling3">Kling 3.0 (고품질 · 최종 권장)</option>
						<option value="wan26">Wan 2.6 (가성비 · 빠른 미리보기)</option>
						<option value="ltx2">LTX-2 (빠름)</option>
						<option value="hailuo">Hailuo (T2V + 카메라)</option>
						<option value="klingO1">Kling O1 (보간)</option>
					</select>
					<PText size="x-small" color="contrast-medium">
						씬당 약 ${VIDEO_COST_PER_SCENE[aiVideoProvider].toFixed(2)} · 총 ~$
						{(VIDEO_COST_PER_SCENE[aiVideoProvider] * scenes.length).toFixed(2)}
					</PText>
					{!generating && (
						<PButton
							compact
							variant="secondary"
							onClick={handleGenerateAllAiVideos}
						>
							🎬 선택: 모든 씬 AI 영상화
						</PButton>
					)}
					{aiVideoBatch && (
						<PTag color="notification-info-soft">
							일괄 생성중 {aiVideoBatch.current}/{aiVideoBatch.total}
						</PTag>
					)}
					<PText size="x-small" color="contrast-low">
						{scriptFormat === "shorts" ? "9:16 세로" : "16:9 가로"} · 시드 잠금
						· 마지막 프레임 체이닝
					</PText>
				</div>
			)}

			{narrationError && (
				<PInlineNotification
					state="error"
					dismissButton={false}
					className="mb-static-md"
				>
					나레이션 생성 실패: {narrationError}
				</PInlineNotification>
			)}

			{generating && (
				<PInlineNotification
					state="info"
					dismissButton={false}
					className="mb-static-md"
				>
					AI 이미지와 음성을 생성하고 있습니다. 씬당 약 15-20초가 소요됩니다...
				</PInlineNotification>
			)}

			{productionType === "animation" && animationQcReport && (
				<div className="mb-static-md bg-canvas rounded-[4px] p-static-sm">
					<div className="flex items-center gap-static-xs flex-wrap mb-static-xs">
						<PTag
							color={
								animationQcReport.passed
									? "notification-success-soft"
									: "notification-warning-soft"
							}
						>
							애니메이션 QC {animationQcReport.score}/100
						</PTag>
						<PTag color="background-surface">
							연속성{" "}
							{Math.round(
								animationQcReport.metrics.continuityTaggedRatio * 100,
							)}
							%
						</PTag>
						<PTag color="background-surface">
							모션{" "}
							{Math.round(animationQcReport.metrics.motionCoverageRatio * 100)}%
						</PTag>
						<PTag color="background-surface">
							에셋{" "}
							{Math.round(animationQcReport.metrics.sourceResolvedRatio * 100)}%
						</PTag>
						<PTag color="background-surface">
							리깅{" "}
							{Math.round(animationQcReport.metrics.rigCoverageRatio * 100)}%
						</PTag>
						<PTag color="background-surface">
							SFX{" "}
							{Math.round(animationQcReport.metrics.sfxCueCoverageRatio * 100)}%
						</PTag>
					</div>
					{!animationQcReport.passed && (
						<ul className="list-disc pl-4 text-[12px] text-contrast-medium">
							{animationQcReport.requiredActions.slice(0, 3).map((action) => (
								<li key={action}>{action}</li>
							))}
						</ul>
					)}
				</div>
			)}

			<div className="flex flex-col gap-static-sm">
				{scenes.map((scene, i) => (
					<div
						key={scene.id}
						className="bg-canvas rounded-[4px] overflow-hidden"
					>
						<div className="p-static-md flex items-start gap-static-md">
							<div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-[12px] font-semibold shrink-0 mt-1">
								{i + 1}
							</div>

							{(scene.videoUrl || scene.imageUrl) && (
								<div className="w-32 h-20 rounded-[4px] overflow-hidden shrink-0">
									{scene.videoUrl ? (
										<video
											src={scene.videoUrl}
											className="w-full h-full object-cover"
											muted
											playsInline
											controls
										/>
									) : (
										<img
											src={scene.imageUrl}
											alt={`씬 ${i + 1}`}
											className="w-full h-full object-cover"
										/>
									)}
								</div>
							)}

							<div className="flex-1 min-w-0">
								<PText size="small" ellipsis>
									{scene.narration_text}
								</PText>
								<div className="flex items-center gap-static-xs mt-static-xs flex-wrap">
									<PTag
										color={
											scene.scene_type === "news_overlay"
												? "notification-error-soft"
												: scene.scene_type === "video"
													? "notification-info-soft"
													: "background-surface"
										}
									>
										{scene.scene_type === "news_overlay"
											? "뉴스"
											: scene.scene_type === "video"
												? "영상"
												: scene.scene_type === "text_emphasis"
													? "텍스트"
													: "이미지"}
									</PTag>
									<PText size="x-small" color="contrast-medium">
										{scene.duration_seconds}초
									</PText>
									{/* Image status */}
									{scene.imageStatus === "complete" && (
										<PTag color="notification-success-soft">
											{scene.sourceUrl?.startsWith("http")
												? "수집자료"
												: "이미지"}
										</PTag>
									)}
									{scene.imageStatus === "generating" && (
										<PTag color="notification-info-soft">
											{scene.sourceUrl?.startsWith("http")
												? "자료 다운로드중"
												: "이미지 생성중"}
										</PTag>
									)}
									{scene.videoStatus === "complete" && (
										<PTag color="notification-success-soft">영상</PTag>
									)}
									{scene.videoStatus === "generating" && (
										<PTag color="notification-info-soft">영상 다운로드중</PTag>
									)}
									{scene.ttsStatus === "complete" && (
										<PTag color="notification-success-soft">음성</PTag>
									)}
									{scene.ttsStatus === "generating" && (
										<PTag color="notification-info-soft">음성 생성중</PTag>
									)}
								</div>
								{scene.errorMsg && (
									<PText
										size="x-small"
										color="notification-error"
										className="mt-static-xs"
									>
										{scene.errorMsg}
									</PText>
								)}
								<div className="mt-static-sm rounded-[4px] border border-[var(--p-color-state-base)] bg-surface p-static-sm">
									<div className="flex items-center gap-static-xs flex-wrap">
										<PText size="x-small" color="contrast-high">
											실제 영상 삽입
										</PText>
										<PTag color="background-surface">
											{getVideoShots(scene).length > 0
												? "비디오 샷 연결"
												: "새 비디오 샷 생성"}
										</PTag>
										{scene.videoUrl && (
											<PTag color="notification-success-soft">적용됨</PTag>
										)}
									</div>
									<div className="mt-static-xs flex gap-static-xs flex-wrap items-center">
										<input
											type="file"
											accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
											disabled={manualVideoBusy[scene.id] || generating}
											className="max-w-[260px] text-[12px] text-contrast-medium file:mr-static-xs file:rounded-[4px] file:border-0 file:bg-canvas file:px-static-sm file:py-[6px] file:text-[12px] file:font-semibold"
											onChange={(event) => {
												const file = event.currentTarget.files?.[0];
												event.currentTarget.value = "";
												void handleInsertVideoFile(i, file);
											}}
										/>
										<input
											type="url"
											placeholder="YouTube 또는 mp4/webm/mov URL"
											value={manualVideoUrls[scene.id] ?? ""}
											disabled={manualVideoBusy[scene.id] || generating}
											className="min-w-[220px] flex-1 rounded-[4px] border border-[var(--p-color-state-base)] bg-canvas px-static-sm py-[7px] text-[12px] text-contrast-high outline-none"
											onChange={(event) =>
												setManualVideoUrls((prev) => ({
													...prev,
													[scene.id]: event.currentTarget.value,
												}))
											}
										/>
										<PButton
											compact
											variant="secondary"
											disabled={
												manualVideoBusy[scene.id] ||
												generating ||
												!(manualVideoUrls[scene.id] ?? "").trim()
											}
											onClick={() => {
												void handleInsertVideoUrl(i);
											}}
										>
											URL 적용
										</PButton>
										{manualVideoBusy[scene.id] && <PSpinner size="small" />}
									</div>
									<PText
										size="x-small"
										color="contrast-medium"
										className="mt-static-xs"
									>
										삽입된 영상은 이 씬의 중앙 클립 슬롯에 우선 사용됩니다. 렌더
										전에는 렌더 서버 자산으로 자동 미러링됩니다.
									</PText>
								</div>
								{(() => {
									const videoShot = primaryVideoShot(scene);
									if (!videoShot && !scene.videoUrl) return null;
									const trimStart = sanitizeClipSeconds(
										videoShot?.trim_start ?? 0,
										0,
										0,
										3600,
									);
									const clipDuration = sanitizeClipSeconds(
										videoShot?.duration_seconds ??
											Number(scene.duration_seconds || 4),
										4,
										0.8,
										120,
									);
									const selectedCrop = videoShot?.crop ?? "medium";
									return (
										<div className="mt-static-xs rounded-[4px] border border-[var(--p-color-state-base)] bg-surface p-static-sm">
											<div className="flex items-center gap-static-xs flex-wrap mb-static-xs">
												<PText size="x-small" color="contrast-high">
													클립 조절
												</PText>
												<PText size="x-small" color="contrast-medium">
													시작 위치, 사용 길이, 화면 크기
												</PText>
											</div>
											<div className="grid grid-cols-1 md:grid-cols-3 gap-static-xs">
												<label className="text-[11px] text-contrast-medium">
													시작 초
													<input
														type="number"
														min={0}
														step={0.1}
														value={trimStart}
														className="mt-[4px] w-full rounded-[4px] border border-[var(--p-color-state-base)] bg-canvas px-static-sm py-[7px] text-[12px] text-contrast-high"
														onChange={(event) => {
															const nextStart = sanitizeClipSeconds(
																event.currentTarget.valueAsNumber,
																trimStart,
																0,
																3600,
															);
															void updatePrimaryVideoShot(i, {
																trim_start: nextStart,
																trim_end: nextStart + clipDuration,
															});
														}}
													/>
												</label>
												<label className="text-[11px] text-contrast-medium">
													사용 길이 초
													<input
														type="number"
														min={0.8}
														max={120}
														step={0.1}
														value={clipDuration}
														className="mt-[4px] w-full rounded-[4px] border border-[var(--p-color-state-base)] bg-canvas px-static-sm py-[7px] text-[12px] text-contrast-high"
														onChange={(event) => {
															const nextDuration = sanitizeClipSeconds(
																event.currentTarget.valueAsNumber,
																clipDuration,
																0.8,
																120,
															);
															void updatePrimaryVideoShot(i, {
																duration_seconds: nextDuration,
																trim_end: trimStart + nextDuration,
															});
														}}
													/>
												</label>
												<label className="text-[11px] text-contrast-medium">
													화면 크기
													<select
														value={selectedCrop}
														className="mt-[4px] w-full rounded-[4px] border border-[var(--p-color-state-base)] bg-canvas px-static-sm py-[7px] text-[12px] text-contrast-high"
														onChange={(event) => {
															void updatePrimaryVideoShot(i, {
																crop: event.currentTarget.value as NonNullable<
																	SceneShot["crop"]
																>,
															});
														}}
													>
														{VIDEO_CROP_OPTIONS.map((option) => (
															<option key={option.value} value={option.value}>
																{option.label} · {option.description}
															</option>
														))}
													</select>
												</label>
											</div>
										</div>
									);
								})()}
							</div>

							<div className="shrink-0 flex items-center gap-static-xs">
								{aiVideoAvailable &&
									!generating &&
									scene.scene_type !== "text_emphasis" &&
									scene.videoStatus !== "generating" && (
										<PButton
											compact
											variant="tertiary"
											onClick={() => generateAiVideo(i)}
										>
											🎬 AI 영상
										</PButton>
									)}
								{(scene.imageStatus === "pending" ||
									scene.videoStatus === "pending" ||
									scene.ttsStatus === "pending") &&
									!generating && (
										<PButton
											compact
											variant="secondary"
											onClick={() => {
												if (scene.imageStatus === "pending") generateImage(i);
												if (scene.videoStatus === "pending") generateVideo(i);
												if (scene.ttsStatus === "pending") generateTts(i);
											}}
										>
											생성
										</PButton>
									)}
								{(scene.imageStatus === "generating" ||
									scene.videoStatus === "generating" ||
									scene.ttsStatus === "generating") && (
									<PSpinner size="small" />
								)}
								{(scene.imageStatus === "complete" ||
									scene.imageStatus === "not_needed") &&
									scene.ttsStatus === "complete" && (
										<PTag color="notification-success-soft">완료</PTag>
									)}
								{(scene.imageStatus === "error" ||
									scene.videoStatus === "error" ||
									scene.ttsStatus === "error") &&
									!generating && (
										<PButton
											compact
											variant="secondary"
											onClick={() => {
												if (scene.imageStatus === "error") generateImage(i);
												if (scene.videoStatus === "error") generateVideo(i);
												if (scene.ttsStatus === "error") generateTts(i);
											}}
										>
											재시도
										</PButton>
									)}
							</div>
						</div>
					</div>
				))}
			</div>

			<PDivider className="my-static-lg" />

			<div className="flex justify-between">
				<PButton variant="secondary" onClick={onBack}>
					이전
				</PButton>
				<PButton disabled={!canProceed} onClick={onNext}>
					다음: 미리보기
				</PButton>
			</div>
		</div>
	);
}
