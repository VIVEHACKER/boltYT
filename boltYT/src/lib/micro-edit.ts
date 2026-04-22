import type { TransitionType, WordTiming } from "../remotion/types";
import type { NewsSurfaceTone } from "./news-surface-theme";
import type { SceneShotKind } from "./scene-shot-types";

export interface MicroEditStyle {
	transform?: string;
	filter?: string;
}

export interface OverlayTypographyStyle {
	containerTransform: string;
	containerOpacity: number;
	titleTransform: string;
	titleLetterSpacing: number;
	metaOpacity: number;
}

export interface NewsCardLayerMotion {
	labelTransform: string;
	labelOpacity: number;
	metaTransform: string;
	metaOpacity: number;
	titleTransform: string;
	titleOpacity: number;
	excerptTransform: string;
	excerptOpacity: number;
}

export interface ShotOverlayLayerMotion {
	labelTransform: string;
	labelOpacity: number;
	metaTransform: string;
	metaOpacity: number;
	titleTransform: string;
	titleOpacity: number;
	sourceTransform: string;
	sourceOpacity: number;
	quoteMarkTransform: string;
	quoteMarkOpacity: number;
}

export interface TextEmphasisLayerMotion {
	cardTransform: string;
	cardOpacity: number;
	labelTransform: string;
	labelOpacity: number;
	metaTransform: string;
	metaOpacity: number;
	titleTransform: string;
	titleOpacity: number;
}

export interface CutFlashStyle {
	opacity: number;
	blurPx: number;
	scale: number;
	tint: string;
}

function pulseEnvelope(
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
		return (frame - start) / Math.max(1, peak - start);
	}
	return 1 - (frame - peak) / Math.max(1, end - peak);
}

export function collectAccentFrames(
	wordTimings: WordTiming[] | undefined,
	durationInFrames: number,
	hookBoost = false,
): number[] {
	const targetCount = hookBoost ? 3 : 2;
	const frames: number[] = [];

	for (const word of wordTimings ?? []) {
		const cue = Math.max(0, Math.min(durationInFrames - 1, word.startFrame));
		if (frames.length === 0 || cue - frames[frames.length - 1] >= 8) {
			frames.push(cue);
		}
		if (frames.length >= targetCount) break;
	}

	if (frames.length === 0) {
		frames.push(hookBoost ? 2 : 0);
	}

	if (
		hookBoost &&
		durationInFrames > 40 &&
		!frames.some((frame) => Math.abs(frame - 18) <= 6)
	) {
		frames.push(Math.min(18, Math.max(0, durationInFrames - 6)));
	}

	return [...new Set(frames)].sort((a, b) => a - b);
}

type MicroEditKind = SceneShotKind | NewsSurfaceTone;

/** kind별 pulse attack/release 파라미터 */
function kindPulseParams(
	kind: MicroEditKind | undefined,
	hookBoost: boolean,
): { attackF: number; releaseF: number } {
	switch (kind) {
		case "evidence":
		case "punch":
			return { attackF: 1, releaseF: hookBoost ? 5 : 3 };
		case "witness":
			return { attackF: 2, releaseF: hookBoost ? 12 : 8 };
		case "timeline":
			return { attackF: hookBoost ? 3 : 2, releaseF: hookBoost ? 9 : 7 };
		default:
			return { attackF: hookBoost ? 2 : 1, releaseF: hookBoost ? 8 : 5 };
	}
}

