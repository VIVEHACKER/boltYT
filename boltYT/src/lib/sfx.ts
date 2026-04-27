/**
 * 효과음(SFX) 자동 삽입 + BGM Dip 시스템
 *
 * 씬의 mood/transition/type을 분석하여 적절한 효과음을 자동 배정합니다.
 * Remotion에서 <Audio> 컴포넌트로 재생.
 *
 * 효과음 소스: public/sfx/ 디렉토리의 무료 CC0 효과음
 */

import type {
	SceneMood,
	TextEffect,
	TransitionType,
	WordTiming,
} from "../remotion/types";

// ─── SFX 카탈로그 ───

export type SfxCategory =
	| "whoosh"
	| "impact"
	| "tension_rise"
	| "reveal"
	| "glitch"
	| "transition"
	| "dark_ambient"
	| "notification"
	| "suspense_hit"
	| "bell"
	| "drone"
	| "woosh_tail"
	| "none";

export interface SfxEntry {
	id: string;
	category: SfxCategory;
	/** public/sfx/ 기준 파일명 */
	file: string;
	/** 재생 길이 (초) */
	duration: number;
	/** 볼륨 (0-1) */
	volume: number;
}

/**
 * 내장 SFX 카탈로그
 * — public/sfx/ 에 배치할 무료 효과음 파일 매핑
 * — 파일이 없으면 자동 스킵
 */
export const SFX_CATALOG: SfxEntry[] = [
	{
		id: "whoosh-1",
		category: "whoosh",
		file: "whoosh-1.mp3",
		duration: 0.8,
		volume: 0.4,
	},
	{
		id: "whoosh-2",
		category: "whoosh",
		file: "whoosh-2.mp3",
		duration: 0.6,
		volume: 0.35,
	},
	{
		id: "whoosh-soft",
		category: "whoosh",
		file: "whoosh-soft.mp3",
		duration: 0.5,
		volume: 0.28,
	},
	{
		id: "whoosh-deep",
		category: "whoosh",
		file: "whoosh-deep.mp3",
		duration: 1.1,
		volume: 0.45,
	},
	{
		id: "impact-1",
		category: "impact",
		file: "impact-1.mp3",
		duration: 1.2,
		volume: 0.5,
	},
	{
		id: "impact-2",
		category: "impact",
		file: "impact-2.mp3",
		duration: 0.8,
		volume: 0.45,
	},
	{
		id: "impact-soft",
		category: "impact",
		file: "impact-soft.mp3",
		duration: 0.6,
		volume: 0.32,
	},
	{
		id: "impact-bass",
		category: "impact",
		file: "impact-bass.mp3",
		duration: 1.4,
		volume: 0.55,
	},
	{
		id: "tension-rise",
		category: "tension_rise",
		file: "tension-rise.mp3",
		duration: 2.0,
		volume: 0.3,
	},
	{
		id: "reveal-1",
		category: "reveal",
		file: "reveal-1.mp3",
		duration: 1.5,
		volume: 0.4,
	},
	{
		id: "glitch-1",
		category: "glitch",
		file: "glitch-1.mp3",
		duration: 0.5,
		volume: 0.5,
	},
	{
		id: "glitch-2",
		category: "glitch",
		file: "glitch-2.mp3",
		duration: 0.3,
		volume: 0.45,
	},
	{
		id: "glitch-stutter",
		category: "glitch",
		file: "glitch-stutter.mp3",
		duration: 0.7,
		volume: 0.42,
	},
	{
		id: "riser-short",
		category: "tension_rise",
		file: "riser-short.mp3",
		duration: 1.2,
		volume: 0.32,
	},
	{
		id: "riser-long",
		category: "tension_rise",
		file: "riser-long.mp3",
		duration: 3.5,
		volume: 0.28,
	},
	{
		id: "reveal-cinematic",
		category: "reveal",
		file: "reveal-cinematic.mp3",
		duration: 2.2,
		volume: 0.38,
	},
	{
		id: "dark-ambient",
		category: "dark_ambient",
		file: "dark-ambient.mp3",
		duration: 3.0,
		volume: 0.2,
	},
	{
		id: "suspense-hit",
		category: "suspense_hit",
		file: "suspense-hit.mp3",
		duration: 1.0,
		volume: 0.5,
	},
	{
		id: "notification",
		category: "notification",
		file: "notification.mp3",
		duration: 0.6,
		volume: 0.3,
	},
	{
		id: "bell-soft",
		category: "bell",
		file: "bell-soft.mp3",
		duration: 1.4,
		volume: 0.32,
	},
	{
		id: "bell-deep",
		category: "bell",
		file: "bell-deep.mp3",
		duration: 2.5,
		volume: 0.4,
	},
	{
		id: "drone-low",
		category: "drone",
		file: "drone-low.mp3",
		duration: 6.0,
		volume: 0.18,
	},
	{
		id: "drone-mystic",
		category: "drone",
		file: "drone-mystic.mp3",
		duration: 5.5,
		volume: 0.22,
	},
	{
		id: "woosh-tail-1",
		category: "woosh_tail",
		file: "woosh-tail-1.mp3",
		duration: 1.6,
		volume: 0.3,
	},
	{
		id: "woosh-tail-2",
		category: "woosh_tail",
		file: "woosh-tail-2.mp3",
		duration: 1.2,
		volume: 0.28,
	},
];

