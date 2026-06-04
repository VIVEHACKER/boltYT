import type { ResearchBrief } from "./ai-agents";
import {
	type AnimationBible,
	type AnimationProductionFamily,
	type AnimationProductionReadinessReport,
	analyzeAnimationProductionReadiness,
	formatAnimationReadinessForPrompt,
} from "./animation-production";
import { getApiProxyUrl } from "./proxy";
import type { ReferencePreset } from "./reference-bridge";
import { buildScriptConstraint } from "./reference-bridge";
import { LONGFORM_MAX_DURATION_SECONDS } from "./reference-duration-policy";
import { supabase } from "./supabase";
import {
	buildChronologicalTimeline,
	formatTimelineConstraint,
} from "./timeline";
import {
	analyzeTopicProductionReadiness,
	formatTopicProductionReadinessForPrompt,
	type TopicProductionReadinessReport,
} from "./topic-production-readiness";

interface OpenAICallOptions {
	/** 응답 최대 토큰. 장편 JSON 은 잘림 방지 위해 크게(8000~12000) 지정. */
	maxTokens?: number;
	/** true 면 response_format: json_object 강제 (단일 JSON 객체 보장, 절단/펜스 파싱 실패 제거). */
	jsonMode?: boolean;
	/** 추출/구조화=0.2~0.3, 대본 창작=0.7~0.8. 기본 0.8. */
	temperature?: number;
	/** 클라 abort 타임아웃 ms. 대용량 생성은 120_000 권장. 기본 60_000. */
	timeoutMs?: number;
}

