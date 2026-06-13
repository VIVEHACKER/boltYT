import { describe, expect, it } from "vitest";
import {
	BGM_PRESET_AUDIO_EXTENSIONS,
	BGM_PRESET_MOODS,
	buildLocalPresetMetadataPath,
	buildLocalPresetPath,
	isBgmPresetMood,
	normalizeBgmPresetExtension,
	normalizeBgmPresetSlot,
} from "./bgm-local-preset";

describe("BGM local preset helpers", () => {
	it("keeps the production mood set in one place", () => {
		expect(BGM_PRESET_MOODS).toHaveLength(8);
		expect(isBgmPresetMood("tense")).toBe(true);
		expect(isBgmPresetMood("lofi")).toBe(false);
	});

	it("normalizes preset slots to safe static asset names", () => {
		expect(normalizeBgmPresetSlot("Main Hook 01")).toBe("main-hook-01");
		expect(normalizeBgmPresetSlot("")).toBe("default");
	});

	it("builds the default mp3 path used by auto BGM selection", () => {
		expect(buildLocalPresetPath("tense")).toBe("/bgm/tense/default.mp3");
		expect(buildLocalPresetPath("tense", "news pulse")).toBe(
			"/bgm/tense/news-pulse.mp3",
		);
	});

	it("builds metadata paths next to the audio file", () => {
		expect(buildLocalPresetMetadataPath("dramatic", "NASA track")).toBe(
			"/bgm/dramatic/nasa-track.json",
		);
	});

	it("accepts only supported audio extensions", () => {
		expect(BGM_PRESET_AUDIO_EXTENSIONS).toContain("mp3");
		expect(normalizeBgmPresetExtension(".WAV")).toBe("wav");
		expect(normalizeBgmPresetExtension("exe")).toBeNull();
	});
});
