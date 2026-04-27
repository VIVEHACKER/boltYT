/**
 * 청크 자막 — 모던 유튜브/쇼츠 스타일
 * 2~3단어씩 끊어서 표시, 현재 단어 하이라이트, 필 배경
 */

import { interpolate, useCurrentFrame } from "remotion";
import { getNarrationCaptionMotionTheme } from "../lib/narration-caption-motion";
import {
	getNarrationCaptionContainerToneStyle,
	getNarrationCaptionWordToneStyle,
	isEmphasisWord,
} from "../lib/narration-caption-theme";
import type { NewsSurfaceTone } from "../lib/news-surface-theme";
import type { RemotionScene, SubtitleStyle, WordTiming } from "./types";

export type ChunkedCaptionBgStyle =
	| "none"
	| "pill"
	| "block"
	| "stroke"
	| "glow";

interface Props {
	words: WordTiming[];
	style: Required<SubtitleStyle>;
	emphasis?: boolean;
	/** 하이라이트 액센트 컬러 */
	accentColor?: string;
	/** 자막 배경 스타일 (레퍼런스 프리셋) */
	bgStyle?: ChunkedCaptionBgStyle;
	tone?: NewsSurfaceTone;
	hookBoost?: boolean;
	sceneType?: RemotionScene["type"];
}

interface Chunk {
	words: WordTiming[];
	startFrame: number;
	endFrame: number;
}

// 한국어 절 경계 기호 (구두점 + 어미)
const CLAUSE_BREAK_RE = /[.!?,;。！？，、…]$|[은는이가을를도만에서로]$/;
const STRONG_BREAK_RE = /[.!?。！？…]$/;

/** 단어들을 2~4개씩 청크로 분할 — 절 경계 우선, orphan tail 흡수 */
function buildChunks(words: WordTiming[]): Chunk[] {
	if (words.length === 0) return [];

	const chunks: Chunk[] = [];
	let i = 0;
	const maxChars = 14; // 한국어 기준 (영어는 token 수로 자연 제한됨)
	const minWords = 2;
	const maxWords = 4;

	while (i < words.length) {
		let charCount = 0;
		const chunkWords: WordTiming[] = [];

		while (i < words.length && chunkWords.length < maxWords) {
			const w = words[i];
			charCount += w.word.length + 1; // 공백 포함 추정
			chunkWords.push(w);
			i++;
			// 강한 종결(.?!) → 즉시 끊기
			if (STRONG_BREAK_RE.test(w.word) && chunkWords.length >= minWords) break;
			// 글자수 + 절 경계 선호
			if (charCount >= maxChars && chunkWords.length >= minWords) {
				if (CLAUSE_BREAK_RE.test(w.word) || charCount >= maxChars + 4) break;
			}
		}

		if (chunkWords.length > 0) {
			chunks.push({
				words: chunkWords,
				startFrame: chunkWords[0].startFrame,
				endFrame: chunkWords[chunkWords.length - 1].endFrame,
			});
		}
	}

	// Orphan tail 흡수: 마지막 청크가 1단어이고 직전 청크가 maxWords 미만이면 병합
	if (chunks.length >= 2) {
		const last = chunks[chunks.length - 1];
		const prev = chunks[chunks.length - 2];
		if (last.words.length === 1 && prev.words.length < maxWords) {
			prev.words.push(...last.words);
			prev.endFrame = last.endFrame;
			chunks.pop();
		}
	}

	return chunks;
}

// bgStyle별 컨테이너 스타일
function getBgContainerStyle(
	bgStyle: ChunkedCaptionBgStyle,
	emphasis: boolean,
): React.CSSProperties {
	if (bgStyle === "none" || bgStyle === "stroke" || bgStyle === "glow") {
		return {
			padding: 0,
			display: "flex",
			gap: emphasis ? 12 : 6,
			flexWrap: "wrap",
			justifyContent: "center",
			alignItems: "center",
		};
	}
	if (bgStyle === "block") {
		return {
			background: "rgba(0, 0, 0, 0.78)",
			borderRadius: 4,
			padding: emphasis ? "18px 38px" : "12px 24px",
			boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
			display: "flex",
			gap: emphasis ? 12 : 6,
			flexWrap: "wrap",
			justifyContent: "center",
			alignItems: "center",
		};
	}
	// pill (기본)
	return {
		background: "rgba(0, 0, 0, 0.42)",
		backdropFilter: "blur(6px)",
		WebkitBackdropFilter: "blur(6px)",
		borderRadius: 14,
		padding: emphasis ? "15px 30px" : "9px 18px",
		boxShadow:
			"0 4px 16px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
		border: "1px solid rgba(255,255,255,0.05)",
		display: "flex",
		gap: emphasis ? 10 : 5,
		flexWrap: "wrap",
		justifyContent: "center",
		alignItems: "center",
	};
}

