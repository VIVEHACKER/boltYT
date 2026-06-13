import type { BgmMood } from "./bgm";

export const BGM_PRESET_MOODS = [
	"dark",
	"tense",
	"mysterious",
	"dramatic",
	"calm",
	"upbeat",
	"epic",
	"sad",
] as const satisfies readonly BgmMood[];

const DEFAULT_BGM_PRESET_SLOT = "default";

export const BGM_PRESET_AUDIO_EXTENSIONS = [
	"mp3",
	"wav",
	"m4a",
	"aac",
	"ogg",
	"flac",
] as const;

export type BgmPresetAudioExtension =
	(typeof BGM_PRESET_AUDIO_EXTENSIONS)[number];

export function isBgmPresetMood(value: string): value is BgmMood {
	return (BGM_PRESET_MOODS as readonly string[]).includes(value);
}

function isBgmPresetAudioExtension(
	value: string,
): value is BgmPresetAudioExtension {
	return (BGM_PRESET_AUDIO_EXTENSIONS as readonly string[]).includes(value);
}

export function normalizeBgmPresetExtension(
	value: string,
): BgmPresetAudioExtension | null {
	const normalized = value.trim().toLowerCase().replace(/^\./, "");
	return isBgmPresetAudioExtension(normalized) ? normalized : null;
}

export function normalizeBgmPresetSlot(input?: string): string {
	const raw = (input ?? DEFAULT_BGM_PRESET_SLOT).trim().toLowerCase();
	const normalized = raw
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return normalized || DEFAULT_BGM_PRESET_SLOT;
}

export function buildLocalPresetPath(
	mood: BgmMood,
	slot = DEFAULT_BGM_PRESET_SLOT,
	ext: BgmPresetAudioExtension = "mp3",
): string {
	return `/bgm/${mood}/${normalizeBgmPresetSlot(slot)}.${ext}`;
}

export function buildLocalPresetMetadataPath(
	mood: BgmMood,
	slot = DEFAULT_BGM_PRESET_SLOT,
): string {
	return `/bgm/${mood}/${normalizeBgmPresetSlot(slot)}.json`;
}
