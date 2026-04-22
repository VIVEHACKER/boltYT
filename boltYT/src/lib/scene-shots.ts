import type {
	SceneShot,
	SceneShotCrop,
	SceneShotMotion,
} from "./scene-shot-types";

type SceneType = "image" | "video" | "text_emphasis" | "news_overlay";
type SourceType = "image" | "video" | "article";
type IncidentPattern =
	| "missing_person"
	| "investigation"
	| "evidence"
	| "witness"
	| "pursuit"
	| "aftermath"
	| "timeline"
	| "profile"
	| "generic";

export interface ShotSource {
	type: SourceType;
	title: string;
	url?: string;
	thumbnail?: string;
	description?: string;
	bodyText?: string;
	publisher?: string;
	eventDate?: string;
	eventTitle?: string;
}

export interface ShotSceneInput {
	narration: string;
	type: SceneType;
	visualPrompt: string;
	duration: number;
	sourceIndex?: number;
	newsTitle?: string;
	newsSource?: string;
	newsExcerpt?: string;
	newsDate?: string;
	shots?: SceneShot[];
}

function toId(index: number, kind: string): string {
	return `${kind}-${index + 1}`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 80): string {
	return value.length <= max ? value : `${value.slice(0, max).trim()}...`;
}

function looksEnglish(value: string): boolean {
	return Array.from(value).every((char) => char.charCodeAt(0) <= 0x7f);
}

function sentenceLead(text: string): string {
	const first = normalizeText(text).split(/[.!?\n]/)[0] ?? "";
	return truncate(first, 68);
}

function minShotDurationForTotal(totalSeconds: number): number {
	if (totalSeconds <= 3.2) return 0.62;
	if (totalSeconds <= 5) return 0.72;
	if (totalSeconds <= 8) return 0.85;
	return 1;
}

function splitDuration(totalSeconds: number, shotCount: number): number[] {
	const total = Math.max(totalSeconds, 1.5);
	if (shotCount <= 1) return [Number(total.toFixed(2))];

	const base = total / shotCount;
	const minShotDuration = minShotDurationForTotal(total);
	const durations = Array.from({ length: shotCount }, (_, index) => {
		const weight =
			index === 0
				? 1.15
				: index === shotCount - 1
					? 0.9
					: 1 + (index % 2) * 0.08;
		return Math.max(minShotDuration, Number((base * weight).toFixed(2)));
	});

	const sum = durations.reduce((acc, value) => acc + value, 0);
	const diff = Number((total - sum).toFixed(2));
	durations[durations.length - 1] = Number(
		Math.max(minShotDuration, durations[durations.length - 1] + diff).toFixed(
			2,
		),
	);

	return durations;
}

function shotCountForScene(scene: ShotSceneInput): number {
	if (scene.type === "text_emphasis") return scene.duration <= 3.2 ? 2 : 3;
	if (scene.duration <= 2.6) return 2;
	if (scene.duration <= 4.5) return 3;
	if (scene.duration <= 7) return 4;
	if (scene.duration <= 10) return 5;
	return 5;
}

function hasKeyword(text: string, keywords: string[]): boolean {
	return keywords.some((keyword) => text.includes(keyword));
}

function inferIncidentPattern(
	scene: ShotSceneInput,
	primarySource?: ShotSource,
): IncidentPattern {
	const haystack = normalizeText(
		[
			scene.narration,
			scene.newsTitle,
			scene.newsExcerpt,
			scene.visualPrompt,
			scene.newsDate,
			primarySource?.eventTitle,
			primarySource?.description,
			primarySource?.bodyText,
			primarySource?.title,
		]
			.filter(Boolean)
			.join(" "),
	).toLowerCase();

	if (
		hasKeyword(haystack, [
			"증거",
			"cctv",
			"통화",
			"녹취",
			"녹음",
			"지문",
			"dna",
			"메모",
			"편지",
			"문서",
			"forensic",
			"evidence",
			"document",
			"record",
			"call log",
			"ransom note",
			"footage",
		])
	) {
		return "evidence";
	}
	if (
		hasKeyword(haystack, [
			"증언",
			"목격",
			"진술",
			"인터뷰",
			"자백",
			"witness",
			"statement",
			"interview",
			"confession",
			"testimony",
		])
	) {
		return "witness";
	}
	if (
		hasKeyword(haystack, [
			"실종",
			"유괴",
			"납치",
			"몸값",
			"kidnap",
			"abduction",
			"missing",
			"last seen",
			"ransom",
		])
	) {
		return "missing_person";
	}
	if (
		hasKeyword(haystack, [
			"추격",
			"수색",
			"검거",
			"체포",
			"도주",
			"manhunt",
			"pursuit",
			"chase",
			"raid",
			"search operation",
		])
	) {
		return "pursuit";
	}
	if (
		hasKeyword(haystack, [
			"수사",
			"추적",
			"탐문",
			"형사",
			"경찰",
			"investigation",
			"detective",
			"probe",
			"case board",
			"search",
		])
	) {
		return "investigation";
	}
	if (
		hasKeyword(haystack, [
			"추모",
			"장례",
			"여파",
			"비극",
			"상처",
			"기억",
			"aftermath",
			"memorial",
			"grief",
			"mourning",
			"unresolved",
		])
	) {
		return "aftermath";
	}
	if (
		hasKeyword(haystack, [
			"당일",
			"직후",
			"이후",
			"다음날",
			"며칠 뒤",
			"timeline",
			"sequence",
			"reconstruction",
			"before",
			"after",
		])
	) {
		return "timeline";
	}
	if (
		hasKeyword(haystack, [
			"피해자",
			"범인",
			"용의자",
			"아버지",
			"어머니",
			"가족",
			"victim",
			"suspect",
			"portrait",
			"profile",
			"family",
		])
	) {
		return "profile";
	}

	return "generic";
}

