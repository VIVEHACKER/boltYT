import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { buildMetadataProductionDna } from "../server/lib/reference-production-dna.ts";
import {
	LONGFORM_MIN_DURATION_SECONDS,
	LONGFORM_MAX_DURATION_SECONDS,
	SHORTS_MAX_DURATION_SECONDS,
	referenceFormatForDuration,
} from "../src/lib/reference-duration-policy.ts";
import { scoreReferenceQuality } from "../src/lib/reference-quality.ts";

type ReferenceAnalysisMode = "auto" | "shortform" | "longform" | "deep";
type ReferenceTargetFormat = "auto" | "shorts" | "longform";

interface AnalysisJobResult {
	source_type: "youtube" | "file";
	source_url: string;
	source_title: string;
	source_creator: string;
	thumbnail_url: string;
	duration_seconds: number;
	dominant_colors: string[];
	visual_mood: "horror" | "mystery" | "news" | "neutral" | "warm";
	visual_prompt_template: string;
	lighting_style: "dark" | "natural" | "bright" | "mixed";
	subtitle_position: "top" | "center" | "bottom" | "dynamic";
	subtitle_size_preset: "xs" | "sm" | "md" | "lg" | "xl";
	subtitle_bg_style: "none" | "pill" | "block" | "stroke" | "glow";
	subtitle_accent_color: string;
	scene_count: number;
	avg_scene_duration: number;
	hook_duration: number;
	transition_style: "hardcut" | "crossfade" | "zoom" | "mixed";
	pacing_preset: "fast" | "medium" | "slow";
	tts_voice_id: string;
	tts_provider: "openai" | "elevenlabs";
	tts_speed: number;
	tts_tone_keywords: string[];
	bgm_mood: string;
	bgm_keywords: string[];
	bgm_tempo: "slow" | "mid" | "fast";
	hook_pattern: "question" | "shock" | "claim" | "story" | "";
	script_structure: Array<{ role: string; duration: number; note: string }>;
	transcript: string;
	frame_urls: string[];
	raw_analysis: Record<string, unknown>;
}

interface AnalysisJob {
	id: string;
	status: "queued" | "downloading" | "extracting" | "transcribing" | "analyzing" | "complete" | "failed";
	progress: number;
	input: {
		type: "youtube" | "file";
		url?: string;
		filePath?: string;
		mode?: ReferenceAnalysisMode;
	};
	result?: AnalysisJobResult;
	error?: string;
	createdAt: string;
	completedAt?: string;
}

interface ReferenceChannelCategory {
	id: string;
	label: string;
	modeHint: ReferenceAnalysisMode;
}

interface ReferenceChannelCandidate {
	id: string;
	categoryId: string;
	categoryLabel: string;
	channelTitle: string;
	representativeUrl: string;
	suggestedMode: ReferenceAnalysisMode;
	representativeVideo: {
		videoId: string;
		title: string;
		thumbnail?: string;
		durationSeconds: number;
		viewCount?: number;
		likeCount?: number;
		commentCount?: number;
	};
}

interface StoredJob extends AnalysisJob {
	referenceCategoryId?: string;
	referenceCategoryLabel?: string;
}

