import type { ReferenceTemplate } from "../types/database";
import { formatCompactNumber, formatDuration } from "./niche-research";
import {
	REFERENCE_CHANNEL_CATEGORIES,
	type ReferenceChannelCandidate,
} from "./reference-channel-scout";
import { getReferenceTemplateRecommendedMode } from "./reference-template-presets";
import { inferCategoryProfile } from "./reference-topic-planner";
import {
	getYouTubeDomainIntelligence,
	type DomainFormat,
	type TrendCluster,
} from "./youtube-domain-intelligence";

export type ChannelStrategyConfidence = "live" | "modeled" | "fallback";

export interface ChannelNameCandidate {
	name: string;
	score: number;
	tokens: string[];
	rationale: string;
}

export interface ChannelScoreFactor {
	key: "live" | "trend" | "policy" | "template" | "format";
	label: string;
	score: number;
	weight: number;
	evidence: string;
}

export interface ChannelEvidenceSource {
	label: string;
	url: string;
	kind: "official" | "live_api" | "internal";
	usedFor: string;
}

export interface RankedChannelStrategy {
	rank: number;
	categoryId: string;
	label: string;
	description: string;
	score: number;
	confidence: ChannelStrategyConfidence;
	recommendedFormat: "shorts" | "longform" | "hybrid";
	channelConcept: string;
	firstContentPillar: string;
	nameCandidates: ChannelNameCandidate[];
	scoreFactors: ChannelScoreFactor[];
	trendClusters: TrendCluster[];
	liveCandidateCount: number;
	liveEvidence: string[];
	dataBasis: string[];
	evidenceSources: ChannelEvidenceSource[];
	riskControls: string[];
	pilotPlan: string[];
}

export interface ChannelStrategyPlan {
	generatedAt: string;
	currentTemplateCategory: string;
	weights: Array<{
		key: ChannelScoreFactor["key"];
		label: string;
		liveWeight: number;
		fallbackWeight: number;
	}>;
	rankings: RankedChannelStrategy[];
	sourceNotes: string[];
	evidenceSources: ChannelEvidenceSource[];
}

export const CHANNEL_STRATEGY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface ChannelBlueprint {
	categoryId: string;
	domainCategoryId: string;
	templateProfileId: string;
	format: "shorts" | "longform" | "hybrid";
	concept: string;
	firstContentPillar: string;
	nameTokens: string[];
	riskControls: string[];
	pilotPlan: string[];
}

const SCORE_WEIGHTS = [
	{
		key: "live" as const,
		label: "실측 후보 채널 성과",
		liveWeight: 0.36,
		fallbackWeight: 0,
	},
	{
		key: "trend" as const,
		label: "공개 트렌드 적합도",
		liveWeight: 0.24,
		fallbackWeight: 0.38,
	},
	{
		key: "policy" as const,
		label: "정책/반복양산 안전성",
		liveWeight: 0.16,
		fallbackWeight: 0.24,
	},
	{
		key: "template" as const,
		label: "현재 레퍼런스 제작 적합도",
		liveWeight: 0.14,
		fallbackWeight: 0.2,
	},
	{
		key: "format" as const,
		label: "쇼츠/롱폼 포맷 적합도",
		liveWeight: 0.1,
		fallbackWeight: 0.18,
	},
];