async function callOpenAI(
	systemPrompt: string,
	userPrompt: string,
	opts?: OpenAICallOptions,
): Promise<string> {
	const proxy = getApiProxyUrl();

	const requestBody: Record<string, unknown> = {
		model: "gpt-4o",
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		],
		temperature: opts?.temperature ?? 0.8,
		max_tokens: opts?.maxTokens ?? 4096,
	};
	// JSON 객체 응답 강제 — 시스템 프롬프트에 'JSON' 명시가 있을 때만 사용 (배열 응답엔 쓰지 말 것).
	if (opts?.jsonMode) {
		requestBody.response_format = { type: "json_object" };
	}

	const res = await fetch(`${proxy}/api/openai/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(requestBody),
		signal: AbortSignal.timeout(opts?.timeoutMs ?? 60_000),
	});

	if (!res.ok) {
		throw new Error(
			`OpenAI API 오류: ${res.status} ${await readProxyError(res)}`,
		);
	}

	const json = await res.json();
	const content = json.choices?.[0]?.message?.content;
	if (!content) throw new Error("OpenAI 응답에 content가 없습니다");
	return content;
}

async function readProxyError(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const parsed = JSON.parse(text) as {
			code?: string;
			error?: unknown;
			openaiRuntime?: { quotaBlockedUntil?: string };
		};
		if (parsed.code === "openai_quota_cooldown") {
			return parsed.openaiRuntime?.quotaBlockedUntil
				? `OpenAI 쿼터 대기 중입니다. 재시도 가능 시각: ${parsed.openaiRuntime.quotaBlockedUntil}`
				: "OpenAI 쿼터 대기 중입니다.";
		}
		if (typeof parsed.error === "string") return parsed.error;
		return JSON.stringify(parsed).slice(0, 500);
	} catch {
		return text.slice(0, 500);
	}
}

function parseJSON<T>(raw: string): T {
	const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
	return JSON.parse(cleaned);
}

function compactTopicSuggestion(value: string): string {
	return value.replace(/\s+/g, " ").trim().slice(0, 34);
}

function isWeakTopicSuggestion(value: string): boolean {
	const normalized = value.replace(/\s+/g, "").toLowerCase();
	if (normalized.length < 2) return true;
	return [
		"정보가부족",
		"상세정보",
		"제공해주세요",
		"추천할수없",
		"알수없",
		"주제가필요",
	].some((token) => normalized.includes(token));
}

function buildFallbackTopicSuggestions(
	channel: Record<string, string> | null,
	seedTopic = "",
): string[] {
	const category = channel?.category || channel?.name || "미스터리";
	const seed = compactTopicSuggestion(
		seedTopic || channel?.description || category,
	);
	const mysterySeed = seed.includes("미스터리") ? seed : `${seed} 미스터리`;
	const base =
		category.includes("드라마") || category.includes("영화")
			? [
					`${seed} 결말이 바뀌는 순간`,
					`${seed} 숨겨진 복선 5가지`,
					`${seed} 인물 관계 완전정리`,
					`${seed} 다시 보면 소름인 장면`,
					`${seed} 몰아보기 전 핵심요약`,
				]
			: [
					`${mysterySeed}의 기록 공백`,
					`${seed} 현장 증거 3가지`,
					`${seed}가 아직 설명 안 된 이유`,
					`${seed} 지도에만 남은 흔적`,
					`${seed} 한 장의 사진이 바꾼 사건`,
				];

	return Array.from(new Set(base.map(compactTopicSuggestion))).slice(0, 5);
}

export function buildDeterministicTopicSuggestions(
	channel: Partial<Record<string, string>> | null,
	seedTopic = "",
): string[] {
	return buildFallbackTopicSuggestions(
		channel as Record<string, string> | null,
		seedTopic,
	);
}

function normalizeTopicSuggestions(
	raw: unknown,
	channel: Record<string, string> | null,
	seedTopic = "",
): string[] {
	const parsed = Array.isArray(raw) ? raw : [];
	const usable = parsed
		.filter((item): item is string => typeof item === "string")
		.map(compactTopicSuggestion)
		.filter((item) => item && !isWeakTopicSuggestion(item));

	if (usable.length >= 3) {
		return Array.from(new Set(usable)).slice(0, 5);
	}

	return buildFallbackTopicSuggestions(channel, seedTopic);
}

export async function fetchTopicSuggestions(
	channelId: string,
	seedTopic = "",
): Promise<string[]> {
	const { data: channel } = await supabase
		.from("channels")
		.select("*")
		.eq("id", channelId)
		.maybeSingle();

	const ch = channel as Record<string, string> | null;

	const result = await callOpenAI(
		"당신은 유튜브 콘텐츠 기획 전문가입니다. 채널의 특성을 정확히 파악하여 시청자가 클릭할 만한 구체적이고 트렌디한 주제를 추천합니다. 반드시 JSON 배열로만 응답하세요.",
		`다음 채널 정보를 분석하고, 이 채널에 딱 맞는 유튜브 콘텐츠 주제 5개를 추천해주세요.

채널명: ${ch?.name ?? ""}
카테고리: ${ch?.category ?? ""}
채널 설명: ${ch?.description ?? ""}
톤앤매너: ${ch?.tone ?? ""}
언어: ${ch?.language ?? "ko"}
기본 CTA: ${ch?.default_cta ?? ""}
현재 입력 주제: ${seedTopic || "(없음)"}

주제 작성 규칙:
- 채널의 카테고리와 설명에 맞는 구체적인 주제
- 현재 입력 주제가 있으면 같은 편집 문법으로 확장 가능한 후속/변형 주제
- 시청자의 호기심을 자극하는 제목 형태 (숫자, 질문, 비교 등)
- 최신 트렌드 반영
- "정보 부족", "상세 정보 필요" 같은 회피 답변 금지
- 각 주제는 30자 이내

응답 형식: ["주제1", "주제2", "주제3", "주제4", "주제5"]`,
	);

	return normalizeTopicSuggestions(parseJSON<unknown>(result), ch, seedTopic);
}

interface BriefResult {
	core_message: string;
	target_audience: string;
	cautions: string;
	shorts_hooks: string[];
	longform_outline: string[];
}

export async function generateBrief(topicId: string): Promise<BriefResult> {
	const { data: topic } = await supabase
		.from("topics")
		.select("*")
		.eq("id", topicId)
		.maybeSingle();

	const t = topic as Record<string, string> | null;

	const result = await callOpenAI(
		"당신은 유튜브 콘텐츠 브리프 작성 전문가입니다. 반드시 지정된 JSON 형식으로만 응답하세요.",
		`주제: ${t?.title ?? ""}

브리프 작성 규칙:
- core_message: 이 주제 고유의 핵심 메시지 1~2문장 (일반론 금지).
- longform_outline: 이 주제를 8~12개 챕터로 쪼갠 골격. 각 항목은 "N. <이 주제의 구체적 사건/논점>" 형태로, 주제의 고유명사·핵심 질문이 드러나게.
- shorts_hooks: 스크롤을 멈출 강한 훅 3개 (주제 고유 사실 기반).

응답 형식:
{"core_message": "핵심 메시지", "target_audience": "타겟 시청자", "cautions": "주의사항", "shorts_hooks": ["훅1", "훅2", "훅3"], "longform_outline": ["1. 도입", "2. 본론", "3. 결론"]}`,
		{ temperature: 0.7, jsonMode: true, maxTokens: 2000 },
	);

	return parseJSON<BriefResult>(result);
}

interface SceneResult {
	narration: string;
	type: "image" | "video" | "text_emphasis" | "news_overlay";
	visual_prompt: string;
	source_index?: number;
	duration: number;
	news_title?: string;
	news_source?: string;
	news_excerpt?: string;
	news_date?: string;
	// v2: 프리미엄 연출 필드
	transition?:
		| "crossfade"
		| "zoom"
		| "slide_left"
		| "slide_right"
		| "glitch"
		| "whip_left"
		| "whip_right"
		| "none";
	mood?: "horror" | "mystery" | "news" | "neutral" | "warm";
	text_effect?: "typewriter" | "glitch" | "scale_in" | "none";
}

interface ScriptResult {
	shorts_script: string;
	longform_scenes: SceneResult[];
	animation_bible?: AnimationBible;
	production_family?: AnimationProductionFamily;
}

function formatMinutes(seconds: number): string {
	const minutes = seconds / 60;
	if (!Number.isFinite(minutes) || minutes <= 0) return "6~12분";
	if (minutes >= 60) {
		const hours = Math.floor(minutes / 60);
		const rest = Math.round(minutes % 60);
		return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
	}
	return `${Math.round(minutes)}분`;
}

function isFeatureLengthReference(referencePreset?: ReferencePreset): boolean {
	return (
		(referencePreset?.script?.targetDuration ?? 0) >=
		LONGFORM_MAX_DURATION_SECONDS
	);
}

/**
 * 비드라마 주제에 장편(20분/30씬급) 레퍼런스가 걸렸을 때, buildScriptConstraint 가 주입하는
 * 길이/씬수 수치만 일반 롱폼으로 다운그레이드한다(스타일/톤/썸네일 DNA 는 유지).
 * → 대본 프롬프트에 모순된 길이 지시가 들어가지 않아 드라마 길이로 드리프트하지 않음.
 */
function downgradeFeatureLengthPreset(
	preset: ReferencePreset | undefined,
	useFeatureLengthDrama: boolean,
): ReferencePreset | undefined {
	if (!preset || useFeatureLengthDrama || !isFeatureLengthReference(preset)) {
		return preset;
	}
	return {
		...preset,
		script: {
			...preset.script,
			sceneCount: Math.min(preset.script.sceneCount, 16),
			targetDuration: Math.min(preset.script.targetDuration, 600),
			avgSceneDuration: Math.min(preset.script.avgSceneDuration, 32),
			// 장편(20분) 구조 행이 다운그레이드된 길이와 모순되지 않게 비운다(구조는 일반 롱폼 규칙이 담당).
			structure: [],
		},
	};
}

function buildLongformPacing(referencePreset?: ReferencePreset): string {
	if (!referencePreset?.script) {
		return "롱폼: 10~18개 씬, 6~12분 목표, 최대 20분 초과 금지. 씬당 10~28초. 챕터형 전개, 나레이션 3~6문장, 자료/문서/지도/영상 근거를 번갈아 사용.";
	}

	const target = referencePreset.script.targetDuration;
	const sceneCount = referencePreset.script.sceneCount;
	const avg = referencePreset.script.avgSceneDuration;
	const hook = referencePreset.script.hookDuration;

	if (isFeatureLengthReference(referencePreset)) {
		return `레퍼런스 롱폼 상한: ${sceneCount}개 내외 씬, ${formatMinutes(target)} 목표, 최대 20분 초과 금지. 첫 ${hook}초 안에 작품의 핵심 아이러니/비밀을 던지고, 5~7개 챕터로 쪼개세요. 씬 평균은 ${avg}초이며, 각 씬은 실제 TTS 길이가 맞도록 충분한 나레이션(4~7문장)을 작성합니다. 줄거리 요약만 나열하지 말고 인물 관계, 선택의 이유, 장르적 재미, 결말 회수를 섞어 중반 반복을 막으세요.`;
	}

	return `레퍼런스 롱폼: ${sceneCount}개 내외 씬, ${formatMinutes(target)} 목표, 최대 20분 초과 금지. 씬 평균 ${avg}초, 첫 ${hook}초는 강한 질문/상황으로 시작합니다. 챕터형 전개와 자료/문서/지도/영상 근거를 번갈아 사용하세요.`;
}

function isDramaRecapContentContext(contentStrategyContext?: string): boolean {
	if (!contentStrategyContext) return true;
	// '카테고리:' 라인만 검사 — 레퍼런스/지시 텍스트에 들어간 '드라마/영화 해설' 오탐을 막아
	// 비드라마 주제에 드라마 레퍼런스를 써도 드라마 규칙이 잘못 적용되지 않게 한다.
	const categoryLine = contentStrategyContext
		.split("\n")
		.find((line) => line.trim().startsWith("카테고리:"));
	const target = categoryLine ?? contentStrategyContext;
	return /드라마\/영화|drama_recap/i.test(target);
}

function buildLongformSceneRules(
	referencePreset?: ReferencePreset,
	options: { useFeatureLengthRules?: boolean } = {},
): string {
	const useFeatureLengthRules =
		options.useFeatureLengthRules ?? isFeatureLengthReference(referencePreset);
	if (!useFeatureLengthRules) {
		return `=== 롱폼(16:9) 규칙 ===
5단계 네러티브 구조를 반드시 지킨다. 비율은 전체 씬 수 기준.

[도입 — 전체의 15%]
- 씬1: 핵심 질문/충격 사실로 바로 시작. "~이 있습니다"형 설명 금지.
- 강렬한 영상/이미지 + zoom 트랜지션. duration: 10~18초.

[배경 — 전체의 20%]
- 씬2~4: 사건·인물·맥락 소개. 시청자가 몰입할 맥락만. duration: 14~24초.
- transition: crossfade or slide_left.

[전개 — 전체의 40%]
- 씬5~12: 핵심 사실을 하나씩 순서대로 풀어감. 각 씬에 하나의 포인트만.
- 수집 이미지·영상·문서·지도 최대 활용. duration: 16~28초. transition: crossfade.

[반전/클라이맥스 — 전체의 15%]
- 가장 놀라운 반전 또는 핵심 충격. text_emphasis는 사용하지 말고 증거/문서/지도/영상/디테일 샷으로 보여주세요.
- mood: "horror" 또는 "mystery". duration: 10~20초.

[결말 — 전체의 10%]
- 마지막 씬: 현재 상황, 미해결 의문, 다음에 확인해야 할 사실, 부드러운 CTA. duration: 18~32초.
- transition: crossfade. mood: "neutral" or "warm".

공통:
- 총 10~18개 씬, 6~12분 분량을 목표로 하고 20분을 절대 넘기지 않는다.
- 나레이션은 씬당 3~6문장. 짧은 구어체 문장. 접속사로 자연스럽게 연결.
- 쇼츠식 6~8초 인터럽트를 반복하지 말고, 챕터마다 화면 문법을 바꾼다.
- video 비율은 자료가 충분할 때 40~55% 수준. 나머지는 문서, 지도, 아카이브 이미지, 정교한 재구성으로 근거 밀도를 만든다.
- 각 단계 전환 시 transition으로 리듬 변화를 준다.`;
	}

	const fls = referencePreset?.script;
	const target = fls?.targetDuration ?? LONGFORM_MAX_DURATION_SECONDS;
	const sceneCount = fls?.sceneCount ?? 24;
	const avg = fls?.avgSceneDuration ?? 30;
	const minScenes = Math.max(18, Math.min(32, sceneCount - 4));
	const maxScenes = Math.max(minScenes, Math.min(36, sceneCount + 4));
	return `=== 장편 몰아보기 롱폼(16:9) 규칙 ===
- 목표 길이: ${formatMinutes(target)}. 총 ${minScenes}~${maxScenes}개 씬을 만들고 20분을 절대 넘기지 않는다.
- 씬 duration 평균은 ${avg}초 전후로 잡고, 실제 TTS 길이가 너무 짧아지지 않도록 각 씬 나레이션을 4~7문장으로 충분히 작성한다.
- 구조는 cold open → 작품 전제 → 인물 관계 → 1막 사건 → 중반 반전 → 압박 누적 → 감정 저점 → 결말 회수 → 짧은 리뷰 순서로 간다.
- 드라마/영화 제목이 주어지면 줄거리, 인물 관계, 장르 톤, 공개 자료를 분석해 새 해설 대본으로 재구성한다.
- 원작 대사나 특정 장면 묘사를 그대로 베끼지 말고, 시청자가 이해할 수 있는 요약·해석·연결 설명으로 쓴다.
- 영상 슬롯은 사용자가 권리를 가진 클립/예고편/공식 공개 자료/직접 업로드 자료를 넣는 전제로 배치한다. 자료가 없으면 문서형 화면, 관계도, 챕터 카드, 이미지 재구성으로 대체한다.
- BGM은 도입, 코믹 완급, 긴장, 감정 저점, 결말 회수마다 분위기가 바뀌도록 장면 mood를 조절한다.
- 쇼츠식 텍스트 카드 남발 금지. 긴 호흡의 해설과 장면 근거가 이어져야 한다.
- transition은 crossfade, slide, zoom 중심. glitch/whip은 중간 반전이나 클라이맥스에만 제한적으로 사용한다.`;
}

export async function generateScript(
	briefId: string,
	format: string,
	referencePreset?: ReferencePreset,
	productionType: "standard" | "animation" = "standard",
	animationReadiness?: AnimationProductionReadinessReport,
	contentStrategyContext?: string,
): Promise<ScriptResult> {
	const { data: brief } = await supabase
		.from("briefs")
		.select("*")
		.eq("id", briefId)
		.maybeSingle();

	const b = brief as Record<string, unknown> | null;

	const isShorts = format === "shorts";
	if (productionType === "animation") {
		const readiness =
			animationReadiness ??
			analyzeAnimationProductionReadiness({
				topicTitle: String(b?.core_message ?? ""),
				format,
			});
		const familyRules = `제작 포맷 패밀리:
- id: ${readiness.productionFamily}
- label: ${readiness.productionFamilyLabel}
- 이 포맷은 특정 채널 복제가 아니라 공개적으로 관찰 가능한 구조/리듬/샷 문법만 참고합니다.
- 품질 게이트: ${readiness.qualityGates.join(" / ")}
- 리스크 제어: ${readiness.riskControls.join(" / ")}`;
		const pacing = isShorts
			? "쇼츠 애니메이션: 7~12개 씬, 30~55초. 첫 2초 안에 주인공의 문제 또는 반전을 보여주세요. 컷은 빠르지만 캐릭터 외형은 유지하세요."
			: "롱폼 애니메이션: 10~18개 씬, 4~8분 목표. 3막 구조(도입/실패/전환/클라이맥스/여운)를 지키고 중반부에 새 갈등을 넣으세요.";
		const referenceSection = referencePreset
			? `\n${buildScriptConstraint(referencePreset)}\n`
			: "";
		const contentStrategySection = contentStrategyContext
			? `\n=== 주제 맞춤 제작 지시서 ===\n${contentStrategyContext}\n`
			: "";
		const result = await callOpenAI(
			"당신은 유튜브 애니메이션 쇼츠/롱폼 작가이자 스토리보드 디렉터입니다. 반드시 지정된 JSON 형식으로만 응답하세요.",
			`브리프:
핵심 메시지: ${b?.core_message ?? ""}
타겟: ${b?.target_audience ?? ""}
주의사항: ${b?.cautions ?? ""}
형식: ${format}

${formatAnimationReadinessForPrompt(readiness)}
${familyRules}
${referenceSection}
${contentStrategySection}

${pacing}

작성 규칙:
- 실사 다큐/뉴스 자료 기반처럼 쓰지 마세요. 모든 장면은 애니메이션 키포즈와 캐릭터 액션으로 설계합니다.
- 캐릭터 바이블을 먼저 만들고, 모든 visual_prompt에 같은 주인공 외형/의상/색상/세계관 단서를 반복하세요.
- 제작 포맷 패밀리(${readiness.productionFamilyLabel})에 맞는 샷 문법과 결말 방식을 따르세요.
- 유명 채널 레퍼런스는 구조 분석용입니다. 특정 캐릭터, 고유 그래픽 스타일, 대사, 편집 리듬을 그대로 모사하지 마세요.
- 캐릭터가 매 컷 다른 사람처럼 보이지 않도록 외형 문장을 고정해서 visual_prompt에 넣으세요.
- 씬마다 하나의 스토리 비트만 다루세요: 목표, 방해, 리액션, 실패, 선택, 반전, 결말.
- TTS는 캐릭터 대사처럼 자연스러운 구어체로 쓰되, 자막이 길어지지 않게 짧은 문장으로 자릅니다.
- type은 image만 사용하세요. 텍스트만 보이는 강조 씬은 만들지 마세요.
- 훅과 반전은 별도 카드 화면이 아니라 캐릭터 액션, 표정 변화, 오브젝트 클로즈업, 컷 전환으로 보여주세요.
- visual_prompt는 영어로 작성하고, 텍스트/로고/워터마크를 넣지 마세요.

응답 형식:
{
  "production_family": "${readiness.productionFamily}",
  "animation_bible": {
    "style": "consistent 2D character animation",
    "world": "short world description",
    "characters": [
      {
        "name": "character name",
        "role": "protagonist",
        "appearance": "fixed appearance, outfit, color, silhouette",
        "personality": "personality",
        "voice_tone": "voice direction"
      }
    ],
    "recurring_props": ["prop1", "prop2"],
    "color_palette": ["color1", "color2"]
  },
  "shorts_script": "쇼츠용 스크립트",
  "longform_scenes": [
    {
      "narration": "짧은 나레이션 또는 대사",
      "type": "image",
      "visual_prompt": "English prompt with fixed character appearance and action",
      "duration": ${isShorts ? 3 : 12},
      "transition": "none",
      "mood": "warm",
      "text_effect": "none"
    }
  ]
}`,
			// 애니메이션 대본 창작 — jsonMode 로 절단 방지, 캐릭터 일관성 위해 충분한 max_tokens.
			{
				jsonMode: true,
				temperature: 0.8,
				maxTokens: isShorts ? 4096 : 8000,
				timeoutMs: isShorts ? 60_000 : 120_000,
			},
		);

		return parseJSON<ScriptResult>(result);
	}
	// 일반 레퍼런스 페이싱은 보존하고, 장편(20분/30씬급) 레퍼런스가 비드라마 주제에 걸렸을 때만
	// 길이/씬수를 일반 롱폼으로 다운그레이드(스타일/훅은 유지). 일반 레퍼런스엔 영향 없음.
	const useFeatureLengthDrama =
		isFeatureLengthReference(referencePreset) &&
		isDramaRecapContentContext(contentStrategyContext);
	const pacingPreset = downgradeFeatureLengthPreset(
		referencePreset,
		useFeatureLengthDrama,
	);
	const pacing = isShorts
		? "쇼츠: 7~12개 씬, 30~55초. 첫 10초는 씬당 1.5~3초, 이후도 4.2초 초과 금지. 나레이션 1~2문장. 하드컷/whip/glitch 전환 70% 이상."
		: buildLongformPacing(pacingPreset);
	const mediaBalance = isShorts
		? `- 기본값은 image가 아니라 video라고 생각하세요. evidence/quote/document 성격의 씬이 아니면 우선 video를 선택하세요.
	- 전체 비텍스트 씬 중 절반 이상은 video 타입이 되도록 구성하세요.
	- 시작 10초 안에 들어가는 첫 2~3개 씬은 80% 이상이 video 타입이 되도록 구성하세요.`
		: `- 롱폼은 쇼츠처럼 모든 장면을 빠른 video로 몰지 마세요. 실제 영상, 문서, 지도, 기사 이미지, 재구성 이미지를 챕터 리듬에 맞게 배치하세요.
	- 관련 영상 자료가 충분할 때만 비텍스트 씬의 40~55%를 video로 구성하세요. 영상 자료가 약하면 무리하게 video 타입을 늘리지 마세요.
	- 시작부는 강한 질문으로 열되, 10초마다 휙휙 바뀌는 쇼츠식 인터럽트보다 출처와 맥락이 보이는 다큐 리듬을 우선하세요.`;
	const policyGuard = `- AI 재구성/합성 장면을 실제 CCTV, 실제 영상, 단독 영상처럼 표현하지 마세요.
	- 출처가 없는 내용은 단정하지 말고 "자료에 따르면", "보도에 따르면", "추정됩니다"처럼 근거 수준을 표현하세요.
	- 잔혹 장면, 시신, 유혈, 사고 순간을 충격 유도용으로 묘사하지 마세요. 필요한 경우 비노출 자료와 맥락 설명으로 대체하세요.
	- 같은 템플릿을 반복한 대량생산형 영상처럼 보이지 않게, 이 주제만의 타임라인/근거/해석/결론을 넣으세요.`;

	const constraintPreset = downgradeFeatureLengthPreset(
		referencePreset,
		useFeatureLengthDrama,
	);
	const referenceSection = constraintPreset
		? `\n${buildScriptConstraint(constraintPreset)}\n`
		: "";
	const contentStrategySection = contentStrategyContext
		? `\n=== 주제 맞춤 제작 지시서 ===\n${contentStrategyContext}\n`
		: "";

	// generateBrief 가 만든 골격(아웃라인/훅)을 버리지 않고 대본 생성에 주입 — 자료 없는 경로의 내용 빈약/주제 드리프트 방지.
	const coreMessage = String(b?.core_message ?? "");
	const outline = Array.isArray(b?.longform_outline)
		? (b?.longform_outline as unknown[])
				.map((x) => String(x).trim())
				.filter(Boolean)
		: [];
	const shortsHooks = Array.isArray(b?.shorts_hooks)
		? (b?.shorts_hooks as unknown[])
				.map((x) => String(x).trim())
				.filter(Boolean)
		: [];
	const briefBlock = [
		`핵심 메시지: ${coreMessage}`,
		`타겟: ${b?.target_audience ?? ""}`,
		b?.cautions ? `주의사항: ${b.cautions}` : "",
		!isShorts && outline.length
			? `장편 아웃라인(이 골격을 빠짐없이 씬으로 확장):\n${outline
					.map((x, i) => `${i + 1}. ${x.replace(/^\d+[.)]\s*/, "")}`)
					.join("\n")}`
			: "",
		isShorts && shortsHooks.length
			? `쇼츠 훅 후보: ${shortsHooks.join(" / ")}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
	const outlineRule =
		!isShorts && outline.length
			? "\n\t- 위 장편 아웃라인의 모든 항목을 순서대로 빠짐없이 다루되, 전체 씬 수는 위 페이싱 규칙의 목표 범위 안에서 항목 비중에 맞게 배분하세요(항목당 고정 씬 수를 강제하지 말 것)."
			: "";
	// 장편 레퍼런스인데 비드라마 주제면, 레퍼런스의 20분/30씬 길이는 무시하라고 명시(드리프트 방지).
	const featureLengthReconcileRule =
		!isShorts &&
		isFeatureLengthReference(referencePreset) &&
		!isDramaRecapContentContext(contentStrategyContext)
			? "\n\t- 주의: 레퍼런스의 장편(20분/30씬급) 길이·씬 수는 드라마 몰아보기 전용이다. 이 주제는 드라마 해설이 아니므로 레퍼런스 길이/씬 수는 무시하고 6~12분 일반 롱폼으로 구성하라."
			: "";
	const topicFidelityBlock = coreMessage
		? `\n=== 절대 준수: 주제 충실도 (최우선) ===
이 영상은 "${coreMessage}"를 다룬다. 첫 씬에서 핵심 대상·사건을 제시하고 모든 씬이 그것을 이어가되, 주제와 무관한 일반 상식·다른 사건으로 새지 마라. 같은 주제 문구를 매 씬 반복하지 말고 대명사·맥락으로 자연스럽게 이어가라.`
		: "";

	const result = await callOpenAI(
		"당신은 유튜브 영상 스크립트 작성 전문가입니다. 반드시 지정된 JSON 형식으로만 응답하세요.",
		`브리프:\n${briefBlock}\n형식: ${format}\n\n${pacing}${referenceSection}${contentStrategySection}

	씬 작성 규칙:
	- 씬은 시간순 또는 인과순으로 흘러가야 합니다.
	- 각 씬은 하나의 사건/정보 비트만 다루세요.${outlineRule}${featureLengthReconcileRule}
	${mediaBalance}
	${policyGuard}
	- visual_prompt는 그 씬에서 실제로 보여야 할 장면을 영어로 구체적으로 쓰세요. 추상적인 분위기 설명만 쓰지 마세요.
	- visual_prompt에는 장소 + 인물/대상 + 행동/증거물 중 최소 2가지를 포함해, 한 씬을 3~5개의 샷으로 쪼개도 성립하게 쓰세요.
	- 앞 씬과 겹치는 화면 설명을 반복하지 마세요.

응답 형식:
{"shorts_script": "쇼츠 스크립트", "longform_scenes": [{"narration": "나레이션", "type": "image", "visual_prompt": "visual description in English", "duration": ${isShorts ? 4 : 8}, "transition": "crossfade", "mood": "mystery", "text_effect": "none"}]}

visual_prompt는 영어로.${topicFidelityBlock}`,
		// 대본 창작 — 사실 안정성 위해 0.7, 장편은 잘림 방지 위해 max_tokens 상향 + 타임아웃 연장.
		{
			jsonMode: true,
			temperature: 0.7,
			maxTokens: isShorts ? 4096 : 8000,
			timeoutMs: isShorts ? 60_000 : 120_000,
		},
	);

	return parseJSON<ScriptResult>(result);
}

