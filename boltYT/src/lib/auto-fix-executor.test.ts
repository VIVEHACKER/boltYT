import { describe, expect, it, vi } from "vitest";

// tts.ts 경유 의존(local-db/supabase/proxy)이 모듈 로드 시 localStorage 에 접근
// → tts.test.ts 와 동일하게 vi.mock 으로 차단 (node 환경)
vi.mock("./local-db", () => ({ storeLocalFile: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: {} }));
vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3456" }));

import type { Scene } from "../types/database";
import {
	type AutoFixContext,
	buildBgmNormalizeDirective,
	executeAutoFixPlan,
} from "./auto-fix-executor";
import type { FixHistoryEntry } from "./quality-fix-history";
import type {
	AutoFixAction,
	AutoFixActionType,
	AutoFixPlan,
	FixBudget,
	FixCostEstimate,
} from "./quality-verdict";

function cost(overrides: Partial<FixCostEstimate> = {}): FixCostEstimate {
	return {
		usd: 0,
		llmCalls: 0,
		ttsChars: 0,
		bgmGenerations: 0,
		withinBudget: true,
		...overrides,
	};
}

function action(
	type: AutoFixActionType,
	overrides: Partial<AutoFixAction> = {},
): AutoFixAction {
	return {
		id: `editing:${type}`,
		type,
		dimension: "editing",
		targetSceneIds: [],
		params: {},
		estimatedCost: cost(),
		expectedScoreLift: 5,
		idempotencyKey: `${type}:00000000`,
		...overrides,
	};
}

function plan(
	actions: AutoFixAction[],
	overrides: Partial<AutoFixPlan> = {},
): AutoFixPlan {
	const usd =
		Math.round(
			actions.reduce((sum, a) => sum + a.estimatedCost.usd, 0) * 10000,
		) / 10000;
	const llmCalls = actions.reduce(
		(sum, a) => sum + a.estimatedCost.llmCalls,
		0,
	);
	return {
		actions,
		totalCost: cost({ usd, llmCalls }),
		requiresApproval: false,
		skippedDuplicateIds: [],
		...overrides,
	};
}

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
	return {
		id,
		script_id: "script-1",
		order_index: 0,
		narration_text: `${id} 사건의 기록이 그대로 남아 있었다`,
		scene_type: "image",
		visual_prompt: "",
		duration_seconds: 4,
		created_at: "2026-06-11T00:00:00.000Z",
		...overrides,
	};
}

function defaultScenes(): Scene[] {
	return [
		scene("s1", {
			narration_text: "안녕하세요 오늘은 이 사건을 알아보겠습니다",
		}),
		scene("s2", { order_index: 1 }),
		scene("s3", { order_index: 2 }),
	];
}

function makeCtx(overrides: Partial<AutoFixContext> = {}): AutoFixContext {
	return {
		scenes: defaultScenes(),
		applyScenePatch: vi.fn(),
		replaceNarration: vi.fn(),
		retakeTts: vi.fn(async () => {}),
		swapBgm: vi.fn(async () => {}),
		normalizeBgm: vi.fn(),
		replanBgmCues: vi.fn(),
		...overrides,
	};
}

function historyEntry(idempotencyKey: string): FixHistoryEntry {
	return {
		idempotencyKey,
		actionType: "bgm_swap",
		bundleHash: "deadbeef",
		round: 1,
		appliedAt: "2026-06-11T00:00:00.000Z",
	};
}

