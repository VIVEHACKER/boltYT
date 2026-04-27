import type { SceneShot } from "../lib/scene-shot-types";

/** 모션 그래픽 스펙 — 씬에 오버레이되는 애니메이션 요소 */
export type MotionGraphicType =
	| "number_counter"
	| "lower_third"
	| "progress_bar"
	| "arrow_callout"
	| "quote_bubble"
	| "emoji_burst";

export interface MotionGraphicSpec {
	type: MotionGraphicType;
	/** 씬 내 시작 프레임 (0 = 씬 시작) */
	startFrame: number;
	/** 표시 지속 프레임 */
	duration: number;
	/** 타입별 파라미터 */
	params: Record<string, unknown>;
}

export interface Profile {
	[key: string]: unknown;
	id: string;
	email: string;
	display_name: string;
	avatar_url: string;
	created_at: string;
}

export interface Channel {
	[key: string]: unknown;
	id: string;
	user_id: string;
	name: string;
	description: string;
	language: string;
	category: string;
	tone: string;
	forbidden_words: string[];
	default_cta: string;
	visibility_policy: string;
	created_at: string;
	updated_at: string;
}

export interface StyleBible {
	[key: string]: unknown;
	id: string;
	channel_id: string;
	character_name: string;
	appearance_description: string;
	outfit_rules: string;
	background_rules: string;
	color_palette: string[];
	subtitle_font: string;
	subtitle_placement: string;
	cut_duration_rules: string;
	tts_voice_id: string;
	tts_speed: number;
	tts_tone: string;
	thumbnail_style: string;
	intro_template: string;
	outro_template: string;
	created_at: string;
	updated_at: string;
}

export interface Topic {
	[key: string]: unknown;
	id: string;
	channel_id: string;
	title: string;
	status: string;
	source: string;
	created_at: string;
}

export interface Brief {
	[key: string]: unknown;
	id: string;
	topic_id: string;
	core_message: string;
	target_audience: string;
	cautions: string;
	shorts_hooks: string[];
	longform_outline: Record<string, unknown>[];
	created_at: string;
}

export interface Script {
	[key: string]: unknown;
	id: string;
	brief_id: string;
	format: "shorts" | "longform";
	content_json: Record<string, unknown>;
	version: number;
	status: string;
	rejection_reason: string;
	reference_template_id?: string | null;
	created_at: string;
}

export interface ReferenceTemplate {
	[key: string]: unknown;
	id: string;
	channel_id: string;
	name: string;
	source_type: "youtube" | "file" | "manual";
	source_url: string;
	source_title: string;
	source_creator: string;
	thumbnail_url: string;
	duration_seconds: number;

	dominant_colors: string[];
	visual_mood: "horror" | "mystery" | "news" | "neutral" | "warm";
	visual_prompt_template: string;
	lighting_style: "dark" | "natural" | "bright" | "mixed";

	subtitle_position: "top" | "center" | "bottom" | "dynamic";
	subtitle_size_preset: "xs" | "sm" | "md" | "lg" | "xl";
	subtitle_bg_style: "none" | "pill" | "block" | "stroke" | "glow";
	subtitle_accent_color: string;

	scene_count: number;
	avg_scene_duration: number;
	hook_duration: number;
	transition_style: "hardcut" | "crossfade" | "zoom" | "mixed";
	pacing_preset: "fast" | "medium" | "slow";

	tts_voice_id: string;
	tts_provider: "openai" | "elevenlabs";
	tts_speed: number;
	tts_tone_keywords: string[];

	bgm_mood: string;
	bgm_keywords: string[];
	bgm_tempo: "slow" | "mid" | "fast";
	bgm_reference_url: string;
	/** 실측 BPM (Web Audio onset detection, 0 = 미분석) */
	bgm_bpm?: number;
	/** 실측 비트 타임스탬프 (초) */
	bgm_beats?: number[];
	bgm_bpm_confidence?: number;

