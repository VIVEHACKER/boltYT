/**
 * 트랜지션 시스템 — 씬 간 전환 효과
 *
 * 각 트랜지션은 entering(들어오는 씬)/exiting(나가는 씬) CSS 스타일을 반환.
 * Composition에서 Sequence 오버랩 구간에 적용.
 */

import { interpolate, spring } from "remotion";
import type { TransitionType } from "../types";

export interface TransitionStyles {
	entering: React.CSSProperties;
	exiting: React.CSSProperties;
}

type TransitionFn = (
	frame: number,
	fps: number,
	transitionFrames: number,
) => TransitionStyles;

function crossfade(
	frame: number,
	_fps: number,
	transitionFrames: number,
): TransitionStyles {
	const progress = interpolate(frame, [0, transitionFrames], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	return {
		entering: { opacity: progress },
		exiting: { opacity: 1 - progress },
	};
}

function zoom(
	frame: number,
	fps: number,
	transitionFrames: number,
): TransitionStyles {
	const progress = spring({
		frame,
		fps,
		config: { damping: 20, stiffness: 80, mass: 0.6 },
		durationInFrames: transitionFrames,
	});
	return {
		entering: {
			opacity: progress,
			transform: `scale(${interpolate(progress, [0, 1], [0.85, 1])})`,
		},
		exiting: {
			opacity: 1 - progress,
			transform: `scale(${interpolate(progress, [0, 1], [1, 1.25])})`,
		},
	};
}

function slideLeft(
	frame: number,
	fps: number,
	transitionFrames: number,
): TransitionStyles {
	const progress = spring({
		frame,
		fps,
		config: { damping: 22, stiffness: 100, mass: 0.5 },
		durationInFrames: transitionFrames,
	});
	return {
		entering: {
			transform: `translateX(${interpolate(progress, [0, 1], [100, 0])}%)`,
		},
		exiting: {
			transform: `translateX(${interpolate(progress, [0, 1], [0, -100])}%)`,
		},
	};
}

function slideRight(
	frame: number,
	fps: number,
	transitionFrames: number,
): TransitionStyles {
	const progress = spring({
		frame,
		fps,
		config: { damping: 22, stiffness: 100, mass: 0.5 },
		durationInFrames: transitionFrames,
	});
	return {
		entering: {
			transform: `translateX(${interpolate(progress, [0, 1], [-100, 0])}%)`,
		},
		exiting: {
			transform: `translateX(${interpolate(progress, [0, 1], [0, 100])}%)`,
		},
	};
}

function glitch(
	frame: number,
	_fps: number,
	transitionFrames: number,
): TransitionStyles {
	const progress = interpolate(frame, [0, transitionFrames], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// 글리치: 프레임별 랜덤-ish 오프셋 (sin 기반 결정적)
	const jitterX = Math.sin(frame * 7.3) * 12;
	const jitterY = Math.sin(frame * 11.1) * 4;
	const skew = Math.sin(frame * 5.7) * 2;

	// RGB 채널 분리 효과 (text-shadow로 구현)
	const rgbOffset = Math.abs(Math.sin(frame * 9.2)) * 4;

	const entering: React.CSSProperties =
		progress > 0.5
			? {
					opacity: 1,
					transform: `translate(${jitterX * (1 - progress)}px, ${jitterY * (1 - progress)}px) skewX(${skew * (1 - progress)}deg)`,
					filter: `drop-shadow(${rgbOffset * (1 - progress)}px 0 0 rgba(255,0,0,0.5)) drop-shadow(-${rgbOffset * (1 - progress)}px 0 0 rgba(0,255,255,0.5))`,
				}
			: { opacity: 0 };

	const exiting: React.CSSProperties =
		progress <= 0.5
			? {
					opacity: 1,
					transform: `translate(${jitterX * progress}px, ${jitterY * progress}px) skewX(${skew * progress}deg)`,
					filter: `drop-shadow(${rgbOffset * progress}px 0 0 rgba(255,0,0,0.5)) drop-shadow(-${rgbOffset * progress}px 0 0 rgba(0,255,255,0.5))`,
				}
			: { opacity: 0 };

	return { entering, exiting };
}

function none(): TransitionStyles {
	return {
		entering: { opacity: 1 },
		exiting: { opacity: 1 },
	};
}

/**
 * Zoom punch — 펀치감 있는 확대 컷. 짧은 트랜지션에 강한 임팩트.
 * exiting: 1 → 1.4 빠르게, entering: 1.15 → 1 + 짧은 모션 블러
 */
function zoomPunch(
	frame: number,
	fps: number,
	transitionFrames: number,
): TransitionStyles {
	const progress = spring({
		frame,
		fps,
		config: { damping: 14, stiffness: 200, mass: 0.4 },
		durationInFrames: transitionFrames,
	});
	const blur = Math.sin(progress * Math.PI) * 6;
	return {
		entering: {
			opacity: progress,
			transform: `scale(${interpolate(progress, [0, 1], [1.15, 1])})`,
			filter: `blur(${blur}px)`,
		},
		exiting: {
			opacity: 1 - progress,
			transform: `scale(${interpolate(progress, [0, 1], [1, 1.4])})`,
			filter: `blur(${blur}px)`,
		},
	};
}

/**
 * Light leak — 따뜻한 화이트→오렌지 플레어가 가운데에서 화면을 휩쓸고 사라짐.
 * 영화/감성 다큐 느낌. 두 씬 모두 보이지만 mid-progress 에서 플레어 오버레이가 가림.
 */
function lightLeak(
	frame: number,
	_fps: number,
	transitionFrames: number,
): TransitionStyles {
	const progress = interpolate(frame, [0, transitionFrames], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	// 0.5 지점에서 플레어 최대치
	const flare = Math.sin(progress * Math.PI);
	const enterOpacity = interpolate(progress, [0.3, 0.7], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const flareFilter = `brightness(${1 + flare * 0.6}) contrast(${1 - flare * 0.2}) saturate(${1 + flare * 0.4})`;
	return {
		entering: {
			opacity: enterOpacity,
			filter: flareFilter,
		},
		exiting: {
			opacity: 1 - enterOpacity,
			filter: flareFilter,
		},
	};
}

/**
 * Push — 다음 씬이 이전 씬을 밀어내듯 함께 이동.
 * direction: 1 = 새 씬이 오른쪽→왼쪽, -1 = 왼쪽→오른쪽.
 */
function pushPan(direction: 1 | -1) {
	return (
		frame: number,
		fps: number,
		transitionFrames: number,
	): TransitionStyles => {
		const progress = spring({
			frame,
			fps,
			config: { damping: 26, stiffness: 120, mass: 0.6 },
			durationInFrames: transitionFrames,
		});
		const enterFrom = 100 * direction;
		const exitTo = -100 * direction;
		return {
			entering: {
				transform: `translateX(${interpolate(progress, [0, 1], [enterFrom, 0])}%)`,
			},
			exiting: {
				transform: `translateX(${interpolate(progress, [0, 1], [0, exitTo])}%)`,
			},
		};
	};
}

/**
 * Whip pan — 프로 쇼츠의 빠른 가로 "휙!" 전환.
 * 전체 5프레임 내에 모션 블러 + 고속 translateX.
 * direction: 1 = right (현재 씬이 왼쪽으로 빠짐), -1 = left (오른쪽으로 빠짐)
 */
function whipPan(direction: 1 | -1) {
	return (
		frame: number,
		_fps: number,
		transitionFrames: number,
	): TransitionStyles => {
		const progress = interpolate(frame, [0, transitionFrames], [0, 1], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});

		// 고속 translateX (150% 이동) + 모션 블러 — sin² 으로 더 sharp peak (artifact ↓)
		const sinP = Math.sin(progress * Math.PI);
		// asymmetric: 출발/도착에서 블러가 빠르게 사라짐 → tail artifact 방지
		const blurAmount = sinP * sinP * 36; // 0 → 36 (peak) → 0
		// 채도 살짝 ↓ 하면 모션 블러 시 색번짐 줄어듦
		const sat = 1 - sinP * 0.15;

		// Exiting: 현재 씬이 direction 방향으로 빠르게 사라짐
		// Entering: 새 씬이 direction 반대에서 빠르게 들어옴
		const exitingTx = interpolate(progress, [0, 1], [0, 150 * direction]);
		const enteringTx = interpolate(progress, [0, 1], [-150 * direction, 0]);

		return {
			entering: {
				transform: `translateX(${enteringTx}%)`,
				filter: `blur(${blurAmount}px) saturate(${sat})`,
			},
			exiting: {
				transform: `translateX(${exitingTx}%)`,
				filter: `blur(${blurAmount}px) saturate(${sat})`,
			},
		};
	};
}

const TRANSITION_MAP: Record<TransitionType, TransitionFn> = {
	crossfade,
	zoom,
	zoom_punch: zoomPunch,
	light_leak: lightLeak,
	slide_left: slideLeft,
	slide_right: slideRight,
	push_left: pushPan(-1),
	push_right: pushPan(1),
	glitch,
	whip_left: whipPan(-1),
	whip_right: whipPan(1),
	none,
};

export function getTransitionStyles(
	type: TransitionType,
	frame: number,
	fps: number,
	transitionFrames: number,
): TransitionStyles {
	return TRANSITION_MAP[type](frame, fps, transitionFrames);
}
