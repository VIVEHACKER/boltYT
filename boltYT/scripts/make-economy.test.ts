import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	beatSceneCounts,
	buildCartoonPrompt,
	compositionIdFor,
	containsInvestmentAdvice,
	containsUnsafeEconomyClaim,
	decodeXml,
	ECON_ANGLES,
	estimateSceneCount,
	estimateShortsSceneCount,
	estimateShortsTotalSec,
	extractKeywords,
	findGroundingModalityViolations,
	findUngroundedNumberViolations,
	groundingContext,
	hashStr,
	isRenderQcAcceptable,
	isUsableArticle,
	loadYoutubeTrendTerms,
	minimumLongformBodySeconds,
	outputStem,
	parseEconomySourceManifest,
	parseGeneratedEconomyScenes,
	parseGroundingClaimAudit,
	parseRssItems,
	parseTrendTerms,
	pickAngle,
	pickArticle,
	publisherFromUrl,
	type RssItem,
	readEconomySourceManifest,
	regenImagePath,
	relatedArticles,
	requireGroundingBody,
	SCENE_CAP,
	SHORTS_BEATS,
	SHORTS_MAX_SEC,
	sanitizeCartoonVisualPrompt,
	sceneImageDims,
	scenesNeeded,
	scoreEmotionalAngle,
	scoreTrend,
	slugify,
	sourceGroundedThumbnailText,
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

