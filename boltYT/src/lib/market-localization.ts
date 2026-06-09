/**
 * Market localization engine — 같은 콘텐츠를 고RPM 시장으로 현지화해 수익을 끌어올리는 계획 코어.
 *
 * 근거(2025-2026 리서치): YouTube 광고 수익은 "시청자 국가 × 포맷"이 결정한다(제작자 국가 무관).
 * 시중에 도는 "일본이 한국의 2.6배" 주장은 실측 데이터로 반박됨 — 실제 일본/한국 CPM 비는 ~1.17배다.
 * 진짜 차익은 영어권(미/영/호, 한국 대비 2.4~4.1배). 그래서 이 모듈은 일본이 아니라
 * 영어권 우선순위를 기본값으로 인코딩한다.
 *
 * 비용 효율의 핵심: 영상(visual_prompt)은 언어 중립이라 재생성하지 않는다.
 * 대본/나레이션/자막/제목/썸네일 텍스트만 번역하고 TTS만 새 언어로 다시 뽑으면,
 * "같은 영상, 다른 시장" 차익을 최소 비용으로 얻는다.
 *
 * 데이터·LLM 의존성을 분리한다: 이 모듈은 순수 계획/추출/병합만 담당하고,
 * 실제 번역 LLM 호출은 ai.ts(localizeScriptContent)가 이 모듈의 extract/merge를 사용한다.
 */

export type MarketTier = "tier1" | "tier2" | "tier3";

export interface MarketProfile {
	/** BCP-47 로케일 (예: "en-US") */
	locale: string;
	/** 언어 베이스 (예: "en") — TTS/자막 언어 선택용 */
	language: string;
	/** 한국어 표시 라벨 */
	label: string;
	tier: MarketTier;
	/**
	 * 대한민국 = 1.0 기준 상대 RPM. 시청자 국가 기반 실측 CPM(IsThisChannelMonetized 2024,
	 * digitalinformationworld 2025)을 한국 CPM(~$2.91)으로 나눈 보수적 추정치.
	 */
	relativeRpm: number;
	note: string;
}

/**
 * 시장 레지스트리. 상대 RPM은 보수적으로 잡았다(블로그 표는 과장이 심해 median CPM만 채택).
 * tier1: 상대 RPM ≥ 2.0(영어권/북유럽), tier2: 1.0~2.0(일/한 등 중위), tier3: < 1.0(저단가).
 */
export const MARKET_PROFILES: Record<string, MarketProfile> = {
	"en-US": {
		locale: "en-US",
		language: "en",
		label: "미국(영어)",
		tier: "tier1",
		relativeRpm: 4.1,
		note: "최고 단가. 영어권 현지화 1순위.",
	},
	"en-AU": {
		locale: "en-AU",
		language: "en",
		label: "호주(영어)",
		tier: "tier1",
		relativeRpm: 2.9,
		note: "고단가 영어권. 미국 다음.",
	},
	"en-CA": {
		locale: "en-CA",
		language: "en",
		label: "캐나다(영어)",
		tier: "tier1",
		relativeRpm: 2.7,
		note: "고단가 영어권.",
	},
	"nb-NO": {
		locale: "nb-NO",
		language: "nb",
		label: "노르웨이",
		tier: "tier1",
		relativeRpm: 2.5,
		note: "북유럽 고단가, 시장 규모 작음.",
	},
	"en-GB": {
		locale: "en-GB",
		language: "en",
		label: "영국(영어)",
		tier: "tier1",
		relativeRpm: 2.4,
		note: "고단가 영어권.",
	},
	"de-DE": {
		locale: "de-DE",
		language: "de",
		label: "독일",
		tier: "tier1",
		relativeRpm: 2.0,
		note: "고단가, 비영어 더빙 필요.",
	},
	"ja-JP": {
		locale: "ja-JP",
		language: "ja",
		label: "일본",
		tier: "tier2",
		relativeRpm: 1.17,
		note: "한국 대비 ~1.2배뿐. 장르 근접성 있을 때만.",
	},
	"ko-KR": {
		locale: "ko-KR",
		language: "ko",
		label: "대한민국",
		tier: "tier2",
		relativeRpm: 1.0,
		note: "기준 시장.",
	},
	"es-ES": {
		locale: "es-ES",
		language: "es",
		label: "스페인",
		tier: "tier3",
		relativeRpm: 0.7,
		note: "중하위 단가.",
	},
	"pt-BR": {
		locale: "pt-BR",
		language: "pt",
		label: "브라질",
		tier: "tier3",
		relativeRpm: 0.46,
		note: "저단가, 대량 트래픽 시장.",
	},
	"hi-IN": {
		locale: "hi-IN",
		language: "hi",
		label: "인도",
		tier: "tier3",
		relativeRpm: 0.33,
		note: "최저단가, 조회수는 큼.",
	},
};

const DEFAULT_LOCALE_BY_LANGUAGE: Record<string, string> = {
	en: "en-US",
	ja: "ja-JP",
	ko: "ko-KR",
	de: "de-DE",
	es: "es-ES",
	pt: "pt-BR",
	hi: "hi-IN",
	nb: "nb-NO",
};

