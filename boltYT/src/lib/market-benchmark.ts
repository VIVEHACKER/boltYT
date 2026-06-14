/**
 * 시장 벤치마크 — 장르×포맷 marketBar 스키마 + 내장 프리셋(콜드스타트 폴백)
 * + 레퍼런스 샘플 가중 중앙값 학습 + 장르 분류 + 결정론 fingerprint.
 *
 * 순수 모듈 — ReferenceTemplate 파싱은 어댑터(웨이브2)에 위임한다.
 * 프리셋 수치 근거: 시장 상위 AI 쇼츠 컷 밀도 2.5-3.0s, 훅 3s 이내,
 * 자막 25-30/min; 롱폼 컷 4-5s, 챕터 2-3분 간격, b-roll 40%+.
 *
 * 멱등 불변량: fingerprint 는 updatedAt 등 비결정 필드를 제외한
 * 키 정렬 stable-stringify + fnv1a32 — 같은 입력이면 항상 같은 값.
 */

import { fnv1a32 } from "./hash-seed";

export type BenchmarkFormat = "shorts" | "longform";

export type BenchmarkGenre =
	| "horror_mystery"
	| "news_issue"
	| "drama_recap"
	| "docu_story"
	| "historical_vlog"
	| "generic";

export interface EditingBar {
	cutDensitySec: number;
	hookSec: number;
	bRollRatio: number;
	captionsPerMin: number;
	motionRatio: number;
}

export interface BgmBar {
	mood: string;
	integratedLufs: number;
	/** 내레이션 구간에서 BGM 에 적용할 게인(dB, 음수 = 감쇠) */
	duckingDb: number;
	cueEverySec?: number;
}

export interface TtsBar {
	profile: "suspense" | "news" | "warm" | "upbeat" | "neutral";
	speed: number;
}

export interface ScriptBar {
	hookSec: number;
	structureRoles: string[];
	chapterEverySec?: number;
	minScenes: number;
}

export interface MarketBenchmark {
	id: string;
	genre: BenchmarkGenre;
	format: BenchmarkFormat;
	source: "builtin" | "learned" | "hybrid";
	sampleCount: number;
	confidence: number;
	editing: EditingBar;
	bgm: BgmBar;
	tts: TtsBar;
	script: ScriptBar;
	version: number;
	fingerprint: string;
	updatedAt: string;
}

export interface BenchmarkReferenceSample {
	url?: string;
	views?: number;
	channelSubs?: number;
	format: BenchmarkFormat;
	cutDensitySec?: number;
	hookSec?: number;
	bgmMood?: string;
	integratedLufs?: number;
	ttsSpeed?: number;
	captionsPerMin?: number;
	chapterEverySec?: number;
	sceneCount?: number;
}

const BUILTIN_VERSION = 1;
/** 내장 프리셋 신뢰도 — 시장 통계 기반이지만 채널 맞춤 학습 전이므로 중간 이하 */
const BUILTIN_CONFIDENCE = 0.4;
/** 이 수 이상의 샘플이면 learned, 미만이면 프리셋과 블렌딩(hybrid) */
const MIN_LEARNED_SAMPLES = 3;
const MIN_SAMPLE_WEIGHT = 0.5;
const MAX_SAMPLE_WEIGHT = 10;

interface FormatBase {
	editing: Omit<EditingBar, "cutDensitySec">;
	bgmIntegratedLufs: number;
	bgmCueEverySec: number;
	scriptHookSec: number;
	scriptMinScenes: number;
	scriptChapterEverySec?: number;
}

/** 쇼츠 TTS 속도 하한 — 느리면 즉시 넘겨짐(성장 플레이북: 1.1~1.2x 권장). */
const SHORTS_TTS_SPEED_FLOOR = 1.1;

const FORMAT_BASE: Record<BenchmarkFormat, FormatBase> = {
	shorts: {
		editing: {
			hookSec: 2.5,
			bRollRatio: 0.3,
			captionsPerMin: 28,
			motionRatio: 0.5,
		},
		bgmIntegratedLufs: -16,
		bgmCueEverySec: 15,
		scriptHookSec: 3,
		scriptMinScenes: 6,
	},
	longform: {
		editing: {
			hookSec: 10,
			bRollRatio: 0.45,
			captionsPerMin: 14,
			motionRatio: 0.3,
		},
		bgmIntegratedLufs: -15,
		bgmCueEverySec: 40,
		scriptHookSec: 12,
		scriptMinScenes: 12,
		scriptChapterEverySec: 150,
	},
};

