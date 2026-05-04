import type { ReferenceTemplate } from "../types/database";
import type { ThumbnailPreset } from "./thumbnail";

export type ThumbnailAnalysisDepth = "metadata_structured" | "deep_structured";
export type ThumbnailTextStrategy =
	| "curiosity_gap"
	| "proof_claim"
	| "face_emotion"
	| "source_event"
	| "minimal_context";
export type ThumbnailTextZone =
	| "left_third"
	| "center_band"
	| "top_left"
	| "bottom_band"
	| "right_third";
export type ThumbnailSubjectZone =
	| "center"
	| "left"
	| "right"
	| "split"
	| "background";
export type ThumbnailContrast = "low" | "medium" | "high" | "extreme";
export type ThumbnailAssetMode =
	| "custom_thumbnail"
	| "shorts_cover_frame"
	| "upload_package";

export interface ReferenceThumbnailDna {
	version: "thumbnail-dna-v1";
	analysisDepth: ThumbnailAnalysisDepth;
	source: {
		templateId: string;
		title: string;
		thumbnailUrl: string;
		sourceUrl: string;
		sourceCreator: string;
	};
	format: {
		assetMode: ThumbnailAssetMode;
		width: number;
		height: number;
		aspectRatio: "16:9";
		note: string;
	};
	text: {
		strategy: ThumbnailTextStrategy;
		maxWords: number;
		maxChars: number;
		lineCount: 1 | 2 | 3;
		titleFormula: string;
		subtitleFormula: string;
		forbidden: string[];
	};
	layout: {
		textZone: ThumbnailTextZone;
		subjectZone: ThumbnailSubjectZone;
		safeZones: string[];
		negativeSpace: "low" | "medium" | "high";
	};
	color: {
		palette: string[];
		accentColor: string;
		contrast: ThumbnailContrast;
		backgroundTone: "dark" | "warm" | "bright" | "neutral";
	};
	clickPackaging: {
		promiseType: "mystery" | "news" | "recap" | "automation" | "story";
		emotion: string;
		curiosityGap: string;
		titleThumbnailRelationship: string;
	};
	generation: {
		preset: ThumbnailPreset;
		badgeText: string;
		overlay: "vignette" | "news_plate" | "cinematic_shadow" | "clean_card";
		negativePromptRules: string[];
		variants: Array<{
			id: string;
			titlePattern: string;
			subtitle: string;
			testGoal: string;
		}>;
	};
	quality: {
		score: number;
		strengths: string[];
		risks: string[];
		requiredActions: string[];
	};
}

export interface ThumbnailPlan {
	title: string;
	subtitle: string;
	preset: ThumbnailPreset;
	accentColor: string;
	badgeText: string;
	layout: ThumbnailTextZone;
	referenceDna: ReferenceThumbnailDna;
	variants: ReferenceThumbnailDna["generation"]["variants"];
	quality: ReferenceThumbnailDna["quality"];
}