interface BatchOptions {
	targetPerCategory?: number;
	targetPerCategoryFormat?: number;
	formats: ReferenceTargetFormat[];
	incrementPerCategory: number;
	maxChannels: number;
	resultsPerQuery: number;
	daysBack: number;
	candidatePool: number;
	order: "viewCount" | "date" | "relevance";
	retryFailed: boolean;
	offline: boolean;
	metadataOnly: boolean;
	fallbackYtSearch: boolean;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const jobsPath = path.join(repoRoot, "server/.tmp/reference/.jobs.json");
const categoryMapPath = path.join(
	repoRoot,
	"server/.tmp/reference/.reference-category-map.json",
);
const generatedPath = path.join(
	repoRoot,
	"src/lib/generated-reference-template-presets.ts",
);
const generatedJsonPath = path.join(
	repoRoot,
	"public/generated-reference-template-presets.json",
);
const execFileAsync = promisify(execFile);
const analyzerBase = process.env.REFERENCE_ANALYZER_URL ?? "http://localhost:3460";
const apiProxyBase = process.env.API_PROXY_URL ?? "http://localhost:3459";
const batchOptions = parseArgs(process.argv.slice(2));

const localStorageShim = {
	getItem(key: string) {
		if (key === "api_proxy_url") return apiProxyBase;
		if (key === "reference_analyzer_url") return analyzerBase;
		return null;
	},
	setItem() {},
	removeItem() {},
	clear() {},
	key() {
		return null;
	},
	get length() {
		return 0;
	},
};

(globalThis as typeof globalThis & { localStorage?: Storage }).localStorage =
	localStorageShim as Storage;

const {
	REFERENCE_CHANNEL_CATEGORIES,
	fetchReferenceChannelCandidates,
} = (await import("../src/lib/reference-channel-scout.ts")) as {
	REFERENCE_CHANNEL_CATEGORIES: ReferenceChannelCategory[];
	fetchReferenceChannelCandidates(
		category: ReferenceChannelCategory,
		options: {
			maxChannels: number;
			resultsPerQuery: number;
			daysBack: number;
			order: "viewCount" | "date" | "relevance";
			format?: ReferenceTargetFormat;
		},
	): Promise<ReferenceChannelCandidate[]>;
};

async function main() {
	if (batchOptions.offline) {
		const generated = buildGeneratedTemplates(await readJobs(), await readCategoryMap());
		await writeGeneratedTemplates(generated);
		console.log(
			JSON.stringify(
				{
					ok: true,
					offline: true,
					generatedTemplates: generated.length,
					output: path.relative(repoRoot, generatedPath),
				},
				null,
				2,
			),
		);
		return;
	}

	if (isFormatAwareBatch(batchOptions)) {
		await runFormatAwareBatch();
		return;
	}

	await ensureAnalyzerReady();
	const targetPerCategory = resolveTargetPerCategory(
		await readJobs(),
		await readCategoryMap(),
		batchOptions,
	);

	const startedOrSkipped: string[] = [];
	for (const category of REFERENCE_CHANNEL_CATEGORIES) {
		const jobs = await readJobs();
		const categoryMap = await readCategoryMap();
		const existingUrls = new Set(
			jobs
				.filter((job) => job.status === "complete")
				.map((job) => job.result?.source_url ?? job.input.url)
				.filter((url): url is string => Boolean(url)),
		);
		const failedUrls = new Map(
			jobs
				.filter((job) => job.status === "failed" && !batchOptions.retryFailed)
				.map((job) => [job.input.url, job.error ?? "previous failure"] as const)
				.filter((entry): entry is [string, string] => Boolean(entry[0])),
		);

		const completedCategoryUrls = new Set(
			jobs
				.filter(
					(job) =>
						job.status === "complete" &&
						categoryIdForJob(job, categoryMap) === category.id,
				)
				.map((job) => job.result?.source_url ?? job.input.url)
				.filter((url): url is string => Boolean(url)),
		);
		const completedForCategory = completedCategoryUrls.size;

		if (completedForCategory >= targetPerCategory) {
			startedOrSkipped.push(`${category.label}: already has ${completedForCategory}`);
			continue;
		}

			let candidates: ReferenceChannelCandidate[] = [];
			try {
				candidates = await fetchReferenceChannelCandidates(category, {
					maxChannels: batchOptions.maxChannels,
					resultsPerQuery: batchOptions.resultsPerQuery,
					daysBack: batchOptions.daysBack,
					order: batchOptions.order,
				});
			} catch (error) {
				startedOrSkipped.push(
				`${category.label}: scout failed (${error instanceof Error ? error.message : "unknown"})`,
			);
			continue;
		}

		let categoryCompleted = completedForCategory;
		for (const candidate of candidates.slice(0, batchOptions.candidatePool)) {
			if (categoryCompleted >= targetPerCategory) break;
			await recordCategoryForUrl(candidate.representativeUrl, category);
			const previousFailure = failedUrls.get(candidate.representativeUrl);
			if (previousFailure) {
				startedOrSkipped.push(
					`${category.label}: skip failed ${candidate.channelTitle} (${previousFailure})`,
				);
				continue;
			}
			if (existingUrls.has(candidate.representativeUrl)) {
				await annotateStoredJobsByUrl(candidate.representativeUrl, {
					referenceCategoryId: category.id,
					referenceCategoryLabel: category.label,
				});
				startedOrSkipped.push(
					`${category.label}: skip existing ${candidate.channelTitle}`,
				);
				if (!completedCategoryUrls.has(candidate.representativeUrl)) {
					completedCategoryUrls.add(candidate.representativeUrl);
					categoryCompleted += 1;
				}
				continue;
			}
			try {
				const job = await startAnalysis(
					candidate.representativeUrl,
					candidate.suggestedMode,
				);
				await annotateStoredJob(job.id, {
					referenceCategoryId: category.id,
					referenceCategoryLabel: category.label,
				});
				startedOrSkipped.push(
					`${category.label}: started ${candidate.channelTitle} (${job.id})`,
				);
				const final = await waitForJob(job.id, candidate.suggestedMode);
				if (final.status === "complete") {
					await annotateStoredJob(final.id, {
						referenceCategoryId: category.id,
						referenceCategoryLabel: category.label,
					});
					completedCategoryUrls.add(candidate.representativeUrl);
					categoryCompleted += 1;
				} else {
					startedOrSkipped.push(
						`${category.label}: failed ${candidate.channelTitle} (${final.error ?? "unknown"})`,
					);
				}
			} catch (error) {
				startedOrSkipped.push(
					`${category.label}: failed ${candidate.channelTitle} (${error instanceof Error ? error.message : "unknown"})`,
				);
			}
		}
	}

	const generated = buildGeneratedTemplates(await readJobs(), await readCategoryMap());
	await writeGeneratedTemplates(generated);

	console.log(
		JSON.stringify(
			{
				ok: true,
				targetPerCategory,
				actions: startedOrSkipped,
				generatedTemplates: generated.length,
				output: path.relative(repoRoot, generatedPath),
			},
			null,
			2,
		),
	);
}

async function runFormatAwareBatch() {
	await ensureAnalyzerReady();
	const targetPerCategoryFormat =
		batchOptions.targetPerCategoryFormat ?? batchOptions.targetPerCategory ?? 10;
	const targetFormats = batchOptions.formats.filter(
		(format): format is Exclude<ReferenceTargetFormat, "auto"> =>
			format === "shorts" || format === "longform",
	);
	const startedOrSkipped: string[] = [];

	for (const category of REFERENCE_CHANNEL_CATEGORIES) {
		for (const format of targetFormats) {
			const jobs = await readJobs();
			const categoryMap = await readCategoryMap();
			const existingUrls = new Set(
				jobs
					.filter((job) => job.status === "complete")
					.map((job) => job.result?.source_url ?? job.input.url)
					.filter((url): url is string => Boolean(url)),
			);
			const failedUrls = new Map(
				jobs
					.filter((job) => job.status === "failed" && !batchOptions.retryFailed)
					.map((job) => [job.input.url, job.error ?? "previous failure"] as const)
					.filter((entry): entry is [string, string] => Boolean(entry[0])),
			);
			const completedCategoryUrls = new Set(
				jobs
					.filter(
						(job) =>
							job.status === "complete" &&
							job.result &&
							categoryIdForJob(job, categoryMap) === category.id &&
							matchesTargetFormat(job.result.duration_seconds, format),
					)
					.map((job) => job.result?.source_url ?? job.input.url)
					.filter((url): url is string => Boolean(url)),
			);
			let categoryCompleted = completedCategoryUrls.size;
			const label = `${category.label}/${formatLabel(format)}`;

			if (categoryCompleted >= targetPerCategoryFormat) {
				startedOrSkipped.push(`${label}: already has ${categoryCompleted}`);
				continue;
			}

				let candidates: ReferenceChannelCandidate[] = [];
				try {
					candidates = await fetchReferenceChannelCandidates(category, {
						maxChannels: batchOptions.maxChannels,
						resultsPerQuery: batchOptions.resultsPerQuery,
						daysBack: batchOptions.daysBack,
						order: batchOptions.order,
						format,
					});
				} catch (error) {
					startedOrSkipped.push(
						`${label}: scout failed (${error instanceof Error ? error.message : "unknown"})`,
					);
				}

				if (
					batchOptions.fallbackYtSearch &&
					candidates.length <
						Math.min(batchOptions.candidatePool, targetPerCategoryFormat)
				) {
					try {
						const fallbackCandidates = await fetchYtDlpCandidates(
							category,
							format,
							batchOptions.candidatePool,
						);
						const before = candidates.length;
						candidates = mergeCandidates(candidates, fallbackCandidates);
						const added = candidates.length - before;
						if (added > 0) {
							startedOrSkipped.push(`${label}: yt-dlp fallback added ${added}`);
						}
					} catch (error) {
						startedOrSkipped.push(
							`${label}: yt-dlp fallback failed (${error instanceof Error ? error.message : "unknown"})`,
						);
					}
				}

				if (candidates.length === 0) {
					startedOrSkipped.push(`${label}: no candidates`);
					continue;
				}

			for (const candidate of candidates.slice(0, batchOptions.candidatePool)) {
				if (categoryCompleted >= targetPerCategoryFormat) break;
				if (
					!matchesTargetFormat(candidate.representativeVideo.durationSeconds, format)
				) {
					startedOrSkipped.push(
						`${label}: skip format mismatch ${candidate.channelTitle}`,
					);
					continue;
				}

				await recordCategoryForUrl(candidate.representativeUrl, category);
				const previousFailure = failedUrls.get(candidate.representativeUrl);
				if (previousFailure) {
					startedOrSkipped.push(
						`${label}: skip failed ${candidate.channelTitle} (${previousFailure})`,
					);
					continue;
				}
				if (existingUrls.has(candidate.representativeUrl)) {
					await annotateStoredJobsByUrl(candidate.representativeUrl, {
						referenceCategoryId: category.id,
						referenceCategoryLabel: category.label,
					});
					startedOrSkipped.push(`${label}: skip existing ${candidate.channelTitle}`);
					if (!completedCategoryUrls.has(candidate.representativeUrl)) {
						completedCategoryUrls.add(candidate.representativeUrl);
						categoryCompleted += 1;
					}
					continue;
				}

				try {
					const mode: ReferenceAnalysisMode =
						format === "shorts" ? "shortform" : "longform";
					if (batchOptions.metadataOnly) {
						const final = await storeMetadataOnlyJob(candidate, category, format, mode);
						completedCategoryUrls.add(candidate.representativeUrl);
						categoryCompleted += 1;
						startedOrSkipped.push(
							`${label}: metadata ${candidate.channelTitle} (${final.id})`,
						);
						continue;
					}
					const job = await startAnalysis(candidate.representativeUrl, mode);
					await annotateStoredJob(job.id, {
						referenceCategoryId: category.id,
						referenceCategoryLabel: category.label,
					});
					startedOrSkipped.push(
						`${label}: started ${candidate.channelTitle} (${job.id})`,
					);
					const final = await waitForJob(job.id, mode);
					if (final.status === "complete" && final.result) {
						await annotateStoredJob(final.id, {
							referenceCategoryId: category.id,
							referenceCategoryLabel: category.label,
						});
						if (matchesTargetFormat(final.result.duration_seconds, format)) {
							completedCategoryUrls.add(candidate.representativeUrl);
							categoryCompleted += 1;
						} else {
							startedOrSkipped.push(
								`${label}: completed but format mismatch ${candidate.channelTitle}`,
							);
						}
					} else {
						startedOrSkipped.push(
							`${label}: failed ${candidate.channelTitle} (${final.error ?? "unknown"})`,
						);
					}
				} catch (error) {
					startedOrSkipped.push(
						`${label}: failed ${candidate.channelTitle} (${error instanceof Error ? error.message : "unknown"})`,
					);
				}
			}
		}
	}

	const jobs = await readJobs();
	const categoryMap = await readCategoryMap();
	const generated = buildGeneratedTemplates(jobs, categoryMap);
	await writeGeneratedTemplates(generated);

	console.log(
		JSON.stringify(
			{
				ok: true,
				formats: targetFormats,
				targetPerCategoryFormat,
				coverage: completionCountsByCategoryAndFormat(jobs, categoryMap),
				actions: startedOrSkipped,
				generatedTemplates: generated.length,
				output: path.relative(repoRoot, generatedPath),
			},
			null,
			2,
		),
	);
}

function parseArgs(args: string[]): BatchOptions {
	const targetPerCategory = readOptionalPositiveInt(args, "--target-per-category");
	const targetPerCategoryFormat = readOptionalPositiveInt(
		args,
		"--target-per-category-format",
	);
	const incrementPerCategory = readPositiveInt(args, "--increment-per-category", 0);
	const formats = parseFormats(readString(args, "--formats", "auto"));
	const targetHint =
		targetPerCategoryFormat ??
		targetPerCategory ??
		Math.max(3, incrementPerCategory + 3);
	const maxChannels = readPositiveInt(
		args,
		"--max-channels",
		Math.max(6, targetHint * 3),
	);
	const resultsPerQuery = readPositiveInt(args, "--results-per-query", 10);
	const daysBack = readPositiveInt(args, "--days-back", 730);
	const candidatePool = readPositiveInt(
		args,
		"--candidate-pool",
		Math.max(maxChannels, targetHint * 3),
	);
	const order = readString(args, "--order", "viewCount");
		const retryFailed = hasFlag(args, "--retry-failed");
		const offline = hasFlag(args, "--offline");
		const metadataOnly = hasFlag(args, "--metadata-only");
		const fallbackYtSearch = hasFlag(args, "--fallback-ytsearch");
		return {
			targetPerCategory,
			targetPerCategoryFormat,
			formats,
		incrementPerCategory,
		maxChannels,
		resultsPerQuery,
		daysBack,
		candidatePool,
		order:
			order === "date" || order === "relevance" || order === "viewCount"
				? order
				: "viewCount",
			retryFailed,
			offline,
			metadataOnly,
			fallbackYtSearch,
		};
	}

function parseFormats(raw: string): ReferenceTargetFormat[] {
	if (raw === "both" || raw === "all") return ["shorts", "longform"];
	const formats = raw
		.split(",")
		.map((format) => format.trim())
		.filter(Boolean)
		.map((format) =>
			format === "shortform" || format === "short"
				? "shorts"
				: format === "long"
					? "longform"
					: format,
		)
		.filter(
			(format): format is ReferenceTargetFormat =>
				format === "auto" || format === "shorts" || format === "longform",
		);
	return formats.length > 0 ? [...new Set(formats)] : ["auto"];
}

function hasFlag(args: string[], key: string): boolean {
	return args.includes(key);
}

function resolveTargetPerCategory(
	jobs: StoredJob[],
	categoryMap: Record<string, { id: string; label: string }>,
	options: BatchOptions,
) {
	if (options.targetPerCategory) return options.targetPerCategory;
	if (options.incrementPerCategory > 0) {
		const counts = completionCountsByCategory(jobs, categoryMap);
		const currentFloor = Math.min(
			...REFERENCE_CHANNEL_CATEGORIES.map((category) => counts[category.id] ?? 0),
		);
		return currentFloor + options.incrementPerCategory;
	}
	return 3;
}

function completionCountsByCategory(
	jobs: StoredJob[],
	categoryMap: Record<string, { id: string; label: string }>,
) {
	return jobs.reduce<Record<string, number>>((counts, job) => {
		if (job.status !== "complete") return counts;
		const categoryId = categoryIdForJob(job, categoryMap);
		if (!categoryId) return counts;
		counts[categoryId] = (counts[categoryId] ?? 0) + 1;
		return counts;
	}, {});
}

function completionCountsByCategoryAndFormat(
	jobs: StoredJob[],
	categoryMap: Record<string, { id: string; label: string }>,
) {
	return jobs.reduce<
		Record<string, { total: number; shorts: number; longform: number; other: number }>
	>((counts, job) => {
		if (job.status !== "complete" || !job.result) return counts;
		const categoryId = categoryIdForJob(job, categoryMap) || "unknown";
		counts[categoryId] ??= { total: 0, shorts: 0, longform: 0, other: 0 };
		counts[categoryId].total += 1;
		const format = targetFormatForDuration(job.result.duration_seconds);
		counts[categoryId][format] += 1;
		return counts;
	}, {});
}

function isFormatAwareBatch(options: BatchOptions) {
	return (
		Boolean(options.targetPerCategoryFormat) ||
		options.formats.some((format) => format === "shorts" || format === "longform")
	);
}

function matchesTargetFormat(
	durationSeconds: number,
	format: Exclude<ReferenceTargetFormat, "auto">,
) {
	return targetFormatForDuration(durationSeconds) === format;
}

function targetFormatForDuration(durationSeconds: number) {
	return referenceFormatForDuration(durationSeconds);
}

function formatLabel(format: Exclude<ReferenceTargetFormat, "auto">) {
	return format === "shorts" ? "쇼츠" : "롱폼";
}

interface YtDlpSearchEntry {
	id?: string;
	url?: string;
	webpage_url?: string;
	title?: string;
	duration?: number;
	channel?: string;
	channel_id?: string;
	uploader?: string;
	uploader_id?: string;
	view_count?: number;
	like_count?: number;
	comment_count?: number;
	thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
	thumbnail?: string;
}

async function fetchYtDlpCandidates(
	category: ReferenceChannelCategory,
	format: Exclude<ReferenceTargetFormat, "auto">,
	maxResults: number,
): Promise<ReferenceChannelCandidate[]> {
	const entries: YtDlpSearchEntry[] = [];
	const queries = buildYtDlpQueries(category, format).slice(0, 10);
	const perQuery = format === "shorts" ? 25 : 12;
	for (const query of queries) {
		try {
			const { stdout } = await execFileAsync(
				"yt-dlp",
				[
					"--dump-json",
					"--skip-download",
					"--flat-playlist",
					`ytsearch${perQuery}:${query}`,
				],
				{ maxBuffer: 24 * 1024 * 1024, timeout: 90_000 },
			);
			entries.push(...parseYtDlpJsonLines(stdout));
		} catch {
			// Search fallback is opportunistic; a single noisy query should not kill the batch.
		}
	}

	return mergeCandidates(
		[],
		entries
			.map((entry) => ytDlpEntryToCandidate(entry, category, format))
			.filter((candidate): candidate is ReferenceChannelCandidate => Boolean(candidate)),
	).slice(0, maxResults);
}

function parseYtDlpJsonLines(stdout: string): YtDlpSearchEntry[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as YtDlpSearchEntry];
			} catch {
				return [];
			}
		});
}

