/**
 * Bilingual caption helper — KR + EN 동시 표시 (이중 언어 콘텐츠).
 *
 * Whisper 한 트랙을 메인으로 받고, 보조 트랙(예: 번역) 을 아래줄에 배치.
 * 메인 폰트 크기는 baseFontSize, 보조는 0.6x.
 */

import type { WordTiming } from "../remotion/types";

export interface BilingualLine {
	primary: string;
	secondary: string;
	startFrame: number;
	endFrame: number;
}

/**
 * 두 word_timings 배열 → 동기화된 라인 페어.
 * primary 의 청크 단위로 secondary 시간 범위 겹치는 단어들을 묶음.
 */
export function buildBilingualLines(
	primary: WordTiming[],
	secondary: WordTiming[],
	chunkSize = 4,
): BilingualLine[] {
	if (primary.length === 0) return [];
	const lines: BilingualLine[] = [];
	for (let i = 0; i < primary.length; i += chunkSize) {
		const chunk = primary.slice(i, i + chunkSize);
		if (chunk.length === 0) continue;
		const startF = chunk[0].startFrame;
		const endF = chunk[chunk.length - 1].endFrame;
		const primaryText = chunk.map((w) => w.word).join(" ");
		const secondaryWords = secondary.filter(
			(w) => w.endFrame > startF && w.startFrame < endF,
		);
		const secondaryText = secondaryWords.map((w) => w.word).join(" ");
		lines.push({
			primary: primaryText,
			secondary: secondaryText,
			startFrame: startF,
			endFrame: endF,
		});
	}
	return lines;
}

/** 현재 frame 에 표시할 라인 찾기 */
export function activeBilingualLine(
	lines: BilingualLine[],
	frame: number,
): BilingualLine | null {
	return lines.find((l) => frame >= l.startFrame && frame < l.endFrame) ?? null;
}
