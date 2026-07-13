import { describe, expect, it } from "vitest";
import type { BundleScene, ContentBundle } from "./content-bundle";
import { hashContentBundle } from "./content-bundle";
import { getBuiltinBenchmark } from "./market-benchmark";
import type {
	FixHistoryEntry,
	QualityHistoryStore,
} from "./quality-fix-history";
import {
	buildLlmDigest,
	detectHardBlocks,
	judgeContentBundle,
	judgeContentBundleHeuristic,
	judgeLongformByChapters,
	type LlmCritic,
	scoreBgm,
	scoreEditing,
	scoreScript,
	scoreTts,
} from "./quality-judge";
import { collectJudgeSignals } from "./quality-judge-signals";
import {
	DEFAULT_FIX_BUDGET,
	type QualityDimension,
	type QualityVerdictReport,
} from "./quality-verdict";

const HORROR_SHORTS = getBuiltinBenchmark("horror_mystery", "shorts");
const DOCU_LONGFORM = getBuiltinBenchmark("docu_story", "longform");

const DIMENSIONS: QualityDimension[] = ["editing", "script", "bgm", "tts"];

function bscene(overrides: Partial<BundleScene> = {}): BundleScene {
	return {
		id: "s1",
		orderIndex: 0,
		narration: "사건 현장에는 단서가 거의 남지 않았습니다",
		durationSec: 6,
		type: "image",
		shotCount: 1,
		motionGraphicCount: 0,
		hasWordTimings: false,
		...overrides,
	};
}

function makeBundle(input: {
	scenes: BundleScene[];
	format?: "shorts" | "longform";
	tts?: Partial<ContentBundle["tts"]>;
	bgm?: Partial<ContentBundle["bgm"]>;
	scriptStructure?: string[];
}): ContentBundle {
	return {
		contentId: "c1",
		format: input.format ?? "shorts",
		durationSec: input.scenes.reduce((sum, s) => sum + s.durationSec, 0),
		scriptStructure: input.scriptStructure ?? ["hook", "body", "cta"],
		scenes: input.scenes,
		tts: { coverageRatio: 0.5, ...input.tts },
		bgm: { hasBeatGrid: false, ...input.bgm },
	};
}

/** 시장 바를 넘는 쇼츠 — llm_assisted 에서 ship 이 나와야 하는 기준 픽스처 */
function shippableBundle(): ContentBundle {
	const narrations = [
		"왜 이 사건은 30년째 풀리지 않았을까요?",
		"첫 번째 단서는 현장에서 발견된 낡은 사진이었습니다",
		"그런데 사진 속 인물은 이미 사라진 사람이었습니다",
		"경찰 기록과 증언은 서로 다른 시간을 가리켰습니다",
		"마지막 목격자는 끝내 입을 열지 않았습니다",
		"결국 확인된 것은 단 하나, 남은 의문은 아직 그대로입니다",
	];
	const types = ["video", "video", "image", "video", "image", "image"];
	return makeBundle({
		scenes: narrations.map((narration, i) =>
			bscene({
				id: `d${i}`,
				orderIndex: i,
				narration,
				durationSec: 4,
				type: types[i] ?? "image",
				shotCount: 3,
				motionGraphicCount: i === 2 || i === 4 ? 1 : 0,
				hasWordTimings: true,
				transition: i % 2 === 0 ? "cut" : "whip",
			}),
		),
		scriptStructure: ["hook", "buildup", "twist", "cta"],
		tts: { coverageRatio: 0.95, speed: 1.0, profile: "suspense" },
		bgm: {
			source: "ai_generated",
			mood: "dark",
			qualityScore: 78,
			lufsEstimate: -15,
			hasBeatGrid: true,
		},
	});
}

