/**
 * Progress Bar — 좌→우 진행 채우기.
 * 용도: "23%" 같은 진척도, 타임라인, 비율 시각화.
 */

import { interpolate, useCurrentFrame } from "remotion";

export interface ProgressBarParams {
	/** 0-100 목표 퍼센트 */
	target: number;
	label?: string;
	/** hex 색 */
	color?: string;
	/** 위치 */
	position?: "top" | "center" | "bottom";
}

interface Props {
	params: ProgressBarParams;
	startFrame: number;
	duration: number;
}

export function ProgressBar({ params, startFrame, duration }: Props) {
	const frame = useCurrentFrame();
	const localFrame = frame - startFrame;
	if (localFrame < 0 || localFrame > duration) return null;

	// 진척 fill 애니메이션 (duration의 70%에서 완료)
	const fillProgress = interpolate(localFrame, [4, duration * 0.7], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const currentPct = Math.round(params.target * fillProgress);

	const opacity = interpolate(
		localFrame,
		[0, 6, duration - 12, duration],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	const color = params.color ?? "#FFD700";
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
				padding: "12% 10%",
				pointerEvents: "none",
				opacity,
			}}
		>
			<div style={{ width: "70%", maxWidth: 800 }}>
				{params.label && (
					<div
						style={{
							fontSize: 36,
							fontWeight: 700,
							color: "#fff",
							fontFamily: "'Noto Sans KR', sans-serif",
							marginBottom: 12,
							textShadow: "0 2px 8px rgba(0,0,0,0.8)",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "baseline",
						}}
					>
						<span>{params.label}</span>
						<span style={{ color, fontSize: 52, fontWeight: 900 }}>
							{currentPct}%
						</span>
					</div>
				)}
				<div
					style={{
						height: 18,
						background: "rgba(255,255,255,0.15)",
						borderRadius: 12,
						overflow: "hidden",
						border: "1px solid rgba(255,255,255,0.2)",
						boxShadow: "inset 0 2px 6px rgba(0,0,0,0.5)",
					}}
				>
					<div
						style={{
							width: `${params.target * fillProgress}%`,
							height: "100%",
							background: `linear-gradient(90deg, ${color}, ${color}dd)`,
							boxShadow: `0 0 16px ${color}99`,
							transition: "width 0.1s",
						}}
					/>
				</div>
			</div>
		</div>
	);
}
