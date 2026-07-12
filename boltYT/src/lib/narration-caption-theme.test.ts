import { describe, expect, it } from "vitest";
import {
	getNarrationCaptionContainerToneStyle,
	getNarrationCaptionWordToneStyle,
	isNarrationTimelineCueWord,
	isNumberEmphasisWord,
} from "./narration-caption-theme";

describe("narration-caption-theme", () => {
	it("witness tone 컨테이너는 좌측 rail을 만든다", () => {
		const style = getNarrationCaptionContainerToneStyle({
			tone: "witness",
			accentColor: "#ef4444",
		});

		expect(String(style.borderLeft)).toContain("solid");
		expect(style.paddingLeft).toBe(10);
	});

	it("evidence tone 활성 단어는 stamp형 배경을 쓴다", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "evidence",
			word: "증거",
			state: "active",
			accentColor: "#f59e0b",
		});

		expect(style.background).toBeTruthy();
		expect(String(style.border)).toContain("solid");
	});

	it("timeline cue 단어는 배지형으로 강조한다", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "timeline",
			word: "당일",
			state: "active",
			accentColor: "#38bdf8",
		});

		expect(isNarrationTimelineCueWord("당일")).toBe(true);
		expect(style.borderRadius).toBe(999);
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("narration-caption-theme 추가 분기", () => {
	// ─── hexToRgba: hex 길이 6이 아닐 때 폴백 ─────────────────────────────────
	it("잘못된 hex(#fff) → 폴백 rgba(255,255,255,...)", () => {
		// #fff 는 length 3 → 폴백 분기
		const style = getNarrationCaptionContainerToneStyle({
			tone: "witness",
			accentColor: "#fff",
		});
		expect(String(style.borderLeft)).toContain("rgba(255,255,255");
	});

	// ─── getNarrationCaptionContainerToneStyle ───────────────────────────────
	it("evidence tone 컨테이너 스타일 — border와 backgroundImage 있음", () => {
		const style = getNarrationCaptionContainerToneStyle({
			tone: "evidence",
			accentColor: "#f59e0b",
		});
		expect(String(style.border)).toContain("dashed");
		expect(style.backgroundImage).toBeTruthy();
	});

	it("timeline tone 컨테이너 스타일 — borderTop/borderBottom 있음", () => {
		const style = getNarrationCaptionContainerToneStyle({
			tone: "timeline",
			accentColor: "#38bdf8",
		});
		expect(String(style.borderTop)).toContain("solid");
		expect(String(style.borderBottom)).toContain("solid");
	});

	it("generic(default) tone 컨테이너 → 빈 객체", () => {
		const style = getNarrationCaptionContainerToneStyle({
			tone: "generic",
			accentColor: "#ffffff",
		});
		expect(style).toEqual({});
	});

	it("hookBoost: true → glow alpha 0.26", () => {
		const style = getNarrationCaptionContainerToneStyle({
			tone: "witness",
			accentColor: "#ef4444",
			hookBoost: true,
		});
		// hookBoost=true → glow에 0.26 alpha 사용
		expect(String(style.boxShadow)).toContain("0.26");
	});

	// ─── getNarrationCaptionWordToneStyle ─────────────────────────────────────
	it("witness tone — future 상태 → fontStyle: normal, transform: undefined", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "witness",
			word: "단어",
			state: "future",
			accentColor: "#ef4444",
		});
		expect(style.fontStyle).toBe("normal");
		expect(style.transform).toBeUndefined();
	});

	it("witness tone — past 상태 → translateX(-1px)", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "witness",
			word: "단어",
			state: "past",
			accentColor: "#ef4444",
		});
		expect(String(style.transform)).toContain("translateX(-1px)");
	});

	it("witness tone — active 상태 → translateX(-3px) + textShadow", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "witness",
			word: "단어",
			state: "active",
			accentColor: "#ef4444",
		});
		expect(String(style.transform)).toContain("translateX(-3px)");
		expect(style.textShadow).toBeTruthy();
	});

	it("evidence tone — past 상태 → 연한 배경", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "evidence",
			word: "증거",
			state: "past",
			accentColor: "#f59e0b",
		});
		expect(style.background).toBeTruthy();
		expect(style.transform).toBeUndefined(); // active만 rotate
	});

	it("evidence tone — future 상태 → 빈 객체", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "evidence",
			word: "증거",
			state: "future",
			accentColor: "#f59e0b",
		});
		expect(style).toEqual({});
	});

	it("timeline tone — non-cue 단어 → 빈 객체", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "timeline",
			word: "단어", // 타임라인 큐 아님
			state: "active",
			accentColor: "#38bdf8",
		});
		expect(isNarrationTimelineCueWord("단어")).toBe(false);
		expect(style).toEqual({});
	});

	it("timeline tone — past + cue → 연한 배경", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "timeline",
			word: "당일",
			state: "past",
			accentColor: "#38bdf8",
		});
		expect(style.background).toBeTruthy();
	});

	it("timeline tone — future → 빈 객체 (state future = false 분기)", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "timeline",
			word: "당일",
			state: "future",
			accentColor: "#38bdf8",
		});
		expect(style).toEqual({});
	});

	it("generic(default) tone 단어 → 빈 객체", () => {
		const style = getNarrationCaptionWordToneStyle({
			tone: "generic",
			word: "단어",
			state: "active",
			accentColor: "#ffffff",
		});
		expect(style).toEqual({});
	});

	// ─── isNarrationTimelineCueWord ───────────────────────────────────────────
	it("타임라인 큐 패턴들 검증", () => {
		expect(isNarrationTimelineCueWord("10:30")).toBe(true); // HH:MM
		expect(isNarrationTimelineCueWord("2일")).toBe(true); // N일
		expect(isNarrationTimelineCueWord("직후")).toBe(true);
		expect(isNarrationTimelineCueWord("이후")).toBe(true);
		expect(isNarrationTimelineCueWord("분 후")).toBe(true);
		expect(isNarrationTimelineCueWord("시간 후")).toBe(true);
		expect(isNarrationTimelineCueWord("오전")).toBe(true);
		expect(isNarrationTimelineCueWord("오후")).toBe(true);
		expect(isNarrationTimelineCueWord("새벽")).toBe(true);
		expect(isNarrationTimelineCueWord("일반단어")).toBe(false);
	});

	// ─── tone undefined → default 처리 ───────────────────────────────────────
	it("tone 미지정 → generic 기본값으로 처리", () => {
		const containerStyle = getNarrationCaptionContainerToneStyle({
			accentColor: "#ffffff",
		});
		expect(containerStyle).toEqual({});

		const wordStyle = getNarrationCaptionWordToneStyle({
			word: "단어",
			state: "active",
			accentColor: "#ffffff",
		});
		expect(wordStyle).toEqual({});
	});
});

describe("isNumberEmphasisWord (자막 숫자 지속 강조)", () => {
	it("퍼센트·단위 숫자를 강조 대상으로 판정", () => {
		for (const w of [
			"3.5%",
			"1,200억",
			"150명",
			"2배",
			"30년",
			"12만원",
			"5",
		]) {
			expect(isNumberEmphasisWord(w)).toBe(true);
		}
	});
	it("끝 구두점은 무시하고 판정", () => {
		expect(isNumberEmphasisWord("3.5%,")).toBe(true);
		expect(isNumberEmphasisWord("2026년.")).toBe(true);
	});
	it("숫자 아닌 단어는 제외", () => {
		for (const w of ["코스피", "상승", "절대", "", "AI"]) {
			expect(isNumberEmphasisWord(w)).toBe(false);
		}
	});
});
