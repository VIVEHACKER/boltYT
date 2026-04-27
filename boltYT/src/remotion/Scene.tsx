import { useMemo } from "react";
import {
	AbsoluteFill,
	Audio,
	Img,
	interpolate,
	Sequence,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
	Video,
} from "remotion";
import { useProxyAvailable } from "../hooks/useProxyAvailable";
import { compileColorGraphToCss } from "../lib/color-graph-css";
import {
	computeMicroEditStyle,
	computeNewsCardLayerMotion,
	computeOverlayTypographyStyle,
	computeShotOverlayLayerMotion,
	computeTextEmphasisLayerMotion,
} from "../lib/micro-edit";
import {
	getNewsCardTheme,
	inferNewsSurfaceTone,
} from "../lib/news-surface-theme";
import type { SceneShot } from "../lib/scene-shot-types";
import { getShotOverlayTheme } from "../lib/shot-overlay-theme";
import { computeTextEmphasisCueTheme } from "../lib/text-emphasis-cue-theme";
import { computeTextEmphasisWordStyle } from "../lib/text-emphasis-highlight";
import { computeTextEmphasisLayout } from "../lib/text-emphasis-layout";
import { getTextEmphasisSurfaceTheme } from "../lib/text-emphasis-surface-theme";
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
import type { CaptionStyle, RemotionScene, SubtitleStyle } from "./types";
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

function buildShotTimeline(
	shots: SceneShot[] | undefined,
	totalFrames: number,
) {
	if (!shots || shots.length === 0) return [];

	const baseFrames = shots.map((shot) =>
		Math.max(1, Math.round(Math.max(0.4, shot.duration_seconds) * 30)),
	);
	const sum = baseFrames.reduce((acc, value) => acc + value, 0);
	const scaled = baseFrames.map((value) =>
		Math.max(1, Math.round((value / Math.max(sum, 1)) * totalFrames)),
	);
	const scaledSum = scaled.reduce((acc, value) => acc + value, 0);
	scaled[scaled.length - 1] = Math.max(
		1,
		scaled[scaled.length - 1] + (totalFrames - scaledSum),
	);

	let cursor = 0;
	return shots.map((shot, index) => {
		const from = cursor;
		const durationInFrames = Math.max(1, scaled[index]);
		cursor += durationInFrames;
		return {
			shot,
			from,
			durationInFrames,
		};
	});
}

