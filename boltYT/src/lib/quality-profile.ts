/**
 * Quality Profile — 생성 전 시장 벤치마크 주입
 *
 * {topic, format, durationSec} → QualityProfile 을 만들고,
 * 기존 생성 체인(ai.ts 프롬프트 / StepMedia TTS / BGM / 레퍼런스 프리셋)이
 * 시그니처 수정 없이 소비할 수 있는 형태로 변환한다.
 *
 * - 프롬프트: contentStrategyContext 에 append 하는 한국어 지시문 텍스트
 * - 영속: scriptId 키(localStorage, store 주입형)로 저장해 다운스트림
 *   (StepMedia TTS/BGM, 판정)이 같은 기준을 공유
 *
 * 모든 파생값은 결정론(벤치마크 수치 기반) — LLM 개입 없음.
 */

import { type BgmMood, normalizeMood } from "./bgm";
import type { BgmQualityContext } from "./bgm-quality";
import {
	type BenchmarkFormat,
	type BenchmarkReferenceSample,
	classifyBenchmarkGenre,
	type MarketBenchmark,
	resolveMarketBenchmark,
	type TtsBar,
} from "./market-benchmark";
import type { QualityHistoryStore } from "./quality-fix-history";
import type { ReferencePreset } from "./reference-bridge";
import type { TtsOptions } from "./tts";

export interface QualityProfile {
	benchmark: MarketBenchmark;
	editing: {
		cutDensitySec: number;
		bRollRatio: number;
		captionStyle: "dense" | "standard" | "minimal";
		captionsPerMin: number;
	};
	bgm: {
		mood: string;
		duckingDb: number;
		cuePlan: "hook_climax_resolve" | "chapter_pulse";
	};
	tts: {
		profile: TtsBar["profile"];
		speed: number;
	};
	script: {
		structureRoles: string[];
		hookSec: number;
		chapters?: { everySec: number; count: number };
	};
}

const PROFILE_KEY_PREFIX = "quality_profile_";

/** 자막 밀도(분당) → 캡션 스타일 결정론 분류 */
const DENSE_CAPTIONS_PER_MIN = 20;
const MINIMAL_CAPTIONS_PER_MIN = 10;

/** chapterEverySec 결측 시 롱폼 폴백 (market-benchmark FORMAT_BASE 와 동일) */
const FALLBACK_CHAPTER_EVERY_SEC = 150;

/** 컷 밀도(초) → BGM 템포 결정론 분류 */
const FAST_CUT_DENSITY_SEC = 3;
const MID_CUT_DENSITY_SEC = 4.5;

/**
 * TTS 프로파일 → 톤 키워드. tts.ts 의 PROFILE_TONE_KEYWORDS(비공개)와 동일 —
 * inferProfileFromOptions 정규식이 같은 프로파일로 역추론하도록 보장된 어휘.
 */
const PROFILE_TONE_KEYWORDS: Record<TtsBar["profile"], string[]> = {
	suspense: ["긴장감", "절제", "다큐 톤", "단서 강조"],
	news: ["정확함", "또박또박", "브리핑", "냉정함"],
	warm: ["따뜻함", "절제된 감정", "여운", "공감"],
	upbeat: ["속도감", "선명한 강조", "에너지", "반전 포인트"],
	neutral: ["차분함", "명료함", "다큐 톤"],
};

const BGM_MOODS: ReadonlySet<string> = new Set([
	"dark",
	"tense",
	"mysterious",
	"dramatic",
	"calm",
	"upbeat",
	"epic",
	"sad",
]);

function classifyCaptionStyle(
	captionsPerMin: number,
): QualityProfile["editing"]["captionStyle"] {
	if (captionsPerMin >= DENSE_CAPTIONS_PER_MIN) return "dense";
	if (captionsPerMin >= MINIMAL_CAPTIONS_PER_MIN) return "standard";
	return "minimal";
}

/**
 * 벤치마크 mood 문자열 → BgmMood. 리터럴이면 그대로(normalizeMood 는
 * "dark" 등 리터럴 자체를 calm 으로 흘리는 사각이 있어 우선 매칭), 아니면 정규화.
 */
function toBgmMood(mood: string): BgmMood {
	const m = mood.trim().toLowerCase();
	return BGM_MOODS.has(m) ? (m as BgmMood) : normalizeMood(m);
}

function toBgmTempo(cutDensitySec: number): "slow" | "mid" | "fast" {
	if (cutDensitySec <= FAST_CUT_DENSITY_SEC) return "fast";
	if (cutDensitySec <= MID_CUT_DENSITY_SEC) return "mid";
	return "slow";
}

