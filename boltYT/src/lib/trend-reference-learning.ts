import type { ReferenceTemplate } from "../types/database";
import { formatCompactNumber, formatDuration } from "./niche-research";
import type {
	ChannelStrategyPlan,
	RankedChannelStrategy,
} from "./channel-strategy-ranker";
import type {
	AnalysisJobResult,
	ReferenceAnalysisMode,
} from "./reference-import";
import {
	buildReferenceTemplateName,
	type ReferenceChannelCandidate,
} from "./reference-channel-scout";
import type { TrendCluster } from "./youtube-domain-intelligence";

export type TrendReferenceTargetKind = "video" | "style";
export type TrendReferencePriority = "separate_reference" | "style_watchlist";

export interface TrendReferenceTarget {
	id: string;
	kind: TrendReferenceTargetKind;
	categoryId: string;
	label: string;
	score: number;
	priority: TrendReferencePriority;
	suggestedMode: ReferenceAnalysisMode;
	sourceUrl?: string;
	sourceTitle?: string;
	sourceCreator?: string;
	importName?: string;
	evidence: string[];
	styleSignals: string[];
	learningDirectives: string[];
	safeTransformRules: string[];
	expectedQualityLift: string;
}

export interface TrendReferenceLearningPlan {
	generatedAt: string;
	sourceTemplateId: string;
	targetCount: number;
	videoTargets: TrendReferenceTarget[];
	styleTargets: TrendReferenceTarget[];
	autoReferencePolicy: string[];
	learningRules: string[];
	qualityLiftSummary: string;
}

export interface TrendReferenceLearningMetadata {
	version: 1;
	discoveredAt: string;
	source: "trend-reference-scout" | "trend-reference-import";
	targetKind: TrendReferenceTargetKind;
	categoryId?: string;
	categoryLabel?: string;
	candidateId?: string;
	score?: number;
	label: string;
	representativeUrl: string;
	sourceQueries: string[];
	evidence: string[];
	styleSignals: string[];
	learningDirectives: string[];
	safeTransformRules: string[];
	copyBoundary: {
		rawAssetsReusable: false;
		musicReusable: false;
		transcriptReusable: false;
		reason: string;
	};
}

const MIN_VIDEO_TARGET_SCORE = 82;
const MIN_STYLE_TARGET_SCORE = 86;

export function buildTrendReferenceLearningPlan(input: {
	template: ReferenceTemplate;
	strategyPlan: ChannelStrategyPlan;
	candidatesByCategory: Record<string, ReferenceChannelCandidate[] | undefined>;
	now?: Date;
	maxVideoTargets?: number;
	maxStyleTargets?: number;
}): TrendReferenceLearningPlan {
	const rankingsByCategory = new Map(
		input.strategyPlan.rankings.map((ranking) => [ranking.categoryId, ranking]),
	);
	const videoTargets = Object.values(input.candidatesByCategory)
		.flatMap((candidates) => candidates ?? [])
		.map((candidate) =>
			videoTargetFromCandidate(candidate, rankingsByCategory.get(candidate.categoryId)),
		)
		.filter((target) => target.score >= MIN_VIDEO_TARGET_SCORE)
		.sort((a, b) => b.score - a.score)
		.filter(uniqueTargetBySource)
		.slice(0, input.maxVideoTargets ?? 6);

	const styleTargets = input.strategyPlan.rankings
		.flatMap((ranking) =>
			ranking.trendClusters.map((cluster) => styleTargetFromCluster(ranking, cluster)),
		)
		.filter((target) => target.score >= MIN_STYLE_TARGET_SCORE)
		.sort((a, b) => b.score - a.score)
		.slice(0, input.maxStyleTargets ?? 4);

	const targetCount = videoTargets.length + styleTargets.length;
	return {
		generatedAt: (input.now ?? new Date()).toISOString(),
		sourceTemplateId: input.template.id,
		targetCount,
		videoTargets,
		styleTargets,
		autoReferencePolicy: [
			"트렌드 영상이 감지되면 기존 템플릿에 섞지 않고 별도 deep 레퍼런스로 저장한다.",
			"원본 영상, 원본 BGM, 원문 대사는 재사용하지 않고 편집 문법만 학습한다.",
			"학습 결과는 raw_analysis.trend_reference_learning에 남겨 다음 생성의 명시지/암묵지로 반영한다.",
		],
		learningRules: [
			"실측 영상은 컷 밀도, 첫 화면 변화, 자료 배치, BGM 에너지, 자막 안전영역을 추출한다.",
			"스타일 신호는 바로 복제하지 않고 후보 검색 쿼리와 제작 규칙으로 전환한다.",
			"고위험 밈/이슈 스타일은 반복 양산 대신 해설, 맥락, 출처 카드로 변환한다.",
		],
		qualityLiftSummary:
			targetCount > 0
				? `${videoTargets.length}개 트렌드 영상과 ${styleTargets.length}개 스타일 신호를 별도 레퍼런스/학습 대상으로 분리했습니다.`
				: "아직 별도 레퍼런스로 승격할 만큼 강한 실측 트렌드가 없습니다.",
	};
}

