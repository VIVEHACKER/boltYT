import { buildCastDirective } from "./character-roster";
import type { SceneShot } from "./scene-shot-types";

export type AnimationProductionStatus =
	| "ready"
	| "needs_development"
	| "blocked";

export type AnimationProductionFamily =
	| "character_micro_sitcom"
	| "storytime_animation"
	| "slapstick_no_dialogue"
	| "animated_explainer"
	| "history_comedy"
	| "infographic_motion"
	| "whiteboard_lesson"
	| "myth_horror_story"
	| "meme_original"
	| "kids_fable";

export interface AnimationProductionFamilyProfile {
	id: AnimationProductionFamily;
	label: string;
	referenceFamily: string;
	formatFit: Array<"shorts" | "longform">;
	visualGrammar: string;
	storyFormula: string;
	shotIntents: string[];
	promptDirectives: string[];
	qualityGates: string[];
	riskControls: string[];
}

export interface AnimationReadinessIssue {
	severity: "critical" | "warning" | "info";
	code: string;
	message: string;
}

export interface AnimationProductionReadinessReport {
	status: AnimationProductionStatus;
	canGenerate: boolean;
	score: number;
	recommendedFormat: "shorts" | "longform" | "both";
	productionFamily: AnimationProductionFamily;
	productionFamilyLabel: string;
	recommendedAnimationStyle: string;
	storyAngle: string;
	referenceConfidence: "public_pattern";
	riskControls: string[];
	qualityGates: string[];
	issues: AnimationReadinessIssue[];
	requiredActions: string[];
	promptDirectives: string[];
}

export interface AnimationBible {
	style: string;
	world: string;
	characters: Array<{
		name: string;
		role: string;
		appearance: string;
		personality: string;
		voice_tone: string;
	}>;
	recurring_props: string[];
	color_palette: string[];
}

type SceneType = "image" | "video" | "text_emphasis" | "news_overlay";

export interface AnimationSceneInput {
	narration: string;
	type: SceneType;
	visualPrompt: string;
	duration: number;
	mood?: string;
	textEffect?: string;
	transition?: string;
	shots?: SceneShot[];
	productionFamily?: AnimationProductionFamily;
}

export const ANIMATION_PRODUCTION_FAMILY_PROFILES: Record<
	AnimationProductionFamily,
	AnimationProductionFamilyProfile
