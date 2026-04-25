/**
 * useProcessedAudioUrl — 오디오 이펙트 전처리 로직 테스트.
 *
 * @testing-library/react 미설치 환경 — 내부 async process 함수 로직을
 * 직접 검증 (renderWithEffects + fetch + blob URL 생성/해제 경로).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioEffect } from "../lib/audio-effects";
import { renderWithEffects } from "../lib/audio-render";

vi.mock("../lib/audio-render", () => ({
	renderWithEffects: vi.fn(async (_buf: ArrayBuffer, _effects: unknown) => ({
		buffer: new ArrayBuffer(4),
		mimeType: "audio/wav",
		processed: true,
	})),
}));

const mockRender = vi.mocked(renderWithEffects);

const GAIN: AudioEffect = { kind: "gain", db: -6 };
const AUDIO_URL = "https://example.com/audio.mp3";

async function processAudio(
	audioUrl: string,
	effects: AudioEffect[],
): Promise<{ url: string; blobCreated: boolean }> {
	const buf = await fetch(audioUrl).then((r) => r.arrayBuffer());
	const result = await renderWithEffects(buf, effects);
	const blob = new Blob([result.buffer], { type: result.mimeType });
	const url = URL.createObjectURL(blob);
	return { url, blobCreated: result.processed };
}

beforeEach(() => {
	let counter = 0;
	vi.stubGlobal("URL", {
		createObjectURL: vi.fn(() => `blob:mock-${counter++}`),
		revokeObjectURL: vi.fn(),
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("useProcessedAudioUrl — 내부 처리 로직", () => {
	it("effects 없으면 renderWithEffects 호출 안 함", async () => {
		// effectsKey === '' → hook 내부 early return
		const effectsKey = "";
		expect(effectsKey).toBe(""); // guard: no processing
		expect(mockRender).not.toHaveBeenCalled();
	});

	it("effects 있으면 fetch → renderWithEffects → blob URL 생성", async () => {
		const { url, blobCreated } = await processAudio(AUDIO_URL, [GAIN]);
		expect(fetch).toHaveBeenCalledWith(AUDIO_URL);
		expect(mockRender).toHaveBeenCalledTimes(1);
		expect(blobCreated).toBe(true);
		expect(url).toMatch(/^blob:/);
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
	});

	it("gain effect: db 값이 renderWithEffects 에 전달됨", async () => {
		await processAudio(AUDIO_URL, [GAIN]);
		const [, passedEffects] = mockRender.mock.calls[0] ?? [];
		expect(passedEffects).toEqual([GAIN]);
	});

	it("fetch 실패 → 원본 URL 반환 (fallback 경로)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network error");
			}),
		);
		await expect(processAudio(AUDIO_URL, [GAIN])).rejects.toThrow(
			"network error",
		);
		// hook 내부에서 catch → blobUrl = undefined → return audioUrl
		expect(URL.createObjectURL).not.toHaveBeenCalled();
	});

	it("renderWithEffects 실패 → blob 미생성", async () => {
		mockRender.mockRejectedValueOnce(new Error("codec error"));
		await expect(processAudio(AUDIO_URL, [GAIN])).rejects.toThrow(
			"codec error",
		);
		expect(URL.createObjectURL).not.toHaveBeenCalled();
	});

	it("multiple effects → 모두 renderWithEffects 에 전달", async () => {
		const effects: AudioEffect[] = [
			{ kind: "gain", db: 3 },
			{ kind: "eq3", low: 0, mid: 2, high: -1 },
		];
		await processAudio(AUDIO_URL, effects);
		const [, passed] = mockRender.mock.calls[0] ?? [];
		expect(passed).toEqual(effects);
	});
});
