/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  VIDEO TYPOGRAPHY — 영상 자막/글씨체 단일 소스 오브 트루스
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 쇼츠(9:16)·롱폼(16:9) 영상 제작 파이프라인 전체에서 쓰는 모든 텍스트 스타일
 * (자막 크기, 글씨체, 굵기, 색, 외곽선/그림자)을 이 파일 하나에 모아 관리한다.
 *
 * WHY: 이전에는 자막 프리셋(DEFAULT_SUBTITLE/SHORTS_SUBTITLE, 5개 필드)만 부분적으로
 *      중앙화돼 있었고, 나머지 20여 개 폰트 크기·6가지 글씨체 문자열·모든 외곽선/그림자가
 *      Scene.tsx / cards / motion / overlays / captions 곳곳에 하드코딩돼 있었다.
 *      → 크기를 바꾸려면 여러 파일을 뒤져야 했고, 포맷별 일관성 보장이 불가능했다.
 *
 * 원칙: 여기 값들은 "제작 시점에 실제로 렌더되던 값"을 그대로 옮긴 것이다(무회귀).
 *      크기를 조정하고 싶으면 **이 파일만** 고치면 전 파이프라인에 반영된다.
 *
 * 포맷 판정: resolveVideoFormat(width, height) — 세로가 길면 'shorts', 아니면 'longform'.
 *           (isVertical(w,h) 과 동일 기준. Scene.tsx 의 `vertical` 불리언과 1:1 대응)
 *
 * @AX:ANCHOR 이 모듈은 영상 텍스트 스타일의 유일한 소스다. 값 변경은 곧 렌더 결과 변경.
 * @AX:REASON captions/cards/motion/overlays/Scene/reference-bridge 6+ 모듈이 여기서 import.
 */

// ─── 포맷 ───
export type VideoFormat = "shorts" | "longform";

/** width/height 로 포맷 판정 (isVertical 과 동일 기준). Scene 의 `vertical` = (format==='shorts') */
export function resolveVideoFormat(width: number, height: number): VideoFormat {
	return height > width ? "shorts" : "longform";
}

/** 포맷별 두 값 중 하나를 고르는 헬퍼 (shorts=세로) */
export function pickByFormat<T>(
	format: VideoFormat,
	values: { shorts: T; longform: T },
): T {
	return format === "shorts" ? values.shorts : values.longform;
}

// ─── 글씨체 스택 (반복되던 문자열을 명명 상수로) ───
//
// 주의: `sans` 와 `sansCompact` 는 `-apple-system` 유무만 다르다(과거 코드의 우연한 불일치).
//       무회귀를 위해 지금은 둘 다 유지한다. 통일하려면 여기서 한 줄만 바꾸면 된다.
export const FONT_STACKS = {
	/** 자막·뉴스 라벨 기본 (Noto Sans KR + apple-system) */
	sans: "'Noto Sans KR', -apple-system, sans-serif",
	/** 카드·모션그래픽·로워서드 (apple-system 없음) */
	sansCompact: "'Noto Sans KR', sans-serif",
	/** 핫클립 숏폼 템플릿 본문 (Apple SD Gothic Neo 우선) */
	gothic: "'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
	/** 핫클립 큰 명조 헤드라인 */
	serifHeadline:
		"'AppleMyungjo', 'Hiragino Mincho ProN', 'Nanum Myeongjo', serif",
	/** 인용문(QuoteBubble) 세리프 */
	serifQuote: "'Noto Sans KR', serif",
	/** 손글씨 (style-bridge handwriting) */
	handwriting: "'Nanum Pen Script', cursive, sans-serif",
} as const;

// ─── 자막(SubtitleStyle) — 예전 types.ts 에서 이관 ───
export interface SubtitleStyle {
	fontSize?: number;
	emphasisFontSize?: number;
	fontFamily?: string;
	fontWeight?: number;
	color?: string;
}

/** 자막 기본 색 (흰색) */
export const CAPTION_COLOR = "#ffffff";
/** 강조/키워드 하이라이트 색 (골드) — Composition subtitleAccentColor 기본값과 동일 */
export const CAPTION_ACCENT_COLOR = "#FFD700";

