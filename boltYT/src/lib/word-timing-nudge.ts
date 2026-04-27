/**
 * Word timing nudge — Whisper word timings에 자연스러운 호흡 휴지를 추가.
 *
 * 구두점(. ! ? … ,) 뒤에 짧은 silence gap 을 늘려 자막 청크가 spoken cadence 와 맞도록.
 * Composition 의 자막 표시 윈도우만 영향, audio 자체는 변경 없음.
 */

import type { WordTiming } from "../remotion/types";

const STRONG_PUNCT_RE = /[.!?。！？…]$/;
const SOFT_PUNCT_RE = /[,;:、，；：]$/;

export interface NudgeOptions {
	/** 강한 종결 뒤 추가 휴지 (frames). 기본 6 = 30fps에서 200ms */
	strongPauseFrames?: number;
	/** 약한 구두점 뒤 추가 휴지 (frames). 기본 3 */
	softPauseFrames?: number;
}

/**
 * Whisper word timings 의 startFrame/endFrame 을 in-place 가 아닌 새 배열로 반환.
 * 구두점이 있는 단어 다음에는 다음 단어를 N프레임 미룸 (호흡 표시).
 *
 * 주의: 이건 자막 표시용 가상 타이밍. 실제 오디오 트랙은 변경되지 않음.
 * audio drift 를 막기 위해 누적 시프트 상한 (max 18 frames = 600ms).
 */
export function nudgeWordTimings(
	words: WordTiming[],
	opts: NudgeOptions = {},
): WordTiming[] {
	const strong = opts.strongPauseFrames ?? 6;
	const soft = opts.softPauseFrames ?? 3;
	const maxShift = 18;

	let shift = 0;
	const out: WordTiming[] = [];
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		out.push({
			...w,
			startFrame: w.startFrame + shift,
			endFrame: w.endFrame + shift,
		});
		const trimmed = w.word.trim();
		if (i < words.length - 1) {
			if (STRONG_PUNCT_RE.test(trimmed) && shift < maxShift) {
				shift = Math.min(maxShift, shift + strong);
			} else if (SOFT_PUNCT_RE.test(trimmed) && shift < maxShift) {
				shift = Math.min(maxShift, shift + soft);
			}
		}
	}
	return out;
}
