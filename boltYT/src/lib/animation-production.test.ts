import { describe, expect, it } from "vitest";
import type { SceneShot } from "./scene-shot-types";
import {
	analyzeAnimationProductionReadiness,
	applyAnimationContinuityToShots,
	applyAnimationPacingRules,
	buildAnimationAssetManifest,
	buildAnimationCharacterReferencePrompt,
	buildAnimationSceneShots,
	formatAnimationReadinessForPrompt,
	inferAnimationProductionFamily,
	repairAnimationScenesForQuality,
	scoreAnimationProductionQuality,
	type AnimationSceneInput,
} from "./animation-production";

describe("animation-production", () => {
	it("주제가 없으면 애니메이션 제작을 차단한다", () => {
		const report = analyzeAnimationProductionReadiness({
			topicTitle: "",
			format: "shorts",
		});

		expect(report.status).toBe("blocked");
		expect(report.canGenerate).toBe(false);
		expect(report.issues.some((issue) => issue.code === "missing_topic")).toBe(
			true,
		);
	});

	it("주인공과 갈등이 있는 주제는 통과한다", () => {
		const report = analyzeAnimationProductionReadiness({
			topicTitle: "비밀을 숨긴 로봇 소년의 탈출",
			format: "longform",
		});

		expect(report.status).toBe("ready");
		expect(report.canGenerate).toBe(true);
		expect(report.recommendedFormat).toBe("both");
		expect(report.productionFamily).toBe("character_micro_sitcom");
		expect(report.promptDirectives.join(" ")).toContain("애니메이션 스타일");
	});

	it("주제에 맞는 애니메이션 제작 포맷 패밀리를 고른다", () => {
		expect(
			inferAnimationProductionFamily({
				topicTitle: "알바 첫날에 벌어진 이상한 경험담 썰",
				format: "longform",
			}),
		).toBe("storytime_animation");
		expect(
			inferAnimationProductionFamily({
				topicTitle: "전쟁을 한 장의 지도와 숫자로 설명",
				format: "longform",
			}),
		).toBe("history_comedy");
		expect(
			inferAnimationProductionFamily({
				topicTitle: "무대사 소품 슬랩스틱 쇼츠",
				format: "shorts",
			}),
		).toBe("slapstick_no_dialogue");
	});

	it("애니메이션 샷은 외부 검색이 아니라 AI 키포즈용 메타데이터를 만든다", () => {
		const shots = buildAnimationSceneShots(
			{
				narration: "로봇 소년은 문 앞에서 처음으로 망설였다.",
				type: "image",
				visualPrompt:
					"small robot boy in a yellow raincoat standing before a glowing door",
				duration: 6,
			},
			{
				style: "expressive 2D animation",
				world: "rainy neon village",
				characters: [
					{
						name: "루",
						role: "protagonist",
						appearance:
							"small round robot boy, yellow raincoat, blue glowing eyes",
						personality: "curious but nervous",
						voice_tone: "soft young voice",
					},
				],
				recurring_props: ["glowing key"],
				color_palette: ["yellow", "blue"],
			},
		);

		expect(shots.length).toBeGreaterThanOrEqual(3);
		expect(shots.every((shot) => shot.media_type === "image")).toBe(true);
		expect(shots.every((shot) => shot.selection_provider === "animation")).toBe(
			true,
		);
		expect(shots.every((shot) => shot.search_terms?.length === 0)).toBe(true);
		expect(shots.every((shot) => shot.animation_rig)).toBe(true);
		expect(shots.every((shot) => shot.sfx_cue)).toBe(true);
		expect(shots[0].visual_prompt).toContain("yellow raincoat");
		expect(shots[0].visual_prompt).toContain("animation rig");
		expect(shots[0].source_title).toBeTruthy();
		expect(shots.reduce((sum, shot) => sum + shot.duration_seconds, 0)).toBeCloseTo(
			6,
			1,
		);
	});

	it("설명형 애니메이션은 다이어그램/데이터 샷 문법을 반영한다", () => {
		const shots = buildAnimationSceneShots(
			{
				narration: "왜 빛은 이렇게 움직일까?",
				type: "image",
				visualPrompt: "simple animated diagram of light moving through glass",
				duration: 8,
			},
			undefined,
			"animated_explainer",
		);

		expect(shots.some((shot) => shot.kind === "evidence")).toBe(true);
		expect(shots[0].visual_prompt).toContain("visual metaphors");
		expect(shots.every((shot) => shot.selection_provider === "animation")).toBe(
			true,
		);
	});

	it("캐릭터 레퍼런스 시트와 연속성 태그를 샷에 주입한다", () => {
		const manifest = buildAnimationAssetManifest({
			scriptId: "script-1",
			productionFamily: "character_micro_sitcom",
			bible: {
				style: "clean 2D animation",
				world: "tiny moon town",
				characters: [
					{
						name: "루",
						role: "hero",
						appearance: "round robot, yellow raincoat, blue eyes",
						personality: "curious",
						voice_tone: "soft",
					},
				],
				recurring_props: ["glowing key"],
				color_palette: ["yellow", "blue"],
			},
			scenes: [{ narration_text: "루가 열쇠를 들었다.", visual_prompt: "key" }],
			now: "2026-05-01T00:00:00.000Z",
		});
		const prompt = buildAnimationCharacterReferencePrompt(manifest);
		const shots = applyAnimationContinuityToShots(
			buildAnimationSceneShots(
				{
					narration: "루가 열쇠를 들었다.",
					type: "image",
					visualPrompt: "robot holding a glowing key",
					duration: 4,
				},
				undefined,
				"character_micro_sitcom",
			),
			manifest,
		);

		expect(manifest.referenceSheetPath).toBe(
			"scripts/script-1/animation/character-sheet.png",
		);
		expect(manifest.styleSeed).toBeGreaterThan(0);
		expect(manifest.identityLock).toContain("yellow raincoat");
		expect(prompt).toContain("character reference sheet");
		expect(prompt).toContain("yellow raincoat");
		expect(shots.every((shot) => shot.reference_image_path)).toBe(true);
		expect(shots.every((shot) => shot.continuity_key)).toBe(true);
		expect(shots[0].visual_prompt).toContain("Reference contract");
	});

	it("애니메이션 QC는 레퍼런스/연속성/엔딩을 점수화한다", () => {
		const manifest = buildAnimationAssetManifest({
			scriptId: "script-qc",
			productionFamily: "meme_original",
			scenes: [{ narration_text: "밈 상황극", visual_prompt: "setup" }],
			now: "2026-05-01T00:00:00.000Z",
		});
		const shots = applyAnimationContinuityToShots(
			buildAnimationSceneShots(
				{
					narration: "갑자기 반전이 왔다.",
					type: "image",
					visualPrompt: "animated character reacts to absurd reveal",
					duration: 4,
				},
				undefined,
				"meme_original",
			).map((shot, index, list) => ({
				...shot,
				source_url: `scenes/s1/${shot.id}.png`,
				visual_role: index === list.length - 1 ? "ending" : shot.visual_role,
			})),
			manifest,
		);
		const report = scoreAnimationProductionQuality({
			scenes: [{ shots }],
			productionFamily: "meme_original",
			referenceSheetPath: manifest.referenceSheetPath,
		});

		expect(report.passed).toBe(true);
		expect(report.score).toBeGreaterThanOrEqual(78);
		expect(report.metrics.continuityTaggedRatio).toBe(1);
		expect(report.metrics.rigCoverageRatio).toBe(1);
		expect(report.metrics.sfxCueCoverageRatio).toBe(1);
	});

	it("QC 복구는 중복 프롬프트와 약한 엔딩/정적 모션을 보강한다", () => {
		const manifest = buildAnimationAssetManifest({
			scriptId: "script-repair",
			productionFamily: "character_micro_sitcom",
			scenes: [{ narration_text: "반복 장면", visual_prompt: "same pose" }],
			now: "2026-05-01T00:00:00.000Z",
		});
		const scenes = repairAnimationScenesForQuality(
			[
				{
					shots: [
						{
							id: "a",
							kind: "detail",
							duration_seconds: 1,
							media_type: "image",
							selection_provider: "animation",
							visual_prompt: "same character same pose",
							motion: "static",
						},
						{
							id: "b",
							kind: "detail",
							duration_seconds: 1,
							media_type: "image",
							selection_provider: "animation",
							visual_prompt: "same character same pose",
							motion: "static",
						},
					],
				},
			],
			manifest,
		);
		const shots = (scenes[0].shots ?? []) as SceneShot[];

		expect(shots[0].motion).not.toBe("static");
		expect(shots[1].visual_prompt).toContain("Distinct animation beat");
		expect(shots[1].kind).toBe("punch");
		expect(shots[1].visual_role).toBe("ending");
		expect(shots[1].animation_rig?.pose).toBe("action");
		expect(shots[1].sfx_cue?.category).toBe("impact");
	});

	it("애니메이션 페이싱은 video 씬을 image 키포즈로 바꾼다", () => {
		const scenes: AnimationSceneInput[] = [
				{
					narration: "첫 장면",
					type: "video",
					visualPrompt: "animated hero runs",
					duration: 8,
				},
				{
					narration: "반전",
					type: "text_emphasis",
					visualPrompt: "reveal text",
					duration: 5,
				},
			];
		const result = applyAnimationPacingRules(scenes, "shorts");

		expect(result[0].type).toBe("image");
		expect(result[0].duration).toBeLessThanOrEqual(4.2);
		expect(result[0].transition).toBe("none");
		expect(result[1].transition).toBe("zoom");
	});

	it("프롬프트용 평가 섹션을 만든다", () => {
		const report = analyzeAnimationProductionReadiness({
			topicTitle: "괴물 친구와 소녀의 비밀 대결",
			format: "shorts",
		});
		const prompt = formatAnimationReadinessForPrompt(report);

		expect(prompt).toContain("애니메이션 프리프로덕션 평가");
		expect(prompt).toContain("제작 지시");
		expect(prompt).toContain("품질 게이트");
		expect(prompt).toContain("리스크 제어");
		expect(prompt).toContain("스타일");
	});
});