function kindsForScene(
	scene: ShotSceneInput,
	pattern: IncidentPattern,
	shotCount: number,
): SceneShot["kind"][] {
	const textKindsByPattern: Record<IncidentPattern, SceneShot["kind"][]> = {
		missing_person: ["punch", "detail", "punch"],
		investigation: ["punch", "detail", "quote"],
		evidence: ["context", "punch", "punch"],
		witness: ["quote", "punch", "punch"],
		pursuit: ["punch", "detail", "punch"],
		aftermath: ["punch", "quote", "punch"],
		timeline: ["context", "punch", "punch"],
		profile: ["quote", "punch", "punch"],
		generic: ["punch", "detail", "quote"],
	};
	const imageKindsByPattern: Record<IncidentPattern, SceneShot["kind"][]> = {
		missing_person: ["establishing", "context", "detail", "evidence", "punch"],
		investigation: ["context", "detail", "evidence", "detail", "punch"],
		evidence: ["context", "evidence", "detail", "quote", "punch"],
		witness: ["context", "quote", "detail", "evidence", "punch"],
		pursuit: ["establishing", "detail", "context", "evidence", "punch"],
		aftermath: ["establishing", "context", "detail", "quote", "punch"],
		timeline: ["context", "establishing", "detail", "evidence", "punch"],
		profile: ["establishing", "detail", "quote", "context", "punch"],
		generic: ["establishing", "detail", "evidence", "quote", "punch"],
	};
	const videoKindsByPattern: Record<IncidentPattern, SceneShot["kind"][]> = {
		missing_person: ["establishing", "context", "detail", "evidence", "punch"],
		investigation: ["context", "detail", "evidence", "detail", "punch"],
		evidence: ["context", "evidence", "detail", "quote", "punch"],
		witness: ["context", "detail", "quote", "evidence", "punch"],
		pursuit: ["establishing", "detail", "detail", "context", "punch"],
		aftermath: ["establishing", "context", "detail", "quote", "punch"],
		timeline: ["context", "establishing", "detail", "evidence", "punch"],
		profile: ["establishing", "detail", "quote", "context", "punch"],
		generic: ["establishing", "detail", "context", "evidence", "punch"],
	};

	const base =
		scene.type === "text_emphasis"
			? textKindsByPattern[pattern]
			: scene.type === "video"
				? videoKindsByPattern[pattern]
				: imageKindsByPattern[pattern];

	return base.slice(0, shotCount);
}

function cropForKind(
	kind: SceneShot["kind"],
	pattern: IncidentPattern,
	index: number,
): SceneShotCrop {
	if (kind === "establishing") {
		return pattern === "profile" ? "medium" : "wide";
	}
	if (kind === "context") return index === 0 ? "wide" : "medium";
	if (kind === "detail") return pattern === "profile" ? "close" : "detail";
	if (kind === "evidence") return "detail";
	if (kind === "quote") return pattern === "aftermath" ? "medium" : "close";
	if (kind === "punch") {
		return pattern === "timeline" ? "medium" : "close";
	}
	return "medium";
}

function motionForKind(
	kind: SceneShot["kind"],
	index: number,
	pattern: IncidentPattern,
): SceneShotMotion {
	if (pattern === "aftermath") {
		if (kind === "punch") return "slow_zoom_in";
		if (kind === "quote") return "slow_zoom_out";
		return index % 2 === 0 ? "slow_zoom_in" : "drift";
	}
	if (pattern === "pursuit") {
		if (kind === "punch") return "push_in";
		if (kind === "evidence") return "pan_right";
		return index % 2 === 0 ? "pan_left" : "pan_right";
	}
	if (pattern === "evidence" || pattern === "investigation") {
		if (kind === "punch") return "push_in";
		if (kind === "evidence") return "push_in";
		if (kind === "quote") return "slow_zoom_out";
		return index % 2 === 0 ? "pan_left" : "drift";
	}
	if (pattern === "witness" || pattern === "profile") {
		if (kind === "quote") return "slow_zoom_out";
		if (kind === "punch") return "push_in";
		return index % 2 === 0 ? "slow_zoom_in" : "drift";
	}
	if (kind === "punch") return "push_in";
	if (kind === "detail") return index % 2 === 0 ? "slow_zoom_in" : "drift";
	if (kind === "evidence") return "pan_right";
	if (kind === "quote") return "slow_zoom_out";
	return index % 2 === 0 ? "pan_left" : "slow_zoom_in";
}

function promptSuffixForPattern(pattern: IncidentPattern): string {
	switch (pattern) {
		case "missing_person":
			return "missing-person case, last-seen atmosphere, documentary tension";
		case "investigation":
			return "active police investigation, detectives, search operation";
		case "evidence":
			return "forensic evidence, documents, call records, clue-focused framing";
		case "witness":
			return "witness statement tension, interview-like emotion, human focus";
		case "pursuit":
			return "urgent search operation, patrol lights, movement and pursuit";
		case "aftermath":
			return "aftermath of tragedy, memorial tone, unresolved grief";
		case "timeline":
			return "chronological reconstruction, time and place markers";
		case "profile":
			return "person-focused documentary portrait, identity and relationship cues";
		default:
			return "investigative documentary framing, factual cinematic tone";
	}
}