/** 바 미달이지만 하드 블록은 없는 쇼츠 — improve 가 나와야 하는 픽스처 */
function mediocreBundle(): ContentBundle {
	const narrations = [
		"안녕하세요 오늘은 미제 사건을 알아보겠습니다",
		"긴 정지 화면이 계속 이어지는 구간입니다",
		"별다른 변화 없이 마무리되는 장면입니다",
	];
	return makeBundle({
		scenes: narrations.map((narration, i) =>
			bscene({ id: `f${i}`, orderIndex: i, narration, durationSec: 10 }),
		),
		tts: { coverageRatio: 0.3 },
	});
}

/** 10분 롱폼 — 챕터 2(씬 6-8)만 의도적으로 망가뜨린 픽스처 */
function longformBundle(): ContentBundle {
	const goodNarration = (i: number) =>
		`왜 이 사건은 끝내 풀리지 않았을까요? ${"현장에 남은 기록과 증언은 서로 어긋났고, 우리는 그 차이를 하나씩 비교하며 사건의 시간대를 다시 맞춰 봅니다. ".repeat(3)}${i}번째 단서가 여기서 등장합니다`;
	const badNarrations = [
		"주변은 오랫동안 고요했고",
		"기록은 한동안 비어 있었으며",
		"그날의 흔적은 거의 남지 않았다고 전해진다",
	];
	const scenes = Array.from({ length: 10 }, (_, i) => {
		const bad = i >= 6 && i <= 8;
		return bscene({
			id: `l${i}`,
			orderIndex: i,
			narration: bad ? (badNarrations[i - 6] ?? "") : goodNarration(i),
			durationSec: 60,
			type: bad ? "image" : "video",
			shotCount: bad ? 1 : 12,
			motionGraphicCount: bad ? 0 : 1,
			hasWordTimings: !bad,
			...(bad ? {} : { transition: i % 2 === 0 ? "cut" : "dissolve" }),
		});
	});
	return makeBundle({
		scenes,
		format: "longform",
		scriptStructure: ["hook", "context", "journey", "reflection"],
		tts: { coverageRatio: 0.9, speed: 1.0, profile: "warm" },
		bgm: {
			source: "import",
			mood: "dramatic",
			qualityScore: 75,
			lufsEstimate: -15,
			hasBeatGrid: true,
		},
	});
}

function memStore(): QualityHistoryStore {
	const map = new Map<string, string>();
	return {
		get: (k) => map.get(k) ?? null,
		set: (k, v) => {
			map.set(k, v);
		},
	};
}

const VALID_CRITIC_RESPONSE = JSON.stringify({
	findings: {
		editing: ["루프 구간 반복감이 있음"],
		script: ["중반 전개가 늘어짐"],
	},
	fixHints: ["첫 2초에 모션 그래픽을 추가하라"],
});

function countingLlm(response: string | (() => string)) {
	const state = { count: 0 };
	const llm: LlmCritic = async () => {
		state.count += 1;
		return typeof response === "function" ? response() : response;
	};
	return { llm, state };
}

function throwingLlm() {
	const state = { count: 0 };
	const llm: LlmCritic = async () => {
		state.count += 1;
		throw new Error("timeout");
	};
	return { llm, state };
}

function withoutJudgedAt(report: QualityVerdictReport) {
	return { ...report, judgedAt: "" };
}

