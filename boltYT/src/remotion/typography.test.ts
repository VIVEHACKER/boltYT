import { describe, expect, it } from "vitest";
import {
	CAPTION_ACCENT_COLOR,
	CAPTION_EFFECTS,
	CAPTION_SIZE_SCALE,
	CAPTION_WEIGHT,
	CARD_TEXT,
	captionStyleFor,
	DEFAULT_SUBTITLE,
	END_CARD_TEXT,
	FOCUS_WORD_SCALE,
	FOCUS_WORD_WEIGHT,
	FONT_STACKS,
	HOTCLIP_TEXT,
	MOTION_TEXT,
	NEWS_TEXT,
	pickByFormat,
	resolveVideoFormat,
	SHORTS_SUBTITLE,
} from "./typography";

/**
 * 이 테스트는 영상 타이포 값들의 "회귀 방지 잠금"이다.
 * 여기 숫자/문자열은 typography.ts 로 중앙화되기 전 실제 렌더되던 값과 동일해야 한다.
 * 값을 의도적으로 바꾸면(디자인 튜닝) 이 테스트도 함께 갱신할 것.
 */

describe("resolveVideoFormat", () => {
	it("16:9 롱폼", () => {
		expect(resolveVideoFormat(1920, 1080)).toBe("longform");
	});
	it("9:16 숏폼", () => {
		expect(resolveVideoFormat(1080, 1920)).toBe("shorts");
	});
	it("정사각형은 롱폼으로(세로가 더 길지 않음)", () => {
		expect(resolveVideoFormat(1080, 1080)).toBe("longform");
	});
});

describe("pickByFormat", () => {
	it("포맷별 선택", () => {
		expect(pickByFormat("shorts", { shorts: 1, longform: 2 })).toBe(1);
		expect(pickByFormat("longform", { shorts: 1, longform: 2 })).toBe(2);
	});
});

describe("captionStyleFor / 자막 프리셋", () => {
	it("롱폼 md = DEFAULT_SUBTITLE (46/76, w600)", () => {
		expect(captionStyleFor("longform")).toEqual({
			fontSize: 46,
			emphasisFontSize: 76,
			fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
			fontWeight: 600,
			color: "#ffffff",
		});
		expect(DEFAULT_SUBTITLE).toEqual(captionStyleFor("longform"));
	});

	it("숏폼 md = SHORTS_SUBTITLE (56/88, w700)", () => {
		expect(captionStyleFor("shorts")).toEqual({
			fontSize: 56,
			emphasisFontSize: 88,
			fontFamily: "'Noto Sans KR', -apple-system, sans-serif",
			fontWeight: 700,
			color: "#ffffff",
		});
		expect(SHORTS_SUBTITLE).toEqual(captionStyleFor("shorts"));
	});

	it("크기 프리셋 xs~xl (reference-bridge 호환)", () => {
		// reference-bridge.test 가 기대하는 값과 일치해야 함
		expect(captionStyleFor("shorts", "xs").fontSize).toBe(40);
		expect(captionStyleFor("shorts", "xs").emphasisFontSize).toBe(64);
		expect(captionStyleFor("shorts", "xl").fontSize).toBe(84);
		expect(captionStyleFor("shorts", "xl").emphasisFontSize).toBe(128);
		expect(captionStyleFor("longform", "xs").fontSize).toBe(32);
		expect(captionStyleFor("longform", "xl").fontSize).toBe(68);
	});

	it("알 수 없는 프리셋은 md 로 폴백", () => {
		// @ts-expect-error 런타임 안전성 확인
		expect(captionStyleFor("longform", "zz")).toEqual(
			captionStyleFor("longform", "md"),
		);
	});
});

describe("CAPTION_SIZE_SCALE (스케일 잠금)", () => {
	it("전체 표", () => {
		expect(CAPTION_SIZE_SCALE).toEqual({
			xs: {
				longform: 32,
				longformEmphasis: 52,
				shorts: 40,
				shortsEmphasis: 64,
			},
			sm: {
				longform: 40,
				longformEmphasis: 64,
				shorts: 48,
				shortsEmphasis: 76,
			},
			md: {
				longform: 46,
				longformEmphasis: 76,
				shorts: 56,
				shortsEmphasis: 88,
			},
			lg: {
				longform: 56,
				longformEmphasis: 88,
				shorts: 68,
				shortsEmphasis: 104,
			},
			xl: {
				longform: 68,
				longformEmphasis: 104,
				shorts: 84,
				shortsEmphasis: 128,
			},
		});
	});
	it("포맷별 굵기", () => {
		expect(CAPTION_WEIGHT).toEqual({ longform: 600, shorts: 700 });
	});
});