function ytDlpEntryToCandidate(
	entry: YtDlpSearchEntry,
	category: ReferenceChannelCategory,
	format: Exclude<ReferenceTargetFormat, "auto">,
): ReferenceChannelCandidate | null {
	const videoId = entry.id?.trim();
	const title = entry.title?.trim();
	if (!videoId || !title) return null;

	const durationSeconds = Math.round(Number(entry.duration ?? 0));
	if (!matchesTargetFormat(durationSeconds, format)) return null;

	const channelTitle =
		entry.channel?.trim() || entry.uploader?.trim() || "YouTube reference";
	const representativeUrl = normalizedYouTubeUrl(entry, videoId);
	const viewCount = Math.max(0, Math.round(Number(entry.view_count ?? 0)));
	const likeCount = Math.max(0, Math.round(Number(entry.like_count ?? 0)));
	const commentCount = Math.max(0, Math.round(Number(entry.comment_count ?? 0)));

	return {
		id: `${category.id}:ytsearch:${videoId}`,
		categoryId: category.id,
		categoryLabel: category.label,
		channelTitle,
		representativeUrl,
		suggestedMode: format === "shorts" ? "shortform" : "longform",
		representativeVideo: {
			videoId,
			title,
			thumbnail: bestThumbnail(entry),
			durationSeconds,
			viewCount,
			likeCount,
			commentCount,
		},
	};
}

