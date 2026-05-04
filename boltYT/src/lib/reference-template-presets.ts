import type { LayoutVariant } from "../remotion/types";
import type { ReferenceTemplate } from "../types/database";
import { buildReferenceKnowledgeProfile } from "./knowledge-system";
import {
	scoreReferenceQuality,
	type ReferenceQualityReport,
} from "./reference-quality";

export const BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID = "__builtin_reference__";

type ReferenceProductionMode = "ai" | "research" | "animation";
export type ReferenceOutputFormat = "shorts" | "longform";

export interface GeneratedReferenceCategoryCoverage {
	id: string;
	label: string;
	count: number;
	deep: number;
	shorts: number;
	longform: number;
	over20: number;
	qualityAvg: number;
	qualityMin: number;
	ready: number;
	review: number;
	blocked: number;
	knowledgeAvg: number;
	outcomeCalibrated: number;
}

export type ReferenceTemplateReadinessStatus = "ready" | "review" | "blocked";

export interface ReferenceTemplateReadiness {
	status: ReferenceTemplateReadinessStatus;
	label: string;
	state: "info" | "warning" | "error";
	priority: number;
	summary: string;
	action: string;
}

interface ProductionFormatProfile {
	durationSeconds: number;
	sceneCount: number;
	avgSceneDuration: number;
	hookDuration: number;
}

interface ProductionMethod {
	id: string;
	label: string;
	description: string;
	recommendedMode: ReferenceProductionMode;
	supportedFormats?: ReferenceOutputFormat[];
	formatProfiles?: Partial<Record<ReferenceOutputFormat, ProductionFormatProfile>>;
	sceneLayout?: LayoutVariant;
	sceneLayouts?: Partial<Record<ReferenceOutputFormat, LayoutVariant>>;
	requiresRealClipVideo?: boolean;
	manualVideoInsert?: boolean;
	clipControls?: Array<"trim_start" | "duration_seconds" | "crop">;
	referenceSources?: Array<{
		url: string;
		purpose: string;
	}>;
	rules: string[];
}

export type BuiltInReferenceTemplateInput = Omit<
	ReferenceTemplate,
	"channel_id" | "created_at" | "updated_at"
> & {
	channel_id?: string;
	created_at?: string;
	updated_at?: string;
	raw_analysis: ReferenceTemplate["raw_analysis"] & {
		built_in_reference?: true;
		production_method?: ProductionMethod;
	};
};

const BUILT_IN_CREATED_AT = "2026-05-02T00:00:00.000Z";

const BASE_TEMPLATE: Omit<
	BuiltInReferenceTemplateInput,
	| "id"
	| "name"
	| "source_title"
	| "duration_seconds"
	| "visual_mood"
	| "visual_prompt_template"
	| "lighting_style"
	| "subtitle_accent_color"
	| "scene_count"
	| "avg_scene_duration"
	| "hook_duration"
	| "transition_style"
	| "pacing_preset"
	| "bgm_mood"
	| "bgm_keywords"
	| "bgm_tempo"
	| "hook_pattern"
	| "script_structure"
	| "raw_analysis"
> = {
	source_type: "manual",
	source_url: "",
	source_creator: "내장 제작 방식",
	thumbnail_url: "",
	dominant_colors: ["#101010", "#ffffff"],
	subtitle_position: "bottom",
	subtitle_size_preset: "lg",
	subtitle_bg_style: "none",
	tts_voice_id: "",
	tts_provider: "openai",
	tts_speed: 1,
	tts_tone_keywords: ["명확함", "몰입"],
	bgm_reference_url: "",
	transcript: "",
	frame_urls: [],
	analysis_status: "complete",
	analysis_error: "",
};

