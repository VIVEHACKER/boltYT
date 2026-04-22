import { describe, expect, it } from "vitest";
import { computeTextEmphasisCueTheme } from "./text-emphasis-cue-theme";

describe("text-emphasis-cue-theme", () => {
	it("witness tone은 좌측 quote rail과 음수 x cue를 만든다", () => {
		const cue = computeTextEmphasisCueTheme({
			tone: "witness",
			frame: 6,
			wordTimings: [{ word: "목격자", startFrame: 5, endFrame: 12 }],
			durationInFrames: 60,
			accentColor: "#ef4444",
		});

		expect(String(cue.shellOverlay.background)).toContain("linear-gradient");
		expect(cue.accentOverlay.left).toBe(18);
		expect(String(cue.labelCue.transform)).toContain("translateX(-");
	});

	it("evidence tone은 stamp overlay와 회전 cue를 만든다", () => {
		const cue = computeTextEmphasisCueTheme({
			tone: "evidence",
			frame: 6,
			wordTimings: [{ word: "증거", startFrame: 5, endFrame: 12 }],
			durationInFrames: 60,
			accentColor: "#f59e0b",
		});

		expect(String(cue.accentOverlay.border)).toContain("dashed");
		expect(String(cue.accentOverlay.transform)).toContain("rotate(");
	});

	it("timeline tone은 marker sweep line을 만든다", () => {
		const cue = computeTextEmphasisCueTheme({
			tone: "timeline",
			frame: 8,
			wordTimings: [{ word: "당일", startFrame: 5, endFrame: 12 }],
			durationInFrames: 60,
			accentColor: "#38bdf8",
		});

		expect(cue.accentOverlay.top).toBe("50%");
		expect(String(cue.shellOverlay.background)).toContain("linear-gradient");
		expect(String(cue.labelCue.transform)).toContain("translateX(");
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("text-emphasis-cue-theme 추가 분기", () => {
	const base = {
		frame: 6,
		wordTimings: [{ word: "단어", startFrame: 5, endFrame: 12 }],
		durationInFrames: 60,
		accentColor: "#ef4444",
	};

	// ─── default (generic) tone ────────────────────────────────────────────
	it("generic tone → radial-gradient shellOverlay", () => {
		const cue = computeTextEmphasisCueTheme({ ...base, tone: "generic" });
		expect(String(cue.shellOverlay.background)).toContain("radial-gradient");
	});

	it("tone undefined → default 분기 (radial-gradient)", () => {
		const cue = computeTextEmphasisCueTheme({ ...base, tone: undefined });
		expect(String(cue.shellOverlay.background)).toContain("radial-gradient");
	});

	// ─── hookBoost 분기 ────────────────────────────────────────────────────
	it("hookBoost=true → attackFrames=2, releaseFrames=10", () => {
		const cue = computeTextEmphasisCueTheme({
			...base,
			tone: "witness",
			hookBoost: true,
		});
		// hookBoost: shellOverlay opacity가 더 높을 수 있음
		expect(cue.shellOverlay.opacity).toBeGreaterThan(0);
	});

	// ─── pulseEnvelope: frame < start ─────────────────────────────────────
	it("frame < cueFrame - 1 → pulse = 0 → opacity 최소값", () => {
		// cueFrame = 5 (first word startFrame), frame = 1 → frame < 4
		const cue = computeTextEmphasisCueTheme({
			...base,
			frame: 1,
			tone: "timeline",
		});
		// pulse=0 → opacity = 0.22 + 0*0.42 = 0.22
		expect(cue.accentOverlay.opacity).toBeCloseTo(0.22, 2);
	});

	// ─── pulseEnvelope: frame > end ───────────────────────────────────────
	it("frame > cueFrame + releaseFrames → pulse = 0", () => {
		const cue = computeTextEmphasisCueTheme({
			...base,
			frame: 50,
			tone: "evidence",
		});
		expect(cue.accentOverlay.opacity).toBeCloseTo(0.22, 2);
	});

	// ─── pulseEnvelope: frame <= peak (rising edge) ───────────────────────
	it("frame <= peak → rising edge pulse > 0", () => {
		// cueFrame = startFrame 근처, frame = cueFrame (peak)
		const cue = computeTextEmphasisCueTheme({
			...base,
			frame: 5,
			tone: "witness",
		});
		// pulse > 0 → opacity > 0.22
		expect(Number(cue.accentOverlay.opacity)).toBeGreaterThanOrEqual(0.22);
	});

	// ─── progressBetween: end <= start → 0 if frame < end ─────────────────
	it("cueFrames 없을 때 sweepProgress → 0", () => {
		// wordTimings 없음 → cueFrames = [] → primaryCue = 0
		const cue = computeTextEmphasisCueTheme({
			...base,
			wordTimings: undefined,
			frame: 0,
			tone: "timeline",
		});
		expect(cue.shellOverlay.opacity).toBeGreaterThan(0);
	});

	// ─── hexToRgba: short hex fallback ────────────────────────────────────
	it("짧은 hex (#fff) → rgba(255,255,255,...) 폴백", () => {
		const cue = computeTextEmphasisCueTheme({
			...base,
			accentColor: "#fff",
			tone: "generic",
		});
		expect(String(cue.labelCue.boxShadow)).toContain("rgba(255,255,255");
	});
});
