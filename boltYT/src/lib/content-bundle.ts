/**
 * 판정 입력 번들 — Scene[] 을 화이트리스트 투영으로 정규화해
 * 비결정 필드(created_at / 키 순서 / undefined)를 제거하고,
 * 안정 해시(멱등 기반)와 롱폼 챕터 분할을 제공한다.
 *
 * 멱등 불변량: 같은 번들 + 같은 벤치마크 fingerprint → 항상 같은 해시.
 * BGM claim 차단 신호(claimBlocked)는 하드 블록 규칙으로 연결되는 입력이다.
 */

import type { Scene } from "../types/database";
import { fnv1a32 } from "./hash-seed";

export interface BundleScene {
	id: string;
	orderIndex: number;
	narration: string;
	durationSec: number;
	type: string;
	shotCount: number;
	motionGraphicCount: number;
	hasWordTimings: boolean;
	sourceIndex?: number;
	transition?: string;
	mood?: string;
}

export interface BundleTts {
	provider?: string;
	voiceId?: string;
	speed?: number;
	profile?: string;
	coverageRatio: number;
}

export interface BundleBgm {
	source?: "ai_generated" | "import" | "preset" | "search";
	mood?: string;
	qualityScore?: number;
	lufsEstimate?: number;
	hasBeatGrid: boolean;
	claimBlocked?: boolean;
}

export interface ContentBundle {
	contentId: string;
	format: "shorts" | "longform";
	durationSec: number;
	scriptStructure: string[];
	scenes: BundleScene[];
	tts: BundleTts;
	bgm: BundleBgm;
}

export interface ContentBundleChapter {
	index: number;
	startSec: number;
	endSec: number;
	scenes: BundleScene[];
}

export interface BuildContentBundleInput {
	contentId: string;
	format: "shorts" | "longform";
	scenes: Scene[];
	tts?: Partial<BundleTts>;
	bgm?: Partial<BundleBgm>;
	scriptStructure?: string[];
}

/** 비결정 필드 — 화이트리스트 밖에서 흘러들어와도 해시에서 영구 제외 */
const NON_DETERMINISTIC_KEYS = new Set([
	"created_at",
	"createdAt",
	"updated_at",
	"updatedAt",
	"judged_at",
	"judgedAt",
]);

function toFiniteNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function projectScene(scene: Scene): BundleScene {
	const projected: BundleScene = {
		id: typeof scene.id === "string" ? scene.id : "",
		orderIndex: toFiniteNumber(scene.order_index, 0),
		narration:
			typeof scene.narration_text === "string" ? scene.narration_text : "",
		durationSec: Math.max(0, toFiniteNumber(scene.duration_seconds, 0)),
		type: typeof scene.scene_type === "string" ? scene.scene_type : "image",
		// shots/word_timings/motion_graphics 결측 가드 — 누락 시 0/false
		shotCount: Array.isArray(scene.shots) ? scene.shots.length : 0,
		motionGraphicCount: Array.isArray(scene.motion_graphics)
			? scene.motion_graphics.length
			: 0,
		hasWordTimings:
			Array.isArray(scene.word_timings) && scene.word_timings.length > 0,
	};
	// undefined 옵션 필드는 키 자체를 만들지 않는다 (해시 안정성)
	if (typeof scene.source_index === "number") {
		projected.sourceIndex = scene.source_index;
	}
	if (typeof scene.transition === "string") {
		projected.transition = scene.transition;
	}
	if (typeof scene.mood === "string") {
		projected.mood = scene.mood;
	}
	return projected;
}

/**
 * Scene[] → 판정 입력 번들. 입력 배열 순서와 무관하게 order_index 기준 정렬.
 * tts.coverageRatio 미지정 시 word_timings 보유 씬 비율로 유도(결정론).
 */