describe("쓰레기 픽스처 고정 세트 — heuristic_only 에서도 전부 blocked", () => {
	const fixtures: Array<{
		name: string;
		bundle: ContentBundle;
		benchmark: typeof HORROR_SHORTS;
		code: string;
	}> = [
		{
			name: "(a) 전체 빈 나레이션",
			bundle: makeBundle({
				scenes: [
					bscene({ id: "a0", orderIndex: 0, narration: "" }),
					bscene({ id: "a1", orderIndex: 1, narration: "   " }),
				],
			}),
			benchmark: HORROR_SHORTS,
			code: "empty_narration",
		},
		{
			name: "(b) 0씬",
			bundle: makeBundle({ scenes: [] }),
			benchmark: HORROR_SHORTS,
			code: "zero_scenes",
		},
		{
			name: "(c) 25분 롱폼",
			bundle: makeBundle({
				format: "longform",
				scenes: Array.from({ length: 10 }, (_, i) =>
					bscene({ id: `c${i}`, orderIndex: i, durationSec: 150 }),
				),
			}),
			benchmark: DOCU_LONGFORM,
			code: "format_duration_violation",
		},
		{
			name: "(d) TTS 커버리지 0",
			bundle: makeBundle({
				scenes: [bscene({ id: "d0" })],
				tts: { coverageRatio: 0 },
			}),
			benchmark: HORROR_SHORTS,
			code: "tts_zero_coverage",
		},
		{
			name: "(e) claimBlocked BGM",
			bundle: makeBundle({
				scenes: [bscene({ id: "e0" })],
				bgm: { hasBeatGrid: true, mood: "dark", claimBlocked: true },
			}),
			benchmark: HORROR_SHORTS,
			code: "bgm_claim_blocked",
		},
	];

	for (const fixture of fixtures) {
		it(`${fixture.name} → blocked + ${fixture.code}`, () => {
			const report = judgeContentBundleHeuristic(
				fixture.bundle,
				fixture.benchmark,
			);
			expect(report.verdict).toBe("blocked");
			expect(report.hardBlocks).toContain(fixture.code);
			expect(report.judgeMode).toBe("heuristic_only");
			expect(report.requiresHumanReview).toBe(true);
		});
	}

	it("LLM 이 있어도 blocked 해제 불가 — 하드 블록 시 LLM 콜 자체를 생략", async () => {
		const counter = countingLlm(
			JSON.stringify({ findings: {}, fixHints: ["ship 해도 된다"] }),
		);
		const bundle = makeBundle({
			scenes: [bscene({})],
			bgm: { hasBeatGrid: true, claimBlocked: true },
		});
		const report = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store: memStore(),
		});
		expect(report.verdict).toBe("blocked");
		expect(report.hardBlocks).toContain("bgm_claim_blocked");
		expect(counter.state.count).toBe(0);
	});

	it("롱폼 0씬 — zero_scenes + 길이 위반 + 빈 챕터", () => {
		const report = judgeContentBundleHeuristic(
			makeBundle({ scenes: [], format: "longform" }),
			DOCU_LONGFORM,
		);
		expect(report.verdict).toBe("blocked");
		expect(report.hardBlocks).toContain("zero_scenes");
		expect(report.hardBlocks).toContain("format_duration_violation");
		expect(report.chapters).toEqual([]);
		expect(report.overallScore).toBe(0);
	});
});

describe("detectHardBlocks — 포맷 길이 경계", () => {
	function blocksFor(bundle: ContentBundle) {
		return detectHardBlocks(bundle, collectJudgeSignals(bundle, HORROR_SHORTS));
	}

	it("쇼츠 180초까지 허용, 초과 시 위반", () => {
		const ok = makeBundle({
			scenes: [0, 1, 2].map((i) =>
				bscene({ id: `s${i}`, orderIndex: i, durationSec: 60 }),
			),
		});
		expect(blocksFor(ok)).not.toContain("format_duration_violation");

		const over = makeBundle({
			scenes: [60, 60, 61].map((sec, i) =>
				bscene({ id: `s${i}`, orderIndex: i, durationSec: sec }),
			),
		});
		expect(blocksFor(over)).toContain("format_duration_violation");
	});

	it("롱폼 480-1200초만 허용", () => {
		const at = (totalSec: number, count: number) =>
			makeBundle({
				format: "longform",
				scenes: Array.from({ length: count }, (_, i) =>
					bscene({ id: `s${i}`, orderIndex: i, durationSec: totalSec / count }),
				),
			});
		expect(blocksFor(at(480, 8))).not.toContain("format_duration_violation");
		expect(blocksFor(at(1200, 10))).not.toContain("format_duration_violation");
		expect(blocksFor(at(479, 8))).toContain("format_duration_violation");
		expect(blocksFor(at(1201, 10))).toContain("format_duration_violation");
	});
});

