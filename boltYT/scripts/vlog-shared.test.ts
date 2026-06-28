import { describe, expect, it } from "vitest";
import {
	buildChapterMarkers,
	buildSourceDescription,
	buildSourceListLines,
	buildTextbookIllustrationPrompt,
	formatTimestamp,
	isDegenerateImageStats,
	type SourceRef,
	srtTime,
} from "./vlog-shared.ts";

describe("isDegenerateImageStats", () => {
	it("낮은 stddev(빈/솔리드) → degenerate", () => {
		expect(isDegenerateImageStats(0)).toBe(true);
		expect(isDegenerateImageStats(5)).toBe(true);
	});
	it("정상 이미지 stddev → 통과", () => {
		expect(isDegenerateImageStats(45)).toBe(false);
		expect(isDegenerateImageStats(12)).toBe(false); // 경계(threshold 미만만 reject)
	});
	it("threshold 커스텀", () => {
		expect(isDegenerateImageStats(20, 30)).toBe(true);
	});
	it("비유한 값 방어", () => {
		expect(isDegenerateImageStats(Number.NaN)).toBe(false);
	});
});

describe("buildTextbookIllustrationPrompt", () => {
	it("일러스트 스타일 prefix + 텍스트 억제 + visual 포함", () => {
		const p = buildTextbookIllustrationPrompt("a roman forum at dawn");
		expect(p).toContain("colored pencil");
		expect(p).toContain("watercolor");
		expect(p).toContain("no text");
		expect(p).toContain("a roman forum at dawn");
	});
});

describe("buildSourceListLines", () => {
	const sources: SourceRef[] = [
		{
			title: "SK하이닉스 45조 유상증자",
			source: "연합뉴스",
			date: "2026-06-26",
			url: "https://x/a",
		},
		{ url: "https://x/b" },
	];
	it("날짜·매체·제목 조합", () => {
		const lines = buildSourceListLines(sources);
		expect(lines[0]).toContain(
			"2026-06-26 · 연합뉴스 — SK하이닉스 45조 유상증자",
		);
		expect(lines[0].startsWith("· ")).toBe(true);
	});
	it("제목 없으면 URL 폴백", () => {
		expect(buildSourceListLines(sources)[1]).toContain("https://x/b");
	});
	it("max 로 개수 제한", () => {
		const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}` }));
		expect(buildSourceListLines(many, 14)).toHaveLength(14);
	});
	it("긴 줄은 말줄임", () => {
		const long = [{ title: "가".repeat(200) }];
		expect(buildSourceListLines(long)[0].length).toBeLessThanOrEqual(68);
	});
});

describe("buildSourceDescription", () => {
	it("헤더 + 메타 + URL 줄", () => {
		const d = buildSourceDescription([
			{ title: "제목", source: "연합뉴스", date: "2026", url: "https://x/a" },
		]);
		expect(d).toContain("출처 / Sources");
		expect(d).toContain("연합뉴스");
		expect(d).toContain("https://x/a");
	});
});

describe("formatTimestamp", () => {
	it("분:초 (1시간 미만)", () => {
		expect(formatTimestamp(0)).toBe("0:00");
		expect(formatTimestamp(65)).toBe("1:05");
		expect(formatTimestamp(599)).toBe("9:59");
	});
	it("시:분:초 (1시간 이상)", () => {
		expect(formatTimestamp(3661)).toBe("1:01:01");
	});
	it("음수/소수 방어", () => {
		expect(formatTimestamp(-5)).toBe("0:00");
		expect(formatTimestamp(5.9)).toBe("0:05");
	});
});

describe("buildChapterMarkers", () => {
	it("첫 챕터는 0:00 강제, 이후는 startSec", () => {
		const lines = buildChapterMarkers([
			{ title: "도입", startSec: 3 },
			{ title: "도착", startSec: 40 },
			{ title: "마무리", startSec: 120 },
		]);
		expect(lines[0]).toBe("0:00 도입");
		expect(lines[1]).toBe("0:40 도착");
		expect(lines[2]).toBe("2:00 마무리");
	});
});

describe("srtTime", () => {
	it("기본 포맷 HH:MM:SS,mmm", () => {
		expect(srtTime(0)).toBe("00:00:00,000");
		expect(srtTime(3.0)).toBe("00:00:03,000");
		expect(srtTime(75.5)).toBe("00:01:15,500");
		expect(srtTime(3661.25)).toBe("01:01:01,250");
	});
	it("ms 1000 오버플로 방지 — 초로 carry (Codex P2)", () => {
		expect(srtTime(1.9996)).toBe("00:00:02,000"); // 01,1000 아님
		expect(srtTime(59.9999)).toBe("00:01:00,000"); // 분 carry
	});
	it("음수 방어", () => {
		expect(srtTime(-1)).toBe("00:00:00,000");
	});
});
