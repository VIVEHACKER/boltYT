/**
 * 카라오케 자막 — 현재 말하는 단어가 하이라이트
 * OpenMontage 참고: word_by_word highlight + spring animation
 */

import { interpolate, useCurrentFrame } from "remotion";
import { getNarrationCaptionMotionTheme } from "../lib/narration-caption-motion";
import {
	getNarrationCaptionContainerToneStyle,
	getNarrationCaptionWordToneStyle,
} from "../lib/narration-caption-theme";
import type { NewsSurfaceTone } from "../lib/news-surface-theme";
import type { RemotionScene, SubtitleStyle, WordTiming } from "./types";

interface KaraokeCaptionProps {
	words: WordTiming[];
	style: Required<SubtitleStyle>;
	/** text_emphasis 모드 (큰 글씨, 중앙) */
	emphasis?: boolean;
	tone?: NewsSurfaceTone;
	accentColor?: string;
	hookBoost?: boolean;
	sceneType?: RemotionScene["type"];
}

export function KaraokeCaption({
	words,
	style: sub,
	emphasis = false,
	tone = "generic",
	accentColor = "#FFD700",
	hookBoost = false,
	sceneType = "image",
}: KaraokeCaptionProps) {
	const frame = useCurrentFrame();
	const fontSize = emphasis ? sub.emphasisFontSize : sub.fontSize;
	const motionTheme = getNarrationCaptionMotionTheme({
		sceneType,
		tone,
		hookBoost,
	});
	const firstStart = words[0]?.startFrame ?? 0;
	const lastEnd = words[words.length - 1]?.endFrame ?? 0;
	const enterProgress = interpolate(
		frame,
		[
			firstStart - motionTheme.enterStartOffsetFrames,
			firstStart + motionTheme.enterDurationFrames,
		],
		[0, 1],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	const exitProgress = interpolate(
		frame,
		[
			lastEnd - motionTheme.exitLeadFrames,
			lastEnd + motionTheme.exitDurationFrames,
		],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);
	const enterTranslateX = interpolate(
		enterProgress,
		[0, 1],
		[motionTheme.enterFromX, 0],
	);
	const enterTranslateY = interpolate(
		enterProgress,
		[0, 1],
		[motionTheme.enterFromY, 0],
	);
	const enterScale = interpolate(
		enterProgress,
		[0, 1],
		[motionTheme.enterFromScale, 1],
	);
	const exitTranslateX = interpolate(
		exitProgress,
		[0, 1],
		[motionTheme.exitToX, 0],
	);
	const exitTranslateY = interpolate(
		exitProgress,
		[0, 1],
		[motionTheme.exitToY, 0],
	);
	const exitScale = interpolate(
		exitProgress,
		[0, 1],
		[motionTheme.exitToScale, 1],
	);

	return (
		<p
			style={{
				fontSize,
				fontWeight: emphasis ? 700 : sub.fontWeight,
				lineHeight: 1.6,
				textAlign: "center",
				margin: 0,
				textShadow:
					"0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.6)",
				WebkitTextStroke: "1.5px rgba(0,0,0,0.8)",
				fontFamily: sub.fontFamily,
				letterSpacing: "-0.01em",
				opacity: Math.min(enterProgress, exitProgress),
				transform: `translate(${Math.round(enterTranslateX + exitTranslateX)}px, ${Math.round(enterTranslateY + exitTranslateY)}px) scale(${(enterScale * exitScale).toFixed(4)})`,
				...getNarrationCaptionContainerToneStyle({
					tone,
					accentColor,
					hookBoost,
				}),
			}}
		>
			{words.map((w, i) => {
				const isActive = frame >= w.startFrame && frame < w.endFrame;
				const isPast = frame >= w.endFrame;
				const isFuture = frame < w.startFrame;
				const state = isActive ? "active" : isPast ? "past" : "future";

				// 단어 진입 시 살짝 커졌다 돌아오는 효과
				const scale = isActive
					? interpolate(frame, [w.startFrame, w.startFrame + 4], [1.08, 1.0], {
							extrapolateRight: "clamp",
							extrapolateLeft: "clamp",
						})
					: 1;
				const toneScale = isActive
					? interpolate(
							frame,
							[w.startFrame, w.startFrame + 4],
							[motionTheme.activeWordScale, 1.0],
							{
								extrapolateRight: "clamp",
								extrapolateLeft: "clamp",
							},
						)
					: 1;

				const opacity = isFuture ? 0.4 : isPast ? 0.7 : 1;
				const color = isActive
					? "#ffffff"
					: isPast
						? "rgba(255,255,255,0.7)"
						: "rgba(255,255,255,0.4)";
				const toneWordStyle = getNarrationCaptionWordToneStyle({
					tone,
					word: w.word,
					state,
					accentColor,
				});

				return (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: word order is stable
						key={i}
						style={{
							color,
							opacity,
							transform: `scale(${(scale * toneScale).toFixed(4)})`,
							display: "inline-block",
							transition: "color 0.1s",
							fontWeight: isActive ? 700 : sub.fontWeight,
							...toneWordStyle,
						}}
					>
						{w.word}
						{i < words.length - 1 ? " " : ""}
					</span>
				);
			})}
		</p>
	);
}

/** 나레이션 텍스트를 단어별 타이밍으로 분할 (글자 수 비례) */
// eslint-disable-next-line react-refresh/only-export-components
export function generateWordTimings(
	narration: string,
	durationInFrames: number,
	/** 자막이 시작되는 오프셋 프레임 (fade-in 후) */
	startOffset = 12,
	/** 자막이 끝나기 전 여유 프레임 */
	endMargin = 8,
): WordTiming[] {
	const words = narration.split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];

	const availableFrames = durationInFrames - startOffset - endMargin;
	if (availableFrames <= 0) {
		return words.map((w) => ({
			word: w,
			startFrame: startOffset,
			endFrame: durationInFrames,
		}));
	}

	// 글자 수 비례로 프레임 배분
	const totalChars = words.reduce((s, w) => s + w.length, 0);
	const timings: WordTiming[] = [];
	let currentFrame = startOffset;

	for (const word of words) {
		const ratio = word.length / totalChars;
		const frames = Math.max(3, Math.round(availableFrames * ratio));
		timings.push({
			word,
			startFrame: Math.round(currentFrame),
			endFrame: Math.round(currentFrame + frames),
		});
		currentFrame += frames;
	}

	return timings;
}