interface GenrePreset {
	bgmMood: string;
	duckingDb: number;
	ttsProfile: TtsBar["profile"];
	ttsSpeed: number;
	structureRoles: string[];
	shortsCutDensitySec: number;
	longformCutDensitySec: number;
}

const GENRE_PRESETS: Record<BenchmarkGenre, GenrePreset> = {
	horror_mystery: {
		bgmMood: "dark",
		duckingDb: -10,
		ttsProfile: "suspense",
		ttsSpeed: 1.0,
		structureRoles: ["hook", "buildup", "twist", "cta"],
		shortsCutDensitySec: 3.0,
		longformCutDensitySec: 5.0,
	},
	news_issue: {
		bgmMood: "tense",
		duckingDb: -12,
		ttsProfile: "news",
		ttsSpeed: 1.08,
		structureRoles: ["hook", "facts", "analysis", "outlook"],
		shortsCutDensitySec: 2.5,
		longformCutDensitySec: 4.0,
	},
	drama_recap: {
		bgmMood: "dramatic",
		duckingDb: -10,
		ttsProfile: "upbeat",
		ttsSpeed: 1.1,
		structureRoles: ["hook", "setup", "conflict", "climax", "ending"],
		shortsCutDensitySec: 2.6,
		longformCutDensitySec: 4.2,
	},
	docu_story: {
		bgmMood: "dramatic",
		duckingDb: -9,
		ttsProfile: "warm",
		ttsSpeed: 1.0,
		structureRoles: ["hook", "context", "journey", "reflection"],
		shortsCutDensitySec: 2.9,
		longformCutDensitySec: 4.8,
	},
	// AI 역사 시간여행 1인칭 브이로그 — 검증된 포맷("Chloe VS History").
	// 몰입형이라 컷이 다큐보다 약간 느리고, 따뜻한 스토리텔링 톤.
	// structureRoles 는 historical-vlog-format.HISTORICAL_VLOG_STRUCTURE_ROLES 와 일치(저수준 모듈이라 인라인).
	historical_vlog: {
		bgmMood: "epic",
		duckingDb: -10,
		ttsProfile: "warm",
		ttsSpeed: 1.0,
		structureRoles: [
			"hook",
			"arrival",
			"immersion",
			"conflict",
			"revelation",
			"farewell",
		],
		shortsCutDensitySec: 2.8,
		longformCutDensitySec: 4.5,
	},
	generic: {
		bgmMood: "calm",
		duckingDb: -10,
		ttsProfile: "neutral",
		ttsSpeed: 1.05,
		structureRoles: ["hook", "body", "cta"],
		shortsCutDensitySec: 2.7,
		longformCutDensitySec: 4.5,
	},
};

/** 비결정 필드 — 어떤 경로로 흘러들어와도 fingerprint 에서 영구 제외 */
const NON_DETERMINISTIC_KEYS = new Set([
	"updatedAt",
	"updated_at",
	"createdAt",
	"created_at",
	"judgedAt",
	"judged_at",
	"fingerprint",
]);

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
 * 결정론 fingerprint — updatedAt(비결정) 제외, 키 순서 무관.
 * 같은 벤치마크 내용이면 항상 같은 8자리 hex.
 */
export function benchmarkFingerprint(
	b: Omit<MarketBenchmark, "fingerprint" | "updatedAt">,
): string {
	return fnv1a32(stableStringify(b)).toString(16).padStart(8, "0");
}

function finalizeBenchmark(
	core: Omit<MarketBenchmark, "fingerprint" | "updatedAt">,
): MarketBenchmark {
	// 쇼츠 TTS 속도 하한을 builtin·learned·hybrid 모든 경로에 적용(느린 샘플 학습 방지).
	// fingerprint 계산 전에 정규화해야 멱등 캐시 키도 하한값 기준으로 일치.
	const normalized =
		core.format === "shorts" && core.tts.speed < SHORTS_TTS_SPEED_FLOOR
			? { ...core, tts: { ...core.tts, speed: SHORTS_TTS_SPEED_FLOOR } }
			: core;
	return {
		...normalized,
		fingerprint: benchmarkFingerprint(normalized),
		updatedAt: new Date().toISOString(),
	};
}

