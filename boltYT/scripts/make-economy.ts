/**
 * make-economy — 한국 경제/금융 뉴스 해설 영상 1편 생성(장르 economy).
 *
 * 데이터 근거: 우리 파이프라인 약점(모션·포토리얼·호스트 일관성)이 무의미하고, 강점(썸네일·대본·양산)이
 * 그대로 통하는 장르. 레퍼런스 경제읽음이(플랫 카툰+TTS 롱폼, 2.15만 구독에 편당 12~39만 뷰) 포맷.
 *
 * 파이프라인: 실제 경제 RSS(연합뉴스 등) → 사실 기반 grounding → Claude 뉴스해설 대본(4비트 챕터)
 *   → 플랫 카툰 이미지(IPAdapter/호스트 없음) → ElevenLabs TTS → Remotion 롱폼 → 카툰 썸네일 + .srt.
 *
 * YMYL 안전 레인: "뉴스 요약 + 맥락 해설"만. 투자 조언/종목 추천/가격 예측 금지(LLM 시스템 프롬프트로 강제).
 * 기사 외 사실 창작 방지를 위해 LLM 에 RSS 제목/요약을 그대로 제공하고 그 범위로 해설하게 한다.
 *
 * 품질 게이트(기본 ON — 해당 env 를 "0" 으로 두면 opt-out):
 *   SHOTPLAN_REBUDGET  대본 생성 직후 컷별 분량 재작성(1패스). SHOTPLAN_TOLERANCE(기본 0.25) 초과
 *                      어긋난 컷만 재작성 1회, 목표에 더 가까울 때만 채택.
 *   SHOTPLAN_AUDIT     TTS 실측 후 스토리 싱크 감사 + 재생성 루프 정확히 1회. 그래도 error → exit 1.
 *   CAMERA_MOVES       컷별 카메라무빙 결정적 배정(seed=기사 slug) → Remotion + shot_plan.json.
 * 최종 렌더 후 verify-output 검수(길이/자막 정합 + contact sheet) 실패 시에도 exit 1(fail-closed).
 *
 * 전제: ComfyUI(8188) + api-proxy(3459, LLM_BACKEND=claude + ELEVENLABS).
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// 카메라무빙 — 결정적 배정(시드=기사 slug) + i2v 프롬프트 아티팩트 + Remotion 근사 모션.
import {
	assignCameraMoves,
	i2vPromptFor,
	remotionMotionFor,
} from "../src/lib/camera-movements.ts";
// 4플랫폼(유튜브/틱톡/릴스/네이버클립) 업로드 메타 변환 — 출처 리스트 + YMYL 면책 전파.
import {
	buildPlatformMeta,
	type PlatformMetaInput,
} from "../src/lib/platform-meta.ts";
// reference-ai-drama-codex-pipeline — shot-plan/rebudget/story-sync 감사(게이트, 기본 ON).
import {
	auditStorySync,
	budgetNarrationChars,
	buildShotPlan,
	cutId,
	estimateSpeakingSeconds,
	planRebudget,
	summarizeAudit,
	targetSecondsPerCut,
} from "../src/lib/shot-plan.ts";
// 인트로/아웃트로 카드 길이(순수 상수, remotion 비의존). 자막 오프셋·총길이 계산용.
import {
	END_CARD_FRAMES,
	TITLE_CARD_FRAMES,
} from "../src/remotion/cards/card-frames.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";
// 최종 산출물 검수(길이/자막 정합 + contact sheet) — 실패 시 exit 1(fail-closed).
import { runVerifyOutput, WARN_CHECKS } from "./verify-output.ts";
import {
	buildChapterMarkers,
	buildSourceDescription,
	buildSourceListLines,
	dur,
	floatEnv,
	latentDimEnv,
	log,
	overlayThumbnailText,
	parseArgs,
	posIntEnv,
	proxyChatJSON,
	renderSourceListSlide,
	runComfy,
	runComfyChecked,
	type SourceRef,
	srtTime,
	textToImageWorkflow,
	tts,
} from "./vlog-shared.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 경제 피드 — 전부 HTTPS 라이브 검증(2026-07-08). YMYL 해설 근거라 http 소스는 기본값에서 제외
//   (변조 벡터 차단; edaily 는 https 미지원이라 뺐고, 필요 시 --feed 로 옵트인). fetchFeed 가 죽은 피드는 skip.
const DEFAULT_FEEDS = [
	"https://www.yna.co.kr/rss/economy.xml", // 연합뉴스 경제
	"https://www.yna.co.kr/rss/market.xml", // 연합뉴스 시장
	"https://www.hankyung.com/feed/economy", // 한국경제 경제
	"https://www.hankyung.com/feed/finance", // 한국경제 금융
];

// Google Trends 일일 인기검색어(KR) — 최신순 RSS 위에 "지금 도는 주제" 신호를 얹는다(케이스 스터디 핵심).
const TRENDS_RSS =
	"https://trends.google.com/trends/trendingsearches/daily/rss?geo=KR";

export interface RssItem {
	title: string;
	link: string;
	description: string;
	pubDate: string;
}

interface Scene {
	narration: string;
	visual: string;
}

// ── 순수 로직(테스트 대상) ───────────────────────────────────────────────────

/** CDATA 래퍼 제거. */
export function stripCdata(s: string): string {
	return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/**
 * XML/HTML 엔티티 디코드 + HTML 태그 제거(RSS description 정리).
 * 엔티티를 "먼저" 디코드해야 이스케이프된 마크업(&lt;p&gt;)도 실태그가 된 뒤 함께 제거된다(Codex P3).
 */
export function decodeXml(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/<[^>]+>/g, " ") // 디코드 후 실태그+이스케이프태그 모두 제거(well-formed <...> 만)
		.replace(/\s+/g, " ")
		.trim();
}

/** RSS XML → 아이템 배열(<item> 의 title/link/description/pubDate). */
export function parseRssItems(xml: string): RssItem[] {
	const items: RssItem[] = [];
	const blocks = xml.split(/<item[\s>]/i).slice(1);
	for (const raw of blocks) {
		const body = raw.split(/<\/item>/i)[0];
		const pick = (tag: string): string => {
			const m = body.match(
				new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"),
			);
			return m ? decodeXml(stripCdata(m[1])) : "";
		};
		const title = pick("title");
		const link = pick("link");
		if (!title || !link) continue;
		items.push({
			title,
			link,
			description: pick("description"),
			pubDate: pick("pubDate"),
		});
	}
	return items;
}

// 연합뉴스 등 RSS 에 섞이는 비-기사 보일러플레이트(영상화 부적합) 카테고리.
const LOW_VALUE_PREFIX =
	/^\[(부고|인사|동정|알림|일정|게시판|표|업소록|증시일정|주말|fyi|카드뉴스)\]/i;

/** 영상화 가능한 기사인지 — 부고/인사 등 보일러플레이트·너무 짧은 제목 제외. */
export function isUsableArticle(item: RssItem): boolean {
	const t = item.title.trim();
	return t.length >= 8 && !LOW_VALUE_PREFIX.test(t);
}

/** Google Trends 일일 RSS → 트렌딩 검색어 배열(<item><title>=검색어). */
export function parseTrendTerms(xml: string): string[] {
	const terms: string[] = [];
	const blocks = xml.split(/<item[\s>]/i).slice(1);
	for (const raw of blocks) {
		const body = raw.split(/<\/item>/i)[0];
		const m = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
		if (m) {
			const t = decodeXml(stripCdata(m[1]));
			if (t) terms.push(t);
		}
	}
	return terms;
}

/** 기사의 트렌드 적합도 — 트렌딩 검색어가 제목(가중 2)/요약(가중 1)에 등장한 합산 점수. */
export function scoreTrend(item: RssItem, terms: string[]): number {
	const title = item.title.toLowerCase();
	const desc = item.description.toLowerCase();
	let score = 0;
	for (const raw of terms) {
		const t = raw.trim().toLowerCase();
		if (t.length < 2) continue;
		if (title.includes(t)) score += 2;
		else if (desc.includes(t)) score += 1;
	}
	return score;
}

// 감정 강도 마커 — "사실이면서" 클릭/시청을 끄는 프레이밍(기록/경쟁/위기/급변). 케이스 스터디의
// 감정 한국중심 장르를 YMYL 안전 레인에 맞게 재해석: 둠/민족선동 장르를 새로 만들지 않고,
// "실제 경제 뉴스 중 감정 강도 높은 사실 기사"를 선택 단계에서만 우선한다(대본은 그대로 사실 grounded).
const EMOTIONAL_MARKERS =
	/사상\s*최대|역대\s*급|역대\s*최|신기록|최초|세계\s*1위|1위|돌파|추월|제치|제쳐|뒤집|충격|초비상|비상|위기|급등|급락|폭등|폭락|쇼크|역전|날벼락|초유/;

/** 기사의 감정 강도 점수 — 제목(가중 2)/요약(가중 1) 의 감정 마커 등장. 사실성과 무관(선택 가중용). */
export function scoreEmotionalAngle(item: RssItem): number {
	let score = 0;
	if (EMOTIONAL_MARKERS.test(item.title)) score += 2;
	if (EMOTIONAL_MARKERS.test(item.description)) score += 1;
	return score;
}

