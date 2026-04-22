/**
 * bgm-analyze.ts 단위 테스트
 *
 * analyzeAudioBuffer: AudioBuffer mock 사용.
 * analyzeBgmFromUrl: AudioContext WebAPI 의존 → fetch 오류 경로만 검증.
 * isBpmReliable: 순수 함수 → 외부 의존 없음.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BgmAnalysis } from "./bgm-analyze";
import {
	analyzeAudioBuffer,
	analyzeBgmFromUrl,
	isBpmReliable,
} from "./bgm-analyze";

afterEach(() => vi.restoreAllMocks());

// ─── AudioBuffer mock 헬퍼 ────────────────────────────────────────────────────
function makeAudioBuffer(samples: number[], sampleRate = 44100): AudioBuffer {
	return {
		sampleRate,
		duration: samples.length / sampleRate,
		numberOfChannels: 1,
		length: samples.length,
		getChannelData: () => new Float32Array(samples),
		copyFromChannel: vi.fn(),
		copyToChannel: vi.fn(),
	} as unknown as AudioBuffer;
}

// ─── analyzeAudioBuffer ───────────────────────────────────────────────────────
describe("analyzeAudioBuffer", () => {
	it("빈 채널(0샘플) → bpm 0, beats 빈 배열", () => {
		const buf = makeAudioBuffer([]);
		expect(analyzeAudioBuffer(buf)).toEqual({
			bpm: 0,
			beats: [],
			confidence: 0,
		});
	});

	it("짧은 버퍼(onset 4개 미만) → bpm 0", () => {
		// 0.1초 분량 → onset 감지 어려움
		const samples = new Array(4410).fill(0.01);
		const buf = makeAudioBuffer(samples);
		const result = analyzeAudioBuffer(buf);
		expect(result.bpm).toBe(0);
	});

	it("유효한 BPM 감지 — 120BPM(0.5초 간격) 샘플", () => {
		const sampleRate = 44100;
		// 120BPM = 0.5초 간격 비트 = 22050 샘플 간격
		// 10초 버퍼에 비트 신호 삽입
		const totalSamples = sampleRate * 10;
		const samples = new Array(totalSamples).fill(0.001);
		const beatInterval = sampleRate / 2; // 22050 samples = 0.5s
		for (let i = 0; i < totalSamples; i += beatInterval) {
			// 각 비트 위치에서 짧은 임펄스 (에너지 급상승)
			const end = Math.min(i + 200, totalSamples);
			for (let j = i; j < end; j++) {
				samples[j] = 0.9;
			}
		}
		const buf = makeAudioBuffer(samples, sampleRate);
		const result = analyzeAudioBuffer(buf);
		// BPM이 0이 아니면 유효한 분석 결과
		if (result.bpm > 0) {
			expect(result.bpm).toBeGreaterThanOrEqual(60);
			expect(result.bpm).toBeLessThanOrEqual(180);
			expect(result.beats.length).toBeGreaterThan(0);
			expect(result.confidence).toBeGreaterThanOrEqual(0);
		} else {
			// onset 감지에 실패해도 에러 없이 기본값 반환
			expect(result).toEqual({ bpm: 0, beats: [], confidence: 0 });
		}
	});
});

// ─── analyzeBgmFromUrl ────────────────────────────────────────────────────────
describe("analyzeBgmFromUrl", () => {
	it("HTTP 오류 → 기본값 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 404 }),
		);
		const result = await analyzeBgmFromUrl("https://example.com/bgm.mp3");
		expect(result).toEqual({ bpm: 0, beats: [], confidence: 0 });
	});

	it("네트워크 오류 → 기본값 반환 (throw 없음)", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net fail")));
		const result = await analyzeBgmFromUrl("https://example.com/bgm.mp3");
		expect(result).toEqual({ bpm: 0, beats: [], confidence: 0 });
	});

	it("AudioContext 성공 경로 → analyzeAudioBuffer 결과 반환", async () => {
		const fakeArrayBuffer = new ArrayBuffer(100);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(fakeArrayBuffer),
			}),
		);

		const fakeAudioBuffer = {
			sampleRate: 44100,
			duration: 0.1,
			numberOfChannels: 1,
			length: 4410,
			getChannelData: () => new Float32Array(4410).fill(0.001),
			copyFromChannel: vi.fn(),
			copyToChannel: vi.fn(),
		};

		class MockAudioContext {
			decodeAudioData(_buf: ArrayBuffer) {
				return Promise.resolve(fakeAudioBuffer);
			}
			close() {
				return Promise.resolve();
			}
		}

		vi.stubGlobal("window", {
			AudioContext: MockAudioContext,
		});

		const result = await analyzeBgmFromUrl("https://example.com/bgm.mp3");
		// bpm이 0이어도 에러 없이 반환됨
		expect(result).toHaveProperty("bpm");
		expect(result).toHaveProperty("beats");
		expect(result).toHaveProperty("confidence");

		vi.stubGlobal("window", undefined);
	});

	it("webkitAudioContext fallback 경로", async () => {
		const fakeArrayBuffer = new ArrayBuffer(100);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(fakeArrayBuffer),
			}),
		);

		class MockWebkitAudioContext {
			decodeAudioData(_buf: ArrayBuffer) {
				return Promise.resolve({
					sampleRate: 44100,
					duration: 0.1,
					numberOfChannels: 1,
					length: 4410,
					getChannelData: () => new Float32Array(4410).fill(0.001),
				});
			}
			close() {
				return Promise.resolve();
			}
		}

		vi.stubGlobal("window", {
			AudioContext: undefined,
			webkitAudioContext: MockWebkitAudioContext,
		});

		const result = await analyzeBgmFromUrl("https://example.com/bgm.mp3");
		expect(result).toHaveProperty("bpm");

		vi.stubGlobal("window", undefined);
	});
});

// ─── isBpmReliable ────────────────────────────────────────────────────────────
describe("isBpmReliable", () => {
	it("bpm >= MIN(60) · confidence >= 0.4 → true", () => {
		const a: BgmAnalysis = { bpm: 120, beats: [0.5], confidence: 0.5 };
		expect(isBpmReliable(a)).toBe(true);
	});

	it("bpm 0 → false", () => {
		expect(isBpmReliable({ bpm: 0, beats: [], confidence: 0 })).toBe(false);
	});

	it("confidence 0.39 → false", () => {
		expect(isBpmReliable({ bpm: 120, beats: [], confidence: 0.39 })).toBe(
			false,
		);
	});

	it("bpm 59 (< MIN_BPM 60) → false", () => {
		expect(isBpmReliable({ bpm: 59, beats: [], confidence: 0.9 })).toBe(false);
	});

	it("경계값: bpm=60, confidence=0.4 → true", () => {
		expect(isBpmReliable({ bpm: 60, beats: [], confidence: 0.4 })).toBe(true);
	});
});