	hook_pattern: "question" | "shock" | "claim" | "story" | "";
	script_structure: Array<{ role: string; duration: number; note: string }>;

	transcript: string;
	frame_urls: string[];
	raw_analysis: Record<string, unknown>;

	analysis_status: "pending" | "analyzing" | "complete" | "failed";
	analysis_error: string;

	created_at: string;
	updated_at: string;
}

export interface Scene {
	[key: string]: unknown;
	id: string;
	script_id: string;
	order_index: number;
	narration_text: string;
	scene_type: "image" | "video" | "text_emphasis" | "news_overlay";
	visual_prompt: string;
	duration_seconds: number;
	source_index?: number;
	source_url?: string;
	news_title?: string;
	news_source?: string;
	news_excerpt?: string;
	news_date?: string;
	shots?: SceneShot[];
	word_timings?: Array<{ word: string; startFrame: number; endFrame: number }>;
	motion_graphics?: MotionGraphicSpec[];
	color_grade?:
		| "none"
		| "teal-orange"
		| "warm-film"
		| "cold-noir"
		| "vibrant-pop"
		| "muted-doc"
		| "retro-vhs"
		| "cinematic-bleach"
		| "sunset-glow"
		| "arctic"
		| "k-drama-soft"
		| "true-crime-noir"
		| "nature-doc";
	transition?:
		| "crossfade"
		| "zoom"
		| "zoom_punch"
		| "light_leak"
		| "slide_left"
		| "slide_right"
		| "push_left"
		| "push_right"
		| "glitch"
		| "whip_left"
		| "whip_right"
		| "none";
	mood?: "horror" | "mystery" | "news" | "neutral" | "warm";
	text_effect?: "typewriter" | "glitch" | "scale_in" | "none";
	start_frame?: number;
	edit_keyframes?: {
		sourceIn?: number;
		sourceOut?: number;
		speed?: number;
		volume?: number;
		opacity?: number;
		scale?: number;
		volumeEnvelope?: unknown;
		transformKeyframes?: unknown;
	};
	created_at: string;
}

export interface MediaAsset {
	[key: string]: unknown;
	id: string;
	scene_id: string;
	type: "image" | "video" | "tts_audio" | "bgm" | "subtitle";
	storage_path: string;
	generation_params: Record<string, unknown>;
	status: string;
	created_at: string;
}

export interface Render {
	[key: string]: unknown;
	id: string;
	script_id: string;
	format: "shorts" | "longform";
	aspect_ratio: string;
	storage_path: string;
	duration_seconds: number;
	status: string;
	qc_result_json: Record<string, unknown>;
	created_at: string;
}

export interface Approval {
	[key: string]: unknown;
	id: string;
	render_id: string;
	status: "pending" | "approved" | "rejected";
	rejection_reason: string;
	rejection_scope: string;
	reviewed_at: string | null;
}

export interface ChannelMember {
	[key: string]: unknown;
	id: string;
	channel_id: string;
	user_id: string | null;
	email: string;
	role: "owner" | "editor" | "viewer";
	invited_by: string | null;
	invited_at: string;
	accepted_at: string | null;
}

export interface Upload {
	[key: string]: unknown;
	id: string;
	render_id: string;
	youtube_video_id: string;
	tiktok_video_id: string | null;
	instagram_media_id: string | null;
	platform: "youtube" | "tiktok" | "instagram" | null;
	title: string;
	description: string;
	tags: string[];
	thumbnail_path: string;
	playlist: string;
	scheduled_at: string | null;
	published_at: string | null;
	status: string;
	created_at: string;
}

export interface Analytics {
	[key: string]: unknown;
	id: string;
	upload_id: string;
	views: number;
	ctr: number;
	avg_watch_duration: number;
	likes: number;
	comments: number;
	subscribers_gained: number;
	fetched_at: string;
}