// YMYL 금칙: 매수/매도 권유·가격 예측·수익 보장·특정 종목 투자 추천 어투. LLM 논지 출력의 사후 게이트용.
//   앵글 논지(thesis)는 이후 모든 챕터에 재주입되므로 여기서 걸러 조언성 문구가 대본으로 증폭되는 걸 차단.
const INVESTMENT_ADVICE =
	/매수|매도|사세요|파세요|사야|팔아야|담아|손절|익절|비중\s*확대|비중\s*축소|목표\s*가|목표주가|저점\s*매수|고점\s*매도|불타기|물타기|추천\s*종목|유망\s*종목|수익\s*보장|오를\s*것|내릴\s*것|급등할|폭등할|반드시\s*오른|사면\s*(된|돼)|지금\s*(사|들어)/;

/** 텍스트에 투자 조언/가격 예측성 문구가 있는지(YMYL 게이트). true=금칙 포함. */
export function containsInvestmentAdvice(text: string): boolean {
	return INVESTMENT_ADVICE.test(text ?? "");
}

/**
 * 미사용 + 영상화 가능한 기사 1건 선택. topic 지정 시 제목/요약 포함 필터.
 * terms(트렌딩 검색어) 제공 시 트렌드 점수, emotional 시 감정 강도 점수를 합산해 내림차순(안정 정렬).
 * 가중치 없는(모두 0점) 경우 자연히 최신순(현행 동작) 유지 → 신호 실패 시 안전 폴백.
 */
export function pickArticle(
	items: RssItem[],
	used: Set<string>,
	topic?: string,
	terms?: string[],
	emotional = false,
): RssItem | null {
	let pool = items.filter((it) => !used.has(it.link) && isUsableArticle(it));
	if (topic?.trim()) {
		const t = topic.trim().toLowerCase();
		pool = pool.filter((it) =>
			`${it.title} ${it.description}`.toLowerCase().includes(t),
		);
	}
	const hasTrend = !!terms && terms.length > 0;
	if (hasTrend || emotional) {
		pool = pool
			.map((it, i) => {
				// 트렌드는 ×2 가중(시의성이 감정보다 우선) + 감정 강도.
				const score =
					(hasTrend ? scoreTrend(it, terms) * 2 : 0) +
					(emotional ? scoreEmotionalAngle(it) : 0);
				return { it, i, score };
			})
			.sort((a, b) => b.score - a.score || a.i - b.i)
			.map((x) => x.it);
	}
	return pool[0] ?? null;
}

// 매체 도메인 → 한글 매체명(출처 표기용). 미등록 도메인은 호스트명 그대로.
const PUBLISHERS: { host: string; name: string }[] = [
	{ host: "yna.co.kr", name: "연합뉴스" },
	{ host: "hankyung.com", name: "한국경제" },
	{ host: "mk.co.kr", name: "매일경제" },
	{ host: "sedaily.com", name: "서울경제" },
	{ host: "edaily.co.kr", name: "이데일리" },
];

/** 기사 URL → 매체명(출처 표기). 파싱 실패 시 빈 문자열. */
export function publisherFromUrl(url: string): string {
	try {
		const host = new URL(url).hostname.replace(/^www\./, "");
		const hit = PUBLISHERS.find((p) => host.endsWith(p.host));
		return hit ? hit.name : host;
	} catch {
		return "";
	}
}

/** 제목에서 키워드 추출 — 한글/영숫자 토큰(길이≥2), 중복 제거. 관련 기사 클러스터링용. */
export function extractKeywords(title: string): string[] {
	const toks = Array.from(
		new Set(
			title
				.toLowerCase()
				.split(/[^a-z0-9가-힣]+/)
				.filter((t) => t.length >= 2),
		),
	);
	// 다른(더 긴) 토큰의 부분문자열인 조각 제거(예: "sk" ⊂ "sk하이닉스") — 의미 약한 토큰 정리.
	return toks.filter((t) => !toks.some((o) => o !== t && o.includes(t)));
}

/**
 * primary 와 같은 주제 클러스터의 관련 기사 — primary 제목 키워드가 후보 제목/요약에 겹치는 수로 스코어링.
 * primary/used 제외, 점수 내림차순 상위 max. 케이스 스터디의 "다중 소스 취합"을 피드 내에서 구현(추가 의존성 0).
 */
export function relatedArticles(
	items: RssItem[],
	primary: RssItem,
	used: Set<string>,
	max = 4,
): RssItem[] {
	const kws = extractKeywords(primary.title);
	if (kws.length === 0) return [];
	return items
		.filter(
			(it) =>
				it.link !== primary.link && !used.has(it.link) && isUsableArticle(it),
		)
		.map((it) => {
			const hay = `${it.title} ${it.description}`.toLowerCase();
			const score = kws.reduce((s, k) => (hay.includes(k) ? s + 1 : s), 0);
			return { it, score };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, max)
		.map((x) => x.it);
}

/** 파일명용 slug — 한글/영숫자 유지, 나머지는 하이픈. */
export function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.replace(/[^a-z0-9가-힣]+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 40) || "economy"
	);
}

/** 산출물 파일명 stem — shorts 면 "_shorts" 접미사(롱폼은 빈 문자열 = 기존 동작 100% 불변). */
export function outputStem(
	slug: string,
	stamp: number,
	isShorts: boolean,
): string {
	return `economy_${slug}_${stamp}${isShorts ? "_shorts" : ""}`;
}

/** 경제 해설 4비트 챕터(무슨일→배경→시장영향→요약). conflict 없이 정보 아크. */
export const ECON_BEATS: { key: string; note: string }[] = [
	{
		key: "무슨일",
		note: "헤드라인의 핵심 사실 — 무슨 일이 일어났는지 강한 훅으로 시작. 숫자/고유명사 명확히.",
	},
	{
		key: "배경",
		note: "왜 이런 일이 생겼는지 맥락과 원인. 기사에 있는 사실만.",
	},
	{
		key: "시장영향",
		note: "관련 기업/산업/시장에 어떤 의미인지. 사실·인용 중심, 단정적 가격 예측 금지.",
	},
	{
		key: "요약",
		note: "핵심을 3줄로 정리 + 시청자가 알아둘 포인트. 투자 조언이 아님을 분명히.",
	},
];

/**
 * 숏폼(≤60초) 단일 아크 — 4비트 다중씬 대신 훅→핵심사실→관점→시청자영향→마무리 5씬 고정.
 * 항목당 정확히 1씬(SHORTS_BEATS.length = 씬수). 훅은 0~3초 강한 패턴인터럽트 지향.
 */
export const SHORTS_BEATS: { key: string; note: string }[] = [
	{
		key: "훅",
		note: "0~3초 강한 패턴인터럽트 — 헤드라인의 가장 놀라운 숫자/사실로 즉시 시작(이탈 방지). 군더더기 인사말 금지.",
	},
	{
		key: "핵심사실",
		note: "무슨 일이 일어났는지 핵심 사실을 짧고 명확하게.",
	},
	{
		key: "관점",
		note: "해설 앵글의 핵심 논지를 압축 전달(왜 중요한지).",
	},
	{
		key: "시청자영향",
		note: "이 뉴스가 시청자의 지갑/생활에 뭘 바꾸는지 구체적으로.",
	},
	{
		key: "마무리",
		note: "핵심을 한 줄로 정리 + 담백한 마무리(투자 조언이 아님을 분명히, 과장된 CTA 금지).",
	},
];

// 숏폼 길이 제어 — 55초 목표(소프트), 60초 하드캡. 롱폼의 3.x 측정-연장(길이 채우기)은 숏폼엔 역효과라
// 스킵하고, 대신 대본 프롬프트에서 씬당 짧게 유도 + 사후 경고 로그로 대응(자르지는 않음).
export const SHORTS_TARGET_SEC = 55;
export const SHORTS_MAX_SEC = 60;
// 씬당 평균 발화초 추정치(패턴인터럽트 훅 포함 컴팩트 서술 가정) — 씬수/총길이 사전 추정용, TTS 실측과 별개.
export const SHORTS_SEC_PER_SCENE = 9;

/** 숏폼 목표 씬수 — SHORTS_BEATS 고정 아크(≤6). */
export function estimateShortsSceneCount(): number {
	return Math.min(6, SHORTS_BEATS.length);
}

/** 숏폼 예상 총 발화초 — 씬수 × SHORTS_SEC_PER_SCENE. 60초 하드캡 이내인지 사전 점검용. */
export function estimateShortsTotalSec(
	sceneCount = estimateShortsSceneCount(),
): number {
	return sceneCount * SHORTS_SEC_PER_SCENE;
}

const ECON_SYSTEM =
	"한국 경제 뉴스 해설 유튜브 작가. 제공된 기사의 '사실에만' 근거해 쉽게 설명한다. 투자 조언·종목 추천·매수매도 권유·가격 예측 절대 금지(YMYL). 기사에 없는 수치/사실 창작 금지. JSON만 출력.";