/**
 * 벤치마크 → 생성 전 품질 프로파일.
 * benchmark 미지정 시 topic 장르 분류 + 샘플 학습으로 해석한다.
 * 쇼츠는 cuePlan hook_climax_resolve, 롱폼은 chapter_pulse + chapters 계산.
 */
export function buildQualityProfile(input: {
	topic: string;
	format: BenchmarkFormat;
	durationSec: number;
	benchmark?: MarketBenchmark;
	samples?: BenchmarkReferenceSample[];
}): QualityProfile {
	const benchmark =
		input.benchmark ??
		resolveMarketBenchmark({
			genre: classifyBenchmarkGenre(input.topic),
			format: input.format,
			samples: input.samples,
		});

	const isLongform = input.format === "longform";

	let chapters: QualityProfile["script"]["chapters"];
	if (isLongform) {
		const rawEvery = benchmark.script.chapterEverySec;
		const everySec =
			typeof rawEvery === "number" && Number.isFinite(rawEvery) && rawEvery > 0
				? rawEvery
				: FALLBACK_CHAPTER_EVERY_SEC;
		const duration =
			Number.isFinite(input.durationSec) && input.durationSec > 0
				? input.durationSec
				: 0;
		chapters = { everySec, count: Math.max(1, Math.ceil(duration / everySec)) };
	}

	return {
		benchmark,
		editing: {
			cutDensitySec: benchmark.editing.cutDensitySec,
			bRollRatio: benchmark.editing.bRollRatio,
			captionStyle: classifyCaptionStyle(benchmark.editing.captionsPerMin),
			captionsPerMin: benchmark.editing.captionsPerMin,
		},
		bgm: {
			mood: benchmark.bgm.mood,
			duckingDb: benchmark.bgm.duckingDb,
			cuePlan: isLongform ? "chapter_pulse" : "hook_climax_resolve",
		},
		tts: {
			profile: benchmark.tts.profile,
			speed: benchmark.tts.speed,
		},
		script: {
			structureRoles: [...benchmark.script.structureRoles],
			hookSec: benchmark.script.hookSec,
			...(chapters !== undefined ? { chapters } : {}),
		},
	};
}

/**
 * 대본 생성 contentStrategyContext 에 append 하는 한국어 지시문.
 * ai.ts 시그니처 무수정 — 호출부가 기존 컨텍스트 문자열 뒤에 붙인다.
 */
export function qualityProfileToPromptContext(p: QualityProfile): string {
	const b = p.benchmark;
	const lines = [
		"=== 시장 품질 기준 ===",
		`- 벤치마크: ${b.genre} × ${b.format} (출처 ${b.source}, 신뢰도 ${b.confidence})`,
		`- 오프닝 훅: 첫 ${p.script.hookSec}초 안에 핵심 사건/질문 제시`,
		`- 컷 밀도: 평균 ${p.editing.cutDensitySec}초마다 장면 전환 — 씬 길이를 이 리듬에 맞출 것`,
		`- 자막 밀도: 분당 ${p.editing.captionsPerMin}개 (${p.editing.captionStyle} 스타일)`,
		`- b-roll 비율: 전체의 ${Math.round(p.editing.bRollRatio * 100)}% 이상`,
		`- 구조 역할: ${p.script.structureRoles.join(" → ")} 순서를 지킬 것`,
	];
	if (p.script.chapters) {
		lines.push(
			`- 챕터: 약 ${p.script.chapters.everySec}초 간격으로 총 ${p.script.chapters.count}개 — 각 챕터 시작은 미니 훅으로 열 것`,
		);
	}
	lines.push(
		`- BGM: ${p.bgm.mood} 무드, 내레이션 구간 더킹 ${p.bgm.duckingDb}dB, 큐 플랜 ${p.bgm.cuePlan}`,
		`- 내레이션 톤: ${p.tts.profile} 프로파일, 속도 ${p.tts.speed}x 를 전제로 문장 길이를 조절할 것`,
	);
	return lines.join("\n");
}

/** StepMedia TTS 가 그대로 합칠 수 있는 옵션 패치 */
export function qualityProfileToTtsOptions(
	p: QualityProfile,
): Partial<TtsOptions> {
	return {
		speed: p.tts.speed,
		toneKeywords: [...PROFILE_TONE_KEYWORDS[p.tts.profile]],
	};
}