function normalizedYouTubeUrl(entry: YtDlpSearchEntry, videoId: string) {
	const candidate = entry.webpage_url || entry.url || "";
	if (/^https?:\/\//.test(candidate)) return candidate;
	return `https://www.youtube.com/watch?v=${videoId}`;
}

function bestThumbnail(entry: YtDlpSearchEntry) {
	if (entry.thumbnail) return entry.thumbnail;
	const thumbnails = [...(entry.thumbnails ?? [])].filter((item) => item.url);
	return thumbnails.sort(
		(a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
	)[0]?.url;
}

function mergeCandidates(
	primary: ReferenceChannelCandidate[],
	secondary: ReferenceChannelCandidate[],
) {
	const byUrl = new Map<string, ReferenceChannelCandidate>();
	for (const candidate of [...primary, ...secondary]) {
		if (!byUrl.has(candidate.representativeUrl)) {
			byUrl.set(candidate.representativeUrl, candidate);
		}
	}
	return [...byUrl.values()].sort((a, b) => {
		const aViews = a.representativeVideo.viewCount ?? 0;
		const bViews = b.representativeVideo.viewCount ?? 0;
		return bViews - aViews;
	});
}

function buildYtDlpQueries(
	category: ReferenceChannelCategory,
	format: Exclude<ReferenceTargetFormat, "auto">,
) {
	const categorySeeds = ytDlpCategorySeeds(category.id, format);
	const formatQueries =
		format === "shorts"
			? [
					...category.queries.map((query) => `${query} 쇼츠`),
					...category.queries.map((query) => `${query} #shorts`),
					...category.queries.map((query) => `${query} shorts`),
				]
			: [
					...category.queries,
					...category.queries.map((query) => `${query} 롱폼`),
					...category.queries.map((query) => `${query} 몰아보기`),
				];
	return [...new Set([...categorySeeds, ...formatQueries])];
}

function ytDlpCategorySeeds(
	categoryId: string,
	format: Exclude<ReferenceTargetFormat, "auto">,
) {
	if (format === "longform") {
		if (categoryId === "drama_recap") {
			return ["영화 결말포함 몰아보기", "드라마 리뷰 롱폼", "드라마 정주행 해설"];
		}
		if (categoryId === "mystery_doc") {
			return ["미스터리 다큐 롱폼", "미제사건 다큐", "역사 미스터리 해설"];
		}
		if (categoryId === "news_issue") {
			return ["뉴스 이슈 해설 롱폼", "시사 이슈 분석", "경제 뉴스 해설 롱폼"];
		}
		if (categoryId === "automation_business") {
			return ["AI 자동화 강의", "AI 수익화 자동화", "업무 자동화 노코드"];
		}
		return ["돈 공부 롱폼", "자기계발 돈 버는 법", "성공 습관 심리"];
	}
	if (categoryId === "drama_recap") {
		return ["영화 결말포함 쇼츠", "드라마 리뷰 쇼츠", "드라마 명장면 해설 #shorts"];
	}
	if (categoryId === "mystery_doc") {
		return ["미스터리 쇼츠", "미제사건 쇼츠", "역사 미스터리 #shorts"];
	}
	if (categoryId === "news_issue") {
		return ["뉴스 쇼츠", "시사 쇼츠", "경제뉴스 쇼츠", "뉴스 이슈 #shorts"];
	}
	if (categoryId === "automation_business") {
		return ["AI 자동화 쇼츠", "챗GPT 자동화 쇼츠", "AI 수익화 쇼츠", "노코드 자동화 쇼츠"];
	}
	return ["돈 공부 쇼츠", "부자 심리 쇼츠", "자기계발 쇼츠", "성공 습관 쇼츠"];
}

function inferHookPattern(title: string): AnalysisJobResult["hook_pattern"] {
	if (/[?？]|왜|어떻게|무엇|누가/.test(title)) return "question";
	if (/충격|소름|역대|최초|논란|폭로|미친|절대/.test(title)) return "shock";
	if (/하는 법|방법|비밀|공식|이유|결과|성공/.test(title)) return "claim";
	return "story";
}

function colorsForCategory(categoryId: string) {
	if (categoryId === "drama_recap") return ["#15110f", "#d7b98c", "#f5eee3"];
	if (categoryId === "mystery_doc") return ["#080b10", "#6f8aa6", "#d8e0e8"];
	if (categoryId === "news_issue") return ["#101820", "#e93f33", "#f6f2e8"];
	if (categoryId === "automation_business") return ["#0c1b2a", "#29d3a7", "#edf7f3"];
	return ["#151515", "#f1c45b", "#f8f1de"];
}

function accentForCategory(categoryId: string) {
	return colorsForCategory(categoryId)[1] ?? "#f1c45b";
}

function moodForCategory(categoryId: string): AnalysisJobResult["visual_mood"] {
	if (categoryId === "mystery_doc") return "mystery";
	if (categoryId === "news_issue") return "news";
	if (categoryId === "money_psychology") return "warm";
	return "neutral";
}

function toneKeywordsForCategory(
	categoryId: string,
	format: Exclude<ReferenceTargetFormat, "auto">,
) {
	const base =
		categoryId === "drama_recap"
			? ["몰입형", "감정선", "스포일러 정리"]
			: categoryId === "mystery_doc"
				? ["긴장감", "차분한 추적", "사실 확인"]
				: categoryId === "news_issue"
					? ["명확한", "긴박한", "근거 중심"]
					: categoryId === "automation_business"
						? ["실험적", "실용적", "빠른 결론"]
						: ["설득형", "따뜻한", "성장 서사"];
	return format === "shorts" ? ["압축", "강한 훅", ...base].slice(0, 5) : base;
}

function bgmMoodForCategory(
	categoryId: string,
	format: Exclude<ReferenceTargetFormat, "auto">,
) {
	if (categoryId === "mystery_doc") return format === "shorts" ? "tense pulse" : "dark investigative";
	if (categoryId === "news_issue") return "urgent editorial";
	if (categoryId === "automation_business") return "clean tech momentum";
	if (categoryId === "money_psychology") return "warm motivational";
	return "cinematic recap";
}

function bgmKeywordsForCategory(
	categoryId: string,
	format: Exclude<ReferenceTargetFormat, "auto">,
) {
	const tempo = format === "shorts" ? "fast cuts" : "chaptered pacing";
	if (categoryId === "mystery_doc") return ["low drone", "pulse", tempo];
	if (categoryId === "news_issue") return ["ticker", "percussion", tempo];
	if (categoryId === "automation_business") return ["synth", "minimal beat", tempo];
	if (categoryId === "money_psychology") return ["piano", "soft beat", tempo];
	return ["strings", "tension bed", tempo];
}

function metadataScriptStructure(
	durationSeconds: number,
	format: Exclude<ReferenceTargetFormat, "auto">,
	hookPattern: AnalysisJobResult["hook_pattern"],
) {
	if (format === "shorts") {
		return [
			{ role: "hook", duration: 3, note: `${hookPattern} 훅으로 제목 약속 즉시 제시` },
			{ role: "proof", duration: Math.max(8, Math.round(durationSeconds * 0.38)), note: "근거/장면을 빠르게 2-3개 제시" },
			{ role: "turn", duration: Math.max(6, Math.round(durationSeconds * 0.28)), note: "반전 또는 핵심 정보 회수" },
			{ role: "payoff", duration: Math.max(5, Math.round(durationSeconds * 0.2)), note: "결론과 다음 궁금증 연결" },
		];
	}
	return [
		{ role: "cold_open", duration: 12, note: `${hookPattern} 훅으로 핵심 갈등 선공개` },
		{ role: "setup", duration: Math.max(60, Math.round(durationSeconds * 0.16)), note: "인물/사건/자료 배경 정리" },
		{ role: "development", duration: Math.max(180, Math.round(durationSeconds * 0.45)), note: "챕터 단위 근거와 장면 전개" },
		{ role: "turning_point", duration: Math.max(90, Math.round(durationSeconds * 0.22)), note: "반전, 쟁점, 해석 전환" },
		{ role: "resolution", duration: Math.max(45, Math.round(durationSeconds * 0.1)), note: "결론, 시청자 질문 회수, 다음 편 연결" },
	];
}

function readOptionalPositiveInt(args: string[], key: string): number | undefined {
	const raw = readString(args, key, "");
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : undefined;
}

function readPositiveInt(args: string[], key: string, fallback: number): number {
	const raw = readString(args, key, "");
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readString(args: string[], key: string, fallback: string): string {
	const index = args.indexOf(key);
	if (index >= 0) return args[index + 1] ?? fallback;
	const prefix = `${key}=`;
	const inline = args.find((arg) => arg.startsWith(prefix));
	return inline ? inline.slice(prefix.length) : fallback;
}

async function ensureAnalyzerReady() {
	const res = await fetch(`${analyzerBase}/health`);
	if (!res.ok) {
		throw new Error(`reference analyzer unavailable: ${res.status}`);
	}
}

async function startAnalysis(
	url: string,
	mode: ReferenceAnalysisMode,
): Promise<AnalysisJob> {
	const res = await fetch(`${analyzerBase}/api/reference/analyze`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type: "youtube", url, mode }),
	});
	if (!res.ok) {
		throw new Error(`analyze failed ${res.status}: ${await res.text()}`);
	}
	const data = (await res.json()) as { job: AnalysisJob };
	return data.job;
}