const BLUEPRINTS: ChannelBlueprint[] = [
	{
		categoryId: "drama_recap",
		domainCategoryId: "drama_recap",
		templateProfileId: "drama_recap",
		format: "longform",
		concept: "드라마/영화 장면을 복선, 선택, 결말 회수 관점으로 재구성하는 해설 채널",
		firstContentPillar: "결말을 알고 다시 보면 달라지는 장면 5-9챕터 롱폼",
		nameTokens: ["복선", "장면", "결말", "회수", "지도", "해석"],
		riskControls: [
			"원본 장면은 짧게 쓰고 대본/해설/구조를 새로 만든다.",
			"공식 예고편, 스틸, 인물 관계 등 출처형 자료를 우선한다.",
		],
		pilotPlan: [
			"8-12분 롱폼 3개로 복선 회수형 제목을 먼저 테스트",
			"각 영상은 공식 자료 4개 이상, 원본 장면 장시간 재사용 금지",
			"상위 1개 주제는 45-75초 쇼츠로 잘라 유입 경로를 만든다.",
		],
	},
	{
		categoryId: "mystery_doc",
		domainCategoryId: "mystery_doc",
		templateProfileId: "mystery_doc",
		format: "longform",
		concept: "사건, 기록, 지도, 사진을 근거로 쌓아 올리는 미스터리 다큐 채널",
		firstContentPillar: "기록의 빈칸과 현장 자료가 충돌하는 사건형 롱폼",
		nameTokens: ["기록", "단서", "지도", "사건", "빈칸", "로그"],
		riskControls: [
			"사실/의견/추정을 분리하고 단정 표현을 줄인다.",
			"근거형 씬 70% 이상에 기사, 지도, 공식 기록 앵커를 붙인다.",
		],
		pilotPlan: [
			"8-12분 롱폼 3개와 45-75초 요약 쇼츠 3개를 같은 소재군에서 테스트",
			"초반 15초 안에 지도/사진/기록 중 하나를 먼저 제시",
			"10개 파일럿 후 일평균 조회와 평균 시청시간으로 주제군을 남긴다.",
		],
	},
	{
		categoryId: "news_issue",
		domainCategoryId: "social_clip",
		templateProfileId: "social_clip",
		format: "hybrid",
		concept: "뉴스 제목만으로 오해하기 쉬운 이슈를 사실, 반응, 맥락으로 분해하는 채널",
		firstContentPillar: "한 장면 때문에 댓글이 갈린 이슈의 60초 요약과 8분 타임라인",
		nameTokens: ["쟁점", "맥락", "팩트", "타임라인", "브리핑", "라인"],
		riskControls: [
			"개인 신상, 모욕, 미확인 주장을 제거한다.",
			"쟁점형 소재는 양쪽 논리와 출처를 분리해 표시한다.",
		],
		pilotPlan: [
			"60초 쇼츠 5개로 댓글 반응이 갈리는 제목 구조를 테스트",
			"성과 상위 1개만 8-10분 타임라인 롱폼으로 확장",
			"설명란 첫 2줄에 출처와 쟁점 요약을 고정한다.",
		],
	},
	{
		categoryId: "automation_business",
		domainCategoryId: "business",
		templateProfileId: "business",
		format: "hybrid",
		concept: "AI/자동화 툴을 수익 보장이 아니라 병목 제거와 실험 데이터로 설명하는 채널",
		firstContentPillar: "실패한 자동화와 성공한 자동화의 차이를 숫자로 비교하는 워크플로우",
		nameTokens: ["자동화", "워크플로우", "실험", "AI", "레버리지", "루틴"],
		riskControls: [
			"수익 보장, 빠른 돈, 외부방 유도 문구를 쓰지 않는다.",
			"도구 추천보다 전후 지표와 한계를 함께 보여준다.",
		],
		pilotPlan: [
			"전후 비교형 쇼츠 5개와 워크플로우 롱폼 2개를 병행",
			"각 영상에 시간 절감, 실패 조건, 재현 순서를 숫자로 남긴다.",
			"성과 판단은 조회수보다 저장/댓글/구독 전환을 우선한다.",
		],
	},
	{
		categoryId: "money_psychology",
		domainCategoryId: "business",
		templateProfileId: "business",
		format: "longform",
		concept: "돈, 습관, 심리, 성장 서사를 사례와 행동 패턴으로 해설하는 채널",
		firstContentPillar: "부자 심리와 실패 습관을 사례, 체크리스트, 반례로 분해하는 롱폼",
		nameTokens: ["돈", "습관", "심리", "성장", "계산서", "패턴"],
		riskControls: [
			"투자 조언이나 수익 보장처럼 들리는 문장을 피한다.",
			"개인 경험담은 조건, 한계, 반례를 함께 제시한다.",
		],
		pilotPlan: [
			"10-15분 사례형 롱폼 3개로 평균 시청시간을 확인",
			"각 영상은 실천 체크리스트와 실패 조건을 분리",
			"쇼츠는 한 문장 교훈보다 행동 전후 차이를 보여준다.",
		],
	},
];

