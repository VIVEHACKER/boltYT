import type { ResearchBrief } from "./ai-agents";
import { getApiProxyUrl } from "./proxy";
import type { ReferencePreset } from "./reference-bridge";
import { buildScriptConstraint } from "./reference-bridge";
import { supabase } from "./supabase";
import {
	buildChronologicalTimeline,
	formatTimelineConstraint,
} from "./timeline";

async function callOpenAI(
	systemPrompt: string,
	userPrompt: string,
): Promise<string> {
	const proxy = getApiProxyUrl();

	const res = await fetch(`${proxy}/api/openai/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "gpt-4o",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			temperature: 0.8,
		}),
		signal: AbortSignal.timeout(60_000),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenAI API 오류: ${res.status} ${err}`);
	}

	const json = await res.json();
	const content = json.choices?.[0]?.message?.content;
	if (!content) throw new Error("OpenAI 응답에 content가 없습니다");
	return content;
}

function parseJSON<T>(raw: string): T {
	const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
	return JSON.parse(cleaned);
}

export async function fetchTopicSuggestions(
	channelId: string,
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

주제 작성 규칙:
- 채널의 카테고리와 설명에 맞는 구체적인 주제
- 시청자의 호기심을 자극하는 제목 형태 (숫자, 질문, 비교 등)
- 최신 트렌드 반영
- 각 주제는 30자 이내

응답 형식: ["주제1", "주제2", "주제3", "주제4", "주제5"]`,
	);

	return parseJSON<string[]>(result);
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
		`주제: ${t?.title ?? ""}\n\n응답 형식:\n{"core_message": "핵심 메시지", "target_audience": "타겟 시청자", "cautions": "주의사항", "shorts_hooks": ["훅1", "훅2", "훅3"], "longform_outline": ["1. 도입", "2. 본론", "3. 결론"]}`,
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
}

export async function generateScript(
	briefId: string,
	format: string,
	referencePreset?: ReferencePreset,
): Promise<ScriptResult> {
	const { data: brief } = await supabase
		.from("briefs")
		.select("*")
		.eq("id", briefId)
		.maybeSingle();

	const b = brief as Record<string, unknown> | null;

	const isShorts = format === "shorts";
	const pacing = isShorts
		? "쇼츠: 7~12개 씬, 30~55초. 첫 10초는 씬당 1.5~3초, 이후도 4.2초 초과 금지. 나레이션 1~2문장. 하드컷/whip/glitch 전환 70% 이상."
		: "롱폼: 6~8개 씬, 3~5분. 씬당 8~15초. 나레이션 3~5문장.";

	const referenceSection = referencePreset
		? `\n${buildScriptConstraint(referencePreset)}\n`
		: "";

	const result = await callOpenAI(
		"당신은 유튜브 영상 스크립트 작성 전문가입니다. 반드시 지정된 JSON 형식으로만 응답하세요.",
		`브리프:\n핵심 메시지: ${b?.core_message ?? ""}\n타겟: ${b?.target_audience ?? ""}\n형식: ${format}\n\n${pacing}${referenceSection}

	씬 작성 규칙:
	- 씬은 시간순 또는 인과순으로 흘러가야 합니다.
	- 각 씬은 하나의 사건/정보 비트만 다루세요.
	- 기본값은 image가 아니라 video라고 생각하세요. evidence/quote/document 성격의 씬이 아니면 우선 video를 선택하세요.
	- 전체 비텍스트 씬 중 절반 이상은 video 타입이 되도록 구성하세요.
	- 시작 10초 안에 들어가는 첫 2~3개 씬은 80% 이상이 video 타입이 되도록 구성하세요.
	- visual_prompt는 그 씬에서 실제로 보여야 할 장면을 영어로 구체적으로 쓰세요. 추상적인 분위기 설명만 쓰지 마세요.
	- visual_prompt에는 장소 + 인물/대상 + 행동/증거물 중 최소 2가지를 포함해, 한 씬을 3~5개의 샷으로 쪼개도 성립하게 쓰세요.
	- 앞 씬과 겹치는 화면 설명을 반복하지 마세요.

응답 형식:
{"shorts_script": "쇼츠 스크립트", "longform_scenes": [{"narration": "나레이션", "type": "image", "visual_prompt": "visual description in English", "duration": ${isShorts ? 4 : 8}, "transition": "crossfade", "mood": "mystery", "text_effect": "none"}]}

visual_prompt는 영어로.`,
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
export async function extractResearchBrief(
	topicTitle: string,
	sources: SourceForScript[],
): Promise<ResearchBrief> {
	// 기사 본문이 있는 것만 AI에 전달 (이미지/영상은 팩트 추출에 기여 낮음)
	const articles = sources.filter((s) => s.type === "article");
	if (articles.length === 0) {
		return {
			summary: "",
			timeline: [],
			key_figures: [],
			facts: [],
			misconceptions: [],
			search_keywords: [],
		};
	}

	const articleText = articles
		.slice(0, 8) // 토큰 보호: 최대 8개 기사
		.map((a, i) => {
			const body = (a.bodyText || a.description || "").slice(0, 3500);
			const meta = [a.publisher, a.pubDate].filter(Boolean).join(" · ");
			return `[기사${i + 1}${meta ? ` — ${meta}` : ""}] ${a.title}\n${body}`;
		})
		.join("\n\n---\n\n");

	const result = await callOpenAI(
		`당신은 한국어 뉴스 분석 전문 리서처입니다.
아래 수집된 기사들에서 **기사에 실제로 언급된 사실만** 추출하세요.

규칙:
- 기사에 없는 내용은 절대 추가 금지(사전지식 금지).
- 날짜·인물·장소·수치는 기사에 나온 그대로.
- misconceptions(대중의 오해)는 기사에 명시된 경우만.
- search_keywords: 이 주제 이미지/영상 검색용 한국어 10개.
반드시 JSON으로만 응답.`,
		`주제: ${topicTitle}

=== 수집된 기사 ===
${articleText}

응답 형식:
{
  "summary": "사건/주제 요약 3-5문장",
  "timeline": [{"date": "2024.05.10", "event": "이벤트"}],
  "key_figures": [{"name": "이름", "role": "역할"}],
  "facts": ["팩트1", "팩트2"],
  "misconceptions": ["오해1"],
  "search_keywords": ["키워드1", "키워드2"]
}`,
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
): Promise<ScriptResult> {
	const { data: topic } = await supabase
		.from("topics")
		.select("*")
		.eq("id", topicId)
		.maybeSingle();

	const t = topic as Record<string, string> | null;

	// 브리프가 제공되지 않았고 기사가 수집돼 있으면 자동으로 팩트 추출
	// (C: 자료 기반 모드에서 할루시네이션 방지)
	let effectiveBrief = researchBrief;
	if (!effectiveBrief) {
		const hasArticles = sources.some(
			(s) => s.type === "article" && (s.bodyText || s.description),
		);
		if (hasArticles) {
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

	// 레퍼런스 템플릿이 있으면 스타일 준수 지시 추가
	const referenceSection = referencePreset
		? `\n${buildScriptConstraint(referencePreset)}\n`
		: "";

	const result = await callOpenAI(
		`당신은 한국 유튜브 미스테리/공포/정보 채널의 스크립트 작성 전문가입니다.
참고 채널: "편집중", "까마귀의 밤", "미스테리 호러쇼" 스타일.

핵심 원칙:
1. 자료에 나오는 구체적인 정보(인물 이름, 날짜, 장소, 사건 경위, 수치)를 반드시 나레이션에 포함하세요.
2. "~라고 합니다" 같은 모호한 표현 대신, 자료에 기반한 팩트를 단정적으로 서술하세요.
${effectiveBrief ? "3. 아래 리서치 브리프의 팩트를 우선 사용하세요. 사실을 지어내지 마세요." : ""}
4. 씬은 사건의 시간순 또는 인과순으로 배열하세요. 각 씬은 하나의 명확한 사건 비트만 담당해야 합니다.
5. 시청자가 바로 옆에서 이야기를 듣는 것처럼 생생하고 몰입감 있는 구어체로 작성하세요.
6. 수집된 자료(뉴스 기사, 이미지)를 영상에 직접 사용합니다. source_index로 지정합니다.
7. 뉴스 내용은 나레이션으로 전달합니다. 화면에는 분위기 있는 이미지/영상을 배경으로 깔아주세요.
8. news_overlay는 사용하지 마세요. 모든 씬은 image, video, text_emphasis 중에서 선택하세요.
9. evidence/quote/document 성격이 아닌 씬은 기본적으로 video 타입을 우선하세요. 비텍스트 씬의 60% 이상을 video로 구성하세요.
10. 시작 10초 안에 들어가는 첫 2~3개 씬은 최소 80%가 video 타입이 되게 하세요.
반드시 지정된 JSON 형식으로만 응답하세요.`,
		`주제: ${t?.title ?? ""}
형식: ${format}
${researchSection}${referenceSection}
=== 수집된 자료 목록 (통합 인덱스) ===
${sourceList || "(없음)"}

위 자료의 구체적인 내용을 기반으로 스크립트를 작성하세요.

응답 형식:
{
  "shorts_script": "쇼츠용 60초 스크립트",
  "longform_scenes": [
    {
      "narration": "나레이션 텍스트",
      "type": "image | video | text_emphasis | news_overlay",
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
- "text_emphasis": 텍스트 강조 화면. 충격적인 사실/반전을 큰 글씨로.
- ⛔ "news_overlay"는 사용하지 마세요. 뉴스 정보는 나레이션으로 전달하고 배경은 image나 video로.

스크립트 작성 규칙:
- 씬은 반드시 사건의 시간순 또는 인과순으로 흘러가야 합니다.
- 각 씬은 "어느 시점의 사건인지"가 분명해야 합니다.
- source_index: 자료 인덱스 (0부터). 수집 자료 사용 시 지정. AI 생성이면 -1.
- 뉴스 기사 내용은 나레이션 텍스트에 자연스럽게 녹여서 전달하세요. 카드 UI 금지.
- YouTube 영상 자료가 있으면 반드시 "video" 타입으로 배경에 활용하세요.
- evidence/quote/document 삽입용 씬이 아니면 기본적으로 "video" 타입을 우선하세요.
- 전체 비텍스트 씬의 최소 60%는 "video" 타입으로 구성하세요.
- 시작 10초 안에 들어가는 첫 2~3개 씬은 최소 80%를 "video" 타입으로 배치하세요.
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
- 6~8초마다 패턴 인터럽트 1회. text_emphasis 또는 glitch/whip 전환으로 리듬을 꺾으세요.
- 씬 수의 50~70% 지점(씬 수가 3개 이상일 때): 가장 반전적인 사실을 text_emphasis + glitch로. 충격 카드 필수.
- 마지막 씬: 2~3초로 짧게 끝내고, "이 사건은 아직도 미제입니다" 또는 "당신이라면?" 형식의 여운 한 줄로 마무리.
- transition: "none", "whip_left", "whip_right", "glitch" 합계 70% 이상. crossfade 10% 이내.
- mood: "horror" 또는 "mystery" 위주.
- visual_prompt: 무드 묘사 금지. "장소+인물/대상+행동" 형식. 예: "야간 부두, 우비 입은 형사들이 손전등으로 현장 수색"`
		: `
=== 롱폼(16:9) 규칙 ===
5단계 네러티브 구조를 반드시 지킨다. 비율은 전체 씬 수 기준.

[도입 — 전체의 15%]
- 씬1: 핵심 질문/충격 사실로 바로 시작. "~이 있습니다"형 설명 금지.
- 강렬한 영상/이미지 + zoom 트랜지션. duration: 8~12초.

[배경 — 전체의 20%]
- 씬2~3: 사건·인물·맥락 소개. 시청자가 몰입할 맥락만. duration: 10~15초.
- transition: crossfade or slide_left.

[전개 — 전체의 40%]
- 씬4~7: 핵심 사실을 하나씩 순서대로 풀어감. 각 씬에 하나의 포인트만.
- 수집 이미지·영상 최대 활용. duration: 12~18초. transition: crossfade.

[반전/클라이맥스 — 전체의 15%]
- 씬8~9: 가장 놀라운 반전 또는 핵심 충격. text_emphasis + glitch 트랜지션.
- mood: "horror" 또는 "mystery". duration: 8~12초.

[결말 — 전체의 10%]
- 마지막 씬: 현재 상황, 미해결 의문, 시청자 행동 유도(CTA). duration: 10~15초.
- transition: fade or crossfade. mood: "neutral" or "warm".

공통:
- 총 8~12개 씬, 5~8분 분량.
- 나레이션은 씬당 3~5문장. 짧은 구어체 문장. 접속사로 자연스럽게 연결.
- 각 단계 전환 시 transition으로 리듬 변화를 준다.`
}

연출 필드 (각 씬에 반드시 포함):
- transition: "crossfade"(기본), "zoom"(극적), "slide_left"/"slide_right"(장면 이동), "glitch"(충격/반전), "whip_left"/"whip_right"(빠른 휙 전환 — 쇼츠에서 템포 올릴 때), "none"(하드컷)
- mood: "horror"(차가운 파랑), "mystery"(따뜻한 앰버), "news"(중립), "neutral", "warm"
- text_effect: text_emphasis 전용. "typewriter", "glitch", "scale_in", "none". 반전→glitch, 질문→typewriter, 강조→scale_in
- visual_prompt는 영어로 작성. 어둡고 분위기 있는 시네마틱 톤으로.`,
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
): Promise<string> {
	const { generateImage: gen } = await import("./image-gen");
	const { url } = await gen(sceneId, visualPrompt, undefined, referencePreset);
	return url;
}

export async function generateImageToPath(
	storagePath: string,
	visualPrompt: string,
	referencePreset?: ReferencePreset,
): Promise<string> {
	const { generateImageToPath: gen } = await import("./image-gen");
	const { url } = await gen(
		storagePath,
		visualPrompt,
		undefined,
		referencePreset,
	);
	return url;
}

// ─── TTS 함수 — tts.ts로 위임 (기존 export 시그니처 유지) ───
// 새 기능(음성 선택, 속도 조절, ElevenLabs)은 tts.ts에서 직접 import하세요.

export {
	generateContinuousNarration,
	generateSceneTts as generateTts,
} from "./tts";
