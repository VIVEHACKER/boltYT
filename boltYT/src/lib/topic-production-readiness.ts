import type { ResearchBrief } from "./ai-agents";

export type TopicProductionStatus = "ready" | "needs_reframe" | "blocked";
export type TopicProductionSeverity = "critical" | "warning" | "info";

export interface TopicProductionSource {
	type: "image" | "video" | "article";
	title: string;
	url: string;
	description?: string;
	bodyText?: string;
	pubDate?: string;
	publisher?: string;
	eventDate?: string;
	eventTitle?: string;
}

export interface TopicProductionIssue {
	severity: TopicProductionSeverity;
	code: string;
	message: string;
}

export interface TopicProductionReadinessReport {
	status: TopicProductionStatus;
	canGenerate: boolean;
	score: number;
	recommendedFormat: "shorts" | "longform" | "both";
	recommendedAngle: string;
	metrics: {
		sourceCount: number;
		articleSourceCount: number;
		videoSourceCount: number;
		imageSourceCount: number;
		factualSourceCount: number;
		totalTextChars: number;
		datedSourceCount: number;
		eventTitleSourceCount: number;
		distinctPublisherCount: number;
		timelineEventCount: number;
		factCount: number;
		visualSourceCount: number;
		evidenceBitCount: number;
		longformReady: boolean;
		shortsReady: boolean;
	};
	issues: TopicProductionIssue[];
	requiredActions: string[];
	reframeOptions: string[];
	searchQueries: string[];
	promptDirectives: string[];
}

interface TopicProductionInput {
	topicTitle?: string;
	format?: "shorts" | "longform" | "both" | string;
	sources: TopicProductionSource[];
	researchBrief?: ResearchBrief;
}

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function sourceText(source: TopicProductionSource): string {
	return normalizeText(
		[source.title, source.eventTitle, source.description, source.bodyText]
			.filter(Boolean)
			.join(" "),
	);
}

function parseDateSortKey(raw?: string): number {
	if (!raw) return 0;
	const cleaned = raw
		.replace(/년|월/g, "-")
		.replace(/일/g, "")
		.replace(/\./g, "-")
		.replace(/\s+/g, "")
		.trim();
	const isoMatch = cleaned.match(/(\d{4})-(\d{1,2})-?(\d{1,2})?/);
	if (isoMatch) {
		const y = Number(isoMatch[1]);
		const m = Number(isoMatch[2]) - 1;
		const d = Number(isoMatch[3] || 1);
		const ts = new Date(y, m, d).getTime();
		if (!Number.isNaN(ts)) return ts;
	}
	const parsed = Date.parse(raw);
	if (!Number.isNaN(parsed)) return parsed;
	const yearOnly = raw.match(/(\d{4})/);
	if (yearOnly) return new Date(Number(yearOnly[1]), 0, 1).getTime();
	return 0;
}

function isFactualSource(source: TopicProductionSource): boolean {
	const textLength = sourceText(source).length;
	if (source.type === "article") return textLength >= 120;
	if (source.type === "video") return textLength >= 80;
	return textLength >= 140 && Boolean(source.eventDate || source.publisher);
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}

function pushUnique(list: string[], value: string) {
	if (!list.includes(value)) list.push(value);
}

function buildIssue(
	severity: TopicProductionSeverity,
	code: string,
	message: string,
): TopicProductionIssue {
	return { severity, code, message };
}

function clampScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function inferRecommendedAngle(input: {
	topicTitle: string;
	videoSourceCount: number;
	imageSourceCount: number;
	articleSourceCount: number;
	datedSourceCount: number;
	timelineEventCount: number;
	factCount: number;
	totalTextChars: number;
}): string {
	if (input.videoSourceCount >= 2) return "영상 자료 분석형";
	if (input.timelineEventCount >= 3 || input.datedSourceCount >= 3) {
		return "타임라인 검증형";
	}
	if (input.articleSourceCount >= 2 && input.totalTextChars >= 1200) {
		return "문서/보도자료 해석형";
	}
	if (input.imageSourceCount >= 2) return "사진/현장자료 분석형";
	if (input.factCount >= 3) return "핵심 팩트 체크형";
	return `${input.topicTitle || "주제"} 핵심 의문 압축형`;
}