describe("executeAutoFixPlan — 액션 라우팅", () => {
	it("8개 지원 액션을 각각 올바른 ctx 콜백/repair API 로 라우팅한다", async () => {
		const ctx = makeCtx();
		const actions = [
			action("scene_density_patch", {
				targetSceneIds: ["s2"],
				idempotencyKey: "k1",
			}),
			action("caption_density_patch", { idempotencyKey: "k2" }),
			action("opening_hook_rewrite", {
				dimension: "script",
				targetSceneIds: ["s1"],
				idempotencyKey: "k3",
			}),
			action("ending_narration_patch", {
				dimension: "script",
				targetSceneIds: ["s3"],
				idempotencyKey: "k4",
			}),
			action("tts_retake", {
				dimension: "tts",
				targetSceneIds: ["s1", "s2"],
				params: { profile: "suspense", speed: 0.93 },
				idempotencyKey: "k5",
			}),
			action("bgm_swap", {
				dimension: "bgm",
				params: { targetMood: "dark" },
				idempotencyKey: "k6",
			}),
			action("bgm_normalize", {
				dimension: "bgm",
				params: { targetLufs: -14, duckingDb: -12, currentLufs: -9 },
				idempotencyKey: "k7",
			}),
			action("bgm_cue_replan", { dimension: "bgm", idempotencyKey: "k8" }),
		];

		const result = await executeAutoFixPlan(plan(actions), ctx, []);

		expect(result.failed).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(result.applied).toHaveLength(8);

		// scene_density_patch(s2 1회) + caption_density_patch(전체 3회) = 4회
		expect(ctx.applyScenePatch).toHaveBeenCalledTimes(4);
		expect(ctx.applyScenePatch).toHaveBeenNthCalledWith(
			1,
			"s2",
			expect.objectContaining({
				shots: expect.arrayContaining([expect.objectContaining({})]),
				transition: expect.any(String),
			}),
		);

		// 오프닝 훅(제네릭 인트로 → 재작성) + 엔딩 보강 = 2회
		expect(ctx.replaceNarration).toHaveBeenCalledTimes(2);
		expect(ctx.replaceNarration).toHaveBeenCalledWith(
			"s1",
			expect.stringContaining("바꿨을까요"),
		);
		expect(ctx.replaceNarration).toHaveBeenCalledWith(
			"s3",
			expect.stringContaining("현재까지"),
		);

		expect(ctx.retakeTts).toHaveBeenCalledWith(
			["s1", "s2"],
			expect.objectContaining({
				profile: "suspense",
				speed: 0.93,
				provider: "openai",
			}),
		);
		expect(ctx.swapBgm).toHaveBeenCalledWith("dark");
		expect(ctx.normalizeBgm).toHaveBeenCalledWith({
			targetDb: -14,
			duckingDb: -12,
			gainDb: -5,
			gainLinear: 0.5623,
		});
		expect(ctx.replanBgmCues).toHaveBeenCalledWith(
			expect.objectContaining({
				bursts: expect.any(Array),
				resolveFrame: expect.any(Number),
				startFromFrame: expect.any(Number),
			}),
		);
	});

	it("chapter_restructure 는 1차 미지원 — unsupported skip", async () => {
		const ctx = makeCtx();
		const a = action("chapter_restructure", { dimension: "script" });
		const result = await executeAutoFixPlan(plan([a]), ctx, []);

		expect(result.skipped).toEqual([{ action: a, reason: "unsupported" }]);
		expect(result.applied).toEqual([]);
		expect(ctx.applyScenePatch).not.toHaveBeenCalled();
		expect(ctx.replaceNarration).not.toHaveBeenCalled();
	});

	it("필요 콜백 부재 시 unsupported skip (swapBgm/retakeTts/normalizeBgm/replanBgmCues)", async () => {
		const ctx = makeCtx({
			retakeTts: undefined,
			swapBgm: undefined,
			normalizeBgm: undefined,
			replanBgmCues: undefined,
		});
		const result = await executeAutoFixPlan(
			plan([
				action("bgm_swap", { params: { targetMood: "dark" } }),
				action("tts_retake", { idempotencyKey: "t1" }),
				action("bgm_normalize", { idempotencyKey: "n1" }),
				action("bgm_cue_replan", { idempotencyKey: "c1" }),
			]),
			ctx,
			[],
		);
		expect(result.skipped.map((s) => s.reason)).toEqual([
			"unsupported",
			"unsupported",
			"unsupported",
			"unsupported",
		]);
		expect(result.applied).toEqual([]);
	});

	it("tts_retake 대상 미지정 시 전체 씬 재합성", async () => {
		const ctx = makeCtx();
		await executeAutoFixPlan(
			plan([action("tts_retake", { dimension: "tts" })]),
			ctx,
			[],
		);
		expect(ctx.retakeTts).toHaveBeenCalledWith(
			["s1", "s2", "s3"],
			expect.objectContaining({ provider: "openai" }),
		);
	});

	it("엔딩이 이미 마무리 문구를 가지면 replaceNarration 없이 적용(멱등 no-op)으로 기록", async () => {
		const ctx = makeCtx({
			scenes: [
				scene("s1"),
				scene("s2", {
					order_index: 1,
					narration_text: "현재까지 확인된 것은 여기까지입니다",
				}),
			],
		});
		const result = await executeAutoFixPlan(
			plan([
				action("ending_narration_patch", {
					dimension: "script",
					targetSceneIds: ["s2"],
				}),
			]),
			ctx,
			[],
		);
		expect(ctx.replaceNarration).not.toHaveBeenCalled();
		expect(result.applied).toHaveLength(1);
		expect(result.historyEntries).toHaveLength(1);
	});
});

