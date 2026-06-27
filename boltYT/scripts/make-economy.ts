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
	CKPT,
	dur,
	log,
	overlayThumbnailText,
	parseArgs,
	proxyChatJSON,
	runComfy,
	SCENE_H,
	SCENE_W,
	STEPS,
	srtTime,
	tts,
} from "./vlog-shared.ts";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_FEEDS = [
	"https://www.yna.co.kr/rss/economy.xml",
	"https://www.hankyung.com/feed/economy",
];

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

/** 미사용(used 에 없는) + 영상화 가능한 기사 중 최신(RSS 선두) 1건. topic 지정 시 제목/요약 포함 필터. */
export function pickArticle(
	items: RssItem[],
	used: Set<string>,
	topic?: string,
): RssItem | null {
	let pool = items.filter((it) => !used.has(it.link) && isUsableArticle(it));
	if (topic?.trim()) {
		const t = topic.trim().toLowerCase();
		pool = pool.filter((it) =>
			`${it.title} ${it.description}`.toLowerCase().includes(t),
		);
	}
	return pool[0] ?? null;
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

/** 기사 1건 → 4비트 챕터 grounded 대본. 비트별 개별 호출(truncation 회피 + 사실 집중). */
async function generateEconomyScript(
	article: RssItem,
	minutes: number,
): Promise<Scene[]> {
	const totalScenes = Math.max(8, Math.round(minutes * 4)); // 경제는 정보 밀도↑ → ~4씬/분
	const counts = beatSceneCounts(totalScenes);
	const all: Scene[] = [];
	for (let i = 0; i < ECON_BEATS.length; i++) {
		const beat = ECON_BEATS[i];
		const n = counts[i];
		const usr = `기사 제목: ${article.title}\n기사 요약: ${article.description || "(요약 없음 — 제목 기반)"}\n\n이 뉴스 해설 영상의 '${beat.key}' 챕터. ${beat.note}\n정확히 ${n}개 씬. 각 씬: narration(한국어 1문장, 쉽고 명확, 구어체), visual(English, a flat cartoon illustration describing the economic concept of this scene). JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
		const parsed = await proxyChatJSON(ECON_SYSTEM, usr);
		const scenes = Array.isArray(parsed.scenes)
			? (parsed.scenes as Scene[])
			: [];
		all.push(...scenes.slice(0, n));
		log(`   챕터 ${i + 1}/4 (${beat.key}) → ${Math.min(scenes.length, n)}씬`);
	}
	return all;
}

async function generateMeta(
	article: RssItem,
): Promise<{ videoTitle: string; thumbText: string }> {
	try {
		const parsed = await proxyChatJSON(
			ECON_SYSTEM,
			`기사 제목: ${article.title}\n이 뉴스 영상의 유튜브 제목(클릭 유도형이되 사실 기반, 한국어, 낚시 과장 금지)과 썸네일 큰 텍스트(10자 이내, 충격 숫자/핵심 키워드)를 JSON 으로. {"videoTitle":"...","thumbText":"..."}`,
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

	// 1) 실제 뉴스 RSS → 미사용 최신 기사
	log("1) 경제 RSS 수집...");
	const items = await fetchFeed(feeds);
	if (items.length === 0) throw new Error("RSS 수집 실패 (네트워크/피드 확인)");
	const used = loadUsed(usedPath);
	const article = pickArticle(items, used, topic);
	if (!article)
		throw new Error(
			topic
				? `"${topic}" 관련 미사용 기사 없음 (다른 토픽/피드 시도)`
				: "미사용 기사 없음 (모두 제작됨)",
		);
	log(`   선택: ${article.title}`);

	// 2) 사실 기반 대본(Claude)
	log("2) 뉴스 해설 대본(grounded)...");
	const scenes = await generateEconomyScript(article, minutes);
	if (scenes.length === 0) throw new Error("대본 생성 실패 (씬 0개)");
	const meta = await generateMeta(article);
	log(`   ${scenes.length}씬 · 제목 "${meta.videoTitle}"`);

	const work = join(outDir, `economy_${slugify(article.title)}_${stamp}`);
	mkdirSync(work, { recursive: true });

	// 3) 씬별 카툰 이미지 + 내레이션
	const made: { img: string; mp3: string; narration: string; d: number }[] = [];
	const srt: string[] = [];
	const introOffsetSec = TITLE_CARD_FRAMES / 30; // 인트로 카드만큼 자막 오프셋(make-vlog 와 동일 원리)
	let cursor = introOffsetSec;
	for (let i = 0; i < scenes.length; i++) {
		log(`3.${i + 1}) 카툰 + 내레이션...`);
		const img = await runComfy(
			cartoonWorkflow(scenes[i].visual, 1000 + i * 137),
			join(work, `scene${i}.png`),
		);
		const mp3 = join(work, `scene${i}.mp3`);
		await tts(scenes[i].narration, mp3);
		const d = await dur(mp3);
		made.push({ img, mp3, narration: scenes[i].narration, d });
		srt.push(
			`${i + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + d)}\n${scenes[i].narration}\n`,
		);
		cursor += d;
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

	// 6) 기사 사용 기록(중복 방지)
	used.add(article.link);
	saveUsed(usedPath, used);

	const totalSec = cursor + END_CARD_FRAMES / 30;
	log(
		`\n✅ 완성: ${finalPath} (${Math.round(totalSec)}초)\n   자막: ${srtPath} · 썸네일: ${thumbPath}`,
	);
}

if (process.argv[1]?.endsWith("make-economy.ts")) {
	main().catch((e) => {
		process.stderr.write(`ERROR: ${e}\n`);
		process.exit(1);
	});
}
