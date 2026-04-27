/**
 * BGM 라우드니스 정규화 — RMS 기반 -23 LUFS 근사 (Web Audio).
 * 트랙별 음량 편차로 듀킹이 일관되지 않는 문제를 해결.
 */

/**
 * AudioBuffer RMS dBFS 측정. -∞ 면 -120 반환.
 */
export function measureRmsDb(buffer: AudioBuffer): number {
	let sum = 0;
	let count = 0;
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < data.length; i++) {
			sum += data[i] * data[i];
			count++;
		}
	}
	if (count === 0) return -120;
	const rms = Math.sqrt(sum / count);
	if (rms < 1e-7) return -120;
	return 20 * Math.log10(rms);
}

/**
 * BGM 정규화 gain 계산 — target dB 까지 끌어올림. +18dB 상한.
 * BGM 은 voice 보다 낮은 -27 ~ -23 LUFS 가 mixing best practice.
 */
export function computeBgmNormalizeGain(
	buffer: AudioBuffer,
	targetDb = -23,
): number {
	const currentDb = measureRmsDb(buffer);
	if (currentDb <= -119) return 1;
	const gainDb = targetDb - currentDb;
	const clampedDb = Math.max(-24, Math.min(18, gainDb));
	return 10 ** (clampedDb / 20);
}

/**
 * 단일 채널/스테레오 AudioBuffer 에 gain 을 즉시 곱해 반환 (offline 불필요).
 */
export function applyBgmGain(input: AudioBuffer, gain: number): AudioBuffer {
	if (Math.abs(gain - 1) < 1e-4) return input;
	const out = new AudioBuffer({
		numberOfChannels: input.numberOfChannels,
		length: input.length,
		sampleRate: input.sampleRate,
	});
	for (let ch = 0; ch < input.numberOfChannels; ch++) {
		const src = input.getChannelData(ch);
		const dst = out.getChannelData(ch);
		for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
	}
	return out;
}

/** 정규화 메타 — 캐시/UI 표시용 */
export interface BgmNormalizeMeta {
	originalDb: number;
	targetDb: number;
	gainDb: number;
	gainLinear: number;
}

export function normalizeBgmBuffer(
	input: AudioBuffer,
	targetDb = -23,
): { buffer: AudioBuffer; meta: BgmNormalizeMeta } {
	const originalDb = measureRmsDb(input);
	const gainLinear = computeBgmNormalizeGain(input, targetDb);
	return {
		buffer: applyBgmGain(input, gainLinear),
		meta: {
			originalDb,
			targetDb,
			gainDb: 20 * Math.log10(gainLinear),
			gainLinear,
		},
	};
}
