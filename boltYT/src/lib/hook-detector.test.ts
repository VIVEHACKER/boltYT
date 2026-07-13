/**
 * hook-detector.ts 단위 테스트 — 순수 함수, 외부 의존 없음
 */

import { describe, expect, it } from "vitest";
import {
	buildHookFlags,
	detectEmpathyHook,
	detectHookPattern,
} from "./hook-detector";

// ─── detectHookPattern ────────────────────────────────────────────────────────

describe("detectHookPattern — 빈 입력", () => {
	it("빈 문자열 → pattern '', confidence 0", () => {
		expect(detectHookPattern("")).toEqual({ pattern: "", confidence: 0 });
	});

	it("공백만 → pattern '', confidence 0", () => {
		expect(detectHookPattern("   ")).toEqual({ pattern: "", confidence: 0 });
	});
});

describe("detectHookPattern — question 패턴", () => {
	it("물음표 끝 → question", () => {
		const r = detectHookPattern("이게 맞을까요?");
		expect(r.pattern).toBe("question");
		expect(r.confidence).toBeGreaterThan(0);
	});

	it("'왜'로 시작 → question", () => {
		expect(detectHookPattern("왜 이런 일이 일어났을까").pattern).toBe(
			"question",
		);
	});

	it("'알고 계셨나요?' → question", () => {
		expect(detectHookPattern("이 사실을 알고 계셨나요?").pattern).toBe(
			"question",
		);
	});

	it("'혹시' 포함 → question", () => {
		expect(detectHookPattern("혹시 이 방법 알고 계신가요").pattern).toBe(
			"question",
		);
	});

	it("'할까요' 포함 → question", () => {
		expect(detectHookPattern("과연 성공할까요").pattern).toBe("question");
	});
});

describe("detectHookPattern — shock 패턴", () => {
	it("'충격' 포함 → shock", () => {
		expect(detectHookPattern("충격적인 사실이 밝혀졌습니다").pattern).toBe(
			"shock",
		);
	});

	it("'놀라운' 포함 → shock", () => {
		expect(detectHookPattern("놀라운 반전이 숨어 있습니다").pattern).toBe(
			"shock",
		);
	});

	it("'사실은' 포함 → shock", () => {
		expect(detectHookPattern("사실은 이렇습니다").pattern).toBe("shock");
	});

	it("'반전' 포함 → shock", () => {
		expect(detectHookPattern("믿기 힘든 반전").pattern).toBe("shock");
	});
});

describe("detectHookPattern — claim 패턴", () => {
	it("'사실'로 시작 → claim", () => {
		expect(detectHookPattern("사실 이 방법이 최선입니다").pattern).toBe(
			"claim",
		);
	});

	it("'해야 합니다' 포함 → claim", () => {
		expect(detectHookPattern("반드시 알아야 합니다").pattern).toBe("claim");
	});

	it("'입니다.' 끝 → claim", () => {
		expect(detectHookPattern("이것이 핵심입니다.").pattern).toBe("claim");
	});
});

describe("detectHookPattern — story 패턴", () => {
	it("'이야기' 포함 → story", () => {
		expect(
			detectHookPattern("오늘은 특별한 이야기를 전해드립니다").pattern,
		).toBe("story");
	});

	it("'어느 날'로 시작 → story", () => {
		expect(
			detectHookPattern("어느 날 갑자기 모든 것이 바뀌었습니다").pattern,
		).toBe("story");
	});

	it("'경험' 포함 → story", () => {
		// "입니다" 없이 경험만 포함해야 claim과 겹치지 않음
		expect(detectHookPattern("직접 경험한 이야기를 전해드려요").pattern).toBe(
			"story",
		);
	});
});

