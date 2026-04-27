/**
 * Video render script — run via CLI:
 *   npx ts-node src/remotion/render-video.ts <scriptId>
 *
 * Or via npm script:
 *   npm run render -- <scriptId>
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import {
	makeCancelSignal,
	renderMedia,
	selectComposition,
} from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import {
	type RenderQualityPreset,
	resolveRenderOptions,
	toRenderMediaOptions,
} from "../lib/render-options";
import type { SceneShot } from "../lib/scene-shot-types";

const VIDEO_FPS = 30;
const BUNDLE_TIMEOUT_MS = 5 * 60 * 1000;
const RENDER_TIMEOUT_MS = 45 * 60 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		p,
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`Timeout: ${label} exceeded ${ms / 1000}s`)),
				ms,
			),
		),
	]);
}

async function main() {
	const scriptId = process.argv[2];
	if (!scriptId) {
		console.error(
			"Usage: npx ts-node src/remotion/render-video.ts <scriptId> [preset]",
		);
		console.error(
			"  preset: draft | balanced | high | archive (default: high)",
		);
		process.exit(1);
	}
	const presetArg = process.argv[3] as RenderQualityPreset | undefined;
	const validPresets: RenderQualityPreset[] = [
		"draft",
		"balanced",
		"high",
		"archive",
	];
	const preset =
		presetArg && validPresets.includes(presetArg) ? presetArg : "high";
	const rOpts = resolveRenderOptions({ preset });

	const supabaseUrl =
		process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
	const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

	if (!supabaseUrl || !supabaseKey) {
		console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
		process.exit(1);
	}

	const supabase = createClient(supabaseUrl, supabaseKey);

	process.stderr.write(`Loading scenes for script ${scriptId}...`);

	const { data: scenes } = await supabase
		.from("scenes")
		.select("*")
		.eq("script_id", scriptId)
		.order("order_index");

	if (!scenes || scenes.length === 0) {
		console.error("No scenes found");
		process.exit(1);
	}

	const { data: assets } = await supabase
		.from("media_assets")
		.select("scene_id, storage_path, status, type")
		.in(
			"scene_id",
			scenes.map((s) => s.id),
		)
		.eq("status", "complete");

	const imageMap = new Map<string, string>();
	const videoMap = new Map<string, string>();
	const audioMap = new Map<string, string>();
	for (const a of assets ?? []) {
		if (!a.storage_path?.startsWith("scenes/")) continue;
		const {
			data: { publicUrl },
		} = supabase.storage.from("media").getPublicUrl(a.storage_path);

		if (a.type === "tts_audio") audioMap.set(a.scene_id, publicUrl);
		else if (a.type === "video") videoMap.set(a.scene_id, publicUrl);
		else if (a.type === "image") imageMap.set(a.scene_id, publicUrl);
	}

	const remotionScenes = scenes.map((s) => {
		const resolvedShots = (
			((s as Record<string, unknown>).shots as SceneShot[] | undefined) ?? []
		).map((shot) => ({
			...shot,
			source_url:
				typeof shot.source_url === "string" &&
				shot.source_url.startsWith("scenes/")
					? supabase.storage.from("media").getPublicUrl(shot.source_url).data
							.publicUrl
					: shot.source_url,
		}));

		return {
			imageUrl: imageMap.get(s.id) ?? (s.source_url || ""),
			videoUrl: videoMap.get(s.id) ?? "",
			audioUrl: audioMap.get(s.id) ?? "",
			narration: s.narration_text,
			durationInFrames: Math.ceil(Number(s.duration_seconds) * VIDEO_FPS),
			type: s.scene_type as
				| "image"
				| "video"
				| "text_emphasis"
				| "news_overlay",
			newsTitle: s.news_title ?? "",
			newsSource: s.news_source ?? "",
			newsExcerpt: s.news_excerpt ?? "",
			newsDate: s.news_date ?? "",
			shots: resolvedShots,
			// Whisper 기반 word timings (자막 정확 sync)
			wordTimings: (s as Record<string, unknown>).word_timings as
				| Array<{ word: string; startFrame: number; endFrame: number }>
				| undefined,
			// v3: 모션 그래픽 + 색보정
			motionGraphics: (s as Record<string, unknown>).motion_graphics as
				| Array<{
						type:
							| "number_counter"
							| "lower_third"
							| "progress_bar"
							| "arrow_callout"
							| "quote_bubble"
							| "emoji_burst";
						startFrame: number;
						duration: number;
						params: Record<string, unknown>;
				  }>
				| undefined,
			colorGrade: (() => {
				const cg = (s as Record<string, unknown>).color_grade as
					| string
					| undefined;
				if (cg && cg !== "none")
					return cg as
						| "teal-orange"
						| "warm-film"
						| "cold-noir"
						| "vibrant-pop"
						| "muted-doc"
						| "retro-vhs";
				// color_grade 미설정 시 category 기반 기본값
				const cat = (s as Record<string, unknown>).category as
					| string
					| undefined;
				if (cat === "미스테리" || cat === "범죄" || cat === "horror")
					return "cold-noir";
				if (cat === "역사" || cat === "다큐") return "warm-film";
				return "teal-orange";
			})(),
		};
	});

	// Composition.tsx와 동일한 CROSSFADE 상수 사용
	const CROSSFADE = 15;
	const crossfadeTotal = Math.max(0, remotionScenes.length - 1) * CROSSFADE;
	const totalFrames =
		remotionScenes.reduce((sum, s) => sum + s.durationInFrames, 0) -
		crossfadeTotal;

	process.stderr.write(
		`${scenes.length} scenes, ${totalFrames} total frames (${totalFrames / VIDEO_FPS}s)`,
	);
	process.stderr.write("Bundling Remotion project...");

	const bundled = await withTimeout(
		bundle({
			entryPoint: path.resolve(__dirname, "index.ts"),
			webpackOverride: (config) => config,
		}),
		BUNDLE_TIMEOUT_MS,
		"bundle",
	);

	const composition = await withTimeout(
		selectComposition({
			serveUrl: bundled,
			id: "YouTubeVideo",
			inputProps: { scenes: remotionScenes },
		}),
		BUNDLE_TIMEOUT_MS,
		"selectComposition",
	);

	const outputDir = path.resolve(__dirname, "../../renders");
	if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

	const outputPath = path.join(outputDir, `${scriptId}.mp4`);

	process.stderr.write(`Rendering to ${outputPath}...`);

	process.stderr.write(
		`Render options: ${rOpts.preset} · ${rOpts.codec} · CRF ${rOpts.crf} · ${rOpts.videoBitrate}`,
	);

	const { cancel, cancelSignal } = makeCancelSignal();
	const watchdog = setTimeout(() => {
		process.stderr.write("\nRender watchdog: timeout exceeded — aborting\n");
		cancel();
	}, RENDER_TIMEOUT_MS);

	try {
		await renderMedia({
			...(toRenderMediaOptions(rOpts) as Parameters<typeof renderMedia>[0]),
			composition: { ...composition, durationInFrames: totalFrames },
			serveUrl: bundled,
			outputLocation: outputPath,
			inputProps: { scenes: remotionScenes },
			cancelSignal,
			onProgress: ({ progress }) => {
				process.stdout.write(`\rRendering: ${Math.round(progress * 100)}%`);
			},
		});
	} finally {
		clearTimeout(watchdog);
	}

	process.stderr.write(`\nRender complete: ${outputPath}`);

	// Upload to Supabase Storage
	const fileBuffer = fs.readFileSync(outputPath);
	const storagePath = `renders/${scriptId}/final.mp4`;

	process.stderr.write("Uploading to Supabase Storage...");
	const { error: uploadError } = await supabase.storage
		.from("media")
		.upload(storagePath, fileBuffer, {
			contentType: "video/mp4",
			upsert: true,
		});

	if (uploadError) {
		console.error("Upload failed:", uploadError.message);
		process.exit(1);
	}

	// Update render record
	await supabase
		.from("renders")
		.update({ storage_path: storagePath, status: "complete" })
		.eq("script_id", scriptId)
		.eq("status", "rendering");

	const {
		data: { publicUrl },
	} = supabase.storage.from("media").getPublicUrl(storagePath);

	process.stderr.write(`Upload complete: ${publicUrl}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
