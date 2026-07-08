import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildSearchUrl,
	CACHE_TTL_MS,
	collectTrendTopics,
	DEFAULT_CATEGORIES,
	DEFAULT_SP,
	extractVideosFromHtml,
	extractYtInitialData,
	isCacheFresh,
	parseViewCount,
	parseYtDlpLines,
	rankTopics,
	resolveCategories,
	type TrendTopicsFile,
	type TrendVideo,
} from "./trend-topics.ts";

// ── 픽스처: 유튜브 검색 결과 HTML 합성(네트워크 금지) ────────────────────────
type Vr = {
	videoId?: string;
	title?: unknown;
	ownerText?: unknown;
	longBylineText?: unknown;
	viewCountText?: unknown;
	publishedTimeText?: unknown;
};
const vr = (v: Vr) => ({ videoRenderer: v });
const runs = (text: string) => ({ runs: [{ text }] });
// 실제 검색 응답의 대표 트리(twoColumnSearchResultsRenderer → sectionListRenderer → itemSectionRenderer)
const makeData = (items: unknown[]) => ({
	contents: {
		twoColumnSearchResultsRenderer: {
			primaryContents: {
				sectionListRenderer: {
					contents: [{ itemSectionRenderer: { contents: items } }],
				},
			},
		},
	},
});
const makeHtml = (data: unknown) =>
	`<html><head></head><body><script>var ytInitialData = ${JSON.stringify(data)};</script><script>var other = {};</script></body></html>`;

describe("parseViewCount", () => {
	it("한국어 표기: 만/천/억", () => {
		expect(parseViewCount("조회수 12만회")).toBe(120_000);
		expect(parseViewCount("조회수 1.2만회")).toBe(12_000);
		expect(parseViewCount("조회수 5천회")).toBe(5_000);
		expect(parseViewCount("조회수 3.4억회")).toBe(340_000_000);
	});
	it("한국어 복합 단위(천만)", () => {
		expect(parseViewCount("조회수 1.2천만회")).toBe(12_000_000);
	});
	it("한국어 콤마 표기", () => {
		expect(parseViewCount("조회수 1,234회")).toBe(1_234);
	});
	it("영어 표기: K/M/B", () => {
		expect(parseViewCount("12K views")).toBe(12_000);
		expect(parseViewCount("1.2M views")).toBe(1_200_000);
		expect(parseViewCount("1.5B views")).toBe(1_500_000_000);
		expect(parseViewCount("1,234 views")).toBe(1_234);
	});
	it("라이브 시청자 표기(watching)", () => {
		expect(parseViewCount("1,234 watching")).toBe(1_234);
	});
	it("파싱 불가/빈 값 → 0", () => {
		expect(parseViewCount("No views")).toBe(0);
		expect(parseViewCount("")).toBe(0);
		expect(parseViewCount(undefined)).toBe(0);
		expect(parseViewCount(null)).toBe(0);
	});
});

describe("extractYtInitialData / extractVideosFromHtml", () => {
	it("ytInitialData JSON 을 추출한다 (뒤따르는 다른 script 에 오염되지 않음)", () => {
		const data = makeData([]);
		expect(extractYtInitialData(makeHtml(data))).toEqual(data);
	});
	it('window["ytInitialData"] 할당 형태도 지원', () => {
		const html = `<script>window["ytInitialData"] = {"a":1};</script>`;
		expect(extractYtInitialData(html)).toEqual({ a: 1 });
	});
	it("ytInitialData 부재 → null / 빈 배열", () => {
		expect(extractYtInitialData("<html></html>")).toBeNull();
		expect(extractVideosFromHtml("<html></html>")).toEqual([]);
	});
	it('JSON 문자열 내부의 "};" 에 견고하다(중괄호 균형 스캔)', () => {
		const data = { note: 'tricky "};" inside string', ok: true };
		const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
		expect(extractYtInitialData(html)).toEqual(data);
	});
	it("videoRenderer 를 재귀 수집하고 필드를 매핑한다", () => {
		const html = makeHtml(
			makeData([
				vr({
					videoId: "abc123",
					title: runs("경제 위기 총정리"),
					ownerText: runs("경제채널"),
					viewCountText: { simpleText: "조회수 12만회" },
					publishedTimeText: { simpleText: "3일 전" },
				}),
				vr({
					videoId: "def456",
					title: runs("Global Economy"),
					ownerText: runs("EconTV"),
					viewCountText: { simpleText: "1.2M views" },
				}),
				{ shelfRenderer: { title: runs("관련 없음") } },
			]),
		);
		const videos = extractVideosFromHtml(html);
		expect(videos).toHaveLength(2);
		const a = videos.find((v) => v.videoId === "abc123");
		expect(a).toMatchObject({
			title: "경제 위기 총정리",
			channel: "경제채널",
			views: 120_000,
			publishedTimeText: "3일 전",
		});
		const b = videos.find((v) => v.videoId === "def456");
		expect(b).toMatchObject({ channel: "EconTV", views: 1_200_000 });
	});
	it("videoId 중복은 1건만(dedup), videoId/title 결손은 제외", () => {
		const html = makeHtml(
			makeData([
				vr({ videoId: "dup1", title: runs("A"), ownerText: runs("ch") }),
				vr({ videoId: "dup1", title: runs("A-again"), ownerText: runs("ch") }),
				vr({ title: runs("no-id") }),
				vr({ videoId: "no-title" }),
			]),
		);
		const videos = extractVideosFromHtml(html);
		expect(videos).toHaveLength(1);
		expect(videos[0].videoId).toBe("dup1");
	});
	it("ownerText 부재 시 longBylineText 폴백", () => {
		const html = makeHtml(
			makeData([
				vr({
					videoId: "x1",
					title: runs("t"),
					longBylineText: runs("바이라인채널"),
				}),
			]),
		);
		expect(extractVideosFromHtml(html)[0].channel).toBe("바이라인채널");
	});
});