describe("글씨체 스택", () => {
	it("명명 상수 값", () => {
		expect(FONT_STACKS.sans).toBe("'Noto Sans KR', -apple-system, sans-serif");
		expect(FONT_STACKS.sansCompact).toBe("'Noto Sans KR', sans-serif");
		expect(FONT_STACKS.gothic).toBe(
			"'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
		);
		expect(FONT_STACKS.serifHeadline).toBe(
			"'AppleMyungjo', 'Hiragino Mincho ProN', 'Nanum Myeongjo', serif",
		);
		expect(FONT_STACKS.serifQuote).toBe("'Noto Sans KR', serif");
	});
});

describe("자막 외곽선/그림자 프리셋 (회귀 잠금)", () => {
	it("karaoke", () => {
		expect(CAPTION_EFFECTS.karaoke.stroke).toBe("1.5px rgba(0,0,0,0.8)");
		expect(CAPTION_EFFECTS.karaoke.textShadow).toBe(
			"0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.6)",
		);
	});
	it("stroke bgStyle", () => {
		expect(CAPTION_EFFECTS.stroke.stroke).toBe("1.5px rgba(0,0,0,0.9)");
		expect(CAPTION_EFFECTS.stroke.shadowActive).toBe(
			"0 1px 0 rgba(0,0,0,0.76), 0 2px 6px rgba(0,0,0,0.56), 0 5px 14px rgba(0,0,0,0.28)",
		);
		expect(CAPTION_EFFECTS.stroke.shadowInactive).toBe(
			"0 1px 0 rgba(0,0,0,0.62), 0 2px 4px rgba(0,0,0,0.46)",
		);
	});
	it("glow 는 accentColor 를 받는 함수", () => {
		expect(CAPTION_EFFECTS.glow.stroke).toBe("1.5px rgba(0,0,0,0.9)");
		expect(CAPTION_EFFECTS.glow.shadow("#FFD700")).toBe(
			"0 0 6px #FFD70066, 0 0 14px #FFD70033, 0 2px 6px rgba(0,0,0,0.76)",
		);
	});
	it("ticker / default", () => {
		expect(CAPTION_EFFECTS.ticker.stroke).toBe("1px rgba(0,0,0,0.9)");
		expect(CAPTION_EFFECTS.default.stroke).toBe("1.5px rgba(0,0,0,0.85)");
	});
});

describe("시네마틱 강조 단어 스케일", () => {
	it("배수/굵기", () => {
		expect(FOCUS_WORD_SCALE.lead).toEqual({ shorts: 0.46, longform: 0.42 });
		expect(FOCUS_WORD_SCALE.focusStacked).toEqual({
			shorts: 0.78,
			longform: 0.7,
		});
		expect(FOCUS_WORD_SCALE.focusSolo).toEqual({
			shorts: 0.92,
			longform: 0.86,
		});
		expect(FOCUS_WORD_WEIGHT).toEqual({
			lead: 690,
			focus: 830,
			focusHook: 900,
		});
	});
});

describe("요소별 텍스트 토큰 (핵심 크기 잠금)", () => {
	it("뉴스 라벨/출처/제목", () => {
		expect(NEWS_TEXT.label.fontSize).toEqual({ shorts: 17, longform: 18 });
		expect(NEWS_TEXT.source.fontSize).toEqual({ shorts: 16, longform: 17 });
		expect(NEWS_TEXT.title.fontSize).toEqual({ shorts: 36, longform: 42 });
	});
	it("카드", () => {
		expect(CARD_TEXT.title.fontSizeMax).toBe(64);
		expect(CARD_TEXT.title.fontSizeWidthFactor).toBe(0.035);
		expect(CARD_TEXT.subtitle.fontSize).toBe(24);
		expect(END_CARD_TEXT.cta.fontSize).toBe(48);
	});
	it("모션그래픽", () => {
		expect(MOTION_TEXT.quote.fontSize).toBe(42);
		expect(MOTION_TEXT.progressValue.fontSize).toBe(52);
		expect(MOTION_TEXT.numberCounter.fontSize).toBe(140);
		expect(MOTION_TEXT.numberCounter.color).toBe(CAPTION_ACCENT_COLOR);
	});
	it("핫클립 숏폼 템플릿", () => {
		expect(HOTCLIP_TEXT.title.fontSizeFirst).toBe(76);
		expect(HOTCLIP_TEXT.title.fontSizeRest).toBe(82);
		expect(HOTCLIP_TEXT.caption.fontSize).toBe(55);
		expect(HOTCLIP_TEXT.handle.fontSize).toBe(30);
		expect(HOTCLIP_TEXT.rootFontFamily).toBe(FONT_STACKS.gothic);
	});
});
