/**
 * 씬 vs 레퍼런스 시각 유사도 점수 — 0-1.
 *
 * 입력:
 *   - scene 의 mood, lighting, dominant colors (이미지 분석 후)
 *   - reference 의 같은 필드
 *
 * 점수 = mood match (0.4) + lighting match (0.3) + color distance (0.3)
 */

import { fnv1a32 } from "./hash-seed";

interface VisualProfile {
	mood?: string;
	lighting?: string;
	dominantColors?: string[];
}

function colorDistance(a: string, b: string): number {
	const ah = fnv1a32(a) % 256;
	const bh = fnv1a32(b) % 256;
	return Math.abs(ah - bh) / 256;
}

function colorPaletteDistance(a: string[], b: string[]): number {
	if (a.length === 0 || b.length === 0) return 1;
	let sum = 0;
	let count = 0;
	for (const ca of a) {
		let minDist = 1;
		for (const cb of b) {
			const d = colorDistance(ca, cb);
			if (d < minDist) minDist = d;
		}
		sum += minDist;
		count++;
	}
	return count === 0 ? 1 : sum / count;
}

export function visualSimilarityScore(
	scene: VisualProfile,
	reference: VisualProfile,
): number {
	let score = 0;
	if (scene.mood && reference.mood && scene.mood === reference.mood) {
		score += 0.4;
	} else if (scene.mood && reference.mood) {
		score += 0.1; // 다르면 부분 점수
	}
	if (
		scene.lighting &&
		reference.lighting &&
		scene.lighting === reference.lighting
	) {
		score += 0.3;
	}
	if (scene.dominantColors && reference.dominantColors) {
		const dist = colorPaletteDistance(
			scene.dominantColors,
			reference.dominantColors,
		);
		score += 0.3 * (1 - dist);
	}
	return Math.max(0, Math.min(1, score));
}
