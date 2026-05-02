import { describe, expect, it } from "vitest";
import {
	buildMetadataProductionDna,
	buildReferenceProductionDna,
	inferReferenceCameraMode,
	type ReferencePixelFrameMetrics,
} from "./reference-production-dna.ts";
import type { RenderReferenceProfile } from "./render-output-qc.ts";

function frame(
	index: number,
	overrides: Partial<ReferencePixelFrameMetrics> = {},
): ReferencePixelFrameMetrics {
	return {
		index,
		path: `/tmp/frame-${index}.jpg`,
		brightness: 0.44,
		contrast: 0.18,
		saturation: 0.32,
		warmth: 0.57,
		edgeDensity: 0.09,
		subjectZone: "center",
		dominantTone: "balanced_midtone",
		subtitleBandRisk: "medium",
		cellMap: [],
		...overrides,
	};
}

function profile(overrides: Partial<RenderReferenceProfile> = {}) {
	return {
		durationSeconds: 30,
		width: 1080,
		height: 1920,
		aspectRatio: 0.5625,
		fps: 30,
		visualRegion: {
			frameCount: 60,
			avgDiff: 0.02,
			maxDiff: 0.08,
			meaningfulDiffs: 8,
			strongDiffs: 2,
			first3AvgDiff: 0.026,
		},
		fullFrame: {
			frameCount: 60,
			avgDiff: 0.03,
			maxDiff: 0.1,
			meaningfulDiffs: 10,
			strongDiffs: 3,
			first3AvgDiff: 0.04,
		},
		sceneCuts: {
			selectedFrames: 9,
			estimatedCuts: 8,
			times: [1.8, 4.2, 7.1, 10.4, 13.6, 17.2, 21.5, 25.4],
		},
		cutDensityPerMinute: 16,
		avgCutIntervalSeconds: 3.75,
		volume: { meanDb: -19, maxDb: -3 },
		loudness: {
			integratedLufs: -14.5,
			loudnessRangeLu: 5.2,
			truePeakDbfs: -1.1,
		},
		...overrides,
	} satisfies RenderReferenceProfile;
}

describe("inferReferenceCameraMode", () => {
	it("컷 밀도가 매우 높으면 cut_driven", () => {
		expect(
			inferReferenceCameraMode({
				cutDensityPerMinute: 24,
				avgDiff: 0.01,
				first3AvgDiff: 0.012,
			}),
		).toBe("cut_driven");
	});

	it("컷은 적고 프레임 변화가 크면 handheld", () => {
		expect(
			inferReferenceCameraMode({
				cutDensityPerMinute: 2,
				avgDiff: 0.07,
				first3AvgDiff: 0.04,
			}),
		).toBe("handheld");
	});

	it("변화가 거의 없으면 static", () => {
		expect(
			inferReferenceCameraMode({
				cutDensityPerMinute: 1,
				avgDiff: 0.006,
				first3AvgDiff: 0.007,
			}),
		).toBe("static");
	});
});

describe("buildReferenceProductionDna", () => {
	it("픽셀 프레임과 QC 프로필을 production DNA로 요약", () => {
		const dna = buildReferenceProductionDna({
			analysisDepth: "pixel_frame_audio_edit",
			pixelPrecisionAvailable: true,
			durationSeconds: 30,
			analysis: {
				visual_mood: "mystery",
				lighting_style: "mixed",
				subtitle_position: "bottom",
				subtitle_size_preset: "lg",
				subtitle_bg_style: "stroke",
				bgm_mood: "tense",
				bgm_tempo: "fast",
				transition_rules: ["첫 문장 끝에서 hard cut"],
			},
			frameProfile: profile(),
			frameQcReport: null,
			frames: [
				frame(1, { subjectZone: "middle_right" }),
				frame(2, { subjectZone: "middle_right", subtitleBandRisk: "high" }),
			],
		});

		expect(dna.analysisDepth).toBe("pixel_frame_audio_edit");
		expect(dna.pixelPrecisionAvailable).toBe(true);
		expect(dna.layout.subjectZone).toBe("middle_right");
		expect(dna.layout.subtitleCollisionRisk).toBe("high");
		expect(dna.camera.cutDensityPerMinute).toBe(16);
		expect(dna.audio.integratedLufs).toBe(-14.5);
		expect(dna.transitions.rules).toContain("첫 문장 끝에서 hard cut");
	});
});

describe("buildMetadataProductionDna", () => {
	it("롱폼 메타데이터 분석은 metadata_only로 저장", () => {
		const dna = buildMetadataProductionDna({
			durationSeconds: 1800,
			sceneCount: 24,
			avgSceneDuration: 75,
			hookDuration: 12,
			chapterCutTimes: [0, 120, 260, 420],
			analysis: {
				visual_mood: "news",
				lighting_style: "natural",
				transition_style: "hardcut",
				bgm_mood: "tense",
				bgm_tempo: "mid",
			},
		});

		expect(dna.analysisDepth).toBe("metadata_only");
		expect(dna.pixelPrecisionAvailable).toBe(false);
		expect(dna.layout.frameSize).toEqual({ width: 1920, height: 1080 });
		expect(dna.camera.cutDensityPerMinute).toBe(0.8);
		expect(dna.copyBoundary.rawAssetsReusable).toBe(false);
	});
});