/** kind별 transform/filter */
function kindMicroTransform(
	kind: MicroEditKind | undefined,
	pulse: number,
	hookBoost: boolean,
	isVideo: boolean,
	vertical: boolean,
): MicroEditStyle {
	const baseMult = hookBoost
		? isVideo
			? 0.08
			: 0.06
		: isVideo
			? 0.035
			: 0.025;
	const brightness = 1 + pulse * (hookBoost ? 0.08 : 0.04);
	const contrast = 1 + pulse * 0.035;

	switch (kind) {
		case "evidence": {
			const scale = 1 + pulse * baseMult * 1.3;
			const ty = Math.round(pulse * (vertical ? -22 : -14));
			const blur = isVideo ? pulse * (hookBoost ? 1.4 : 0.8) : 0;
			return {
				transform: `scale(${scale.toFixed(4)}) translateY(${ty}px)`,
				filter: `brightness(${(brightness * 1.04).toFixed(3)}) contrast(${(contrast * 1.06).toFixed(3)})${blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : ""}`,
			};
		}
		case "punch": {
			const scale = 1 + pulse * baseMult * 1.5;
			const ty = Math.round(pulse * (vertical ? -20 : -12));
			const tx = isVideo ? Math.round(pulse * (hookBoost ? 22 : 12)) : 0;
			const blur = isVideo ? pulse * (hookBoost ? 1.6 : 0.9) : 0;
			return {
				transform: `scale(${scale.toFixed(4)}) translate(${tx}px, ${ty}px)`,
				filter: `brightness(${(brightness * 1.06).toFixed(3)}) contrast(${(contrast * 1.05).toFixed(3)})${blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : ""}`,
			};
		}
		case "witness": {
			const scale = 1 + pulse * baseMult;
			const ty = Math.round(pulse * (vertical ? -16 : -8));
			const tx = isVideo
				? Math.round(pulse * (hookBoost ? 14 : 8))
				: Math.round(pulse * -6);
			return {
				transform: `scale(${scale.toFixed(4)}) translate(${tx}px, ${ty}px)`,
				filter: `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)})`,
			};
		}
		case "timeline": {
			const scale = 1 + pulse * baseMult * 0.9;
			const ty = Math.round(pulse * (vertical ? -12 : -6));
			const tx = Math.round(pulse * (hookBoost ? 16 : 10));
			const blur = isVideo ? pulse * (hookBoost ? 0.9 : 0.5) : 0;
			return {
				transform: `scale(${scale.toFixed(4)}) translate(${tx}px, ${ty}px)`,
				filter: `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)})${blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : ""}`,
			};
		}
		default: {
			const scale = 1 + pulse * baseMult;
			const ty = Math.round(pulse * (vertical ? -18 : -10));
			const tx = isVideo ? Math.round(pulse * (hookBoost ? 18 : 10)) : 0;
			const blur = isVideo ? pulse * (hookBoost ? 1.2 : 0.7) : 0;
			return {
				transform: `scale(${scale.toFixed(4)}) translate(${tx}px, ${ty}px)`,
				filter: `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)})${blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : ""}`,
			};
		}
	}
}

export function computeMicroEditStyle(params: {
	frame: number;
	durationInFrames: number;
	wordTimings?: WordTiming[];
	hookBoost?: boolean;
	vertical?: boolean;
	isVideo?: boolean;
	/** shot kind or tone — 없으면 기존 동작 유지 */
	kind?: MicroEditKind;
}): MicroEditStyle {
	const {
		frame,
		durationInFrames,
		wordTimings,
		hookBoost = false,
		vertical = false,
		isVideo = false,
		kind,
	} = params;

	const { attackF, releaseF } = kindPulseParams(kind, hookBoost);
	const cueFrames = collectAccentFrames(
		wordTimings,
		durationInFrames,
		hookBoost,
	);
	const pulse = cueFrames.reduce((maxPulse, cueFrame) => {
		const cuePulse = pulseEnvelope(frame, cueFrame, attackF, releaseF);
		return Math.max(maxPulse, cuePulse);
	}, 0);

	if (pulse <= 0) return {};

	return kindMicroTransform(kind, pulse, hookBoost, isVideo, vertical);
}

export function computeOverlayTypographyStyle(params: {
	frame: number;
	wordTimings?: WordTiming[];
	durationInFrames: number;
	hookBoost?: boolean;
}): OverlayTypographyStyle {
	const { frame, wordTimings, durationInFrames, hookBoost = false } = params;
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
			hookBoost ? 10 : 6,
		);
		return Math.max(maxPulse, cuePulse);
	}, 0);
	const baseEnter = Math.min(1, Math.max(0, (frame - 2) / 10));
	return {
		containerTransform: `translateY(${Math.round((1 - baseEnter) * 18 - pulse * 8)}px) scale(${(1 + pulse * (hookBoost ? 0.04 : 0.02)).toFixed(4)})`,
		containerOpacity: Number(
			Math.min(1, 0.72 + baseEnter * 0.28 + pulse * 0.15).toFixed(3),
		),
		titleTransform: `translateY(${Math.round((1 - baseEnter) * 10 - pulse * 6)}px) scale(${(1 + pulse * (hookBoost ? 0.055 : 0.03)).toFixed(4)})`,
		titleLetterSpacing: Number((pulse * 0.6).toFixed(2)),
		metaOpacity: Number(
			Math.min(1, 0.64 + baseEnter * 0.26 + pulse * 0.08).toFixed(3),
		),
	};
}

