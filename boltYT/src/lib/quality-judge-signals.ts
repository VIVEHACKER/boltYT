/**
 * 휴리스틱 신호 어댑터 — ContentBundle 을 시장 벤치마크 대비 정규화 신호로
 * 변환한다. 호출 가능한 기존 분석기(analyzeOpeningRetention / detectPacing /
 * detectHookPattern)는 재사용하고, 번들 화이트리스트 투영에 없는 shot 단위
 * 메타(source_url/visual_role/motion 등)나 BgmTrack 메타가 필요한 분석기
 * (analyzeProductionQuality / assessBgmTrackQuality)는 번들 가용 필드 기반
 * 자체 휴리스틱으로 대체한다.
 *
 * 순수·동기·결정론 + node-safe — 브라우저 전용 측정(video-dynamics,
 * AudioBuffer)은 제외하며, lufsDelta 는 번들의 사전 추정치(lufsEstimate)
 * 기반 추정 델타다. 점수는 휴리스틱 신호에서만 산출된다(불변량 1) —
 * LLM 출력은 이 모듈을 거치지 않는다.
 */

import type { BundleScene, ContentBundle } from "./content-bundle";
import { segmentBundleIntoChapters } from "./content-bundle";
import { detectEmpathyHook, detectHookPattern } from "./hook-detector";
import type { MarketBenchmark } from "./market-benchmark";
import { detectPacing } from "./pacing-detect";
import { analyzeOpeningRetention } from "./youtube-retention";

export interface EditingSignals {
	editorialDensityScore: number;
	premiumFloorScore: number;
	openingRetentionScore: number;
	avgCutSec: number;
	motionRatio: number;
	captionsPerMin: number;
	issues: string[];
}

export interface ScriptSignals {
	hookPattern: string;
	hookSec: number;
	/** 도입부 감정 공감 강도 0-1 — "내 얘기 같다"는 정서적 관련성(성장 플레이북 최대 레버) */
	emotionalEmpathy: number;
	structureRoles: string[];
	chapterCount: number;
	pacing: "slow" | "normal" | "fast";
	emptyNarrationCount: number;
}

export interface BgmSignals {
	qualityScore?: number;
	moodMatched: boolean;
	lufsDelta?: number;
	hasCuePlan: boolean;
	claimBlocked: boolean;
}

export interface TtsSignals {
	coverageRatio: number;
	speedDelta: number;
	profileMatched: boolean;
	wordTimingCoverage: number;
}

export interface JudgeSignals {
	editing: EditingSignals;
	script: ScriptSignals;
	bgm: BgmSignals;
	tts: TtsSignals;
}

/** youtube-retention 의 strong hook 판정 기준과 동일 */
const HOOK_CONFIDENCE_THRESHOLD = 0.34;
/** 한국어 자막 한 비트(한 줄) 평균 글자수 근사 — 자막 빈도 추정용 */
const CAPTION_CHARS_PER_BEAT = 14;
/** youtube-production-quality 의 thin_ending_narration 기준과 동일 */
const MIN_ENDING_NARRATION_CHARS = 14;
/** bgm-quality 의 MIN_PROFESSIONAL_BGM_SCORE 와 동일 — 만점 환산 기준 */
const BGM_QUALITY_FULL_CREDIT = 64;
/** BGM 은 있으나 품질 점수 미산출 — 통과 임계 직전으로 보수 추정 */
const FALLBACK_BGM_QUALITY = 55;
/** TTS speed 미지정 시 프로바이더 기본 배속 가정 */
const DEFAULT_TTS_SPEED = 1.0;

/** 근접 mood 쌍 — 정확 일치 외에 분위기 호환으로 간주 (key=벤치마크 mood) */
const MOOD_COMPAT: Record<string, string[]> = {
	dark: ["mysterious"],
	mysterious: ["dark"],
	dramatic: ["epic"],
	epic: ["dramatic"],
};

function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value) || value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

/** bar 대비 충족도 0..1 — bar 가 0 이하이면 신호 존재 여부로 폴백 */
function fitToBar(value: number, bar: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	if (!Number.isFinite(bar) || bar <= 0) return 1;
	return clamp01(value / bar);
}

