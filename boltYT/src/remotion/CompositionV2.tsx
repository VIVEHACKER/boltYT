/**
 * CompositionV2 — TimelineProject 기반 Remotion composition.
 *
 * V1 Composition 은 Scene 배열 + 하드코딩 J/L-cut + 고정 덕킹만 지원.
 * V2 는:
 *   - Clip-on-Track 멀티트랙 렌더
 *   - 클립별 볼륨 엔벨로프 (키프레임 자동화)
 *   - 트랙별 마스터 볼륨/팬/솔로/뮤트 + 자동화
 *   - 색보정 (프리셋 or 3-way) — Phase 3 훅
 */

import { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, useCurrentFrame } from "remotion";
import { useProcessedAudioUrl } from "../hooks/useProcessedAudioUrl";
import { useProxyAvailable } from "../hooks/useProxyAvailable";
import { compileColorGraphToCss } from "../lib/color-graph-css";
import { isMulticamClipVisible } from "../lib/multicam-timeline";
import {
	evaluateCurve,
	evaluateTransform,
	type TimelineClip,
	type TimelineProject,
	type TimelineTrack,
} from "../lib/timeline-model";
import { ColorGradedVideo } from "./ColorGradedVideo";
import { SceneView } from "./Scene";
import type { RemotionScene } from "./types";

export interface CompositionV2Props extends Record<string, unknown> {
	project: TimelineProject;
}

function anySolo(project: TimelineProject): boolean {
	return project.tracks.some((t) => t.kind === "audio" && t.solo);
}

function clipAudioVolume(clip: TimelineClip, globalFrame: number): number {
	if (clip.muted) return 0;
	const base = clip.volumeEnvelope
		? evaluateCurve(clip.volumeEnvelope, globalFrame - clip.startFrame)
		: clip.volume;
	return Math.max(0, base);
}

function trackAudioFactor(
	track: TimelineTrack | undefined,
	soloActive: boolean,
	frame: number,
): number {
	if (!track) return 0;
	if (track.muted) return 0;
	if (soloActive && !track.solo) return 0;
	if (track.volumeAutomation)
		return Math.max(0, evaluateCurve(track.volumeAutomation, frame));
	return Math.max(0, track.volume);
}

function clipToRemotionScene(
	clip: TimelineClip,
	resolvedVideoUrl?: string,
): RemotionScene {
	return {
		imageUrl: clip.imageUrl ?? "",
		videoUrl: resolvedVideoUrl !== undefined ? resolvedVideoUrl : clip.videoUrl,
		audioUrl: "", // 오디오는 별도 Audio 태그로
		narration: (clip.narration ?? clip.text ?? "") as string,
		durationInFrames: clip.durationFrames,
		type: ((clip.meta.scene_type as RemotionScene["type"]) ??
			"image") as RemotionScene["type"],
		newsTitle: clip.meta.news_title as string | undefined,
		newsSource: clip.meta.news_source as string | undefined,
		newsExcerpt: clip.meta.news_excerpt as string | undefined,
		newsDate: clip.meta.news_date as string | undefined,
		transition: (clip.transitionIn?.kind ??
			"crossfade") as RemotionScene["transition"],
		mood: clip.meta.mood as RemotionScene["mood"],
		textEffect: clip.meta.text_effect as RemotionScene["textEffect"],
		wordTimings: clip.meta.word_timings as RemotionScene["wordTimings"],
		motionGraphics: clip.motionGraphics as RemotionScene["motionGraphics"],
		colorGrade: clip.colorGrade?.preset as RemotionScene["colorGrade"],
		colorGradeSpec: clip.colorGrade,
	};
}

function AudioClip({
	clip,
	project,
}: {
	clip: TimelineClip;
	project: TimelineProject;
}) {
	// hooks는 early return 전에 — Rules of Hooks
	const track = useMemo(
		() => project.tracks.find((t) => t.id === clip.trackId),
		[project, clip.trackId],
	);
	const soloActive = useMemo(() => anySolo(project), [project]);
	// audioEffects 전처리 — hooks는 early return 전에 (Rules of Hooks)
	const hasAudioEffects = useMemo(
		() => (clip.audioEffects?.length ?? 0) > 0,
		[clip.audioEffects],
	);
	const processedAudioUrl = useProcessedAudioUrl(
		clip.audioUrl,
		hasAudioEffects ? clip.audioEffects : undefined,
	);

	if (!clip.audioUrl) return null;
	// 멀티캠: group.audioAngle 이 아닌 angle 클립은 오디오 비활성 (스위처가 오디오 소스를 고정)
	if (clip.multicam) {
		const group = project.multicamGroups?.find(
			(g) => g.id === clip.multicam?.groupId,
		);
		if (group && clip.multicam.angle !== group.audioAngle) return null;
	}

	// audioEffects는 useProcessedAudioUrl에서 OfflineAudioContext로 전처리됨.
	// volumeFn은 envelope/track 자동화만 담당.
	const volumeFn = (f: number) =>
		clipAudioVolume(clip, clip.startFrame + f) *
		trackAudioFactor(track, soloActive, clip.startFrame + f);

	return (
		<Sequence from={clip.startFrame} durationInFrames={clip.durationFrames}>
			<Audio src={processedAudioUrl ?? ""} volume={volumeFn} />
		</Sequence>
	);
}

