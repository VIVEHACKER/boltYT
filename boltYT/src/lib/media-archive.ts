export type MediaArchiveKind = "image" | "video";

export interface MediaArchiveEntry {
	id: string;
	kind: MediaArchiveKind;
	provider: string;
	locale: "ko" | "en";
	storagePath: string;
	remoteUrl?: string;
	thumbnailUrl?: string;
	title?: string;
	queries: string[];
	archiveKey?: string;
	qualityScore?: number;
	dynamicScore?: number;
	dynamicIssues?: string[];
	width?: number;
	height?: number;
	duration?: number;
	useCount: number;
	createdAt: string;
	lastUsedAt: string;
}

const STORAGE_KEY = "boltyt:media-archive:v1";

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
	return normalizeText(value)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]+/gu, " ")
		.split(/\s+/)
		.filter((token) => token.length > 1);
}

function loadArchive(): MediaArchiveEntry[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as MediaArchiveEntry[];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveArchive(entries: MediaArchiveEntry[]) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 400)));
}

function scoreQueryOverlap(queries: string[], haystack: string[]): number {
	if (queries.length === 0 || haystack.length === 0) return 0;
	const haystackSet = new Set(haystack);
	let best = 0;
	for (const query of queries) {
		const tokens = tokenize(query);
		if (tokens.length === 0) continue;
		const overlap = tokens.filter((token) => haystackSet.has(token)).length;
		best = Math.max(best, (overlap / tokens.length) * 40);
	}
	return best;
}

export function recordMediaArchiveEntry(
	input: Omit<MediaArchiveEntry, "id" | "createdAt" | "lastUsedAt" | "useCount">,
): MediaArchiveEntry {
	const now = new Date().toISOString();
	const entries = loadArchive();
	const queries = [...new Set(input.queries.map(normalizeText).filter(Boolean))];
	const existingIndex = entries.findIndex(
		(entry) =>
			entry.kind === input.kind &&
			((input.remoteUrl && entry.remoteUrl === input.remoteUrl) ||
				entry.storagePath === input.storagePath),
	);

	if (existingIndex >= 0) {
		const existing = entries[existingIndex];
		const merged: MediaArchiveEntry = {
			...existing,
			...input,
			queries: [...new Set([...existing.queries, ...queries])],
			lastUsedAt: now,
			useCount: existing.useCount + 1,
		};
		entries[existingIndex] = merged;
		saveArchive(entries);
		return merged;
	}

	const created: MediaArchiveEntry = {
		id: crypto.randomUUID(),
		createdAt: now,
		lastUsedAt: now,
		useCount: 1,
		...input,
		queries,
	};
	entries.unshift(created);
	saveArchive(entries);
	return created;
}

export function markMediaArchiveEntryUsed(id: string) {
	const entries = loadArchive();
	const index = entries.findIndex((entry) => entry.id === id);
	if (index < 0) return;
	entries[index] = {
		...entries[index],
		lastUsedAt: new Date().toISOString(),
		useCount: entries[index].useCount + 1,
	};
	saveArchive(entries);
}

export function findArchivedMediaByRemoteUrl(
	kind: MediaArchiveKind,
	remoteUrl: string,
): MediaArchiveEntry | null {
	const normalized = normalizeText(remoteUrl);
	if (!normalized) return null;
	const entries = loadArchive();
	return (
		entries.find(
			(entry) => entry.kind === kind && normalizeText(entry.remoteUrl) === normalized,
		) ?? null
	);
}

export function findArchivedMediaByQueries(params: {
	kind: MediaArchiveKind;
	locale: "ko" | "en";
	queries: string[];
	limit?: number;
}): MediaArchiveEntry[] {
	const limit = params.limit ?? 5;
	const targetQueries = params.queries.map(normalizeText).filter(Boolean);
	if (targetQueries.length === 0) return [];

	return loadArchive()
		.filter((entry) => entry.kind === params.kind)
		.map((entry) => {
			const localeBias = entry.locale === params.locale ? 8 : 0;
			const recency =
				Math.max(0, Date.parse(entry.lastUsedAt) - Date.now() + 30 * 86400_000) /
				86400_000 /
				3;
			const overlap = scoreQueryOverlap(
				targetQueries,
				entry.queries.flatMap((query) => tokenize(query)),
			);
			const qualityBias =
				typeof entry.qualityScore === "number"
					? Math.max(-8, Math.min(10, (entry.qualityScore - 28) / 4))
					: 0;
			const dynamicBias =
				entry.kind === "video" && typeof entry.dynamicScore === "number"
					? Math.max(-16, Math.min(8, (entry.dynamicScore - 22) / 3))
					: 0;
			return {
				entry,
				score:
					overlap +
					localeBias +
					qualityBias +
					dynamicBias +
					Math.min(entry.useCount, 8) +
					recency,
			};
		})
		.filter((item) => item.score > 10)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((item) => item.entry);
}

export const __test = {
	loadArchive,
	STORAGE_KEY,
};
