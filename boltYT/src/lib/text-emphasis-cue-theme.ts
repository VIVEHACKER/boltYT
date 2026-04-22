import type { CSSProperties } from "react";
import type { WordTiming } from "../remotion/types";
import { collectAccentFrames } from "./micro-edit";
import type { NewsSurfaceTone } from "./news-surface-theme";

export interface TextEmphasisCueTheme {
	shellOverlay: CSSProperties;
	accentOverlay: CSSProperties;
	labelCue: CSSProperties;
}

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function progressBetween(frame: number, start: number, end: number) {
	if (end <= start) return frame >= end ? 1 : 0;
	return clamp((frame - start) / (end - start), 0, 1);
}

function pulseEnvelope(
	frame: number,
	cueFrame: number,
	attackFrames: number,
	releaseFrames: number,
) {
	const start = cueFrame - 1;
	const peak = cueFrame + attackFrames;
	const end = peak + releaseFrames;
	if (frame < start || frame > end) return 0;
	if (frame <= peak) {
		return (frame - start) / Math.max(1, peak - start);
	}
	return 1 - (frame - peak) / Math.max(1, end - peak);
}

function hexToRgba(hex: string, alpha: number) {
	const normalized = hex.replace("#", "");
	if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`;

	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);

	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function computeTextEmphasisCueTheme(params: {
	tone?: NewsSurfaceTone;
	frame: number;
	wordTimings?: WordTiming[];
	durationInFrames: number;
	accentColor: string;
	hookBoost?: boolean;
}): TextEmphasisCueTheme {
	const {
		tone = "generic",
		frame,
		wordTimings,
		durationInFrames,
		accentColor,
		hookBoost = false,
	} = params;

	const cueFrames = collectAccentFrames(
		wordTimings,
		durationInFrames,
		hookBoost,
	);
	const pulse = cueFrames.reduce((maxPulse, cueFrame) => {
		const cuePulse = pulseEnvelope(
			frame,
			cueFrame,
			hookBoost ? 2 : 1,
			hookBoost ? 10 : 7,
		);
		return Math.max(maxPulse, cuePulse);
	}, 0);
	const primaryCue = cueFrames[0] ?? 0;
	const sweepProgress = progressBetween(
		frame,
		Math.max(0, primaryCue - 4),
		Math.min(durationInFrames - 1, primaryCue + (hookBoost ? 18 : 14)),
	);

	const baseShell: CSSProperties = {
		position: "absolute",
		inset: 0,
		borderRadius: "inherit",
		pointerEvents: "none",
		opacity: Number((0.16 + pulse * 0.26).toFixed(3)),
		mixBlendMode: "screen",
	};

	const baseAccent: CSSProperties = {
		position: "absolute",
		pointerEvents: "none",
		opacity: Number((0.22 + pulse * 0.42).toFixed(3)),
	};

	const baseLabel: CSSProperties = {
		boxShadow: `0 0 ${Math.round(12 + pulse * 18)}px ${hexToRgba(accentColor, 0.16 + pulse * 0.1)}`,
		filter: `brightness(${(1 + pulse * 0.12).toFixed(3)})`,
	};

	switch (tone) {
		case "witness":
			return {
				shellOverlay: {
					...baseShell,
					background: `linear-gradient(90deg, ${hexToRgba(accentColor, 0.22 + pulse * 0.18)} 0%, transparent 44%)`,
					transform: `translateX(${Math.round(-10 + pulse * 10)}px)`,
				},
				accentOverlay: {
					...baseAccent,
					left: 18,
					top: 18,
					bottom: 18,
					width: 3,
					borderRadius: 999,
					background: accentColor,
					boxShadow: `0 0 ${Math.round(18 + pulse * 22)}px ${hexToRgba(accentColor, 0.26)}`,
					transform: `scaleY(${(0.78 + pulse * 0.22).toFixed(4)})`,
					transformOrigin: "top center",
				},
				labelCue: {
					...baseLabel,
					transform: `translateX(${Math.round(-4 - pulse * 6)}px) skewX(-4deg)`,
				},
			};
		case "evidence":
			return {
				shellOverlay: {
					...baseShell,
					backgroundImage: [
						`linear-gradient(135deg, transparent 0 70%, ${hexToRgba(accentColor, 0.18 + pulse * 0.18)} 70% 100%)`,
						`repeating-linear-gradient(180deg, ${hexToRgba(accentColor, 0.02 + pulse * 0.03)} 0 1px, transparent 1px 12px)`,
					].join(", "),
				},
				accentOverlay: {
					...baseAccent,
					right: 28,
					top: 24,
					width: 116,
					height: 42,
					borderRadius: 10,
					border: `1px dashed ${hexToRgba(accentColor, 0.52)}`,
					background: hexToRgba(accentColor, 0.08 + pulse * 0.08),
					transform: `rotate(${(-10 + pulse * 10).toFixed(3)}deg) scale(${(0.92 + pulse * 0.1).toFixed(4)})`,
					boxShadow: `0 10px 28px ${hexToRgba(accentColor, 0.12 + pulse * 0.08)}`,
				},
				labelCue: {
					...baseLabel,
					transform: `rotate(${(-1.2 + pulse * 1.2).toFixed(3)}deg) scale(${(1 + pulse * 0.04).toFixed(4)})`,
				},
			};
		case "timeline":
			return {
				shellOverlay: {
					...baseShell,
					background: `linear-gradient(180deg, transparent 0 42%, ${hexToRgba(accentColor, 0.06 + pulse * 0.06)} 42% 58%, transparent 58% 100%)`,
				},
				accentOverlay: {
					...baseAccent,
					left: `${(-12 + sweepProgress * 112).toFixed(2)}%`,
					top: "50%",
					width: "26%",
					height: 3,
					marginTop: -1.5,
					borderRadius: 999,
					background: accentColor,
					boxShadow: `0 0 ${Math.round(16 + pulse * 20)}px ${hexToRgba(accentColor, 0.28)}`,
					transform: `scaleX(${(0.82 + pulse * 0.18).toFixed(4)})`,
				},
				labelCue: {
					...baseLabel,
					transform: `translateX(${Math.round(pulse * 8)}px)`,
				},
			};
		default:
			return {
				shellOverlay: {
					...baseShell,
					background: `radial-gradient(circle at 50% 42%, ${hexToRgba(accentColor, 0.12 + pulse * 0.12)} 0%, transparent 62%)`,
				},
				accentOverlay: {
					...baseAccent,
					inset: "auto 18% 18% 18%",
					height: 2,
					borderRadius: 999,
					background: `linear-gradient(90deg, transparent 0%, ${hexToRgba(accentColor, 0.8)} 50%, transparent 100%)`,
					transform: `scaleX(${(0.72 + pulse * 0.28).toFixed(4)})`,
				},
				labelCue: {
					...baseLabel,
				},
			};
	}
}
