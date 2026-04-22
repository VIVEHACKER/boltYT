/**
 * voice-dsp.ts 단위 테스트
 *
 * Web Audio API(AudioContext, OfflineAudioContext)는 Node 환경 미지원 → 제외.
 * localStorage 기반 DSP 설정 토글만 검증한다.
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

vi.mock("./audio-effects-web", () => ({
	buildEffectChain: vi.fn(
		(_ctx: unknown, source: { connect: () => void }) => source,
	),
}));

import { encodeWav, isVoiceDspEnabled, setVoiceDspEnabled } from "./voice-dsp";

const _ls: Record<string, string> = {};
const mockStorage = {
	getItem: (k: string) => _ls[k] ?? null,
	setItem: (k: string, v: string) => {
		_ls[k] = v;
	},
	removeItem: (k: string) => {
		delete _ls[k];
	},
	clear: () => {
		for (const k of Object.keys(_ls)) delete _ls[k];
	},
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => mockStorage.clear());

describe("isVoiceDspEnabled / setVoiceDspEnabled", () => {
	it("기본값 → true (미설정 시)", () => {
		expect(isVoiceDspEnabled()).toBe(true);
	});

	it("setVoiceDspEnabled(false) 후 → false", () => {
		setVoiceDspEnabled(false);
		expect(isVoiceDspEnabled()).toBe(false);
	});

	it("setVoiceDspEnabled(true) 후 → true", () => {
		setVoiceDspEnabled(false);
		setVoiceDspEnabled(true);
		expect(isVoiceDspEnabled()).toBe(true);
	});

	it("localStorage에 'false' 문자열 있을 때만 disabled", () => {
		mockStorage.setItem("voice_dsp_enabled", "false");
		expect(isVoiceDspEnabled()).toBe(false);
		mockStorage.setItem("voice_dsp_enabled", "true");
		expect(isVoiceDspEnabled()).toBe(true);
	});
});

// ─── encodeWav ────────────────────────────────────────────────────────────────
function makeAudioBuffer(
	samples: number[],
	numChannels = 1,
	sampleRate = 44100,
): AudioBuffer {
	return {
		sampleRate,
		duration: samples.length / sampleRate,
		numberOfChannels: numChannels,
		length: samples.length,
		getChannelData: (_ch: number) => new Float32Array(samples),
		copyFromChannel: () => {},
		copyToChannel: () => {},
	} as unknown as AudioBuffer;
}

describe("encodeWav", () => {
	it("헤더(44) + PCM 데이터 크기", () => {
		const buf = makeAudioBuffer([0.5, -0.5, 0.0], 1, 44100);
		const wav = encodeWav(buf);
		expect(wav.byteLength).toBe(44 + 3 * 2);
	});

	it("RIFF 매직 바이트", () => {
		const wav = encodeWav(makeAudioBuffer([0]));
		const view = new DataView(wav);
		expect(view.getUint8(0)).toBe(82); // 'R'
		expect(view.getUint8(1)).toBe(73); // 'I'
		expect(view.getUint8(2)).toBe(70); // 'F'
		expect(view.getUint8(3)).toBe(70); // 'F'
	});

	it("WAVE 서명 (offset 8)", () => {
		const wav = encodeWav(makeAudioBuffer([0]));
		const view = new DataView(wav);
		expect(view.getUint8(8)).toBe(87); // 'W'
		expect(view.getUint8(9)).toBe(65); // 'A'
	});

	it("sampleRate 필드 (offset 24)", () => {
		const wav = encodeWav(makeAudioBuffer([0], 1, 22050));
		expect(new DataView(wav).getUint32(24, true)).toBe(22050);
	});

	it("빈 버퍼 → 44바이트 헤더만", () => {
		expect(encodeWav(makeAudioBuffer([])).byteLength).toBe(44);
	});

	it("클리핑 상한 → 0x7fff", () => {
		const wav = encodeWav(makeAudioBuffer([2.0]));
		expect(new DataView(wav).getInt16(44, true)).toBe(0x7fff);
	});

	it("클리핑 하한 → -0x8000", () => {
		const wav = encodeWav(makeAudioBuffer([-2.0]));
		expect(new DataView(wav).getInt16(44, true)).toBe(-0x8000);
	});
});

// ─── processVoice ─────────────────────────────────────────────────────────────
describe("processVoice", () => {
	function makeRawBuffer(samples: number[]): ArrayBuffer {
		const ab = new ArrayBuffer(samples.length * 4);
		const view = new DataView(ab);
		samples.forEach((v, i) => {
			view.setFloat32(i * 4, v, true);
		});
		return ab;
	}

	let originalAudioContext: unknown;
	let originalOfflineAudioContext: unknown;

	beforeEach(() => {
		originalAudioContext = globalThis.AudioContext;
		originalOfflineAudioContext = globalThis.OfflineAudioContext;
	});

	afterEach(() => {
		// @ts-expect-error — restoring test stub to original value
		globalThis.AudioContext = originalAudioContext;
		// @ts-expect-error — restoring test stub to original value
		globalThis.OfflineAudioContext = originalOfflineAudioContext;
	});

	it("DSP 비활성화 + effects 없음 → 원본 패스스루 (processed: false)", async () => {
		mockStorage.setItem("voice_dsp_enabled", "false");
		const { processVoice } = await import("./voice-dsp");
		const raw = makeRawBuffer([0.1, 0.2]);
		const result = await processVoice(raw, []);
		expect(result.processed).toBe(false);
		expect(result.mimeType).toBe("audio/mpeg");
		expect(result.buffer).toBe(raw);
		mockStorage.clear();
	});

	it("AudioContext 디코딩 실패 → fallback (processed: false)", async () => {
		mockStorage.setItem("voice_dsp_enabled", "true");

		const mockCtx = {
			state: "running",
			decodeAudioData: vi.fn(() => Promise.reject(new Error("decode fail"))),
		};
		// @ts-expect-error — stubbing read-only global for test
		globalThis.AudioContext = vi.fn(() => mockCtx);

		// 싱글턴 리셋: _sharedCtx 강제 재생성 위해 closed 상태 시뮬레이션
		const mod = await import("./voice-dsp");
		// getAudioContext 재호출 시 새 ctx 생성하도록 _sharedCtx 를 교체
		vi.spyOn(mod, "getAudioContext").mockReturnValue(
			mockCtx as unknown as AudioContext,
		);

		const raw = makeRawBuffer([0.1]);
		const result = await mod.processVoice(raw, []);
		expect(result.processed).toBe(false);
		expect(result.buffer).toBe(raw);

		vi.restoreAllMocks();
		mockStorage.clear();
	});

	it("DSP 비활성화 + effects 있음 → applyEffectsToBuffer 경로 → processed: true", async () => {
		// Web Audio mock 환경: window/AudioContext 제공 → applyEffectsToBuffer 성공
		mockStorage.setItem("voice_dsp_enabled", "false");

		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer([0.1]);

		const result = await mod.processVoice(raw, [
			{ kind: "gain", db: 0 } as import("./audio-effects").AudioEffect,
		]);
		expect(result.processed).toBe(true);
		expect(result.mimeType).toBe("audio/wav");

		mockStorage.clear();
	});
});

// ─── getAudioContext ─────────────────────────────────────────────────────────
describe("getAudioContext", () => {
	it("getAudioContext export 존재 확인", async () => {
		const mod = await import("./voice-dsp");
		expect(typeof mod.getAudioContext).toBe("function");
	});

	it("localStorage undefined 환경 → isVoiceDspEnabled 기본값 true", async () => {
		vi.stubGlobal("localStorage", undefined);

		const { isVoiceDspEnabled, setVoiceDspEnabled } = await import(
			"./voice-dsp"
		);
		expect(isVoiceDspEnabled()).toBe(true);
		expect(() => setVoiceDspEnabled(false)).not.toThrow();

		vi.stubGlobal("localStorage", mockStorage);
	});
});

// ─── applyDspChain / applyEffectsToBuffer via processVoice (Web Audio mock) ──
describe("processVoice — DSP 성공 경로 (Web Audio mock)", () => {
	function makeRawBuffer(len = 100): ArrayBuffer {
		return new ArrayBuffer(len * 4);
	}

	afterEach(() => {
		vi.restoreAllMocks();
		mockStorage.clear();
	});

	it("DSP 활성화 + effects=[] → processed: true, mimeType: audio/wav", async () => {
		mockStorage.setItem("voice_dsp_enabled", "true");
		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer();
		const result = await mod.processVoice(raw, []);
		expect(result.processed).toBe(true);
		expect(result.mimeType).toBe("audio/wav");
		expect(result.buffer).toBeInstanceOf(ArrayBuffer);
		expect(result.buffer.byteLength).toBeGreaterThan(44); // WAV header + data
	});

	it("DSP 활성화 + gain effect → processed: true", async () => {
		mockStorage.setItem("voice_dsp_enabled", "true");
		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer();
		const result = await mod.processVoice(raw, [
			{ kind: "gain", db: 3 } as import("./audio-effects").AudioEffect,
		]);
		expect(result.processed).toBe(true);
		expect(result.mimeType).toBe("audio/wav");
	});

	it("DSP 활성화 + eq3 effect → processed: true", async () => {
		mockStorage.setItem("voice_dsp_enabled", "true");
		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer();
		const result = await mod.processVoice(raw, [
			{
				kind: "eq3",
				low: 2,
				mid: 0,
				high: -2,
				midFreq: 1000,
			} as import("./audio-effects").AudioEffect,
		]);
		expect(result.processed).toBe(true);
	});

	it("DSP 비활성화 + gain effect → applyEffectsToBuffer 경로 → processed: true", async () => {
		mockStorage.setItem("voice_dsp_enabled", "false");
		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer();
		const result = await mod.processVoice(raw, [
			{ kind: "gain", db: 0 } as import("./audio-effects").AudioEffect,
		]);
		expect(result.processed).toBe(true);
		expect(result.mimeType).toBe("audio/wav");
	});

	it("DSP 비활성화 + effects=[] → passthrough (processed: false)", async () => {
		mockStorage.setItem("voice_dsp_enabled", "false");
		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer();
		const result = await mod.processVoice(raw, []);
		expect(result.processed).toBe(false);
		expect(result.buffer).toBe(raw);
	});
});

// ─── processVoice DSP 성공 경로 (OfflineAudioContext mock) ───────────────────
// NOTE: Web Audio API (AudioContext/OfflineAudioContext)는 Node.js 환경에서
// 사용 불가. getAudioContext() 내 `window` 참조가 ESM 모듈 스코프에서
// vi.stubGlobal로 인터셉트되지 않아 ReferenceError 발생.
// lines 39-145, 229-234 는 jsdom/browser 환경에서만 커버 가능.
// 이하 테스트는 Node.js에서 실행 가능한 경계 조건만 검증한다.
describe("processVoice — Node.js 경계 조건", () => {
	function makeRawBuffer(samples: number[]): ArrayBuffer {
		const ab = new ArrayBuffer(samples.length * 4);
		const view = new DataView(ab);
		for (let i = 0; i < samples.length; i++)
			view.setFloat32(i * 4, samples[i], true);
		return ab;
	}

	afterEach(() => {
		vi.restoreAllMocks();
		mockStorage.clear();
	});

	it("DSP 활성화 + effects=[] → Web Audio mock 환경 → processed: true", async () => {
		// Web Audio mock 제공: applyDspChain 성공 경로
		mockStorage.setItem("voice_dsp_enabled", "true");
		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer([0.1]);
		const result = await mod.processVoice(raw, []);
		expect(result.processed).toBe(true);
		expect(result.mimeType).toBe("audio/wav");
	});

	it("processVoice export 존재 확인", async () => {
		const mod = await import("./voice-dsp");
		expect(typeof mod.processVoice).toBe("function");
	});

	it("DSP 비활성화 + effects=[] → passthrough (processed: false)", async () => {
		mockStorage.setItem("voice_dsp_enabled", "false");
		const mod = await import("./voice-dsp");
		const raw = makeRawBuffer([0.5, -0.5]);
		const result = await mod.processVoice(raw, []);
		expect(result.processed).toBe(false);
		expect(result.mimeType).toBe("audio/mpeg");
		expect(result.buffer).toBe(raw);
	});
});
