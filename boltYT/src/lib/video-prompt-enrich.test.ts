/**
 * video-prompt-enrich 단위 테스트 — 순수 함수, 키워드 합성 / aspect / seed.
 */

import { describe, expect, it } from "vitest";
import {
	colorsToKeyword,
	deriveLockedSeed,
	enrichVideoPrompt,
} from "./video-prompt-enrich";

describe("enrichVideoPrompt", () => {
	it("최소 입력: rawPrompt + 기본 quality 키워드", () => {
		const r = enrichVideoPrompt({ rawPrompt: "ocean waves at dusk" });
		expect(r.prompt).toContain("ocean waves at dusk");
		expect(r.prompt).toMatch(/cinematic/i);
		expect(r.aspectRatio).toBe("16:9");
		expect(r.cameraCommands).toEqual([]);
	});

	it("shorts 포맷 → aspect 9:16", () => {
		const r = enrichVideoPrompt({ rawPrompt: "x", format: "shorts" });
		expect(r.aspectRatio).toBe("9:16");
	});

	it("longform → aspect 16:9", () => {
		const r = enrichVideoPrompt({ rawPrompt: "x", format: "longform" });
		expect(r.aspectRatio).toBe("16:9");
	});

	it("mood horror → 어두운 cinematography 키워드 주입", () => {
		const r = enrichVideoPrompt({ rawPrompt: "scene", mood: "horror" });
		expect(r.prompt).toMatch(/low-key|shadows|desaturated/i);
	});

	it("mood warm → 골든 아워 키워드", () => {
		const r = enrichVideoPrompt({ rawPrompt: "x", mood: "warm" });
		expect(r.prompt).toMatch(/golden hour|warm tones/i);
	});

	it("shot_type close_up → 얕은 심도 키워드", () => {
		const r = enrichVideoPrompt({ rawPrompt: "x", shotType: "close_up" });
		expect(r.prompt).toMatch(/close-up|shallow depth/i);
	});

	it("camera_motion zoom_in → forward dolly + hailuo Push in", () => {
		const r = enrichVideoPrompt({ rawPrompt: "x", cameraMotion: "zoom_in" });
		expect(r.prompt).toMatch(/forward dolly|zoom-in/i);
		expect(r.cameraCommands).toEqual(["Push in"]);
	});

	it("camera_motion handheld → micro-shake + hailuo Tracking shot", () => {
		const r = enrichVideoPrompt({ rawPrompt: "x", cameraMotion: "handheld" });
		expect(r.prompt).toMatch(/handheld|micro-shake/i);
		expect(r.cameraCommands).toEqual(["Tracking shot"]);
	});

	it("subjectFocus 주입", () => {
		const r = enrichVideoPrompt({
			rawPrompt: "rainy night",
			subjectFocus: "detective in trench coat",
		});
		expect(r.prompt).toMatch(/focus on detective in trench coat/i);
	});

	it("lighting dark + mood mystery 동시 주입", () => {
		const r = enrichVideoPrompt({
			rawPrompt: "alley",
			lighting: "dark",
			mood: "mystery",
		});
		expect(r.prompt).toMatch(/dramatic lighting/i);
		expect(r.prompt).toMatch(/misty|teal|suspenseful/i);
	});

	it("rawPrompt에 이미 cinematic 키워드 있으면 중복 방지", () => {
		const r = enrichVideoPrompt({
			rawPrompt: "cinematic 35mm shot of waves",
		});
		const cinemaCount = (r.prompt.match(/cinematic/gi) || []).length;
		expect(cinemaCount).toBe(1);
	});

	it("complex: shorts horror close_up handheld", () => {
		const r = enrichVideoPrompt({
			rawPrompt: "abandoned hospital corridor",
			format: "shorts",
			mood: "horror",
			shotType: "close_up",
			cameraMotion: "handheld",
			lighting: "dark",
		});
		expect(r.aspectRatio).toBe("9:16");
		expect(r.prompt).toMatch(/close-up/i);
		expect(r.prompt).toMatch(/handheld/i);
		expect(r.prompt).toMatch(/low-key|shadows/i);
		expect(r.cameraCommands).toEqual(["Tracking shot"]);
	});

	it("빈 rawPrompt 도 quality 키워드 포함", () => {
		const r = enrichVideoPrompt({ rawPrompt: "" });
		expect(r.prompt).toMatch(/cinematic/i);
	});
});