// ─── 자동 배정 로직 ───

export interface SceneSfx {
	/** 씬 시작 시 재생할 SFX */
	enterSfx?: SfxEntry;
	/** 씬 종료(트랜지션) 시 재생할 SFX */
	transitionSfx?: SfxEntry;
	enterOffsetFrames?: number;
	transitionOffsetFrames?: number;
}

interface SceneInfo {
	type: string;
	mood?: SceneMood;
	transition?: TransitionType;
	textEffect?: TextEffect;
	hookBoost?: boolean;
	durationInFrames?: number;
	wordTimings?: WordTiming[];
	beatTimes?: number[];
	sceneStartSeconds?: number;
	index?: number;
	isFirst?: boolean;
	isLast?: boolean;
}

function pickVariant(category: SfxCategory, seed = 0): SfxEntry | undefined {
	const matches = SFX_CATALOG.filter((s) => s.category === category);
	if (matches.length === 0) return undefined;
	return matches[Math.abs(seed) % matches.length];
}

/** Mood 별 SFX 볼륨 스케일 (1.0 = 원본). horror 는 강조, news 는 절제. */
export function moodVolumeScale(mood?: SceneMood): number {
	if (mood === "horror") return 1.25;
	if (mood === "mystery") return 1.1;
	if (mood === "news") return 0.75;
	if (mood === "warm") return 0.9;
	return 1;
}

/** SfxEntry 의 volume 을 mood 에 맞게 적용한 새 entry 반환. */
export function withMoodVolume(
	entry: SfxEntry | undefined,
	mood?: SceneMood,
): SfxEntry | undefined {
	if (!entry) return undefined;
	const scale = moodVolumeScale(mood);
	if (scale === 1) return entry;
	return {
		...entry,
		volume: Math.max(0, Math.min(1, entry.volume * scale)),
	};
}

