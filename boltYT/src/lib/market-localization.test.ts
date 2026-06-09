import { describe, expect, it } from "vitest";
import {
	extractTranslatableFields,
	getMarketProfile,
	mergeTranslatedFields,
	planLocalization,
	rankMarketsByRoi,
} from "./market-localization";

describe("getMarketProfile", () => {
	it("returns exact locale match", () => {
		expect(getMarketProfile("en-US")?.relativeRpm).toBe(4.1);
		expect(getMarketProfile("ja-JP")?.tier).toBe("tier2");
	});

	it("falls back from a bare language code to its default locale", () => {
		expect(getMarketProfile("en")?.locale).toBe("en-US");
		expect(getMarketProfile("ja")?.locale).toBe("ja-JP");
	});

	it("returns null for unknown markets", () => {
		expect(getMarketProfile("xx-YY")).toBeNull();
		expect(getMarketProfile("")).toBeNull();
	});
});

describe("rankMarketsByRoi", () => {
	it("orders English markets above Japan for a Korean source (refutes the 2.6x Japan myth)", () => {
		const ranked = rankMarketsByRoi("ko-KR", ["ja-JP", "en-GB", "en-US"]);
		expect(ranked.map((m) => m.profile.locale)).toEqual([
			"en-US",
			"en-GB",
			"ja-JP",
		]);
		const us = ranked.find((m) => m.profile.locale === "en-US");
		const jp = ranked.find((m) => m.profile.locale === "ja-JP");
		expect(us?.recommendation).toBe("prioritize");
		// 일본은 한국 대비 ~1.17배뿐 → consider (우선순위 아님)
		expect(jp?.recommendation).toBe("consider");
		expect(jp?.expectedRpmLift).toBeCloseTo(1.17, 2);
	});

	it("classifies low-tier markets as skip", () => {
		const ranked = rankMarketsByRoi("ko-KR", ["hi-IN", "pt-BR"]);
		expect(ranked.every((m) => m.recommendation === "skip")).toBe(true);
	});

	it("excludes targets sharing the source language", () => {
		const ranked = rankMarketsByRoi("en-US", ["en-GB", "ja-JP"]);
		expect(ranked.map((m) => m.profile.locale)).toEqual(["ja-JP"]);
	});

	it("dedupes repeated locales", () => {
		const ranked = rankMarketsByRoi("ko-KR", ["en-US", "en-US"]);
		expect(ranked).toHaveLength(1);
	});
});

describe("planLocalization", () => {
	it("plans variants that reuse visuals and only localize text/audio", () => {
		const plan = planLocalization({
			sourceLocale: "ko-KR",
			format: "longform",
			targetLocales: ["en-US", "en-GB"],
			hasMultiAudioAccess: true,
		});
		expect(plan.variants).toHaveLength(2);
		for (const variant of plan.variants) {
			expect(variant.assetsToRegenerate.visuals).toBe(false);
			expect(variant.assetsToRegenerate.tts).toBe(true);
			expect(variant.assetsToRegenerate.script).toBe(true);
			expect(variant.deliveryMode).toBe("multi_audio_track");
		}
		expect(plan.variants[0].locale).toBe("en-US");
	});

	it("falls back to separate_upload without multi-audio access and warns", () => {
		const plan = planLocalization({
			sourceLocale: "ko-KR",
			format: "longform",
			targetLocales: ["en-US"],
			hasMultiAudioAccess: false,
		});
		expect(plan.variants[0].deliveryMode).toBe("separate_upload");
		expect(plan.variants[0].warnings.join(" ")).toContain("별도 채널");
	});

	it("warns that Shorts revenue depends on viewer geography, not dubbing", () => {
		const plan = planLocalization({
			sourceLocale: "ko-KR",
			format: "shorts",
			targetLocales: ["en-US"],
			hasMultiAudioAccess: true,
		});
		expect(plan.variants[0].warnings.join(" ")).toContain(
			"시청자 국가별 공동 풀",
		);
	});

	it("records skipped markets with reasons", () => {
		const plan = planLocalization({
			sourceLocale: "ko-KR",
			format: "longform",
			targetLocales: ["hi-IN", "xx-YY"],
		});
		expect(plan.variants).toHaveLength(0);
		const reasons = plan.skipped.map((s) => s.locale);
		expect(reasons).toContain("hi-IN");
		expect(reasons).toContain("xx-YY");
		expect(plan.warnings.join(" ")).toContain("영어권");
	});
});

describe("extractTranslatableFields / mergeTranslatedFields", () => {
	const content: Record<string, unknown> = {
		title: "한국 제목",
		shorts_script: "쇼츠 대본",
		thumbnail_text: "썸네일 문구",
		shorts_hooks: ["훅1", "훅2"],
		longform_scenes: [
			{
				narration: "씬1 나레이션",
				visual_prompt: "a dark forest",
				duration: 8,
				mood: "mystery",
			},
			{
				narration: "씬2 나레이션",
				visual_prompt: "a bright city",
				duration: 8,
				mood: "warm",
			},
		],
	};

	it("extracts only translatable text, index-aligned scene narrations", () => {
		const fields = extractTranslatableFields(content);
		expect(fields.title).toBe("한국 제목");
		expect(fields.shortsScript).toBe("쇼츠 대본");
		expect(fields.thumbnailText).toBe("썸네일 문구");
		expect(fields.hooks).toEqual(["훅1", "훅2"]);
		expect(fields.sceneNarrations).toEqual(["씬1 나레이션", "씬2 나레이션"]);
	});

	it("merges translations back while preserving visual_prompt and other scene fields", () => {
		const translated = {
			title: "English Title",
			shortsScript: "English shorts script",
			thumbnailText: "Thumbnail text",
			hooks: ["Hook 1", "Hook 2"],
			sceneNarrations: ["Scene 1 narration", "Scene 2 narration"],
		};
		const merged = mergeTranslatedFields(content, translated);
		expect(merged.title).toBe("English Title");
		expect(merged.shorts_script).toBe("English shorts script");
		const scenes = merged.longform_scenes as Array<Record<string, unknown>>;
		expect(scenes[0].narration).toBe("Scene 1 narration");
		// 비주얼 프롬프트와 기타 필드는 보존 (영상 재사용)
		expect(scenes[0].visual_prompt).toBe("a dark forest");
		expect(scenes[0].duration).toBe(8);
		expect(scenes[1].mood).toBe("warm");
	});

	it("does not mutate the original content", () => {
		const snapshot = JSON.parse(JSON.stringify(content));
		mergeTranslatedFields(content, {
			title: "X",
			hooks: [],
			sceneNarrations: ["A", "B"],
		});
		expect(content).toEqual(snapshot);
	});

	it("keeps original narration when a translation slot is empty", () => {
		const merged = mergeTranslatedFields(content, {
			hooks: [],
			sceneNarrations: ["", "Scene 2 only"],
		});
		const scenes = merged.longform_scenes as Array<Record<string, unknown>>;
		expect(scenes[0].narration).toBe("씬1 나레이션");
		expect(scenes[1].narration).toBe("Scene 2 only");
	});
});