/** 포맷별 자막 굵기 */
export const CAPTION_WEIGHT: Record<VideoFormat, number> = {
	longform: 600,
	shorts: 700,
};

/**
 * 자막 크기 스케일 (xs~xl). 각 프리셋은 {longform 본문/강조, shorts 본문/강조} px.
 * — reference-bridge.ts 의 SIZE_FONT_MAP 이 여기서 파생된다.
 * — md 가 DEFAULT_SUBTITLE / SHORTS_SUBTITLE 의 값과 일치(기본 프리셋).
 */
export const CAPTION_SIZE_SCALE = {
	xs: { longform: 32, longformEmphasis: 52, shorts: 40, shortsEmphasis: 64 },
	sm: { longform: 40, longformEmphasis: 64, shorts: 48, shortsEmphasis: 76 },
	md: { longform: 46, longformEmphasis: 76, shorts: 56, shortsEmphasis: 88 },
	lg: { longform: 56, longformEmphasis: 88, shorts: 68, shortsEmphasis: 104 },
	xl: { longform: 68, longformEmphasis: 104, shorts: 84, shortsEmphasis: 128 },
} as const;

export type CaptionSizePreset = keyof typeof CAPTION_SIZE_SCALE;
export const DEFAULT_CAPTION_SIZE_PRESET: CaptionSizePreset = "md";

/**
 * 포맷 + 크기 프리셋 → 완성된 자막 스타일.
 * 영상 제작 시 이 함수 하나로 자막 크기/글씨체/굵기/색이 결정된다.
 */
export function captionStyleFor(
	format: VideoFormat,
	preset: CaptionSizePreset = DEFAULT_CAPTION_SIZE_PRESET,
): Required<SubtitleStyle> {
	const scale = CAPTION_SIZE_SCALE[preset] ?? CAPTION_SIZE_SCALE.md;
	const isShorts = format === "shorts";
	return {
		fontSize: isShorts ? scale.shorts : scale.longform,
		emphasisFontSize: isShorts ? scale.shortsEmphasis : scale.longformEmphasis,
		fontFamily: FONT_STACKS.sans,
		fontWeight: CAPTION_WEIGHT[format],
		color: CAPTION_COLOR,
	};
}

/** 롱폼(16:9) 기본 자막 — Composition merge 의 base 이기도 하다. (md 롱폼: 46/76, w600) */
export const DEFAULT_SUBTITLE: Required<SubtitleStyle> =
	captionStyleFor("longform");

/** 숏폼(9:16) 기본 자막 — 글씨가 더 커야 함. (md 숏폼: 56/88, w700) */
export const SHORTS_SUBTITLE: Required<SubtitleStyle> =
	captionStyleFor("shorts");

// ─── 자막 외곽선/그림자 프리셋 (KaraokeCaption + ChunkedCaption bgStyle) ───
//
// 자막은 배경 위 가독성을 위해 외곽선(WebkitTextStroke)+다층 그림자(textShadow)를 쓴다.
// getWordEffect(bgStyle) 이 여기서 값을 읽는다. glow 는 accentColor 를 받는 함수.
export const CAPTION_EFFECTS = {
	/** KaraokeCaption 라인 전체 기본 외곽선/그림자 */
	karaoke: {
		stroke: "1.5px rgba(0,0,0,0.8)",
		textShadow:
			"0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.6)",
	},
	/** bgStyle="stroke" — 얇은 외곽선 + 근/원 그림자 (활성/비활성) */
	stroke: {
		stroke: "1.5px rgba(0,0,0,0.9)",
		shadowActive:
			"0 1px 0 rgba(0,0,0,0.76), 0 2px 6px rgba(0,0,0,0.56), 0 5px 14px rgba(0,0,0,0.28)",
		shadowInactive: "0 1px 0 rgba(0,0,0,0.62), 0 2px 4px rgba(0,0,0,0.46)",
	},
	/** bgStyle="glow" — 액센트 글로우 + 깊이 그림자 */
	glow: {
		stroke: "1.5px rgba(0,0,0,0.9)",
		shadow: (accentColor: string): string =>
			`0 0 6px ${accentColor}66, 0 0 14px ${accentColor}33, 0 2px 6px rgba(0,0,0,0.76)`,
	},
	/** bgStyle="ticker"|"spotlight" — 얇은 외곽선 + 3층 그림자 */
	ticker: {
		stroke: "1px rgba(0,0,0,0.9)",
		textShadow:
			"0 1px 0 rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3)",
	},
	/** 기본(none/pill/block) — 중간 외곽선 + 근/원 그림자 (활성/비활성) */
	default: {
		stroke: "1.5px rgba(0,0,0,0.85)",
		shadowActive:
			"0 1px 0 rgba(0,0,0,0.62), 0 2px 5px rgba(0,0,0,0.52), 0 4px 10px rgba(0,0,0,0.24)",
		shadowInactive: "0 1px 0 rgba(0,0,0,0.48), 0 2px 4px rgba(0,0,0,0.38)",
	},
} as const;