/**
 * 해설 앵글(관점) — 중립 요약의 획일성 차단. 매일 다른 앵글로 로테이션해 "실제 해설"의 색을 낸다.
 * 사용자 확정(2026-07-08): "맥락 해설형" — 관점은 있되 투자 조언/예측은 없음(YMYL 안전).
 */
export interface EconAngle {
	key: string;
	label: string;
	guide: string;
}
export const ECON_ANGLES: EconAngle[] = [
	{
		key: "hidden-cause",
		label: "숨은 원인",
		guide:
			"표면 뉴스 뒤의 진짜 원인·구조적 배경을 짚는다. '겉으로는 X지만 실제로는 Y' 관점 — 단, 기사 사실 범위 안에서만.",
	},
	{
		key: "historical-parallel",
		label: "역사 비교",
		guide:
			"기사가 직접 언급한 과거 사례가 있으면 그것과 비교한다. 기사에 없는 구체적 연도·사건·수치를 새로 지어내지 말고, 비교는 '비슷한 흐름이 반복된다'는 개념 수준으로만. 억지 비교 금지.",
	},
	{
		key: "personal-impact",
		label: "일반인 영향",
		guide:
			"이 뉴스가 평범한 시청자의 지갑·생활(물가·금리·환율 체감 등)에 뭘 바꾸는지 구체적으로 설명한다.",
	},
	{
		key: "contrarian",
		label: "반대 시각",
		guide:
			"통념/다수 해석과 다른 각도를 제시한다. 기사 사실에 근거하고 단정적 예측·투자 판단은 피한다.",
	},
];

/** 문자열 → 32bit 부호없는 해시(FNV-1a). 앵글 로테이션의 결정적 시드용(Math.random/Date 금지). */
export function hashStr(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * 기사별 결정적 앵글 선택 — seed(기사 링크/제목) 해시로 로테이션(매일 다른 앵글 + 재현성).
 * override(--angle <key|label>)로 강제 지정 가능. 미매칭 override 는 무시하고 로테이션 유지.
 */
export function pickAngle(seed: string, override?: string): EconAngle {
	if (override) {
		const o = override.trim().toLowerCase();
		const hit = ECON_ANGLES.find(
			(a) => a.key === o || a.label.toLowerCase() === o,
		);
		if (hit) return hit;
	}
	return ECON_ANGLES[hashStr(seed) % ECON_ANGLES.length];
}

/** 앵글 논지(thesis) — grounding 사실에서 도출한 한 문장 관점 + 뒷받침 근거. */
export interface AngleThesis {
	angle: string;
	thesis: string;
	points: string[];
}

// 길이 보정 상수: 내레이션 1~2문장 ≈ 16초/씬(실측 — SEC=20 은 초기 씬수를 과소추정해 +12% 오버슛 유발,
// 실측 평균 ~15.7초에 맞춰 16 으로 타이트닝). minutes 를 이 기준으로 초기 씬수 환산 → 보강 라운드 최소화.
// 언더슛은 measure-and-extend 가 보강, 오버슛은 watch-time 이득이라 허용.
export const SEC_PER_SCENE = 16;
export const SCENE_CAP = 60; // 로컬 SDXL 비용 상한(잡당 이미지 수)

/** 목표 분량 → 초기 씬수. ~SEC_PER_SCENE/씬 가정, 최소 8 · 상한 SCENE_CAP. */
export function estimateSceneCount(minutes: number): number {
	const raw = Math.round((minutes * 60) / SEC_PER_SCENE);
	return Math.min(SCENE_CAP, Math.max(8, raw));
}

/** 실측 부족분 → 추가 필요 씬수. avg(실측 평균 씬 길이)로 환산, 남은 캡 내. */
export function scenesNeeded(
	targetSec: number,
	currentSec: number,
	avgSecPerScene: number,
	remainingCap: number,
): number {
	if (currentSec >= targetSec || remainingCap <= 0) return 0;
	const deficit = targetSec - currentSec;
	const per = Math.max(6, avgSecPerScene); // 0 나눗셈/과대추정 방지
	return Math.min(remainingCap, Math.max(2, Math.ceil(deficit / per)));
}

/** 비트별 씬 수 — 총 씬을 4비트에 균등 분배(무슨일/요약 약간 적게). */
export function beatSceneCounts(totalScenes: number): number[] {
	const weights = [1, 1.1, 1.2, 0.9]; // 무슨일/배경/시장영향/요약
	const sum = weights.reduce((a, b) => a + b, 0);
	return weights.map((w) => Math.max(2, Math.round((totalScenes * w) / sum)));
}

/**
 * 플랫 카툰 이미지 프롬프트(경제읽음이 스타일). 텍스트/포토리얼 억제.
 * "infographic"(라벨·숫자 유발)·positive "no text"(SDXL 은 positive 부정 무시) 제거 →
 * text-free editorial 스타일로 유도하고 실제 억제는 negative(cartoonWorkflow)에 맡긴다(SDXL 텍스트 누수 저감).
 */
export function buildCartoonPrompt(visual: string): string {
	return `flat 2D vector cartoon illustration, bold clean outlines, minimal flat color palette, simple rounded shapes, Korean economic news editorial illustration, clean text-free conceptual style, expressive and clear, centered composition: ${visual}`;
}

// ── IO / 워크플로 ────────────────────────────────────────────────────────────

// 숏폼(--shorts true) 세로 9:16 생성 차원 — make-vlog SHORTS_W/H 와 동일 값·동일 env 규칙(레버 A 이식).
// 기본 768x1344 = SDXL 1MP 9:16 버킷. FLUX 면 SHORTS_W=1080 SHORTS_H=1920 권장(env 오버라이드).
const SHORTS_W = latentDimEnv("SHORTS_W", 768);
const SHORTS_H = latentDimEnv("SHORTS_H", 1344);

/** 씬 이미지 생성 차원 — shorts 면 세로, 롱폼이면 undefined(textToImageWorkflow 기본 가로 SCENE_W/H 유지 = 회귀 방지). */
export function sceneImageDims(
	isShorts: boolean,
): { width: number; height: number } | undefined {
	return isShorts ? { width: SHORTS_W, height: SHORTS_H } : undefined;
}

/** Remotion 컴포지션 선택 — shorts 면 세로 Shorts 컴포지션, 롱폼이면 기존 YouTubeVideo(불변). */
export function compositionIdFor(
	isShorts: boolean,
): "YouTubeVideo" | "YouTubeShorts" {
	return isShorts ? "YouTubeShorts" : "YouTubeVideo";
}

/**
 * 플랫 카툰 워크플로(SDXL/FLUX 공용) — IPAdapter/호스트 없음(경제는 일관 캐릭터 불필요).
 * 모델 분기는 공유 textToImageWorkflow(IMAGE_MODEL)가 담당. dims 미지정 시 가로(SCENE_W/H, 롱폼 기존 동작);
 * shorts 는 호출부가 sceneImageDims(true) 로 세로 차원을 넘긴다.
 */
function cartoonWorkflow(
	prompt: string,
	seed: number,
	dims?: { width: number; height: number },
) {
	return textToImageWorkflow({
		positive: buildCartoonPrompt(prompt),
		// 텍스트 누수 강화 차단(SDXL 은 차트/대시보드 씬에서 라벨·글자를 잘 흘림).
		negative:
			"photorealistic, realistic, 3d render, photograph, text, letters, words, numbers, typography, captions, labels, gibberish text, random characters, fake writing, watermark, signature, logo, ugly, blurry, jpeg artifacts, cluttered, deformed",
		seed,
		filenamePrefix: "econ_scene",
		cfg: 7,
		...(dims ?? {}),
	});
}

/**
 * 모든 피드를 합산(link 로 dedup) — 첫 피드가 닿아도 거기서 멈추지 않는다(Codex P2).
 * 그래야 topic 이 뒤 피드에만 있거나 앞 피드가 소진돼도 폴백이 동작. 순서 보존(앞 피드=풍부한 요약 우선).
 */
async function fetchFeed(feeds: string[]): Promise<RssItem[]> {
	const all: RssItem[] = [];
	const seen = new Set<string>();
	for (const url of feeds) {
		try {
			const r = await fetch(url, {
				headers: { "User-Agent": "Mozilla/5.0" },
				signal: AbortSignal.timeout(15000),
			});
			if (!r.ok) continue;
			let added = 0;
			for (const it of parseRssItems(await r.text())) {
				if (seen.has(it.link)) continue;
				seen.add(it.link);
				all.push(it);
				added++;
			}
			if (added) log(`   RSS ${url} → ${added}건`);
		} catch (e) {
			log(`   RSS 실패(${url}): ${e}`);
		}
	}
	return all;
}

/**
 * 기사 본문 수집 — Jina Reader(r.jina.ai)로 뉴스 사이트 무관 본문 텍스트화. 키 불필요.
 * 실패/타임아웃 시 빈 문자열(요약 기반 폴백). maxChars 로 컨텍스트 예산 제한.
 */
async function fetchArticleBody(url: string, maxChars = 3000): Promise<string> {
	try {
		const r = await fetch(`https://r.jina.ai/${url}`, {
			headers: { "User-Agent": "Mozilla/5.0", "X-Return-Format": "text" },
			signal: AbortSignal.timeout(20000),
		});
		if (!r.ok) return "";
		const text = (await r.text()).replace(/\s+/g, " ").trim();
		return text.slice(0, maxChars);
	} catch (e) {
		log(`   본문 수집 실패(${e}) — 요약 기반 진행`);
		return "";
	}
}

/** Google Trends KR 인기검색어. 실패 시 빈 배열(최신순 폴백). */
async function fetchTrends(): Promise<string[]> {
	try {
		const r = await fetch(TRENDS_RSS, {
			headers: { "User-Agent": "Mozilla/5.0" },
			signal: AbortSignal.timeout(10000),
		});
		if (!r.ok) return [];
		return parseTrendTerms(await r.text());
	} catch (e) {
		log(`   트렌드 조회 실패(${e}) — 최신순으로 진행`);
		return [];
	}
}

function loadUsed(path: string): Set<string> {
	if (!existsSync(path)) return new Set();
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as { links?: string[] };
		return new Set(Array.isArray(data.links) ? data.links : []);
	} catch {
		return new Set();
	}
}

