import type { RemotionScene } from "./types";
import { TRANSITION_FRAMES } from "./types";

// J/L-cut — 씬 경계에서 오디오 오버랩 (프로 쇼츠 편집감)
export const J_CUT_PRE_FRAMES = 4;
export const L_CUT_POST_FRAMES = 6;

/** 씬별 트랜지션 프레임 수 계산 */
export function getOverlapFrames(scene: RemotionScene): number {
	const t = scene.transition ?? "crossfade";
	return TRANSITION_FRAMES[t];
}

export function getSceneAudioWindow(
	scenes: RemotionScene[],
	sceneIndex: number,
	from: number,
	to: number,
	totalFrames: number,
) {
	const hasAudio = Boolean(scenes[sceneIndex]?.audioUrl);
	if (!hasAudio) return { from, to };

	const prevHasAudio =
		sceneIndex > 0 && Boolean(scenes[sceneIndex - 1]?.audioUrl);
	const prevOverlap = sceneIndex > 0 ? getOverlapFrames(scenes[sceneIndex]) : 0;
	const seamPrev = prevHasAudio ? from + Math.ceil(prevOverlap / 2) : 0;

	const nextHasAudio =
		sceneIndex < scenes.length - 1 &&
		Boolean(scenes[sceneIndex + 1]?.audioUrl);
	const nextOverlap =
		sceneIndex < scenes.length - 1
			? getOverlapFrames(scenes[sceneIndex + 1])
			: 0;
	const seamNext = nextHasAudio ? to - Math.floor(nextOverlap / 2) : totalFrames;

	const audioFrom = Math.max(seamPrev, from - J_CUT_PRE_FRAMES);
	const audioEnd = Math.min(seamNext, to + L_CUT_POST_FRAMES);

	return {
		from: audioFrom,
		to: Math.max(audioFrom + 1, audioEnd),
	};
}

/** 씬 타이밍 맵 — 가변 트랜지션 오버랩과 실제 J/L-cut 오디오 윈도우 지원 */
export function buildSceneTimeline(
	scenes: RemotionScene[],
	introFrames: number,
	totalFrames: number,
) {
	const timeline: Array<{
		from: number;
		to: number;
		hasAudio: boolean;
		overlapFrames: number;
		audioFrom: number;
		audioTo: number;
	}> = [];
	let f = introFrames;
	for (let i = 0; i < scenes.length; i++) {
		const from = f;
		const to = from + scenes[i].durationInFrames;
		const overlap = i < scenes.length - 1 ? getOverlapFrames(scenes[i + 1]) : 0;
		const hasAudio = Boolean(scenes[i].audioUrl);
		const audioWindow = getSceneAudioWindow(scenes, i, from, to, totalFrames);
		timeline.push({
			from,
			to,
			hasAudio,
			overlapFrames: overlap,
			audioFrom: audioWindow.from,
			audioTo: audioWindow.to,
		});
		f += scenes[i].durationInFrames - overlap;
	}
	return timeline;
}