/** BGM 추천/스코어링 컨텍스트 변환 */
export function qualityProfileToBgmContext(
	p: QualityProfile,
): BgmQualityContext {
	const mood = toBgmMood(p.bgm.mood);
	const raw = p.bgm.mood.trim().toLowerCase();
	const keywords = raw && raw !== mood ? [mood, raw] : [mood];
	return {
		mood,
		keywords,
		tempo: toBgmTempo(p.editing.cutDensitySec),
	};
}

/**
 * 레퍼런스 프리셋 패치 — 완전 구성 가능한 tts/bgm 섹션만 덮는다.
 * script 섹션은 sceneCount/targetDuration 등 프로파일이 보유하지 않는
 * 필드를 요구하므로 패치하지 않는다 (기존 프리셋 값 유지).
 */
export function qualityProfileToReferencePresetPatch(
	p: QualityProfile,
): Partial<ReferencePreset> {
	const bgmContext = qualityProfileToBgmContext(p);
	return {
		tts: {
			speed: p.tts.speed,
			toneKeywords: [...PROFILE_TONE_KEYWORDS[p.tts.profile]],
		},
		bgm: {
			mood: toBgmMood(p.bgm.mood),
			keywords: bgmContext.keywords ?? [],
			tempo: bgmContext.tempo ?? "mid",
		},
	};
}

// ─── 영속 (scriptId 키, store 주입형) ───

/** node 폴백 — 프로세스 생애 동안만 유지되는 메모리 저장소 */
const memoryFallback = new Map<string, string>();

function resolveStore(store?: QualityHistoryStore): QualityHistoryStore {
	if (store) return store;
	if (typeof window !== "undefined" && window.localStorage) {
		return {
			get: (k) => window.localStorage.getItem(k),
			set: (k, v) => {
				window.localStorage.setItem(k, v);
			},
		};
	}
	return {
		get: (k) => memoryFallback.get(k) ?? null,
		set: (k, v) => {
			memoryFallback.set(k, v);
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const CAPTION_STYLES: ReadonlySet<string> = new Set([
	"dense",
	"standard",
	"minimal",
]);
const CUE_PLANS: ReadonlySet<string> = new Set([
	"hook_climax_resolve",
	"chapter_pulse",
]);
const TTS_PROFILES: ReadonlySet<string> = new Set([
	"suspense",
	"news",
	"warm",
	"upbeat",
	"neutral",
]);

function isQualityProfile(value: unknown): value is QualityProfile {
	if (!isRecord(value)) return false;
	const { benchmark, editing, bgm, tts, script } = value;
	if (!isRecord(benchmark) || typeof benchmark.fingerprint !== "string") {
		return false;
	}
	if (
		!isRecord(editing) ||
		typeof editing.cutDensitySec !== "number" ||
		typeof editing.bRollRatio !== "number" ||
		typeof editing.captionsPerMin !== "number" ||
		typeof editing.captionStyle !== "string" ||
		!CAPTION_STYLES.has(editing.captionStyle)
	) {
		return false;
	}
	if (
		!isRecord(bgm) ||
		typeof bgm.mood !== "string" ||
		typeof bgm.duckingDb !== "number" ||
		typeof bgm.cuePlan !== "string" ||
		!CUE_PLANS.has(bgm.cuePlan)
	) {
		return false;
	}
	if (
		!isRecord(tts) ||
		typeof tts.profile !== "string" ||
		!TTS_PROFILES.has(tts.profile) ||
		typeof tts.speed !== "number"
	) {
		return false;
	}
	if (
		!isRecord(script) ||
		!isStringArray(script.structureRoles) ||
		typeof script.hookSec !== "number"
	) {
		return false;
	}
	if (script.chapters !== undefined) {
		if (
			!isRecord(script.chapters) ||
			typeof script.chapters.everySec !== "number" ||
			typeof script.chapters.count !== "number"
		) {
			return false;
		}
	}
	return true;
}

/** scriptId 키로 저장 — StepMedia TTS/BGM, 판정 단계가 동일 기준을 공유 */
export function saveQualityProfile(
	scriptId: string,
	p: QualityProfile,
	store?: QualityHistoryStore,
): void {
	const s = resolveStore(store);
	s.set(`${PROFILE_KEY_PREFIX}${scriptId}`, JSON.stringify(p));
}

/** 저장값이 없거나 파싱 실패/형식 불일치면 null */
export function loadQualityProfile(
	scriptId: string,
	store?: QualityHistoryStore,
): QualityProfile | null {
	const s = resolveStore(store);
	const raw = s.get(`${PROFILE_KEY_PREFIX}${scriptId}`);
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		return isQualityProfile(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
