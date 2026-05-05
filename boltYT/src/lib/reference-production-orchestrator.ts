import type { ReferenceTemplate } from "../types/database";
import {
	buildContentRecommendationPlan,
	type ContentPerformanceSample,
	type ContentRecommendationPlan,
	type RecommendationFormat,
	type RecommendationMode,
	type RecommendationSourceInput,
} from "./content-recommendation-ranker";
import {
	buildReferenceKnowledgeProfile,
	compactKnowledgeProfile,
	type CompactKnowledgeProfile,
} from "./knowledge-system";
import type { NicheResearchHandoff } from "./niche-research";
import {
	buildReferenceTopicPlan,
	inferCategoryProfile,
	type ReferenceTopicPlan,
} from "./reference-topic-planner";
import {
	getReferenceTemplateQuality,
	getReferenceTemplateReadiness,
	getReferenceTemplateRecommendedMode,
	getReferenceTemplateSupportedFormats,
} from "./reference-template-presets";
import { finalizeReferenceThumbnailDna } from "./thumbnail-intelligence";
import {
	getYouTubeDomainIntelligence,
	type DomainFormat,
} from "./youtube-domain-intelligence";

export interface ReferenceProductionCandidate {
	template: ReferenceTemplate;
	score: number;
	categoryId: string;
	categoryLabel: string;
	qualityScore: number;
	knowledgeScore: number;
	readiness: ReturnType<typeof getReferenceTemplateReadiness>;
	formatFit: number;
	topicFit: number;
	trendFit: number;
	reasons: string[];
	risks: string[];
}

export interface ReferenceProductionDirective {
	id: string;
	label: string;
	directive: string;
	priority: "critical" | "high" | "normal";
}

export interface ReferenceProductionPlan {
	topicTitle: string;
	autoSelected: boolean;
	selectedTemplate: ReferenceTemplate | null;
	selectedCandidate: ReferenceProductionCandidate | null;
	candidates: ReferenceProductionCandidate[];
	recommendationPlan: ContentRecommendationPlan;
	topicPlan: ReferenceTopicPlan | null;
	knowledge: CompactKnowledgeProfile | null;
	directives: ReferenceProductionDirective[];
	qualityGates: string[];
	trendSummary: string[];
	evidence: string[];
	promptContext: string;
}

export interface ReferenceProductionPlanInput {
	topicTitle?: string | null;
	mode?: RecommendationMode;
	selectedFormat?: RecommendationFormat;
	sources?: RecommendationSourceInput[];
	referenceTemplate?: ReferenceTemplate | null;
	referenceCandidates?: ReferenceTemplate[];
	nicheHandoff?: NicheResearchHandoff | null;
	performanceHistory?: ContentPerformanceSample[];
}

const FALLBACK_TOPIC = "입력한 주제";

export function buildReferenceProductionPlan(
	input: ReferenceProductionPlanInput,
): ReferenceProductionPlan {
	const topicTitle = normalizeTopic(input.topicTitle);
	const candidates = rankReferenceCandidates(input, topicTitle);
	const selectedTemplate =
		input.referenceTemplate ?? candidates[0]?.template ?? null;
	const selectedCandidate =
		candidates.find((candidate) => candidate.template.id === selectedTemplate?.id) ??
		null;
	const recommendationPlan = buildContentRecommendationPlan({
		topicTitle,
		mode: input.mode,
		selectedFormat: input.selectedFormat,
		sources: input.sources,
		referenceTemplate: selectedTemplate,
		nicheHandoff: input.nicheHandoff,
		performanceHistory: input.performanceHistory,
	});
	const topicPlan = selectedTemplate
		? buildReferenceTopicPlan(selectedTemplate, topicTitle)
		: null;
	const knowledge = selectedTemplate
		? compactKnowledgeProfile(buildReferenceKnowledgeProfile(selectedTemplate))
		: null;
	const domainIntel = getYouTubeDomainIntelligence({
		categoryId:
			selectedCandidate?.categoryId ?? recommendationPlan.categoryId,
		format: toDomainFormat(input.selectedFormat, selectedTemplate),
	});
	const directives = buildDirectives({
		topicTitle,
		selectedTemplate,
		selectedCandidate,
		recommendationPlan,
		topicPlan,
	});
	const trendSummary = domainIntel.trendClusters.slice(0, 3).map(
		(cluster) =>
			`${cluster.label} S${cluster.score}: ${cluster.signals.slice(0, 2).join(" / ")}`,
	);
	const qualityGates = [
		...recommendationPlan.qualityGates,
		...(selectedCandidate?.risks.map((risk) => `레퍼런스 리스크 제어: ${risk}`) ?? []),
		"선택 레퍼런스의 원본 영상/음악/대사/고유 캐릭터는 복제하지 않고 컷 호흡, 화면 배치, 지식 규칙만 적용",
		"대본, 썸네일, BGM, TTS, 씬 타입이 같은 주제를 향하도록 저장 전 확인",
	].slice(0, 12);
	const evidence = [
		...recommendationPlan.evidence,
		...(selectedCandidate
			? [
					`선택 레퍼런스 점수: R${selectedCandidate.score} · Q${selectedCandidate.qualityScore} · K${selectedCandidate.knowledgeScore}`,
					`주제 적합도 ${selectedCandidate.topicFit} · 포맷 적합도 ${selectedCandidate.formatFit} · 트렌드 적합도 ${selectedCandidate.trendFit}`,
				]
			: []),
		...trendSummary.slice(0, 2),
	];
	const promptContext = buildPromptContext({
		topicTitle,
		selectedTemplate,
		selectedCandidate,
		recommendationPlan,
		knowledge,
		directives,
		qualityGates,
		trendSummary,
	});

	return {
		topicTitle,
		autoSelected: !input.referenceTemplate && Boolean(selectedTemplate),
		selectedTemplate,
		selectedCandidate,
		candidates,
		recommendationPlan,
		topicPlan,
		knowledge,
		directives,
		qualityGates,
		trendSummary,
		evidence,
		promptContext,
	};
}