export function computeNewsCardLayerMotion(params: {
	frame: number;
	wordTimings?: WordTiming[];
	durationInFrames: number;
	hookBoost?: boolean;
}): NewsCardLayerMotion {
	const { frame, wordTimings, durationInFrames, hookBoost = false } = params;
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

	const layerEnter = (delay: number, span: number) =>
		Math.min(1, Math.max(0, (frame - delay) / Math.max(1, span)));

	const labelEnter = layerEnter(0, 7);
	const metaEnter = layerEnter(4, 8);
	const titleEnter = layerEnter(8, 9);
	const excerptEnter = layerEnter(13, 10);

	return {
		labelTransform: `translateY(${Math.round((1 - labelEnter) * 16 - pulse * 6)}px) scale(${(0.96 + labelEnter * 0.04 + pulse * 0.02).toFixed(4)})`,
		labelOpacity: Number(
			Math.min(1, 0.18 + labelEnter * 0.82 + pulse * 0.08).toFixed(3),
		),
		metaTransform: `translateY(${Math.round((1 - metaEnter) * 14 - pulse * 5)}px)`,
		metaOpacity: Number(
			Math.min(1, 0.12 + metaEnter * 0.84 + pulse * 0.06).toFixed(3),
		),
		titleTransform: `translateY(${Math.round((1 - titleEnter) * 18 - pulse * 7)}px) scale(${(0.97 + titleEnter * 0.03 + pulse * 0.025).toFixed(4)})`,
		titleOpacity: Number(
			Math.min(1, 0.1 + titleEnter * 0.9 + pulse * 0.08).toFixed(3),
		),
		excerptTransform: `translateY(${Math.round((1 - excerptEnter) * 16 - pulse * 4)}px)`,
		excerptOpacity: Number(
			Math.min(1, 0.06 + excerptEnter * 0.88 + pulse * 0.05).toFixed(3),
		),
	};
}

