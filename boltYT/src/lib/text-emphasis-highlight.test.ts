import { describe, expect, it } from "vitest";
import {
	computeTextEmphasisWordStyle,
	isTimelineCueWord,
} from "./text-emphasis-highlight";

describe("text-emphasis-highlight", () => {
	it("witness tone 활성 단어는 왼쪽 pull과 italic을 쓴다", () => {
		const style = computeTextEmphasisWordStyle({
			tone: "witness",
			word: "목격자",
			frame: 6,
			startFrame: 5,
			endFrame: 12,
			activeColor: "#ef4444",
			baseColor: "#ffffff",
			baseWeight: 720,
		});

		expect(String(style.transform)).toContain("translateX(-");
		expect(style.fontStyle).toBe("italic");
	});

	it("evidence tone 활성 단어는 stamp 배경과 회전을 쓴다", () => {
		const style = computeTextEmphasisWordStyle({
			tone: "evidence",
			word: "증거",
			frame: 6,
			startFrame: 5,
			endFrame: 12,
			activeColor: "#f59e0b",
			baseColor: "#ffffff",
			baseWeight: 720,
		});

		expect(style.background).toBeTruthy();
		expect(String(style.border)).toContain("solid");
		expect(String(style.transform)).toContain("rotate(");
	});

	it("timeline cue 단어는 날짜 배지형 스타일을 쓴다", () => {
		const style = computeTextEmphasisWordStyle({
			tone: "timeline",
			word: "당일",
			frame: 8,
			startFrame: 5,
			endFrame: 12,
			activeColor: "#38bdf8",
			baseColor: "#ffffff",
			baseWeight: 700,
		});

		expect(isTimelineCueWord("당일")).toBe(true);
		expect(style.borderRadius).toBe(999);
		expect(style.background).toBeTruthy();
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("text-emphasis-highlight 추가 분기", () => {
	const base = {
		activeColor: "#ef4444",
		baseColor: "#ffffff",
		baseWeight: 700,
	};

	// ─── progressBetween: end <= start 분기 ──────────────────────────────────
	it("end <= start 이면 frame >= end 일 때 1 반환 (진행도 클램핑)", () => {
		// startFrame=endFrame=5, frame=5 → isActive: true
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "witness",
			word: "단어",
			frame: 5,
			startFrame: 5,
			endFrame: 5,
		});
		// isActive: frame >= 5 && frame < 5 → false
		// isPast: frame >= 5 → true
		expect(style.fontStyle).toBe("italic"); // isPast → italic
	});

	// ─── hexToRgba: 짧은 hex 폴백 ────────────────────────────────────────────
	it("짧은 hex (#fff) → rgba(255,255,255,...) 폴백", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "witness",
			word: "단어",
			frame: 6,
			startFrame: 5,
			endFrame: 12,
			activeColor: "#fff",
		});
		// textShadow에 rgba(255,255,255 포함
		expect(String(style.textShadow)).toContain("rgba(255,255,255");
	});

	// ─── witness tone 분기들 ─────────────────────────────────────────────────
	it("witness tone — future 상태 → normal, translateX(0)", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "witness",
			word: "단어",
			frame: 3,
			startFrame: 5,
			endFrame: 12,
		});
		expect(style.fontStyle).toBe("normal");
		expect(String(style.transform)).toContain("translateX(0px)");
	});

	it("witness tone — past 상태 → italic, translateX(-1px)", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "witness",
			word: "단어",
			frame: 15,
			startFrame: 5,
			endFrame: 12,
		});
		expect(style.fontStyle).toBe("italic");
		expect(String(style.transform)).toContain("translateX(-1px)");
	});

	// ─── evidence tone 분기들 ────────────────────────────────────────────────
	it("evidence tone — future 상태 → 패딩/배경 없음", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "evidence",
			word: "증거",
			frame: 1,
			startFrame: 5,
			endFrame: 12,
		});
		expect(style.padding).toBeUndefined();
		expect(style.background).toBeUndefined();
	});

	it("evidence tone — past 상태 → 배경 있음, rotate(-1.2deg)", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "evidence",
			word: "증거",
			frame: 15,
			startFrame: 5,
			endFrame: 12,
		});
		expect(style.background).toBeTruthy();
		expect(String(style.transform)).toContain("rotate(-1.200deg)");
	});

	// ─── timeline tone 분기들 ────────────────────────────────────────────────
	it("timeline tone — non-cue 단어 → padding/background 없음", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "timeline",
			word: "단어",
			frame: 6,
			startFrame: 5,
			endFrame: 12,
		});
		expect(style.padding).toBeUndefined();
		expect(style.background).toBeUndefined();
	});

	it("timeline tone — past + cue → background 있음", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "timeline",
			word: "당일",
			frame: 15,
			startFrame: 5,
			endFrame: 12,
		});
		expect(style.background).toBeTruthy();
	});

	it("timeline tone — future → 기본 스타일", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "timeline",
			word: "당일",
			frame: 3,
			startFrame: 5,
			endFrame: 12,
		});
		// future → background, padding undefined
		expect(style.background).toBeUndefined();
	});

	// ─── default tone ─────────────────────────────────────────────────────────
	it("default tone → baseStyle 반환", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: undefined,
			word: "단어",
			frame: 6,
			startFrame: 5,
			endFrame: 12,
		});
		expect(style.display).toBe("inline-block");
		expect(style.fontStyle).toBeUndefined();
	});

	// ─── line 139 (uncovered): dateCue && isActive → 다른 background alpha ──
	it("timeline — active + dateCue → alpha 0.18", () => {
		const style = computeTextEmphasisWordStyle({
			...base,
			tone: "timeline",
			word: "10:30", // dateCue
			frame: 6,
			startFrame: 5,
			endFrame: 12,
		});
		// active + dateCue → hexToRgba(activeColor, 0.18)
		expect(String(style.background)).toContain("0.18");
	});
});