function buildSearchQueries(topicTitle: string, sources: TopicProductionSource[]) {
	const base = normalizeText(topicTitle);
	const sourceTerms = unique(
		sources
			.map((source) => normalizeText(source.eventTitle || source.title))
			.filter(Boolean)
			.slice(0, 4),
	);
	const queries = [
		base && `${base} 타임라인`,
		base && `${base} 현장 사진`,
		base && `${base} 영상 자료`,
		base && `${base} 판결문`,
		base && `${base} 보도자료`,
		base && `${base} 인터뷰`,
		...sourceTerms.map((term) => `${term} 사진`),
		...sourceTerms.map((term) => `${term} 영상`),
	].filter(Boolean) as string[];
	return unique(queries).slice(0, 10);
}

function buildReframeOptions(input: {
	topicTitle: string;
	recommendedAngle: string;
	longformReady: boolean;
	videoSourceCount: number;
	articleSourceCount: number;
	totalTextChars: number;
}) {
	const topic = input.topicTitle || "이 주제";
	const options = [
		`${topic} 전체 요약이 아니라 "${input.recommendedAngle}"으로 좁히기`,
		"확인된 사실과 확인되지 않은 내용을 분리하는 팩트체크형 구성",
		"부족한 장면은 실제 영상처럼 꾸미지 말고 문서/지도/source card로 처리",
	];
	if (!input.longformReady) {
		options.push("롱폼 대신 45-75초 압축형 또는 3분 미만 미니 다큐로 시작");
	}
	if (input.videoSourceCount === 0) {
		options.push("영상 중심을 포기하고 문서 하이라이트, 지도, 타임라인 모션 중심으로 재기획");
	}
	if (input.articleSourceCount === 0 || input.totalTextChars < 800) {
		options.push("스크립트 생성 전에 본문 있는 기사/공식 자료를 최소 2개 추가");
	}
	return unique(options);
}

