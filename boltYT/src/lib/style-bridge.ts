/**
 * 스타일바이블 → 렌더 연동 브릿지
 *
 * style_bibles 테이블의 설정을 Remotion CompositionProps로 변환
 */

import type { CompositionProps } from "../remotion/Composition";
import type { EndCardProps } from "../remotion/cards/EndCard";
import type { TitleCardProps } from "../remotion/cards/TitleCard";
import type { CaptionStyle, SubtitleStyle } from "../remotion/types";
import { supabase } from "./supabase";
import type { TtsOptions } from "./tts";
import { findVoice } from "./tts";

interface StyleBibleRow {
	id: string;
	channel_id: string;
	character_name: string;
	color_palette: string[];
	subtitle_font: string;
	subtitle_placement: string;
	tts_voice_id: string;
	tts_speed: number;
	tts_tone: string;
	thumbnail_style: string;
	intro_template: string;
	outro_template: string;
}

export interface StyleConfig {
	subtitleStyle: SubtitleStyle;
	captionStyle: CaptionStyle;
	intro?: TitleCardProps;
	outro?: EndCardProps;
	ttsOptions: TtsOptions;
	thumbnailStyle: string;
	colorPalette: string[];
}

const FONT_MAP: Record<string, string> = {
	default: "'Noto Sans KR', -apple-system, sans-serif",
	bold: "'Noto Sans KR', -apple-system, sans-serif",
	handwriting: "'Nanum Pen Script', cursive, sans-serif",
};

const FONT_WEIGHT_MAP: Record<string, number> = {
	default: 400,
	bold: 700,
	handwriting: 400,
};

/** 채널의 스타일바이블을 렌더 설정으로 변환 */
export async function getStyleConfig(
	channelId: string,
	topicTitle?: string,
): Promise<StyleConfig> {
	const { data } = await supabase
		.from("style_bibles")
		.select("*")
		.eq("channel_id", channelId)
		.maybeSingle();

	const sb = data as StyleBibleRow | null;

	if (!sb) {
		// 스타일바이블 없으면 기본값
		return {
			subtitleStyle: {},
			captionStyle: "chunked",
			ttsOptions: {},
			thumbnailStyle: "",
			colorPalette: [],
		};
	}

	// ─── 자막 스타일 매핑 ───
	const subtitleStyle: SubtitleStyle = {
		fontFamily: FONT_MAP[sb.subtitle_font] ?? FONT_MAP.default,
		fontWeight: FONT_WEIGHT_MAP[sb.subtitle_font] ?? 400,
	};

	// ─── 인트로 ───
	const { data: channel } = await supabase
		.from("channels")
		.select("name, default_cta")
		.eq("id", channelId)
		.maybeSingle();

	const ch = channel as { name?: string; default_cta?: string } | null;

	const intro: TitleCardProps | undefined = sb.intro_template
		? {
				title: topicTitle ?? sb.intro_template,
				channelName: ch?.name,
			}
		: topicTitle
			? {
					title: topicTitle,
					channelName: ch?.name,
				}
			: undefined;

	// ─── 아웃트로 ───
	const outro: EndCardProps | undefined = sb.outro_template
		? {
				channelName: ch?.name,
				ctaText: sb.outro_template,
			}
		: ch?.default_cta
			? {
					channelName: ch?.name,
					ctaText: ch.default_cta,
				}
			: undefined;

	// ─── TTS 옵션 ───
	const ttsOptions: TtsOptions = {};
	if (sb.tts_voice_id) {
		const voice = findVoice(sb.tts_voice_id);
		if (voice) {
			ttsOptions.voice = voice.id;
			ttsOptions.provider = voice.provider;
		} else {
			// ID가 직접 입력된 경우 (커스텀 voice)
			ttsOptions.voice = sb.tts_voice_id;
		}
	}
	if (sb.tts_speed && sb.tts_speed !== 1.0) {
		ttsOptions.speed = sb.tts_speed;
	}

	return {
		subtitleStyle,
		captionStyle: "chunked",
		intro,
		outro,
		ttsOptions,
		thumbnailStyle: sb.thumbnail_style,
		colorPalette: sb.color_palette ?? [],
	};
}

/** StyleConfig를 CompositionProps에 적용 */
export function applyStyleToComposition(
	props: Partial<CompositionProps>,
	style: StyleConfig,
): Partial<CompositionProps> {
	return {
		...props,
		subtitleStyle: { ...props.subtitleStyle, ...style.subtitleStyle },
		captionStyle: style.captionStyle,
		intro: props.intro ?? style.intro,
		outro: props.outro ?? style.outro,
	};
}
