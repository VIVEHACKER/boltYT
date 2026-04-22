/**
 * 텍스트 이펙트 — text_emphasis 씬 전용 애니메이션
 * typewriter | glitch | scale_in | none
 */

import type React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TextEffect } from "../types";

interface Props {
	effect: TextEffect;
	children: React.ReactNode;
	durationInFrames: number;
}

export function TextEffectWrapper({
	effect,
	children,
	durationInFrames,
}: Props) {
	switch (effect) {
		case "typewriter":
			return (
				<TypewriterEffect durationInFrames={durationInFrames}>
					{children}
				</TypewriterEffect>
			);
		case "glitch":
			return (
				<GlitchTextEffect durationInFrames={durationInFrames}>
					{children}
				</GlitchTextEffect>
			);
		case "scale_in":
			return <ScaleInEffect>{children}</ScaleInEffect>;
		default:
			return <>{children}</>;
	}
}

/** 타자기 효과 — 글자가 한 글자씩 나타남 */
function TypewriterEffect({
	children,
	durationInFrames,
}: {
	children: React.ReactNode;
	durationInFrames: number;
}) {
	const frame = useCurrentFrame();

	// 텍스트 노출 진행률 (처음 70% 구간에서 타이핑, 나머지 30%는 유지)
	const typingEnd = Math.floor(durationInFrames * 0.7);
	const progress = interpolate(frame, [8, typingEnd], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// 커서 깜빡임
	const cursorVisible = Math.floor(frame / 8) % 2 === 0;

	return (
		<div style={{ position: "relative", display: "inline" }}>
			<div
				style={{
					clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
					display: "inline",
				}}
			>
				{children}
			</div>
			{progress < 1 && (
				<span
					style={{
						opacity: cursorVisible ? 1 : 0,
						color: "#ffffff",
						fontWeight: 100,
						fontSize: "inherit",
						marginLeft: 2,
					}}
				>
					|
				</span>
			)}
		</div>
	);
}

/** 글리치 텍스트 — 주기적 RGB 분리 + 수평 슬라이스 */
function GlitchTextEffect({
	children,
}: {
	children: React.ReactNode;
	durationInFrames: number;
}) {
	const frame = useCurrentFrame();

	// 글리치 발동 주기: 매 18~25 프레임마다 3 프레임간 발동
	const cycle = 22;
	const glitchDuration = 3;
	const posInCycle = frame % cycle;
	const isGlitching = posInCycle < glitchDuration && frame > 10;

	// 페이드인
	const opacity = interpolate(frame, [0, 12], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	if (!isGlitching) {
		return <div style={{ opacity }}>{children}</div>;
	}

	const jitterX = Math.sin(frame * 13.7) * 8;
	const sliceY1 = 30 + Math.sin(frame * 7.3) * 20;
	const sliceY2 = 70 + Math.sin(frame * 11.1) * 15;

	return (
		<div style={{ position: "relative", opacity }}>
			{/* 원본 */}
			<div
				style={{
					transform: `translateX(${jitterX}px)`,
					clipPath: `polygon(0 0, 100% 0, 100% ${sliceY1}%, 0 ${sliceY1}%)`,
				}}
			>
				{children}
			</div>
			{/* 중간 슬라이스 — 반대 방향 */}
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					transform: `translateX(${-jitterX * 1.5}px)`,
					clipPath: `polygon(0 ${sliceY1}%, 100% ${sliceY1}%, 100% ${sliceY2}%, 0 ${sliceY2}%)`,
					filter:
						"drop-shadow(3px 0 0 rgba(255,0,0,0.6)) drop-shadow(-3px 0 0 rgba(0,255,255,0.6))",
				}}
			>
				{children}
			</div>
			{/* 하단 슬라이스 */}
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					transform: `translateX(${jitterX * 0.7}px)`,
					clipPath: `polygon(0 ${sliceY2}%, 100% ${sliceY2}%, 100% 100%, 0 100%)`,
				}}
			>
				{children}
			</div>
		</div>
	);
}

/** 스케일 인 — spring 바운스로 등장 */
function ScaleInEffect({ children }: { children: React.ReactNode }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const scale = spring({
		frame: frame - 6, // 6프레임 딜레이
		fps,
		config: { damping: 12, stiffness: 120, mass: 0.8 },
	});

	const opacity = interpolate(frame, [4, 14], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<div
			style={{
				transform: `scale(${interpolate(scale, [0, 1], [0.3, 1])})`,
				opacity,
			}}
		>
			{children}
		</div>
	);
}