const CURATED_REFERENCE_TEMPLATES: BuiltInReferenceTemplateInput[] = [
	{
		...BASE_TEMPLATE,
		id: "builtin-social-clip-real-video",
		name: "소셜 클립 카드 · 실제 영상 삽입",
		source_title: "실제 영상 URL/파일을 쓰는 쇼츠/롱폼 클립 큐레이션 포맷",
		source_url: "internal://reference-method/social-clip-real-video",
		duration_seconds: 38,
		dominant_colors: ["#ffffff", "#111111", "#efefef", "#ffcc00"],
		visual_mood: "news",
		visual_prompt_template:
			"real interview or source footage inside a clean vertical social clip card, large white Korean title card, central video slot, minimal upload-safe overlays, no fake comments, no editor labels",
		lighting_style: "natural",
		subtitle_position: "bottom",
		subtitle_size_preset: "md",
		subtitle_bg_style: "none",
		subtitle_accent_color: "#111111",
		scene_count: 7,
		avg_scene_duration: 5.4,
		hook_duration: 2.6,
		transition_style: "hardcut",
		pacing_preset: "fast",
		tts_speed: 1.03,
		tts_tone_keywords: ["짧게", "현장감", "단정함"],
		bgm_mood: "calm",
		bgm_keywords: ["clean social beat", "street interview", "light rhythm"],
		bgm_tempo: "mid",
		hook_pattern: "claim",
		script_structure: [
			{
				role: "hook",
				duration: 2.6,
				note: "상단 제목 카드 한 줄로 상황을 즉시 이해시킨다.",
			},
			{
				role: "context",
				duration: 5.4,
				note: "실제 클립의 핵심 행동/발언을 설명한다.",
			},
			{
				role: "clip_1",
				duration: 7,
				note: "첫 번째 실제 영상 구간을 길게 보여주며 핵심 장면을 잡는다.",
			},
			{
				role: "explain",
				duration: 5.5,
				note: "왜 이 장면이 반응을 얻는지 짧게 해설한다.",
			},
			{
				role: "clip_2",
				duration: 7,
				note: "두 번째 실제 영상 구간이나 디테일 컷으로 리듬을 유지한다.",
			},
			{
				role: "turn",
				duration: 5.5,
				note: "반전 또는 가장 눈에 띄는 포인트를 자막과 맞춘다.",
			},
			{
				role: "close",
				duration: 5,
				note: "업로드용 메타 문구 없이 짧은 결론으로 닫는다.",
			},
		],
		raw_analysis: {
			built_in_reference: true,
			production_method: {
				id: "social-clip-real-video",
				label: "실제 영상 중심 소셜 클립",
				description:
					"쇼츠는 제목 카드 + 중앙 실제 영상 + 짧은 자막, 롱폼은 실제 영상과 해설 컷을 16:9 편집물로 확장한다.",
				recommendedMode: "research",
				sceneLayout: "social_clip_card",
				sceneLayouts: {
					shorts: "social_clip_card",
					longform: "full",
				},
				supportedFormats: ["shorts", "longform"],
				formatProfiles: {
					shorts: {
						durationSeconds: 38,
						sceneCount: 7,
						avgSceneDuration: 5.4,
						hookDuration: 2.6,
					},
					longform: {
						durationSeconds: 180,
						sceneCount: 12,
						avgSceneDuration: 15,
						hookDuration: 8,
					},
				},
				requiresRealClipVideo: true,
				manualVideoInsert: true,
				clipControls: ["trim_start", "duration_seconds", "crop"],
				referenceSources: [
					{
						url: "https://www.youtube.com/shorts/hmDt88ANJMI",
						purpose:
							"소셜 클립 카드, 실제 영상 중앙 슬롯, 업로드용 메타 문구 제거 방식 참고",
					},
				],
				rules: [
					"첫 장면에 실제 영상 슬롯이 없으면 이미지 대체로 렌더하지 않는다.",
					"중앙 영상은 시작 초, 길이, 크롭을 조절해 피사체를 가리지 않는다.",
					"업로드 화면에 어색한 설명 문구나 테스트 라벨을 넣지 않는다.",
					"롱폼에서는 쇼츠 카드 좌표를 강제하지 않고 16:9 자료/클립 편집 구조로 전환한다.",
				],
			},
		},
	},
	{
		...BASE_TEMPLATE,
		id: "builtin-mystery-illustrated-countdown",
		name: "미스터리 제목 카드 · 3가지 구조",
		source_title: "상단 제목 + 중앙 일러스트 + 질문형 카운트다운 쇼츠",
		source_url: "internal://reference-method/mystery-illustrated-countdown",
		duration_seconds: 45,
		dominant_colors: ["#f7f5ee", "#071821", "#07313d", "#ffd75d"],
		visual_mood: "mystery",
		visual_prompt_template:
			"editorial Korean mystery short, paper header, bold black Korean title, central illustrated evidence scene, ocean noir palette, archive map texture, graphic shapes, premium explainer style",
		lighting_style: "mixed",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "none",
		subtitle_accent_color: "#FFD75D",
		scene_count: 9,
		avg_scene_duration: 5,
		hook_duration: 4,
		transition_style: "hardcut",
		pacing_preset: "fast",
		tts_speed: 0.98,
		tts_tone_keywords: ["궁금증", "단서", "미스터리"],
		bgm_mood: "mysterious",
		bgm_keywords: ["mystery waltz", "archive suspense", "curious documentary"],
		bgm_tempo: "mid",
		hook_pattern: "question",
		script_structure: [
			{ role: "title", duration: 4, note: "큰 제목으로 질문을 던진다." },
			{ role: "clue", duration: 5, note: "첫 번째 시각 단서를 보여준다." },
			{ role: "evidence", duration: 5, note: "기록/지도/자료 컷으로 신뢰감을 만든다." },
			{ role: "movement", duration: 5, note: "조사선, 현장 접근 등 동적인 장면을 넣는다." },
			{ role: "count_1", duration: 5, note: "첫 번째 궁금증을 번호로 정리한다." },
			{ role: "count_2", duration: 5, note: "두 번째 궁금증과 근거 컷을 붙인다." },
			{ role: "count_3", duration: 6, note: "세 번째 궁금증을 가장 강한 이미지로 보여준다." },
			{ role: "payoff", duration: 5, note: "지금까지의 단서를 한 문장으로 묶는다." },
			{ role: "open_loop", duration: 5, note: "결론을 닫지 말고 다음 궁금증을 남긴다." },
		],
		raw_analysis: {
			built_in_reference: true,
			production_method: {
				id: "mystery-illustrated-countdown",
				label: "미스터리 일러스트 카운트다운",
				description:
					"실사 한 장을 흔드는 방식 대신 단서별 장면을 갈아끼우고, 큰 제목/번호/자료컷으로 리듬을 만든다.",
				recommendedMode: "research",
				sceneLayout: "full",
				sceneLayouts: {
					shorts: "full",
					longform: "full",
				},
				supportedFormats: ["shorts", "longform"],
				formatProfiles: {
					shorts: {
						durationSeconds: 45,
						sceneCount: 9,
						avgSceneDuration: 5,
						hookDuration: 4,
					},
					longform: {
						durationSeconds: 300,
						sceneCount: 15,
						avgSceneDuration: 20,
						hookDuration: 12,
					},
				},
				referenceSources: [
					{
						url: "https://www.youtube.com/shorts/mlrp7Z4Ffkk",
						purpose:
							"상단 제목, 미스터리형 시각 구성, 질문/카운트다운 구조 참고",
					},
				],
				rules: [
					"제목은 상단 안전 영역 안에 두고 이미지가 가리지 않게 한다.",
					"각 씬은 단서, 기록, 지도, 이동, 번호 정리처럼 역할이 달라야 한다.",
					"BGM은 밝은 예능톤보다 묘한 왈츠/아카이브 긴장감을 우선한다.",
				],
			},
		},
	},
	{
		...BASE_TEMPLATE,
		id: "builtin-dynamic-story-source-match",
		name: "다이내믹 스토리 · 이미지/자료 매칭",
		source_title: "내용에 맞는 이미지·자료 컷을 계속 교체하는 편집물형 포맷",
		source_url: "internal://reference-method/dynamic-story-source-match",
		duration_seconds: 52,
		dominant_colors: ["#111827", "#f8fafc", "#d6a84f", "#376a7f"],
		visual_mood: "mystery",
		visual_prompt_template:
			"source-matched documentary collage, every narration line matched with concrete generated or collected image, layered map, archive photo, newspaper texture, cutaway details, parallax motion, no single static image",
		lighting_style: "mixed",
		subtitle_position: "bottom",
		subtitle_size_preset: "lg",
		subtitle_bg_style: "stroke",
		subtitle_accent_color: "#F2C14E",
		scene_count: 10,
		avg_scene_duration: 5.2,
		hook_duration: 3.5,
		transition_style: "mixed",
		pacing_preset: "fast",
		tts_speed: 1,
		tts_tone_keywords: ["스토리텔링", "자료 기반", "속도감"],
		bgm_mood: "dramatic",
		bgm_keywords: ["cinematic documentary", "investigation", "soft tension"],
		bgm_tempo: "mid",
		hook_pattern: "story",
		script_structure: [
			{ role: "hook", duration: 3.5, note: "한 문장 사건/상황으로 시작한다." },
			{ role: "setup", duration: 5, note: "장소와 인물을 빠르게 특정한다." },
			{ role: "cutaway_1", duration: 5, note: "지도, 기사, 사진, 디테일 컷으로 바꾼다." },
			{ role: "conflict", duration: 6, note: "의문점 또는 충돌을 제시한다." },
			{ role: "evidence_1", duration: 6, note: "근거 장면을 이어 붙인다." },
			{ role: "evidence_2", duration: 6, note: "두 번째 근거 컷으로 신뢰감을 보강한다." },
			{ role: "turn", duration: 6, note: "시청자가 다시 보게 만드는 반전을 둔다." },
			{ role: "payoff", duration: 6, note: "핵심 해석을 짧게 말한다." },
			{ role: "detail", duration: 5, note: "마지막 디테일 컷으로 기억점을 만든다." },
			{ role: "loop", duration: 3.5, note: "다음 질문으로 유지율을 만든다." },
		],
		raw_analysis: {
			built_in_reference: true,
			production_method: {
				id: "dynamic-story-source-match",
				label: "자료 매칭형 다이내믹 편집",
				description:
					"나레이션마다 어울리는 이미지/뉴스/자료 컷을 바꾸고, 단일 이미지 흔들기만으로 동적 영상을 대체하지 않는다.",
				recommendedMode: "research",
				sceneLayout: "full",
				sceneLayouts: {
					shorts: "full",
					longform: "full",
				},
				supportedFormats: ["shorts", "longform"],
				formatProfiles: {
					shorts: {
						durationSeconds: 52,
						sceneCount: 10,
						avgSceneDuration: 5.2,
						hookDuration: 3.5,
					},
					longform: {
						durationSeconds: 360,
						sceneCount: 18,
						avgSceneDuration: 20,
						hookDuration: 12,
					},
				},
				rules: [
					"한 이미지를 오래 버티지 말고 2~4초 단위로 의미 있는 컷을 바꾼다.",
					"장면마다 장소, 인물, 자료, 디테일, 결과 중 하나의 역할을 가진다.",
					"수집 자료가 있으면 생성 이미지보다 실제 자료 컷을 우선 배치한다.",
				],
			},
		},
	},
	{
		...BASE_TEMPLATE,
		id: "builtin-news-foreign-footage-curation",
		name: "뉴스/외국 영상 큐레이션 · 편집물형",
		source_title: "뉴스·외부 영상·이미지를 조합해 하나의 편집물로 만드는 포맷",
		source_url: "internal://reference-method/news-foreign-footage-curation",
		duration_seconds: 62,
		dominant_colors: ["#0f172a", "#e5e7eb", "#ef4444", "#f59e0b"],
		visual_mood: "news",
		visual_prompt_template:
			"fast documentary news curation, foreign footage segments, article screenshots, map cards, source-aware cutaways, strong visual hierarchy, clean captions, no raw reupload feel",
		lighting_style: "natural",
		subtitle_position: "bottom",
		subtitle_size_preset: "md",
		subtitle_bg_style: "block",
		subtitle_accent_color: "#F59E0B",
		scene_count: 12,
		avg_scene_duration: 5.2,
		hook_duration: 4,
		transition_style: "mixed",
		pacing_preset: "fast",
		tts_speed: 1.04,
		tts_tone_keywords: ["팩트 중심", "뉴스형", "짧은 해설"],
		bgm_mood: "tense",
		bgm_keywords: ["news pulse", "documentary tension", "minimal beat"],
		bgm_tempo: "mid",
		hook_pattern: "shock",
		script_structure: [
			{ role: "hook", duration: 4, note: "가장 큰 변화/충격을 먼저 말한다." },
			{ role: "fact", duration: 5, note: "언제, 어디서, 누가를 특정한다." },
			{ role: "source_cut_1", duration: 5, note: "기사/영상/사진 근거를 보여준다." },
			{ role: "context", duration: 6, note: "왜 중요한지 배경을 설명한다." },
			{ role: "sequence_1", duration: 7, note: "외부 영상과 이미지 컷을 순서대로 엮는다." },
			{ role: "sequence_2", duration: 7, note: "두 번째 실제 자료 컷으로 흐름을 이어간다." },
			{ role: "map", duration: 5, note: "지도/장소 카드로 이해를 돕는다." },
			{ role: "source_cut_2", duration: 5, note: "추가 기사나 화면 캡처로 근거를 보강한다." },
			{ role: "impact", duration: 7, note: "결과와 파장을 정리한다." },
			{ role: "counterpoint", duration: 5, note: "다른 해석이나 예외를 짧게 넣는다." },
			{ role: "watch_next", duration: 4, note: "이후 관전 포인트를 제시한다." },
			{ role: "close", duration: 2, note: "과장 없이 마무리한다." },
		],
		raw_analysis: {
			built_in_reference: true,
			production_method: {
				id: "news-foreign-footage-curation",
				label: "뉴스/외부 자료 큐레이션 편집",
				description:
					"외부 영상 하나를 통째로 쓰지 않고, 뉴스·사진·지도·짧은 영상 컷을 해설 흐름에 맞춰 조립한다.",
				recommendedMode: "research",
				sceneLayout: "full",
				sceneLayouts: {
					shorts: "full",
					longform: "full",
				},
				supportedFormats: ["shorts", "longform"],
				formatProfiles: {
					shorts: {
						durationSeconds: 62,
						sceneCount: 12,
						avgSceneDuration: 5.2,
						hookDuration: 4,
					},
					longform: {
						durationSeconds: 420,
						sceneCount: 21,
						avgSceneDuration: 20,
						hookDuration: 14,
					},
				},
				rules: [
					"원본 영상 장면은 짧은 클립 단위로 분해해 해설과 맞춘다.",
					"기사/출처 화면은 증거 컷으로만 쓰고 업로드용 본문에는 불필요한 메타 문구를 넣지 않는다.",
					"시청자가 보는 화면은 항상 현재 문장의 근거 또는 결과여야 한다.",
				],
			},
		},
	},
	{
		...BASE_TEMPLATE,
		id: "builtin-drama-recap-longform",
		name: "드라마/영화 몰아보기 · 롱폼 해설",
		source_title:
			"드라마나 영화 주제를 입력하면 줄거리·인물·장르를 분석해 20분 이내 몰아보기로 구성하는 포맷",
		source_url: "internal://reference-method/drama-recap-longform",
		duration_seconds: 1200,
		dominant_colors: ["#111827", "#f5f0e8", "#b7793f", "#3b82f6"],
		visual_mood: "mystery",
		visual_prompt_template:
			"longform Korean drama and movie recap, cinematic editorial montage, licensed source clip slots, character relationship board, act chapter cards, subtle timeline graphics, warm suspense color grade, no raw reupload feel",
		lighting_style: "mixed",
		subtitle_position: "bottom",
		subtitle_size_preset: "md",
		subtitle_bg_style: "stroke",
		subtitle_accent_color: "#E6B35A",
		scene_count: 30,
		avg_scene_duration: 40,
		hook_duration: 16,
		transition_style: "crossfade",
		pacing_preset: "medium",
		tts_speed: 1.06,
		tts_tone_keywords: [
			"몰아보기",
			"드라마 해설",
			"긴장감",
			"코믹한 완급",
			"결말까지",
		],
		bgm_mood: "dramatic",
		bgm_keywords: [
			"cinematic drama recap",
			"suspense comedy spy",
			"emotional orchestral bed",
			"chapter tension pulse",
		],
		bgm_tempo: "mid",
		hook_pattern: "story",
		script_structure: [
			{
				role: "cold_open",
				duration: 24,
				note: "작품의 가장 강한 아이러니나 비밀을 먼저 던지고 바로 본편으로 들어간다.",
			},
			{
				role: "premise",
				duration: 70,
				note: "주인공, 관계, 장르 약속, 시청자가 따라가야 할 핵심 질문을 정리한다.",
			},
			{
				role: "relationship_board",
				duration: 90,
				note: "부부/가족/동료/적대 관계를 인물 카드와 사건 컷으로 연결한다.",
			},
			{
				role: "act_1_incident",
				duration: 125,
				note: "첫 사건과 오해를 세팅하고 코미디/첩보/멜로 톤을 번갈아 만든다.",
			},
			{
				role: "act_1_turn",
				duration: 105,
				note: "작은 단서가 커지는 구간. 대사 요약보다 행동과 선택의 결과를 설명한다.",
			},
			{
				role: "act_2_pressure",
				duration: 160,
				note: "정체 은폐, 추적, 가족 갈등처럼 압박이 누적되는 구간을 챕터로 나눈다.",
			},
			{
				role: "midpoint_reveal",
				duration: 105,
				note: "시청자가 다시 보게 되는 중간 반전을 가장 밀도 높은 편집으로 배치한다.",
			},
			{
				role: "act_2_escalation",
				duration: 145,
				note: "적대 세력, 임무, 가족 위기가 겹치는 구간을 빠른 교차편집으로 만든다.",
			},
			{
				role: "emotional_low",
				duration: 90,
				note: "인물의 선택이 흔들리는 감정 저점을 BGM과 TTS 톤으로 낮춘다.",
			},
			{
				role: "finale_setup",
				duration: 105,
				note: "결말 직전 필요한 단서와 인물 동선을 다시 정렬한다.",
			},
			{
				role: "finale_payoff",
				duration: 130,
				note: "클라이맥스와 결말을 액션, 관계 회수, 반전 순서로 설명한다.",
			},
			{
				role: "ending_review",
				duration: 51,
				note: "작품이 남긴 감정, 장단점, 다음에 볼 포인트를 짧게 정리한다.",
			},
		],
		raw_analysis: {
			built_in_reference: true,
			production_method: {
				id: "drama-recap-longform",
				label: "드라마/영화 몰아보기 롱폼",
				description:
					"작품 제목이나 주제를 입력하면 장르·인물·줄거리 자료를 분석해 대본, BGM, TTS 톤, 챕터형 편집을 자동 구성한다.",
				recommendedMode: "research",
				sceneLayout: "full",
				sceneLayouts: {
					longform: "full",
				},
				supportedFormats: ["longform"],
				formatProfiles: {
					longform: {
						durationSeconds: 1200,
						sceneCount: 30,
						avgSceneDuration: 40,
						hookDuration: 16,
					},
				},
				manualVideoInsert: true,
				clipControls: ["trim_start", "duration_seconds", "crop"],
				referenceSources: [
					{
						url: "https://www.youtube.com/watch?v=riYzzUg7KbI",
						purpose:
							"드라마 결말까지 몰아보기의 챕터 호흡, 내레이션 밀도, BGM 긴장감을 20분 이하 구조로 압축 참고",
					},
				],
				rules: [
					"입력은 작품 제목, 드라마/영화명, 또는 비슷한 장르 주제로 받는다.",
					"대본은 줄거리 요약, 인물 관계, 장르적 해석, 결말 회수 중심으로 새로 작성한다.",
					"원작 대사, 원본 영상, 원본 음악을 그대로 복제하지 않는다. 사용자가 권리를 가진 클립이나 공개 자료만 영상 슬롯에 넣는다.",
					"60~90분 롱폼은 6~10개 챕터와 50개 이상 씬으로 나눠 중반부 반복을 막는다.",
					"BGM은 한 곡 반복보다 도입, 코믹 완급, 긴장, 감정 저점, 결말 회수 구간별 무드를 바꾼다.",
					"TTS는 빠른 쇼츠 톤이 아니라 장시간 청취 가능한 해설 톤으로 두고, 클라이맥스에서만 속도와 긴장을 올린다.",
				],
			},
		},
	},
];

