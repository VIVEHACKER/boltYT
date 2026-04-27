/**
 * AudioEffect → WebAudio 노드 빌더.
 *
 * 순수 매퍼 함수(biquadsForEq3/delayParams/reverbMix) 는 테스트 가능.
 * attachEffect/buildEffectChain 은 WebAudio API 호출 (브라우저/OfflineAudioContext 전용,
 * 테스트 환경에서는 ctx 미제공 → mock 주입).
 */

import {
	type AudioEffect,
	type DelayEffect,
	dbToGain,
	type Eq3Effect,
	orderChain,
	type ReverbEffect,
	synthReverbIR,
} from "./audio-effects";

export interface BiquadSpec {
	type: "lowshelf" | "peaking" | "highshelf";
	freq: number;
	gain: number;
	q?: number;
}

/** EQ3 → 3개 BiquadFilter 스펙 (low shelf 320Hz / peaking midFreq / high shelf 3200Hz). */
export function biquadsForEq3(eq: Eq3Effect): BiquadSpec[] {
	return [
		{ type: "lowshelf", freq: 320, gain: eq.low },
		{
			type: "peaking",
			freq: eq.midFreq ?? 1000,
			gain: eq.mid,
			q: 0.8,
		},
		{ type: "highshelf", freq: 3200, gain: eq.high },
	];
}

export interface DelayParams {
	time: number;
	feedback: number;
	wet: number;
	dry: number;
}

export function delayParams(effect: DelayEffect): DelayParams {
	return {
		time: effect.time,
		feedback: effect.feedback,
		wet: effect.wet,
		dry: Math.max(0, 1 - effect.wet),
	};
}

export interface ReverbMix {
	wet: number;
	dry: number;
	decay: number;
	preset: ReverbEffect["preset"];
}

export function reverbMix(effect: ReverbEffect): ReverbMix {
	return {
		wet: effect.wet,
		dry: Math.max(0, 1 - effect.wet),
		decay: effect.decay,
		preset: effect.preset,
	};
}

// ─── WebAudio wiring (브라우저 전용) ───

/**
 * 입력 AudioNode 에 이펙트 하나를 붙이고 출력 AudioNode 를 반환.
 * 체인 호출자는 반환값을 다음 attachEffect 의 source 로 사용.
 */
export function attachEffect(
	ctx: BaseAudioContext,
	source: AudioNode,
	effect: AudioEffect,
): AudioNode {
	switch (effect.kind) {
		case "gain": {
			const g = ctx.createGain();
			g.gain.value = dbToGain(effect.db);
			source.connect(g);
			return g;
		}
		case "eq3": {
			let head = source;
			for (const spec of biquadsForEq3(effect)) {
				const biquad = ctx.createBiquadFilter();
				biquad.type = spec.type;
				biquad.frequency.value = spec.freq;
				biquad.gain.value = spec.gain;
				if (spec.q !== undefined) biquad.Q.value = spec.q;
				head.connect(biquad);
				head = biquad;
			}
			return head;
		}
		case "delay": {
			const p = delayParams(effect);
			const delay = ctx.createDelay(Math.max(0.001, p.time + 1));
			delay.delayTime.value = p.time;
			const fb = ctx.createGain();
			fb.gain.value = p.feedback;
			const wetG = ctx.createGain();
			wetG.gain.value = p.wet;
			const dryG = ctx.createGain();
			dryG.gain.value = p.dry;
			const sum = ctx.createGain();
			source.connect(dryG);
			dryG.connect(sum);
			source.connect(delay);
			delay.connect(fb);
			fb.connect(delay);
			delay.connect(wetG);
			wetG.connect(sum);
			return sum;
		}
		case "reverb": {
			const mix = reverbMix(effect);
			const conv = ctx.createConvolver();
			const ir = synthReverbIR(ctx.sampleRate, mix.decay, mix.preset);
			const irBuf = ctx.createBuffer(2, ir.length, ctx.sampleRate);
			// ArrayBuffer 기반 Float32Array 로 복사 — copyToChannel 시그니처 요구
			const irCopy = new Float32Array(ir.length);
			irCopy.set(ir);
			irBuf.copyToChannel(irCopy, 0);
			irBuf.copyToChannel(irCopy, 1);
			conv.buffer = irBuf;
			const wetG = ctx.createGain();
			wetG.gain.value = mix.wet;
			const dryG = ctx.createGain();
			dryG.gain.value = mix.dry;
			const sum = ctx.createGain();
			source.connect(dryG);
			dryG.connect(sum);
			source.connect(conv);
			conv.connect(wetG);
			wetG.connect(sum);
			return sum;
		}
	}
}

/** 체인 적용 — orderChain 순으로 직렬 연결, 최종 head 반환. 호출자가 destination 연결. */
export function buildEffectChain(
	ctx: BaseAudioContext,
	source: AudioNode,
	effects: AudioEffect[],
): AudioNode {
	let head = source;
	for (const fx of orderChain(effects)) {
		head = attachEffect(ctx, head, fx);
	}
	return head;
}
