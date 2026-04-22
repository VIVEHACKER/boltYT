/**
 * Emoji Burst — 임팩트 순간 이모지가 사방으로 폭발.
 * 용도: 충격/반전/리액션 순간, "와우/헐/대박" 감정 증폭.
 */

import { interpolate, useCurrentFrame } from "remotion";

export interface EmojiBurstParams {
	/** 사용할 이모지 배열 (랜덤 선택) */
	emojis: string[];
	/** 파티클 수 */
	count?: number;
	/** 중앙에서 퍼지는 반경 (% 화면 기준) */
	radius?: number;
}

interface Props {
	params: EmojiBurstParams;
	startFrame: number;
	duration: number;
}

/** 결정적 pseudo-random (시드 기반) */
function seededRandom(seed: number): number {
	const x = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
	return x - Math.floor(x);
}

export function EmojiBurst({ params, startFrame, duration }: Props) {
	const frame = useCurrentFrame();
	const localFrame = frame - startFrame;
	if (localFrame < 0 || localFrame > duration) return null;

	const count = params.count ?? 14;
	const radius = params.radius ?? 35;
	const emojis = params.emojis.length > 0 ? params.emojis : ["💥"];

	// 버스트 타이밍: 0-15프레임에 퍼지고, 유지하다가 페이드 아웃
	const burstProgress = interpolate(localFrame, [0, 15], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const ease = 1 - (1 - burstProgress) ** 2;

	const particles = Array.from({ length: count }, (_, i) => {
		const seed = i + 1;
		const angle = (i / count) * Math.PI * 2 + seededRandom(seed) * 0.5;
		const r = radius * (0.6 + seededRandom(seed * 2) * 0.4);
		const x = 50 + Math.cos(angle) * r * ease;
		const y = 50 + Math.sin(angle) * r * ease;
		const emoji = emojis[Math.floor(seededRandom(seed * 3) * emojis.length)];
		const rotation = seededRandom(seed * 4) * 360 * ease;
		const size = 40 + seededRandom(seed * 5) * 40;
		return { x, y, emoji, rotation, size, seed };
	});

	const fadeOut = interpolate(localFrame, [duration - 12, duration], [1, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				pointerEvents: "none",
				opacity: fadeOut,
			}}
		>
			{particles.map((p) => (
				<div
					key={`${p.seed}-${p.emoji}`}
					style={{
						position: "absolute",
						left: `${p.x}%`,
						top: `${p.y}%`,
						transform: `translate(-50%, -50%) rotate(${p.rotation}deg) scale(${ease})`,
						fontSize: p.size,
						lineHeight: 1,
						filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.6))",
					}}
				>
					{p.emoji}
				</div>
			))}
		</div>
	);
}
