/**
 * Beat Sync — BGM 템포에 씬 길이 맞추기
 *
 * 레퍼런스 템플릿의 bgm_tempo(slow/mid/fast)로 BPM 추정 →
 * 씬 duration을 가장 가까운 N비트 단위로 snap.
 *
 * 쇼츠 컷이 비트에 떨어지면 "리듬감"이 급격히 올라감 — 프로 편집 핵심.
 */

export type BgmTempo = "slow" | "mid" | "fast";
type WordTiming = { startFrame: number; endFrame: number };
type SceneWithWordTimings = {
	duration_seconds: number;
	word_timings?: WordTiming[];
};

/** 템포별 BPM 추정치 (일반적인 쇼츠 BGM 범위) */
const BPM_BY_TEMPO: Record<BgmTempo, number> = {
	slow: 80,
	mid: 100,
	fast: 130,
};

export function estimatedBpmFromTempo(tempo: BgmTempo): number {
	return BPM_BY_TEMPO[tempo];
}

/**
 * BPM + FPS를 프레임 단위 비트 길이로 변환.
 * 예) 100 BPM @ 30fps → 0.6초/비트 → 18프레임/비트
 */
export function beatFrames(bpm: number, fps = 30): number {
	return Math.round((60 / bpm) * fps);
}

/**
 * 씬 duration(초)을 가장 가까운 N비트 단위(2/4)로 snap.
 *
 * @param originalSeconds 원본 duration (초)
 * @param tempo BGM 템포
 * @param minBeats 최소 비트 수 (기본 2)
 * @returns snap된 duration (초)
 */
export function snapDurationToBeat(
	originalSeconds: number,
	tempoOrBpm: BgmTempo | number,
	minBeats = 2,
): number {
	const bpm =
		typeof tempoOrBpm === "number" ? tempoOrBpm : BPM_BY_TEMPO[tempoOrBpm];
	const beatSec = 60 / bpm;

	// 2비트 단위로 snap (더 자연스러움)
	const beats = Math.max(
		minBeats,
		Math.round(originalSeconds / beatSec / 2) * 2,
	);
	return Number((beats * beatSec).toFixed(2));
}

/**
 * 실측된 비트 타임스탬프 배열에 가장 가까운 비트에 snap.
 * BPM 평균보다 실제 비트 위치가 정확함.
 */
export function snapToNearestBeat(
	targetSeconds: number,
	beats: number[],
): number {
	if (beats.length === 0) return targetSeconds;
	let closest = beats[0];
	let minDiff = Math.abs(beats[0] - targetSeconds);
	for (const b of beats) {
		const d = Math.abs(b - targetSeconds);
		if (d < minDiff) {
			minDiff = d;
			closest = b;
		}
	}
	return closest;
}

/**
 * 전체 씬 배열을 BGM 비트에 맞춰 재타이밍.
 * 원본 합계와 너무 벗어나지 않도록 비례 조정.
 */
export function snapScenesToBeat<T extends { duration_seconds: number }>(
	scenes: T[],
	tempo: BgmTempo,
): T[] {
	if (scenes.length === 0) return scenes;

	const originalTotal = scenes.reduce((s, sc) => s + sc.duration_seconds, 0);

	const snapped = scenes.map((s) => ({
		...s,
		duration_seconds: snapDurationToBeat(s.duration_seconds, tempo),
	}));

	// 총 길이가 원본 대비 ±30% 벗어나면 비례 조정 (과도한 변형 방지)
	const snappedTotal = snapped.reduce((s, sc) => s + sc.duration_seconds, 0);
	const ratio = snappedTotal / originalTotal;
	if (ratio < 0.7 || ratio > 1.3) {
		const scale = originalTotal / snappedTotal;
		return snapped.map((s) => ({
			...s,
			duration_seconds: Number((s.duration_seconds * scale).toFixed(2)),
		}));
	}

	return snapped;
}