function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/** 5장르×2포맷 전부 프리셋 존재 — 콜드스타트 폴백 */
export function getBuiltinBenchmark(
	genre: BenchmarkGenre,
	format: BenchmarkFormat,
): MarketBenchmark {
	const base = FORMAT_BASE[format];
	const preset = GENRE_PRESETS[genre];
	const core: Omit<MarketBenchmark, "fingerprint" | "updatedAt"> = {
		id: `${genre}:${format}`,
		genre,
		format,
		source: "builtin",
		sampleCount: 0,
		confidence: BUILTIN_CONFIDENCE,
		editing: {
			cutDensitySec:
				format === "shorts"
					? preset.shortsCutDensitySec
					: preset.longformCutDensitySec,
			...base.editing,
		},
		bgm: {
			mood: preset.bgmMood,
			integratedLufs: base.bgmIntegratedLufs,
			duckingDb: preset.duckingDb,
			cueEverySec: base.bgmCueEverySec,
		},
		// 쇼츠 TTS 속도 하한은 finalizeBenchmark 에서 일괄 적용(builtin·learned 공통).
		tts: { profile: preset.ttsProfile, speed: preset.ttsSpeed },
		script: {
			hookSec: base.scriptHookSec,
			structureRoles: [...preset.structureRoles],
			minScenes: base.scriptMinScenes,
			...(base.scriptChapterEverySec !== undefined
				? { chapterEverySec: base.scriptChapterEverySec }
				: {}),
		},
		version: BUILTIN_VERSION,
	};
	return finalizeBenchmark(core);
}

function positiveFinite(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: undefined;
}

/**
 * 샘플 가중치 — "터진" 영상(구독자 대비 조회수↑)일수록 가중↑.
 * views 없음 → 1 / subs 없음 → 절대 조회수 로그 스케일 근사 (1e6뷰 ≈ 2).
 */
function sampleWeight(sample: BenchmarkReferenceSample): number {
	const views = positiveFinite(sample.views);
	const subs = positiveFinite(sample.channelSubs);
	if (views === undefined) return 1;
	const raw = subs === undefined ? Math.log10(views + 1) / 3 : views / subs;
	return Math.min(MAX_SAMPLE_WEIGHT, Math.max(MIN_SAMPLE_WEIGHT, raw));
}

interface WeightedNumber {
	value: number;
	weight: number;
}

/** 가중 중앙값 — 값 오름차순 정렬 후 누적 가중치가 절반에 닿는 값 (결정론) */
function weightedMedian(entries: WeightedNumber[]): number | undefined {
	if (entries.length === 0) return undefined;
	const sorted = [...entries].sort((a, b) => a.value - b.value);
	let total = 0;
	for (const entry of sorted) total += entry.weight;
	const half = total / 2;
	let cumulative = 0;
	for (const entry of sorted) {
		cumulative += entry.weight;
		if (cumulative >= half) return entry.value;
	}
	return sorted[sorted.length - 1]?.value;
}

/** 가중 최빈값 — 동률이면 사전순 작은 값 (결정론) */
function weightedMode(
	entries: { value: string; weight: number }[],
): string | undefined {
	if (entries.length === 0) return undefined;
	const totals = new Map<string, number>();
	for (const entry of entries) {
		totals.set(entry.value, (totals.get(entry.value) ?? 0) + entry.weight);
	}
	let best: string | undefined;
	let bestWeight = Number.NEGATIVE_INFINITY;
	for (const [value, weight] of totals) {
		if (
			weight > bestWeight ||
			(weight === bestWeight && best !== undefined && value < best)
		) {
			best = value;
			bestWeight = weight;
		}
	}
	return best;
}

/**
 * 레퍼런스 샘플 학습 — views/channelSubs 비율 가중 중앙값.
 * 결측 필드 샘플은 해당 필드 계산에서만 제외(sampleCount 에는 포함).
 * sampleCount < 3 → confidence < 0.5 + 프리셋과 블렌딩(source: "hybrid").
 * 포맷 불일치 샘플은 학습에서 제외 (쇼츠 바를 롱폼 샘플로 오염 방지).
 */
