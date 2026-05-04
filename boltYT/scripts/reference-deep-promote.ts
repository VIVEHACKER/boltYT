import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	LONGFORM_MAX_DURATION_SECONDS,
	SHORTS_MAX_DURATION_SECONDS,
} from "../src/lib/reference-duration-policy.ts";

type ReferenceAnalysisMode = "auto" | "shortform" | "longform" | "deep";

interface GeneratedReferenceTemplate {
	id: string;
	channel_id: string;
	name: string;
	source_type: "youtube" | "file";
	source_url: string;
	source_title: string;
	source_creator: string;
	thumbnail_url: string;
	duration_seconds: number;
	dominant_colors: string[];
	visual_mood: string;
	visual_prompt_template: string;
	lighting_style: string;
	subtitle_position: string;
	subtitle_size_preset: string;
	subtitle_bg_style: string;
	subtitle_accent_color: string;
	scene_count: number;
	avg_scene_duration: number;
	hook_duration: number;
	transition_style: string;
	pacing_preset: string;
	tts_voice_id: string;
	tts_provider: string;
	tts_speed: number;
	tts_tone_keywords: string[];
	bgm_mood: string;
	bgm_keywords: string[];
	bgm_tempo: string;
	bgm_reference_url: string;
	hook_pattern: string;
	script_structure: Array<{ role: string; duration: number; note: string }>;
	transcript: string;
	frame_urls: string[];
	raw_analysis: Record<string, unknown>;
	analysis_status: string;
	analysis_error: string;
	created_at: string;
	updated_at: string;
}

interface AnalysisJob {
	id: string;
	status:
		| "queued"
		| "downloading"
		| "extracting"
		| "transcribing"
		| "analyzing"
		| "complete"
		| "failed";
	progress: number;
	input: {
		type: "youtube" | "file";
		url?: string;
		mode?: ReferenceAnalysisMode;
	};
	result?: GeneratedReferenceTemplate;
	error?: string;
	createdAt: string;
	completedAt?: string;
}

