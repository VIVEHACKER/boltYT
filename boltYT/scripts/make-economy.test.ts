import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	beatSceneCounts,
	buildCartoonPrompt,
	containsInvestmentAdvice,
	decodeXml,
	ECON_ANGLES,
	estimateSceneCount,
	extractKeywords,
	groundingContext,
	hashStr,
	isUsableArticle,
	loadYoutubeTrendTerms,
	parseRssItems,
	parseTrendTerms,
	pickAngle,
	pickArticle,
	publisherFromUrl,
	type RssItem,
	relatedArticles,
	SCENE_CAP,
	scenesNeeded,
	scoreEmotionalAngle,
	scoreTrend,
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

describe("estimateSceneCount (길이 보정)", () => {
	it("~16초/씬 기준 환산", () => {
		expect(estimateSceneCount(3)).toBe(11); // round(180/16)
		expect(estimateSceneCount(15)).toBe(56); // round(900/16)
	});
	it("최소 8씬 floor", () => {
		expect(estimateSceneCount(1)).toBe(8); // round(60/16)=4 → 8
	});
	it("SCENE_CAP 상한", () => {
		expect(estimateSceneCount(60)).toBe(SCENE_CAP); // round(3600/18)=200 → cap
	});
});

describe("scenesNeeded (measure-and-extend)", () => {
	it("목표 충족/초과 → 0", () => {
		expect(scenesNeeded(180, 180, 18, 40)).toBe(0);
		expect(scenesNeeded(180, 200, 18, 40)).toBe(0);
	});
	it("부족분 / 평균 → 추가 씬수", () => {
		expect(scenesNeeded(180, 90, 18, 40)).toBe(5); // ceil(90/18)
	});
	it("남은 캡으로 제한", () => {
		expect(scenesNeeded(180, 90, 18, 3)).toBe(3);
	});
	it("avg 0 방어(최소 6초/씬)", () => {
		expect(scenesNeeded(180, 90, 0, 40)).toBe(15); // ceil(90/6)
	});
	it("작은 부족분도 최소 2씬", () => {
		expect(scenesNeeded(180, 178, 18, 40)).toBe(2);
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

describe("parseTrendTerms", () => {
	const TRENDS = `<?xml version="1.0"?><rss><channel><title>Daily Search Trends</title>
<item><title>SK하이닉스</title><link>https://t/a</link></item>
<item><title><![CDATA[삼성전자]]></title></item>
</channel></rss>`;
	it("item title(검색어)만 추출, 채널 title 제외", () => {
		const terms = parseTrendTerms(TRENDS);
		expect(terms).toEqual(["SK하이닉스", "삼성전자"]);
	});
	it("빈/깨진 XML → 빈 배열", () => {
		expect(parseTrendTerms("")).toEqual([]);
	});
});

describe("scoreTrend", () => {
	const mkD = (title: string, description = ""): RssItem => ({
		title,
		link: "x",
		description,
		pubDate: "",
	});
	it("제목 매치 가중 2, 요약 매치 가중 1", () => {
		expect(scoreTrend(mkD("SK하이닉스 유상증자"), ["SK하이닉스"])).toBe(2);
		expect(
			scoreTrend(mkD("증자 소식", "SK하이닉스 관련"), ["SK하이닉스"]),
		).toBe(1);
	});
	it("1글자 검색어 무시, 무매치 0", () => {
		expect(scoreTrend(mkD("삼성전자"), ["A"])).toBe(0);
		expect(scoreTrend(mkD("삼성전자"), ["없는키워드"])).toBe(0);
	});
});

describe("pickArticle 트렌드 정렬", () => {
	const items = [
		mk("일반 경제 기사입니다", "a"),
		mk("SK하이닉스 45조 유상증자 결정", "b"),
	];
	it("트렌드 매치 기사를 최신보다 우선", () => {
		expect(pickArticle(items, new Set(), undefined, ["SK하이닉스"])?.link).toBe(
			"b",
		);
	});
	it("트렌드 0점이면 최신순(선두) 유지", () => {
		expect(pickArticle(items, new Set(), undefined, ["없는것"])?.link).toBe(
			"a",
		);
	});
	it("빈 terms 면 현행 최신순", () => {
		expect(pickArticle(items, new Set(), undefined, [])?.link).toBe("a");
	});
});

describe("scoreEmotionalAngle", () => {
	const mkD = (title: string, description = ""): RssItem => ({
		title,
		link: "x",
		description,
		pubDate: "",
	});
	it("제목 감정마커 가중 2, 요약 가중 1", () => {
		expect(scoreEmotionalAngle(mkD("삼성, 사상 최대 실적"))).toBe(2);
		expect(scoreEmotionalAngle(mkD("실적 발표", "코스피 폭락"))).toBe(1);
		expect(scoreEmotionalAngle(mkD("역대급 돌파", "위기 충격"))).toBe(3);
	});
	it("감정 마커 없으면 0", () => {
		expect(scoreEmotionalAngle(mkD("환율 소폭 변동", "보합세"))).toBe(0);
	});
});

describe("pickArticle 감정 앵글", () => {
	const items = [
		mk("환율 보합세 마감", "a"),
		mk("삼성전자 사상 최대 실적 충격", "b"),
	];
	it("emotional on → 감정 강도 높은 기사 우선", () => {
		expect(
			pickArticle(items, new Set(), undefined, undefined, true)?.link,
		).toBe("b");
	});
	it("emotional off(기본) → 최신순 유지", () => {
		expect(pickArticle(items, new Set())?.link).toBe("a");
	});
});

describe("publisherFromUrl", () => {
	it("등록 도메인 → 한글 매체명", () => {
		expect(publisherFromUrl("https://www.yna.co.kr/view/AKR1")).toBe(
			"연합뉴스",
		);
		expect(publisherFromUrl("https://hankyung.com/x")).toBe("한국경제");
	});
	it("미등록 도메인 → 호스트명", () => {
		expect(publisherFromUrl("https://example.com/x")).toBe("example.com");
	});
	it("잘못된 URL → 빈 문자열", () => {
		expect(publisherFromUrl("not a url")).toBe("");
	});
});

describe("extractKeywords", () => {
	it("길이≥2 토큰, 중복 제거, 소문자", () => {
		expect(extractKeywords("SK하이닉스 45조 SK 유상증자")).toEqual([
			"sk하이닉스",
			"45조",
			"유상증자",
		]);
	});
});

describe("relatedArticles", () => {
	const mkF = (title: string, link: string, description = ""): RssItem => ({
		title,
		link,
		description,
		pubDate: "",
	});
	const primary = mkF("SK하이닉스 45조 유상증자 결정", "p");
	const items = [
		primary,
		mkF("SK하이닉스 HBM 증설", "a", "유상증자 자금 활용"),
		mkF("삼성전자 실적 발표", "b"),
		mkF("코스피 마감 시황", "c"),
	];
	it("키워드 겹치는 기사만 점수순으로", () => {
		const r = relatedArticles(items, primary, new Set());
		expect(r.map((x) => x.link)).toEqual(["a"]);
	});
	it("primary/used 제외", () => {
		expect(
			relatedArticles(items, primary, new Set(["a"])).map((x) => x.link),
		).toEqual([]);
	});
	it("max 로 상한", () => {
		const many = [
			primary,
			mkF("SK하이닉스 유상증자 분석", "x"),
			mkF("SK하이닉스 유상증자 영향", "y"),
		];
		expect(relatedArticles(many, primary, new Set(), 1)).toHaveLength(1);
	});
});

describe("groundingContext", () => {
	const primary: RssItem = {
		title: "제목A",
		link: "p",
		description: "요약A",
		pubDate: "",
	};
	it("본문/관련보도 있으면 포함", () => {
		const c = groundingContext({
			primary,
			body: "본문발췌",
			related: [{ title: "관련B", link: "b", description: "", pubDate: "" }],
		});
		expect(c).toContain("제목A");
		expect(c).toContain("기사 본문(발췌): 본문발췌");
		expect(c).toContain("- 관련B");
	});
	it("본문/관련보도 없으면 제목+요약만", () => {
		const c = groundingContext({ primary, body: "", related: [] });
		expect(c).toContain("제목A");
		expect(c).not.toContain("기사 본문");
		expect(c).not.toContain("관련 보도");
	});
});

describe("hashStr", () => {
	it("결정적 — 같은 입력 같은 해시", () => {
		expect(hashStr("삼성전자")).toBe(hashStr("삼성전자"));
	});
	it("다른 입력 다른 해시(충돌 낮음) + 32bit 부호없음", () => {
		expect(hashStr("a")).not.toBe(hashStr("b"));
		expect(hashStr("긴 문자열 시드 test")).toBeGreaterThanOrEqual(0);
		expect(hashStr("긴 문자열 시드 test")).toBeLessThanOrEqual(0xffffffff);
	});
});

describe("pickAngle — 해설 앵글 로테이션", () => {
	it("결정적 — 같은 seed 같은 앵글", () => {
		expect(pickAngle("seed-x").key).toBe(pickAngle("seed-x").key);
	});
	it("seed 로 로테이션 — 여러 seed 가 4앵글 전부 커버", () => {
		const keys = new Set(
			Array.from({ length: 60 }, (_, i) => pickAngle(`article-${i}`).key),
		);
		expect(keys.size).toBe(ECON_ANGLES.length); // 4종 전부 등장
	});
	it("override(key/label) 강제", () => {
		expect(pickAngle("any", "contrarian").key).toBe("contrarian");
		expect(pickAngle("any", "숨은 원인").key).toBe("hidden-cause");
	});
	it("미매칭 override 는 무시하고 로테이션 유지", () => {
		expect(pickAngle("seed-x", "emotional").key).toBe(pickAngle("seed-x").key);
		expect(pickAngle("seed-x", "없는앵글").key).toBe(pickAngle("seed-x").key);
	});
	it("항상 유효 앵글 반환", () => {
		const a = pickAngle("무엇이든");
		expect(ECON_ANGLES.some((x) => x.key === a.key)).toBe(true);
	});
});

describe("containsInvestmentAdvice (YMYL 게이트)", () => {
	it("투자 조언/가격 예측 어투 감지", () => {
		expect(containsInvestmentAdvice("지금 삼성전자 매수 타이밍")).toBe(true);
		expect(containsInvestmentAdvice("목표주가 10만원, 반드시 오른다")).toBe(
			true,
		);
		expect(containsInvestmentAdvice("이 종목 담아야 합니다")).toBe(true);
		expect(containsInvestmentAdvice("고점 매도 후 저점 매수")).toBe(true);
	});
	it("사실 해설/맥락 문구는 통과(오탐 아님)", () => {
		expect(
			containsInvestmentAdvice("삼성전자 실적이 시장 예상을 밑돌았다"),
		).toBe(false);
		expect(
			containsInvestmentAdvice("반도체 업황이 왜 중요한지 맥락을 짚는다"),
		).toBe(false);
		expect(containsInvestmentAdvice("")).toBe(false);
	});
});

describe("loadYoutubeTrendTerms", () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});
	it("경제 카테고리 제목 → 키워드 추출·dedup", () => {
		dir = mkdtempSync(join(tmpdir(), "econ-trend-"));
		const p = join(dir, "trend_topics.json");
		writeFileSync(
			p,
			JSON.stringify({
				categories: {
					경제: {
						topics: [
							{ title: "삼성전자 실적 급락" },
							{ title: "삼성전자 반도체 전망" },
						],
					},
					역사: { topics: [{ title: "신라 역사" }] },
				},
			}),
		);
		const terms = loadYoutubeTrendTerms(p);
		expect(terms).toContain("삼성전자");
		expect(terms).toContain("반도체");
		expect(terms.filter((t) => t === "삼성전자")).toHaveLength(1); // dedup
		expect(terms).not.toContain("신라"); // 다른 카테고리 제외
	});
	it("파일 없음/손상 → 빈 배열(비파괴)", () => {
		expect(loadYoutubeTrendTerms("/tmp/__no_such_trend__.json")).toEqual([]);
		dir = mkdtempSync(join(tmpdir(), "econ-trend-"));
		const bad = join(dir, "bad.json");
		writeFileSync(bad, "{ not json");
		expect(loadYoutubeTrendTerms(bad)).toEqual([]);
	});
});
