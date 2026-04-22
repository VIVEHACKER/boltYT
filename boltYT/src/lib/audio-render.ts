/**
 * AudioEffect 체인을 OfflineAudioContext 로 렌더링 → WAV 결과 반환.
 *
 * 용도: clip.audioEffects 가 있는 경우 프리뷰/내보내기 전 한 번 오프라인 렌더 후
 *      브라우저는 렌더된 WAV 를 그대로 재생. 실시간 그래프 재생성 비용 회피.
 */

import type { AudioEffect } from "./audio-effects";
import { buildEffectChain } from "./audio-effects-web";
import type { TimelineClip } from "./timeline-model";
import { encodeWav, getAudioContext } from "./voice-dsp";

/**
 * gain(dB)을 Float32Array에 직접 스케일링 적용 — OfflineAudioContext 없이 수치 검증 가능.
 * 새 AudioBuffer를 반환 (원본 불변).
 */
export function applyGainDirect(
	input: AudioBuffer,
	gainDb: number,
): AudioBuffer {
	const linear = 10 ** (gainDb / 20);
	const out = new AudioBuffer({
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
	return out;
}

export interface RenderResult {
	buffer: ArrayBuffer;
	mimeType: string;
	processed: boolean;
}

/**
 * 원본 오디오 버퍼 + effects → 체인 적용된 WAV.
 * effects 비어있으면 no-op 패스스루 (mimeType 은 원본 가정: audio/mpeg).
 * 실패 시 원본 반환 (호출자에서 UI 경고만 띄우면 됨).
 */
export async function renderWithEffects(
	rawBuffer: ArrayBuffer,
	effects: AudioEffect[],
): Promise<RenderResult> {
	if (effects.length === 0) {
		return { buffer: rawBuffer, mimeType: "audio/mpeg", processed: false };
	}
	try {
		const ctx = getAudioContext();
		const decoded = await ctx.decodeAudioData(rawBuffer.slice(0));
		const offline = new OfflineAudioContext(
			decoded.numberOfChannels,
			decoded.length,
			decoded.sampleRate,
		);
		const source = offline.createBufferSource();
		source.buffer = decoded;
		const head = buildEffectChain(offline, source, effects);
		head.connect(offline.destination);
		source.start(0);
		const rendered = await offline.startRendering();
		return {
			buffer: encodeWav(rendered),
			mimeType: "audio/wav",
			processed: true,
		};
	} catch (e) {
		console.warn("renderWithEffects failed, using raw audio:", e);
		return { buffer: rawBuffer, mimeType: "audio/mpeg", processed: false };
	}
}

/**
 * TimelineClip.audioEffects 를 OfflineAudioContext 체인으로 적용해 AudioBuffer 반환.
 * clip.audioEffects 가 없거나 비어있으면 buffer 를 그대로 패스스루.
 * 실패 시 원본 buffer 반환 (호출자 영향 없음).
 */
export async function renderClipAudio(
	buffer: AudioBuffer,
	clip: Pick<TimelineClip, "audioEffects">,
): Promise<AudioBuffer> {
	const effects: AudioEffect[] = clip.audioEffects ?? [];
	if (effects.length === 0) return buffer;

	// gain 단독 이펙트는 OfflineAudioContext 없이 직접 스케일링 — 수치 검증 가능
	if (effects.length === 1 && effects[0]?.kind === "gain") {
		return applyGainDirect(buffer, effects[0].db);
	}

	try {
		const offline = new OfflineAudioContext(
			buffer.numberOfChannels,
			buffer.length,
			buffer.sampleRate,
		);
		const source = offline.createBufferSource();
		source.buffer = buffer;
		const head = buildEffectChain(offline, source, effects);
		head.connect(offline.destination);
		source.start(0);
		return await offline.startRendering();
	} catch (e) {
		console.warn("renderClipAudio failed, using original buffer:", e);
		return buffer;
	}
}
