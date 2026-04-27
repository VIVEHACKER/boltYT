import { describe, expect, it } from "vitest";
import {
	applyBgmGain,
	computeBgmNormalizeGain,
	measureRmsDb,
	normalizeBgmBuffer,
} from "./bgm-loudness";

function makeBuffer(samples: number[], channels = 1, sampleRate = 44100) {
	const buf = new AudioBuffer({
		numberOfChannels: channels,
		length: samples.length,
		sampleRate,
	});
	for (let ch = 0; ch < channels; ch++) {
		buf.getChannelData(ch).set(samples);
	}
	return buf;
}

describe("measureRmsDb", () => {
	it("무음 → -120", () => {
		expect(measureRmsDb(makeBuffer([0, 0, 0, 0]))).toBeLessThanOrEqual(-119);
	});

	it("0.5 진폭 사인파 ~ -9dB", () => {
		const samples: number[] = [];
		for (let i = 0; i < 1000; i++) samples.push(Math.sin(i * 0.1) * 0.5);
		const db = measureRmsDb(makeBuffer(samples));
		expect(db).toBeGreaterThan(-12);
		expect(db).toBeLessThan(-6);
	});
});

describe("computeBgmNormalizeGain", () => {
	it("이미 target 에 있으면 ~1", () => {
		// -23dB ≈ amplitude 0.0708
		const samples = new Array(1000)
			.fill(0)
			.map((_, i) => Math.sin(i * 0.1) * 0.1);
		const gain = computeBgmNormalizeGain(makeBuffer(samples), -23);
		expect(gain).toBeGreaterThan(0.7);
		expect(gain).toBeLessThan(1.6);
	});

	it("매우 작은 BGM → +18dB 클램프", () => {
		const samples = new Array(1000)
			.fill(0)
			.map((_, i) => Math.sin(i * 0.1) * 0.0001);
		const gain = computeBgmNormalizeGain(makeBuffer(samples), -23);
		expect(gain).toBeLessThanOrEqual(10 ** (18 / 20) + 0.01);
	});
});

describe("applyBgmGain", () => {
	it("gain=1 → 원본 반환 (no copy)", () => {
		const buf = makeBuffer([0.5, -0.5, 0.3]);
		expect(applyBgmGain(buf, 1)).toBe(buf);
	});

	it("gain=2 → 샘플 2배", () => {
		const buf = makeBuffer([0.1, -0.1, 0.2]);
		const out = applyBgmGain(buf, 2);
		expect(out.getChannelData(0)[0]).toBeCloseTo(0.2, 5);
		expect(out.getChannelData(0)[1]).toBeCloseTo(-0.2, 5);
	});
});

describe("normalizeBgmBuffer", () => {
	it("meta 반환 + buffer 변경", () => {
		const samples = new Array(1000)
			.fill(0)
			.map((_, i) => Math.sin(i * 0.1) * 0.05);
		const r = normalizeBgmBuffer(makeBuffer(samples), -23);
		expect(r.meta.targetDb).toBe(-23);
		expect(r.meta.gainLinear).toBeGreaterThan(1);
	});
});