function saveUsed(path: string, used: Set<string>): void {
	// 원자적 쓰기(crash-safe): tmp 에 쓰고 rename.
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify({ links: [...used] }, null, 2));
	renameSync(tmp, path);
}

/**
 * trend-topics.json(유튜브 경제 카테고리 실조회수 랭킹) 제목 → 키워드 목록.
 * pickArticle 의 트렌드 신호로 합류시켜 "실제로 조회수 나오는 주제"에 가까운 기사를 우선.
 * 파일 없음/손상/비경제 → 빈 배열(비파괴, 기존 최신순/구글트렌드 폴백 유지).
 */
export function loadYoutubeTrendTerms(
	path = join(PROJECT_ROOT, "output", "trend_topics.json"),
	category = "경제",
): string[] {
	if (!existsSync(path)) return [];
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as {
			categories?: Record<string, { topics?: { title?: string }[] }>;
		};
		const topics = data.categories?.[category]?.topics;
		if (!Array.isArray(topics)) return [];
		const terms = new Set<string>();
		for (const t of topics)
			if (typeof t?.title === "string")
				for (const kw of extractKeywords(t.title)) terms.add(kw);
		return [...terms];
	} catch {
		return [];
	}
}

/** 대본 grounding 입력 — 주 기사 + (Jina) 본문 + 관련 보도. 다중 소스 사실 근거. */
export interface Grounding {
	primary: RssItem;
	body: string;
	related: RssItem[];
}

/** grounding → LLM 컨텍스트 문자열(제목/요약/본문 발췌/관련 보도 헤드라인). */
export function groundingContext(g: Grounding): string {
	const body = g.body ? `\n기사 본문(발췌): ${g.body}` : "";
	const related = g.related.length
		? `\n관련 보도(맥락):\n${g.related.map((r) => `- ${r.title}`).join("\n")}`
		: "";
	return `기사 제목: ${g.primary.title}\n기사 요약: ${g.primary.description || "(요약 없음)"}${body}${related}`;
}

/**
 * 해설 앵글 논지 도출 — grounding 사실에서 '이 영상의 관점' 한 문장 + 근거 2~4개.
 * 실패/빈 응답 시 null(비파괴 — 호출부가 중립 요약으로 폴백해 기존 동작 유지).
 * YMYL: 관점은 되지만 투자 조언/예측은 시스템 프롬프트+지시로 이중 차단.
 */
async function deriveAngleThesis(
	g: Grounding,
	angle: EconAngle,
): Promise<AngleThesis | null> {
	try {
		const usr = `${groundingContext(g)}\n\n위 기사 '사실에만' 근거해 '${angle.label}' 관점의 해설 논지를 잡아라. ${angle.guide}\n반드시 지킬 것: 관점은 제시하되 투자 조언·종목 추천·매수매도·가격 예측은 절대 금지. 기사에 없는 수치/사실 창작 금지.\nJSON: {"thesis":"한 문장 핵심 논지(한국어)","points":["뒷받침 근거 2~4개(각 기사 사실 기반, 한국어)"]}`;
		const parsed = await proxyChatJSON(ECON_SYSTEM, usr);
		const thesis =
			typeof parsed.thesis === "string" ? parsed.thesis.trim() : "";
		const points = (
			Array.isArray(parsed.points)
				? parsed.points.filter(
						(p): p is string => typeof p === "string" && !!p.trim(),
					)
				: []
		).slice(0, 4); // 근거는 최대 4개(프롬프트 증폭·컨텍스트 폭주 방지)
		if (!thesis) return null;
		// YMYL 사후 게이트 — 논지/근거에 투자 조언·가격 예측이 섞이면 채택 거부(중립 요약 폴백).
		//   이후 모든 챕터에 재주입되는 값이라 한 번 새면 대본 전체로 증폭됨.
		if (
			containsInvestmentAdvice(thesis) ||
			points.some((p) => containsInvestmentAdvice(p))
		) {
			log("   앵글 논지에 투자 조언성 문구 감지 — 폐기하고 중립 요약으로 진행");
			return null;
		}
		return { angle: angle.label, thesis, points };
	} catch (e) {
		log(`   앵글 논지 도출 실패(${e}) — 중립 요약으로 진행`);
		return null;
	}
}

/**
 * grounding(주기사+본문+관련보도) → 4비트 챕터 대본. 비트별 개별 호출(truncation 회피 + 사실 집중).
 * beatStarts[i] = scenes 배열에서 비트 i 가 시작하는 인덱스(YouTube 챕터 타임스탬프 계산용).
 * thesis 제공 시 각 비트를 그 관점으로 전개(해설 앵글) — 없으면 기존 중립 요약(하위호환).
 */