describe("executeAutoFixPlan — fail-closed 게이트", () => {
	it("requiresApproval plan 은 전부 needs-approval skip (실행기에서 해제 불가)", async () => {
		const ctx = makeCtx();
		const actions = [
			action("bgm_swap", { params: { targetMood: "dark" } }),
			action("ending_narration_patch", { idempotencyKey: "e1" }),
		];
		const result = await executeAutoFixPlan(
			plan(actions, { requiresApproval: true, approvalReason: "예산 초과" }),
			ctx,
			[],
		);

		expect(result.skipped).toEqual(
			actions.map((a) => ({ action: a, reason: "needs-approval" })),
		);
		expect(result.applied).toEqual([]);
		expect(result.historyEntries).toEqual([]);
		expect(result.costUsd).toBe(0);
		expect(ctx.swapBgm).not.toHaveBeenCalled();
		expect(ctx.replaceNarration).not.toHaveBeenCalled();
	});

	it("requiresApproval=false 라도 totalCost.withinBudget=false 면 전부 over-budget skip (방어)", async () => {
		const ctx = makeCtx();
		const a = action("bgm_swap", { params: { targetMood: "dark" } });
		const result = await executeAutoFixPlan(
			plan([a], { totalCost: cost({ usd: 9, withinBudget: false }) }),
			ctx,
			[],
		);
		expect(result.skipped).toEqual([{ action: a, reason: "over-budget" }]);
		expect(ctx.swapBgm).not.toHaveBeenCalled();
	});

	it("누적 USD 가 기본 한도(0.5)를 넘는 순간 잔여 액션 전부 over-budget skip", async () => {
		const ctx = makeCtx();
		const actions = [
			action("bgm_swap", {
				params: { targetMood: "dark" },
				estimatedCost: cost({ usd: 0.3 }),
				idempotencyKey: "a1",
			}),
			action("bgm_normalize", {
				estimatedCost: cost({ usd: 0.3 }),
				idempotencyKey: "a2",
			}),
			// 0비용이어도 잔여로서 함께 skip (fail-closed)
			action("bgm_cue_replan", { idempotencyKey: "a3" }),
		];
		const result = await executeAutoFixPlan(
			plan(actions, { totalCost: cost({ usd: 0.6 }) }),
			ctx,
			[],
		);

		expect(result.applied.map((a) => a.idempotencyKey)).toEqual(["a1"]);
		expect(result.skipped).toEqual([
			{ action: actions[1], reason: "over-budget" },
			{ action: actions[2], reason: "over-budget" },
		]);
		expect(result.costUsd).toBe(0.3);
		expect(ctx.normalizeBgm).not.toHaveBeenCalled();
		expect(ctx.replanBgmCues).not.toHaveBeenCalled();
	});

	it("누적 LLM 호출이 한도(2)를 넘어도 over-budget skip", async () => {
		const ctx = makeCtx();
		const a = action("opening_hook_rewrite", {
			dimension: "script",
			estimatedCost: cost({ usd: 0.02, llmCalls: 3 }),
		});
		const result = await executeAutoFixPlan(
			plan([a], { totalCost: cost({ usd: 0.02, llmCalls: 3 }) }),
			ctx,
			[],
		);
		expect(result.skipped).toEqual([{ action: a, reason: "over-budget" }]);
	});

	it("커스텀 budget(maxUsdPerLoop 큰 값)으로 DEFAULT 한도 초과 액션이 스킵되지 않음", async () => {
		// DEFAULT_FIX_BUDGET.maxUsdPerLoop = 0.5 이므로 각 0.4 USD 액션 2개(합 0.8)는
		// 기본 한도에서 두 번째가 over-budget skip 된다.
		// 커스텀 budget 으로 maxUsdPerLoop=2 를 지정하면 두 액션 모두 적용돼야 한다.
		const ctx = makeCtx();
		const largeBudget: FixBudget = {
			maxUsdPerLoop: 2,
			maxLlmCallsPerJudgement: 10,
			maxRounds: 2,
		};
		const actions = [
			action("bgm_swap", {
				params: { targetMood: "dark" },
				estimatedCost: cost({ usd: 0.4 }),
				idempotencyKey: "b1",
			}),
			action("bgm_normalize", {
				params: { targetLufs: -23 },
				estimatedCost: cost({ usd: 0.4 }),
				idempotencyKey: "b2",
			}),
		];
		const result = await executeAutoFixPlan(
			plan(actions, { totalCost: cost({ usd: 0.8 }) }),
			ctx,
			[],
			largeBudget,
		);

		expect(result.skipped).toEqual([]);
		expect(result.applied.map((a) => a.idempotencyKey)).toEqual(["b1", "b2"]);
		expect(result.costUsd).toBe(0.8);
		expect(ctx.swapBgm).toHaveBeenCalledTimes(1);
		expect(ctx.normalizeBgm).toHaveBeenCalledTimes(1);
	});
});

