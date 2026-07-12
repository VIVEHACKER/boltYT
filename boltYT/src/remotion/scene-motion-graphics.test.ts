import { describe, expect, it } from "vitest";
import {
	buildSceneGraphics,
	corroboratedDelta,
	deltaArrowSpec,
	KR_DOWN,
	KR_UP,
	krDeltaColor,
	llmKeyFigureToKeyFigure,
	numberCounterSpec,
	parseEconomyPercentages,
	parseLlmKeyFigure,
	sourceLowerThird,
} from "./scene-motion-graphics";

const F = 30; // MG_FPS
const SCENE = F * 5; // 5s scene

describe("krDeltaColor (한국 시장 색 규약)", () => {
	it("상승/0 = 빨강, 하락 = 파랑", () => {
		expect(krDeltaColor(2.3)).toBe(KR_UP);
		expect(krDeltaColor(0)).toBe(KR_UP);
		expect(krDeltaColor(-1.1)).toBe(KR_DOWN);
	});
	it("undefined/NaN → 색 미지정", () => {
		expect(krDeltaColor(undefined)).toBeUndefined();
		expect(krDeltaColor(Number.NaN)).toBeUndefined();
	});
});

describe("sourceLowerThird", () => {
	it("출처 라벨 → lower_third 스펙(하단, 최대 4s)", () => {
		const s = sourceLowerThird("한국경제", "2026-07-11", SCENE);
		expect(s).not.toBeNull();
		expect(s?.type).toBe("lower_third");
		expect(s?.params.title).toBe("한국경제");
		expect(s?.params.subtitle).toBe("2026-07-11");
		expect(s?.params.position).toBe("bottom");
		expect(s?.duration).toBeLessThanOrEqual(F * 4);
		expect((s?.startFrame ?? 0) + (s?.duration ?? 0)).toBeLessThanOrEqual(
			SCENE,
		);
	});
	it("빈 제목/너무 짧은 씬 → null(출력 불변)", () => {
		expect(sourceLowerThird("  ", undefined, SCENE)).toBeNull();
		expect(sourceLowerThird("출처", undefined, F - 1)).toBeNull();
	});
	it("공백 subtitle 은 키 생략", () => {
		const s = sourceLowerThird("기관", "   ", SCENE);
		expect(s?.params.subtitle).toBeUndefined();
	});
});

describe("numberCounterSpec", () => {
	it("지수(≥1000) → comma 포맷, 상승 delta → 빨강", () => {
		const s = numberCounterSpec(
			{ target: 2650, delta: 1.2, suffix: " KOSPI" },
			SCENE,
		);
		expect(s?.type).toBe("number_counter");
		expect(s?.params.target).toBe(2650);
		expect(s?.params.format).toBe("comma");
		expect(s?.params.color).toBe(KR_UP);
		expect(s?.params.suffix).toBe(" KOSPI");
	});
	it("퍼센트(<1000) → number 포맷, 하락 delta → 파랑", () => {
		const s = numberCounterSpec(
			{ target: 3.5, delta: -0.4, suffix: "%" },
			SCENE,
		);
		expect(s?.params.format).toBe("number");
		expect(s?.params.color).toBe(KR_DOWN);
	});
	it("delta 없으면 색 미지정(절대치만)", () => {
		const s = numberCounterSpec({ target: 500 }, SCENE);
		expect(s?.params.color).toBeUndefined();
	});
	it("target 비유한/짧은 씬 → null", () => {
		expect(numberCounterSpec({ target: Number.NaN }, SCENE)).toBeNull();
		expect(numberCounterSpec({ target: 10 }, F - 1)).toBeNull();
	});
});

describe("deltaArrowSpec", () => {
	it("상승 → top-right + 빨강, 하락 → bottom-right + 파랑, x/y 클램프", () => {
		const up = deltaArrowSpec(2, "▲ 2%", { x: 1.5, y: -0.2 }, SCENE);
		expect(up?.type).toBe("arrow_callout");
		expect(up?.params.direction).toBe("top-right");
		expect(up?.params.color).toBe(KR_UP);
		expect(up?.params.targetX).toBe(1); // clamped
		expect(up?.params.targetY).toBe(0); // clamped
		const down = deltaArrowSpec(-2, "▼ 2%", { x: 0.5, y: 0.5 }, SCENE);
		expect(down?.params.direction).toBe("bottom-right");
		expect(down?.params.color).toBe(KR_DOWN);
	});
	it("빈 텍스트/짧은 씬 → null", () => {
		expect(deltaArrowSpec(1, "  ", { x: 0.5, y: 0.5 }, SCENE)).toBeNull();
		expect(deltaArrowSpec(1, "x", { x: 0.5, y: 0.5 }, F - 1)).toBeNull();
	});
});

