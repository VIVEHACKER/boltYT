import { describe, expect, it } from "vitest";
import { getNewsCardTheme } from "./news-surface-theme";
import { getTextEmphasisSurfaceTheme } from "./text-emphasis-surface-theme";

describe("text-emphasis-surface-theme", () => {
	it("witness tone은 좌정렬 인터뷰형 카드로 바뀐다", () => {
		const theme = getNewsCardTheme({
			mood: "news",
			tone: "witness",
		});
		const surface = getTextEmphasisSurfaceTheme({
			theme,
			tone: "witness",
		});

		expect(surface.lineAlign).toBe("flex-start");
		expect(String(surface.card.borderLeft)).toContain("solid");
		expect(surface.titleBlock.textAlign).toBe("left");
	});

	it("evidence tone은 도큐먼트 프레임을 추가한다", () => {
		const theme = getNewsCardTheme({
			mood: "mystery",
			tone: "evidence",
		});
		const surface = getTextEmphasisSurfaceTheme({
			theme,
			tone: "evidence",
		});

		expect(String(surface.card.backgroundImage)).toContain(
			"repeating-linear-gradient",
		);
		expect(String(surface.titleBlock.border)).toContain("dashed");
	});

	it("timeline tone은 상하단 타임라인 밴드를 만든다", () => {
		const theme = getNewsCardTheme({
			mood: "neutral",
			tone: "timeline",
		});
		const surface = getTextEmphasisSurfaceTheme({
			theme,
			tone: "timeline",
		});

		expect(surface.lineAlign).toBe("center");
		expect(String(surface.titleBlock.borderTop)).toContain("solid");
		expect(String(surface.card.boxShadow)).toContain("inset");
	});

	it("generic tone(기본값) → 기본 카드 반환", () => {
		const theme = getNewsCardTheme({ mood: "neutral", tone: "generic" });
		const surface = getTextEmphasisSurfaceTheme({ theme, tone: "generic" });
		expect(surface.lineAlign).toBe("center");
		expect(surface.card).toBeDefined();
	});

	it("hookBoost=true → 카드 boxShadow에 강조 추가", () => {
		const theme = getNewsCardTheme({ mood: "news", tone: "generic" });
		const surface = getTextEmphasisSurfaceTheme({
			theme,
			tone: "generic",
			hookBoost: true,
		});
		expect(surface.card.boxShadow).toBeDefined();
	});

	it("accentColor 짧은 hex(비6자) → rgba(255,255,255,...) 폴백", () => {
		const theme = getNewsCardTheme({ mood: "neutral", tone: "generic" });
		// 짧은 hex를 직접 전달하기 위해 theme 오버라이드
		const shortTheme = { ...theme, accentColor: "#fff" };
		const surface = getTextEmphasisSurfaceTheme({
			theme: shortTheme as typeof theme,
			tone: "generic",
		});
		// 폴백 경로가 실행돼도 에러 없이 반환
		expect(surface.card).toBeDefined();
	});
});
