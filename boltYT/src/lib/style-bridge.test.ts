/**
 * style-bridge.ts 단위 테스트
 *
 * applyStyleToComposition: 순수 함수
 * getStyleConfig: supabase 의존 → vi.mock
 */

import { describe, expect, it, vi } from "vitest";

const mockMaybeSingle = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({
	supabase: {
		from: vi.fn(() => ({
			select: vi.fn(() => ({
				eq: vi.fn(() => ({ maybeSingle: mockMaybeSingle })),
			})),
		})),
	},
}));
vi.mock("./tts", () => ({
	findVoice: vi.fn(() => null),
}));

import { applyStyleToComposition, getStyleConfig } from "./style-bridge";
import type { StyleConfig } from "./style-bridge";

// ─── applyStyleToComposition ──────────────────────────────────────────────────
describe("applyStyleToComposition", () => {
	const style: StyleConfig = {
		subtitleStyle: { fontFamily: "Noto Sans KR" },
		captionStyle: "chunked",
		ttsOptions: {},
		thumbnailStyle: "minimal",
		colorPalette: ["#ff0000"],
	};

	it("subtitleStyle 병합", () => {
		const result = applyStyleToComposition(
			{ subtitleStyle: { fontWeight: 700 } },
			style,
		);
		expect(result.subtitleStyle).toMatchObject({
			fontFamily: "Noto Sans KR",
			fontWeight: 700,
		});
	});

	it("captionStyle 적용", () => {
		const result = applyStyleToComposition({}, style);
		expect(result.captionStyle).toBe("chunked");
	});

	it("props에 intro 있으면 style.intro 무시", () => {
		const styleWithIntro: StyleConfig = {
			...style,
			intro: { title: "style-intro" },
		};
		const result = applyStyleToComposition(
			{ intro: { title: "props-intro" } },
			styleWithIntro,
		);
		expect(result.intro?.title).toBe("props-intro");
	});

	it("props에 intro 없으면 style.intro 사용", () => {
		const styleWithIntro: StyleConfig = {
			...style,
			intro: { title: "style-intro" },
		};
		const result = applyStyleToComposition({}, styleWithIntro);
		expect(result.intro?.title).toBe("style-intro");
	});

	it("outro 없으면 undefined", () => {
		const result = applyStyleToComposition({}, style);
		expect(result.outro).toBeUndefined();
	});
});

// ─── getStyleConfig ───────────────────────────────────────────────────────────
describe("getStyleConfig", () => {
	it("style_bible 없으면 기본값 반환", async () => {
		mockMaybeSingle.mockResolvedValue({ data: null });
		const result = await getStyleConfig("channel-1");
		expect(result.subtitleStyle).toEqual({});
		expect(result.captionStyle).toBe("chunked");
		expect(result.colorPalette).toEqual([]);
		expect(result.ttsOptions).toEqual({});
	});

	it("style_bible 있으면 fontFamily 매핑", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "bold",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "dark",
					color_palette: ["#000"],
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널명", default_cta: "" } });
		const result = await getStyleConfig("ch-2");
		expect(result.subtitleStyle.fontWeight).toBe(700);
		expect(result.thumbnailStyle).toBe("dark");
		expect(result.colorPalette).toContain("#000");
	});

	it("intro_template 있을 때 topicTitle 우선 사용", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "default",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "기본 인트로",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널A", default_cta: "" } });
		const result = await getStyleConfig("ch-3", "주제 타이틀");
		expect(result.intro?.title).toBe("주제 타이틀");
		expect(result.intro?.channelName).toBe("채널A");
	});

	it("intro_template 없고 topicTitle 있으면 intro 생성", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "default",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널B", default_cta: "" } });
		const result = await getStyleConfig("ch-4", "토픽 제목");
		expect(result.intro?.title).toBe("토픽 제목");
	});

	it("intro_template 없고 topicTitle 없으면 intro undefined", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "default",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널C", default_cta: "" } });
		const result = await getStyleConfig("ch-5");
		expect(result.intro).toBeUndefined();
	});

	it("outro_template 있으면 outro 생성", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "default",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "",
					outro_template: "구독 눌러주세요",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널D", default_cta: "" } });
		const result = await getStyleConfig("ch-6");
		expect(result.outro?.ctaText).toBe("구독 눌러주세요");
	});

	it("outro_template 없고 default_cta 있으면 outro 생성", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "default",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널E", default_cta: "좋아요 구독" } });
		const result = await getStyleConfig("ch-7");
		expect(result.outro?.ctaText).toBe("좋아요 구독");
	});

	it("tts_voice_id 있고 findVoice 반환값 있으면 voice/provider 설정", async () => {
		const { findVoice } = await import("./tts");
		(findVoice as ReturnType<typeof vi.fn>).mockReturnValueOnce({
			id: "voice-abc",
			provider: "elevenlabs",
		});
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "default",
					tts_voice_id: "voice-abc",
					tts_speed: 1.5,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널F", default_cta: "" } });
		const result = await getStyleConfig("ch-8");
		expect(result.ttsOptions.voice).toBe("voice-abc");
		expect(result.ttsOptions.provider).toBe("elevenlabs");
		expect(result.ttsOptions.speed).toBe(1.5);
	});

	it("tts_voice_id 있고 findVoice null 반환 → voice ID 직접 설정", async () => {
		const { findVoice } = await import("./tts");
		(findVoice as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "default",
					tts_voice_id: "custom-voice-id",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: { name: "채널G", default_cta: "" } });
		const result = await getStyleConfig("ch-9");
		expect(result.ttsOptions.voice).toBe("custom-voice-id");
	});

	it("handwriting font → 폰트 매핑", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "handwriting",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: [],
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: null });
		const result = await getStyleConfig("ch-10");
		expect(String(result.subtitleStyle.fontFamily)).toContain("Nanum");
	});

	it("알 수 없는 font → 기본값 폴백", async () => {
		mockMaybeSingle
			.mockResolvedValueOnce({
				data: {
					subtitle_font: "unknown-font",
					tts_voice_id: "",
					tts_speed: 1.0,
					thumbnail_style: "",
					color_palette: null,
					intro_template: "",
					outro_template: "",
				},
			})
			.mockResolvedValueOnce({ data: null });
		const result = await getStyleConfig("ch-11");
		// unknown font → FONT_MAP.default via ?? fallback
		expect(result.subtitleStyle.fontFamily).toBe(
			"'Noto Sans KR', -apple-system, sans-serif",
		);
		expect(result.colorPalette).toEqual([]);
	});
});