export function computeTextEmphasisLayerMotion(params: {
	frame: number;
	wordTimings?: WordTiming[];
	durationInFrames: number;
	hookBoost?: boolean;
	tone?: NewsSurfaceTone;
}): TextEmphasisLayerMotion {
	const {
		frame,
		wordTimings,
		durationInFrames,
		hookBoost = false,
		tone = "generic",
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

	const layerEnter = (delay: number, span: number) =>
		Math.min(1, Math.max(0, (frame - delay) / Math.max(1, span)));

	const cardEnter = layerEnter(0, tone === "evidence" ? 5 : 7);
	const labelEnter = layerEnter(1, 6);
	const metaEnter = layerEnter(4, 7);
	const titleEnter = layerEnter(tone === "timeline" ? 6 : 7, 9);

	const baseCardOpacity = Number(
		Math.min(1, 0.18 + cardEnter * 0.82 + pulse * 0.06).toFixed(3),
	);
	const baseTitleOpacity = Number(
		Math.min(1, 0.1 + titleEnter * 0.9 + pulse * 0.08).toFixed(3),
	);

	switch (tone) {
		case "witness":
			return {
				cardTransform: `translateX(${Math.round((1 - cardEnter) * -34 + pulse * 4)}px) rotate(${((-1 + cardEnter) * 1.2).toFixed(3)}deg) scale(${(0.985 + cardEnter * 0.015 + pulse * 0.02).toFixed(4)})`,
				cardOpacity: baseCardOpacity,
				labelTransform: `translateX(${Math.round((1 - labelEnter) * -24)}px) translateY(${Math.round((1 - labelEnter) * 8 - pulse * 3)}px)`,
				labelOpacity: Number(
					Math.min(1, 0.2 + labelEnter * 0.8 + pulse * 0.05).toFixed(3),
				),
				metaTransform: `translateX(${Math.round((1 - metaEnter) * -16)}px) translateY(${Math.round((1 - metaEnter) * 8 - pulse * 2)}px)`,
				metaOpacity: Number(
					Math.min(1, 0.12 + metaEnter * 0.84 + pulse * 0.04).toFixed(3),
				),
				titleTransform: `translateX(${Math.round((1 - titleEnter) * -32 + pulse * 6)}px) translateY(${Math.round((1 - titleEnter) * 10 - pulse * 4)}px) scale(${(0.97 + titleEnter * 0.03 + pulse * 0.022).toFixed(4)})`,
				titleOpacity: baseTitleOpacity,
			};
		case "evidence":
			return {
				cardTransform: `translateY(${Math.round((1 - cardEnter) * 18 - pulse * 3)}px) rotate(${((1 - cardEnter) * -2.6).toFixed(3)}deg) scale(${(1.045 - cardEnter * 0.045 + pulse * 0.018).toFixed(4)})`,
				cardOpacity: baseCardOpacity,
				labelTransform: `translateY(${Math.round((1 - labelEnter) * 14)}px) scale(${(0.92 + labelEnter * 0.08).toFixed(4)})`,
				labelOpacity: Number(
					Math.min(1, 0.18 + labelEnter * 0.82 + pulse * 0.05).toFixed(3),
				),
				metaTransform: `translateY(${Math.round((1 - metaEnter) * 10)}px) rotate(${((1 - metaEnter) * -1.2).toFixed(3)}deg)`,
				metaOpacity: Number(
					Math.min(1, 0.1 + metaEnter * 0.86 + pulse * 0.04).toFixed(3),
				),
				titleTransform: `translateY(${Math.round((1 - titleEnter) * 12 - pulse * 4)}px) rotate(${((1 - titleEnter) * -0.9).toFixed(3)}deg) scale(${(0.9 + titleEnter * 0.1 + pulse * 0.03).toFixed(4)})`,
				titleOpacity: baseTitleOpacity,
			};
		case "timeline":
			return {
				cardTransform: `translateY(${Math.round((1 - cardEnter) * 22 - pulse * 4)}px) scale(${(0.988 + cardEnter * 0.012 + pulse * 0.016).toFixed(4)})`,
				cardOpacity: baseCardOpacity,
				labelTransform: `translateX(${Math.round((1 - labelEnter) * -28 - pulse * 3)}px) translateY(${Math.round((1 - labelEnter) * 6)}px)`,
				labelOpacity: Number(
					Math.min(1, 0.18 + labelEnter * 0.82 + pulse * 0.05).toFixed(3),
				),
				metaTransform: `translateX(${Math.round((1 - metaEnter) * 18)}px) translateY(${Math.round((1 - metaEnter) * 6)}px)`,
				metaOpacity: Number(
					Math.min(1, 0.12 + metaEnter * 0.84 + pulse * 0.04).toFixed(3),
				),
				titleTransform: `translateX(${Math.round((1 - titleEnter) * -22 + pulse * 4)}px) translateY(${Math.round((1 - titleEnter) * 8 - pulse * 3)}px) scale(${(0.975 + titleEnter * 0.025 + pulse * 0.02).toFixed(4)})`,
				titleOpacity: baseTitleOpacity,
			};
		default:
			return {
				cardTransform: `translateY(${Math.round((1 - cardEnter) * 16 - pulse * 4)}px) scale(${(0.988 + cardEnter * 0.012 + pulse * 0.018).toFixed(4)})`,
				cardOpacity: baseCardOpacity,
				labelTransform: `translateY(${Math.round((1 - labelEnter) * 16 - pulse * 6)}px) scale(${(0.96 + labelEnter * 0.04 + pulse * 0.02).toFixed(4)})`,
				labelOpacity: Number(
					Math.min(1, 0.18 + labelEnter * 0.82 + pulse * 0.08).toFixed(3),
				),
				metaTransform: `translateY(${Math.round((1 - metaEnter) * 14 - pulse * 5)}px)`,
				metaOpacity: Number(
					Math.min(1, 0.12 + metaEnter * 0.84 + pulse * 0.06).toFixed(3),
				),
				titleTransform: `translateY(${Math.round((1 - titleEnter) * 18 - pulse * 7)}px) scale(${(0.97 + titleEnter * 0.03 + pulse * 0.025).toFixed(4)})`,
				titleOpacity: baseTitleOpacity,
			};
	}
}

export function computeShotOverlayLayerMotion(params: {
	frame: number;
	wordTimings?: WordTiming[];
	durationInFrames: number;
	hookBoost?: boolean;
}): ShotOverlayLayerMotion {
	const { frame, wordTimings, durationInFrames, hookBoost = false } = params;
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
			hookBoost ? 9 : 6,
		);
		return Math.max(maxPulse, cuePulse);
	}, 0);

	const layerEnter = (delay: number, span: number) =>
		Math.min(1, Math.max(0, (frame - delay) / Math.max(1, span)));

	const labelEnter = layerEnter(0, 6);
	const quoteEnter = layerEnter(1, 7);
	const metaEnter = layerEnter(4, 7);
	const titleEnter = layerEnter(7, 9);
	const sourceEnter = layerEnter(12, 8);

	return {
		labelTransform: `translateY(${Math.round((1 - labelEnter) * 14 - pulse * 5)}px) scale(${(0.96 + labelEnter * 0.04 + pulse * 0.02).toFixed(4)})`,
		labelOpacity: Number(
			Math.min(1, 0.14 + labelEnter * 0.86 + pulse * 0.06).toFixed(3),
		),
		metaTransform: `translateY(${Math.round((1 - metaEnter) * 12 - pulse * 4)}px)`,
		metaOpacity: Number(
			Math.min(1, 0.1 + metaEnter * 0.86 + pulse * 0.05).toFixed(3),
		),
		titleTransform: `translateY(${Math.round((1 - titleEnter) * 16 - pulse * 6)}px) scale(${(0.97 + titleEnter * 0.03 + pulse * 0.02).toFixed(4)})`,
		titleOpacity: Number(
			Math.min(1, 0.08 + titleEnter * 0.92 + pulse * 0.06).toFixed(3),
		),
		sourceTransform: `translateY(${Math.round((1 - sourceEnter) * 12 - pulse * 4)}px)`,
		sourceOpacity: Number(
			Math.min(1, 0.08 + sourceEnter * 0.9 + pulse * 0.04).toFixed(3),
		),
		quoteMarkTransform: `translateY(${Math.round((1 - quoteEnter) * 18 - pulse * 7)}px) scale(${(0.94 + quoteEnter * 0.06 + pulse * 0.03).toFixed(4)})`,
		quoteMarkOpacity: Number(
			Math.min(1, 0.16 + quoteEnter * 0.84 + pulse * 0.08).toFixed(3),
		),
	};
}