/**
 * Video/caption/title 클립 — Sequence 내부에서 프레임별 transform 보간 적용.
 * Sequence의 frame은 0부터 시작하므로 evaluateTransform에 클립 global frame 전달.
 */
function VideoClip({
	clip,
	project,
	usage = "preview",
}: {
	clip: TimelineClip;
	project: TimelineProject;
	/** preview = 편집 중 (proxy 사용), render = 최종 렌더 (원본 사용) */
	usage?: "preview" | "render";
}) {
	const localFrame = useCurrentFrame();
	const globalFrame = clip.startFrame + localFrame;

	// proxy 가용 여부 — hooks 는 early return 전에 (Rules of Hooks)
	const originalVideoUrl = clip.videoUrl ?? "";
	const { proxyUrl, isReady: proxyReady } = useProxyAvailable(
		clip.id,
		originalVideoUrl,
	);

	// D4: ColorGraph 있으면 WebGL 경로, 없으면 CSS 경로 — early return 전에 계산
	const hasColorGraph = useMemo(
		() => Boolean(clip.colorGraph?.length),
		[clip.colorGraph],
	);

	// Phase 20.5: colorGraph 없을 때만 CSS filter 근사 사용
	const cssFilter = useMemo(
		() =>
			!hasColorGraph && clip.colorGraph?.length
				? compileColorGraphToCss(clip.colorGraph).css
				: null,
		[hasColorGraph, clip.colorGraph],
	);
	const hasFilter = cssFilter && cssFilter !== "none";

	// 멀티캠: 비활성 angle 은 렌더하지 않음 (active 한 angle 만 비주얼로 표시)
	if (clip.multicam && !isMulticamClipVisible(project, clip, globalFrame)) {
		return null;
	}

	const t = evaluateTransform(clip, globalFrame);
	const hasTransform =
		t.x !== 0 ||
		t.y !== 0 ||
		t.scale !== 1 ||
		t.rotation !== 0 ||
		t.opacity !== 1;

	// preview 모드이고 proxy 가 준비됐으면 proxy URL 사용, render 는 항상 원본
	const resolvedVideoUrl =
		usage === "preview" && proxyReady && proxyUrl
			? proxyUrl
			: originalVideoUrl || undefined;

	// D4: colorGraph 있으면 <ColorGradedVideo> (WebGL), 없으면 기존 SceneView
	if (hasColorGraph && clip.colorGraph && resolvedVideoUrl) {
		const transformStyle = hasTransform
			? {
					transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale}) rotate(${t.rotation}deg)`,
					transformOrigin: "center center" as const,
					opacity: t.opacity,
					willChange: "transform, opacity" as const,
				}
			: undefined;
		const webglContent = (
			<ColorGradedVideo
				src={resolvedVideoUrl}
				colorGraph={clip.colorGraph}
				width={1920}
				height={1080}
				volume={0}
				muted={true}
			/>
		);
		if (transformStyle) {
			return <AbsoluteFill style={transformStyle}>{webglContent}</AbsoluteFill>;
		}
		return webglContent;
	}

	const scene = clipToRemotionScene(clip, resolvedVideoUrl);

	if (!hasTransform && !hasFilter) {
		return (
			<SceneView
				scene={scene}
				suppressAudio={true}
				hasGlobalNarration={false}
			/>
		);
	}

	return (
		<AbsoluteFill
			style={{
				transform: hasTransform
					? `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale}) rotate(${t.rotation}deg)`
					: undefined,
				transformOrigin: "center center",
				opacity: hasTransform ? t.opacity : undefined,
				filter: hasFilter ? cssFilter : undefined,
				willChange: hasTransform ? "transform, opacity" : undefined,
			}}
		>
			<SceneView
				scene={scene}
				suppressAudio={true}
				hasGlobalNarration={false}
			/>
		</AbsoluteFill>
	);
}

export function CompositionV2({ project }: CompositionV2Props) {
	// Video 트랙 클립들을 시간순으로
	const videoClips = project.clips
		.filter(
			(c) => c.kind === "video" || c.kind === "caption" || c.kind === "title",
		)
		.sort((a, b) => a.startFrame - b.startFrame);

	const audioClips = project.clips.filter(
		(c) => c.kind === "audio" || c.kind === "bgm",
	);

	return (
		<AbsoluteFill style={{ backgroundColor: "#000" }}>
			{/* 비디오/이미지 클립 렌더 (transform 키프레임 보간 포함) */}
			{videoClips.map((clip) => (
				<Sequence
					key={clip.id}
					from={clip.startFrame}
					durationInFrames={clip.durationFrames}
				>
					<VideoClip clip={clip} project={project} />
				</Sequence>
			))}

			{/* 오디오 클립 — 엔벨로프 + 트랙 마스터 적용 */}
			{audioClips.map((clip) => (
				<AudioClip key={clip.id} clip={clip} project={project} />
			))}

			{/* BGM — Composition 레벨 */}
			{project.bgmUrl && (
				<Audio src={project.bgmUrl} volume={project.bgmVolume} loop />
			)}
		</AbsoluteFill>
	);
}