function minSceneDurationSeconds(
	scene: SceneWithWordTimings,
	fps = 30,
): number {
	const lastWordEndFrame =
		scene.word_timings?.reduce(
			(maxFrame, word) => Math.max(maxFrame, word.endFrame),
			0,
		) ?? 0;
	if (lastWordEndFrame <= 0) {
		return Math.min(
			Number(scene.duration_seconds),
			Math.max(0.9, Number((scene.duration_seconds * 0.72).toFixed(2))),
		);
	}
	return Number((lastWordEndFrame / fps + 0.18).toFixed(2));
}

function snapBoundarySeconds(
	targetSeconds: number,
	options: { beats?: number[]; bpm?: number; maxDriftSeconds: number },
): number {
	const { beats = [], bpm = 0, maxDriftSeconds } = options;
	if (beats.length > 0) {
		const snapped = snapToNearestBeat(targetSeconds, beats);
		return Math.abs(snapped - targetSeconds) <= maxDriftSeconds
			? snapped
			: targetSeconds;
	}
	if (bpm > 0) {
		const beatSec = 60 / bpm;
		const snapped = Math.round(targetSeconds / beatSec) * beatSec;
		return Math.abs(snapped - targetSeconds) <= maxDriftSeconds
			? Number(snapped.toFixed(2))
			: targetSeconds;
	}
	return targetSeconds;
}

/**
 * 씬 경계를 비트 그리드에 맞춰 다시 배치.
 * - 실제 beat timestamp가 있으면 우선 사용
 * - 없으면 BPM 평균값으로 fallback
 * - 나레이션 마지막 단어보다 앞에서 컷이 나지 않도록 최소 길이 보장
 */
export function retimeScenesToBeatGrid<T extends SceneWithWordTimings>(
	scenes: T[],
	options: {
		beats?: number[];
		bpm?: number;
		fps?: number;
		hookSeconds?: number;
		maxHookDriftSeconds?: number;
		maxDriftSeconds?: number;
	} = {},
): T[] {
	if (scenes.length === 0) return scenes;

	const fps = options.fps ?? 30;
	const hookSeconds = options.hookSeconds ?? 10;
	const maxHookDriftSeconds = options.maxHookDriftSeconds ?? 0.22;
	const maxDriftSeconds = options.maxDriftSeconds ?? 0.26;

	let originalCursor = 0;
	let retimedCursor = 0;

	return scenes.map((scene, index) => {
		originalCursor += Number(scene.duration_seconds);
		const minDuration = minSceneDurationSeconds(scene, fps);
		const isLast = index === scenes.length - 1;
		const inHook = retimedCursor < hookSeconds;
		const snappedBoundary = snapBoundarySeconds(originalCursor, {
			beats: options.beats,
			bpm: options.bpm,
			maxDriftSeconds: inHook ? maxHookDriftSeconds : maxDriftSeconds,
		});
		const targetDuration = isLast
			? Math.max(minDuration, Number(scene.duration_seconds))
			: Math.max(minDuration, snappedBoundary - retimedCursor);
		const duration_seconds = Number(targetDuration.toFixed(2));
		retimedCursor += duration_seconds;
		return {
			...scene,
			duration_seconds,
		};
	});
}

/**
 * 쇼츠 총 길이를 목표 범위로 proportional rescale.
 * beat-sync 이후 마지막 단계로 호출. intro/outro 여유분 제외.
 *
 * @param scenes beat-sync 완료된 씬 배열
 * @param targetMin 목표 최솟값(초), 기본 50
 * @param targetMax 목표 최댓값(초), 기본 58
 */
export function clampShortsDuration<T extends { duration_seconds: number }>(
	scenes: T[],
	targetMin = 50,
	targetMax = 58,
): T[] {
	if (scenes.length === 0) return scenes;
	const total = scenes.reduce((s, sc) => s + Number(sc.duration_seconds), 0);
	if (total >= targetMin && total <= targetMax) return scenes;

	const target = total < targetMin ? targetMin : targetMax;
	const scale = target / total;
	return scenes.map((sc) => ({
		...sc,
		duration_seconds: Number((Number(sc.duration_seconds) * scale).toFixed(2)),
	}));
}
