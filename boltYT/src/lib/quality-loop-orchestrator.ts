/**
 * 품질 루프 코디네이터 — judge → (ship/blocked 종료) → 승인 게이트 → execute →
 * 재번들(getBundle 재호출)·재판정을 maxRounds 한도 내에서 반복한다.
 *
 * 시스템 불변량 (이 모듈이 집행):
 * - blocked 는 fix 시도 없이 즉시 종료 — 루프/LLM 이 해제 불가(불변량 2).
 * - 비용 fail-closed(불변량 6): plan.requiresApproval 이면 approveOverBudget 콜백
 *   부재/거부/예외 전부 budget_declined 종료. 명시 승인 시에만 requiresApproval 을
 *   해제한 파생 plan 으로 실행한다 — 실행기 내부의 액션별 누적 예산 게이트
 *   (DEFAULT_FIX_BUDGET)는 그대로 동작한다.
 * - 멱등(불변량 5): 실행 historyEntries 를 store 에 기록하고 다음 라운드 judge 에
 *   주입 — 같은 fix 의 중복 적용을 라운드를 넘어 영구 차단.
 * - 점수 미상승 조기 종료: 재판정 점수가 직전 이하이면 추가 fix 없이 no_improvement.
 * - AbortSignal 은 단계 경계(라운드 시작 전·execute 직전)에서만 체크 — 진행 중인
 *   await(judge/execute)는 중단하지 않고, 완료 후 cancelled 로 resolve(reject 아님).
 */

import {
	type AutoFixContext,
	type AutoFixExecutionResult,
	executeAutoFixPlan,
} from "./auto-fix-executor";
import type { ContentBundle } from "./content-bundle";
import type { MarketBenchmark } from "./market-benchmark";
import {
	type FixHistoryEntry,
	loadFixHistory,
	type QualityHistoryStore,
	recordFixApplications,
} from "./quality-fix-history";
import {
	judgeContentBundle,
	judgeContentBundleHeuristic,
	type LlmCritic,
} from "./quality-judge";
import {
	type AutoFixPlan,
	DEFAULT_FIX_BUDGET,
	type FixBudget,
	type QualityVerdictReport,
} from "./quality-verdict";

export interface QualityLoopOptions {
	maxRounds?: number;
	budget?: FixBudget;
	llm?: LlmCritic;
	store?: QualityHistoryStore;
	approveOverBudget?: (plan: AutoFixPlan) => Promise<boolean>;
	onRound?: (r: QualityVerdictReport) => void;
	signal?: AbortSignal;
}

export interface QualityLoopResult {
	finalReport: QualityVerdictReport;
	rounds: QualityVerdictReport[];
	execution: AutoFixExecutionResult[];
	totalCostUsd: number;
	stoppedBy:
		| "ship"
		| "blocked"
		| "max_rounds"
		| "budget_declined"
		| "no_improvement"
		| "cancelled";
}

export interface ScheduledQualityLoop {
	promise: Promise<QualityLoopResult>;
	cancel: () => void;
}

export interface QualityLoopInput {
	getBundle: () => ContentBundle;
	benchmark: MarketBenchmark;
	fixContext: AutoFixContext;
}

/** USD 합산 부동소수점 노이즈 제거 — 실행기/플래너와 동일 자릿수 */
function round4(value: number): number {
	return Math.round(value * 10000) / 10000;
}

/**
 * 재판정 후 루프 계속 여부 — 순수 결정론 정책.
 * next.overallScore <= prev.overallScore → false (점수 미상승 조기 종료),
 * round >= maxRounds → false (상한 도달).
 */
export function shouldContinueLoop(
	prev: QualityVerdictReport,
	next: QualityVerdictReport,
	round: number,
	maxRounds: number,
): boolean {
	if (next.overallScore <= prev.overallScore) return false;
	if (round >= maxRounds) return false;
	return true;
}

/**
 * 품질 루프 실행. 라운드 = judge 1회 + (필요 시) fix 실행 1회.
 * maxRounds 는 judge 라운드 수 상한 — 기본은 budget.maxRounds(2).
 */