const BUILT_IN_REFERENCE_TEMPLATES: BuiltInReferenceTemplateInput[] = [
	...CURATED_REFERENCE_TEMPLATES,
];

export const GENERATED_REFERENCE_CATEGORY_LABELS: Record<string, string> = {
	drama_recap: "드라마/영화",
	mystery_doc: "미스터리/사건",
	news_issue: "뉴스/이슈",
	automation_business: "AI/비즈니스",
	money_psychology: "돈/심리",
};

export function cloneReferenceTemplateInput(
	template: BuiltInReferenceTemplateInput,
	channelId = BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
): ReferenceTemplate {
	const cloned = JSON.parse(JSON.stringify(template)) as ReferenceTemplate;
	return {
		...cloned,
		channel_id: channelId || BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
		created_at: template.created_at ?? BUILT_IN_CREATED_AT,
		updated_at: template.updated_at ?? BUILT_IN_CREATED_AT,
		raw_analysis: {
			...(cloned.raw_analysis ?? {}),
			built_in_reference: true,
		},
	};
}

function timestamp(value: unknown): number {
	if (typeof value !== "string" && typeof value !== "number") return 0;
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : 0;
}

function productionMethodOf(
	template?: ReferenceTemplate | null,
): ProductionMethod | null {
	const raw = template?.raw_analysis;
	if (!raw || typeof raw !== "object") return null;
	const method = (raw as { production_method?: unknown }).production_method;
	if (!method || typeof method !== "object") return null;
	const candidate = method as Partial<ProductionMethod>;
	return typeof candidate.id === "string" &&
		typeof candidate.label === "string" &&
		typeof candidate.description === "string"
		? (candidate as ProductionMethod)
		: null;
}