describe("executeAutoFixPlan — 멱등키 재확인", () => {
	it("이력에 같은 멱등키가 있으면 duplicate skip", async () => {
		const ctx = makeCtx();
		const dup = action("bgm_swap", {
			params: { targetMood: "dark" },
			idempotencyKey: "bgm_swap:aaaa",
		});
		const fresh = action("ending_narration_patch", {
			dimension: "script",
			idempotencyKey: "ending:bbbb",
		});
		const result = await executeAutoFixPlan(plan([dup, fresh]), ctx, [
			historyEntry("bgm_swap:aaaa"),
		]);

		expect(result.skipped).toEqual([{ action: dup, reason: "duplicate" }]);
		expect(result.applied).toEqual([fresh]);
		expect(ctx.swapBgm).not.toHaveBeenCalled();
	});

	it("같은 실행 내 중복 멱등키도 두 번째부터 duplicate skip", async () => {
		const ctx = makeCtx();
		const first = action("bgm_swap", {
			params: { targetMood: "dark" },
			idempotencyKey: "same-key",
		});
		const second = action("bgm_swap", {
			params: { targetMood: "dark" },
			idempotencyKey: "same-key",
		});
		const result = await executeAutoFixPlan(plan([first, second]), ctx, []);

		expect(result.applied).toEqual([first]);
		expect(result.skipped).toEqual([{ action: second, reason: "duplicate" }]);
		expect(ctx.swapBgm).toHaveBeenCalledTimes(1);
	});
});

describe("executeAutoFixPlan — dryRun", () => {
	it("ctx 콜백을 한 번도 호출하지 않지만 결과는 실제 실행과 동일하게 보고", async () => {
		const ctx = makeCtx({ dryRun: true });
		const actions = [
			action("scene_density_patch", {
				targetSceneIds: ["s1"],
				estimatedCost: cost({ usd: 0.1 }),
				idempotencyKey: "d1",
			}),
			action("bgm_swap", {
				params: { targetMood: "dark" },
				idempotencyKey: "d2",
			}),
			action("tts_retake", {
				dimension: "tts",
				targetSceneIds: ["s2"],
				idempotencyKey: "d3",
			}),
		];
		const result = await executeAutoFixPlan(plan(actions), ctx, []);

		expect(ctx.applyScenePatch).not.toHaveBeenCalled();
		expect(ctx.replaceNarration).not.toHaveBeenCalled();
		expect(ctx.retakeTts).not.toHaveBeenCalled();
		expect(ctx.swapBgm).not.toHaveBeenCalled();
		expect(ctx.normalizeBgm).not.toHaveBeenCalled();
		expect(ctx.replanBgmCues).not.toHaveBeenCalled();

		expect(result.applied).toHaveLength(3);
		expect(result.historyEntries).toHaveLength(3);
		expect(result.costUsd).toBe(0.1);
		expect(result.failed).toEqual([]);
	});

	it("dryRun 에서도 잘못된 대상(없는 씬)은 failed 로 드러난다", async () => {
		const ctx = makeCtx({ dryRun: true });
		const result = await executeAutoFixPlan(
			plan([action("scene_density_patch", { targetSceneIds: ["ghost"] })]),
			ctx,
			[],
		);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]?.error).toContain("ghost");
	});
});

