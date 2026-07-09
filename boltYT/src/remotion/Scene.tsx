import { useMemo } from "react";
import {
	AbsoluteFill,
	Audio,
	Img,
	interpolate,
	OffthreadVideo,
	Sequence,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
	Video,
} from "remotion";
import { useProxyAvailable } from "../hooks/useProxyAvailable";
import { compileColorGraphToCss } from "../lib/color-graph-css";
import {
	collectAccentFrames,
	computeMicroEditStyle,
	computeNewsCardLayerMotion,
	computeOverlayTypographyStyle,
	computeShotOverlayLayerMotion,
	computeTextEmphasisLayerMotion,
} from "../lib/micro-edit";
import {
	getNewsCardTheme,
	inferNewsSurfaceTone,
	type NewsSurfaceTone,
} from "../lib/news-surface-theme";
import type { SceneShot } from "../lib/scene-shot-types";
import { SFX_CATALOG, type SfxCategory, type SfxEntry } from "../lib/sfx";
import { getShotOverlayTheme } from "../lib/shot-overlay-theme";
import { computeBeatPulseScale } from "../lib/beat-pulse";
import { computeTextEmphasisCueTheme } from "../lib/text-emphasis-cue-theme";
import { computeTextEmphasisWordStyle } from "../lib/text-emphasis-highlight";
import { computeTextEmphasisLayout } from "../lib/text-emphasis-layout";
import { evaluateTransformKeyframes } from "../lib/timeline-model";
import { ChunkedCaption } from "./ChunkedCaption";
import { TextEffectWrapper } from "./effects/TextEffects";
import { generateWordTimings, KaraokeCaption } from "./KaraokeCaption";
import { MotionGraphicsLayer } from "./motion/MotionGraphicsLayer";
import { CinematicOverlay } from "./overlays/CinematicOverlay";
import { ColorGrade } from "./overlays/ColorGrade";
import { LowerThird } from "./overlays/LowerThird";
import { LightLeak, Particles } from "./overlays/Particles";
import { resolveVideoSrc } from "./resolve-video-src";
import { buildShotTimeline } from "./shot-timing";
import type {
	CaptionStyle,
	LayoutVariant,
	RemotionScene,
	SubtitleStyle,
	TextEffect,
} from "./types";
import { DEFAULT_SUBTITLE, isVertical, SHORTS_SAFE_AREA } from "./types";

/** 쇼츠 여부에 따른 레이아웃 값 */
function useLayoutMode() {
	const { width, height } = useVideoConfig();
	const vertical = isVertical(width, height);
	return {
		vertical,
		sidePad: vertical ? SHORTS_SAFE_AREA.left : 60,
		bottomPad: vertical ? SHORTS_SAFE_AREA.bottom : 60,
		topPad: vertical ? SHORTS_SAFE_AREA.top : 0,
		cardPad: vertical ? 32 : 120,
		cardMaxWidth: vertical ? "95%" : "85%",
		newsTitleSize: vertical ? 36 : 42,
		captionMaxWidth: vertical ? "95%" : "85%",
		imgTransformOrigin: vertical
			? ("center 35%" as const)
			: ("center center" as const),
		baseScale: vertical ? 1.15 : 1,
	};
}

function getShotScale(crop?: SceneShot["crop"], baseScale = 1) {
	switch (crop) {
		case "wide":
			return baseScale * 1.08;
		case "medium":
			return baseScale * 1.16;
		case "close":
			return baseScale * 1.24;
		case "detail":
			return baseScale * 1.34;
		default:
			return baseScale;
	}
}

function getShotObjectFit(crop?: SceneShot["crop"]): "cover" | "contain" {
	return crop === "full" ? "contain" : "cover";
}

function secondsToFrames(seconds: number | undefined, fps: number) {
	if (typeof seconds !== "number" || !Number.isFinite(seconds)) return 0;
	return Math.max(0, Math.floor(seconds * fps));
}

function isLegacyDownloadedTrim(shot: SceneShot | undefined): boolean {
	if (!shot) return false;
	const trimStart = shot.trim_start ?? 0;
	const trimEnd = shot.trim_end;
	return (
		shot.selection_provider === "youtube" &&
		Number.isFinite(trimStart) &&
		trimStart <= 0.01 &&
		typeof trimEnd === "number" &&
		trimEnd <= 1.01 &&
		Number(shot.duration_seconds) > 1.2
	);
}

function shotEndAtFrame(
	shot: SceneShot | undefined,
	fps: number,
	startFrom: number,
	fallbackDurationFrames?: number,
): number | undefined {
	const fallback =
		typeof fallbackDurationFrames === "number" && fallbackDurationFrames > 0
			? startFrom + fallbackDurationFrames
			: undefined;
	if (isLegacyDownloadedTrim(shot)) return fallback;
	if (typeof shot?.trim_end === "number" && Number.isFinite(shot.trim_end)) {
		return Math.max(startFrom + 2, secondsToFrames(shot.trim_end, fps));
	}
	return fallback;
}

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function mergeMotionStyles(
	base: React.CSSProperties,
	micro: { transform?: string; filter?: string },
): React.CSSProperties {
	return {
		...base,
		transform: [base.transform, micro.transform]
			.filter(Boolean)
			.join(" ")
			.trim(),
		filter: [base.filter, micro.filter].filter(Boolean).join(" ").trim(),
	};
}

function activeSpeechIntensity(
	frame: number,
	wordTimings?: RemotionScene["wordTimings"],
): number {
	if (!wordTimings?.length) return 0;
	const active = wordTimings.find(
		(word) => frame >= word.startFrame && frame <= word.endFrame,
	);
	if (!active) return 0;
	const span = Math.max(1, active.endFrame - active.startFrame);
	const local = (frame - active.startFrame) / span;
	return Math.sin(Math.PI * clamp(local, 0, 1));
}

function computeAnimationSpeechStyle(
	shot: SceneShot | undefined,
	frame: number,
	wordTimings?: RemotionScene["wordTimings"],
): { transform?: string; filter?: string } {
	const rig = shot?.animation_rig;
	if (!rig) return {};
	const speech = activeSpeechIntensity(frame, wordTimings);
	if (speech <= 0) return {};
	const mouthWeight =
		rig.mouthCue === "wide" ? 1 : rig.mouthCue === "open" ? 0.72 : 0.36;
	const expressionWeight =
		rig.expression === "surprised" || rig.expression === "fear" ? 1.15 : 1;
	const scale = 1 + speech * mouthWeight * expressionWeight * 0.014;
	const lift = -speech * clamp(rig.actionIntensity, 0.2, 1) * 3.5;
	return {
		transform: `translateY(${lift.toFixed(2)}px) scale(${scale.toFixed(3)})`,
		filter: `brightness(${(1 + speech * 0.025).toFixed(3)}) saturate(${(1 + speech * 0.035).toFixed(3)})`,
	};
}

function animationRigMicroTransform(
	shot: SceneShot | undefined,
	localFrame: number,
	durationInFrames: number,
): string {
	const rig = shot?.animation_rig;
	if (!rig) return "";
	const progress = durationInFrames <= 1 ? 1 : localFrame / durationInFrames;
	const eased = Math.sin(progress * Math.PI);
	const beat = Math.sin(progress * Math.PI * 2);
	const intensity = clamp(rig.actionIntensity, 0, 1);
	const anticipation =
		rig.pose === "action" && progress < 0.18
			? Math.sin((progress / 0.18) * Math.PI) * 5 * intensity
			: 0;
	const settle =
		rig.pose === "action" && progress > 0.82
			? Math.sin(((progress - 0.82) / 0.18) * Math.PI) * 3 * intensity
			: 0;
	const y =
		rig.pose === "action"
			? -10 * eased * intensity + anticipation + settle
			: -4 * eased * intensity;
	const rotation =
		rig.pose === "action"
			? beat * 2.2 * intensity
			: rig.expression === "surprised" || rig.expression === "fear"
				? beat * 1.1 * intensity
				: 0;
	const mouthPulse =
		rig.mouthCue === "open" || rig.mouthCue === "wide"
			? 1 + 0.012 * eased * intensity
			: 1;
	const squash = rig.pose === "action" ? 1 + 0.012 * eased * intensity : 1;
	return `translateY(${y.toFixed(2)}px) rotate(${rotation.toFixed(2)}deg) scale(${(mouthPulse * squash).toFixed(3)})`;
}

function withAnimationRigMotion(
	base: React.CSSProperties,
	shot: SceneShot | undefined,
	localFrame: number,
	durationInFrames: number,
): React.CSSProperties {
	const rigTransform = animationRigMicroTransform(
		shot,
		localFrame,
		durationInFrames,
	);
	if (!rigTransform) return base;
	return {
		...base,
		transform: [base.transform, rigTransform].filter(Boolean).join(" "),
	};
}

function isAnimationPerformanceShot(shot?: SceneShot): boolean {
	return Boolean(shot?.animation_rig || shot?.animation_family);
}

function animationAccentColor(scene: RemotionScene, shot?: SceneShot): string {
	const cue = shot?.sfx_cue?.category;
	if (cue === "impact" || cue === "suspense_hit") return "255, 232, 138";
	if (cue === "glitch") return "112, 231, 255";
	if (cue === "notification" || cue === "bell") return "132, 204, 255";
	if (scene.mood === "horror" || scene.mood === "mystery")
		return "167, 139, 250";
	return "255, 255, 255";
}

