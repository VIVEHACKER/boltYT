import type { YouTubeMetadata } from "./youtube-metadata.ts";

/**
 * 4개 플랫폼(유튜브/틱톡/릴스/네이버클립) 업로드 메타 변환기.
 * 새 카피라이팅 없이 기존 buildYouTubeMetadata 산출물을 플랫폼 제약에 맞게 변환한다.
 * 순수 함수 — LLM/네트워크 호출 없음.
 *
 * 플랫폼 제약 요약:
 * - youtube:    제목 100자 / 설명 5000자 / 해시태그 15개 초과 시 전부 무시 → 15 컷
 * - tiktok:     제목 100자 컷 / 캡션 2200자 컷 / 해시태그 최대 5
 * - reels:      캡션 2200자 컷 / 해시태그 최대 8
 * - naver_clip: 한국어 태그 우선(비한글 후순위 정렬) / 해시태그 최대 10
 * - 공통: sourceList/disclosure 는 4종 모두 포함 (YMYL 안전레인 전파).
 *   캡션이 잘릴 경우 면책 > 출처 > 챕터 > 본문 순으로 생존한다.
 */

export interface PlatformChapter {
	/** 챕터 시작 시각(초) */
	sec: number;
	label: string;
}

export interface PlatformMetaInput {
	title: string;
	description: string;
	tags: string[];
	hashtags?: string[];
	chapters?: PlatformChapter[];
	isShorts: boolean;
	/** 경제 콘텐츠 출처 리스트 (기사/기관명) */
	sourceList?: string[];
	/** YMYL 면책 문구 — 잘려도 우선 생존 */
	disclosure?: string;
}

export interface PlatformMeta {
	title: string;
	description: string;
	tags: string[];
	hashtags: string[];
}

export interface PlatformMetaBundle {
	youtube: PlatformMeta;
	tiktok: PlatformMeta;
	reels: PlatformMeta;
	naver_clip: PlatformMeta;
}

// ── 플랫폼 상수 ──────────────────────────────────────────────
const YOUTUBE_TITLE_MAX = 100;
const YOUTUBE_DESC_MAX = 5000;
const YOUTUBE_HASHTAG_MAX = 15; // 15개 초과 시 유튜브가 전부 무시
const TIKTOK_TITLE_MAX = 100;
const TIKTOK_CAPTION_MAX = 2200;
const TIKTOK_HASHTAG_MAX = 5;
const REELS_CAPTION_MAX = 2200;
const REELS_HASHTAG_MAX = 8;
const NAVER_HASHTAG_MAX = 10;
const SECTION_SEP = "\n\n";

// ── 문자열 유틸 (코드포인트 기준 — 이모지 절단 방지) ───────────
function cpLength(value: string): number {
	return Array.from(value).length;
}

function clampCodePoints(value: string, max: number): string {
	if (max <= 0) return "";
	const points = Array.from(value);
	if (points.length <= max) return value;
	return points.slice(0, max).join("").trim();
}

function normalizeText(value?: string): string {
	return (value ?? "").trim();
}

