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
// 인트로/아웃트로 카드 길이(순수 상수, remotion 비의존). 자막 오프셋·총길이 계산용.
import {
	END_CARD_FRAMES,
	TITLE_CARD_FRAMES,
} from "../src/remotion/cards/card-frames.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";
import {
	buildChapterMarkers,
	buildSourceDescription,
	buildSourceListLines,
	CKPT,
	dur,
	log,
	overlayThumbnailText,
	parseArgs,
	proxyChatJSON,
	renderSourceListSlide,
	runComfy,
	runComfyChecked,
	SCENE_H,
	SCENE_W,
	type SourceRef,
	STEPS,
	srtTime,
	tts,
} from "./vlog-shared.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_FEEDS = [
	"https://www.yna.co.kr/rss/economy.xml",
	"https://www.hankyung.com/feed/economy",
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

const ECON_SYSTEM =
	"한국 경제 뉴스 해설 유튜브 작가. 제공된 기사의 '사실에만' 근거해 쉽게 설명한다. 투자 조언·종목 추천·매수매도 권유·가격 예측 절대 금지(YMYL). 기사에 없는 수치/사실 창작 금지. JSON만 출력.";

// 길이 보정 상수: 내레이션 1~2문장 ≈ 20초/씬(실측 기반 — "2~3문장" 요청은 ~24초로 오버슛해 축소).
// minutes 를 이 기준으로 초기 씬수 환산. 언더슛은 measure-and-extend 가, 오버슛은 watch-time 이득이라 허용.
export const SEC_PER_SCENE = 20;
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

/** 플랫 카툰 이미지 프롬프트(경제읽음이 스타일). 텍스트/포토리얼 억제. */
export function buildCartoonPrompt(visual: string): string {
	return `flat 2D vector cartoon illustration, bold clean outlines, minimal flat color palette, simple rounded shapes, Korean economic news explainer infographic style, expressive and clear, centered composition, no text no letters: ${visual}`;
}

// ── IO / 워크플로 ────────────────────────────────────────────────────────────