function AnimationPerformanceOverlay({
	scene,
	shot,
	sceneFrame,
	localFrame,
	durationInFrames,
}: {
	scene: RemotionScene;
	shot?: SceneShot;
	sceneFrame: number;
	localFrame: number;
	durationInFrames: number;
}) {
	const rig = shot?.animation_rig;
	if (!isAnimationPerformanceShot(shot) || !rig) return null;
	const progress =
		durationInFrames <= 1 ? 1 : clamp(localFrame / durationInFrames, 0, 1);
	const beat = Math.sin(progress * Math.PI);
	const speech = activeSpeechIntensity(
		Math.max(0, Math.round(sceneFrame)),
		scene.wordTimings,
	);
	const accent = animationAccentColor(scene, shot);
	const actionOpacity = clamp(rig.actionIntensity, 0, 1) * beat;
	const impactFrame =
		shot?.kind === "punch"
			? localFrame >= Math.max(0, durationInFrames - 10)
			: localFrame <= 8;
	const impactOpacity =
		impactFrame && (shot?.sfx_cue?.intensity ?? 0) > 0.6
			? clamp((shot.sfx_cue?.intensity ?? 0) * 0.22, 0, 0.22)
			: 0;
	const blinkCycle = Math.sin((localFrame / 30) * Math.PI * 2);
	const blinkOpacity =
		rig.expression === "surprised" || rig.expression === "fear"
			? 0
			: blinkCycle > 0.96
				? 0.42
				: 0;
	const speechGlowOpacity =
		(rig.mouthCue === "open" || rig.mouthCue === "wide") && speech > 0
			? speech * 0.18
			: 0;
	const actionLineOpacity =
		rig.pose === "action" ? clamp(actionOpacity * 0.3, 0, 0.3) : 0;

	return (
		<AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
			{impactOpacity > 0 && (
				<AbsoluteFill
					style={{
						background: `radial-gradient(circle at 50% 45%, rgba(${accent}, ${impactOpacity}) 0%, rgba(${accent}, ${impactOpacity * 0.32}) 22%, transparent 58%)`,
						mixBlendMode: "screen",
					}}
				/>
			)}
			{actionLineOpacity > 0 && (
				<AbsoluteFill
					style={{
						background: `linear-gradient(105deg, transparent 0%, rgba(${accent}, ${actionLineOpacity}) 16%, transparent 27%, transparent 62%, rgba(${accent}, ${actionLineOpacity * 0.8}) 78%, transparent 92%)`,
						transform: `translateX(${Math.sin(progress * Math.PI * 2) * 14}px)`,
						filter: "blur(10px)",
						mixBlendMode: "screen",
					}}
				/>
			)}
			{speechGlowOpacity > 0 && (
				<div
					style={{
						position: "absolute",
						left: "32%",
						right: "32%",
						bottom: "25%",
						height: 48,
						borderRadius: 999,
						background: `radial-gradient(ellipse, rgba(${accent}, ${speechGlowOpacity}) 0%, transparent 72%)`,
						filter: "blur(14px)",
						transform: `scale(${1 + speech * 0.2})`,
						mixBlendMode: "screen",
					}}
				/>
			)}
			{blinkOpacity > 0 && (
				<div
					style={{
						position: "absolute",
						left: "30%",
						right: "30%",
						top: "33%",
						height: 2,
						background: `rgba(${accent}, ${blinkOpacity})`,
						boxShadow: `0 0 18px rgba(${accent}, ${blinkOpacity})`,
						transform: "scaleX(0.42)",
						mixBlendMode: "screen",
					}}
				/>
			)}
		</AbsoluteFill>
	);
}

function rhythmPulseEnvelope(
	frame: number,
	cueFrame: number,
	attackFrames: number,
	releaseFrames: number,
): number {
	const start = cueFrame - 1;
	const peak = cueFrame + attackFrames;
	const end = peak + releaseFrames;
	if (frame < start || frame > end) return 0;
	if (frame <= peak) {
		return clamp((frame - start) / Math.max(1, peak - start), 0, 1);
	}
	return clamp(1 - (frame - peak) / Math.max(1, end - peak), 0, 1);
}

function shotBoundaryFadeFrames(
	shot: SceneShot | undefined,
	scene: RemotionScene,
): number {
	if (!shot) return scene.pacing === "fast" || scene.hookBoost ? 3 : 5;
	const cue = shot.sfx_cue;
	const highImpact =
		shot.kind === "punch" ||
		cue?.category === "impact" ||
		cue?.category === "glitch" ||
		(cue?.intensity ?? 0) >= 0.82;
	if (highImpact) return 1;
	if (
		cue?.category === "whoosh" ||
		cue?.category === "reveal" ||
		shot.motion === "pan_left" ||
		shot.motion === "pan_right"
	) {
		return 2;
	}
	if (scene.pacing === "fast" || scene.hookBoost || shot.animation_rig)
		return 3;
	if (shot.media_type === "video") return 4;
	return 6;
}

function editorialAccentColor(scene: RemotionScene, shot?: SceneShot): string {
	const cue = shot?.sfx_cue?.category;
	if (cue === "glitch") return "84, 220, 255";
	if (cue === "impact" || cue === "suspense_hit") return "255, 223, 118";
	if (scene.mood === "warm") return "255, 198, 128";
	if (scene.mood === "horror" || scene.mood === "mystery")
		return "166, 130, 255";
	return "255, 255, 255";
}