export function listBuiltInReferenceTemplates(
	channelId = BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
): ReferenceTemplate[] {
	return sortReferenceTemplatesByQuality(
		BUILT_IN_REFERENCE_TEMPLATES.map((template) =>
			cloneReferenceTemplateInput(template, channelId),
		),
	);
}

export function calculateGeneratedReferenceTemplateCoverage(
	templates: ReferenceTemplate[],
): {
	total: number;
	deep: number;
	shorts: number;
	longform: number;
	over20: number;
	qualityAvg: number;
	qualityMin: number;
	ready: number;
	review: number;
	blocked: number;
	knowledgeAvg: number;
	outcomeCalibrated: number;
	categories: GeneratedReferenceCategoryCoverage[];
} {
	const counts = new Map<
		string,
		{
			count: number;
			deep: number;
			shorts: number;
			longform: number;
			over20: number;
			qualityTotal: number;
			qualityMin: number;
			ready: number;
			review: number;
			blocked: number;
			knowledgeTotal: number;
			outcomeCalibrated: number;
		}
	>();
	let deep = 0;
	let shorts = 0;
	let longform = 0;
	let over20 = 0;
	let qualityTotal = 0;
	let qualityMin = Number.POSITIVE_INFINITY;
	let ready = 0;
	let review = 0;
	let blocked = 0;
	let knowledgeTotal = 0;
	let outcomeCalibrated = 0;
	for (const template of templates) {
		const raw = isRecord(template.raw_analysis) ? template.raw_analysis : {};
		const categoryId = stringField(raw.reference_category_id);
		if (!categoryId) continue;
		const current = counts.get(categoryId) ?? {
			count: 0,
			deep: 0,
			shorts: 0,
			longform: 0,
			over20: 0,
			qualityTotal: 0,
			qualityMin: Number.POSITIVE_INFINITY,
			ready: 0,
			review: 0,
			blocked: 0,
			knowledgeTotal: 0,
			outcomeCalibrated: 0,
		};
		const quality = scoreReferenceQuality(template);
		const readiness = getReferenceTemplateReadiness(template);
		const knowledge = buildReferenceKnowledgeProfile(template);
		const sourceDuration =
			numberField(raw.source_duration_seconds) ??
			numberField(template.duration_seconds) ??
			0;
		const isDeep = quality.deep;
		const isShorts = sourceDuration > 0 && sourceDuration <= 180;
		const isLongform = sourceDuration >= 8 * 60 && sourceDuration <= 20 * 60;
		const isOver20 = sourceDuration > 20 * 60;
		current.count += 1;
		current.deep += isDeep ? 1 : 0;
		current.shorts += isShorts ? 1 : 0;
		current.longform += isLongform ? 1 : 0;
		current.over20 += isOver20 ? 1 : 0;
		current.qualityTotal += quality.score;
		current.qualityMin = Math.min(current.qualityMin, quality.score);
		current.ready += readiness.status === "ready" ? 1 : 0;
		current.review += readiness.status === "review" ? 1 : 0;
		current.blocked += readiness.status === "blocked" ? 1 : 0;
		current.knowledgeTotal += knowledge.score;
		current.outcomeCalibrated +=
			knowledge.maturity === "outcome-calibrated" ? 1 : 0;
		counts.set(categoryId, current);
		deep += isDeep ? 1 : 0;
		shorts += isShorts ? 1 : 0;
		longform += isLongform ? 1 : 0;
		over20 += isOver20 ? 1 : 0;
		qualityTotal += quality.score;
		qualityMin = Math.min(qualityMin, quality.score);
		ready += readiness.status === "ready" ? 1 : 0;
		review += readiness.status === "review" ? 1 : 0;
		blocked += readiness.status === "blocked" ? 1 : 0;
		knowledgeTotal += knowledge.score;
		outcomeCalibrated += knowledge.maturity === "outcome-calibrated" ? 1 : 0;
	}
	return {
		total: templates.length,
		deep,
		shorts,
		longform,
		over20,
		qualityAvg: templates.length ? Math.round(qualityTotal / templates.length) : 0,
		qualityMin: Number.isFinite(qualityMin) ? qualityMin : 0,
		ready,
		review,
		blocked,
		knowledgeAvg: templates.length
			? Math.round(knowledgeTotal / templates.length)
			: 0,
		outcomeCalibrated,
		categories: Object.entries(GENERATED_REFERENCE_CATEGORY_LABELS).map(
			([id, label]) => {
				const current = counts.get(id) ?? {
					count: 0,
					deep: 0,
					shorts: 0,
					longform: 0,
					over20: 0,
					qualityTotal: 0,
					qualityMin: Number.POSITIVE_INFINITY,
					ready: 0,
					review: 0,
					blocked: 0,
					knowledgeTotal: 0,
					outcomeCalibrated: 0,
				};
				return {
					id,
					label,
					count: current.count,
					deep: current.deep,
					shorts: current.shorts,
					longform: current.longform,
					over20: current.over20,
					qualityAvg: current.count
						? Math.round(current.qualityTotal / current.count)
						: 0,
					qualityMin: Number.isFinite(current.qualityMin)
						? current.qualityMin
						: 0,
					ready: current.ready,
					review: current.review,
					blocked: current.blocked,
					knowledgeAvg: current.count
						? Math.round(current.knowledgeTotal / current.count)
						: 0,
					outcomeCalibrated: current.outcomeCalibrated,
				};
			},
		),
	};
}