function useActiveShot(
	shots: SceneShot[] | undefined,
	durationInFrames: number,
): {
	shot?: SceneShot;
	localFrame: number;
	durationInFrames: number;
} {
	const frame = useCurrentFrame();
	const timeline = useMemo(
		() => buildShotTimeline(shots, durationInFrames),
		[shots, durationInFrames],
	);
	if (timeline.length === 0) {
		return {
			shot: undefined,
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

	switch (shot.motion) {
		case "static":
			return { transform: `scale(${scale})`, transformOrigin: "center center" };
		case "slow_zoom_out":
			return {
				transform: `scale(${interpolate(ease, [0, 1], [scale * 1.08, scale])})`,
				transformOrigin: vertical ? "center 35%" : "center center",
			};
		case "pan_left":
			return {
				transform: `scale(${scale * 1.08}) translateX(${interpolate(
					ease,
					[0, 1],
					[80, -60],
				)}px)`,
				transformOrigin: "center center",
			};
		case "pan_right":
			return {
				transform: `scale(${scale * 1.08}) translateX(${interpolate(
					ease,
					[0, 1],
					[-80, 60],
				)}px)`,
				transformOrigin: "center center",
			};
		case "drift":
			return {
				transform: `scale(${interpolate(ease, [0, 1], [scale, scale * 1.08])}) translate(${interpolate(
					ease,
					[0, 1],
					[-18, 24],
				)}px, ${interpolate(ease, [0, 1], [16, -18])}px)`,
				transformOrigin: vertical ? "center 35%" : "center center",
			};
		case "push_in":
			return {
				transform: `scale(${interpolate(ease, [0, 1], [scale, scale * 1.16])})`,
				transformOrigin: vertical ? "center 32%" : "center center",
			};
		default:
			// "slow_zoom_in" 포함 — 가장 일반적인 기본 동작
			return {
				transform: `scale(${interpolate(ease, [0, 1], [scale, scale * 1.1])})`,
				transformOrigin: vertical ? "center 35%" : "center center",
			};
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
	/** 씬 오디오를 여기서 렌더링하지 않음 — Composition 레벨에서 J/L-cut 오버랩으로 처리 */
	suppressAudio?: boolean;
	/** "preview": 프록시 파일 우선. "render": 항상 원본. 기본 "render" */
	usage?: "preview" | "render";
}

/** subtitlePosition → flex 배치 변환 */
function positionToFlex(
	pos: SubtitlePosition,
	isEmphasis: boolean,
): "flex-start" | "center" | "flex-end" {
	if (pos === "dynamic") return isEmphasis ? "center" : "flex-end";
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
function SfxCue({ file, volume }: { file: string; volume: number }) {
	const frame = useCurrentFrame();
	return (
		<Audio
			src={staticFile(`sfx/${file}`)}
			volume={interpolate(frame, [0, 4], [0, volume], {
				extrapolateRight: "clamp",
			})}
			startFrom={0}
		/>
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
	const { durationInFrames } = scene;
	const audioVolume = useAudioVolume(durationInFrames);
	const viewOpacity = useTailFade(durationInFrames, fadeOutFrames);
	const subtitleOpacity = useSubtitleOpacity(durationInFrames, fadeOutFrames);
	const layout = useLayoutMode();
	const activeShot = useActiveShot(scene.shots, durationInFrames);

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
							...scaleTransform,
							filter: "brightness(0.4)",
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
					justifyContent: positionToFlex(subtitlePosition, false),
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
	const { durationInFrames } = scene;
	const audioVolume = useAudioVolume(durationInFrames);
	const viewOpacity = useTailFade(durationInFrames, fadeOutFrames);
	const layout = useLayoutMode();
	const activeShot = useActiveShot(scene.shots, durationInFrames);
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
	const trimStart = Math.max(
		0,
		Math.floor((activeShot.shot?.trim_start ?? 0) * durationInFrames),
	);
	const trimEnd = Math.min(
		durationInFrames,
		Math.ceil((activeShot.shot?.trim_end ?? 1) * durationInFrames),
	);

	const kb = computeShotMotion(
		activeShot.shot,
		activeShot.localFrame,
		activeShot.durationInFrames,
		layout.baseScale,
		layout.vertical,
		scene.narration,
		scene.mood,
	);
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

	const subtitleOpacity = useSubtitleOpacity(durationInFrames, fadeOutFrames);

	const isEmphasis = scene.type === "text_emphasis";
	const textEffect = scene.textEffect ?? "none";
	const emphasisTheme = getNewsCardTheme({
		mood: scene.mood,
		hookBoost: scene.hookBoost,
		tone: emphasisTone,
	});
	const emphasisSurfaceTheme = getTextEmphasisSurfaceTheme({
		theme: emphasisTheme,
		tone: emphasisTone,
		hookBoost: scene.hookBoost,
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

	return (
		<AbsoluteFill style={{ opacity: viewOpacity }}>
			{/* 배경 이미지 */}
			{hasVideo ? (
				<AbsoluteFill style={{ overflow: "hidden" }}>
					<Video
						src={videoSrc}
						startFrom={trimStart}
						endAt={Math.max(trimStart + 2, trimEnd)}
						volume={videoVolume}
						style={mergeMotionStyles(
							{
								width: "100%",
								height: "100%",
								objectFit: "cover",
								...kb,
							},
							micro,
						)}
					/>
				</AbsoluteFill>
			) : shotImageUrl && !isNewsPhoto ? (
				// 일반 이미지 — 풀스크린 Ken Burns
				<AbsoluteFill style={{ overflow: "hidden" }}>
					<Img
						src={shotImageUrl}
						style={mergeMotionStyles(
							{
								width: "100%",
								height: "100%",
								objectFit: "cover",
								...kb,
							},
							micro,
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
					justifyContent: positionToFlex(subtitlePosition, isEmphasis),
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
						<div
							style={{
								...emphasisTheme.card,
								...emphasisSurfaceTheme.card,
								padding: layout.vertical ? "28px 24px 24px" : "36px 34px 30px",
								maxWidth: layout.vertical ? "100%" : 980,
								opacity: subtitleOpacity * emphasisLayerMotion.cardOpacity,
								transform: emphasisLayerMotion.cardTransform,
							}}
						>
							<div style={emphasisCueTheme.shellOverlay} />
							<div style={emphasisCueTheme.accentOverlay} />
							<div
								style={{
									position: "relative",
									zIndex: 1,
									display: "flex",
									flexDirection: "column",
								}}
							>
								<div
									style={{
										...emphasisTheme.label.style,
										...emphasisCueTheme.labelCue,
										transform:
											`${emphasisLayerMotion.labelTransform} ${String(emphasisCueTheme.labelCue.transform ?? "")}`.trim(),
										opacity: emphasisLayerMotion.labelOpacity,
									}}
								>
									{emphasisTheme.label.text}
								</div>
								{scene.newsDate &&
									emphasisTheme.datePlacement === "badge" &&
									emphasisTheme.dateBadge && (
										<div
											style={{
												...emphasisTheme.dateBadge,
												transform: emphasisLayerMotion.metaTransform,
												opacity: emphasisLayerMotion.metaOpacity,
											}}
										>
											{scene.newsDate}
										</div>
									)}
								{(scene.newsSource ||
									scene.sourceAttribution ||
									(scene.newsDate &&
										emphasisTheme.datePlacement === "meta")) && (
									<div
										style={{
											...emphasisTheme.metaRow,
											...emphasisSurfaceTheme.metaRow,
											transform: emphasisLayerMotion.metaTransform,
											opacity: emphasisLayerMotion.metaOpacity,
										}}
									>
										{(scene.sourceAttribution || scene.newsSource) && (
											<span
												style={{
													fontFamily:
														"'Noto Sans KR', -apple-system, sans-serif",
													...emphasisTheme.source,
												}}
											>
												{scene.sourceAttribution || scene.newsSource}
											</span>
										)}
										{scene.newsDate &&
											emphasisTheme.datePlacement === "meta" && (
												<span
													style={{
														fontFamily:
															"'Noto Sans KR', -apple-system, sans-serif",
														...emphasisTheme.date,
													}}
												>
													{scene.newsDate}
												</span>
											)}
									</div>
								)}
								<div
									style={{
										transform: emphasisLayerMotion.titleTransform,
										opacity: emphasisLayerMotion.titleOpacity,
									}}
								>
									{textEffect !== "none" ? (
										<TextEffectWrapper
											effect={textEffect}
											durationInFrames={durationInFrames}
										>
											<div
												style={{
													...emphasisSurfaceTheme.titleBlock,
													gap: emphasisLayout.variant === "stacked" ? 16 : 0,
												}}
											>
												{emphasisLayout.variant === "stacked" && (
													<EmphasisWordLine
														words={emphasisLeadWords}
														frame={frame}
														fontSize={Math.round(
															sub.emphasisFontSize *
																(layout.vertical ? 0.44 : 0.4),
														)}
														fontFamily={sub.fontFamily}
														activeColor={emphasisTheme.accentColor}
														baseColor={String(
															emphasisTheme.excerpt.color ?? "#d1d5db",
														)}
														baseWeight={680}
														align={emphasisSurfaceTheme.lineAlign}
														tone={emphasisTone}
													/>
												)}
												<EmphasisWordLine
													words={emphasisFocusWords}
													frame={frame}
													fontSize={
														emphasisLayout.variant === "stacked"
															? Math.round(
																	sub.emphasisFontSize *
																		(layout.vertical ? 0.72 : 0.66),
																)
															: sub.emphasisFontSize
													}
													fontFamily={sub.fontFamily}
													activeColor={emphasisTheme.accentColor}
													baseColor={String(
														emphasisTheme.title.color ?? "#ffffff",
													)}
													baseWeight={
														emphasisLayout.variant === "stacked" ? 760 : 820
													}
													align={emphasisSurfaceTheme.lineAlign}
													tone={emphasisTone}
												/>
											</div>
										</TextEffectWrapper>
									) : (
										<div
											style={{
												...emphasisSurfaceTheme.titleBlock,
												gap: emphasisLayout.variant === "stacked" ? 16 : 0,
											}}
										>
											{emphasisLayout.variant === "stacked" && (
												<EmphasisWordLine
													words={emphasisLeadWords}
													frame={frame}
													fontSize={Math.round(
														sub.emphasisFontSize *
															(layout.vertical ? 0.44 : 0.4),
													)}
													fontFamily={sub.fontFamily}
													activeColor={emphasisTheme.accentColor}
													baseColor={String(
														emphasisTheme.excerpt.color ?? "#d1d5db",
													)}
													baseWeight={680}
													align={emphasisSurfaceTheme.lineAlign}
													tone={emphasisTone}
												/>
											)}
											<EmphasisWordLine
												words={emphasisFocusWords}
												frame={frame}
												fontSize={
													emphasisLayout.variant === "stacked"
														? Math.round(
																sub.emphasisFontSize *
																	(layout.vertical ? 0.72 : 0.66),
															)
														: sub.emphasisFontSize
												}
												fontFamily={sub.fontFamily}
												activeColor={emphasisTheme.accentColor}
												baseColor={String(
													emphasisTheme.title.color ?? "#ffffff",
												)}
												baseWeight={
													emphasisLayout.variant === "stacked" ? 760 : 820
												}
												align={emphasisSurfaceTheme.lineAlign}
												tone={emphasisTone}
											/>
										</div>
									)}
								</div>
							</div>
						</div>
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

function VideoSceneView({
	scene,
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
	const { durationInFrames } = scene;
	const audioVolume = useAudioVolume(durationInFrames);
	const viewOpacity = useTailFade(durationInFrames, fadeOutFrames);
	const layout = useLayoutMode();

	const shotTimeline = useMemo(
		() => buildShotTimeline(scene.shots, durationInFrames),
		[scene.shots, durationInFrames],
	);
	const activeShot = useActiveShot(scene.shots, durationInFrames);
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

	// 샷 경계에서 6프레임 cross-dissolve
	const FADE = 6;

	return (
		<AbsoluteFill style={{ opacity: viewOpacity }}>
			{shotTimeline.length > 0 ? (
				shotTimeline.map((entry) => {
					const localF = frame - entry.from;
					const opacity = interpolate(
						localF,
						[-FADE, 0, entry.durationInFrames - FADE, entry.durationInFrames],
						[0, 1, 1, 0],
						{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
					);
					if (opacity <= 0) return null;

					const isVideoShot = entry.shot.media_type !== "image";
					// trim_start/trim_end은 씬 durationInFrames 기준 정규화
					// 올바른 startFrom: 해당 샷 시작 시점에 비디오가 videoStartFrame을 재생하도록 오프셋
					const videoStartFrame = Math.floor(
						(entry.shot.trim_start ?? 0) * durationInFrames,
					);
					const startFrom = Math.max(0, videoStartFrame - entry.from);
					const shotUrl = isVideoShot
						? entry.shot.source_url || baseVideoUrl
						: entry.shot.source_url || scene.imageUrl;
					const shotSrc = isVideoShot
						? videoSrc
						: resolveVideoSrc(shotUrl, staticFile, {
								usage,
								proxyAvailable: proxyReady,
							});
					const motion = computeShotMotion(
						entry.shot,
						Math.max(0, localF),
						entry.durationInFrames,
						layout.baseScale,
						layout.vertical,
						scene.narration,
						scene.mood,
					);
					const micro = computeMicroEditStyle({
						frame,
						durationInFrames,
						wordTimings: scene.wordTimings,
						hookBoost: scene.hookBoost,
						vertical: layout.vertical,
						isVideo: isVideoShot,
					});

					const shotFilter = entry.shot.colorGraph
						? compileColorGraphToCss(entry.shot.colorGraph).css
						: undefined;

					return (
						<AbsoluteFill
							key={entry.shot.id}
							style={{
								opacity,
								overflow: "hidden",
								filter: shotFilter || undefined,
							}}
						>
							{isVideoShot && shotSrc ? (
								<Video
									src={shotSrc}
									startFrom={startFrom}
									style={mergeMotionStyles(
										{
											width: "100%",
											height: "100%",
											objectFit: "cover",
											...motion,
										},
										micro,
									)}
									volume={opacity * videoVolume}
								/>
							) : shotSrc ? (
								<Img
									src={shotSrc}
									style={mergeMotionStyles(
										{
											width: "100%",
											height: "100%",
											objectFit: "cover",
											...motion,
										},
										micro,
									)}
								/>
							) : null}
						</AbsoluteFill>
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
							<Video
								src={videoSrc}
								startFrom={0}
								style={mergeMotionStyles(
									{ width: "100%", height: "100%", objectFit: "cover" },
									micro,
								)}
								volume={videoVolume}
							/>
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
					justifyContent: positionToFlex(subtitlePosition, false),
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
	subtitleStyle,
	fadeOutFrames,
	hasGlobalNarration,
	captionStyle = "chunked",
	subtitlePosition = "bottom",
	subtitleBgStyle = "stroke",
	subtitleAccentColor = "#FFD700",
	suppressAudio = false,
	usage = "render",
}: SceneProps) {
	const props: SceneProps = {
		scene,
		subtitleStyle,
		fadeOutFrames,
		hasGlobalNarration,
		captionStyle,
		subtitlePosition,
		subtitleBgStyle,
		subtitleAccentColor,
		suppressAudio,
		usage,
	};

	const sceneContent = (
		<>
			{scene.type === "news_overlay" ? (
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
		scene.hookBoost && bgStyle !== "block" ? "glow" : bgStyle;
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
