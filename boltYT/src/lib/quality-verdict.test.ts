import { describe, expect, it } from "vitest";
import {
	aggregateChapterVerdicts,
	aggregateDimensionScores,
	type ChapterVerdict,
	combineWithExistingVerdicts,
	DEFAULT_FIX_BUDGET,
	DEFAULT_WEIGHTS,
	type DimensionVerdict,
	type QualityDimension,
	resolveVerdict,
} from "./quality-verdict";

function dimension(
	name: QualityDimension,
	score: number,
	overrides: Partial<DimensionVerdict> = {},
): DimensionVerdict {
	return {
		dimension: name,
		score,
		bar: 70,
		gap: score - 70,
		status: score >= 70 ? "pass" : "below_bar",
		findings: [],
		fixIds: [],
		...overrides,
	};
}

function dimensions(
	scores: Record<QualityDimension, number>,
): Record<QualityDimension, DimensionVerdict> {
	return {
		editing: dimension("editing", scores.editing),
		bgm: dimension("bgm", scores.bgm),
		tts: dimension("tts", scores.tts),
		script: dimension("script", scores.script),
	};
}

function chapter(
	index: number,
	score: number,
	overrides: Partial<ChapterVerdict> = {},
): ChapterVerdict {
	return {
		index,
		startSec: index * 60,
		endSec: (index + 1) * 60,
		score,
		worstDimension: "editing",
		blockedReasons: [],
		...overrides,
	};
}

