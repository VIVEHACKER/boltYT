/**
 * 역사 시간여행 브이로그 채널 팩토리 — 호스트 + 시대 + 장르 + 듀얼언어를
 * 한 번에 묶어 "바로 제작 가능한 채널 계획"으로 만든다 (검증된 수익 포맷의 조립 라인).
 *
 * 재사용:
 *   - host-character: 고정 호스트(에피소드 간 동일 인물) — 키스톤
 *   - historical-vlog-format: 제목/썸네일/챕터/시대 공식
 *   - market-benchmark: historical_vlog 장르 바(컷 밀도/훅/챕터 등)
 *   - market-localization: KO→EN(또는 역) RPM 차익 듀얼언어 계획
 *   - channel-factory.assessBatchVariation: 양산형 슬롭(inauthentic) 위험 점수화
 *
 * 순수 모듈 — DOM/네트워크/DB 의존 없음. 결정론(현지화 RPM 수치는 레지스트리 고정값).
 */

import {
	assessBatchVariation,
	type BatchVariationReport,
} from "./channel-factory";
import {
	buildHistoricalChapters,
	buildHistoricalThumbnail,
	buildHistoricalTitle,
	type HistoricalChapter,
	type HistoricalEra,
	type HistoricalThumbnailPlan,
	resolveEra,
	suggestHistoricalEras,
	type VlogLocale,
} from "./historical-vlog-format";
import {
	buildHostIdentity,
	buildHostReferencePrompt,
	createStarterHost,
	type HostCharacter,
	type HostIdentity,
	type HostMediaLock,
	hostMediaLock,
} from "./host-character";
import {
	type BenchmarkFormat,
	type MarketBenchmark,
	resolveMarketBenchmark,
} from "./market-benchmark";
import { type LocalizationPlan, planLocalization } from "./market-localization";

export interface HistoricalVlogChannelInput {
	channelId: string;
	/** 고정 호스트. 미지정 시 스타터 호스트 자동 생성. */
	host?: HostCharacter;
	/** 시대 리스트(시대 id/라벨/객체). 비면 큐레이션 풀에서 자동 제안. */
	eras?: Array<string | HistoricalEra>;
	/** 내레이션 기본 언어 (기본 ko). 호스트 외형은 언어와 무관. */
	locale?: VlogLocale;
	/** 포맷 (기본 longform — 9~14분 광고 RPM). */
	format?: BenchmarkFormat;
	/** 듀얼언어 대상 시장. 미지정 시 반대 언어권 자동(ko→en-US, en→ko-KR). */
	targetLocales?: string[];
	/** 현지화 RPM 랭킹 소스 로케일. 미지정 시 locale 로부터 추론. */
	sourceLocale?: string;
	/** 다국어 오디오 트랙 권한 (없으면 별도 업로드 폴백). */
	hasMultiAudioAccess?: boolean;
}

export interface HistoricalVlogEpisodePlan {
	index: number;
	era: HistoricalEra;
	/** 기본 언어 제목 */
	title: string;
	/** 영어 제목 (듀얼언어 — 항상 동봉, 저비용) */
	titleEn: string;
	thumbnail: HistoricalThumbnailPlan;
	chapters: HistoricalChapter[];
	/**
	 * 미디어 생성에 넘길 호스트 잠금 — 모든 에피소드가 동일(동일 인물 보장).
	 * StepMedia 가 image-gen/video-gen 에 { referenceImagePath, seed } 로 전달.
	 */
	hostMediaLock: HostMediaLock;
	/** 씬 프롬프트 빌드 시 적용할 시대 id (POV/의상 주입용) */
	eraId: string;
	/** 현지화 계획 (targetLocales 있을 때) */
	localization: LocalizationPlan | null;
}

export interface HistoricalVlogChannelPlan {
	channelId: string;
	host: HostCharacter;
	hostIdentity: HostIdentity;
	/** 채널당 1회 호스트 레퍼런스 시트 생성 프롬프트 */
	hostReferencePrompt: string;
	/** historical_vlog × format 시장 바 */
	benchmark: MarketBenchmark;
	episodes: HistoricalVlogEpisodePlan[];
	/** 에피소드 주제 다양성(슬롭/inauthentic 위험) */
	variation: BatchVariationReport;
	/** 에피소드 수 + 모든 현지화 변형 수(추정 산출 영상 개수) */
	estimatedOutputs: number;
	summary: string;
	warnings: string[];
}