interface PromoteOptions {
	targetPerCategory: number;
	limit: number;
	dryRun: boolean;
	retryDeep: boolean;
	timeoutMs: number;
	adoptJobId: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const generatedPath = path.join(
	repoRoot,
	"src/lib/generated-reference-template-presets.ts",
);
const generatedJsonPath = path.join(
	repoRoot,
	"public/generated-reference-template-presets.json",
);
const analyzerBase = process.env.REFERENCE_ANALYZER_URL ?? "http://localhost:3460";
const options = parseArgs(process.argv.slice(2));

async function main() {
	if (!options.dryRun) await ensureAnalyzerReady();
	const templates = await readGeneratedTemplates();
	if (options.adoptJobId) {
		const final = await fetchJob(options.adoptJobId);
		if (final.status !== "complete" || !final.result) {
			throw new Error(
				`job ${options.adoptJobId} is not complete: ${final.status} ${
					final.error ?? ""
				}`,
			);
		}
		const index = templates.findIndex(
			(template) => template.source_url === final.result?.source_url,
		);
		if (index < 0) {
			throw new Error(`no generated template for ${final.result.source_url}`);
		}
		const nextTemplates = [...templates];
		nextTemplates[index] = mergeDeepResult(
			templates[index],
			final.result,
			final.id,
		);
		await writeGeneratedTemplates(nextTemplates);
		console.log(
			JSON.stringify(
				{
					ok: true,
					adopted: final.id,
					template: templates[index].id,
					coverage: summarizeDepth(nextTemplates),
					output: path.relative(repoRoot, generatedPath),
				},
				null,
				2,
			),
		);
		return;
	}
	const targets = selectTargets(templates, options);
	const actions: string[] = [];

	if (options.dryRun) {
		console.log(
			JSON.stringify(
				{
					ok: true,
					dryRun: true,
					targets: targets.map((target) => ({
						id: target.id,
						category: target.raw_analysis.reference_category_label,
						title: target.source_title,
						url: target.source_url,
					})),
				},
				null,
				2,
			),
		);
		return;
	}

	const nextTemplates = [...templates];
	let promotedCount = 0;
	for (const target of targets) {
		try {
			actions.push(`start ${target.name}`);
			const job = await startAnalysis(target.source_url, "deep");
			const final = await waitForJob(job.id, options.timeoutMs);
			if (final.status !== "complete" || !final.result) {
				actions.push(`failed ${target.name}: ${final.error ?? "unknown"}`);
				continue;
			}
			const index = nextTemplates.findIndex((item) => item.id === target.id);
			if (index >= 0) {
				nextTemplates[index] = mergeDeepResult(target, final.result, final.id);
				promotedCount += 1;
				actions.push(`promoted ${target.name} (${final.id})`);
			}
		} catch (error) {
			actions.push(
				`failed ${target.name}: ${
					error instanceof Error ? error.message : "unknown"
				}`,
			);
		}
	}

	await writeGeneratedTemplates(nextTemplates);
	const coverage = summarizeDepth(nextTemplates);
	console.log(
		JSON.stringify(
			{
				ok: true,
				promoted: promotedCount,
				attempted: targets.length,
				coverage,
				actions,
				output: path.relative(repoRoot, generatedPath),
			},
			null,
			2,
		),
	);
}

function parseArgs(args: string[]): PromoteOptions {
	return {
		targetPerCategory: readPositiveInt(args, "--target-per-category", 1),
		limit: readPositiveInt(args, "--limit", 5),
		dryRun: args.includes("--dry-run"),
		retryDeep: args.includes("--retry-deep"),
		timeoutMs: readPositiveInt(args, "--timeout-ms", 20 * 60 * 1000),
		adoptJobId: readString(args, "--adopt-job", ""),
	};
}

function readString(args: string[], key: string, fallback: string): string {
	const index = args.indexOf(key);
	if (index >= 0) return args[index + 1] ?? fallback;
	const inline = args.find((arg) => arg.startsWith(`${key}=`));
	return inline ? inline.slice(key.length + 1) : fallback;
}

function readPositiveInt(args: string[], key: string, fallback: number): number {
	const index = args.indexOf(key);
	const raw = index >= 0 ? args[index + 1] : undefined;
	const inline = args.find((arg) => arg.startsWith(`${key}=`));
	const value = Number(inline ? inline.slice(key.length + 1) : raw);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function ensureAnalyzerReady() {
	const res = await fetch(`${analyzerBase}/health`);
	if (!res.ok) throw new Error(`reference analyzer unavailable: ${res.status}`);
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
	timeoutMs: number,
): Promise<AnalysisJob> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const data = { job: await fetchJob(jobId) };
		if (data.job.status === "complete" || data.job.status === "failed") {
			return data.job;
		}
		await new Promise((resolve) => setTimeout(resolve, 5000));
	}
	throw new Error(`job ${jobId} timed out`);
}

async function fetchJob(jobId: string): Promise<AnalysisJob> {
	const res = await fetch(`${analyzerBase}/api/reference/job/${jobId}`);
	if (!res.ok) throw new Error(`job fetch failed ${res.status}`);
	const data = (await res.json()) as { job: AnalysisJob };
	return data.job;
}

async function readGeneratedTemplates(): Promise<GeneratedReferenceTemplate[]> {
	const text = await fs.readFile(generatedPath, "utf8");
	const match = text.match(/= (\[[\s\S]*\]);\s*$/);
	if (!match) throw new Error("generated reference template file is malformed");
	return JSON.parse(match[1]) as GeneratedReferenceTemplate[];
}

function selectTargets(
	templates: GeneratedReferenceTemplate[],
	opts: PromoteOptions,
): GeneratedReferenceTemplate[] {
	const byCategory = new Map<string, GeneratedReferenceTemplate[]>();
	for (const template of templates) {
		const categoryId = stringField(template.raw_analysis.reference_category_id);
		if (!categoryId) continue;
		const list = byCategory.get(categoryId) ?? [];
		list.push(template);
		byCategory.set(categoryId, list);
	}

	const targets: GeneratedReferenceTemplate[] = [];
	for (const list of byCategory.values()) {
		const deepCount = list.filter((template) => isDeepTemplate(template)).length;
		const needed = Math.max(0, opts.targetPerCategory - deepCount);
		if (needed === 0 && !opts.retryDeep) continue;
		const candidates = list
			.filter(
				(template) =>
					(opts.retryDeep || !isDeepTemplate(template)) &&
					isPromotableReferenceDuration(template),
			)
			.sort((a, b) => scoreTemplateForDeep(a) - scoreTemplateForDeep(b))
			.slice(0, needed || opts.targetPerCategory);
		targets.push(...candidates);
		if (targets.length >= opts.limit) return targets.slice(0, opts.limit);
	}
	return targets.slice(0, opts.limit);
}

