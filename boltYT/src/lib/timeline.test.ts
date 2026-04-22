import { describe, expect, it } from "vitest";
import {
	buildChronologicalTimeline,
	formatTimelineConstraint,
	parseDateToSortKey,
	sortByEventDate,
} from "./timeline";

describe("timeline", () => {
	it("sorts by event date only and keeps undated items at the end", () => {
		const sorted = sortByEventDate([
			{
				id: "followup",
				eventDate: "",
				pubDate: "1991-02-10",
			},
			{
				id: "incident",
				eventDate: "1991-01-29",
				pubDate: "1991-02-11",
			},
			{
				id: "archive",
				pubDate: "1991-01-15",
			},
		]);

		expect(sorted.map((item) => item.id)).toEqual([
			"incident",
			"followup",
			"archive",
		]);
	});

	it("keeps undated brief events after dated events", () => {
		const timeline = buildChronologicalTimeline(
			{
				summary: "",
				key_figures: [],
				facts: [],
				misconceptions: [],
				search_keywords: [],
				timeline: [
					{ date: "며칠 뒤", event: "수사 확대" },
					{ date: "1991-01-29", event: "실종 신고" },
				],
			},
			[],
		);

		expect(timeline.events.map((event) => event.event)).toEqual([
			"실종 신고",
			"수사 확대",
		]);
	});
});

// ─── parseDateToSortKey ───────────────────────────────────────────────────────
describe("parseDateToSortKey", () => {
	it("빈 문자열 → 0", () => {
		expect(parseDateToSortKey("")).toBe(0);
	});

	it("ISO 날짜 파싱", () => {
		const ts = parseDateToSortKey("2024-05-10");
		expect(ts).toBeGreaterThan(0);
		expect(new Date(ts).getFullYear()).toBe(2024);
	});

	it("한국어 날짜 (2024년 5월 10일)", () => {
		const ts = parseDateToSortKey("2024년 5월 10일");
		expect(ts).toBeGreaterThan(0);
		expect(new Date(ts).getFullYear()).toBe(2024);
	});

	it("점 구분 날짜 (2024.05.10)", () => {
		const ts = parseDateToSortKey("2024.05.10");
		expect(ts).toBeGreaterThan(0);
	});

	it("RFC 2822 날짜", () => {
		const ts = parseDateToSortKey("Mon, 29 Jan 2026 00:00:00 +0900");
		expect(ts).toBeGreaterThan(0);
		expect(new Date(ts).getFullYear()).toBe(2026);
	});

	it("연도만 ('2006') → 그 해 1월 1일", () => {
		const ts = parseDateToSortKey("2006");
		expect(ts).toBeGreaterThan(0);
		expect(new Date(ts).getFullYear()).toBe(2006);
	});

	it("파싱 불가 → 0", () => {
		expect(parseDateToSortKey("며칠 뒤")).toBe(0);
	});
});

// ─── buildChronologicalTimeline (추가 케이스) ─────────────────────────────────
describe("buildChronologicalTimeline (추가)", () => {
	it("타임라인 없으면 빈 이벤트 배열", () => {
		const result = buildChronologicalTimeline(
			{
				summary: "",
				key_figures: [],
				facts: [],
				misconceptions: [],
				search_keywords: [],
				timeline: [],
			},
			[],
		);
		expect(result.events).toEqual([]);
	});

	it("소스와 이벤트 키워드 매칭 → sourceIndices 반환", () => {
		const result = buildChronologicalTimeline(
			{
				summary: "",
				key_figures: [],
				facts: [],
				misconceptions: [],
				search_keywords: [],
				timeline: [{ date: "2024-01-01", event: "이태원 사건 발생" }],
			},
			[{ title: "이태원 사건 관련 기사", bodyText: "사건이 발생했다" }],
		);
		expect(result.events[0].sourceIndices).toContain(0);
	});

	it("날짜 기반 가장 가까운 소스 매칭 (키워드 미매칭)", () => {
		const result = buildChronologicalTimeline(
			{
				summary: "",
				key_figures: [],
				facts: [],
				misconceptions: [],
				search_keywords: [],
				timeline: [{ date: "2024-05-01", event: "xyz abc def" }],
			},
			[{ title: "관련 없는 제목", eventDate: "2024-04-30" }],
		);
		// 날짜 가깝고 유일 소스이므로 매칭
		expect(result.events[0].sourceIndices).toContain(0);
	});
});

// ─── sortByEventDate 추가 분기 ────────────────────────────────────────────────
describe("sortByEventDate 추가 분기", () => {
	it("같은 날짜 두 아이템 → 원래 순서 유지 (index 기반)", () => {
		const sorted = sortByEventDate([
			{ eventDate: "2024-01-01", id: "first" },
			{ eventDate: "2024-01-01", id: "second" },
		]);
		expect(sorted.map((i) => i.id)).toEqual(["first", "second"]);
	});

	it("다른 날짜 → 날짜 오름차순 정렬", () => {
		const sorted = sortByEventDate([
			{ eventDate: "2024-06-01", _id: "later" },
			{ eventDate: "2024-01-01", _id: "earlier" },
		]);
		expect(sorted.map((i) => i._id)).toEqual(["earlier", "later"]);
	});

	it("undated 두 개 → 원래 순서 유지", () => {
		const sorted = sortByEventDate([
			{ eventDate: undefined, _id: "a" },
			{ eventDate: undefined, _id: "b" },
		]);
		expect(sorted.map((i) => i._id)).toEqual(["a", "b"]);
	});
});

// ─── buildChronologicalTimeline: line 144 (dateSortKey 비교) ─────────────────
describe("buildChronologicalTimeline dateSortKey 비교 분기", () => {
	it("두 이벤트 모두 날짜 있으면 dateSortKey로 정렬", () => {
		const result = buildChronologicalTimeline(
			{
				summary: "",
				key_figures: [],
				facts: [],
				misconceptions: [],
				search_keywords: [],
				timeline: [
					{ date: "2024-12-01", event: "후기 사건" },
					{ date: "2024-01-01", event: "초기 사건" },
				],
			},
			[],
		);
		expect(result.events[0].event).toBe("초기 사건");
		expect(result.events[1].event).toBe("후기 사건");
	});
});

// ─── formatTimelineConstraint ─────────────────────────────────────────────────
describe("formatTimelineConstraint", () => {
	it("빈 이벤트 → 빈 문자열", () => {
		expect(formatTimelineConstraint({ events: [] })).toBe("");
	});

	it("이벤트 있으면 제목 포함", () => {
		const result = formatTimelineConstraint({
			events: [
				{
					date: "2024-01-01",
					dateSortKey: 1,
					event: "사건 발생",
					sourceIndices: [0, 1],
				},
			],
		});
		expect(result).toContain("사건 타임라인");
		expect(result).toContain("2024-01-01");
		expect(result).toContain("사건 발생");
		expect(result).toContain("자료0,1");
	});

	it("sourceIndices 없으면 자료 태그 생략", () => {
		const result = formatTimelineConstraint({
			events: [
				{
					date: "2024-01-01",
					dateSortKey: 1,
					event: "사건",
					sourceIndices: [],
				},
			],
		});
		expect(result).not.toContain("자료");
	});
});
