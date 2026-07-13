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

/**
 * 카운트업 표시값 포맷(순수). 목표값의 소수 자릿수를 그대로 유지한다 — 반올림으로 3.5→"4",
 * 0.25→"0" 처럼 근거 있는 수치를 화면에서 조작하지 않기 위함(YMYL). 정수 목표는 자릿수 0.
 */
export function formatCounterValue(
	value: number,
	target: number,
	format?: "comma" | "number",
): string {
	const decimals = Number.isInteger(target)
		? 0
		: (String(target).split(".")[1]?.length ?? 0);
	return format === "comma"
		? value.toLocaleString("ko-KR", {
				minimumFractionDigits: decimals,
				maximumFractionDigits: decimals,
			})
		: value.toFixed(decimals);
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
	// 소수를 반올림하면 "3.5%"→"4%", "0.25%p"→"0%p" 처럼 근거 있는 수치를 화면에서 조작하게 된다(YMYL).
	// 목표값의 소수 자릿수를 유지해 카운트업 — 정수 목표는 자릿수 0이라 기존 동작 그대로.
	const currentValue = params.target * eased;

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

	const formatted = formatCounterValue(
		currentValue,
		params.target,
		params.format,
	);

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
