import type { ReferenceTemplate } from "../types/database";
import { getReferenceTemplateRecommendedMode } from "./reference-template-presets";
import {
	formatDurationRange,
	getYouTubeDomainIntelligence,
	recommendDurationBand,
} from "./youtube-domain-intelligence";

export type TopicGrowthGoal =
	| "new_viewers"
	| "subscriber_conversion"
	| "returning_viewers";

export interface ReferenceTopicIdea {
	id: string;
	title: string;
	format: "shorts" | "longform";
	score: number;
	goal: TopicGrowthGoal;
	angle: string;
	hook: string;
	targetDurationSeconds: number;
	durationRange: string;
	durationPlan: string[];
	thumbnailText: string;
	whyNow: string;
	sourcePlan: string[];
	riskControl: string;
	trendCluster: string;
	domainSignals: string[];
}

export interface ReferenceTopicPlan {
	inputPlaceholder: string;
	defaultTopic: string;
	recommendedMode: string;
	strategy: string[];
	domainKnowledge: {
		enforcementSummary: string[];
		trendSummary: string[];
		productionRules: string[];
	};
	ideas: ReferenceTopicIdea[];
	weeklyPlan: Array<{
		slot: string;
		action: string;
		reason: string;
	}>;
}

interface CategoryProfile {
	id: string;
	label: string;
	defaultTopic: string;
	seeds: string[];
	angles: string[];
	sourcePlan: string[];
	riskControl: string;
}

const CATEGORY_PROFILES: CategoryProfile[] = [
	{
		id: "drama_recap",
		label: "드라마/영화 해설",
		defaultTopic: "요즘 다시 보는 복수극 명장면의 숨은 복선",
		seeds: [
			"결말을 알고 다시 보면 완전히 달라지는 장면",
			"주인공이 첫 화부터 이미 무너지고 있었다는 증거",
			"악역보다 더 무서웠던 조력자의 선택",
			"시청자가 놓친 3초짜리 복선",
		],
		angles: [
			"결말에서 역산해 초반 복선을 회수",
			"인물 선택의 대가를 장면 순서대로 추적",
			"원작/설정/대사 차이를 증거처럼 제시",
		],
		sourcePlan: ["공식 예고편/스틸", "작품 소개", "공식 인물 관계", "리뷰/해설 자료"],
		riskControl: "원본 장면을 길게 그대로 쓰지 말고 요약, 비평, 해설 중심으로 재구성",
	},
	{
		id: "mystery_doc",
		label: "미스터리/다큐",
		defaultTopic: "기록에는 남았지만 설명되지 않은 한국의 미스터리 장소",
		seeds: [
			"지도에는 있는데 아무도 설명하지 못한 장소",
			"사라진 기록과 현장 사진이 서로 맞지 않는 사건",
			"한 장의 사진 때문에 다시 열린 미스터리",
			"전문가도 결론을 못 낸 오래된 발견",
		],
		angles: [
			"처음엔 단순한 사건처럼 보이게 시작하고 마지막에 기록의 빈틈을 공개",
			"지도, 기사, 증언 순서로 증거 밀도를 높임",
			"반박 가능한 가설 3개를 놓고 마지막에 가장 강한 설명을 남김",
		],
		sourcePlan: ["뉴스 기사", "지도/위성 이미지", "공식 기록", "현장 사진/자료 영상"],
		riskControl: "단정 표현을 피하고 출처가 약한 가설은 가능성으로만 표현",
	},
	{
		id: "social_clip",
		label: "사회/이슈 클립",
		defaultTopic: "지금 댓글이 갈리는 사회 이슈를 60초 안에 정리",
		seeds: [
			"오늘 가장 많이 갈린 댓글의 진짜 쟁점",
			"뉴스 제목만 보면 오해하기 쉬운 사건",
			"한 장면 때문에 여론이 바뀐 순간",
			"해외 반응과 국내 반응이 갈린 이유",
		],
		angles: [
			"처음 5초에 쟁점을 제시하고 양쪽 논리를 짧게 대조",
			"사실, 반응, 맥락, 다음 변수 순서로 정리",
			"시청자가 댓글을 달 수밖에 없는 질문으로 마무리",
		],
		sourcePlan: ["공식 발표", "뉴스 기사", "SNS 공개 반응", "통계/타임라인"],
		riskControl: "개인 신상, 모욕, 확인 안 된 주장은 제거하고 사실/의견을 분리",
	},
	{
		id: "business",
		label: "비즈니스/자동화",
		defaultTopic: "작은 채널이 자동화로 시간을 줄이는 실제 워크플로우",
		seeds: [
			"초보가 가장 먼저 자동화해야 하는 반복 작업",
			"돈보다 시간을 먼저 아껴야 하는 이유",
			"실패한 자동화와 성공한 자동화의 차이",
			"혼자 운영하는 채널의 주간 제작 루틴",
		],
		angles: [
			"실패 사례로 시작해 체크리스트로 회수",
			"전후 비교를 숫자로 보여주고 마지막에 실행 순서를 제공",
			"도구가 아니라 병목 제거 관점으로 설명",
		],
		sourcePlan: ["직접 캡처", "워크플로우 다이어그램", "성과 지표", "툴 비교표"],
		riskControl: "수익 보장처럼 보이는 표현을 피하고 조건과 한계를 함께 제시",
	},
	{
		id: "animation",
		label: "애니메이션/스토리",
		defaultTopic: "반복되는 선택 때문에 망하는 캐릭터의 짧은 이야기",
		seeds: [
			"작은 거짓말 하나가 하루를 망치는 이야기",
			"친구의 한마디를 오해한 캐릭터",
			"절대 누르면 안 되는 버튼을 누른 순간",
			"매번 같은 실수를 반복하는 주인공",
		],
		angles: [
			"반복 개그 2번 뒤 세 번째에 반전",
			"표정 변화와 소품 하나로 갈등을 압축",
			"교훈을 직접 말하지 않고 마지막 행동으로 보여줌",
		],
		sourcePlan: ["캐릭터 바이블", "소품/배경 리스트", "표정 시트", "SFX 큐"],
		riskControl: "기존 캐릭터 고유 외형이나 말투를 복제하지 않고 새 캐릭터로 구성",
	},
];

