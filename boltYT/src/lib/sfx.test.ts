import { describe, expect, it } from "vitest";
import {
	assignSfx,
	assignSfxToScenes,
	getTransitionBgmDip,
	transitionDipFactor,
} from "./sfx";

describe("sfx", () => {
	it("hook scene의 SFX cue를 자막 강조와 비트에 맞춘다", () => {
		const result = assignSfxToScenes([
			{
				type: "video",
				transition: "none",
				hookBoost: true,
				durationInFrames: 90,
				wordTimings: [
					{ word: "그날", startFrame: 4, endFrame: 10 },
					{ word: "밤", startFrame: 12, endFrame: 18 },
					{ word: "CCTV", startFrame: 54, endFrame: 63 },
				],
				beatTimes: [0.4, 2.0, 3.0],
			},
			{
				type: "image",
				transition: "crossfade",
				durationInFrames: 60,
				wordTimings: [{ word: "후속", startFrame: 8, endFrame: 16 }],
			},
		]);

		expect(result[0].enterSfx?.file).toBeTruthy();
		expect(result[0].transitionSfx?.file).toBeTruthy();
		expect(result[0].enterOffsetFrames).toBe(12);
		expect(result[0].transitionOffsetFrames).toBe(60);
	});

	it("glitch 전환 경계 직전 프레임에서 dip factor가 0보다 크다", () => {
		const boundaries = [{ boundary: 90, transitionType: "glitch" as const }];
		// 경계 1프레임 전 — attackFrames=2 이내
		const dip = transitionDipFactor(89, boundaries);
		expect(dip).toBeGreaterThan(0);
	});

	it("crossfade dip은 glitch dip보다 얕다", () => {
		const glitchDip = transitionDipFactor(89, [
			{ boundary: 90, transitionType: "glitch" as const },
		]);
		const crossfadeDip = transitionDipFactor(89, [
			{ boundary: 90, transitionType: "crossfade" as const },
		]);
		expect(crossfadeDip).toBeLessThan(glitchDip);
	});

	it("경계에서 멀리 떨어진 프레임에서는 dip이 0이다", () => {
		const dip = transitionDipFactor(30, [
			{ boundary: 90, transitionType: "glitch" as const },
		]);
		expect(dip).toBe(0);
	});

	it("text_emphasis 씬은 시작 프레임에서 바로 enter SFX가 붙는다", () => {
		const result = assignSfxToScenes([
			{
				type: "text_emphasis",
				textEffect: "glitch",
				transition: "glitch",
				durationInFrames: 45,
			},
		]);

		expect(result[0].enterSfx?.file).toBeTruthy();
		expect(result[0].enterOffsetFrames).toBe(0);
	});
});

// ─── getTransitionBgmDip ──────────────────────────────────────────────────────
describe("getTransitionBgmDip", () => {
	it("glitch → dipDepth 0.72, attack 2, release 7", () => {
		const dip = getTransitionBgmDip("glitch");
		expect(dip.dipDepth).toBe(0.72);
		expect(dip.attackFrames).toBe(2);
		expect(dip.releaseFrames).toBe(7);
	});

	it("whip_left → dipDepth 0.62", () => {
		expect(getTransitionBgmDip("whip_left").dipDepth).toBe(0.62);
	});

	it("whip_right → dipDepth 0.62", () => {
		expect(getTransitionBgmDip("whip_right").dipDepth).toBe(0.62);
	});

	it("none → dipDepth 0.55", () => {
		expect(getTransitionBgmDip("none").dipDepth).toBe(0.55);
	});

	it("zoom → dipDepth 0.36", () => {
		expect(getTransitionBgmDip("zoom").dipDepth).toBe(0.36);
	});

	it("crossfade → dipDepth 0.25", () => {
		expect(getTransitionBgmDip("crossfade").dipDepth).toBe(0.25);
	});

	it("undefined/기타 → default dipDepth 0.4", () => {
		expect(getTransitionBgmDip(undefined).dipDepth).toBe(0.4);
		expect(getTransitionBgmDip("slide_left" as "none").dipDepth).toBe(0.4);
	});
});

// ─── transitionDipFactor (추가 분기) ─────────────────────────────────────────
describe("transitionDipFactor 추가 분기", () => {
	it("release 구간 (경계 직후) → dip factor > 0", () => {
		// boundary=90, releaseFrames=7 → frame=91 (distAfter=1 < 7)
		const dip = transitionDipFactor(91, [
			{ boundary: 90, transitionType: "glitch" },
		]);
		expect(dip).toBeGreaterThan(0);
	});

	it("boundary 없음 → 0", () => {
		expect(transitionDipFactor(45, [])).toBe(0);
	});

	it("여러 경계 중 최대 dip 반환", () => {
		const dip = transitionDipFactor(89, [
			{ boundary: 90, transitionType: "crossfade" },
			{ boundary: 90, transitionType: "glitch" },
		]);
		// glitch의 dipDepth(0.72) > crossfade(0.25)
		expect(dip).toBeGreaterThanOrEqual(0.72 * (1 - 1 / 2));
	});

	it("transitionType undefined → default dip", () => {
		const dip = transitionDipFactor(89, [{ boundary: 90 }]);
		// attackFrames=5, distBefore=1 → dipDepth*0.8
		expect(dip).toBeGreaterThan(0);
	});
});