describe("결정론 — 같은 번들+벤치마크 → judgedAt 제외 동일 리포트", () => {
	it("heuristic 2회 판정 동일", () => {
		const first = judgeContentBundleHeuristic(mediocreBundle(), HORROR_SHORTS);
		const second = judgeContentBundleHeuristic(mediocreBundle(), HORROR_SHORTS);
		expect(withoutJudgedAt(second)).toEqual(withoutJudgedAt(first));
	});

	it("LLM 포함 skipCache 2회 판정 동일 + bundleHash 멱등", async () => {
		const bundle = shippableBundle();
		const first = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: countingLlm(VALID_CRITIC_RESPONSE).llm,
			store: memStore(),
			skipCache: true,
		});
		const second = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: countingLlm(VALID_CRITIC_RESPONSE).llm,
			store: memStore(),
			skipCache: true,
		});
		expect(withoutJudgedAt(second)).toEqual(withoutJudgedAt(first));
		expect(first.bundleHash).toBe(
			hashContentBundle(bundle, HORROR_SHORTS.fingerprint),
		);
	});

	it("롱폼 heuristic 2회 판정 동일 (챕터 포함)", () => {
		const first = judgeContentBundleHeuristic(longformBundle(), DOCU_LONGFORM);
		const second = judgeContentBundleHeuristic(longformBundle(), DOCU_LONGFORM);
		expect(withoutJudgedAt(second)).toEqual(withoutJudgedAt(first));
	});
});

describe("LLM 실패 → heuristic_only 디그레이드 (ship 금지)", () => {
	it("LLM throw — ship 자격 점수여도 improve + requiresHumanReview", async () => {
		const thrower = throwingLlm();
		const report = await judgeContentBundle(shippableBundle(), HORROR_SHORTS, {
			llm: thrower.llm,
			store: memStore(),
		});
		expect(thrower.state.count).toBe(1);
		expect(report.judgeMode).toBe("heuristic_only");
		expect(report.requiresHumanReview).toBe(true);
		expect(report.overallScore).toBeGreaterThanOrEqual(report.marketBar);
		expect(report.verdict).toBe("improve");
	});

	it("같은 번들 + 정상 LLM → ship (대조군)", async () => {
		const report = await judgeContentBundle(shippableBundle(), HORROR_SHORTS, {
			llm: countingLlm(VALID_CRITIC_RESPONSE).llm,
			store: memStore(),
		});
		expect(report.judgeMode).toBe("llm_assisted");
		expect(report.verdict).toBe("ship");
		expect(report.requiresHumanReview).toBe(false);
	});

	it("LLM 부재(heuristic) — 점수가 바를 넘어도 ship 금지", () => {
		const report = judgeContentBundleHeuristic(
			shippableBundle(),
			HORROR_SHORTS,
		);
		expect(report.overallScore).toBeGreaterThanOrEqual(report.marketBar);
		expect(report.verdict).toBe("improve");
		expect(report.requiresHumanReview).toBe(true);
	});

	it("비정형(non-JSON) 응답도 실패로 간주 → heuristic_only", async () => {
		const report = await judgeContentBundle(mediocreBundle(), HORROR_SHORTS, {
			llm: countingLlm("이건 JSON 이 아니라 그냥 문장입니다").llm,
			store: memStore(),
		});
		expect(report.judgeMode).toBe("heuristic_only");
		expect(report.requiresHumanReview).toBe(true);
	});

	it("코드펜스로 감싼 JSON 은 정상 파싱 → llm_assisted", async () => {
		const fenced = `\`\`\`json\n${VALID_CRITIC_RESPONSE}\n\`\`\``;
		const report = await judgeContentBundle(mediocreBundle(), HORROR_SHORTS, {
			llm: countingLlm(fenced).llm,
			store: memStore(),
		});
		expect(report.judgeMode).toBe("llm_assisted");
	});
});