describe("detectHookPattern — confidence", () => {
	it("패턴 1개 → confidence 0.4 (calibration 강화)", () => {
		// "경악"만 shock 패턴에 해당 → score=1, confidence=0.4
		const r = detectHookPattern("경악할 만한 일이 벌어졌어요");
		expect(r.confidence).toBeCloseTo(0.4, 1);
	});

	it("패턴 3개 이상 → confidence 1", () => {
		const r = detectHookPattern(
			"충격! 충격적인 사실은, 상상도 못한 반전이 있었습니다",
		);
		expect(r.confidence).toBe(1);
	});

	it("패턴 없는 평범한 문장 → pattern ''", () => {
		expect(detectHookPattern("오늘 날씨는 맑습니다").pattern).toBe("");
	});
});

describe("detectEmpathyHook — 도입부 감정 공감", () => {
	it("빈 입력 → 0", () => {
		expect(detectEmpathyHook("")).toBe(0);
		expect(detectEmpathyHook("   ")).toBe(0);
	});

	it("공감 신호 없는 평범한 정보 문장 → 0", () => {
		expect(detectEmpathyHook("로마 제국은 기원전 27년에 세워졌습니다")).toBe(0);
	});

	it("2인칭 호명/보편 동질감 → 공감 점수 상승", () => {
		// "당신도", "혹시", "느껴본" 3신호 → 1.0
		expect(
			detectEmpathyHook("당신도 혹시 이런 막막함을 느껴본 적 있나요"),
		).toBe(1);
	});

	it("신호 1개 → 0.4, 결정론적", () => {
		const a = detectEmpathyHook("우리 모두 겪는 일입니다만 정보만 전달");
		const b = detectEmpathyHook("우리 모두 겪는 일입니다만 정보만 전달");
		expect(a).toBe(b);
		expect(a).toBeGreaterThan(0);
	});
});

// ─── buildHookFlags ───────────────────────────────────────────────────────────

describe("buildHookFlags", () => {
	it("빈 배열 → 빈 배열", () => {
		expect(buildHookFlags([])).toEqual([]);
	});

	it("첫 씬이 hookWindow 내 → hookBoost true", () => {
		const flags = buildHookFlags([
			{ duration_seconds: 5, narration: "오늘 날씨입니다" },
			{ duration_seconds: 5, narration: "내일도 맑습니다" },
		]);
		expect(flags[0].hookBoost).toBe(true); // elapsed 0 < 10
		expect(flags[1].hookBoost).toBe(true); // elapsed 5 < 10
	});

	it("hookWindow 지난 씬 → hookBoost false", () => {
		const flags = buildHookFlags([
			{ duration_seconds: 10, narration: "오늘" },
			{ duration_seconds: 5, narration: "내일" },
		]);
		expect(flags[1].hookBoost).toBe(false); // elapsed 10 >= 10
	});

	it("첫 씬 — question 패턴이면 hookPattern 기록", () => {
		const flags = buildHookFlags([
			{ duration_seconds: 3, narration: "왜 이런 일이 생겼을까요?" },
		]);
		expect(flags[0].hookPattern).toBe("question");
	});

	it("첫 씬 — 강한 shock 패턴이면 hookBoost true (시간 무관)", () => {
		const flags = buildHookFlags(
			[
				{
					duration_seconds: 1,
					narration:
						"충격! 충격적인 사실은, 상상도 못한 반전이 있었습니다. 경악할 만한 일이 벌어졌습니다.",
				},
			],
			0,
		);
		// hookWindow=0이어도 contentBoost가 true면 hookBoost true
		expect(flags[0].hookBoost).toBe(true);
	});

	it("첫 씬 이후 → hookPattern 항상 ''", () => {
		const flags = buildHookFlags([
			{ duration_seconds: 3, narration: "왜 이런 일이?" },
			{ duration_seconds: 3, narration: "충격적인 반전" },
		]);
		expect(flags[1].hookPattern).toBe("");
	});

	it("narration 없으면 hookPattern ''", () => {
		const flags = buildHookFlags([{ duration_seconds: 5 }]);
		expect(flags[0].hookPattern).toBe("");
	});
});