function rankReferenceCandidates(
	input: ReferenceProductionPlanInput,
	topicTitle: string,
): ReferenceProductionCandidate[] {
	const templates = input.referenceTemplate
		? [input.referenceTemplate]
		: dedupeTemplates(input.referenceCandidates ?? []);
	const selectedFormat = input.selectedFormat ?? "both";
	const mode = input.mode ?? "research";
	const scored = templates
		.map((template) =>
			scoreReferenceCandidate({
				template,
				topicTitle,
				selectedFormat,
				mode,
				sourceCount: input.sources?.length ?? 0,
				nicheHandoff: input.nicheHandoff,
				performanceHistory: input.performanceHistory ?? [],
			}),
		)
		.sort((a, b) => b.score - a.score);
	const usable = scored.filter(
		(candidate) => candidate.readiness.status !== "blocked",
	);
	return (usable.length > 0 ? usable : scored).slice(0, 8);
}

function scoreReferenceCandidate(params: {
	template: ReferenceTemplate;
	topicTitle: string;
	selectedFormat: RecommendationFormat;
	mode: RecommendationMode;
	sourceCount: number;
	nicheHandoff?: NicheResearchHandoff | null;
	performanceHistory: ContentPerformanceSample[];
}): ReferenceProductionCandidate {
	const {
		template,
		topicTitle,
		selectedFormat,
		mode,
		sourceCount,
		nicheHandoff,
		performanceHistory,
	} = params;
	const profile = inferCategoryProfile(template);
	const quality = getReferenceTemplateQuality(template);
	const readiness = getReferenceTemplateReadiness(template);
	const knowledge = buildReferenceKnowledgeProfile(template);
	const supportedFormats = getReferenceTemplateSupportedFormats(template);
	const recommendedMode = getReferenceTemplateRecommendedMode(template);
	const topicFit = scoreTopicFit(topicTitle, profile.id);
	const formatFit = scoreFormatFit(selectedFormat, supportedFormats, template);
	const trendFit = scoreTrendFit(profile.id, selectedFormat);
	const modeFit = recommendedMode === mode ? 8 : mode === "research" ? 3 : 0;
	const sourceFit =
		sourceCount >= 5 && supportedFormats.includes("longform")
			? 7
			: sourceCount >= 2
				? 4
				: 0;
	const performanceFit = performanceHistory.length
		? Math.min(7, Math.round(performanceHistory.length / 3))
		: 0;
	const nicheFit =
		nicheHandoff && topicMatches(topicTitle, nicheHandoff.topic) ? 5 : 0;
	const readinessPenalty = readiness.status === "review" ? -8 : 0;
	const score = clampScore(
		Math.round(
			quality.score * 0.24 +
				knowledge.score * 0.26 +
				topicFit * 0.22 +
				formatFit * 0.12 +
				trendFit * 0.1 +
				modeFit +
				sourceFit +
				performanceFit +
				nicheFit +
				readinessPenalty,
		),
	);
	const reasons = [
		`${profile.label} 주제 적합도 ${topicFit}점`,
		`레퍼런스 품질 Q${quality.score}/${quality.grade}, 지식 K${knowledge.score}/${knowledge.maturity}`,
		`${supportedFormats.map(formatLabel).join("/")} 제작 가능, ${formatLabel(selectedFormat)} 요청과 적합도 ${formatFit}점`,
		`트렌드 적합도 ${trendFit}점`,
	];
	const risks = [
		...quality.gaps.slice(0, 2),
		...(readiness.action ? [readiness.action] : []),
	].slice(0, 3);
	return {
		template,
		score,
		categoryId: profile.id,
		categoryLabel: profile.label,
		qualityScore: quality.score,
		knowledgeScore: knowledge.score,
		readiness,
		formatFit,
		topicFit,
		trendFit,
		reasons,
		risks,
	};
}

