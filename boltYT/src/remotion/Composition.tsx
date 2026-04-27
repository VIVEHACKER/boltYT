import {
	AbsoluteFill,
	Audio,
	interpolate,
	Sequence,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { computeCutFlashStyle } from "../lib/micro-edit";
import { transitionDipFactor } from "../lib/sfx";
import type { EndCardProps } from "./cards/EndCard";
import { END_CARD_FRAMES, EndCard } from "./cards/EndCard";
import type { TitleCardProps } from "./cards/TitleCard";
import { TITLE_CARD_FRAMES, TitleCard } from "./cards/TitleCard";
import { SceneView } from "./Scene";
import {
	buildSceneTimeline,
	getOverlapFrames,
	getSceneAudioWindow,
} from "./timing";
import { getTransitionStyles } from "./transitions";
import type {
	CaptionStyle,
	RemotionScene,
	SubtitleStyle,
	TransitionType,
} from "./types";
import { DEFAULT_SUBTITLE } from "./types";

export type SubtitlePosition = "top" | "center" | "bottom" | "dynamic";
export type SubtitleBgStyle = "none" | "pill" | "block" | "stroke" | "glow";

export interface CompositionProps extends Record<string, unknown> {
	scenes: RemotionScene[];
	bgmUrl?: string;
	narrationUrl?: string;
	subtitleStyle?: SubtitleStyle;
	captionStyle?: CaptionStyle;
	/** 자막 위치 (레퍼런스 템플릿 주입) */
	subtitlePosition?: SubtitlePosition;
	/** 자막 배경 스타일 (레퍼런스 템플릿 주입) */
	subtitleBgStyle?: SubtitleBgStyle;
	/** 자막 강조색 (레퍼런스 템플릿 주입) */
	subtitleAccentColor?: string;
	// 인트로/아웃트로
	intro?: TitleCardProps;
	outro?: EndCardProps;
	/** "preview": 프록시 파일 우선 (브라우저 Player). "render": 원본 보장 (기본) */
	usage?: "preview" | "render";
}

// 덕킹 파라미터
const DUCK_VOL = 0.18;
const FULL_VOL = 0.38;
const ATTACK_FRAMES = 8;
const RELEASE_FRAMES = 20;

const FINAL_VISUAL_FADE_FRAMES = 24;
const SCENE_AUDIO_FADE_IN = 5;
const SCENE_AUDIO_FADE_OUT = 14;

/** BGM 덕킹 envelope */
function useDuckEnvelope(
	scenes: RemotionScene[],
	hasGlobalNarration: boolean,
	introFrames: number,
	totalFrames: number,
) {
	const frame = useCurrentFrame();
	const timeline = buildSceneTimeline(scenes, introFrames, totalFrames);

	// transitionType별 BGM dip — hasGlobalNarration 경로에서도 항상 적용
	const dipBoundaries = timeline.slice(0, -1).map((entry, i) => ({
		boundary: entry.to - entry.overlapFrames,
		transitionType: scenes[i + 1]?.transition,
	}));
	const tDip = transitionDipFactor(frame, dipBoundaries);

	if (hasGlobalNarration) return DUCK_VOL * (1 - tDip);

	let speechActive = false;
	for (const seg of timeline) {
		if (frame >= seg.audioFrom && frame < seg.audioTo && seg.hasAudio) {
			speechActive = true;
			break;
		}
	}

	let baseVol: number;
	if (speechActive) {
		let distFromStart = Number.MAX_SAFE_INTEGER;
		for (const seg of timeline) {
			if (seg.hasAudio && frame >= seg.audioFrom && frame < seg.audioTo) {
				distFromStart = Math.min(distFromStart, frame - seg.audioFrom);
			}
		}
		// cubic ease-in: t³ → 빠르게 밀어내리는 자연스러운 덕킹
		const tLin = Math.min(distFromStart / ATTACK_FRAMES, 1);
		const t = tLin * tLin * tLin;
		baseVol = interpolate(t, [0, 1], [FULL_VOL, DUCK_VOL]);
	} else {
		let distFromEnd = Number.MAX_SAFE_INTEGER;
		for (const seg of timeline) {
			if (seg.hasAudio && frame >= seg.audioTo) {
				distFromEnd = Math.min(distFromEnd, frame - seg.audioTo);
			}
		}
		if (distFromEnd < RELEASE_FRAMES) {
			// cubic ease-out: 1 - (1-t)³ → 부드럽게 회복
			const tLin = distFromEnd / RELEASE_FRAMES;
			const inv = 1 - tLin;
			const t = 1 - inv * inv * inv;
			baseVol = interpolate(t, [0, 1], [DUCK_VOL, FULL_VOL]);
		} else {
			baseVol = FULL_VOL;
		}
	}

	return baseVol * (1 - tDip);
}

function useSequenceAudioVolume(
	durationInFrames: number,
	fadeOutFrames = SCENE_AUDIO_FADE_OUT,
) {
	const frame = useCurrentFrame();
	const fadeIn = interpolate(frame, [0, SCENE_AUDIO_FADE_IN], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const fadeOut = interpolate(
		frame,
		[
			Math.max(0, durationInFrames - fadeOutFrames),
			Math.max(0, durationInFrames - 1),
		],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	return Math.min(fadeIn, fadeOut);
}

function SceneSequenceAudio({
	src,
	durationInFrames,
	fadeOutFrames = SCENE_AUDIO_FADE_OUT,
}: {
	src: string;
	durationInFrames: number;
	fadeOutFrames?: number;
}) {
	const volume = useSequenceAudioVolume(durationInFrames, fadeOutFrames);
	return <Audio src={src} volume={volume} />;
}

function TransitionCutOverlay({
	durationInFrames,
	transitionType,
	hookBoost,
}: {
	durationInFrames: number;
	transitionType: TransitionType;
	hookBoost: boolean;
}) {
	const frame = useCurrentFrame();
	const cut = computeCutFlashStyle({
		frame,
		durationInFrames,
		transitionType,
		hookBoost,
	});
	if (cut.opacity <= 0.01) return null;
	return (
		<AbsoluteFill
			style={{
				pointerEvents: "none",
				backgroundColor: cut.tint,
				opacity: cut.opacity,
				filter: `blur(${cut.blurPx}px)`,
				transform: `scale(${cut.scale})`,
				mixBlendMode: transitionType === "glitch" ? "screen" : "soft-light",
			}}
		/>
	);
}

/** 트랜지션 래퍼 — entering/exiting 스타일 적용 */
function TransitionWrapper({
	children,
	transitionType,
	transitionFrames,
	durationInFrames,
	isEntering,
}: {
	children: React.ReactNode;
	transitionType: TransitionType;
	transitionFrames: number;
	durationInFrames: number;
	isEntering: boolean;
}) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	if (transitionType === "none" || transitionFrames === 0) {
		return <AbsoluteFill>{children}</AbsoluteFill>;
	}

	// exiting: 씬 끝부분에서 트랜지션
	// entering: 씬 시작부분에서 트랜지션
	const localFrame = isEntering
		? frame
		: frame - (durationInFrames - transitionFrames);

	// 트랜지션 구간 밖이면 그냥 표시
	if (isEntering && frame >= transitionFrames) {
		return <AbsoluteFill>{children}</AbsoluteFill>;
	}
	if (!isEntering && frame < durationInFrames - transitionFrames) {
		return <AbsoluteFill>{children}</AbsoluteFill>;
	}

	const clampedFrame = Math.max(0, Math.min(localFrame, transitionFrames));
	const styles = getTransitionStyles(
		transitionType,
		clampedFrame,
		fps,
		transitionFrames,
	);

	const style = isEntering ? styles.entering : styles.exiting;

	return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

export function VideoComposition({
	scenes,
	bgmUrl,
	narrationUrl,
	subtitleStyle,
	captionStyle = "chunked",
	subtitlePosition = "bottom",
	subtitleBgStyle = "stroke",
	subtitleAccentColor = "#FFD700",
	intro,
	outro,
	usage = "render",
}: CompositionProps) {
	const introFrames = intro ? TITLE_CARD_FRAMES : 0;
	const outroFrames = outro ? END_CARD_FRAMES : 0;

	// 씬 시작 프레임 계산 (가변 트랜지션 오버랩)
	const sceneFromFrames: number[] = [];
	for (let i = 0; i < scenes.length; i++) {
		if (i === 0) {
			sceneFromFrames.push(introFrames);
		} else {
			const prevEnd = sceneFromFrames[i - 1] + scenes[i - 1].durationInFrames;
			const overlap = getOverlapFrames(scenes[i]);
			sceneFromFrames.push(prevEnd - overlap);
		}
	}

	const totalFrames = calculateTotalFrames(scenes, intro, outro);
	const lastFrame = Math.max(0, totalFrames - 1);
	const frame = useCurrentFrame();
	const sub = { ...DEFAULT_SUBTITLE, ...subtitleStyle };
	const hasNarration = Boolean(narrationUrl);

	const duckVol = useDuckEnvelope(
		scenes,
		hasNarration,
		introFrames,
		totalFrames,
	);

	const fadeOutStart = Math.max(31, lastFrame - 59);
	const edgeFade = bgmUrl
		? interpolate(frame, [0, 30, fadeOutStart, lastFrame], [0, 1, 1, 0], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 0;
	const bgmVolume = duckVol * edgeFade;

	const narrationVolume = narrationUrl
		? interpolate(
				frame,
				[
					introFrames,
					introFrames + 8,
					Math.max(introFrames + 8, totalFrames - outroFrames - 24),
					Math.max(introFrames + 9, totalFrames - outroFrames - 1),
				],
				[0, 1, 1, 0],
				{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
			)
		: 0;

	return (
		<AbsoluteFill style={{ backgroundColor: "#000" }}>
			{/* 인트로 타이틀 카드 */}
			{intro && (
				<Sequence from={0} durationInFrames={TITLE_CARD_FRAMES}>
					<TitleCard {...intro} />
				</Sequence>
			)}

			{/* 씬들 — 트랜지션 래핑 */}
			{scenes.map((scene, i) => {
				const from = sceneFromFrames[i];
				const isLast = i === scenes.length - 1;
				const nextTransition: TransitionType = isLast
					? "none"
					: (scenes[i + 1]?.transition ?? "crossfade");
				const nextOverlap = isLast ? 0 : getOverlapFrames(scenes[i + 1]);
				const currentTransition = scene.transition ?? "crossfade";
				const currentOverlap = i === 0 ? 0 : getOverlapFrames(scene);

				return (
					<Sequence
						// biome-ignore lint/suspicious/noArrayIndexKey: scenes ordered by index
						key={i}
						from={from}
						durationInFrames={scene.durationInFrames}
					>
						{/* 나가는 트랜지션 (현재 씬 끝부분) */}
						<TransitionWrapper
							transitionType={nextTransition}
							transitionFrames={nextOverlap}
							durationInFrames={scene.durationInFrames}
							isEntering={false}
						>
							{/* 들어오는 트랜지션 (현재 씬 시작부분) */}
							<TransitionWrapper
								transitionType={i === 0 ? "none" : currentTransition}
								transitionFrames={currentOverlap}
								durationInFrames={scene.durationInFrames}
								isEntering={true}
							>
								<SceneView
									scene={scene}
									subtitleStyle={sub}
									hasGlobalNarration={hasNarration}
									captionStyle={captionStyle}
									subtitlePosition={subtitlePosition}
									subtitleBgStyle={subtitleBgStyle}
									subtitleAccentColor={subtitleAccentColor}
									fadeOutFrames={
										isLast && !outro ? FINAL_VISUAL_FADE_FRAMES : undefined
									}
									suppressAudio={true}
									usage={usage}
								/>
								{/* 마지막 씬에는 flash overlay 생략 — 엔딩 자연 감쇠 보호 */}
								{!isLast && (
									<TransitionCutOverlay
										durationInFrames={scene.durationInFrames}
										transitionType={nextTransition}
										hookBoost={Boolean(
											scene.hookBoost || scenes[i + 1]?.hookBoost,
										)}
									/>
								)}
							</TransitionWrapper>
						</TransitionWrapper>
					</Sequence>
				);
			})}

			{/* 아웃트로 엔드 카드 */}
			{outro && (
				<Sequence
					from={totalFrames - outroFrames}
					durationInFrames={END_CARD_FRAMES}
				>
					<EndCard {...outro} />
				</Sequence>
			)}

			{/* 씬별 오디오 — J/L-cut 오버랩 (경계 흐릿하게, 프로 편집감).
			    단, 인접 씬이 나레이션을 갖고 있으면 트랜지션 중간점(seam)으로 clamp 하여
			    두 TTS 가 동시에 재생되지 않도록 한다 (Codex P1). */}
			{!hasNarration &&
				scenes.map((scene, i) => {
					if (!scene.audioUrl) return null;
					const baseFrom = sceneFromFrames[i];
					const baseEnd = baseFrom + scene.durationInFrames;
					const audioWindow = getSceneAudioWindow(
						scenes,
						i,
						baseFrom,
						baseEnd,
						totalFrames,
					);
					const audioDuration = audioWindow.to - audioWindow.from;
					return (
						<Sequence
							// biome-ignore lint/suspicious/noArrayIndexKey: scene order stable
							key={`audio-${i}`}
							from={audioWindow.from}
							durationInFrames={audioDuration}
						>
							<SceneSequenceAudio
								src={scene.audioUrl}
								durationInFrames={audioDuration}
								fadeOutFrames={
									i === scenes.length - 1 ? 26 : SCENE_AUDIO_FADE_OUT
								}
							/>
						</Sequence>
					);
				})}

			{narrationUrl && <Audio src={narrationUrl} volume={narrationVolume} />}
			{bgmUrl && <Audio src={bgmUrl} volume={bgmVolume} loop />}
			{!outro && (
				<AbsoluteFill
					style={{
						backgroundColor: "#000",
						opacity: interpolate(
							frame,
							[
								Math.max(0, lastFrame - FINAL_VISUAL_FADE_FRAMES + 1),
								lastFrame,
							],
							[0, 1],
							{
								extrapolateLeft: "clamp",
								extrapolateRight: "clamp",
							},
						),
					}}
				/>
			)}
		</AbsoluteFill>
	);
}

// eslint-disable-next-line react-refresh/only-export-components
export function calculateTotalFrames(
	scenes: RemotionScene[],
	intro?: TitleCardProps,
	outro?: EndCardProps,
): number {
	if (scenes.length === 0) return 0;

	const introFrames = intro ? TITLE_CARD_FRAMES : 0;
	const outroFrames = outro ? END_CARD_FRAMES : 0;

	// 가변 트랜지션 오버랩 합산
	let overlapTotal = 0;
	for (let i = 1; i < scenes.length; i++) {
		overlapTotal += getOverlapFrames(scenes[i]);
	}

	const sceneFrames =
		scenes.reduce((sum, s) => sum + s.durationInFrames, 0) - overlapTotal;

	return introFrames + sceneFrames + outroFrames;
}