describe("buildSceneGraphics", () => {
	it("주어진 데이터만 조립하고 null 은 제외", () => {
		const g = buildSceneGraphics({
			sceneFrames: SCENE,
			source: { title: "연합뉴스" },
			keyFigure: { target: 1350, delta: 5, suffix: "원" },
			arrow: { delta: 5, text: "환율 급등", x: 0.7, y: 0.4 },
		});
		expect(g.map((x) => x.type)).toEqual([
			"lower_third",
			"number_counter",
			"arrow_callout",
		]);
	});
	it("데이터 없으면 빈 배열(호출측이 키 생략 → 출력 불변)", () => {
		expect(buildSceneGraphics({ sceneFrames: SCENE })).toEqual([]);
	});
	it("일부만 있으면 그것만", () => {
		const g = buildSceneGraphics({
			sceneFrames: SCENE,
			source: { title: "한국은행" },
		});
		expect(g).toHaveLength(1);
		expect(g[0].type).toBe("lower_third");
	});
});

describe("parseEconomyPercentages (보수적·중립)", () => {
	it("% / 퍼센트 매칭, delta 없음(중립)", () => {
		const a = parseEconomyPercentages("기준금리를 3.5%로 동결했다");
		expect(a).toEqual([{ target: 3.5, suffix: "%", format: "number" }]);
		const b = parseEconomyPercentages("물가가 3.1 퍼센트 올랐다");
		expect(b[0]).toMatchObject({ target: 3.1, suffix: "%" });
		expect(a[0].delta).toBeUndefined();
	});
	it("%p / %포인트 → 접미사 %p", () => {
		expect(parseEconomyPercentages("0.25%p 인상")[0].suffix).toBe("%p");
		expect(parseEconomyPercentages("0.5%포인트 내렸다")[0].suffix).toBe("%p");
	});
	it("서로 다른 값은 각각, 같은 값은 중복 제거", () => {
		expect(parseEconomyPercentages("3.5% 에서 2.1% 로")).toHaveLength(2);
		expect(parseEconomyPercentages("3.5% ... 다시 3.5%")).toHaveLength(1);
	});
	it("퍼센트 없으면 빈 배열(카운터 미생성 → 출력 불변)", () => {
		expect(parseEconomyPercentages("코스피가 크게 올랐다")).toEqual([]);
		expect(parseEconomyPercentages("2026년 전망")).toEqual([]);
	});
	it("%가 없는 지수/연도 숫자는 무시, 진짜 퍼센트만", () => {
		expect(parseEconomyPercentages("코스피 지수 2026 마감")).toEqual([]);
		// 연도(2026년)는 % 미부착이라 제외, 3.5% 만.
		expect(parseEconomyPercentages("2026년 물가 3.5% 전망")).toEqual([
			{ target: 3.5, suffix: "%", format: "number" },
		]);
	});
	it("큰 퍼센트는 잘리지 않고 전체값(YMYL 조작 방지)", () => {
		// \\d{1,3} 로 자르면 1200%→200 으로 조작됨 — 전체값 유지.
		expect(parseEconomyPercentages("수익률 1200% 급등")).toEqual([
			{ target: 1200, suffix: "%", format: "number" },
		]);
		expect(parseEconomyPercentages("1,234% 상승")).toEqual([
			{ target: 1234, suffix: "%", format: "number" },
		]);
	});
	it("범위 표현은 통째로 배제(단일 정밀치로 오해 방지)", () => {
		expect(parseEconomyPercentages("성장률 2~3% 전망")).toEqual([]);
		expect(parseEconomyPercentages("기준선 3-5%")).toEqual([]);
		expect(parseEconomyPercentages("2에서 3% 사이")).toEqual([]);
	});
});