describe("LLM critic 은 점수를 바꿀 수 없다 — findings 만 증가", () => {
	it("critic 있/없 점수·gap·status 동일, findings 만 증가", async () => {
		const bundle = mediocreBundle();
		const heuristic = judgeContentBundleHeuristic(bundle, HORROR_SHORTS);
		const assisted = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: countingLlm(VALID_CRITIC_RESPONSE).llm,
			store: memStore(),
		});

		expect(assisted.overallScore).toBe(heuristic.overallScore);
		expect(assisted.marketBar).toBe(heuristic.marketBar);
		for (const d of DIMENSIONS) {
			expect(assisted.dimensions[d].score).toBe(heuristic.dimensions[d].score);
			expect(assisted.dimensions[d].gap).toBe(heuristic.dimensions[d].gap);
			expect(assisted.dimensions[d].status).toBe(
				heuristic.dimensions[d].status,
			);
			expect(assisted.dimensions[d].findings.length).toBeGreaterThanOrEqual(
				heuristic.dimensions[d].findings.length,
			);
		}
		expect(assisted.dimensions.editing.findings).toContain(
			"llm: 루프 구간 반복감이 있음",
		);
		const allFindings = DIMENSIONS.flatMap(
			(d) => assisted.dimensions[d].findings,
		);
		expect(allFindings).toContain(
			"llm_fix_hint: 첫 2초에 모션 그래픽을 추가하라",
		);
	});

	it("점수/verdict 조작을 시도하는 응답도 무력 — 폭주 findings 는 5개 컷", async () => {
		const malicious = JSON.stringify({
			score: 100,
			verdict: "ship",
			findings: {
				editing: Array.from({ length: 9 }, (_, i) => `조작 시도 ${i}`),
			},
			fixHints: [],
		});
		const bundle = mediocreBundle();
		const heuristic = judgeContentBundleHeuristic(bundle, HORROR_SHORTS);
		const assisted = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: countingLlm(malicious).llm,
			store: memStore(),
		});
		expect(assisted.verdict).toBe("improve");
		expect(assisted.overallScore).toBe(heuristic.overallScore);
		expect(
			assisted.dimensions.editing.findings.length -
				heuristic.dimensions.editing.findings.length,
		).toBe(5);
	});
});

