import { beforeEach, describe, expect, it, vi } from "vitest";

// 루프 코디네이터는 judge/executor 를 정밀 제어해야 라운드 전이를 검증할 수 있다
// → 모듈 mock (quality-fix-history 는 실물 사용 — 멱등 레저 영속화까지 검증)
vi.mock("./quality-judge", () => ({
	judgeContentBundle: vi.fn(),
	judgeContentBundleHeuristic: vi.fn(),
}));
vi.mock("./auto-fix-executor", () => ({
	executeAutoFixPlan: vi.fn(),
}));

import {
	type AutoFixContext,
	type AutoFixExecutionResult,
	executeAutoFixPlan,
} from "./auto-fix-executor";
import type { ContentBundle } from "./content-bundle";
import { getBuiltinBenchmark } from "./market-benchmark";
import {
	type FixHistoryEntry,
	loadFixHistory,
	type QualityHistoryStore,
} from "./quality-fix-history";
import {
	type JudgeOptions,
	judgeContentBundle,
	judgeContentBundleHeuristic,
} from "./quality-judge";
import {
	type QualityLoopInput,
	runQualityLoop,
	scheduleQualityLoop,
	shouldContinueLoop,
} from "./quality-loop-orchestrator";
import type {
	AutoFixAction,
	AutoFixPlan,
	DimensionVerdict,
	FixCostEstimate,
	QualityDimension,
	QualityVerdictReport,
} from "./quality-verdict";

const judgeMock = vi.mocked(judgeContentBundle);
const heuristicMock = vi.mocked(judgeContentBundleHeuristic);
const executeMock = vi.mocked(executeAutoFixPlan);

const BENCHMARK = getBuiltinBenchmark("horror_mystery", "shorts");

function memStore(): QualityHistoryStore {
	const m = new Map<string, string>();
	return {
		get: (k) => m.get(k) ?? null,
		set: (k, v) => {
			m.set(k, v);
		},
	};
}

function cost(overrides: Partial<FixCostEstimate> = {}): FixCostEstimate {
	return {
		usd: 0.05,
		llmCalls: 0,
		ttsChars: 0,
		bgmGenerations: 0,
		withinBudget: true,
		...overrides,
	};
}

function fixAction(overrides: Partial<AutoFixAction> = {}): AutoFixAction {
	return {
		id: "script:opening_hook_rewrite",
		type: "opening_hook_rewrite",
		dimension: "script",
		targetSceneIds: ["s1"],
		params: {},
		estimatedCost: cost(),
		expectedScoreLift: 8,
		idempotencyKey: "opening_hook_rewrite:0000abcd",
		...overrides,
	};
}

function fixPlan(
	actions: AutoFixAction[],
	overrides: Partial<AutoFixPlan> = {},
): AutoFixPlan {
	return {
		actions,
		totalCost: cost(),
		requiresApproval: false,
		skippedDuplicateIds: [],
		...overrides,
	};
}

function dv(dimension: QualityDimension): DimensionVerdict {
	return {
		dimension,
		score: 60,
		bar: 70,
		gap: 10,
		status: "below_bar",
		findings: [],
		fixIds: [],
	};
}

function report(
	overrides: Partial<QualityVerdictReport> = {},
): QualityVerdictReport {
	return {
		verdict: "improve",
		overallScore: 60,
		marketBar: 70,
		judgeMode: "llm_assisted",
		requiresHumanReview: false,
		hardBlocks: [],
		bundleHash: "hash-r1",
		benchmarkFingerprint: BENCHMARK.fingerprint,
		round: 1,
		dimensions: {
			editing: dv("editing"),
			script: dv("script"),
			bgm: dv("bgm"),
			tts: dv("tts"),
		},
		autoFixPlan: fixPlan([fixAction()]),
		estimatedFixCost: cost(),
		judgedAt: "2026-06-12T00:00:00.000Z",
		...overrides,
	};
}

function bundle(contentId = "c1"): ContentBundle {
	return {
		contentId,
		format: "shorts",
		durationSec: 24,
		scriptStructure: ["hook", "body", "cta"],
		scenes: [],
		tts: { coverageRatio: 0.8 },
		bgm: { hasBeatGrid: false },
	};
}