// bgStyle별 단어 shadow/stroke
function getWordEffect(
	bgStyle: ChunkedCaptionBgStyle,
	isActive: boolean,
	accentColor: string,
): Pick<React.CSSProperties, "textShadow" | "WebkitTextStroke"> {
	if (bgStyle === "stroke") {
		return {
			WebkitTextStroke: "2px rgba(0,0,0,0.92)",
			textShadow: isActive
				? "0 2px 10px rgba(0,0,0,0.7)"
				: "0 2px 4px rgba(0,0,0,0.7)",
		};
	}
	if (bgStyle === "glow") {
		return {
			WebkitTextStroke: "1.5px rgba(0,0,0,0.9)",
			textShadow: `0 0 12px ${accentColor}88, 0 0 24px ${accentColor}55, 0 2px 6px rgba(0,0,0,0.8)`,
		};
	}
	return {
		WebkitTextStroke: "1.5px rgba(0,0,0,0.85)",
		textShadow: isActive
			? "0 2px 8px rgba(0,0,0,0.7)"
			: "0 1px 4px rgba(0,0,0,0.6)",
	};
}

export function ChunkedCaption({
	words,
	style: sub,
	emphasis = false,
	accentColor = "#FFD700",
	bgStyle = "pill",
	tone = "generic",
	hookBoost = false,
	sceneType = "image",
}: Props) {
	const frame = useCurrentFrame();
	const fontSize = emphasis ? sub.emphasisFontSize : sub.fontSize;
	const chunks = buildChunks(words);
	const motionTheme = getNarrationCaptionMotionTheme({
		sceneType,
		tone,
		hookBoost,
	});

	// 현재 프레임에 해당하는 청크 찾기 — exit 애니메이션 전체가 렌더되도록 윈도우 확장
	const exitWindow = Math.max(4, motionTheme.exitDurationFrames);
	const activeChunk = chunks.find(
		(c) => frame >= c.startFrame - 2 && frame < c.endFrame + exitWindow,
	);

	if (!activeChunk) return null;

	// 청크 등장 애니메이션
	const enterProgress = interpolate(
		frame,
		[
			activeChunk.startFrame - motionTheme.enterStartOffsetFrames,
			activeChunk.startFrame + motionTheme.enterDurationFrames,
		],
		[0, 1],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	// 청크 퇴장
	const exitProgress = interpolate(
		frame,
		[
			activeChunk.endFrame - motionTheme.exitLeadFrames,
			activeChunk.endFrame + motionTheme.exitDurationFrames,
		],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	const opacity = Math.min(enterProgress, exitProgress);
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
	const containerStyle = {
		...getBgContainerStyle(bgStyle, emphasis),
		...getNarrationCaptionContainerToneStyle({
			tone,
			accentColor,
			hookBoost,
		}),
	};

	return (
		<div
			style={{
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				transform: `translate(${Math.round(enterTranslateX + exitTranslateX)}px, ${Math.round(enterTranslateY + exitTranslateY)}px) scale(${(enterScale * exitScale).toFixed(4)})`,
				opacity,
			}}
		>
			{/* 배경 스타일에 따른 컨테이너 */}
			<div style={containerStyle}>
				{activeChunk.words.map((w, i) => {
					const isActive = frame >= w.startFrame && frame < w.endFrame;
					const isPast = frame >= w.endFrame;
					const state = isActive ? "active" : isPast ? "past" : "future";
					const activeColor =
						emphasis || bgStyle === "glow" ? accentColor : "#ffffff";

					// 활성 단어: 살짝 커지는 효과
					const wordScale = isActive
						? interpolate(
								frame,
								[w.startFrame, w.startFrame + 3],
								[motionTheme.activeWordScale, 1.0],
								{
									extrapolateLeft: "clamp",
									extrapolateRight: "clamp",
								},
							)
						: 1;

					const wordEffect = getWordEffect(bgStyle, isActive, accentColor);
					const toneWordStyle = getNarrationCaptionWordToneStyle({
						tone,
						word: w.word,
						state,
						accentColor,
					});
					// 자동 emphasis: 숫자/강조부사/감탄사는 항상 accent 컬러 + heavier weight
					const emphasized = isEmphasisWord(w.word);
					const baseColor = isActive
						? activeColor
						: isPast
							? "rgba(255,255,255,0.9)"
							: "rgba(255,255,255,0.72)";
					const finalColor = emphasized && !isActive ? accentColor : baseColor;
					const finalWeight = emphasized
						? isActive
							? 800
							: 720
						: isActive
							? 750
							: emphasis
								? 680
								: 580;
					return (
						<span
							key={`${w.word}-${w.startFrame}`}
							style={{
								fontSize,
								fontWeight: finalWeight,
								fontFamily: sub.fontFamily,
								color: finalColor,
								transform: `scale(${wordScale})`,
								display: "inline-block",
								transition: "color 0.08s",
								...wordEffect,
								...toneWordStyle,
								letterSpacing: 0,
							}}
						>
							{w.word}
							{i < activeChunk.words.length - 1 ? " " : ""}
						</span>
					);
				})}
			</div>
		</div>
	);
}