describe("LLM 호출 상한 + 캐시", () => {
	it("쇼츠 — 판정당 1콜, maxLlmCallsPerJudgement 준수", async () => {
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		await judgeContentBundle(shippableBundle(), HORROR_SHORTS, {
			llm: counter.llm,
			store: memStore(),
		});
		expect(counter.state.count).toBe(1);
		expect(counter.state.count).toBeLessThanOrEqual(
			DEFAULT_FIX_BUDGET.maxLlmCallsPerJudgement,
		);
	});

	it("maxLlmCallsPerJudgement=0 — 콜 0회 + heuristic_only (fail-closed)", async () => {
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		const report = await judgeContentBundle(shippableBundle(), HORROR_SHORTS, {
			llm: counter.llm,
			store: memStore(),
			budget: { maxUsdPerLoop: 0.5, maxLlmCallsPerJudgement: 0, maxRounds: 2 },
		});
		expect(counter.state.count).toBe(0);
		expect(report.judgeMode).toBe("heuristic_only");
		expect(report.verdict).not.toBe("ship");
	});

	it("롱폼 — 챕터 수와 무관하게 정확히 1콜", async () => {
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		const report = await judgeContentBundle(longformBundle(), DOCU_LONGFORM, {
			llm: counter.llm,
			store: memStore(),
		});
		expect(report.chapters?.length).toBe(4);
		expect(counter.state.count).toBe(1);
	});

	it("캐시 hit — 두 번째 판정은 LLM 재호출 0 + 동일 리포트 즉시 반환", async () => {
		const store = memStore();
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		const bundle = shippableBundle();
		const first = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store,
		});
		const second = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store,
		});
		expect(counter.state.count).toBe(1);
		expect(second).toEqual(first);
	});

	it("skipCache — 캐시를 읽지 않아 LLM 이 매번 호출된다", async () => {
		const store = memStore();
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		const bundle = shippableBundle();
		await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store,
			skipCache: true,
		});
		await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store,
			skipCache: true,
		});
		expect(counter.state.count).toBe(2);
	});

	it("[회귀] llm 으로 ship 캐시 후 llm 없이 호출 → 캐시 미스 + heuristic_only improve", async () => {
		// LLM 포함 판정으로 ship 을 캐시
		const store = memStore();
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		const bundle = shippableBundle();
		const first = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store,
		});
		expect(first.verdict).toBe("ship");
		expect(first.judgeMode).toBe("llm_assisted");

		// 같은 store + 같은 번들이지만 llm 없이(컨텍스트 다름) → 캐시 미스 → 재판정
		const second = await judgeContentBundle(bundle, HORROR_SHORTS, {
			// llm 미전달
			store,
		});
		// heuristic_only 에서 ship 은 절대 나오지 않는다(불변량 3)
		expect(second.judgeMode).toBe("heuristic_only");
		expect(second.verdict).toBe("improve");
		expect(second.requiresHumanReview).toBe(true);
		// LLM 은 첫 번째 판정에서만 호출됨
		expect(counter.state.count).toBe(1);
	});

	it("[회귀] 같은 컨텍스트(llm+budget+history) 재호출은 여전히 캐시 hit", async () => {
		const store = memStore();
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		const bundle = shippableBundle();
		const opts = {
			llm: counter.llm,
			store,
			budget: DEFAULT_FIX_BUDGET,
			history: [] as FixHistoryEntry[],
		};
		const first = await judgeContentBundle(bundle, HORROR_SHORTS, opts);
		expect(counter.state.count).toBe(1);

		// 동일 컨텍스트 재호출 → 캐시 hit, LLM 재호출 없음
		const second = await judgeContentBundle(bundle, HORROR_SHORTS, opts);
		expect(counter.state.count).toBe(1); // LLM 재호출 0
		expect(second).toEqual(first);
	});

	it("[회귀] 같은 번들 + 다른 maxUsdPerLoop → 캐시 미스 (다른 키)", async () => {
		// 같은 번들, 같은 번들해시이지만 예산이 다르면 verdict 캐시 키가 달라야 한다.
		// autoFixPlan.requiresApproval / estimatedFixCost.withinBudget 은 maxUsdPerLoop 에
		// 직접 의존하므로, 이전 예산 기준 캐시를 재사용하면 승인 게이트가 오동작한다.
		// mediocreBundle: tts_retake(0.05$/씬 × 3씬=0.15$) + opening_hook_rewrite(0.02$) 등
		// 유료 액션이 포함되어 budget 에 따라 withinBudget 이 확실히 달라진다.
		const bundle = mediocreBundle();

		// 각각 분리된 store 로 LLM 응답 캐시 영향을 제거하고 독립 판정
		const lowBudgetReport = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: countingLlm(VALID_CRITIC_RESPONSE).llm,
			store: memStore(),
			budget: { ...DEFAULT_FIX_BUDGET, maxUsdPerLoop: 0.001 },
		});

		const highBudgetReport = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: countingLlm(VALID_CRITIC_RESPONSE).llm,
			store: memStore(),
			budget: { ...DEFAULT_FIX_BUDGET, maxUsdPerLoop: 100 },
		});

		// 번들해시·점수는 같아야 한다 (같은 번들 + 같은 벤치마크)
		expect(lowBudgetReport.bundleHash).toBe(highBudgetReport.bundleHash);
		expect(lowBudgetReport.overallScore).toBe(highBudgetReport.overallScore);

		// 예산 0.001 USD → 유료 액션(tts_retake 등)이 초과 → withinBudget=false
		// 예산 100 USD → 모든 액션이 범위 내 → withinBudget=true
		expect(lowBudgetReport.estimatedFixCost.withinBudget).toBe(false);
		expect(highBudgetReport.estimatedFixCost.withinBudget).toBe(true);

		// 같은 예산으로 공유 store 두 번 호출 → 두 번째는 verdict 캐시 hit
		const sharedStore = memStore();
		const counter = countingLlm(VALID_CRITIC_RESPONSE);
		const first = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store: sharedStore,
			budget: { ...DEFAULT_FIX_BUDGET, maxUsdPerLoop: 0.5 },
		});
		const second = await judgeContentBundle(bundle, HORROR_SHORTS, {
			llm: counter.llm,
			store: sharedStore,
			budget: { ...DEFAULT_FIX_BUDGET, maxUsdPerLoop: 0.5 }, // 같은 예산 → 캐시 hit
		});
		// LLM 원응답 캐시(llm_critic_)도 재사용되므로 1회만 호출된다
		expect(counter.state.count).toBe(1);
		expect(second).toEqual(first);
	});
});

