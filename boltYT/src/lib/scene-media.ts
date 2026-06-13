import type { Scene } from "../types/database";
import type { SceneShot } from "./scene-shot-types";

type SceneMediaLike = Pick<
	Scene,
	| "narration_text"
	| "scene_type"
	| "visual_prompt"
	| "source_url"
	| "news_title"
	| "news_source"
	| "news_date"
> & {
	searchQueryKo?: string;
	searchQueryEn?: string;
	locale?: "ko" | "en";
};

type ShotMediaLike = Pick<
	SceneShot,
	| "visual_prompt"
	| "source_url"
	| "source_title"
	| "caption"
	| "search_terms"
	| "visual_role"
>;

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 80): string {
	return value.length <= max ? value : `${value.slice(0, max).trim()}...`;
}

function looksEnglish(value: string): boolean {
	return Array.from(value).every((char) => char.charCodeAt(0) <= 0x7f);
}

function firstNonEmpty(values: Array<string | undefined>): string {
	return values.map(normalizeText).find(Boolean) ?? "";
}

export function isDirectImageUrl(url?: string): url is string {
	return Boolean(
		url &&
			/^https?:\/\//.test(url) &&
			/\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(url),
	);
}

export function isDirectVideoUrl(url?: string): url is string {
	if (!url) return false;
	if (/youtu\.be|youtube\.com/i.test(url)) return true;
	return /^https?:\/\//.test(url) && /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);
}

export function buildSceneSearchQueries(scene: SceneMediaLike): {
	queryKo: string;
	queryEn: string;
	locale: "ko" | "en";
} {
	const sourceHeadline = [scene.news_title, scene.news_source]
		.map(normalizeText)
		.filter(Boolean)
		.join(" ");
	const narration = truncate(normalizeText(scene.narration_text), 60);
	const visualPrompt = normalizeText(scene.visual_prompt);

	const queryKo = firstNonEmpty([
		scene.searchQueryKo,
		sourceHeadline,
		looksEnglish(visualPrompt) ? "" : visualPrompt,
		narration,
		normalizeText(scene.news_date)
			? `${normalizeText(scene.news_date)} ${sourceHeadline}`.trim()
			: "",
	]);
	const queryEn = firstNonEmpty([
		scene.searchQueryEn,
		looksEnglish(visualPrompt) ? visualPrompt : "",
		sourceHeadline,
		scene.searchQueryKo,
		narration,
	]);

	return {
		queryKo,
		queryEn,
		locale: scene.locale ?? "ko",
	};
}

export function buildSceneImagePrompt(scene: SceneMediaLike): string {
	const visualPrompt = normalizeText(scene.visual_prompt);
	// 정상 경로: 영어 visual_prompt 를 충분한 길이로 사용 (디테일 유실 방지).
	if (visualPrompt && looksEnglish(visualPrompt))
		return truncate(visualPrompt, 380);

	// fal/Flux/SDXL 은 영어 편향 — 한국어 프롬프트는 무시되므로 영어 대체(searchQueryEn) 우선.
	const englishFallback = normalizeText(scene.searchQueryEn);
	if (englishFallback) return truncate(englishFallback, 380);

	// 영어 대체가 없으면 한국어 visual_prompt 라도 사용 (현행 동작).
	if (visualPrompt) return truncate(visualPrompt, 380);

	const parts = [
		normalizeText(scene.news_title),
		normalizeText(scene.news_date),
		normalizeText(scene.narration_text),
	].filter(Boolean);

	return truncate(parts.join(" - "), 380);
}

export function buildShotSearchQueries(
	scene: SceneMediaLike,
	shot?: ShotMediaLike,
): {
	queryKo: string;
	queryEn: string;
	locale: "ko" | "en";
} {
	const sceneQueries = buildSceneSearchQueries(scene);
	const shotPrompt = normalizeText(shot?.visual_prompt);
	const shotCaption = normalizeText(shot?.caption);
	const shotTitle = normalizeText(shot?.source_title);
	const shotTerms =
		shot?.search_terms?.map(normalizeText).filter(Boolean) ?? [];
	const roleSuffix =
		shot?.visual_role === "document"
			? "document record evidence"
			: shot?.visual_role === "map"
				? "timeline map"
				: shot?.visual_role === "archive"
					? "archive documentary"
					: shot?.visual_role === "reconstruction"
						? "cinematic reconstruction"
						: "";
	const shotHeadline = [scene.news_date, shotTitle, shotCaption]
		.map(normalizeText)
		.filter(Boolean)
		.join(" ");

	return {
		queryKo: firstNonEmpty([
			...shotTerms.filter((term) => !looksEnglish(term)),
			looksEnglish(shotPrompt) ? "" : shotPrompt,
			shotHeadline,
			scene.searchQueryKo,
			sceneQueries.queryKo,
		]),
		queryEn: firstNonEmpty([
			...shotTerms.filter(looksEnglish),
			looksEnglish(shotPrompt) ? shotPrompt : "",
			roleSuffix,
			scene.searchQueryEn,
			looksEnglish(scene.visual_prompt ?? "")
				? normalizeText(scene.visual_prompt)
				: "",
			shotTitle,
			shotCaption,
			sceneQueries.queryEn,
		]),
		locale: sceneQueries.locale,
	};
}

export function buildShotImagePrompt(
	scene: SceneMediaLike,
	shot?: ShotMediaLike,
): string {
	const shotPrompt = normalizeText(shot?.visual_prompt);
	if (shotPrompt && looksEnglish(shotPrompt)) return truncate(shotPrompt, 380);

	// 영어 shot search_terms 가 있으면 영어 모델용으로 우선 사용.
	const englishShotTerms = (shot?.search_terms ?? [])
		.map(normalizeText)
		.filter((term) => term && looksEnglish(term));
	if (englishShotTerms.length)
		return truncate(englishShotTerms.join(", "), 380);

	if (shotPrompt) return truncate(shotPrompt, 380);

	const parts = [
		normalizeText(shot?.source_title),
		normalizeText(shot?.caption),
		buildSceneImagePrompt(scene),
	].filter(Boolean);

	return truncate(parts.join(" - "), 380);
}
