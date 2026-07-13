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
import { END_CARD_TEXT } from "../typography";

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

	const contentOpacity = fadeIn * fadeOut;

	return (
		<AbsoluteFill
			style={{
				// 배경은 마지막 프레임까지 유지한다. 전체 카드를 투명하게 만들면
				// Remotion 캔버스의 검정이 노출돼 최종 QC에서 black segment가 된다.
				backgroundColor: "#111827",
			}}
		>
			{/* 배경 그라데이션 */}
			<AbsoluteFill
				style={{
					background:
						"radial-gradient(ellipse at 28% 36%, rgba(37,99,235,0.42) 0%, transparent 58%), radial-gradient(ellipse at 72% 64%, rgba(245,158,11,0.24) 0%, transparent 56%), linear-gradient(145deg, #111827 0%, #172554 100%)",
				}}
			/>

			{/* 메인 콘텐츠 */}
			<AbsoluteFill
				style={{
					justifyContent: "center",
					alignItems: "center",
					gap: 30,
					flexDirection: "column",
					opacity: contentOpacity,
				}}
			>
				{/* 채널명 */}
				{channelName && (
					<span
						style={{
							fontSize: END_CARD_TEXT.channel.fontSize,
							fontWeight: END_CARD_TEXT.channel.fontWeight,
							color: END_CARD_TEXT.channel.color,
							fontFamily: END_CARD_TEXT.channel.fontFamily,
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
						fontSize: END_CARD_TEXT.cta.fontSize,
						fontWeight: END_CARD_TEXT.cta.fontWeight,
						color: END_CARD_TEXT.cta.color,
						fontFamily: END_CARD_TEXT.cta.fontFamily,
						margin: 0,
						transform: `translateY(${interpolate(ctaSpring, [0, 1], [40, 0])}px)`,
						opacity: ctaSpring,
						letterSpacing: "-0.02em",
						textShadow: END_CARD_TEXT.cta.textShadow,
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
							fontSize: END_CARD_TEXT.subscribeButton.fontSize,
							fontWeight: END_CARD_TEXT.subscribeButton.fontWeight,
							color: END_CARD_TEXT.subscribeButton.color,
							fontFamily: END_CARD_TEXT.subscribeButton.fontFamily,
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