export async function runQualityLoop(
	i: QualityLoopInput,
	options: QualityLoopOptions = {},
): Promise<QualityLoopResult> {
	const budget = options.budget ?? DEFAULT_FIX_BUDGET;
	const maxRounds = options.maxRounds ?? budget.maxRounds;
	const signal = options.signal;
	const rounds: QualityVerdictReport[] = [];
	const execution: AutoFixExecutionResult[] = [];
	let totalCostUsd = 0;
	let history: FixHistoryEntry[] | undefined;
	let prev: QualityVerdictReport | undefined;
	let round = 1;

	const finish = (
		stoppedBy: QualityLoopResult["stoppedBy"],
		finalReport: QualityVerdictReport,
	): QualityLoopResult => ({
		finalReport,
		rounds,
		execution,
		totalCostUsd: round4(totalCostUsd),
		stoppedBy,
	});

	// 스케줄 직후의 동기 cancel() 이 첫 judge 전에 반영되도록 마이크로태스크 양보
	// (렌더 큐 비차단 — 호출자는 즉시 제어권을 돌려받는다)
	await Promise.resolve();

	for (;;) {
		// 라운드 경계 체크 — 진행 중이던 라운드는 이미 완료된 상태로만 도달한다
		if (signal?.aborted === true) {
			const last = rounds.at(-1);
			if (last !== undefined) return finish("cancelled", last);
			// 첫 라운드 전 취소 — finalReport 가 필수이므로 LLM 0비용 휴리스틱
			// 스냅샷으로 채운다 (fix 미실행, rounds 에는 미포함)
			const bundle = i.getBundle();
			const snapshot = judgeContentBundleHeuristic(
				bundle,
				i.benchmark,
				loadFixHistory(bundle.contentId, options.store),
			);
			return finish("cancelled", snapshot);
		}

		// 재번들 — 직전 라운드 fix 가 반영된 최신 번들을 매 라운드 다시 가져온다
		const bundle = i.getBundle();
		if (history === undefined) {
			history = loadFixHistory(bundle.contentId, options.store);
		}
		const report = await judgeContentBundle(bundle, i.benchmark, {
			budget,
			history,
			round,
			...(options.llm !== undefined ? { llm: options.llm } : {}),
			...(options.store !== undefined ? { store: options.store } : {}),
		});
		rounds.push(report);
		options.onRound?.(report);

		if (report.verdict === "ship") return finish("ship", report);
		// blocked 는 결정론 하드 블록 — fix 시도 없이 즉시 종료(불변량 2)
		if (report.verdict === "blocked") return finish("blocked", report);

		const wantsMore =
			prev === undefined
				? round < maxRounds
				: shouldContinueLoop(prev, report, round, maxRounds);
		if (!wantsMore) {
			const noImprovement =
				prev !== undefined && report.overallScore <= prev.overallScore;
			return finish(noImprovement ? "no_improvement" : "max_rounds", report);
		}

		// 승인 게이트 — fail-closed(불변량 6): 콜백 부재/거부/예외 전부 종료
		const plan = report.autoFixPlan;
		let planToExecute = plan;
		if (plan.requiresApproval) {
			const approve = options.approveOverBudget;
			if (approve === undefined) return finish("budget_declined", report);
			let approved = false;
			try {
				approved = await approve(plan);
			} catch {
				// 승인 채널 오류는 거부와 동일 — 비용 fail-closed
				approved = false;
			}
			if (!approved) return finish("budget_declined", report);
			// 명시 승인 — 실행기는 승인을 해제할 수 없으므로(fail-closed 게이트)
			// 승인 사실을 반영한 파생 plan 으로 전달한다 (원본 plan 불변)
			planToExecute = {
				...plan,
				requiresApproval: false,
				totalCost: { ...plan.totalCost, withinBudget: true },
			};
		}

		// execute 직전 경계 체크 — cancel 이후에는 fix 가 절대 적용되지 않는다
		if (signal?.aborted) return finish("cancelled", report);

		const exec = await executeAutoFixPlan(
			planToExecute,
			{ ...i.fixContext, bundleHash: report.bundleHash, round },
			history,
			budget,
		);
		execution.push(exec);
		totalCostUsd += exec.costUsd;
		if (exec.historyEntries.length > 0) {
			// 멱등 레저 영속화 — 다음 라운드 judge/planner 가 중복 fix 를 제외한다
			recordFixApplications(
				bundle.contentId,
				exec.historyEntries,
				options.store,
			);
			history = [...history, ...exec.historyEntries];
		}

		prev = report;
		round += 1;
	}
}

/**
 * AbortController 래퍼 — 렌더 큐를 막지 않고 루프를 시작하고,
 * cancel() 시 promise 는 stoppedBy:'cancelled' 로 resolve 된다(reject 아님).
 * options.signal 이 함께 주어지면 그 abort 도 내부 controller 로 전파된다.
 */
export function scheduleQualityLoop(
	i: QualityLoopInput,
	options: QualityLoopOptions = {},
): ScheduledQualityLoop {
	const controller = new AbortController();
	const upstream = options.signal;
	if (upstream !== undefined) {
		if (upstream.aborted) {
			controller.abort();
		} else {
			upstream.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
		}
	}
	const promise = runQualityLoop(i, { ...options, signal: controller.signal });
	return {
		promise,
		cancel: () => controller.abort(),
	};
}