function buildDirectives(input: {
	topicTitle: string;
	selectedTemplate: ReferenceTemplate | null;
	selectedCandidate: ReferenceProductionCandidate | null;
	recommendationPlan: ContentRecommendationPlan;
	topicPlan: ReferenceTopicPlan | null;
}): ReferenceProductionDirective[] {
	const { topicTitle, selectedTemplate, selectedCandidate, recommendationPlan, topicPlan } =
		input;
	const topScript = recommendationPlan.scripts[0];
	const topHook = recommendationPlan.hooks[0];
	const topThumbnail = recommendationPlan.thumbnails[0];
	const topFormat = recommendationPlan.formats[0];
	const thumbnailDna = selectedTemplate
		? finalizeReferenceThumbnailDna(selectedTemplate)
		: null;
	return [
		{
			id: "script-direction",
			label: "대본 방향",
			priority: "critical",
			directive: topScript
				? `${topScript.title}: ${topScript.structure}`
				: `${topicTitle}를 단일 질문, 근거, 반론, 결론 순서로 구성`,
		},
		{
			id: "hook",
			label: "훅",
			priority: "critical",
			directive: topHook?.text ?? `${topicTitle}, 왜 지금 다시 봐야 할까요?`,
		},
		{
			id: "format-duration",
			label: "포맷/길이",
			priority: "high",
			directive: topFormat
				? `${topFormat.label}: ${topFormat.durationRange}`
				: "쇼츠는 30-55초, 롱폼은 20분 이내에서 자료 밀도에 맞춤",
		},
		{
			id: "thumbnail",
			label: "썸네일",
			priority: "high",
			directive: topThumbnail
				? `${topThumbnail.text} · ${topThumbnail.layout}`
				: thumbnailDna
					? `${thumbnailDna.text.titleFormula} · 텍스트 ${thumbnailDna.layout.textZone}`
					: "제목 반복이 아니라 클릭 이유를 별도 시각 단서로 제시",
		},
		{
			id: "reference-fit",
			label: "레퍼런스 적용",
			priority: "high",
			directive: selectedCandidate
				? `${selectedCandidate.template.name}: ${selectedCandidate.reasons.slice(0, 2).join(" / ")}`
				: "선택 레퍼런스 없이 기본 도메인 규칙으로 제작",
		},
		{
			id: "trend",
			label: "트렌드",
			priority: "normal",
			directive:
				topicPlan?.ideas[0]?.trendCluster ??
				"질문형 훅, 증거 컷, 후속 시리즈화 가능성을 우선",
		},
	];
}

function buildPromptContext(input: {
	topicTitle: string;
	selectedTemplate: ReferenceTemplate | null;
	selectedCandidate: ReferenceProductionCandidate | null;
	recommendationPlan: ContentRecommendationPlan;
	knowledge: CompactKnowledgeProfile | null;
	directives: ReferenceProductionDirective[];
	qualityGates: string[];
	trendSummary: string[];
}): string {
	const {
		topicTitle,
		selectedTemplate,
		selectedCandidate,
		recommendationPlan,
		knowledge,
		directives,
		qualityGates,
		trendSummary,
	} = input;
	const topScript = recommendationPlan.scripts[0];
	const topThumbnail = recommendationPlan.thumbnails[0];
	const candidateLine = selectedCandidate
		? `선택 레퍼런스: ${selectedTemplate?.name ?? selectedTemplate?.source_title} (R${selectedCandidate.score}, Q${selectedCandidate.qualityScore}, K${selectedCandidate.knowledgeScore})`
		: "선택 레퍼런스: 없음";
	const knowledgeLine = knowledge
		? `지식 성숙도: ${knowledge.maturity}, K${knowledge.score}, 명시지 ${knowledge.explicitCount}, 암묵지 ${knowledge.tacitCount}, 성과지 ${knowledge.performanceCount}`
		: "지식 성숙도: 기본 도메인 규칙";
	return `
=== 주제 맞춤 레퍼런스 오케스트레이션 ===
주제: ${topicTitle}
${candidateLine}
${knowledgeLine}
카테고리: ${recommendationPlan.categoryLabel} / 신뢰도 ${recommendationPlan.confidence}
1순위 대본: ${topScript ? `${topScript.title} - ${topScript.structure}` : "없음"}
1순위 훅: ${topScript?.hook ?? directives.find((item) => item.id === "hook")?.directive ?? ""}
1순위 썸네일: ${topThumbnail ? `${topThumbnail.text} - ${topThumbnail.layout}` : ""}
트렌드 신호:
${trendSummary.map((item) => `- ${item}`).join("\n")}
제작 지시:
${directives.map((item) => `- [${item.priority}] ${item.label}: ${item.directive}`).join("\n")}
품질 게이트:
${qualityGates.slice(0, 8).map((gate) => `- ${gate}`).join("\n")}
금지:
- 원본 영상, 음악, 대사, 고유 캐릭터, 고유 자막 문구를 복제하지 않는다.
- 레퍼런스는 컷 호흡, 화면 배치, BGM/TTS 에너지, 대본 구조, 썸네일 역할만 변환해 적용한다.
- 주제와 직접 맞지 않는 레퍼런스 장면을 억지로 끼워 넣지 않는다.
`.trim();
}

