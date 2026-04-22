/**
 * 로워서드 출처 표시 — 뉴스/자료 출처를 하단 좌측에 표시
 * 슬라이드인 → 3초 유지 → 페이드아웃
 */

import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
	getLowerThirdTheme,
	type NewsSurfaceTone,
} from "../../lib/news-surface-theme";
import type { SceneMood } from "../types";

interface Props {
	source: string;
	date?: string;
	mood?: SceneMood;
	hookBoost?: boolean;
	tone?: NewsSurfaceTone;
}

export function LowerThird({
	source,
	date,
	mood = "neutral",
	hookBoost = false,
	tone = "generic",
}: Props) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const theme = getLowerThirdTheme({ mood, hookBoost, tone });

	// 슬라이드인 (spring)
	const enterSpring = spring({
		frame: frame - 10,
		fps,
		config: { damping: 20, stiffness: 120, mass: 0.5 },
	});
	const translateX = interpolate(enterSpring, [0, 1], [-100, 0]);

	// 3초(90프레임) 후 페이드아웃
	const fadeOut = interpolate(frame, [100, 115], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const opacity = Math.min(enterSpring, fadeOut);

	if (opacity <= 0) return null;

	return (
		<div
			style={{
				position: "absolute",
				bottom: 120,
				left: 40,
				opacity,
				transform: `translateX(${translateX}%)`,
				zIndex: 10,
				...theme.shell,
			}}
		>
			<div style={theme.rail} />

			<div
				style={{
					...theme.panel,
				}}
			>
				<span style={theme.badge.style}>{theme.badge.text}</span>
				<span
					style={{
						fontFamily: "'Noto Sans KR', sans-serif",
						...theme.source,
					}}
				>
					{source}
				</span>
				{date && (
					<>
						<span style={theme.separator}>/</span>
						<span
							style={{
								fontFamily: "'Noto Sans KR', sans-serif",
								...theme.date,
							}}
						>
							{date}
						</span>
					</>
				)}
			</div>
		</div>
	);
}
