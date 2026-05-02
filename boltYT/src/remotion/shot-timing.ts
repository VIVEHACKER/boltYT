import type { SceneShot } from "../lib/scene-shot-types";
import type { WordTiming } from "./types";

export interface ShotTimelineEntry {
	shot: SceneShot;
	from: number;
	durationInFrames: number;
}

interface SpeechSafeShotTimelineOptions {
	fps?: number;
	wordTimings?: WordTiming[];
}

const DEFAULT_FPS = 30;
const MIN_SHOT_SECONDS = 0.85;
const SPEECH_PAD_FRAMES = 3;
const MAX_BOUNDARY_DRIFT_SECONDS = 0.75;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function shotFrames(shot: SceneShot, fps: number): number {
	return Math.max(1, Math.round(Math.max(0.4, shot.duration_seconds) * fps));
}

function scaledShotDurations(
	shots: SceneShot[],
	totalFrames: number,
	fps: number,
): number[] {
	const baseFrames = shots.map((shot) => shotFrames(shot, fps));
	const sum = baseFrames.reduce((acc, value) => acc + value, 0);
	const scaled = baseFrames.map((value) =>
		Math.max(1, Math.round((value / Math.max(sum, 1)) * totalFrames)),
	);
	const scaledSum = scaled.reduce((acc, value) => acc + value, 0);
	scaled[scaled.length - 1] = Math.max(
		1,
		scaled[scaled.length - 1] + (totalFrames - scaledSum),
	);
	return scaled;
}

function normalizedWords(
	wordTimings: WordTiming[] | undefined,
	totalFrames: number,
): WordTiming[] {
	return (wordTimings ?? [])
		.map((word) => ({
			...word,
			startFrame: clamp(Math.round(word.startFrame), 0, totalFrames),
			endFrame: clamp(Math.round(word.endFrame), 0, totalFrames),
		}))
		.filter((word) => word.endFrame > word.startFrame)
		.sort((a, b) => a.startFrame - b.startFrame);
}

function isSentenceEnd(word: string): boolean {
	const text = word.trim();
	return /[.!?。！？…]$/.test(text) || /(다|요|죠|까|니다|습니다|네요|군요|나요|어요|아요|예요|이에요)$/.test(text);
}

function isPhraseEnd(word: string): boolean {
	return /[,;:、，]$/.test(word.trim());
}

function isInsideSpokenWord(frame: number, words: WordTiming[]): boolean {
	return words.some(
		(word) => frame > word.startFrame + 1 && frame < word.endFrame - 1,
	);
}

function boundaryCandidates(
	words: WordTiming[],
	totalFrames: number,
): Array<{ frame: number; penalty: number }> {
	const candidates: Array<{ frame: number; penalty: number }> = [];
	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		const next = words[i + 1];
		const gap = next ? next.startFrame - word.endFrame : 0;
		const sentenceEnd = isSentenceEnd(word.word);
		const pauseEnd = gap >= 8;
		const phraseEnd = isPhraseEnd(word.word);
		const frame = clamp(word.endFrame + SPEECH_PAD_FRAMES, 1, totalFrames - 1);

		if (sentenceEnd) {
			candidates.push({ frame, penalty: 0 });
		} else if (pauseEnd) {
			candidates.push({ frame, penalty: 4 });
		} else if (phraseEnd) {
			candidates.push({ frame, penalty: 8 });
		} else {
			candidates.push({ frame, penalty: 18 });
		}
	}
	return candidates;
}

function chooseSpeechSafeBoundary(
	targetFrame: number,
	range: { min: number; max: number },
	words: WordTiming[],
	totalFrames: number,
	fps: number,
): number {
	const target = clamp(Math.round(targetFrame), range.min, range.max);
	if (!isInsideSpokenWord(target, words)) return target;

	const maxDrift = Math.round(MAX_BOUNDARY_DRIFT_SECONDS * fps);
	const candidates = boundaryCandidates(words, totalFrames).filter(
		(candidate) => candidate.frame >= range.min && candidate.frame <= range.max,
	);
	if (candidates.length === 0) return target;

	let best = candidates[0];
	let bestScore = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const distance = Math.abs(candidate.frame - target);
		const driftPenalty = distance > maxDrift ? (distance - maxDrift) * 3 : 0;
		const score = distance + candidate.penalty + driftPenalty;
		if (score < bestScore) {
			best = candidate;
			bestScore = score;
		}
	}

	return best.frame;
}

function sequentialTimeline(
	shots: SceneShot[],
	durations: number[],
	totalFrames: number,
): ShotTimelineEntry[] {
	let cursor = 0;
	return shots.map((shot, index) => {
		const from = cursor;
		const durationInFrames =
			index === shots.length - 1
				? Math.max(1, totalFrames - cursor)
				: Math.max(1, durations[index]);
		cursor += durationInFrames;
		return { shot, from, durationInFrames };
	});
}

export function buildShotTimeline(
	shots: SceneShot[] | undefined,
	totalFrames: number,
	options: SpeechSafeShotTimelineOptions = {},
): ShotTimelineEntry[] {
	if (!shots || shots.length === 0 || totalFrames <= 0) return [];

	const fps = options.fps ?? DEFAULT_FPS;
	const durations = scaledShotDurations(shots, totalFrames, fps);
	const words = normalizedWords(options.wordTimings, totalFrames);
	if (shots.length === 1 || words.length === 0) {
		return sequentialTimeline(shots, durations, totalFrames);
	}

	const defaultMinFrames = Math.round(MIN_SHOT_SECONDS * fps);
	const minFrames = Math.max(
		1,
		Math.min(defaultMinFrames, Math.floor(totalFrames / shots.length / 2)),
	);
	const boundaries: number[] = [];
	let cursor = 0;
	let targetCursor = 0;

	for (let index = 0; index < shots.length - 1; index++) {
		targetCursor += durations[index];
		const remainingShots = shots.length - index - 1;
		const min = Math.min(totalFrames - remainingShots, cursor + minFrames);
		const max = Math.max(min, totalFrames - remainingShots * minFrames);
		const boundary = chooseSpeechSafeBoundary(
			targetCursor,
			{ min, max },
			words,
			totalFrames,
			fps,
		);
		cursor = clamp(boundary, min, max);
		boundaries.push(cursor);
	}

	let from = 0;
	return shots.map((shot, index) => {
		const to =
			index < boundaries.length ? boundaries[index] : Math.max(from + 1, totalFrames);
		const durationInFrames = Math.max(1, to - from);
		const entry = { shot, from, durationInFrames };
		from = to;
		return entry;
	});
}

export const __test = {
	boundaryCandidates,
	chooseSpeechSafeBoundary,
	normalizedWords,
	scaledShotDurations,
};