describe("quality-verdict", () => {
	describe("resolveVerdict", () => {
		it("hardBlocks가 있으면 score 100이어도 무조건 blocked", () => {
			const result = resolveVerdict({
				overallScore: 100,
				marketBar: 70,
				hardBlocks: ["empty_narration"],
				judgeMode: "llm_assisted",
			});
			expect(result.verdict).toBe("blocked");
		});

		it("hardBlocks는 heuristic_only 모드에서도 blocked (LLM 부재가 블록을 해제하지 않음)", () => {
			const result = resolveVerdict({
				overallScore: 95,
				marketBar: 70,
				hardBlocks: ["zero_scenes", "tts_zero_coverage"],
				judgeMode: "heuristic_only",
			});
			expect(result.verdict).toBe("blocked");
			expect(result.requiresHumanReview).toBe(true);
		});

		it("heuristic_only는 score>=bar여도 ship 금지 — improve + review:true 강등", () => {
			const result = resolveVerdict({
				overallScore: 92,
				marketBar: 70,
				hardBlocks: [],
				judgeMode: "heuristic_only",
			});
			expect(result.verdict).toBe("improve");
			expect(result.requiresHumanReview).toBe(true);
		});

		it("llm_assisted + score>=bar + 블록 없음 → ship + review:false", () => {
			const result = resolveVerdict({
				overallScore: 85,
				marketBar: 70,
				hardBlocks: [],
				judgeMode: "llm_assisted",
			});
			expect(result.verdict).toBe("ship");
			expect(result.requiresHumanReview).toBe(false);
		});

		it("score가 bar와 정확히 같으면 ship (>= 경계)", () => {
			const result = resolveVerdict({
				overallScore: 70,
				marketBar: 70,
				hardBlocks: [],
				judgeMode: "llm_assisted",
			});
			expect(result.verdict).toBe("ship");
		});

		it("llm_assisted여도 score<bar면 improve", () => {
			const result = resolveVerdict({
				overallScore: 69.9,
				marketBar: 70,
				hardBlocks: [],
				judgeMode: "llm_assisted",
			});
			expect(result.verdict).toBe("improve");
			expect(result.requiresHumanReview).toBe(false);
		});

		it("heuristic_only + score<bar → improve + review:true", () => {
			const result = resolveVerdict({
				overallScore: 40,
				marketBar: 70,
				hardBlocks: [],
				judgeMode: "heuristic_only",
			});
			expect(result.verdict).toBe("improve");
			expect(result.requiresHumanReview).toBe(true);
		});

		it("같은 입력 → 같은 출력 (결정론)", () => {
			const input = {
				overallScore: 71,
				marketBar: 70,
				hardBlocks: [],
				judgeMode: "llm_assisted" as const,
			};
			expect(resolveVerdict(input)).toEqual(resolveVerdict(input));
		});
	});

	describe("combineWithExistingVerdicts", () => {
		it("기존 verdict 중 하나라도 blocked면 blocked (합집합)", () => {
			expect(combineWithExistingVerdicts("ship", ["ship", "blocked"])).toBe(
				"blocked",
			);
		});

		it("market이 blocked면 기존이 전부 ship이어도 blocked", () => {
			expect(combineWithExistingVerdicts("blocked", ["ship", "ready"])).toBe(
				"blocked",
			);
		});

		it("전부 ship/ready이면서 market도 ship일 때만 ship (교집합)", () => {
			expect(combineWithExistingVerdicts("ship", ["ship", "ready"])).toBe(
				"ship",
			);
		});

		it("market이 ship이어도 기존에 review가 섞이면 improve", () => {
			expect(combineWithExistingVerdicts("ship", ["ship", "review"])).toBe(
				"improve",
			);
		});

		it("market이 ship이어도 기존에 improve가 섞이면 improve", () => {
			expect(combineWithExistingVerdicts("ship", ["ready", "improve"])).toBe(
				"improve",
			);
		});

		it("market이 improve면 기존이 전부 ship이어도 improve", () => {
			expect(combineWithExistingVerdicts("improve", ["ship", "ship"])).toBe(
				"improve",
			);
		});

		it("기존 verdict가 비어있으면 market 판정을 따른다 (교집합 공허 충족)", () => {
			expect(combineWithExistingVerdicts("ship", [])).toBe("ship");
			expect(combineWithExistingVerdicts("improve", [])).toBe("improve");
			expect(combineWithExistingVerdicts("blocked", [])).toBe("blocked");
		});
	});

	describe("aggregateChapterVerdicts", () => {
		it("worst 챕터가 지배한다 — mean보다 worst+12가 낮으면 후자", () => {
			// mean = (90+90+30)/3 = 70, worst+12 = 42 → 42
			const result = aggregateChapterVerdicts([
				chapter(0, 90),
				chapter(1, 90),
				chapter(2, 30),
			]);
			expect(result.score).toBe(42);
		});

		it("챕터가 고르게 좋으면 mean을 따른다 (worst+12 > mean)", () => {
			// mean = (80+78+76)/3 = 78, worst+12 = 88 → 78
			const result = aggregateChapterVerdicts([
				chapter(0, 80),
				chapter(1, 78),
				chapter(2, 76),
			]);
			expect(result.score).toBe(78);
		});

		it("hardBlocks는 전 챕터 합집합 (중복 제거, 첫 등장 순서)", () => {
			const result = aggregateChapterVerdicts([
				chapter(0, 80, { blockedReasons: ["empty_narration"] }),
				chapter(1, 75, {
					blockedReasons: ["empty_narration", "tts_zero_coverage"],
				}),
				chapter(2, 70, { blockedReasons: ["zero_scenes"] }),
			]);
			expect(result.hardBlocks).toEqual([
				"empty_narration",
				"tts_zero_coverage",
				"zero_scenes",
			]);
		});

		it("빈 챕터 배열 → score 0, hardBlocks 없음", () => {
			expect(aggregateChapterVerdicts([])).toEqual({
				score: 0,
				hardBlocks: [],
			});
		});

		it("단일 챕터 → 자기 점수 그대로 (mean == worst+12 캡 미적용)", () => {
			const result = aggregateChapterVerdicts([chapter(0, 65)]);
			expect(result.score).toBe(65);
		});
	});

	describe("aggregateDimensionScores", () => {
		it("기본 가중치 가중 평균: editing .34 / script .30 / bgm .18 / tts .18", () => {
			const score = aggregateDimensionScores(
				dimensions({ editing: 80, script: 70, bgm: 60, tts: 50 }),
			);
			// 80*.34 + 70*.30 + 60*.18 + 50*.18 = 68
			expect(score).toBe(68);
		});

		it("전 차원 동일 점수면 가중치와 무관하게 그 점수", () => {
			const score = aggregateDimensionScores(
				dimensions({ editing: 75, script: 75, bgm: 75, tts: 75 }),
			);
			expect(score).toBe(75);
		});

		it("커스텀 가중치를 적용하고 합으로 정규화한다", () => {
			const score = aggregateDimensionScores(
				dimensions({ editing: 100, script: 0, bgm: 0, tts: 0 }),
				{ editing: 2, script: 1, bgm: 1, tts: 0 },
			);
			// 100*2 / (2+1+1+0) = 50
			expect(score).toBe(50);
		});

		it("가중치 합이 0이면 0을 반환한다 (fail-closed)", () => {
			const score = aggregateDimensionScores(
				dimensions({ editing: 90, script: 90, bgm: 90, tts: 90 }),
				{ editing: 0, script: 0, bgm: 0, tts: 0 },
			);
			expect(score).toBe(0);
		});

		it("DEFAULT_WEIGHTS 합은 1.0", () => {
			const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
			expect(total).toBeCloseTo(1.0, 10);
		});
	});

	describe("DEFAULT_FIX_BUDGET", () => {
		it("비용 fail-closed 기본값 고정: 0.5 USD / 2 calls / 2 rounds", () => {
			expect(DEFAULT_FIX_BUDGET).toEqual({
				maxUsdPerLoop: 0.5,
				maxLlmCallsPerJudgement: 2,
				maxRounds: 2,
			});
		});
	});
});
