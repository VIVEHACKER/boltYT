/**
 * Voice DSP — TTS 출력을 방송급 품질로 가공.
 *
 * Web Audio OfflineAudioContext 체인:
 *   HP Filter (80Hz)         — 저역 rumble 제거
 *   Peaking EQ (+3dB @ 2.5k) — presence (또렷함)
 *   Notch (-4dB @ 6.5k)      — de-esser (치찰음 감소)
 *   Compressor               — 다이나믹 레인지 압축
 *   Makeup Gain              — Loudness -14 LUFS 근사 (YouTube 표준)
 *
 * 모든 처리는 브라우저 오프라인. 런타임 비용 0원.
 */

/** DSP 활성화 여부 (사용자 설정) */
export function isVoiceDspEnabled(): boolean {
	if (typeof localStorage === "undefined") return true;
	return localStorage.getItem("voice_dsp_enabled") !== "false";
}

export function setVoiceDspEnabled(enabled: boolean): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem("voice_dsp_enabled", String(enabled));
}

let _sharedCtx: AudioContext | null = null;

/**
 * AudioContext 싱글턴 — 브라우저 동시 생성 한도(Chrome 6개) 방지
 * @AX:ANCHOR audio-render.ts 가 decode 용도로 재사용 (export 명시)
 */
export function getAudioContext(): AudioContext {
	if (!_sharedCtx || _sharedCtx.state === "closed") {
		const AudioCtx =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext: typeof AudioContext })
				.webkitAudioContext;
		_sharedCtx = new AudioCtx();
	}
	return _sharedCtx;
}

/**
 * RMS → dB 변환 후 target dB까지 gain 스케일 계산.
 * Target: -18 dBFS RMS ≈ -14 LUFS (speech)
 */
function computeNormalizeGain(buffer: AudioBuffer, targetDb = -18): number {
	let sumSquares = 0;
	let sampleCount = 0;
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < data.length; i++) {
			sumSquares += data[i] * data[i];
			sampleCount++;
		}
	}
	if (sampleCount === 0) return 1;
	const rms = Math.sqrt(sumSquares / sampleCount);
	if (rms < 1e-6) return 1;
	const currentDb = 20 * Math.log10(rms);
	const gainDb = targetDb - currentDb;
	// 안전 상한 — +18dB 초과 금지 (노이즈 증폭 방지)
	const clampedDb = Math.min(18, Math.max(-20, gainDb));
	return 10 ** (clampedDb / 20);
}

import type { AudioEffect } from "./audio-effects";
import { buildEffectChain } from "./audio-effects-web";

/** AudioBuffer → 추가 이펙트 체인 적용 → AudioBuffer (재렌더). effects 비어있으면 원본 반환. */
async function applyEffectsToBuffer(
	input: AudioBuffer,
	effects: AudioEffect[],
): Promise<AudioBuffer> {
	if (effects.length === 0) return input;
	const offline = new OfflineAudioContext(
		input.numberOfChannels,
		input.length,
		input.sampleRate,
	);
	const source = offline.createBufferSource();
	source.buffer = input;
	const head = buildEffectChain(offline, source, effects);
	head.connect(offline.destination);
	source.start(0);
	return offline.startRendering();
}

/**
 * 입력 오디오 버퍼 → DSP 체인 → PCM Float32 결과 AudioBuffer 반환.
 */