interface SourceForScript {
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

/**
 * 수집된 자료에서 팩트 기반 리서치 브리프 추출.
 * — 기사 본문(bodyText)이 있으면 사용, 없으면 description(스니펫)만 사용
 * — 스크립트 작성 전에 호출되면 AI가 사실을 지어낼 여지를 크게 줄임
 */
/** 보조 팩트 자료로 채택할 영상/이미지 설명 최소 길이 — 짧은 캡션 노이즈 차단. */
const SUPPLEMENTARY_SOURCE_MIN_LENGTH = 200;

export async function extractResearchBrief(
	topicTitle: string,
	sources: SourceForScript[],
): Promise<ResearchBrief> {
	const empty: ResearchBrief = {
		summary: "",
		timeline: [],
		key_figures: [],
		facts: [],
		misconceptions: [],
		search_keywords: [],
	};
	// 기사 본문이 1순위. 미스터리/사건 주제는 자료가 영상 자막/설명 위주인 경우가 많아,
	// 충분히 긴(노이즈 아닌) 영상/이미지 설명도 보조 팩트 소스로 포함한다.
	const articles = sources.filter((s) => s.type === "article");
	const supplementary = sources.filter(
		(s) =>
			s.type !== "article" &&
			(s.bodyText || s.description || "").trim().length >=
				SUPPLEMENTARY_SOURCE_MIN_LENGTH,
	);
	if (articles.length === 0 && supplementary.length === 0) {
		return empty;
	}

	const articleText = articles
		.slice(0, 8) // 토큰 보호: 최대 8개 기사
		.map((a, i) => {
			const body = (a.bodyText || a.description || "").slice(0, 3500);
			const meta = [a.publisher, a.pubDate].filter(Boolean).join(" · ");
			return `[기사${i + 1}${meta ? ` — ${meta}` : ""}] ${a.title}\n${body}`;
		})
		.join("\n\n---\n\n");

	const supplementaryText = supplementary
		.slice(0, 6)
		.map((s, i) => {
			const body = (s.bodyText || s.description || "").slice(0, 2500);
			const label = s.type === "video" ? "영상 설명/자막" : "이미지 설명";
			return `[${label}${i + 1}] ${s.title}\n${body}`;
		})
		.join("\n\n---\n\n");

	const result = await callOpenAI(
		`당신은 한국어 뉴스 분석 전문 리서처입니다.
아래 수집된 자료에서 **자료에 실제로 언급된 사실만** 추출하세요.

규칙:
- 자료에 없는 내용은 절대 추가 금지(사전지식 금지).
- 날짜·인물·장소·수치는 자료에 나온 그대로.
- 영상 설명/자막·이미지 설명은 보조 자료로만 취급하고, 거기서도 명시된 사실만 사용하며 추측하지 마세요.
- misconceptions(대중의 오해)는 자료에 명시된 경우만.
- search_keywords: 이 주제 이미지/영상 검색용 한국어 10개.
반드시 JSON으로만 응답.`,
		`주제: ${topicTitle}
${articleText ? `\n=== 수집된 기사 ===\n${articleText}\n` : ""}${supplementaryText ? `\n=== 보조 자료 (영상 설명/자막·이미지 설명) ===\n${supplementaryText}\n` : ""}
응답 형식:
{
  "summary": "사건/주제 요약 3-5문장",
  "timeline": [{"date": "2024.05.10", "event": "이벤트"}],
  "key_figures": [{"name": "이름", "role": "역할"}],
  "facts": ["팩트1", "팩트2"],
  "misconceptions": ["오해1"],
  "search_keywords": ["키워드1", "키워드2"]
}`,
		// 추출/구조화 작업 — 저온도로 사실 변형·할루시네이션 억제, jsonMode 로 파싱 안정화.
		{ temperature: 0.2, jsonMode: true, maxTokens: 2000 },
	);

	return parseJSON<ResearchBrief>(result);
}

/** 자료 기반 스크립트 생성 — 리서치 브리프 + 수집된 자료를 참조하여 영상 구성 */
export async function generateResearchScript(
	topicId: string,
	sources: SourceForScript[],
	format: string,
	researchBrief?: ResearchBrief,
	referencePreset?: ReferencePreset,
	productionReadiness?: TopicProductionReadinessReport,
	nichePlaybookContext?: string,
	contentStrategyContext?: string,
): Promise<ScriptResult> {
	const { data: topic } = await supabase
		.from("topics")
		.select("*")
		.eq("id", topicId)
		.maybeSingle();

	const t = topic as Record<string, string> | null;
	const topicTitle = (t?.title ?? "").trim();

	// 브리프가 제공되지 않았고 기사가 수집돼 있으면 자동으로 팩트 추출
	// (C: 자료 기반 모드에서 할루시네이션 방지)
	let effectiveBrief = researchBrief;
	if (!effectiveBrief) {
		// 기사뿐 아니라 충분히 긴 영상 자막/이미지 설명도 팩트 추출 대상 (영상 전용 입력 지원).
		const hasExtractableSources = sources.some(
			(s) =>
				(s.type === "article" && (s.bodyText || s.description)) ||
				(s.type !== "article" &&
					(s.bodyText || s.description || "").trim().length >=
						SUPPLEMENTARY_SOURCE_MIN_LENGTH),
		);
		if (hasExtractableSources) {
			try {
				effectiveBrief = await extractResearchBrief(t?.title ?? "", sources);
			} catch {
				// 실패해도 스크립트 생성은 계속 — brief 없이 진행
			}
		}
	}

	// 통합 인덱스: 모든 자료에 순번 부여 (이미지/기사/영상 구분 없이)
	// 기사는 스크래핑한 본문(bodyText)이 있으면 우선 사용 — 팩트 밀도↑
	const sourceList = sources
		.map((s, i) => {
			const sceneTitle = s.eventTitle || s.title;
			const eventDateMeta = s.eventDate ? `사건시점 ${s.eventDate}` : "";
			const publishDateMeta =
				s.pubDate && s.pubDate !== s.eventDate ? `기사일 ${s.pubDate}` : "";
			if (s.type === "image") {
				const meta = [eventDateMeta].filter(Boolean).join(" · ");
				return `[자료${i}] 타입: 이미지 | ${sceneTitle}${meta ? ` (${meta})` : ""} | URL: ${s.url}`;
			}
			if (s.type === "article") {
				const body = (s.bodyText || s.description || "").slice(0, 3500);
				const meta = [s.publisher, eventDateMeta, publishDateMeta]
					.filter(Boolean)
					.join(" · ");
				return `[자료${i}] 타입: 기사 | ${sceneTitle}${meta ? ` (${meta})` : ""}\n본문: ${body}`;
			}
			const meta = [s.publisher, eventDateMeta].filter(Boolean).join(" · ");
			return `[자료${i}] 타입: 영상 | ${sceneTitle}${meta ? ` (${meta})` : ""} | URL: ${s.url}`;
		})
		.join("\n\n");

	// 타임라인 오케스트레이터: 시간순 정렬 + 소스 매핑
	const timeline = effectiveBrief
		? buildChronologicalTimeline(
				effectiveBrief,
				sources.map((source) => ({
					title: source.eventTitle || source.title,
					bodyText: source.bodyText,
					eventDate: source.eventDate,
					pubDate: source.pubDate,
				})),
			)
		: null;
	const timelineConstraint = timeline ? formatTimelineConstraint(timeline) : "";

	// 리서치 브리프가 있으면 팩트 섹션 추가
	const researchSection = effectiveBrief
		? `
=== 리서치 브리프 (검증된 팩트) ===
요약: ${effectiveBrief.summary}
핵심 인물: ${effectiveBrief.key_figures.map((f) => `${f.name}(${f.role})`).join(", ")}
팩트: ${effectiveBrief.facts.join(" | ")}
대중의 오해: ${effectiveBrief.misconceptions.join(" | ")}

${timelineConstraint}
`
		: "";

	// 드라마 게이팅: 장편 레퍼런스라도 비드라마 주제면 일반 롱폼 규칙/길이를 쓴다.
	const featureLengthReference = isFeatureLengthReference(referencePreset);
	const useFeatureLengthDramaRules =
		featureLengthReference &&
		isDramaRecapContentContext(contentStrategyContext);
	// 레퍼런스 템플릿이 있으면 스타일 준수 지시 추가 (비드라마면 길이 수치는 다운그레이드)
	const constraintPreset = downgradeFeatureLengthPreset(
		referencePreset,
		useFeatureLengthDramaRules,
	);
	const referenceSection = constraintPreset
		? `\n${buildScriptConstraint(constraintPreset)}\n`
		: "";
	const readinessReport =
		productionReadiness ??
		analyzeTopicProductionReadiness({
			topicTitle: t?.title ?? "",
			format,
			sources,
			researchBrief: effectiveBrief,
		});
	const productionReadinessSection = `\n${formatTopicProductionReadinessForPrompt(readinessReport)}\n`;
	const nichePlaybookSection = nichePlaybookContext
		? `\n=== 니치 리서치 플레이북 ===\n${nichePlaybookContext}\n`
		: "";
	const contentStrategySection = contentStrategyContext
		? `\n=== 주제 맞춤 제작 지시서 ===\n${contentStrategyContext}\n`
		: "";

	const isShorts = format === "shorts";
	const mediaBalanceRules = isShorts
		? `9. evidence/quote/document 성격이 아닌 씬은 기본적으로 video 타입을 우선하세요. 비텍스트 씬의 60% 이상을 video로 구성하세요.
10. 시작 10초 안에 들어가는 첫 2~3개 씬은 최소 80%가 video 타입이 되게 하세요.`
		: useFeatureLengthDramaRules
			? `9. 장편 몰아보기는 영상 클립만 이어붙이지 말고, 인물 관계도/챕터 카드/자료 화면/재구성 이미지/사용자 제공 클립을 챕터별로 섞으세요.
10. 관련 영상 자료가 충분한 경우에도 비텍스트 씬의 35~50%만 video로 두고, 나머지는 이해를 돕는 편집 화면으로 구성하세요.
11. 각 씬 나레이션은 실제 TTS 길이가 duration에 맞도록 충분히 작성하세요. 짧은 요약문만 쓰면 장편 목표 길이에 도달하지 못합니다.`
			: `9. 롱폼은 쇼츠식 video 과밀 편집을 피하고, 실제 영상/문서/지도/기사 이미지/재구성 컷을 챕터별로 섞으세요.
10. 관련 영상 자료가 충분한 경우에만 비텍스트 씬의 40~55%를 video로 구성하세요. 영상 자료가 약하면 image/document/map/evidence 씬을 우선하세요.`;
	const policyGuard = `정책/신뢰 가드:
- AI 재구성/합성 장면을 실제 CCTV, 실제 영상, 단독 영상처럼 표현하지 마세요.
- 실제 인물·장소·사건을 현실적으로 합성한 경우 업로드 설명에 AI 재구성 고지가 필요하다는 전제로 작성하세요.
- 출처 없는 단정, 범인 확정, 조작/은폐 같은 고위험 주장은 자료 근거가 있을 때만 쓰고, 없으면 추정 표현으로 낮추세요.
- 잔혹 장면, 시신, 유혈, 사고 순간은 충격 유도용으로 묘사하지 말고 비노출 자료와 맥락 설명으로 대체하세요.
	- 기사 읽기/이미지 슬라이드쇼처럼 보이지 않게 원본 해설, 사건 순서, 자료 해석, 결론을 반드시 포함하세요.`;

	const systemRole = useFeatureLengthDramaRules
		? `당신은 한국 유튜브 드라마/영화 몰아보기 롱폼 작가이자 편집 구성 디렉터입니다.
핵심은 작품/주제를 분석해 새 해설 대본, 챕터 구성, 장면별 음악 톤, TTS 호흡을 설계하는 것입니다.
원본 영상·음악·대사를 그대로 복제하지 말고 공개 자료와 사용자 제공 클립을 전제로 새 설명/해석으로 재구성하세요.`
		: `당신은 한국 유튜브 미스테리/공포/정보 채널의 스크립트 작성 전문가입니다.
참고 채널: "편집중", "까마귀의 밤", "미스테리 호러쇼" 스타일.
`;

	const result = await callOpenAI(
		`${systemRole}

핵심 원칙:
${topicTitle ? `0. 이 영상의 주제는 "${topicTitle}"이다. 첫 씬에서 이 주제의 구체적 대상·사건을 분명히 제시하고, 이후 모든 씬이 같은 사건을 이어가게 하라. 주제 문구를 매 씬 기계적으로 반복하지 말고 대명사·맥락으로 자연스럽게 잇되, 다른 사건·일반론으로 새지 마라.` : ""}
1. 자료에 나오는 구체적인 정보(인물 이름, 날짜, 장소, 사건 경위, 수치)를 반드시 나레이션에 포함하세요.
2. "~라고 합니다" 같은 모호한 표현 대신, 자료에 기반한 팩트를 단정적으로 서술하세요.
${effectiveBrief ? "3. 아래 리서치 브리프의 팩트를 우선 사용하세요. 사실을 지어내지 마세요." : ""}
4. 씬은 사건의 시간순 또는 인과순으로 배열하세요. 각 씬은 하나의 명확한 사건 비트만 담당해야 합니다.
5. 시청자가 바로 옆에서 이야기를 듣는 것처럼 생생하고 몰입감 있는 구어체로 작성하세요.
6. 수집된 자료(뉴스 기사, 이미지)를 영상에 직접 사용합니다. source_index로 지정합니다.
7. 뉴스 내용은 나레이션으로 전달합니다. 화면에는 분위기 있는 이미지/영상을 배경으로 깔아주세요.
8. news_overlay와 text_emphasis는 사용하지 마세요. 모든 씬은 image 또는 video 중에서만 선택하세요.
${mediaBalanceRules}
${nichePlaybookContext ? "11. 니치 리서치 플레이북의 훅 시간, 오프닝 공식, 제작 제약을 첫 씬과 전체 페이싱에 반영하세요. 단, 자료 팩트와 정책 가드를 우선합니다." : ""}
${policyGuard}
반드시 지정된 JSON 형식으로만 응답하세요.`,
		`주제: ${t?.title ?? ""}
형식: ${format}
${researchSection}${productionReadinessSection}${nichePlaybookSection}${referenceSection}${contentStrategySection}
=== 수집된 자료 목록 (통합 인덱스) ===
${sourceList || "(없음)"}

위 자료의 구체적인 내용을 기반으로 스크립트를 작성하세요.

응답 형식:
{
  "shorts_script": "쇼츠용 60초 스크립트",
  "longform_scenes": [
    {
      "narration": "나레이션 텍스트",
      "type": "image | video",
      "visual_prompt": "영문 이미지 설명",
      "source_index": 0,
      "duration": 12,
      "transition": "crossfade",
      "mood": "mystery",
      "text_effect": "none"
    }
  ]
}

씬 타입 규칙:
- "image": 이미지 배경 + 나레이션. source_index로 수집 이미지 지정 또는 -1이면 AI 생성.
- "video": 영상 클립 배경 + 나레이션. source_index로 수집 YouTube 영상 지정 (영상 자료만 가능).
- ⛔ "text_emphasis"는 사용하지 마세요. 충격적인 사실/반전도 별도 카드가 아니라 영상/이미지 샷 위 자막, 줌, SFX, 컷 전환으로 처리합니다.
- ⛔ "news_overlay"는 사용하지 마세요. 뉴스 정보는 나레이션으로 전달하고 배경은 image나 video로.

스크립트 작성 규칙:
- 씬은 반드시 사건의 시간순 또는 인과순으로 흘러가야 합니다.
- 각 씬은 "어느 시점의 사건인지"가 분명해야 합니다.
- source_index: 자료 인덱스 (0부터). 수집 자료 사용 시 지정. AI 생성이면 -1.
- 뉴스 기사 내용은 나레이션 텍스트에 자연스럽게 녹여서 전달하세요. 카드 UI 금지.
- YouTube 영상 자료가 있으면 반드시 "video" 타입으로 배경에 활용하세요.
${mediaBalanceRules}
${policyGuard}
- 이미지 자료가 있으면 해당 이미지를 source_index로 직접 사용하세요.
	- 사건 흐름상 필요하면 같은 source_index를 여러 씬에서 재사용해도 됩니다.
	- visual_prompt는 그 씬의 실제 장소/인물/행동/증거를 보여주는 영어 설명이어야 합니다.
	- visual_prompt는 샷 플래너가 establishing/detail/evidence/quote 샷으로 분해할 수 있게 장소, 대상, 행동, 증거물 단서를 충분히 포함하세요.
	- 추상적인 무드 표현만 쓰지 말고, 그 씬에서 카메라가 실제로 무엇을 봐야 하는지 쓰세요.
	- 가능하면 news_title, news_date 필드에 이 씬이 다루는 사건 시점 제목과 날짜를 넣으세요.
- 자료가 부족하면 source_index: -1로 AI 이미지를 생성합니다.
${
	format === "shorts"
		? `
=== 쇼츠(9:16) 전용 규칙 ===
- 총 7~12개 씬, 30~55초 분량. 빠른 페이싱 필수!
- 첫 10초는 씬당 1.5~3초, 이후도 4.2초를 넘기지 마세요.
- 나레이션은 씬당 1~2문장만. 짧고 강렬하게.
- 씬1(훅, 2초 안팎): 시청자가 스크롤을 멈출 최강 사실 1개로 바로 시작. 도입·배경 금지.
- 씬2~4(전개): 핵심 사실만 빠르게. 씬당 사건 비트 1개만 — 두 정보를 한 씬에 넣지 마세요.
- 6~8초마다 패턴 인터럽트 1회. 별도 텍스트 카드가 아니라 영상 컷, 클로즈업, glitch/whip 전환, SFX로 리듬을 꺾으세요.
- 씬 수의 50~70% 지점(씬 수가 3개 이상일 때): 가장 반전적인 사실을 evidence/detail/video 샷 + glitch 전환으로 보여주세요. 충격 카드 금지.
- 마지막 씬: 2~3초로 짧게 끝내고, "이 사건은 아직도 미제입니다" 또는 "당신이라면?" 형식의 여운 한 줄로 마무리.
- transition: "none", "whip_left", "whip_right", "glitch" 합계 70% 이상. crossfade 10% 이내.
- mood: "horror" 또는 "mystery" 위주.
- visual_prompt: 무드 묘사 금지. "장소+인물/대상+행동" 형식. 예: "야간 부두, 우비 입은 형사들이 손전등으로 현장 수색"`
		: `${buildLongformSceneRules(referencePreset, {
				useFeatureLengthRules: useFeatureLengthDramaRules,
			})}${
				featureLengthReference && !useFeatureLengthDramaRules
					? `\n- 주의: 위 레퍼런스의 장편(20분/30씬급) 길이·씬 수는 드라마 몰아보기 전용이다. 이 주제는 드라마 해설이 아니므로 레퍼런스의 길이/씬 수는 무시하고 위 6~12분 롱폼 규칙을 따른다.`
					: ""
			}`
}

연출 필드 (각 씬에 반드시 포함):
- transition: "crossfade"(기본), "zoom"(극적), "slide_left"/"slide_right"(장면 이동), "glitch"(충격/반전), "whip_left"/"whip_right"(빠른 휙 전환 — 쇼츠에서 템포 올릴 때), "none"(하드컷)
- mood: "horror"(차가운 파랑), "mystery"(따뜻한 앰버), "news"(중립), "neutral", "warm"
- text_effect: 사용하지 않는 값입니다. 항상 "none"으로 두세요. 강조는 씬 타입이 아니라 자막/컷/SFX/카메라 무브로 처리합니다.
- visual_prompt는 영어로 작성. 어둡고 분위기 있는 시네마틱 톤으로.
${topicTitle ? `\n=== 절대 준수: 주제 충실도 (최우선) ===\n이 영상의 주제는 "${topicTitle}"이다. 모든 씬이 이 주제의 구체적 사건/대상/인물/숫자를 다루고 다른 사건·일반론으로 새지 않게 하라. 단, 같은 주제 문구를 매 씬 반복하지 말고 대명사·맥락으로 자연스러운 구어체로 이어가라. 마지막 씬에서 이 주제의 핵심 질문에 분명히 답하라.` : ""}`,
		// 대본 창작 — 사실 안정성 0.7, 장편 드라마는 36씬까지라 max_tokens 최대, 타임아웃 연장.
		{
			jsonMode: true,
			temperature: 0.7,
			maxTokens: useFeatureLengthDramaRules ? 12000 : 8000,
			timeoutMs: 120_000,
		},
	);

	return parseJSON<ScriptResult>(result);
}

/**
 * 이미지 생성 — 로컬 모델 우선, API fallback
 * (상세 구현은 image-gen.ts)
 */
export async function generateImage(
	sceneId: string,
	visualPrompt: string,
	referencePreset?: ReferencePreset,
	options?: import("./image-gen").ImageGenerationOptions,
): Promise<string> {
	const { generateImage: gen } = await import("./image-gen");
	const { url } = await gen(
		sceneId,
		visualPrompt,
		undefined,
		referencePreset,
		options,
	);
	return url;
}

export async function generateImageToPath(
	storagePath: string,
	visualPrompt: string,
	referencePreset?: ReferencePreset,
	options?: import("./image-gen").ImageGenerationOptions,
): Promise<string> {
	const { generateImageToPath: gen } = await import("./image-gen");
	const { url } = await gen(
		storagePath,
		visualPrompt,
		undefined,
		referencePreset,
		options,
	);
	return url;
}

// ─── TTS 함수 — tts.ts로 위임 (기존 export 시그니처 유지) ───
// 새 기능(음성 선택, 속도 조절, ElevenLabs)은 tts.ts에서 직접 import하세요.

export {
	generateContinuousNarration,
	generateSceneTts as generateTts,
} from "./tts";