function defaultSourceLocale(locale: VlogLocale): string {
	return locale === "en" ? "en-US" : "ko-KR";
}

function defaultTargetLocales(locale: VlogLocale): string[] {
	// 듀얼: 반대 언어권 1개를 기본 타깃으로 (KO↔EN RPM 차익).
	return locale === "en" ? ["ko-KR"] : ["en-US"];
}

/** 채널 팩토리 — 입력 → 호스트 고정 + 시대별 에피소드 계획 + 다양성/현지화 합성. */
export function planHistoricalVlogChannel(
	input: HistoricalVlogChannelInput,
): HistoricalVlogChannelPlan {
	const locale: VlogLocale = input.locale ?? "ko";
	const format: BenchmarkFormat = input.format ?? "longform";
	const host = input.host ?? createStarterHost(input.channelId, locale);
	const hostIdentity = buildHostIdentity(host);
	const lock = hostMediaLock(hostIdentity);

	const benchmark = resolveMarketBenchmark({
		genre: "historical_vlog",
		format,
	});

	const rawEras =
		input.eras && input.eras.length > 0 ? input.eras : suggestHistoricalEras(4);
	const eras = rawEras.map((era) => resolveEra(era));

	const sourceLocale = input.sourceLocale ?? defaultSourceLocale(locale);
	const targetLocales = input.targetLocales ?? defaultTargetLocales(locale);
	const localization =
		targetLocales.length > 0
			? planLocalization({
					sourceLocale,
					format: format === "longform" ? "longform" : "shorts",
					targetLocales,
					hasMultiAudioAccess: input.hasMultiAudioAccess,
				})
			: null;

	const episodes: HistoricalVlogEpisodePlan[] = eras.map((era, index) => ({
		index,
		era,
		title: buildHistoricalTitle(era, locale),
		titleEn: buildHistoricalTitle(era, "en"),
		thumbnail: buildHistoricalThumbnail(era, locale),
		chapters: buildHistoricalChapters(era, locale),
		// 동일 호스트 잠금을 모든 에피소드에 부여 → 시리즈 일관성(키스톤).
		hostMediaLock: lock,
		eraId: era.id,
		localization,
	}));

	const variation = assessBatchVariation(
		episodes.map((ep) => ep.era.subjectKo),
	);

	const localizationVariantsPerEpisode = localization?.variants.length ?? 0;
	const estimatedOutputs =
		episodes.length * (1 + localizationVariantsPerEpisode);

	const warnings: string[] = [];
	if (episodes.length === 0) {
		warnings.push("시대가 없어 에피소드를 만들 수 없습니다.");
	}
	for (const w of variation.warnings) warnings.push(w);
	if (localization) {
		for (const w of localization.warnings) warnings.push(w);
	}
	if (benchmark.source === "builtin") {
		warnings.push(
			"시장 바가 내장 프리셋(콜드스타트)입니다. 레퍼런스 분석 샘플을 학습시키면 채널 맞춤 정밀도가 올라갑니다.",
		);
	}
	const dedupedWarnings = Array.from(new Set(warnings));

	const localizationNote =
		localizationVariantsPerEpisode > 0
			? ` × 현지화 ${localizationVariantsPerEpisode}개 = 약 ${estimatedOutputs}편`
			: "";
	const summary =
		episodes.length > 0
			? `호스트 "${host.name}" 고정 · ${episodes.length}개 시대(${format})${localizationNote} — 다양성 ${variation.score}/100(${variation.verdict}), 시장바 신뢰도 ${benchmark.confidence}`
			: "에피소드 없음.";

	return {
		channelId: input.channelId,
		host,
		hostIdentity,
		hostReferencePrompt: buildHostReferencePrompt(hostIdentity),
		benchmark,
		episodes,
		variation,
		estimatedOutputs,
		summary,
		warnings: dedupedWarnings,
	};
}