export function buildReferenceTopicPlan(
	template: ReferenceTemplate,
	seedTopic = "",
): ReferenceTopicPlan {
	const profile = inferCategoryProfile(template);
	const normalizedSeed = seedTopic.trim();
	const recommendedMode = getReferenceTemplateRecommendedMode(template);
	const format = recommendedMode === "animation" ? "shorts" : preferredFormat(template);
	const domainIntel = getYouTubeDomainIntelligence({
		categoryId: profile.id,
		format,
	});
	const topics = normalizedSeed
		? expandSeedTopic(normalizedSeed)
		: profile.seeds;
	const ideas = topics.slice(0, 6).map((topic, index) =>
		buildIdea({
			template,
			profile,
			topic,
			index,
			format: index % 3 === 1 ? alternateFormat(format) : format,
		}),
	);

	return {
		inputPlaceholder: `${profile.defaultTopic}처럼 주제만 입력`,
		defaultTopic: normalizedSeed || profile.defaultTopic,
		recommendedMode,
		strategy: [
			`${profile.label} 레퍼런스의 편집 문법은 유지하고 소재만 교체합니다.`,
			"처음에는 신규 유입용 강한 질문형 제목 2개, 구독 전환용 시리즈형 제목 1개를 함께 실험합니다.",
			"추천은 YouTube Analytics의 시청자 관심 콘텐츠, 제목/썸네일 반응, 노출 대비 시청시간을 확인하는 운영 방식에 맞춰 설계했습니다.",
			`${domainIntel.trendClusters[0]?.label ?? "검증된 트렌드"} 클러스터를 우선 반영하고, 반복 양산처럼 보이는 주제명 치환은 차단합니다.`,
		],
		domainKnowledge: {
			enforcementSummary: domainIntel.enforcementMetrics.slice(2, 6).map(
				(metric) => `${metric.label}: ${metric.displayValue} - ${metric.implication}`,
			),
			trendSummary: domainIntel.trendClusters.slice(0, 3).map(
				(cluster) =>
					`${cluster.label} S${cluster.score}: ${cluster.examples.slice(0, 3).join(", ")}`,
			),
			productionRules: domainIntel.productionRules,
		},
		ideas,
		weeklyPlan: buildWeeklyPlan(ideas),
	};
}

