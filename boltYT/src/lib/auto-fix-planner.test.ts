import { describe, expect, it } from "vitest";
import {
	buildFixIdempotencyKey,
	estimateFixCost,
	FIX_COST_TABLE,
	planAutoFixes,
} from "./auto-fix-planner";
import type { BundleScene, ContentBundle } from "./content-bundle";
import { getBuiltinBenchmark } from "./market-benchmark";
import type { FixHistoryEntry } from "./quality-fix-history";
import type {
	AutoFixAction,
	DimensionVerdict,
	QualityDimension,
} from "./quality-verdict";

function scene(id: string, overrides: Partial<BundleScene> = {}): BundleScene {
	return {
		id,
		orderIndex: 0,
		narration: `내레이션 ${id}`,
		durationSec: 3,
		type: "image",
		shotCount: 1,
		motionGraphicCount: 0,
		hasWordTimings: true,
		...overrides,
	};
}

function bundle(overrides: Partial<ContentBundle> = {}): ContentBundle {
	const scenes = overrides.scenes ?? [
		scene("s1", { orderIndex: 0 }),
		scene("s2", { orderIndex: 1 }),
		scene("s3", { orderIndex: 2 }),
	];
	return {
		contentId: "content-1",
		format: "shorts",
		durationSec: scenes.reduce((sum, s) => sum + s.durationSec, 0),
		scriptStructure: ["hook", "body", "cta"],
		tts: { coverageRatio: 1 },
		bgm: { hasBeatGrid: true },
		...overrides,
		scenes,
	};
}

function dim(
	dimension: QualityDimension,
	overrides: Partial<DimensionVerdict> = {},
): DimensionVerdict {
	return {
		dimension,
		score: 80,
		bar: 70,
		gap: 0,
		status: "pass",
		findings: [],
		fixIds: [],
		...overrides,
	};
}

function allPass(): Record<QualityDimension, DimensionVerdict> {
	return {
		editing: dim("editing"),
		script: dim("script"),
		bgm: dim("bgm"),
		tts: dim("tts"),
	};
}

function historyEntry(idempotencyKey: string): FixHistoryEntry {
	return {
		idempotencyKey,
		actionType: "any",
		bundleHash: "deadbeef",
		round: 1,
		appliedAt: "2026-06-11T00:00:00.000Z",
	};
}

const shortsBenchmark = getBuiltinBenchmark("horror_mystery", "shorts");

