/**
 * Channel factory — "반복 가능한 제작 공정"을 1개에서 N개로 확장하는 배치 계획 코어.
 *
 * 근거(리서치): 페이스리스 유튜브 수익의 핵심은 영상 하나를 잘 만드는 게 아니라
 * "계속 만들 수 있는 시스템"을 만드는 것. 다만 채널 30개로 월 1.5억 같은 주장은
 * 생존편향(수익화 ~3%)으로 반박됨 — 그래서 이 모듈은 "많이"가 아니라
 * "정책 안전하게 다양하게" 양산하는 데 초점을 둔다.
 *
 * YouTube inauthentic-content 정책(2025-07): "평균 시청자가 영상 간 차이를 분명히 알 수 있어야"
 * 한다. 같은 템플릿으로 거의 동일한 영상을 찍어내면 수익창출이 정지된다.
 * 이 모듈은 업로드를 막지 않는다(사용자 요청 제외 항목). 대신 *생성 시점*에
 * 배치 항목들이 서로 충분히 다른지 점수화해 양산형 슬롭 위험을 사전 경고한다.
 */

import type { ReferenceTemplate } from "../types/database";
import type {
	RecommendationFormat,
	RecommendationMode,
} from "./content-recommendation-ranker";
import { type LocalizationPlan, planLocalization } from "./market-localization";
import {
	buildReferenceProductionPlan,
	type ReferenceProductionPlan,
} from "./reference-production-orchestrator";

export interface ChannelFactoryBatchInput {
	/** 양산할 주제 리스트. 팩토리의 입력. */
	topics: string[];
	/** 고정 템플릿 — 모든 항목에 같은 "공정"을 적용(반복 가능성의 핵심). */
	template?: ReferenceTemplate | null;
	/** 템플릿 미지정 시 자동 선택에 쓰는 후보 풀. */
	candidates?: ReferenceTemplate[];
	format?: RecommendationFormat;
	mode?: RecommendationMode;
	/** 지정 시 각 항목에 대해 시장 현지화 계획도 함께 생성(기능 합성). */
	localization?: {
		sourceLocale: string;
		targetLocales: string[];
		hasMultiAudioAccess?: boolean;
	};
}

export type BatchVariationVerdict = "diverse" | "watch" | "templated_risk";

export interface BatchProductionItem {
	index: number;
	topicTitle: string;
	plan: ReferenceProductionPlan;
	localization: LocalizationPlan | null;
}

export interface BatchVariationReport {
	/** 0-100, 높을수록 항목 간 다양성이 큼(슬롭 위험 낮음). */
	score: number;
	verdict: BatchVariationVerdict;
	warnings: string[];
	/** 서로 너무 비슷한 항목 쌍(생성 단계에서 교체/재작성 권고). */
	similarPairs: Array<{
		a: number;
		b: number;
		similarity: number;
		reason: string;
	}>;
}

export interface ChannelFactoryBatchPlan {
	items: BatchProductionItem[];
	templateId: string | null;
	variation: BatchVariationReport;
	/** 항목 수 + 모든 현지화 변형 수(실제 산출 영상 개수 추정). */
	estimatedOutputs: number;
	summary: string;
	warnings: string[];
}

const VARIATION_STOPWORDS = new Set([
	"the",
	"a",
	"an",
	"of",
	"to",
	"and",
	"or",
	"in",
	"on",
	"for",
	"with",
	"그리고",
	"그러나",
	"하는",
	"대한",
	"위한",
	"에서",
	"으로",
	"이런",
	"저런",
	"그런",
	"무슨",
	"어떤",
]);

/** 한국어/영어 토큰화 — 2글자 이상, 불용어 제거. 배치 항목 간 유사도 계산용. */
function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.split(/\s+/)
			.filter((token) => token.length >= 2 && !VARIATION_STOPWORDS.has(token)),
	);
}

function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let intersection = 0;
	for (const token of a) {
		if (b.has(token)) intersection++;
	}
	const union = a.size + b.size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function clampScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * 배치 항목들이 서로 충분히 다른지 *주제(subject) 기준*으로 평가한다.
 * 같은 고정 템플릿을 쓰는 건 의도된 공정이므로 벌점이 아니다 — 템플릿이 만들어내는
 * 훅/대본 방향의 정형 문구는 모든 항목에 동일하게 들어가므로 유사도 신호에서 제외한다.
 * inauthentic-content 정책이 실제로 보는 건 "영상마다 다룬 내용이 다른가"이고, 그건 주제로 측정한다.
 */
