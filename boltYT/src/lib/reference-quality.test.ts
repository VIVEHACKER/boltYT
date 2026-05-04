import { describe, expect, it } from "vitest";
import { scoreReferenceQuality } from "./reference-quality";

describe("scoreReferenceQuality", () => {
	it("deep DNA와 20분 정책을 만족하면 높은 등급을 준다", () => {
		const report = scoreReferenceQuality({
			duration_seconds: 900,
			scene_count: 18,
			bgm_keywords: ["cinematic", "pulse"],
			tts_tone_keywords: ["분석", "긴장"],
			script_structure: [
				{ role: "hook", duration: 12, note: "시작" },
				{ role: "setup", duration: 120, note: "배경" },
				{ role: "turn", duration: 180, note: "반전" },
				{ role: "payoff", duration: 120, note: "결론" },
			],
			transcript: "자료 기반 나레이션 ".repeat(120),
			raw_analysis: {
				analysis_depth: "pixel_frame_audio_edit",
				analysis_mode: "deep_sampled_longform",
				generated_reference: true,
				source_duration_seconds: 900,
				copy_boundary: { rawAssetsReusable: false },
				production_method: {
					rules: ["원본 금지", "문장 끝 컷", "BGM 새 선택", "자료 우선"],
					referenceSources: [{ url: "https://example.com" }],
				},
				production_dna: {
					analysisDepth: "pixel_frame_audio_edit",
					pixelPrecisionAvailable: true,
					frames: Array.from({ length: 16 }, (_, index) => ({ index })),
					camera: { sceneCutTimes: [4, 12, 30, 48, 72, 100] },
					transitions: { cutTimes: [4, 12, 30, 48, 72, 100] },
					audio: { volumeMeanDb: -18, integratedLufs: -16 },
					copyBoundary: { rawAssetsReusable: false },
				},
			},
		});

		expect(report.grade).toBe("S");
		expect(report.score).toBeGreaterThanOrEqual(92);
		expect(report.gaps).not.toContain("20분 정책 확인 필요");
	});

	it("20분 초과 generated source는 품질 점수에서 감점한다", () => {
		const report = scoreReferenceQuality({
			duration_seconds: 1200,
			scene_count: 20,
			transcript: "긴 전사 ".repeat(200),
			raw_analysis: {
				analysis_depth: "pixel_frame_audio_edit",
				generated_reference: true,
				source_duration_seconds: 1500,
				production_dna: {
					analysisDepth: "pixel_frame_audio_edit",
					pixelPrecisionAvailable: true,
				},
			},
		});

		expect(report.sourceDurationOk).toBe(false);
		expect(report.gaps).toContain("20분 정책 확인 필요");
		expect(report.score).toBeLessThan(90);
	});
});