describe("planAutoFixes", () => {
	it("gap 큰 critical 차원부터 액션을 생성하고 pass 차원은 액션이 없다", () => {
		const dimensions = {
			...allPass(),
			editing: dim("editing", {
				score: 50,
				bar: 70,
				gap: 20,
				status: "critical",
			}),
			script: dim("script", {
				score: 62,
				bar: 70,
				gap: 8,
				status: "below_bar",
			}),
		};
		const plan = planAutoFixes({
			dimensions,
			bundle: bundle({
				scenes: [
					scene("s1", { durationSec: 5 }),
					scene("s2", { orderIndex: 1, durationSec: 2 }),
				],
			}),
			benchmark: shortsBenchmark,
			history: [],
		});

		const used = plan.actions.map((a) => a.dimension);
		expect(used).not.toContain("bgm");
		expect(used).not.toContain("tts");
		expect(plan.actions[0]?.dimension).toBe("editing");
		// critical(gap 20) 차원 액션이 below_bar(gap 8) 액션보다 전부 앞선다
		expect(used.indexOf("script")).toBeGreaterThan(used.lastIndexOf("editing"));
		// 컷 밀도(3s) 초과 씬만 분할 대상
		const density = plan.actions.find((a) => a.type === "scene_density_patch");
		expect(density?.targetSceneIds).toEqual(["s1"]);
		expect(plan.requiresApproval).toBe(false);
	});

	it("전 차원 pass → 빈 plan (승인 불필요, 비용 0)", () => {
		const plan = planAutoFixes({
			dimensions: allPass(),
			bundle: bundle(),
			benchmark: shortsBenchmark,
			history: [],
		});
		expect(plan.actions).toEqual([]);
		expect(plan.skippedDuplicateIds).toEqual([]);
		expect(plan.requiresApproval).toBe(false);
		expect(plan.totalCost.usd).toBe(0);
		expect(plan.totalCost.withinBudget).toBe(true);
	});

	it("차원당 최대 2액션 — bgm 후보 3개 중 lift/cost 비율 상위 2개만", () => {
		const dimensions = {
			...allPass(),
			bgm: dim("bgm", { score: 55, bar: 70, gap: 15, status: "below_bar" }),
		};
		const plan = planAutoFixes({
			dimensions,
			// normalize(LUFS 이탈) + swap(무드 불일치/저품질) + cue_replan(비트그리드 없음) 전부 트리거
			bundle: bundle({
				bgm: {
					hasBeatGrid: false,
					mood: "calm",
					lufsEstimate: -9,
					qualityScore: 50,
				},
			}),
			benchmark: shortsBenchmark,
			history: [],
		});
		expect(plan.actions).toHaveLength(2);
		// lift: swap 10 > normalize 8 > cue_replan 6 (비용 전부 0 → lift 순)
		expect(plan.actions.map((a) => a.type)).toEqual([
			"bgm_swap",
			"bgm_normalize",
		]);
	});

	it("예산 초과 → requiresApproval=true + approvalReason, 액션은 유지(게이트는 orchestrator)", () => {
		const dimensions = {
			...allPass(),
			script: dim("script", {
				score: 60,
				bar: 70,
				gap: 10,
				status: "below_bar",
			}),
		};
		const plan = planAutoFixes({
			dimensions,
			bundle: bundle(),
			benchmark: shortsBenchmark,
			history: [],
			budget: { maxUsdPerLoop: 0.01, maxLlmCallsPerJudgement: 0, maxRounds: 2 },
		});
		expect(plan.totalCost.llmCalls).toBeGreaterThan(0);
		expect(plan.totalCost.withinBudget).toBe(false);
		expect(plan.requiresApproval).toBe(true);
		expect(plan.approvalReason).toContain("예산 초과");
		// 플래그만 — 액션 자체는 plan 에 남아 있어야 orchestrator 가 승인 후 실행 가능
		expect(plan.actions.length).toBeGreaterThan(0);
	});

	it("기본 예산 내 plan 은 requiresApproval=false", () => {
		const dimensions = {
			...allPass(),
			script: dim("script", {
				score: 60,
				bar: 70,
				gap: 10,
				status: "below_bar",
			}),
		};
		const plan = planAutoFixes({
			dimensions,
			bundle: bundle(),
			benchmark: shortsBenchmark,
			history: [],
		});
		expect(plan.requiresApproval).toBe(false);
		expect(plan.approvalReason).toBeUndefined();
	});

	it("이력의 멱등키와 충돌하면 skippedDuplicateIds 로 빠지고 캡을 소모하지 않는다", () => {
		const dimensions = {
			...allPass(),
			bgm: dim("bgm", { score: 55, bar: 70, gap: 15, status: "below_bar" }),
		};
		const b = bundle({
			bgm: {
				hasBeatGrid: false,
				mood: "calm",
				lufsEstimate: -9,
				qualityScore: 50,
			},
		});
		const first = planAutoFixes({
			dimensions,
			bundle: b,
			benchmark: shortsBenchmark,
			history: [],
		});
		const topKey = first.actions[0]?.idempotencyKey ?? "";

		const second = planAutoFixes({
			dimensions,
			bundle: b,
			benchmark: shortsBenchmark,
			history: [historyEntry(topKey)],
		});
		expect(second.skippedDuplicateIds).toEqual([topKey]);
		expect(second.actions.map((a) => a.idempotencyKey)).not.toContain(topKey);
		// 중복이 캡(2)을 소모하지 않아 3순위 후보(cue_replan)가 올라온다
		expect(second.actions.map((a) => a.type)).toEqual([
			"bgm_normalize",
			"bgm_cue_replan",
		]);
	});

	it("라운드를 거듭하며 이력이 쌓이면 차순위 fix(chapter_restructure)가 표면화된다", () => {
		const lfBenchmark = getBuiltinBenchmark("docu_story", "longform");
		const dimensions = {
			...allPass(),
			script: dim("script", {
				score: 50,
				bar: 70,
				gap: 20,
				status: "critical",
			}),
		};
		const b = bundle({ format: "longform" });
		const first = planAutoFixes({
			dimensions,
			bundle: b,
			benchmark: lfBenchmark,
			history: [],
		});
		expect(first.actions).toHaveLength(2);

		const history = first.actions.map((a) => historyEntry(a.idempotencyKey));
		const second = planAutoFixes({
			dimensions,
			bundle: b,
			benchmark: lfBenchmark,
			history,
		});
		expect(second.actions.map((a) => a.type)).toEqual(["chapter_restructure"]);
		expect(second.skippedDuplicateIds).toHaveLength(2);
	});

	it("critical 차원 액션은 비율이 낮아도 below_bar 액션보다 앞선다", () => {
		const dimensions = {
			...allPass(),
			tts: dim("tts", { score: 66, bar: 70, gap: 4, status: "critical" }),
			script: dim("script", {
				score: 60,
				bar: 70,
				gap: 10,
				status: "below_bar",
			}),
		};
		const plan = planAutoFixes({
			dimensions,
			bundle: bundle(),
			benchmark: shortsBenchmark,
			history: [],
		});
		expect(plan.actions[0]?.dimension).toBe("tts");
	});

	it("gap 부호가 반대(음수)여도 bar-score 로 방어적 lift 산출", () => {
		const cutDensitySec = shortsBenchmark.editing.cutDensitySec;
		const dimensions = {
			...allPass(),
			editing: dim("editing", {
				score: 50,
				bar: 70,
				gap: -20,
				status: "below_bar",
			}),
		};
		const plan = planAutoFixes({
			dimensions,
			// scene_density_patch 가 생성되려면 cutDensitySec 초과 씬이 필요하다
			bundle: bundle({
				scenes: [
					scene("s1", { orderIndex: 0, durationSec: cutDensitySec + 1 }),
					scene("s2", { orderIndex: 1, durationSec: 2 }),
				],
			}),
			benchmark: shortsBenchmark,
			history: [],
		});
		const density = plan.actions.find((a) => a.type === "scene_density_patch");
		// min(bar-score=20, cap 12)
		expect(density?.expectedScoreLift).toBe(12);
	});

	it("모든 씬이 컷 밀도 기준 이하 → scene_density_patch 가 plan 에 없다", () => {
		// shortsBenchmark.editing.cutDensitySec 이하인 씬만 구성
		const cutDensitySec = shortsBenchmark.editing.cutDensitySec;
		const dimensions = {
			...allPass(),
			editing: dim("editing", {
				score: 50,
				bar: 70,
				gap: 20,
				status: "critical",
			}),
		};
		const plan = planAutoFixes({
			dimensions,
			bundle: bundle({
				scenes: [
					scene("s1", { orderIndex: 0, durationSec: cutDensitySec }),
					scene("s2", { orderIndex: 1, durationSec: cutDensitySec - 1 }),
				],
			}),
			benchmark: shortsBenchmark,
			history: [],
		});

		// 어떤 씬도 기준 초과가 아니므로 scene_density_patch 는 생성되지 않아야 한다
		expect(plan.actions.some((a) => a.type === "scene_density_patch")).toBe(
			false,
		);
		// 빈 대상=전체 의도인 caption_density_patch 는 여전히 생성되어야 한다
		expect(plan.actions.some((a) => a.type === "caption_density_patch")).toBe(
			true,
		);
	});

	it("씬 없는 번들 — script/tts 후보가 없어도 안전하게 빈 plan", () => {
		const dimensions = {
			...allPass(),
			script: dim("script", { score: 0, bar: 70, gap: 70, status: "critical" }),
			tts: dim("tts", { score: 0, bar: 70, gap: 70, status: "critical" }),
		};
		const plan = planAutoFixes({
			dimensions,
			bundle: bundle({ scenes: [] }),
			benchmark: shortsBenchmark,
			history: [],
		});
		expect(plan.actions).toEqual([]);
		expect(plan.requiresApproval).toBe(false);
	});

	it("같은 입력 → 같은 plan (결정론, 타임스탬프 없음)", () => {
		const input = {
			dimensions: {
				...allPass(),
				editing: dim("editing", {
					score: 50,
					bar: 70,
					gap: 20,
					status: "critical" as const,
				}),
				bgm: dim("bgm", {
					score: 55,
					bar: 70,
					gap: 15,
					status: "below_bar" as const,
				}),
			},
			bundle: bundle({
				bgm: { hasBeatGrid: false, mood: "calm", lufsEstimate: -9 },
			}),
			benchmark: shortsBenchmark,
			history: [],
		};
		expect(planAutoFixes(input)).toEqual(planAutoFixes(input));
	});

	it("tts_retake 는 word timing 누락 씬만 노리고 비용이 씬 수에 비례한다", () => {
		const dimensions = {
			...allPass(),
			tts: dim("tts", { score: 55, bar: 70, gap: 15, status: "below_bar" }),
		};
		const scenes = [
			scene("s1", { hasWordTimings: false }),
			scene("s2", { orderIndex: 1, hasWordTimings: true }),
			scene("s3", { orderIndex: 2, hasWordTimings: false }),
		];
		const plan = planAutoFixes({
			dimensions,
			bundle: bundle({ scenes }),
			benchmark: shortsBenchmark,
			history: [],
		});
		const retake = plan.actions.find((a) => a.type === "tts_retake");
		expect(retake?.targetSceneIds).toEqual(["s1", "s3"]);
		const perScene = FIX_COST_TABLE.tts_retake.ttsCharsPerScene ?? 0;
		expect(retake?.estimatedCost.ttsChars).toBe(perScene * 2);
		expect(retake?.estimatedCost.usd).toBe(
			Math.round(FIX_COST_TABLE.tts_retake.usd * 2 * 10000) / 10000,
		);
	});
});