function normalizeCompareText(value?: string): string {
	return normalizeText(value).toLowerCase();
}

function overlapsSceneMoment(
	scene: ShotSceneInput,
	source?: ShotSource,
): boolean {
	if (!source) return false;
	const sceneDate = normalizeCompareText(scene.newsDate);
	const sourceDate = normalizeCompareText(source.eventDate);
	if (sceneDate && sourceDate && sceneDate === sourceDate) return true;

	const sceneTitle = normalizeCompareText(scene.newsTitle);
	const sourceTitle = normalizeCompareText(source.eventTitle || source.title);
	if (!sceneTitle || !sourceTitle) return false;
	return (
		sceneTitle.includes(sourceTitle) ||
		sourceTitle.includes(sceneTitle) ||
		sceneTitle
			.split(/\s+/)
			.filter(Boolean)
			.some((token) => token.length > 1 && sourceTitle.includes(token))
	);
}

function promptSuffixForKind(kind: SceneShot["kind"]): string {
	switch (kind) {
		case "establishing":
			return "wide establishing frame, location and atmosphere clearly visible";
		case "context":
			return "context frame with timeline cues, documents, surroundings";
		case "detail":
			return "closer observational detail, object texture, intimate framing";
		case "evidence":
			return "evidence insert shot, key clue or official record in focus";
		case "quote":
			return "human reaction or testimony emphasis, intimate emotional framing";
		case "punch":
			return "dramatic reveal frame, single focal point, strong emphasis";
		default:
			return "documentary still frame";
	}
}

function buildShotVisualPrompt(
	scene: ShotSceneInput,
	kind: SceneShot["kind"],
	pattern: IncidentPattern,
	source?: ShotSource,
): string {
	const basePrompt = normalizeText(scene.visualPrompt);
	const promptParts = [
		looksEnglish(basePrompt) ? basePrompt : "",
		promptSuffixForKind(kind),
		promptSuffixForPattern(pattern),
		source?.type === "article" && (kind === "context" || kind === "evidence")
			? "archival newspaper texture, document close-up"
			: "",
	]
		.filter(Boolean)
		.join(", ");

	if (promptParts) return truncate(promptParts, 220);

	return truncate(
		[
			promptSuffixForKind(kind),
			promptSuffixForPattern(pattern),
			"cinematic true-crime visual",
		].join(", "),
		220,
	);
}

function shotCaption(
	scene: ShotSceneInput,
	source: ShotSource | undefined,
	kind: SceneShot["kind"],
	pattern: IncidentPattern,
): string {
	const eventTitle = normalizeText(
		scene.newsTitle || source?.eventTitle || source?.title,
	);
	const excerpt = normalizeText(
		scene.newsExcerpt || source?.description || source?.bodyText,
	);
	const date = normalizeText(scene.newsDate || source?.eventDate);

	switch (kind) {
		case "establishing":
			return eventTitle || sentenceLead(scene.narration);
		case "context":
			return (
				[date, eventTitle].filter(Boolean).join(" · ") ||
				sentenceLead(scene.narration)
			);
		case "detail":
			return excerpt ? sentenceLead(excerpt) : sentenceLead(scene.narration);
		case "evidence":
			return (
				excerpt ||
				(pattern === "evidence" ? eventTitle : "") ||
				eventTitle ||
				sentenceLead(scene.narration)
			);
		case "quote":
			return excerpt || sentenceLead(scene.narration);
		case "punch":
			return eventTitle || sentenceLead(scene.narration);
		default:
			return sentenceLead(scene.narration);
	}
}

function isDirectImageUrl(url?: string): boolean {
	return Boolean(
		url &&
			/^https?:\/\//.test(url) &&
			/\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(url),
	);
}

function resolveVisualUrl(source?: ShotSource): string | undefined {
	if (!source) return undefined;
	if (isDirectImageUrl(source.url)) return source.url;
	if (isDirectImageUrl(source.thumbnail)) return source.thumbnail;
	return undefined;
}

export function isSourceCompatible(
	sceneType: SceneType,
	sourceType: SourceType,
): boolean {
	if (sceneType === "video") return sourceType === "video";
	if (sceneType === "text_emphasis") return sourceType !== "video";
	return (
		sourceType === "image" || sourceType === "article" || sourceType === "video"
	);
}

function pickCompatibleSources(
	scene: ShotSceneInput,
	sources: ShotSource[],
): Array<{ index: number; source: ShotSource }> {
	return sources
		.map((source, index) => ({ index, source }))
		.filter(({ source }) => isSourceCompatible(scene.type, source.type));
}

