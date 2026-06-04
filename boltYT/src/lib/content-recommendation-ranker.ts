import type { ReferenceTemplate } from "../types/database";
import type { NicheResearchHandoff } from "./niche-research";
import { inferCategoryProfile } from "./reference-topic-planner";
import {
	formatDurationRange,
	getYouTubeDomainIntelligence,
	recommendDurationBand,
	type DomainFormat,
} from "./youtube-domain-intelligence";

export type RecommendationFormat = "shorts" | "longform" | "both";
export type RecommendationMode = "ai" | "research" | "animation";

export interface RecommendationSourceInput {
	type?: string | null;
	title?: string | null;
	description?: string | null;
	bodyText?: string | null;
	publisher?: string | null;
	url?: string | null;
}

export interface ContentPerformanceSample {
	uploadId: string;
	title?: string | null;
	description?: string | null;
	tags?: string[] | null;
	format?: RecommendationFormat | string | null;
	durationSeconds?: number | null;
	publishedAt?: string | null;
	metrics?: {
		views?: number | null;
		ctr?: number | null;
		avgWatchDuration?: number | null;
		avgViewPercentage?: number | null;
		likes?: number | null;
		comments?: number | null;
		subscribersGained?: number | null;
		retentionCurve?: Array<{
			elapsedVideoTimeRatio: number;
			audienceWatchRatio: number;
			relativeRetentionPerformance?: number | null;
		}> | null;
	};
}

export interface RankedScriptRecommendation {
	id: string;
	rank: number;
	score: number;
	title: string;
	format: RecommendationFormat;
	goal: "new_viewers" | "subscriber_conversion" | "watch_time";
	hook: string;
	structure: string;
	viewerQuestion: string;
	endingBeat: string;
	durationLabel: string;
	scriptBeats: string[];
	thumbnailAngle: string;
	reasons: string[];
	risks: string[];
	promptDirectives: string[];
}

export interface RankedHookRecommendation {
	rank: number;
	score: number;
	pattern: "question" | "shock" | "claim" | "story";
	text: string;
	reason: string;
}

export interface RankedThumbnailIdea {
	rank: number;
	score: number;
	text: string;
	layout: string;
	visualCue: string;
	reason: string;
}

export interface RankedFormatChoice {
	rank: number;
	format: RecommendationFormat;
	score: number;
	label: string;
	durationRange: string;
	reason: string;
}

export interface ContentRecommendationPlan {
	topicTitle: string;
	categoryId: string;
	categoryLabel: string;
	confidence: "low" | "medium" | "high";
	topSummary: string;
	performanceFeedback: ContentPerformanceFeedback;
	scripts: RankedScriptRecommendation[];
	hooks: RankedHookRecommendation[];
	thumbnails: RankedThumbnailIdea[];
	formats: RankedFormatChoice[];
	evidence: string[];
	qualityGates: string[];
}

export interface ContentRecommendationInput {
	topicTitle?: string | null;
	mode?: RecommendationMode;
	selectedFormat?: RecommendationFormat;
	sources?: RecommendationSourceInput[];
	referenceTemplate?: ReferenceTemplate | null;
	nicheHandoff?: NicheResearchHandoff | null;
	performanceHistory?: ContentPerformanceSample[];
}

export interface ContentPerformanceFeedback {
	sampleCount: number;
	confidence: "none" | "low" | "medium" | "high";
	winningFormat: DomainFormat | null;
	winningFormatScore: number;
	avgCtr: number | null;
	avgViewPercentage: number | null;
	avgWatchDuration: number | null;
	openingRetentionRisk: boolean;
	ctrRisk: boolean;
	topKeywords: Array<{ keyword: string; score: number; sampleCount: number }>;
	topSignals: string[];
	warnings: string[];
	scoreNotes: string[];
}

interface CategoryBlueprint {
	id: string;
	label: string;
	keywords: RegExp;
	defaultMode: RecommendationMode;
	scriptDirections: Array<{
		id: string;
		title: string;
		format: RecommendationFormat;
		goal: RankedScriptRecommendation["goal"];
		structure: string;
		angle: string;
		beats: string[];
		thumbnail: string;
		risks: string[];
	}>;
}

