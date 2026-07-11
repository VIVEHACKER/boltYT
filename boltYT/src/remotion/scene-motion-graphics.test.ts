import { describe, expect, it } from "vitest";
import {
	buildSceneGraphics,
	deltaArrowSpec,
	KR_DOWN,
	KR_UP,
	krDeltaColor,
	numberCounterSpec,
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
