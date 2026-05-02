import { describe, expect, it } from "vitest";
import {
	buildMotionRepairPatch,
	buildReferenceRepairGuidance,
	renderOutputIssueCodesToProductionIssueCodes,
	selectHeroVideoRepairIndexes,
	shouldRepairMotionDesign,
	shouldRepairNarrationEnding,
	shouldRepairRenderOutput,
	strengthenEndingNarration,
} from "./youtube-production-repair";

describe("youtube-production-repair", () => {
	it("결론 없는 엔딩 문장을 현재 결론/남은 의문으로 닫는다", () => {
		const repaired = strengthenEndingNarration("그리고 사건은 끝났습니다.", "longform");

		expect(repaired).toContain("현재까지 확인된 사실");
		expect(repaired).toContain("남은 의문");
	});

	it("이미 결론 단서가 있는 엔딩은 중복 보강하지 않는다", () => {
		const text = "현재까지 확인된 것은 여기까지입니다.";

		expect(strengthenEndingNarration(text, "shorts")).toBe(text);
	});

	it("모션 없는 씬에 샷 모션과 로워서드를 추가한다", () => {
		const patch = buildMotionRepairPatch(
			{
				scene_type: "image",
				duration_seconds: 6,
				imageUrl: "blob:image",
				news_title: "마지막 목격 기록",
				news_source: "뉴스A",
			},
			0,
		);

		expect(patch.transition).toBe("zoom_punch");
		expect(patch.shots).toHaveLength(4);
		expect(patch.shots?.every((shot) => shot.motion && shot.motion !== "static")).toBe(
			true,
		);
		expect(
			patch.motion_graphics?.some((graphic) => graphic.type === "lower_third"),
		).toBe(true);
		expect(patch.shots?.some((shot) => shot.sfx_cue?.category === "reveal")).toBe(
			true,
		);
	});

	it("선택적 hero 영상 후보는 기존 영상이 없을 때만 고른다", () => {
		expect(
			selectHeroVideoRepairIndexes(
				[
					{
						scene_type: "image",
						imageUrl: "blob:1",
						duration_seconds: 5,
						news_title: "첫 단서",
					},
					{ scene_type: "image", imageUrl: "blob:2", duration_seconds: 5 },
				],
				"shorts",
			),
		).toEqual([0]);

		expect(
			selectHeroVideoRepairIndexes(
				[
					{ scene_type: "image", videoUrl: "blob:v", duration_seconds: 5 },
					{ scene_type: "image", imageUrl: "blob:2", duration_seconds: 5 },
				],
				"shorts",
			),
		).toEqual([]);
	});

	it("이슈 코드로 엔딩/모션 복구 필요 여부를 판정한다", () => {
		expect(shouldRepairNarrationEnding(["missing_ending_cue"])).toBe(true);
		expect(shouldRepairMotionDesign(["low_designed_visual_ratio"])).toBe(true);
		expect(shouldRepairMotionDesign(["high_generic_stock_ratio"])).toBe(true);
		expect(shouldRepairMotionDesign(["large_quality_gap"])).toBe(true);
		expect(shouldRepairMotionDesign(["low_motion_video_scene"])).toBe(true);
		expect(shouldRepairMotionDesign(["low_opening_visual_density"])).toBe(true);
		expect(shouldRepairMotionDesign(["low_video_ratio"])).toBe(false);
		expect(shouldRepairMotionDesign(["missing_bgm"])).toBe(false);
	});

	it("실제 렌더 QC 이슈를 제작 보강 이슈로 변환한다", () => {
		expect(
			renderOutputIssueCodesToProductionIssueCodes([
				"weak_opening_hook",
				"low_visual_variation",
				"low_cut_density",
				"audio_level_needs_mix",
			]),
		).toEqual([
			"low_opening_visual_density",
			"low_editorial_density",
			"motion_monotony",
			"single_long_still_scene",
		]);
		expect(shouldRepairRenderOutput(["weak_opening_hook"])).toBe(true);
		expect(shouldRepairRenderOutput(["audio_level_needs_mix"])).toBe(false);
	});

	it("렌더 QC 보강 모드는 초반 컷 밀도와 강한 모션을 강제한다", () => {
		const patch = buildMotionRepairPatch(
			{
				scene_type: "image",
				duration_seconds: 8,
				imageUrl: "blob:image",
				shots: [
					{
						id: "long-static",
						kind: "context",
						duration_seconds: 8,
						media_type: "image",
						source_url: "blob:image",
						motion: "slow_zoom_in",
						crop: "wide",
					},
				],
			},
			0,
			{
				dense: true,
				forceMotion: true,
				reason: "actual render qc",
			},
		);

		expect(patch.shots).toHaveLength(5);
		expect(
			patch.shots?.every(
				(shot) =>
					shot.motion &&
					shot.motion !== "static" &&
					shot.motion !== "slow_zoom_in" &&
					shot.duration_seconds <= 1.7,
			),
		).toBe(true);
		expect(
			patch.shots?.every((shot) =>
				shot.qc_issues?.includes("render_output_motion_repair"),
			),
		).toBe(true);
		expect(
			patch.motion_graphics?.some((graphic) => graphic.type === "progress_bar"),
		).toBe(true);
	});

	it("레퍼런스 DNA가 있으면 컷 간격과 초반 모션 기준으로 수리 밀도를 올린다", () => {
		const guidance = buildReferenceRepairGuidance({
			camera: {
				mode: "cut_driven",
				cutDensityPerMinute: 22,
				avgCutIntervalSeconds: 1.2,
				firstCutSeconds: 1.1,
				first3Motion: 0.62,
			},
			transitions: {
				rules: ["첫 문장 끝에서 hard cut", "반전 전 punch zoom"],
			},
			layout: { textSafeZones: ["bottom_center_with_stroke"] },
			audio: { bgmMood: "tense", bgmTempo: "fast", integratedLufs: -14.2 },
		});
		const patch = buildMotionRepairPatch(
			{
				scene_type: "image",
				duration_seconds: 7,
				imageUrl: "blob:image",
				news_title: "핵심 단서",
				shots: [
					{
						id: "static-1",
						kind: "context",
						duration_seconds: 7,
						media_type: "image",
						source_url: "blob:image",
						motion: "static",
					},
				],
			},
			0,
			{ referenceGuidance: guidance },
		);

		expect(guidance?.integratedLufs).toBe(-14.2);
		expect(patch.transition).toBe("zoom_punch");
		expect(patch.shots).toHaveLength(6);
		expect(patch.shots?.every((shot) => shot.duration_seconds <= 1.7)).toBe(
			true,
		);
		expect(
			patch.shots?.some((shot) =>
				shot.search_terms?.some((term) => term.includes("cut_driven")),
			),
		).toBe(true);
		expect(
			patch.shots?.some((shot) =>
				shot.sfx_cue?.reason.includes("레퍼런스 DNA"),
			),
		).toBe(true);
	});
});
