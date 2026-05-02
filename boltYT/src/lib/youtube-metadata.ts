import type { SceneShot } from "./scene-shot-types";
import type { ThumbnailPreset } from "./thumbnail";

export interface YouTubeMetadataScene {
	narration_text?: string;
	scene_type?: string;
	duration_seconds?: number;
	news_title?: string;
	news_source?: string;
	news_date?: string;
	shots?: SceneShot[];
}

export interface YouTubeMetadataInput {
	topicTitle: string;
	channelName?: string;
	format?: "shorts" | "longform" | "both" | string;
	scenes: YouTubeMetadataScene[];
}

export interface YouTubeMetadata {
	title: string;
	description: string;
	tags: string[];
	hashtags: string[];
	primaryKeywords: string[];
	chapters: string[];
	thumbnail: {
		title: string;
		subtitle: string;
		preset: ThumbnailPreset;
		accentColor: string;
	};
}

const STOPWORDS = new Set([
	"그리고",
	"하지만",
	"그러나",
	"오늘은",
	"이것은",
	"대해서",
	"알아봅니다",
	"정리합니다",
	"했습니다",
	"있습니다",
	"됩니다",
	"대한",
	"영상",
	"장면",
	"자료",
	"사실",
	"확인",
]);

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function clampText(value: string, max: number): string {
	if (value.length <= max) return value;
	return value.slice(0, max - 1).trim();
}