// ─── 시네마틱 강조 단어 (Scene.tsx CinematicTextEmphasis) ───
//
// 리드/포커스 단어 크기는 자막 강조 크기(emphasisFontSize)의 배수로 계산된다.
// 포맷별로 배수가 다르다(숏폼이 조금 더 큼).
export const FOCUS_WORD_SCALE = {
	/** 리드(부제) 단어 배수 */
	lead: { shorts: 0.46, longform: 0.42 },
	/** 스택 레이아웃일 때 포커스 단어 배수 */
	focusStacked: { shorts: 0.78, longform: 0.7 },
	/** 단독 레이아웃일 때 포커스 단어 배수 */
	focusSolo: { shorts: 0.92, longform: 0.86 },
} as const;

export const FOCUS_WORD_WEIGHT = {
	lead: 690,
	/** 일반 포커스 단어 굵기 */
	focus: 830,
	/** 훅(첫 10초) 구간 포커스 단어 굵기 */
	focusHook: 900,
} as const;

/** 리드 단어 기본색(비활성) */
export const FOCUS_WORD_LEAD_BASE_COLOR = "rgba(235, 238, 244, 0.84)";
/** 시네마틱 강조 타이틀 블록 그림자 */
export const FOCUS_WORD_TITLE_SHADOW =
	"0 9px 34px rgba(0,0,0,0.78), 0 1px 2px rgba(0,0,0,0.9)";

// ─── 뉴스/시네마틱 라벨 (Scene.tsx) ───
export const NEWS_TEXT = {
	/** 카테고리 큐 칩 (대문자 pill) */
	label: {
		fontSize: { shorts: 17, longform: 18 },
		fontFamily: FONT_STACKS.sans,
		fontWeight: 820,
	},
	/** 출처/날짜 메타 행 */
	source: {
		fontSize: { shorts: 16, longform: 17 },
		fontFamily: FONT_STACKS.sans,
		fontWeight: 650,
		color: "rgba(229, 231, 235, 0.82)",
		textShadow: "0 2px 10px rgba(0,0,0,0.8)",
	},
	/** 뉴스 카드 제목 크기 (cardTheme 와 병용; 글씨체는 sans 로 오버라이드) */
	title: {
		fontSize: { shorts: 36, longform: 42 },
		fontFamily: FONT_STACKS.sans,
	},
} as const;

// ─── 카드 (TitleCard / EndCard) ───
export const CARD_TEXT = {
	/** 상단 채널명 (대문자, 흐림) */
	channel: {
		fontSize: 18,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 500,
		color: "rgba(255,255,255,0.6)",
	},
	/** 메인 제목 h1 — width*0.035, 최대 64px 로 반응형 */
	title: {
		fontSizeMax: 64,
		fontSizeWidthFactor: 0.035,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 900,
		color: "#ffffff",
		textShadow: "0 4px 30px rgba(0,0,0,0.6)",
	},
	/** 부제 p */
	subtitle: {
		fontSize: 24,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 400,
		color: "rgba(255,255,255,0.7)",
	},
} as const;