export const CHANNEL_STRATEGY_EVIDENCE_SOURCES: ChannelEvidenceSource[] = [
	{
		label: "YouTube 2025 Culture & Trends",
		url: "https://blog.youtube/culture-and-trends/end-of-year-summary-2025/",
		kind: "official",
		usedFor: "공개 트렌드 클러스터와 주제 수요 신호",
	},
	{
		label: "YouTube channel monetization policies",
		url: "https://support.google.com/youtube/answer/1311392?hl=en",
		kind: "official",
		usedFor: "반복 양산, 재사용, 원본성 리스크 감점",
	},
	{
		label: "YouTube Community Guidelines enforcement visible changes",
		url: "https://support.google.com/transparencyreport/answer/9198203?hl=en",
		kind: "official",
		usedFor: "스팸/기만/사기 채널 삭제 분류와 정책 변경",
	},
	{
		label: "YouTube Data API 후보 채널 수집",
		url: "local://youtube-data-api/niche-research",
		kind: "live_api",
		usedFor: "카테고리별 후보 채널 점수, 일평균 조회, 대표 영상 성과",
	},
	{
		label: "현재 레퍼런스 템플릿 분석값",
		url: "local://reference-template/current",
		kind: "internal",
		usedFor: "현재 제작 가능한 편집 문법, 길이, 씬 수, 카테고리 적합도",
	},
];

export function buildChannelStrategyPlan(
	template: ReferenceTemplate,
	liveCandidatesByCategory: Record<string, ReferenceChannelCandidate[] | undefined> = {},
	now = new Date(),
): ChannelStrategyPlan {
	const currentProfile = inferCategoryProfile(template);
	const recommendedMode = getReferenceTemplateRecommendedMode(template);
	const rankings = REFERENCE_CHANNEL_CATEGORIES.map((category) => {
		const blueprint = blueprintFor(category.id);
		const format = primaryDomainFormat(blueprint.format);
		const domainIntel = getYouTubeDomainIntelligence({
			categoryId: blueprint.domainCategoryId,
			format,
		});
		const liveCandidates = liveCandidatesByCategory[category.id] ?? [];
		const scoreFactors = buildScoreFactors({
			template,
			templateProfileId: currentProfile.id,
			recommendedMode,
			blueprint,
			liveCandidates,
			trendClusters: domainIntel.trendClusters,
		});
		const score = Math.round(
			scoreFactors.reduce((sum, factor) => sum + factor.score * factor.weight, 0),
		);
		const topLive = [...liveCandidates]
			.sort((a, b) => b.score - a.score)
			.slice(0, 3);
		return {
			rank: 0,
			categoryId: category.id,
			label: category.label,
			description: category.description,
			score,
			confidence: confidenceFor(liveCandidates),
			recommendedFormat: blueprint.format,
			channelConcept: blueprint.concept,
			firstContentPillar: blueprint.firstContentPillar,
			nameCandidates: buildChannelNameCandidates(blueprint, domainIntel.trendClusters),
			scoreFactors,
			trendClusters: domainIntel.trendClusters.slice(0, 3),
			liveCandidateCount: liveCandidates.length,
			liveEvidence:
				topLive.length > 0
					? topLive.map((candidate) => liveEvidenceLine(candidate))
					: [
							"실시간 YouTube 후보 채널 데이터 없음. 공개 트렌드/정책/현재 레퍼런스 기준으로 산정.",
						],
			dataBasis: [
				`카테고리 쿼리: ${category.queries.join(" / ")}`,
				`도메인 트렌드: ${domainIntel.trendClusters
					.slice(0, 3)
					.map((cluster) => `${cluster.label} S${cluster.score}`)
					.join(" / ")}`,
				`정책 리스크: ${domainIntel.riskSignals.slice(0, 2).join(" / ")}`,
				`현재 레퍼런스: ${currentProfile.label}, ${template.scene_count}씬, ${
					template.duration_seconds
						? formatDuration(template.duration_seconds)
						: "길이 미확인"
				}`,
			],
			evidenceSources: strategyEvidenceSources(liveCandidates.length > 0),
			riskControls: [
				...blueprint.riskControls,
				...domainIntel.safeActions.slice(0, 2),
			],
			pilotPlan: blueprint.pilotPlan,
		} satisfies RankedChannelStrategy;
	})
		.sort((a, b) => b.score - a.score)
		.map((item, index) => ({ ...item, rank: index + 1 }));

	return {
		generatedAt: now.toISOString(),
		currentTemplateCategory: currentProfile.label,
		weights: SCORE_WEIGHTS,
		rankings,
		sourceNotes: [
			"YouTube API 후보 채널이 있으면 실측 성과 36%를 반영합니다.",
			"실측 데이터가 없으면 트렌드 38%, 정책 안전성 24%, 현재 레퍼런스 적합도 20%, 포맷 적합도 18%로 재가중합니다.",
			"YouTube 정책상 반복 양산/재사용/스팸성 메타데이터는 채널 단위 리스크로 처리합니다.",
		],
		evidenceSources: CHANNEL_STRATEGY_EVIDENCE_SOURCES,
	};
}