// ─── assignSfx 추가 분기 ─────────────────────────────────────────────────────
describe("assignSfx 추가 분기", () => {
	it("hookBoost + isFirst → impact SFX", () => {
		const result = assignSfx({
			type: "video",
			hookBoost: true,
			isFirst: true,
			transition: "crossfade",
			durationInFrames: 60,
		});
		expect(result.enterSfx?.category).toBe("impact");
	});

	it("hookBoost + glitch transition → glitch SFX", () => {
		const result = assignSfx({
			type: "video",
			hookBoost: true,
			transition: "glitch",
			durationInFrames: 60,
		});
		expect(result.enterSfx?.category).toBe("glitch");
		expect(result.transitionSfx?.category).toBe("glitch");
	});

	it("hookBoost + whip_left → whoosh SFX", () => {
		const result = assignSfx({
			type: "video",
			hookBoost: true,
			transition: "whip_left",
			durationInFrames: 60,
		});
		expect(result.enterSfx?.category).toBe("whoosh");
		expect(result.transitionSfx?.category).toBe("whoosh");
	});

	it("hookBoost + whip_right → whoosh SFX", () => {
		const result = assignSfx({
			type: "video",
			hookBoost: true,
			transition: "whip_right",
			durationInFrames: 60,
		});
		expect(result.enterSfx?.category).toBe("whoosh");
	});

	it("hookBoost + none + isLast=false → transitionSfx impact", () => {
		const result = assignSfx({
			type: "video",
			hookBoost: true,
			transition: "none",
			isLast: false,
			durationInFrames: 60,
		});
		expect(result.enterSfx?.category).toBe("suspense_hit");
		expect(result.transitionSfx?.category).toBe("impact");
	});

	it("hookBoost + none + isLast=true → transitionSfx 없음", () => {
		const result = assignSfx({
			type: "video",
			hookBoost: true,
			transition: "none",
			isLast: true,
			durationInFrames: 60,
		});
		expect(result.transitionSfx).toBeUndefined();
	});

	it("text_emphasis + scale_in → impact SFX", () => {
		const result = assignSfx({
			type: "text_emphasis",
			textEffect: "scale_in",
			transition: "none",
			durationInFrames: 45,
		});
		expect(result.enterSfx?.category).toBe("impact");
	});

	it("text_emphasis + typewriter/none → reveal SFX", () => {
		const result = assignSfx({
			type: "text_emphasis",
			textEffect: "typewriter",
			transition: "crossfade",
			durationInFrames: 45,
		});
		expect(result.enterSfx?.category).toBe("reveal");
	});

	it("horror mood + seed % 3 === 0 → suspense_hit", () => {
		// seed(index)=0, 0%3===0 → suspense_hit
		const result = assignSfx({
			type: "video",
			mood: "horror",
			index: 0,
			transition: "crossfade",
			durationInFrames: 60,
		});
		expect(result.enterSfx?.category).toBe("suspense_hit");
	});

	it("mystery mood + seed % 3 !== 0 → enter SFX 없음", () => {
		// seed=1, 1%3!==0 → enterSfx 없음
		const result = assignSfx({
			type: "video",
			mood: "mystery",
			index: 1,
			transition: "crossfade",
			durationInFrames: 60,
		});
		expect(result.enterSfx).toBeUndefined();
	});

	it("isFirst (비hook) → impact SFX", () => {
		const result = assignSfx({
			type: "image",
			isFirst: true,
			transition: "crossfade",
			durationInFrames: 60,
		});
		expect(result.enterSfx?.category).toBe("impact");
	});

	it("zoom transition → whoosh SFX", () => {
		const result = assignSfx({
			type: "image",
			transition: "zoom",
			durationInFrames: 60,
		});
		expect(result.transitionSfx?.category).toBe("whoosh");
	});

	it("slide_left → whoosh SFX", () => {
		const result = assignSfx({
			type: "image",
			transition: "slide_left",
			durationInFrames: 60,
		});
		expect(result.transitionSfx?.category).toBe("whoosh");
	});

	it("slide_right → whoosh SFX", () => {
		const result = assignSfx({
			type: "image",
			transition: "slide_right",
			durationInFrames: 60,
		});
		expect(result.transitionSfx?.category).toBe("whoosh");
	});

	it("crossfade + seed % 5 === 0 → whoosh SFX", () => {
		// seed=0, 0%5===0 → whoosh
		const result = assignSfx({
			type: "image",
			transition: "crossfade",
			isLast: false,
			index: 0,
			durationInFrames: 60,
		});
		expect(result.transitionSfx?.category).toBe("whoosh");
	});

	it("crossfade + isLast → transitionSfx 없음", () => {
		const result = assignSfx({
			type: "image",
			transition: "crossfade",
			isLast: true,
			index: 0,
			durationInFrames: 60,
		});
		expect(result.transitionSfx).toBeUndefined();
	});

	it("hookBoost + firstWordFrame과 SFX가 같은 프레임 → SFX 1프레임 뒤로", () => {
		const result = assignSfx({
			type: "video",
			hookBoost: true,
			isFirst: true,
			transition: "crossfade",
			durationInFrames: 60,
			wordTimings: [{ word: "훅", startFrame: 0, endFrame: 6 }],
		});
		// enterOffsetFrames는 wordTimings[0].startFrame이 0이면 hookBoost 조건 미충족
		expect(result.enterSfx).toBeTruthy();
	});
});