const CATEGORY_BLUEPRINTS: CategoryBlueprint[] = [
	{
		id: "mystery_doc",
		label: "미스터리/다큐",
		keywords:
			/미스터리|사건|기록|왕릉|유적|실종|범죄|다큐|비밀|의문|mystery|case|crime|documentary/i,
		defaultMode: "research",
		scriptDirections: [
			{
				id: "evidence-reversal",
				title: "증거 역전형 대본",
				format: "both",
				goal: "watch_time",
				structure:
					"첫 장면에서 결론처럼 보이는 단서를 제시하고, 지도/기록/반론을 순서대로 쌓아 마지막에 가장 강한 가설을 남김",
				angle: "처음엔 단순한 이야기처럼 보이지만 기록의 빈틈이 커지는 방향",
				beats: [
					"0-5초: 가장 이상한 단서 한 문장",
					"5-20초: 왜 이 단서가 이상한지 맥락 압축",
					"20-70초: 증거 1, 2, 3을 시각 자료로 제시",
					"후반: 반론을 먼저 인정한 뒤 남는 의문 회수",
				],
				thumbnail: "현장 이미지 + 노란 원형 표시 + '왜 여기만?'",
				risks: [
					"출처 없는 단정 표현",
					"괴담처럼 과장된 제목",
					"자료 없는 AI 이미지 의존",
				],
			},
			{
				id: "three-questions",
				title: "궁금증 3단 회수형",
				format: "shorts",
				goal: "new_viewers",
				structure:
					"시청자가 바로 이해할 수 있는 질문 3개를 던지고 각 질문을 1컷씩 회수해 댓글을 유도",
				angle: "모르는 사람도 60초 안에 따라올 수 있는 질문형 정리",
				beats: [
					"0-3초: 가장 강한 질문",
					"3-18초: 첫 번째 단서",
					"18-40초: 두 번째/세 번째 단서",
					"40-55초: 아직 풀리지 않은 질문으로 마감",
				],
				thumbnail: "질문 문구 4-6자 + 대상 클로즈업",
				risks: ["질문만 있고 답이 없는 구성", "제목과 본문 단서 불일치"],
			},
			{
				id: "timeline-doc",
				title: "타임라인 다큐형",
				format: "longform",
				goal: "subscriber_conversion",
				structure:
					"연도/장소/인물/공식 기록 순서로 사건을 정리하고 90-150초마다 새 자료를 투입",
				angle: "자료가 많을수록 구독 전환에 유리한 장기 시청형 구성",
				beats: [
					"0-20초: 결론을 암시하는 프롤로그",
					"20-90초: 전체 지도와 핵심 인물",
					"90초 이후: 챕터마다 새 증거와 반론",
					"마지막: 가장 설득력 있는 해석과 다음 편 예고",
				],
				thumbnail: "지도/문서/인물 실루엣을 삼각 구도로 배치",
				risks: ["20분 초과", "긴 설명만 있고 장면 전환 부족", "출처 앵커 부족"],
			},
		],
	},
	{
		id: "drama_recap",
		label: "드라마/영화 해설",
		keywords:
			/드라마|영화|결말|복선|리캡|몰아보기|캐릭터|movie|film|recap|ending/i,
		defaultMode: "research",
		scriptDirections: [
			{
				id: "ending-backsolve",
				title: "결말 역산 복선형",
				format: "longform",
				goal: "watch_time",
				structure:
					"결말의 충격을 먼저 제시하고 초반 장면으로 되돌아가 복선을 하나씩 회수",
				angle: "이미 본 사람도 다시 보게 만드는 해설형 구성",
				beats: [
					"0-15초: 결말을 다시 보게 만드는 질문",
					"15-90초: 인물 관계와 갈등 압축",
					"중반: 장면별 복선 4-6개 회수",
					"후반: 캐릭터 선택의 의미 정리",
				],
				thumbnail: "인물 표정 2분할 + '이미 정해져 있었다'",
				risks: ["원본 장면 장시간 재사용", "비평/해설 없이 줄거리만 요약"],
			},
			{
				id: "one-scene-short",
				title: "한 장면 해부형",
				format: "shorts",
				goal: "new_viewers",
				structure: "한 장면의 대사/표정/소품 하나만 골라 짧게 의미를 뒤집음",
				angle: "클립 소비자에게 맞춘 고밀도 쇼츠",
				beats: [
					"0-3초: 놓친 장면 지목",
					"3-25초: 대사와 표정의 의미",
					"25-45초: 결말과 연결",
					"마지막: 다시 보면 달라지는 포인트",
				],
				thumbnail: "장면 클로즈업 + 작은 화살표",
				risks: ["스포일러 경고 누락", "공식 소재 외 불법 영상 사용"],
			},
		],
	},
	{
		id: "social_clip",
		label: "사회/이슈 클립",
		keywords:
			/뉴스|이슈|논란|반응|댓글|사회|사건|해외|정리|news|issue|reaction|social/i,
		defaultMode: "research",
		scriptDirections: [
			{
				id: "two-side-contrast",
				title: "양쪽 논리 대조형",
				format: "shorts",
				goal: "new_viewers",
				structure:
					"첫 5초에 쟁점을 던지고 사실, A측 주장, B측 주장, 남은 변수 순서로 정리",
				angle: "댓글이 갈리는 이슈를 안전하게 정리",
				beats: [
					"0-5초: 왜 논란인지 한 문장",
					"5-18초: 확인된 사실",
					"18-42초: 양쪽 논리 대조",
					"42-58초: 다음 변수와 질문",
				],
				thumbnail: "A/B 대립 구도 + 핵심 숫자 1개",
				risks: ["확인 안 된 주장", "개인 신상 노출", "모욕적 표현"],
			},
			{
				id: "context-briefing",
				title: "맥락 브리핑형",
				format: "longform",
				goal: "watch_time",
				structure:
					"사건 발생, 여론 변화, 공식 입장, 앞으로의 변수 순서로 챕터화",
				angle: "뉴스 제목만 본 사람에게 전체 맥락 제공",
				beats: [
					"0-20초: 오늘 왜 중요한지",
					"20-120초: 핵심 타임라인",
					"중반: 이해관계자별 입장",
					"후반: 다음 관전 포인트",
				],
				thumbnail: "타임라인 그래픽 + '지금 봐야 하는 이유'",
				risks: ["정치/사회 이슈의 단정적 프레이밍", "출처 편향"],
			},
		],
	},
	{
		id: "business",
		label: "비즈니스/자동화",
		keywords:
			/자동화|수익|비즈니스|창업|\bai\b|워크플로우|툴|개발자|automation|business|startup|workflow/i,
		defaultMode: "ai",
		scriptDirections: [
			{
				id: "failure-autopsy",
				title: "실패 원인 해부형",
				format: "both",
				goal: "subscriber_conversion",
				structure:
					"실패 사례를 먼저 보여주고 병목, 데이터, 자동화, 운영 루틴 순서로 개선안을 제시",
				angle: "과장된 수익 약속이 아니라 검증 가능한 운영 방식 중심",
				beats: [
					"0-5초: 실패한 이유 한 문장",
					"5-35초: 병목과 데이터 부족",
					"중반: 자동화 워크플로우",
					"마지막: 재현 가능한 체크리스트",
				],
				thumbnail: "전/후 비교 화면 + '여기서 망함'",
				risks: ["수익 보장 표현", "툴 홍보처럼 보이는 구성", "근거 없는 숫자"],
			},
			{
				id: "workflow-demo",
				title: "워크플로우 실전형",
				format: "longform",
				goal: "watch_time",
				structure:
					"실제 화면 캡처, 입력 데이터, 자동화 단계, 결과 검증까지 순서대로 보여줌",
				angle: "도구보다 병목 제거 원리를 보여주는 실전 튜토리얼",
				beats: [
					"0-20초: 완성 결과 미리보기",
					"20-120초: 데이터 수집 기준",
					"중반: 자동화 단계별 실행",
					"후반: 실패 케이스와 개선 루프",
				],
				thumbnail: "대시보드 캡처 + 핵심 KPI 1개",
				risks: ["개인 키/계정 노출", "외부 링크 유도 과다", "결과 과장"],
			},
		],
	},
	{
		id: "animation",
		label: "애니메이션/스토리",
		keywords:
			/애니|캐릭터|스토리|상황극|공포|개그|cartoon|animation|character|story/i,
		defaultMode: "animation",
		scriptDirections: [
			{
				id: "character-loop",
				title: "캐릭터 루프 반전형",
				format: "shorts",
				goal: "new_viewers",
				structure:
					"같은 행동을 2번 반복해 패턴을 만들고 세 번째에 예상과 다른 결과로 반전",
				angle: "표정, 소품, 리액션으로 이해되는 짧은 이야기",
				beats: [
					"0-3초: 이상한 행동 시작",
					"3-20초: 반복 1, 2회",
					"20-45초: 세 번째 반전",
					"마지막: 말보다 행동으로 교훈",
				],
				thumbnail: "캐릭터 표정 3단 변화",
				risks: ["기존 캐릭터 외형/말투 복제", "대사만 많은 애니메이션"],
			},
			{
				id: "short-horror",
				title: "짧은 공포 빌드업형",
				format: "shorts",
				goal: "watch_time",
				structure:
					"평범한 상황에서 시각적 불일치를 하나씩 늘려 마지막 컷에서 정체를 암시",
				angle: "설명보다 화면 변화로 긴장감 생성",
				beats: [
					"0-4초: 평범하지만 이상한 첫 프레임",
					"4-25초: 배경 변화 2회",
					"25-50초: 주인공이 깨닫는 순간",
					"마지막: 직접 보여주지 않는 여운",
				],
				thumbnail: "어두운 배경 + 뒤쪽 실루엣",
				risks: ["잔혹성 과다", "점프스케어만 반복"],
			},
		],
	},
];

