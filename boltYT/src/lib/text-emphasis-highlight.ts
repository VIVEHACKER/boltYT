import type { CSSProperties } from "react";
import type { NewsSurfaceTone } from "./news-surface-theme";

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function progressBetween(frame: number, start: number, end: number) {
	if (end <= start) return frame >= end ? 1 : 0;
	return clamp((frame - start) / (end - start), 0, 1);
}

function hexToRgba(hex: string, alpha: number) {
	const normalized = hex.replace("#", "");
	if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`;

	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);

	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isTimelineCueWord(word: string) {
	return /\d{1,2}[.:]\d{2}|\d+일|당일|직후|이후|뒤|분 후|시간 후|오전|오후|새벽/u.test(
		word,
	);
}

export function computeTextEmphasisWordStyle(params: {
	tone?: NewsSurfaceTone;
	word: string;
	frame: number;
	startFrame: number;
	endFrame: number;
	activeColor: string;
	baseColor: string;
	baseWeight: number;
}): CSSProperties {
	const {
		tone = "generic",
		word,
		frame,
		startFrame,
		endFrame,
		activeColor,
		baseColor,
		baseWeight,
	} = params;

	const isActive = frame >= startFrame && frame < endFrame;
	const isPast = frame >= endFrame;
	const enter = progressBetween(
		frame,
		startFrame,
		Math.min(endFrame, startFrame + 3),
	);
	const activeScale = 1.06 - enter * 0.06;
	const dateCue = isTimelineCueWord(word);

	const baseStyle: CSSProperties = {
		fontWeight: isActive ? Math.max(baseWeight, 760) : baseWeight,
		color: isActive ? activeColor : baseColor,
		opacity: isPast ? 0.92 : isActive ? 1 : 0.7,
		transform: `scale(${isActive ? activeScale.toFixed(4) : "1"})`,
		display: "inline-block",
		letterSpacing: 0,
		textShadow: isActive
			? "0 8px 24px rgba(0,0,0,0.28)"
			: "0 4px 14px rgba(0,0,0,0.2)",
	};

	switch (tone) {
		case "witness": {
			const pullX = isActive ? Math.round(-14 + enter * 14) : isPast ? -1 : 0;
			return {
				...baseStyle,
				fontWeight: isActive
					? Math.max(baseWeight, 780)
					: isPast
						? baseWeight + 20
						: baseWeight,
				fontStyle: isActive || isPast ? "italic" : "normal",
				opacity: isPast ? 0.96 : isActive ? 1 : 0.66,
				transform: `translateX(${pullX}px) scale(${isActive ? activeScale.toFixed(4) : "1"})`,
				textShadow: isActive
					? `0 10px 26px ${hexToRgba(activeColor, 0.2)}`
					: "0 4px 14px rgba(0,0,0,0.22)",
			};
		}
		case "evidence": {
			const rotate = isActive ? -5 + enter * 5 : isPast ? -1.2 : 0;
			return {
				...baseStyle,
				fontWeight: isActive ? Math.max(baseWeight, 800) : baseWeight,
				padding: isActive || isPast ? "2px 8px" : undefined,
				borderRadius: isActive || isPast ? 8 : undefined,
				background:
					isActive || isPast
						? hexToRgba(activeColor, isActive ? 0.16 : 0.08)
						: undefined,
				border:
					isActive || isPast
						? `1px solid ${hexToRgba(activeColor, isActive ? 0.42 : 0.18)}`
						: undefined,
				transform: `translateY(${isActive ? Math.round(2 - enter * 2) : 0}px) rotate(${rotate.toFixed(3)}deg) scale(${isActive ? (1.09 - enter * 0.09).toFixed(4) : "1"})`,
				textShadow: isActive
					? `0 12px 28px ${hexToRgba(activeColor, 0.16)}`
					: "0 4px 14px rgba(0,0,0,0.18)",
			};
		}
		case "timeline": {
			return {
				...baseStyle,
				fontWeight:
					dateCue && (isActive || isPast)
						? Math.max(baseWeight, 790)
						: isActive
							? Math.max(baseWeight, 760)
							: baseWeight,
				opacity: isPast ? 0.95 : isActive ? 1 : 0.58,
				padding: dateCue ? "2px 8px" : undefined,
				borderRadius: dateCue ? 999 : undefined,
				background:
					dateCue && (isActive || isPast)
						? hexToRgba(activeColor, isActive ? 0.18 : 0.1)
						: undefined,
				border:
					dateCue && (isActive || isPast)
						? `1px solid ${hexToRgba(activeColor, 0.26)}`
						: undefined,
				transform: `translateY(${isActive ? Math.round(3 - enter * 3) : 0}px) scale(${isActive ? (1.045 - enter * 0.045).toFixed(4) : "1"})`,
				textShadow: isActive
					? `0 8px 22px ${hexToRgba(activeColor, 0.18)}`
					: "0 4px 12px rgba(0,0,0,0.18)",
			};
		}
		default:
			return baseStyle;
	}
}