function cleanKeyword(value: string): string {
	return value
		.replace(/[#"'“”‘’()[\]{}<>]/g, "")
		.replace(/[^\p{L}\p{N}\s.-]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function tokenize(value: string): string[] {
	return cleanKeyword(value)
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(
			(token) =>
				token.length >= 2 &&
				!STOPWORDS.has(token) &&
				!/^[0-9]+$/.test(token),
		);
}

function unique(values: string[]): string[] {
	return [...new Set(values.map(cleanKeyword).filter(Boolean))];
}

function inferContentKeywords(topicTitle: string, scenes: YouTubeMetadataScene[]) {
	const counts = new Map<string, number>();
	const bump = (value: string, weight: number) => {
		for (const token of tokenize(value)) {
			counts.set(token, (counts.get(token) ?? 0) + weight);
		}
	};

	bump(topicTitle, 5);
	for (const scene of scenes) {
		bump(scene.news_title ?? "", 4);
		bump(scene.news_date ?? "", 2);
		bump(scene.narration_text ?? "", 1);
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([keyword]) => keyword)
		.slice(0, 10);
}

function inferTopicTags(topicTitle: string, scenes: YouTubeMetadataScene[]): string[] {
	const haystack = `${topicTitle} ${scenes
		.map((scene) => `${scene.narration_text ?? ""} ${scene.news_title ?? ""}`)
		.join(" ")}`;
	const tags = ["사건분석", "자료기반", "타임라인"];
	if (/미제|실종|수사|용의자|범인|살인/.test(haystack)) {
		tags.push("미제사건", "사건다큐");
	}
	if (/미스터리|괴담|공포|소름|의문/.test(haystack)) {
		tags.push("미스터리");
	}
	if (/뉴스|보도|공식|브리핑/.test(haystack)) {
		tags.push("뉴스분석");
	}
	return tags;
}

function inferThumbnailPreset(topicTags: string[]): ThumbnailPreset {
	if (topicTags.includes("뉴스분석")) return "news";
	if (topicTags.includes("미스터리") || topicTags.includes("미제사건")) {
		return "dramatic";
	}
	return "mystery";
}

function buildThumbnailTitle(
	topicTitle: string,
	primaryKeywords: string[],
): string {
	const cleaned = cleanKeyword(topicTitle)
		.replace(/\s*(타임라인|분석|정리|요약)$/g, "")
		.trim();
	if (cleaned.length > 0 && cleaned.length <= 18) return cleaned;
	const compactKeyword = primaryKeywords.find(
		(keyword) => keyword.length >= 2 && keyword.length <= 16,
	);
	return clampText(compactKeyword || cleaned || topicTitle, 18);
}

function buildThumbnailSubtitle(
	isShorts: boolean,
	topicTags: string[],
): string {
	if (isShorts) return "핵심 60초";
	if (topicTags.includes("미제사건")) return "미제 타임라인";
	if (topicTags.includes("뉴스분석")) return "보도자료 분석";
	return "확인된 흐름";
}

function formatTimestamp(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(safe / 60);
	const rest = safe % 60;
	return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function sceneLabel(scene: YouTubeMetadataScene, fallback: string): string {
	const label =
		normalizeText(scene.news_title) ||
		normalizeText(scene.narration_text)
			.split(/[.!?\n]/)[0]
			?.slice(0, 34)
			.trim() ||
		fallback;
	return clampText(label, 38);
}

function buildChapters(scenes: YouTubeMetadataScene[]): string[] {
	if (scenes.length < 6) return [];

	const total = scenes.reduce(
		(sum, scene) => sum + Number(scene.duration_seconds ?? 0),
		0,
	);
	if (total < 180) return [];

	const targets = [
		{ ratio: 0, label: "도입" },
		{ ratio: 0.18, label: "배경" },
		{ ratio: 0.38, label: "전개" },
		{ ratio: 0.62, label: "핵심 쟁점" },
		{ ratio: 0.82, label: "현재와 남은 의문" },
	];
	const starts: number[] = [];
	let cursor = 0;
	for (const scene of scenes) {
		starts.push(cursor);
		cursor += Number(scene.duration_seconds ?? 0);
	}

	const used = new Set<number>();
	return targets
		.map((target) => {
			const targetSeconds = total * target.ratio;
			let bestIndex = 0;
			let bestDelta = Number.POSITIVE_INFINITY;
			for (let index = 0; index < starts.length; index++) {
				if (used.has(index)) continue;
				const delta = Math.abs(starts[index] - targetSeconds);
				if (delta < bestDelta) {
					bestDelta = delta;
					bestIndex = index;
				}
			}
			used.add(bestIndex);
			return `${formatTimestamp(starts[bestIndex])} ${sceneLabel(
				scenes[bestIndex],
				target.label,
			)}`;
		})
		.filter(Boolean);
}

function hasSyntheticReconstruction(scenes: YouTubeMetadataScene[]): boolean {
	return scenes.some((scene) =>
		scene.shots?.some(
			(shot) =>
				shot.visual_role === "reconstruction" ||
				shot.selection_provider === "ai" ||
				Boolean(shot.rejection_reason),
		),
	);
}

function sourceLines(scenes: YouTubeMetadataScene[]): string[] {
	return unique(
		scenes
			.map((scene) => scene.news_source)
			.filter((value): value is string => Boolean(value)),
	)
		.slice(0, 6)
		.map((source) => `- ${source}`);
}

export function buildYouTubeMetadata(
	input: YouTubeMetadataInput,
): YouTubeMetadata {
	const topicTitle = normalizeText(input.topicTitle) || "사건 타임라인";
	const isShorts = input.format === "shorts";
	const contentKeywords = inferContentKeywords(topicTitle, input.scenes);
	const topicTags = inferTopicTags(topicTitle, input.scenes);
	const primaryKeywords = unique([
		topicTitle,
		...contentKeywords.slice(0, 3),
		...topicTags.slice(0, 2),
	]).slice(0, 6);
	const thumbnailPreset = inferThumbnailPreset(topicTags);
	const title = clampText(
		isShorts
			? `${topicTitle} 핵심만 60초 요약`
			: `${topicTitle} 타임라인 분석 | 확인된 사실과 남은 의문`,
		96,
	);
	const hashtags = unique([
		...(isShorts ? ["shorts"] : []),
		...topicTags,
	])
		.slice(0, 3)
		.map((tag) => `#${tag.replace(/\s+/g, "")}`);
	const chapters = isShorts ? [] : buildChapters(input.scenes);
	const sources = sourceLines(input.scenes);
	const disclosure = hasSyntheticReconstruction(input.scenes)
		? [
				"",
				"일부 장면은 이해를 돕기 위한 AI 재구성입니다. 실제 사진/영상은 출처가 확인된 자료만 사용했습니다.",
			]
		: [];

	const descriptionParts = [
		`${topicTitle}의 사건 흐름, 확인된 사실, 남은 의문을 자료 기반으로 정리했습니다.`,
		`핵심 키워드: ${primaryKeywords.slice(0, 4).join(", ")}`,
		...disclosure,
		...(chapters.length > 0 ? ["", "챕터", ...chapters] : []),
		...(sources.length > 0 ? ["", "참고/출처", ...sources] : []),
		"",
		hashtags.join(" "),
	];
	const description = clampText(descriptionParts.join("\n"), 5000);
	const tags = unique([
		topicTitle,
		...contentKeywords,
		...topicTags,
		input.channelName ?? "",
	])
		.filter((tag) => !tag.startsWith("#"))
		.slice(0, 14);

	return {
		title,
		description,
		tags,
		hashtags,
		primaryKeywords,
		chapters,
		thumbnail: {
			title: buildThumbnailTitle(topicTitle, primaryKeywords),
			subtitle: buildThumbnailSubtitle(isShorts, topicTags),
			preset: thumbnailPreset,
			accentColor: thumbnailPreset === "news" ? "#ef4444" : "#f59e0b",
		},
	};
}