export function analyzeTopicProductionReadiness(
	input: TopicProductionInput,
): TopicProductionReadinessReport {
	const topicTitle = normalizeText(input.topicTitle);
	const sources = input.sources;
	const articleSources = sources.filter((source) => source.type === "article");
	const videoSources = sources.filter((source) => source.type === "video");
	const imageSources = sources.filter((source) => source.type === "image");
	const factualSources = sources.filter(isFactualSource);
	const totalTextChars = sources.reduce(
		(sum, source) => sum + sourceText(source).length,
		0,
	);
	const datedSourceCount = sources.filter(
		(source) =>
			parseDateSortKey(source.eventDate) > 0 ||
			parseDateSortKey(source.pubDate) > 0,
	).length;
	const eventTitleSourceCount = sources.filter((source) =>
		Boolean(normalizeText(source.eventTitle)),
	).length;
	const distinctPublisherCount = unique(
		sources.map((source) => normalizeText(source.publisher)).filter(Boolean),
	).length;
	const timelineEventCount = input.researchBrief?.timeline?.length ?? 0;
	const factCount = input.researchBrief?.facts?.length ?? 0;
	const visualSourceCount = videoSources.length + imageSources.length;
	const evidenceBitCount =
		factualSources.length +
		Math.min(6, timelineEventCount) +
		Math.min(6, factCount) +
		Math.min(4, datedSourceCount) +
		Math.min(4, visualSourceCount);
	const longformReady =
		sources.length >= 4 &&
		factualSources.length >= 2 &&
		totalTextChars >= 1800 &&
		evidenceBitCount >= 8;
	const shortsReady =
		sources.length >= 2 &&
		factualSources.length >= 1 &&
		(totalTextChars >= 450 || factCount >= 2 || timelineEventCount >= 2);

	const issues: TopicProductionIssue[] = [];
	const actions: string[] = [];
	let score = 100;

	if (sources.length === 0) {
		issues.push(
			buildIssue(
				"critical",
				"no_sources",
				"수집된 자료가 없어 제작 전에 품질을 판단할 수 없습니다.",
			),
		);
		pushUnique(actions, "본문 있는 기사, 원본 이미지, 영상 자료를 먼저 수집하세요.");
		score -= 68;
	}

	if (factualSources.length === 0) {
		issues.push(
			buildIssue(
				"critical",
				"no_factual_backbone",
				"스크립트를 지탱할 기사 본문/설명/출처 텍스트가 없습니다.",
			),
		);
		pushUnique(actions, "본문이 있는 기사나 공식 자료를 최소 1개 이상 추가하세요.");
		score -= 44;
	} else if (factualSources.length < 2) {
		issues.push(
			buildIssue(
				"warning",
				"thin_factual_backbone",
				"팩트를 교차 확인할 자료가 부족해 내용 편차가 커질 수 있습니다.",
			),
		);
		pushUnique(actions, "동일 사건을 다룬 다른 출처의 기사/자료를 1개 이상 더 추가하세요.");
		score -= 14;
	}

	if (totalTextChars > 0 && totalTextChars < 800) {
		issues.push(
			buildIssue(
				"warning",
				"thin_source_text",
				"수집 자료의 본문/설명이 짧아 롱폼 서사를 만들기 어렵습니다.",
			),
		);
		pushUnique(actions, "기사 본문을 가져오거나 직접 텍스트 탭에 핵심 자료를 붙여넣으세요.");
		score -= 12;
	}

	if (sources.length >= 2 && datedSourceCount < 2 && timelineEventCount < 2) {
		issues.push(
			buildIssue(
				"warning",
				"weak_timeline_evidence",
				"사건 날짜나 타임라인 단서가 부족해 순서 기반 편집이 흔들릴 수 있습니다.",
			),
		);
		pushUnique(actions, "각 자료의 사건 날짜와 '이 자료가 보여줄 사건 순간'을 채우세요.");
		score -= 11;
	}

	if (visualSourceCount === 0) {
		issues.push(
			buildIssue(
				"warning",
				"no_direct_visual_sources",
				"직접 연결된 이미지/영상 자료가 없어 source card와 문서형 화면 비중이 커집니다.",
			),
		);
		pushUnique(actions, "핵심 사건 시점과 직접 연결된 이미지나 영상 URL을 1개 이상 추가하세요.");
		score -= 12;
	}

	if (videoSources.length === 0) {
		issues.push(
			buildIssue(
				"info",
				"no_video_sources",
				"실제 영상 소스가 없어 영상감은 문서 모션/지도/카메라 무브로 만들어야 합니다.",
			),
		);
		pushUnique(actions, "가능하면 현장 영상, 뉴스 영상, 인터뷰 영상 중 하나를 추가하세요.");
		score -= 4;
	}

	if (sources.length >= 3 && distinctPublisherCount < 2) {
		issues.push(
			buildIssue(
				"warning",
				"single_source_perspective",
				"출처가 한쪽에 치우쳐 재사용/요약 영상처럼 보일 수 있습니다.",
			),
		);
		pushUnique(actions, "서로 다른 언론사/기관/영상 출처를 섞어 신뢰도를 높이세요.");
		score -= 8;
	}

	if (input.format === "longform" && !longformReady) {
		issues.push(
			buildIssue(
				"warning",
				"longform_not_supported_by_sources",
				"현재 자료 밀도로는 롱폼을 만들면 중반부가 늘어지거나 반복될 가능성이 큽니다.",
			),
		);
		pushUnique(actions, "롱폼 제작 전 본문 있는 자료 4개 이상 또는 확실한 타임라인 5비트 이상을 확보하세요.");
		score -= 14;
	}

	if (input.format === "shorts" && !shortsReady) {
		issues.push(
			buildIssue(
				"warning",
				"shorts_hook_material_weak",
				"쇼츠 훅으로 쓸 강한 사실/시각 자료가 부족합니다.",
			),
		);
		pushUnique(actions, "첫 3초에 넣을 확인된 사실, 사진, 영상, 문서 중 하나를 확보하세요.");
		score -= 10;
	}

	const criticals = issues.filter((issue) => issue.severity === "critical").length;
	const normalizedScore = clampScore(score);
	let status: TopicProductionStatus = "ready";
	if (criticals > 0 || normalizedScore < 45) {
		status = "blocked";
	} else if (!longformReady || normalizedScore < 74) {
		status = "needs_reframe";
	}

	const recommendedFormat: "shorts" | "longform" | "both" = longformReady
		? "both"
		: shortsReady
			? "shorts"
			: "shorts";
	const recommendedAngle = inferRecommendedAngle({
		topicTitle,
		videoSourceCount: videoSources.length,
		imageSourceCount: imageSources.length,
		articleSourceCount: articleSources.length,
		datedSourceCount,
		timelineEventCount,
		factCount,
		totalTextChars,
	});
	const reframeOptions = buildReframeOptions({
		topicTitle,
		recommendedAngle,
		longformReady,
		videoSourceCount: videoSources.length,
		articleSourceCount: articleSources.length,
		totalTextChars,
	});
	const searchQueries = buildSearchQueries(topicTitle, sources);
	const promptDirectives = [
		`제작 각도는 "${recommendedAngle}"으로 좁히세요.`,
		"자료가 직접 뒷받침하는 사건 비트만 씬으로 만드세요.",
		"자료가 빈 구간은 실제 영상처럼 꾸미지 말고 문서형 화면, 지도, 타임라인, source card로 처리하세요.",
		"확인되지 않은 장면은 AI 재구성 또는 추정 표현으로 명확히 낮추세요.",
		longformReady
			? "롱폼은 챕터마다 다른 근거 화면 문법을 사용하세요."
			: "롱폼으로 늘리지 말고 압축형 구성 또는 미니 다큐 구조로 제한하세요.",
	];

	return {
		status,
		canGenerate: status !== "blocked",
		score: normalizedScore,
		recommendedFormat,
		recommendedAngle,
		metrics: {
			sourceCount: sources.length,
			articleSourceCount: articleSources.length,
			videoSourceCount: videoSources.length,
			imageSourceCount: imageSources.length,
			factualSourceCount: factualSources.length,
			totalTextChars,
			datedSourceCount,
			eventTitleSourceCount,
			distinctPublisherCount,
			timelineEventCount,
			factCount,
			visualSourceCount,
			evidenceBitCount,
			longformReady,
			shortsReady,
		},
		issues,
		requiredActions: actions,
		reframeOptions,
		searchQueries,
		promptDirectives,
	};
}