const FALLBACK_CATEGORY = CATEGORY_BLUEPRINTS[0];

export function buildContentRecommendationPlan(
	input: ContentRecommendationInput,
): ContentRecommendationPlan {
	const topicTitle = normalizeTopic(input.topicTitle);
	const blueprint = resolveCategory(input);
	const sourceMetrics = measureSources(input.sources ?? []);
	const performanceFeedback = summarizePerformanceFeedback(
		input.performanceHistory ?? [],
		topicTitle,
	);
	const domainFormat = recommendedDomainFormat(input, blueprint, sourceMetrics);
	const domainIntel = getYouTubeDomainIntelligence({
		categoryId: blueprint.id,
		format: domainFormat,
	});
	const scripts = rankScriptRecommendations({
		topicTitle,
		blueprint,
		input,
		sourceMetrics,
		domainFormat,
		performanceFeedback,
	});
	const hooks = rankHooks(topicTitle, input, blueprint, performanceFeedback);
	const thumbnails = rankThumbnails(
		topicTitle,
		blueprint,
		input,
		performanceFeedback,
		scripts[0],
	);
	const formats = rankFormats({
		input,
		blueprint,
		sourceMetrics,
		performanceFeedback,
	});
	const evidence = buildEvidence(
		input,
		blueprint,
		sourceMetrics,
		domainIntel.productionRules,
		performanceFeedback,
	);
	const qualityGates = [
		"첫 3-5초 안에 제목의 약속을 실제 장면/문장으로 회수",
		"쇼츠는 첫 10초 3컷 이상, 롱폼은 90-150초마다 새 증거/인물/반론 투입",
		"썸네일 문구는 제목 반복이 아니라 클릭 이유를 따로 제공",
		"레퍼런스는 편집 문법만 차용하고 원문/자막/BGM 고유 표현은 복제하지 않음",
		...performanceFeedback.warnings,
	];

	return {
		topicTitle,
		categoryId: blueprint.id,
		categoryLabel: blueprint.label,
		confidence: confidenceLevel(input, sourceMetrics, performanceFeedback),
		topSummary: scripts[0]
			? `1순위는 ${scripts[0].title}입니다. ${scripts[0].reasons[0]}${performanceFeedback.sampleCount ? ` 최근 성과 ${performanceFeedback.sampleCount}개도 점수에 반영했습니다.` : ""}`
			: "주제를 입력하면 대본 방향을 점수화합니다.",
		performanceFeedback,
		scripts,
		hooks,
		thumbnails,
		formats,
		evidence,
		qualityGates,
	};
}

export function pickTopContentRecommendation(
	plan: ContentRecommendationPlan,
): RankedScriptRecommendation | null {
	return plan.scripts[0] ?? null;
}