export function attachTrendReferenceLearningToAnalysisResult(
	result: AnalysisJobResult,
	candidate: ReferenceChannelCandidate,
	ranking?: RankedChannelStrategy,
	now = new Date(),
): AnalysisJobResult {
	const metadata = buildTrendReferenceLearningMetadata(candidate, ranking, now);
	return attachTrendMetadata(result, metadata);
}

export function attachTrendReferenceSeedToAnalysisResult(
	result: AnalysisJobResult,
	seed: {
		label: string;
		sourceUrl: string;
		categoryId?: string;
		evidence?: string[];
		styleSignals?: string[];
	},
	now = new Date(),
): AnalysisJobResult {
	const metadata: TrendReferenceLearningMetadata = {
		version: 1,
		discoveredAt: now.toISOString(),
		source: "trend-reference-import",
		targetKind: "video",
		categoryId: seed.categoryId,
		label: seed.label,
		representativeUrl: seed.sourceUrl,
		sourceQueries: [],
		evidence: seed.evidence ?? ["상세 화면 트렌드 학습 큐에서 수동 레퍼런스 진행"],
		styleSignals: seed.styleSignals ?? [],
		learningDirectives: defaultLearningDirectives("수동 트렌드 레퍼런스"),
		safeTransformRules: defaultSafeTransformRules(),
		copyBoundary: trendCopyBoundary(),
	};
	return attachTrendMetadata(result, metadata);
}

export function buildTrendReferenceLearningMetadata(
	candidate: ReferenceChannelCandidate,
	ranking?: RankedChannelStrategy,
	now = new Date(),
): TrendReferenceLearningMetadata {
	const target = videoTargetFromCandidate(candidate, ranking);
	return {
		version: 1,
		discoveredAt: now.toISOString(),
		source: "trend-reference-scout",
		targetKind: "video",
		categoryId: candidate.categoryId,
		categoryLabel: candidate.categoryLabel,
		candidateId: candidate.id,
		score: target.score,
		label: target.label,
		representativeUrl: candidate.representativeUrl,
		sourceQueries: candidate.sourceQueries,
		evidence: target.evidence,
		styleSignals: target.styleSignals,
		learningDirectives: target.learningDirectives,
		safeTransformRules: target.safeTransformRules,
		copyBoundary: trendCopyBoundary(),
	};
}

function videoTargetFromCandidate(
	candidate: ReferenceChannelCandidate,
	ranking?: RankedChannelStrategy,
): TrendReferenceTarget {
	const score = scoreVideoTarget(candidate, ranking);
	const trendSignals = ranking?.trendClusters
		.flatMap((cluster) => [
			`${cluster.label} S${cluster.score}`,
			...cluster.signals.slice(0, 2),
		])
		.slice(0, 5) ?? [];
	return {
		id: `trend-video:${candidate.categoryId}:${candidate.representativeVideo.videoId}`,
		kind: "video",
		categoryId: candidate.categoryId,
		label: candidate.representativeVideo.title || candidate.channelTitle,
		score,
		priority: "separate_reference",
		suggestedMode: "deep",
		sourceUrl: candidate.representativeUrl,
		sourceTitle: candidate.representativeVideo.title,
		sourceCreator: candidate.channelTitle,
		importName: buildReferenceTemplateName(candidate),
		evidence: [
			`${candidate.categoryLabel} 후보 S${candidate.score}`,
			`대표 영상 ${formatCompactNumber(candidate.representativeVideo.viewCount)} · 일평균 ${formatCompactNumber(
				candidate.avgViewsPerDay,
			)}/일`,
			`길이 ${formatDuration(candidate.representativeVideo.durationSeconds)} · 추천 ${candidate.suggestedMode}`,
			`소스 쿼리: ${candidate.sourceQueries.slice(0, 2).join(" / ")}`,
		],
		styleSignals: [
			...trendSignals,
			`채널 내 후보 영상 ${candidate.videoCount}개`,
			`롱폼 비중 ${Math.round(candidate.longformShare * 100)}%`,
		],
		learningDirectives: defaultLearningDirectives(candidate.channelTitle),
		safeTransformRules: defaultSafeTransformRules(),
		expectedQualityLift:
			"실측 트렌드 영상의 컷 호흡, 화면 전환, 자막/썸네일 배치, BGM 에너지 암묵지를 보강합니다.",
	};
}

