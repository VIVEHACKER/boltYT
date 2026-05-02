/**
 * Film grain overlay — SVG fractal noise 로 35mm 필름 입자 시뮬레이션.
 * frame 마다 baseFrequency seed 변화로 살짝 dance.
 */

import { AbsoluteFill, useCurrentFrame } from "remotion";

export type GrainIntensity = "subtle" | "medium" | "heavy";

interface Props {
	intensity?: GrainIntensity;
	opacity?: number;
}

const PRESETS: Record<
	GrainIntensity,
	{ frequency: number; opacity: number; brightness: number }
> = {
	subtle: { frequency: 0.85, opacity: 0.08, brightness: 0.5 },
	medium: { frequency: 0.95, opacity: 0.16, brightness: 0.45 },
	heavy: { frequency: 1.1, opacity: 0.28, brightness: 0.4 },
};

export function FilmGrain({ intensity = "subtle", opacity = 1 }: Props) {
	const frame = useCurrentFrame();
	const p = PRESETS[intensity];
	// baseFrequency seed 마다 살짝 다르게 (frame % 6 으로 6-tick 사이클)
	const seedOffset = ((frame % 6) - 3) * 0.005;
	const freq = (p.frequency + seedOffset).toFixed(3);
	const seed = frame % 30;

	return (
		<AbsoluteFill
			style={{
				pointerEvents: "none",
				opacity: p.opacity * opacity,
				mixBlendMode: "overlay",
			}}
		>
			<svg
				width="100%"
				height="100%"
				xmlns="http://www.w3.org/2000/svg"
				role="presentation"
				aria-hidden="true"
			>
				<title>Film grain</title>
				<filter id={`grain-${seed}`}>
					<feTurbulence
						type="fractalNoise"
						baseFrequency={freq}
						numOctaves="2"
						seed={seed}
						stitchTiles="stitch"
					/>
					<feColorMatrix type="saturate" values="0" />
					<feComponentTransfer>
						<feFuncA type="linear" slope={p.brightness} />
					</feComponentTransfer>
				</filter>
				<rect
					x="0"
					y="0"
					width="100%"
					height="100%"
					filter={`url(#grain-${seed})`}
				/>
			</svg>
		</AbsoluteFill>
	);
}
