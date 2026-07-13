/**
 * 벤치마크 레퍼런스 어댑터 — 기존 ReferenceTemplate/AnalysisJobResult 의
 * untyped raw_analysis(production_dna)를 BenchmarkReferenceSample 로 변환.
 *
 * 런타임 가드 원칙: raw_analysis 는 분석 서버 출력이라 타입 보장이 없다.
 * 문자열/NaN/Infinity 오염 필드는 조용히 제외 — 벤치마크 학습(가중 중앙값)
 * 으로 NaN 이 전파되는 것을 막는다.
 *
 * 다이제스트: 저장 직전 buildBenchmarkObservation 결과를
 * raw_analysis.benchmark_observation 에 중첩해 두면, 판정 시
 * extractBenchmarkSample 이 production_dna 재파싱 없이 그대로 읽는다.
 */

import type { ReferenceTemplate } from "../types/database";
import type {
	BenchmarkFormat,
	BenchmarkReferenceSample,
} from "./market-benchmark";
import { referenceFormatForDuration } from "./reference-duration-policy";
import { scoreReferenceQuality } from "./reference-quality";

export interface ReferenceSampleMeta {
	views?: number;
	channelSubs?: number;
}

/**
 * buildBenchmarkObservation 입력 — AnalysisJobResult(reference-import)의
 * 구조적 부분집합. reference-import 가 저장 시점에 이 모듈을 value import
 * 하므로, 역방향 type import 를 제거해 순환 의존을 없앤다.
 * AnalysisJobResult 는 이 타입에 그대로 할당 가능하다.
 */
export interface BenchmarkObservationSource {
	raw_analysis?: Record<string, unknown>;
	hook_duration?: number;
	tts_speed?: number;
	bgm_mood?: string;
}

/** 저장 시점 관측치 다이제스트 — raw_analysis.benchmark_observation 으로 중첩 */
export interface BenchmarkObservation {
	cutDensitySec?: number;
	hookSec?: number;
	integratedLufs?: number;
	ttsSpeed?: number;
	captionsPerMin?: number;
	bgmMood?: string;
	extractedAt: string;
}

