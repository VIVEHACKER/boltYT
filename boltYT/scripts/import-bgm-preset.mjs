#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const MOODS = new Set([
	"dark",
	"tense",
	"mysterious",
	"dramatic",
	"calm",
	"upbeat",
	"epic",
	"sad",
]);

const DEFAULTS = {
	slot: "default",
	targetLufs: "-23",
	bitrate: "192k",
	licenseBasis: "licensed",
	library: "other",
};

const LIBRARY_CLEAR_METHOD = {
	epidemic_sound: "channel_safelist",
	artlist: "channel_clearlist",
	soundstripe: "per_video_code",
	envato_elements: "per_video_tool",
	uppbeat: "claim_free",
	bgm_president: "unknown",
	mewpot: "unknown",
	sellbuymusic: "unknown",
	other: "unknown",
};

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");

function parseArgs(argv) {
	const args = { ...DEFAULTS };
	const positional = [];
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (!token.startsWith("--")) {
			positional.push(token);
			continue;
		}
		const [rawKey, inlineValue] = token.slice(2).split("=", 2);
		const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
		if (["help", "dryRun", "claimExpected", "channelCleared"].includes(key)) {
			args[key] = inlineValue === undefined ? true : inlineValue !== "false";
			continue;
		}
		const next = inlineValue ?? argv[i + 1];
		if (next === undefined || next.startsWith("--")) {
			throw new Error(`Missing value for --${rawKey}`);
		}
		args[key] = next;
		if (inlineValue === undefined) i += 1;
	}
	if (!args.source && positional[0]) args.source = positional[0];
	return args;
}

function usage() {
	return `Usage:
  npm run bgm:import -- --source ~/Downloads/track.wav --mood tense

Options:
  --source <path>              Audio file to import. Required.
  --mood <mood>                dark|tense|mysterious|dramatic|calm|upbeat|epic|sad. Required.
  --slot <name>                Preset slot. Default: default.
  --title <text>               Track title for metadata.
  --artist <text>              Artist/source label for metadata.
  --library <id>               epidemic_sound|artlist|soundstripe|envato_elements|uppbeat|bgm_president|mewpot|sellbuymusic|other.
  --license-basis <basis>      Default: licensed.
  --license-tier <text>        Subscription/license tier.
  --attribution <text>         Attribution text.
  --claim-expected             Mark Content ID claim as expected.
  --claim-clear-method <id>    channel_safelist|channel_clearlist|per_video_code|per_video_tool|claim_free|unknown.
  --channel-cleared            Mark channel safelist/clearlist done.
  --clear-code <text>          Per-video claim clear code.
  --target-lufs <number>       BGM normalization target. Default: -23.
  --bitrate <value>            MP3 bitrate. Default: 192k.
  --dry-run                    Print the planned output without writing.
`;
}

function normalizeSlot(input) {
	const raw = String(input || "default").trim().toLowerCase();
	const normalized = raw
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return normalized || "default";
}

function expandHome(filePath) {
	if (!filePath.startsWith("~/")) return filePath;
	return join(process.env.HOME || "", filePath.slice(2));
}

function run(cmd, args, label) {
	const result = spawnSync(cmd, args, { encoding: "utf8" });
	if (result.status !== 0) {
		const detail = [result.stderr, result.stdout].filter(Boolean).join("\n");
		throw new Error(`${label} failed: ${detail || `exit ${result.status}`}`);
	}
	return result.stdout.trim();
}

function commandExists(cmd) {
	const result = spawnSync(cmd, ["-version"], { encoding: "utf8" });
	return result.status === 0;
}

function probeDuration(filePath) {
	if (!commandExists("ffprobe")) return null;
	const out = run(
		"ffprobe",
		[
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			filePath,
		],
		"ffprobe duration",
	);
	const duration = Number(out);
	return Number.isFinite(duration) ? duration : null;
}

function toBool(value) {
	return value === true || value === "true" || value === "1" || value === "yes";
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		return;
	}

	if (!args.source) throw new Error("--source is required");
	if (!args.mood) throw new Error("--mood is required");
	if (!MOODS.has(args.mood)) {
		throw new Error(`Unsupported mood: ${args.mood}`);
	}

	const source = resolve(expandHome(args.source));
	if (!existsSync(source)) throw new Error(`Source file not found: ${source}`);
	const sourceExt = extname(source).toLowerCase().replace(/^\./, "");
	if (!sourceExt) throw new Error("Source file must have an audio extension");
	if (!commandExists("ffmpeg")) {
		throw new Error("ffmpeg is required. Install it first, then rerun bgm:import.");
	}

	const slot = normalizeSlot(args.slot);
	const claimClearMethod =
		args.claimClearMethod || LIBRARY_CLEAR_METHOD[args.library] || "unknown";
	// fail-closed: clearMethod 미상(unknown)도 claim 예상으로 기록 — 수익화 게이트가
	// 증적 없는 트랙을 통과시키지 않도록. claim-free 만 명시적으로 제외.
	const claimExpected =
		args.claimExpected === undefined
			? claimClearMethod !== "claim_free"
			: toBool(args.claimExpected);
	const outDir = join(projectRoot, "public", "bgm", args.mood);
	const outAudio = join(outDir, `${slot}.mp3`);
	const outMeta = join(outDir, `${slot}.json`);
	const publicAudioPath = `/bgm/${args.mood}/${slot}.mp3`;
	const publicMetaPath = `/bgm/${args.mood}/${slot}.json`;

	const plan = {
		source,
		sourceExt,
		library: args.library,
		claimClearMethod,
		claimExpected,
		outAudio,
		outMeta,
		publicAudioPath,
		publicMetaPath,
	};

	if (args.dryRun) {
		console.log(JSON.stringify(plan, null, 2));
		return;
	}

	mkdirSync(outDir, { recursive: true });
	run(
		"ffmpeg",
		[
			"-y",
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			source,
			"-vn",
			"-ac",
			"2",
			"-ar",
			"48000",
			"-codec:a",
			"libmp3lame",
			"-b:a",
			String(args.bitrate),
			"-af",
			`loudnorm=I=${args.targetLufs}:TP=-2:LRA=11`,
			outAudio,
		],
		"ffmpeg transcode",
	);

	const existingMeta = existsSync(outMeta)
		? JSON.parse(readFileSync(outMeta, "utf8"))
		: {};
	const durationSeconds = probeDuration(outAudio);
	const metadata = {
		...existingMeta,
		version: 1,
		mood: args.mood,
		slot,
		file: publicAudioPath,
		sourceFile: basename(source),
		title: args.title || existingMeta.title || basename(source, extname(source)),
		artist: args.artist || existingMeta.artist || "",
		library: args.library,
		licenseBasis: args.licenseBasis,
		licenseTier: args.licenseTier || existingMeta.licenseTier || "",
		attribution: args.attribution || existingMeta.attribution || "",
		contentId: {
			claimExpected,
			clearMethod: claimClearMethod,
			channelCleared: toBool(args.channelCleared),
			clearCode: args.clearCode || existingMeta.contentId?.clearCode || "",
		},
		durationSeconds,
		importedAt: new Date().toISOString(),
		processing: {
			targetLufs: Number(args.targetLufs),
			truePeakDb: -2,
			lra: 11,
			sampleRate: 48000,
			channels: 2,
			bitrate: String(args.bitrate),
		},
	};

	writeFileSync(outMeta, `${JSON.stringify(metadata, null, 2)}\n`);

	console.log(`Imported BGM preset: ${publicAudioPath}`);
	console.log(`Metadata: ${publicMetaPath}`);
	console.log("autoPickBgm will use this when the selected mood matches.");
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
