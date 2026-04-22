export interface SequenceScene {
	narration: string;
	type: "image" | "video" | "text_emphasis" | "news_overlay";
	visualPrompt: string;
	sourceIndex?: number;
	newsTitle?: string;
	newsSource?: string;
	newsDate?: string;
}

export interface SequenceSource {
	type: "image" | "video" | "article";
	title: string;
	description?: string;
	bodyText?: string;
	pubDate?: string;
	publisher?: string;
	eventDate?: string;
	eventTitle?: string;
}

export interface SceneSourceAssignment {
	index: number;
	source_index: number;
	event_title?: string;
	event_date?: string;
}

export interface SceneSourceAssignmentPlan {
	scenes: SceneSourceAssignment[];
}

function typeMatches(
	scene: Pick<SequenceScene, "type">,
	source: Pick<SequenceSource, "type">,
): boolean {
	if (scene.type === "video") return source.type === "video";
	if (scene.type === "text_emphasis") return false;
	return source.type === "image" || source.type === "article";
}

function sourceToEventTitle(source?: SequenceSource): string {
	return source?.eventTitle?.trim() || source?.title?.trim() || "";
}

function sourceToEventDate(source?: SequenceSource): string {
	return source?.eventDate?.trim() || "";
}

function normalizeSourceIndex(value: number, sourcesLength: number): number {
	if (!Number.isInteger(value) || value < 0 || value >= sourcesLength) {
		return -1;
	}

	return value;
}

function trimOrEmpty(value?: string): string {
	return value?.trim() || "";
}

function findFallbackSourceIndex(
	scene: Pick<SequenceScene, "type">,
	sources: SequenceSource[],
	used: Set<number>,
	lastAssignedIndex: number,
): number {
	const matchingIndices = sources.flatMap((source, index) =>
		typeMatches(scene, source) ? [index] : [],
	);

	if (matchingIndices.length === 0) return -1;

	const forwardUnused = matchingIndices.find(
		(index) => index >= Math.max(lastAssignedIndex, 0) && !used.has(index),
	);
	if (typeof forwardUnused === "number") return forwardUnused;

	const anyUnused = matchingIndices.find((index) => !used.has(index));
	if (typeof anyUnused === "number") return anyUnused;

	const reusableForward = matchingIndices.find(
		(index) => index >= Math.max(lastAssignedIndex, 0),
	);
	if (typeof reusableForward === "number") return reusableForward;

	return matchingIndices[matchingIndices.length - 1];
}

export function buildFallbackSceneSourcePlan(
	scenes: SequenceScene[],
	sources: SequenceSource[],
): SceneSourceAssignmentPlan {
	const used = new Set<number>();
	const plan: SceneSourceAssignment[] = [];
	let lastAssignedIndex = -1;

	for (let i = 0; i < scenes.length; i++) {
		const scene = scenes[i];
		const existingIndex =
			typeof scene.sourceIndex === "number"
				? normalizeSourceIndex(scene.sourceIndex, sources.length)
				: -1;
		const existingSource =
			existingIndex >= 0 ? (sources[existingIndex] ?? undefined) : undefined;

		if (existingSource && typeMatches(scene, existingSource)) {
			used.add(existingIndex);
			lastAssignedIndex = existingIndex;
			plan.push({
				index: i,
				source_index: existingIndex,
				event_title: scene.newsTitle || sourceToEventTitle(existingSource),
				event_date: scene.newsDate || sourceToEventDate(existingSource),
			});
			continue;
		}

		if (scene.type === "text_emphasis") {
			plan.push({
				index: i,
				source_index: -1,
				event_title: scene.newsTitle ?? "",
				event_date: scene.newsDate ?? "",
			});
			continue;
		}

		const candidateIndex = findFallbackSourceIndex(
			scene,
			sources,
			used,
			lastAssignedIndex,
		);
		const candidateSource =
			candidateIndex >= 0 ? sources[candidateIndex] : undefined;

		if (candidateIndex >= 0) {
			used.add(candidateIndex);
			lastAssignedIndex = candidateIndex;
		}

		plan.push({
			index: i,
			source_index: candidateIndex,
			event_title:
				sourceToEventTitle(candidateSource) || trimOrEmpty(scene.newsTitle),
			event_date:
				sourceToEventDate(candidateSource) || trimOrEmpty(scene.newsDate),
		});
	}

	return { scenes: plan };
}

export function applySceneSourcePlan<T extends SequenceScene>(
	scenes: T[],
	sources: SequenceSource[],
	plan?: SceneSourceAssignmentPlan | null,
): (T & { newsTitle: string; newsDate: string; newsSource: string })[] {
	const entries = [...(plan?.scenes ?? [])];
	const assignedSourceIndices = entries
		.map((entry) => entry.source_index)
		.filter((value) => Number.isInteger(value) && value >= 0);
	const usesOneBasedSceneIndex =
		entries.length > 0 &&
		!entries.some((entry) => entry.index === 0) &&
		entries.every((entry) => entry.index >= 1) &&
		entries.some((entry) => entry.index >= scenes.length);
	const usesOneBasedSourceIndex =
		assignedSourceIndices.length > 0 &&
		!assignedSourceIndices.includes(0) &&
		assignedSourceIndices.every((value) => value >= 1) &&
		assignedSourceIndices.some((value) => value >= sources.length);
	const byIndex = new Map(
		entries.map((entry) => [
			usesOneBasedSceneIndex ? entry.index - 1 : entry.index,
			{
				...entry,
				source_index:
					entry.source_index < 0
						? -1
						: usesOneBasedSourceIndex
							? entry.source_index - 1
							: entry.source_index,
			},
		]),
	);

	return scenes.map((scene, index) => {
		const entry = byIndex.get(index);
		const previousSourceIndex = normalizeSourceIndex(
			scene.sourceIndex ?? -1,
			sources.length,
		);
		const rawSourceIndex =
			entry && typeof entry.source_index === "number"
				? entry.source_index
				: (scene.sourceIndex ?? -1);
		const sourceIndex = normalizeSourceIndex(rawSourceIndex, sources.length);
		const sourceChanged = sourceIndex !== previousSourceIndex;

		const source =
			sourceIndex >= 0 ? (sources[sourceIndex] ?? undefined) : undefined;
		const sceneNewsTitle = trimOrEmpty(scene.newsTitle);
		const sceneNewsDate = trimOrEmpty(scene.newsDate);
		const sceneNewsSource = trimOrEmpty(scene.newsSource);
		const entryEventTitle = trimOrEmpty(entry?.event_title);
		const entryEventDate = trimOrEmpty(entry?.event_date);
		const sourceEventTitle = sourceToEventTitle(source);
		const sourceEventDate = sourceToEventDate(source);
		const sourcePublisher = trimOrEmpty(source?.publisher);

		return {
			...scene,
			sourceIndex,
			newsTitle:
				entryEventTitle ||
				(sourceChanged ? sourceEventTitle : sceneNewsTitle || sourceEventTitle),
			newsDate:
				entryEventDate ||
				(sourceChanged ? sourceEventDate : sceneNewsDate || sourceEventDate),
			newsSource: sourceChanged
				? sourcePublisher
				: sceneNewsSource || sourcePublisher,
		};
	});
}
