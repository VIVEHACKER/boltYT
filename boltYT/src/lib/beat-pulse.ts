/**
 * Beat-synced pulse — text emphasis 씬에서 BGM 비트와 맞춰 살짝 scale 펄스.
 * Composition 에서 frame 별 호출 → transform 추가.
 */

export interface BeatPulseOptions {
	/** scene start frame in composition (frame 0 기준) */
	sceneStartFrame: number;
	/** 현재 frame */
	frame: number;
	/** BGM 비트 시간(초) 배열 */
	beatTimes: number[];
	/** Composition fps */
	fps?: number;
	/** 비트 펄스 윈도우 (frames) */
	pulseWidthFrames?: number;
	/** 펄스 강도 — 1.0 = 변화 없음, 1.05 = 5% 확대 */
	intensity?: number;
}

/**
 * frame 시점에서 가장 가까운 비트까지 거리를 측정하고 scale factor 반환.
 * 비트 정확히 일치 = max scale, 윈도우 밖 = 1.0.
 */
export function computeBeatPulseScale(opts: BeatPulseOptions): number {
	const fps = opts.fps ?? 30;
	const width = opts.pulseWidthFrames ?? 6;
	const intensity = opts.intensity ?? 1.05;
	if (opts.beatTimes.length === 0) return 1;

	// 현재 frame 의 절대 시간(초)
	const tSec = opts.frame / fps;
	let minDist = Number.POSITIVE_INFINITY;
	for (const beatSec of opts.beatTimes) {
		const d = Math.abs(beatSec - tSec) * fps; // frame 단위 거리
		if (d < minDist) minDist = d;
		if (minDist === 0) break;
	}
	if (minDist >= width) return 1;
	// triangular pulse: 거리 0 = max, 거리 width = 1
	const ratio = 1 - minDist / width;
	return 1 + (intensity - 1) * ratio;
}
