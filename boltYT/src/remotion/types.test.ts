import { describe, expect, it } from "vitest";
import {
	isVertical,
	SHORTS_HEIGHT,
	SHORTS_SAFE_AREA,
	SHORTS_WIDTH,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
} from "./types";

describe("isVertical", () => {
	it("16:9는 가로", () => {
		expect(isVertical(VIDEO_WIDTH, VIDEO_HEIGHT)).toBe(false);
		expect(isVertical(1920, 1080)).toBe(false);
	});

	it("9:16은 세로", () => {
		expect(isVertical(SHORTS_WIDTH, SHORTS_HEIGHT)).toBe(true);
		expect(isVertical(1080, 1920)).toBe(true);
	});

	it("정사각형은 가로", () => {
		expect(isVertical(1080, 1080)).toBe(false);
	});
});

describe("SHORTS_SAFE_AREA", () => {
	it("하단 safe area가 가장 큼 (모바일 UI)", () => {
		expect(SHORTS_SAFE_AREA.bottom).toBeGreaterThan(SHORTS_SAFE_AREA.top);
		expect(SHORTS_SAFE_AREA.bottom).toBeGreaterThan(SHORTS_SAFE_AREA.left);
	});
});