describe("corroboratedDelta (LLM 방향 × 내레이션 교차검증, YMYL)", () => {
	it("방향과 키워드가 일치하면 부호 반환", () => {
		expect(corroboratedDelta("코스피가 3.5% 상승했다", "up")).toBe(1);
		expect(corroboratedDelta("기준금리를 인하했다", "down")).toBe(-1);
	});
	it("'하락을 막았다' 함정: down 키워드 있는데 LLM up → 중립(오방향 방지)", () => {
		// down 단어(하락)가 있어 up 이 뒷받침 안 됨 → undefined. 틀린 ▲빨강 방지.
		expect(corroboratedDelta("하락을 막아냈다", "up")).toBeUndefined();
	});
	it("양방향 서술은 모호 → 중립", () => {
		expect(corroboratedDelta("상승했다가 다시 하락했다", "up")).toBeUndefined();
		expect(
			corroboratedDelta("상승했다가 다시 하락했다", "down"),
		).toBeUndefined();
	});
	it("flat/무방향/무키워드 → 중립", () => {
		expect(corroboratedDelta("3.5%로 유지됐다", "flat")).toBeUndefined();
		expect(corroboratedDelta("3.5%로 유지됐다", undefined)).toBeUndefined();
		expect(corroboratedDelta("환율은 3.5% 수준이다", "up")).toBeUndefined();
	});
	it("동음이의 부분매칭 방지(오른쪽/인상적/건너뛴)", () => {
		expect(corroboratedDelta("오른쪽 그래프를 보라", "up")).toBeUndefined();
		expect(corroboratedDelta("인상적인 실적이었다", "up")).toBeUndefined();
		expect(corroboratedDelta("한 칸 건너뛴 수치", "up")).toBeUndefined();
	});
});

describe("llmKeyFigureToKeyFigure", () => {
	it("변화율(%,%p)만 ▲/▼ 글리프 + delta(색)", () => {
		const up = llmKeyFigureToKeyFigure(
			{ label: "물가", value: 3.5, unit: "%" },
			1,
		);
		expect(up.prefix).toBe("물가 ▲");
		expect(up.suffix).toBe("%");
		expect(up.delta).toBe(1);
		expect(llmKeyFigureToKeyFigure({ value: 3.5, unit: "%" }, -1).prefix).toBe(
			"▼",
		);
	});
	it("수준 값(포인트/원)은 글리프 없이 색(delta)만 — 변화로 오독 방지", () => {
		const k = llmKeyFigureToKeyFigure(
			{ label: "코스피", value: 2650, unit: "포인트" },
			1,
		);
		expect(k.target).toBe(2650);
		expect(k.prefix).toBe("코스피 "); // ▲ 없음(수준 값)
		expect(k.suffix).toBe("포인트");
		expect(k.delta).toBe(1); // 색은 유지
	});
	it("delta 없으면 글리프·색 없음(중립)", () => {
		const neutral = llmKeyFigureToKeyFigure(
			{ label: "물가", value: 3.5, unit: "%" },
			undefined,
		);
		expect(neutral.prefix).toBe("물가 ");
		expect(neutral.delta).toBeUndefined();
	});
	it("중립 delta 는 numberCounterSpec 에서 색 미지정", () => {
		const k = llmKeyFigureToKeyFigure({ value: 3.5, unit: "%" }, undefined);
		expect(numberCounterSpec(k, 150)?.params.color).toBeUndefined();
	});
});

describe("parseLlmKeyFigure (비파괴 타입가드)", () => {
	it("정상 객체를 파싱", () => {
		expect(
			parseLlmKeyFigure({
				label: "코스피",
				value: 2650,
				unit: "포인트",
				direction: "up",
			}),
		).toEqual({
			label: "코스피",
			value: 2650,
			unit: "포인트",
			direction: "up",
		});
	});
	it("문자열 숫자도 허용, 잘못된 direction 은 생략", () => {
		expect(
			parseLlmKeyFigure({ value: "3.5", unit: "%", direction: "왼쪽" }),
		).toEqual({
			value: 3.5,
			unit: "%",
		});
	});
	it("value 없거나 비유한/객체 아님 → undefined(씬 무효화 안 함)", () => {
		expect(parseLlmKeyFigure({ label: "x" })).toBeUndefined();
		expect(parseLlmKeyFigure({ value: "abc" })).toBeUndefined();
		expect(parseLlmKeyFigure(null)).toBeUndefined();
		expect(parseLlmKeyFigure("3.5%")).toBeUndefined();
	});
});