describe("롱폼 챕터 분할 + worst-chapter 지배", () => {
	it("4챕터 분할, 망가진 챕터 2가 최저, 점수는 worst+12 에 묶인다", () => {
		const report = judgeContentBundleHeuristic(longformBundle(), DOCU_LONGFORM);
		expect(report.hardBlocks).toEqual([]);
		expect(report.chapters?.length).toBe(4);

		const chapters = report.chapters ?? [];
		expect(chapters.map((c) => c.index)).toEqual([0, 1, 2, 3]);
		const scores = chapters.map((c) => c.score);
		const worst = Math.min(...scores);
		expect(scores[2]).toBe(worst);
		for (const i of [0, 1, 3]) {
			expect(scores[2]).toBeLessThan(scores[i] ?? 0);
		}

		const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
		expect(report.overallScore).toBeLessThanOrEqual(worst + 12.01);
		expect(report.overallScore).toBeLessThan(mean);
	});

	it("챕터 경계는 씬 단위 누적 — 0-180/180-360/360-540/540-600", () => {
		const report = judgeContentBundleHeuristic(longformBundle(), DOCU_LONGFORM);
		expect((report.chapters ?? []).map((c) => [c.startSec, c.endSec])).toEqual([
			[0, 180],
			[180, 360],
			[360, 540],
			[540, 600],
		]);
	});

	it("judgeLongformByChapters 직접 호출 = judgeContentBundle 롱폼 위임", async () => {
		const bundle = longformBundle();
		const direct = await judgeLongformByChapters(bundle, DOCU_LONGFORM, {
			store: memStore(),
			skipCache: true,
		});
		const delegated = await judgeContentBundle(bundle, DOCU_LONGFORM, {
			store: memStore(),
			skipCache: true,
		});
		expect(withoutJudgedAt(direct)).toEqual(withoutJudgedAt(delegated));
	});

	it("쇼츠 리포트에는 chapters 가 없다", () => {
		const report = judgeContentBundleHeuristic(
			shippableBundle(),
			HORROR_SHORTS,
		);
		expect(report.chapters).toBeUndefined();
	});
});

describe("score* — gap/status 규칙", () => {
	it("gap = bar - score (소수 2자리), 충족 시 pass", () => {
		const signals = collectJudgeSignals(shippableBundle(), HORROR_SHORTS);
		for (const verdict of [
			scoreEditing(signals, HORROR_SHORTS),
			scoreScript(signals, HORROR_SHORTS),
			scoreBgm(signals, HORROR_SHORTS),
			scoreTts(signals, HORROR_SHORTS),
		]) {
			expect(verdict.gap).toBe(
				Math.round((verdict.bar - verdict.score) * 100) / 100,
			);
			expect(verdict.status).toBe("pass");
			expect(verdict.gap).toBeLessThanOrEqual(0);
		}
	});

	it("gap ≤ 15 → below_bar, 초과 → critical", () => {
		// mood 일치 + 큐 없음 + 품질 미산출 → bgm 약 62.6 (gap ~7.4 → below_bar)
		const belowBar = makeBundle({
			scenes: [bscene({})],
			bgm: { hasBeatGrid: false, mood: "dark" },
		});
		const below = scoreBgm(
			collectJudgeSignals(belowBar, HORROR_SHORTS),
			HORROR_SHORTS,
		);
		expect(below.status).toBe("below_bar");
		expect(below.gap).toBeGreaterThan(0);
		expect(below.gap).toBeLessThanOrEqual(15);

		const critical = scoreTts(
			collectJudgeSignals(mediocreBundle(), HORROR_SHORTS),
			HORROR_SHORTS,
		);
		expect(critical.status).toBe("critical");
		expect(critical.gap).toBeGreaterThan(15);
	});

	it("claimBlocked BGM → 점수 0 + critical", () => {
		const bundle = makeBundle({
			scenes: [bscene({})],
			bgm: { hasBeatGrid: true, claimBlocked: true },
		});
		const verdict = scoreBgm(
			collectJudgeSignals(bundle, HORROR_SHORTS),
			HORROR_SHORTS,
		);
		expect(verdict.score).toBe(0);
		expect(verdict.status).toBe("critical");
		expect(verdict.findings).toContain("bgm_claim_blocked");
	});
});