function normalizeShotDurations(
	shots: SceneShot[],
	totalSeconds: number,
): SceneShot[] {
	if (shots.length === 0) return shots;

	const desired = Math.max(totalSeconds, 1.5);
	const sum = shots.reduce((acc, shot) => acc + shot.duration_seconds, 0);
	if (sum <= 0) return shots;
	const minShotDuration = minShotDurationForTotal(desired);

	const scale = desired / sum;
	const scaled = shots.map((shot) => ({
		...shot,
		duration_seconds: Number(
			Math.max(minShotDuration, shot.duration_seconds * scale).toFixed(2),
		),
	}));

	const scaledSum = scaled.reduce(
		(acc, shot) => acc + shot.duration_seconds,
		0,
	);
	scaled[scaled.length - 1] = {
		...scaled[scaled.length - 1],
		duration_seconds: Number(
			Math.max(
				minShotDuration,
				scaled[scaled.length - 1].duration_seconds + (desired - scaledSum),
			).toFixed(2),
		),
	};

	return scaled;
}

function makeShot(
	index: number,
	kind: SceneShot["kind"],
	duration: number,
	scene: ShotSceneInput,
	pattern: IncidentPattern,
	source?: { index: number; source: ShotSource },
): SceneShot {
	const mediaType =
		scene.type === "video"
			? "video"
			: mediaTypeForImageLikeShot(kind, source?.source);
	const sourceUrl =
		mediaType === "image"
			? resolveVisualUrl(source?.source)
			: source?.source.url;
	return {
		id: toId(index, kind),
		kind,
		duration_seconds: duration,
		media_type: mediaType,
		source_index: source?.index,
		source_url: sourceUrl,
		source_title: source?.source.eventTitle || source?.source.title,
		visual_prompt: buildShotVisualPrompt(scene, kind, pattern, source?.source),
		caption: shotCaption(scene, source?.source, kind, pattern),
		motion: motionForKind(kind, index, pattern),
		crop: cropForKind(kind, pattern, index),
		overlay:
			kind === "evidence"
				? "evidence"
				: kind === "quote"
					? "quote"
					: kind === "context"
						? "context"
						: kind === "punch"
							? "headline"
							: "none",
	};
}

function pickPrimarySource(
	scene: ShotSceneInput,
	compatible: Array<{ index: number; source: ShotSource }>,
): { index: number; source: ShotSource } | undefined {
	if (typeof scene.sourceIndex === "number" && scene.sourceIndex >= 0) {
		const assigned = compatible.find(
			({ index }) => index === scene.sourceIndex,
		);
		if (assigned) return assigned;
	}

	if (scene.type === "video") {
		return compatible.find(({ source }) => source.type === "video");
	}
	if (scene.type === "news_overlay") {
		return compatible.find(({ source }) => source.type === "article");
	}
	if (scene.type === "image") {
		return (
			compatible.find(({ source }) => source.type === "image") ??
			compatible.find(({ source }) => source.type === "article")
		);
	}
	return compatible[0];
}

function pickSourceForShot(
	kind: SceneShot["kind"],
	index: number,
	primary: { index: number; source: ShotSource } | undefined,
	alternates: Array<{ index: number; source: ShotSource }>,
): { index: number; source: ShotSource } | undefined {
	const candidates = [primary, ...alternates].filter(Boolean) as Array<{
		index: number;
		source: ShotSource;
	}>;
	const article = candidates.find(({ source }) => source.type === "article");
	const image = candidates.find(({ source }) => source.type === "image");
	const video = candidates.find(({ source }) => source.type === "video");

	if (kind === "evidence" || kind === "quote") {
		return article ?? image ?? primary ?? video ?? alternates[index - 1];
	}
	if (kind === "context") {
		return article ?? image ?? primary ?? video ?? alternates[index - 1];
	}
	if (kind === "establishing") return video ?? image ?? primary ?? article;
	if (kind === "detail") return video ?? image ?? primary ?? article;
	if (kind === "punch") return video ?? image ?? primary ?? article;

	return alternates[index - 1] ?? primary ?? video ?? article ?? image;
}

function mediaTypeForImageLikeShot(
	kind: SceneShot["kind"],
	source?: ShotSource,
): "image" | "video" {
	if (source?.type !== "video") return "image";
	if (kind === "context" || kind === "evidence" || kind === "quote") {
		return "image";
	}
	return "video";
}

function pickSupportSourceForVideoShot(
	kind: SceneShot["kind"],
	scene: ShotSceneInput,
	primary: { index: number; source: ShotSource } | undefined,
	supportSources: Array<{ index: number; source: ShotSource }>,
	index: number,
): { index: number; source: ShotSource } | undefined {
	const matchingSupport = supportSources.filter(({ source }) =>
		overlapsSceneMoment(scene, source),
	);
	const ordered = matchingSupport.length > 0 ? matchingSupport : supportSources;
	const article = ordered.find(({ source }) => source.type === "article");
	const image = ordered.find(({ source }) => source.type === "image");

	if (kind === "establishing" || kind === "detail") {
		return primary ?? image ?? article ?? ordered[index - 1];
	}
	if (kind === "evidence") return image ?? article ?? primary;
	if (kind === "quote") return article ?? image ?? primary;
	if (kind === "context") return article ?? image ?? primary;
	if (kind === "punch" && scene.newsTitle) return primary ?? article ?? image;
	return ordered[index - 1] ?? primary ?? article ?? image;
}

function mediaTypeForVideoShot(
	kind: SceneShot["kind"],
	pattern: IncidentPattern,
	source?: ShotSource,
): "image" | "video" {
	if (source?.type === "video") return "video";
	if (source?.type === "image" || source?.type === "article") return "image";
	if (kind === "evidence" || kind === "quote") return "image";
	if (kind === "context" && pattern !== "pursuit") return "image";
	return "video";
}

