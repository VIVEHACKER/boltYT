import { describe, expect, it } from "vitest";
import {
	buildStoryEditDraft,
	deleteStoryScene,
	duplicateStoryScene,
	insertStorySceneAfter,
	moveStoryScene,
	summarizeStoryEditDraft,
} from "./story-editing";

describe("story-editing", () => {
	it("레퍼런스 제작용 스토리 편집 초안을 생성한다", () => {
		const draft = buildStoryEditDraft({
			shortsScript: "첫 줄 훅\n두 번째 줄",
			referenceName: "미스터리 레퍼런스",
			format: "longform",
			now: new Date("2026-05-04T00:00:00.000Z"),
			scenes: [
				{
					narration: "바다 한가운데서 사라진 왕릉의 단서가 발견됐다.",
					type: "image",
					visualPrompt: "dark sea",
					duration: 12,
				},
				{
					narration: "결국 기록에서 지워진 이름이 드러난다.",
					type: "image",
					visualPrompt: "archive",
					duration: 16,
				},
			],
		});

		expect(draft.hook).toContain("바다 한가운데");
		expect(draft.storyAngle).toContain("미스터리 레퍼런스");
		expect(draft.mustKeep).toContain("챕터");
		expect(draft.updatedAt).toBe("2026-05-04T00:00:00.000Z");
	});

	it("스토리 편집 요약을 저장 가능한 문자열로 만든다", () => {
		const summary = summarizeStoryEditDraft({
			hook: "왜 사라졌나?",
			storyAngle: "추적형",
			viewerQuestion: "진짜 원인은?",
			endingBeat: "반전 공개",
			mustKeep: "증거 컷",
			avoid: "원문 복제 금지",
			editorNotes: "2막을 더 길게",
			updatedAt: "2026-05-04T00:00:00.000Z",
		});

		expect(summary).toContain("훅: 왜 사라졌나?");
		expect(summary).toContain("메모: 2막을 더 길게");
	});

	it("장면 순서를 이동한다", () => {
		const scenes = [{ narration: "a" }, { narration: "b" }, { narration: "c" }];

		expect(moveStoryScene(scenes, 1, -1).map((scene) => scene.narration)).toEqual([
			"b",
			"a",
			"c",
		]);
		expect(moveStoryScene(scenes, 0, -1)).toBe(scenes);
	});

	it("장면 복제/삽입/삭제를 안전하게 처리한다", () => {
		const scenes = [
			{
				narration: "원본",
				type: "image",
				visualPrompt: "prompt",
				duration: 8,
				shots: [{ id: "shot" }],
			},
		];

		const duplicated = duplicateStoryScene(scenes, 0);
		expect(duplicated).toHaveLength(2);
		expect(duplicated[1].shots).toEqual([]);

		const inserted = insertStorySceneAfter(duplicated, 0, {
			narration: "추가",
			visualPrompt: "new prompt",
		});
		expect(inserted[1].narration).toBe("추가");
		expect(inserted[1].duration).toBe(8);

		expect(deleteStoryScene(inserted, 1)).toHaveLength(2);
		expect(deleteStoryScene([inserted[0]], 0)).toHaveLength(1);
	});
});
