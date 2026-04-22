/**
 * motion-graphics 회귀 테스트 — Codex P2 수정 검증.
 */

import { describe, expect, it } from "vitest";
import {
	assignMotionGraphicsForScene,
	assignMotionGraphicsForScenes,
	type SceneInput,
} from "./motion-graphics";

function scene(overrides: Partial<SceneInput>): SceneInput {
	return {
		narration_text: "",
		scene_type: "image",
		duration_seconds: 3,
		...overrides,
	};
}

describe("motion-graphics (Codex P2 regressions)", () => {
	it("NUMBER_PATTERN 은 씬 간 상태를 이월하지 않는다", () => {
		// 같은 모듈에서 연속 호출 — 이전 버전은 `g` 플래그 lastIndex 이월로
		// 2번째 호출이 null 을 반환했음.
		const a = assignMotionGraphicsForScene(
			scene({ narration_text: "147만 명이 참여했다" }),
		);
		const b = assignMotionGraphicsForScene(
			scene({ narration_text: "30년 동안 조사했다" }),
		);
		const c = assignMotionGraphicsForScene(
			scene({ narration_text: "결과는 4.2% 증가였다" }),
		);
		expect(a.some((g) => g.type === "number_counter")).toBe(true);
		expect(b.some((g) => g.type === "number_counter")).toBe(true);
		// 4.2% 는 progress_bar 로 분기
		expect(c.some((g) => g.type === "progress_bar")).toBe(true);
	});

	it("news_source 있는 씬은 motion graphics lower_third 를 중복 생성하지 않는다", () => {
		const g = assignMotionGraphicsForScene(
			scene({
				narration_text: "충격적인 사건이 보도되었다",
				news_title: "사건 발생",
				news_source: "연합뉴스",
			}),
		);
		expect(g.some((x) => x.type === "lower_third")).toBe(false);
	});

	it("news_title 만 있고 news_source 없으면 lower_third 를 붙인다", () => {
		const g = assignMotionGraphicsForScene(
			scene({
				narration_text: "사건의 시작",
				news_title: "사건 발생",
			}),
		);
		expect(g.some((x) => x.type === "lower_third")).toBe(true);
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("motion-graphics 추가 분기", () => {
	it("인용 표현 있으면 quote_bubble 생성", () => {
		const g = assignMotionGraphicsForScene(
			scene({ narration_text: '"이것이 진실이다"라고 증언했다' }),
		);
		expect(g.some((x) => x.type === "quote_bubble")).toBe(true);
	});

	it("인용이 60자 초과면 말줄임 처리", () => {
		const longQuote = "A".repeat(65);
		const g = assignMotionGraphicsForScene(
			scene({ narration_text: `"${longQuote}"라고 말했다` }),
		);
		const bubble = g.find((x) => x.type === "quote_bubble");
		expect((bubble?.params as { text?: string })?.text).toContain("...");
	});

	it("text_emphasis 씬에서 인용 있어도 quote_bubble 생략", () => {
		const g = assignMotionGraphicsForScene(
			scene({
				narration_text: '"이것이 진실이다"라고 증언했다',
				scene_type: "text_emphasis",
			}),
		);
		expect(g.some((x) => x.type === "quote_bubble")).toBe(false);
	});

	it("충격 키워드 + text_emphasis → emoji_burst 생성", () => {
		const g = assignMotionGraphicsForScene(
			scene({
				narration_text: "충격적인 반전이 공개됐다",
				scene_type: "text_emphasis",
			}),
		);
		expect(g.some((x) => x.type === "emoji_burst")).toBe(true);
	});

	it("arrow cue + image 씬 → arrow_callout 생성", () => {
		const g = assignMotionGraphicsForScene(
			scene({
				narration_text: "여기를 주목해야 합니다",
				scene_type: "image",
			}),
		);
		expect(g.some((x) => x.type === "arrow_callout")).toBe(true);
	});

	it("1초 미만 씬 → 빈 배열", () => {
		const g = assignMotionGraphicsForScene(
			scene({ narration_text: "147만 명", duration_seconds: 0.9 }),
		);
		expect(g).toHaveLength(0);
	});

	it("assignMotionGraphicsForScenes: 배열 일괄 처리", () => {
		const scenes = [
			scene({ narration_text: "147만 명이 참여했다" }),
			scene({ narration_text: "충격적인 반전", scene_type: "text_emphasis" }),
		];
		const result = assignMotionGraphicsForScenes(scenes);
		expect(result).toHaveLength(2);
		expect(result[0].motion_graphics).toBeDefined();
		expect(result[1].motion_graphics).toBeDefined();
	});

	it("퍼센트 없고 숫자+단위 없으면 number_counter/progress_bar 미생성", () => {
		const g = assignMotionGraphicsForScene(
			scene({ narration_text: "단순한 나레이션입니다" }),
		);
		expect(g.some((x) => x.type === "number_counter")).toBe(false);
		expect(g.some((x) => x.type === "progress_bar")).toBe(false);
	});
});