export function computeCutFlashStyle(params: {
	frame: number;
	durationInFrames: number;
	transitionType?: TransitionType;
	hookBoost?: boolean;
}): CutFlashStyle {
	const {
		frame,
		durationInFrames,
		transitionType = "crossfade",
		hookBoost = false,
	} = params;
	const flashStart = Math.max(
		0,
		durationInFrames -
			(transitionType === "glitch" ? 6 : transitionType === "none" ? 4 : 5),
	);
	const progress =
		frame < flashStart
			? 0
			: Math.min(
					1,
					(frame - flashStart) / Math.max(1, durationInFrames - flashStart),
				);
	const strengthBase =
		transitionType === "glitch"
			? 0.55
			: transitionType === "whip_left" || transitionType === "whip_right"
				? 0.42
				: transitionType === "none"
					? 0.48
					: 0.24;
	const strength = progress * strengthBase * (hookBoost ? 1.18 : 1);
	return {
		opacity: Number(Math.min(0.7, strength).toFixed(3)),
		blurPx: Number(
			(strength * (transitionType === "glitch" ? 18 : 12)).toFixed(2),
		),
		scale: Number((1 + strength * 0.035).toFixed(4)),
		tint:
			transitionType === "glitch"
				? "rgba(196, 232, 255, 0.95)"
				: transitionType === "none"
					? "rgba(255,255,255,0.92)"
					: "rgba(255,244,214,0.88)",
	};
}
