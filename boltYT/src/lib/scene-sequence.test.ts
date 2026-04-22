import { describe, expect, it } from "vitest";
import {
	applySceneSourcePlan,
	buildFallbackSceneSourcePlan,
} from "./scene-sequence";

describe("scene-sequence", () => {
	it("fallback plan assigns sources in scene order by type", () => {
		const plan = buildFallbackSceneSourcePlan(
			[
				{ narration: "도입", type: "image", visualPrompt: "" },
				{ narration: "현장 영상", type: "video", visualPrompt: "" },
				{ narration: "반전 자막", type: "text_emphasis", visualPrompt: "" },
				{ narration: "결말", type: "image", visualPrompt: "" },
			],
			[
				{ type: "image", title: "초기 현장 사진", pubDate: "1991-01-29" },
				{ type: "video", title: "수사 기록 영상", pubDate: "1991-01-30" },
				{ type: "article", title: "사건 결말 정리", pubDate: "1991-02-02" },
			],
		);

		expect(plan.scenes.map((scene) => scene.source_index)).toEqual([
			0, 1, -1, 2,
		]);
	});

	it("apply plan merges event metadata and source publisher", () => {
		const scenes = applySceneSourcePlan(
			[
				{
					narration: "피해자 실종",
					type: "image",
					visualPrompt: "dark apartment exterior",
					sourceIndex: -1,
				},
			],
			[
				{
					type: "article",
					title: "실종 당일 CCTV 공개",
					pubDate: "1991-01-29",
					publisher: "연합뉴스",
				},
			],
			{
				scenes: [
					{
						index: 0,
						source_index: 0,
						event_title: "실종 당일 CCTV 공개",
						event_date: "1991-01-29",
					},
				],
			},
		);

		expect(scenes[0].sourceIndex).toBe(0);
		expect(scenes[0].newsTitle).toBe("실종 당일 CCTV 공개");
		expect(scenes[0].newsDate).toBe("1991-01-29");
		expect(scenes[0].newsSource).toBe("연합뉴스");
	});

	it("source event metadata is preferred over raw source title/date", () => {
		const scenes = applySceneSourcePlan(
			[
				{
					narration: "결정적 제보가 들어왔다",
					type: "image",
					visualPrompt: "detective office night",
					sourceIndex: 0,
				},
			],
			[
				{
					type: "article",
					title: "기사 원제목",
					eventTitle: "제보가 접수된 밤",
					pubDate: "1991-02-01",
					eventDate: "1991-01-31",
				},
			],
		);

		expect(scenes[0].newsTitle).toBe("제보가 접수된 밤");
		expect(scenes[0].newsDate).toBe("1991-01-31");
	});

	it("one-based AI indices are normalized safely", () => {
		const scenes = applySceneSourcePlan(
			[
				{
					narration: "첫 장면",
					type: "image",
					visualPrompt: "apartment exterior",
					sourceIndex: -1,
				},
			],
			[
				{
					type: "article",
					title: "첫 장면 기사",
					pubDate: "1991-01-29",
				},
			],
			{
				scenes: [
					{
						index: 1,
						source_index: 1,
						event_title: "첫 장면 기사",
						event_date: "1991-01-29",
					},
				],
			},
		);

		expect(scenes[0].sourceIndex).toBe(0);
		expect(scenes[0].newsTitle).toBe("첫 장면 기사");
	});

	it("positive zero-based AI source indices are not misread as one-based", () => {
		const scenes = applySceneSourcePlan(
			[
				{
					narration: "두 번째 자료를 써야 하는 장면",
					type: "image",
					visualPrompt: "archive evidence board",
					sourceIndex: -1,
				},
			],
			[
				{
					type: "article",
					title: "첫 자료",
					eventTitle: "초기 단서",
					eventDate: "1991-01-29",
				},
				{
					type: "article",
					title: "둘째 자료",
					eventTitle: "핵심 제보",
					eventDate: "1991-02-03",
				},
			],
			{
				scenes: [
					{
						index: 0,
						source_index: 1,
					},
				],
			},
		);

		expect(scenes[0].sourceIndex).toBe(1);
		expect(scenes[0].newsTitle).toBe("핵심 제보");
	});

	it("out-of-range AI source indices are discarded", () => {
		const scenes = applySceneSourcePlan(
			[
				{
					narration: "잘못된 자료 지정",
					type: "image",
					visualPrompt: "archive document close-up",
					sourceIndex: -1,
				},
			],
			[
				{
					type: "article",
					title: "실제 자료",
					pubDate: "1991-01-29",
					publisher: "연합뉴스",
				},
			],
			{
				scenes: [
					{
						index: 0,
						source_index: 999,
						event_title: "존재하지 않는 자료",
						event_date: "1991-01-29",
					},
				],
			},
		);

		expect(scenes[0].sourceIndex).toBe(-1);
		expect(scenes[0].newsTitle).toBe("존재하지 않는 자료");
		expect(scenes[0].newsSource).toBe("");
	});

	it("same source can be reused across multiple scenes", () => {
		const scenes = applySceneSourcePlan(
			[
				{
					narration: "첫 번째 설명",
					type: "image",
					visualPrompt: "case file on desk",
					sourceIndex: -1,
				},
				{
					narration: "두 번째 설명",
					type: "image",
					visualPrompt: "detective notes detail",
					sourceIndex: -1,
				},
			],
			[
				{
					type: "article",
					title: "단일 자료",
					eventTitle: "한 자료로 이어지는 사건 흐름",
					eventDate: "1991-01-29",
					publisher: "KBS",
				},
			],
			{
				scenes: [
					{
						index: 0,
						source_index: 0,
						event_title: "실종 직후",
						event_date: "1991-01-29",
					},
					{
						index: 1,
						source_index: 0,
						event_title: "수색 확대",
						event_date: "1991-01-29",
					},
				],
			},
		);

		expect(scenes.map((scene) => scene.sourceIndex)).toEqual([0, 0]);
		expect(scenes[1].newsTitle).toBe("수색 확대");
		expect(scenes[1].newsSource).toBe("KBS");
	});

	it("reassigned sources replace stale scene metadata", () => {
		const scenes = applySceneSourcePlan(
			[
				{
					narration: "수사 전환점",
					type: "image",
					visualPrompt: "detective notes",
					sourceIndex: 0,
					newsTitle: "이전 기사 제목",
					newsDate: "1991-01-29",
					newsSource: "이전 언론사",
				},
			],
			[
				{
					type: "article",
					title: "이전 기사",
					eventTitle: "초기 보도",
					eventDate: "1991-01-29",
					publisher: "A신문",
				},
				{
					type: "article",
					title: "새 기사",
					eventTitle: "수사 방향 전환",
					eventDate: "1991-02-03",
					publisher: "KBS",
				},
			],
			{
				scenes: [
					{
						index: 0,
						source_index: 1,
					},
				],
			},
		);

		expect(scenes[0].sourceIndex).toBe(1);
		expect(scenes[0].newsTitle).toBe("수사 방향 전환");
		expect(scenes[0].newsDate).toBe("1991-02-03");
		expect(scenes[0].newsSource).toBe("KBS");
	});

	it("fallback plan reuses chronological source when matching sources are scarce", () => {
		const plan = buildFallbackSceneSourcePlan(
			[
				{ narration: "도입", type: "image", visualPrompt: "" },
				{ narration: "수색 장면", type: "image", visualPrompt: "" },
				{ narration: "현장 영상", type: "video", visualPrompt: "" },
			],
			[
				{
					type: "article",
					title: "초기 기사",
					eventTitle: "실종 접수",
					eventDate: "1991-01-29",
				},
				{
					type: "video",
					title: "현장 영상",
					eventTitle: "현장 수색",
					eventDate: "1991-01-30",
				},
			],
		);

		expect(plan.scenes.map((scene) => scene.source_index)).toEqual([0, 0, 1]);
		expect(plan.scenes[1].event_title).toBe("실종 접수");
	});

	it("fallback plan does not keep stale metadata when a new source is chosen", () => {
		const plan = buildFallbackSceneSourcePlan(
			[
				{
					narration: "새 자료가 필요한 장면",
					type: "image",
					visualPrompt: "",
					sourceIndex: -1,
					newsTitle: "이전 장면 제목",
					newsDate: "1991-01-10",
				},
			],
			[
				{
					type: "article",
					title: "재배치된 기사",
					eventTitle: "현장 재수색",
					eventDate: "1991-02-04",
				},
			],
		);

		expect(plan.scenes[0]).toMatchObject({
			source_index: 0,
			event_title: "현장 재수색",
			event_date: "1991-02-04",
		});
	});
});