export function buildReferenceTopicContentUrl(params: {
	template: ReferenceTemplate;
	topic: string;
	channelId?: string;
}): string {
	const { template, topic, channelId } = params;
	const search = new URLSearchParams({
		template: template.id,
		mode: getReferenceTemplateRecommendedMode(template),
		source: "reference_topic",
		title: topic.trim(),
	});
	if (channelId || isUsableChannelId(template.channel_id)) {
		search.set("channel", channelId || template.channel_id);
	}
	return `/content/new?${search.toString()}`;
}

export function inferCategoryProfile(template: ReferenceTemplate): CategoryProfile {
	const text = [
		template.id,
		template.name,
		template.source_title,
		template.source_creator,
		template.visual_mood,
		template.bgm_mood,
		JSON.stringify(template.raw_analysis ?? {}),
	]
		.join(" ")
		.toLowerCase();
	if (/drama|movie|film|recap|드라마|영화|몰아보기|리캡/.test(text)) {
		return CATEGORY_PROFILES[0];
	}
	if (/business|automation|money|startup|자동화|수익|비즈니스/.test(text)) {
		return CATEGORY_PROFILES[3];
	}
	if (/animation|animated|cartoon|애니|캐릭터/.test(text)) {
		return CATEGORY_PROFILES[4];
	}
	if (
		/mystery|documentary|true crime|crime|case|doc|미스터리|사건|다큐|범죄|미제|기록/.test(
			text,
		)
	) {
		return CATEGORY_PROFILES[1];
	}
	if (/social|news|issue|clip|뉴스|이슈|사회|foreign/.test(text)) {
		return CATEGORY_PROFILES[2];
	}
	return CATEGORY_PROFILES[1];
}

function buildIdea(params: {
	template: ReferenceTemplate;
	profile: CategoryProfile;
	topic: string;
	index: number;
	format: "shorts" | "longform";
}): ReferenceTopicIdea {
	const { template, profile, topic, index, format } = params;
	const angle = profile.angles[index % profile.angles.length] ?? profile.angles[0];
	const hook = buildHook(topic, template.hook_pattern);
	const goal: TopicGrowthGoal =
		index % 3 === 0
			? "new_viewers"
			: index % 3 === 1
				? "subscriber_conversion"
				: "returning_viewers";
	const durationBand = recommendDurationBand({
		categoryId: profile.id,
		format,
		goal,
	});
	const domainIntel = getYouTubeDomainIntelligence({
		categoryId: profile.id,
		format,
	});
	const trendCluster = domainIntel.trendClusters[0];
	const score = Math.min(
		96,
		72 +
			(index === 0 ? 10 : 0) +
			(template.hook_duration > 0 && template.hook_duration <= 8 ? 4 : 0) +
			(template.pacing_preset === "fast" ? 4 : 0) +
			(format === "shorts" ? 3 : 5) +
			Math.round((trendCluster?.score ?? 70) / 30),
	);

	return {
		id: `${profile.id}-${index}`,
		title: normalizeTitle(topic, format),
		format,
		score,
		goal,
		angle,
		hook,
		targetDurationSeconds: durationBand.sweetSpotSeconds,
		durationRange: formatDurationRange(durationBand),
		durationPlan: durationBand.contentPlan,
		thumbnailText: buildThumbnailText(topic),
		whyNow:
			goal === "new_viewers"
				? "낯선 시청자가 제목만 보고도 궁금해할 질문형 소재입니다."
				: goal === "subscriber_conversion"
					? "시리즈로 이어가기 좋아 구독 전환 CTA를 넣기 쉽습니다."
					: "기존 시청자가 익숙한 문법으로 다시 돌아오기 좋은 후속 소재입니다.",
		sourcePlan: profile.sourcePlan,
		riskControl: `${profile.riskControl} · ${durationBand.riskControls[0] ?? "반복 양산 패턴 차단"}`,
		trendCluster: trendCluster?.label ?? "검증 트렌드",
		domainSignals: [
			...(trendCluster?.signals.slice(0, 2) ?? []),
			...(trendCluster?.recommendedAngles.slice(0, 1) ?? []),
		],
	};
}