export function learnBenchmarkFromSamples(input: {
	samples: BenchmarkReferenceSample[];
	genre: BenchmarkGenre;
	format: BenchmarkFormat;
}): MarketBenchmark {
	const base = getBuiltinBenchmark(input.genre, input.format);
	const samples = input.samples.filter(
		(sample) => sample.format === input.format,
	);
	if (samples.length === 0) return base;

	const weighted = samples.map((sample) => ({
		sample,
		weight: sampleWeight(sample),
	}));
	const sampleCount = samples.length;
	const isLearned = sampleCount >= MIN_LEARNED_SAMPLES;
	// hybrid 블렌딩 비율 — 샘플이 많을수록 학습값 쪽으로 이동
	const learnedShare = isLearned ? 1 : sampleCount / MIN_LEARNED_SAMPLES;

	const medianOf = (
		pick: (sample: BenchmarkReferenceSample) => number | undefined,
		allowNegative = false,
	): number | undefined =>
		weightedMedian(
			weighted.flatMap(({ sample, weight }) => {
				const raw = pick(sample);
				const valid =
					typeof raw === "number" &&
					Number.isFinite(raw) &&
					(allowNegative || raw > 0);
				return valid ? [{ value: raw, weight }] : [];
			}),
		);

	const blend = (builtin: number, learned: number | undefined): number =>
		learned === undefined
			? builtin
			: roundTo(builtin + (learned - builtin) * learnedShare, 4);

	const learnedMood = weightedMode(
		weighted.flatMap(({ sample, weight }) => {
			const mood =
				typeof sample.bgmMood === "string"
					? sample.bgmMood.trim().toLowerCase()
					: "";
			return mood ? [{ value: mood, weight }] : [];
		}),
	);

	const learnedChapter = medianOf((sample) => sample.chapterEverySec);
	const chapterEverySec =
		base.script.chapterEverySec === undefined
			? learnedChapter
			: blend(base.script.chapterEverySec, learnedChapter);

	const core: Omit<MarketBenchmark, "fingerprint" | "updatedAt"> = {
		id: base.id,
		genre: input.genre,
		format: input.format,
		source: isLearned ? "learned" : "hybrid",
		sampleCount,
		confidence: roundTo(
			isLearned
				? Math.min(0.9, 0.5 + 0.08 * sampleCount)
				: BUILTIN_CONFIDENCE + 0.04 * sampleCount,
			2,
		),
		editing: {
			cutDensitySec: blend(
				base.editing.cutDensitySec,
				medianOf((sample) => sample.cutDensitySec),
			),
			hookSec: blend(
				base.editing.hookSec,
				medianOf((sample) => sample.hookSec),
			),
			// 샘플에 신호가 없는 필드는 프리셋 유지
			bRollRatio: base.editing.bRollRatio,
			captionsPerMin: blend(
				base.editing.captionsPerMin,
				medianOf((sample) => sample.captionsPerMin),
			),
			motionRatio: base.editing.motionRatio,
		},
		bgm: {
			// 범주형은 충분한 샘플(learned)일 때만 교체 — hybrid 는 프리셋 분위기 유지
			mood: isLearned ? (learnedMood ?? base.bgm.mood) : base.bgm.mood,
			integratedLufs: blend(
				base.bgm.integratedLufs,
				medianOf((sample) => sample.integratedLufs, true),
			),
			duckingDb: base.bgm.duckingDb,
			...(base.bgm.cueEverySec !== undefined
				? { cueEverySec: base.bgm.cueEverySec }
				: {}),
		},
		tts: {
			profile: base.tts.profile,
			speed: blend(
				base.tts.speed,
				medianOf((sample) => sample.ttsSpeed),
			),
		},
		script: {
			hookSec: blend(
				base.script.hookSec,
				medianOf((sample) => sample.hookSec),
			),
			structureRoles: [...base.script.structureRoles],
			minScenes: Math.max(
				1,
				Math.round(
					blend(
						base.script.minScenes,
						medianOf((sample) => sample.sceneCount),
					),
				),
			),
			...(chapterEverySec !== undefined ? { chapterEverySec } : {}),
		},
		version: base.version,
	};
	return finalizeBenchmark(core);
}

/** samples>=3 → learned | 1-2 → hybrid | 0 → builtin */
export function resolveMarketBenchmark(input: {
	genre: BenchmarkGenre;
	format: BenchmarkFormat;
	samples?: BenchmarkReferenceSample[];
}): MarketBenchmark {
	const samples = (input.samples ?? []).filter(
		(sample) => sample.format === input.format,
	);
	if (samples.length === 0) {
		return getBuiltinBenchmark(input.genre, input.format);
	}
	return learnBenchmarkFromSamples({
		samples,
		genre: input.genre,
		format: input.format,
	});
}

