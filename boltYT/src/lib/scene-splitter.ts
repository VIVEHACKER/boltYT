/**
 * 긴 씬 자동 분할 — 12s 초과 씬을 의미 단위로 split하여 페이싱 개선.
 *
 * 분할 기준:
 *  - duration_seconds > THRESHOLD (기본 12s)
 *  - narration 에 강한 종결 (?!.) 가 있는 위치에서 절단
 *  - 양쪽 sub-scene 은 최소 3.5s 이상 보장
 */

interface SplittableScene {
	narration?: string;
	duration_seconds: number;
	scene_type?: string;
}

const STRONG_BREAK_RE = /[.!?。！？…]\s*/g;

export interface SplitOptions {
	thresholdSeconds?: number;
	minPartSeconds?: number;
}

/**
 * 단일 narration 문자열을 강한 구두점 위치에서 둘로 절단.
 * 가능한 위치가 없거나 너무 한쪽으로 치우치면 null 반환.
 */
function findSplitIndex(
	text: string,
	minRatio = 0.25,
	maxRatio = 0.75,
): number | null {
	if (!text || text.length < 6) return null;
	const breaks: number[] = [];
	const re = new RegExp(STRONG_BREAK_RE);
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) breaks.push(m.index + m[0].length);
	if (breaks.length === 0) return null;
	// 중앙에 가장 가까운 break 선택
	const target = text.length / 2;
	let best = -1;
	let minDist = Number.POSITIVE_INFINITY;
	for (const b of breaks) {
		const ratio = b / text.length;
		if (ratio < minRatio || ratio > maxRatio) continue;
		const d = Math.abs(b - target);
		if (d < minDist) {
			minDist = d;
			best = b;
		}
	}
	return best > 0 ? best : null;
}

/**
 * 한 씬 → 2 씬 분할 (조건 미충족 시 [scene] 그대로 반환).
 */
export function splitLongScene<T extends SplittableScene>(
	scene: T,
	opts: SplitOptions = {},
): T[] {
	const threshold = opts.thresholdSeconds ?? 12;
	const minPart = opts.minPartSeconds ?? 3.5;
	if (scene.duration_seconds <= threshold) return [scene];
	if (!scene.narration) return [scene];
	if (scene.scene_type === "text_emphasis") return [scene];
	const idx = findSplitIndex(scene.narration);
	if (idx === null) return [scene];

	const left = scene.narration.slice(0, idx).trim();
	const right = scene.narration.slice(idx).trim();
	if (!left || !right) return [scene];

	const ratio = left.length / scene.narration.length;
	const leftDur = Number((scene.duration_seconds * ratio).toFixed(2));
	const rightDur = Number((scene.duration_seconds - leftDur).toFixed(2));
	if (leftDur < minPart || rightDur < minPart) return [scene];

	return [
		{ ...scene, narration: left, duration_seconds: leftDur },
		{ ...scene, narration: right, duration_seconds: rightDur },
	];
}

/** 씬 배열 일괄 분할 */
export function splitLongScenes<T extends SplittableScene>(
	scenes: T[],
	opts?: SplitOptions,
): T[] {
	const out: T[] = [];
	for (const s of scenes) out.push(...splitLongScene(s, opts));
	return out;
}
