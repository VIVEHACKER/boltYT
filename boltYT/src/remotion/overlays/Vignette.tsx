/**
 * Vignette overlay — 화면 가장자리 어둡기 (시네마틱 룩).
 * 라디얼 그라디언트 1장으로 zero overhead.
 */

import { AbsoluteFill } from "remotion";

export type VignetteIntensity = "light" | "medium" | "heavy";

interface Props {
	intensity?: VignetteIntensity;
	/** 0-1, 페이드 인 (씬 시작 시 자연스럽게 적용) */
	opacity?: number;
}

const PRESETS: Record<
	VignetteIntensity,
	{ inner: string; outer: string; spread: string }
> = {
	light: {
		inner: "rgba(0,0,0,0)",
		outer: "rgba(0,0,0,0.32)",
		spread: "65%",
	},
	medium: {
		inner: "rgba(0,0,0,0)",
		outer: "rgba(0,0,0,0.55)",
		spread: "55%",
	},
	heavy: {
		inner: "rgba(0,0,0,0)",
		outer: "rgba(0,0,0,0.78)",
		spread: "45%",
	},
};

export function Vignette({ intensity = "medium", opacity = 1 }: Props) {
	const p = PRESETS[intensity];
	return (
		<AbsoluteFill
			style={{
				background: `radial-gradient(ellipse at center, ${p.inner} ${p.spread}, ${p.outer} 100%)`,
				pointerEvents: "none",
				opacity,
				mixBlendMode: "multiply",
			}}
		/>
	);
}
