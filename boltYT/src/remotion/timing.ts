import type { RemotionScene } from "./types";
import { TRANSITION_FRAMES } from "./types";

// J/L-cut — 씬 경계에서 오디오 오버랩 (프로 쇼츠 편집감)
export const J_CUT_PRE_FRAMES = 4;
export const L_CUT_POST_FRAMES = 6;

/**
 * 씬 mood 별 J/L-cut 프레임 — 페이싱 차별화.
 * news: 짧고 정확 / story: 길고 매끄럽게 / fast pacing: 짧게 / horror: L 길게 (긴장 잔향)
 */
function getMoodCutFrames(scene?: RemotionScene): {
	jPre: number;
	lPost: number;
} {
	const mood = scene?.mood;
	const pacing = scene?.pacing;
	if (pacing === "fast") return { jPre: 2, lPost: 3 };
	if (pacing === "slow") return { jPre: 5, lPost: 9 };
	if (mood === "news") return { jPre: 2, lPost: 4 };
	if (mood === "horror" || mood === "mystery") return { jPre: 5, lPost: 10 };
	if (mood === "warm") return { jPre: 4, lPost: 8 };
	return { jPre: J_CUT_PRE_FRAMES, lPost: L_CUT_POST_FRAMES };
}

/** 씬별 트랜지션 프레임 수 계산 — pacing 별 boost (slow ↑ / fast ↓) */
export function getOverlapFrames(scene: RemotionScene): number {
	const t = scene.transition ?? "crossfade";
	const base = TRANSITION_FRAMES[t];
	// crossfade 만 pacing 영향 — 다른 트랜지션은 효과 자체가 길이 의존적
	if (t !== "crossfade") return base;
	const pacing = scene.pacing;
	if (pacing === "fast") return Math.max(8, Math.round(base * 0.55));
	if (pacing === "slow") return Math.round(base * 1.6);
	return base;
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
		sceneIndex < scenes.length - 1 && Boolean(scenes[sceneIndex + 1]?.audioUrl);
	const nextOverlap =
		sceneIndex < scenes.length - 1
			? getOverlapFrames(scenes[sceneIndex + 1])
			: 0;
	const seamNext = nextHasAudio
		? to - Math.floor(nextOverlap / 2)
		: totalFrames;

	const { jPre, lPost } = getMoodCutFrames(scenes[sceneIndex]);
	const audioFrom = Math.max(seamPrev, from - jPre);
	const audioEnd = Math.min(seamNext, to + lPost);

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
