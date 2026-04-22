/**
 * LowerThird V2 — 좌측 슬라이드 인 + 세로 액센트 바 + 페이드 아웃.
 * 방송급 뉴스/다큐 로워서드.
 */

import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export interface LowerThirdParams {
	title: string;
	subtitle?: string;
	/** hex 액센트색 */
	accent?: string;
	/** 위치 — bottom 기본 */
	position?: "bottom" | "top";
}

interface Props {
	params: LowerThirdParams;
	startFrame: number;
	duration: number;
}

export function LowerThirdV2({ params, startFrame, duration }: Props) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const localFrame = frame - startFrame;
	if (localFrame < 0 || localFrame > duration) return null;

	// 좌측에서 슬라이드 + 스프링
	const slide = spring({
		frame: localFrame,
		fps,
		config: { damping: 14, stiffness: 110, mass: 0.6 },
	});
	const translateX = interpolate(slide, [0, 1], [-60, 0]);

	const opacity = interpolate(
		localFrame,
		[0, 6, duration - 15, duration],
		[0, 1, 1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	// 액센트 바 scaleY 애니메이션
	const barScale = interpolate(localFrame, [4, 16], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const accent = params.accent ?? "#e63946";
	const isTop = params.position === "top";

	return (
		<div
			style={{
				position: "absolute",
				left: "6%",
				right: "6%",
				[isTop ? "top" : "bottom"]: "12%",
				display: "flex",
				alignItems: "center",
				gap: 20,
				transform: `translateX(${translateX}px)`,
				opacity,
				pointerEvents: "none",
			}}
		>
			{/* 세로 액센트 바 */}
			<div
				style={{
					width: 8,
					height: 80,
					backgroundColor: accent,
					boxShadow: `0 0 20px ${accent}`,
					transform: `scaleY(${barScale})`,
					transformOrigin: "center",
				}}
			/>

			{/* 텍스트 블록 */}
			<div
				style={{
					background: "rgba(0,0,0,0.82)",
					backdropFilter: "blur(16px)",
					WebkitBackdropFilter: "blur(16px)",
					padding: "16px 28px",
					borderRadius: 4,
					borderLeft: `4px solid ${accent}`,
					maxWidth: "80%",
				}}
			>
				<div
					style={{
						fontSize: 44,
						fontWeight: 800,
						color: "#fff",
						fontFamily: "'Noto Sans KR', sans-serif",
						letterSpacing: "-0.02em",
						lineHeight: 1.15,
					}}
				>
					{params.title}
				</div>
				{params.subtitle && (
					<div
						style={{
							fontSize: 24,
							fontWeight: 500,
							color: `${accent}`,
							marginTop: 6,
							fontFamily: "'Noto Sans KR', sans-serif",
							textTransform: "uppercase",
							letterSpacing: "0.08em",
						}}
					>
						{params.subtitle}
					</div>
				)}
			</div>
		</div>
	);
}