export function buildContentBundle(
	input: BuildContentBundleInput,
): ContentBundle {
	const scenes = input.scenes
		.map(projectScene)
		.sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));

	const durationSec = scenes.reduce((sum, s) => sum + s.durationSec, 0);

	const timedScenes = scenes.filter((s) => s.hasWordTimings).length;
	const derivedCoverage = scenes.length > 0 ? timedScenes / scenes.length : 0;

	const tts: BundleTts = {
		coverageRatio: clamp01(
			toFiniteNumber(input.tts?.coverageRatio, derivedCoverage),
		),
	};
	if (typeof input.tts?.provider === "string")
		tts.provider = input.tts.provider;
	if (typeof input.tts?.voiceId === "string") tts.voiceId = input.tts.voiceId;
	if (
		typeof input.tts?.speed === "number" &&
		Number.isFinite(input.tts.speed)
	) {
		tts.speed = input.tts.speed;
	}
	if (typeof input.tts?.profile === "string") tts.profile = input.tts.profile;

	const bgm: BundleBgm = {
		hasBeatGrid: input.bgm?.hasBeatGrid === true,
	};
	if (input.bgm?.source !== undefined) bgm.source = input.bgm.source;
	if (typeof input.bgm?.mood === "string") bgm.mood = input.bgm.mood;
	if (
		typeof input.bgm?.qualityScore === "number" &&
		Number.isFinite(input.bgm.qualityScore)
	) {
		bgm.qualityScore = input.bgm.qualityScore;
	}
	if (
		typeof input.bgm?.lufsEstimate === "number" &&
		Number.isFinite(input.bgm.lufsEstimate)
	) {
		bgm.lufsEstimate = input.bgm.lufsEstimate;
	}
	if (typeof input.bgm?.claimBlocked === "boolean") {
		bgm.claimBlocked = input.bgm.claimBlocked;
	}

	return {
		contentId: input.contentId,
		format: input.format,
		durationSec,
		scriptStructure: [...(input.scriptStructure ?? [])],
		scenes,
		tts,
		bgm,
	};
}

/**
 * 키 정렬 stable-stringify — 객체 키 순서/undefined/비결정 키와 무관하게
 * 같은 내용이면 같은 문자열을 보장한다.
 */
function stableStringify(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "number") {
		return Number.isFinite(value) ? JSON.stringify(value) : "null";
	}
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item ?? null)).join(",")}]`;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const parts = Object.keys(record)
			.filter(
				(key) => record[key] !== undefined && !NON_DETERMINISTIC_KEYS.has(key),
			)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
		return `{${parts.join(",")}}`;
	}
	// undefined/function/symbol 등 JSON 비호환 값
	return "null";
}

/**
 * 멱등 해시 — 같은 번들 + 같은 벤치마크 fingerprint → 같은 해시.
 * 비결정 필드(created_at/updatedAt/judgedAt 류)가 끼어들어도 결과 불변.
 */
export function hashContentBundle(
	bundle: ContentBundle,
	benchmarkFingerprint: string,
): string {
	const payload = `${stableStringify(bundle)}::${benchmarkFingerprint}`;
	return fnv1a32(payload).toString(16).padStart(8, "0");
}

/**
 * 롱폼 챕터 분할 — 씬 경계 기준. 누적 길이가 chapterEverySec 에 도달하면
 * 챕터를 닫고, 마지막 잔여 씬들은 마지막 챕터로 포함한다.
 * chapterEverySec 가 0 이하/비유한이면 전체를 챕터 1개로 반환.
 */
export function segmentBundleIntoChapters(
	bundle: ContentBundle,
	chapterEverySec: number,
): ContentBundleChapter[] {
	if (bundle.scenes.length === 0) return [];

	const safeEvery =
		Number.isFinite(chapterEverySec) && chapterEverySec > 0
			? chapterEverySec
			: Number.POSITIVE_INFINITY;

	const chapters: ContentBundleChapter[] = [];
	let currentScenes: BundleScene[] = [];
	let chapterStart = 0;
	let cursor = 0;

	for (const scene of bundle.scenes) {
		currentScenes.push(scene);
		cursor += scene.durationSec;
		if (cursor - chapterStart >= safeEvery) {
			chapters.push({
				index: chapters.length,
				startSec: chapterStart,
				endSec: cursor,
				scenes: currentScenes,
			});
			chapterStart = cursor;
			currentScenes = [];
		}
	}

	if (currentScenes.length > 0) {
		chapters.push({
			index: chapters.length,
			startSec: chapterStart,
			endSec: cursor,
			scenes: currentScenes,
		});
	}

	return chapters;
}
