/**
 * 테스트 전용 AudioBuffer 유틸리티.
 *
 * web-audio-mock.ts 의 MockAudioBuffer(getChannelData → Float32Array) 환경에서 동작.
 * 브라우저 AudioBuffer 인터페이스를 그대로 받아 작동하므로 타입 호환성 유지.
 */

import { MockAudioBuffer } from "../test-setup/web-audio-mock";

/**
 * 테스트용 순수 AudioBuffer 생성.
 * fillFn 기본값: 440 Hz 사인파.
 */
export function makeTestBuffer(
	sampleRate: number,
	durationSeconds: number,
	fillFn?: (i: number, sampleRate: number) => number,
): AudioBuffer {
	const length = Math.floor(sampleRate * durationSeconds);
	const buf = new MockAudioBuffer({ numberOfChannels: 1, length, sampleRate });
	const ch = buf.getChannelData(0);
	const fn = fillFn ?? ((i, sr) => Math.sin((2 * Math.PI * 440 * i) / sr));
	for (let i = 0; i < length; i++) {
		ch[i] = fn(i, sampleRate);
	}
	return buf as unknown as AudioBuffer;
}

/**
 * AudioBuffer 채널의 RMS (Root Mean Square) 계산.
 * RMS = sqrt(mean(x^2))
 */
export function computeRMS(buffer: AudioBuffer, channel = 0): number {
	const data = buffer.getChannelData(channel);
	if (data.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < data.length; i++) {
		sum += data[i] * data[i];
	}
	return Math.sqrt(sum / data.length);
}

/**
 * AudioBuffer 채널의 peak (최대 절댓값) 계산.
 */
export function computePeak(buffer: AudioBuffer, channel = 0): number {
	const data = buffer.getChannelData(channel);
	let peak = 0;
	for (let i = 0; i < data.length; i++) {
		const abs = Math.abs(data[i]);
		if (abs > peak) peak = abs;
	}
	return peak;
}

/**
 * AudioBuffer 채널에서 특정 주파수의 에너지를 계산 (Goertzel 알고리즘).
 * DFT 전체 계산 없이 단일 주파수 에너지를 O(N)으로 추출.
 */
export function computeFreqEnergy(
	buffer: AudioBuffer,
	freqHz: number,
	channel = 0,
): number {
	const data = buffer.getChannelData(channel);
	const N = data.length;
	if (N === 0) return 0;
	const k = (freqHz / buffer.sampleRate) * N;
	const omega = (2 * Math.PI * k) / N;
	const coeff = 2 * Math.cos(omega);
	let s0 = 0;
	let s1 = 0;
	let s2 = 0;
	for (let n = 0; n < N; n++) {
		s0 = (data[n] ?? 0) + coeff * s1 - s2;
		s2 = s1;
		s1 = s0;
	}
	// 에너지 = s1^2 + s2^2 - coeff*s1*s2
	const energy = s1 * s1 + s2 * s2 - coeff * s1 * s2;
	return Math.sqrt(Math.max(0, energy)) / N;
}

/**
 * 입력 AudioBuffer의 Float32Array를 직접 스케일링해 gain(dB)을 적용한 새 AudioBuffer 반환.
 * OfflineAudioContext 없이 수치 검증 가능한 순수 함수.
 */
export function applyGainToBuffer(
	input: AudioBuffer,
	gainDb: number,
): AudioBuffer {
	const linear = 10 ** (gainDb / 20);
	const out = new MockAudioBuffer({
		numberOfChannels: input.numberOfChannels,
		length: input.length,
		sampleRate: input.sampleRate,
	});
	for (let c = 0; c < input.numberOfChannels; c++) {
		const src = input.getChannelData(c);
		const dst = out.getChannelData(c);
		for (let i = 0; i < src.length; i++) {
			dst[i] = src[i] * linear;
		}
	}
	return out as unknown as AudioBuffer;
}