const GENRE_KEYWORDS: Record<Exclude<BenchmarkGenre, "generic">, string[]> = {
	horror_mystery: [
		"공포",
		"괴담",
		"미스터리",
		"귀신",
		"호러",
		"무서운",
		"소름",
		"미제",
		"실종",
		"저주",
		"흉가",
		"오싹",
		"horror",
		"ghost",
		"scary",
		"creepy",
		"haunted",
		"mystery",
		"unsolved",
		"paranormal",
	],
	news_issue: [
		"뉴스",
		"속보",
		"이슈",
		"논란",
		"사건",
		"시사",
		"정치",
		"경제",
		"사회",
		"근황",
		"news",
		"breaking",
		"issue",
		"controversy",
		"politics",
		"scandal",
		"economy",
	],
	drama_recap: [
		"드라마",
		"리캡",
		"결말",
		"줄거리",
		"요약",
		"몰아보기",
		"명장면",
		"영화",
		"drama",
		"recap",
		"ending",
		"summary",
		"binge",
		"movie",
		"series",
	],
	docu_story: [
		"다큐",
		"다큐멘터리",
		"역사",
		"실화",
		"인물",
		"일대기",
		"위인",
		"전쟁사",
		"documentary",
		"history",
		"true story",
		"biography",
	],
	// 시간여행 1인칭 브이로그 — 다큐(역사/history)·일반 브이로그·사극(시대극)과 겹치지 않도록
	// *시간여행* 특화 신호만 사용. ("사극"/"시대극"은 시간여행 아닌 일반 시대물도 포함해 제외)
	historical_vlog: [
		"시간여행",
		"시간 여행",
		"타임슬립",
		"타임머신",
		"타임트래블",
		"time travel",
		"time-travel",
		"time traveled",
		"time traveler",
		"time-traveling",
		"pov vlog",
		"i went back to",
	],
};

/** YouTube categoryId → 장르 힌트 (25=News&Politics, 1=Film&Animation, 27=Education) */
const HINT_CATEGORY_GENRE: Record<
	string,
	Exclude<BenchmarkGenre, "generic">
> = {
	"25": "news_issue",
	"1": "drama_recap",
	"27": "docu_story",
};

const HINT_MOOD_GENRE: Record<string, Exclude<BenchmarkGenre, "generic">> = {
	dark: "horror_mystery",
	creepy: "horror_mystery",
	eerie: "horror_mystery",
	mysterious: "horror_mystery",
	tense: "news_issue",
	urgent: "news_issue",
	dramatic: "drama_recap",
	emotional: "drama_recap",
	warm: "docu_story",
	nostalgic: "docu_story",
};

/** 동률 시 결정론 우선순위 */
const GENRE_PRIORITY: Exclude<BenchmarkGenre, "generic">[] = [
	"horror_mystery",
	"news_issue",
	"drama_recap",
	// 시간여행 신호가 있으면 역사 다큐보다 브이로그 포맷을 우선(동점 시).
	"historical_vlog",
	"docu_story",
];

/** 키워드 휴리스틱 장르 분류 (한국어+영어) — 매칭 실패 시 generic */
export function classifyBenchmarkGenre(
	topic: string,
	hints?: { visualMood?: string; categoryId?: string },
): BenchmarkGenre {
	const text = topic.toLowerCase();
	const scores: Record<Exclude<BenchmarkGenre, "generic">, number> = {
		horror_mystery: 0,
		news_issue: 0,
		drama_recap: 0,
		historical_vlog: 0,
		docu_story: 0,
	};

	for (const genre of GENRE_PRIORITY) {
		for (const keyword of GENRE_KEYWORDS[genre]) {
			if (text.includes(keyword)) scores[genre] += 1;
		}
	}

	const mood = hints?.visualMood?.trim().toLowerCase() ?? "";
	const moodGenre = HINT_MOOD_GENRE[mood];
	if (moodGenre) scores[moodGenre] += 1;

	const categoryGenre = HINT_CATEGORY_GENRE[hints?.categoryId ?? ""];
	if (categoryGenre) scores[categoryGenre] += 2;

	let best: BenchmarkGenre = "generic";
	let bestScore = 0;
	for (const genre of GENRE_PRIORITY) {
		if (scores[genre] > bestScore) {
			best = genre;
			bestScore = scores[genre];
		}
	}
	return best;
}