describe("buildFixIdempotencyKey", () => {
	it("같은 type+targets+params → 동일, params 다르면 다름", () => {
		const key = buildFixIdempotencyKey("tts_retake", ["s1", "s2"], {
			speed: 1,
		});
		expect(
			buildFixIdempotencyKey("tts_retake", ["s1", "s2"], { speed: 1 }),
		).toBe(key);
		expect(
			buildFixIdempotencyKey("tts_retake", ["s1", "s2"], { speed: 1.1 }),
		).not.toBe(key);
		expect(
			buildFixIdempotencyKey("bgm_swap", ["s1", "s2"], { speed: 1 }),
		).not.toBe(key);
		expect(buildFixIdempotencyKey("tts_retake", ["s1"], { speed: 1 })).not.toBe(
			key,
		);
	});

	it("대상 씬 순서/params 키 순서와 무관하게 동일 키 (정규화)", () => {
		expect(
			buildFixIdempotencyKey("tts_retake", ["s2", "s1"], { speed: 1 }),
		).toBe(buildFixIdempotencyKey("tts_retake", ["s1", "s2"], { speed: 1 }));
		expect(buildFixIdempotencyKey("bgm_swap", [], { a: 1, b: 2 })).toBe(
			buildFixIdempotencyKey("bgm_swap", [], { b: 2, a: 1 }),
		);
	});

	it("비결정 필드(updatedAt 류)가 params 에 끼어도 키 불변", () => {
		expect(
			buildFixIdempotencyKey("bgm_swap", [], { a: 1, updatedAt: "2026-06-11" }),
		).toBe(buildFixIdempotencyKey("bgm_swap", [], { a: 1 }));
	});
});