function buildImageLikeShots(
	scene: ShotSceneInput,
	sources: ShotSource[],
): SceneShot[] {
	const compatible = pickCompatibleSources(scene, sources);
	const primary = pickPrimarySource(scene, compatible);
	const alternates = compatible.filter(({ index }) => index !== primary?.index);
	const pattern = inferIncidentPattern(scene, primary?.source);
	const shotCount = shotCountForScene(scene);
	const durations = splitDuration(scene.duration, shotCount);
	const kinds = kindsForScene(scene, pattern, shotCount);
	const trims = Array.from({ length: shotCount }, (_, index) => {
		const start = clamp(index * 0.16, 0, 0.76);
		const end = clamp(start + 0.32, start + 0.14, 0.98);
		return { start, end };
	});

	return normalizeShotDurations(
		durations.map((duration, index) => {
			const kind = kinds[index] ?? kinds[kinds.length - 1];
			const source = pickSourceForShot(kind, index, primary, alternates);
			const shot = makeShot(index, kind, duration, scene, pattern, source);
			if (shot.media_type !== "video") return shot;
			return {
				...shot,
				trim_start: trims[index].start,
				trim_end: trims[index].end,
				overlay:
					kind === "punch" && scene.newsTitle
						? "headline"
						: kind === "context"
							? "context"
							: "none",
			};
		}),
		scene.duration,
	);
}

function buildVideoShots(
	scene: ShotSceneInput,
	sources: ShotSource[],
): SceneShot[] {
	const compatible = pickCompatibleSources(scene, sources);
	const primary = pickPrimarySource(scene, compatible);
	const supportSources = sources
		.map((source, index) => ({ index, source }))
		.filter(
			({ index, source }) =>
				index !== primary?.index && source.type !== "video",
		);
	const pattern = inferIncidentPattern(scene, primary?.source);
	const shotCount = shotCountForScene(scene);
	const durations = splitDuration(scene.duration, shotCount);
	const trims = Array.from({ length: shotCount }, (_, index) => {
		const start = clamp(index * 0.18, 0, 0.78);
		const end = clamp(start + 0.34, start + 0.12, 0.98);
		return { start, end };
	});
	const kinds = kindsForScene(scene, pattern, shotCount);

	return normalizeShotDurations(
		durations.map((duration, index) => {
			const kind = kinds[index] ?? "detail";
			const source = pickSupportSourceForVideoShot(
				kind,
				scene,
				primary,
				supportSources,
				index,
			);
			const mediaType = mediaTypeForVideoShot(kind, pattern, source?.source);
			return {
				...makeShot(index, kind, duration, scene, pattern, source),
				media_type: mediaType,
				motion: motionForKind(kind, index, pattern),
				crop: cropForKind(kind, pattern, index),
				overlay:
					kind === "punch" && scene.newsTitle
						? "headline"
						: kind === "evidence"
							? "evidence"
							: kind === "quote"
								? "quote"
								: kind === "context"
									? "context"
									: "none",
				trim_start: mediaType === "video" ? trims[index].start : undefined,
				trim_end: mediaType === "video" ? trims[index].end : undefined,
				source_url:
					mediaType === "image" ? resolveVisualUrl(source?.source) : undefined,
			};
		}),
		scene.duration,
	);
}

export function buildSceneShots(
	scene: ShotSceneInput,
	sources: ShotSource[],
): SceneShot[] {
	if (scene.type === "video") return buildVideoShots(scene, sources);
	return buildImageLikeShots(scene, sources);
}

export function ensureSceneShots(
	scene: ShotSceneInput,
	sources: ShotSource[],
): SceneShot[] {
	if (!Array.isArray(scene.shots) || scene.shots.length === 0) {
		return buildSceneShots(scene, sources);
	}

	const compatible = pickCompatibleSources(scene, sources);
	const primary = pickPrimarySource(scene, compatible);
	const pattern = inferIncidentPattern(scene, primary?.source);

	return normalizeShotDurations(
		scene.shots.map((shot, index) => ({
			...shot,
			id: shot.id || toId(index, shot.kind || "detail"),
			duration_seconds: Number(
				Math.max(0.8, shot.duration_seconds || 0).toFixed(2),
			),
			visual_prompt:
				shot.visual_prompt ||
				buildShotVisualPrompt(
					scene,
					shot.kind || "detail",
					pattern,
					primary?.source,
				),
			crop: shot.crop ?? cropForKind(shot.kind || "detail", pattern, index),
			motion:
				shot.motion ?? motionForKind(shot.kind || "detail", index, pattern),
			overlay: shot.overlay ?? "none",
		})),
		scene.duration,
	);
}

export function syncSceneMetadataFromSource<T extends ShotSceneInput>(
	scene: T,
	source?: ShotSource,
): T {
	return {
		...scene,
		newsTitle: source?.eventTitle || source?.title || "",
		newsSource: source?.publisher || "",
		newsDate: source?.eventDate || "",
		newsExcerpt: source?.description || source?.bodyText || "",
	};
}

