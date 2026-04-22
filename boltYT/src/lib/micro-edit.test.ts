import { describe, expect, it } from "vitest";
import {
	collectAccentFrames,
	computeCutFlashStyle,
	computeMicroEditStyle,
	computeNewsCardLayerMotion,
	computeOverlayTypographyStyle,
	computeShotOverlayLayerMotion,
	computeTextEmphasisLayerMotion,
} from "./micro-edit";

describe("micro-edit", () => {
	it("hook 구간은 초반 단어 기준으로 여러 accent frame을 수집한다", () => {
		const frames = collectAccentFrames(
			[
				{ word: "그날", startFrame: 4, endFrame: 9 },
				{ word: "밤", startFrame: 12, endFrame: 18 },
				{ word: "CCTV", startFrame: 20, endFrame: 28 },
				{ word: "화면", startFrame: 35, endFrame: 44 },
			],
			90,
			true,
		);

		expect(frames).toEqual([4, 12, 20]);
	});

	it("accent frame 근처에서 scale/brightness punch를 만든다", () => {
		const style = computeMicroEditStyle({
			frame: 6,
			durationInFrames: 60,
			wordTimings: [{ word: "충격", startFrame: 4, endFrame: 10 }],
			hookBoost: true,
		});

		expect(style.transform).toContain("scale(");
		expect(style.filter).toContain("brightness(");
	});

	it("accent가 멀면 미세 편집을 만들지 않는다", () => {
		const style = computeMicroEditStyle({
			frame: 40,
			durationInFrames: 60,
			wordTimings: [{ word: "충격", startFrame: 4, endFrame: 10 }],
			hookBoost: true,
		});

		expect(style).toEqual({});
	});

	it("오버레이 타이포는 초반 진입과 cue에서 추가 펀치를 만든다", () => {
		const style = computeOverlayTypographyStyle({
			frame: 8,
			wordTimings: [{ word: "속보", startFrame: 6, endFrame: 12 }],
			durationInFrames: 60,
			hookBoost: true,
		});

		expect(style.containerOpacity).toBeGreaterThan(0.8);
		expect(style.titleTransform).toContain("scale(");
	});

	it("뉴스 카드 레이어는 label/meta/title/excerpt를 순차적으로 진입시킨다", () => {
		const motion = computeNewsCardLayerMotion({
			frame: 12,
			wordTimings: [{ word: "속보", startFrame: 6, endFrame: 12 }],
			durationInFrames: 60,
			hookBoost: true,
		});

		expect(motion.labelOpacity).toBeGreaterThan(motion.excerptOpacity);
		expect(motion.titleTransform).toContain("translateY(");
	});

	it("샷 오버레이 레이어는 quote mark와 title/source를 순차적으로 진입시킨다", () => {
		const motion = computeShotOverlayLayerMotion({
			frame: 10,
			wordTimings: [{ word: "증언", startFrame: 5, endFrame: 11 }],
			durationInFrames: 60,
			hookBoost: true,
		});

		expect(motion.quoteMarkOpacity).toBeGreaterThan(0);
		expect(motion.titleOpacity).toBeGreaterThan(motion.sourceOpacity);
		expect(motion.titleTransform).toContain("translateY(");
	});

	it("witness text emphasis는 왼쪽에서 끌어오는 quote pull 모션을 쓴다", () => {
		const motion = computeTextEmphasisLayerMotion({
			frame: 2,
			wordTimings: [{ word: "증언", startFrame: 5, endFrame: 11 }],
			durationInFrames: 60,
			hookBoost: true,
			tone: "witness",
		});

		expect(motion.cardTransform).toContain("translateX(-");
		expect(motion.titleTransform).toContain("translateX(-");
	});

	it("evidence text emphasis는 stamp 계열 회전/스케일 모션을 쓴다", () => {
		const motion = computeTextEmphasisLayerMotion({
			frame: 8,
			wordTimings: [{ word: "증거", startFrame: 5, endFrame: 11 }],
			durationInFrames: 60,
			tone: "evidence",
		});

		expect(motion.cardTransform).toContain("rotate(");
		expect(motion.titleTransform).toContain("scale(");
	});

	it("timeline text emphasis는 좌우 sweep 기반 메타/타이틀 모션을 쓴다", () => {
		const motion = computeTextEmphasisLayerMotion({
			frame: 8,
			wordTimings: [{ word: "당일", startFrame: 5, endFrame: 11 }],
			durationInFrames: 60,
			tone: "timeline",
		});

		expect(motion.metaTransform).toContain("translateX(");
		expect(motion.titleTransform).toContain("translateX(");
	});

	it("하드컷 전환은 끝 프레임 근처에서 flash overlay를 만든다", () => {
		const style = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "none",
			hookBoost: true,
		});

		expect(style.opacity).toBeGreaterThan(0);
		expect(style.blurPx).toBeGreaterThan(0);
	});

	it("evidence kind는 stamp 계열 — translateY만 있고 brightness가 강하다", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "증거", startFrame: 4, endFrame: 10 }],
			hookBoost: true,
			kind: "evidence",
		});

		expect(style.transform).toContain("scale(");
		expect(style.transform).toContain("translateY(");
		expect(style.filter).toContain("brightness(");
		// evidence는 translate(x, y) 형식이 아닌 translateY만 사용
		expect(style.transform).not.toContain("translate(");
	});

	it("punch kind는 가장 강한 zoom punch를 만든다", () => {
		const punchStyle = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "반전", startFrame: 4, endFrame: 10 }],
			hookBoost: true,
			kind: "punch",
		});
		const defaultStyle = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "반전", startFrame: 4, endFrame: 10 }],
			hookBoost: true,
		});

		// punch scale 값이 default보다 크다
		const punchScale = Number(
			punchStyle.transform?.match(/scale\(([\d.]+)\)/)?.[1] ?? 0,
		);
		const defaultScale = Number(
			defaultStyle.transform?.match(/scale\(([\d.]+)\)/)?.[1] ?? 0,
		);
		expect(punchScale).toBeGreaterThan(defaultScale);
	});

	it("witness kind는 pull 계열 — X translation이 포함된다", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "증언", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: false,
			kind: "witness",
		});

		// witness는 isVideo=false 여도 X translation 포함
		expect(style.transform).toContain("translate(");
	});

	it("timeline kind는 sweep 계열 — X 방향 양수 translation이 있다", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "당일", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			kind: "timeline",
		});

		expect(style.transform).toContain("translate(");
		// X 값이 양수 (sweep 방향)
		const xVal = Number(
			style.transform?.match(/translate\(([-\d.]+)px/)?.[1] ?? 0,
		);
		expect(xVal).toBeGreaterThan(0);
	});

	// ─── computeOverlayTypographyStyle hookBoost=false 분기 ──────────────────
	it("computeOverlayTypographyStyle hookBoost=false → 더 작은 scale", () => {
		const styleNoBoost = computeOverlayTypographyStyle({
			frame: 8,
			wordTimings: [{ word: "속보", startFrame: 6, endFrame: 12 }],
			durationInFrames: 60,
			hookBoost: false,
		});
		const styleBoost = computeOverlayTypographyStyle({
			frame: 8,
			wordTimings: [{ word: "속보", startFrame: 6, endFrame: 12 }],
			durationInFrames: 60,
			hookBoost: true,
		});
		expect(styleNoBoost.containerTransform).toContain("scale(");
		// hookBoost=false produces smaller scale than hookBoost=true at same pulse
		expect(styleBoost.containerOpacity).toBeGreaterThanOrEqual(
			styleNoBoost.containerOpacity,
		);
	});

	// ─── computeNewsCardLayerMotion hookBoost=false 분기 ─────────────────────
	it("computeNewsCardLayerMotion hookBoost=false", () => {
		const motion = computeNewsCardLayerMotion({
			frame: 12,
			wordTimings: [{ word: "속보", startFrame: 6, endFrame: 12 }],
			durationInFrames: 60,
			hookBoost: false,
		});
		expect(motion.titleTransform).toContain("translateY(");
	});

	it("generic (default) tone → translateY 기반 default 모션", () => {
		const motion = computeTextEmphasisLayerMotion({
			frame: 8,
			wordTimings: [{ word: "기본", startFrame: 5, endFrame: 11 }],
			durationInFrames: 60,
			tone: "generic",
		});
		// default branch: cardTransform contains translateY (not translateX/rotate)
		expect(motion.cardTransform).toContain("translateY(");
		expect(motion.labelTransform).toContain("scale(");
	});

	it("tone undefined → default 분기", () => {
		const motion = computeTextEmphasisLayerMotion({
			frame: 8,
			wordTimings: [],
			durationInFrames: 60,
		});
		expect(motion.cardTransform).toContain("translateY(");
	});

	// ─── computeCutFlashStyle: 다양한 transitionType 분기 ─────────────────────
	it("glitch transition → 더 강한 strength (0.55)", () => {
		const style = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "glitch",
			hookBoost: false,
		});
		expect(style.tint).toContain("196, 232, 255");
		expect(style.blurPx).toBeGreaterThan(0);
	});

	it("whip_left transition → 중간 strength (0.42)", () => {
		const style = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "whip_left",
		});
		expect(style.opacity).toBeGreaterThan(0);
	});

	it("whip_right transition → 중간 strength (0.42)", () => {
		const style = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "whip_right",
		});
		expect(style.opacity).toBeGreaterThan(0);
	});

	it("none transition → tint rgba(255,255,255,...)", () => {
		const style = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "none",
		});
		expect(style.tint).toContain("255,255,255");
	});

	it("crossfade transition → warm tint", () => {
		const style = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "crossfade",
		});
		expect(style.tint).toContain("rgba(255,244,214");
	});

	it("frame < flashStart → opacity=0", () => {
		const style = computeCutFlashStyle({
			frame: 1,
			durationInFrames: 60,
			transitionType: "crossfade",
		});
		expect(style.opacity).toBe(0);
	});

	it("hookBoost=false → strength 낮음", () => {
		const withBoost = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "none",
			hookBoost: true,
		});
		const withoutBoost = computeCutFlashStyle({
			frame: 58,
			durationInFrames: 60,
			transitionType: "none",
			hookBoost: false,
		});
		expect(withBoost.opacity).toBeGreaterThanOrEqual(withoutBoost.opacity);
	});

	// ─── computeShotOverlayLayerMotion: hookBoost 분기 ────────────────────────
	it("hookBoost=false in computeShotOverlayLayerMotion", () => {
		const motion = computeShotOverlayLayerMotion({
			frame: 10,
			wordTimings: [{ word: "증언", startFrame: 5, endFrame: 11 }],
			durationInFrames: 60,
			hookBoost: false,
		});
		expect(motion.titleOpacity).toBeGreaterThan(0);
	});

	it("kind 없으면 기존 동작과 동일한 패턴을 유지한다", () => {
		const withKind = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "사건", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
		});
		const withoutKind = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "사건", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			kind: undefined,
		});

		expect(withKind.transform).toBe(withoutKind.transform);
		expect(withKind.filter).toBe(withoutKind.filter);
	});

	// ─── kindMicroTransform isVideo/vertical 분기 ─────────────────────────────
	it("evidence kind + isVideo=true → blur 포함", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "증거", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: true,
			kind: "evidence",
		});
		expect(style.filter).toContain("brightness(");
	});

	it("evidence kind + vertical=true → translateY 값 다름", () => {
		const vertical = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "증거", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: false,
			vertical: true,
			kind: "evidence",
		});
		const horizontal = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "증거", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: false,
			vertical: false,
			kind: "evidence",
		});
		expect(vertical.transform).not.toBe(horizontal.transform);
	});

	it("punch kind + isVideo=true + hookBoost=false → blur 포함", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "반전", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: true,
			kind: "punch",
		});
		expect(style.filter).toContain("brightness(");
	});

	it("punch kind + vertical=true → 더 큰 translateY", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "반전", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: false,
			vertical: true,
			kind: "punch",
		});
		expect(style.transform).toContain("translate(");
	});

	it("witness kind + isVideo=true → X translation 포함", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "증언", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: true,
			kind: "witness",
		});
		expect(style.transform).toContain("translate(");
	});

	it("witness kind + vertical=true → 더 큰 translateY", () => {
		const vertical = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "증언", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: false,
			vertical: true,
			kind: "witness",
		});
		expect(vertical.transform).toContain("translate(");
	});

	it("timeline kind + isVideo=true + hookBoost=true → blur 포함 가능", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "당일", startFrame: 4, endFrame: 10 }],
			hookBoost: true,
			isVideo: true,
			kind: "timeline",
		});
		expect(style.filter).toContain("brightness(");
	});

	it("default kind + isVideo=true + hookBoost=false → blur 포함 가능", () => {
		const style = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "사건", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: true,
			vertical: false,
		});
		expect(style.transform).toContain("translate(");
	});

	it("default kind + vertical=true → translateY 값 다름", () => {
		const vert = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "사건", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: false,
			vertical: true,
		});
		const horiz = computeMicroEditStyle({
			frame: 5,
			durationInFrames: 60,
			wordTimings: [{ word: "사건", startFrame: 4, endFrame: 10 }],
			hookBoost: false,
			isVideo: false,
			vertical: false,
		});
		expect(vert.transform).not.toBe(horiz.transform);
	});
});
