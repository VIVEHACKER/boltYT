/**
 * Quote Bubble — 인용/대사 말풍선 pop-in + 꼬리 bounce.
 * 용도: "이렇게 말했습니다" 인용, 증인 진술, 강조 대사.
 */

import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export interface QuoteBubbleParams {
	text: string;
	/** 인용 주체 (선택) */
	speaker?: string;
	/** 위치 */
	position?: "top" | "center" | "bottom";
	color?: string;
}

interface Props {
	params: QuoteBubbleParams;
	startFrame: number;
	duration: number;
}

export function QuoteBubble({ params, startFrame, duration }: Props) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const localFrame = frame - startFrame;
	if (localFrame < 0 || localFrame > duration) return null;

	// Pop-in 스프링
	const pop = spring({
		frame: localFrame,
		fps,
		config: { damping: 11, stiffness: 180, mass: 0.5 },
	});

	// 꼬리 bounce
	const tailY = Math.sin(localFrame * 0.3) * 2;

	const opacity = interpolate(
		localFrame,
		[0, 6, duration - 12, duration],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	const color = params.color ?? "#fff";
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
				padding: "18%",
				pointerEvents: "none",
				opacity,
			}}
		>
			<div
				style={{
					position: "relative",
					transform: `scale(${pop})`,
					maxWidth: "85%",
				}}
			>
				{/* 말풍선 몸통 */}
				<div
					style={{
						background: color,
						borderRadius: 24,
						padding: "24px 36px",
						boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
					}}
				>
					<div
						style={{
							fontSize: 42,
							fontWeight: 700,
							color: "#111",
							fontFamily: "'Noto Sans KR', serif",
							lineHeight: 1.35,
							fontStyle: "italic",
							letterSpacing: "-0.01em",
						}}
					>
						&ldquo;{params.text}&rdquo;
					</div>
					{params.speaker && (
						<div
							style={{
								marginTop: 12,
								fontSize: 22,
								fontWeight: 600,
								color: "#666",
								fontFamily: "'Noto Sans KR', sans-serif",
								textAlign: "right",
							}}
						>
							— {params.speaker}
						</div>
					)}
				</div>

				{/* 꼬리 */}
				<div
					style={{
						position: "absolute",
						bottom: -18,
						left: "15%",
						width: 0,
						height: 0,
						borderLeft: "18px solid transparent",
						borderRight: "18px solid transparent",
						borderTop: `22px solid ${color}`,
						transform: `translateY(${tailY}px)`,
						filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.4))",
					}}
				/>
			</div>
		</div>
	);
}