export function getReferenceTemplateQuality(
	template?: ReferenceTemplate | null,
): ReferenceQualityReport {
	return scoreReferenceQuality(template ?? {});
}

export function getReferenceTemplateReadiness(
	template?: ReferenceTemplate | null,
): ReferenceTemplateReadiness {
	const quality = getReferenceTemplateQuality(template);
	const primaryGap = quality.gaps[0] ?? "";
	const primaryStrength = quality.strengths[0] ?? "기본 제작 신호";

	if (
		!quality.sourceDurationOk ||
		!quality.outputDurationOk ||
		quality.grade === "C" ||
		quality.grade === "D"
	) {
		return {
			status: "blocked",
			label: "생성 차단 권장",
			state: "error",
			priority: 0,
			summary: `Q${quality.score} · ${quality.grade} · ${primaryGap || "품질 기준 미달"}`,
			action:
				"이 레퍼런스는 바로 생성에 쓰지 말고 deep 분석, 전사, 길이 정책을 먼저 보강하세요.",
		};
	}

	if (quality.grade === "B" || quality.gaps.length > 0) {
		return {
			status: "review",
			label: "검토 후 사용",
			state: "warning",
			priority: 1,
			summary: `Q${quality.score} · ${quality.grade} · ${primaryGap || "보강 여지 있음"}`,
			action:
				"생성은 가능하지만 약한 신호가 있으므로 같은 카테고리의 S/A 레퍼런스를 우선 비교하세요.",
		};
	}

	return {
		status: "ready",
		label: "생성 우선 사용",
		state: "info",
		priority: 2,
		summary: `Q${quality.score} · ${quality.grade} · ${primaryStrength}`,
		action:
			"대본, 컷 호흡, 화면 배치, BGM/TTS 톤을 생성 프리셋으로 바로 적용할 수 있습니다.",
	};
}