async function waitForJob(
	jobId: string,
	mode: ReferenceAnalysisMode,
): Promise<AnalysisJob> {
	const timeoutMs =
		mode === "deep"
			? 20 * 60 * 1000
			: mode === "shortform"
				? 10 * 60 * 1000
				: 3 * 60 * 1000;
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const job = (await readJobs()).find((item) => item.id === jobId);
		if (job?.status === "complete" || job?.status === "failed") {
			return job;
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error(`job ${jobId} timed out`);
}

async function readJobs(): Promise<StoredJob[]> {
	try {
		return JSON.parse(await fs.readFile(jobsPath, "utf8")) as StoredJob[];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

async function readCategoryMap(): Promise<
	Record<string, { id: string; label: string }>
> {
	try {
		return JSON.parse(await fs.readFile(categoryMapPath, "utf8")) as Record<
			string,
			{ id: string; label: string }
		>;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

async function recordCategoryForUrl(
	sourceUrl: string,
	category: ReferenceChannelCategory,
) {
	const map = await readCategoryMap();
	map[sourceUrl] = { id: category.id, label: category.label };
	await fs.writeFile(categoryMapPath, `${JSON.stringify(map, null, 2)}\n`);
}

async function annotateStoredJob(
	jobId: string,
	patch: Pick<StoredJob, "referenceCategoryId" | "referenceCategoryLabel">,
) {
	const jobs = await readJobs();
	const index = jobs.findIndex((job) => job.id === jobId);
	if (index < 0) return;
	jobs[index] = { ...jobs[index], ...patch };
	await fs.writeFile(jobsPath, `${JSON.stringify(jobs, null, 2)}\n`);
}

async function annotateStoredJobsByUrl(
	sourceUrl: string,
	patch: Pick<StoredJob, "referenceCategoryId" | "referenceCategoryLabel">,
) {
	const jobs = await readJobs();
	let changed = false;
	const next = jobs.map((job) => {
		const url = job.result?.source_url ?? job.input.url;
		if (url !== sourceUrl) return job;
		changed = true;
		return { ...job, ...patch };
	});
	if (changed) await fs.writeFile(jobsPath, `${JSON.stringify(next, null, 2)}\n`);
}

async function storeMetadataOnlyJob(
	candidate: ReferenceChannelCandidate,
	category: ReferenceChannelCategory,
	format: Exclude<ReferenceTargetFormat, "auto">,
	mode: ReferenceAnalysisMode,
): Promise<StoredJob> {
	const jobs = await readJobs();
	const now = new Date().toISOString();
	const result = metadataResultFromCandidate(candidate, category, format);
	const job: StoredJob = {
		id: `ref-meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		status: "complete",
		progress: 100,
		input: {
			type: "youtube",
			url: candidate.representativeUrl,
			mode,
		},
		result,
		createdAt: now,
		completedAt: now,
		referenceCategoryId: category.id,
		referenceCategoryLabel: category.label,
	};
	jobs.push(job);
	await fs.writeFile(jobsPath, `${JSON.stringify(jobs, null, 2)}\n`);
	return job;
}

function metadataResultFromCandidate(
	candidate: ReferenceChannelCandidate,
	category: ReferenceChannelCategory,
	format: Exclude<ReferenceTargetFormat, "auto">,
): AnalysisJobResult {
	const video = candidate.representativeVideo;
	const durationSeconds = Math.max(1, Math.round(video.durationSeconds || 60));
	const isShorts = format === "shorts";
	const avgSceneDuration = isShorts ? 2.4 : 8.5;
	const sceneCount = Math.max(
		isShorts ? 8 : 12,
		Math.round(durationSeconds / avgSceneDuration),
	);
	const hookPattern = inferHookPattern(video.title);
	const result: AnalysisJobResult = {
		source_type: "youtube",
		source_url: candidate.representativeUrl,
		source_title: video.title,
		source_creator: candidate.channelTitle,
		thumbnail_url: video.thumbnail ?? "",
		duration_seconds: durationSeconds,
		dominant_colors: colorsForCategory(category.id),
		visual_mood: moodForCategory(category.id),
		visual_prompt_template: `${category.label} ${formatLabel(format)} reference: high-retention edit pacing, source-backed visuals, clear title payoff.`,
		lighting_style: "mixed",
		subtitle_position: isShorts ? "bottom" : "dynamic",
		subtitle_size_preset: isShorts ? "lg" : "md",
		subtitle_bg_style: isShorts ? "stroke" : "glow",
		subtitle_accent_color: accentForCategory(category.id),
		scene_count: sceneCount,
		avg_scene_duration: Math.round((durationSeconds / sceneCount) * 10) / 10,
		hook_duration: isShorts ? 2.5 : 8,
		transition_style: isShorts ? "hardcut" : "mixed",
		pacing_preset: isShorts ? "fast" : "medium",
		tts_voice_id: "alloy",
		tts_provider: "openai",
		tts_speed: isShorts ? 1.08 : 0.98,
		tts_tone_keywords: toneKeywordsForCategory(category.id, format),
		bgm_mood: bgmMoodForCategory(category.id, format),
		bgm_keywords: bgmKeywordsForCategory(category.id, format),
		bgm_tempo: isShorts ? "fast" : "mid",
		hook_pattern: hookPattern,
		script_structure: metadataScriptStructure(durationSeconds, format, hookPattern),
		transcript: "",
		frame_urls: [],
		raw_analysis: {
			analysis_depth: "metadata_only",
			analysis_mode: `metadata_${format}`,
			built_in_reference: true,
			generated_reference: true,
			reference_category_id: category.id,
			reference_category_label: category.label,
			reference_format: format,
			source_metrics: {
				videoId: video.videoId,
				viewCount: video.viewCount ?? 0,
				likeCount: video.likeCount ?? 0,
				commentCount: video.commentCount ?? 0,
			},
			copy_boundary: {
				rawAssetsReusable: false,
				allowedUse:
					"Use only metadata-level structure, topic fit, pacing targets, and category rules. Do not reuse source footage, music, speech, or exact script.",
			},
			production_method: {
				id: `metadata-${category.id}-${format}`,
				label: `${category.label} ${formatLabel(format)} 메타 레퍼런스`,
				description:
					"YouTube 성과/길이/카테고리 메타데이터를 기반으로 제작 규칙과 템플릿을 만든다.",
				recommendedMode: "research",
				supportedFormats: [format === "shorts" ? "shorts" : "longform"],
				manualVideoInsert: true,
				clipControls: ["trim_start", "duration_seconds", "crop"],
				referenceSources: [
					{ url: candidate.representativeUrl, purpose: "구조와 제작 규칙만 참조" },
				],
				rules: [
					"원본 영상, 음악, 대사를 그대로 재사용하지 않는다.",
					"자료와 화면 소스는 새 주제에 맞춰 별도로 확보한다.",
					"제목의 핵심 약속을 첫 구간 안에서 반드시 회수한다.",
					"문장 단위 TTS가 끊기지 않도록 컷을 정렬한다.",
				],
			},
		},
	};
	result.raw_analysis.production_dna = buildMetadataProductionDna({
		durationSeconds,
		sceneCount,
		avgSceneDuration: result.avg_scene_duration,
		hookDuration: result.hook_duration,
		analysis: result,
	});
	return result;
}

function buildGeneratedTemplates(
	jobs: StoredJob[],
	categoryMap: Record<string, { id: string; label: string }>,
) {
	const latestByUrl = new Map<string, StoredJob>();
	for (const job of jobs) {
		if (job.status !== "complete" || !job.result?.source_url) continue;
		if (referenceFormatForDuration(job.result.duration_seconds) === "other") {
			continue;
		}
		const previous = latestByUrl.get(job.result.source_url);
		if (
			!previous ||
			new Date(job.completedAt ?? job.createdAt).getTime() >
				new Date(previous.completedAt ?? previous.createdAt).getTime()
		) {
			latestByUrl.set(job.result.source_url, job);
		}
	}

	return [...latestByUrl.values()]
		.sort((a, b) => {
			const category = categoryRank(a, categoryMap) - categoryRank(b, categoryMap);
			if (category !== 0) return category;
			return (a.result?.source_creator ?? "").localeCompare(
				b.result?.source_creator ?? "",
				"ko",
			);
		})
		.map((job) => templateFromJob(job, categoryMap));
}

function templateFromJob(
	job: StoredJob,
	categoryMap: Record<string, { id: string; label: string }>,
) {
	const result = mustResult(job);
	const createdAt = job.completedAt ?? job.createdAt;
	const durationSeconds = templateDurationSeconds(result.duration_seconds);
	const mappedCategory = categoryMap[result.source_url];
	const categoryId =
		mappedCategory?.id ?? job.referenceCategoryId ?? inferCategoryId(result);
	const categoryLabel =
		mappedCategory?.label ?? job.referenceCategoryLabel ?? labelForCategory(categoryId);
	const youtubeId = extractYouTubeId(result.source_url) ?? stableSlug(result.source_url);
	const name =
		categoryLabel && result.source_creator
			? `${categoryLabel} · ${result.source_creator} · ${cleanTitle(result.source_title, 38)}`
			: `자동 레퍼런스 · ${cleanTitle(result.source_title, 48)}`;
	const rawAnalysis = sanitizeRawAnalysis(result.raw_analysis, job, categoryId, categoryLabel);

	const template = {
		id: `builtin-auto-${stableSlug(categoryId || "reference")}-${stableSlug(youtubeId)}`,
		channel_id: "__builtin_reference__",
		name,
		source_type: result.source_type,
		source_url: result.source_url,
		source_title: result.source_title,
		source_creator: result.source_creator,
		thumbnail_url: result.thumbnail_url,
		duration_seconds: durationSeconds,
		dominant_colors: result.dominant_colors,
		visual_mood: result.visual_mood,
		visual_prompt_template: result.visual_prompt_template,
		lighting_style: result.lighting_style,
		subtitle_position: result.subtitle_position,
		subtitle_size_preset: result.subtitle_size_preset,
		subtitle_bg_style: result.subtitle_bg_style,
		subtitle_accent_color: result.subtitle_accent_color,
		scene_count: result.scene_count,
		avg_scene_duration: result.avg_scene_duration,
		hook_duration: result.hook_duration,
		transition_style: result.transition_style,
		pacing_preset: result.pacing_preset,
		tts_voice_id: result.tts_voice_id,
		tts_provider: result.tts_provider,
		tts_speed: result.tts_speed,
		tts_tone_keywords: result.tts_tone_keywords,
		bgm_mood: result.bgm_mood,
		bgm_keywords: result.bgm_keywords,
		bgm_tempo: result.bgm_tempo,
		bgm_reference_url: "",
		hook_pattern: result.hook_pattern,
		script_structure: result.script_structure,
		transcript: sanitizeTranscript(result.transcript),
		frame_urls: [],
		raw_analysis: rawAnalysis,
		analysis_status: "complete",
		analysis_error: "",
		created_at: createdAt,
		updated_at: createdAt,
	};
	return {
		...template,
		raw_analysis: {
			...rawAnalysis,
			reference_quality: scoreReferenceQuality(template),
		},
	};
}

function sanitizeRawAnalysis(
	raw: Record<string, unknown>,
	job: StoredJob,
	categoryId: string,
	categoryLabel: string,
) {
	const copy = { ...raw };
	delete copy.automatic_caption_languages;
	delete copy.subtitle_languages;
	const result = mustResult(job);
	const productionDna = sanitizeProductionDna(
		isRecord(copy.production_dna)
			? copy.production_dna
			: buildMetadataProductionDna({
					durationSeconds: result.duration_seconds,
					sceneCount: result.scene_count,
					avgSceneDuration: result.avg_scene_duration,
					hookDuration: result.hook_duration,
					chapterCutTimes: Array.isArray(copy.chapters)
						? copy.chapters
								.map((chapter) =>
									isRecord(chapter) && typeof chapter.start_time === "number"
										? chapter.start_time
										: 0,
								)
								.filter((time) => time > 0)
						: undefined,
					analysis: result,
				}),
	);
	return {
		...copy,
		source_duration_seconds: result.duration_seconds,
		duration_policy: {
			shorts_max_seconds: SHORTS_MAX_DURATION_SECONDS,
			longform_min_seconds: LONGFORM_MIN_DURATION_SECONDS,
			longform_max_seconds: LONGFORM_MAX_DURATION_SECONDS,
			output_duration_seconds: templateDurationSeconds(result.duration_seconds),
		},
		analysis_depth:
			typeof copy.analysis_depth === "string"
				? copy.analysis_depth
				: isRecord(productionDna) &&
					  typeof productionDna.analysisDepth === "string"
					? productionDna.analysisDepth
					: "metadata_only",
		built_in_reference: true,
		generated_reference: true,
		generated_from_job_id: job.id,
		reference_category_id: categoryId,
		reference_category_label: categoryLabel,
		production_dna: productionDna,
		production_method: normalizeProductionMethod(
			copy.production_method,
			result,
			categoryId,
			categoryLabel,
		),
	};
}

function templateDurationSeconds(durationSeconds: number) {
	const duration = Math.max(1, Math.round(Number(durationSeconds) || 1));
	if (duration > SHORTS_MAX_DURATION_SECONDS) {
		return Math.min(duration, LONGFORM_MAX_DURATION_SECONDS);
	}
	return duration;
}

function sanitizeProductionDna(dna: Record<string, unknown>) {
	if (!isRecord(dna)) return dna;
	return {
		...dna,
		frames: Array.isArray(dna.frames)
			? dna.frames.map((frame, index) =>
					isRecord(frame)
						? {
								...frame,
								path: `reference-frame-${index + 1}`,
							}
						: frame,
				)
			: [],
		copyBoundary: {
			...(isRecord(dna.copyBoundary) ? dna.copyBoundary : {}),
			rawAssetsReusable: false,
			allowedUse:
				"Use only production rules and numeric/style metrics. Do not reuse source frames, music, speech, or exact script.",
		},
	};
}

function normalizeProductionMethod(
	method: unknown,
	result: AnalysisJobResult,
	categoryId: string,
	categoryLabel: string,
) {
	const supportedFormats =
		result.duration_seconds > SHORTS_MAX_DURATION_SECONDS ? ["longform"] : ["shorts"];
	const defaultSceneLayouts = Object.fromEntries(
		supportedFormats.map((format) => [format, "full"]),
	);
	if (isRecord(method)) {
		const methodFormats = Array.isArray(method.supportedFormats)
			? method.supportedFormats.filter(
					(format): format is string =>
						format === "shorts" || format === "longform",
				)
			: supportedFormats;
		const normalizedFormats = methodFormats.length > 0 ? methodFormats : supportedFormats;
		const methodSceneLayouts = isRecord(method.sceneLayouts) ? method.sceneLayouts : {};
		return {
			...method,
			supportedFormats: normalizedFormats,
			formatProfiles: normalizeFormatProfiles(
				method.formatProfiles,
				result,
				normalizedFormats,
			),
			sceneLayout:
				typeof method.sceneLayout === "string" ? method.sceneLayout : "full",
			sceneLayouts: {
				...Object.fromEntries(normalizedFormats.map((format) => [format, "full"])),
				...methodSceneLayouts,
			},
			referenceSources: normalizeReferenceSources(
				method.referenceSources,
				result.source_url,
			),
		};
	}
	return {
		id: `auto-${categoryId || "reference"}`,
		label: `${categoryLabel || "자동"} 레퍼런스`,
		description:
			"인기 채널 대표 영상을 분석해 대본, TTS, BGM, 컷 호흡, 화면 배치를 재사용 가능한 제작 규칙으로 변환합니다.",
		recommendedMode: "research",
		supportedFormats,
		formatProfiles: {
			[supportedFormats[0]]: {
				durationSeconds: templateDurationSeconds(result.duration_seconds),
				sceneCount: normalizedSceneCount(result),
				avgSceneDuration: normalizedAvgSceneDuration(result),
				hookDuration: result.hook_duration,
			},
		},
		sceneLayout: "full",
		sceneLayouts: defaultSceneLayouts,
		manualVideoInsert: true,
		clipControls: ["trim_start", "duration_seconds", "crop"],
		referenceSources: [{ url: result.source_url, purpose: "구조와 제작 규칙만 참조" }],
		rules: [
			"원본 영상, 음악, 대사를 그대로 재사용하지 않는다.",
			"주제와 자료는 새로 조사하고 레퍼런스는 컷 호흡과 화면 배치 기준으로만 사용한다.",
			"말이 끊기지 않도록 TTS 문장 단위로 컷을 정렬한다.",
			"BGM은 원곡 복제가 아니라 mood/tempo/keyword 기반으로 새 트랙을 선택한다.",
		],
	};
}

function normalizeFormatProfiles(
	value: unknown,
	result: AnalysisJobResult,
	formats: string[],
) {
	const profiles = isRecord(value) ? value : {};
	return Object.fromEntries(
		formats.map((format) => {
			const current = isRecord(profiles[format]) ? profiles[format] : {};
			if (format !== "longform") return [format, current];
			const durationSeconds = templateDurationSeconds(
				typeof current.durationSeconds === "number"
					? current.durationSeconds
					: result.duration_seconds,
			);
			const sceneCount = normalizedSceneCount(result, durationSeconds, current);
			const avgSceneDuration = normalizedAvgSceneDuration(
				result,
				durationSeconds,
				sceneCount,
			);
			return [
				format,
				{
					...current,
					durationSeconds,
					sceneCount,
					avgSceneDuration,
				},
			];
		}),
	);
}

function normalizedSceneCount(
	result: AnalysisJobResult,
	durationSeconds = templateDurationSeconds(result.duration_seconds),
	profile: Record<string, unknown> = {},
) {
	const current =
		typeof profile.sceneCount === "number" && Number.isFinite(profile.sceneCount)
			? profile.sceneCount
			: result.scene_count;
	if (durationSeconds < LONGFORM_MIN_DURATION_SECONDS) return Math.max(1, Math.round(current));
	return Math.max(12, Math.min(36, Math.round(current || durationSeconds / 40)));
}

function normalizedAvgSceneDuration(
	result: AnalysisJobResult,
	durationSeconds = templateDurationSeconds(result.duration_seconds),
	sceneCount = normalizedSceneCount(result, durationSeconds),
) {
	if (durationSeconds < LONGFORM_MIN_DURATION_SECONDS) {
		return result.avg_scene_duration;
	}
	return Math.max(12, Math.round(durationSeconds / Math.max(1, sceneCount)));
}

function normalizeReferenceSources(value: unknown, sourceUrl: string) {
	if (Array.isArray(value) && value.length > 0) return value;
	return [{ url: sourceUrl, purpose: "구조와 제작 규칙만 참조" }];
}

async function writeGeneratedTemplates(templates: unknown[]) {
	const contents = [
		'import type { BuiltInReferenceTemplateInput } from "./reference-template-presets";',
		"",
		"// Auto-generated by scripts/reference-batch-template.ts.",
		"// Keep this file committed so analyzed reference DNA is available beyond browser localStorage.",
		`export const GENERATED_REFERENCE_TEMPLATES: BuiltInReferenceTemplateInput[] = ${JSON.stringify(templates, null, "\t")};`,
		"",
	].join("\n");
	await Promise.all([
		fs.writeFile(generatedPath, contents),
		fs.writeFile(generatedJsonPath, JSON.stringify(templates)),
	]);
}

function mustResult(job: StoredJob): AnalysisJobResult {
	if (!job.result) throw new Error(`job ${job.id} has no result`);
	return job.result;
}

function inferCategoryId(input: StoredJob | AnalysisJobResult | undefined): string {
	const raw =
		"result" in (input ?? {})
			? (input as StoredJob).result?.raw_analysis
			: (input as AnalysisJobResult | undefined)?.raw_analysis;
	const family = isRecord(raw) ? raw.inferred_family : undefined;
	if (family === "drama_recap") return "drama_recap";
	if (family === "documentary") return "mystery_doc";
	if (family === "news") return "news_issue";
	return "";
}

function labelForCategory(categoryId: string) {
	const category = REFERENCE_CHANNEL_CATEGORIES.find((item) => item.id === categoryId);
	return category?.label ?? "";
}

function categoryIdForJob(
	job: StoredJob,
	categoryMap: Record<string, { id: string; label: string }>,
) {
	const url = job.result?.source_url ?? job.input.url ?? "";
	return categoryMap[url]?.id ?? job.referenceCategoryId ?? inferCategoryId(job);
}

function categoryRank(
	job: StoredJob,
	categoryMap: Record<string, { id: string; label: string }>,
) {
	const id = categoryIdForJob(job, categoryMap);
	const index = REFERENCE_CHANNEL_CATEGORIES.findIndex((item) => item.id === id);
	return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function extractYouTubeId(url: string) {
	try {
		const parsed = new URL(url);
		if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
		if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
		const shorts = parsed.pathname.match(/\/shorts\/([^/?]+)/);
		return shorts?.[1] ?? null;
	} catch {
		return null;
	}
}

function cleanTitle(title: string, maxLength: number) {
	return title.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeTranscript(transcript: string) {
	return transcript
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
		.replace(/https?:\/\/\S+/g, "[link removed]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 2400);
}

function stableSlug(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9가-힣]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