function unique(values: string[]): string[] {
	return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

// ── 해시태그/태그 정규화 ─────────────────────────────────────
/** `#` 유무/공백 섞인 입력을 `#태그` 형태로 통일하고 중복 제거 */
function normalizeHashtags(values: string[]): string[] {
	return unique(
		values.map((v) => v.replace(/^#+/, "").replace(/\s+/g, "")),
	).map((tag) => `#${tag}`);
}

const HANGUL_RE = /[ㄱ-ㆎ가-힣]/;

/** 한글 포함 항목을 앞으로 — 상대 순서 유지(stable) */
function koreanFirst(values: string[]): string[] {
	return [
		...values.filter((v) => HANGUL_RE.test(v)),
		...values.filter((v) => !HANGUL_RE.test(v)),
	];
}

// ── 챕터 ────────────────────────────────────────────────────
/** 초 → 유튜브 타임스탬프 (3600초 이상은 H:MM:SS) */
export function formatChapterTimestamp(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const rest = safe % 60;
	const mmss = `${minutes}:${String(rest).padStart(2, "0")}`;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
		: mmss;
}

/**
 * 챕터 라인 생성 — 유튜브 규칙: 첫 챕터는 반드시 0:00.
 * 정렬 후 첫 챕터가 0초가 아니면 0초로 보정한다.
 */
function buildChapterLines(chapters: PlatformChapter[]): string[] {
	const sorted = chapters
		.filter((c) => normalizeText(c.label).length > 0)
		.slice()
		.sort((a, b) => a.sec - b.sec);
	if (sorted.length === 0) return [];
	return sorted.map((chapter, index) => {
		const sec = index === 0 ? 0 : chapter.sec;
		return `${formatChapterTimestamp(sec)} ${normalizeText(chapter.label)}`;
	});
}

// ── 캡션 조립 (면책 우선 생존) ───────────────────────────────
/**
 * 표시 순서대로 받은 섹션에 예산을 **뒤에서부터** 배정한다.
 * → 마지막 섹션(면책)이 먼저 예산을 확보하고, 본문이 먼저 잘린다.
 */
function composeWithPriority(sections: string[], maxLen: number): string {
	const kept: string[] = new Array(sections.length).fill("");
	let budget = maxLen;
	for (let i = sections.length - 1; i >= 0; i--) {
		const section = sections[i];
		if (!section) continue;
		const sepCost = kept.some(Boolean) ? SECTION_SEP.length : 0;
		const available = budget - sepCost;
		if (available <= 0) continue;
		const clamped = clampCodePoints(section, available);
		if (!clamped) continue;
		kept[i] = clamped;
		budget -= cpLength(clamped) + sepCost;
	}
	return kept.filter(Boolean).join(SECTION_SEP);
}

function buildSourcesBlock(sourceList?: string[]): string {
	const sources = unique(sourceList ?? []);
	if (sources.length === 0) return "";
	return ["참고/출처", ...sources.map((s) => `- ${s}`)].join("\n");
}

function buildCaption(
	input: PlatformMetaInput,
	options: { maxLen: number; includeChapters: boolean },
): string {
	const chapterLines =
		options.includeChapters && !input.isShorts && input.chapters?.length
			? buildChapterLines(input.chapters)
			: [];
	const sections = [
		normalizeText(input.description),
		chapterLines.length > 0 ? ["챕터", ...chapterLines].join("\n") : "",
		buildSourcesBlock(input.sourceList),
		normalizeText(input.disclosure),
	];
	return composeWithPriority(sections, options.maxLen);
}

// ── 메인 변환기 ──────────────────────────────────────────────
export function buildPlatformMeta(
	input: PlatformMetaInput,
): PlatformMetaBundle {
	const title = normalizeText(input.title);
	const tags = unique(input.tags);
	const hashtags = normalizeHashtags(input.hashtags ?? []);

	const youtube: PlatformMeta = {
		title: clampCodePoints(title, YOUTUBE_TITLE_MAX),
		description: buildCaption(input, {
			maxLen: YOUTUBE_DESC_MAX,
			includeChapters: true,
		}),
		tags,
		hashtags: hashtags.slice(0, YOUTUBE_HASHTAG_MAX),
	};

	const tiktok: PlatformMeta = {
		title: clampCodePoints(title, TIKTOK_TITLE_MAX),
		description: buildCaption(input, {
			maxLen: TIKTOK_CAPTION_MAX,
			includeChapters: false,
		}),
		tags,
		hashtags: hashtags.slice(0, TIKTOK_HASHTAG_MAX),
	};

	const reels: PlatformMeta = {
		title,
		description: buildCaption(input, {
			maxLen: REELS_CAPTION_MAX,
			includeChapters: false,
		}),
		tags,
		hashtags: hashtags.slice(0, REELS_HASHTAG_MAX),
	};

	const naverClip: PlatformMeta = {
		title,
		description: buildCaption(input, {
			maxLen: YOUTUBE_DESC_MAX,
			includeChapters: false,
		}),
		tags: koreanFirst(tags),
		hashtags: koreanFirst(hashtags).slice(0, NAVER_HASHTAG_MAX),
	};

	return { youtube, tiktok, reels, naver_clip: naverClip };
}

// ── buildYouTubeMetadata 출력 어댑터 ─────────────────────────
const CHAPTER_LINE_RE = /^(?:(\d+):)?(\d+):(\d{2})\s+(.+)$/;

/** "M:SS 라벨" / "H:MM:SS 라벨" 챕터 문자열 → PlatformChapter */
export function parseChapterLine(line: string): PlatformChapter | null {
	const match = CHAPTER_LINE_RE.exec(line.trim());
	if (!match) return null;
	const [, h, m, s, label] = match;
	const hours = h ? Number(h) : 0;
	return {
		sec: hours * 3600 + Number(m) * 60 + Number(s),
		label: label.trim(),
	};
}

const HASHTAG_ONLY_BLOCK_RE = /^#\S+(\s+#\S+)*$/;

/**
 * buildYouTubeMetadata 의 description 에는 챕터/출처/해시태그 블록이 이미
 * 박혀 있다. 그대로 넘기면 buildPlatformMeta 가 같은 블록을 중복 부착하므로
 * 섹션 헤더("챕터"/"참고/출처") 블록과 해시태그 전용 블록을 벗겨 본문만 남긴다.
 */
function stripComposedBlocks(description: string): string {
	return description
		.split(SECTION_SEP)
		.filter((block) => {
			const trimmed = block.trim();
			if (!trimmed) return false;
			if (trimmed.startsWith("챕터\n")) return false;
			if (trimmed.startsWith("참고/출처\n")) return false;
			if (HASHTAG_ONLY_BLOCK_RE.test(trimmed)) return false;
			return true;
		})
		.join(SECTION_SEP)
		.trim();
}

export interface AdaptYouTubeMetadataOptions {
	isShorts?: boolean;
	sourceList?: string[];
	disclosure?: string;
}

/**
 * buildYouTubeMetadata 출력 → PlatformMetaInput 필드 매핑.
 * - tags 가 비면 hashtags(# 제거) → title 순으로 폴백해 빈 tags 를 막는다.
 * - chapters 문자열("M:SS 라벨")은 {sec,label} 로 파싱.
 * - description 의 챕터/출처/해시태그 블록은 제거(중복 부착 방지).
 */
export function adaptYouTubeMetadata(
	meta: YouTubeMetadata,
	options: AdaptYouTubeMetadataOptions = {},
): PlatformMetaInput {
	const fallbackTags =
		meta.tags.length > 0
			? meta.tags
			: meta.hashtags.length > 0
				? meta.hashtags.map((tag) => tag.replace(/^#+/, ""))
				: [meta.title];
	return {
		title: meta.title,
		description: stripComposedBlocks(meta.description),
		tags: unique(fallbackTags),
		hashtags: meta.hashtags,
		chapters: meta.chapters
			.map(parseChapterLine)
			.filter((c): c is PlatformChapter => c !== null),
		isShorts: options.isShorts ?? meta.chapters.length === 0,
		sourceList: options.sourceList,
		disclosure: options.disclosure,
	};
}
