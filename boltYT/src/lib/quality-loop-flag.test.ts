import { describe, expect, it } from "vitest";
import {
	isQualityLoopEnabled,
	QUALITY_LOOP_ALWAYS_ON_GENRES,
} from "./quality-loop-flag";

describe("isQualityLoopEnabled", () => {
	it("전역 플래그가 켜지면 장르와 무관하게 활성", () => {
		expect(isQualityLoopEnabled({ flagEnabled: true })).toBe(true);
		expect(isQualityLoopEnabled({ flagEnabled: true, genre: "generic" })).toBe(
			true,
		);
	});

	it("플래그 off + historical_vlog 는 기본 ON", () => {
		expect(
			isQualityLoopEnabled({ flagEnabled: false, genre: "historical_vlog" }),
		).toBe(true);
	});

	it("플래그 off + 비화이트리스트 장르는 OFF (기존 동작 보존)", () => {
		expect(isQualityLoopEnabled({ flagEnabled: false, genre: "generic" })).toBe(
			false,
		);
		expect(
			isQualityLoopEnabled({ flagEnabled: false, genre: "docu_story" }),
		).toBe(false);
		expect(isQualityLoopEnabled({ flagEnabled: false })).toBe(false);
	});

	it("화이트리스트에 historical_vlog 가 포함된다", () => {
		expect(QUALITY_LOOP_ALWAYS_ON_GENRES).toContain("historical_vlog");
	});
});
