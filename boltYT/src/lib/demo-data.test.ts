import { describe, expect, it, vi } from "vitest";

vi.mock("remotion", () => ({
	staticFile: (path: string) => `/static/${path}`,
}));

import {
	DEMO_BGM_URL,
	DEMO_CHANNELS,
	DEMO_SCENES,
	getDemoRemotionScenes,
} from "./demo-data";

describe("DEMO_CHANNELS", () => {
	it("1개 채널 존재", () => {
		expect(DEMO_CHANNELS).toHaveLength(1);
	});

	it("필수 필드 포함", () => {
		const ch = DEMO_CHANNELS[0];
		expect(ch.id).toBe("ch-1");
		expect(ch.language).toBe("ko");
	});
});

describe("DEMO_SCENES", () => {
	it("3개 씬 존재", () => {
		expect(DEMO_SCENES).toHaveLength(3);
	});

	it("order_index 순서 보장", () => {
		const indices = DEMO_SCENES.map((s) => s.order_index);
		expect(indices).toEqual([0, 1, 2]);
	});

	it("scene_type이 유효한 값", () => {
		const valid = ["image", "text_emphasis", "video", "news_overlay"];
		for (const s of DEMO_SCENES) {
			expect(valid).toContain(s.scene_type);
		}
	});
});

describe("DEMO_BGM_URL", () => {
	it("staticFile 경로 반환", () => {
		expect(DEMO_BGM_URL).toContain("dark-ambient.mp3");
	});
});

describe("getDemoRemotionScenes", () => {
	it("DEMO_SCENES와 같은 길이", () => {
		const scenes = getDemoRemotionScenes();
		expect(scenes).toHaveLength(DEMO_SCENES.length);
	});

	it("각 씬에 durationInFrames > 0", () => {
		const scenes = getDemoRemotionScenes();
		for (const s of scenes) {
			expect(s.durationInFrames).toBeGreaterThan(0);
		}
	});

	it("audioUrl에 staticFile 경로 포함", () => {
		const scenes = getDemoRemotionScenes();
		for (const s of scenes) {
			expect(s.audioUrl).toContain("/static/");
		}
	});

	it("mood='mystery' 고정", () => {
		const scenes = getDemoRemotionScenes();
		for (const s of scenes) {
			expect(s.mood).toBe("mystery");
		}
	});

	it("shots 배열 존재", () => {
		const scenes = getDemoRemotionScenes();
		for (const s of scenes) {
			expect(Array.isArray(s.shots)).toBe(true);
			expect(s.shots?.length ?? 0).toBeGreaterThan(0);
		}
	});
});