describe("estimateFixCost", () => {
	function action(
		overrides: Partial<AutoFixAction> & { id: string },
	): AutoFixAction {
		return {
			type: "bgm_swap",
			dimension: "bgm",
			targetSceneIds: [],
			params: {},
			estimatedCost: {
				usd: 0,
				llmCalls: 0,
				ttsChars: 0,
				bgmGenerations: 0,
				withinBudget: true,
			},
			expectedScoreLift: 5,
			idempotencyKey: overrides.id,
			...overrides,
		};
	}

	it("액션 비용을 정확히 합산한다", () => {
		const actions = [
			action({
				id: "a",
				type: "opening_hook_rewrite",
				dimension: "script",
				estimatedCost: {
					usd: 0.02,
					llmCalls: 1,
					ttsChars: 0,
					bgmGenerations: 0,
					withinBudget: true,
				},
			}),
			action({
				id: "b",
				type: "tts_retake",
				dimension: "tts",
				estimatedCost: {
					usd: 0.15,
					llmCalls: 0,
					ttsChars: 600,
					bgmGenerations: 0,
					withinBudget: true,
				},
			}),
		];
		expect(estimateFixCost(actions)).toEqual({
			usd: 0.17,
			llmCalls: 1,
			ttsChars: 600,
			bgmGenerations: 0,
			withinBudget: true,
		});
	});

	it("withinBudget 은 usd/llmCalls 한도 중 하나라도 넘으면 false", () => {
		const actions = [
			action({
				id: "a",
				estimatedCost: {
					usd: 0.2,
					llmCalls: 1,
					ttsChars: 0,
					bgmGenerations: 0,
					withinBudget: true,
				},
			}),
		];
		expect(
			estimateFixCost(actions, {
				maxUsdPerLoop: 0.1,
				maxLlmCallsPerJudgement: 2,
				maxRounds: 2,
			}).withinBudget,
		).toBe(false);
		expect(
			estimateFixCost(actions, {
				maxUsdPerLoop: 0.5,
				maxLlmCallsPerJudgement: 0,
				maxRounds: 2,
			}).withinBudget,
		).toBe(false);
		expect(
			estimateFixCost(actions, {
				maxUsdPerLoop: 0.5,
				maxLlmCallsPerJudgement: 2,
				maxRounds: 2,
			}).withinBudget,
		).toBe(true);
	});

	it("빈 액션 배열 → 0 비용 + withinBudget=true", () => {
		expect(estimateFixCost([])).toEqual({
			usd: 0,
			llmCalls: 0,
			ttsChars: 0,
			bgmGenerations: 0,
			withinBudget: true,
		});
	});

	it("부동소수점 합산 노이즈를 제거한다 (round4)", () => {
		const actions = [0.1, 0.2].map((usd, i) =>
			action({
				id: `a${i}`,
				estimatedCost: {
					usd,
					llmCalls: 0,
					ttsChars: 0,
					bgmGenerations: 0,
					withinBudget: true,
				},
			}),
		);
		// 0.1 + 0.2 = 0.30000000000000004 → 0.3
		expect(estimateFixCost(actions).usd).toBe(0.3);
	});
});
