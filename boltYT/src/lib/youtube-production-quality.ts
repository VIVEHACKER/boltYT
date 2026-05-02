import { analyzeYouTubePolicyRisk } from "./youtube-policy-risk";
import { analyzeOpeningRetention } from "./youtube-retention";

export type ProductionQualitySeverity = "critical" | "warning" | "info";

export interface ProductionQualityIssue {
	severity: ProductionQualitySeverity;
	code: string;
	message: string;
	sceneIndex?: number;
}

export interface ProductionQualityShot {
	media_type?: "image" | "video";
	source_url?: string;
	duration_seconds?: number;
	visual_role?: string;
	motion?: string;
	overlay?: string;
	source_confidence?: number;
	quality_score?: number;
	dynamic_score?: number;
	dynamic_issues?: string[];
	selection_provider?: string;
	rejection_reason?: string;
	sfx_cue?: { category?: string; intensity?: number };
}

export interface ProductionQualityScene {
	narration?: string;
	narration_text?: string;
	scene_type?: string;
	type?: string;
	duration?: number;
	duration_seconds?: number;
	durationInFrames?: number;
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
	visual_prompt?: string;
	news_title?: string;
	newsTitle?: string;
	news_source?: string;
	newsSource?: string;
	news_date?: string;
	source_url?: string;
	sourceUrl?: string;
	sourceAttribution?: string;
	transition?: string;
	enterSfxFile?: string;
	transitionSfxFile?: string;
	wordTimings?: Array<{ word: string; startFrame: number; endFrame: number }>;
	motionGraphics?: Array<unknown>;
	shots?: ProductionQualityShot[];
}

export interface ProductionQualityInput {
	title?: string;
	description?: string;
	format?: "shorts" | "longform" | "both" | string;
	scenes: ProductionQualityScene[];
	narrationUrl?: string;
	bgmUrl?: string;
	thumbnailPath?: string;
	thumbnailPlanned?: boolean;
}

export interface ProductionQualityReport {
	passed: boolean;
	score: number;
	issues: ProductionQualityIssue[];
	requiredActions: string[];
	metrics: {
		sceneCount: number;
		totalDurationSeconds: number;
		videoSceneRatio: number;
		motionVisualRatio: number;
		sourceAnchorRatio: number;
		lowConfidenceShotRatio: number;
		genericStockShotRatio: number;
		reconstructionShotRatio: number;
		textEmphasisRatio: number;
		designedVisualRatio: number;
		captionSyncRatio: number;
		averageNarrationCharsPerSecond: number;
		averageShotsPerVisualScene: number;
		openingShotCount: number;
		openingDynamicBeatCount: number;
		lowMotionVideoShotRatio: number;
		visualDiversityScore: number;
		motionDiversityScore: number;
		editorialDensityScore: number;
		premiumFloorScore: number;
		hasNarration: boolean;
		hasBgm: boolean;
		hasThumbnail: boolean;
		hasEndingCue: boolean;
	};
}

const ENDING_CUE_PATTERNS = [
	/결국/,
	/정리하면/,
	/여기서 남는/,
	/남은 의문/,
	/현재까지/,
	/확인된 것은/,
	/마지막으로/,
	/여기까지/,
	/다음 단계/,
	/의문은/,
	/남습니다/,
];

const SOURCE_ANCHOR_PROVIDERS = new Set([
	"youtube",
	"wikimedia",
	"naver",
	"direct",
	"direct_url",
	"archive",
	"document",
	"map",
	"news",
	"source_card",
]);

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function typeOf(scene: ProductionQualityScene): string {
	return scene.scene_type ?? scene.type ?? "";
}

function narrationOf(scene: ProductionQualityScene): string {
	return normalizeText(scene.narration_text ?? scene.narration);
}

function durationOf(scene: ProductionQualityScene): number {
	const seconds = Number(scene.duration_seconds ?? scene.duration ?? 0);
	if (Number.isFinite(seconds) && seconds > 0) return seconds;
	const frames = Number(scene.durationInFrames ?? 0);
	return Number.isFinite(frames) && frames > 0 ? frames / 30 : 0;
}

function hasShotSource(shot: ProductionQualityShot): boolean {
	return normalizeText(shot.source_url).length > 0;
}

function hasVisual(scene: ProductionQualityScene): boolean {
	if (typeOf(scene) === "text_emphasis") return true;
	if (normalizeText(scene.imageUrl) || normalizeText(scene.videoUrl)) return true;
	return Boolean(scene.shots?.some(hasShotSource));
}

function hasVideoVisual(scene: ProductionQualityScene): boolean {
	if (normalizeText(scene.videoUrl)) return true;
	return Boolean(
		scene.shots?.some(
			(shot) => (shot.media_type ?? "video") === "video" && hasShotSource(shot),
		),
	);
}

function isReconstruction(shot: ProductionQualityShot): boolean {
	return (
		shot.visual_role === "reconstruction" ||
		shot.selection_provider === "ai" ||
		shot.selection_provider === "generated" ||
		Boolean(shot.rejection_reason)
	);
}