function scoreTopicFit(topicTitle: string, categoryId: string): number {
	const text = topicTitle.toLowerCase();
	const keywordMap: Record<string, RegExp> = {
		drama_recap: /드라마|영화|결말|복선|리캡|몰아보기|장면|캐릭터|movie|film|recap|ending/i,
		mystery_doc: /미스터리|사건|기록|왕릉|유적|실종|범죄|비밀|의문|지도|사진|mystery|case|crime|documentary/i,
		social_clip: /뉴스|이슈|논란|반응|댓글|사회|해외|정리|클립|news|issue|reaction|social/i,
		business: /자동화|수익|비즈니스|창업|ai|워크플로우|툴|개발자|automation|business|startup|workflow/i,
		animation: /애니|캐릭터|스토리|상황극|공포|개그|cartoon|animation|character|story/i,
	};
	const regex = keywordMap[categoryId];
	let score = regex?.test(text) ? 92 : 54;
	const tokens = text.split(/\s+/).filter((token) => token.length >= 2);
	if (tokens.length >= 4) score += 4;
	if (/[?？!！]/.test(topicTitle)) score += 2;
	return clampScore(score);
}

function scoreFormatFit(
	selectedFormat: RecommendationFormat,
	supportedFormats: Array<"shorts" | "longform">,
	template: ReferenceTemplate,
): number {
	if (selectedFormat === "both") {
		return supportedFormats.length >= 2 ? 94 : 74;
	}
	if (supportedFormats.includes(selectedFormat)) return 96;
	const prefersLongform =
		template.duration_seconds >= 180 || template.scene_count >= 12;
	if (selectedFormat === "longform" && prefersLongform) return 82;
	if (selectedFormat === "shorts" && !prefersLongform) return 82;
	return 48;
}

function scoreTrendFit(
	categoryId: string,
	selectedFormat: RecommendationFormat,
): number {
	const domain = getYouTubeDomainIntelligence({
		categoryId,
		format: toDomainFormat(selectedFormat),
	});
	const top = domain.trendClusters[0]?.score ?? 70;
	const rules = domain.productionRules.length;
	return clampScore(top + Math.min(8, rules));
}

function toDomainFormat(
	format?: RecommendationFormat,
	template?: ReferenceTemplate | null,
): DomainFormat {
	if (format === "shorts" || format === "longform") return format;
	if (template) {
		return template.duration_seconds >= 180 || template.scene_count >= 12
			? "longform"
			: "shorts";
	}
	return "shorts";
}

function dedupeTemplates(templates: ReferenceTemplate[]): ReferenceTemplate[] {
	const seen = new Set<string>();
	const result: ReferenceTemplate[] = [];
	for (const template of templates) {
		if (!template.id || seen.has(template.id)) continue;
		seen.add(template.id);
		result.push(template);
	}
	return result;
}

function normalizeTopic(value: string | null | undefined): string {
	return value?.replace(/\s+/g, " ").trim() || FALLBACK_TOPIC;
}

function topicMatches(a: string, b: string): boolean {
	const aTokens = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
	return b
		.toLowerCase()
		.split(/\s+/)
		.some((token) => aTokens.has(token));
}

function formatLabel(format: RecommendationFormat | "shorts" | "longform") {
	if (format === "both") return "쇼츠+롱폼";
	if (format === "shorts") return "쇼츠";
	return "롱폼";
}

function clampScore(score: number): number {
	return Math.max(0, Math.min(99, Math.round(score)));
}
