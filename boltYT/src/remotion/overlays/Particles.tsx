/**
 * 파티클 오버레이 — 떠다니는 먼지/빛 입자
 * mood에 따라 개수/크기/밝기 조절
 */

import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { SceneMood } from "../types";

interface Props {
	mood?: SceneMood;
	/** 파티클 개수 (기본: mood에 따라 자동) */
	count?: number;
}

interface Particle {
	x: number;
	y: number;
	size: number;
	speed: number;
	opacity: number;
	drift: number;
}

const MOOD_CONFIG: Record<
	SceneMood,
	{ count: number; sizeRange: [number, number]; opacityRange: [number, number] }
> = {
	horror: { count: 35, sizeRange: [3, 9], opacityRange: [0.18, 0.45] },
	mystery: { count: 28, sizeRange: [3, 8], opacityRange: [0.2, 0.4] },
	news: { count: 0, sizeRange: [0, 0], opacityRange: [0, 0] },
	neutral: { count: 14, sizeRange: [2, 5], opacityRange: [0.12, 0.28] },
	warm: { count: 22, sizeRange: [3, 7], opacityRange: [0.15, 0.35] },
};

/** 결정적 pseudo-random (시드 기반) */
function seededRandom(seed: number): number {
	const x = Math.sin(seed * 127.1 + seed * 311.7) * 43758.5453;
	return x - Math.floor(x);
}

function generateParticles(count: number, mood: SceneMood): Particle[] {
	const config = MOOD_CONFIG[mood];
	const particles: Particle[] = [];

	for (let i = 0; i < count; i++) {
		const r1 = seededRandom(i * 3 + 1);
		const r2 = seededRandom(i * 3 + 2);
		const r3 = seededRandom(i * 3 + 3);
		const r4 = seededRandom(i * 7 + 5);
		const r5 = seededRandom(i * 11 + 7);

		particles.push({
			x: r1 * 100,
			y: r2 * 100,
			size:
				config.sizeRange[0] + r3 * (config.sizeRange[1] - config.sizeRange[0]),
			speed: 0.3 + r4 * 0.7,
			opacity:
				config.opacityRange[0] +
				r5 * (config.opacityRange[1] - config.opacityRange[0]),
			drift: (r1 - 0.5) * 0.3,
		});
	}

	return particles;
}

export function Particles({ mood = "neutral", count }: Props) {
	const frame = useCurrentFrame();
	const config = MOOD_CONFIG[mood];
	const particleCount = count ?? config.count;

	if (particleCount === 0) return null;

	const particles = generateParticles(particleCount, mood);

	return (
		<AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
			{particles.map((p) => {
				// 결정적 키: 시드 기반 좌표로 유일성 보장
				const particleKey = `p-${p.x.toFixed(1)}-${p.y.toFixed(1)}-${p.size.toFixed(1)}`;

				// 느리게 위로 떠오름 + 좌우 drift
				const yOffset = (frame * p.speed * 0.15) % 120;
				const xDrift = Math.sin(frame * 0.02 * p.speed + p.x) * 20 * p.drift;
				const currentY = p.y - yOffset;
				const wrappedY = (((currentY % 120) + 120) % 120) - 10;

				// 부드러운 깜빡임
				const flicker =
					0.7 + 0.3 * Math.sin(frame * 0.05 * p.speed + p.y * 2.3);

				return (
					<div
						key={particleKey}
						style={{
							position: "absolute",
							left: `${p.x + xDrift}%`,
							top: `${wrappedY}%`,
							width: p.size,
							height: p.size,
							borderRadius: "50%",
							backgroundColor:
								mood === "warm" ? "rgba(255,220,150,1)" : "rgba(255,255,255,1)",
							opacity: p.opacity * flicker,
							mixBlendMode: "screen",
							filter: `blur(${p.size > 3 ? 1 : 0}px)`,
						}}
					/>
				);
			})}
		</AbsoluteFill>
	);
}

/**
 * 라이트릭 오버레이 — 부드럽게 이동하는 빛 번짐
 * mystery/warm mood에서만 활성
 */
export function LightLeak({ mood = "neutral" }: { mood?: SceneMood }) {
	const frame = useCurrentFrame();

	if (mood === "news" || mood === "neutral") return null;

	// 빛이 천천히 이동
	const posX = 60 + Math.sin(frame * 0.008) * 30;
	const posY = 30 + Math.cos(frame * 0.006) * 20;

	const leakColor =
		mood === "warm"
			? "rgba(255, 180, 80, 0.14)"
			: mood === "mystery"
				? "rgba(255, 200, 100, 0.12)"
				: "rgba(150, 100, 255, 0.1)";

	return (
		<AbsoluteFill
			style={{
				pointerEvents: "none",
				background: `radial-gradient(circle at ${posX}% ${posY}%, ${leakColor} 0%, transparent 60%)`,
				mixBlendMode: "screen",
			}}
		/>
	);
}