export function sortReferenceTemplatesByQuality<T extends ReferenceTemplate>(
	templates: T[],
): T[] {
	return [...templates].sort((a, b) => {
		const aQuality = getReferenceTemplateQuality(a);
		const bQuality = getReferenceTemplateQuality(b);
		const aReadiness = getReferenceTemplateReadiness(a);
		const bReadiness = getReferenceTemplateReadiness(b);
		const aKnowledge = buildReferenceKnowledgeProfile(a);
		const bKnowledge = buildReferenceKnowledgeProfile(b);
		return (
			bReadiness.priority - aReadiness.priority ||
			bKnowledge.score - aKnowledge.score ||
			Number(bKnowledge.maturity === "outcome-calibrated") -
				Number(aKnowledge.maturity === "outcome-calibrated") ||
			Number(bQuality.deep) - Number(aQuality.deep) ||
			bQuality.score - aQuality.score ||
			timestamp(b.created_at) - timestamp(a.created_at)
		);
	});
}

export function getBuiltInReferenceTemplate(
	id: string,
	channelId = BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
): ReferenceTemplate | null {
	const template = BUILT_IN_REFERENCE_TEMPLATES.find((item) => item.id === id);
	return template ? cloneReferenceTemplateInput(template, channelId) : null;
}

export function isBuiltInReferenceTemplate(id: string): boolean {
	return (
		BUILT_IN_REFERENCE_TEMPLATES.some((template) => template.id === id) ||
		id.startsWith("builtin-auto-")
	);
}