describe("sanitizeCartoonVisualPrompt", () => {
	it("가짜 글자를 유발하는 숫자·보드·문서 표현을 상징 그래픽으로 치환", () => {
		const out = sanitizeCartoonVisualPrompt(
			"A digital exchange-rate board displaying 1501.4, a Nasdaq ticker board, and a checklist document",
		);
		expect(out).not.toMatch(/1501|displaying|ticker board|checklist|document/i);
		expect(out).toMatch(/unlabeled|blank/i);
	});

	it("기호 유발 저금통은 치환하고 나머지 생활 피사체는 보존", () => {
		const out = sanitizeCartoonVisualPrompt(
			"A piggy bank beside a shopping cart and an airplane",
		);
		expect(out).not.toContain("piggy bank");
		expect(out).toContain("closed rounded savings container");
		expect(out).toContain("shopping cart");
	});

	it("암호화폐 기호를 유발하는 통화·동전 토큰을 흐름 화살표로 치환", () => {
		const out = sanitizeCartoonVisualPrompt(
			"gold coins, dollar money, a Nasdaq building, a piggy bank, a flag, and a market graph around a city",
		);
		expect(out).not.toMatch(
			/\b(?:coin|dollar|money|currency|nasdaq|piggy|flag|graph)\b/i,
		);
		expect(out).toContain("flow arrows");
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

describe("economy source manifest", () => {
	let sourceDir = "";
	afterEach(() => {
		if (sourceDir) rmSync(sourceDir, { recursive: true, force: true });
		sourceDir = "";
	});
	it("같은 기사 소스를 쇼츠·롱폼에 재사용할 수 있게 정규화", () => {
		const source = parseEconomySourceManifest({
			version: 1,
			selectedAt: "2026-07-10T00:00:00.000Z",
			article: {
				title: "한국은행 기준금리 동결",
				link: "https://example.com/economy/1",
				description: "물가와 성장 경로를 함께 점검했다.",
				pubDate: "2026-07-10",
			},
		});
		expect(source.article.title).toBe("한국은행 기준금리 동결");
		expect(source.article.link).toBe("https://example.com/economy/1");
	});

	it("필수 기사 필드가 없거나 URL이 공개 HTTPS가 아니면 거부", () => {
		expect(() =>
			parseEconomySourceManifest({ article: { title: "제목", link: "" } }),
		).toThrow(/source/i);
		expect(() =>
			parseEconomySourceManifest({
				article: { title: "제목입니다", link: "file://local" },
			}),
		).toThrow(/source/i);
		expect(() =>
			parseEconomySourceManifest({
				article: { title: "제목입니다", link: "http://example.com/news" },
			}),
		).toThrow(/source/i);
		expect(() =>
			parseEconomySourceManifest({
				article: { title: "제목입니다", link: "https://127.0.0.1/news" },
			}),
		).toThrow(/source/i);
	});

	it("파일에서 source manifest를 읽고 기본 선택 시각을 채움", () => {
		sourceDir = mkdtempSync(join(tmpdir(), "econ-source-"));
		const path = join(sourceDir, "source.json");
		writeFileSync(
			path,
			JSON.stringify({
				article: {
					title: "원달러 환율 변동성 확대",
					link: "https://example.com/economy/2",
					description: "",
					pubDate: "",
				},
			}),
		);
		const source = readEconomySourceManifest(path);
		expect(source.version).toBe(1);
		expect(Number.isNaN(Date.parse(source.selectedAt))).toBe(false);
	});
});

describe("parseGeneratedEconomyScenes", () => {
	it("내레이션과 visual이 모두 있는 씬만 정규화", () => {
		expect(
			parseGeneratedEconomyScenes({
				scenes: [
					{ narration: " 핵심 사실 ", visual: " market chart " },
					{ narration: "", visual: "empty narration" },
					{ narration: "missing visual" },
				],
			}),
		).toEqual([{ narration: "핵심 사실", visual: "market chart" }]);
	});

	it("배열이 아니면 빈 씬 목록", () => {
		expect(parseGeneratedEconomyScenes({ scenes: "invalid" })).toEqual([]);
		expect(parseGeneratedEconomyScenes(null)).toEqual([]);
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

describe("minimumLongformBodySeconds", () => {
	it("요청 길이의 90%를 기본 완료 하한으로 고정", () => {
		expect(minimumLongformBodySeconds(480)).toBe(432);
		expect(minimumLongformBodySeconds(60, 0.95)).toBe(57);
	});

	it("운영 오설정도 하드 하한 90% 아래로 완화할 수 없음", () => {
		expect(minimumLongformBodySeconds(100, 0.1)).toBe(90);
		expect(minimumLongformBodySeconds(100, 2)).toBe(100);
		expect(minimumLongformBodySeconds(100, Number.NaN)).toBe(90);
	});
});

describe("buildCartoonPrompt", () => {
	it("카툰 스타일 prefix + text-free 유도 + visual 포함, infographic 미포함", () => {
		const p = buildCartoonPrompt("a bank vault overflowing with money");
		expect(p).toContain("flat 2D vector cartoon");
		expect(p).toContain("text-free");
		expect(p).not.toContain("infographic"); // 텍스트 유발어 제거
		expect(p).toContain(
			"a bank vault overflowing with abstract opposing flow arrows",
		);
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
	it("상장·나스닥 같은 일반어만 겹치는 다른 기업 기사는 제외", () => {
		const fxPrimary = mkF(
			"하이닉스 ADR 상장 기대·달러 약세에 환율 장중 1,500원 하회",
			"fx",
		);
		const candidates = [
			fxPrimary,
			mkF("스페이스X 나스닥 상장 추진", "space"),
			mkF("하이닉스 ADR 상장 앞두고 환율 하락", "hynix"),
		];
		expect(
			relatedArticles(candidates, fxPrimary, new Set()).map(
				(article) => article.link,
			),
		).toEqual(["hynix"]);
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

describe("requireGroundingBody", () => {
	it("본문 공백을 정규화하고 빈 본문은 fail-closed", () => {
		expect(requireGroundingBody("  실제   기사\n본문  ")).toBe(
			"실제 기사 본문",
		);
		expect(() => requireGroundingBody(" \n\t ")).toThrow(/RSS 요약만/);
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

describe("containsUnsafeEconomyClaim (최종 산출물 YMYL 게이트)", () => {
	it("직접 권유·수익 보장·근거 없는 방향 예측을 차단", () => {
		expect(containsUnsafeEconomyClaim("지금 삼성전자를 매수하세요")).toBe(true);
		expect(containsUnsafeEconomyClaim("이 종목은 반드시 오를 것입니다")).toBe(
			true,
		);
		expect(containsUnsafeEconomyClaim("수익을 보장하는 추천 종목")).toBe(true);
	});

	it("시장 수급을 설명하는 사실 문장은 오탐하지 않음", () => {
		expect(
			containsUnsafeEconomyClaim("외국인은 장중 2천억 원을 순매수했습니다"),
		).toBe(false);
		expect(
			containsUnsafeEconomyClaim("기관 매도세가 지수 변동성을 키웠습니다"),
		).toBe(false);
	});

	// 회귀: fail-open 이었던 케이스 — 조사(을/를) 삽입, '팔아야' 활용형, 예측 종결형.
	it("목적격 조사·활용형·종결형 권유·예측을 차단(fail-open 회귀 방지)", () => {
		expect(containsUnsafeEconomyClaim("삼성전자 매수를 추천합니다")).toBe(true);
		expect(containsUnsafeEconomyClaim("포트폴리오 비중을 확대하세요")).toBe(
			true,
		);
		expect(containsUnsafeEconomyClaim("이 주식은 당장 팔아야 합니다")).toBe(
			true,
		);
		expect(containsUnsafeEconomyClaim("삼성전자는 반드시 오릅니다")).toBe(true);
		expect(containsUnsafeEconomyClaim("주가가 폭락할 것입니다")).toBe(true);
	});

	// 회귀: 사실 서술형(순매수/매도세/상승 마감)은 계속 통과해야 함(오탐 금지).
	it("사실 서술형 수급·시황 문장은 넓힌 정규식에도 계속 통과", () => {
		expect(containsUnsafeEconomyClaim("외국인 순매수가 이어졌다")).toBe(false);
		expect(containsUnsafeEconomyClaim("기관 매도세가 강했다")).toBe(false);
		expect(containsUnsafeEconomyClaim("코스피가 상승 마감했다")).toBe(false);
	});
});

describe("regenImagePath (확장 씬 재생성 경로 충돌 방지)", () => {
	it("엔트리의 기존 img 경로를 그대로 반환", () => {
		expect(regenImagePath({ img: "/w/extension-1-1.png" })).toBe(
			"/w/extension-1-1.png",
		);
		expect(regenImagePath({ img: "/w/scene0.png" })).toBe("/w/scene0.png");
	});

	it("확장 씬 삽입 후에도 재생성 대상이 서로 충돌하지 않음", () => {
		// 원본 scene1 이 확장 씬(index 1) 삽입으로 index 2 로 시프트된 상태.
		const made = [
			{ img: "/w/scene0.png" },
			{ img: "/w/extension-1-1.png" },
			{ img: "/w/scene1.png" },
		];
		// 옛 버그: `scene${i}.png` 로 재생성하면 확장 엔트리(i=1)가 made[2] 의 파일을 덮어씀.
		const buggyTarget = (i: number) => `/w/scene${i}.png`;
		expect(buggyTarget(1)).toBe(made[2].img); // 충돌 증거
		// 수정: 각 엔트리는 자기 경로로 재생성 → 대상이 모두 유일.
		const targets = made.map((m) => regenImagePath(m));
		expect(new Set(targets).size).toBe(targets.length);
		expect(regenImagePath(made[1])).toBe("/w/extension-1-1.png");
	});
});

describe("sourceGroundedThumbnailText", () => {
	it("기사 제목에 실제로 있는 숫자와 핵심어만 10자 이내로 사용", () => {
		const text = sourceGroundedThumbnailText(
			"하이닉스 ADR 기대에 환율 장중 1,500원 하회",
		);
		expect(text).toBe("환율 1,500원");
		expect(Array.from(text).length).toBeLessThanOrEqual(10);
	});

	it("숫자가 없으면 기사 핵심어로 폴백", () => {
		expect(sourceGroundedThumbnailText("기준금리 동결 배경")).toBe("기준금리");
	});
});

describe("findGroundingModalityViolations (출처 확실성 게이트)", () => {
	const expectedSource = {
		title: "하이닉스 ADR 상장 기대",
		description: "최대 40조 원 조달을 추진한다는 보도",
	};

	it("전망·추진을 완료 사실로 바꾼 기업 이벤트를 차단", () => {
		expect(
			findGroundingModalityViolations(expectedSource, [
				"SK하이닉스가 ADR로 40조 원을 조달합니다",
				"공모가는 149달러로 확정됐는데 시장이 반응했습니다",
			]),
		).toEqual([0, 1]);
		expect(
			findGroundingModalityViolations(expectedSource, [
				"상장하면서 약 40조 원을 조달했는데요",
				"이번 상장으로 약 40조 원을 조달하는데 시장이 반응했습니다",
			]),
		).toEqual([0, 1]);
	});

	it("불확실성을 보존한 문장과 확정 시장 관측은 통과", () => {
		expect(
			findGroundingModalityViolations(expectedSource, [
				"최대 40조 원 조달을 추진하고 있습니다",
				"상장 가능성이 거론되고 있습니다",
				"원·달러 환율은 장중 하락했습니다",
			]),
		).toEqual([]);
	});

	it("본문에만 있는 불확실성과 쉼표 뒤 확정 단정을 절 단위로 검사", () => {
		const grounding = {
			primary: {
				...mk("기업 자금조달 관련 보도", "https://example.com/article"),
				description: "",
			},
			body: "회사는 ADR 상장을 검토하고 최대 40조 원 조달을 추진 중이다.",
			related: [],
		};
		expect(
			findGroundingModalityViolations(grounding, [
				"상장 기대가 커졌지만, 회사는 40조 원을 조달합니다",
			]),
		).toEqual([0]);
		expect(
			findGroundingModalityViolations(
				{ ...grounding, body: "회사는 신규 공장 투자를 검토하고 있다." },
				["회사는 신규 공장에 투자합니다"],
			),
		).toEqual([0]);
	});

	it("한 절의 다른 이벤트 qualifier 공유와 기대→임박 승격을 차단", () => {
		const grounding = {
			primary: {
				...mk("기업 계획 보도", "https://example.com/plan"),
				description: "",
			},
			body: "회사는 ADR 상장을 추진하고 신규 공장 투자를 검토하고 있다.",
			related: [],
		};
		expect(
			findGroundingModalityViolations(grounding, [
				"상장을 추진하며 신규 공장에 투자합니다",
				"ADR 상장이 임박했습니다",
			]),
		).toEqual([0, 1]);
	});

	it("예정→완료와 동일 이벤트의 다른 주체 완료를 허가로 공유하지 않음", () => {
		const scheduled = {
			primary: {
				...mk("ADR 상장 예정", "https://example.com/scheduled"),
				description: "회사는 감독당국 승인을 검토 중이다.",
			},
			body: "자회사 상장은 완료됐지만 본사 ADR 상장은 기대 단계다.",
			related: [],
		};
		expect(
			findGroundingModalityViolations(scheduled, [
				"본사는 ADR에 상장했습니다",
				"회사는 감독당국 승인을 받았습니다",
			]),
		).toEqual([0, 1]);
	});
});

describe("findUngroundedNumberViolations (출처 숫자 게이트)", () => {
	const source = {
		primary: {
			title: "환율 장중 1,500원 하회",
			link: "https://example.com/fx",
			description: "기준가는 4.7원 내린 1,501.4원",
			pubDate: "",
		},
		body: "환율은 1,499.3원까지 내렸다. 코스피는 2.52% 올랐고 공모 규모는 40조 원으로 예상됐다.",
		related: [],
	};

	it("쉼표·띄어쓰기·퍼센트 표기가 달라도 출처 숫자를 허용", () => {
		expect(
			findUngroundedNumberViolations(source, [
				"환율은 1,499원대였고 코스피는 2.52퍼센트 올랐습니다.",
				"공모 규모는 40조원으로 예상됩니다.",
			]),
		).toEqual([]);
	});

	it("출처에 없는 숫자 변조를 차단", () => {
		expect(
			findUngroundedNumberViolations(source, [
				"환율은 1,401.4원으로 마감했습니다.",
				"코스피는 20% 올랐습니다.",
			]),
		).toEqual([0, 1]);
	});
});

describe("parseGroundingClaimAudit", () => {
	it("모든 씬의 고유 index와 boolean 판정을 요구", () => {
		expect(
			parseGroundingClaimAudit(
				{
					results: [
						{ index: 0, supported: true },
						{ index: 1, supported: false },
					],
				},
				2,
			),
		).toEqual([1]);
	});

	it("누락·중복·범위 밖 결과는 fail-closed", () => {
		expect(() => parseGroundingClaimAudit({ results: [] }, 1)).toThrow();
		expect(() =>
			parseGroundingClaimAudit(
				{
					results: [
						{ index: 0, supported: true },
						{ index: 0, supported: true },
					],
				},
				2,
			),
		).toThrow();
	});
});

describe("isRenderQcAcceptable", () => {
	it("85점 이상이고 issue가 없을 때만 게시 가능", () => {
		expect(isRenderQcAcceptable({ score: 85, issues: [] })).toBe(true);
		expect(
			isRenderQcAcceptable({ score: 95, issues: ["black_segment_detected"] }),
		).toBe(false);
		expect(isRenderQcAcceptable({ score: 84, issues: [] })).toBe(false);
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

// ── --shorts 모드(순수 로직) ─────────────────────────────────────────────────

describe("SHORTS_BEATS / estimateShortsSceneCount / estimateShortsTotalSec", () => {
	it("숏폼 아크는 훅으로 시작, 5개 고정 비트", () => {
		expect(SHORTS_BEATS.length).toBe(5);
		expect(SHORTS_BEATS[0].key).toBe("훅");
	});
	it("씬수 추정은 6 이하", () => {
		expect(estimateShortsSceneCount()).toBeLessThanOrEqual(6);
		expect(estimateShortsSceneCount()).toBeGreaterThan(0);
	});
	it("예상 총 발화초는 60초 하드캡 이내", () => {
		expect(estimateShortsTotalSec()).toBeLessThanOrEqual(SHORTS_MAX_SEC);
	});
	it("씬수 인자를 받으면 그 값으로 계산", () => {
		expect(estimateShortsTotalSec(1)).toBeLessThan(estimateShortsTotalSec(6));
	});
});

describe("sceneImageDims (씬 이미지 차원)", () => {
	it("shorts=true → 세로(width < height)", () => {
		const dims = sceneImageDims(true);
		expect(dims).toBeDefined();
		expect(dims?.width).toBeLessThan(dims?.height ?? 0);
	});
	it("shorts=false(롱폼) → undefined(기존 가로 기본값 유지, 회귀 방지)", () => {
		expect(sceneImageDims(false)).toBeUndefined();
	});
});

describe("compositionIdFor", () => {
	it("shorts=true → YouTubeShorts", () => {
		expect(compositionIdFor(true)).toBe("YouTubeShorts");
	});
	it("shorts=false → YouTubeVideo(기존 동작 불변)", () => {
		expect(compositionIdFor(false)).toBe("YouTubeVideo");
	});
});

describe("outputStem (산출물 파일명)", () => {
	it("롱폼(shorts=false) → 기존 규칙 그대로(접미사 없음)", () => {
		expect(outputStem("sk하이닉스-45조", 1234, false)).toBe(
			"economy_sk하이닉스-45조_1234",
		);
	});
	it("shorts=true → _shorts 접미사", () => {
		expect(outputStem("sk하이닉스-45조", 1234, true)).toBe(
			"economy_sk하이닉스-45조_1234_shorts",
		);
	});
});
