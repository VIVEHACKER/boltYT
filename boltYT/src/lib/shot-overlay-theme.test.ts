import { describe, expect, it } from "vitest";
import type { SceneMood } from "../remotion/types";
import type { SceneShotOverlay } from "./scene-shot-types";
import { getShotOverlayTheme } from "./shot-overlay-theme";

describe("shot-overlay-theme", () => {
	it("headline 테마는 브레이킹 라벨과 강한 카드 액센트를 가진다", () => {
		const theme = getShotOverlayTheme({
			overlay: "headline",
			mood: "news",
			hookBoost: true,
		});

		expect(theme.label?.text).toBe("BREAKING");
		expect(String(theme.card.borderLeft)).toContain("solid");
		expect(theme.title.fontSize).toBe(30);
	});

	it("quote 테마는 중앙 정렬과 강조 인용부호를 사용한다", () => {
		const theme = getShotOverlayTheme({
			overlay: "quote",
			mood: "mystery",
			tone: "witness",
		});

		expect(theme.container.justifyContent).toBe("center");
		expect(theme.quoteMark?.text).toBe("“");
		expect(theme.showDate).toBe(false);
		expect(theme.label?.text).toBe("WITNESS");
	});

	it("evidence 테마는 하단 배치와 모노스페이스 스타일을 사용한다", () => {
		const theme = getShotOverlayTheme({
			overlay: "evidence",
			mood: "warm",
		});

		expect(theme.container.justifyContent).toBe("flex-end");
		expect(theme.label?.text).toBe("EVIDENCE");
		expect(String(theme.title.fontFamily)).toContain("JetBrains Mono");
	});

	it("context 테마는 우하단 보조 카드로 렌더링한다", () => {
		const theme = getShotOverlayTheme({
			overlay: "context",
			mood: "neutral",
			tone: "timeline",
		});

		expect(theme.container.alignItems).toBe("flex-end");
		expect(theme.showSource).toBe(false);
		expect(theme.title.fontSize).toBe(20);
		expect(theme.datePlacement).toBe("badge");
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("shot-overlay-theme 추가 분기", () => {
	// ─── headline: tone 분기 ─────────────────────────────────────────────
	it("headline + timeline → TIMELINE 라벨", () => {
		const theme = getShotOverlayTheme({ overlay: "headline", tone: "timeline" });
		expect(theme.label?.text).toBe("TIMELINE");
	});

	it("headline + generic → BREAKING 라벨", () => {
		const theme = getShotOverlayTheme({ overlay: "headline", tone: "generic" });
		expect(theme.label?.text).toBe("BREAKING");
	});

	// ─── quote: non-witness → label undefined ────────────────────────────
	it("quote + generic tone → label undefined", () => {
		const theme = getShotOverlayTheme({ overlay: "quote", tone: "generic" });
		expect(theme.label).toBeUndefined();
	});

	it("quote + witness + hookBoost → 박스 섀도 강화", () => {
		const theme = getShotOverlayTheme({
			overlay: "quote",
			tone: "witness",
			hookBoost: true,
		});
		expect(theme.label?.text).toBe("WITNESS");
	});

	// ─── evidence: tone 분기 ─────────────────────────────────────────────
	it("evidence + evidence tone → EVIDENCE FILE 라벨", () => {
		const theme = getShotOverlayTheme({ overlay: "evidence", tone: "evidence" });
		expect(theme.label?.text).toBe("EVIDENCE FILE");
	});

	it("evidence + generic tone → EVIDENCE 라벨", () => {
		const theme = getShotOverlayTheme({ overlay: "evidence", tone: "generic" });
		expect(theme.label?.text).toBe("EVIDENCE");
	});

	// ─── context: non-timeline ────────────────────────────────────────────
	it("context + generic → CONTEXT 라벨, datePlacement meta", () => {
		const theme = getShotOverlayTheme({ overlay: "context", tone: "generic" });
		expect(theme.label?.text).toBe("CONTEXT");
		expect(theme.datePlacement).toBe("meta");
		expect(theme.title.fontSize).toBe(22);
	});

	it("context + witness → date color = palette.muted (not timeline)", () => {
		const theme = getShotOverlayTheme({
			overlay: "context",
			mood: "news",
			tone: "witness",
		});
		expect(theme.datePlacement).toBe("meta");
		// date.padding should be undefined (non-timeline)
		expect(theme.date.padding).toBeUndefined();
	});

	// ─── default overlay ──────────────────────────────────────────────────
	it("알 수 없는 overlay → base 반환", () => {
		const theme = getShotOverlayTheme({
			overlay: "unknown" as unknown as SceneShotOverlay,
		});
		expect(theme.showDate).toBe(true);
		expect(theme.datePlacement).toBe("meta");
	});

	// ─── hookBoost card shadow ────────────────────────────────────────────
	it("hookBoost=true → card boxShadow에 accentSoft 포함", () => {
		const theme = getShotOverlayTheme({
			overlay: "headline",
			mood: "horror",
			hookBoost: true,
		});
		expect(String(theme.card.boxShadow)).toContain("rgba");
	});

	// ─── 다양한 mood 팔레트 ────────────────────────────────────────────────
	it("horror mood → accent #a855f7 계열", () => {
		const theme = getShotOverlayTheme({ overlay: "headline", mood: "horror" });
		expect(String(theme.card.borderLeft)).toContain("solid");
	});

	it("warm mood → default palette 사용", () => {
		const theme = getShotOverlayTheme({ overlay: "headline", mood: "warm" });
		expect(theme.tone).toBeTruthy();
	});

	it("알 수 없는 mood → neutral 팔레트 폴백", () => {
		const theme = getShotOverlayTheme({
			overlay: "headline",
			mood: "alien" as unknown as SceneMood,
		});
		expect(theme.label?.text).toBeTruthy();
	});
});