function sceneMotionScore(scene: ShotSceneInput): number {
	const haystack = normalizeText(
		[
			scene.narration,
			scene.visualPrompt,
			scene.newsTitle,
			scene.newsExcerpt,
			scene.newsDate,
		]
			.filter(Boolean)
			.join(" "),
	).toLowerCase();

	let score = 0;
	if (scene.type === "video") score += 1000;
	if (scene.duration <= 5) score += 40;
	if (
		hasKeyword(haystack, [
			"영상",
			"cctv",
			"공개",
			"현장",
			"수색",
			"추격",
			"도주",
			"체포",
			"재구성",
			"조사",
			"footage",
			"camera",
			"surveillance",
			"investigation",
			"search",
			"raid",
			"chase",
			"reconstruction",
		])
	) {
		score += 140;
	}
	if (
		hasKeyword(haystack, [
			"증거",
			"편지",
			"메모",
			"지문",
			"dna",
			"녹취",
			"통화",
			"document",
			"record",
			"forensic",
			"evidence",
		])
	) {
		score -= 45;
	}
	return score;
}

function sceneShockScore(scene: ShotSceneInput): number {
	const haystack = normalizeText(
		[scene.narration, scene.newsTitle, scene.newsExcerpt, scene.visualPrompt]
			.filter(Boolean)
			.join(" "),
	).toLowerCase();

	let score = 0;
	if (
		hasKeyword(haystack, [
			"충격",
			"반전",
			"경악",
			"끔찍",
			"소름",
			"의외",
			"미제",
			"실종",
			"살인",
			"범인",
			"mystery",
			"shock",
			"killer",
			"missing",
			"unresolved",
			"secret",
		])
	) {
		score += 120;
	}
	if (
		hasKeyword(haystack, [
			"결국",
			"그런데",
			"하지만",
			"그리고",
			"마지막",
			"finally",
			"however",
			"then",
		])
	) {
		score += 30;
	}
	if (scene.type === "text_emphasis") score += 300;
	if ((scene.narration.match(/[?!]/g) ?? []).length > 0) score += 20;
	return score;
}

function pickBestVideoSourceIndex(
	scene: ShotSceneInput,
	sources: ShotSource[],
): number {
	const videoSources = sources
		.map((source, index) => ({ index, source }))
		.filter(({ source }) => source.type === "video");
	if (videoSources.length === 0) return -1;

	if (
		typeof scene.sourceIndex === "number" &&
		scene.sourceIndex >= 0 &&
		sources[scene.sourceIndex]?.type === "video"
	) {
		return scene.sourceIndex;
	}

	const exact = videoSources.find(({ source }) =>
		overlapsSceneMoment(scene, source),
	);
	if (exact) return exact.index;

	return videoSources[0]?.index ?? -1;
}

function buildHookCandidates<T extends ShotSceneInput>(scenes: T[]) {
	let cursor = 0;
	const hookWindowSeconds = 10;

	return scenes
		.map((scene, index) => {
			const start = cursor;
			cursor += Math.max(0, scene.duration);
			return {
				scene,
				index,
				start,
				duration: Math.max(0, scene.duration),
			};
		})
		.filter(
			({ scene, start }) =>
				start < hookWindowSeconds &&
				scene.type !== "text_emphasis" &&
				scene.type !== "news_overlay",
		);
}

function buildSceneStartOffsets<T extends ShotSceneInput>(scenes: T[]) {
	let cursor = 0;
	return scenes.map((scene) => {
		const start = cursor;
		cursor += Math.max(0, scene.duration);
		return start;
	});
}

function injectShortsPatternInterrupts<
	T extends ShotSceneInput & {
		transition?: string;
		mood?: string;
		textEffect?: string;
	},
>(scenes: T[]): T[] {
	if (scenes.length < 4) return scenes;

	const starts = buildSceneStartOffsets(scenes);
	const totalDuration = scenes.reduce(
		(sum, scene) => sum + Math.max(0, scene.duration),
		0,
	);
	const desiredInterrupts = scenes.length >= 8 ? 2 : 1;
	const existingInterrupts = scenes.filter(
		(scene) => scene.type === "text_emphasis",
	).length;
	if (existingInterrupts >= desiredInterrupts) return scenes;

	const targetWindows =
		desiredInterrupts === 1
			? [totalDuration * 0.55]
			: [totalDuration * 0.38, totalDuration * 0.72];
	const chosen = new Set<number>();

	for (const target of targetWindows) {
		if (chosen.size + existingInterrupts >= desiredInterrupts) break;
		const ranked = scenes
			.map((scene, index) => ({
				scene,
				index,
				start: starts[index],
				score:
					sceneShockScore(scene) -
					Math.abs(starts[index] - target) * 8 -
					(index === 0 || index === scenes.length - 1 ? 500 : 0) -
					(scene.type === "news_overlay" ? 500 : 0),
			}))
			.filter(
				({ scene, index }) =>
					scene.type !== "text_emphasis" &&
					scene.type !== "news_overlay" &&
					!chosen.has(index),
			)
			.sort((a, b) => b.score - a.score);
		const winner = ranked[0];
		if (winner && winner.score > -100) {
			chosen.add(winner.index);
		}
	}

	if (chosen.size === 0) return scenes;

	return scenes.map((scene, index) => {
		if (!chosen.has(index)) return scene;
		return {
			...scene,
			type: "text_emphasis",
			sourceIndex: -1,
			duration: Number(Math.min(scene.duration, 2.2).toFixed(2)),
			transition: "glitch",
			textEffect:
				scene.textEffect && scene.textEffect !== "none"
					? scene.textEffect
					: "glitch",
			mood: scene.mood && scene.mood !== "neutral" ? scene.mood : "mystery",
		};
	});
}

