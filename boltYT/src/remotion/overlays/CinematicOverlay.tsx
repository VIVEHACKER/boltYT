/**
 * 시네마틱 오버레이 — 필름 그레인 + 비네트 + 색보정
 * mood에 따라 색감이 달라짐
 */

import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { SceneMood } from "../types";

interface Props {
	mood?: SceneMood;
	/** 그레인 강도 (0~1, 기본 0.08) */
	grainIntensity?: number;
	/** 비네트 강도 (0~1, 기본 0.5) */
	vignetteIntensity?: number;
}

const COLOR_GRADES: Record<SceneMood, string> = {
	horror: "rgba(20, 50, 160, 0.32)",
	mystery: "rgba(200, 150, 40, 0.28)",
	news: "rgba(0, 0, 0, 0)",
	neutral: "rgba(10, 10, 30, 0.12)",
	warm: "rgba(220, 130, 50, 0.24)",
};

const VIGNETTE_STRENGTH: Record<SceneMood, number> = {
	horror: 0.8,
	mystery: 0.65,
	news: 0.3,
	neutral: 0.45,
	warm: 0.5,
};

export function CinematicOverlay({
	mood = "neutral",
	grainIntensity = 0.08,
	vignetteIntensity,
}: Props) {
	const frame = useCurrentFrame();
	const vignette = vignetteIntensity ?? VIGNETTE_STRENGTH[mood];
	const colorGrade = COLOR_GRADES[mood];

	// SVG 그레인 필터 — seed를 프레임 기반으로 변경하여 자연스러운 움직임
	const grainSeed = frame % 60;

	return (
		<>
			{/* 필름 그레인 */}
			<AbsoluteFill style={{ pointerEvents: "none" }}>
				<svg
					width="0"
					height="0"
					style={{ position: "absolute" }}
					role="img"
					aria-hidden="true"
				>
					<defs>
						<filter id={`grain-${grainSeed}`}>
							<feTurbulence
								type="fractalNoise"
								baseFrequency="0.65"
								numOctaves="3"
								seed={grainSeed}
								stitchTiles="stitch"
							/>
							<feColorMatrix type="saturate" values="0" />
						</filter>
					</defs>
				</svg>
				<div
					style={{
						width: "100%",
						height: "100%",
						filter: `url(#grain-${grainSeed})`,
						opacity: grainIntensity,
						mixBlendMode: "overlay",
					}}
				/>
			</AbsoluteFill>

			{/* 비네트 */}
			<AbsoluteFill
				style={{
					pointerEvents: "none",
					background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${vignette}) 100%)`,
				}}
			/>

			{/* 색보정 */}
			{mood !== "news" && (
				<AbsoluteFill
					style={{
						pointerEvents: "none",
						backgroundColor: colorGrade,
						mixBlendMode: "color",
					}}
				/>
			)}
		</>
	);
}