describe("colorsToKeyword", () => {
	it("빈 배열 → 빈 문자열", () => {
		expect(colorsToKeyword([])).toBe("");
	});

	it("단일 색상 → 'X color palette'", () => {
		const out = colorsToKeyword(["#1a2b3c"]);
		expect(out).toMatch(/color palette$/);
		expect(out).toContain("deep navy");
	});

	it("2색 → 'A and B color palette'", () => {
		const out = colorsToKeyword(["#1a2b3c", "#d2a36f"]);
		expect(out).toMatch(/^deep navy and warm amber color palette$/);
	});

	it("3색 → '쉼표, A and B color palette'", () => {
		const out = colorsToKeyword(["#1a2b3c", "#d2a36f", "#c0392b"]);
		expect(out).toMatch(/, .* color palette$/);
		expect(out.split(" and ").length).toBe(2);
	});

	it("4번째 이상은 무시", () => {
		const out = colorsToKeyword([
			"#1a2b3c",
			"#d2a36f",
			"#c0392b",
			"#ffffff",
			"#000000",
		]);
		expect(out.split(",").length).toBeLessThanOrEqual(2);
	});

	it("어두운 색 → deep charcoal", () => {
		expect(colorsToKeyword(["#0a0a0a"])).toContain("deep charcoal");
	});

	it("회색 → muted gray", () => {
		expect(colorsToKeyword(["#aaaaaa"])).toContain("muted gray");
	});

	it("잘못된 hex → 무시", () => {
		expect(colorsToKeyword(["not-a-color"])).toBe("");
	});

	it("중복 라벨 → 한번만 반영", () => {
		const out = colorsToKeyword(["#1a2b3c", "#1a3a4c"]); // 둘 다 deep navy 영역
		const matches = (out.match(/deep navy/g) || []).length;
		expect(matches).toBe(1);
	});
});

describe("enrichVideoPrompt with dominantColors / stylePromptTemplate", () => {
	it("dominantColors → palette 키워드 주입", () => {
		const r = enrichVideoPrompt({
			rawPrompt: "alley scene",
			dominantColors: ["#1a2b3c", "#d2a36f"],
		});
		expect(r.prompt).toMatch(/deep navy and warm amber color palette/);
	});

	it("stylePromptTemplate → 그대로 prompt 에 합쳐짐", () => {
		const r = enrichVideoPrompt({
			rawPrompt: "x",
			stylePromptTemplate: "kdrama dramatic close-up of {subject}",
		});
		expect(r.prompt).toContain("kdrama dramatic close-up of {subject}");
	});

	it("dominantColors 빈 배열 → 추가 안됨", () => {
		const r = enrichVideoPrompt({ rawPrompt: "x", dominantColors: [] });
		expect(r.prompt).not.toMatch(/color palette/);
	});
});

describe("deriveLockedSeed", () => {
	it("동일 scriptId → 동일 시드 (결정론적)", () => {
		expect(deriveLockedSeed("script-abc-123")).toBe(
			deriveLockedSeed("script-abc-123"),
		);
	});

	it("다른 scriptId → 다른 시드", () => {
		expect(deriveLockedSeed("script-A")).not.toBe(deriveLockedSeed("script-B"));
	});

	it("sceneIndex 생략(0)은 기존 시드와 동일 → 이미지 톤 일관성 유지", () => {
		expect(deriveLockedSeed("script-x", 0)).toBe(deriveLockedSeed("script-x"));
	});

	it("sceneIndex 지정 시 씬마다 다른 시드 → I2V 모션 정체 방지", () => {
		const s0 = deriveLockedSeed("script-x", 0);
		const s1 = deriveLockedSeed("script-x", 1);
		const s2 = deriveLockedSeed("script-x", 2);
		expect(s1).not.toBe(s0);
		expect(s2).not.toBe(s1);
		// 결정론 유지
		expect(deriveLockedSeed("script-x", 1)).toBe(s1);
	});

	it("양의 정수 (32-bit 양수 범위)", () => {
		const seed = deriveLockedSeed("any-id");
		expect(seed).toBeGreaterThanOrEqual(0);
		expect(seed).toBeLessThan(2 ** 31);
		expect(Number.isInteger(seed)).toBe(true);
	});

	it("빈 문자열 → 0이 아닌 결정론적 값", () => {
		expect(deriveLockedSeed("")).toBe(deriveLockedSeed(""));
	});
});
