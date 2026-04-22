import { describe, expect, it } from "vitest";
import {
	clampEffect,
	dbToGain,
	defaultEffect,
	FX_ORDER,
	orderChain,
	REVERB_DECAY_DEFAULTS,
	synthReverbIR,
} from "./audio-effects";

describe("audio-effects", () => {
	it("defaultEffect 각 타입 기본값", () => {
		expect(defaultEffect("eq3")).toMatchObject({
			kind: "eq3",
			low: 0,
			mid: 0,
			high: 0,
		});
		expect(defaultEffect("delay")).toMatchObject({ kind: "delay", time: 0.25 });
		expect(defaultEffect("reverb")).toMatchObject({
			kind: "reverb",
			preset: "room",
			decay: REVERB_DECAY_DEFAULTS.room,
		});
		expect(defaultEffect("gain")).toMatchObject({ kind: "gain", db: 0 });
	});

	it("clampEffect — EQ 초과 값 클램핑", () => {
		expect(
			clampEffect({ kind: "eq3", low: 50, mid: -30, high: 6, midFreq: 10000 }),
		).toEqual({ kind: "eq3", low: 12, mid: -12, high: 6, midFreq: 5000 });
	});

	it("clampEffect — Delay 범위", () => {
		expect(
			clampEffect({ kind: "delay", time: 10, feedback: 1.5, wet: -0.1 }),
		).toEqual({ kind: "delay", time: 2, feedback: 0.9, wet: 0 });
	});

	it("clampEffect — Reverb decay 하한", () => {
		expect(
			clampEffect({ kind: "reverb", preset: "hall", wet: 2, decay: 0 }),
		).toEqual({ kind: "reverb", preset: "hall", wet: 1, decay: 0.2 });
	});

	it("clampEffect — Gain 한계", () => {
		expect(clampEffect({ kind: "gain", db: 100 })).toEqual({
			kind: "gain",
			db: 12,
		});
		expect(clampEffect({ kind: "gain", db: -100 })).toEqual({
			kind: "gain",
			db: -24,
		});
	});

	it("orderChain — FX_ORDER 대로 재정렬 안정", () => {
		const chain = [
			defaultEffect("reverb"),
			defaultEffect("eq3"),
			defaultEffect("delay"),
			defaultEffect("gain"),
		];
		const ordered = orderChain(chain);
		expect(ordered.map((e) => e.kind)).toEqual([
			"eq3",
			"gain",
			"delay",
			"reverb",
		]);
		expect(FX_ORDER.eq3).toBeLessThan(FX_ORDER.reverb);
	});

	it("dbToGain — 0dB=1, -6dB≈0.5, +6dB≈2", () => {
		expect(dbToGain(0)).toBeCloseTo(1);
		expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
		expect(dbToGain(6)).toBeCloseTo(1.995, 2);
	});

	it("synthReverbIR — 길이 = sampleRate * decay", () => {
		const ir = synthReverbIR(48000, 1.5, "room");
		expect(ir.length).toBe(Math.floor(48000 * 1.5));
		// 감쇠 envelope: 끝 근처 값이 앞부분보다 훨씬 작음
		const front = Math.abs(ir[100]);
		const back = Math.abs(ir[ir.length - 100]);
		expect(front).toBeGreaterThan(back);
	});

	it("synthReverbIR — hall 은 스무딩으로 인접 샘플 평균치", () => {
		const room = synthReverbIR(8000, 0.5, "room");
		const hall = synthReverbIR(8000, 0.5, "hall");
		expect(hall.length).toBe(room.length);
		// hall 은 고주파 성분이 적음 → 절대 diff 평균 낮아야
		let roomDiff = 0;
		let hallDiff = 0;
		for (let i = 1; i < 500; i++) {
			roomDiff += Math.abs(room[i] - room[i - 1]);
			hallDiff += Math.abs(hall[i] - hall[i - 1]);
		}
		expect(hallDiff).toBeLessThan(roomDiff);
	});
});
