/**
 * 인트로 타이틀 카드 — 시네마틱 레터박스 + spring 애니메이션
 */

import {
	AbsoluteFill,
	Img,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { TITLE_CARD_FRAMES } from "./card-frames";
import { CARD_TEXT } from "../typography";

export interface TitleCardProps {
	title: string;
	subtitle?: string;
	channelName?: string;
	/** 배경 이미지 (있으면 어둡게 깔림) */
	backgroundUrl?: string;
	/** 쇼츠 훅 모드 — 짧고 강렬하게 (45프레임) */
	hookMode?: boolean;
}

/** 타이틀 카드 기본 길이: 90프레임 (3초), hookMode: 45프레임 (1.5초). 값은 card-frames.ts(순수). */
export { TITLE_CARD_FRAMES };
export const HOOK_CARD_FRAMES = 45;

export function TitleCard({
	title,
	subtitle,
	channelName,
	backgroundUrl,
}: TitleCardProps) {
	const frame = useCurrentFrame();
	const { fps, width, height } = useVideoConfig();

	// 레터박스 바 (2.35:1 시네마스코프)
	const barHeight = height * 0.12;
	const barProgress = interpolate(
		frame,
		[0, 20, 70, TITLE_CARD_FRAMES],
		[0, 1, 1, 0],
		{
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		},
	);

	// 채널명 페이드인
	const channelOpacity = interpolate(frame, [8, 20], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// 타이틀 spring 등장
	const titleSpring = spring({
		frame: frame - 15,
		fps,
		config: { damping: 14, stiffness: 100, mass: 0.7 },
	});
	const titleY = interpolate(titleSpring, [0, 1], [60, 0]);
	const titleOpacity = interpolate(titleSpring, [0, 1], [0, 1]);

	// 서브타이틀 딜레이 등장
	const subOpacity = interpolate(frame, [35, 48], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// 전체 페이드아웃
	const fadeOut = interpolate(
		frame,
		[TITLE_CARD_FRAMES - 15, TITLE_CARD_FRAMES],
		[1, 0],
		{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
	);

	// 배경 Ken Burns
	const bgScale = interpolate(frame, [0, TITLE_CARD_FRAMES], [1, 1.08], {
		extrapolateRight: "clamp",
	});

	return (
		<AbsoluteFill style={{ backgroundColor: "#000", opacity: fadeOut }}>
			{/* 배경 이미지 */}
			{backgroundUrl && (
				<AbsoluteFill style={{ overflow: "hidden" }}>
					<Img
						src={backgroundUrl}
						style={{
							width: "100%",
							height: "100%",
							objectFit: "cover",
							transform: `scale(${bgScale})`,
							filter: "brightness(0.25) blur(2px)",
						}}
					/>
				</AbsoluteFill>
			)}

			{/* 비네트 */}
			<AbsoluteFill
				style={{
					background:
						"radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.8) 100%)",
				}}
			/>

			{/* 채널명 — 상단 */}
			{channelName && (
				<AbsoluteFill
					style={{
						justifyContent: "flex-start",
						alignItems: "center",
						padding: `${barHeight + 30}px 0 0`,
						opacity: channelOpacity,
					}}
				>
					<span
						style={{
							fontSize: CARD_TEXT.channel.fontSize,
							fontWeight: CARD_TEXT.channel.fontWeight,
							color: CARD_TEXT.channel.color,
							fontFamily: CARD_TEXT.channel.fontFamily,
							letterSpacing: "0.15em",
							textTransform: "uppercase",
						}}
					>
						{channelName}
					</span>
				</AbsoluteFill>
			)}

			{/* 메인 타이틀 — 중앙 */}
			<AbsoluteFill
				style={{
					justifyContent: "center",
					alignItems: "center",
					padding: "0 120px",
				}}
			>
				<div
					style={{
						transform: `translateY(${titleY}px)`,
						opacity: titleOpacity,
						textAlign: "center",
					}}
				>
					<h1
						style={{
							fontSize: Math.min(
								CARD_TEXT.title.fontSizeMax,
								width * CARD_TEXT.title.fontSizeWidthFactor,
							),
							fontWeight: CARD_TEXT.title.fontWeight,
							color: CARD_TEXT.title.color,
							fontFamily: CARD_TEXT.title.fontFamily,
							lineHeight: 1.3,
							margin: 0,
							letterSpacing: "-0.02em",
							textShadow: CARD_TEXT.title.textShadow,
						}}
					>
						{title}
					</h1>
				</div>

				{/* 서브타이틀 */}
				{subtitle && (
					<p
						style={{
							fontSize: CARD_TEXT.subtitle.fontSize,
							fontWeight: CARD_TEXT.subtitle.fontWeight,
							color: CARD_TEXT.subtitle.color,
							fontFamily: CARD_TEXT.subtitle.fontFamily,
							marginTop: 20,
							opacity: subOpacity,
							letterSpacing: "0.02em",
						}}
					>
						{subtitle}
					</p>
				)}
			</AbsoluteFill>

			{/* 시네마스코프 레터박스 바 */}
			<AbsoluteFill style={{ pointerEvents: "none" }}>
				{/* 상단 바 */}
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: barHeight * barProgress,
						backgroundColor: "#000",
					}}
				/>
				{/* 하단 바 */}
				<div
					style={{
						position: "absolute",
						bottom: 0,
						left: 0,
						right: 0,
						height: barHeight * barProgress,
						backgroundColor: "#000",
					}}
				/>
			</AbsoluteFill>

			{/* 중앙 구분선 */}
			<AbsoluteFill
				style={{
					justifyContent: "center",
					alignItems: "center",
				}}
			>
				<div
					style={{
						position: "absolute",
						top: "50%",
						marginTop: 50,
						width: interpolate(frame, [20, 40], [0, 120], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						}),
						height: 2,
						backgroundColor: "rgba(255,255,255,0.3)",
					}}
				/>
			</AbsoluteFill>
		</AbsoluteFill>
	);
}