export interface ThumbnailReadiness {
	ok: boolean;
	level: "ready" | "warning" | "blocked";
	score: number;
	label: string;
	blockers: string[];
	warnings: string[];
	strengths: string[];
	requiredActions: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function clampScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizedText(value?: string | null): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function compactText(value: string | undefined, maxChars: number): string {
	const text = normalizedText(value);
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1).trim()}…`;
}

function inferAssetMode(template: ReferenceTemplate): ThumbnailAssetMode {
	const source = (template.source_url ?? "").toLowerCase();
	if (source.includes("/shorts/") || Number(template.duration_seconds ?? 0) <= 90) {
		return "shorts_cover_frame";
	}
	if (template.thumbnail_url) return "custom_thumbnail";
	return "upload_package";
}

function inferPromiseType(
	template: ReferenceTemplate,
): ReferenceThumbnailDna["clickPackaging"]["promiseType"] {
	const text = [
		template.id,
		template.name,
		template.source_title,
		template.visual_mood,
		template.bgm_mood,
		JSON.stringify(template.raw_analysis ?? {}),
	]
		.join(" ")
		.toLowerCase();
	if (/drama|movie|recap|드라마|영화|몰아보기|리캡/.test(text)) return "recap";
	if (/business|automation|money|자동화|수익|비즈니스/.test(text)) {
		return "automation";
	}
	if (/news|issue|social|뉴스|이슈|사회/.test(text)) return "news";
	if (/animation|story|애니|캐릭터|스토리/.test(text)) return "story";
	return "mystery";
}

function inferPreset(
	template: ReferenceTemplate,
	promiseType: ReferenceThumbnailDna["clickPackaging"]["promiseType"],
): ThumbnailPreset {
	if (promiseType === "news") return "news";
	if (promiseType === "recap") return "dramatic";
	if (promiseType === "automation") return "bold";
	if (promiseType === "story") return "minimal";
	if (template.visual_mood === "news") return "news";
	if (template.visual_mood === "warm") return "minimal";
	return "mystery";
}

function inferTextStrategy(
	template: ReferenceTemplate,
	promiseType: ReferenceThumbnailDna["clickPackaging"]["promiseType"],
): ThumbnailTextStrategy {
	const text = `${template.source_title} ${template.name}`.toLowerCase();
	if (/왜|비밀|숨겨|실종|미스터리|의문|반전/.test(text)) return "curiosity_gap";
	if (/증거|기록|확인|자료|팩트|공식/.test(text)) return "proof_claim";
	if (/인터뷰|사람|여자|남자|배우|주인공|얼굴/.test(text)) return "face_emotion";
	if (promiseType === "news") return "source_event";
	if (promiseType === "automation") return "proof_claim";
	return "curiosity_gap";
}

function inferTextZone(strategy: ThumbnailTextStrategy): ThumbnailTextZone {
	if (strategy === "face_emotion") return "left_third";
	if (strategy === "source_event") return "bottom_band";
	if (strategy === "proof_claim") return "left_third";
	return "center_band";
}

function inferSubjectZone(textZone: ThumbnailTextZone): ThumbnailSubjectZone {
	if (textZone === "left_third") return "right";
	if (textZone === "right_third") return "left";
	if (textZone === "bottom_band") return "center";
	return "background";
}

function inferContrast(template: ReferenceTemplate): ThumbnailContrast {
	const colors = (template.dominant_colors ?? []).map((color) =>
		color.toLowerCase(),
	);
	if (colors.includes("#000000") && colors.includes("#ffffff")) return "extreme";
	if (template.lighting_style === "dark" || template.visual_mood === "mystery") {
		return "high";
	}
	if (template.lighting_style === "bright") return "medium";
	return "high";
}

function inferBackgroundTone(
	template: ReferenceTemplate,
): ReferenceThumbnailDna["color"]["backgroundTone"] {
	if (template.lighting_style === "dark" || template.visual_mood === "mystery") {
		return "dark";
	}
	if (template.visual_mood === "warm") return "warm";
	if (template.lighting_style === "bright") return "bright";
	return "neutral";
}

function inferAccentColor(template: ReferenceTemplate): string {
	if (template.subtitle_accent_color?.trim()) return template.subtitle_accent_color;
	const palette = (template.dominant_colors ?? []).filter(Boolean);
	const saturated = palette.find((color) => !/^#(?:000000|ffffff|f+|0+)$/i.test(color));
	return saturated ?? "#f59e0b";
}

function analysisDepth(template: ReferenceTemplate): ThumbnailAnalysisDepth {
	const raw = isRecord(template.raw_analysis) ? template.raw_analysis : {};
	const productionDna = nestedRecord(raw, "production_dna");
	const depth =
		stringField(raw.analysis_depth) || stringField(productionDna?.analysisDepth);
	return depth === "pixel_frame_audio_edit" || raw.sampled_deep_reference === true
		? "deep_structured"
		: "metadata_structured";
}

function textFormula(strategy: ThumbnailTextStrategy): string {
	if (strategy === "proof_claim") return "핵심 증거 1개 + 반박 가능한 질문";
	if (strategy === "face_emotion") return "인물 감정 단어 + 선택/반전";
	if (strategy === "source_event") return "사건 주어 + 달라진 이유";
	if (strategy === "minimal_context") return "짧은 명사구 + 상황 라벨";
	return "익숙한 소재 + 설명되지 않은 빈틈";
}

function subtitleFormula(
	promiseType: ReferenceThumbnailDna["clickPackaging"]["promiseType"],
): string {
	if (promiseType === "recap") return "결말/복선/관계 중 하나만 보조 문구로 사용";
	if (promiseType === "automation") return "숫자 또는 전후 비교를 보조 문구로 사용";
	if (promiseType === "news") return "자료/타임라인/쟁점 중 하나만 보조 문구로 사용";
	return "기록/단서/미스터리 중 하나만 보조 문구로 사용";
}

function badgeTextFor(
	promiseType: ReferenceThumbnailDna["clickPackaging"]["promiseType"],
): string {
	if (promiseType === "recap") return "복선";
	if (promiseType === "automation") return "실험";
	if (promiseType === "news") return "쟁점";
	if (promiseType === "story") return "반전";
	return "단서";
}

function variantsFor(
	template: ReferenceTemplate,
	dna: Pick<
		ReferenceThumbnailDna,
		"clickPackaging" | "text"
	>,
): ReferenceThumbnailDna["generation"]["variants"] {
	const base = compactText(template.source_title || template.name || "", 24);
	const promise = dna.clickPackaging.promiseType;
	return [
		{
			id: "curiosity",
			titlePattern:
				promise === "automation"
					? "이 방법이 실패하는 이유"
					: "아무도 설명하지 못한 장면",
			subtitle: badgeTextFor(promise),
			testGoal: "홈/추천 노출에서 호기심 CTR을 검증",
		},
		{
			id: "proof",
			titlePattern:
				promise === "recap" ? "결말을 바꾼 한 장면" : "기록에 남은 결정적 단서",
			subtitle: "자료 기반",
			testGoal: "검색/관련 동영상에서 신뢰 클릭을 검증",
		},
		{
			id: "direct",
			titlePattern: base || "핵심만 다시 보기",
			subtitle: "빠른 이해",
			testGoal: "기존 시청자 재방문/구독 전환을 검증",
		},
	];
}

function qualityFor(input: {
	template: ReferenceTemplate;
	depth: ThumbnailAnalysisDepth;
	thumbnailUrl: string;
	textZone: ThumbnailTextZone;
	contrast: ThumbnailContrast;
	palette: string[];
}): ReferenceThumbnailDna["quality"] {
	const strengths: string[] = [];
	const risks: string[] = [];
	const requiredActions: string[] = [];
	let score = 42;

	if (input.thumbnailUrl) {
		score += 20;
		strengths.push("레퍼런스 썸네일 URL 보존");
	} else {
		risks.push("원본 썸네일 이미지 없음");
		requiredActions.push("업로드 전 생성 썸네일을 반드시 검수하세요.");
	}
	if (input.depth === "deep_structured") {
		score += 16;
		strengths.push("deep 레퍼런스 문맥과 연결");
	}
	if (input.palette.length >= 2) {
		score += 8;
		strengths.push("팔레트 신호 보유");
	} else {
		risks.push("팔레트 신호 부족");
	}
	if (input.contrast === "high" || input.contrast === "extreme") {
		score += 8;
		strengths.push("고대비 클릭 패키징 가능");
	}
	if (input.textZone === "center_band") {
		risks.push("중앙 텍스트는 피사체를 가릴 수 있음");
		requiredActions.push("피사체가 중앙이면 텍스트를 좌/하단으로 이동하세요.");
	} else {
		score += 6;
		strengths.push("피사체/텍스트 분리 구조");
	}
	if (inferAssetMode(input.template) === "shorts_cover_frame") {
		requiredActions.push(
			"Shorts는 커스텀 썸네일 업로드 대신 첫 프레임/커버 프레임까지 같은 구조로 설계하세요.",
		);
	}

	return {
		score: clampScore(score),
		strengths: strengths.slice(0, 4),
		risks: risks.slice(0, 4),
		requiredActions: requiredActions.slice(0, 4),
	};
}

export function buildReferenceThumbnailDna(
	template: ReferenceTemplate,
): ReferenceThumbnailDna {
	const raw = isRecord(template.raw_analysis) ? template.raw_analysis : {};
	const stored = nestedRecord(raw, "thumbnail_dna");
	if (stored?.version === "thumbnail-dna-v1") {
		return stored as unknown as ReferenceThumbnailDna;
	}

	const promiseType = inferPromiseType(template);
	const strategy = inferTextStrategy(template, promiseType);
	const textZone = inferTextZone(strategy);
	const contrast = inferContrast(template);
	const palette = (template.dominant_colors ?? []).filter(Boolean).slice(0, 5);
	const depth = analysisDepth(template);
	const quality = qualityFor({
		template,
		depth,
		thumbnailUrl: template.thumbnail_url ?? "",
		textZone,
		contrast,
		palette,
	});
	const badgeText = badgeTextFor(promiseType);

	return {
		version: "thumbnail-dna-v1",
		analysisDepth: depth,
		source: {
			templateId: template.id,
			title: template.source_title || template.name,
			thumbnailUrl: template.thumbnail_url ?? "",
			sourceUrl: template.source_url ?? "",
			sourceCreator: template.source_creator ?? "",
		},
		format: {
			assetMode: inferAssetMode(template),
			width: 1280,
			height: 720,
			aspectRatio: "16:9",
			note:
				"롱폼은 1280x720 커스텀 썸네일, Shorts는 같은 구조를 첫 프레임/커버 프레임으로 반영",
		},
		text: {
			strategy,
			maxWords: strategy === "minimal_context" ? 3 : 5,
			maxChars: strategy === "proof_claim" ? 22 : 18,
			lineCount: strategy === "source_event" ? 2 : 3,
			titleFormula: textFormula(strategy),
			subtitleFormula: subtitleFormula(promiseType),
			forbidden: [
				"영상 내용에 없는 충격 표현",
				"원본 제목/문구 그대로 복제",
				"피사체 얼굴 또는 핵심 증거를 가리는 텍스트",
			],
		},
		layout: {
			textZone,
			subjectZone: inferSubjectZone(textZone),
			safeZones: ["outer_8_percent_margin", "mobile_center_readability"],
			negativeSpace: textZone === "center_band" ? "medium" : "high",
		},
		color: {
			palette,
			accentColor: inferAccentColor(template),
			contrast,
			backgroundTone: inferBackgroundTone(template),
		},
		clickPackaging: {
			promiseType,
			emotion:
				promiseType === "automation"
					? "전후 비교와 실행 욕구"
					: promiseType === "recap"
						? "복선 발견과 감정 회수"
						: promiseType === "news"
							? "쟁점 이해와 확인 욕구"
							: "설명되지 않은 단서에 대한 호기심",
			curiosityGap:
				strategy === "proof_claim"
					? "증거는 보이지만 결론은 바로 말하지 않음"
					: "익숙한 소재 안의 설명되지 않은 빈틈을 남김",
			titleThumbnailRelationship:
				"제목은 질문/약속, 썸네일은 증거/감정을 담당해 같은 문장을 반복하지 않음",
		},
		generation: {
			preset: inferPreset(template, promiseType),
			badgeText,
			overlay:
				contrast === "extreme"
					? "cinematic_shadow"
					: promiseType === "news"
						? "news_plate"
						: "vignette",
			negativePromptRules: [
				"small unreadable text",
				"cluttered background",
				"misleading object not in video",
				"graphic gore or shocking injury",
			],
			variants: [],
		},
		quality,
	};
}

export function finalizeReferenceThumbnailDna(
	template: ReferenceTemplate,
): ReferenceThumbnailDna {
	const dna = buildReferenceThumbnailDna(template);
	return {
		...dna,
		generation: {
			...dna.generation,
			variants: variantsFor(template, dna),
		},
	};
}

function topicMainPhrase(topicTitle: string, fallback: string, maxChars: number): string {
	const clean = normalizedText(topicTitle)
		.replace(/\s*(타임라인|분석|정리|요약|#shorts)$/gi, "")
		.trim();
	const source = clean || fallback;
	const words = source.split(/\s+/).filter(Boolean);
	if (source.length <= maxChars) return source;
	if (words.length > 1) {
		const compact = words.slice(0, 4).join(" ");
		if (compact.length <= maxChars) return compact;
	}
	return compactText(source, maxChars);
}

function subtitleFromDna(
	dna: ReferenceThumbnailDna,
	isShorts: boolean,
): string {
	if (isShorts) return "첫 프레임 훅";
	const promise = dna.clickPackaging.promiseType;
	if (promise === "recap") return "복선 회수";
	if (promise === "automation") return "실험 결과";
	if (promise === "news") return "쟁점 정리";
	return "기록의 빈틈";
}

export function buildThumbnailPlanFromReference(input: {
	topicTitle: string;
	fallbackTitle: string;
	fallbackSubtitle?: string;
	isShorts: boolean;
	referenceTemplate?: ReferenceTemplate | null;
}): ThumbnailPlan {
	const reference =
		input.referenceTemplate ??
		({
			id: "fallback-thumbnail-reference",
			channel_id: "",
			name: input.fallbackTitle,
			source_type: "manual",
			source_url: "",
			source_title: input.fallbackTitle,
			source_creator: "",
			thumbnail_url: "",
			duration_seconds: input.isShorts ? 60 : 600,
			dominant_colors: ["#0b0b0b", "#ffffff", "#f59e0b"],
			visual_mood: "mystery",
			visual_prompt_template: "",
			lighting_style: "dark",
			subtitle_position: "bottom",
			subtitle_size_preset: "lg",
			subtitle_bg_style: "block",
			subtitle_accent_color: "#f59e0b",
			scene_count: 8,
			avg_scene_duration: input.isShorts ? 6 : 45,
			hook_duration: input.isShorts ? 3 : 8,
			transition_style: "hardcut",
			pacing_preset: "fast",
			tts_voice_id: "",
			tts_provider: "openai",
			tts_speed: 1,
			tts_tone_keywords: [],
			bgm_mood: "",
			bgm_keywords: [],
			bgm_tempo: "mid",
			bgm_reference_url: "",
			hook_pattern: "question",
			script_structure: [],
			transcript: "",
			frame_urls: [],
			raw_analysis: {},
			analysis_status: "complete",
			analysis_error: "",
			created_at: "",
			updated_at: "",
		} satisfies ReferenceTemplate);
	const dna = finalizeReferenceThumbnailDna(reference);
	const title = topicMainPhrase(input.topicTitle, input.fallbackTitle, dna.text.maxChars);
	const subtitle =
		!input.referenceTemplate && input.fallbackSubtitle
			? input.fallbackSubtitle
			: subtitleFromDna(dna, input.isShorts);

	return {
		title,
		subtitle,
		preset: dna.generation.preset,
		accentColor: dna.color.accentColor,
		badgeText: dna.generation.badgeText,
		layout: dna.layout.textZone,
		referenceDna: dna,
		variants: dna.generation.variants,
		quality: dna.quality,
	};
}

export function assessThumbnailReadiness(input: {
	title?: string | null;
	description?: string | null;
	thumbnailPath?: string | null;
	thumbnailPlan?: ThumbnailPlan | null;
	requirePlan?: boolean;
	isShorts?: boolean;
}): ThumbnailReadiness {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const strengths: string[] = [];
	const requiredActions: string[] = [];
	const title = normalizedText(input.title ?? "");
	let score = 34;

	if (input.thumbnailPath) {
		score += 34;
		strengths.push("생성된 썸네일 파일 있음");
	} else {
		warnings.push("업로드용 썸네일 파일이 없습니다.");
		requiredActions.push("승인 단계에서 썸네일을 생성하거나 다시 생성하세요.");
	}
	if (input.thumbnailPlan) {
		score += Math.round(input.thumbnailPlan.quality.score * 0.24);
		strengths.push("레퍼런스 썸네일 DNA 적용");
	} else if (input.requirePlan !== false) {
		warnings.push("레퍼런스 기반 썸네일 계획이 없습니다.");
	}
	if (title.length >= 18 && title.length <= 72) {
		score += 10;
		strengths.push("제목 길이 적정");
	} else if (title.length > 0) {
		warnings.push("제목 길이가 썸네일/제목 패키징 실험에 애매합니다.");
		requiredActions.push("제목 첫 45자 안에 핵심 키워드와 궁금증을 넣으세요.");
	}
	if (input.isShorts) {
		warnings.push(
			"Shorts는 커스텀 썸네일 업로드가 제한될 수 있어 첫 프레임도 썸네일처럼 설계해야 합니다.",
		);
	}

	const finalScore = clampScore(score);
	if (blockers.length > 0) {
		return {
			ok: false,
			level: "blocked",
			score: finalScore,
			label: "썸네일 차단",
			blockers,
			warnings,
			strengths,
			requiredActions,
		};
	}
	if (warnings.length > 0 || finalScore < 78) {
		return {
			ok: true,
			level: "warning",
			score: finalScore,
			label: "썸네일 보강 필요",
			blockers,
			warnings,
			strengths,
			requiredActions,
		};
	}
	return {
		ok: true,
		level: "ready",
		score: finalScore,
		label: "썸네일 준비",
		blockers,
		warnings,
		strengths,
		requiredActions,
	};
}
