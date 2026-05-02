import { describe, expect, it } from "vitest";
import {
	applyReferenceComparisonToReport,
	buildRenderOutputQcReport,
	profileFromRenderOutputQc,
} from "./render-output-qc.js";

const baseMeta = {
	duration: 8,
	sizeBytes: 3_000_000,
	bitRate: 3_000_000,
	video: {
		codec: "h264",
		width: 1080,
		height: 1920,
		fps: 30,
		frames: 240,
		bitRate: 2_600_000,
	},
	audio: {
		codec: "aac",
		channels: 2,
		sampleRate: 48_000,
		bitRate: 317_000,
	},
};

describe("render-output-qc", () => {
	it("정상 포맷, 오디오, 초반 컷 밀도가 있으면 통과한다", () => {
		const report = buildRenderOutputQcReport({
			file: "/tmp/good.mp4",
			meta: baseMeta,
			visualDiff: {
				frameCount: 16,
				avgDiff: 0.08,
				maxDiff: 0.2,
				meaningfulDiffs: 8,
				strongDiffs: 4,
				first3AvgDiff: 0.05,
			},
			fullDiff: {
				frameCount: 16,
				avgDiff: 0.06,
				maxDiff: 0.17,
				meaningfulDiffs: 7,
				strongDiffs: 3,
				first3AvgDiff: 0.04,
			},
			sceneCuts: {
				selectedFrames: 4,
				estimatedCuts: 3,
				times: [0.03, 1.4, 2.8, 5.2],
			},
			black: { segments: [], count: 0 },
			volume: { meanDb: -20, maxDb: -5 },
		});

		expect(report.passed).toBe(true);
		expect(report.score).toBe(100);
		expect(report.issues).toEqual([]);
	});

	it("정적인 배경에 오디오만 있는 결과는 fail 처리한다", () => {
		const report = buildRenderOutputQcReport({
			file: "/tmp/static.mp4",
			meta: baseMeta,
			visualDiff: {
				frameCount: 12,
				avgDiff: 0.004,
				maxDiff: 0.006,
				meaningfulDiffs: 0,
				strongDiffs: 0,
				first3AvgDiff: 0.004,
			},
			fullDiff: {
				frameCount: 12,
				avgDiff: 0.004,
				maxDiff: 0.006,
				meaningfulDiffs: 0,
				strongDiffs: 0,
				first3AvgDiff: 0.004,
			},
			sceneCuts: {
				selectedFrames: 1,
				estimatedCuts: 0,
				times: [0.03],
			},
			black: { segments: [], count: 0 },
			volume: { meanDb: -20, maxDb: -5 },
		});

		expect(report.passed).toBe(false);
		expect(report.verdict).toBe("fail");
		expect(report.issues).toContain("low_visual_variation");
		expect(report.issues).toContain("weak_opening_hook");
		expect(report.issues).toContain("low_cut_density");
	});

	it("LUFS/True Peak 기준을 벗어난 오디오는 마스터링 이슈로 잡는다", () => {
		const report = buildRenderOutputQcReport({
			file: "/tmp/hot-audio.mp4",
			meta: baseMeta,
			visualDiff: {
				frameCount: 16,
				avgDiff: 0.08,
				maxDiff: 0.2,
				meaningfulDiffs: 8,
				strongDiffs: 4,
				first3AvgDiff: 0.05,
			},
			fullDiff: {
				frameCount: 16,
				avgDiff: 0.06,
				maxDiff: 0.17,
				meaningfulDiffs: 7,
				strongDiffs: 3,
				first3AvgDiff: 0.04,
			},
			sceneCuts: {
				selectedFrames: 4,
				estimatedCuts: 3,
				times: [0.03, 1.4, 2.8, 5.2],
			},
			black: { segments: [], count: 0 },
			volume: { meanDb: -18, maxDb: -2 },
			loudness: {
				integratedLufs: -10.5,
				loudnessRangeLu: 18,
				truePeakDbfs: -0.2,
			},
		});

		expect(report.passed).toBe(false);
		expect(report.issues).toContain("audio_loudness_needs_master");
		expect(report.issues).toContain("audio_true_peak_too_hot");
		expect(report.issues).toContain("audio_too_dynamic_for_mobile");
		expect(report.requiredActions.join(" ")).toContain("통합 라우드니스");
	});

	it("레퍼런스 대비 컷 밀도와 훅 변화량이 낮으면 비교 이슈를 추가한다", () => {
		const reference = buildRenderOutputQcReport({
			file: "/tmp/reference.mp4",
			meta: baseMeta,
			visualDiff: {
				frameCount: 24,
				avgDiff: 0.09,
				maxDiff: 0.22,
				meaningfulDiffs: 12,
				strongDiffs: 6,
				first3AvgDiff: 0.08,
			},
			fullDiff: {
				frameCount: 24,
				avgDiff: 0.08,
				maxDiff: 0.2,
				meaningfulDiffs: 11,
				strongDiffs: 5,
				first3AvgDiff: 0.07,
			},
			sceneCuts: {
				selectedFrames: 7,
				estimatedCuts: 6,
				times: [0.4, 1.2, 2.1, 3.4, 4.8, 6.2, 7.5],
			},
			black: { segments: [], count: 0 },
			volume: { meanDb: -18, maxDb: -4 },
			loudness: {
				integratedLufs: -16,
				loudnessRangeLu: 7,
				truePeakDbfs: -2,
			},
		});
		const generated = buildRenderOutputQcReport({
			file: "/tmp/generated.mp4",
			meta: baseMeta,
			visualDiff: {
				frameCount: 24,
				avgDiff: 0.03,
				maxDiff: 0.08,
				meaningfulDiffs: 4,
				strongDiffs: 1,
				first3AvgDiff: 0.02,
			},
			fullDiff: {
				frameCount: 24,
				avgDiff: 0.03,
				maxDiff: 0.08,
				meaningfulDiffs: 4,
				strongDiffs: 1,
				first3AvgDiff: 0.02,
			},
			sceneCuts: {
				selectedFrames: 2,
				estimatedCuts: 1,
				times: [0.6, 5.2],
			},
			black: { segments: [], count: 0 },
			volume: { meanDb: -18, maxDb: -4 },
			loudness: {
				integratedLufs: -16,
				loudnessRangeLu: 7,
				truePeakDbfs: -2,
			},
		});

		const compared = applyReferenceComparisonToReport(
			generated,
			profileFromRenderOutputQc(reference),
		);

		expect(compared.referenceComparison?.passed).toBe(false);
		expect(compared.issues).toContain("reference_cut_density_gap");
		expect(compared.issues).toContain("reference_hook_motion_gap");
		expect(compared.requiredActions.join(" ")).toContain("레퍼런스 대비");
	});

	it("정적 이미지 수준의 레퍼런스는 비교 기준으로 부적합 처리한다", () => {
		const staticReference = buildRenderOutputQcReport({
			file: "/tmp/static-reference.mp4",
			meta: baseMeta,
			visualDiff: {
				frameCount: 20,
				avgDiff: 0.001,
				maxDiff: 0.003,
				meaningfulDiffs: 0,
				strongDiffs: 0,
				first3AvgDiff: 0.001,
			},
			fullDiff: {
				frameCount: 20,
				avgDiff: 0.001,
				maxDiff: 0.003,
				meaningfulDiffs: 0,
				strongDiffs: 0,
				first3AvgDiff: 0.001,
			},
			sceneCuts: {
				selectedFrames: 1,
				estimatedCuts: 0,
				times: [0.1],
			},
			black: { segments: [], count: 0 },
			volume: { meanDb: -18, maxDb: -4 },
		});
		const generated = buildRenderOutputQcReport({
			file: "/tmp/generated.mp4",
			meta: baseMeta,
			visualDiff: {
				frameCount: 20,
				avgDiff: 0.07,
				maxDiff: 0.2,
				meaningfulDiffs: 8,
				strongDiffs: 4,
				first3AvgDiff: 0.05,
			},
			fullDiff: {
				frameCount: 20,
				avgDiff: 0.06,
				maxDiff: 0.17,
				meaningfulDiffs: 8,
				strongDiffs: 3,
				first3AvgDiff: 0.04,
			},
			sceneCuts: {
				selectedFrames: 5,
				estimatedCuts: 4,
				times: [0.4, 1.2, 2.1, 4.2, 6.2],
			},
			black: { segments: [], count: 0 },
			volume: { meanDb: -18, maxDb: -4 },
		});

		const compared = applyReferenceComparisonToReport(
			generated,
			profileFromRenderOutputQc(staticReference),
		);

		expect(compared.referenceComparison?.passed).toBe(false);
		expect(compared.issues).toContain("reference_profile_too_static");
		expect(compared.requiredActions.join(" ")).toContain("기준 영상으로 부적합");
	});
});