function isPromotableReferenceDuration(template: GeneratedReferenceTemplate): boolean {
	const sourceDuration =
		Number(template.raw_analysis.source_duration_seconds) ||
		Number(template.duration_seconds) ||
		0;
	return (
		sourceDuration <= SHORTS_MAX_DURATION_SECONDS ||
		sourceDuration <= LONGFORM_MAX_DURATION_SECONDS
	);
}

function scoreTemplateForDeep(template: GeneratedReferenceTemplate): number {
	const duration = Number(template.duration_seconds) || 0;
	const hasChapters = Array.isArray(template.raw_analysis.chapters)
		? template.raw_analysis.chapters.length
		: 0;
	const hasHeatmap = Array.isArray(template.raw_analysis.heatmap_peaks)
		? template.raw_analysis.heatmap_peaks.length
		: 0;
	const isLocalFallback =
		template.raw_analysis.analysis_mode === "deep_local_frame_audio_edit";
	return duration - hasChapters * 60 - hasHeatmap * 90 - (isLocalFallback ? 1_000_000 : 0);
}

function isDeepTemplate(template: GeneratedReferenceTemplate): boolean {
	const raw = template.raw_analysis;
	const dna = isRecord(raw.production_dna) ? raw.production_dna : undefined;
	return (
		raw.analysis_depth === "pixel_frame_audio_edit" ||
		raw.analysis_mode === "deep_sampled_longform" ||
		dna?.analysisDepth === "pixel_frame_audio_edit"
	);
}

function mergeDeepResult(
	previous: GeneratedReferenceTemplate,
	result: GeneratedReferenceTemplate,
	jobId: string,
): GeneratedReferenceTemplate {
	const previousRaw = previous.raw_analysis;
	const resultRaw = result.raw_analysis ?? {};
	const productionMethod = isRecord(resultRaw.production_method)
		? resultRaw.production_method
		: previousRaw.production_method;
	const raw = sanitizeRawAnalysis({
		...previousRaw,
		...resultRaw,
		production_method: productionMethod,
		built_in_reference: true,
		generated_reference: true,
		generated_from_job_id: jobId,
		reference_category_id: previousRaw.reference_category_id,
		reference_category_label: previousRaw.reference_category_label,
	});
	return {
		...previous,
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
		transition_style: result.transition_style,
		pacing_preset: result.pacing_preset,
		tts_speed: result.tts_speed,
		tts_tone_keywords: result.tts_tone_keywords,
		bgm_mood: result.bgm_mood,
		bgm_keywords: result.bgm_keywords,
		bgm_tempo: result.bgm_tempo,
		hook_pattern: result.hook_pattern,
		transcript: sanitizeTranscript(result.transcript || previous.transcript),
		frame_urls: [],
		raw_analysis: raw,
		updated_at: new Date().toISOString(),
	};
}

function sanitizeRawAnalysis(raw: Record<string, unknown>) {
	const copy = { ...raw };
	delete copy.automatic_caption_languages;
	delete copy.subtitle_languages;
	if (isRecord(copy.production_dna)) {
		copy.production_dna = sanitizeProductionDna(copy.production_dna);
	}
	return copy;
}

function sanitizeProductionDna(dna: Record<string, unknown>) {
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

async function writeGeneratedTemplates(templates: GeneratedReferenceTemplate[]) {
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

function summarizeDepth(templates: GeneratedReferenceTemplate[]) {
	return templates.reduce<Record<string, { total: number; deep: number }>>(
		(acc, template) => {
			const categoryId =
				stringField(template.raw_analysis.reference_category_id) || "unknown";
			acc[categoryId] ??= { total: 0, deep: 0 };
			acc[categoryId].total += 1;
			if (isDeepTemplate(template)) acc[categoryId].deep += 1;
			return acc;
		},
		{},
	);
}

function sanitizeTranscript(transcript: string) {
	return transcript
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
		.replace(/https?:\/\/\S+/g, "[link removed]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 2400);
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