> = {
	character_micro_sitcom: {
		id: "character_micro_sitcom",
		label: "캐릭터 상황극/시리즈",
		referenceFamily: "The Land of Boggs류 반복 캐릭터 마이크로 시트콤/시리즈",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"simple recurring character, expressive face changes, clean background, reaction cuts",
		storyFormula:
			"주인공 욕망 -> 방해물 -> 오해/실패 -> 표정 리액션 -> 펀치라인",
		shotIntents: [
			"hook pose",
			"goal pose",
			"obstacle action",
			"reaction close-up",
			"punchline or loop pose",
		],
		promptDirectives: [
			"첫 장면에서 상황과 감정이 보이게 하세요.",
			"대사는 짧고 캐릭터 리액션으로 웃음을 만드세요.",
			"마지막 1~3초는 펀치라인 또는 루프 가능한 표정으로 끝내세요.",
		],
		qualityGates: [
			"3~5초마다 표정 또는 포즈 변화",
			"주인공 실루엣과 의상 고정",
			"마지막 샷이 독립적인 농담/반응으로 성립",
		],
		riskControls: [
			"특정 채널 캐릭터, 말투, 디자인을 복제하지 말고 구조만 참고",
			"유행 밈을 쓰더라도 대사와 캐릭터 행동은 새로 작성",
		],
	},
	storytime_animation: {
		id: "storytime_animation",
		label: "스토리타임 애니메이션",
		referenceFamily: "Jaiden Animations / TheOdd1sOut류 경험담 애니메이션",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"simple avatar narrator, memory reenactment, exaggerated expression, cutaway gags",
		storyFormula:
			"개인적 문제 -> 이상한 선택 -> 점점 커지는 상황 -> 깨달음/농담",
		shotIntents: [
			"avatar confession",
			"memory setup",
			"awkward action",
			"cutaway gag",
			"self-aware payoff",
		],
		promptDirectives: [
			"나레이터 아바타를 고정하고 회상 장면과 현재 반응을 번갈아 쓰세요.",
			"롱폼은 에피소드마다 작은 실패와 배움을 넣으세요.",
			"실제 개인/학교/회사 식별 정보처럼 보이는 표현은 피하세요.",
		],
		qualityGates: [
			"아바타가 모든 챕터의 시각 앵커로 반복 등장",
			"설명만 있는 씬보다 회상/컷어웨이 씬이 많음",
			"롱폼은 60초마다 새 에피소드 비트",
		],
		riskControls: [
			"실존 인물 비방처럼 보이는 이야기 금지",
			"자전적 경험담을 꾸며도 실제 제보/폭로처럼 포장하지 않음",
		],
	},
	slapstick_no_dialogue: {
		id: "slapstick_no_dialogue",
		label: "무대사 슬랩스틱",
		referenceFamily: "Pencilmation류 물리 코미디",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"clear stage, simple props, exaggerated squash and stretch, action-led timing",
		storyFormula: "소품 발견 -> 잘못된 사용 -> 연쇄 실패 -> 과장된 결과",
		shotIntents: [
			"prop reveal",
			"attempt action",
			"mechanical failure",
			"impact frame",
			"silent reaction",
		],
		promptDirectives: [
			"나레이션보다 행동, SFX, 음악 히트로 정보를 전달하세요.",
			"각 샷에 소품 상태 변화를 명확히 쓰세요.",
			"자막은 최소화하고 표정/동작으로 이해되게 하세요.",
		],
		qualityGates: [
			"모든 주요 행동 비트에 SFX 큐 필요",
			"소품 위치와 상태가 이전 샷과 이어짐",
			"대사 없이도 갈등과 결과가 이해됨",
		],
		riskControls: [
			"위험한 행동 모방을 유도하지 않도록 결과를 과장된 만화 연출로 제한",
			"어린이 대상처럼 보일 때 성인/잔혹 소재 혼합 금지",
		],
	},
	animated_explainer: {
		id: "animated_explainer",
		label: "프리미엄 설명형 애니메이션",
		referenceFamily: "Kurzgesagt / TED-Ed류 리서치 기반 설명 애니메이션",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"visual metaphors, clean motion graphics, abstract concepts made concrete",
		storyFormula: "질문 -> 기존 오해 -> 핵심 원리 -> 사례 -> 결론/여운",
		shotIntents: [
			"question hook",
			"metaphor setup",
			"mechanism animation",
			"example transformation",
			"takeaway image",
		],
		promptDirectives: [
			"각 씬은 하나의 개념을 하나의 시각 은유로 바꾸세요.",
			"롱폼은 45~75초마다 새 개념 단계와 시각 모드를 넣으세요.",
			"사실 주제는 단정 대신 근거 수준을 드러내세요.",
		],
		qualityGates: [
			"추상 설명만 있는 씬 금지",
			"각 챕터에 before/after 개념 변화 존재",
			"과학/역사/사회 정보는 출처 확인 대상",
		],
		riskControls: [
			"레퍼런스 채널의 특정 그래픽 스타일/아이콘을 복제하지 않음",
			"검증되지 않은 사실을 교육 콘텐츠처럼 확정 표현하지 않음",
		],
	},
	history_comedy: {
		id: "history_comedy",
		label: "역사/사회 코미디 설명",
		referenceFamily: "OverSimplified류 지도/캐릭터 컷아웃 코미디",
		formatFit: ["longform", "shorts"],
		visualGrammar:
			"simplified maps, cutout characters, timeline boards, recurring visual jokes",
		storyFormula: "시대/문제 설정 -> 잘못된 선택 -> 세력 충돌 -> 반전 -> 결과",
		shotIntents: [
			"map setup",
			"leader/crowd cutout",
			"bad decision gag",
			"timeline escalation",
			"consequence callback",
		],
		promptDirectives: [
			"지도, 보드, 캐릭터 컷아웃을 챕터 앵커로 반복하세요.",
			"농담은 사실 흐름을 가리는 것이 아니라 기억 포인트로 쓰세요.",
			"민감한 역사/정치 주제는 조롱보다 구조 설명을 우선하세요.",
		],
		qualityGates: [
			"챕터마다 지도/타임라인/보드 중 하나 등장",
			"정보 비트 뒤에 보상 비트가 있음",
			"사실과 농담의 경계가 흐려지지 않음",
		],
		riskControls: [
			"실존 집단 혐오/비하로 읽히는 캐릭터화 금지",
			"전쟁/참사 소재를 충격 유도용 코미디로 처리하지 않음",
		],
	},
	infographic_motion: {
		id: "infographic_motion",
		label: "인포그래픽 모션 다큐",
		referenceFamily: "The Infographics Show류 데이터/아이콘 내레이션",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"icons, charts, maps, counters, labeled systems, reusable motion templates",
		storyFormula: "질문 -> 수치/비교 -> 사례 -> 원인 -> 결론",
		shotIntents: [
			"big number hook",
			"comparison board",
			"icon sequence",
			"map/data transition",
			"summary card",
		],
		promptDirectives: [
			"숫자, 비교, 단계, 분류를 시각 오브젝트로 바꾸세요.",
			"아이콘/차트/맵을 같은 그래픽 문법으로 반복하세요.",
			"출처가 필요한 수치에는 근거 수준을 드러내세요.",
		],
		qualityGates: [
			"모든 통계/순위 씬은 시각 비교 구조를 가짐",
			"아이콘 스타일과 색상 규칙 일관",
			"텍스트 카드만 이어지는 구간 금지",
		],
		riskControls: [
			"검증 안 된 랭킹/수치를 사실처럼 확정하지 않음",
			"대량 재사용 템플릿처럼 보이지 않도록 주제별 고유 시각 은유 포함",
		],
	},
	whiteboard_lesson: {
		id: "whiteboard_lesson",
		label: "화이트보드/수업형 애니메이션",
		referenceFamily: "MinutePhysics류 보드 설명 영상",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"hand-drawn board, diagrams, arrows, simple symbols, step-by-step reveal",
		storyFormula: "문제 제시 -> 단계 1 -> 단계 2 -> 예외 -> 한 줄 결론",
		shotIntents: [
			"board question",
			"diagram reveal",
			"arrow step",
			"counterexample",
			"boxed conclusion",
		],
		promptDirectives: [
			"장면마다 하나의 도식 또는 단계만 보여주세요.",
			"그림 안 텍스트는 최소화하고 자막/나레이션으로 설명하세요.",
			"복잡한 개념은 화살표와 위치 변화로 분해하세요.",
		],
		qualityGates: [
			"각 씬이 한 단계씩 누적됨",
			"작은 화면에서도 도식 구조가 보임",
			"결론이 마지막 보드 상태로 남음",
		],
		riskControls: [
			"공식/전문 지식은 검증 전 단정 금지",
			"기존 교육 채널의 고유 캐릭터/보드 디자인 복제 금지",
		],
	},
	myth_horror_story: {
		id: "myth_horror_story",
		label: "괴담/신화 스토리 애니메이션",
		referenceFamily: "호러 스토리텔링/다크 스토리북 애니메이션",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"dark storybook frames, silhouettes, symbolic props, restrained scares",
		storyFormula: "이상한 규칙 -> 금지 위반 -> 단서 축적 -> 정체 공개 -> 여운",
		shotIntents: [
			"ominous rule",
			"forbidden action",
			"clue close-up",
			"shadow reveal",
			"unsettling aftermath",
		],
		promptDirectives: [
			"공포는 노골적 잔혹 장면보다 실루엣, 소리, 단서로 만드세요.",
			"룰, 금지, 반복 소품을 초반에 심고 후반에 회수하세요.",
			"마지막은 갑작스러운 정지가 아니라 여운/루프 단서로 끝내세요.",
		],
		qualityGates: [
			"반복 소품/규칙이 결말에서 회수됨",
			"잔혹 묘사 없이 긴장이 유지됨",
			"엔딩 샷에 해석 가능한 단서가 있음",
		],
		riskControls: [
			"자해/현실 범죄 모방 가능성이 있는 묘사 금지",
			"어린이 캐릭터를 쓰더라도 성인 공포 소재와 혼동되지 않게 톤 명확화",
		],
	},
	meme_original: {
		id: "meme_original",
		label: "오리지널 밈 상황극",
		referenceFamily: "Nutshell Animations류 짧은 밈형 애니메이션",
		formatFit: ["shorts"],
		visualGrammar:
			"fast setup, absurd escalation, expressive poses, impact captions used sparingly",
		storyFormula:
			"익숙한 상황 -> 과장된 해석 -> 말도 안 되는 상승 -> 한 컷 반전",
		shotIntents: [
			"recognizable setup",
			"absurd escalation",
			"reaction cut",
			"impact frame",
			"loopable punchline",
		],
		promptDirectives: [
			"유행 밈을 그대로 베끼지 말고 주제에 맞는 새 상황으로 바꾸세요.",
			"대사는 짧고 화면 반응은 크게 만드세요.",
			"마지막 프레임은 반복 시 첫 장면으로 자연스럽게 이어지게 하세요.",
		],
		qualityGates: [
			"첫 2초 안에 상황 이해",
			"10초 안에 첫 반전 또는 리액션",
			"루프 가능한 마지막 프레임",
		],
		riskControls: [
			"상업 음원/타인 대사/유행 오디오를 기본값으로 쓰지 않음",
			"레퍼런스 밈의 문장, 캐릭터, 장면 구성 직접 복제 금지",
		],
	},
	kids_fable: {
		id: "kids_fable",
		label: "동화/교훈형 애니메이션",
		referenceFamily: "가족 친화형 캐릭터 동화/교훈 애니메이션",
		formatFit: ["shorts", "longform"],
		visualGrammar:
			"warm characters, simple moral conflict, soft color palette, clear emotions",
		storyFormula: "작은 욕심/문제 -> 친구/가족과 갈등 -> 선택 -> 교훈",
		shotIntents: [
			"warm world setup",
			"small conflict",
			"choice moment",
			"kind reaction",
			"gentle lesson",
		],
		promptDirectives: [
			"갈등은 명확하지만 불안/폭력 수위는 낮게 유지하세요.",
			"교훈은 설교가 아니라 행동 결과로 보여주세요.",
			"아동용처럼 보이는 경우 제목/설명/내용 톤을 일관되게 맞추세요.",
		],
		qualityGates: [
			"캐릭터 감정 변화가 선명함",
			"교훈이 마지막 행동으로 드러남",
			"무서운 소재/성인 소재와 혼합되지 않음",
		],
		riskControls: [
			"어린이 대상 콘텐츠 정책과 충돌할 수 있는 성인 소재 혼합 금지",
			"교육/교훈을 가장한 광고성 또는 조작적 메시지 금지",
		],
	},
};

export const ANIMATION_PRODUCTION_FAMILIES = Object.values(
	ANIMATION_PRODUCTION_FAMILY_PROFILES,
);