function styleTargetFromCluster(
	ranking: RankedChannelStrategy,
	cluster: TrendCluster,
): TrendReferenceTarget {
	return {
		id: `trend-style:${ranking.categoryId}:${cluster.id}`,
		kind: "style",
		categoryId: ranking.categoryId,
		label: `${ranking.label} · ${cluster.label}`,
		score: Math.round(cluster.score * 0.72 + ranking.score * 0.28),
		priority: "style_watchlist",
		suggestedMode: ranking.recommendedFormat === "shorts" ? "shortform" : "deep",
		evidence: [
			`${cluster.source} · S${cluster.score}`,
			`예시: ${cluster.examples.slice(0, 3).join(" / ")}`,
			`추천 포맷: ${cluster.bestFormats.join(" + ")}`,
		],
		styleSignals: [...cluster.signals, ...cluster.recommendedAngles].slice(0, 5),
		learningDirectives: defaultLearningDirectives(cluster.label),
		safeTransformRules: defaultSafeTransformRules(),
		expectedQualityLift:
			"URL이 없는 스타일 신호를 후보 검색 쿼리와 편집 규칙으로 바꿔 다음 스카우트 품질을 높입니다.",
	};
}

function scoreVideoTarget(
	candidate: ReferenceChannelCandidate,
	ranking?: RankedChannelStrategy,
): number {
	const rankingScore = ranking?.score ?? 70;
	const trendScore = ranking?.trendClusters[0]?.score ?? 70;
	const velocityBonus = Math.min(12, Math.log10(candidate.avgViewsPerDay + 1) * 2);
	return Math.round(
		Math.min(
			100,
			candidate.score * 0.43 +
				candidate.representativeVideo.score * 0.25 +
				rankingScore * 0.16 +
				trendScore * 0.1 +
				velocityBonus,
		),
	);
}

function defaultLearningDirectives(label: string): string[] {
	return [
		`${label}는 별도 deep 레퍼런스로 분석해 기존 템플릿과 섞지 않는다.`,
		"첫 10초 컷 변화, 제목 회수 방식, 자막 안전영역, BGM 에너지 곡선을 추출한다.",
		"분석 결과는 다음 콘텐츠 생성 시 명시지/암묵지로만 적용하고 원본 자산은 재사용하지 않는다.",
	];
}

function defaultSafeTransformRules(): string[] {
	return [
		"원본 영상 장면, 원문 대사, 원본 음악을 그대로 가져오지 않는다.",
		"스타일은 컷 리듬, 구도, 정보 밀도, 썸네일 역할 분리로만 변환한다.",
		"고위험 소재는 사실/의견/추정과 출처 앵커를 분리한다.",
	];
}

function trendCopyBoundary(): TrendReferenceLearningMetadata["copyBoundary"] {
	return {
		rawAssetsReusable: false,
		musicReusable: false,
		transcriptReusable: false,
		reason: "트렌드 레퍼런스는 편집 문법과 스타일 암묵지만 학습하고 원본 자산은 복제하지 않습니다.",
	};
}

function attachTrendMetadata(
	result: AnalysisJobResult,
	metadata: TrendReferenceLearningMetadata,
): AnalysisJobResult {
	const raw = result.raw_analysis ?? {};
	const existingMethod = isRecord(raw.production_method)
		? raw.production_method
		: {};
	const existingRules = Array.isArray(existingMethod.rules)
		? existingMethod.rules.filter((rule): rule is string => typeof rule === "string")
		: [];
	return {
		...result,
		raw_analysis: {
			...raw,
			trend_reference_learning: metadata,
			copy_boundary: {
				...(isRecord(raw.copy_boundary) ? raw.copy_boundary : {}),
				rawAssetsReusable: false,
				originalAssetsReusable: false,
				musicReusable: false,
				transcriptReusable: false,
			},
			production_method: {
				...existingMethod,
				rules: [
					...existingRules,
					...metadata.learningDirectives,
					...metadata.safeTransformRules,
				].slice(0, 16),
			},
		},
	};
}

function uniqueTargetBySource(
	target: TrendReferenceTarget,
	index: number,
	targets: TrendReferenceTarget[],
): boolean {
	if (!target.sourceUrl) return true;
	return targets.findIndex((item) => item.sourceUrl === target.sourceUrl) === index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
