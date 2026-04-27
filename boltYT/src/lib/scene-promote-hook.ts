/**
 * Scene 순서 자동 재배치 — hook 강도가 가장 강한 씬을 첫 위치로 promote.
 *
 * 쇼츠 첫 3초가 retention 의 80% 를 결정 (YouTube 통계).
 * GPT 가 가끔 약한 씬을 1번에 배치 → 강한 hook 씬을 1번으로 끌어오는 자동 보정.
 */

import { detectHookPattern } from "./hook-detector";

export interface PromotableScene {
	narration?: string;
	scene_type?: string;
	order_index?: number;
}

interface ScoredScene<T> {
	scene: T;
	score: number;
	originalIndex: number;
}

/**
 * 씬 배열 → hook 점수 기반 재정렬. 첫 1-2 자리에 강한 hook 씬 배치.
 * 옵션:
 *  - preserveStructure: news/timeline 처럼 시간 순서 중요한 콘텐츠는 비활성
 *  - maxPromote: 최대 N 자리 재배치 (기본 1 — 첫 씬만)
 */
export function promoteHookScenes<T extends PromotableScene>(
	scenes: T[],
	opts: { maxPromote?: number; preserveStructure?: boolean } = {},
): T[] {
	if (opts.preserveStructure) return scenes;
	if (scenes.length < 2) return scenes;
	const maxPromote = Math.min(opts.maxPromote ?? 1, scenes.length - 1);

	const scored: ScoredScene<T>[] = scenes.map((s, i) => {
		const { confidence } = detectHookPattern(s.narration ?? "");
		// 위치 페널티: 뒤쪽 씬일수록 promote 부담 ↑
		const positionPenalty = i * 0.05;
		return {
			scene: s,
			score: confidence - positionPenalty,
			originalIndex: i,
		};
	});

	// 첫 maxPromote 자리에 score 가 가장 높은 씬을 배치
	const sortedHigh = [...scored].sort((a, b) => b.score - a.score);
	const promoted = sortedHigh.slice(0, maxPromote).map((s) => s.scene);
	const promotedSet = new Set(promoted);
	const rest = scenes.filter((s) => !promotedSet.has(s));
	const result = [...promoted, ...rest];

	// order_index 재할당 (있는 씬만)
	return result.map((s, i) =>
		s.order_index !== undefined ? { ...s, order_index: i } : s,
	);
}