describe("parseYtDlpLines", () => {
	it("JSONL 파싱 + uploader 폴백 + view_count 결손 0", () => {
		const stdout = [
			JSON.stringify({
				id: "v1",
				title: "경제 뉴스",
				channel: "채널A",
				view_count: 5000,
			}),
			JSON.stringify({ id: "v2", title: "History Doc", uploader: "업로더B" }),
			"not-json-progress-line",
			JSON.stringify({ title: "id 없음" }),
			"",
		].join("\n");
		const videos = parseYtDlpLines(stdout);
		expect(videos).toHaveLength(2);
		expect(videos[0]).toEqual({
			videoId: "v1",
			title: "경제 뉴스",
			channel: "채널A",
			views: 5000,
		});
		expect(videos[1]).toEqual({
			videoId: "v2",
			title: "History Doc",
			channel: "업로더B",
			views: 0,
		});
	});
});

describe("rankTopics", () => {
	const mk = (videoId: string, views: number): TrendVideo => ({
		videoId,
		title: `t-${videoId}`,
		channel: "ch",
		views,
	});
	it("조회수 내림차순 정렬 + rank 1부터 부여 + watch URL 생성", () => {
		const topics = rankTopics([mk("a", 10), mk("b", 300), mk("c", 20)]);
		expect(topics.map((t) => t.rank)).toEqual([1, 2, 3]);
		expect(topics.map((t) => t.views)).toEqual([300, 20, 10]);
		expect(topics[0].url).toBe("https://www.youtube.com/watch?v=b");
	});
	it("limit 상위 N 절단(기본 20)", () => {
		const many = Array.from({ length: 30 }, (_, i) => mk(`v${i}`, i));
		expect(rankTopics(many)).toHaveLength(20);
		expect(rankTopics(many, 5)).toHaveLength(5);
		expect(rankTopics(many, 5)[0].views).toBe(29);
	});
	it("videoId/title 빈 항목 제외", () => {
		const topics = rankTopics([
			mk("ok", 1),
			{ ...mk("", 99) },
			{ ...mk("x", 50), title: "" },
		]);
		expect(topics).toHaveLength(1);
		expect(topics[0].url).toContain("v=ok");
	});
});

describe("isCacheFresh", () => {
	const now = Date.parse("2026-07-07T12:00:00Z");
	it("24h 이내 → 신선", () => {
		expect(isCacheFresh("2026-07-07T00:00:00Z", now)).toBe(true);
		expect(isCacheFresh("2026-07-06T12:00:01Z", now)).toBe(true);
	});
	it("24h 경과 → 스테일", () => {
		expect(isCacheFresh("2026-07-06T12:00:00Z", now)).toBe(false);
		expect(isCacheFresh("2026-07-01T00:00:00Z", now)).toBe(false);
	});
	it("결손/비정상 문자열 → 스테일", () => {
		expect(isCacheFresh(undefined, now)).toBe(false);
		expect(isCacheFresh(null, now)).toBe(false);
		expect(isCacheFresh("not-a-date", now)).toBe(false);
	});
	it("ttl 커스텀", () => {
		expect(isCacheFresh("2026-07-07T11:00:00Z", now, 30 * 60 * 1000)).toBe(
			false,
		);
		expect(CACHE_TTL_MS).toBe(86_400_000);
	});
});

