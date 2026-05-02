import type { RemotionScene } from "../remotion/types";

export interface BgmCueBurst {
	frame: number;
	strength: number;
	widthFrames: number;
}

export interface BgmCuePlan {
	startFromFrame: number;
	bursts: BgmCueBurst[];
	resolveFrame: number;
}

interface PlanOptions {
	beats?: number[];
	bpm?: number;
	fps?: number;
}

function buildSceneStarts(scenes: RemotionScene[]): number[] {
	let cursor = 0;
	return scenes.map((scene) => {
		const start = cursor;
		cursor += Math.max(0, scene.durationInFrames);
		return start;
	});
}

function toSeconds(frame: number, fps: number) {
	return frame / fps;
}

function snapSeconds(targetSeconds: number, beats: number[], bpm: number): number {
	if (beats.length > 0) {
		let closest = beats[0];
		let minDiff = Math.abs(beats[0] - targetSeconds);
		for (const beat of beats) {
			const diff = Math.abs(beat - targetSeconds);
			if (diff < minDiff) {
				minDiff = diff;
				closest = beat;
			}
		}
		return minDiff <= 0.24 ? closest : targetSeconds;
	}

	if (bpm > 0) {
		const beatSeconds = 60 / bpm;
		const snapped = Math.round(targetSeconds / beatSeconds) * beatSeconds;
		return Math.abs(snapped - targetSeconds) <= 0.24 ? snapped : targetSeconds;
	}

	return targetSeconds;
}

function scoreScene(scene: RemotionScene, startFrame: number, totalFrames: number) {
	const progress = totalFrames > 0 ? startFrame / totalFrames : 0;
	let score = 0;
	if (scene.hookBoost) score += 170;
	if (scene.type === "video") score += 80;
	if (scene.type === "text_emphasis") score += 120;
	if (scene.type === "news_overlay") score -= 120;
	if (scene.mood === "mystery" || scene.mood === "horror") score += 70;
	if (scene.mood === "news") score += 40;
	if (scene.pacing === "fast") score += 50;
	if (scene.durationInFrames <= 90) score += 24;
	if (progress >= 0.35 && progress <= 0.78) score += 16;
	if (progress < 0.12) score += 10;
	return score;
}

function uniqueBursts(bursts: BgmCueBurst[]) {
	const seen = new Set<number>();
	return bursts.filter((burst) => {
		const key = Math.round(burst.frame);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function planBgmCuePlan(
	scenes: RemotionScene[],
	options: PlanOptions = {},
): BgmCuePlan {
	const fps = options.fps ?? 30;
	if (scenes.length === 0) {
		return { startFromFrame: 0, bursts: [], resolveFrame: 0 };
	}

	const beats = options.beats ?? [];
	const bpm = options.bpm ?? 0;
	const starts = buildSceneStarts(scenes);
	const totalFrames = scenes.reduce(
		(sum, scene) => sum + Math.max(0, scene.durationInFrames),
		0,
	);

	let startFromFrame = 0;
	const firstBeat = beats[0] ?? 0;
	if (firstBeat >= 0.35 && firstBeat <= 2.2) {
		startFromFrame = Math.max(0, Math.round((firstBeat - 0.08) * fps));
	}

	const ranked = scenes
		.map((scene, index) => ({
			scene,
			index,
			startFrame: starts[index],
			score: scoreScene(scene, starts[index], totalFrames),
		}))
		.filter(({ scene }) => scene.type !== "news_overlay");

	const hookCandidate =
		ranked
			.filter(({ startFrame }) => toSeconds(startFrame, fps) < 10)
			.sort((a, b) => b.score - a.score)[0] ?? ranked[0];
	const climaxCandidate =
		ranked
			.filter(({ startFrame }) => {
				const progress = totalFrames > 0 ? startFrame / totalFrames : 0;
				return progress >= 0.35 && progress <= 0.82;
			})
			.sort((a, b) => b.score - a.score)[0] ??
		ranked[Math.min(ranked.length - 1, Math.floor(ranked.length * 0.6))];

	const lastSceneIndex = scenes.length - 1;
	const resolveBaseFrame =
		starts[lastSceneIndex] +
		Math.min(
			Math.round(scenes[lastSceneIndex].durationInFrames * 0.28),
			Math.round(fps * 1.2),
		);

	const hookFrame = Math.round(
		snapSeconds(
			toSeconds(
				hookCandidate.startFrame +
					Math.min(
						Math.round(hookCandidate.scene.durationInFrames * 0.35),
						Math.round(fps * 0.8),
					),
				fps,
			),
			beats,
			bpm,
		) * fps,
	);
	const climaxFrame = Math.round(
		snapSeconds(
			toSeconds(
				climaxCandidate.startFrame +
					Math.min(
						Math.round(climaxCandidate.scene.durationInFrames * 0.38),
						Math.round(fps * 0.9),
					),
				fps,
			),
			beats,
			bpm,
		) * fps,
	);
	const resolveFrame = Math.round(
		snapSeconds(toSeconds(resolveBaseFrame, fps), beats, bpm) * fps,
	);

	return {
		startFromFrame,
		bursts: uniqueBursts([
			{
				frame: hookFrame,
				strength: 0.12,
				widthFrames: Math.round(fps * 0.28),
			},
			{
				frame: climaxFrame,
				strength: 0.16,
				widthFrames: Math.round(fps * 0.34),
			},
		]).sort((a, b) => a.frame - b.frame),
		resolveFrame,
	};
}
