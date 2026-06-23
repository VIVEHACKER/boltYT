/**
 * 아웃트로 엔드 카드 — 구독 CTA + 채널명
 */

import {
	AbsoluteFill,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { END_CARD_FRAMES } from "./card-frames";

export interface EndCardProps {
	channelName?: string;
	ctaText?: string;
}

/** 엔드 카드 기본 길이: 150프레임 (5초). 값은 card-frames.ts(순수). */
export { END_CARD_FRAMES };

export function EndCard({
	channelName = "",
	ctaText = "구독과 좋아요 부탁드립니다",
}: EndCardProps) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// 페이드인
	const fadeIn = interpolate(frame, [0, 20], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// CTA 텍스트 spring 등장
	const ctaSpring = spring({
		frame: frame - 15,
		fps,
		config: { damping: 14, stiffness: 80, mass: 0.8 },
	});

	// 구독 버튼 등장
	const btnSpring = spring({
		frame: frame - 35,
		fps,
		config: { damping: 16, stiffness: 100, mass: 0.6 },
	});

	// 추천 영상 박스 등장
	const box1Spring = spring({
		frame: frame - 50,
		fps,
		config: { damping: 18, stiffness: 90, mass: 0.7 },
	});
	const box2Spring = spring({
		frame: frame - 60,
		fps,
		config: { damping: 18, stiffness: 90, mass: 0.7 },
	});

	// 페이드아웃
	const fadeOut = interpolate(
		frame,
		[END_CARD_FRAMES - 20, END_CARD_FRAMES],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	const opacity = fadeIn * fadeOut;

	return (
		<AbsoluteFill
			style={{
				backgroundColor: "#0a0a0a",
				opacity,
			}}
		>
			{/* 배경 그라데이션 */}
			<AbsoluteFill
				style={{
					background:
						"radial-gradient(ellipse at 30% 40%, rgba(30,30,80,0.4) 0%, transparent 60%), radial-gradient(ellipse at 70% 60%, rgba(80,30,30,0.3) 0%, transparent 60%)",
				}}
			/>

			{/* 메인 콘텐츠 */}
			<AbsoluteFill
				style={{
					justifyContent: "center",
					alignItems: "center",
					gap: 30,
					flexDirection: "column",
				}}
			>
				{/* 채널명 */}
				{channelName && (
					<span
						style={{
							fontSize: 20,
							fontWeight: 500,
							color: "rgba(255,255,255,0.5)",
							fontFamily: "'Noto Sans KR', sans-serif",
							letterSpacing: "0.12em",
							textTransform: "uppercase",
							opacity: fadeIn,
						}}
					>
						{channelName}
					</span>
				)}

				{/* CTA 텍스트 */}
				<h2
					style={{
						fontSize: 48,
						fontWeight: 800,
						color: "#ffffff",
						fontFamily: "'Noto Sans KR', sans-serif",
						margin: 0,
						transform: `translateY(${interpolate(ctaSpring, [0, 1], [40, 0])}px)`,
						opacity: ctaSpring,
						letterSpacing: "-0.02em",
						textShadow: "0 2px 20px rgba(0,0,0,0.5)",
					}}
				>
					{ctaText}
				</h2>

				{/* 구독 버튼 */}
				<div
					style={{
						transform: `scale(${interpolate(btnSpring, [0, 1], [0.5, 1])})`,
						opacity: btnSpring,
						background: "#FF0000",
						borderRadius: 8,
						padding: "14px 48px",
						display: "flex",
						alignItems: "center",
						gap: 10,
						boxShadow: "0 4px 20px rgba(255,0,0,0.3)",
					}}
				>
					<span
						style={{
							fontSize: 22,
							fontWeight: 700,
							color: "#ffffff",
							fontFamily: "'Noto Sans KR', sans-serif",
						}}
					>
						구독하기
					</span>
				</div>

				{/* 추천 영상 플레이스홀더 */}
				<div
					style={{
						display: "flex",
						gap: 24,
						marginTop: 30,
					}}
				>
					{[box1Spring, box2Spring].map((sp, i) => (
						<div
							key={i === 0 ? "box1" : "box2"}
							style={{
								width: 280,
								height: 158,
								borderRadius: 12,
								border: "2px solid rgba(255,255,255,0.15)",
								background: "rgba(255,255,255,0.05)",
								transform: `scale(${interpolate(sp, [0, 1], [0.7, 1])})`,
								opacity: sp,
								display: "flex",
								justifyContent: "center",
								alignItems: "center",
							}}
						>
							{/* 재생 아이콘 */}
							<div
								style={{
									width: 48,
									height: 48,
									borderRadius: "50%",
									background: "rgba(255,255,255,0.15)",
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
								}}
							>
								<div
									style={{
										width: 0,
										height: 0,
										borderLeft: "16px solid rgba(255,255,255,0.6)",
										borderTop: "10px solid transparent",
										borderBottom: "10px solid transparent",
										marginLeft: 4,
									}}
								/>
							</div>
						</div>
					))}
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
}
