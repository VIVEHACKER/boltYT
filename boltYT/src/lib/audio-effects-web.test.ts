import { describe, expect, it } from "vitest";
import { defaultEffect } from "./audio-effects";
import {
	attachEffect,
	biquadsForEq3,
	buildEffectChain,
	delayParams,
	reverbMix,
} from "./audio-effects-web";

// ─── WebAudio mock ─────────────────────────────────────────────────────────────
const makeParam = (v = 0) => ({ value: v });
function makeAudioNode(extra: Record<string, unknown> = {}): AudioNode {
	return { connect: () => undefined, ...extra } as unknown as AudioNode;
}
function makeCtx(sampleRate = 44100): BaseAudioContext {
	return {
		sampleRate,
		createGain: () => ({ ...makeAudioNode(), gain: makeParam() }),
		createBiquadFilter: () => ({
			...makeAudioNode(),
			type: "peaking",
			frequency: makeParam(),
			gain: makeParam(),
			Q: makeParam(),
		}),
		createDelay: () => ({ ...makeAudioNode(), delayTime: makeParam() }),
		createConvolver: () => ({ ...makeAudioNode(), buffer: null }),
		createBuffer: (_ch: number, len: number, sr: number) => ({
			length: len,
			sampleRate: sr,
			numberOfChannels: _ch,
			copyToChannel: () => {},
		}),
	} as unknown as BaseAudioContext;
}

describe("audio-effects-web 순수 매퍼", () => {
	it("biquadsForEq3 — 3개 필터, lowshelf/peaking/highshelf", () => {
		const specs = biquadsForEq3({
			kind: "eq3",
			low: 3,
			mid: -2,
			high: 1,
			midFreq: 1800,
		});
		expect(specs).toHaveLength(3);
		expect(specs[0]).toEqual({ type: "lowshelf", freq: 320, gain: 3 });
		expect(specs[1]).toEqual({
			type: "peaking",
			freq: 1800,
			gain: -2,
			q: 0.8,
		});
		expect(specs[2]).toEqual({ type: "highshelf", freq: 3200, gain: 1 });
	});

	it("biquadsForEq3 — midFreq 없으면 1000Hz 기본", () => {
		const specs = biquadsForEq3({
			kind: "eq3",
			low: 0,
			mid: 0,
			high: 0,
		});
		expect(specs[1].freq).toBe(1000);
	});

	it("delayParams — dry = 1 - wet", () => {
		const p = delayParams({
			kind: "delay",
			time: 0.3,
			feedback: 0.4,
			wet: 0.25,
		});
		expect(p).toEqual({ time: 0.3, feedback: 0.4, wet: 0.25, dry: 0.75 });
	});

	it("delayParams — wet > 1 클램핑 없이 dry 는 0 하한", () => {
		const p = delayParams({
			kind: "delay",
			time: 0,
			feedback: 0,
			wet: 1.5,
		});
		expect(p.dry).toBe(0);
	});

	it("reverbMix — wet/dry/decay/preset 전달", () => {
		const m = reverbMix({
			kind: "reverb",
			preset: "hall",
			wet: 0.4,
			decay: 2.1,
		});
		expect(m).toEqual({ wet: 0.4, dry: 0.6, decay: 2.1, preset: "hall" });
	});

	it("defaultEffect('reverb') 과 reverbMix 조합 일관성", () => {
		const fx = defaultEffect("reverb");
		if (fx.kind !== "reverb") throw new Error("kind mismatch");
		const m = reverbMix(fx);
		expect(m.preset).toBe("room");
		expect(m.dry + m.wet).toBeCloseTo(1);
	});
});

// ─── attachEffect ─────────────────────────────────────────────────────────────
describe("attachEffect", () => {
	it("gain → GainNode 반환", () => {
		const ctx = makeCtx();
		const out = attachEffect(ctx, makeAudioNode(), { kind: "gain", db: -6 });
		expect(out).toBeDefined();
	});

	it("eq3 → 마지막 BiquadFilter 반환", () => {
		const ctx = makeCtx();
		const out = attachEffect(ctx, makeAudioNode(), {
			kind: "eq3",
			low: 2,
			mid: 0,
			high: -2,
		});
		expect(out).toBeDefined();
	});

	it("delay → sum 노드 반환", () => {
		const ctx = makeCtx();
		const out = attachEffect(ctx, makeAudioNode(), {
			kind: "delay",
			time: 0.25,
			feedback: 0.3,
			wet: 0.4,
		});
		expect(out).toBeDefined();
	});

	it("reverb → sum 노드 반환", () => {
		const ctx = makeCtx();
		const out = attachEffect(ctx, makeAudioNode(), {
			kind: "reverb",
			wet: 0.3,
			decay: 1.5,
			preset: "room",
		});
		expect(out).toBeDefined();
	});
});

// ─── buildEffectChain ─────────────────────────────────────────────────────────
describe("buildEffectChain", () => {
	it("effects 없으면 source 그대로 반환", () => {
		const ctx = makeCtx();
		const source = makeAudioNode();
		expect(buildEffectChain(ctx, source, [])).toBe(source);
	});

	it("여러 effect 직렬 연결 → source와 다른 노드 반환", () => {
		const ctx = makeCtx();
		const source = makeAudioNode();
		const out = buildEffectChain(ctx, source, [
			{ kind: "gain", db: -3 },
			{ kind: "eq3", low: 0, mid: 0, high: 0 },
		]);
		expect(out).toBeDefined();
		expect(out).not.toBe(source);
	});
});