describe("resolveCategories / buildSearchUrl", () => {
	it("env 미설정 → 기본셋(경제/역사/쇼핑)", () => {
		expect(resolveCategories(undefined)).toEqual(DEFAULT_CATEGORIES);
		expect(DEFAULT_CATEGORIES).toEqual(["경제", "역사", "쇼핑"]);
	});
	it("env 콤마 목록 오버라이드(공백 트림, 빈 항목 제거)", () => {
		expect(resolveCategories("경제, 게임 ,,")).toEqual(["경제", "게임"]);
		expect(resolveCategories("  ")).toEqual(DEFAULT_CATEGORIES);
	});
	it("검색 URL: 쿼리 인코딩 + sp(기본 조회수순) 그대로 결합", () => {
		const url = buildSearchUrl("경제", DEFAULT_SP);
		expect(url).toBe(
			`https://www.youtube.com/results?search_query=${encodeURIComponent("경제")}&sp=CAMSBAgCEAE%3D`,
		);
	});
});

// ── collectTrendTopics: fs+주입 fetch 통합(네트워크/서브프로세스 금지) ────────
describe("collectTrendTopics", () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});
	const NOW = Date.parse("2026-07-07T12:00:00Z");
	const fetchNever: typeof fetch = () => {
		throw new Error("네트워크 호출 금지 위반");
	};
	const htmlFor = (videoId: string, title: string, viewText: string) =>
		makeHtml(
			makeData([
				vr({
					videoId,
					title: runs(title),
					ownerText: runs("ch"),
					viewCountText: { simpleText: viewText },
				}),
			]),
		);

	it("신선 + 요청 카테고리 전부 채워짐 → fetch 없이 스킵", async () => {
		dir = mkdtempSync(join(tmpdir(), "trend-topics-"));
		const outPath = join(dir, "trend_topics.json");
		const cached: TrendTopicsFile = {
			fetchedAt: "2026-07-07T01:00:00Z",
			categories: {
				경제: {
					query: "경제",
					topics: [{ rank: 1, title: "t", channel: "c", views: 9, url: "u" }],
				},
			},
		};
		writeFileSync(outPath, JSON.stringify(cached));
		const res = await collectTrendTopics({
			outPath,
			categories: ["경제"],
			now: () => NOW,
			fetchImpl: fetchNever,
			useYtDlpFallback: false,
			log: () => {},
		});
		expect(res.skipped).toBe(true);
		expect(res.data?.fetchedAt).toBe("2026-07-07T01:00:00Z");
	});

	it("신선하나 캐시 카테고리 topics 비어있음 → stale 취급, 재수집", async () => {
		dir = mkdtempSync(join(tmpdir(), "trend-topics-"));
		const outPath = join(dir, "trend_topics.json");
		// 24h 이내지만 경제 topics:[] (이전 수집 0건 보존) → 굶기지 않도록 재시도해야 함
		const cached: TrendTopicsFile = {
			fetchedAt: "2026-07-07T01:00:00Z",
			categories: { 경제: { query: "경제", topics: [] } },
		};
		writeFileSync(outPath, JSON.stringify(cached));
		const fetchStub: typeof fetch = async () =>
			new Response(htmlFor("vid-경제", "경제 영상", "조회수 4만회"));
		const res = await collectTrendTopics({
			outPath,
			categories: ["경제"],
			now: () => NOW,
			fetchImpl: fetchStub,
			useYtDlpFallback: false,
			log: () => {},
		});
		expect(res.skipped).toBe(false);
		expect(res.data?.categories.경제.topics).toHaveLength(1);
	});

	it("신선하나 요청 카테고리 누락 → 스킵 안 하고 누락분 수집", async () => {
		dir = mkdtempSync(join(tmpdir(), "trend-topics-"));
		const outPath = join(dir, "trend_topics.json");
		// 경제만 있는 신선 캐시인데 경제+역사 요청 → 역사 굶기지 않도록 재수집해야 함
		const cached: TrendTopicsFile = {
			fetchedAt: "2026-07-07T01:00:00Z",
			categories: { 경제: { query: "경제", topics: [] } },
		};
		writeFileSync(outPath, JSON.stringify(cached));
		const fetchStub: typeof fetch = async (input) => {
			const cat = decodeURIComponent(String(input)).includes("역사")
				? "역사"
				: "경제";
			return new Response(htmlFor(`vid-${cat}`, `${cat} 영상`, "조회수 5만회"));
		};
		const res = await collectTrendTopics({
			outPath,
			categories: ["경제", "역사"],
			now: () => NOW,
			fetchImpl: fetchStub,
			useYtDlpFallback: false,
			log: () => {},
		});
		expect(res.skipped).toBe(false);
		expect(res.data?.categories.역사.topics).toHaveLength(1);
	});

	it("--force → 재수집 후 계약 스키마로 기록", async () => {
		dir = mkdtempSync(join(tmpdir(), "trend-topics-"));
		const outPath = join(dir, "sub", "trend_topics.json");
		const fetchStub: typeof fetch = async (input) => {
			const q = decodeURIComponent(String(input));
			const cat = q.includes("경제") ? "경제" : "역사";
			return new Response(htmlFor(`vid-${cat}`, `${cat} 영상`, "조회수 3만회"));
		};
		const res = await collectTrendTopics({
			outPath,
			categories: ["경제", "역사"],
			force: true,
			now: () => NOW,
			fetchImpl: fetchStub,
			useYtDlpFallback: false,
			log: () => {},
		});
		expect(res.skipped).toBe(false);
		const written = JSON.parse(
			readFileSync(outPath, "utf-8"),
		) as TrendTopicsFile;
		expect(written.fetchedAt).toBe(new Date(NOW).toISOString());
		expect(written.categories.경제.query).toBe("경제");
		expect(written.categories.경제.topics[0]).toEqual({
			rank: 1,
			title: "경제 영상",
			channel: "ch",
			views: 30_000,
			url: "https://www.youtube.com/watch?v=vid-경제",
		});
		expect(written.categories.역사.topics).toHaveLength(1);
	});

	it("전 카테고리 실패 → 기존 캐시 미덮어쓰기 + throw 없음", async () => {
		dir = mkdtempSync(join(tmpdir(), "trend-topics-"));
		const outPath = join(dir, "trend_topics.json");
		const cached: TrendTopicsFile = {
			fetchedAt: "2026-07-01T00:00:00Z", // 스테일 → 재수집 시도
			categories: {
				경제: {
					query: "경제",
					topics: [
						{ rank: 1, title: "이전", channel: "c", views: 1, url: "u" },
					],
				},
			},
		};
		writeFileSync(outPath, JSON.stringify(cached));
		const failFetch: typeof fetch = async () => {
			throw new Error("network down");
		};
		const res = await collectTrendTopics({
			outPath,
			categories: ["경제"],
			now: () => NOW,
			fetchImpl: failFetch,
			useYtDlpFallback: false,
			log: () => {},
		});
		expect(res.skipped).toBe(false);
		expect(res.warnings.some((w) => w.includes("network down"))).toBe(true);
		// 파일은 그대로 — fetchedAt 미변경
		const kept = JSON.parse(readFileSync(outPath, "utf-8")) as TrendTopicsFile;
		expect(kept.fetchedAt).toBe("2026-07-01T00:00:00Z");
		expect(kept.categories.경제.topics[0].title).toBe("이전");
	});

	it("일부 카테고리만 실패 → 실패분은 이전 캐시 항목 보전", async () => {
		dir = mkdtempSync(join(tmpdir(), "trend-topics-"));
		const outPath = join(dir, "trend_topics.json");
		const cached: TrendTopicsFile = {
			fetchedAt: "2026-07-01T00:00:00Z",
			categories: {
				역사: {
					query: "역사",
					topics: [
						{ rank: 1, title: "역사-이전", channel: "c", views: 7, url: "u" },
					],
				},
			},
		};
		writeFileSync(outPath, JSON.stringify(cached));
		const fetchStub: typeof fetch = async (input) => {
			if (decodeURIComponent(String(input)).includes("역사"))
				throw new Error("timeout");
			return new Response(htmlFor("eco1", "경제 최신", "조회수 9만회"));
		};
		const res = await collectTrendTopics({
			outPath,
			categories: ["경제", "역사"],
			now: () => NOW,
			fetchImpl: fetchStub,
			useYtDlpFallback: false,
			log: () => {},
		});
		expect(res.skipped).toBe(false);
		const written = JSON.parse(
			readFileSync(outPath, "utf-8"),
		) as TrendTopicsFile;
		expect(written.fetchedAt).toBe(new Date(NOW).toISOString());
		expect(written.categories.경제.topics[0].views).toBe(90_000);
		expect(written.categories.역사.topics[0].title).toBe("역사-이전"); // 캐시 보전
	});
});