function isHardTransition(transition?: string) {
	return (
		transition === "none" ||
		transition === "whip_left" ||
		transition === "whip_right" ||
		transition === "glitch"
	);
}

function preferredShortsTransition(
	index: number,
	sceneType: SceneType,
	prevType?: SceneType,
): string {
	if (index <= 1) return "none";
	if (sceneType === "text_emphasis") return "glitch";
	// text_emphasis 이후: hard cut으로 바로 돌아옴
	if (prevType === "text_emphasis") return "none";
	// image → video 전환: whip으로 긴장감 유지
	if (prevType === "image" && sceneType === "video") {
		return index % 2 === 0 ? "whip_right" : "whip_left";
	}
	// video → image 전환: whip 또는 드물게 zoom
	if (prevType === "video" && sceneType === "image") {
		return index % 5 === 0
			? "zoom"
			: index % 2 === 0
				? "whip_left"
				: "whip_right";
	}
	// 일반: crossfade 남용 제거, hard 위주
	if (index % 7 === 0) return "zoom"; // 드물게 zoom
	if (index % 3 === 0) return "none";
	return index % 2 === 0 ? "whip_right" : "whip_left";
}

export function rebalanceScenesForMotion<T extends ShotSceneInput>(
	scenes: T[],
	sources: ShotSource[],
): T[] {
	if (scenes.length === 0) return scenes;

	const candidateIndexes = scenes
		.map((scene, index) => ({ scene, index }))
		.filter(
			({ scene }) =>
				scene.type !== "text_emphasis" && scene.type !== "news_overlay",
		);
	if (candidateIndexes.length === 0) return scenes;

	const desiredVideoCount = Math.max(
		candidateIndexes.some(({ scene }) => scene.duration <= 5) ? 2 : 1,
		Math.ceil(
			candidateIndexes.length *
				(sources.some((s) => s.type === "video") ? 0.65 : 0.45),
		),
	);

	const ranked = candidateIndexes
		.map(({ scene, index }) => ({
			index,
			score:
				sceneMotionScore(scene) +
				(pickBestVideoSourceIndex(scene, sources) >= 0 ? 70 : 15),
		}))
		.sort((a, b) => b.score - a.score);

	const targetIndexes = new Set(
		ranked
			.slice(0, Math.min(desiredVideoCount, ranked.length))
			.map((item) => item.index),
	);

	const hookCandidates = buildHookCandidates(scenes);
	const hookTargetDuration =
		hookCandidates.reduce((sum, item) => sum + item.duration, 0) * 0.8;
	let hookVideoDuration = hookCandidates.reduce((sum, item) => {
		const selected =
			item.scene.type === "video" || targetIndexes.has(item.index);
		return sum + (selected ? item.duration : 0);
	}, 0);

	if (hookVideoDuration < hookTargetDuration) {
		const rankedHook = hookCandidates
			.map((item) => ({
				...item,
				score:
					sceneMotionScore(item.scene) +
					(item.start < 5 ? 160 : 90) +
					(pickBestVideoSourceIndex(item.scene, sources) >= 0 ? 80 : 25),
			}))
			.sort((a, b) => b.score - a.score);

		for (const item of rankedHook) {
			if (hookVideoDuration >= hookTargetDuration) break;
			if (targetIndexes.has(item.index) || item.scene.type === "video")
				continue;
			targetIndexes.add(item.index);
			hookVideoDuration += item.duration;
		}
	}

	return scenes.map((scene, index) => {
		if (!targetIndexes.has(index)) return scene;
		if (scene.type === "text_emphasis" || scene.type === "news_overlay") {
			return scene;
		}
		const videoSourceIndex = pickBestVideoSourceIndex(scene, sources);
		return {
			...scene,
			type: "video",
			sourceIndex: videoSourceIndex,
		};
	});
}

export function applyShortsVideoRules<
	T extends ShotSceneInput & {
		transition?: string;
		mood?: string;
		textEffect?: string;
	},