/** 플랫 카툰 SDXL 워크플로 — IPAdapter/호스트 없음(경제는 일관 캐릭터 불필요). */
function cartoonWorkflow(prompt: string, seed: number) {
	return {
		"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: SCENE_W, height: SCENE_H, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: buildCartoonPrompt(prompt), clip: ["4", 1] },
		},
		"7": {
			class_type: "CLIPTextEncode",
			inputs: {
				text: "photorealistic, realistic, 3d render, photograph, text, letters, words, watermark, signature, ugly, blurry, jpeg artifacts, cluttered, deformed",
				clip: ["4", 1],
			},
		},
		"3": {
			class_type: "KSampler",
			inputs: {
				seed,
				steps: STEPS,
				cfg: 7,
				sampler_name: "dpmpp_2m",
				scheduler: "karras",
				denoise: 1,
				model: ["4", 0],
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"8": {
			class_type: "VAEDecode",
			inputs: { samples: ["3", 0], vae: ["4", 2] },
		},
		"9": {
			class_type: "SaveImage",
			inputs: { filename_prefix: "econ_scene", images: ["8", 0] },
		},
	};
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
 * grounding(주기사+본문+관련보도) → 4비트 챕터 대본. 비트별 개별 호출(truncation 회피 + 사실 집중).
 * beatStarts[i] = scenes 배열에서 비트 i 가 시작하는 인덱스(YouTube 챕터 타임스탬프 계산용).
 */
async function generateEconomyScript(
	g: Grounding,
	minutes: number,
): Promise<{ scenes: Scene[]; beatStarts: number[] }> {
	const totalScenes = estimateSceneCount(minutes);
	const counts = beatSceneCounts(totalScenes);
	const context = groundingContext(g);
	const all: Scene[] = [];
	const beatStarts: number[] = [];
	for (let i = 0; i < ECON_BEATS.length; i++) {
		beatStarts.push(all.length);
		const beat = ECON_BEATS[i];
		const n = counts[i];
		const usr = `${context}\n\n위 자료의 '사실에만' 근거해 이 뉴스 해설 영상의 '${beat.key}' 챕터를 쓴다. ${beat.note}\n정확히 ${n}개 씬. 각 씬: narration(한국어 1~2문장, 쉽고 명확한 구어체), visual(English, a flat cartoon illustration describing the economic concept of this scene). JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
		const parsed = await proxyChatJSON(ECON_SYSTEM, usr);
		const scenes = Array.isArray(parsed.scenes)
			? (parsed.scenes as Scene[])
			: [];
		all.push(...scenes.slice(0, n));
		log(`   챕터 ${i + 1}/4 (${beat.key}) → ${Math.min(scenes.length, n)}씬`);
	}
	return { scenes: all, beatStarts };
}

/** 길이 미달 시 심화 씬 추가 — 이미 다룬 내용과 중복 없는 추가 배경/세부수치/파급효과. */
async function generateExtensionScenes(
	g: Grounding,
	n: number,
	existing: string[],
): Promise<Scene[]> {
	if (n <= 0) return [];
	const covered = existing
		.slice(-14)
		.map((s) => `- ${s}`)
		.join("\n");
	const usr = `${groundingContext(g)}\n\n위 자료에 근거해, 아래 "이미 다룬 내용"과 중복되지 않는 심화 해설 ${n}개 씬을 추가로 쓴다(추가 배경·세부 수치·파급효과·과거 비교 등 새 정보만). 투자 조언/예측 금지.\n이미 다룬 내용:\n${covered}\n각 씬: narration(한국어 1~2문장, 쉽고 명확한 구어체), visual(English, flat cartoon illustration). JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
	const parsed = await proxyChatJSON(ECON_SYSTEM, usr);
	const scenes = Array.isArray(parsed.scenes) ? (parsed.scenes as Scene[]) : [];
	return scenes.slice(0, n);
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
	const channel = args.channel ?? "경제 한입";
	const topic = args.topic;
	const feeds = args.feed ? [args.feed] : DEFAULT_FEEDS;
	const outDir = args.out ?? join(process.cwd(), "renders");
	mkdirSync(outDir, { recursive: true });
	const usedPath = join(outDir, "economy-used.json");
	const stamp =
		Number(process.env.SOURCE_DATE_EPOCH) || Math.floor(Date.now() / 1000);

	log(
		`▶ 경제 뉴스 해설 (~${minutes}분) — 채널 ${channel}${topic ? ` / 토픽 "${topic}"` : " / 최신"}`,
	);

	// 1) 실제 뉴스 RSS → (트렌드 정렬) → 미사용 기사
	log("1) 경제 RSS 수집...");
	const items = await fetchFeed(feeds);
	if (items.length === 0) throw new Error("RSS 수집 실패 (네트워크/피드 확인)");
	// 트렌드 신호로 "지금 도는" 기사를 우선 — 실패하거나 --trend false 면 최신순 폴백(현행 동작).
	const useTrend = args.trend !== "false";
	const terms = useTrend ? await fetchTrends() : [];
	if (terms.length) log(`   트렌딩 ${terms.length}개 → 기사 트렌드 정렬`);
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

	// 2) 사실 기반 대본(Claude) — 다중 소스 grounded
	log("2) 뉴스 해설 대본(grounded)...");
	const { scenes, beatStarts } = await generateEconomyScript(
		{ primary: article, body, related },
		minutes,
	);
	if (scenes.length === 0) throw new Error("대본 생성 실패 (씬 0개)");
	const meta = await generateMeta(article);
	log(`   ${scenes.length}씬 · 제목 "${meta.videoTitle}"`);

	const work = join(outDir, `economy_${slugify(article.title)}_${stamp}`);
	mkdirSync(work, { recursive: true });

	// 3) 씬별 카툰 이미지 + 내레이션
	const made: { img: string; mp3: string; narration: string; d: number }[] = [];
	const srt: string[] = [];
	const sceneStart: number[] = []; // 씬 i 의 시작초(챕터 타임스탬프 계산용)
	const introOffsetSec = TITLE_CARD_FRAMES / 30; // 인트로 카드만큼 자막 오프셋(make-vlog 와 동일 원리)
	let cursor = introOffsetSec;
	for (let i = 0; i < scenes.length; i++) {
		log(`3.${i + 1}) 카툰 + 내레이션...`);
		const img = await runComfyChecked(
			(s) => cartoonWorkflow(scenes[i].visual, s),
			1000 + i * 137,
			join(work, `scene${i}.png`),
		);
		const mp3 = join(work, `scene${i}.mp3`);
		await tts(scenes[i].narration, mp3);
		const d = await dur(mp3);
		sceneStart.push(cursor);
		made.push({ img, mp3, narration: scenes[i].narration, d });
		srt.push(
			`${i + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + d)}\n${scenes[i].narration}\n`,
		);
		cursor += d;
	}

	// 3.x) 길이 보정(measure-and-extend) — 실측 길이가 목표 미달이면 심화 씬 추가.
	//      이미지는 비싼 단계라 SCENE_CAP/최대 3라운드로 캡. LLM 이 더 못 주면 즉시 중단.
	const targetSec = minutes * 60;
	for (let round = 0; round < 3; round++) {
		const bodySec = cursor - introOffsetSec;
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
			{ primary: article, body, related },
			need,
			made.map((m) => m.narration),
		);
		if (extra.length === 0) break;
		for (const sc of extra) {
			const i = made.length;
			const img = await runComfyChecked(
				(s) => cartoonWorkflow(sc.visual, s),
				1000 + i * 137,
				join(work, `scene${i}.png`),
			);
			const mp3 = join(work, `scene${i}.mp3`);
			await tts(sc.narration, mp3);
			const d = await dur(mp3);
			sceneStart.push(cursor);
			srt.push(
				`${made.length + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + d)}\n${sc.narration}\n`,
			);
			made.push({ img, mp3, narration: sc.narration, d });
			cursor += d;
		}
	}

	// 3.s) 출처 리스트 엔드슬라이드 — 실제 인용 자료를 화면에 표기(YouTube 재사용 콘텐츠 비수익화 회피).
	//      마지막 "씬"으로 끼워 ffmpeg/Remotion 양 경로에서 자동 노출. 실패해도 영상엔 무영향.
	const sources: SourceRef[] = [article, ...related].map((a) => ({
		title: a.title,
		source: publisherFromUrl(a.link),
		date: a.pubDate,
		url: a.link,
	}));
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
		srt.push(
			`${made.length + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + sd)}\n${srcNarr}\n`,
		);
		made.push({ img: srcImg, mp3: srcMp3, narration: srcNarr, d: sd });
		cursor += sd;
	} catch (e) {
		log(`   출처 슬라이드 생략(${e})`);
	}

	// 4) 썸네일(카툰 + 거대 텍스트)
	const slug = slugify(article.title);
	const thumbPath = join(outDir, `economy_${slug}_${stamp}_thumb.jpg`);
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

	// 5) .srt + Remotion 렌더(인트로/아웃트로 카드)
	const srtPath = join(outDir, `economy_${slug}_${stamp}.srt`);
	writeFileSync(srtPath, srt.join("\n"));
	const finalPath = join(outDir, `economy_${slug}_${stamp}.mp4`);
	log("4) Remotion 렌더...");
	await renderVlogRemotion({
		scenes: made.map((m) => ({
			imageUrl: m.img,
			audioUrl: m.mp3,
			narration: m.narration,
			durationSec: m.d,
		})),
		outPath: finalPath,
		projectRoot: PROJECT_ROOT,
		compositionId: "YouTubeVideo",
		runId: `economy_${stamp}`,
		intro: { title: meta.videoTitle, channelName: channel },
		outro: {
			channelName: channel,
			ctaText: "구독하고 경제 흐름 놓치지 마세요!",
		},
		onProgress: (pct) => process.stdout.write(`\r   렌더: ${pct}%`),
	});

	// 6) 업로드 메타데이터(title/description/chapters) — make-economy 가 실제 업로드 자산까지 출력.
	//    챕터: 4비트 시작 씬의 누적초 → YouTube 타임스탬프. 첫 챕터는 0:00 강제.
	const seenStart = new Set<number>();
	const chapters = beatStarts
		.map((s, i) => ({ key: ECON_BEATS[i].key, start: sceneStart[s] }))
		// 빈 비트(start 인덱스가 범위 밖)·중복 시작초 제거 → YouTube 챕터 규칙 위반 방지.
		.filter((c) => {
			if (typeof c.start !== "number") return false;
			if (seenStart.has(c.start)) return false;
			seenStart.add(c.start);
			return true;
		})
		.map((c) => ({ title: c.key, startSec: c.start as number }));
	const chapterLines = buildChapterMarkers(chapters);
	const description = [
		meta.videoTitle,
		"",
		"챕터",
		...chapterLines,
		"",
		buildSourceDescription(sources),
		"",
		"※ 본 영상의 이미지는 이해를 돕기 위한 AI 일러스트이며, 투자 조언이 아닙니다.",
	].join("\n");
	const metaBase = join(outDir, `economy_${slug}_${stamp}`);
	writeFileSync(`${metaBase}.title.txt`, meta.videoTitle);
	writeFileSync(`${metaBase}.description.txt`, description);
	writeFileSync(`${metaBase}.chapters.txt`, chapterLines.join("\n"));

	// 7) 기사 사용 기록(중복 방지)
	used.add(article.link);
	saveUsed(usedPath, used);

	const totalSec = cursor + END_CARD_FRAMES / 30;
	log(
		`\n✅ 완성: ${finalPath} (${Math.round(totalSec)}초)\n   자막: ${srtPath} · 썸네일: ${thumbPath}\n   메타: ${metaBase}.{title,description,chapters}.txt`,
	);
}

if (process.argv[1]?.endsWith("make-economy.ts")) {
	main().catch((e) => {
		process.stderr.write(`ERROR: ${e}\n`);
		process.exit(1);
	});
}