function buildScoreFactors(input: {
	template: ReferenceTemplate;
	templateProfileId: string;
	recommendedMode: string;
	blueprint: ChannelBlueprint;
	liveCandidates: ReferenceChannelCandidate[];
	trendClusters: TrendCluster[];
}): ChannelScoreFactor[] {
	const hasLive = input.liveCandidates.length > 0;
	const weight = (key: ChannelScoreFactor["key"]) => {
		const row = SCORE_WEIGHTS.find((item) => item.key === key);
		return hasLive ? (row?.liveWeight ?? 0) : (row?.fallbackWeight ?? 0);
	};
	const liveScore = scoreLiveCandidates(input.liveCandidates);
	const trendScore = scoreTrendClusters(input.trendClusters);
	const policyScore = scorePolicySafety(input.trendClusters, input.blueprint);
	const templateScore = scoreTemplateFit(input.templateProfileId, input.blueprint);
	const formatScore = scoreFormatFit(input.template, input.recommendedMode, input.blueprint);

	const factors: ChannelScoreFactor[] = [
		{
			key: "live",
			label: "실측 후보",
			score: liveScore,
			weight: weight("live"),
			evidence: hasLive
				? `${input.liveCandidates.length}개 후보 채널, 평균 점수 ${liveScore}`
				: "실시간 후보 없음. fallback 가중치에서는 제외.",
		},
		{
			key: "trend",
			label: "트렌드",
			score: trendScore,
			weight: weight("trend"),
			evidence: input.trendClusters
				.slice(0, 3)
				.map((cluster) => `${cluster.label} S${cluster.score}`)
				.join(" / "),
		},
		{
			key: "policy",
			label: "정책 안전성",
			score: policyScore,
			weight: weight("policy"),
			evidence: input.trendClusters.some((cluster) => cluster.risk === "high")
				? "고위험 트렌드 포함. 반복/기만/재사용 제어 필요."
				: "고위험 트렌드 비중 낮음.",
		},
		{
			key: "template",
			label: "레퍼런스 적합",
			score: templateScore,
			weight: weight("template"),
			evidence:
				input.templateProfileId === input.blueprint.templateProfileId
					? "현재 레퍼런스 카테고리와 일치"
					: `현재 레퍼런스(${input.templateProfileId})와 다른 카테고리`,
		},
		{
			key: "format",
			label: "포맷",
			score: formatScore,
			weight: weight("format"),
			evidence: `템플릿 권장 모드 ${input.recommendedMode}, 후보 포맷 ${input.blueprint.format}`,
		},
	];
	return factors.filter((factor) => factor.weight > 0);
}

function scoreLiveCandidates(candidates: ReferenceChannelCandidate[]): number {
	if (candidates.length === 0) return 50;
	const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, 4);
	const avgCandidateScore =
		top.reduce((sum, candidate) => sum + candidate.score, 0) / top.length;
	const avgViewsPerDay =
		top.reduce((sum, candidate) => sum + candidate.avgViewsPerDay, 0) / top.length;
	const velocityBonus = Math.min(12, Math.log10(avgViewsPerDay + 1) * 2.4);
	const diversityBonus = Math.min(8, new Set(top.map((item) => item.channelId)).size * 2);
	return Math.round(Math.min(100, avgCandidateScore * 0.82 + velocityBonus + diversityBonus));
}

