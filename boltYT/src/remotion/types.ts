import type { SceneShot } from "../lib/scene-shot-types";

// ─── Transition ───
export type TransitionType =
	| "crossfade"
	| "zoom"
	| "slide_left"
	| "slide_right"
	| "glitch"
	| "whip_left"
	| "whip_right"
	| "none";

/** 트랜지션 타입별 기본 프레임 수 */
export const TRANSITION_FRAMES: Record<TransitionType, number> = {
	crossfade: 22,
	zoom: 20,
	slide_left: 18,
	slide_right: 18,
	glitch: 8,
	whip_left: 12,
	whip_right: 12,
	none: 0,
};

// ─── Mood / Color Grading ───
export type SceneMood = "horror" | "mystery" | "news" | "neutral" | "warm";

// ─── Text Effects ───
export type TextEffect = "typewriter" | "glitch" | "scale_in" | "none";

// ─── Caption Style ───
export type CaptionStyle = "karaoke" | "chunked" | "none";

// ─── Layout ───
export type LayoutVariant = "full" | "split" | "letterbox";

// ─── Subtitle ───
export interface SubtitleStyle {
	fontSize?: number;
	emphasisFontSize?: number;
	fontFamily?: string;
	fontWeight?: number;
	color?: string;
}

export const DEFAULT_SUBTITLE: Required<SubtitleStyle> = {
	fontSize: 46,
	emphasisFontSize: 76,
	fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
	fontWeight: 600,
	color: "#ffffff",
};

/** 숏폼(9:16)은 글씨가 더 커야 함 */
export const SHORTS_SUBTITLE: Required<SubtitleStyle> = {
	fontSize: 56,
	emphasisFontSize: 88,
	fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
	fontWeight: 700,
	color: "#ffffff",
};

// ─── Word Timing ───
export interface WordTiming {
	word: string;
	/** 씬 내 시작 프레임 */
	startFrame: number;
	/** 씬 내 끝 프레임 */
	endFrame: number;
}

// ─── Motion Graphics ───
export type MotionGraphicType =
	| "number_counter"
	| "lower_third"
	| "progress_bar"
	| "arrow_callout"
	| "quote_bubble"
	| "emoji_burst";

export interface MotionGraphicSpec {
	type: MotionGraphicType;
	startFrame: number;
	duration: number;
	params: Record<string, unknown>;
}

// ─── Scene ───
export interface RemotionScene {
	imageUrl: string;
	videoUrl?: string;
	audioUrl: string;
	narration: string;
	durationInFrames: number;
	type: "image" | "video" | "text_emphasis" | "news_overlay";

	/** 카라오케 자막용 단어별 타이밍 */
	wordTimings?: WordTiming[];

	// 뉴스 오버레이 전용
	newsTitle?: string;
	newsSource?: string;
	newsExcerpt?: string;
	newsDate?: string;
	shots?: SceneShot[];

	// ─── v2: 프리미엄 업그레이드 필드 ───
	/** 다음 씬으로의 전환 효과 */
	transition?: TransitionType;
	/** 씬 분위기 (색보정/파티클에 영향) */
	mood?: SceneMood;
	/** text_emphasis 전용 텍스트 애니메이션 */
	textEffect?: TextEffect;
	/** 레이아웃 변형 */
	layout?: LayoutVariant;
	/** 출처 표시 (로워서드) */
	sourceAttribution?: string;
	/** true면 저해상도 뉴스 사진 → 블러배경+프레임 모드. false/undefined면 풀스크린 Ken Burns */
	isNewsPhoto?: boolean;
	/** 첫 10초 훅 구간 여부 */
	hookBoost?: boolean;
	/** 씬 시작 효과음 (public/sfx/ 파일 경로) */
	enterSfxFile?: string;
	enterSfxVolume?: number;
	enterSfxFromFrame?: number;
	enterSfxDurationFrames?: number;
	/** 트랜지션 효과음 */
	transitionSfxFile?: string;
	transitionSfxVolume?: number;
	transitionSfxFromFrame?: number;
	transitionSfxDurationFrames?: number;

	// ─── v2.5: Scene Director 촬영 지시 필드 ───
	/** 샷 타입 (planSceneDirectives 결과) */
	shot_type?: "wide" | "medium" | "close_up" | "extreme_close" | "aerial";
	/** 카메라 무브 */
	camera_motion?:
		| "static"
		| "slow_pan"
		| "zoom_in"
		| "zoom_out"
		| "handheld"
		| "tilt_up"
		| "tilt_down";
	/** BGM 무드 */
	bgm_mood?:
		| "tension"
		| "mysterious"
		| "sad"
		| "neutral"
		| "hopeful"
		| "horror";
	/** 씬 페이싱 */
	pacing?: "slow" | "normal" | "fast";

	// ─── v3: 프로 에디터급 업그레이드 ───
	/** 모션 그래픽 오버레이 (숫자 카운터, 로워서드 등) */
	motionGraphics?: MotionGraphicSpec[];
	/** LUT 색보정 프리셋 (V1 호환) */
	colorGrade?:
		| "none"
		| "teal-orange"
		| "warm-film"
		| "cold-noir"
		| "vibrant-pop"
		| "muted-doc"
		| "retro-vhs";
	/** 3-way 색보정 전체 스펙 (V2 타임라인 — preset + temp/tint/sat/lift/gamma/gain) */
	colorGradeSpec?: import("../lib/timeline-model").ColorGradeSpec;
	/** ColorGraph → CSS filter 컴파일 결과 (V2 타임라인 노드 그래프) */
	colorGraphCss?: string;
	/** Phase 6 transform 보간 — 로컬 Scene 프레임 기준 */
	transformKeyframes?: import("../lib/timeline-model").TransformKeyframes;
}

export interface VideoCompositionProps {
	scenes: RemotionScene[];
	fps: number;
}

export const VIDEO_FPS = 30;

// 롱폼 16:9
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

// 숏폼 9:16
export const SHORTS_WIDTH = 1080;
export const SHORTS_HEIGHT = 1920;

/** 현재 컴포지션이 세로형(쇼츠)인지 판단 */
export function isVertical(width: number, height: number): boolean {
	return height > width;
}

/**
 * 쇼츠 safe area 마진 (px)
 * — 모바일 UI 요소(댓글, 좋아요 버튼 등)와 겹치지 않도록
 */
export const SHORTS_SAFE_AREA = {
	top: 80,
	bottom: 160,
	left: 24,
	right: 24,
} as const;