describe("autoFixPlan 연동", () => {
	it("미통과 차원의 fixIds 는 plan 액션 id 와 일치한다", () => {
		const report = judgeContentBundleHeuristic(mediocreBundle(), HORROR_SHORTS);
		expect(report.verdict).toBe("improve");
		expect(report.autoFixPlan.actions.length).toBeGreaterThan(0);
		expect(report.estimatedFixCost).toEqual(report.autoFixPlan.totalCost);
		for (const d of DIMENSIONS) {
			const verdict = report.dimensions[d];
			const planIds = report.autoFixPlan.actions
				.filter((a) => a.dimension === d)
				.map((a) => a.id);
			expect(verdict.fixIds).toEqual(planIds);
			if (verdict.status !== "pass") {
				expect(verdict.fixIds.length).toBeGreaterThan(0);
			}
			for (const id of verdict.fixIds) {
				expect(id.startsWith(`${d}:`)).toBe(true);
			}
		}
	});

	it("이력의 idempotencyKey 와 충돌하는 fix 는 영구 skip", () => {
		const bundle = mediocreBundle();
		const first = judgeContentBundleHeuristic(bundle, HORROR_SHORTS);
		const action = first.autoFixPlan.actions[0];
		expect(action).toBeDefined();
		const entry: FixHistoryEntry = {
			idempotencyKey: action?.idempotencyKey ?? "",
			actionType: action?.type ?? "",
			bundleHash: first.bundleHash,
			round: 0,
			appliedAt: "2026-01-01T00:00:00.000Z",
		};
		const second = judgeContentBundleHeuristic(bundle, HORROR_SHORTS, [entry]);
		expect(second.autoFixPlan.skippedDuplicateIds).toContain(
			entry.idempotencyKey,
		);
		expect(
			second.autoFixPlan.actions.map((a) => a.idempotencyKey),
		).not.toContain(entry.idempotencyKey);
	});
});

describe("buildLlmDigest — 메트릭 요약만, 스크립트 전문 미포함", () => {
	it("나레이션 원문이 다이제스트에 들어가지 않는다", () => {
		const bundle = longformBundle();
		const report = judgeContentBundleHeuristic(bundle, DOCU_LONGFORM);
		const digest = buildLlmDigest(bundle, DOCU_LONGFORM, report.chapters);
		expect(digest).toContain("format=longform");
		expect(digest).toContain("[chapter 0]");
		expect(digest).not.toContain("고요했고");
		expect(digest).not.toContain("풀리지 않았을까요");
	});

	it("챕터 라인은 320자 컷", () => {
		const bundle = longformBundle();
		const report = judgeContentBundleHeuristic(bundle, DOCU_LONGFORM);
		const digest = buildLlmDigest(bundle, DOCU_LONGFORM, report.chapters);
		for (const line of digest.split("\n")) {
			if (line.startsWith("[chapter")) {
				expect(line.length).toBeLessThanOrEqual(320);
			}
		}
	});

	it("chapters 미전달(쇼츠) 시 챕터 라인이 없다", () => {
		const digest = buildLlmDigest(shippableBundle(), HORROR_SHORTS);
		expect(digest).not.toContain("[chapter");
	});
});