/** raw_analysis 안에서 다이제스트가 중첩되는 키 — 저장/판독 양쪽이 공유 */
export const BENCHMARK_OBSERVATION_KEY = "benchmark_observation";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function positiveFinite(value: unknown): number | undefined {
	const num = finiteNumber(value);
	return num !== undefined && num > 0 ? num : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function roundTo(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/** extractedAt 을 제외한 순수 관측 신호 */
interface ObservationSignals {
	cutDensitySec?: number;
	hookSec?: number;
	integratedLufs?: number;
	ttsSpeed?: number;
	captionsPerMin?: number;
	bgmMood?: string;
}

function hasAnySignal(signals: ObservationSignals): boolean {
	return (
		signals.cutDensitySec !== undefined ||
		signals.hookSec !== undefined ||
		signals.integratedLufs !== undefined ||
		signals.ttsSpeed !== undefined ||
		signals.captionsPerMin !== undefined ||
		signals.bgmMood !== undefined
	);
}

/**
 * 저장된 다이제스트 판독 — 필드 단위 가드로 오염 값은 제외.
 * 전 필드 무효(빈 다이제스트)면 undefined 를 돌려 production_dna 폴백을 허용.
 */
function readStoredObservation(
	raw: Record<string, unknown> | undefined,
): ObservationSignals | undefined {
	const stored = nestedRecord(raw, BENCHMARK_OBSERVATION_KEY);
	if (!stored) return undefined;
	const signals: ObservationSignals = {
		cutDensitySec: positiveFinite(stored.cutDensitySec),
		hookSec: positiveFinite(stored.hookSec),
		// LUFS 는 항상 음수 — 부호가 아니라 유한성만 가드
		integratedLufs: finiteNumber(stored.integratedLufs),
		ttsSpeed: positiveFinite(stored.ttsSpeed),
		captionsPerMin: positiveFinite(stored.captionsPerMin),
		bgmMood: nonEmptyString(stored.bgmMood),
	};
	return hasAnySignal(signals) ? signals : undefined;
}

/** production_dna 직접 파싱 — cutDensityPerMinute(컷/분) → 컷 간격(초) 환산 */
function deriveSignalsFromDna(
	raw: Record<string, unknown> | undefined,
): ObservationSignals {
	const dna = nestedRecord(raw, "production_dna");
	const camera = nestedRecord(dna, "camera");
	const audio = nestedRecord(dna, "audio");

	const cutsPerMinute = positiveFinite(camera?.cutDensityPerMinute);
	const cutDensitySec =
		cutsPerMinute !== undefined
			? roundTo(60 / cutsPerMinute, 2)
			: positiveFinite(camera?.avgCutIntervalSeconds);

	return {
		cutDensitySec,
		integratedLufs: finiteNumber(audio?.integratedLufs),
		ttsSpeed: positiveFinite(audio?.ttsSpeed),
		bgmMood: nonEmptyString(audio?.bgmMood),
		// captionsPerMin 은 production_dna 에 원천 신호가 없다 — 다이제스트 경유만
	};
}

/** raw_analysis.chapters(start_time 배열) — 2개 이상일 때만 평균 간격 추정 */
function chapterCadenceSec(
	raw: Record<string, unknown> | undefined,
	durationSec: number | undefined,
): number | undefined {
	if (durationSec === undefined) return undefined;
	const chapters = raw?.chapters;
	if (!Array.isArray(chapters)) return undefined;
	const valid = chapters.filter(
		(chapter) =>
			isRecord(chapter) && finiteNumber(chapter.start_time) !== undefined,
	);
	if (valid.length < 2) return undefined;
	return roundTo(durationSec / valid.length, 2);
}

/**
 * 템플릿 1개 → 벤치마크 샘플. 다이제스트 우선, 없으면 production_dna 파싱.
 * 핵심 필드(cutDensitySec 또는 hookSec) 1개 이상 없으면 null.
 * 길이 정책 위반(3-8분 갭, 20분 초과 등) 템플릿도 null — 포맷 배정 불가.
 */
export function extractBenchmarkSample(
	template: ReferenceTemplate,
	meta?: ReferenceSampleMeta,
): BenchmarkReferenceSample | null {
	const durationSec = positiveFinite(template.duration_seconds);
	const format = referenceFormatForDuration(durationSec ?? 0);
	if (format === "other") return null;

	const raw = isRecord(template.raw_analysis)
		? template.raw_analysis
		: undefined;
	const signals = readStoredObservation(raw) ?? deriveSignalsFromDna(raw);

	const cutDensitySec = signals.cutDensitySec;
	const hookSec = signals.hookSec ?? positiveFinite(template.hook_duration);
	if (cutDensitySec === undefined && hookSec === undefined) return null;

	const url = nonEmptyString(template.source_url);
	const views = positiveFinite(meta?.views);
	const channelSubs = positiveFinite(meta?.channelSubs);
	const bgmMood = signals.bgmMood ?? nonEmptyString(template.bgm_mood);
	const integratedLufs = signals.integratedLufs;
	const ttsSpeed = signals.ttsSpeed ?? positiveFinite(template.tts_speed);
	const captionsPerMin = signals.captionsPerMin;
	const chapterEverySec = chapterCadenceSec(raw, durationSec);
	const sceneCount = positiveFinite(template.scene_count);

	return {
		format,
		...(url !== undefined ? { url } : {}),
		...(views !== undefined ? { views } : {}),
		...(channelSubs !== undefined ? { channelSubs } : {}),
		...(cutDensitySec !== undefined ? { cutDensitySec } : {}),
		...(hookSec !== undefined ? { hookSec } : {}),
		...(bgmMood !== undefined ? { bgmMood } : {}),
		...(integratedLufs !== undefined ? { integratedLufs } : {}),
		...(ttsSpeed !== undefined ? { ttsSpeed } : {}),
		...(captionsPerMin !== undefined ? { captionsPerMin } : {}),
		...(chapterEverySec !== undefined ? { chapterEverySec } : {}),
		...(sceneCount !== undefined ? { sceneCount } : {}),
	};
}

/**
 * 템플릿 목록 → 요청 포맷의 학습용 샘플 목록.
 * 제외 규칙: 품질 grade C/D, 길이 정책 위반, 포맷 불일치, 핵심 필드 부재.
 */
export function collectBenchmarkSamples(
	templates: ReferenceTemplate[],
	format: BenchmarkFormat,
	metaByUrl?: Record<string, ReferenceSampleMeta>,
): BenchmarkReferenceSample[] {
	const samples: BenchmarkReferenceSample[] = [];
	for (const template of templates) {
		const quality = scoreReferenceQuality(template);
		if (quality.grade === "C" || quality.grade === "D") continue;
		const url = nonEmptyString(template.source_url);
		const meta = url !== undefined ? metaByUrl?.[url] : undefined;
		const sample = extractBenchmarkSample(template, meta);
		if (!sample || sample.format !== format) continue;
		samples.push(sample);
	}
	return samples;
}

/**
 * 분석 결과 → 저장 시점 관측치 다이제스트.
 * saveReferenceTemplate 직전 raw_analysis.benchmark_observation 으로 중첩한다.
 * 관측 신호가 하나도 없으면 null — 빈 다이제스트를 저장하지 않는다.
 */
export function buildBenchmarkObservation(
	result: BenchmarkObservationSource,
): BenchmarkObservation | null {
	const raw = isRecord(result.raw_analysis) ? result.raw_analysis : undefined;
	const dna = deriveSignalsFromDna(raw);

	const cutDensitySec = dna.cutDensitySec;
	const hookSec = positiveFinite(result.hook_duration);
	const integratedLufs = dna.integratedLufs;
	const ttsSpeed = dna.ttsSpeed ?? positiveFinite(result.tts_speed);
	const captionsPerMin = dna.captionsPerMin;
	const bgmMood = dna.bgmMood ?? nonEmptyString(result.bgm_mood);

	const signals: ObservationSignals = {
		cutDensitySec,
		hookSec,
		integratedLufs,
		ttsSpeed,
		captionsPerMin,
		bgmMood,
	};
	if (!hasAnySignal(signals)) return null;

	return {
		...(cutDensitySec !== undefined ? { cutDensitySec } : {}),
		...(hookSec !== undefined ? { hookSec } : {}),
		...(integratedLufs !== undefined ? { integratedLufs } : {}),
		...(ttsSpeed !== undefined ? { ttsSpeed } : {}),
		...(captionsPerMin !== undefined ? { captionsPerMin } : {}),
		...(bgmMood !== undefined ? { bgmMood } : {}),
		extractedAt: new Date().toISOString(),
	};
}