function isSourceCard(shot: ProductionQualityShot): boolean {
	return shot.selection_provider === "source_card";
}

function isSourceAnchored(shot: ProductionQualityShot): boolean {
	if (!hasShotSource(shot) || isReconstruction(shot)) return false;
	if (isSourceCard(shot)) return true;
	if (shot.visual_role === "document" || shot.visual_role === "evidence") {
		return true;
	}
	if (shot.visual_role === "archive" || shot.visual_role === "map") {
		return true;
	}
	return SOURCE_ANCHOR_PROVIDERS.has(shot.selection_provider ?? "");
}

function isGenericStockShot(shot: ProductionQualityShot): boolean {
	return (
		(shot.selection_provider === "pexels" ||
			shot.selection_provider === "pixabay") &&
		shot.visual_role !== "context" &&
		shot.visual_role !== "transition"
	);
}

function isDesignedShot(shot: ProductionQualityShot): boolean {
	if (isSourceCard(shot)) return true;
	if (shot.visual_role === "document" || shot.visual_role === "evidence") {
		return true;
	}
	if (shot.visual_role === "map" || shot.visual_role === "data") return true;
	if (shot.visual_role === "archive") return true;
	if (hasShotSource(shot) && shot.motion && shot.motion !== "static") return true;
	return false;
}

function hasDesignedVisual(scene: ProductionQualityScene): boolean {
	if (hasVideoVisual(scene)) return true;
	if ((scene.motionGraphics?.length ?? 0) > 0) return true;
	return Boolean(scene.shots?.some(isDesignedShot));
}

function hasMotion(scene: ProductionQualityScene): boolean {
	if (hasVideoVisual(scene)) return true;
	if ((scene.motionGraphics?.length ?? 0) > 0) return true;
	return Boolean(
		scene.shots?.some((shot) => shot.motion && shot.motion !== "static"),
	);
}

function hasEndingCue(scene: ProductionQualityScene): boolean {
	const narration = narrationOf(scene);
	return ENDING_CUE_PATTERNS.some((pattern) => pattern.test(narration));
}

function buildIssue(
	severity: ProductionQualitySeverity,
	code: string,
	message: string,
	sceneIndex?: number,
): ProductionQualityIssue {
	return sceneIndex
		? { severity, code, message, sceneIndex }
		: { severity, code, message };
}

function pushAction(actions: string[], action: string) {
	if (!actions.includes(action)) actions.push(action);
}

function ratio(value: number, max: number): number {
	if (max <= 0 || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value / max));
}

function diversityScore(values: string[], targetUnique: number): number {
	const normalized = values.map(normalizeText).filter(Boolean);
	if (normalized.length === 0) return 0;
	const uniqueCount = new Set(normalized).size;
	return Math.round(ratio(uniqueCount, targetUnique) * 100);
}

function mostCommonRatio(values: string[]): number {
	const normalized = values.map(normalizeText).filter(Boolean);
	if (normalized.length === 0) return 0;
	const counts = new Map<string, number>();
	for (const value of normalized) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return Math.max(...counts.values()) / normalized.length;
}

function hasShotRhythmCue(shot: ProductionQualityShot): boolean {
	const category = shot.sfx_cue?.category;
	return Boolean(category && category !== "none" && (shot.sfx_cue?.intensity ?? 0) >= 0.35);
}

function isVideoShot(shot: ProductionQualityShot): boolean {
	return (shot.media_type ?? "video") === "video" && hasShotSource(shot);
}

function isLowMotionVideoShot(shot: ProductionQualityShot): boolean {
	if (!isVideoShot(shot)) return false;
	if ((shot.dynamic_issues ?? []).includes("low_motion_video")) return true;
	if ((shot.dynamic_issues ?? []).includes("no_meaningful_frame_change")) {
		return true;
	}
	return typeof shot.dynamic_score === "number" && shot.dynamic_score < 22;
}

function openingVisualDensity(
	scenes: ProductionQualityScene[],
	windowSeconds: number,
): { openingShotCount: number; openingDynamicBeatCount: number } {
	let cursor = 0;
	let openingShotCount = 0;
	let openingDynamicBeatCount = 0;

	for (const scene of scenes) {
		const duration = durationOf(scene);
		if (cursor >= windowSeconds) break;
		if (typeOf(scene) === "text_emphasis") {
			cursor += duration;
			continue;
		}

		const remaining = Math.max(0, windowSeconds - cursor);
		const sceneWindow = Math.min(duration || remaining, remaining);
		const shots = scene.shots ?? [];
		if (shots.length === 0) {
			if (hasVisual(scene)) {
				openingShotCount += 1;
				if (hasMotion(scene) || hasVideoVisual(scene)) openingDynamicBeatCount += 1;
			}
			cursor += duration;
			continue;
		}

		let shotCursor = 0;
		for (const shot of shots) {
			if (shotCursor >= sceneWindow) break;
			if (!hasShotSource(shot)) {
				shotCursor += Math.max(0.8, shot.duration_seconds ?? 1.8);
				continue;
			}
			openingShotCount += 1;
			const dynamic =
				(isVideoShot(shot) && !isLowMotionVideoShot(shot)) ||
				(Boolean(shot.motion) && shot.motion !== "static") ||
				hasShotRhythmCue(shot);
			if (dynamic) openingDynamicBeatCount += 1;
			shotCursor += Math.max(0.8, shot.duration_seconds ?? 1.8);
		}
		cursor += duration;
	}

	return { openingShotCount, openingDynamicBeatCount };
}

