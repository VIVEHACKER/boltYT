import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMetadataProductionDna } from "../server/lib/reference-production-dna.ts";

type ReferenceAnalysisMode = "auto" | "shortform" | "longform" | "deep";

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
	};
}

interface StoredJob extends AnalysisJob {
	referenceCategoryId?: string;
	referenceCategoryLabel?: string;
}

interface BatchOptions {
	targetPerCategory?: number;
	incrementPerCategory: number;
	maxChannels: number;
	resultsPerQuery: number;
	daysBack: number;
	candidatePool: number;
	order: "viewCount" | "date" | "relevance";
	retryFailed: boolean;
	offline: boolean;
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

		let candidates: ReferenceChannelCandidate[];
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

function parseArgs(args: string[]): BatchOptions {
	const targetPerCategory = readOptionalPositiveInt(args, "--target-per-category");
	const incrementPerCategory = readPositiveInt(args, "--increment-per-category", 0);
	const targetHint = targetPerCategory ?? Math.max(3, incrementPerCategory + 3);
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
	return {
		targetPerCategory,
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
	};
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

function buildGeneratedTemplates(
	jobs: StoredJob[],
	categoryMap: Record<string, { id: string; label: string }>,
) {
	const latestByUrl = new Map<string, StoredJob>();
	for (const job of jobs) {
		if (job.status !== "complete" || !job.result?.source_url) continue;
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

	return {
		id: `builtin-auto-${stableSlug(categoryId || "reference")}-${stableSlug(youtubeId)}`,
		channel_id: "__builtin_reference__",
		name,
		source_type: result.source_type,
		source_url: result.source_url,
		source_title: result.source_title,
		source_creator: result.source_creator,
		thumbnail_url: result.thumbnail_url,
		duration_seconds: result.duration_seconds,
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
	if (isRecord(method)) {
		return {
			...method,
			referenceSources: normalizeReferenceSources(
				method.referenceSources,
				result.source_url,
			),
		};
	}
	const supportedFormats = result.duration_seconds > 180 ? ["longform"] : ["shorts"];
	return {
		id: `auto-${categoryId || "reference"}`,
		label: `${categoryLabel || "자동"} 레퍼런스`,
		description:
			"인기 채널 대표 영상을 분석해 대본, TTS, BGM, 컷 호흡, 화면 배치를 재사용 가능한 제작 규칙으로 변환합니다.",
		recommendedMode: "research",
		supportedFormats,
		formatProfiles: {
			[supportedFormats[0]]: {
				durationSeconds: Math.round(result.duration_seconds),
				sceneCount: result.scene_count,
				avgSceneDuration: result.avg_scene_duration,
				hookDuration: result.hook_duration,
			},
		},
		sceneLayout: "full",
		sceneLayouts: Object.fromEntries(
			supportedFormats.map((format) => [format, "full"]),
		),
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
	await fs.writeFile(generatedPath, contents);
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
