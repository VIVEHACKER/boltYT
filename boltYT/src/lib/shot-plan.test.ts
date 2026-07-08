import { describe, expect, it } from "vitest";
import {
	type AuditCut,
	auditStorySync,
	blockFor,
	budgetNarrationChars,
	buildShotPlan,
	cutId,
	cutsNeedingRegen,
	estimateSpeakingSeconds,
	type PlanScene,
	planRebudget,
	recommendSceneCount,
	summarizeAudit,
	targetSecondsPerCut,
} from "./shot-plan";

describe("cutId", () => {
	it("0패딩 3자리", () => {
		expect(cutId(1)).toBe("CUT_001");
		expect(cutId(41)).toBe("CUT_041");
		expect(cutId(123)).toBe("CUT_123");
	});
});

describe("estimateSpeakingSeconds", () => {
	it("공백 제외 문자수 / 속도, 하한 1.5", () => {
		expect(estimateSpeakingSeconds("", 5.5)).toBe(1.5);
		expect(estimateSpeakingSeconds("가".repeat(55), 5.5)).toBeCloseTo(10, 1);
		// 짧은 텍스트는 하한
		expect(estimateSpeakingSeconds("짧다", 5.5)).toBe(1.5);
	});
	it("공백은 길이에서 제외", () => {
		expect(estimateSpeakingSeconds("가 가 가", 5.5)).toBe(
			estimateSpeakingSeconds("가가가", 5.5),
		);
	});
});

describe("budgetNarrationChars (visual-length→script-length)", () => {
	it("목표 초 × 속도 = 권장 문자수", () => {
		expect(budgetNarrationChars(8, 5.5)).toBe(44);
		expect(budgetNarrationChars(12, 5.5)).toBe(66);
	});
	it("음수/0 방어", () => {
		expect(budgetNarrationChars(-5, 5.5)).toBe(0);
	});
});

describe("recommendSceneCount (측정평균 기반, 고정 SEC_PER_SCENE 대체)", () => {
	it("측정 평균으로 씬수 산정", () => {
		// 600초 목표, 측정 평균 20초 → 30씬
		expect(recommendSceneCount(600, 20)).toBe(30);
	});
	it("min/cap 클램프", () => {
		expect(recommendSceneCount(60, 20, { min: 8 })).toBe(8); // raw 3 → min 8
		expect(recommendSceneCount(6000, 10, { cap: 60 })).toBe(60); // raw 600 → cap
	});
	it("측정값 없으면 fallbackSec", () => {
		expect(recommendSceneCount(160, 0, { fallbackSec: 16, min: 1 })).toBe(10);
	});
});

describe("blockFor", () => {
	it("scene idx → 블록 라벨", () => {
		const starts = [0, 3, 6];
		const labels = ["intro", "body", "outro"];
		expect(blockFor(0, starts, labels)).toBe("intro");
		expect(blockFor(2, starts, labels)).toBe("intro");
		expect(blockFor(3, starts, labels)).toBe("body");
		expect(blockFor(7, starts, labels)).toBe("outro");
	});
	it("라벨 없으면 B## 자동", () => {
		expect(blockFor(5, [0, 4], [])).toBe("B02");
	});
});

describe("buildShotPlan", () => {
	const scenes: PlanScene[] = [
		{ narration: "옛날 옛적에 살았습니다", visual: "a village at dawn" },
		{ narration: "", visual: "wide landscape, no people" },
		{ narration: "그리고 떠났습니다", visual: "grandmother walking, hospital" },
	];
	it("컷별 메타 부여(번호/블록/예상길이/금지장소)", () => {
		const plan = buildShotPlan(scenes, {
			blockStarts: [0, 2],
			blockLabels: ["ch1", "ch2"],
			forbiddenLocations: ["bank", "salon"],
			charsPerSec: 5.5,
		});
		expect(plan).toHaveLength(3);
		expect(plan[0].cutId).toBe("CUT_001");
		expect(plan[0].block).toBe("ch1");
		expect(plan[2].block).toBe("ch2");
		expect(plan[0].purpose).toBe("a-roll");
		expect(plan[1].purpose).toBe("b-roll"); // 내레이션 없음
		expect(plan[0].forbiddenLocations).toEqual(["bank", "salon"]);
		expect(plan[0].expectedSec).toBeGreaterThan(0);
	});
	it("requiredCharacters 를 visual 에서 매칭", () => {
		const plan = buildShotPlan(scenes, {
			requiredCharacters: ["grandmother", "doctor"],
		});
		expect(plan[2].characters).toContain("grandmother");
		expect(plan[2].characters).not.toContain("doctor");
	});
});

