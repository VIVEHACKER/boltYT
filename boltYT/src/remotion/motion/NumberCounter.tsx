/**
 * 숫자 카운터 — 0에서 목표값까지 빠르게 카운트업.
 * 예: "147만 명", "30년", "4.2%"
 */

import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { MOTION_TEXT } from "../typography";

export interface NumberCounterParams {
	target: number;
	prefix?: string;
	suffix?: string;
	/** 포맷: "comma" | "number" */
	format?: "comma" | "number";
	/** 위치 */
	position?: "top" | "center" | "bottom";
	fontSize?: number;
	color?: string;
}

interface Props {
	params: NumberCounterParams;
	startFrame: number;
	duration: number;
}

export function NumberCounter({ params, startFrame, duration }: Props) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const localFrame = frame - startFrame;
	if (localFrame < 0 || localFrame > duration) return null;

	// 카운트업: duration의 80%에서 끝남
	const countProgress = Math.min(1, localFrame / (duration * 0.8));
	// Ease-out cubic
	const eased = 1 - (1 - countProgress) ** 3;
	const currentValue = Math.round(params.target * eased);

	// Scale pop-in (처음 10프레임)
	const scale = spring({
		frame: localFrame,
		fps,
		config: { damping: 12, stiffness: 180, mass: 0.5 },
	});

	// Fade out 끝 12프레임
	const opacity = interpolate(
		localFrame,
		[0, 8, duration - 12, duration],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	const formatted =
		params.format === "comma"
			? currentValue.toLocaleString("ko-KR")
			: String(currentValue);

	const justify =
		params.position === "top"
			? "flex-start"
			: params.position === "bottom"
				? "flex-end"
				: "center";

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				display: "flex",
				justifyContent: "center",
				alignItems: justify,
				padding: "15%",
				pointerEvents: "none",
			}}
		>
			<div
				style={{
					fontSize: params.fontSize ?? MOTION_TEXT.numberCounter.fontSize,
					fontWeight: MOTION_TEXT.numberCounter.fontWeight,
					color: params.color ?? MOTION_TEXT.numberCounter.color,
					fontFamily: MOTION_TEXT.numberCounter.fontFamily,
					letterSpacing: "-0.04em",
					textShadow: MOTION_TEXT.numberCounter.textShadow,
					WebkitTextStroke: MOTION_TEXT.numberCounter.stroke,
					transform: `scale(${scale})`,
					opacity,
					lineHeight: 1,
				}}
			>
				{params.prefix ?? ""}
				{formatted}
				{params.suffix ?? ""}
			</div>
		</div>
	);
}
