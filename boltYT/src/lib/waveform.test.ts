/**
 * waveform.ts 단위 테스트
 *
 * extractPeaks: fetch 의존 → vi.stubGlobal (AudioContext 없이 에러 경로만)
 * drawWaveform: canvas mock
 * clearWaveformCache: 순수
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWaveformCache, drawWaveform, extractPeaks } from "./waveform";

afterEach(() => {
	clearWaveformCache();
	vi.restoreAllMocks();
});

// ─── extractPeaks ─────────────────────────────────────────────────────────────
describe("extractPeaks", () => {
	it("HTTP 오류 → 빈 Float32Array 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 404 }),
		);
		const result = await extractPeaks("https://example.com/audio.mp3");
		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(0);
	});

	it("네트워크 오류 → 빈 Float32Array 반환 (throw 없음)", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net fail")));
		const result = await extractPeaks("https://example.com/audio.mp3");
		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(0);
	});

	it("AudioContext 없으면 → 빈 Float32Array 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
			}),
		);
		// window.AudioContext 없음 → 에러 → catch → empty
		vi.stubGlobal("window", {});
		const result = await extractPeaks("https://example.com/audio.mp3", 100);
		expect(result).toBeInstanceOf(Float32Array);
	});

	it("AudioContext 있고 decode 성공 → peaks 반환", async () => {
		// 10개 샘플, value=0.5
		const channelData = new Float32Array(10).fill(0.5);
		const mockAudioBuffer = { getChannelData: () => channelData };

		class MockAudioContext {
			decodeAudioData() {
				return Promise.resolve(mockAudioBuffer);
			}
			close() {
				return Promise.resolve();
			}
		}

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
			}),
		);
		vi.stubGlobal("window", { AudioContext: MockAudioContext });

		const result = await extractPeaks("https://example.com/audio-ac.mp3", 5);
		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(5);
		expect(result[0]).toBeCloseTo(0.5, 1);
	});

	it("캐시 히트 → fetch 호출 없음", async () => {
		const channelData = new Float32Array(10).fill(0.3);
		const mockAudioBuffer = { getChannelData: () => channelData };

		class MockAudioContext2 {
			decodeAudioData() {
				return Promise.resolve(mockAudioBuffer);
			}
			close() {
				return Promise.resolve();
			}
		}

		vi.stubGlobal("window", { AudioContext: MockAudioContext2 });

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
		});
		vi.stubGlobal("fetch", fetchMock);

		// 첫 번째 호출 — fetch 1회
		await extractPeaks("https://example.com/cached2.mp3", 5);
		// 두 번째 호출 — 캐시 히트 → fetch 없음
		await extractPeaks("https://example.com/cached2.mp3", 5);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

// ─── drawWaveform ─────────────────────────────────────────────────────────────
describe("drawWaveform", () => {
	function makeCanvas(width = 200, height = 80) {
		const calls: string[] = [];
		const ctx = {
			clearRect: vi.fn(),
			fillRect: vi.fn(),
			fillStyle: "",
			get _calls() {
				return calls;
			},
		};
		return {
			width,
			height,
			getContext: vi.fn(() => ctx),
			_ctx: ctx,
		} as unknown as HTMLCanvasElement & { _ctx: typeof ctx };
	}

	it("peaks 없으면 fillRect 미호출", () => {
		const canvas = makeCanvas();
		const ctx = (
			canvas as unknown as { _ctx: ReturnType<typeof makeCanvas>["_ctx"] }
		)._ctx;
		drawWaveform(canvas, new Float32Array(0));
		expect(ctx.clearRect).toHaveBeenCalled();
		expect(ctx.fillRect).not.toHaveBeenCalled();
	});

	it("peaks 있으면 각 bar fillRect 호출", () => {
		const canvas = makeCanvas(100, 60);
		const ctx = (
			canvas as unknown as { _ctx: ReturnType<typeof makeCanvas>["_ctx"] }
		)._ctx;
		const peaks = new Float32Array([0.5, 0.8, 0.3]);
		drawWaveform(canvas, peaks);
		expect(ctx.fillRect).toHaveBeenCalledTimes(3);
	});

	it("background 옵션 → fillRect 한 번 더 호출 (배경)", () => {
		const canvas = makeCanvas(100, 60);
		const ctx = (
			canvas as unknown as { _ctx: ReturnType<typeof makeCanvas>["_ctx"] }
		)._ctx;
		const peaks = new Float32Array([0.5]);
		drawWaveform(canvas, peaks, { background: "#000" });
		// 배경 1 + 바 1 = 2
		expect(ctx.fillRect).toHaveBeenCalledTimes(2);
	});

	it("canvas context null → throw 없음", () => {
		const canvas = {
			width: 100,
			height: 60,
			getContext: vi.fn(() => null),
		} as unknown as HTMLCanvasElement;
		expect(() => drawWaveform(canvas, new Float32Array([0.5]))).not.toThrow();
	});
});

// ─── clearWaveformCache ───────────────────────────────────────────────────────
describe("clearWaveformCache", () => {
	it("throw 없음", () => {
		expect(() => clearWaveformCache()).not.toThrow();
	});
});