export function assessBatchVariation(topics: string[]): BatchVariationReport {
	const warnings: string[] = [];
	const similarPairs: BatchVariationReport["similarPairs"] = [];

	if (topics.length <= 1) {
		return {
			score: 100,
			verdict: "diverse",
			warnings: topics.length === 0 ? ["배치에 주제가 없습니다."] : [],
			similarPairs: [],
		};
	}

	const tokenSets = topics.map((topic) => tokenize(topic));

	let pairCount = 0;
	let similaritySum = 0;
	let maxSimilarity = 0;
	for (let i = 0; i < topics.length; i++) {
		for (let j = i + 1; j < topics.length; j++) {
			const similarity = jaccard(tokenSets[i], tokenSets[j]);
			pairCount++;
			similaritySum += similarity;
			if (similarity > maxSimilarity) maxSimilarity = similarity;
			if (similarity >= 0.6) {
				similarPairs.push({
					a: i,
					b: j,
					similarity: Math.round(similarity * 100) / 100,
					reason: `${i + 1}번과 ${j + 1}번 항목의 주제가 너무 비슷함 — 평균 시청자가 차이를 구분하기 어려움`,
				});
			}
		}
	}

	const avgSimilarity = pairCount > 0 ? similaritySum / pairCount : 0;
	const score = clampScore(100 - avgSimilarity * 100);

	let verdict: BatchVariationVerdict;
	if (maxSimilarity >= 0.85) {
		verdict = "templated_risk";
		warnings.push(
			"거의 중복인 항목이 있어 inauthentic-content(양산형) 위험이 큽니다. 해당 주제를 교체하거나 각도를 바꾸세요.",
		);
	} else if (score < 70 || similarPairs.length > 0) {
		verdict = "watch";
		warnings.push(
			"항목 간 차별성이 낮습니다. 같은 템플릿이라도 주제·훅·대본 방향이 분명히 달라야 합니다.",
		);
	} else {
		verdict = "diverse";
	}

	return { score, verdict, warnings, similarPairs };
}

/**
 * 채널 팩토리 배치 계획. 주제 리스트를 고정 템플릿에 통과시켜 항목별 제작 계획을 만들고,
 * (옵션) 시장 현지화 계획을 합성한 뒤, 생성 단계 다양성을 점수화한다.
 */
export function planChannelFactoryBatch(
	input: ChannelFactoryBatchInput,
): ChannelFactoryBatchPlan {
	const cleanTopics = input.topics
		.map((topic) => topic.replace(/\s+/g, " ").trim())
		.filter((topic) => topic.length > 0);

	const format = input.format ?? "shorts";
	const items: BatchProductionItem[] = cleanTopics.map((topicTitle, index) => {
		const plan = buildReferenceProductionPlan({
			topicTitle,
			mode: input.mode,
			selectedFormat: format,
			referenceTemplate: input.template ?? null,
			referenceCandidates: input.candidates,
		});
		const localization = input.localization
			? planLocalization({
					sourceLocale: input.localization.sourceLocale,
					format,
					targetLocales: input.localization.targetLocales,
					hasMultiAudioAccess: input.localization.hasMultiAudioAccess,
				})
			: null;
		return { index, topicTitle, plan, localization };
	});

	const variation = assessBatchVariation(items.map((item) => item.topicTitle));

	const localizationOutputs = items.reduce(
		(sum, item) => sum + (item.localization?.variants.length ?? 0),
		0,
	);
	const estimatedOutputs = items.length + localizationOutputs;

	const templateId =
		input.template?.id ?? items[0]?.plan.selectedTemplate?.id ?? null;

	const warnings: string[] = [];
	if (items.length === 0) {
		warnings.push("유효한 주제가 없어 배치를 만들 수 없습니다.");
	}
	if (cleanTopics.length !== input.topics.length) {
		warnings.push("빈 주제 항목이 제거되었습니다.");
	}

	const localizationNote =
		localizationOutputs > 0 ? ` + 현지화 변형 ${localizationOutputs}개` : "";
	const summary =
		items.length > 0
			? `${items.length}개 주제 배치(${format})${localizationNote} — 다양성 ${variation.score}/100(${variation.verdict})`
			: "배치 항목 없음.";

	return {
		items,
		templateId,
		variation,
		estimatedOutputs,
		summary,
		warnings,
	};
}