function EditorialRhythmOverlay({
	scene,
	shot,
	sceneFrame,
	localFrame,
	durationInFrames,
	isVideoShot,
}: {
	scene: RemotionScene;
	shot?: SceneShot;
	sceneFrame: number;
	localFrame: number;
	durationInFrames: number;
	isVideoShot?: boolean;
}) {
	const { width, height } = useVideoConfig();
	const vertical = isVertical(width, height);
	const cueFrames = collectAccentFrames(
		scene.wordTimings,
		scene.durationInFrames,
		scene.hookBoost,
	).slice(0, scene.hookBoost ? 4 : 3);
	const pulse = cueFrames.reduce((maxPulse, cueFrame) => {
		const cuePulse = rhythmPulseEnvelope(
			sceneFrame,
			cueFrame,
			scene.hookBoost ? 2 : 1,
			scene.hookBoost ? 10 : 7,
		);
		return Math.max(maxPulse, cuePulse);
	}, 0);
	const startSnap = interpolate(localFrame, [0, 3, 12], [1, 0.4, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const framesToEnd = Math.max(0, durationInFrames - localFrame);
	const endProgress = clamp((12 - framesToEnd) / 12, 0, 1);
	const endSnap = endProgress * endProgress * 0.85;
	const cueIntensity = clamp(shot?.sfx_cue?.intensity ?? 0, 0, 1);
	const accent = editorialAccentColor(scene, shot);
	const focusOpacity = clamp(
		(scene.mood === "news" ? 0.08 : 0.13) +
			pulse * 0.055 +
			(isVideoShot ? 0 : 0.035),
		0,
		0.22,
	);
	const edgeOpacity = clamp(
		(pulse * 0.1 + startSnap * 0.045 + endSnap * 0.05) *
			(scene.hookBoost ? 1.25 : 1),
		0,
		0.16,
	);
	const impactOpacity = clamp(
		(startSnap + endSnap + pulse * 0.5) *
			cueIntensity *
			(shot?.kind === "punch" ? 0.18 : 0.08),
		0,
		0.2,
	);
	const scanX = ((sceneFrame * (scene.hookBoost ? 1.7 : 1.1)) % 120) - 10;
	const focusY =
		shot?.crop === "detail" || shot?.crop === "close"
			? vertical
				? 38
				: 42
			: vertical
				? 44
				: 50;

	return (
		<AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
			<AbsoluteFill
				style={{
					background: `radial-gradient(ellipse at 50% ${focusY}%, transparent 0%, transparent ${vertical ? "42%" : "50%"}, rgba(0,0,0,${focusOpacity}) 100%)`,
					mixBlendMode: "multiply",
				}}
			/>
			{edgeOpacity > 0.01 && (
				<AbsoluteFill
					style={{
						background: `linear-gradient(112deg, transparent 0%, transparent ${Math.max(0, scanX - 10)}%, rgba(${accent}, ${edgeOpacity}) ${scanX}%, transparent ${Math.min(100, scanX + 11)}%, transparent 100%)`,
						filter: "blur(8px)",
						mixBlendMode: "soft-light",
					}}
				/>
			)}
			{impactOpacity > 0.01 && (
				<AbsoluteFill
					style={{
						background: `linear-gradient(90deg, rgba(${accent}, ${impactOpacity}) 0%, transparent 18%, transparent 82%, rgba(${accent}, ${impactOpacity}) 100%)`,
						filter: "blur(4px)",
						mixBlendMode: "screen",
					}}
				/>
			)}
		</AbsoluteFill>
	);
}

function useActiveShot(
	shots: SceneShot[] | undefined,
	durationInFrames: number,
	wordTimings?: RemotionScene["wordTimings"],
): {
	shot?: SceneShot;
	from: number;
	localFrame: number;
	durationInFrames: number;
} {
	const frame = useCurrentFrame();
	const timeline = useMemo(
		() => buildShotTimeline(shots, durationInFrames, { wordTimings }),
		[shots, durationInFrames, wordTimings],
	);
	if (timeline.length === 0) {
		return {
			shot: undefined,
			from: 0,
			localFrame: frame,
			durationInFrames,
		};
	}

	const active =
		timeline.find(
			(entry) =>
				frame >= entry.from && frame < entry.from + entry.durationInFrames,
		) ?? timeline[timeline.length - 1];

	return {
		shot: active.shot,
		from: active.from,
		localFrame: Math.max(0, frame - active.from),
		durationInFrames: active.durationInFrames,
	};
}

function computeShotMotion(
	shot: SceneShot | undefined,
	localFrame: number,
	durationInFrames: number,
	baseScale: number,
	vertical: boolean,
	narration: string,
	mood?: string,
) {
	if (!shot) {
		return getKenBurnsTransform(
			localFrame,
			durationInFrames,
			baseScale,
			vertical,
			narration,
			mood,
		);
	}

	const progress = durationInFrames <= 1 ? 1 : localFrame / durationInFrames;
	const ease = progress * progress * (3 - 2 * progress);
	const scale = getShotScale(shot.crop, baseScale);
	const withRig = (style: React.CSSProperties) =>
		withAnimationRigMotion(style, shot, localFrame, durationInFrames);

	switch (shot.motion) {
		case "static":
			return withRig({
				transform: `scale(${scale})`,
				transformOrigin: "center center",
			});
		case "slow_zoom_out":
			return withRig({
				transform: `scale(${interpolate(ease, [0, 1], [scale * 1.08, scale])})`,
				transformOrigin: vertical ? "center 35%" : "center center",
			});
		case "pan_left":
			return withRig({
				transform: `scale(${scale * 1.08}) translateX(${interpolate(
					ease,
					[0, 1],
					[80, -60],
				)}px)`,
				transformOrigin: "center center",
			});
		case "pan_right":
			return withRig({
				transform: `scale(${scale * 1.08}) translateX(${interpolate(
					ease,
					[0, 1],
					[-80, 60],
				)}px)`,
				transformOrigin: "center center",
			});
		case "drift":
			return withRig({
				transform: `scale(${interpolate(ease, [0, 1], [scale, scale * 1.08])}) translate(${interpolate(
					ease,
					[0, 1],
					[-18, 24],
				)}px, ${interpolate(ease, [0, 1], [16, -18])}px)`,
				transformOrigin: vertical ? "center 35%" : "center center",
			});
		case "push_in":
			return withRig({
				transform: `scale(${interpolate(ease, [0, 1], [scale, scale * 1.16])})`,
				transformOrigin: vertical ? "center 32%" : "center center",
			});
		default:
			// "slow_zoom_in" 포함 — 가장 일반적인 기본 동작
			return withRig({
				transform: `scale(${interpolate(ease, [0, 1], [scale, scale * 1.1])})`,
				transformOrigin: vertical ? "center 35%" : "center center",
			});
	}
}

/**
 * 다양한 Ken Burns 카메라 무브먼트
 * — 씬 인덱스(narration hash)에 따라 다른 패턴 적용
 */
type KBPattern =
	| "zoom_in"
	| "zoom_out"
	| "pan_left"
	| "pan_right"
	| "tilt_up"
	| "drift";

/**
 * mood에 따른 Ken Burns 줌 강도 계수.
 * horror/mystery → 강한 줌(긴장감), warm → 부드럽게, news → 절제.
 */
function moodZoomFactor(mood?: string): number {
	switch (mood) {
		case "horror":
			return 1.18;
		case "mystery":
			return 1.12;
		case "warm":
			return 1.04;
		case "news":
			return 1.0;
		default:
			return 1.08;
	}
}

/**
 * 나레이션 키워드 기반 KB 패턴 추론. 못 찾으면 null.
 */
function inferKBFromNarration(narration: string): KBPattern | null {
	const t = narration.replace(/\s+/g, "");
	if (/위로|올라|상승|솟|치솟/.test(t)) return "tilt_up";
	if (/내려|아래|추락|떨어|내리|하강/.test(t)) return "tilt_up"; // tilt_down 대신 tilt_up 역방향은 별도. 일단 tilt_up.
	if (/다가|가까이|클로즈|확대|들어가|접근/.test(t)) return "zoom_in";
	if (/멀어|전체|풀샷|넓게|벗어|물러/.test(t)) return "zoom_out";
	if (/오른쪽|right|동쪽/i.test(t)) return "pan_right";
	if (/왼쪽|left|서쪽/i.test(t)) return "pan_left";
	if (/방황|떠도|흩어|복잡/.test(t)) return "drift";
	return null;
}

function getKenBurnsTransform(
	frame: number,
	durationInFrames: number,
	baseScale: number,
	vertical: boolean,
	narration: string,
	mood?: string,
	sceneIndex = 0,
) {
	const mz = moodZoomFactor(mood);
	const inferred = inferKBFromNarration(narration);
	const patterns: KBPattern[] = [
		"zoom_in",
		"zoom_out",
		"pan_left",
		"pan_right",
		"tilt_up",
		"drift",
	];
	// scene index 기반 결정적 변주 — 같은 패턴 연속 회피.
	// inferred 가 있으면 우선, 없으면 (index + narrationHash) 로 결정.
	const hash = (sceneIndex * 3 + (narration.length % 5)) % patterns.length;
	let pattern = inferred ?? patterns[hash];

	// pan 좌/우는 짝/홀수 씬으로 자동 alternation (연속 같은 방향 방지)
	if (pattern === "pan_left" && sceneIndex % 2 === 1) pattern = "pan_right";
	else if (pattern === "pan_right" && sceneIndex % 2 === 0)
		pattern = "pan_left";

	const progress = frame / durationInFrames;
	// smoothstep easing: 시네마틱한 느린 시작·끝 (영화 카메라 무브먼트)
	const ease = progress * progress * (3 - 2 * progress);

	switch (pattern) {
		case "zoom_out": {
			const s = interpolate(
				ease,
				[0, 1],
				[baseScale * (1.28 + 0.14 * mz), baseScale],
				{ extrapolateRight: "clamp" },
			);
			return { transform: `scale(${s})`, transformOrigin: "center center" };
		}
		case "pan_left": {
			const s = baseScale * (1.18 + 0.14 * mz);
			const tx = vertical
				? 0
				: interpolate(ease, [0, 1], [80 * mz, -80 * mz], {
						extrapolateRight: "clamp",
					});
			return {
				transform: `scale(${s}) translateX(${tx}px)`,
				transformOrigin: "center center",
			};
		}
		case "pan_right": {
			const s = baseScale * (1.18 + 0.14 * mz);
			const tx = vertical
				? 0
				: interpolate(ease, [0, 1], [-80 * mz, 80 * mz], {
						extrapolateRight: "clamp",
					});
			return {
				transform: `scale(${s}) translateX(${tx}px)`,
				transformOrigin: "center center",
			};
		}
		case "tilt_up": {
			const s = baseScale * (1.14 + 0.14 * mz);
			const ty = interpolate(ease, [0, 1], [90 * mz, -45 * mz], {
				extrapolateRight: "clamp",
			});
			return {
				transform: `scale(${s}) translateY(${ty}px)`,
				transformOrigin: "center center",
			};
		}
		case "drift": {
			const s = interpolate(
				ease,
				[0, 1],
				[baseScale * (1.08 + 0.1 * mz), baseScale * (1.22 + 0.16 * mz)],
				{ extrapolateRight: "clamp" },
			);
			const tx = vertical
				? 0
				: interpolate(ease, [0, 1], [-30 * mz, 35 * mz], {
						extrapolateRight: "clamp",
					});
			const ty = interpolate(ease, [0, 1], [22 * mz, -22 * mz], {
				extrapolateRight: "clamp",
			});
			return {
				transform: `scale(${s}) translate(${tx}px, ${ty}px)`,
				transformOrigin: "center 40%",
			};
		}
		default: {
			// zoom_in
			const s = interpolate(
				ease,
				[0, 1],
				[baseScale, baseScale * (1.22 + 0.16 * mz)],
				{ extrapolateRight: "clamp" },
			);
			return {
				transform: `scale(${s})`,
				transformOrigin: vertical ? "center 35%" : "center center",
			};
		}
	}
}

const AUDIO_FADE_IN = 8;
const AUDIO_FADE_OUT = 12;

type SubtitlePosition = "top" | "center" | "bottom" | "dynamic";
type SubtitleBgStyle = "none" | "pill" | "block" | "stroke" | "glow";

interface SceneProps {
	scene: RemotionScene;
	/** 이 씬 Sequence의 컴포지션 절대 시작 프레임(전환 오버랩 반영). beat-pulse 절대 동기화용. */
	sceneStartFrame?: number;
	brand?: {
		channelName?: string;
		channelHandle?: string;
		tagline?: string;
	};
	subtitleStyle?: Required<SubtitleStyle>;
	fadeOutFrames?: number;
	/** 컴포지션 레벨 연속 나레이션이 재생 중일 때 true */
	hasGlobalNarration?: boolean;
	/** 자막 스타일 (컴포지션 레벨) */
	captionStyle?: CaptionStyle;
	/** 자막 위치 (레퍼런스 프리셋) */
	subtitlePosition?: SubtitlePosition;
	/** 자막 배경 스타일 (레퍼런스 프리셋) */
	subtitleBgStyle?: SubtitleBgStyle;
	/** 자막 강조색 (레퍼런스 프리셋) */
	subtitleAccentColor?: string;
	/** 컴포지션 레벨 레퍼런스 레이아웃 */
	layoutVariant?: LayoutVariant;
	/** 씬 오디오를 여기서 렌더링하지 않음 — Composition 레벨에서 J/L-cut 오버랩으로 처리 */
	suppressAudio?: boolean;
	/** "preview": 프록시 파일 우선. "render": 항상 원본. 기본 "render" */
	usage?: "preview" | "render";
}

/** subtitlePosition → flex 배치 변환. shot_type 이 close/extreme close 면 dynamic 일 때 top 으로. */
function positionToFlex(
	pos: SubtitlePosition,
	isEmphasis: boolean,
	shotType?: string,
): "flex-start" | "center" | "flex-end" {
	if (pos === "dynamic") {
		if (isEmphasis) return "center";
		// 클로즈업 → 자막 위쪽 (얼굴 가리지 않게)
		if (shotType === "close_up" || shotType === "extreme_close")
			return "flex-start";
		// 와이드 → 자막 아래
		return "flex-end";
	}
	if (pos === "top") return "flex-start";
	if (pos === "center") return "center";
	return "flex-end";
}

/** 오디오 볼륨 envelope — 부드러운 시작/끝 */
function useAudioVolume(durationInFrames: number) {
	const frame = useCurrentFrame();
	const fadeIn = interpolate(frame, [0, AUDIO_FADE_IN], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const fadeOut = interpolate(
		frame,
		[Math.max(0, durationInFrames - AUDIO_FADE_OUT), durationInFrames],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	return Math.min(fadeIn, fadeOut);
}

function useTailFade(durationInFrames: number, fadeOutFrames?: number) {
	const frame = useCurrentFrame();
	if (!fadeOutFrames || fadeOutFrames <= 0) return 1;
	return interpolate(
		frame,
		[
			Math.max(0, durationInFrames - fadeOutFrames),
			Math.max(0, durationInFrames - 1),
		],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
}

function useSubtitleOpacity(durationInFrames: number, fadeOutFrames?: number) {
	const frame = useCurrentFrame();
	const fadeIn = interpolate(frame, [8, 18], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	if (!fadeOutFrames || fadeOutFrames <= 0) return fadeIn;
	const fadeOut = interpolate(
		frame,
		[
			Math.max(0, durationInFrames - Math.min(18, fadeOutFrames)),
			Math.max(0, durationInFrames - 1),
		],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	return fadeIn * fadeOut;
}

function splitReadableLines(
	value: string,
	maxLineLength: number,
	maxLines: number,
): string[] {
	const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
	if (words.length === 0) return [];

	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length > maxLineLength && current) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
		if (lines.length === maxLines - 1) break;
	}
	if (current) {
		const remainingStart = words.findIndex((word) => current.includes(word));
		const remaining =
			remainingStart >= 0 && lines.length === maxLines - 1
				? words.slice(remainingStart).join(" ")
				: current;
		lines.push(remaining);
	}
	return lines.slice(0, maxLines);
}

function compactText(value: string, maxLength: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

// ─── 공통 오버레이 레이어 ───

/** 시네마틱 + 파티클 + 라이트릭 + 로워서드 오버레이 번들 */
function OverlayStack({ scene }: { scene: RemotionScene }) {
	const mood = scene.mood ?? "neutral";
	const source = scene.sourceAttribution ?? scene.newsSource;
	const surfaceTone = inferNewsSurfaceTone({
		narration: scene.narration,
		newsTitle: scene.newsTitle,
		newsExcerpt: scene.newsExcerpt,
	});

	return (
		<>
			<Particles mood={mood} />
			<LightLeak mood={mood} />
			<CinematicOverlay mood={mood} />
			{/* v3: LUT 색보정 — spec(V2 3-way) 우선, fallback preset(V1) */}
			<ColorGrade spec={scene.colorGradeSpec} preset={scene.colorGrade} />
			{source && (
				<LowerThird
					source={source}
					date={scene.newsDate}
					mood={mood}
					hookBoost={scene.hookBoost}
					tone={surfaceTone}
				/>
			)}
			{/* v3: 모션 그래픽 오버레이 */}
			<MotionGraphicsLayer graphics={scene.motionGraphics} />
		</>
	);
}

function ShotOverlay({
	scene,
	shot,
}: {
	scene: RemotionScene;
	shot?: SceneShot;
}) {
	const frame = useCurrentFrame();
	if (!shot?.caption || !shot.overlay || shot.overlay === "none") return null;
	const typo = computeOverlayTypographyStyle({
		frame,
		wordTimings: scene.wordTimings,
		durationInFrames: scene.durationInFrames,
		hookBoost: scene.hookBoost,
	});
	const overlayTone = inferNewsSurfaceTone({
		narration: scene.narration,
		newsTitle: scene.newsTitle,
		newsExcerpt: scene.newsExcerpt,
		shotKind: shot.kind,
	});
	const theme = getShotOverlayTheme({
		overlay: shot.overlay,
		mood: scene.mood,
		hookBoost: scene.hookBoost,
		tone: overlayTone,
	});
	const layerMotion = computeShotOverlayLayerMotion({
		frame,
		wordTimings: scene.wordTimings,
		durationInFrames: scene.durationInFrames,
		hookBoost: scene.hookBoost,
	});

	const title =
		shot.overlay === "headline"
			? scene.newsTitle || shot.caption
			: shot.caption;
	const renderedSource =
		shot.overlay === "quote"
			? scene.newsSource || shot.source_title
			: scene.newsSource;

	return (
		<AbsoluteFill
			style={{
				...theme.container,
			}}
		>
			<div
				style={{
					...theme.card,
					transform: typo.containerTransform,
					opacity: typo.containerOpacity,
				}}
			>
				{theme.label && (
					<div
						style={{
							...theme.label.style,
							transform: layerMotion.labelTransform,
							opacity: layerMotion.labelOpacity,
						}}
					>
						{theme.label.text}
					</div>
				)}
				{theme.quoteMark && (
					<div
						style={{
							...theme.quoteMark.style,
							transform: layerMotion.quoteMarkTransform,
							opacity: layerMotion.quoteMarkOpacity,
						}}
					>
						{theme.quoteMark.text}
					</div>
				)}
				{scene.newsDate &&
					theme.showDate &&
					theme.datePlacement === "badge" && (
						<div
							style={{
								opacity: typo.metaOpacity * layerMotion.metaOpacity,
								transform: layerMotion.metaTransform,
								...theme.date,
							}}
						>
							{scene.newsDate}
						</div>
					)}
				{scene.newsDate && theme.showDate && theme.datePlacement === "meta" && (
					<div
						style={{
							opacity: typo.metaOpacity * layerMotion.metaOpacity,
							transform: layerMotion.metaTransform,
							...theme.metaRow,
						}}
					>
						<div style={theme.date}>{scene.newsDate}</div>
					</div>
				)}
				<div
					style={{
						transform:
							`${typo.titleTransform} ${layerMotion.titleTransform}`.trim(),
						opacity: layerMotion.titleOpacity,
						letterSpacing: `${typo.titleLetterSpacing}px`,
						...theme.title,
					}}
				>
					{title}
				</div>
				{theme.showSource &&
					renderedSource &&
					theme.sourcePlacement === "footer" && (
						<div
							style={{
								opacity: typo.metaOpacity * layerMotion.sourceOpacity,
								transform: layerMotion.sourceTransform,
								...theme.source,
							}}
						>
							{renderedSource}
						</div>
					)}
			</div>
		</AbsoluteFill>
	);
}

/** SFX 오디오 레이어 — 씬 시작/트랜지션 효과음 */
function normalizeSfxFile(file: string) {
	return file.replace(/^\/+/, "").replace(/^sfx\//, "");
}

function SfxCue({ file, volume }: { file: string; volume: number }) {
	const frame = useCurrentFrame();
	return (
		<Audio
			src={staticFile(`sfx/${normalizeSfxFile(file)}`)}
			volume={interpolate(frame, [0, 4], [0, volume], {
				extrapolateRight: "clamp",
			})}
			startFrom={0}
		/>
	);
}

function pickShotSfx(
	category: SfxCategory | string | undefined,
	seed: number,
): SfxEntry | undefined {
	if (!category || category === "none") return undefined;
	const matches = SFX_CATALOG.filter((entry) => entry.category === category);
	if (matches.length === 0) return undefined;
	return matches[Math.abs(seed) % matches.length];
}

function ShotSfxLayer({ scene }: { scene: RemotionScene }) {
	const timeline = useMemo(
		() =>
			buildShotTimeline(scene.shots, scene.durationInFrames, {
				wordTimings: scene.wordTimings,
			}),
		[scene.shots, scene.durationInFrames, scene.wordTimings],
	);
	if (timeline.length === 0) return null;
	const maxShotSfx = scene.durationInFrames < 180 ? 3 : 6;
	const selectedShotIds = new Set(
		[...timeline]
			.filter((entry) => {
				const cue = entry.shot.sfx_cue;
				return Boolean(cue?.category && cue.category !== "none");
			})
			.sort(
				(a, b) =>
					(b.shot.sfx_cue?.intensity ?? 0) - (a.shot.sfx_cue?.intensity ?? 0),
			)
			.slice(0, maxShotSfx)
			.map((entry) => entry.shot.id),
	);
	return (
		<>
			{timeline.map((entry, index) => {
				const cue = entry.shot.sfx_cue;
				const sfx = pickShotSfx(cue?.category, index);
				if (!cue || !sfx || !selectedShotIds.has(entry.shot.id)) return null;
				const localOffset =
					entry.shot.kind === "punch"
						? Math.max(0, entry.durationInFrames - 8)
						: Math.min(6, Math.max(0, entry.durationInFrames - 1));
				const from = clamp(
					entry.from + localOffset,
					0,
					Math.max(0, scene.durationInFrames - 1),
				);
				const durationInFrames = Math.max(
					1,
					Math.min(
						Math.ceil(sfx.duration * 30),
						Math.max(1, scene.durationInFrames - from),
					),
				);
				const volume = clamp(
					sfx.volume * (0.6 + clamp(cue.intensity, 0, 1) * 0.55),
					0,
					0.75,
				);
				return (
					<Sequence
						key={`${entry.shot.id}-${cue.category}-${index}`}
						from={from}
						durationInFrames={durationInFrames}
					>
						<SfxCue file={sfx.file} volume={volume} />
					</Sequence>
				);
			})}
		</>
	);
}

function SfxLayer({ scene }: { scene: RemotionScene }) {
	const { durationInFrames } = scene;
	const enterFrom = clamp(
		scene.enterSfxFromFrame ?? 0,
		0,
		Math.max(0, durationInFrames - 1),
	);
	const enterDuration = Math.max(
		1,
		Math.min(scene.enterSfxDurationFrames ?? 30, durationInFrames - enterFrom),
	);
	const transitionFrom = clamp(
		scene.transitionSfxFromFrame ??
			Math.max(0, durationInFrames - (scene.transitionSfxDurationFrames ?? 24)),
		0,
		Math.max(0, durationInFrames - 1),
	);
	const transitionDuration = Math.max(
		1,
		Math.min(
			scene.transitionSfxDurationFrames ?? 24,
			durationInFrames - transitionFrom,
		),
	);

	return (
		<>
			<ShotSfxLayer scene={scene} />
			{scene.enterSfxFile && (
				<Sequence from={enterFrom} durationInFrames={enterDuration}>
					<SfxCue
						file={scene.enterSfxFile}
						volume={scene.enterSfxVolume ?? 0.4}
					/>
				</Sequence>
			)}
			{scene.transitionSfxFile && (
				<Sequence from={transitionFrom} durationInFrames={transitionDuration}>
					<SfxCue
						file={scene.transitionSfxFile}
						volume={scene.transitionSfxVolume ?? 0.35}
					/>
				</Sequence>
			)}
		</>
	);
}

// ─── 뉴스 오버레이 씬 ───

function NewsOverlayView({
	scene,
	subtitleStyle: sub = DEFAULT_SUBTITLE,
	fadeOutFrames,
	hasGlobalNarration = false,
	captionStyle = "chunked",
	subtitlePosition = "bottom",
	subtitleBgStyle = "stroke",
	subtitleAccentColor = "#FFD700",
	suppressAudio = false,
}: SceneProps) {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	const audioVolume = useAudioVolume(durationInFrames);
	const viewOpacity = useTailFade(durationInFrames, fadeOutFrames);
	const subtitleOpacity = useSubtitleOpacity(durationInFrames, fadeOutFrames);
	const layout = useLayoutMode();
	const activeShot = useActiveShot(
		scene.shots,
		durationInFrames,
		scene.wordTimings,
	);

	const cardY = interpolate(frame, [4, 20], [40, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const cardOpacity = interpolate(frame, [4, 20], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const scaleTransform = computeShotMotion(
		activeShot.shot,
		activeShot.localFrame,
		activeShot.durationInFrames,
		layout.baseScale,
		layout.vertical,
		scene.narration,
		scene.mood,
	);
	const speechMicro = computeAnimationSpeechStyle(
		activeShot.shot,
		frame,
		scene.wordTimings,
	);
	const newsImageMotion = mergeMotionStyles(scaleTransform, speechMicro);

	const shotImageUrl = activeShot.shot?.source_url || scene.imageUrl;
	const hasImage = Boolean(shotImageUrl);
	const titleMotion = computeOverlayTypographyStyle({
		frame,
		wordTimings: scene.wordTimings,
		durationInFrames,
		hookBoost: scene.hookBoost,
	});
	const cardLayerMotion = computeNewsCardLayerMotion({
		frame,
		wordTimings: scene.wordTimings,
		durationInFrames,
		hookBoost: scene.hookBoost,
	});
	const cardTone = inferNewsSurfaceTone({
		narration: scene.narration,
		newsTitle: scene.newsTitle,
		newsExcerpt: scene.newsExcerpt,
		shotKind: activeShot.shot?.kind,
	});
	const cardTheme = getNewsCardTheme({
		mood: scene.mood,
		hookBoost: scene.hookBoost,
		tone: cardTone,
	});

	return (
		<AbsoluteFill style={{ opacity: viewOpacity }}>
			{/* 배경 */}
			{hasImage ? (
				<AbsoluteFill style={{ overflow: "hidden" }}>
					<Img
						src={shotImageUrl}
						style={{
							width: "100%",
							height: "100%",
							objectFit: "cover",
							...newsImageMotion,
							filter: [newsImageMotion.filter, "brightness(0.4)"]
								.filter(Boolean)
								.join(" "),
						}}
					/>
				</AbsoluteFill>
			) : (
				<AbsoluteFill
					style={{
						background:
							"linear-gradient(135deg, #0d1117 0%, #161b22 50%, #1a1f2e 100%)",
					}}
				/>
			)}
			<AnimationPerformanceOverlay
				scene={scene}
				shot={activeShot.shot}
				sceneFrame={frame}
				localFrame={activeShot.localFrame}
				durationInFrames={activeShot.durationInFrames}
			/>
			<EditorialRhythmOverlay
				scene={scene}
				shot={activeShot.shot}
				sceneFrame={frame}
				localFrame={activeShot.localFrame}
				durationInFrames={activeShot.durationInFrames}
				isVideoShot={false}
			/>

			{/* 오버레이 스택 */}
			<OverlayStack scene={scene} />
			<ShotOverlay scene={scene} shot={activeShot.shot} />

			{/* 뉴스 카드 */}
			<AbsoluteFill
				style={{
					justifyContent: "center",
					alignItems: "center",
					padding: `${layout.topPad}px ${layout.cardPad}px ${layout.bottomPad}px`,
				}}
			>
				<div
					style={{
						transform: `translateY(${cardY}px) ${titleMotion.containerTransform}`,
						opacity: cardOpacity * titleMotion.containerOpacity,
						...cardTheme.card,
						padding: layout.vertical ? "32px 28px" : "48px 56px",
						maxWidth: layout.cardMaxWidth,
					}}
				>
					<div
						style={{
							...cardTheme.label.style,
							transform: cardLayerMotion.labelTransform,
							opacity: cardLayerMotion.labelOpacity,
						}}
					>
						{cardTheme.label.text}
					</div>
					{scene.newsDate &&
						cardTheme.datePlacement === "badge" &&
						cardTheme.dateBadge && (
							<div
								style={{
									...cardTheme.dateBadge,
									transform: cardLayerMotion.metaTransform,
									opacity:
										titleMotion.metaOpacity * cardLayerMotion.metaOpacity,
								}}
							>
								{scene.newsDate}
							</div>
						)}
					{(scene.newsSource ||
						(scene.newsDate && cardTheme.datePlacement === "meta")) && (
						<div
							style={{
								opacity: titleMotion.metaOpacity * cardLayerMotion.metaOpacity,
								transform: cardLayerMotion.metaTransform,
								...cardTheme.metaRow,
							}}
						>
							{scene.newsSource && (
								<span
									style={{
										fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
										...cardTheme.source,
									}}
								>
									{scene.newsSource}
								</span>
							)}
							{scene.newsDate && cardTheme.datePlacement === "meta" && (
								<span
									style={{
										fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
										...cardTheme.date,
									}}
								>
									{scene.newsDate}
								</span>
							)}
						</div>
					)}

					{scene.newsTitle && (
						<p
							style={{
								margin: 0,
								marginBottom: scene.newsExcerpt ? 20 : 0,
								letterSpacing: `${-0.02 + titleMotion.titleLetterSpacing / 100}em`,
								transform:
									`${titleMotion.titleTransform} ${cardLayerMotion.titleTransform}`.trim(),
								opacity: cardLayerMotion.titleOpacity,
								...cardTheme.title,
							}}
						>
							{scene.newsTitle}
						</p>
					)}

					{scene.newsExcerpt && (
						<p
							style={{
								margin: 0,
								opacity:
									titleMotion.metaOpacity * cardLayerMotion.excerptOpacity,
								transform: cardLayerMotion.excerptTransform,
								...cardTheme.excerpt,
							}}
						>
							{scene.newsExcerpt}
						</p>
					)}
				</div>
			</AbsoluteFill>

			{/* 하단 나레이션 자막 */}
			<AbsoluteFill
				style={{
					justifyContent: positionToFlex(
						subtitlePosition,
						false,
						scene.shot_type,
					),
					alignItems: "center",
					padding: `${layout.topPad}px ${layout.sidePad}px ${layout.bottomPad}px`,
				}}
			>
				<div
					style={{ maxWidth: layout.captionMaxWidth, opacity: subtitleOpacity }}
				>
					<NarrationCaption
						scene={scene}
						sub={sub}
						captionStyle={captionStyle}
						bgStyle={subtitleBgStyle}
						accentColor={subtitleAccentColor}
					/>
				</div>
			</AbsoluteFill>

			{scene.audioUrl && !hasGlobalNarration && !suppressAudio && (
				<Audio src={scene.audioUrl} volume={audioVolume} />
			)}
		</AbsoluteFill>
	);
}

// ─── 기본 이미지/텍스트 강조 씬 ───

function DefaultSceneView({
	scene,
	sceneStartFrame = 0,
	subtitleStyle: sub = DEFAULT_SUBTITLE,
	fadeOutFrames,
	hasGlobalNarration = false,
	captionStyle = "chunked",
	subtitlePosition = "bottom",
	subtitleBgStyle = "stroke",
	subtitleAccentColor = "#FFD700",
	suppressAudio = false,
	usage = "render",
}: SceneProps) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const { durationInFrames } = scene;
	const audioVolume = useAudioVolume(durationInFrames);
	const viewOpacity = useTailFade(durationInFrames, fadeOutFrames);
	const layout = useLayoutMode();
	const activeShot = useActiveShot(
		scene.shots,
		durationInFrames,
		scene.wordTimings,
	);
	const { isReady: proxyReady } = useProxyAvailable(
		scene.videoUrl ?? scene.imageUrl,
		scene.videoUrl ?? "",
	);
	const activeShotVideoUrl =
		activeShot.shot?.media_type === "video"
			? activeShot.shot.source_url || scene.videoUrl
			: "";
	const hasVideo = Boolean(activeShotVideoUrl);
	const videoSrc = resolveVideoSrc(activeShotVideoUrl, staticFile, {
		usage,
		proxyAvailable: proxyReady,
	});
	const trimStart = secondsToFrames(activeShot.shot?.trim_start, fps);
	const trimEnd = shotEndAtFrame(
		activeShot.shot,
		fps,
		trimStart,
		activeShot.durationInFrames,
	);

	const kbBase = computeShotMotion(
		activeShot.shot,
		activeShot.localFrame,
		activeShot.durationInFrames,
		layout.baseScale,
		layout.vertical,
		scene.narration,
		scene.mood,
	);
	// beat-pulse: BGM 비트에 맞춰 배경 비주얼만 미세 줌펀치(자막 제외). 컴포지션 절대 프레임
	// (sceneStartFrame=전환 오버랩 반영) 기준으로 절대 비트(초)와 매칭 → 다중 씬 누적 드리프트 없음.
	// export 경로는 BGM startFrom=0(seek 안 함)이라 트랙 비트시간=컴포지션 시간이므로 그대로 매칭.
	const beatPulse = computeBeatPulseScale({
		sceneStartFrame,
		frame: sceneStartFrame + frame,
		beatTimes: scene.beatTimes ?? [],
		fps,
		intensity: 1.05,
		pulseWidthFrames: 5,
	});
	const kb =
		beatPulse > 1
			? {
					...kbBase,
					transform: `${kbBase.transform ?? ""} scale(${beatPulse.toFixed(4)})`,
				}
			: kbBase;
	const emphasisTone = inferNewsSurfaceTone({
		narration: scene.narration,
		newsTitle: scene.newsTitle,
		newsExcerpt: scene.newsExcerpt,
		shotKind: activeShot.shot?.kind,
	});
	const micro = computeMicroEditStyle({
		frame,
		durationInFrames,
		wordTimings: scene.wordTimings,
		hookBoost: scene.hookBoost,
		vertical: layout.vertical,
		isVideo: hasVideo,
		kind: activeShot.shot?.kind ?? emphasisTone,
	});
	const speechMicro = computeAnimationSpeechStyle(
		activeShot.shot,
		frame,
		scene.wordTimings,
	);

	const subtitleOpacity = useSubtitleOpacity(durationInFrames, fadeOutFrames);

	const isEmphasis = scene.type === "text_emphasis";
	const textEffect = scene.textEffect ?? "none";
	const emphasisTheme = getNewsCardTheme({
		mood: scene.mood,
		hookBoost: scene.hookBoost,
		tone: emphasisTone,
	});
	const emphasisWords = useMemo(
		() =>
			scene.wordTimings ??
			generateWordTimings(scene.narration, scene.durationInFrames),
		[scene.wordTimings, scene.narration, scene.durationInFrames],
	);
	const emphasisCueTheme = computeTextEmphasisCueTheme({
		tone: emphasisTone,
		frame,
		wordTimings: emphasisWords,
		durationInFrames,
		accentColor: emphasisTheme.accentColor,
		hookBoost: scene.hookBoost,
	});
	const emphasisLayout = useMemo(
		() => computeTextEmphasisLayout(scene.narration),
		[scene.narration],
	);
	const emphasisLayerMotion = computeTextEmphasisLayerMotion({
		frame,
		wordTimings: scene.wordTimings,
		durationInFrames,
		hookBoost: scene.hookBoost,
		tone: emphasisTone,
	});
	const emphasisLeadWords =
		emphasisLayout.variant === "stacked" && emphasisLayout.splitWordIndex
			? emphasisWords.slice(0, emphasisLayout.splitWordIndex)
			: [];
	const emphasisFocusWords =
		emphasisLayout.variant === "stacked" && emphasisLayout.splitWordIndex
			? emphasisWords.slice(emphasisLayout.splitWordIndex)
			: emphasisWords;
	const shotImageUrl =
		activeShot.shot?.source_url && !scene.videoUrl
			? activeShot.shot.source_url
			: scene.imageUrl;

	// 뉴스/자료 이미지 프레임 모드: 명시적 isNewsPhoto 플래그 사용
	// true → 블러 배경 + 중앙 프레임 (미스테리 채널 스타일)
	// sourceAttribution은 LowerThird 출처 표시에만 사용 (별개)
	const isNewsPhoto = Boolean(shotImageUrl) && (scene.isNewsPhoto ?? false);
	const hasAnyNarration = hasGlobalNarration || Boolean(scene.audioUrl);
	const videoBaseVol = hasAnyNarration ? 0.12 : 0.55;
	const videoVolume = videoBaseVol * audioVolume;
	const videoObjectFit = getShotObjectFit(activeShot.shot?.crop);

	return (
		<AbsoluteFill style={{ opacity: viewOpacity }}>
			{/* 배경 이미지 */}
			{hasVideo ? (
				<AbsoluteFill style={{ overflow: "hidden" }}>
					<Sequence
						from={activeShot.from}
						durationInFrames={activeShot.durationInFrames}
					>
						<Video
							src={videoSrc}
							startFrom={trimStart}
							endAt={trimEnd}
							volume={videoVolume}
							style={mergeMotionStyles(
								mergeMotionStyles(
									{
										width: "100%",
										height: "100%",
										objectFit: videoObjectFit,
										background: "#050505",
										...kb,
									},
									micro,
								),
								speechMicro,
							)}
						/>
					</Sequence>
				</AbsoluteFill>
			) : shotImageUrl && !isNewsPhoto ? (
				// 일반 이미지 — 풀스크린 Ken Burns
				<AbsoluteFill style={{ overflow: "hidden" }}>
					<Img
						src={shotImageUrl}
						style={mergeMotionStyles(
							mergeMotionStyles(
								{
									width: "100%",
									height: "100%",
									objectFit: "cover",
									...kb,
								},
								micro,
							),
							speechMicro,
						)}
					/>
				</AbsoluteFill>
			) : shotImageUrl && isNewsPhoto ? (
				// 뉴스/자료 이미지 — 블러 배경 + 중앙 프레임
				<AbsoluteFill>
					{/* 블러 배경 */}
					<AbsoluteFill style={{ overflow: "hidden" }}>
						<Img
							src={shotImageUrl}
							style={{
								width: "100%",
								height: "100%",
								objectFit: "cover",
								filter: "blur(30px) brightness(0.3)",
								transform: "scale(1.2)",
							}}
						/>
					</AbsoluteFill>
					{/* 어두운 비네트 */}
					<AbsoluteFill
						style={{
							background:
								"radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)",
						}}
					/>
					{/* 중앙 프레임 사진 — Ken Burns 적용 */}
					<AbsoluteFill
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: layout.vertical ? "120px 40px" : "60px 200px",
						}}
					>
						<div
							style={mergeMotionStyles(
								mergeMotionStyles(
									{
										position: "relative",
										maxWidth: layout.vertical ? "85%" : "65%",
										maxHeight: "70%",
										boxShadow:
											"0 8px 60px rgba(0,0,0,0.8), 0 0 0 2px rgba(255,255,255,0.1)",
										borderRadius: 4,
										overflow: "hidden",
										...kb,
									},
									micro,
								),
								speechMicro,
							)}
						>
							<Img
								src={shotImageUrl}
								style={{
									width: "100%",
									height: "100%",
									objectFit: "contain",
									display: "block",
								}}
							/>
						</div>
					</AbsoluteFill>
				</AbsoluteFill>
			) : (
				<AbsoluteFill
					style={{
						background:
							"linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
					}}
				/>
			)}
			<AnimationPerformanceOverlay
				scene={scene}
				shot={activeShot.shot}
				sceneFrame={frame}
				localFrame={activeShot.localFrame}
				durationInFrames={activeShot.durationInFrames}
			/>
			<EditorialRhythmOverlay
				scene={scene}
				shot={activeShot.shot}
				sceneFrame={frame}
				localFrame={activeShot.localFrame}
				durationInFrames={activeShot.durationInFrames}
				isVideoShot={hasVideo}
			/>

			{/* 어두운 오버레이 */}
			{isEmphasis && (
				<AbsoluteFill style={{ backgroundColor: "rgba(0, 0, 0, 0.6)" }} />
			)}

			{/* 하단 그라데이션 — 쇼츠는 더 넓은 그라데이션 */}
			{!isEmphasis && (
				<AbsoluteFill
					style={{
						background: layout.vertical
							? "linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 40%, transparent 60%)"
							: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 30%, transparent 50%)",
					}}
				/>
			)}

			{/* 오버레이 스택 */}
			<OverlayStack scene={scene} />
			<ShotOverlay scene={scene} shot={activeShot.shot} />

			{/* 자막 */}
			<AbsoluteFill
				style={{
					justifyContent: positionToFlex(
						subtitlePosition,
						isEmphasis,
						scene.shot_type,
					),
					alignItems: "center",
					padding: `${layout.topPad}px ${layout.sidePad}px ${layout.bottomPad}px`,
				}}
			>
				<div
					style={{
						maxWidth: layout.captionMaxWidth,
						opacity: subtitleOpacity,
					}}
				>
					{isEmphasis ? (
						<CinematicTextEmphasis
							scene={scene}
							sub={sub}
							frame={frame}
							durationInFrames={durationInFrames}
							leadWords={emphasisLeadWords}
							focusWords={emphasisFocusWords}
							accentColor={emphasisTheme.accentColor}
							label={emphasisTheme.label.text}
							source={scene.sourceAttribution || scene.newsSource}
							date={scene.newsDate}
							tone={emphasisTone}
							textEffect={textEffect}
							isStacked={emphasisLayout.variant === "stacked"}
							vertical={layout.vertical}
							opacity={subtitleOpacity * emphasisLayerMotion.cardOpacity}
							shellOverlay={emphasisCueTheme.shellOverlay}
							accentOverlay={emphasisCueTheme.accentOverlay}
							labelCue={emphasisCueTheme.labelCue}
							labelTransform={emphasisLayerMotion.labelTransform}
							labelOpacity={emphasisLayerMotion.labelOpacity}
							metaTransform={emphasisLayerMotion.metaTransform}
							metaOpacity={emphasisLayerMotion.metaOpacity}
							titleTransform={emphasisLayerMotion.titleTransform}
							titleOpacity={emphasisLayerMotion.titleOpacity}
							cardTransform={emphasisLayerMotion.cardTransform}
						/>
					) : (
						<NarrationCaption
							scene={scene}
							sub={sub}
							emphasis={isEmphasis}
							captionStyle={captionStyle}
							bgStyle={subtitleBgStyle}
							accentColor={subtitleAccentColor}
						/>
					)}
				</div>
			</AbsoluteFill>

			{scene.audioUrl && !hasGlobalNarration && !suppressAudio && (
				<Audio src={scene.audioUrl} volume={audioVolume} />
			)}
		</AbsoluteFill>
	);
}

// ─── 비디오 클립 씬 ───

function SocialClipCardSceneView({
	scene,
	brand,
	fadeOutFrames,
	hasGlobalNarration = false,
	subtitleAccentColor = "#FFD64A",
	suppressAudio = false,
	usage = "render",
}: SceneProps) {
	const frame = useCurrentFrame();
	const { durationInFrames } = scene;
	const { width, height, fps } = useVideoConfig();
	const audioVolume = useAudioVolume(durationInFrames);
	const viewOpacity = useTailFade(durationInFrames, fadeOutFrames);
	const activeShot = useActiveShot(
		scene.shots,
		durationInFrames,
		scene.wordTimings,
	);
	const progress = clamp(frame / Math.max(1, durationInFrames - 1), 0, 1);
	const handle = brand?.channelHandle?.trim() ?? "";
	const title = scene.newsTitle || scene.sourceAttribution || scene.narration;
	const titleLines = splitReadableLines(title, 13, 2);
	const captionSource =
		activeShot.shot?.caption || scene.newsExcerpt || scene.narration;
	const captionLines = splitReadableLines(captionSource, 17, 2);
	const hookPill = scene.newsExcerpt ? compactText(scene.newsExcerpt, 38) : "";
	const mediaUrl =
		activeShot.shot?.source_url || scene.videoUrl || scene.imageUrl || "";
	const isVideoShot =
		activeShot.shot?.media_type === "video" ||
		Boolean(scene.videoUrl && mediaUrl === scene.videoUrl) ||
		/\.(mp4|webm|mov)(\?|$)/i.test(mediaUrl);
	const { isReady: proxyReady } = useProxyAvailable(
		scene.videoUrl ?? scene.imageUrl,
		scene.videoUrl ?? "",
	);
	const mediaSrc = resolveVideoSrc(mediaUrl, staticFile, {
		usage,
		proxyAvailable: proxyReady,
	});
	const mediaMotion = computeShotMotion(
		activeShot.shot,
		activeShot.localFrame,
		activeShot.durationInFrames,
		1,
		height > width,
		scene.narration,
		scene.mood,
	);
	const micro = computeMicroEditStyle({
		frame,
		durationInFrames,
		wordTimings: scene.wordTimings,
		hookBoost: scene.hookBoost,
		vertical: height > width,
		isVideo: isVideoShot,
	});
	const mediaStyle = mergeMotionStyles(
		{
			width: "100%",
			height: "100%",
			objectFit: getShotObjectFit(activeShot.shot?.crop),
			background: "#050505",
			...mediaMotion,
		},
		micro,
	);
	const socialTrimStart = secondsToFrames(activeShot.shot?.trim_start, fps);
	const socialEndAt = shotEndAtFrame(
		activeShot.shot,
		fps,
		socialTrimStart,
		activeShot.durationInFrames,
	);
	const captionColor =
		scene.hookBoost || /[?？]|왜|제일|방법/.test(captionSource)
			? subtitleAccentColor
			: "#ffffff";
	const mediaTop = Math.round(height * 0.305);
	const mediaHeight = Math.round(height * 0.32);
	const footerTop = mediaTop + mediaHeight;

	return (
		<AbsoluteFill
			style={{
				opacity: viewOpacity,
				background:
					"linear-gradient(180deg, #ffffff 0%, #ffffff 58%, #eeeeee 100%)",
				overflow: "hidden",
				fontFamily: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
			}}
		>
			<div
				style={{
					position: "absolute",
					inset: 0,
					borderRadius: height > width ? 28 : 0,
					overflow: "hidden",
					background: "#fff",
				}}
			/>

			<div
				style={{
					position: "absolute",
					top: 132,
					left: 62,
					right: 62,
					textAlign: "center",
					fontFamily:
						"'AppleMyungjo', 'Hiragino Mincho ProN', 'Nanum Myeongjo', serif",
					fontWeight: 900,
					color: "#050505",
					letterSpacing: "-0.045em",
					lineHeight: 1.18,
				}}
			>
				{titleLines.map((line, index) => (
					<div
						key={`${line}-${index}`}
						style={{
							fontSize: index === 0 ? 76 : 82,
							transform:
								index === 0
									? `translateY(${Math.sin(frame / 18) * 1.2}px)`
									: undefined,
						}}
					>
						{line}
					</div>
				))}
			</div>

			{hookPill && (
				<div
					style={{
						position: "absolute",
						top: 292,
						left: "50%",
						maxWidth: 650,
						padding: "9px 18px",
						borderRadius: 999,
						transform: "translateX(-50%)",
						background: "rgba(0,0,0,0.62)",
						color: "#fff",
						fontSize: 25,
						fontWeight: 760,
						lineHeight: 1.25,
						textAlign: "center",
						boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
					}}
				>
					{hookPill}
				</div>
			)}

			<div
				style={{
					position: "absolute",
					top: mediaTop,
					left: 0,
					width,
					height: mediaHeight,
					overflow: "hidden",
					background: "#111",
				}}
			>
				{mediaSrc ? (
					<Sequence
						from={activeShot.from}
						durationInFrames={activeShot.durationInFrames}
					>
						{isVideoShot ? (
							<Video
								src={mediaSrc}
								style={mediaStyle}
								startFrom={socialTrimStart}
								endAt={socialEndAt}
								volume={hasGlobalNarration ? 0.08 : 0.42}
							/>
						) : (
							<Img src={mediaSrc} style={mediaStyle} />
						)}
					</Sequence>
				) : (
					<div
						style={{
							width: "100%",
							height: "100%",
							background:
								"radial-gradient(circle at 50% 40%, #394457 0%, #11151d 62%, #050608 100%)",
						}}
					/>
				)}
				<div
					style={{
						position: "absolute",
						inset: 0,
						background:
							"linear-gradient(180deg, rgba(0,0,0,0.04) 0%, transparent 44%, rgba(0,0,0,0.46) 100%)",
					}}
				/>
				<div
					style={{
						position: "absolute",
						left: 38,
						top: 34,
						padding: "8px 12px",
						borderRadius: 8,
						background: "#ffcf21",
						color: "#ed1b3a",
						fontSize: 27,
						fontWeight: 950,
						letterSpacing: "-0.05em",
						boxShadow: "0 4px 0 rgba(0,0,0,0.22)",
					}}
				>
					핫클립
				</div>
				<div
					style={{
						position: "absolute",
						left: 44,
						right: 44,
						bottom: 38,
						textAlign: "center",
						color: captionColor,
						fontSize: 55,
						fontWeight: 930,
						lineHeight: 1.18,
						letterSpacing: "-0.045em",
						textShadow: "0 4px 0 rgba(0,0,0,0.86), 0 0 18px rgba(0,0,0,0.72)",
					}}
				>
					{captionLines.map((line, index) => (
						<div key={`${line}-${index}`}>{line}</div>
					))}
				</div>
			</div>

			<div
				style={{
					position: "absolute",
					top: footerTop,
					left: 0,
					right: 0,
					height: height - footerTop,
					background:
						"linear-gradient(180deg, #ffffff 0%, #f9f9f7 48%, #d4d4d4 100%)",
				}}
			/>

			{handle && (
				<div
					style={{
						position: "absolute",
						top: footerTop + 236,
						left: 92,
						display: "flex",
						alignItems: "center",
						gap: 16,
					}}
				>
					<div
						style={{
							width: 62,
							height: 62,
							borderRadius: 999,
							background: "#ffd21f",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#fff",
							fontSize: 34,
							fontWeight: 950,
						}}
					>
						♪
					</div>
					<div style={{ color: "#111", fontSize: 30, fontWeight: 900 }}>
						{handle}
					</div>
					<div
						style={{
							marginLeft: 6,
							padding: "12px 30px",
							borderRadius: 999,
							background: "#fff",
							color: "#111",
							fontSize: 29,
							fontWeight: 900,
							boxShadow: "0 4px 18px rgba(0,0,0,0.16)",
						}}
					>
						구독
					</div>
				</div>
			)}

			<div
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: 0,
					height: 8,
					background: "rgba(0,0,0,0.15)",
				}}
			>
				<div
					style={{
						width: `${progress * 100}%`,
						height: "100%",
						background: "#ff174b",
					}}
				/>
			</div>

			{scene.audioUrl && !hasGlobalNarration && !suppressAudio && (
				<Audio src={scene.audioUrl} volume={audioVolume} />
			)}
		</AbsoluteFill>
	);
}

function VideoSceneView({
	scene,
	sceneStartFrame = 0,
	subtitleStyle: sub = DEFAULT_SUBTITLE,
	fadeOutFrames,
	hasGlobalNarration = false,
	captionStyle = "chunked",
	subtitlePosition = "bottom",
	subtitleBgStyle = "stroke",
	subtitleAccentColor = "#FFD700",
	suppressAudio = false,
	usage = "render",
}: SceneProps) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const { durationInFrames } = scene;
	const audioVolume = useAudioVolume(durationInFrames);
	const viewOpacity = useTailFade(durationInFrames, fadeOutFrames);
	const layout = useLayoutMode();
	// During RENDER use OffthreadVideo (ffmpeg frame extraction) — Chrome's
	// <Video>/<Html5Video> stalls on frame-accurate seeks in headless and trips
	// delayRender timeouts (esp. for screen-recorded chart clips). Preview keeps
	// <Video> for scrubbing. Runtime uses OffthreadVideo; props are Video-compatible.
	const VideoTag = (
		usage === "render" ? OffthreadVideo : Video
	) as typeof Video;

	const shotTimeline = useMemo(
		() =>
			buildShotTimeline(scene.shots, durationInFrames, {
				wordTimings: scene.wordTimings,
			}),
		[scene.shots, durationInFrames, scene.wordTimings],
	);
	const activeShot = useActiveShot(
		scene.shots,
		durationInFrames,
		scene.wordTimings,
	);
	const { isReady: proxyReady } = useProxyAvailable(
		scene.videoUrl ?? scene.imageUrl,
		scene.videoUrl ?? "",
	);

	const subtitleOpacity = useSubtitleOpacity(durationInFrames, fadeOutFrames);

	const baseVideoUrl = scene.videoUrl ?? "";
	const videoSrc = resolveVideoSrc(baseVideoUrl, staticFile, {
		usage,
		proxyAvailable: proxyReady,
	});

	const hasAnyNarration = hasGlobalNarration || Boolean(scene.audioUrl);
	const videoBaseVol = hasAnyNarration ? 0.22 : 0.8;
	const videoVolume = videoBaseVol * audioVolume;

	return (
		<AbsoluteFill style={{ opacity: viewOpacity }}>
			{shotTimeline.length > 0 ? (
				shotTimeline.map((entry) => {
					const localF = frame - entry.from;
					const fadeFrames = clamp(
						shotBoundaryFadeFrames(entry.shot, scene),
						1,
						Math.max(1, Math.floor(entry.durationInFrames / 3)),
					);
					const fadeIn = interpolate(localF, [-fadeFrames, 0], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					});
					const fadeOut = interpolate(
						localF,
						[entry.durationInFrames - fadeFrames, entry.durationInFrames],
						[1, 0],
						{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
					);
					const opacity = Math.min(fadeIn, fadeOut);
					if (opacity <= 0) return null;

					const isVideoShot = entry.shot.media_type !== "image";
					const sequenceFrom = Math.max(0, entry.from - fadeFrames);
					const sequenceLeadFrames = entry.from - sequenceFrom;
					const videoStartFrame = secondsToFrames(entry.shot.trim_start, fps);
					const startFrom = Math.max(0, videoStartFrame - sequenceLeadFrames);
					const endAt = shotEndAtFrame(
						entry.shot,
						fps,
						startFrom,
						entry.durationInFrames + sequenceLeadFrames,
					);
					const shotUrl = isVideoShot
						? entry.shot.source_url || baseVideoUrl
						: entry.shot.source_url || scene.imageUrl;
					const shotSrc = resolveVideoSrc(shotUrl, staticFile, {
						usage,
						proxyAvailable: proxyReady,
					});
					const motionBase = computeShotMotion(
						entry.shot,
						Math.max(0, localF),
						entry.durationInFrames,
						layout.baseScale,
						layout.vertical,
						scene.narration,
						scene.mood,
					);
					// beat-pulse: 컴포지션 절대 프레임 기준 BGM 비트 줌펀치(영상 씬에도 적용).
					const beatPulse = computeBeatPulseScale({
						sceneStartFrame,
						frame: sceneStartFrame + frame,
						beatTimes: scene.beatTimes ?? [],
						fps,
						intensity: 1.05,
						pulseWidthFrames: 5,
					});
					const motion =
						beatPulse > 1
							? {
									...motionBase,
									transform: `${motionBase.transform ?? ""} scale(${beatPulse.toFixed(4)})`,
								}
							: motionBase;
					const micro = computeMicroEditStyle({
						frame,
						durationInFrames,
						wordTimings: scene.wordTimings,
						hookBoost: scene.hookBoost,
						vertical: layout.vertical,
						isVideo: isVideoShot,
					});
					const speechMicro = computeAnimationSpeechStyle(
						entry.shot,
						frame,
						scene.wordTimings,
					);

					const shotFilter = entry.shot.colorGraph
						? compileColorGraphToCss(entry.shot.colorGraph).css
						: undefined;

					return (
						<Sequence
							key={entry.shot.id}
							from={sequenceFrom}
							durationInFrames={entry.durationInFrames + sequenceLeadFrames}
						>
							<AbsoluteFill
								style={{
									opacity,
									overflow: "hidden",
									filter: shotFilter || undefined,
								}}
							>
								{isVideoShot && shotSrc ? (
									<VideoTag
										src={shotSrc}
										startFrom={startFrom}
										style={mergeMotionStyles(
											mergeMotionStyles(
												{
													width: "100%",
													height: "100%",
													objectFit: getShotObjectFit(entry.shot.crop),
													background: "#050505",
													...motion,
												},
												micro,
											),
											speechMicro,
										)}
										volume={opacity * videoVolume}
										endAt={endAt}
									/>
								) : shotSrc ? (
									<Img
										src={shotSrc}
										style={mergeMotionStyles(
											mergeMotionStyles(
												{
													width: "100%",
													height: "100%",
													objectFit: "cover",
													...motion,
												},
												micro,
											),
											speechMicro,
										)}
									/>
								) : null}
								<AnimationPerformanceOverlay
									scene={scene}
									shot={entry.shot}
									sceneFrame={frame}
									localFrame={Math.max(0, localF)}
									durationInFrames={entry.durationInFrames}
								/>
								<EditorialRhythmOverlay
									scene={scene}
									shot={entry.shot}
									sceneFrame={frame}
									localFrame={Math.max(0, localF)}
									durationInFrames={entry.durationInFrames}
									isVideoShot={isVideoShot}
								/>
							</AbsoluteFill>
						</Sequence>
					);
				})
			) : videoSrc ? (
				<AbsoluteFill>
					{(() => {
						const micro = computeMicroEditStyle({
							frame,
							durationInFrames,
							wordTimings: scene.wordTimings,
							hookBoost: scene.hookBoost,
							vertical: layout.vertical,
							isVideo: true,
						});
						return (
							<>
								<VideoTag
									src={videoSrc}
									startFrom={0}
									style={mergeMotionStyles(
										{ width: "100%", height: "100%", objectFit: "cover" },
										micro,
									)}
									volume={videoVolume}
								/>
								<EditorialRhythmOverlay
									scene={scene}
									sceneFrame={frame}
									localFrame={frame}
									durationInFrames={durationInFrames}
									isVideoShot={true}
								/>
							</>
						);
					})()}
				</AbsoluteFill>
			) : (
				<AbsoluteFill
					style={{
						background:
							"linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
					}}
				/>
			)}

			{/* 하단 그라데이션 */}
			<AbsoluteFill
				style={{
					background: layout.vertical
						? "linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.4) 40%, transparent 60%)"
						: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 30%, transparent 50%)",
				}}
			/>

			{/* 오버레이 스택 */}
			<OverlayStack scene={scene} />
			<ShotOverlay scene={scene} shot={activeShot.shot} />

			{/* 자막 */}
			<AbsoluteFill
				style={{
					justifyContent: positionToFlex(
						subtitlePosition,
						false,
						scene.shot_type,
					),
					alignItems: "center",
					padding: `${layout.topPad}px ${layout.sidePad}px ${layout.bottomPad}px`,
				}}
			>
				<div
					style={{ maxWidth: layout.captionMaxWidth, opacity: subtitleOpacity }}
				>
					<NarrationCaption
						scene={scene}
						sub={sub}
						captionStyle={captionStyle}
						bgStyle={subtitleBgStyle}
						accentColor={subtitleAccentColor}
					/>
				</div>
			</AbsoluteFill>

			{scene.audioUrl && !hasGlobalNarration && !suppressAudio && (
				<Audio src={scene.audioUrl} volume={audioVolume} />
			)}
		</AbsoluteFill>
	);
}

// ─── 씬 라우터 ───

export function SceneView({
	scene,
	sceneStartFrame = 0,
	brand,
	subtitleStyle,
	fadeOutFrames,
	hasGlobalNarration,
	captionStyle = "chunked",
	subtitlePosition = "bottom",
	subtitleBgStyle = "stroke",
	subtitleAccentColor = "#FFD700",
	layoutVariant,
	suppressAudio = false,
	usage = "render",
}: SceneProps) {
	const props: SceneProps = {
		scene,
		sceneStartFrame,
		brand,
		subtitleStyle,
		fadeOutFrames,
		hasGlobalNarration,
		captionStyle,
		subtitlePosition,
		subtitleBgStyle,
		subtitleAccentColor,
		layoutVariant,
		suppressAudio,
		usage,
	};
	const effectiveLayout = scene.layout ?? layoutVariant;

	const sceneContent = (
		<>
			{effectiveLayout === "social_clip_card" ? (
				<SocialClipCardSceneView {...props} />
			) : scene.type === "news_overlay" ? (
				<NewsOverlayView {...props} />
			) : scene.type === "video" ? (
				<VideoSceneView {...props} />
			) : (
				<DefaultSceneView {...props} />
			)}
			<SfxLayer scene={scene} />
		</>
	);

	const body =
		scene.colorGraphCss && scene.colorGraphCss !== "none" ? (
			<AbsoluteFill style={{ filter: scene.colorGraphCss }}>
				{sceneContent}
			</AbsoluteFill>
		) : (
			sceneContent
		);

	if (!scene.transformKeyframes) return body;

	return (
		<TransformKeyframeLayer tk={scene.transformKeyframes}>
			{body}
		</TransformKeyframeLayer>
	);
}

/**
 * Phase 6 — Scene 로컬 프레임 기반 transform 보간 wrapper.
 * 키프레임 없는 prop 은 identity (SceneView 내부에 이미 있는 기본 transform 그대로).
 */
function TransformKeyframeLayer({
	tk,
	children,
}: {
	tk: NonNullable<RemotionScene["transformKeyframes"]>;
	children: React.ReactNode;
}) {
	const frame = useCurrentFrame();
	const t = evaluateTransformKeyframes(tk, frame);
	const hasMotion =
		t.x !== 0 ||
		t.y !== 0 ||
		t.scale !== 1 ||
		t.rotation !== 0 ||
		t.opacity !== 1;
	if (!hasMotion) return <>{children}</>;
	return (
		<AbsoluteFill
			style={{
				transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale}) rotate(${t.rotation}deg)`,
				transformOrigin: "center center",
				opacity: t.opacity,
				willChange: "transform, opacity",
			}}
		>
			{children}
		</AbsoluteFill>
	);
}

// ─── 자막 렌더러 ───

function NarrationCaption({
	scene,
	sub,
	emphasis = false,
	captionStyle = "chunked",
	bgStyle = "pill",
	accentColor = "#FFD700",
}: {
	scene: RemotionScene;
	sub: Required<SubtitleStyle>;
	emphasis?: boolean;
	captionStyle?: CaptionStyle;
	bgStyle?: SubtitleBgStyle;
	accentColor?: string;
}) {
	const words = useMemo(
		() =>
			scene.wordTimings ??
			generateWordTimings(scene.narration, scene.durationInFrames),
		[scene.wordTimings, scene.narration, scene.durationInFrames],
	);

	if (captionStyle === "none") return null;

	const boostedEmphasis = emphasis || Boolean(scene.hookBoost);
	const captionTone = inferNewsSurfaceTone({
		narration: scene.narration,
		newsTitle: scene.newsTitle,
		newsExcerpt: scene.newsExcerpt,
	});
	const effectiveBgStyle =
		scene.hookBoost && bgStyle === "none"
			? "stroke"
			: bgStyle === "glow"
				? "stroke"
				: bgStyle;
	const effectiveCaptionStyle = captionStyle;

	if (words.length > 0) {
		if (effectiveCaptionStyle === "chunked") {
			return (
				<ChunkedCaption
					words={words}
					style={sub}
					emphasis={boostedEmphasis}
					bgStyle={effectiveBgStyle}
					accentColor={accentColor}
					tone={captionTone}
					hookBoost={Boolean(scene.hookBoost)}
					sceneType={scene.type}
				/>
			);
		}
		return (
			<KaraokeCaption
				words={words}
				style={sub}
				emphasis={boostedEmphasis}
				tone={captionTone}
				accentColor={accentColor}
				hookBoost={Boolean(scene.hookBoost)}
				sceneType={scene.type}
			/>
		);
	}

	// fallback: 일반 텍스트
	return (
		<p
			style={{
				fontSize: boostedEmphasis ? sub.emphasisFontSize : sub.fontSize,
				fontWeight: boostedEmphasis ? 700 : sub.fontWeight,
				lineHeight: 1.6,
				textAlign: "center",
				margin: 0,
				textShadow: scene.hookBoost
					? "0 0 18px rgba(255,215,0,0.35), 0 1px 8px rgba(0,0,0,0.75)"
					: "0 1px 8px rgba(0,0,0,0.6)",
				fontFamily: sub.fontFamily,
				color: sub.color,
			}}
		>
			{scene.narration}
		</p>
	);
}

function hexToRgbaLocal(hex: string, alpha: number) {
	const normalized = hex.replace("#", "");
	if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`;

	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function CinematicTextEmphasis({
	scene,
	sub,
	frame,
	durationInFrames,
	leadWords,
	focusWords,
	accentColor,
	label,
	source,
	date,
	tone,
	textEffect,
	isStacked,
	vertical,
	opacity,
	shellOverlay,
	accentOverlay,
	labelCue,
	labelTransform,
	labelOpacity,
	metaTransform,
	metaOpacity,
	titleTransform,
	titleOpacity,
	cardTransform,
}: {
	scene: RemotionScene;
	sub: Required<SubtitleStyle>;
	frame: number;
	durationInFrames: number;
	leadWords: { word: string; startFrame: number; endFrame: number }[];
	focusWords: { word: string; startFrame: number; endFrame: number }[];
	accentColor: string;
	label: string;
	source?: string;
	date?: string;
	tone: NewsSurfaceTone;
	textEffect: TextEffect;
	isStacked: boolean;
	vertical: boolean;
	opacity: number;
	shellOverlay: React.CSSProperties;
	accentOverlay: React.CSSProperties;
	labelCue: React.CSSProperties;
	labelTransform: string;
	labelOpacity: number;
	metaTransform: string;
	metaOpacity: number;
	titleTransform: string;
	titleOpacity: number;
	cardTransform: string;
}) {
	const leadFontSize = Math.round(
		sub.emphasisFontSize * (vertical ? 0.46 : 0.42),
	);
	const focusFontSize = isStacked
		? Math.round(sub.emphasisFontSize * (vertical ? 0.78 : 0.7))
		: Math.round(sub.emphasisFontSize * (vertical ? 0.92 : 0.86));
	const topSpacing = vertical ? 22 : 26;
	const titleBlock = (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: isStacked ? (vertical ? 18 : 16) : 0,
				textAlign: "center",
				textShadow: "0 9px 34px rgba(0,0,0,0.78), 0 1px 2px rgba(0,0,0,0.9)",
				letterSpacing: scene.hookBoost ? "-0.035em" : "-0.02em",
			}}
		>
			{isStacked && (
				<EmphasisWordLine
					words={leadWords}
					frame={frame}
					fontSize={leadFontSize}
					fontFamily={sub.fontFamily}
					activeColor={accentColor}
					baseColor="rgba(235, 238, 244, 0.84)"
					baseWeight={690}
					align="center"
					tone={tone}
				/>
			)}
			<EmphasisWordLine
				words={focusWords}
				frame={frame}
				fontSize={focusFontSize}
				fontFamily={sub.fontFamily}
				activeColor={accentColor}
				baseColor="#ffffff"
				baseWeight={scene.hookBoost ? 900 : 830}
				align="center"
				tone={tone}
			/>
		</div>
	);

	return (
		<div
			style={{
				position: "relative",
				width: vertical ? "100%" : 1100,
				maxWidth: "100%",
				minHeight: vertical ? 470 : 330,
				padding: vertical ? "38px 22px 42px" : "42px 70px 48px",
				opacity,
				transform: cardTransform,
				borderRadius: 0,
				overflow: "visible",
				background: "transparent",
				boxShadow: "none",
			}}
		>
			<div
				style={{
					position: "absolute",
					inset: vertical ? "-22% -18%" : "-28% -12%",
					background: [
						`radial-gradient(circle at 50% 38%, ${hexToRgbaLocal(accentColor, scene.hookBoost ? 0.34 : 0.24)} 0%, transparent 48%)`,
						"linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.36) 100%)",
					].join(", "),
					filter: "blur(2px)",
					pointerEvents: "none",
				}}
			/>
			<div style={{ ...shellOverlay, borderRadius: "inherit" }} />
			<div style={{ ...accentOverlay, borderRadius: 999 }} />
			<div
				style={{
					position: "absolute",
					top: vertical ? 18 : 22,
					left: "50%",
					width: vertical ? "74%" : "52%",
					height: 4,
					borderRadius: 999,
					background: `linear-gradient(90deg, transparent 0%, ${hexToRgbaLocal(accentColor, 0.95)} 50%, transparent 100%)`,
					boxShadow: `0 0 28px ${hexToRgbaLocal(accentColor, 0.32)}`,
					transform: "translateX(-50%)",
					pointerEvents: "none",
				}}
			/>
			<div
				style={{
					position: "relative",
					zIndex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
				}}
			>
				<div
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 8,
						padding: vertical ? "7px 12px" : "8px 14px",
						borderRadius: 999,
						border: `1px solid ${hexToRgbaLocal(accentColor, 0.38)}`,
						background: "rgba(0,0,0,0.34)",
						color: accentColor,
						fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
						fontSize: vertical ? 17 : 18,
						fontWeight: 820,
						letterSpacing: "0.11em",
						textTransform: "uppercase",
						boxShadow: `0 0 24px ${hexToRgbaLocal(accentColor, 0.16)}`,
						...labelCue,
						transform:
							`${labelTransform} ${String(labelCue.transform ?? "")}`.trim(),
						opacity: labelOpacity,
					}}
				>
					<span
						style={{
							width: 7,
							height: 7,
							borderRadius: 999,
							background: accentColor,
							boxShadow: `0 0 18px ${hexToRgbaLocal(accentColor, 0.72)}`,
						}}
					/>
					{label}
				</div>
				{(source || date) && (
					<div
						style={{
							marginTop: vertical ? 14 : 16,
							display: "flex",
							justifyContent: "center",
							gap: 14,
							flexWrap: "wrap",
							transform: metaTransform,
							opacity: metaOpacity,
							fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
							fontSize: vertical ? 16 : 17,
							fontWeight: 650,
							letterSpacing: "0.02em",
							color: "rgba(229, 231, 235, 0.82)",
							textShadow: "0 2px 10px rgba(0,0,0,0.8)",
						}}
					>
						{source && <span>{source}</span>}
						{source && date && <span style={{ color: accentColor }}>•</span>}
						{date && <span>{date}</span>}
					</div>
				)}
				<div
					style={{
						marginTop: topSpacing,
						transform: titleTransform,
						opacity: titleOpacity,
					}}
				>
					{textEffect !== "none" ? (
						<TextEffectWrapper
							effect={textEffect}
							durationInFrames={durationInFrames}
						>
							{titleBlock}
						</TextEffectWrapper>
					) : (
						titleBlock
					)}
				</div>
			</div>
		</div>
	);
}

function EmphasisWordLine({
	words,
	frame,
	fontSize,
	fontFamily,
	activeColor,
	baseColor,
	baseWeight,
	align = "center",
	tone = "generic",
}: {
	words: { word: string; startFrame: number; endFrame: number }[];
	frame: number;
	fontSize: number;
	fontFamily: string;
	activeColor: string;
	baseColor: string;
	baseWeight: number;
	align?: "center" | "flex-start";
	tone?: "generic" | "witness" | "evidence" | "timeline";
}) {
	if (words.length === 0) return null;

	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				justifyContent: align,
				alignItems: "center",
				gap: 8,
			}}
		>
			{words.map((word, index) => {
				const wordStyle = computeTextEmphasisWordStyle({
					tone,
					word: word.word,
					frame,
					startFrame: word.startFrame,
					endFrame: word.endFrame,
					activeColor,
					baseColor,
					baseWeight,
				});

				return (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: word order is stable; index 는 동일 word+startFrame 중복 분리용
						key={`${word.word}-${word.startFrame}-${index}`}
						style={{
							fontSize,
							fontFamily,
							...wordStyle,
						}}
					>
						{word.word}
					</span>
				);
			})}
		</div>
	);
}