function finiteOrUndefined(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** 씬에 동적 요소가 있는가 — shot motion 메타 부재의 번들 수준 근사 */
function hasMotion(scene: BundleScene): boolean {
	return scene.type === "video" || scene.motionGraphicCount > 0;
}

/** scene_type/transition 변주 — 4종 이상이면 만점 (분석기 diversity 근사) */
function varietyFit(scenes: BundleScene[]): number {
	const values = new Set<string>();
	for (const scene of scenes) {
		const type = scene.type.trim().toLowerCase();
		if (type) values.add(`type:${type}`);
		const transition = scene.transition?.trim().toLowerCase() ?? "";
		if (transition && transition !== "none") {
			values.add(`transition:${transition}`);
		}
	}
	return clamp01(values.size / 4);
}

function moodMatches(
	bundleMood: string | undefined,
	benchmarkMood: string,
): boolean {
	const actual = (bundleMood ?? "").trim().toLowerCase();
	const bar = benchmarkMood.trim().toLowerCase();
	if (!actual || !bar) return false;
	if (actual === bar) return true;
	return (MOOD_COMPAT[bar] ?? []).includes(actual);
}

/**
 * 번들 → 판정용 정규화 신호. 같은 번들 + 같은 벤치마크 → 항상 같은 신호.
 * 수치 신호는 FP 노이즈 제거를 위해 자릿수 고정(점수 정수 / 초·델타 2자리 /
 * 비율 4자리) — 하류 리포트 해시 멱등(불변량 4) 지원.
 */
export function collectJudgeSignals(
	bundle: ContentBundle,
	benchmark: MarketBenchmark,
): JudgeSignals {
	const scenes = bundle.scenes;
	const sceneCount = scenes.length;
	const narrationScenes = scenes.filter(
		(scene) => scene.narration.trim().length > 0,
	);
	const emptyNarrationCount = sceneCount - narrationScenes.length;

	// --- 기존 분석기 재사용: 초반 유지율 (제목은 번들에 없어 생략) ---
	const retention = analyzeOpeningRetention({
		format: bundle.format,
		scenes: scenes.map((scene) => ({
			narration_text: scene.narration,
			scene_type: scene.type,
			duration_seconds: scene.durationSec,
			// 모션 그래픽은 동적 비트로 간주 — shot motion 메타 부재의 근사
			shots: Array.from({ length: scene.motionGraphicCount }, () => ({
				motion: "motion_graphic",
			})),
		})),
	});

	// --- editing 신호 ---
	const totalCuts = scenes.reduce(
		(sum, scene) => sum + Math.max(1, scene.shotCount),
		0,
	);
	const avgCutSec =
		totalCuts > 0 && bundle.durationSec > 0
			? roundTo(bundle.durationSec / totalCuts, 2)
			: 0;
	const motionRatio =
		sceneCount > 0
			? roundTo(scenes.filter(hasMotion).length / sceneCount, 4)
			: 0;
	const narrationChars = narrationScenes.reduce(
		(sum, scene) => sum + scene.narration.trim().length,
		0,
	);
	const captionsPerMin =
		bundle.durationSec > 0
			? roundTo(
					narrationChars / CAPTION_CHARS_PER_BEAT / (bundle.durationSec / 60),
					2,
				)
			: 0;

	// 컷이 벤치마크보다 빠르면 만점 — 느릴수록 비례 감점
	const cutFit =
		avgCutSec > 0 ? clamp01(benchmark.editing.cutDensitySec / avgCutSec) : 0;
	const motionFit = fitToBar(motionRatio, benchmark.editing.motionRatio);
	const captionFit = fitToBar(captionsPerMin, benchmark.editing.captionsPerMin);
	const motionGraphicRatio =
		sceneCount > 0
			? scenes.filter((scene) => scene.motionGraphicCount > 0).length /
				sceneCount
			: 0;
	const editorialDensityScore =
		sceneCount === 0
			? 0
			: Math.round(
					cutFit * 30 +
						motionFit * 25 +
						captionFit * 20 +
						varietyFit(scenes) * 15 +
						motionGraphicRatio * 10,
				);

	const timedNarrationScenes = narrationScenes.filter(
		(scene) => scene.hasWordTimings,
	);
	const wordTimingCoverage =
		narrationScenes.length > 0
			? roundTo(timedNarrationScenes.length / narrationScenes.length, 4)
			: 0;

	const bgmQualityScore = finiteOrUndefined(bundle.bgm.qualityScore);
	const hasBgm =
		bundle.bgm.source !== undefined ||
		(bundle.bgm.mood ?? "").trim().length > 0 ||
		bgmQualityScore !== undefined;
	const lastScene = scenes[sceneCount - 1];
	const endingOk =
		(lastScene?.narration.trim().length ?? 0) >= MIN_ENDING_NARRATION_CHARS;
	const emptyRatio = sceneCount > 0 ? emptyNarrationCount / sceneCount : 1;
	const bgmQualityFit = clamp01(
		(bgmQualityScore ?? (hasBgm ? FALLBACK_BGM_QUALITY : 0)) /
			BGM_QUALITY_FULL_CREDIT,
	);
	const coverageRatio = roundTo(clamp01(bundle.tts.coverageRatio), 4);
	const premiumFloorScore =
		sceneCount === 0
			? 0
			: Math.round(
					(hasBgm ? 14 : 0) +
						coverageRatio * 20 +
						wordTimingCoverage * 16 +
						motionFit * 16 +
						(endingOk ? 10 : 0) +
						(1 - emptyRatio) * 12 +
						bgmQualityFit * 12,
				);

	const issues: string[] = [];
	if (sceneCount === 0) issues.push("zero_scenes");
	if (sceneCount > 0 && avgCutSec > benchmark.editing.cutDensitySec * 1.5) {
		issues.push("cut_density_below_bar");
	}
	if (sceneCount > 0 && motionRatio < benchmark.editing.motionRatio * 0.6) {
		issues.push("low_motion_ratio");
	}
	if (
		sceneCount > 0 &&
		captionsPerMin < benchmark.editing.captionsPerMin * 0.5
	) {
		issues.push("low_caption_density");
	}
	for (const issue of retention.issues) {
		const code = `opening_${issue.code}`;
		if (!issues.includes(code)) issues.push(code);
	}

	// --- script 신호 ---
	const hookPattern = detectHookPattern(scenes[0]?.narration ?? "").pattern;
	// 도입부 3줄(첫 2씬) 감정 공감 — 정보 전달 전 정서적 관련성을 만드는지
	const emotionalEmpathy = Math.max(
		detectEmpathyHook(scenes[0]?.narration ?? ""),
		detectEmpathyHook(scenes[1]?.narration ?? ""),
	);
	// 첫 strong hook 씬의 시작 오프셋(초). 훅이 없으면 총 길이(최악값).
	let hookSec = bundle.durationSec;
	let offset = 0;
	for (const scene of scenes) {
		if (
			detectHookPattern(scene.narration).confidence >= HOOK_CONFIDENCE_THRESHOLD
		) {
			hookSec = offset;
			break;
		}
		offset += scene.durationSec;
	}

	const chapterCount = segmentBundleIntoChapters(
		bundle,
		benchmark.script.chapterEverySec ?? 0,
	).length;

	const pacing = detectPacing({
		narration: scenes.map((scene) => scene.narration).join(" "),
		duration_seconds: bundle.durationSec,
	});

	// --- bgm 신호 ---
	const bgm: BgmSignals = {
		moodMatched: moodMatches(bundle.bgm.mood, benchmark.bgm.mood),
		hasCuePlan: bundle.bgm.hasBeatGrid,
		claimBlocked: bundle.bgm.claimBlocked === true,
	};
	if (bgmQualityScore !== undefined) {
		bgm.qualityScore = roundTo(bgmQualityScore, 2);
	}
	const lufsEstimate = finiteOrUndefined(bundle.bgm.lufsEstimate);
	if (lufsEstimate !== undefined) {
		bgm.lufsDelta = roundTo(lufsEstimate - benchmark.bgm.integratedLufs, 2);
	}

	// --- tts 신호 ---
	const speed = finiteOrUndefined(bundle.tts.speed) ?? DEFAULT_TTS_SPEED;
	const profile = (bundle.tts.profile ?? "").trim().toLowerCase();

	return {
		editing: {
			editorialDensityScore,
			premiumFloorScore,
			// 씬이 없으면 분석기 점수(68)가 아닌 0 — 쓰레기 입력 fail-closed
			openingRetentionScore: sceneCount === 0 ? 0 : retention.score,
			avgCutSec,
			motionRatio,
			captionsPerMin,
			issues,
		},
		script: {
			hookPattern,
			hookSec: roundTo(hookSec, 2),
			emotionalEmpathy: roundTo(emotionalEmpathy, 2),
			structureRoles: [...bundle.scriptStructure],
			chapterCount,
			pacing,
			emptyNarrationCount,
		},
		bgm,
		tts: {
			coverageRatio,
			speedDelta: roundTo(speed - benchmark.tts.speed, 2),
			profileMatched: profile.length > 0 && profile === benchmark.tts.profile,
			wordTimingCoverage,
		},
	};
}