export const END_CARD_TEXT = {
	/** 채널명 (대문자, 흐림) */
	channel: {
		fontSize: 20,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 500,
		color: "rgba(255,255,255,0.5)",
	},
	/** CTA 본문 h2 */
	cta: {
		fontSize: 48,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 800,
		color: "#ffffff",
		textShadow: "0 2px 20px rgba(0,0,0,0.5)",
	},
	/** 구독 버튼 라벨 */
	subscribeButton: {
		fontSize: 22,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 700,
		color: "#ffffff",
	},
} as const;

// ─── 모션그래픽 오버레이 ───
//
// 참고: NumberCounter.fontSize / 색은 인스턴스 param 으로 오버라이드 가능(여기 값은 기본).
//       ArrowCallout(SVG viewBox 유저단위 2.8)·EmojiBurst(랜덤 파티클 크기)는 픽셀 타이포가
//       아니므로 의도적으로 제외한다.
export const MOTION_TEXT = {
	/** QuoteBubble 인용문 본문 */
	quote: {
		fontSize: 42,
		fontFamily: FONT_STACKS.serifQuote,
		fontWeight: 700,
		color: "#111",
	},
	/** QuoteBubble 화자 표기 (— speaker) */
	quoteSpeaker: {
		fontSize: 22,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 600,
		color: "#666",
	},
	/** ProgressBar 좌측 라벨 */
	progressLabel: {
		fontSize: 36,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 700,
		color: "#fff",
		textShadow: "0 2px 8px rgba(0,0,0,0.8)",
	},
	/** ProgressBar 퍼센트 값 (색은 param.color) */
	progressValue: {
		fontSize: 52,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 900,
	},
	/** LowerThirdV2 제목 */
	lowerThirdTitle: {
		fontSize: 44,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 800,
		color: "#fff",
	},
	/** LowerThirdV2 부제 (대문자, 색은 param.accent) */
	lowerThirdSubtitle: {
		fontSize: 24,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 500,
	},
	/** NumberCounter 큰 숫자 (기본값; param 으로 크기/색 오버라이드 가능) */
	numberCounter: {
		fontSize: 140,
		fontFamily: FONT_STACKS.sansCompact,
		fontWeight: 900,
		color: CAPTION_ACCENT_COLOR,
		stroke: "2px rgba(0,0,0,0.9)",
		textShadow: "0 4px 16px rgba(0,0,0,0.9), 0 0 24px rgba(255,215,0,0.4)",
	},
} as const;

/** 로워서드 오버레이(overlays/LowerThird)의 글씨체 (크기/색은 getLowerThirdTheme 테마 소관) */
export const LOWER_THIRD_FONT_FAMILY = FONT_STACKS.sansCompact;

// ─── 핫클립 숏폼 템플릿 (Scene.tsx, 쇼츠 전용 고정 픽셀 레이아웃) ───
export const HOTCLIP_TEXT = {
	/** 루트 글씨체 (자식들이 상속) */
	rootFontFamily: FONT_STACKS.gothic,
	/** 큰 명조 제목 (첫 줄/이후 줄 크기 다름) */
	title: {
		fontSizeFirst: 76,
		fontSizeRest: 82,
		fontFamily: FONT_STACKS.serifHeadline,
		fontWeight: 900,
		color: "#050505",
	},
	/** 훅 pill */
	hookPill: { fontSize: 25, fontWeight: 760, color: "#fff" },
	/** 코너 배지 (핫클립) */
	badge: { fontSize: 27, fontWeight: 950, color: "#ed1b3a" },
	/** 미디어 캡션 오버레이 (색은 계산값) */
	caption: {
		fontSize: 55,
		fontWeight: 930,
		textShadow: "0 4px 0 rgba(0,0,0,0.86), 0 0 18px rgba(0,0,0,0.72)",
	},
	/** 채널 아바타 글리프(♪) */
	handleAvatar: { fontSize: 34, fontWeight: 950, color: "#fff" },
	/** 채널 핸들 텍스트 */
	handle: { fontSize: 30, fontWeight: 900, color: "#111" },
	/** 구독 버튼 */
	subscribeCta: { fontSize: 29, fontWeight: 900, color: "#111" },
} as const;