export function isBuiltInReference(template?: ReferenceTemplate | null): boolean {
	return Boolean(
		template?.raw_analysis &&
			(template.raw_analysis as { built_in_reference?: unknown })
				.built_in_reference === true,
	);
}

export function getReferenceTemplateMethodLabel(
	template?: ReferenceTemplate | null,
): string {
	return productionMethodOf(template)?.label ?? "";
}

export function getReferenceTemplateMethodDescription(
	template?: ReferenceTemplate | null,
): string {
	return productionMethodOf(template)?.description ?? "";
}

export function getReferenceTemplateMethodRules(
	template?: ReferenceTemplate | null,
): string[] {
	return productionMethodOf(template)?.rules ?? [];
}

export function getReferenceTemplateRecommendedMode(
	template?: ReferenceTemplate | null,
): ReferenceProductionMode {
	return productionMethodOf(template)?.recommendedMode ?? "research";
}

export function getReferenceTemplateSupportedFormats(
	template?: ReferenceTemplate | null,
): ReferenceOutputFormat[] {
	return productionMethodOf(template)?.supportedFormats ?? ["shorts", "longform"];
}

export function formatReferenceOutputFormats(
	template?: ReferenceTemplate | null,
): string {
	return getReferenceTemplateSupportedFormats(template)
		.map((format) => (format === "shorts" ? "쇼츠" : "롱폼"))
		.join(" / ");
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