function hasSceneRhythmCue(scene: ProductionQualityScene): boolean {
	const transition = normalizeText(scene.transition);
	return Boolean(
		normalizeText(scene.enterSfxFile) ||
			normalizeText(scene.transitionSfxFile) ||
			(transition && transition !== "none" && transition !== "crossfade"),
	);
}

export function analyzeProductionQuality(
	input: ProductionQualityInput,
): ProductionQualityReport {
	const issues: ProductionQualityIssue[] = [];
	const actions: string[] = [];
	const scenes = input.scenes;
	const isShorts = input.format === "shorts";
	const isLongform = input.format === "longform";

	if (scenes.length === 0) {
		issues.push(
			buildIssue(
				"critical",
				"no_scenes",
				"승인할 씬이 없습니다. 스크립트와 미디어를 먼저 생성해야 합니다.",
			),
		);
		pushAction(actions, "씬 생성 단계로 돌아가 스크립트와 미디어를 다시 생성하세요.");
	}

	const totalDurationSeconds = scenes.reduce(
		(sum, scene) => sum + durationOf(scene),
		0,
	);
	const visualScenes = scenes.filter((scene) => typeOf(scene) !== "text_emphasis");
	const videoScenes = visualScenes.filter(hasVideoVisual);
	const motionScenes = visualScenes.filter(hasMotion);
	const designedVisualScenes = visualScenes.filter(hasDesignedVisual);
	const textScenes = scenes.filter((scene) => typeOf(scene) === "text_emphasis");
	const narrationScenes = scenes.filter((scene) => narrationOf(scene).length > 0);
	const wordTimedScenes = narrationScenes.filter(
		(scene) => (scene.wordTimings?.length ?? 0) > 0,
	);
	const allShots = scenes.flatMap((scene) => scene.shots ?? []);
	const resolvedShots = allShots.filter(hasShotSource);
	const anchoredShots = allShots.filter(isSourceAnchored);
	const lowConfidenceShots = resolvedShots.filter(
		(shot) =>
			!isSourceCard(shot) &&
			((typeof shot.source_confidence === "number" &&
				shot.source_confidence < 55) ||
				(typeof shot.quality_score === "number" && shot.quality_score < 55)),
	);
	const veryWeakShots = resolvedShots.filter(
		(shot) =>
			!isSourceCard(shot) &&
			shot.visual_role !== "context" &&
			shot.visual_role !== "transition" &&
			((typeof shot.source_confidence === "number" &&
				shot.source_confidence < 40) ||
				(typeof shot.quality_score === "number" && shot.quality_score < 40)),
	);
	const genericStockShots = resolvedShots.filter(isGenericStockShot);
	const reconstructionShots = allShots.filter(isReconstruction);
	const videoShots = resolvedShots.filter(isVideoShot);
	const lowMotionVideoShots = videoShots.filter(isLowMotionVideoShot);
	const { openingShotCount, openingDynamicBeatCount } = openingVisualDensity(
		scenes,
		isShorts ? 8 : 12,
	);
	const motionValues = allShots
		.map((shot) => normalizeText(shot.motion))
		.filter(Boolean);
	const visualValues = allShots
		.map((shot) =>
			normalizeText(`${shot.media_type ?? "visual"}:${shot.visual_role ?? "unknown"}`),
		)
		.filter(Boolean);
	const averageShotsPerVisualScene =
		visualScenes.length > 0 ? allShots.length / visualScenes.length : 0;
	const visualDiversityScore = diversityScore(visualValues, 4);
	const motionDiversityScore = diversityScore(motionValues, 4);
	const motionMonotonyRatio = mostCommonRatio(motionValues);
	const shotRhythmCueRatio =
		allShots.length > 0
			? allShots.filter(hasShotRhythmCue).length / allShots.length
			: 0;
	const sceneRhythmCueRatio =
		visualScenes.length > 0
			? visualScenes.filter(hasSceneRhythmCue).length / visualScenes.length
			: 0;
	const motionGraphicRatio =
		visualScenes.length > 0
			? visualScenes.filter((scene) => (scene.motionGraphics?.length ?? 0) > 0).length /
				visualScenes.length
			: 0;
	const hasNarration =
		narrationScenes.length > 0 &&
		(Boolean(normalizeText(input.narrationUrl)) ||
			narrationScenes.every((scene) => normalizeText(scene.audioUrl)));
	const hasBgm = Boolean(normalizeText(input.bgmUrl));
	const hasThumbnail =
		Boolean(normalizeText(input.thumbnailPath)) || Boolean(input.thumbnailPlanned);
	const lastScene = scenes[scenes.length - 1];
	const endingCue = lastScene ? hasEndingCue(lastScene) : false;
	const narrationChars = narrationScenes.reduce(
		(sum, scene) => sum + narrationOf(scene).length,
		0,
	);
	const averageNarrationCharsPerSecond =
		totalDurationSeconds > 0 ? narrationChars / totalDurationSeconds : 0;

	scenes.forEach((scene, index) => {
		const sceneIndex = index + 1;
		const duration = durationOf(scene);
		if (!hasVisual(scene)) {
			issues.push(
				buildIssue(
					"critical",
					"missing_visual",
					`씬 ${sceneIndex}: 실제 이미지/영상/샷 소스가 없어 검은 화면 또는 빈 배경으로 렌더될 수 있습니다.`,
					sceneIndex,
				),
			);
			pushAction(
				actions,
				"빈 비주얼 씬은 자료 재검색, 문서/지도/source card, 이미지·영상 멀티컷으로 먼저 보강하세요. AI 영상은 선택 보강으로만 쓰세요.",
			);
		}
		if (typeOf(scene) === "video" && !hasVideoVisual(scene)) {
			issues.push(
				buildIssue(
					"critical",
					"video_scene_without_video",
					`씬 ${sceneIndex}: video 씬이지만 실제 영상 소스가 없어 이미지 슬라이드처럼 보입니다.`,
					sceneIndex,
				),
			);
			pushAction(
				actions,
				"video 씬은 직접 영상 URL 또는 검색 영상으로 먼저 연결하고, 실패 시 문서/이미지 멀티컷으로 대체하세요.",
			);
		}
		const sceneVideoShots = (scene.shots ?? []).filter(isVideoShot);
		if (
			sceneVideoShots.length > 0 &&
			sceneVideoShots.every(isLowMotionVideoShot)
		) {
			issues.push(
				buildIssue(
					"critical",
					"low_motion_video_scene",
					`씬 ${sceneIndex}: 영상 샷이 있지만 실제 프레임 변화량이 낮아 정지 이미지처럼 보입니다.`,
					sceneIndex,
				),
			);
			pushAction(
				actions,
				"저동작 영상은 다른 원본 영상으로 재검색하거나 문서/지도/source card/이미지 멀티컷으로 교체하세요.",
			);
		}
		if (
			typeOf(scene) !== "text_emphasis" &&
			hasVisual(scene) &&
			!hasVideoVisual(scene) &&
			!hasDesignedVisual(scene)
		) {
			issues.push(
				buildIssue(
					"critical",
					"weak_visual_scene",
					`씬 ${sceneIndex}: 화면 설계가 약해 전체 영상 중 이 씬만 품질이 크게 떨어질 수 있습니다.`,
					sceneIndex,
				),
			);
			pushAction(
				actions,
				"약한 씬은 영상 컷, 문서/지도/source card, 콜아웃, 모션 그래픽 중 하나로 반드시 보강하세요.",
			);
		}
		if (
			typeOf(scene) !== "text_emphasis" &&
			!hasVideoVisual(scene) &&
			duration >= (isShorts ? 5 : 8) &&
			(scene.shots?.length ?? 0) <= 1 &&
			(scene.motionGraphics?.length ?? 0) === 0
		) {
			const severity: ProductionQualitySeverity =
				duration >= (isShorts ? 7 : 12) ? "critical" : "warning";
			issues.push(
				buildIssue(
					severity,
					"single_long_still_scene",
					`씬 ${sceneIndex}: 긴 정지 이미지 구간이 있어 유명 채널 대비 편집 밀도가 떨어질 수 있습니다.`,
					sceneIndex,
				),
			);
			pushAction(
				actions,
				"긴 이미지 씬은 최소 2-3개 샷, 문서 하이라이트, 지도/콜아웃, 또는 짧은 영상 컷으로 분할하세요.",
			);
		}
		if (duration > 0 && narrationOf(scene).length / duration > 8.5) {
			issues.push(
				buildIssue(
					"warning",
					"dense_narration",
					`씬 ${sceneIndex}: 나레이션 밀도가 높아 TTS와 자막이 급하게 들릴 수 있습니다.`,
					sceneIndex,
				),
			);
			pushAction(actions, "긴 문장은 두 씬으로 나누거나 문장을 짧게 줄이세요.");
		}
	});

	if (!hasNarration) {
		issues.push(
			buildIssue(
				"critical",
				"missing_narration",
				"연속 나레이션 또는 씬별 TTS가 없습니다. 유명 쇼츠/롱폼 수준의 완성 영상으로 승인할 수 없습니다.",
			),
		);
		pushAction(actions, "TTS를 다시 생성하고 나레이션 URL이 복원되는지 확인하세요.");
	}

	if (!hasBgm) {
		issues.push(
			buildIssue(
				"critical",
				"missing_bgm",
				"BGM이 없습니다. 영상이 이미지 나열처럼 느껴지는 가장 큰 병목입니다.",
			),
		);
		pushAction(actions, "BGM 자동 선택 또는 사용자 기본 BGM을 설정하세요.");
	}

	if (!hasThumbnail) {
		issues.push(
			buildIssue(
				"critical",
				"missing_thumbnail_plan",
				"썸네일 계획 또는 생성 결과가 없습니다. 업로드 품질 기준을 통과할 수 없습니다.",
			),
		);
		pushAction(actions, "제목과 첫 장면에 맞는 썸네일을 먼저 생성하세요.");
	}

	if (visualScenes.length >= 3 && videoScenes.length === 0) {
		issues.push(
			buildIssue(
				"info",
				"no_video_visuals",
				"실제 영상 컷이 없습니다. 통짜 AI 영상 없이 제작하려면 모션 자료화면/지도/문서 편집 밀도가 충분해야 합니다.",
			),
		);
		pushAction(actions, "AI 영상 대신 자료화면을 push-in, pan, 지도/문서/콜아웃으로 설계하세요.");
	}

	const targetVideoRatio = isShorts ? 0.18 : 0.08;
	if (
		visualScenes.length > 0 &&
		videoScenes.length / visualScenes.length < targetVideoRatio
	) {
		issues.push(
			buildIssue(
				"info",
				"low_video_ratio",
				`실제 영상 컷 비율이 ${Math.round(targetVideoRatio * 100)}%보다 낮습니다. 비용 절감 모드에서는 허용하되 모션 자료화면 밀도를 대신 봅니다.`,
			),
		);
		pushAction(actions, "AI 영상은 훅/반전/엔딩 같은 hero shot에만 선택적으로 사용하세요.");
	}

	if (
		videoShots.length > 0 &&
		lowMotionVideoShots.length / videoShots.length > 0.34
	) {
		issues.push(
			buildIssue(
				"critical",
				"high_low_motion_video_ratio",
				"영상 컷 중 저동작 소스 비율이 높습니다. 실제 렌더에서는 영상이 아니라 정지 이미지 나열처럼 보일 가능성이 큽니다.",
			),
		);
		pushAction(
			actions,
			"영상 후보는 다운로드 후 프레임 변화량을 검사하고, low_motion_video 후보는 아카이브 재사용/렌더 입력에서 제외하세요.",
		);
	}

	const minOpeningBeats = isShorts ? 3 : 4;
	if (
		totalDurationSeconds >= (isShorts ? 6 : 14) &&
		openingDynamicBeatCount < minOpeningBeats
	) {
		issues.push(
			buildIssue(
				"critical",
				"low_opening_visual_density",
				`초반 비주얼 비트가 ${openingDynamicBeatCount}개입니다. 유명 영상 수준으로 보려면 첫 ${isShorts ? 8 : 12}초에 최소 ${minOpeningBeats}개 이상의 실질 컷 변화가 필요합니다.`,
			),
		);
		pushAction(
			actions,
			"첫 장면을 2-4개 샷으로 쪼개고, 영상/문서/지도/증거 클로즈업을 섞어 첫 3초부터 화면이 바뀌게 하세요.",
		);
	}

	if (visualScenes.length > 0 && motionScenes.length / visualScenes.length < 0.7) {
		issues.push(
			buildIssue(
				"warning",
				"low_motion_ratio",
				"모션이 있는 비주얼 비율이 낮아 화면 전개가 정적으로 느껴질 수 있습니다.",
			),
		);
		pushAction(actions, "정적 사진 씬에는 slow zoom, pan, push-in 또는 모션 그래픽을 넣으세요.");
	}

	if (
		visualScenes.length > 0 &&
		designedVisualScenes.length / visualScenes.length < 0.82
	) {
		issues.push(
			buildIssue(
				"critical",
				"low_designed_visual_ratio",
				"자료화면이 충분히 설계되지 않았습니다. 통짜 AI 영상 없이 가려면 대부분의 씬이 모션/문서/지도/콜아웃 처리되어야 합니다.",
			),
		);
		pushAction(
			actions,
			"이미지 나열 대신 각 씬에 모션, 출처 로워서드, 문서 하이라이트, 지도/타임라인 비트를 추가하세요.",
		);
	}

	if (allShots.length >= 4 && anchoredShots.length / allShots.length < 0.45) {
		issues.push(
			buildIssue(
				"warning",
				"low_source_anchor_ratio",
				"출처 앵커가 있는 샷 비율이 낮아 아무 이미지나 붙인 영상처럼 보일 수 있습니다.",
			),
		);
		pushAction(actions, "저신뢰 스톡/AI 재구성 샷을 기사, 문서, 지도, 아카이브 자료로 바꾸세요.");
	}

	if (
		resolvedShots.length >= 4 &&
		lowConfidenceShots.length / resolvedShots.length > 0.5
	) {
		issues.push(
			buildIssue(
				"critical",
				"high_low_confidence_ratio",
				"저신뢰 시각 자료 비율이 과도합니다. 주제와 안 맞는 컷이 섞일 가능성이 높아 승인할 수 없습니다.",
			),
		);
		pushAction(
			actions,
			"낮은 confidence/quality 샷을 재검색하거나 문서/지도/출처 컷으로 교체하세요.",
		);
	} else if (
		resolvedShots.length >= 4 &&
		lowConfidenceShots.length / resolvedShots.length > 0.35
	) {
		issues.push(
			buildIssue(
				"warning",
				"high_low_confidence_ratio",
				"저신뢰 시각 자료 비율이 높아 주제와 안 맞는 컷이 섞일 가능성이 큽니다.",
			),
		);
		pushAction(actions, "낮은 confidence/quality 샷만 선별적으로 재검색하세요.");
	}

	if (veryWeakShots.length > 0) {
		issues.push(
			buildIssue(
				"critical",
				"very_low_quality_shot",
				"핵심 위치에 품질/관련도 점수가 매우 낮은 샷이 남아 있습니다. 평균이 좋아도 이 컷 하나가 영상 수준을 크게 떨어뜨립니다.",
			),
		);
		pushAction(
			actions,
			"품질 40 미만 또는 confidence 40 미만인 핵심 샷은 렌더 전에 재검색하거나 source card/문서 컷으로 교체하세요.",
		);
	}

	if (
		resolvedShots.length >= 4 &&
		genericStockShots.length / resolvedShots.length > 0.35
	) {
		issues.push(
			buildIssue(
				"critical",
				"high_generic_stock_ratio",
				"증거/문서/아카이브 자리에 일반 스톡 자료가 과도하게 섞였습니다. 유명 채널 수준의 자료 기반 영상으로 승인할 수 없습니다.",
			),
		);
		pushAction(
			actions,
			"일반 Pexels/Pixabay 컷은 context/transition에만 제한하고, 핵심 사건 컷은 뉴스/아카이브/문서/지도 자료로 교체하세요.",
		);
	} else if (
		resolvedShots.length >= 4 &&
		genericStockShots.length / resolvedShots.length > 0.2
	) {
		issues.push(
			buildIssue(
				"warning",
				"elevated_generic_stock_ratio",
				"일반 스톡 자료 비율이 높아 주제와 직접 연결되지 않은 영상처럼 보일 수 있습니다.",
			),
		);
		pushAction(actions, "스톡 컷은 배경 전환에만 쓰고 핵심 정보 컷은 출처 앵커가 있는 자료로 바꾸세요.");
	}

	if (
		allShots.length >= 4 &&
		reconstructionShots.length / allShots.length > 0.5
	) {
		issues.push(
			buildIssue(
				"warning",
				"high_reconstruction_ratio",
				"AI 재구성 비율이 높습니다. 실제 자료처럼 오해되지 않도록 고지와 스타일 구분이 필요합니다.",
			),
		);
		pushAction(actions, "설명란과 화면 출처 표시에서 AI 재구성 여부를 명확히 고지하세요.");
	}

	if (scenes.length >= 5 && textScenes.length / scenes.length > 0.35) {
		issues.push(
			buildIssue(
				"warning",
				"high_text_scene_ratio",
				"텍스트 강조 씬 비율이 높아 영상보다 카드뉴스처럼 느껴질 수 있습니다.",
			),
		);
		pushAction(actions, "텍스트 강조는 훅/전환/결론에만 쓰고 본문은 영상 또는 자료 화면으로 바꾸세요.");
	}

	if (motionValues.length >= 4 && motionMonotonyRatio > 0.85) {
		issues.push(
			buildIssue(
				visualScenes.length > 0 && videoScenes.length === 0 ? "critical" : "warning",
				"motion_monotony",
				"동일한 카메라 모션이 과도하게 반복되어 자동 생성 이미지 나열처럼 보일 수 있습니다.",
			),
		);
		pushAction(actions, "push-in, pan, detail crop, source card, timeline/map 컷을 섞어 모션 반복을 줄이세요.");
	}

	if (narrationScenes.length > 0 && wordTimedScenes.length / narrationScenes.length < 0.35) {
		issues.push(
			buildIssue(
				"critical",
				"weak_caption_sync",
				"단어 타이밍 기반 자막 싱크가 거의 없어 자막이 영상 품질을 크게 떨어뜨릴 수 있습니다.",
			),
		);
		pushAction(actions, "Whisper/word timing 생성 경로를 다시 돌려 자막 싱크를 보강하세요.");
	} else if (
		narrationScenes.length > 0 &&
		wordTimedScenes.length / narrationScenes.length < 0.65
	) {
		issues.push(
			buildIssue(
				"warning",
				"weak_caption_sync",
				"단어 타이밍 기반 자막 싱크가 부족합니다. 자막이 튀거나 몰입을 방해할 수 있습니다.",
			),
		);
		pushAction(actions, "Whisper/word timing 생성 경로를 다시 돌려 자막 싱크를 보강하세요.");
	}

	if (averageNarrationCharsPerSecond > 7.2) {
		issues.push(
			buildIssue(
				"warning",
				"fast_tts_pacing",
				"TTS 분량이 영상 길이에 비해 많아 톤이 급하고 부자연스럽게 들릴 수 있습니다.",
			),
		);
		pushAction(actions, "나레이션을 줄이거나 씬 길이를 늘려 자막/발화 속도를 낮추세요.");
	}

	if (lastScene) {
		const lastDuration = durationOf(lastScene);
		const lastNarration = narrationOf(lastScene);
		if (lastDuration < (isShorts ? 1.8 : 4)) {
			issues.push(
				buildIssue(
					lastDuration < 1.2 ? "critical" : "warning",
					"abrupt_ending_duration",
					"마지막 씬이 너무 짧아 영상이 갑자기 멈추듯 끝날 수 있습니다.",
					scenes.length,
				),
			);
			pushAction(actions, "마지막 씬에 2-5초 여운 또는 결론 비트를 추가하세요.");
		}
		if (lastNarration.length < 14) {
			issues.push(
				buildIssue(
					"critical",
					"thin_ending_narration",
					"마지막 나레이션이 너무 짧아 결론 없이 끊기는 인상을 줍니다.",
					scenes.length,
				),
			);
			pushAction(actions, "마지막 문장에 확인된 결론과 남은 의문을 함께 넣으세요.");
		}
		if (!endingCue) {
			issues.push(
				buildIssue(
					isLongform ? "critical" : "warning",
					"missing_ending_cue",
					"마무리 문장이 결론/남은 의문/현재까지 확인된 사실로 닫히지 않습니다.",
					scenes.length,
				),
			);
			pushAction(actions, "엔딩은 '확인된 것', '남은 의문', '현재까지의 결론' 중 하나로 닫으세요.");
		}
	}

	if (isLongform) {
		if (totalDurationSeconds > 0 && totalDurationSeconds < 120) {
			issues.push(
				buildIssue(
					"critical",
					"underdeveloped_longform_runtime",
					"롱폼으로 승인하기에는 총 길이가 너무 짧아 유명 롱폼 채널과 구조적 차이가 크게 납니다.",
				),
			);
			pushAction(actions, "롱폼은 최소 2분 이상, 권장 3-6분 이상으로 배경/전개/쟁점/정리를 분리하세요.");
		} else if (totalDurationSeconds > 0 && totalDurationSeconds < 180) {
			issues.push(
				buildIssue(
					"warning",
					"short_longform_duration",
					"롱폼으로 보기에는 총 길이가 짧습니다. 배경, 전개, 반전, 결론 구조가 압축될 수 있습니다.",
				),
			);
			pushAction(actions, "롱폼은 최소 3-6분 이상으로 배경/타임라인/쟁점/정리를 분리하세요.");
		}
		if (scenes.length > 0 && scenes.length < 8) {
			issues.push(
				buildIssue(
					"warning",
					"thin_longform_structure",
					"롱폼 구조에 필요한 씬 수가 부족합니다.",
				),
			);
			pushAction(actions, "롱폼은 훅, 배경, 사건 전개, 증거, 반론, 결론 씬을 분리하세요.");
		}
	}

	const policyReport = analyzeYouTubePolicyRisk({
		title: input.title,
		description: input.description,
		format: input.format,
		scenes: scenes.map((scene) => ({
			narration_text: scene.narration_text ?? scene.narration,
			scene_type: scene.scene_type ?? scene.type,
			visual_prompt: scene.visual_prompt,
			news_title: scene.news_title ?? scene.newsTitle,
			news_source: scene.news_source ?? scene.newsSource,
			source_url: scene.source_url ?? scene.sourceUrl,
			shots: scene.shots,
		})),
	});
	for (const issue of policyReport.issues) {
		issues.push(
			buildIssue(
				issue.severity,
				`policy_${issue.code}`,
				`YouTube 정책 리스크: ${issue.message}`,
				issue.sceneIndex,
			),
		);
	}
	policyReport.requiredActions.forEach((action) => pushAction(actions, action));

	const retentionReport = analyzeOpeningRetention({
		title: input.title,
		format: input.format,
		scenes: scenes.map((scene) => ({
			narration_text: scene.narration_text ?? scene.narration,
			scene_type: scene.scene_type ?? scene.type,
			duration_seconds: durationOf(scene),
			news_title: scene.news_title ?? scene.newsTitle,
			shots: scene.shots,
		})),
	});
	for (const issue of retentionReport.issues) {
		issues.push(
			buildIssue(
				issue.severity,
				`opening_${issue.code}`,
				`초반 유지율 리스크: ${issue.message}`,
			),
		);
	}
	retentionReport.requiredActions.forEach((action) =>
		pushAction(actions, action),
	);

	const safeRatio = (value: number, fallback = 0) =>
		Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
	const videoSceneRatio =
		visualScenes.length > 0 ? videoScenes.length / visualScenes.length : 0;
	const motionVisualRatio =
		visualScenes.length > 0 ? motionScenes.length / visualScenes.length : 0;
	const sourceAnchorRatio =
		allShots.length > 0 ? anchoredShots.length / allShots.length : 0;
	const lowConfidenceShotRatio =
		resolvedShots.length > 0
			? lowConfidenceShots.length / resolvedShots.length
			: allShots.length > 0
				? 1
				: 0;
	const genericStockShotRatio =
		resolvedShots.length > 0 ? genericStockShots.length / resolvedShots.length : 0;
	const lowMotionVideoShotRatio =
		videoShots.length > 0 ? lowMotionVideoShots.length / videoShots.length : 0;
	const designedVisualRatio =
		visualScenes.length > 0
			? designedVisualScenes.length / visualScenes.length
			: 0;
	const captionSyncRatio =
		narrationScenes.length > 0
			? wordTimedScenes.length / narrationScenes.length
			: 0;
	const editorialDensityScore = Math.min(100, Math.round(
		ratio(averageShotsPerVisualScene, isShorts ? 1.35 : 1.15) * 25 +
			(visualDiversityScore / 100) * 18 +
			(motionDiversityScore / 100) * 18 +
			shotRhythmCueRatio * 14 +
			sceneRhythmCueRatio * 10 +
			motionGraphicRatio * 7 +
			safeRatio(videoSceneRatio, 0) * 8 +
			ratio(openingDynamicBeatCount, isShorts ? 3 : 4) * 8,
	));
	if (visualScenes.length >= 3 && editorialDensityScore < 45) {
		issues.push(
			buildIssue(
				"critical",
				"low_editorial_density",
				`편집 밀도 점수가 ${editorialDensityScore}/100입니다. 컷 리듬과 시각 변주가 부족해 유명 채널 대비 차이가 크게 날 수 있습니다.`,
			),
		);
		pushAction(
			actions,
			"샷 수, 모션 종류, visual role, SFX cue, 전환 리듬, 모션 그래픽을 늘려 편집 밀도를 보강하세요.",
		);
	} else if (visualScenes.length >= 3 && editorialDensityScore < 62) {
		issues.push(
			buildIssue(
				"warning",
				"low_editorial_density",
				`편집 밀도 점수가 ${editorialDensityScore}/100입니다. 통과는 가능하지만 영상 리듬이 단조로울 수 있습니다.`,
			),
		);
		pushAction(actions, "반복되는 정적 샷을 2-3비트로 나누고 SFX/전환 cue를 추가하세요.");
	}
	const premiumFloorScore = Math.round(
		(hasNarration ? 12 : 0) +
			(hasBgm ? 12 : 0) +
			(hasThumbnail ? 8 : 0) +
			(endingCue ? 8 : 0) +
			safeRatio(designedVisualRatio) * 18 +
			safeRatio(motionVisualRatio) * 14 +
			safeRatio(sourceAnchorRatio) * 14 +
			safeRatio(captionSyncRatio) * 8 +
			(1 - safeRatio(lowConfidenceShotRatio)) * 4 +
			(1 - safeRatio(lowMotionVideoShotRatio)) * 4 +
			(1 - safeRatio(genericStockShotRatio)) * 2,
	);
	if (scenes.length > 0 && premiumFloorScore < 86) {
		issues.push(
			buildIssue(
				"critical",
				"large_quality_gap",
				`프리미엄 바닥선 점수가 ${premiumFloorScore}/100입니다. 유명 채널 대비 큰 차이가 날 가능성이 높아 렌더를 승인하지 않습니다.`,
			),
		);
		pushAction(
			actions,
			"나레이션, BGM, 썸네일, 자막 싱크, 출처 앵커, 모션 설계 중 부족한 항목을 먼저 보강하세요.",
		);
	}

	const criticals = issues.filter((issue) => issue.severity === "critical").length;
	const warnings = issues.filter((issue) => issue.severity === "warning").length;
	const score = Math.max(0, 100 - criticals * 26 - warnings * 7);
	const metrics = {
		sceneCount: scenes.length,
		totalDurationSeconds: Number(totalDurationSeconds.toFixed(2)),
		videoSceneRatio: Number(videoSceneRatio.toFixed(2)),
		motionVisualRatio: Number(motionVisualRatio.toFixed(2)),
		sourceAnchorRatio: Number(sourceAnchorRatio.toFixed(2)),
		lowConfidenceShotRatio: Number(lowConfidenceShotRatio.toFixed(2)),
		genericStockShotRatio: Number(genericStockShotRatio.toFixed(2)),
		reconstructionShotRatio:
			allShots.length > 0
				? Number((reconstructionShots.length / allShots.length).toFixed(2))
				: 0,
		textEmphasisRatio:
			scenes.length > 0
				? Number((textScenes.length / scenes.length).toFixed(2))
				: 0,
		designedVisualRatio: Number(designedVisualRatio.toFixed(2)),
		captionSyncRatio: Number(captionSyncRatio.toFixed(2)),
		averageNarrationCharsPerSecond: Number(
			averageNarrationCharsPerSecond.toFixed(2),
		),
		averageShotsPerVisualScene: Number(averageShotsPerVisualScene.toFixed(2)),
		openingShotCount,
		openingDynamicBeatCount,
		lowMotionVideoShotRatio: Number(lowMotionVideoShotRatio.toFixed(2)),
		visualDiversityScore,
		motionDiversityScore,
		editorialDensityScore,
		premiumFloorScore,
		hasNarration,
		hasBgm,
		hasThumbnail,
		hasEndingCue: endingCue,
	};

	return {
		passed: criticals === 0 && score >= 78 && premiumFloorScore >= 86,
		score,
		issues,
		requiredActions: actions,
		metrics,
	};
}