async function generateEconomyScript(
	g: Grounding,
	minutes: number,
	thesis?: AngleThesis | null,
): Promise<{ scenes: Scene[]; beatStarts: number[] }> {
	const totalScenes = estimateSceneCount(minutes);
	const counts = beatSceneCounts(totalScenes);
	const context = groundingContext(g);
	// 관점 라인 — 모든 비트에 관통시켜 중립 요약이 아닌 '해설'로 만든다. 사실 기반·투자조언 금지 재강조.
	const angleLine = thesis
		? `\n\n[이 영상의 해설 관점: ${thesis.angle}] ${thesis.thesis}${thesis.points.length ? `\n관점 근거(기사 사실): ${thesis.points.join(" / ")}` : ""}\n각 씬은 이 관점을 기사 사실로 전개하되, 투자 조언·예측은 하지 마라.`
		: "";
	const all: Scene[] = [];
	const beatStarts: number[] = [];
	for (let i = 0; i < ECON_BEATS.length; i++) {
		beatStarts.push(all.length);
		const beat = ECON_BEATS[i];
		const n = counts[i];
		const usr = `${context}${angleLine}\n\n위 자료의 '사실에만' 근거해 이 뉴스 해설 영상의 '${beat.key}' 챕터를 쓴다. ${beat.note}\n정확히 ${n}개 씬. 각 씬: narration(한국어 1~2문장, 쉽고 명확한 구어체), visual(English, a flat cartoon illustration describing the economic concept of this scene). JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
		const parsed = await proxyChatJSON(ECON_SYSTEM, usr);
		const scenes = Array.isArray(parsed.scenes)
			? (parsed.scenes as Scene[])
			: [];
		all.push(...scenes.slice(0, n));
		log(`   챕터 ${i + 1}/4 (${beat.key}) → ${Math.min(scenes.length, n)}씬`);
	}
	return { scenes: all, beatStarts };
}

/**
 * 숏폼(≤60초) 단일 아크 대본 — SHORTS_BEATS(훅→핵심사실→관점→시청자영향→마무리) 정확히 1씬씩, 1회 호출.
 * 롱폼(generateEconomyScript)의 4비트×다중씬은 60초엔 과하다 — 컴팩트 아크로 압축.
 * thesis(해설 앵글)는 숏폼에도 전체 아크에 관통시킨다 — 중립 요약이 아닌 '관점 있는 해설' 유지(YMYL 가드 동일).
 */
async function generateEconomyShortsScript(
	g: Grounding,
	thesis?: AngleThesis | null,
): Promise<{ scenes: Scene[]; beatStarts: number[] }> {
	const context = groundingContext(g);
	const angleLine = thesis
		? `\n\n[이 영상의 해설 관점: ${thesis.angle}] ${thesis.thesis}${thesis.points.length ? `\n관점 근거(기사 사실): ${thesis.points.join(" / ")}` : ""}\n전체 아크를 이 관점으로 전개하되, 투자 조언·예측은 하지 마라.`
		: "";
	const beatLines = SHORTS_BEATS.map(
		(b, i) => `${i + 1}. ${b.key}: ${b.note}`,
	).join("\n");
	const usr = `${context}${angleLine}\n\n위 자료의 '사실에만' 근거해 60초 이하 숏폼 뉴스 해설 영상을 쓴다. 정확히 ${SHORTS_BEATS.length}개 씬, 아래 순서·역할을 그대로 따르고 각 항목은 1씬씩만:\n${beatLines}\n각 씬 narration 은 한국어 1문장, 매우 짧고 임팩트 있는 구어체(숏폼 템포). 1번(훅) 씬은 특히 숫자·반전으로 강하게 시작해 0~3초 이탈을 막는다.\nvisual(English, a flat cartoon illustration for this scene). JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
	// narration·visual 이 모두 채워진 씬만 유효로 카운트(부분/빈 씬 방지).
	const attempt = async (): Promise<Scene[]> => {
		const parsed = await proxyChatJSON(ECON_SYSTEM, usr);
		return (Array.isArray(parsed.scenes) ? (parsed.scenes as Scene[]) : [])
			.filter((s) => s?.narration?.trim() && s?.visual?.trim())
			.slice(0, SHORTS_BEATS.length);
	};
	let scenes = await attempt();
	// 비트 누락(예: CTA 빠짐)은 숏폼 아크를 깨므로 1회 재시도 후에도 미달이면 fail-closed(격리).
	if (scenes.length < SHORTS_BEATS.length) {
		log(`   숏폼 대본 ${scenes.length}/${SHORTS_BEATS.length}씬 → 1회 재생성`);
		const retry = await attempt();
		if (retry.length > scenes.length) scenes = retry;
	}
	log(`   숏폼 단일 아크 → ${scenes.length}/${SHORTS_BEATS.length}씬`);
	if (scenes.length < SHORTS_BEATS.length)
		throw new Error(
			`숏폼 대본 불완전(${scenes.length}/${SHORTS_BEATS.length}씬 — 비트 누락) — 재실행 권장`,
		);
	return { scenes, beatStarts: scenes.map((_, i) => i) };
}

/** 길이 미달 시 심화 씬 추가 — 이미 다룬 내용과 중복 없는 추가 배경/세부수치/파급효과. */
async function generateExtensionScenes(
	g: Grounding,
	n: number,
	existing: string[],
	thesis?: AngleThesis | null,
): Promise<Scene[]> {
	if (n <= 0) return [];
	const covered = existing
		.slice(-14)
		.map((s) => `- ${s}`)
		.join("\n");
	// 확장(언더슛 꼬리) 씬도 같은 해설 관점을 유지 — 안 그러면 뒷부분만 중립 요약으로 톤이 튄다.
	const angleLine = thesis
		? `\n[이 영상의 해설 관점: ${thesis.angle}] ${thesis.thesis} — 추가 씬도 이 관점을 사실 기반으로 이어가라.`
		: "";
	const usr = `${groundingContext(g)}${angleLine}\n\n위 자료에 근거해, 아래 "이미 다룬 내용"과 중복되지 않는 심화 해설 ${n}개 씬을 추가로 쓴다(추가 배경·세부 수치·파급효과·과거 비교 등 새 정보만). 투자 조언/예측 금지.\n이미 다룬 내용:\n${covered}\n각 씬: narration(한국어 1~2문장, 쉽고 명확한 구어체), visual(English, flat cartoon illustration). JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
	const parsed = await proxyChatJSON(ECON_SYSTEM, usr);
	const scenes = Array.isArray(parsed.scenes) ? (parsed.scenes as Scene[]) : [];
	return scenes.slice(0, n);
}

/**
 * 단일 narration 을 목표 문자수로 재작성(액티브 rebudget) — make-vlog rewriteNarration 패턴의 경제판.
 * YMYL 가드: 기사에 없는 수치·기관명·인용을 지어내지 마라(특히 expand 방향의 환각 위험 차단).
 * 실패/빈 응답 시 원문 유지(비파괴). SHOTPLAN_REBUDGET/감사 재생성 경로 전용.
 */
async function rewriteEconNarration(
	narration: string,
	targetChars: number,
	direction: "expand" | "trim",
): Promise<string> {
	const guide =
		direction === "expand"
			? "기존 내용만 더 쉽게 풀어 써라 — 원문에 없는 수치·기관명·인용·사실을 절대 지어내지 마라"
			: "군더더기만 덜어 수치·기관명·인용 등 핵심 사실을 그대로 보존하라";
	const parsed = await proxyChatJSON(
		ECON_SYSTEM,
		`경제 뉴스 해설 내레이션을 의미·사실·구어체 톤을 유지하며 약 ${targetChars}자(±15%)로 다시 써라. ${guide}. 원문 문장 수(1~2문장) 유지, 한국어. JSON: {"narration":"..."}\n원문: ${narration}`,
	);
	const out =
		typeof parsed.narration === "string" ? parsed.narration.trim() : "";
	return out || narration;
}

/**
 * visual 프롬프트 복구 — empty-visual/forbidden-location 은 visual *텍스트* 문제라 이미지만 재생성하면
 * 재감사가 동일 에러를 다시 잡는다. 텍스트 자체를 고친다. 빈 값 절대 반환 안 함(감사 통과 보장 시도).
 */
async function rewriteEconVisual(
	scene: Scene,
	forbidden: string[],
): Promise<string> {
	const avoid = forbidden.length
		? ` 다음 장소는 절대 등장/언급 금지: ${forbidden.join(", ")}.`
		: "";
	try {
		const parsed = await proxyChatJSON(
			"AI 이미지 생성용 장면 묘사 작가(영어 시각 프롬프트). 플랫 카툰 스타일. JSON만 출력.",
			`이 경제 뉴스 해설 컷을 위한 플랫 카툰 시각 묘사를 영어 1문장으로 써라(피사체/배경/색조).${avoid} 내레이션: ${scene.narration}\nJSON: {"visual":"..."}`,
		);
		const out = typeof parsed.visual === "string" ? parsed.visual.trim() : "";
		if (out) return out;
	} catch {
		// 폴백으로 진행
	}
	const base = (scene.narration || "economy news").slice(0, 80);
	return `flat cartoon economy scene: ${base}`;
}

async function generateMeta(
	article: RssItem,
): Promise<{ videoTitle: string; thumbText: string }> {
	try {
		const parsed = await proxyChatJSON(
			ECON_SYSTEM,
			`기사 제목: ${article.title}\n이 뉴스 영상의 유튜브 제목과 썸네일 큰 텍스트를 JSON 으로.\n- videoTitle: 한국어. 클릭 유도형이되 사실 기반(낚시 과장·허위 금지). 가능하면 기사 속 핵심 "숫자"를 넣고 "호기심 갭"을 만들 것(예: "삼성 45조 투자, 진짜 노림수는?").\n- thumbText: 10자 이내, 충격 숫자/핵심 키워드.\n{"videoTitle":"...","thumbText":"..."}`,
		);
		const videoTitle =
			typeof parsed.videoTitle === "string" ? parsed.videoTitle : article.title;
		const thumbText =
			typeof parsed.thumbText === "string"
				? parsed.thumbText
				: article.title.slice(0, 10);
		return { videoTitle, thumbText };
	} catch {
		return { videoTitle: article.title, thumbText: article.title.slice(0, 10) };
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const minutes = Math.max(1, Number(args.minutes ?? "10"));
	// --shorts true → 60초 이하 세로(9:16) 숏폼. 미지정 시 기존 롱폼 경로 100% 불변(additive 분기).
	const isShorts = args.shorts === "true";
	const channel = args.channel ?? "경제 한입";
	const topic = args.topic;
	const feeds = args.feed ? [args.feed] : DEFAULT_FEEDS;
	const outDir = args.out ?? join(process.cwd(), "renders");
	mkdirSync(outDir, { recursive: true });
	const usedPath = join(outDir, "economy-used.json");
	const stamp =
		Number(process.env.SOURCE_DATE_EPOCH) || Math.floor(Date.now() / 1000);

	log(
		`▶ 경제 뉴스 해설 ${isShorts ? "(숏폼 ≤60초 세로)" : `(~${minutes}분)`} — 채널 ${channel}${topic ? ` / 토픽 "${topic}"` : " / 최신"}`,
	);

	// 1) 실제 뉴스 RSS → (트렌드 정렬) → 미사용 기사
	log("1) 경제 RSS 수집...");
	const items = await fetchFeed(feeds);
	if (items.length === 0) throw new Error("RSS 수집 실패 (네트워크/피드 확인)");
	// 트렌드 신호로 "지금 도는" 기사를 우선 — 실패하거나 --trend false 면 최신순 폴백(현행 동작).
	//   신호 = 구글 일일 인기검색어 + 유튜브 경제 카테고리 실조회수 랭킹(trend-topics.json) 키워드.
	const useTrend = args.trend !== "false";
	const ytTerms = useTrend ? loadYoutubeTrendTerms() : [];
	// 두 소스 병합 후 dedup — 같은 키워드가 겹치면 scoreTrend 가 같은 매치를 이중 가산해 선정이 흔들림.
	const terms = [
		...new Set([...(useTrend ? await fetchTrends() : []), ...ytTerms]),
	];
	if (terms.length)
		log(
			`   트렌드 신호 ${terms.length}개(유튜브 ${ytTerms.length}) → 기사 정렬`,
		);
	// --angle emotional: 사실 기사 중 감정 강도 높은 것 우선(기본 off — 보수적 YMYL 선택 유지).
	const emotional = args.angle === "emotional";
	if (emotional) log("   감정 앵글 가중 on");
	const used = loadUsed(usedPath);
	const article = pickArticle(items, used, topic, terms, emotional);
	if (!article)
		throw new Error(
			topic
				? `"${topic}" 관련 미사용 기사 없음 (다른 토픽/피드 시도)`
				: "미사용 기사 없음 (모두 제작됨)",
		);
	log(`   선택: ${article.title}`);

	// 1.b) 다중 소스 grounding — 주 기사 본문(Jina) + 같은 주제 관련 보도(피드 클러스터).
	log("1.b) 기사 본문 + 관련 보도 수집...");
	const [body, related] = [
		await fetchArticleBody(article.link),
		relatedArticles(items, article, used),
	];
	log(`   본문 ${body.length}자 · 관련 보도 ${related.length}건`);

	// 1.c) 해설 앵글 — 기사별 결정적 로테이션(매일 다른 관점 + 재현성). --angle <key|label> 로 강제.
	//      "emotional" 은 앵글 키가 아니라 기사선정 가중이므로 로테이션으로 폴백(위 emotional 과 무충돌).
	const angle = pickAngle(article.link || article.title, args.angle);
	log(`   해설 앵글: ${angle.label}`);
	const grounding: Grounding = { primary: article, body, related };
	const thesis = await deriveAngleThesis(grounding, angle);
	if (thesis) log(`   논지: ${thesis.thesis}`);

	// 2) 사실 기반 대본(Claude) — 다중 소스 grounded + 해설 앵글 관통.
	//    shorts 는 4비트 다중씬 대신 SHORTS_BEATS 단일 아크(훅→핵심사실→관점→시청자영향→마무리) 1회 호출.
	log(
		isShorts
			? "2) 뉴스 해설 대본(숏폼 단일 아크, grounded)..."
			: "2) 뉴스 해설 대본(grounded)...",
	);
	const { scenes, beatStarts } = isShorts
		? await generateEconomyShortsScript(grounding, thesis)
		: await generateEconomyScript(grounding, minutes, thesis);
	if (scenes.length === 0) throw new Error("대본 생성 실패 (씬 0개)");
	// 컷 페이스/길이 보정의 총 길이 목표 — 롱폼은 minutes*60, shorts 는 SHORTS_TARGET_SEC(55s) 고정.
	const targetTotalSec = isShorts ? SHORTS_TARGET_SEC : minutes * 60;
	// 3.a 감사·3.b 카메라무빙의 shot-plan 블록 라벨 — 비트 구조가 장르(롱폼/숏폼)별로 다르다.
	const beatKeys = isShorts
		? SHORTS_BEATS.map((b) => b.key)
		: ECON_BEATS.map((b) => b.key);

	// 2.b) 액티브 rebudget(대본 생성 직후 1패스, 기본 ON — opt-out: SHOTPLAN_REBUDGET=0).
	//      컷당 목표초(=targetTotalSec/씬수)에 SHOTPLAN_TOLERANCE(기본 0.25) 초과로 어긋난 컷만 재작성 1회,
	//      재작성이 목표에 더 가까울 때만 채택. 3.x 측정-연장과 목표 기준(targetTotalSec)을 통일했고,
	//      역할도 분리: rebudget=컷 페이스 재작성, 측정-연장=총길이 부족분 "새 씬 추가"만 → 같은 컷을
	//      반대 방향으로 당기는 충돌 없음(충돌 소지가 생기면 대본 직후 1패스인 rebudget 결과를 우선).
	//      경제 훅(첫 씬)은 일반 1~2문장이라 vlog 롱폼의 0~3초 패턴인터럽트 훅 제외 규칙은 불필요.
	if (process.env.SHOTPLAN_REBUDGET !== "0") {
		const targets = targetSecondsPerCut(targetTotalSec, scenes.length);
		// tolerance 0.25(계약 확정치 — 모듈 기본 0.35 보다 빡빡). SHOTPLAN_TOLERANCE 로 채널별 오버라이드.
		const tolerance = floatEnv("SHOTPLAN_TOLERANCE", 0.25);
		let plan = planRebudget(
			scenes.map((s) => s.narration),
			targets,
			{ tolerance },
		).slice(0, posIntEnv("SHOTPLAN_REBUDGET_MAX", 24));
		// 숏폼은 trim 만 — 균등 목표로 expand 하면 의도적 0~3초 훅을 늘려 페이싱을 깬다(Codex).
		//   과길이 컷 텍스트만 줄여 5비트를 모두 유지한 채 60s 안에 넣는다(컷 드롭 금지).
		if (isShorts) plan = plan.filter((p) => p.direction === "trim");
		if (plan.length) {
			log(
				`2.b) 액티브 rebudget: ${plan.length}컷 분량 재조정(목표 ~${targets[0]}s/컷)...`,
			);
			for (const p of plan) {
				try {
					const rewritten = await rewriteEconNarration(
						scenes[p.index].narration,
						p.targetChars,
						p.direction,
					);
					// 재작성이 목표에 더 가까울 때만 채택 — 더 어긋나면 원문 유지(과확장/길이폭주 방지).
					const before = Math.abs(
						estimateSpeakingSeconds(scenes[p.index].narration) - p.targetSec,
					);
					const after = Math.abs(
						estimateSpeakingSeconds(rewritten) - p.targetSec,
					);
					if (after <= before)
						scenes[p.index] = { ...scenes[p.index], narration: rewritten };
					else log(`   컷${p.index + 1} rebudget 무시(재작성이 더 어긋남)`);
				} catch (e) {
					log(`   컷${p.index + 1} rebudget 생략(${e})`);
				}
			}
		}
	}

	const meta = await generateMeta(article);
	log(`   ${scenes.length}씬 · 제목 "${meta.videoTitle}"`);

	const slug = slugify(article.title);
	const stem = outputStem(slug, stamp, isShorts);
	const work = join(outDir, stem);
	mkdirSync(work, { recursive: true });

	// 이미지 생성 차원 — shorts 는 세로(SHORTS_W/H), 롱폼은 undefined(기존 가로 SCENE_W/H = 회귀 없음).
	const dims = sceneImageDims(isShorts);

	// 3) 씬별 카툰 이미지 + 내레이션 — .srt/타임라인은 3.a 감사·재생성 "완료 후" made[] 기준으로
	//    계산한다(재생성으로 컷 길이가 바뀌어도 자막 정합 유지 — 계약 확정치).
	const made: { img: string; mp3: string; narration: string; d: number }[] = [];
	// 인트로 카드만큼 자막 오프셋(make-vlog 와 동일 원리) — shorts 는 카드를 안 씀(renderVlogRemotion 이
	// YouTubeShorts 컴포지션에서 intro/outro 를 자동 무시) 이라 오프셋도 0(안 그러면 자막이 3초 밀림).
	const introOffsetSec = isShorts ? 0 : TITLE_CARD_FRAMES / 30;
	for (let i = 0; i < scenes.length; i++) {
		log(`3.${i + 1}) 카툰 + 내레이션...`);
		const img = await runComfyChecked(
			(s) => cartoonWorkflow(scenes[i].visual, s, dims),
			1000 + i * 137,
			join(work, `scene${i}.png`),
		);
		const mp3 = join(work, `scene${i}.mp3`);
		await tts(scenes[i].narration, mp3);
		const d = await dur(mp3);
		made.push({ img, mp3, narration: scenes[i].narration, d });
	}

	// 3.x) 길이 보정(measure-and-extend) — 실측 길이가 목표 미달이면 심화 씬 추가.
	//      이미지는 비싼 단계라 SCENE_CAP/최대 3라운드로 캡. LLM 이 더 못 주면 즉시 중단.
	//      목표 기준은 2.b rebudget 과 동일(targetTotalSec) — 여기선 기존 컷 재작성 없이 씬 추가만.
	//      shorts 는 스킵 — measure-and-extend 는 "길이 채우기"용이라 60초 캡을 지켜야 하는 숏폼엔 역효과.
	if (!isShorts) {
		const targetSec = targetTotalSec;
		for (let round = 0; round < 3; round++) {
			const bodySec = made.reduce((s, m) => s + m.d, 0);
			const need = scenesNeeded(
				targetSec,
				bodySec,
				bodySec / Math.max(1, made.length),
				SCENE_CAP - made.length,
			);
			if (need === 0) break;
			log(
				`3.x) 길이 ${Math.round(bodySec)}s/${targetSec}s → 심화 ${need}씬 추가 (라운드 ${round + 1})`,
			);
			const extra = await generateExtensionScenes(
				grounding,
				need,
				made.map((m) => m.narration),
				thesis,
			);
			if (extra.length === 0) break;
			for (const sc of extra) {
				const i = made.length;
				// 확장 씬도 scenes 에 편입 — 3.a 감사·3.b 카메라무빙이 전체 컷을 커버(scenes↔made 정렬 유지).
				scenes.push(sc);
				const img = await runComfyChecked(
					(s) => cartoonWorkflow(sc.visual, s, dims),
					1000 + i * 137,
					join(work, `scene${i}.png`),
				);
				const mp3 = join(work, `scene${i}.mp3`);
				await tts(sc.narration, mp3);
				const d = await dur(mp3);
				made.push({ img, mp3, narration: sc.narration, d });
			}
		}
	}

	// 3.s) 출처 리스트 엔드슬라이드 — 실제 인용 자료를 화면에 표기(YouTube 재사용 콘텐츠 비수익화 회피).
	//      마지막 "씬"으로 끼워 ffmpeg/Remotion 양 경로에서 자동 노출. 실패해도 영상엔 무영향.
	//      sources 자체는 설명/platform_meta 로도 전파되므로 항상 계산.
	const sources: SourceRef[] = [article, ...related].map((a) => ({
		title: a.title,
		source: publisherFromUrl(a.link),
		date: a.pubDate,
		url: a.link,
	}));
	// 숏폼은 화면 슬라이드 스킵 — ≤60초에 출처 슬라이드는 부적합하고, made 에만 붙어 scenes 와 길이가
	//   어긋나면 뒤의 캡 트림(made·scenes lockstep)이 깨진다. 출처는 설명/메타로만 전파.
	if (!isShorts) {
		try {
			log("3.s) 출처 리스트 슬라이드...");
			const srcImg = await renderSourceListSlide(
				"출처 / Sources",
				buildSourceListLines(sources),
				join(work, "sources.png"),
			);
			const srcNarr = "이 영상은 아래 보도 자료를 참고해 제작했습니다.";
			const srcMp3 = join(work, "sources.mp3");
			await tts(srcNarr, srcMp3);
			const sd = await dur(srcMp3);
			made.push({ img: srcImg, mp3: srcMp3, narration: srcNarr, d: sd });
		} catch (e) {
			log(`   출처 슬라이드 생략(${e})`);
		}
	}

	// 3.a) Shot-plan 스토리 싱크 게이트(기본 ON, opt-out: SHOTPLAN_AUDIT=0) — reference-ai-drama-codex-pipeline.
	//      TTS 실측 후 감사 → error 컷은 재생성 루프 *정확히 1회*(내레이션 재작성+TTS 재생성+길이 재실측,
	//      visual 이슈 컷은 이미지 seed 변경 재생성) → 재감사. 그래도 error>0 이면 audit.json 기록 후 throw
	//      (main catch 가 exit 1) — economy-cron/양산이 실패 산출물을 업로드 라인에서 격리하는 근거.
	//      SHOTPLAN_FORBIDDEN="장소1,장소2" 로 금지장소 지정. (출처 슬라이드는 scenes 밖 — 감사 대상 아님.)
	if (process.env.SHOTPLAN_AUDIT !== "0") {
		const forbidden = (process.env.SHOTPLAN_FORBIDDEN ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		// 감사 스냅샷 — 재생성 후 재감사에서도 동일 기준(항상 현재 scenes/made 기준).
		const auditNow = () =>
			auditStorySync(
				scenes.map((sc, i) => ({
					cutId: cutId(i + 1),
					narration: made[i]?.narration ?? sc.narration,
					visual: sc.visual,
					expectedSec: estimateSpeakingSeconds(
						made[i]?.narration ?? sc.narration,
					),
					measuredSec: made[i]?.d,
					forbiddenLocations: forbidden,
				})),
			);
		let issues = auditNow();
		let sum = summarizeAudit(issues);
		log(`3.a) sync audit: ${sum.errors} error / ${sum.warns} warn`);
		if (sum.errors > 0) {
			log(`   재생성 루프(1회): ${sum.regenCuts.join(", ")}`);
			// 재작성 목표 컷 길이는 2.b rebudget 과 동일 산식(targetTotalSec 균등 분배) — 기준 통일.
			const targets = targetSecondsPerCut(targetTotalSec, scenes.length);
			const regen = new Set(sum.regenCuts);
			for (let i = 0; i < scenes.length; i++) {
				if (!regen.has(cutId(i + 1))) continue;
				const tSec = targets[i] ?? 10;
				// (1) 내레이션 재작성(rewriteNarration 패턴, YMYL 가드 포함) — 실패 시 원문 유지(비파괴).
				try {
					scenes[i] = {
						...scenes[i],
						narration: await rewriteEconNarration(
							scenes[i].narration,
							budgetNarrationChars(tSec),
							estimateSpeakingSeconds(scenes[i].narration) > tSec
								? "trim"
								: "expand",
						),
					};
				} catch (e) {
					log(`   컷${i + 1} 내레이션 재작성 실패 — 원문 유지(${e})`);
				}
				// (2) visual 이슈(error) 컷 — visual *텍스트* 를 먼저 복구한 뒤 이미지 재생성.
				//     텍스트를 안 고치면 재감사가 같은 empty/forbidden 을 다시 잡아 재시도가 무의미.
				const hasVisualError = issues.some(
					(it) =>
						it.cutId === cutId(i + 1) &&
						it.severity === "error" &&
						(it.code === "empty-visual" || it.code === "forbidden-location"),
				);
				if (hasVisualError) {
					try {
						scenes[i] = {
							...scenes[i],
							visual: await rewriteEconVisual(scenes[i], forbidden),
						};
					} catch (e) {
						log(`   컷${i + 1} visual 복구 실패 — 원문 유지(${e})`);
					}
					made[i].img = await runComfyChecked(
						(s) => cartoonWorkflow(scenes[i].visual, s, dims),
						1000 + i * 137 + 104729,
						join(work, `scene${i}.png`),
					);
				}
				// (3) TTS 재생성 + 길이 재실측 → made[] 갱신(같은 mp3 경로 덮어쓰기).
				await tts(scenes[i].narration, made[i].mp3);
				made[i] = {
					...made[i],
					narration: scenes[i].narration,
					d: await dur(made[i].mp3),
				};
			}
			issues = auditNow();
			sum = summarizeAudit(issues);
			log(`   재감사: ${sum.errors} error / ${sum.warns} warn`);
		}
		// 아티팩트는 재생성 반영 후의 최종 상태로 기록.
		const shotPlan = buildShotPlan(scenes, {
			blockStarts: beatStarts,
			blockLabels: beatKeys,
			forbiddenLocations: forbidden,
		});
		const auditDir = join(work, "story_sync_audit");
		mkdirSync(auditDir, { recursive: true });
		const auditPath = join(auditDir, "audit.json");
		writeFileSync(
			auditPath,
			JSON.stringify({ summary: sum, shotPlan, issues }, null, 2),
		);
		if (sum.errors > 0)
			throw new Error(
				`스토리 싱크 감사 실패(재생성 후에도 error ${sum.errors}건: ${sum.regenCuts.join(", ")}) — ${auditPath} 참고`,
			);
	}

	// 숏폼 ≤60초 계약 강제 — 컷 드롭 금지(5비트 완전성 유지). 위 trim-only rebudget 으로 텍스트를 줄였는데도
	//   총 길이가 초과하면 자르지 않고 fail-closed(격리) — 마무리/면책 비트를 떨궈 불완전 숏폼을 내지 않는다.
	//   cron/batch 는 exit 1 로 불량 숏폼을 업로드 레인에서 제외하고, 재실행 시 새 대본으로 다시 시도.
	if (isShorts) {
		const total = made.reduce((s, m) => s + m.d, 0);
		// Remotion 이 컷마다 프레임 단위로 올림(30fps)하므로 렌더 길이는 오디오합보다 최대 (컷수/30)초 길어진다.
		//   그 마진을 미리 빼서 검사 → 렌더 실측이 확실히 ≤60s. (verify-output tolerance 로도 새지 않게 사전 차단.)
		const frameMargin = made.length / 30;
		if (total > SHORTS_MAX_SEC - frameMargin)
			throw new Error(
				`숏폼 ≤${SHORTS_MAX_SEC}s 초과(오디오 ${total.toFixed(1)}s + 프레임마진 ${frameMargin.toFixed(2)}s, 전 비트 유지) — 대본/TTS 확인 후 재실행`,
			);
	}

	// .srt 타임라인은 감사·재생성·트림 *완료 후* 의 made[] 기준으로 계산 — 길이가 바뀌어도 정합.
	const srt: string[] = [];
	const sceneStart: number[] = []; // 씬 i 의 시작초(챕터 타임스탬프 계산용)
	let cursor = introOffsetSec;
	for (let i = 0; i < made.length; i++) {
		sceneStart.push(cursor);
		srt.push(
			`${i + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + made[i].d)}\n${made[i].narration}\n`,
		);
		cursor += made[i].d;
	}

	// 3.b) 카메라무빙(기본 ON, opt-out: CAMERA_MOVES=0) — 컷 구조 기반 결정적 배정.
	//      seed=기사 slug 문자열(타임스탬프 금지) → 같은 기사 재실행 시 동일 배정(재현성).
	//      산출: (a) Remotion 입력 cameraMove(정지컷 모션 근사) (b) shot_plan.json(무빙 id +
	//      i2v 프롬프트 전문 — 향후 i2v 전환용). 정지 이미지 생성 프롬프트에는 카메라 문구를 넣지
	//      않는다 — 정지컷 생성엔 무의미한 노이즈(모션은 Remotion 담당).
	let cameraMoves: string[] = [];
	if (process.env.CAMERA_MOVES !== "0") {
		const cuts = buildShotPlan(scenes, {
			blockStarts: beatStarts,
			blockLabels: beatKeys,
		});
		cameraMoves = assignCameraMoves(
			cuts.map((c) => ({ purpose: c.purpose, expectedSec: c.expectedSec })),
			// 훅=punchy 무빙: "무슨일" 비트 시작 컷(=0).
			{ seed: `economy_${slug}`, hookIndex: beatStarts[0] ?? 0 },
		);
		writeFileSync(
			join(work, "shot_plan.json"),
			JSON.stringify(
				cuts.map((c, i) => ({
					...c,
					cameraMove: cameraMoves[i],
					i2vPrompt: i2vPromptFor(cameraMoves[i]),
				})),
				null,
				2,
			),
		);
		log(
			`3.b) 카메라무빙 배정: ${cameraMoves.slice(0, 8).join(", ")}${cameraMoves.length > 8 ? " …" : ""} → shot_plan.json`,
		);
	}

	// 4) 썸네일(카툰 + 거대 텍스트) — overlayThumbnailText 가 항상 1280x720 로 크롭하므로 shorts 도
	//    가로 dims 로 생성(make-vlog 와 동일 전례 — 썸네일은 세로 소스가 필요 없다).
	const thumbPath = join(outDir, `${stem}_thumb.jpg`);
	try {
		log("3.t) 썸네일...");
		const raw = await runComfy(
			cartoonWorkflow(
				`a shocked surprised reaction about ${meta.thumbText}, dramatic economic news scene, money chart finance icons, vivid high contrast`,
				777,
			),
			join(work, "thumb_raw.png"),
		);
		await overlayThumbnailText(raw, thumbPath, meta.thumbText);
		log(`   썸네일: ${thumbPath}`);
	} catch (e) {
		log(`   썸네일 생략(${e})`);
	}

	// 5) .srt + Remotion 렌더(인트로/아웃트로 카드 — shorts 는 renderVlogRemotion 이 자동 생략)
	const srtPath = join(outDir, `${stem}.srt`);
	writeFileSync(srtPath, srt.join("\n"));
	const finalPath = join(outDir, `${stem}.mp4`);
	log("4) Remotion 렌더...");
	await renderVlogRemotion({
		scenes: made.map((m, i) => ({
			imageUrl: m.img,
			audioUrl: m.mp3,
			narration: m.narration,
			durationSec: m.d,
			// 카메라무빙 → 정지컷 렌더러 근사 모션. 미배정 컷(출처 슬라이드 등)은 기존 Ken Burns 휴리스틱.
			...(cameraMoves[i]
				? { cameraMove: remotionMotionFor(cameraMoves[i]) }
				: {}),
		})),
		outPath: finalPath,
		projectRoot: PROJECT_ROOT,
		compositionId: compositionIdFor(isShorts),
		runId: `economy_${stamp}`,
		// intro/outro 는 compositionId==="YouTubeVideo" 일 때만 renderVlogRemotion 이 실제 사용
		// (YouTubeShorts 는 자동 무시) — shorts 도 그냥 전달해 두지만 렌더에는 영향 없다.
		intro: { title: meta.videoTitle, channelName: channel },
		outro: {
			channelName: channel,
			ctaText: "구독하고 경제 흐름 놓치지 마세요!",
		},
		onProgress: (pct) => process.stdout.write(`\r   렌더: ${pct}%`),
	});

	// 6) 업로드 메타데이터(title/description/chapters) — make-economy 가 실제 업로드 자산까지 출력.
	//    챕터: 4비트 시작 씬의 누적초 → YouTube 타임스탬프. 첫 챕터는 0:00 강제.
	//    shorts 는 챕터 없음(단일 아크, 60초 미만이라 타임스탬프 무의미) — 생성/전달 자체를 스킵.
	const seenStart = new Set<number>();
	const chapters: { title: string; startSec: number }[] = isShorts
		? []
		: beatStarts
				.map((s, i) => ({ key: beatKeys[i], start: sceneStart[s] }))
				// 빈 비트(start 인덱스가 범위 밖)·중복 시작초 제거 → YouTube 챕터 규칙 위반 방지.
				.filter((c) => {
					if (typeof c.start !== "number") return false;
					if (seenStart.has(c.start)) return false;
					seenStart.add(c.start);
					return true;
				})
				.map((c) => ({ title: c.key, startSec: c.start as number }));
	const chapterLines = buildChapterMarkers(chapters);
	// YMYL 면책 — description txt 와 platform_meta 4종 모두에 동일 문구 전파(계약 확정치).
	const AI_DISCLOSURE =
		"※ 본 영상의 이미지는 이해를 돕기 위한 AI 일러스트이며, 투자 조언이 아닙니다.";
	const description = [
		meta.videoTitle,
		"",
		...(isShorts ? [] : ["챕터", ...chapterLines, ""]),
		buildSourceDescription(sources),
		"",
		AI_DISCLOSURE,
	].join("\n");
	const metaBase = join(outDir, stem);
	writeFileSync(`${metaBase}.title.txt`, meta.videoTitle);
	writeFileSync(`${metaBase}.description.txt`, description);
	if (!isShorts)
		writeFileSync(`${metaBase}.chapters.txt`, chapterLines.join("\n"));

	// 6.b) 플랫폼 4종(youtube/tiktok/reels/naver_clip) 업로드 메타 — 기존 txt 는 하위호환 유지,
	//      JSON 은 업로더 자동화용. 출처 리스트 + YMYL 면책을 4종 모두에 전파(캡션 절삭 시에도
	//      buildPlatformMeta 가 면책>출처>챕터>본문 순으로 생존시킨다).
	const platformInput: PlatformMetaInput = {
		title: meta.videoTitle,
		// 본문만 전달 — 챕터/출처/면책은 필드로 넘겨 buildPlatformMeta 가 조립(중복 부착 방지).
		description: meta.videoTitle,
		tags: ["경제", "경제뉴스", "뉴스해설", ...extractKeywords(article.title)],
		hashtags: ["경제뉴스", "경제", "뉴스해설"],
		// shorts 는 챕터 미전달(요구사항) — 필드 자체를 생략(빈 배열이 아니라 undefined).
		...(isShorts
			? {}
			: {
					chapters: chapters.map((c) => ({ sec: c.startSec, label: c.title })),
				}),
		isShorts,
		sourceList: sources.map((s) =>
			[[s.date, s.source, s.title].filter(Boolean).join(" · "), s.url]
				.filter(Boolean)
				.join(" "),
		),
		disclosure: AI_DISCLOSURE,
	};
	writeFileSync(
		`${metaBase}.platform_meta.json`,
		JSON.stringify(buildPlatformMeta(platformInput), null, 2),
	);

	// 7) 최종 검수 게이트(fail-closed) — 렌더 실측 길이/.srt 정합/컷수 + contact sheet.
	//    카드 보정치(인트로/아웃트로 초) 전달 — economy 롱폼은 인트로/아웃트로 카드 상시 사용,
	//    shorts 는 카드가 없으므로 0(introOffsetSec 과 동일 원리 — Codex P2 재발 방지).
	//    실패 시 throw → main catch 가 exit 1. 기사 사용 기록 "전"에 실행 — 실패 잡이 기사를
	//    소진하지 않아 수정 후 같은 기사로 재시도 가능(economy-cron 격리 근거).
	log("7) 최종 검수(verify-output)...");
	const outroSec = isShorts ? 0 : END_CARD_FRAMES / 30;
	const report = await runVerifyOutput({
		videoPath: finalPath,
		srtPath,
		audioSecTotal: made.reduce((s, m) => s + m.d, 0),
		cutCount: made.length,
		introOffsetSec,
		outroSec,
		contactSheet: true,
	});
	for (const c of report.checks)
		if (!c.ok)
			log(
				`   ${WARN_CHECKS.has(c.name) ? "⚠" : "✗"} ${c.name}: ${c.detail ?? `기대=${c.expected} 실측=${c.actual}`}`,
			);
	if (!report.ok) throw new Error(`최종 검수 실패 — ${report.reportPath} 확인`);

	// 8) 기사 사용 기록(중복 방지) — 검수 통과 후에만.
	used.add(article.link);
	saveUsed(usedPath, used);

	const totalSec = cursor + outroSec;
	log(
		`\n✅ 완성: ${finalPath} (${Math.round(totalSec)}초, 검수 통과)\n   자막: ${srtPath} · 썸네일: ${thumbPath}\n   메타: ${metaBase}.{title,description${isShorts ? "" : ",chapters"}}.txt + platform_meta.json`,
	);
}

if (process.argv[1]?.endsWith("make-economy.ts")) {
	main().catch((e) => {
		process.stderr.write(`ERROR: ${e}\n`);
		process.exit(1);
	});
}