export function isAnimationProductionFamily(
	value: unknown,
): value is AnimationProductionFamily {
	return (
		typeof value === "string" && value in ANIMATION_PRODUCTION_FAMILY_PROFILES
	);
}

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function hasAny(text: string, terms: string[]): boolean {
	const lower = text.toLowerCase();
	return terms.some((term) => lower.includes(term.toLowerCase()));
}

function unique(values: string[]): string[] {
	return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function pushUnique(list: string[], value: string) {
	if (!list.includes(value)) list.push(value);
}

export function getAnimationProductionFamilyProfile(
	family: AnimationProductionFamily,
): AnimationProductionFamilyProfile {
	return ANIMATION_PRODUCTION_FAMILY_PROFILES[family];
}

export function inferAnimationProductionFamily(input: {
	topicTitle?: string;
	format?: "shorts" | "longform" | "both" | string;
}): AnimationProductionFamily {
	const topicTitle = normalizeText(input.topicTitle);
	const lower = topicTitle.toLowerCase();
	const isLongform = input.format === "longform";

	if (
		hasAny(lower, [
			"무대사",
			"대사 없음",
			"슬랩스틱",
			"몸개그",
			"소품",
			"silent",
			"slapstick",
			"no dialogue",
		])
	) {
		return "slapstick_no_dialogue";
	}
	if (
		hasAny(lower, [
			"썰",
			"경험담",
			"일상",
			"알바",
			"학교",
			"친구랑",
			"storytime",
			"experience",
			"avatar",
		])
	) {
		return "storytime_animation";
	}
	if (
		hasAny(lower, [
			"괴담",
			"공포",
			"미스터리",
			"악몽",
			"신화",
			"전설",
			"horror",
			"myth",
			"creepy",
		])
	) {
		return "myth_horror_story";
	}
	if (
		hasAny(lower, [
			"역사",
			"전쟁",
			"제국",
			"왕",
			"정치",
			"사회",
			"history",
			"war",
			"empire",
		])
	) {
		return "history_comedy";
	}
	if (
		hasAny(lower, [
			"순위",
			"비교",
			"통계",
			"숫자",
			"데이터",
			"top",
			"ranking",
			"compare",
			"statistics",
		])
	) {
		return "infographic_motion";
	}
	if (
		hasAny(lower, [
			"화이트보드",
			"수업",
			"강의",
			"공식",
			"문제풀이",
			"whiteboard",
			"lesson",
			"diagram",
		])
	) {
		return "whiteboard_lesson";
	}
	if (
		hasAny(lower, [
			"과학",
			"원리",
			"왜",
			"설명",
			"교육",
			"지식",
			"science",
			"explain",
			"why",
			"how",
		])
	) {
		return "animated_explainer";
	}
	if (
		hasAny(lower, [
			"밈",
			"병맛",
			"웃긴",
			"개그",
			"상황극",
			"meme",
			"absurd",
			"skit",
		])
	) {
		return "meme_original";
	}
	if (
		hasAny(lower, [
			"동화",
			"교훈",
			"아이",
			"가족",
			"친절",
			"fable",
			"kids",
			"family",
		])
	) {
		return "kids_fable";
	}
	if (
		hasAny(lower, [
			"소년",
			"소녀",
			"친구",
			"괴물",
			"로봇",
			"마법사",
			"hero",
			"robot",
			"monster",
		]) &&
		hasAny(lower, [
			"비밀",
			"대결",
			"문제",
			"실패",
			"탈출",
			"반전",
			"위기",
			"선택",
			"secret",
			"escape",
			"conflict",
		])
	) {
		return "character_micro_sitcom";
	}

	return isLongform ? "animated_explainer" : "character_micro_sitcom";
}

function inferAnimationStyle(
	topicTitle: string,
	family: AnimationProductionFamily,
): string {
	if (family === "whiteboard_lesson") return "clean whiteboard animation";
	if (family === "infographic_motion")
		return "flat motion infographic animation";
	if (family === "history_comedy") return "simplified cutout history animation";
	if (family === "storytime_animation")
		return "simple avatar storytime animation";
	if (family === "slapstick_no_dialogue")
		return "expressive silent cartoon animation";
	if (family === "meme_original") return "fast expressive 2D meme animation";
	if (hasAny(topicTitle, ["공포", "미스터리", "괴담", "악몽"])) {
		return "2D dark storybook animation";
	}
	if (hasAny(topicTitle, ["개그", "웃긴", "코미디", "병맛"])) {
		return "expressive 2D comedy animation";
	}
	if (hasAny(topicTitle, ["아이", "동화", "가족", "친구"])) {
		return "warm 2D family animation";
	}
	if (hasAny(topicTitle, ["교육", "설명", "과학", "역사"])) {
		return "clean educational motion cartoon";
	}
	return "cinematic 2D character animation";
}

function inferStoryAngle(topicTitle: string): string {
	if (hasAny(topicTitle, ["vs", "대결", "싸움", "경쟁"])) return "대결과 반전";
	if (hasAny(topicTitle, ["비밀", "숨겨진", "정체"])) return "비밀 공개";
	if (hasAny(topicTitle, ["성장", "극복", "실패"])) return "성장과 선택";
	if (hasAny(topicTitle, ["웃긴", "개그", "병맛"])) return "오해와 펀치라인";
	return "갈등, 선택, 반전";
}

export function analyzeAnimationProductionReadiness(input: {
	topicTitle?: string;
	format?: "shorts" | "longform" | "both" | string;
}): AnimationProductionReadinessReport {
	const topicTitle = normalizeText(input.topicTitle);
	const issues: AnimationReadinessIssue[] = [];
	const actions: string[] = [];
	let score = 100;
	const productionFamily = inferAnimationProductionFamily({
		topicTitle,
		format: input.format,
	});
	const familyProfile = getAnimationProductionFamilyProfile(productionFamily);

	if (!topicTitle) {
		issues.push({
			severity: "critical",
			code: "missing_topic",
			message: "애니메이션을 만들 주제가 없습니다.",
		});
		pushUnique(actions, "주인공, 목표, 갈등이 드러나는 주제를 입력하세요.");
		score -= 80;
	}

	const hasCharacterCue = hasAny(topicTitle, [
		"소년",
		"소녀",
		"남자",
		"여자",
		"친구",
		"가족",
		"괴물",
		"로봇",
		"마법사",
		"detective",
		"robot",
		"kid",
	]);
	const hasConflictCue = hasAny(topicTitle, [
		"하지만",
		"비밀",
		"대결",
		"문제",
		"실패",
		"탈출",
		"반전",
		"위기",
		"선택",
		"vs",
		"secret",
		"escape",
		"conflict",
	]);

	if (topicTitle && !hasCharacterCue) {
		issues.push({
			severity: "warning",
			code: "weak_character_anchor",
			message: "주인공 단서가 약해 캐릭터 일관성이 흔들릴 수 있습니다.",
		});
		pushUnique(
			actions,
			"주인공의 정체, 성격, 외형 단서를 제목이나 브리프에 넣으세요.",
		);
		score -= 10;
	}

	if (topicTitle && !hasConflictCue) {
		issues.push({
			severity: "warning",
			code: "weak_story_conflict",
			message: "갈등/반전 단서가 약해 애니메이션 서사가 밋밋해질 수 있습니다.",
		});
		pushUnique(actions, "주인공이 원하는 것과 방해물을 명확히 넣으세요.");
		score -= input.format === "longform" ? 18 : 10;
	}

	if (input.format === "longform" && (!hasCharacterCue || !hasConflictCue)) {
		issues.push({
			severity: "warning",
			code: "longform_story_bible_needed",
			message:
				"롱폼 애니메이션은 캐릭터 목표, 갈등, 중반 전환이 없으면 유지력이 떨어집니다.",
		});
		pushUnique(
			actions,
			"롱폼은 최소 3막 구조와 반복 등장 소품/배경을 정하세요.",
		);
		score -= 10;
	}

	if (
		input.format === "longform" &&
		!familyProfile.formatFit.includes("longform")
	) {
		issues.push({
			severity: "warning",
			code: "format_family_mismatch",
			message: `${familyProfile.label}은 기본적으로 쇼츠 친화 포맷이라 롱폼은 챕터형 확장이 필요합니다.`,
		});
		pushUnique(
			actions,
			"롱폼으로 만들려면 에피소드/챕터/반복 개그를 추가해 포맷을 확장하세요.",
		);
		score -= 8;
	}

	const normalizedScore = clamp(Math.round(score), 0, 100);
	const status: AnimationProductionStatus =
		issues.some((issue) => issue.severity === "critical") ||
		normalizedScore < 45
			? "blocked"
			: normalizedScore < 78
				? "needs_development"
				: "ready";
	const recommendedAnimationStyle = inferAnimationStyle(
		topicTitle,
		productionFamily,
	);
	const storyAngle = inferStoryAngle(topicTitle);
	const recommendedFormat: "shorts" | "longform" | "both" =
		status === "ready" &&
		hasCharacterCue &&
		hasConflictCue &&
		familyProfile.formatFit.includes("longform")
			? "both"
			: (familyProfile.formatFit[0] ?? "shorts");
	const promptDirectives = [
		`제작 포맷 패밀리는 "${familyProfile.label}"입니다. ${familyProfile.storyFormula}`,
		`애니메이션 스타일은 "${recommendedAnimationStyle}"로 고정하세요.`,
		`스토리 각도는 "${storyAngle}"로 좁히세요.`,
		`관찰 가능한 공개 포맷 문법만 참고하고 특정 채널의 캐릭터/그래픽/대사/편집을 복제하지 마세요.`,
		"모든 씬의 visual_prompt에는 같은 주인공 외형, 의상, 색상, 세계관 단서를 반복하세요.",
		"자료 검색/실사 화면이 아니라 캐릭터 키포즈, 표정, 액션, 리액션 샷으로 구성하세요.",
		"롱폼은 도입, 목표, 실패, 전환, 클라이맥스, 여운으로 나누세요.",
		...familyProfile.promptDirectives,
	];

	return {
		status,
		canGenerate: status !== "blocked",
		score: normalizedScore,
		recommendedFormat,
		productionFamily,
		productionFamilyLabel: familyProfile.label,
		recommendedAnimationStyle,
		storyAngle,
		referenceConfidence: "public_pattern",
		riskControls: familyProfile.riskControls,
		qualityGates: familyProfile.qualityGates,
		issues,
		requiredActions: actions,
		promptDirectives,
	};
}

export function formatAnimationReadinessForPrompt(
	report: AnimationProductionReadinessReport,
): string {
	const issues = report.issues
		.map((issue) => `- [${issue.severity}] ${issue.message}`)
		.join("\n");
	const actions = report.requiredActions
		.map((action) => `- ${action}`)
		.join("\n");
	const directives = report.promptDirectives
		.map((directive) => `- ${directive}`)
		.join("\n");
	const riskControls = report.riskControls
		.map((control) => `- ${control}`)
		.join("\n");
	const qualityGates = report.qualityGates
		.map((gate) => `- ${gate}`)
		.join("\n");

	return `=== 애니메이션 프리프로덕션 평가 ===
점수: ${report.score}/100
상태: ${report.status}
추천 형식: ${report.recommendedFormat}
제작 포맷: ${report.productionFamilyLabel} (${report.productionFamily})
스타일: ${report.recommendedAnimationStyle}
스토리 각도: ${report.storyAngle}
레퍼런스 신뢰도: 공개적으로 관찰 가능한 포맷 패턴만 사용

제작 지시:
${directives}

품질 게이트:
${qualityGates || "- 포맷별 게이트 없음"}

리스크 제어:
${riskControls || "- 공통 리스크 제어 없음"}

감지된 약점:
${issues || "- 치명적인 약점 없음"}

보강 액션:
${actions || "- 현재 입력으로 진행 가능"}`;
}

function splitDuration(totalSeconds: number, shotCount: number): number[] {
	const total = Math.max(totalSeconds, 1.5);
	const base = total / shotCount;
	const durations = Array.from({ length: shotCount }, (_, index) => {
		const weight = index === 0 ? 1.08 : index === shotCount - 1 ? 0.92 : 1;
		return Number(Math.max(0.75, base * weight).toFixed(2));
	});
	const sum = durations.reduce((acc, value) => acc + value, 0);
	durations[durations.length - 1] = Number(
		Math.max(0.75, durations[durations.length - 1] + (total - sum)).toFixed(2),
	);
	return durations;
}

function animationShotCount(scene: AnimationSceneInput): number {
	if (scene.type === "text_emphasis") return scene.duration <= 3 ? 2 : 3;
	if (scene.duration <= 3) return 2;
	if (scene.duration <= 6) return 3;
	return 4;
}

function resolveSceneFamily(
	scene: AnimationSceneInput,
	fallbackFamily?: AnimationProductionFamily,
): AnimationProductionFamily {
	return (
		scene.productionFamily ??
		fallbackFamily ??
		inferAnimationProductionFamily({
			topicTitle: `${scene.narration} ${scene.visualPrompt}`,
		})
	);
}

function animationKinds(
	scene: AnimationSceneInput,
	family: AnimationProductionFamily,
): SceneShot["kind"][] {
	if (scene.type === "text_emphasis") return ["punch", "quote", "punch"];
	if (family === "infographic_motion") {
		return ["context", "evidence", "detail", "punch"];
	}
	if (family === "animated_explainer" || family === "whiteboard_lesson") {
		return ["context", "evidence", "detail", "quote"];
	}
	if (family === "history_comedy") {
		return ["context", "evidence", "quote", "punch"];
	}
	if (family === "storytime_animation") {
		return ["context", "detail", "quote", "punch"];
	}
	if (family === "slapstick_no_dialogue") {
		return ["establishing", "detail", "detail", "punch"];
	}
	if (family === "meme_original") {
		return ["establishing", "detail", "punch", "punch"];
	}
	return ["establishing", "detail", "quote", "punch"];
}

function animationMotion(index: number, kind: SceneShot["kind"]) {
	if (kind === "punch") return "push_in";
	if (kind === "quote") return "slow_zoom_in";
	if (kind === "detail") return index % 2 === 0 ? "pan_left" : "pan_right";
	return "slow_zoom_in";
}

function animationCrop(kind: SceneShot["kind"]) {
	if (kind === "establishing") return "wide";
	if (kind === "context") return "wide";
	if (kind === "evidence") return "medium";
	if (kind === "detail") return "medium";
	if (kind === "quote") return "close";
	if (kind === "punch") return "close";
	return "medium";
}

function animationVisualRole(
	family: AnimationProductionFamily,
	kind: SceneShot["kind"],
): SceneShot["visual_role"] {
	if (kind === "punch") return "ending";
	if (family === "infographic_motion")
		return kind === "evidence" ? "data" : "context";
	if (family === "history_comedy")
		return kind === "evidence" ? "map" : "context";
	if (family === "whiteboard_lesson")
		return kind === "evidence" ? "data" : "context";
	return kind === "evidence" ? "data" : "reconstruction";
}

function animationRig(
	family: AnimationProductionFamily,
	kind: SceneShot["kind"],
): NonNullable<SceneShot["animation_rig"]> {
	if (kind === "punch") {
		return {
			expression:
				family === "myth_horror_story"
					? "fear"
					: family === "kids_fable"
						? "happy"
						: "surprised",
			mouthCue: family === "slapstick_no_dialogue" ? "closed" : "wide",
			pose: "action",
			actionIntensity: 0.92,
		};
	}
	if (kind === "quote") {
		return {
			expression: family === "myth_horror_story" ? "worried" : "surprised",
			mouthCue: "open",
			pose: "three_quarter",
			actionIntensity: 0.55,
		};
	}
	if (kind === "detail") {
		return {
			expression: family === "slapstick_no_dialogue" ? "determined" : "worried",
			mouthCue: "closed",
			pose: "action",
			actionIntensity: 0.72,
		};
	}
	if (kind === "evidence") {
		return {
			expression: "determined",
			mouthCue: "closed",
			pose: "three_quarter",
			actionIntensity: 0.45,
		};
	}
	return {
		expression: family === "kids_fable" ? "happy" : "neutral",
		mouthCue: family === "storytime_animation" ? "open" : "closed",
		pose: kind === "context" ? "three_quarter" : "front",
		actionIntensity: 0.35,
	};
}

function animationSfxCue(
	family: AnimationProductionFamily,
	kind: SceneShot["kind"],
): NonNullable<SceneShot["sfx_cue"]> {
	if (family === "myth_horror_story") {
		return {
			category: kind === "punch" ? "suspense_hit" : "drone",
			intensity: kind === "punch" ? 0.9 : 0.45,
			reason:
				kind === "punch" ? "shadow reveal hit" : "sustained horror tension",
		};
	}
	if (family === "slapstick_no_dialogue" || family === "meme_original") {
		return {
			category: kind === "punch" ? "impact" : "whoosh",
			intensity: kind === "punch" ? 0.95 : 0.65,
			reason: kind === "punch" ? "payoff impact frame" : "cartoon action beat",
		};
	}
	if (
		family === "animated_explainer" ||
		family === "infographic_motion" ||
		family === "whiteboard_lesson"
	) {
		return {
			category: kind === "evidence" ? "notification" : "reveal",
			intensity: kind === "punch" ? 0.7 : 0.45,
			reason: "information reveal accent",
		};
	}
	return {
		category: kind === "punch" ? "impact" : "reveal",
		intensity: kind === "punch" ? 0.82 : 0.5,
		reason:
			kind === "punch" ? "character reaction payoff" : "pose change accent",
	};
}

function appendAnimationPerformanceDirectives(
	prompt: string,
	rig: NonNullable<SceneShot["animation_rig"]>,
	sfxCue?: NonNullable<SceneShot["sfx_cue"]>,
): string {
	const parts = [
		prompt,
		`animation rig: ${rig.expression} expression, ${rig.mouthCue} mouth cue, ${rig.pose} pose, action intensity ${rig.actionIntensity.toFixed(2)}`,
		sfxCue
			? `timing cue: ${sfxCue.category} SFX intent for ${sfxCue.reason}, keep the pose readable at the sound hit`
			: "",
	];
	return parts.filter(Boolean).join(", ").slice(0, 720);
}

function ensureAnimationPerformanceDirectives(
	prompt: string,
	rig: NonNullable<SceneShot["animation_rig"]>,
	sfxCue?: NonNullable<SceneShot["sfx_cue"]>,
): string {
	if (/animation rig|Rig lock/i.test(prompt)) return prompt;
	return appendAnimationPerformanceDirectives(prompt, rig, sfxCue);
}

function shotPrompt(
	scene: AnimationSceneInput,
	kind: SceneShot["kind"],
	index: number,
	bible?: AnimationBible,
	family: AnimationProductionFamily = "character_micro_sitcom",
): string {
	const style = bible?.style || "consistent 2D character animation";
	const world = bible?.world || "cohesive animated world";
	const profile = getAnimationProductionFamilyProfile(family);
	const character = bible?.characters?.[0];
	const characterText = character
		? `${character.name}, ${character.appearance}, ${character.personality}`
		: "same main character, consistent outfit, consistent face shape";
	const shotIntent =
		profile.shotIntents[index % profile.shotIntents.length] ??
		"clear action pose";
	const promptParts = [
		style,
		world,
		profile.visualGrammar,
		`${shotIntent} shot intent`,
		characterText,
		scene.visualPrompt,
		kind === "establishing" ? "wide scene setup" : "",
		kind === "context" ? "clear context board or world setup" : "",
		kind === "evidence" ? "visual diagram, map, chart, or concrete clue" : "",
		kind === "detail" ? "clear action pose and prop detail" : "",
		kind === "quote" ? "expressive reaction close-up" : "",
		kind === "punch" ? "strong punchline or reveal pose" : "",
		"clean background, readable silhouette, no text, no watermark",
	];
	return promptParts.filter(Boolean).join(", ").slice(0, 420);
}

function shotCaption(
	scene: AnimationSceneInput,
	kind: SceneShot["kind"],
): string {
	const firstSentence =
		normalizeText(scene.narration).split(/[.!?\n]/)[0] ?? "";
	if (kind === "establishing") return firstSentence || "장면 시작";
	if (kind === "detail") return "행동 비트";
	if (kind === "quote") return "리액션";
	return firstSentence || "반전 비트";
}

export function buildAnimationSceneShots(
	scene: AnimationSceneInput,
	bible?: AnimationBible,
	productionFamily?: AnimationProductionFamily,
): SceneShot[] {
	const count = animationShotCount(scene);
	const family = resolveSceneFamily(scene, productionFamily);
	const profile = getAnimationProductionFamilyProfile(family);
	const durations = splitDuration(scene.duration, count);
	const kinds = animationKinds(scene, family).slice(0, count);

	return kinds.map((kind, index) => {
		const rig = animationRig(family, kind);
		const sfxCue = animationSfxCue(family, kind);
		return {
			id: `anim-${family}-${kind}-${index + 1}`,
			kind,
			duration_seconds: durations[index] ?? durations[0] ?? 1,
			media_type: "image",
			visual_prompt: appendAnimationPerformanceDirectives(
				shotPrompt(scene, kind, index, bible, family),
				rig,
				sfxCue,
			),
			caption: shotCaption(scene, kind),
			motion: animationMotion(index, kind),
			crop: animationCrop(kind),
			visual_role: animationVisualRole(family, kind),
			search_terms: [],
			reject_terms: [
				"photorealistic",
				"real photo",
				"live action",
				"watermark",
				"logo",
			],
			source_title: profile.label,
			source_confidence: 82,
			selection_provider: "animation",
			animation_rig: rig,
			sfx_cue: sfxCue,
			overlay:
				kind === "evidence"
					? "evidence"
					: kind === "quote"
						? "quote"
						: kind === "punch"
							? "headline"
							: "none",
		};
	});
}

export function ensureAnimationSceneShots(
	scene: AnimationSceneInput,
	bible?: AnimationBible,
	productionFamily?: AnimationProductionFamily,
): SceneShot[] {
	const family = resolveSceneFamily(scene, productionFamily);
	const profile = getAnimationProductionFamilyProfile(family);
	if (scene.shots && scene.shots.length > 0) {
		const total = scene.shots.reduce(
			(sum, shot) => sum + shot.duration_seconds,
			0,
		);
		if (total > 0) {
			const scale = Math.max(scene.duration, 1.5) / total;
			return scene.shots.map((shot) => ({
				...shot,
				selection_provider: shot.selection_provider ?? "animation",
				media_type: "image",
				source_title: shot.source_title ?? profile.label,
				animation_rig: shot.animation_rig ?? animationRig(family, shot.kind),
				sfx_cue: shot.sfx_cue ?? animationSfxCue(family, shot.kind),
				duration_seconds: Number(
					Math.max(0.75, shot.duration_seconds * scale).toFixed(2),
				),
			}));
		}
	}
	return buildAnimationSceneShots(scene, bible, family);
}

export interface AnimationAssetManifest {
	scriptId: string;
	productionFamily: AnimationProductionFamily;
	productionFamilyLabel: string;
	referenceSheetPath: string;
	styleSeed: number;
	identityLock: string;
	style: string;
	world: string;
	fixedAppearance: string;
	mainCharacterName: string;
	recurringProps: string[];
	colorPalette: string[];
	continuityDirectives: string[];
	/** 다중 캐릭터 전체 출연진 고정 지시문(2명+일 때만). 핵심 잠금 뒤에 주입돼 cap 시 먼저 잘린다. */
	castDirective?: string;
	sceneContinuityKeys: string[];
	createdAt: string;
}

export interface AnimationProductionQualityIssue {
	severity: "critical" | "warning" | "info";
	code: string;
	message: string;
}

export interface AnimationProductionQualityReport {
	passed: boolean;
	score: number;
	metrics: {
		totalScenes: number;
		totalShots: number;
		animationShotCount: number;
		referenceSheetPresent: boolean;
		continuityTaggedRatio: number;
		familyTaggedRatio: number;
		sourceResolvedRatio: number;
		motionCoverageRatio: number;
		rigCoverageRatio: number;
		sfxCueCoverageRatio: number;
		endingCompleteness: number;
		uniquePromptRatio: number;
	};
	issues: AnimationProductionQualityIssue[];
	requiredActions: string[];
}

export interface AnimationQualitySceneInput {
	id?: string;
	order_index?: number;
	narration_text?: string;
	scene_type?: string;
	visual_prompt?: string;
	duration_seconds?: number;
	shots?: SceneShot[];
}

function defaultAnimationBible(
	family: AnimationProductionFamily,
): AnimationBible {
	const profile = getAnimationProductionFamilyProfile(family);
	return {
		style: profile.visualGrammar,
		world: "consistent animated world built from the script premise",
		characters: [
			{
				name: "Main character",
				role: "protagonist",
				appearance:
					"consistent face shape, fixed outfit, clear silhouette, repeatable color accents",
				personality: "expressive and readable",
				voice_tone: "natural conversational voice",
			},
		],
		recurring_props: [],
		color_palette: ["coherent primary color", "supporting accent color"],
	};
}

function resolveAnimationBible(
	bible: AnimationBible | undefined,
	family: AnimationProductionFamily,
): AnimationBible {
	return bible?.characters?.length ? bible : defaultAnimationBible(family);
}

function stableNumericHash(value: string): number {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export function buildAnimationAssetManifest(input: {
	scriptId: string;
	bible?: AnimationBible;
	productionFamily?: AnimationProductionFamily;
	scenes?: AnimationQualitySceneInput[];
	now?: string;
}): AnimationAssetManifest {
	const productionFamily =
		input.productionFamily ??
		inferAnimationProductionFamily({
			topicTitle:
				input.scenes
					?.map(
						(scene) =>
							`${scene.narration_text ?? ""} ${scene.visual_prompt ?? ""}`,
					)
					.join(" ") ?? "",
		});
	const profile = getAnimationProductionFamilyProfile(productionFamily);
	const bible = resolveAnimationBible(input.bible, productionFamily);
	const mainCharacter = bible.characters[0];
	// 다중 캐릭터(조연 포함) bible 이면 전체 출연진 고정 지시문 — 기존엔 main(characters[0])만
	// 잠가 조연이 컷마다 드리프트했다. buildCastDirective 는 캐릭터 0~1명이면 ""(무영향).
	const castDirective = buildCastDirective(bible.characters);
	const fixedAppearance = normalizeText(
		[
			mainCharacter?.name,
			mainCharacter?.appearance,
			mainCharacter?.personality,
			bible.style,
			bible.world,
		].join(", "),
	);
	const identityLock = normalizeText(
		`${profile.id}:${bible.style}:${bible.world}:${fixedAppearance}:${(bible.color_palette ?? []).join("|")}`,
	);
	const sceneContinuityKeys = unique(
		(input.scenes ?? []).map((scene, index) => {
			const raw = normalizeText(
				`${index + 1}-${scene.scene_type ?? "scene"}-${scene.visual_prompt ?? scene.narration_text ?? ""}`,
			)
				.toLowerCase()
				.replace(/[^a-z0-9가-힣]+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 56);
			return raw || `scene-${index + 1}`;
		}),
	);

	return {
		scriptId: input.scriptId,
		productionFamily,
		productionFamilyLabel: profile.label,
		referenceSheetPath: `scripts/${input.scriptId}/animation/character-sheet.png`,
		styleSeed: stableNumericHash(identityLock),
		identityLock,
		style: bible.style,
		world: bible.world,
		fixedAppearance,
		mainCharacterName: mainCharacter?.name ?? "Main character",
		recurringProps: bible.recurring_props ?? [],
		colorPalette: bible.color_palette ?? [],
		castDirective: castDirective || undefined,
		continuityDirectives: [
			`Use the same main character in every shot: ${fixedAppearance}.`,
			`Keep the world consistent: ${bible.world}.`,
			`Use the production family grammar: ${profile.label} - ${profile.visualGrammar}.`,
			...(bible.recurring_props?.length
				? [
						`Reuse recurring props when relevant: ${bible.recurring_props.join(", ")}.`,
					]
				: []),
			...(bible.color_palette?.length
				? [`Keep this palette consistent: ${bible.color_palette.join(", ")}.`]
				: []),
		],
		sceneContinuityKeys,
		createdAt: input.now ?? new Date().toISOString(),
	};
}

export function buildAnimationCharacterReferencePrompt(
	manifest: AnimationAssetManifest,
): string {
	return [
		"animation character reference sheet",
		manifest.style,
		manifest.world,
		manifest.fixedAppearance,
		`${manifest.mainCharacterName} shown in front view, side view, three-quarter view, neutral pose, happy expression, worried expression, surprised expression`,
		manifest.recurringProps.length
			? `recurring props: ${manifest.recurringProps.join(", ")}`
			: "",
		manifest.colorPalette.length
			? `fixed palette: ${manifest.colorPalette.join(", ")}`
			: "",
		"clean white or simple background, consistent proportions, no text, no logo, no watermark",
	]
		.filter(Boolean)
		.join(", ")
		.slice(0, 900);
}

export function enrichAnimationPromptWithContinuity(
	prompt: string,
	manifest: AnimationAssetManifest,
	shot?: SceneShot,
): string {
	const parts = [
		prompt,
		`Reference contract: ${manifest.continuityDirectives.join(" ")}`,
		`Reference sheet path: ${manifest.referenceSheetPath}.`,
		`Identity lock: ${manifest.identityLock}.`,
		`Stable style seed: ${manifest.styleSeed}.`,
		shot?.continuity_key ? `Continuity key: ${shot.continuity_key}.` : "",
		shot?.animation_rig
			? `Rig lock: ${shot.animation_rig.expression} expression, ${shot.animation_rig.mouthCue} mouth cue, ${shot.animation_rig.pose} pose, action intensity ${shot.animation_rig.actionIntensity.toFixed(2)}.`
			: "",
		shot?.sfx_cue
			? `Sound timing intent: ${shot.sfx_cue.category} at ${shot.sfx_cue.intensity.toFixed(2)} intensity for ${shot.sfx_cue.reason}.`
			: "",
		"Do not change the character age, outfit, face shape, palette, or silhouette between shots.",
		// 다중 캐릭터 전체 출연진 앵커는 신규 추가분이라 truncation 최우선(맨 끝) — 기존 매니페스트/
		// 샷 잠금(시트·식별·시드·rig·sfx)을 절대 밀어내지 않는다. 예산이 남을 때만 들어간다.
		manifest.castDirective ? manifest.castDirective : "",
	];
	return parts.filter(Boolean).join(" ").slice(0, 1400);
}

export function applyAnimationContinuityToShots(
	shots: SceneShot[],
	manifest: AnimationAssetManifest,
): SceneShot[] {
	return shots.map((shot, index) => {
		if (shot.selection_provider !== "animation") return shot;
		const continuityKey =
			shot.continuity_key ??
			manifest.sceneContinuityKeys[
				index % manifest.sceneContinuityKeys.length
			] ??
			`shot-${index + 1}`;
		return {
			...shot,
			animation_family: manifest.productionFamily,
			continuity_key: continuityKey,
			reference_image_path: manifest.referenceSheetPath,
			animation_rig:
				shot.animation_rig ??
				animationRig(manifest.productionFamily, shot.kind),
			sfx_cue:
				shot.sfx_cue ?? animationSfxCue(manifest.productionFamily, shot.kind),
			source_title: shot.source_title ?? manifest.productionFamilyLabel,
			source_confidence: Math.max(shot.source_confidence ?? 0, 84),
			visual_prompt: enrichAnimationPromptWithContinuity(
				shot.visual_prompt ?? "",
				manifest,
				{
					...shot,
					continuity_key: continuityKey,
					animation_rig:
						shot.animation_rig ??
						animationRig(manifest.productionFamily, shot.kind),
					sfx_cue:
						shot.sfx_cue ??
						animationSfxCue(manifest.productionFamily, shot.kind),
				},
			),
		};
	});
}

export function repairAnimationScenesForQuality<
	T extends AnimationQualitySceneInput,
>(scenes: T[], manifest: AnimationAssetManifest): T[] {
	const promptCounts = new Map<string, number>();

	return scenes.map((scene, sceneIndex) => {
		const originalShots = scene.shots ?? [];
		const shots = applyAnimationContinuityToShots(originalShots, manifest).map(
			(shot, shotIndex) => {
				if (shot.selection_provider !== "animation") return shot;
				const family = isAnimationProductionFamily(shot.animation_family)
					? shot.animation_family
					: manifest.productionFamily;
				const rig = shot.animation_rig ?? animationRig(family, shot.kind);
				const sfxCue = shot.sfx_cue ?? animationSfxCue(family, shot.kind);
				const promptKey = normalizedPromptKey(shot);
				const count = (promptCounts.get(promptKey) ?? 0) + 1;
				promptCounts.set(promptKey, count);
				const isDuplicate = count > 1;
				const repairedPrompt = isDuplicate
					? `${shot.visual_prompt ?? ""} Distinct animation beat ${sceneIndex + 1}-${shotIndex + 1}: change pose, expression, camera framing, and action while preserving the same character.`
					: shot.visual_prompt;

				return {
					...shot,
					animation_family: family,
					animation_rig: rig,
					sfx_cue: sfxCue,
					visual_prompt: ensureAnimationPerformanceDirectives(
						repairedPrompt ?? "",
						rig,
						sfxCue,
					),
					motion:
						!shot.motion || shot.motion === "static"
							? shot.kind === "punch"
								? "push_in"
								: shotIndex % 2 === 0
									? "slow_zoom_in"
									: "drift"
							: shot.motion,
					source_confidence: Math.max(shot.source_confidence ?? 0, 84),
					qc_issues: undefined,
				};
			},
		);

		if (shots.length > 0) {
			const lastIndex = shots.length - 1;
			const lastShot = shots[lastIndex];
			if (lastShot.selection_provider === "animation") {
				const rig = animationRig(manifest.productionFamily, "punch");
				const sfxCue = animationSfxCue(manifest.productionFamily, "punch");
				shots[lastIndex] = {
					...lastShot,
					kind: "punch",
					visual_role: "ending",
					overlay: lastShot.overlay === "none" ? "headline" : lastShot.overlay,
					motion: lastShot.motion === "static" ? "push_in" : lastShot.motion,
					animation_rig: rig,
					sfx_cue: sfxCue,
					visual_prompt: ensureAnimationPerformanceDirectives(
						`${lastShot.visual_prompt ?? ""} Clear final payoff frame, loopable ending or emotional aftermath, readable silhouette, same character design.`,
						rig,
						sfxCue,
					),
				};
			}
		}

		return {
			...scene,
			shots,
		};
	});
}

function ratio(numerator: number, denominator: number): number {
	if (denominator <= 0) return 0;
	return Number((numerator / denominator).toFixed(3));
}

function normalizedPromptKey(shot: SceneShot): string {
	return normalizeText(shot.visual_prompt)
		.toLowerCase()
		.replace(/\s+/g, " ")
		.slice(0, 180);
}

export function scoreAnimationProductionQuality(input: {
	scenes: AnimationQualitySceneInput[];
	bible?: AnimationBible;
	productionFamily?: AnimationProductionFamily;
	referenceSheetPath?: string;
}): AnimationProductionQualityReport {
	const scenes = input.scenes ?? [];
	const shots = scenes.flatMap((scene) => scene.shots ?? []);
	const animationShots = shots.filter(
		(shot) => shot.selection_provider === "animation",
	);
	const issues: AnimationProductionQualityIssue[] = [];
	const actions: string[] = [];
	const totalShots = shots.length;
	const animationShotCount = animationShots.length;
	const productionFamily =
		input.productionFamily ??
		inferAnimationProductionFamily({
			topicTitle: scenes
				.map(
					(scene) =>
						`${scene.narration_text ?? ""} ${scene.visual_prompt ?? ""}`,
				)
				.join(" "),
		});

	const referenceSheetPresent = Boolean(input.referenceSheetPath);
	const continuityTaggedRatio = ratio(
		animationShots.filter(
			(shot) => shot.continuity_key && shot.reference_image_path,
		).length,
		animationShotCount,
	);
	const familyTaggedRatio = ratio(
		animationShots.filter((shot) => shot.animation_family === productionFamily)
			.length,
		animationShotCount,
	);
	const sourceResolvedRatio = ratio(
		animationShots.filter((shot) => Boolean(shot.source_url)).length,
		animationShotCount,
	);
	const motionCoverageRatio = ratio(
		animationShots.filter((shot) => shot.motion && shot.motion !== "static")
			.length,
		animationShotCount,
	);
	const rigCoverageRatio = ratio(
		animationShots.filter(
			(shot) =>
				shot.animation_rig &&
				typeof shot.animation_rig.actionIntensity === "number",
		).length,
		animationShotCount,
	);
	const sfxCueCoverageRatio = ratio(
		animationShots.filter((shot) => shot.sfx_cue?.category).length,
		animationShotCount,
	);
	const lastShot = shots[shots.length - 1];
	const endingCompleteness =
		lastShot?.kind === "punch" ||
		lastShot?.visual_role === "ending" ||
		/punchline|loop|ending|aftermath|takeaway|payoff/i.test(
			lastShot?.visual_prompt ?? "",
		)
			? 1
			: 0;
	const promptKeys = new Set(
		animationShots.map(normalizedPromptKey).filter(Boolean),
	);
	const uniquePromptRatio = ratio(promptKeys.size, animationShotCount);

	let score = 100;
	if (!referenceSheetPresent) {
		score -= 22;
		issues.push({
			severity: "critical",
			code: "missing_reference_sheet",
			message:
				"캐릭터 레퍼런스 시트가 없어 샷 간 외형 일관성을 보장하기 어렵습니다.",
		});
		actions.push(
			"캐릭터 레퍼런스 시트를 먼저 생성하고 모든 샷에 reference_image_path를 연결하세요.",
		);
	}
	if (!input.bible?.characters?.length) {
		score -= 14;
		issues.push({
			severity: "warning",
			code: "weak_animation_bible",
			message:
				"캐릭터 바이블이 약해 장기 시리즈/롱폼에서 일관성이 흔들릴 수 있습니다.",
		});
		actions.push("주인공 외형, 성격, 목소리, 반복 소품, 팔레트를 명시하세요.");
	}
	if (animationShotCount === 0) {
		score -= 30;
		issues.push({
			severity: "critical",
			code: "no_animation_shots",
			message: "애니메이션 전용 샷이 없습니다.",
		});
		actions.push(
			"애니메이션 모드에서는 selection_provider가 animation인 키포즈 샷을 생성하세요.",
		);
	}
	if (continuityTaggedRatio < 0.95) {
		score -= Math.round((0.95 - continuityTaggedRatio) * 24);
		issues.push({
			severity: continuityTaggedRatio < 0.6 ? "critical" : "warning",
			code: "weak_continuity_tagging",
			message:
				"일부 샷에 continuity_key/reference_image_path가 없어 연속성이 약합니다.",
		});
		actions.push(
			"모든 애니메이션 샷에 continuity_key와 reference_image_path를 저장하세요.",
		);
	}
	if (familyTaggedRatio < 0.95) {
		score -= Math.round((0.95 - familyTaggedRatio) * 16);
		issues.push({
			severity: "warning",
			code: "family_mismatch",
			message: "일부 샷의 제작 패밀리 태그가 스크립트 포맷과 맞지 않습니다.",
		});
		actions.push(
			"샷 생성 전 production_family를 고정하고 모든 샷에 같은 패밀리를 주입하세요.",
		);
	}
	if (sourceResolvedRatio < 1) {
		score -= Math.round((1 - sourceResolvedRatio) * 18);
		issues.push({
			severity: sourceResolvedRatio < 0.85 ? "critical" : "warning",
			code: "unresolved_animation_assets",
			message: "일부 애니메이션 샷 이미지가 아직 생성되지 않았습니다.",
		});
		actions.push("미해결 애니메이션 샷을 재생성하세요.");
	}
	if (motionCoverageRatio < 0.75) {
		score -= Math.round((0.75 - motionCoverageRatio) * 12);
		issues.push({
			severity: "warning",
			code: "static_pose_risk",
			message: "모션 지시가 부족해 이미지 나열처럼 보일 수 있습니다.",
		});
		actions.push("샷별 pan/zoom/push/drift와 컷 리듬을 보강하세요.");
	}
	if (rigCoverageRatio < 0.95) {
		score -= Math.round((0.95 - rigCoverageRatio) * 14);
		issues.push({
			severity: rigCoverageRatio < 0.5 ? "critical" : "warning",
			code: "weak_animation_rigging",
			message:
				"일부 샷에 표정/입/포즈 리깅 지시가 없어 캐릭터 연기가 평면적으로 보일 수 있습니다.",
		});
		actions.push(
			"모든 애니메이션 샷에 expression, mouthCue, pose, actionIntensity를 넣으세요.",
		);
	}
	if (sfxCueCoverageRatio < 0.9) {
		score -= Math.round((0.9 - sfxCueCoverageRatio) * 10);
		issues.push({
			severity: "warning",
			code: "weak_animation_sfx_cues",
			message:
				"일부 샷에 SFX 의도가 없어 컷/액션 타이밍이 영상처럼 묶이지 않을 수 있습니다.",
		});
		actions.push(
			"액션/리액션/정보 공개 샷에 SFX 카테고리와 강도 큐를 저장하세요.",
		);
	}
	if (uniquePromptRatio < 0.7 && animationShotCount >= 4) {
		score -= Math.round((0.7 - uniquePromptRatio) * 18);
		issues.push({
			severity: "warning",
			code: "repeated_prompt_risk",
			message: "서로 비슷한 프롬프트가 많아 장면 변화가 약할 수 있습니다.",
		});
		actions.push("각 샷에 목표, 장애물, 리액션, 결말 역할을 다르게 넣으세요.");
	}
	if (!endingCompleteness) {
		score -= 12;
		issues.push({
			severity: "warning",
			code: "weak_animation_ending",
			message: "마지막 샷이 펀치라인/루프/여운 역할로 명확하지 않습니다.",
		});
		actions.push(
			"마지막 샷을 punch/ending 역할로 바꾸고 결말 반응 또는 여운을 넣으세요.",
		);
	}

	const normalizedScore = clamp(Math.round(score), 0, 100);
	return {
		passed:
			normalizedScore >= 78 &&
			!issues.some((issue) => issue.severity === "critical"),
		score: normalizedScore,
		metrics: {
			totalScenes: scenes.length,
			totalShots,
			animationShotCount,
			referenceSheetPresent,
			continuityTaggedRatio,
			familyTaggedRatio,
			sourceResolvedRatio,
			motionCoverageRatio,
			rigCoverageRatio,
			sfxCueCoverageRatio,
			endingCompleteness,
			uniquePromptRatio,
		},
		issues,
		requiredActions: unique(actions),
	};
}

export function applyAnimationPacingRules<
	T extends AnimationSceneInput & {
		transition?: string;
		mood?: string;
		textEffect?: string;
	},
>(
	scenes: T[],
	format: "shorts" | "longform" | "both" | string,
	productionFamily?: AnimationProductionFamily,
): T[] {
	const isShorts = format === "shorts";
	return scenes.map((scene, index) => {
		const family = resolveSceneFamily(scene, productionFamily);
		const isLast = index === scenes.length - 1;
		const duration = isShorts
			? Number(
					clamp(
						scene.duration,
						scene.type === "text_emphasis" ? 1.2 : 1.6,
						isLast ? 3.2 : 4.2,
					).toFixed(2),
				)
			: Number(
					clamp(
						scene.duration,
						scene.type === "text_emphasis" ? 3 : 8,
						isLast ? 28 : 22,
					).toFixed(2),
				);
		const transition =
			index === 0
				? "none"
				: scene.type === "text_emphasis"
					? "zoom"
					: isShorts
						? index % 3 === 0
							? "whip_right"
							: "none"
						: index % 4 === 0
							? "zoom"
							: "crossfade";
		return {
			...scene,
			productionFamily: family,
			type: scene.type === "video" ? "image" : scene.type,
			sourceIndex: -1,
			duration,
			transition,
			mood:
				scene.mood && scene.mood !== "news"
					? scene.mood
					: family === "myth_horror_story"
						? "mystery"
						: family === "history_comedy" || family === "infographic_motion"
							? "serious"
							: "warm",
			textEffect:
				scene.type === "text_emphasis" &&
				(!scene.textEffect || scene.textEffect === "none")
					? "scale_in"
					: scene.textEffect,
		};
	});
}

export function summarizeAnimationBible(bible?: AnimationBible): string {
	if (!bible) return "";
	const characters = bible.characters
		.map((character) => `${character.name}: ${character.appearance}`)
		.join(" | ");
	return unique([bible.style, bible.world, characters]).join(" | ");
}