>(scenes: T[], sources: ShotSource[]): T[] {
	if (scenes.length === 0) return scenes;

	let elapsed = 0;
	const paced = scenes.map((scene, index) => {
		const start = elapsed;
		const isLast = index === scenes.length - 1;
		let minDuration = start < 10 ? 1.4 : 1.8;
		let maxDuration = start < 3 ? 2.4 : start < 10 ? 2.8 : 4.2;

		if (scene.type === "text_emphasis") {
			minDuration = 1.1;
			maxDuration = isLast ? 2.4 : 2.2;
		}
		if (scene.type === "news_overlay") {
			maxDuration = Math.min(maxDuration, 3.2);
		}
		if (isLast && scene.type !== "text_emphasis") {
			maxDuration = Math.min(maxDuration, 2.8);
		}

		const duration = Number(
			clamp(scene.duration, minDuration, maxDuration).toFixed(2),
		);
		elapsed += duration;
		return { ...scene, duration };
	});

	let adjusted = paced;
	if (sources.some((source) => source.type === "video")) {
		const starts = buildSceneStartOffsets(adjusted);
		const candidates = adjusted
			.map((scene, index) => ({ scene, index, start: starts[index] }))
			.filter(
				({ scene }) =>
					scene.type !== "text_emphasis" && scene.type !== "news_overlay",
			);

		const desiredVideoCount = Math.max(
			Math.ceil(candidates.length * 0.75),
			candidates.some(({ start }) => start < 10) ? 2 : 1,
		);
		const selected = new Set(
			candidates
				.filter(({ scene }) => scene.type === "video")
				.map(({ index }) => index),
		);
		if (selected.size < desiredVideoCount) {
			const ranked = candidates
				.filter(({ index }) => !selected.has(index))
				.map(({ scene, index, start }) => ({
					index,
					score:
						sceneMotionScore(scene) +
						(start < 10 ? 180 : 60) +
						(pickBestVideoSourceIndex(scene, sources) >= 0 ? 90 : 20),
				}))
				.sort((a, b) => b.score - a.score);

			for (const item of ranked) {
				if (selected.size >= desiredVideoCount) break;
				selected.add(item.index);
			}

			adjusted = adjusted.map((scene, index) => {
				if (!selected.has(index)) return scene;
				if (scene.type === "text_emphasis" || scene.type === "news_overlay") {
					return scene;
				}
				return {
					...scene,
					type: "video",
					sourceIndex: pickBestVideoSourceIndex(scene, sources),
				};
			});
		}
	}

	const starts = buildSceneStartOffsets(adjusted);
	let lastInterruptStart = -100;
	let withInterrupts = adjusted.map((scene, index) => {
		const start = starts[index];
		const isLast = index === adjusted.length - 1;
		const prevType = index > 0 ? adjusted[index - 1].type : undefined;
		const shouldInterrupt =
			index > 1 &&
			!isLast &&
			start >= 5 &&
			start - lastInterruptStart >= 6.5 &&
			scene.type !== "news_overlay";

		if (!shouldInterrupt) {
			if (isLast) {
				return {
					...scene,
					duration: Number(
						Math.min(
							scene.duration,
							scene.type === "text_emphasis" ? 2.2 : 2.8,
						).toFixed(2),
					),
					transition:
						scene.transition && scene.transition !== "crossfade"
							? scene.transition
							: preferredShortsTransition(index, scene.type, prevType),
					textEffect:
						scene.type === "text_emphasis" &&
						(!scene.textEffect || scene.textEffect === "none")
							? "scale_in"
							: scene.textEffect,
				};
			}
			return scene;
		}

		lastInterruptStart = start;
		return {
			...scene,
			transition: preferredShortsTransition(index, scene.type, prevType),
			mood: scene.mood && scene.mood !== "neutral" ? scene.mood : "mystery",
			textEffect:
				scene.type === "text_emphasis" &&
				(!scene.textEffect || scene.textEffect === "none")
					? "glitch"
					: scene.textEffect,
			duration: Number(
				Math.min(
					scene.duration,
					scene.type === "text_emphasis" ? 2.2 : 3.4,
				).toFixed(2),
			),
		};
	});

	const transitionIndexes = withInterrupts
		.map((scene, index) => ({ scene, index }))
		.filter(({ index, scene }) => index > 0 && scene.type !== "news_overlay");
	const currentHardCount = transitionIndexes.filter(({ scene }) =>
		isHardTransition(scene.transition),
	).length;
	const desiredHardCount = Math.ceil(transitionIndexes.length * 0.7);

	if (currentHardCount < desiredHardCount) {
		const startsForHardening = buildSceneStartOffsets(withInterrupts);
		const toHarden = transitionIndexes
			.filter(({ scene }) => !isHardTransition(scene.transition))
			.map(({ scene, index }) => ({
				index,
				score:
					(startsForHardening[index] < 10 ? 200 : 80) +
					(scene.type === "text_emphasis" ? 120 : 0) +
					(scene.type === "video" ? 30 : 0) -
					scene.duration * 3,
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, desiredHardCount - currentHardCount);

		const hardIndexes = new Set(toHarden.map((item) => item.index));
		withInterrupts = withInterrupts.map((scene, index) =>
			hardIndexes.has(index)
				? {
						...scene,
						transition: preferredShortsTransition(
							index,
							scene.type,
							withInterrupts[index - 1]?.type,
						),
						textEffect:
							scene.type === "text_emphasis" &&
							(!scene.textEffect || scene.textEffect === "none")
								? "glitch"
								: scene.textEffect,
					}
				: scene,
		);
	}

	return injectShortsPatternInterrupts(withInterrupts);
}

export function intensifyHookScenes<
	T extends ShotSceneInput & {
		transition?: string;
		mood?: string;
		textEffect?: string;
	},
>(scenes: T[]): T[] {
	let elapsed = 0;

	return scenes.map((scene, index) => {
		const inHook = elapsed < 10;
		elapsed += Math.max(0, scene.duration);
		if (!inHook) return scene;

		if (scene.type === "text_emphasis") {
			return {
				...scene,
				transition: index === 0 ? "none" : "glitch",
				textEffect:
					scene.textEffect && scene.textEffect !== "none"
						? scene.textEffect
						: "glitch",
				mood: scene.mood && scene.mood !== "neutral" ? scene.mood : "mystery",
			};
		}

		if (scene.type === "news_overlay") return scene;

		return {
			...scene,
			transition:
				index === 0
					? "none"
					: index === 1
						? "none"
						: index % 2 === 0
							? "whip_right"
							: "whip_left",
			mood: scene.mood && scene.mood !== "neutral" ? scene.mood : "mystery",
		};
	});
}
