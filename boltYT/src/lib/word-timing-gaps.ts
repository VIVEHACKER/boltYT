/**
 * Whisper word timing 의 긴 silence gap 감지 → "..." placeholder 자막 추가.
 *
 * 사용 사례:
 *  - TTS 가 끊김 / pause 가 큰 구간을 "(...)" 로 시각화
 *  - 자막이 "사라진 채" 화면이 비는 어색함 방지
 */

import type { WordTiming } from "../remotion/types";

export interface GapOptions {
	/** 이 프레임 이상 gap 이면 placeholder 삽입. 기본 30 (1초 @ 30fps) */
	thresholdFrames?: number;
	/** placeholder 단어 (기본 "…") */
	placeholder?: string;
	/** placeholder 단어가 표시될 길이 (frames). 기본 18 */
	placeholderLengthFrames?: number;
}

/**
 * gap 이 threshold 이상인 곳에 placeholder 단어를 삽입한 새 배열 반환.
 * 입력 불변. placeholder 의 startFrame 은 gap 의 중심에 배치.
 */
export function insertGapPlaceholders(
	words: WordTiming[],
	opts: GapOptions = {},
): WordTiming[] {
	const threshold = opts.thresholdFrames ?? 30;
	const placeholder = opts.placeholder ?? "…";
	const placeholderLen = opts.placeholderLengthFrames ?? 18;
	if (words.length < 2) return [...words];

	const out: WordTiming[] = [];
	for (let i = 0; i < words.length; i++) {
		out.push(words[i]);
		if (i < words.length - 1) {
			const gap = words[i + 1].startFrame - words[i].endFrame;
			if (gap >= threshold) {
				const center =
					words[i].endFrame + Math.floor((gap - placeholderLen) / 2);
				out.push({
					word: placeholder,
					startFrame: center,
					endFrame: center + placeholderLen,
				});
			}
		}
	}
	return out;
}
