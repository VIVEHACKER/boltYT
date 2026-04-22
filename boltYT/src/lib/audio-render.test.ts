import { describe, expect, it, vi } from "vitest";
import * as audioEffectsWeb from "./audio-effects-web";
import {
	applyGainDirect,
	renderClipAudio,
	renderWithEffects,
} from "./audio-render";
import {
	applyGainToBuffer,
	computePeak,
	computeRMS,
	makeTestBuffer,
} from "./audio-test-utils";

describe("renderWithEffects", () => {
	it("effects 빈 배열 → 패스스루 (원본 buffer, processed=false)", async () => {
		const raw = new Uint8Array([1, 2, 3, 4]).buffer;
		const result = await renderWithEffects(raw, []);
		expect(result.buffer).toBe(raw);
		expect(result.mimeType).toBe("audio/mpeg");
		expect(result.processed).toBe(false);
	});

	it("AudioContext 있을 때 effects 적용 → processed=true 반환", async () => {
		const raw = new Uint8Array([1, 2, 3, 4]).buffer;
		// web-audio-mock.ts 가 AudioContext/OfflineAudioContext mock을 주입하므로 정상 처리 경로
		const result = await renderWithEffects(raw, [{ kind: "gain", db: -3 }]);
		expect(result.buffer).toBeInstanceOf(ArrayBuffer);
		expect(result.processed).toBe(true);
	});
});

// ─── audio-test-utils 자체 검증 ──────────────────────────────────────────────

describe("audio-test-utils", () => {
	it("makeTestBuffer — 440Hz 사인파 RMS ≈ 0.707 (1/√2)", () => {
		const buf = makeTestBuffer(44100, 0.1);
		const rms = computeRMS(buf);
		// 사인파 RMS = amplitude / √2 ≈ 0.7071
		expect(rms).toBeCloseTo(Math.SQRT1_2, 1);
	});

	it("makeTestBuffer — 440Hz 사인파 peak ≈ 1.0", () => {
		const buf = makeTestBuffer(44100, 0.1);
		const peak = computePeak(buf);
		expect(peak).toBeGreaterThan(0.99);
		expect(peak).toBeLessThanOrEqual(1.0);
	});

	it("applyGainToBuffer +6dB → RMS 약 2배", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const gained = applyGainToBuffer(buf, 6);
		const rmsAfter = computeRMS(gained);
		expect(rmsAfter / rmsBefore).toBeCloseTo(2.0, 1);
	});

	it("applyGainToBuffer -6dB → RMS 약 0.5배", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const attenuated = applyGainToBuffer(buf, -6);
		const rmsAfter = computeRMS(attenuated);
		expect(rmsAfter / rmsBefore).toBeCloseTo(0.5, 1);
	});

	it("applyGainToBuffer 0dB → RMS 변화 없음", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const unity = applyGainToBuffer(buf, 0);
		expect(computeRMS(unity)).toBeCloseTo(rmsBefore, 5);
	});

	it("원본 buffer 불변 — applyGainToBuffer 후 원본 RMS 변화 없음", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		applyGainToBuffer(buf, 12);
		expect(computeRMS(buf)).toBeCloseTo(rmsBefore, 5);
	});
});

// ─── applyGainDirect 순수함수 검증 ───────────────────────────────────────────

describe("applyGainDirect", () => {
	it("+6dB → RMS 약 2배", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const out = applyGainDirect(buf, 6);
		expect(computeRMS(out) / rmsBefore).toBeCloseTo(2.0, 1);
	});

	it("-6dB → RMS 약 0.5배", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const out = applyGainDirect(buf, -6);
		expect(computeRMS(out) / rmsBefore).toBeCloseTo(0.5, 1);
	});

	it("0dB → RMS 변화 없음 (패스스루)", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const out = applyGainDirect(buf, 0);
		expect(computeRMS(out)).toBeCloseTo(rmsBefore, 5);
	});

	it("+12dB → peak ≤ 4.0 (클리핑 없음, 단순 스케일링)", () => {
		const buf = makeTestBuffer(44100, 0.05);
		const out = applyGainDirect(buf, 12);
		// linear = 10^(12/20) ≈ 3.981, peak(sine=1.0) → ≈ 3.981
		expect(computePeak(out)).toBeCloseTo(10 ** (12 / 20), 1);
	});

	it("출력 buffer sampleRate/length/numberOfChannels 보존", () => {
		const buf = makeTestBuffer(44100, 0.1);
		const out = applyGainDirect(buf, 3);
		expect(out.sampleRate).toBe(buf.sampleRate);
		expect(out.length).toBe(buf.length);
		expect(out.numberOfChannels).toBe(buf.numberOfChannels);
	});
});

// ─── renderClipAudio DSP 수치 검증 ──────────────────────────────────────────

describe("renderClipAudio DSP 수치 검증", () => {
	it("effects 없으면 동일 buffer 반환 (참조 동일성)", async () => {
		const buf = makeTestBuffer(44100, 0.05);
		const out = await renderClipAudio(buf, { audioEffects: [] });
		expect(out).toBe(buf);
	});

	it("effects undefined → 동일 buffer 반환", async () => {
		const buf = makeTestBuffer(44100, 0.05);
		const out = await renderClipAudio(buf, {});
		expect(out).toBe(buf);
	});

	it("effects 없으면 RMS 변화 없음", async () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const out = await renderClipAudio(buf, { audioEffects: [] });
		expect(computeRMS(out)).toBeCloseTo(rmsBefore, 5);
	});

	it("gain +6dB → RMS 약 2배", async () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const out = await renderClipAudio(buf, {
			audioEffects: [{ kind: "gain", db: 6 }],
		});
		expect(computeRMS(out) / rmsBefore).toBeCloseTo(2.0, 1);
	});

	it("gain -6dB → RMS 약 0.5배", async () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const out = await renderClipAudio(buf, {
			audioEffects: [{ kind: "gain", db: -6 }],
		});
		expect(computeRMS(out) / rmsBefore).toBeCloseTo(0.5, 1);
	});

	it("gain 0dB → RMS 변화 없음 (패스스루)", async () => {
		const buf = makeTestBuffer(44100, 0.05);
		const rmsBefore = computeRMS(buf);
		const out = await renderClipAudio(buf, {
			audioEffects: [{ kind: "gain", db: 0 }],
		});
		expect(computeRMS(out)).toBeCloseTo(rmsBefore, 5);
	});

	it("빈 effects 배열 → buildEffectChain 호출 안 됨", async () => {
		const spy = vi.spyOn(audioEffectsWeb, "buildEffectChain");
		const buf = makeTestBuffer(44100, 0.05);
		await renderClipAudio(buf, { audioEffects: [] });
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("gain 단독 이펙트 → buildEffectChain 호출 안 됨 (직접 경로)", async () => {
		const spy = vi.spyOn(audioEffectsWeb, "buildEffectChain");
		const buf = makeTestBuffer(44100, 0.05);
		await renderClipAudio(buf, { audioEffects: [{ kind: "gain", db: 3 }] });
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("gain 외 이펙트 포함 → buildEffectChain 1회 호출", async () => {
		const spy = vi.spyOn(audioEffectsWeb, "buildEffectChain");
		const buf = makeTestBuffer(44100, 0.05);
		await renderClipAudio(buf, {
			audioEffects: [
				{ kind: "gain", db: 3 },
				{ kind: "eq3", low: 0, mid: 0, high: 0 },
			],
		});
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});
