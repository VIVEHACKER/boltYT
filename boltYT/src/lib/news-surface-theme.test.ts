import { describe, expect, it } from "vitest";
import {
	getLowerThirdTheme,
	getNewsCardTheme,
	inferNewsSurfaceTone,
} from "./news-surface-theme";

describe("news-surface-theme", () => {
	it("hook 또는 뉴스 mood는 breaking 카드 테마를 쓴다", () => {
		const theme = getNewsCardTheme({
			mood: "news",
			hookBoost: true,
		});

		expect(theme.variant).toBe("breaking");
		expect(theme.label.text).toBe("NEWS FLASH");
		expect(String(theme.card.borderLeft)).toContain("solid");
	});

	it("미스터리 mood는 dossier 카드 테마를 쓴다", () => {
		const theme = getNewsCardTheme({
			mood: "mystery",
		});

		expect(theme.variant).toBe("dossier");
		expect(theme.label.text).toBe("CASE FILE");
		expect(String(theme.source.fontFamily)).toContain("JetBrains Mono");
	});

	it("목격자 키워드는 witness tone으로 분류한다", () => {
		const tone = inferNewsSurfaceTone({
			newsTitle: "목격자 진술 확보",
			newsExcerpt: "목격자는 남자의 동선을 비교적 선명하게 기억했다.",
		});

		expect(tone).toBe("witness");
	});

	it("증거 키워드는 evidence tone으로 분류한다", () => {
		const tone = inferNewsSurfaceTone({
			narration: "통화 녹취와 메모 필체가 결정적 증거가 됐다.",
		});

		expect(tone).toBe("evidence");
	});

	it("타임라인 키워드는 timeline tone으로 분류한다", () => {
		const tone = inferNewsSurfaceTone({
			newsExcerpt: "실종 당일 이후 며칠 뒤까지의 타임라인을 다시 정리했다.",
		});

		expect(tone).toBe("timeline");
	});

	it("timeline tone 뉴스 카드는 날짜를 상단 배지로 분리한다", () => {
		const theme = getNewsCardTheme({
			mood: "neutral",
			tone: "timeline",
		});

		expect(theme.datePlacement).toBe("badge");
		expect(theme.dateBadge).toBeTruthy();
	});

	it("중립 mood는 archive 카드 테마를 쓴다", () => {
		const theme = getNewsCardTheme({
			mood: "neutral",
		});

		expect(theme.variant).toBe("archive");
		expect(theme.label.text).toBe("ARCHIVE");
		expect(String(theme.card.borderTop)).toContain("solid");
	});

	it("breaking 로워서드는 LIVE 배지를 사용한다", () => {
		const theme = getLowerThirdTheme({
			mood: "news",
			hookBoost: true,
		});

		expect(theme.variant).toBe("breaking");
		expect(theme.badge.text).toBe("LIVE");
	});

	it("dossier 로워서드는 SOURCE 배지와 모노스페이스를 사용한다", () => {
		const theme = getLowerThirdTheme({
			mood: "horror",
		});

		expect(theme.variant).toBe("dossier");
		expect(theme.badge.text).toBe("SOURCE");
		expect(String(theme.source.fontFamily)).toContain("JetBrains Mono");
	});

	it("tone에 따라 배지 문구가 달라진다", () => {
		const theme = getLowerThirdTheme({
			mood: "news",
			tone: "witness",
		});

		expect(theme.badge.text).toBe("WITNESS");
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("news-surface-theme 추가 분기", () => {
	// ─── inferNewsSurfaceTone 분기 ────────────────────────────────────────────
	it("shotKind evidence → evidence tone", () => {
		const tone = inferNewsSurfaceTone({ shotKind: "evidence" });
		expect(tone).toBe("evidence");
	});

	it("shotKind quote → witness tone", () => {
		const tone = inferNewsSurfaceTone({ shotKind: "quote" });
		expect(tone).toBe("witness");
	});

	it("shotKind context + timeline keyword → timeline tone", () => {
		const tone = inferNewsSurfaceTone({
			shotKind: "context",
			newsTitle: "사건 타임라인 정리",
		});
		expect(tone).toBe("timeline");
	});

	it("shotKind context + no keyword → generic (falls through to text check)", () => {
		const tone = inferNewsSurfaceTone({
			shotKind: "context",
			newsTitle: "일반 뉴스",
		});
		expect(tone).toBe("generic");
	});

	it("텍스트에 evidence 키워드 없음 → generic", () => {
		const tone = inferNewsSurfaceTone({ narration: "일반 나레이션" });
		expect(tone).toBe("generic");
	});

	// ─── headlineLabel 분기 ────────────────────────────────────────────────
	it("breaking + evidence tone → EVIDENCE DROP 라벨", () => {
		const theme = getNewsCardTheme({ mood: "news", tone: "evidence" });
		expect(theme.label.text).toBe("EVIDENCE DROP");
	});

	it("breaking + timeline tone → TIMELINE NOW 라벨 + dateBadge", () => {
		const theme = getNewsCardTheme({ mood: "news", tone: "timeline" });
		expect(theme.label.text).toBe("TIMELINE NOW");
		expect(theme.dateBadge).toBeTruthy();
	});

	it("breaking + witness tone → WITNESS ALERT 라벨, source italic", () => {
		const theme = getNewsCardTheme({ mood: "news", tone: "witness" });
		expect(theme.label.text).toBe("WITNESS ALERT");
		expect(theme.source.fontStyle).toBe("italic");
	});

	// ─── dossierLabel 분기 ────────────────────────────────────────────────
	it("dossier + witness tone → WITNESS LOG 라벨", () => {
		const theme = getNewsCardTheme({ mood: "mystery", tone: "witness" });
		expect(theme.label.text).toBe("WITNESS LOG");
	});

	it("dossier + evidence tone → EVIDENCE FILE 라벨 + outline", () => {
		const theme = getNewsCardTheme({ mood: "mystery", tone: "evidence" });
		expect(theme.label.text).toBe("EVIDENCE FILE");
		expect(theme.card.outline).not.toBe("none");
	});

	it("dossier + timeline tone → CASE TIMELINE 라벨 + dateBadge + datePlacement badge", () => {
		const theme = getNewsCardTheme({ mood: "mystery", tone: "timeline" });
		expect(theme.label.text).toBe("CASE TIMELINE");
		expect(theme.dateBadge).toBeTruthy();
		expect(theme.datePlacement).toBe("badge");
	});

	// ─── archiveLabel 분기 ────────────────────────────────────────────────
	it("archive + witness tone → WITNESS NOTE 라벨, source italic", () => {
		const theme = getNewsCardTheme({ mood: "neutral", tone: "witness" });
		expect(theme.label.text).toBe("WITNESS NOTE");
		expect(theme.source.fontStyle).toBe("italic");
	});

	it("archive + evidence tone → ARCHIVE EVIDENCE 라벨", () => {
		const theme = getNewsCardTheme({ mood: "neutral", tone: "evidence" });
		expect(theme.label.text).toBe("ARCHIVE EVIDENCE");
	});

	it("archive + timeline tone → ARCHIVE TIMELINE 라벨, dateBadge 있음", () => {
		const theme = getNewsCardTheme({ mood: "neutral", tone: "timeline" });
		expect(theme.label.text).toBe("ARCHIVE TIMELINE");
		expect(theme.dateBadge).toBeTruthy();
		expect(theme.datePlacement).toBe("badge");
	});

	// ─── getLowerThirdTheme: breaking 분기 ────────────────────────────────
	it("breaking lower-third + evidence → PROOF 배지", () => {
		const theme = getLowerThirdTheme({ mood: "news", tone: "evidence" });
		expect(theme.badge.text).toBe("PROOF");
	});

	it("breaking lower-third + timeline → NOW 배지", () => {
		const theme = getLowerThirdTheme({ mood: "news", tone: "timeline" });
		expect(theme.badge.text).toBe("NOW");
	});

	it("breaking lower-third + generic → LIVE 배지, source normal", () => {
		const theme = getLowerThirdTheme({ mood: "news", tone: "generic" });
		expect(theme.badge.text).toBe("LIVE");
		expect(theme.source.fontStyle).toBe("normal");
	});

	// ─── getLowerThirdTheme: dossier 분기 ────────────────────────────────
	it("dossier lower-third + evidence → EVIDENCE 배지", () => {
		const theme = getLowerThirdTheme({ mood: "mystery", tone: "evidence" });
		expect(theme.badge.text).toBe("EVIDENCE");
	});

	it("dossier lower-third + timeline → TIMELINE 배지", () => {
		const theme = getLowerThirdTheme({ mood: "mystery", tone: "timeline" });
		expect(theme.badge.text).toBe("TIMELINE");
	});

	// ─── getLowerThirdTheme: archive 분기 ────────────────────────────────
	it("archive lower-third + witness → NOTE 배지", () => {
		const theme = getLowerThirdTheme({ mood: "neutral", tone: "witness" });
		expect(theme.badge.text).toBe("NOTE");
	});

	it("archive lower-third + evidence → FILE 배지", () => {
		const theme = getLowerThirdTheme({ mood: "neutral", tone: "evidence" });
		expect(theme.badge.text).toBe("FILE");
	});

	it("archive lower-third + timeline → SEQ 배지", () => {
		const theme = getLowerThirdTheme({ mood: "neutral", tone: "timeline" });
		expect(theme.badge.text).toBe("SEQ");
	});

	it("archive lower-third + generic → ARCHIVE 배지", () => {
		const theme = getLowerThirdTheme({ mood: "neutral", tone: "generic" });
		expect(theme.badge.text).toBe("ARCHIVE");
	});

	// ─── warm mood (미테스트 팔레트) ──────────────────────────────────────
	it("warm mood → archive 테마 반환", () => {
		const theme = getNewsCardTheme({ mood: "warm" });
		expect(theme.variant).toBe("archive");
	});
});
