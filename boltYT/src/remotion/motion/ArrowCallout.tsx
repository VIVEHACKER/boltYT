/**
 * Arrow Callout — 화면 특정 영역을 가리키는 화살표 + 텍스트.
 * 용도: "여기!", "이 부분 주목", 증거 지시.
 */

import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export interface ArrowCalloutParams {
	text: string;
	/** 화살표가 가리키는 위치 (0-1 비율) */
	targetX: number;
	targetY: number;
	/** 텍스트 배치 방향 */
	direction?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
	color?: string;
}

interface Props {
	params: ArrowCalloutParams;
	startFrame: number;
	duration: number;
}

export function ArrowCallout({ params, startFrame, duration }: Props) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const localFrame = frame - startFrame;
	if (localFrame < 0 || localFrame > duration) return null;

	const color = params.color ?? "#FFD700";
	const dir = params.direction ?? "top-right";

	// 화살표 끝점 (화면 % 좌표)
	const tipX = params.targetX * 100;
	const tipY = params.targetY * 100;

	// 화살표 시작점 (텍스트 쪽)
	const offsetX = dir.includes("right") ? 18 : -18;
	const offsetY = dir.includes("top") ? -20 : 20;
	const baseX = Math.max(5, Math.min(95, tipX + offsetX));
	const baseY = Math.max(5, Math.min(95, tipY + offsetY));

	// Pop + wiggle
	const pop = spring({
		frame: localFrame,
		fps,
		config: { damping: 10, stiffness: 150, mass: 0.4 },
	});
	const wiggle = Math.sin(localFrame * 0.4) * 3;

	const opacity = interpolate(
		localFrame,
		[0, 8, duration - 10, duration],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	return (
		<svg
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			style={{
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
				pointerEvents: "none",
				opacity,
			}}
			aria-hidden="true"
		>
			<title>Arrow callout</title>
			{/* 타겟 원 (깜빡임) */}
			<circle
				cx={tipX}
				cy={tipY}
				r={1.2 + Math.abs(Math.sin(localFrame * 0.15)) * 0.8}
				fill="none"
				stroke={color}
				strokeWidth={0.4}
				opacity={pop * 0.9}
			/>
			<circle cx={tipX} cy={tipY} r={0.5} fill={color} opacity={pop} />

			{/* 곡선 화살표 */}
			<path
				d={`M ${baseX} ${baseY} Q ${(baseX + tipX) / 2} ${baseY} ${tipX} ${tipY}`}
				fill="none"
				stroke={color}
				strokeWidth={0.5}
				strokeLinecap="round"
				opacity={pop}
				filter={`drop-shadow(0 0.3px 0.5px rgba(0,0,0,0.8))`}
			/>

			{/* 화살촉 */}
			<polygon
				points={`${tipX},${tipY} ${tipX - 1.5 * (dir.includes("right") ? -1 : 1)},${tipY - 1.5 * (dir.includes("top") ? -1 : 1)} ${tipX - 1.5 * (dir.includes("right") ? -1 : 1) + 0.5},${tipY - 0.2}`}
				fill={color}
				opacity={pop}
				transform={`rotate(${dir.includes("right") ? -25 : 25} ${tipX} ${tipY})`}
			/>

			{/* 텍스트 */}
			<g
				transform={`translate(${baseX}, ${baseY}) translate(${wiggle}, 0)`}
				opacity={pop}
			>
				<rect
					x={dir.includes("right") ? 0 : -30}
					y={-3}
					width={30}
					height={5}
					fill="rgba(0,0,0,0.82)"
					rx={0.8}
				/>
				<text
					x={dir.includes("right") ? 15 : -15}
					y={0.5}
					fill="#fff"
					fontSize="2.8"
					fontWeight="800"
					fontFamily="'Noto Sans KR', sans-serif"
					textAnchor="middle"
					dominantBaseline="middle"
				>
					{params.text}
				</text>
			</g>
		</svg>
	);
}