function scoreTrendClusters(clusters: TrendCluster[]): number {
	if (clusters.length === 0) return 50;
	const top = clusters.slice(0, 3);
	return Math.round(top.reduce((sum, cluster) => sum + cluster.score, 0) / top.length);
}

function scorePolicySafety(
	clusters: TrendCluster[],
	blueprint: ChannelBlueprint,
): number {
	const riskPenalty = clusters.slice(0, 3).reduce((sum, cluster) => {
		if (cluster.risk === "high") return sum + 14;
		if (cluster.risk === "medium") return sum + 7;
		return sum + 2;
	}, 0);
	const formatPenalty = blueprint.format === "hybrid" ? 3 : 0;
	return Math.max(45, Math.round(100 - riskPenalty - formatPenalty));
}

function scoreTemplateFit(
	templateProfileId: string,
	blueprint: ChannelBlueprint,
): number {
	if (templateProfileId === blueprint.templateProfileId) return 96;
	if (templateProfileId === blueprint.domainCategoryId) return 88;
	if (blueprint.domainCategoryId === "business" && templateProfileId === "business") return 90;
	return 64;
}

function scoreFormatFit(
	template: ReferenceTemplate,
	recommendedMode: string,
	blueprint: ChannelBlueprint,
): number {
	const isLongReference =
		template.duration_seconds >= 180 || template.scene_count >= 12 || recommendedMode === "longform";
	if (blueprint.format === "hybrid") return 86;
	if (blueprint.format === "longform") return isLongReference ? 94 : 70;
	return isLongReference ? 66 : 92;
}

function buildChannelNameCandidates(
	blueprint: ChannelBlueprint,
	clusters: TrendCluster[],
): ChannelNameCandidate[] {
	const topExamples = clusters.flatMap((cluster) => cluster.examples).slice(0, 6);
	const tokens = blueprint.nameTokens;
	const candidates = [
		`${tokens[0]}의 ${tokens[4] ?? tokens[1]}`,
		`${tokens[1]}${tokens[4] ?? "로그"}`,
		`${tokens[2]} ${tokens[5] ?? "브리핑"}`,
		`${tokens[0]}${tokens[3] ?? "랩"}`,
		`${tokens[3] ?? tokens[0]}의 ${tokens[2]}`,
	];
	return [...new Set(candidates)]
		.map((name, index) => {
			const usedTokens = tokens.filter((token) => name.includes(token));
			const tokenScore = Math.min(30, usedTokens.length * 12);
			const lengthScore = name.length >= 4 && name.length <= 8 ? 24 : 16;
			const trendScore = topExamples.length > 0 ? 18 : 10;
			const distinctScore = 100 - index * 5;
			const score = Math.round(
				Math.min(100, tokenScore + lengthScore + trendScore + distinctScore * 0.22),
			);
			return {
				name,
				score,
				tokens: usedTokens,
				rationale: `카테고리 토큰 ${usedTokens.join("·") || tokens[0]}와 트렌드 예시 ${topExamples
					.slice(0, 2)
					.join("·")} 기준`,
			};
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, 4);
}

function liveEvidenceLine(candidate: ReferenceChannelCandidate): string {
	return `${candidate.channelTitle}: S${candidate.score}, 대표 ${formatCompactNumber(
		candidate.representativeVideo.viewCount,
	)}, 일평균 ${formatCompactNumber(candidate.avgViewsPerDay)}/일, ${formatDuration(
		candidate.representativeVideo.durationSeconds,
	)}`;
}

function strategyEvidenceSources(hasLive: boolean): ChannelEvidenceSource[] {
	return CHANNEL_STRATEGY_EVIDENCE_SOURCES.filter(
		(source) => hasLive || source.kind !== "live_api",
	);
}

function confidenceFor(
	candidates: ReferenceChannelCandidate[],
): ChannelStrategyConfidence {
	if (candidates.length >= 3) return "live";
	if (candidates.length > 0) return "modeled";
	return "fallback";
}

function primaryDomainFormat(format: ChannelBlueprint["format"]): DomainFormat {
	return format === "shorts" ? "shorts" : "longform";
}

function blueprintFor(categoryId: string): ChannelBlueprint {
	return (
		BLUEPRINTS.find((blueprint) => blueprint.categoryId === categoryId) ??
		BLUEPRINTS[1]
	);
}