function execResult(
	overrides: Partial<AutoFixExecutionResult> = {},
): AutoFixExecutionResult {
	return {
		applied: [],
		skipped: [],
		failed: [],
		historyEntries: [],
		costUsd: 0,
		...overrides,
	};
}

function historyEntry(
	overrides: Partial<FixHistoryEntry> = {},
): FixHistoryEntry {
	return {
		idempotencyKey: "opening_hook_rewrite:0000abcd",
		actionType: "opening_hook_rewrite",
		bundleHash: "hash-r1",
		round: 1,
		appliedAt: "2026-06-12T00:00:01.000Z",
		...overrides,
	};
}

function fixContext(): AutoFixContext {
	return {
		scenes: [],
		applyScenePatch: vi.fn(),
		replaceNarration: vi.fn(),
	};
}

function loopInput(getBundle = vi.fn(() => bundle())): QualityLoopInput & {
	getBundle: ReturnType<typeof vi.fn>;
} {
	return { getBundle, benchmark: BENCHMARK, fixContext: fixContext() };
}

/** judge mock 의 n번째 호출 options 인자 */
function judgeOptionsOfCall(index: number): JudgeOptions {
	const call = judgeMock.mock.calls.at(index);
	if (!call) throw new Error(`judge 호출 ${index} 없음`);
	return call[2] ?? {};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("shouldContinueLoop", () => {
	it("점수 상승 + 라운드 여유 → true", () => {
		const prev = report({ overallScore: 60 });
		const next = report({ overallScore: 65 });
		expect(shouldContinueLoop(prev, next, 2, 3)).toBe(true);
	});

	it("점수 동률은 미상승으로 간주 → false", () => {
		const prev = report({ overallScore: 60 });
		const next = report({ overallScore: 60 });
		expect(shouldContinueLoop(prev, next, 2, 5)).toBe(false);
	});

	it("점수 하락 → false", () => {
		const prev = report({ overallScore: 60 });
		const next = report({ overallScore: 55 });
		expect(shouldContinueLoop(prev, next, 2, 5)).toBe(false);
	});

	it("round >= maxRounds → 점수가 올라도 false", () => {
		const prev = report({ overallScore: 60 });
		const next = report({ overallScore: 80 });
		expect(shouldContinueLoop(prev, next, 2, 2)).toBe(false);
	});
});

describe("runQualityLoop — 종료 조건", () => {
	it("ship 은 1라운드에 종료하고 fix 를 시도하지 않는다", async () => {
		const shipped = report({ verdict: "ship", overallScore: 78 });
		judgeMock.mockResolvedValueOnce(shipped);
		const i = loopInput();
		const onRound = vi.fn();

		const result = await runQualityLoop(i, { store: memStore(), onRound });

		expect(result.stoppedBy).toBe("ship");
		expect(result.finalReport).toBe(shipped);
		expect(result.rounds).toEqual([shipped]);
		expect(result.execution).toEqual([]);
		expect(result.totalCostUsd).toBe(0);
		expect(i.getBundle).toHaveBeenCalledTimes(1);
		expect(onRound).toHaveBeenCalledExactlyOnceWith(shipped);
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("blocked 는 즉시 종료 — fix 시도/승인 콜백 호출 없음", async () => {
		const blocked = report({
			verdict: "blocked",
			overallScore: 10,
			hardBlocks: ["zero_scenes"],
			// 승인 필요 plan 이 있어도 blocked 가 우선한다
			autoFixPlan: fixPlan([fixAction()], { requiresApproval: true }),
		});
		judgeMock.mockResolvedValueOnce(blocked);
		const approveOverBudget = vi.fn(async () => true);

		const result = await runQualityLoop(loopInput(), {
			store: memStore(),
			approveOverBudget,
		});

		expect(result.stoppedBy).toBe("blocked");
		expect(result.rounds).toHaveLength(1);
		expect(executeMock).not.toHaveBeenCalled();
		expect(approveOverBudget).not.toHaveBeenCalled();
	});

	it("improve → fix → 점수 상승 → 재판정 → ship 흐름", async () => {
		const store = memStore();
		const round1 = report({ overallScore: 58, bundleHash: "hash-r1" });
		const round2 = report({
			verdict: "ship",
			overallScore: 74,
			bundleHash: "hash-r2",
			round: 2,
		});
		judgeMock.mockResolvedValueOnce(round1).mockResolvedValueOnce(round2);
		const entry = historyEntry();
		executeMock.mockResolvedValueOnce(
			execResult({
				applied: round1.autoFixPlan.actions,
				historyEntries: [entry],
				costUsd: 0.07,
			}),
		);
		const i = loopInput();

		const result = await runQualityLoop(i, { store });

		expect(result.stoppedBy).toBe("ship");
		expect(result.rounds).toEqual([round1, round2]);
		expect(result.finalReport).toBe(round2);
		expect(result.execution).toHaveLength(1);
		expect(result.totalCostUsd).toBe(0.07);
		// 재번들 — 라운드마다 getBundle 재호출
		expect(i.getBundle).toHaveBeenCalledTimes(2);
		// 실행기에는 판정 시점의 bundleHash/round 가 주입된다
		const [, execCtx] = executeMock.mock.calls[0];
		expect(execCtx.bundleHash).toBe("hash-r1");
		expect(execCtx.round).toBe(1);
		// 멱등 레저 영속화 — store 에 기록되고 다음 라운드 judge 에 주입된다
		expect(loadFixHistory("c1", store)).toEqual([entry]);
		expect(judgeOptionsOfCall(0).round).toBe(1);
		expect(judgeOptionsOfCall(0).history).toEqual([]);
		expect(judgeOptionsOfCall(1).round).toBe(2);
		expect(judgeOptionsOfCall(1).history).toEqual([entry]);
	});

	it("재판정 점수 미상승 → no_improvement 종료 (추가 fix 없음)", async () => {
		const round1 = report({ overallScore: 60 });
		const round2 = report({ overallScore: 60, bundleHash: "hash-r2" });
		judgeMock.mockResolvedValueOnce(round1).mockResolvedValueOnce(round2);
		executeMock.mockResolvedValue(execResult({ costUsd: 0.05 }));

		// maxRounds 3 — 상한이 아니라 점수 미상승이 종료 사유임을 분리 검증
		const result = await runQualityLoop(loopInput(), {
			store: memStore(),
			maxRounds: 3,
		});

		expect(result.stoppedBy).toBe("no_improvement");
		expect(result.rounds).toHaveLength(2);
		expect(executeMock).toHaveBeenCalledTimes(1);
		expect(result.totalCostUsd).toBe(0.05);
	});

	it("maxRounds 상한 — 점수가 계속 올라도 judge 라운드 수를 넘지 않는다", async () => {
		judgeMock
			.mockResolvedValueOnce(report({ overallScore: 50 }))
			.mockResolvedValueOnce(report({ overallScore: 60, bundleHash: "h2" }))
			.mockResolvedValueOnce(report({ overallScore: 70, bundleHash: "h3" }));
		executeMock
			.mockResolvedValueOnce(execResult({ costUsd: 0.05 }))
			.mockResolvedValueOnce(execResult({ costUsd: 0.07 }));
		const onRound = vi.fn();

		const result = await runQualityLoop(loopInput(), {
			store: memStore(),
			maxRounds: 3,
			onRound,
		});

		expect(result.stoppedBy).toBe("max_rounds");
		expect(result.rounds).toHaveLength(3);
		expect(executeMock).toHaveBeenCalledTimes(2);
		expect(onRound).toHaveBeenCalledTimes(3);
		expect(result.totalCostUsd).toBe(0.12);
	});

	it("maxRounds 기본값은 budget.maxRounds — 1이면 첫 improve 후 fix 없이 종료", async () => {
		judgeMock.mockResolvedValueOnce(report({ overallScore: 60 }));

		const result = await runQualityLoop(loopInput(), {
			store: memStore(),
			budget: { maxUsdPerLoop: 0.5, maxLlmCallsPerJudgement: 2, maxRounds: 1 },
		});

		expect(result.stoppedBy).toBe("max_rounds");
		expect(result.rounds).toHaveLength(1);
		expect(executeMock).not.toHaveBeenCalled();
	});
});

describe("runQualityLoop — 승인 게이트 (비용 fail-closed)", () => {
	function approvalReport(): QualityVerdictReport {
		return report({
			autoFixPlan: fixPlan([fixAction()], {
				requiresApproval: true,
				approvalReason: "예산 초과 — orchestrator 승인 필요",
				totalCost: cost({ usd: 1.2, withinBudget: false }),
			}),
		});
	}

	it("requiresApproval + 콜백 부재 → budget_declined (fix 없음)", async () => {
		judgeMock.mockResolvedValueOnce(approvalReport());

		const result = await runQualityLoop(loopInput(), { store: memStore() });

		expect(result.stoppedBy).toBe("budget_declined");
		expect(result.rounds).toHaveLength(1);
		expect(executeMock).not.toHaveBeenCalled();
		expect(result.totalCostUsd).toBe(0);
	});

	it("콜백 거부(false) → budget_declined", async () => {
		const r1 = approvalReport();
		judgeMock.mockResolvedValueOnce(r1);
		const approveOverBudget = vi.fn(async () => false);

		const result = await runQualityLoop(loopInput(), {
			store: memStore(),
			approveOverBudget,
		});

		expect(result.stoppedBy).toBe("budget_declined");
		expect(approveOverBudget).toHaveBeenCalledExactlyOnceWith(r1.autoFixPlan);
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("콜백 예외도 거부와 동일 — budget_declined (fail-closed)", async () => {
		judgeMock.mockResolvedValueOnce(approvalReport());
		const approveOverBudget = vi.fn(async () => {
			throw new Error("approval channel down");
		});

		const result = await runQualityLoop(loopInput(), {
			store: memStore(),
			approveOverBudget,
		});

		expect(result.stoppedBy).toBe("budget_declined");
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("콜백 승인(true) → 승인 반영 파생 plan 으로 실행 진행", async () => {
		const r1 = approvalReport();
		judgeMock
			.mockResolvedValueOnce(r1)
			.mockResolvedValueOnce(
				report({ verdict: "ship", overallScore: 75, bundleHash: "h2" }),
			);
		executeMock.mockResolvedValueOnce(execResult({ costUsd: 0.3 }));
		const approveOverBudget = vi.fn(async () => true);

		const result = await runQualityLoop(loopInput(), {
			store: memStore(),
			approveOverBudget,
		});

		expect(result.stoppedBy).toBe("ship");
		expect(executeMock).toHaveBeenCalledTimes(1);
		const [executedPlan] = executeMock.mock.calls[0];
		// 승인 사실이 파생 plan 에 반영된다 — 실행기는 승인을 해제할 수 없으므로
		expect(executedPlan.requiresApproval).toBe(false);
		expect(executedPlan.totalCost.withinBudget).toBe(true);
		expect(executedPlan.actions).toEqual(r1.autoFixPlan.actions);
		// 원본 plan 은 불변
		expect(r1.autoFixPlan.requiresApproval).toBe(true);
		expect(r1.autoFixPlan.totalCost.withinBudget).toBe(false);
		expect(result.totalCostUsd).toBe(0.3);
	});
});

describe("scheduleQualityLoop — AbortController 취소", () => {
	it("동기 cancel() → 첫 judge 전에 cancelled resolve (LLM 0비용 스냅샷)", async () => {
		const snapshot = report({
			judgeMode: "heuristic_only",
			requiresHumanReview: true,
		});
		heuristicMock.mockReturnValueOnce(snapshot);
		const i = loopInput();

		const scheduled = scheduleQualityLoop(i, { store: memStore() });
		scheduled.cancel();
		const result = await scheduled.promise;

		expect(result.stoppedBy).toBe("cancelled");
		expect(result.finalReport).toBe(snapshot);
		expect(result.rounds).toEqual([]);
		expect(result.execution).toEqual([]);
		expect(judgeMock).not.toHaveBeenCalled();
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("라운드 진행 중 cancel → 해당 라운드 judge 완료 후 cancelled, fix 미적용", async () => {
		judgeMock.mockResolvedValueOnce(report({ overallScore: 55 }));
		const cancelRef: { current?: () => void } = {};
		// onRound 시점의 cancel = judge 완료 직후, execute 직전 경계에서 감지된다
		const scheduled = scheduleQualityLoop(loopInput(), {
			store: memStore(),
			onRound: () => {
				cancelRef.current?.();
			},
		});
		cancelRef.current = scheduled.cancel;

		const result = await scheduled.promise;

		expect(result.stoppedBy).toBe("cancelled");
		expect(result.rounds).toHaveLength(1);
		expect(result.finalReport.overallScore).toBe(55);
		// cancel 이후에는 fix 가 절대 적용되지 않는다
		expect(executeMock).not.toHaveBeenCalled();
	});

	it("cancel 중복 호출은 안전 — 한 번만 cancelled 처리", async () => {
		const snapshot = report({ judgeMode: "heuristic_only" });
		heuristicMock.mockReturnValueOnce(snapshot);

		const scheduled = scheduleQualityLoop(loopInput(), { store: memStore() });
		scheduled.cancel();
		scheduled.cancel();
		const result = await scheduled.promise;

		expect(result.stoppedBy).toBe("cancelled");
	});

	it("options.signal 의 abort 도 내부 controller 로 전파된다", async () => {
		const snapshot = report({ judgeMode: "heuristic_only" });
		heuristicMock.mockReturnValueOnce(snapshot);
		const upstream = new AbortController();

		const scheduled = scheduleQualityLoop(loopInput(), {
			store: memStore(),
			signal: upstream.signal,
		});
		upstream.abort();
		const result = await scheduled.promise;

		expect(result.stoppedBy).toBe("cancelled");
		expect(judgeMock).not.toHaveBeenCalled();
	});

	it("이미 abort 된 options.signal → 즉시 cancelled", async () => {
		const snapshot = report({ judgeMode: "heuristic_only" });
		heuristicMock.mockReturnValueOnce(snapshot);
		const upstream = new AbortController();
		upstream.abort();

		const scheduled = scheduleQualityLoop(loopInput(), {
			store: memStore(),
			signal: upstream.signal,
		});
		const result = await scheduled.promise;

		expect(result.stoppedBy).toBe("cancelled");
		expect(judgeMock).not.toHaveBeenCalled();
	});

	it("취소 없으면 runQualityLoop 와 동일하게 완주한다", async () => {
		const shipped = report({ verdict: "ship", overallScore: 80 });
		judgeMock.mockResolvedValueOnce(shipped);

		const scheduled = scheduleQualityLoop(loopInput(), { store: memStore() });
		const result = await scheduled.promise;

		expect(result.stoppedBy).toBe("ship");
		expect(result.finalReport).toBe(shipped);
	});
});

describe("runQualityLoop — 직접 호출 시 signal 처리", () => {
	it("이미 abort 된 signal 을 직접 넘겨도 cancelled resolve (reject 아님)", async () => {
		const snapshot = report({ judgeMode: "heuristic_only" });
		heuristicMock.mockReturnValueOnce(snapshot);
		const controller = new AbortController();
		controller.abort();

		await expect(
			runQualityLoop(loopInput(), {
				store: memStore(),
				signal: controller.signal,
			}),
		).resolves.toMatchObject({ stoppedBy: "cancelled" });
	});
});

describe("runQualityLoop — options.budget 전달 검증", () => {
	it("options.budget 이 executeAutoFixPlan 의 네 번째 인자로 그대로 전달된다", async () => {
		const r1 = report({ overallScore: 55, bundleHash: "hash-b1" });
		const shipped = report({
			verdict: "ship",
			overallScore: 78,
			bundleHash: "hash-b2",
		});
		judgeMock.mockResolvedValueOnce(r1).mockResolvedValueOnce(shipped);
		executeMock.mockResolvedValueOnce(execResult({ costUsd: 0.1 }));

		const customBudget = {
			maxUsdPerLoop: 5,
			maxLlmCallsPerJudgement: 20,
			maxRounds: 3,
		};

		await runQualityLoop(loopInput(), {
			store: memStore(),
			budget: customBudget,
		});

		expect(executeMock).toHaveBeenCalledTimes(1);
		// 4번째 인자가 customBudget 임을 검증
		const callArgs = executeMock.mock.calls[0];
		expect(callArgs[3]).toEqual(customBudget);
	});
});
