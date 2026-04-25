/**
 * audio-effects-ffmpeg 테스트 — ffmpeg 없이 필터 체인 문자열 검증.
 *
 * applyEffectsToAudioUrl / preprocessProjectAudio 는 ffmpeg 의존이므로
 * execFile mock 으로 격리 테스트.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioEffect } from "../../src/lib/audio-effects.js";
import type { TimelineProject } from "../../src/lib/timeline-model.js";
import {
	applyEffectsToAudioUrl,
	buildAudioFilterChain,
	preprocessProjectAudio,
} from "./audio-effects-ffmpeg.js";

// ─── execFile mock ────────────────────────────────────────────────────────────
vi.mock("node:child_process", () => ({
	execFile: vi.fn(
		(
			_cmd: string,
			_args: string[],
			_opts: unknown,
			cb: (err: Error | null, stdout: string, stderr: string) => void,
		) => {
			cb(null, "", "");
			return { kill: vi.fn() };
		},
	),
}));

import { execFile } from "node:child_process";

const mockExec = vi.mocked(execFile);

// ─── buildAudioFilterChain ────────────────────────────────────────────────────

describe("buildAudioFilterChain", () => {
	it("빈 배열 → 빈 문자열", () => {
		expect(buildAudioFilterChain([])).toBe("");
	});

	it("gain → volume={db}dB", () => {
		const f = buildAudioFilterChain([{ kind: "gain", db: -6 }]);
		expect(f).toBe("volume=-6dB");
	});

	it("gain 0dB → volume=0dB", () => {
		const f = buildAudioFilterChain([{ kind: "gain", db: 0 }]);
		expect(f).toBe("volume=0dB");
	});

	it("eq3 low/mid/high 모두 0 → 빈 문자열", () => {
		const f = buildAudioFilterChain([{ kind: "eq3", low: 0, mid: 0, high: 0 }]);
		expect(f).toBe("");
	});

	it("eq3 low만 → equalizer f=320 포함", () => {
		const f = buildAudioFilterChain([{ kind: "eq3", low: 3, mid: 0, high: 0 }]);
		expect(f).toContain("equalizer=f=320");
		expect(f).toContain("g=3");
	});

	it("eq3 mid → midFreq 기본값 1000 사용", () => {
		const f = buildAudioFilterChain([{ kind: "eq3", low: 0, mid: 2, high: 0 }]);
		expect(f).toContain("f=1000");
	});

	it("eq3 midFreq 커스텀", () => {
		const f = buildAudioFilterChain([
			{ kind: "eq3", low: 0, mid: 2, high: 0, midFreq: 2500 },
		]);
		expect(f).toContain("f=2500");
	});

	it("delay → aecho 포함 + 시간 ms 변환", () => {
		const f = buildAudioFilterChain([
			{ kind: "delay", time: 0.25, feedback: 0.5, wet: 0.4 },
		]);
		expect(f).toContain("aecho");
		expect(f).toContain("delays=250");
		expect(f).toContain("decays=0.500");
	});

	it("reverb room → aecho + 다중 딜레이", () => {
		const f = buildAudioFilterChain([
			{ kind: "reverb", preset: "room", wet: 0.4, decay: 2 },
		]);
		expect(f).toContain("aecho");
		expect(f).toContain("delays=20|40|60");
	});

	it("reverb hall → delays=30|80|150", () => {
		const f = buildAudioFilterChain([
			{ kind: "reverb", preset: "hall", wet: 0.3, decay: 1.5 },
		]);
		expect(f).toContain("delays=30|80|150");
	});

	it("reverb plate → delays=10|25|45", () => {
		const f = buildAudioFilterChain([
			{ kind: "reverb", preset: "plate", wet: 0.5, decay: 1 },
		]);
		expect(f).toContain("delays=10|25|45");
	});

	it("FX_ORDER: eq3 → gain → delay (쉼표 연결, 순서 보장)", () => {
		const effects: AudioEffect[] = [
			{ kind: "delay", time: 0.1, feedback: 0.3, wet: 0.3 },
			{ kind: "gain", db: -3 },
			{ kind: "eq3", low: 2, mid: 0, high: 0 },
		];
		const f = buildAudioFilterChain(effects);
		const eqIdx = f.indexOf("equalizer");
		const volIdx = f.indexOf("volume");
		const echoIdx = f.indexOf("aecho");
		expect(eqIdx).toBeLessThan(volIdx);
		expect(volIdx).toBeLessThan(echoIdx);
	});
});

// ─── applyEffectsToAudioUrl ───────────────────────────────────────────────────

describe("applyEffectsToAudioUrl", () => {
	it("effects 없으면 false 반환 (execFile 미호출)", async () => {
		mockExec.mockClear();
		const ok = await applyEffectsToAudioUrl(
			"http://example.com/audio.mp3",
			[],
			"/tmp/out.mp3",
		);
		expect(ok).toBe(false);
		expect(mockExec).not.toHaveBeenCalled();
	});

	it("effects 있고 ffmpeg 성공 → true", async () => {
		const ok = await applyEffectsToAudioUrl(
			"http://example.com/audio.mp3",
			[{ kind: "gain", db: -3 }],
			"/tmp/out.mp3",
		);
		expect(ok).toBe(true);
	});

	it("ffmpeg 실패 → false (에러 삼키지 않음)", async () => {
		mockExec.mockImplementationOnce(
			(
				_cmd: string,
				_args: string[],
				_opts: unknown,
				cb: (err: Error | null, stdout: string, stderr: string) => void,
			) => {
				cb(new Error("ffmpeg not found"), "", "");
				return { kill: vi.fn() };
			},
		);
		const ok = await applyEffectsToAudioUrl(
			"http://example.com/audio.mp3",
			[{ kind: "gain", db: -3 }],
			"/tmp/out.mp3",
		);
		expect(ok).toBe(false);
	});
});

// ─── preprocessProjectAudio ───────────────────────────────────────────────────

describe("preprocessProjectAudio", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `test-fx-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		mockExec.mockClear();
	});

	afterEach(() => {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
		mockExec.mockClear();
	});

	function makeProject(
		clips: Array<{
			audioUrl?: string;
			audioEffects?: AudioEffect[];
		}>,
	): TimelineProject {
		return {
			id: "p1",
			scriptId: "s1",
			fps: 30,
			width: 1080,
			height: 1920,
			tracks: [],
			clips: clips.map((c, i) => ({
				id: `clip-${i}`,
				trackId: "t1",
				kind: "audio" as const,
				startFrame: 0,
				durationFrames: 90,
				volume: 1,
				muted: false,
				label: "",
				meta: {},
				...c,
			})),
			markers: [],
			bgmVolume: 0.3,
			multicamGroups: [],
		} as unknown as TimelineProject;
	}

	it("audioEffects 없는 클립 → audioUrl 변경 없음", async () => {
		const project = makeProject([{ audioUrl: "http://example.com/a.mp3" }]);
		const result = await preprocessProjectAudio(
			project,
			tmpDir,
			"sub",
			"http://localhost:3458/assets",
		);
		expect(result.clips[0]?.audioUrl).toBe("http://example.com/a.mp3");
		expect(mockExec).not.toHaveBeenCalled();
	});

	it("audioEffects 있고 ffmpeg 성공 → audioUrl이 serve URL로 교체", async () => {
		const project = makeProject([
			{
				audioUrl: "http://example.com/a.mp3",
				audioEffects: [{ kind: "gain", db: -3 }],
			},
		]);
		const result = await preprocessProjectAudio(
			project,
			tmpDir,
			"job-123",
			"http://localhost:3458/assets",
		);
		const url = result.clips[0]?.audioUrl ?? "";
		expect(url).toContain("localhost:3458");
		expect(url).toContain("job-123");
		expect(url).toContain("clip-0.mp3");
	});

	it("ffmpeg 실패 → 원본 audioUrl 유지", async () => {
		mockExec.mockImplementationOnce(
			(
				_cmd: string,
				_args: string[],
				_opts: unknown,
				cb: (err: Error | null, stdout: string, stderr: string) => void,
			) => {
				cb(new Error("codec error"), "", "");
				return { kill: vi.fn() };
			},
		);
		const project = makeProject([
			{
				audioUrl: "http://example.com/a.mp3",
				audioEffects: [{ kind: "gain", db: -6 }],
			},
		]);
		const result = await preprocessProjectAudio(
			project,
			tmpDir,
			"job-456",
			"http://localhost:3458/assets",
		);
		expect(result.clips[0]?.audioUrl).toBe("http://example.com/a.mp3");
	});

	it("audioUrl 없는 클립 → 건너뜀", async () => {
		const project = makeProject([{ audioEffects: [{ kind: "gain", db: -3 }] }]);
		const result = await preprocessProjectAudio(
			project,
			tmpDir,
			"job-789",
			"http://localhost:3458/assets",
		);
		expect(result.clips[0]?.audioUrl).toBeUndefined();
		expect(mockExec).not.toHaveBeenCalled();
	});
});
