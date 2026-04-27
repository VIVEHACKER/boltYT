/**
 * Whisper word timing 후처리 — 단어 fragment 병합 + orphan punctuation 부착.
 *
 * Whisper 가 가끔 출력하는 패턴:
 *  - "안녕" "하세요" → 두 토큰을 하나로 병합 (한국어 ending 분리)
 *  - "단어" "." → orphan punctuation 을 직전 단어에 병합
 *  - 중복 timestamp → 0.5 frame 보정
 */

import type { WordTiming } from "../remotion/types";

/** 짧은 한국어 종결어미 (직전 단어와 병합 대상) */
const KOREAN_ENDING_RE = /^(요|야|음|냐|네|군|군요|니다|랍니다|습니다)$/;
/** 단독 punctuation 토큰 */
const PUNCT_ONLY_RE = /^[.,!?;:。、！？…'"」』]+$/;

export interface CleanupOptions {
	/** 두 토큰 사이가 maxGapFrames 이하 + 종결어미 면 병합. 기본 3 */
	maxGapFrames?: number;
}

/**
 * Whisper word timings 후처리. 입력 불변, 새 배열 반환.
 */
export function cleanupWordTimings(
	words: WordTiming[],
	opts: CleanupOptions = {},
): WordTiming[] {
	const maxGap = opts.maxGapFrames ?? 3;
	if (words.length === 0) return [];

	// 1) orphan punctuation 병합
	const merged: WordTiming[] = [];
	for (const w of words) {
		if (
			merged.length > 0 &&
			PUNCT_ONLY_RE.test(w.word.trim()) &&
			w.startFrame - merged[merged.length - 1].endFrame <= maxGap
		) {
			const prev = merged[merged.length - 1];
			merged[merged.length - 1] = {
				word: prev.word + w.word,
				startFrame: prev.startFrame,
				endFrame: Math.max(prev.endFrame, w.endFrame),
			};
			continue;
		}
		merged.push(w);
	}

	// 2) 한국어 짧은 종결어미 병합
	const finalized: WordTiming[] = [];
	for (const w of merged) {
		if (
			finalized.length > 0 &&
			KOREAN_ENDING_RE.test(w.word.trim()) &&
			w.startFrame - finalized[finalized.length - 1].endFrame <= maxGap
		) {
			const prev = finalized[finalized.length - 1];
			finalized[finalized.length - 1] = {
				word: prev.word + w.word,
				startFrame: prev.startFrame,
				endFrame: Math.max(prev.endFrame, w.endFrame),
			};
			continue;
		}
		finalized.push(w);
	}

	// 3) 중복/역순 timestamp 보정 — startFrame 이 직전 endFrame 보다 같거나 작으면 +1
	for (let i = 1; i < finalized.length; i++) {
		if (finalized[i].startFrame <= finalized[i - 1].endFrame) {
			finalized[i] = {
				...finalized[i],
				startFrame: finalized[i - 1].endFrame + 1,
				endFrame: Math.max(
					finalized[i].endFrame,
					finalized[i - 1].endFrame + 2,
				),
			};
		}
	}

	return finalized;
}
