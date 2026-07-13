/**
 * render-options 순수 함수 단위 테스트.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	crfRangeFor,
	DEFAULT_PRESET,
	resolveMemoryRenderOptions,
	resolveRenderOptions,
	toRemotionCliArgs,
	toRenderMediaOptions,
} from "./render-options";

describe("resolveRenderOptions", () => {
	it("defaults to high preset when nothing given", () => {
		const r = resolveRenderOptions();
		expect(r.preset).toBe(DEFAULT_PRESET);
		expect(r.codec).toBe("h264");
		expect(r.crf).toBe(18);
		expect(r.videoBitrate).toBe("12M");
	});

	it("draft preset is fastest, archive is highest quality", () => {
		const draft = resolveRenderOptions({ preset: "draft" });
		const archive = resolveRenderOptions({ preset: "archive" });
		expect(draft.crf).toBeGreaterThan(archive.crf);
		expect(draft.x264Preset).toBe("ultrafast");
		expect(archive.x264Preset).toBe("veryslow");
	});

	it("overrides win over preset values", () => {
		const r = resolveRenderOptions({
			preset: "draft",
			codec: "h265",
			videoBitrate: "6M",
		});
		expect(r.codec).toBe("h265");
		expect(r.videoBitrate).toBe("6M");
		// crf 는 draft 기본 유지
		expect(r.crf).toBe(28);
	});

	it("clamps crf to codec-specific range", () => {
		const r1 = resolveRenderOptions({ codec: "h264", crf: 40 });
		expect(r1.crf).toBe(28);
		const r2 = resolveRenderOptions({ codec: "h265", crf: 5 });
		expect(r2.crf).toBe(16);
		const r3 = resolveRenderOptions({ codec: "vp9", crf: 100 });
		expect(r3.crf).toBe(40);
	});

	it("clamps jpegQuality to [1,100]", () => {
		expect(resolveRenderOptions({ jpegQuality: 150 }).jpegQuality).toBe(100);
		expect(resolveRenderOptions({ jpegQuality: -5 }).jpegQuality).toBe(1);
	});

	it("falls back to default when crf is NaN", () => {
		const r = resolveRenderOptions({ crf: Number.NaN });
		expect(r.crf).toBe(18);
	});
});

describe("crfRangeFor", () => {
	it("h264 → [14,28]", () => {
		expect(crfRangeFor("h264")).toEqual({ min: 14, max: 28 });
	});
	it("h265 → [16,30]", () => {
		expect(crfRangeFor("h265")).toEqual({ min: 16, max: 30 });
	});
	it("vp9 → [10,40]", () => {
		expect(crfRangeFor("vp9")).toEqual({ min: 10, max: 40 });
	});
});

describe("toRemotionCliArgs", () => {
	it("h264 includes --x264-preset", () => {
		const args = toRemotionCliArgs(
			resolveRenderOptions({ preset: "balanced" }),
		);
		expect(args).toContain("--x264-preset");
		expect(args).toContain("fast");
		expect(args).toContain("--codec");
		expect(args).toContain("h264");
	});

	it("h265 drops --x264-preset", () => {
		const args = toRemotionCliArgs(
			resolveRenderOptions({ preset: "high", codec: "h265" }),
		);
		expect(args).not.toContain("--x264-preset");
		expect(args).toContain("h265");
	});
});

describe("toRenderMediaOptions", () => {
	it("includes x264Preset only for h264", () => {
		const h264 = toRenderMediaOptions(resolveRenderOptions({ codec: "h264" }));
		expect(h264.x264Preset).toBeDefined();
		const vp9 = toRenderMediaOptions(resolveRenderOptions({ codec: "vp9" }));
		expect(vp9.x264Preset).toBeUndefined();
	});
});

describe("hardware acceleration", () => {
	it("draft/balanced default hardwareAccel=if-possible", () => {
		expect(resolveRenderOptions({ preset: "draft" }).hardwareAccel).toBe(
			"if-possible",
		);
		expect(resolveRenderOptions({ preset: "balanced" }).hardwareAccel).toBe(
			"if-possible",
		);
	});

	it("high default hardwareAccel=if-possible, archive=disable (quality first)", () => {
		expect(resolveRenderOptions({ preset: "high" }).hardwareAccel).toBe(
			"if-possible",
		);
		expect(resolveRenderOptions({ preset: "archive" }).hardwareAccel).toBe(
			"disable",
		);
	});

	it("hardwareAccel=required disables crf (Remotion restriction)", () => {
		const r = resolveRenderOptions({ hardwareAccel: "required" });
		expect(r.useCrf).toBe(false);
		const args = toRemotionCliArgs(r);
		expect(args).not.toContain("--crf");
		expect(args).toContain("--video-bitrate");
		expect(args).toContain("--hardware-acceleration");
		expect(args).toContain("required");
	});

	it("useCrf true uses --crf without --video-bitrate", () => {
		const r = resolveRenderOptions({ hardwareAccel: "disable" });
		expect(r.useCrf).toBe(true);
		const args = toRemotionCliArgs(r);
		expect(args).toContain("--crf");
		expect(args).not.toContain("--video-bitrate");
		const opts = toRenderMediaOptions(r);
		expect(opts.crf).toBeDefined();
		expect(opts.videoBitrate).toBeUndefined();
		expect(opts.hardwareAcceleration).toBe("disable");
	});

	it("override hardwareAccel wins over preset default", () => {
		const r = resolveRenderOptions({
			preset: "draft",
			hardwareAccel: "disable",
		});
		expect(r.hardwareAccel).toBe("disable");
	});
});

describe("resolveMemoryRenderOptions", () => {
	const KEYS = [
		"REMOTION_CONCURRENCY",
		"REMOTION_OFFTHREAD_CACHE_MB",
		"REMOTION_MEDIA_CACHE_MB",
	];
	const saved: Record<string, string | undefined> = {};
	const MB = 1024 * 1024;

	beforeEach(() => {
		for (const k of KEYS) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
	});
	afterEach(() => {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it("defaults to RAM-conservative values (concurrency 2, 512MB caches)", () => {
		const m = resolveMemoryRenderOptions();
		expect(m.concurrency).toBe(2);
		expect(m.offthreadVideoCacheSizeInBytes).toBe(512 * MB);
		expect(m.mediaCacheSizeInBytes).toBe(512 * MB);
	});

	it("honors positive-integer env overrides (MB → bytes)", () => {
		process.env.REMOTION_CONCURRENCY = "6";
		process.env.REMOTION_OFFTHREAD_CACHE_MB = "256";
		process.env.REMOTION_MEDIA_CACHE_MB = "128";
		const m = resolveMemoryRenderOptions();
		expect(m.concurrency).toBe(6);
		expect(m.offthreadVideoCacheSizeInBytes).toBe(256 * MB);
		expect(m.mediaCacheSizeInBytes).toBe(128 * MB);
	});

	it("falls back to defaults on invalid concurrency (non-int / 0 / negative / float / empty)", () => {
		for (const bad of ["abc", "0", "-1", "2.5", ""]) {
			process.env.REMOTION_CONCURRENCY = bad;
			expect(resolveMemoryRenderOptions().concurrency).toBe(2);
		}
	});
});