/**
 * 로케일 → 프로필. 정확히 일치하지 않으면 언어 베이스로 폴백("en" → "en-US").
 */
export function getMarketProfile(locale: string): MarketProfile | null {
	if (!locale) return null;
	const normalized = locale.trim();
	if (MARKET_PROFILES[normalized]) return MARKET_PROFILES[normalized];
	const base = normalized.split(/[-_]/)[0]?.toLowerCase();
	if (base) {
		const fallback = DEFAULT_LOCALE_BY_LANGUAGE[base];
		if (fallback && MARKET_PROFILES[fallback]) return MARKET_PROFILES[fallback];
		// 같은 언어 베이스를 가진 첫 프로필
		const byLanguage = Object.values(MARKET_PROFILES).find(
			(profile) => profile.language === base,
		);
		if (byLanguage) return byLanguage;
	}
	return null;
}

export interface RankedMarket {
	profile: MarketProfile;
	/** 소스 시장 대비 기대 RPM 배수 (target.relativeRpm / source.relativeRpm) */
	expectedRpmLift: number;
	recommendation: "prioritize" | "consider" | "skip";
	rationale: string;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * 후보 시장을 기대 RPM 배수 내림차순으로 정렬. 소스와 같은 언어는 제외(번역 불필요).
 * 영어권이 자연히 위로 오고, 일본은 lift가 작아 "consider", 저단가는 "skip"으로 분류된다.
 */
export function rankMarketsByRoi(
	sourceLocale: string,
	targetLocales: string[],
): RankedMarket[] {
	const source = getMarketProfile(sourceLocale);
	const sourceRpm = source?.relativeRpm ?? 1.0;
	const sourceLanguage = source?.language ?? sourceLocale.split(/[-_]/)[0];
	const seen = new Set<string>();
	const ranked: RankedMarket[] = [];
	for (const locale of targetLocales) {
		const profile = getMarketProfile(locale);
		if (!profile) continue;
		if (seen.has(profile.locale)) continue;
		seen.add(profile.locale);
		if (profile.language === sourceLanguage) continue;
		const expectedRpmLift = round2(profile.relativeRpm / sourceRpm);
		let recommendation: RankedMarket["recommendation"];
		let rationale: string;
		if (expectedRpmLift >= 1.8) {
			recommendation = "prioritize";
			rationale = `${profile.label} 기대 RPM ${expectedRpmLift}배 — 현지화 우선순위 높음`;
		} else if (expectedRpmLift >= 1.15) {
			recommendation = "consider";
			rationale = `${profile.label} 기대 RPM ${expectedRpmLift}배 — 장르/언어 근접성 있을 때만 진행`;
		} else {
			recommendation = "skip";
			rationale = `${profile.label} 기대 RPM ${expectedRpmLift}배 — 현지화 비용 대비 이득 낮음`;
		}
		ranked.push({ profile, expectedRpmLift, recommendation, rationale });
	}
	return ranked.sort((a, b) => b.expectedRpmLift - a.expectedRpmLift);
}

export type LocalizationDeliveryMode = "multi_audio_track" | "separate_upload";

export interface LocalizedVariantSpec {
	locale: string;
	language: string;
	label: string;
	expectedRpmLift: number;
	deliveryMode: LocalizationDeliveryMode;
	/** 어떤 산출물을 새로 만들어야 하는가. visuals=false 가 비용 효율의 핵심. */
	assetsToRegenerate: {
		script: boolean;
		tts: boolean;
		subtitles: boolean;
		title: boolean;
		description: boolean;
		thumbnailText: boolean;
		visuals: boolean;
	};
	warnings: string[];
}

export interface LocalizationPlanInput {
	sourceLocale: string;
	format: "shorts" | "longform" | "both";
	targetLocales: string[];
	/**
	 * 다국어 오디오 트랙 접근 권한. 2025-09 전 크리에이터 개방됐지만 신규/저권한 채널은
	 * 아직 미보유일 수 있다. 없으면 별도 채널 업로드로 폴백.
	 */
	hasMultiAudioAccess?: boolean;
}

export interface LocalizationPlan {
	sourceLocale: string;
	variants: LocalizedVariantSpec[];
	skipped: Array<{ locale: string; reason: string }>;
	summary: string;
	warnings: string[];
}

/**
 * 시장 현지화 계획. 영상은 재사용(visuals=false)하고 텍스트/오디오만 현지화한다.
 * shorts 포맷에는 "Shorts 풀은 시청자 국가별 배분이라 더빙만으로는 RPM이 안 오른다"는
 * 리서치 경고를 반드시 붙인다(언어 트랙이 아니라 시청자 도달이 RPM을 결정).
 */
export function planLocalization(
	input: LocalizationPlanInput,
): LocalizationPlan {
	const ranked = rankMarketsByRoi(input.sourceLocale, input.targetLocales);
	const variants: LocalizedVariantSpec[] = [];
	const skipped: Array<{ locale: string; reason: string }> = [];
	const includesShorts = input.format === "shorts" || input.format === "both";
	const hasMultiAudio = input.hasMultiAudioAccess ?? false;

	// 입력에는 있지만 프로필이 없거나 같은 언어라 랭킹에서 빠진 로케일을 skipped 로 기록
	const rankedLocales = new Set(ranked.map((item) => item.profile.locale));
	const source = getMarketProfile(input.sourceLocale);
	for (const locale of input.targetLocales) {
		const profile = getMarketProfile(locale);
		if (!profile) {
			skipped.push({ locale, reason: "알 수 없는 시장(레지스트리에 없음)" });
			continue;
		}
		if (
			source &&
			profile.language === source.language &&
			!rankedLocales.has(profile.locale)
		) {
			skipped.push({ locale, reason: "소스와 같은 언어 — 현지화 불필요" });
		}
	}

	for (const market of ranked) {
		if (market.recommendation === "skip") {
			skipped.push({
				locale: market.profile.locale,
				reason: market.rationale,
			});
			continue;
		}
		const warnings: string[] = [];
		const deliveryMode: LocalizationDeliveryMode = hasMultiAudio
			? "multi_audio_track"
			: "separate_upload";
		if (!hasMultiAudio) {
			warnings.push(
				"다국어 오디오 트랙 권한이 없어 별도 채널/업로드로 폴백. 권한 확보 시 같은 채널 트랙으로 전환 권장.",
			);
		}
		if (includesShorts) {
			warnings.push(
				"Shorts 수익은 시청자 국가별 공동 풀에서 배분됨 — 오디오 더빙만으로는 RPM이 오르지 않는다. 실제 고RPM 국가 시청자에게 도달해야 효과가 난다(현지 제목/썸네일/해시태그 필수).",
			);
		}
		if (market.recommendation === "consider") {
			warnings.push(market.rationale);
		}
		variants.push({
			locale: market.profile.locale,
			language: market.profile.language,
			label: market.profile.label,
			expectedRpmLift: market.expectedRpmLift,
			deliveryMode,
			assetsToRegenerate: {
				script: true,
				tts: true,
				subtitles: true,
				title: true,
				description: true,
				thumbnailText: true,
				visuals: false,
			},
			warnings,
		});
	}

	const planWarnings: string[] = [];
	if (variants.length === 0) {
		planWarnings.push(
			"현지화 가치가 있는 대상 시장이 없음 — 영어권(en-US/en-GB/en-AU) 같은 고RPM 시장을 타깃으로 추가하세요.",
		);
	}
	const topLift = variants[0]?.expectedRpmLift ?? 0;
	const summary =
		variants.length > 0
			? `${variants.length}개 시장 현지화 계획 — 최대 기대 RPM ${topLift}배(${variants[0].label}). 영상은 재사용하고 대본/TTS/자막/제목/썸네일만 현지화.`
			: "현지화 대상 시장 없음.";

	return {
		sourceLocale: input.sourceLocale,
		variants,
		skipped,
		summary,
		warnings: planWarnings,
	};
}

/**
 * 대본 콘텐츠(content_json)에서 번역 대상 텍스트만 뽑아낸다.
 * visual_prompt 는 언어 중립(영문 비주얼 묘사)이라 제외 — 영상 재사용의 핵심.
 */
export interface TranslatableFields {
	title?: string;
	shortsScript?: string;
	thumbnailText?: string;
	hooks: string[];
	/** longform_scenes 와 인덱스 정합 — 병합 시 같은 순서로 되돌린다. */
	sceneNarrations: string[];
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

export function extractTranslatableFields(
	content: Record<string, unknown>,
): TranslatableFields {
	const scenes = Array.isArray(content.longform_scenes)
		? (content.longform_scenes as Array<Record<string, unknown>>)
		: [];
	return {
		title: asString(content.title),
		shortsScript: asString(content.shorts_script),
		thumbnailText: asString(content.thumbnail_text),
		hooks: asStringArray(content.shorts_hooks),
		sceneNarrations: scenes.map((scene) => asString(scene?.narration) ?? ""),
	};
}

/**
 * 번역된 필드를 원본 콘텐츠 구조에 다시 끼워 넣는다.
 * 씬 나레이션은 인덱스로 매핑하고 visual_prompt/duration/mood 등은 보존한다.
 * 입력을 변형하지 않고 새 객체를 반환한다.
 */
export function mergeTranslatedFields(
	content: Record<string, unknown>,
	translated: TranslatableFields,
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...content };
	if (translated.title !== undefined) next.title = translated.title;
	if (translated.shortsScript !== undefined)
		next.shorts_script = translated.shortsScript;
	if (translated.thumbnailText !== undefined)
		next.thumbnail_text = translated.thumbnailText;
	if (translated.hooks.length > 0) next.shorts_hooks = [...translated.hooks];
	if (Array.isArray(content.longform_scenes)) {
		const scenes = content.longform_scenes as Array<Record<string, unknown>>;
		next.longform_scenes = scenes.map((scene, index) => {
			const narration = translated.sceneNarrations[index];
			if (narration === undefined || narration === "") return { ...scene };
			return { ...scene, narration };
		});
	}
	return next;
}
