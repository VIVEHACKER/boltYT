import { describe, expect, it } from "vitest";
import {
	beatSceneCounts,
	buildCartoonPrompt,
	decodeXml,
	isUsableArticle,
	parseRssItems,
	pickArticle,
	type RssItem,
	slugify,
	stripCdata,
} from "./make-economy.ts";

const mk = (title: string, link = "x"): RssItem => ({
	title,
	link,
	description: "",
	pubDate: "",
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[SK하이닉스 45조 유상증자]]></title><link>https://x.com/a</link><description><![CDATA[<p>반도체 &amp; HBM 투자</p>]]></description><pubDate>Mon, 26 Jun 2026</pubDate></item>
<item><title>삼성전자 실적 발표</title><link>https://x.com/b</link><description>2분기 영업이익</description></item>
<item><title>빈 링크</title><link></link><description>무시됨</description></item>
</channel></rss>`;

describe("stripCdata / decodeXml", () => {
	it("CDATA 제거", () => {
		expect(stripCdata("<![CDATA[hi]]>")).toBe("hi");
	});
	it("엔티티 디코드 + 실태그 제거", () => {
		expect(decodeXml("<p>a &amp; b</p>")).toBe("a & b");
		expect(decodeXml("&quot;인용&quot;")).toBe('"인용"');
	});
	it("이스케이프된 마크업도 디코드 후 제거(Codex P3)", () => {
		expect(decodeXml("&lt;p&gt;본문 텍스트&lt;/p&gt;")).toBe("본문 텍스트");
	});
});

describe("parseRssItems", () => {
	const items = parseRssItems(RSS);
	it("title/link 있는 항목만(빈 링크 제외)", () => {
		expect(items).toHaveLength(2);
	});
	it("CDATA title + HTML description 정리", () => {
		expect(items[0].title).toBe("SK하이닉스 45조 유상증자");
		expect(items[0].description).toBe("반도체 & HBM 투자");
	});
});

describe("pickArticle", () => {
	const items = parseRssItems(RSS);
	it("미사용 최신(선두) 선택", () => {
		expect(pickArticle(items, new Set())?.link).toBe("https://x.com/a");
	});
	it("used 는 건너뜀", () => {
		expect(pickArticle(items, new Set(["https://x.com/a"]))?.link).toBe(
			"https://x.com/b",
		);
	});
	it("topic 필터(제목/요약 포함)", () => {
		expect(pickArticle(items, new Set(), "삼성")?.link).toBe("https://x.com/b");
		expect(pickArticle(items, new Set(), "없는키워드")).toBeNull();
	});
	it("모두 used → null", () => {
		const used = new Set(items.map((i: RssItem) => i.link));
		expect(pickArticle(items, used)).toBeNull();
	});
});

describe("isUsableArticle", () => {
	it("부고/인사/증시일정 보일러플레이트 제외", () => {
		expect(isUsableArticle(mk("[부고] 홍길동씨 별세"))).toBe(false);
		expect(isUsableArticle(mk("[인사] 기획재정부 인사발령"))).toBe(false);
		expect(isUsableArticle(mk("[증시일정] 6월 26일"))).toBe(false);
	});
	it("일반 경제기사 통과", () => {
		expect(isUsableArticle(mk("SK하이닉스 45조 유상증자 결정"))).toBe(true);
	});
	it("너무 짧은 제목 제외", () => {
		expect(isUsableArticle(mk("속보"))).toBe(false);
	});
});

describe("pickArticle 보일러플레이트 스킵", () => {
	it("최신이 부고면 다음 실기사 선택", () => {
		const items = [
			mk("[부고] 홍길동씨 별세", "z"),
			mk("삼성전자 실적 발표", "b"),
		];
		expect(pickArticle(items, new Set())?.link).toBe("b");
	});
});

describe("slugify", () => {
	it("한글 유지, 특수문자 하이픈", () => {
		expect(slugify("SK하이닉스 45조!")).toBe("sk하이닉스-45조");
	});
	it("빈 결과 폴백", () => {
		expect(slugify("!!!")).toBe("economy");
	});
});

describe("beatSceneCounts", () => {
	it("4비트 합 ≈ 총씬, 각 ≥2", () => {
		const counts = beatSceneCounts(40);
		expect(counts).toHaveLength(4);
		for (const c of counts) expect(c).toBeGreaterThanOrEqual(2);
		const sum = counts.reduce((a, b) => a + b, 0);
		expect(Math.abs(sum - 40)).toBeLessThanOrEqual(2);
	});
	it("작은 총씬도 비트당 최소 2", () => {
		expect(beatSceneCounts(4).every((c) => c >= 2)).toBe(true);
	});
});

describe("buildCartoonPrompt", () => {
	it("카툰 스타일 prefix + 텍스트 억제 + visual 포함", () => {
		const p = buildCartoonPrompt("a bank vault overflowing with money");
		expect(p).toContain("flat 2D vector cartoon");
		expect(p).toContain("no text");
		expect(p).toContain("a bank vault overflowing with money");
	});
});
