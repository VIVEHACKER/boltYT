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

export function isDirectImageUrl(url?: string): boolean {
	return Boolean(
		url &&
			/^https?:\/\//.test(url) &&
			/\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(url),
	);
}

export function isDirectVideoUrl(url?: string): boolean {
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
	if (visualPrompt) return visualPrompt;

	const parts = [
		normalizeText(scene.news_title),
		normalizeText(scene.news_date),
		normalizeText(scene.narration_text),
	].filter(Boolean);

	return truncate(parts.join(" - "), 180);
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
	const shotTerms = shot?.search_terms?.map(normalizeText).filter(Boolean) ?? [];
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
	if (shotPrompt) return shotPrompt;

	const parts = [
		normalizeText(shot?.source_title),
		normalizeText(shot?.caption),
		buildSceneImagePrompt(scene),
	].filter(Boolean);

	return truncate(parts.join(" - "), 220);
}