export function formatTopicProductionReadinessForPrompt(
	report: TopicProductionReadinessReport,
): string {
	const metrics = report.metrics;
	const issues = report.issues
		.map((issue) => `- [${issue.severity}] ${issue.message}`)
		.join("\n");
	const actions = report.requiredActions.map((action) => `- ${action}`).join("\n");
	const directives = report.promptDirectives
		.map((directive) => `- ${directive}`)
		.join("\n");
	const reframes = report.reframeOptions.map((option) => `- ${option}`).join("\n");

	return `=== 프리프로덕션 제작성 평가 ===
점수: ${report.score}/100
상태: ${report.status}
추천 형식: ${report.recommendedFormat}
추천 각도: ${report.recommendedAngle}
자료 지표: 전체 ${metrics.sourceCount}개, 기사 ${metrics.articleSourceCount}개, 영상 ${metrics.videoSourceCount}개, 이미지 ${metrics.imageSourceCount}개, 팩트 자료 ${metrics.factualSourceCount}개, 본문 ${metrics.totalTextChars}자, 타임라인 ${metrics.timelineEventCount}개, 팩트 ${metrics.factCount}개

제작 지시:
${directives || "- 자료 기반으로 압축 구성하세요."}

감지된 약점:
${issues || "- 치명적인 약점 없음"}

보강/재기획 액션:
${actions || "- 현재 자료로 진행 가능"}

재기획 옵션:
${reframes || "- 현재 각도 유지"}`;
}