function clampFrame(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function findEnterAccentFrame(scene: SceneInfo): number {
	const duration = scene.durationInFrames ?? 45;
	const words = scene.wordTimings ?? [];
	if (scene.type === "text_emphasis") return 0;
	if (words.length === 0) return scene.hookBoost ? 2 : 0;
	const targetIndex = scene.hookBoost ? Math.min(1, words.length - 1) : 0;
	return clampFrame(
		Math.max(0, words[targetIndex].startFrame - 1),
		0,
		duration - 1,
	);
}

function findTransitionAccentFrame(scene: SceneInfo): number {
	const duration = scene.durationInFrames ?? 45;
	const words = scene.wordTimings ?? [];
	if (scene.isLast) return clampFrame(duration - 8, 0, duration - 1);
	if (words.length === 0) return clampFrame(duration - 10, 0, duration - 1);
	const lastWord = words[words.length - 1];
	return clampFrame(Math.max(0, lastWord.startFrame), 0, duration - 1);
}

function snapCueToBeatFrame(
	localFrame: number,
	scene: SceneInfo,
	maxShiftFrames = 8,
	fps = 30,
): number {
	const beats = scene.beatTimes ?? [];
	if (beats.length === 0) return localFrame;
	const sceneStartSeconds = scene.sceneStartSeconds ?? 0;
	const targetSeconds = sceneStartSeconds + localFrame / fps;
	let closest = beats[0];
	let minDiff = Math.abs(beats[0] - targetSeconds);
	for (const beat of beats) {
		const diff = Math.abs(beat - targetSeconds);
		if (diff < minDiff) {
			minDiff = diff;
			closest = beat;
		}
	}
	const shifted = Math.round((closest - sceneStartSeconds) * fps);
	if (Math.abs(shifted - localFrame) > maxShiftFrames) return localFrame;
	const duration = scene.durationInFrames ?? 45;
	return clampFrame(shifted, 0, Math.max(0, duration - 1));
}

/**
 * 씬 정보를 분석하여 효과음 자동 배정
 */
export function assignSfx(scene: SceneInfo): SceneSfx {
	const result: SceneSfx = {};
	const seed = scene.index ?? 0;

	if (scene.hookBoost) {
		if (scene.isFirst) {
			result.enterSfx = pickVariant("impact", seed);
		} else if (scene.transition === "glitch") {
			result.enterSfx = pickVariant("glitch", seed);
		} else if (
			scene.transition === "whip_left" ||
			scene.transition === "whip_right"
		) {
			result.enterSfx = pickVariant("whoosh", seed);
		} else if (scene.transition === "none") {
			result.enterSfx = pickVariant("suspense_hit", seed);
		}

		if (scene.transition === "glitch") {
			result.transitionSfx = pickVariant("glitch", seed + 1);
		} else if (
			scene.transition === "whip_left" ||
			scene.transition === "whip_right"
		) {
			result.transitionSfx = pickVariant("whoosh", seed + 1);
		} else if (scene.transition === "none" && !scene.isLast) {
			result.transitionSfx = pickVariant("impact", seed + 1);
		}
	}

	// ─── 씬 시작 SFX ───

	// text_emphasis + glitch → 글리치 효과음
	if (
		!result.enterSfx &&
		scene.type === "text_emphasis" &&
		scene.textEffect === "glitch"
	) {
		result.enterSfx = pickVariant("glitch", seed + 2);
	}
	// text_emphasis + scale_in → 임팩트
	else if (
		!result.enterSfx &&
		scene.type === "text_emphasis" &&
		scene.textEffect === "scale_in"
	) {
		result.enterSfx = pickVariant("impact", seed + 2);
	}
	// text_emphasis 기본 → reveal
	else if (!result.enterSfx && scene.type === "text_emphasis") {
		result.enterSfx = pickVariant("reveal", seed + 2);
	}
	// horror/mystery 무드 → 서스펜스 히트
	else if (
		!result.enterSfx &&
		(scene.mood === "horror" || scene.mood === "mystery")
	) {
		if (seed % 3 === 0) {
			result.enterSfx = pickVariant("suspense_hit", seed + 2);
		}
	}
	// 첫 번째 씬 → 임팩트 (훅)
	else if (!result.enterSfx && scene.isFirst) {
		result.enterSfx = pickVariant("impact", seed + 2);
	}

	// ─── 트랜지션 SFX ───

	if (!result.transitionSfx && scene.transition === "glitch") {
		result.transitionSfx = pickVariant("glitch", seed + 3);
	} else if (!result.transitionSfx && scene.transition === "zoom") {
		result.transitionSfx = pickVariant("whoosh", seed + 3);
	} else if (
		!result.transitionSfx &&
		(scene.transition === "slide_left" || scene.transition === "slide_right")
	) {
		result.transitionSfx = pickVariant("whoosh", seed + 3);
	} else if (
		!result.transitionSfx &&
		scene.transition === "crossfade" &&
		!scene.isLast
	) {
		if (seed % 5 === 0) {
			result.transitionSfx = pickVariant("whoosh", seed + 3);
		}
	}

	if (result.enterSfx) {
		const rawEnterFrame = findEnterAccentFrame(scene);
		const snapped = snapCueToBeatFrame(
			rawEnterFrame,
			scene,
			scene.hookBoost ? 10 : 6,
		);

		// 자막 강조 cue와 SFX cue 충돌 방지:
		// hookBoost 씬에서 첫 단어와 SFX가 정확히 같은 프레임이면
		// 자막 시각 강조가 먼저 보이도록 SFX를 1프레임 뒤로 미룸
		const firstWordFrame = (scene.wordTimings ?? [])[0]?.startFrame ?? -1;
		const duration = scene.durationInFrames ?? 45;
		if (scene.hookBoost && firstWordFrame > 0 && snapped === firstWordFrame) {
			result.enterOffsetFrames = Math.min(snapped + 1, duration - 1);
		} else {
			result.enterOffsetFrames = snapped;
		}
	}

	if (result.transitionSfx) {
		result.transitionOffsetFrames = snapCueToBeatFrame(
			findTransitionAccentFrame(scene),
			scene,
			8,
		);
	}

	return result;
}

// ─── BGM Dip 파라미터 ───

export interface TransitionBgmDip {
	/** dip 최대 깊이 (0=없음, 1=완전 소거). 기존 볼륨에 곱해짐 */
	dipDepth: number;
	/** 전환 경계 직전에 dip을 시작할 프레임 수 */
	attackFrames: number;
	/** 전환 경계 직후 원래 볼륨으로 복귀하는 프레임 수 */
	releaseFrames: number;
}

/**
 * transitionType별 BGM dip 파라미터.
 * whip/glitch/none: 짧고 강한 dip + 빠른 recovery.
 * crossfade/zoom: 부드러운 dip.
 */
export function getTransitionBgmDip(
	transitionType?: TransitionType,
): TransitionBgmDip {
	switch (transitionType) {
		case "glitch":
			return { dipDepth: 0.72, attackFrames: 2, releaseFrames: 7 };
		case "whip_left":
		case "whip_right":
			return { dipDepth: 0.62, attackFrames: 3, releaseFrames: 9 };
		case "none":
			return { dipDepth: 0.55, attackFrames: 2, releaseFrames: 8 };
		case "zoom":
			return { dipDepth: 0.36, attackFrames: 8, releaseFrames: 16 };
		case "crossfade":
			return { dipDepth: 0.25, attackFrames: 10, releaseFrames: 18 };
		default:
			return { dipDepth: 0.4, attackFrames: 5, releaseFrames: 12 };
	}
}

/**
 * 전환 경계 근처 프레임에서 BGM dip factor (0~1) 계산.
 * boundaries: 각 전환의 경계 프레임과 transitionType.
 */
export function transitionDipFactor(
	frame: number,
	boundaries: Array<{ boundary: number; transitionType?: TransitionType }>,
): number {
	let maxDip = 0;
	for (const { boundary, transitionType } of boundaries) {
		const { dipDepth, attackFrames, releaseFrames } =
			getTransitionBgmDip(transitionType);
		const distBefore = boundary - frame;
		const distAfter = frame - boundary;
		if (distBefore >= 0 && distBefore < attackFrames) {
			maxDip = Math.max(maxDip, dipDepth * (1 - distBefore / attackFrames));
		} else if (distAfter > 0 && distAfter < releaseFrames) {
			maxDip = Math.max(maxDip, dipDepth * (1 - distAfter / releaseFrames));
		}
	}
	return maxDip;
}

/**
 * 전체 씬 배열에 SFX 자동 배정
 */
export function assignSfxToScenes(scenes: SceneInfo[]): SceneSfx[] {
	let sceneStartSeconds = 0;
	return scenes.map((scene, i) => {
		const durationSeconds = scene.durationInFrames
			? scene.durationInFrames / 30
			: 0;
		const result = assignSfx({
			...scene,
			index: i,
			sceneStartSeconds,
			isFirst: i === 0,
			isLast: i === scenes.length - 1,
		});
		sceneStartSeconds += durationSeconds;
		return result;
	});
}