function rankScriptRecommendations(params: {
	topicTitle: string;
	blueprint: CategoryBlueprint;
	input: ContentRecommendationInput;
	sourceMetrics: ReturnType<typeof measureSources>;
	domainFormat: DomainFormat;
	performanceFeedback: ContentPerformanceFeedback;
}): RankedScriptRecommendation[] {
	const {
		topicTitle,
		blueprint,
		input,
		sourceMetrics,
		domainFormat,
		performanceFeedback,
	} = params;
	const candidates = blueprint.scriptDirections.map((direction, index) => {
		const candidateFormat =
			direction.format === "both" ? domainFormat : direction.format;
		const durationBand = recommendDurationBand({
			categoryId: blueprint.id,
			format: candidateFormat,
			goal:
				direction.goal === "new_viewers"
					? "new_viewers"
					: direction.goal === "subscriber_conversion"
						? "subscriber_conversion"
						: "returning_viewers",
		});
		const score = scoreScriptDirection({
			direction,
			input,
			sourceMetrics,
			blueprint,
			candidateFormat,
			index,
			performanceFeedback,
		});
		const hook = buildHookText(topicTitle, input, direction.angle, index);
		return {
			id: direction.id,
			rank: 0,
			score,
			title: direction.title,
			format: direction.format,
			goal: direction.goal,
			hook,
			structure: direction.structure,
			viewerQuestion: buildViewerQuestion(topicTitle, blueprint),
			endingBeat: buildEndingBeat(topicTitle, direction.goal),
			durationLabel: formatDurationRange(durationBand),
			scriptBeats: direction.beats,
			thumbnailAngle: direction.thumbnail,
			reasons: buildScriptReasons(
				input,
				sourceMetrics,
				direction,
				blueprint,
				performanceFeedback,
			),
			risks: direction.risks,
			promptDirectives: [
				`대본 방향: ${direction.structure}`,
				`훅: ${hook}`,
				`길이 기준: ${formatDurationRange(durationBand)}`,
				`금지: ${direction.risks.slice(0, 2).join(" / ")}`,
			],
		} satisfies RankedScriptRecommendation;
	});

	return candidates
		.sort((a, b) => b.score - a.score)
		.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function rankHooks(
	topicTitle: string,
	input: ContentRecommendationInput,
	blueprint: CategoryBlueprint,
	performanceFeedback: ContentPerformanceFeedback,
): RankedHookRecommendation[] {
	const preferredPattern = input.referenceTemplate?.hook_pattern || "question";
	const hooks: Array<
		Omit<RankedHookRecommendation, "rank" | "score"> & { base: number }
	> = [
		{
			pattern: "question",
			text: `${topicTitle}, 왜 사람들은 이 지점을 놓쳤을까요?`,
			reason: "댓글과 시청 지속을 동시에 노리는 질문형 훅",
			base: preferredPattern === "question" ? 92 : 84,
		},
		{
			pattern: "shock",
			text: `처음엔 아무도 ${topicTitle}이 이렇게 이어질 줄 몰랐습니다.`,
			reason: "첫 3초 이탈을 줄이는 반전 예고형 훅",
			base: preferredPattern === "shock" ? 92 : 82,
		},
		{
			pattern: "claim",
			text: `${topicTitle}의 핵심은 알려진 이야기와 다릅니다.`,
			reason: "해설/다큐형 영상에서 권위 있는 주장으로 시작",
			base: preferredPattern === "claim" ? 91 : 80,
		},
		{
			pattern: "story",
			text: `모든 건 ${topicTitle}의 아주 작은 장면에서 시작됐습니다.`,
			reason: `${blueprint.label}에서 사건 흐름을 빠르게 열 수 있는 스토리형 훅`,
			base: preferredPattern === "story" ? 91 : 81,
		},
	];
	const nicheBoost = input.nicheHandoff?.playbook.openingFormula.length ? 4 : 0;
	const retentionBoost = performanceFeedback.openingRetentionRisk ? 4 : 0;
	return hooks
		.map((hook) => ({
			...hook,
			score: Math.min(
				99,
				hook.base +
					nicheBoost +
					(hook.pattern === "question" || hook.pattern === "shock"
						? retentionBoost
						: 0),
			),
		}))
		.sort((a, b) => b.score - a.score)
		.map(({ base: _base, ...hook }, index) => ({ ...hook, rank: index + 1 }));
}

function rankThumbnails(
	topicTitle: string,
	blueprint: CategoryBlueprint,
	input: ContentRecommendationInput,
	performanceFeedback: ContentPerformanceFeedback,
	topScript?: RankedScriptRecommendation,
): RankedThumbnailIdea[] {
	const compactTopic = compactThumbnailText(topicTitle);
	const accent = input.referenceTemplate?.subtitle_accent_color || "#f1c75b";
	const ideas: Array<Omit<RankedThumbnailIdea, "rank">> = [
		{
			score: performanceFeedback.ctrRisk ? 96 : 92,
			text: compactTopic,
			layout: "큰 피사체 1개 + 대비 강한 3-6자 문구 + 작은 증거 표시",
			visualCue: `${input.referenceTemplate?.visual_mood ?? blueprint.label} 무드, 포인트 컬러 ${accent}`,
			reason: "제목을 반복하지 않고 클릭 이유를 시각적으로 분리",
		},
		{
			score: performanceFeedback.ctrRisk ? 92 : 88,
			text: topScript?.thumbnailAngle ?? `${compactTopic}의 단서`,
			layout: "좌측 현장/인물, 우측 문구, 중앙 화살표 또는 원형 강조",
			visualCue: "모바일에서 보이는 큰 대비와 단일 초점",
			reason: "쇼츠 첫 프레임과 롱폼 썸네일을 같은 클릭 패키지로 유지",
		},
		{
			score: 84,
			text: "왜 여기만?",
			layout: "지도/문서/화면 캡처 위에 작은 원형 마킹",
			visualCue: "증거 자료를 보여주는 다큐형 썸네일",
			reason: "자료 기반 영상에서 신뢰도와 궁금증을 동시에 제공",
		},
	];
	return ideas
		.sort((a, b) => b.score - a.score)
		.map((idea, index) => ({ ...idea, rank: index + 1 }));
}

function rankFormats(params: {
	input: ContentRecommendationInput;
	blueprint: CategoryBlueprint;
	sourceMetrics: ReturnType<typeof measureSources>;
	performanceFeedback: ContentPerformanceFeedback;
}): RankedFormatChoice[] {
	const { input, blueprint, sourceMetrics, performanceFeedback } = params;
	const choices: Array<Omit<RankedFormatChoice, "rank">> = [
		buildFormatChoice(
			"shorts",
			input,
			blueprint,
			sourceMetrics,
			performanceFeedback,
		),
		buildFormatChoice(
			"longform",
			input,
			blueprint,
			sourceMetrics,
			performanceFeedback,
		),
		buildFormatChoice(
			"both",
			input,
			blueprint,
			sourceMetrics,
			performanceFeedback,
		),
	];
	return choices
		.sort((a, b) => b.score - a.score)
		.map((choice, index) => ({ ...choice, rank: index + 1 }));
}

function buildFormatChoice(
	format: RecommendationFormat,
	input: ContentRecommendationInput,
	blueprint: CategoryBlueprint,
	sourceMetrics: ReturnType<typeof measureSources>,
	performanceFeedback: ContentPerformanceFeedback,
): Omit<RankedFormatChoice, "rank"> {
	const domainFormat: DomainFormat =
		format === "longform" ? "longform" : "shorts";
	const durationBand = recommendDurationBand({
		categoryId: blueprint.id,
		format: domainFormat,
	});
	let score = format === "both" ? 82 : 78;
	if (input.selectedFormat === format) score += 6;
	if (input.selectedFormat === "both" && format !== "both") score += 2;
	if (input.referenceTemplate) {
		const templatePrefersLongform =
			input.referenceTemplate.duration_seconds >= 180 ||
			input.referenceTemplate.scene_count >= 12;
		if ((format === "longform" || format === "both") && templatePrefersLongform)
			score += 8;
		if (format === "shorts" && !templatePrefersLongform) score += 8;
	}
	if (format === "longform" && sourceMetrics.total >= 5) score += 6;
	if (
		format === "longform" &&
		input.mode === "research" &&
		sourceMetrics.total < 3
	)
		score -= 12;
	if (format === "shorts" && sourceMetrics.total < 3) score += 4;
	if (format === "both" && sourceMetrics.hasMixedMedia) score += 5;
	if (performanceFeedback.winningFormat) {
		if (format === performanceFeedback.winningFormat) score += 9;
		if (format === "both") score += 4;
	}

	return {
		format,
		score: clampScore(score),
		label:
			format === "both"
				? "쇼츠+롱폼 동시 제작"
				: format === "shorts"
					? "쇼츠 우선"
					: "롱폼 우선",
		durationRange:
			format === "both"
				? `쇼츠 ${formatDurationRange(
						recommendDurationBand({
							categoryId: blueprint.id,
							format: "shorts",
						}),
					)} / 롱폼 ${formatDurationRange(
						recommendDurationBand({
							categoryId: blueprint.id,
							format: "longform",
						}),
					)}`
				: formatDurationRange(durationBand),
		reason:
			performanceFeedback.winningFormat === format
				? `최근 성과에서 ${format === "longform" ? "롱폼" : "쇼츠"} 지표가 가장 강합니다.`
				: format === "longform"
					? "자료와 해설 밀도가 충분할 때 시청시간/구독 전환에 유리"
					: format === "shorts"
						? "주제 검증과 신규 유입 테스트에 빠름"
						: "쇼츠로 반응을 보고 같은 편집 문법으로 롱폼 확장 가능",
	};
}

function scoreScriptDirection(params: {
	direction: CategoryBlueprint["scriptDirections"][number];
	input: ContentRecommendationInput;
	sourceMetrics: ReturnType<typeof measureSources>;
	blueprint: CategoryBlueprint;
	candidateFormat: DomainFormat;
	index: number;
	performanceFeedback: ContentPerformanceFeedback;
}): number {
	const {
		direction,
		input,
		sourceMetrics,
		blueprint,
		candidateFormat,
		index,
		performanceFeedback,
	} = params;
	let score = 72 - index * 2;
	if (direction.format === input.selectedFormat || direction.format === "both")
		score += 5;
	if (input.mode === blueprint.defaultMode) score += 4;
	if (input.referenceTemplate) {
		score += 5;
		if (
			input.referenceTemplate.hook_duration > 0 &&
			input.referenceTemplate.hook_duration <= 5
		) {
			score += 4;
		}
		if (
			input.referenceTemplate.pacing_preset === "fast" &&
			candidateFormat === "shorts"
		)
			score += 4;
		if (
			input.referenceTemplate.duration_seconds >= 180 &&
			candidateFormat === "longform"
		)
			score += 5;
		if (input.referenceTemplate.script_structure?.length) score += 3;
	}
	if (input.nicheHandoff) {
		score += Math.round(input.nicheHandoff.playbook.score / 12);
		if (input.nicheHandoff.formatAnalysis?.summary.rules.length) score += 3;
	}
	if (sourceMetrics.total >= 5 && candidateFormat === "longform") score += 7;
	if (sourceMetrics.total >= 2 && candidateFormat === "shorts") score += 4;
	if (input.mode === "research" && sourceMetrics.total === 0) score -= 10;
	if (blueprint.id === "animation" && input.mode === "animation") score += 8;
	if (performanceFeedback.winningFormat === candidateFormat) score += 7;
	if (
		performanceFeedback.openingRetentionRisk &&
		direction.goal === "watch_time"
	) {
		score += 5;
	}
	if (performanceFeedback.ctrRisk && direction.goal === "new_viewers") {
		score += 4;
	}
	if (performanceFeedback.topKeywords.length > 0) {
		score += Math.min(
			5,
			Math.round(performanceFeedback.topKeywords[0].score / 80),
		);
	}
	return clampScore(score);
}

function buildScriptReasons(
	input: ContentRecommendationInput,
	sourceMetrics: ReturnType<typeof measureSources>,
	direction: CategoryBlueprint["scriptDirections"][number],
	blueprint: CategoryBlueprint,
	performanceFeedback: ContentPerformanceFeedback,
): string[] {
	const reasons = [
		`${blueprint.label} 주제와 ${direction.title} 구조가 가장 잘 맞습니다.`,
	];
	if (input.referenceTemplate) {
		reasons.push(
			`레퍼런스의 훅 ${input.referenceTemplate.hook_duration || "?"}초, 페이싱 ${input.referenceTemplate.pacing_preset}, 씬 ${input.referenceTemplate.scene_count}개를 반영했습니다.`,
		);
	}
	if (input.nicheHandoff) {
		reasons.push(
			`니치 리서치 점수 ${input.nicheHandoff.playbook.score}점과 오프닝 공식이 반영됐습니다.`,
		);
	}
	if (sourceMetrics.total > 0) {
		reasons.push(
			`현재 선택 자료 ${sourceMetrics.total}개, 본문 약 ${sourceMetrics.textChars.toLocaleString()}자를 근거로 사용할 수 있습니다.`,
		);
	}
	if (performanceFeedback.sampleCount > 0) {
		reasons.push(
			`최근 업로드 ${performanceFeedback.sampleCount}개 성과에서 ${
				performanceFeedback.winningFormat === "longform"
					? "롱폼"
					: performanceFeedback.winningFormat === "shorts"
						? "쇼츠"
						: "혼합 포맷"
			} 신호와 ${performanceFeedback.topKeywords
				.slice(0, 2)
				.map((item) => item.keyword)
				.join(", ")} 키워드를 반영했습니다.`,
		);
	}
	return reasons;
}

function buildEvidence(
	input: ContentRecommendationInput,
	blueprint: CategoryBlueprint,
	sourceMetrics: ReturnType<typeof measureSources>,
	productionRules: string[],
	performanceFeedback: ContentPerformanceFeedback,
): string[] {
	const evidence = [
		`카테고리 판정: ${blueprint.label}`,
		`YouTube 제작 규칙: ${productionRules.slice(0, 2).join(" / ")}`,
	];
	if (input.referenceTemplate) {
		evidence.push(
			`레퍼런스: ${input.referenceTemplate.name || input.referenceTemplate.source_title} · ${input.referenceTemplate.duration_seconds}초 · ${input.referenceTemplate.scene_count}씬`,
		);
	}
	if (input.nicheHandoff) {
		evidence.push(
			`니치 데이터: 중앙 조회수 ${Math.round(input.nicheHandoff.summary.medianViews).toLocaleString()} · 일평균 ${Math.round(input.nicheHandoff.summary.medianViewsPerDay).toLocaleString()}`,
		);
	}
	if (sourceMetrics.total > 0) {
		evidence.push(
			`선택 자료: ${sourceMetrics.total}개 · 영상 ${sourceMetrics.videoCount}개 · 이미지 ${sourceMetrics.imageCount}개 · 기사 ${sourceMetrics.articleCount}개`,
		);
	}
	if (performanceFeedback.sampleCount > 0) {
		evidence.push(
			`성과 피드백: 최근 ${performanceFeedback.sampleCount}개 · 평균 CTR ${
				performanceFeedback.avgCtr?.toFixed(1) ?? "?"
			}% · 평균 유지율 ${
				performanceFeedback.avgViewPercentage?.toFixed(1) ?? "?"
			}% · 우세 포맷 ${
				performanceFeedback.winningFormat === "longform"
					? "롱폼"
					: performanceFeedback.winningFormat === "shorts"
						? "쇼츠"
						: "없음"
			}`,
		);
	}
	return evidence;
}

function confidenceLevel(
	input: ContentRecommendationInput,
	sourceMetrics: ReturnType<typeof measureSources>,
	performanceFeedback: ContentPerformanceFeedback,
): ContentRecommendationPlan["confidence"] {
	let score = 0;
	if (normalizeTopic(input.topicTitle).length >= 8) score += 1;
	if (input.referenceTemplate) score += 1;
	if (input.nicheHandoff) score += 1;
	if (sourceMetrics.total >= 3 || input.mode !== "research") score += 1;
	if (performanceFeedback.confidence === "medium") score += 1;
	if (performanceFeedback.confidence === "high") score += 2;
	if (score >= 3) return "high";
	if (score >= 2) return "medium";
	return "low";
}

/** 텍스트에서 blueprint 키워드 정규식의 매치 개수(전역) — first-match 오분류 방지용 스코어. */
function countCategoryKeywordMatches(keywords: RegExp, text: string): number {
	const matches = text.match(new RegExp(keywords.source, "gi"));
	return matches ? matches.length : 0;
}

/** 가장 많이 매치된 카테고리 선택. 단순 first-match가 아니라 매치 수로 가려, 여러 카테고리
 *  키워드가 섞인 주제(예: '해외 뉴스 댓글이 갈린 사건')를 올바른 카테고리로 라우팅한다. */
function bestTopicCategoryMatch(text: string): CategoryBlueprint | null {
	let best: CategoryBlueprint | null = null;
	let bestScore = 0;
	for (const blueprint of CATEGORY_BLUEPRINTS) {
		const score = countCategoryKeywordMatches(blueprint.keywords, text);
		if (score > bestScore) {
			bestScore = score;
			best = blueprint;
		}
	}
	return best;
}

function resolveCategory(input: ContentRecommendationInput): CategoryBlueprint {
	const topicText = [
		input.topicTitle,
		input.nicheHandoff?.topic,
		input.nicheHandoff?.summary.query,
	]
		.filter(Boolean)
		.join(" ");
	const fromTopic =
		topicText.trim().length > 0 ? bestTopicCategoryMatch(topicText) : null;
	if (fromTopic) return fromTopic;

	if (input.referenceTemplate) {
		const profile = inferCategoryProfile(input.referenceTemplate);
		const fromTemplate =
			CATEGORY_BLUEPRINTS.find((blueprint) => blueprint.id === profile.id) ??
			null;
		if (fromTemplate) return fromTemplate;
	}
	const text = [
		input.referenceTemplate?.name,
		input.referenceTemplate?.source_title,
	]
		.filter(Boolean)
		.join(" ");
	return (
		CATEGORY_BLUEPRINTS.find((blueprint) => blueprint.keywords.test(text)) ??
		FALLBACK_CATEGORY
	);
}

function recommendedDomainFormat(
	input: ContentRecommendationInput,
	blueprint: CategoryBlueprint,
	sourceMetrics: ReturnType<typeof measureSources>,
): DomainFormat {
	if (input.selectedFormat === "shorts") return "shorts";
	if (input.selectedFormat === "longform") return "longform";
	if (
		input.referenceTemplate?.duration_seconds &&
		input.referenceTemplate.duration_seconds >= 180
	) {
		return "longform";
	}
	if (sourceMetrics.total >= 5 && input.mode === "research") return "longform";
	if (blueprint.id === "drama_recap") return "longform";
	return "shorts";
}

function summarizePerformanceFeedback(
	samples: ContentPerformanceSample[],
	topicTitle: string,
): ContentPerformanceFeedback {
	const usable = samples
		.filter((sample) => sample.uploadId && sample.metrics)
		.slice(0, 80);
	if (usable.length === 0) {
		return {
			sampleCount: 0,
			confidence: "none",
			winningFormat: null,
			winningFormatScore: 0,
			avgCtr: null,
			avgViewPercentage: null,
			avgWatchDuration: null,
			openingRetentionRisk: false,
			ctrRisk: false,
			topKeywords: [],
			topSignals: [
				"아직 업로드 성과 데이터가 없어 기본 도메인 규칙으로만 추천합니다.",
			],
			warnings: [],
			scoreNotes: [],
		};
	}

	const formatScores = new Map<
		DomainFormat,
		{ score: number; count: number }
	>();
	const keywordScores = new Map<
		string,
		{ score: number; sampleIds: Set<string> }
	>();
	const topicTokens = new Set(tokenizeRecommendationText(topicTitle));
	const ctrValues: number[] = [];
	const viewPercentageValues: number[] = [];
	const watchDurationValues: number[] = [];
	let retentionRiskCount = 0;

	for (const sample of usable) {
		const metrics = sample.metrics ?? {};
		const score = performanceSampleScore(sample);
		const format = normalizePerformanceFormat(sample);
		if (format) {
			const current = formatScores.get(format) ?? { score: 0, count: 0 };
			current.score += score;
			current.count += 1;
			formatScores.set(format, current);
		}
		const ctr = finiteMetric(metrics.ctr);
		const avgViewPercentage = finiteMetric(metrics.avgViewPercentage);
		const avgWatchDuration = finiteMetric(metrics.avgWatchDuration);
		if (ctr != null && ctr > 0) ctrValues.push(ctr);
		if (avgViewPercentage != null && avgViewPercentage > 0) {
			viewPercentageValues.push(avgViewPercentage);
		}
		if (avgWatchDuration != null && avgWatchDuration > 0) {
			watchDurationValues.push(avgWatchDuration);
		}
		if (hasOpeningRetentionRisk(metrics.retentionCurve ?? null)) {
			retentionRiskCount += 1;
		}
		const sampleTokens = new Set(
			tokenizeRecommendationText(
				[sample.title, sample.description, ...(sample.tags ?? [])]
					.filter(Boolean)
					.join(" "),
			),
		);
		for (const token of sampleTokens) {
			const current = keywordScores.get(token) ?? {
				score: 0,
				sampleIds: new Set<string>(),
			};
			const topicBoost = topicTokens.has(token) ? 1.35 : 1;
			current.score += score * topicBoost;
			current.sampleIds.add(sample.uploadId);
			keywordScores.set(token, current);
		}
	}

	const rankedFormats = [...formatScores.entries()]
		.map(([format, item]) => ({
			format,
			score: item.count ? item.score / item.count : 0,
			count: item.count,
		}))
		.sort((a, b) => b.score - a.score || b.count - a.count);
	const avgCtr = averageOrNull(ctrValues);
	const avgViewPercentage = averageOrNull(viewPercentageValues);
	const avgWatchDuration = averageOrNull(watchDurationValues);
	const topKeywords = [...keywordScores.entries()]
		.map(([keyword, item]) => ({
			keyword,
			score: Math.round(item.score),
			sampleCount: item.sampleIds.size,
		}))
		.sort((a, b) => b.score - a.score || b.sampleCount - a.sampleCount)
		.slice(0, 6);
	const winningFormat = rankedFormats[0]?.format ?? null;
	const openingRetentionRisk =
		retentionRiskCount > 0 && retentionRiskCount / usable.length >= 0.28;
	const ctrRisk = avgCtr != null && avgCtr < 4.2;
	const warnings: string[] = [];
	if (ctrRisk) {
		warnings.push(
			"최근 평균 CTR이 낮습니다. 썸네일은 제목 반복보다 증거/감정/대립 구도를 더 강하게 분리하세요.",
		);
	}
	if (avgViewPercentage != null && avgViewPercentage < 42) {
		warnings.push(
			"최근 평균 유지율이 낮습니다. 대본 초반 30초 안에 결론 암시, 전환 컷, 새 단서를 모두 넣으세요.",
		);
	}
	if (openingRetentionRisk) {
		warnings.push(
			"초반 유지율 급락 샘플이 많습니다. 첫 문장 이후 5-8초 안에 두 번째 장면 전환을 강제하세요.",
		);
	}

	const topSignals = [
		winningFormat
			? `최근 성과 우세 포맷: ${winningFormat === "longform" ? "롱폼" : "쇼츠"}`
			: "포맷별 성과 차이가 아직 충분하지 않습니다.",
		avgCtr != null ? `평균 CTR ${avgCtr.toFixed(1)}%` : "CTR 데이터 부족",
		avgViewPercentage != null
			? `평균 유지율 ${avgViewPercentage.toFixed(1)}%`
			: "평균 유지율 데이터 부족",
		topKeywords[0]
			? `성과 키워드: ${topKeywords
					.slice(0, 3)
					.map((item) => item.keyword)
					.join(", ")}`
			: "성과 키워드 부족",
	];

	return {
		sampleCount: usable.length,
		confidence:
			usable.length >= 12 ? "high" : usable.length >= 5 ? "medium" : "low",
		winningFormat,
		winningFormatScore: Math.round(rankedFormats[0]?.score ?? 0),
		avgCtr,
		avgViewPercentage,
		avgWatchDuration,
		openingRetentionRisk,
		ctrRisk,
		topKeywords,
		topSignals,
		warnings,
		scoreNotes: [
			"CTR은 훅/썸네일/제목 추천에 반영",
			"평균 유지율과 초반 retention curve는 대본 구조와 훅 패턴에 반영",
			"포맷별 성과 평균은 쇼츠/롱폼 추천 순위에 반영",
		],
	};
}

function measureSources(sources: RecommendationSourceInput[]) {
	const videoCount = sources.filter((source) => source.type === "video").length;
	const imageCount = sources.filter((source) => source.type === "image").length;
	const articleCount = sources.filter(
		(source) => source.type === "article",
	).length;
	const textChars = sources.reduce(
		(sum, source) =>
			sum +
			(source.title?.length ?? 0) +
			(source.description?.length ?? 0) +
			(source.bodyText?.length ?? 0),
		0,
	);
	return {
		total: sources.length,
		videoCount,
		imageCount,
		articleCount,
		textChars,
		hasMixedMedia:
			[videoCount > 0, imageCount > 0, articleCount > 0].filter(Boolean)
				.length >= 2,
	};
}

function buildHookText(
	topicTitle: string,
	input: ContentRecommendationInput,
	angle: string,
	index: number,
): string {
	const nicheHook = input.nicheHandoff?.playbook.openingFormula[index];
	if (nicheHook) return `${topicTitle} - ${nicheHook}`;
	if (input.referenceTemplate?.hook_pattern === "shock") {
		return `처음엔 아무도 ${topicTitle}이 이렇게 끝날 줄 몰랐습니다.`;
	}
	if (input.referenceTemplate?.hook_pattern === "claim") {
		return `${topicTitle}의 핵심은 알려진 이야기와 다릅니다.`;
	}
	if (input.referenceTemplate?.hook_pattern === "story") {
		return `모든 건 ${topicTitle}의 작은 장면에서 시작됐습니다.`;
	}
	return `${topicTitle}, 왜 ${angle.replace(/\.$/, "")}일까요?`;
}

function buildViewerQuestion(
	topicTitle: string,
	blueprint: CategoryBlueprint,
): string {
	if (blueprint.id === "business")
		return `${topicTitle}에서 실제 병목은 무엇이었나?`;
	if (blueprint.id === "social_clip")
		return `${topicTitle}에서 사람들이 갈리는 진짜 쟁점은 무엇인가?`;
	if (blueprint.id === "drama_recap")
		return `${topicTitle}의 결말은 이미 어디서 예고됐나?`;
	if (blueprint.id === "animation")
		return `${topicTitle}의 마지막 행동은 왜 예상과 달랐나?`;
	return `${topicTitle}에서 아직 설명되지 않은 단서는 무엇인가?`;
}

function buildEndingBeat(
	topicTitle: string,
	goal: RankedScriptRecommendation["goal"],
): string {
	if (goal === "subscriber_conversion") {
		return `${topicTitle}의 다음 단서를 후속편에서 이어갈 수 있게 질문을 남긴다.`;
	}
	if (goal === "new_viewers") {
		return "댓글로 갈릴 수 있는 질문 하나를 남기되, 본문에서 최소 답변 하나는 제공한다.";
	}
	return "가장 강한 증거와 반론을 함께 남겨 억지 결론처럼 보이지 않게 마무리한다.";
}

function compactThumbnailText(topicTitle: string): string {
	const clean = topicTitle
		.replace(/#shorts/gi, "")
		.replace(/[?!！？]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const words = clean.split(/\s+/).filter(Boolean);
	if (words.length <= 3) return clean || "핵심 단서";
	return words.slice(0, 3).join(" ");
}

const RECOMMENDATION_STOPWORDS = new Set([
	"그리고",
	"하지만",
	"영상",
	"주제",
	"콘텐츠",
	"shorts",
	"youtube",
	"유튜브",
	"the",
	"and",
	"for",
	"with",
	"from",
]);

function performanceSampleScore(sample: ContentPerformanceSample): number {
	const metrics = sample.metrics ?? {};
	const views = finiteMetric(metrics.views) ?? 0;
	const ctr = finiteMetric(metrics.ctr) ?? 0;
	const avgViewPercentage = finiteMetric(metrics.avgViewPercentage) ?? 0;
	const avgWatchDuration = finiteMetric(metrics.avgWatchDuration) ?? 0;
	const likes = finiteMetric(metrics.likes) ?? 0;
	const comments = finiteMetric(metrics.comments) ?? 0;
	const subscribersGained = finiteMetric(metrics.subscribersGained) ?? 0;
	const duration = finiteMetric(sample.durationSeconds) ?? 0;
	const watchRatio =
		duration > 0 && avgWatchDuration > 0
			? Math.min(120, (avgWatchDuration / duration) * 100)
			: 0;
	return Math.max(
		1,
		Math.log10(views + 10) * 14 +
			ctr * 5 +
			avgViewPercentage * 1.1 +
			watchRatio * 0.7 +
			Math.log10(likes + 10) * 5 +
			Math.log10(comments + 10) * 6 +
			subscribersGained * 4,
	);
}

function normalizePerformanceFormat(
	sample: ContentPerformanceSample,
): DomainFormat | null {
	if (sample.format === "shorts" || sample.format === "longform") {
		return sample.format;
	}
	const duration = finiteMetric(sample.durationSeconds);
	if (duration != null && duration > 0)
		return duration > 180 ? "longform" : "shorts";
	return null;
}

function hasOpeningRetentionRisk(
	curve:
		| NonNullable<ContentPerformanceSample["metrics"]>["retentionCurve"]
		| null
		| undefined,
): boolean {
	if (!curve?.length) return false;
	const sorted = [...curve].sort(
		(a, b) => a.elapsedVideoTimeRatio - b.elapsedVideoTimeRatio,
	);
	const early =
		sorted.find((point) => point.elapsedVideoTimeRatio >= 0.05) ?? sorted[0];
	const later =
		sorted.find((point) => point.elapsedVideoTimeRatio >= 0.25) ??
		sorted[Math.min(2, sorted.length - 1)];
	const earlyRatio = finiteMetric(early?.audienceWatchRatio);
	const laterRatio = finiteMetric(later?.audienceWatchRatio);
	if (earlyRatio == null) return false;
	if (earlyRatio < 0.62) return true;
	return laterRatio != null && earlyRatio - laterRatio >= 0.28;
}

function tokenizeRecommendationText(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s#]/gu, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^#+/, "").trim())
		.filter(
			(token) => token.length >= 2 && !RECOMMENDATION_STOPWORDS.has(token),
		)
		.slice(0, 80);
}

function finiteMetric(value: number | null | undefined): number | null {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
}

function averageOrNull(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeTopic(value: string | null | undefined): string {
	return value?.replace(/\s+/g, " ").trim() || "입력한 주제";
}

function clampScore(score: number): number {
	return Math.max(0, Math.min(99, Math.round(score)));
}