describe("auditStorySync", () => {
	it("금지장소 등장 = error", () => {
		const cuts: AuditCut[] = [
			{
				cutId: "CUT_001",
				narration: "n",
				visual: "grandmother at the bank",
				forbiddenLocations: ["bank"],
			},
		];
		const issues = auditStorySync(cuts);
		expect(
			issues.some(
				(i) => i.code === "forbidden-location" && i.severity === "error",
			),
		).toBe(true);
	});
	it("빈 visual = error, 빈 내레이션 = warn", () => {
		const issues = auditStorySync([
			{ cutId: "CUT_001", narration: "", visual: "" },
		]);
		expect(
			issues.some((i) => i.code === "empty-visual" && i.severity === "error"),
		).toBe(true);
		expect(
			issues.some((i) => i.code === "empty-narration" && i.severity === "warn"),
		).toBe(true);
	});
	it("화면 텍스트 요청 = warn(중복 1회)", () => {
		const issues = auditStorySync([
			{
				cutId: "CUT_001",
				narration: "n",
				visual: "poster with big text and logo",
			},
		]);
		expect(issues.filter((i) => i.code === "text-in-visual")).toHaveLength(1);
	});
	it("필수 인물 누락 = warn", () => {
		const issues = auditStorySync([
			{
				cutId: "CUT_001",
				narration: "n",
				visual: "empty room",
				requiredCharacters: ["grandmother"],
			},
		]);
		expect(issues.some((i) => i.code === "missing-character")).toBe(true);
	});
	it("페이스 불일치(예상 vs 측정) = warn", () => {
		const issues = auditStorySync(
			[
				{
					cutId: "CUT_001",
					narration: "n",
					visual: "v",
					expectedSec: 4,
					measuredSec: 9,
				},
			],
			{ paceTolerance: 0.4 },
		);
		expect(issues.some((i) => i.code === "pace-mismatch")).toBe(true);
	});
	it("페이스 허용 범위 내 = 이슈 없음", () => {
		const issues = auditStorySync([
			{
				cutId: "CUT_001",
				narration: "n",
				visual: "v",
				expectedSec: 8,
				measuredSec: 8.5,
			},
		]);
		expect(issues.some((i) => i.code === "pace-mismatch")).toBe(false);
	});
});

describe("cutsNeedingRegen / summarizeAudit", () => {
	it("error 컷만 재생성 대상(중복 제거)", () => {
		const issues = auditStorySync([
			{ cutId: "CUT_001", narration: "", visual: "", forbiddenLocations: [] },
			{ cutId: "CUT_002", narration: "ok", visual: "ok scene" },
		]);
		expect(cutsNeedingRegen(issues)).toEqual(["CUT_001"]);
		const sum = summarizeAudit(issues);
		expect(sum.errors).toBeGreaterThanOrEqual(1);
		expect(sum.regenCuts).toEqual(["CUT_001"]);
	});
});

describe("targetSecondsPerCut", () => {
	it("목표 총길이를 균등 분배 + 클램프", () => {
		expect(targetSecondsPerCut(120, 12)).toEqual(Array(12).fill(10));
		expect(targetSecondsPerCut(1000, 10, { max: 20 })[0]).toBe(20); // max 클램프
		expect(targetSecondsPerCut(10, 10, { min: 4 })[0]).toBe(4); // min 클램프
	});
	it("총길이 0 이면 defaultPerCut", () => {
		expect(targetSecondsPerCut(0, 3, { defaultPerCut: 9 })).toEqual([9, 9, 9]);
	});
	it("씬 0 이면 빈 배열", () => {
		expect(targetSecondsPerCut(100, 0)).toEqual([]);
	});
});

describe("planRebudget (액티브 rebudget 대상 선별)", () => {
	it("tolerance 초과 컷만, direction/targetChars 산정", () => {
		// target 8s(≈44자). 짧음→expand, 적정→제외, 김→trim.
		const narrations = ["짧다", "가".repeat(44), "가".repeat(120)];
		const plan = planRebudget(narrations, [8, 8, 8], { tolerance: 0.35 });
		const idxs = plan.map((p) => p.index);
		expect(idxs).toContain(0);
		expect(idxs).not.toContain(1);
		expect(idxs).toContain(2);
		expect(plan.find((p) => p.index === 0)?.direction).toBe("expand");
		expect(plan.find((p) => p.index === 2)?.direction).toBe("trim");
		expect(plan.find((p) => p.index === 0)?.targetChars).toBe(44);
	});
	it("target<=0 컷은 건너뜀", () => {
		expect(planRebudget(["가".repeat(100)], [0])).toEqual([]);
	});
});