function expandSeedTopic(seedTopic: string): string[] {
	return [
		seedTopic,
		`${seedTopic}에서 사람들이 가장 궁금해하는 3가지`,
		`${seedTopic}의 첫 장면에 숨겨진 단서`,
		`${seedTopic}를 반대로 보면 보이는 진짜 문제`,
		`${seedTopic} 이후 사람들이 놓친 장면`,
		`${seedTopic}를 시리즈로 만들 때 첫 번째 에피소드`,
	].map((topic, index) => (index === 0 ? topic : topic.replace(/\s+/g, " ").trim()));
}

function preferredFormat(template: ReferenceTemplate): "shorts" | "longform" {
	return template.duration_seconds >= 180 || template.scene_count >= 12
		? "longform"
		: "shorts";
}

function alternateFormat(format: "shorts" | "longform"): "shorts" | "longform" {
	return format === "shorts" ? "longform" : "shorts";
}

function buildHook(topic: string, hookPattern: ReferenceTemplate["hook_pattern"]): string {
	if (hookPattern === "shock") return `처음엔 아무도 ${topic}이 이렇게 끝날 줄 몰랐습니다.`;
	if (hookPattern === "claim") return `${topic}의 핵심은 알려진 이야기와 다릅니다.`;
	if (hookPattern === "story") return `모든 건 ${topic}의 아주 작은 장면에서 시작됐습니다.`;
	return `${topic}, 왜 사람들은 이 지점을 놓쳤을까요?`;
}

function normalizeTitle(topic: string, format: "shorts" | "longform"): string {
	const clean = topic.replace(/\s+/g, " ").trim();
	if (format === "shorts" && clean.length > 42) return clean;
	if (format === "shorts") return `${clean} #shorts`;
	return clean;
}

function buildThumbnailText(topic: string): string {
	const compact = topic
		.replace(/#shorts/gi, "")
		.replace(/[?!！？]/g, "")
		.trim();
	const words = compact.split(/\s+/).filter(Boolean);
	if (words.length <= 4) return compact;
	return `${words.slice(0, 4).join(" ")}...`;
}

function buildWeeklyPlan(ideas: ReferenceTopicIdea[]) {
	const first = ideas[0];
	const second = ideas[1] ?? first;
	const third = ideas[2] ?? first;
	return [
		{
			slot: "D+0",
			action: first ? first.title : "첫 추천 주제 업로드",
			reason: "가장 강한 신규 유입형 훅으로 템플릿 반응을 빠르게 확인",
		},
		{
			slot: "D+2",
			action: second ? second.title : "두 번째 주제 업로드",
			reason: "같은 편집 문법에서 소재만 바꿔 클릭/시청지속 차이를 비교",
		},
		{
			slot: "D+5",
			action: third ? third.title : "후속 주제 업로드",
			reason: "성과가 나온 제목 구조를 시리즈화해 구독 전환 유도",
		},
	];
}

function isUsableChannelId(value: string | null | undefined): value is string {
	return Boolean(value && value !== "__builtin_reference__");
}