async function applyDspChain(input: AudioBuffer): Promise<AudioBuffer> {
	const makeupGain = computeNormalizeGain(input);

	const offline = new OfflineAudioContext(
		input.numberOfChannels,
		input.length,
		input.sampleRate,
	);

	// Source
	const source = offline.createBufferSource();
	source.buffer = input;

	// 1. HP filter (80Hz) — 저역 제거
	const hp = offline.createBiquadFilter();
	hp.type = "highpass";
	hp.frequency.value = 80;
	hp.Q.value = 0.7;

	// 2. Presence EQ (+3dB @ 2.5kHz)
	const presence = offline.createBiquadFilter();
	presence.type = "peaking";
	presence.frequency.value = 2500;
	presence.Q.value = 1.4;
	presence.gain.value = 3;

	// 3. De-esser (-4dB @ 6.5kHz) — notch
	const deesser = offline.createBiquadFilter();
	deesser.type = "peaking";
	deesser.frequency.value = 6500;
	deesser.Q.value = 3;
	deesser.gain.value = -4;

	// 4. Compressor
	const comp = offline.createDynamicsCompressor();
	comp.threshold.value = -18;
	comp.ratio.value = 3;
	comp.attack.value = 0.003;
	comp.release.value = 0.05;
	comp.knee.value = 6;

	// 5. Makeup Gain (Loudness normalize)
	const gain = offline.createGain();
	gain.gain.value = makeupGain;

	// Connect
	source.connect(hp);
	hp.connect(presence);
	presence.connect(deesser);
	deesser.connect(comp);
	comp.connect(gain);
	gain.connect(offline.destination);

	source.start(0);
	return offline.startRendering();
}

/**
 * AudioBuffer → WAV ArrayBuffer 인코딩 (16-bit PCM).
 * MP3 인코더 없이도 브라우저 호환 유지.
 * @AX:ANCHOR audio-render.ts 에서도 재사용 (export 명시)
 */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const bitsPerSample = 16;
	const bytesPerSample = bitsPerSample / 8;
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const numFrames = buffer.length;
	const dataSize = numFrames * blockAlign;
	const bufferSize = 44 + dataSize;

	const ab = new ArrayBuffer(bufferSize);
	const view = new DataView(ab);

	const writeStr = (off: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
	};

	// RIFF header
	writeStr(0, "RIFF");
	view.setUint32(4, bufferSize - 8, true);
	writeStr(8, "WAVE");
	// fmt chunk
	writeStr(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);
	// data chunk
	writeStr(36, "data");
	view.setUint32(40, dataSize, true);

	// PCM samples
	let offset = 44;
	const channels: Float32Array[] = [];
	for (let ch = 0; ch < numChannels; ch++)
		channels.push(buffer.getChannelData(ch));
	for (let i = 0; i < numFrames; i++) {
		for (let ch = 0; ch < numChannels; ch++) {
			const sample = Math.max(-1, Math.min(1, channels[ch][i]));
			view.setInt16(
				offset,
				sample < 0 ? sample * 0x8000 : sample * 0x7fff,
				true,
			);
			offset += 2;
		}
	}

	return ab;
}

/**
 * 원본 TTS MP3/WAV 버퍼 → DSP 적용 → WAV 버퍼 반환.
 * 실패 시 원본 그대로 반환.
 */
export async function processVoice(
	rawBuffer: ArrayBuffer,
	effects: AudioEffect[] = [],
): Promise<{
	buffer: ArrayBuffer;
	mimeType: string;
	processed: boolean;
}> {
	const dspEnabled = isVoiceDspEnabled();
	// DSP 끄고 effects 도 없으면 원본 패스스루 — decode 비용 회피
	if (!dspEnabled && effects.length === 0) {
		return { buffer: rawBuffer, mimeType: "audio/mpeg", processed: false };
	}

	try {
		const ctx = getAudioContext();
		const decoded = await ctx.decodeAudioData(rawBuffer.slice(0));
		let buffer: AudioBuffer = decoded;
		if (dspEnabled) buffer = await applyDspChain(buffer);
		if (effects.length > 0)
			buffer = await applyEffectsToBuffer(buffer, effects);
		const wav = encodeWav(buffer);
		return { buffer: wav, mimeType: "audio/wav", processed: true };
	} catch (e) {
		console.warn("Voice DSP failed, using raw audio:", e);
		return { buffer: rawBuffer, mimeType: "audio/mpeg", processed: false };
	}
}