describe("executeAutoFixPlan — 부분 실패 격리", () => {
	it("1액션 throw → failed 에 기록되고 나머지는 계속 진행", async () => {
		const ctx = makeCtx({
			applyScenePatch: vi.fn(() => {
				throw new Error("패치 실패");
			}),
		});
		const broken = action("scene_density_patch", {
			targetSceneIds: ["s1"],
			idempotencyKey: "f1",
		});
		const ok = action("bgm_swap", {
			params: { targetMood: "dark" },
			idempotencyKey: "f2",
		});
		const result = await executeAutoFixPlan(plan([broken, ok]), ctx, []);

		expect(result.failed).toEqual([{ action: broken, error: "패치 실패" }]);
		expect(result.applied).toEqual([ok]);
		expect(ctx.swapBgm).toHaveBeenCalledWith("dark");
		// 실패 액션은 historyEntries 에 남지 않는다 (재시도 가능해야 함)
		expect(result.historyEntries.map((e) => e.idempotencyKey)).toEqual(["f2"]);
	});

	it("targetMood 없는 bgm_swap 은 failed (잘못된 액션)", async () => {
		const ctx = makeCtx();
		const result = await executeAutoFixPlan(
			plan([action("bgm_swap", { params: {} })]),
			ctx,
			[],
		);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]?.error).toContain("targetMood");
		expect(ctx.swapBgm).not.toHaveBeenCalled();
	});

	it("씬이 하나도 없으면 씬 의존 액션은 failed", async () => {
		const ctx = makeCtx({ scenes: [] });
		const result = await executeAutoFixPlan(
			plan([
				action("opening_hook_rewrite", {
					dimension: "script",
					idempotencyKey: "o1",
				}),
				action("ending_narration_patch", {
					dimension: "script",
					idempotencyKey: "e1",
				}),
			]),
			ctx,
			[],
		);
		expect(result.failed).toHaveLength(2);
		expect(result.applied).toEqual([]);
	});
});

describe("executeAutoFixPlan — historyEntries", () => {
	it("적용 액션마다 ctx 메타(bundleHash/round)로 정확한 이력을 생성한다", async () => {
		const ctx = makeCtx({ bundleHash: "cafebabe", round: 3 });
		const actions = [
			action("bgm_swap", {
				params: { targetMood: "dark" },
				idempotencyKey: "h1",
			}),
			action("ending_narration_patch", {
				dimension: "script",
				idempotencyKey: "h2",
			}),
		];
		const result = await executeAutoFixPlan(plan(actions), ctx, []);

		expect(result.historyEntries).toHaveLength(2);
		expect(result.historyEntries[0]).toMatchObject({
			idempotencyKey: "h1",
			actionType: "bgm_swap",
			bundleHash: "cafebabe",
			round: 3,
		});
		expect(result.historyEntries[1]).toMatchObject({
			idempotencyKey: "h2",
			actionType: "ending_narration_patch",
			bundleHash: "cafebabe",
			round: 3,
		});
		for (const entry of result.historyEntries) {
			expect(entry.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		}
	});

	it("ctx 메타 미지정 시 bundleHash='' / round=1 기본값", async () => {
		const ctx = makeCtx();
		const result = await executeAutoFixPlan(
			plan([action("bgm_swap", { params: { targetMood: "dark" } })]),
			ctx,
			[],
		);
		expect(result.historyEntries[0]).toMatchObject({
			bundleHash: "",
			round: 1,
		});
	});
});

describe("buildBgmNormalizeDirective", () => {
	it("params 가 비면 bgm-loudness 기본 타깃(-23dB)만 담는다", () => {
		expect(buildBgmNormalizeDirective({})).toEqual({ targetDb: -23 });
	});

	it("currentLufs 가 있으면 gainDb/gainLinear 를 동봉한다", () => {
		expect(
			buildBgmNormalizeDirective({
				targetLufs: -14,
				duckingDb: -12,
				currentLufs: -9,
			}),
		).toEqual({
			targetDb: -14,
			duckingDb: -12,
			gainDb: -5,
			gainLinear: 0.5623,
		});
	});

	it("게인은 computeBgmNormalizeGain 과 동일하게 -24..+18dB 로 클램프", () => {
		const boosted = buildBgmNormalizeDirective({
			targetLufs: -14,
			currentLufs: -60,
		});
		expect(boosted.gainDb).toBe(18);
		expect(boosted.gainLinear).toBe(7.9433);

		const cut = buildBgmNormalizeDirective({
			targetLufs: -40,
			currentLufs: -5,
		});
		expect(cut.gainDb).toBe(-24);
		expect(cut.gainLinear).toBe(0.0631);
	});

	it("비수치 파라미터는 결측 처리 (타입가드)", () => {
		expect(
			buildBgmNormalizeDirective({
				targetLufs: "loud",
				currentLufs: Number.NaN,
			}),
		).toEqual({ targetDb: -23 });
	});
});
