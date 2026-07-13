import { describe, expect, it } from "vitest";
import {
	type AssignCut,
	assignCameraMoves,
	CAMERA_MOVES,
	type CameraMoveCategory,
	getCameraMove,
	i2vPromptFor,
	remotionMotionFor,
} from "./camera-movements";
import type { SceneShotMotion } from "./scene-shot-types";

/** scene-shot-types.ts 의 SceneShotMotion union 전수(락킹 — union 변경 시 여기도 갱신). */
const VALID_MOTIONS: SceneShotMotion[] = [
	"static",
	"slow_zoom_in",
	"slow_zoom_out",
	"pan_left",
	"pan_right",
	"drift",
	"push_in",
];

/** 원천(docs/camera-movements-source.md) 카테고리별 개수 — 누락 감지용 락. */
const SOURCE_COUNTS: Record<CameraMoveCategory, number> = {
	"pan-tilt": 7,
	zoom: 6,
	dolly: 9,
	physical: 11,
	human: 2,
	drone: 5,
	special: 6,
};

describe("CAMERA_MOVES 레지스트리", () => {
	it("원천 데이터 전수 등록(카테고리별 개수 락)", () => {
		const total = Object.values(SOURCE_COUNTS).reduce((a, b) => a + b, 0);
		expect(CAMERA_MOVES).toHaveLength(total); // 46
		for (const [cat, n] of Object.entries(SOURCE_COUNTS))
			expect(CAMERA_MOVES.filter((m) => m.category === cat)).toHaveLength(n);
	});

	it("id 유일성", () => {
		const ids = CAMERA_MOVES.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("모든 remotionMotion 이 유효한 SceneShotMotion 값", () => {
		for (const m of CAMERA_MOVES)
			expect(VALID_MOTIONS).toContain(m.remotionMotion);
	});

	it("i2vPrompt 는 Movement/Speed/Framing/End 구조 전문", () => {
		for (const m of CAMERA_MOVES) {
			expect(m.i2vPrompt).toContain("Movement:");
			expect(m.i2vPrompt).toContain("Speed:");
			expect(m.i2vPrompt).toContain("Framing:");
			expect(m.i2vPrompt).toContain("End:");
		}
	});
});

describe("헬퍼 (getCameraMove / i2vPromptFor / remotionMotionFor)", () => {
	it("등록된 id 조회", () => {
		expect(getCameraMove("crash-zoom-in")?.category).toBe("zoom");
		expect(i2vPromptFor("pan-right")).toContain("pan right");
		expect(remotionMotionFor("truck-left")).toBe("pan_left");
	});

	it("미지 id 폴백 — getCameraMove=undefined, prompt=static 전문, motion=static", () => {
		expect(getCameraMove("no-such-move")).toBeUndefined();
		expect(i2vPromptFor("no-such-move")).toBe(i2vPromptFor("static"));
		expect(i2vPromptFor("no-such-move")).toContain("locked-off static shot");
		expect(remotionMotionFor("no-such-move")).toBe("static");
	});
});

describe("assignCameraMoves — 결정적 배정", () => {
	const cuts: AssignCut[] = [
		{ purpose: "a-roll", expectedSec: 3 }, // hook
		{ purpose: "a-roll", expectedSec: 10 }, // 긴 a-roll → slow 계열
		{ purpose: "b-roll", expectedSec: 4 },
		{ purpose: "a-roll", expectedSec: 5 },
		{ purpose: "b-roll", expectedSec: 6 },
		{ purpose: "a-roll", expectedSec: 12 }, // 긴 a-roll
		{ purpose: "b-roll", expectedSec: 3 },
		{ purpose: "a-roll", expectedSec: 4 },
		{ purpose: "b-roll", expectedSec: 5 },
		{ purpose: "a-roll", expectedSec: 9 }, // 긴 a-roll
		{ purpose: "b-roll", expectedSec: 4 },
		{ purpose: "a-roll", expectedSec: 3 },
	];

	it("컷당 정확히 1개 + 전부 등록된 id", () => {
		const moves = assignCameraMoves(cuts, { seed: "s1", hookIndex: 0 });
		expect(moves).toHaveLength(cuts.length);
		for (const id of moves) expect(getCameraMove(id)).toBeDefined();
	});

	it("동일 seed → 동일 배정(결정성), 다른 seed → (통상) 다른 배정", () => {
		const a = assignCameraMoves(cuts, { seed: "seed-A", hookIndex: 0 });
		const b = assignCameraMoves(cuts, { seed: "seed-A", hookIndex: 0 });
		expect(a).toEqual(b);
		const c = assignCameraMoves(cuts, { seed: "seed-B", hookIndex: 0 });
		expect(c).not.toEqual(a); // mulberry32 특성상 사실상 항상 다름
	});

	it("연속 컷 동일 무빙 금지 (여러 seed 전수)", () => {
		for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
			const moves = assignCameraMoves(cuts, { seed, hookIndex: 0 });
			for (let i = 1; i < moves.length; i++)
				expect(moves[i]).not.toBe(moves[i - 1]);
		}
	});

	it("hookIndex 컷은 punchy 계열", () => {
		const punchy = [
			"crash-zoom-in",
			"fast-zoom-in",
			"whip-pan-right",
			"whip-pan-left",
		];
		for (const seed of ["s1", "s2", "s3"]) {
			const moves = assignCameraMoves(cuts, { seed, hookIndex: 0 });
			expect(punchy).toContain(moves[0]);
		}
	});

	it("8초+ a-roll 은 slow zoom/pan 계열", () => {
		const slow = ["slow-zoom-in", "slow-zoom-out", "pan-right", "pan-left"];
		for (const seed of ["s1", "s2", "s3"]) {
			const moves = assignCameraMoves(cuts, { seed, hookIndex: 0 });
			for (const idx of [1, 5, 9]) expect(slow).toContain(moves[idx]);
		}
	});

	it("drone/special 은 전체의 ~10% 이하", () => {
		const many: AssignCut[] = Array.from({ length: 50 }, (_, i) => ({
			purpose: i % 2 === 0 ? "a-roll" : "b-roll",
			expectedSec: 4,
		}));
		const accent = new Set(
			CAMERA_MOVES.filter(
				(m) => m.category === "drone" || m.category === "special",
			).map((m) => m.id),
		);
		for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
			const moves = assignCameraMoves(many, { seed });
			const n = moves.filter((id) => accent.has(id)).length;
			expect(n).toBeLessThanOrEqual(Math.floor(many.length * 0.1));
		}
	});

	it("b-roll 은 pan/truck/tilt/slider(+양념) 범위에서 다양화", () => {
		const brollPool = new Set([
			"pan-right",
			"pan-left",
			"truck-right",
			"truck-left",
			"tilt-up",
			"tilt-down",
			"slider-right",
			"slider-left",
		]);
		const accent = new Set(
			CAMERA_MOVES.filter(
				(m) => m.category === "drone" || m.category === "special",
			).map((m) => m.id),
		);
		const moves = assignCameraMoves(cuts, { seed: "s1", hookIndex: 0 });
		for (const idx of [2, 4, 6, 8, 10]) {
			const id = moves[idx];
			expect(brollPool.has(id) || accent.has(id)).toBe(true);
		}
	});

	it("빈 컷 목록 → 빈 배열", () => {
		expect(assignCameraMoves([], { seed: "s1" })).toEqual([]);
	});
});
