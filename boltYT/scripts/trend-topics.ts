/**
 * trend-topics — API 키 없이 유튜브 카테고리별 인기 영상 수집 (트렌드 토픽 생산자).
 *
 * 수집 전략:
 *  1) 주: 유튜브 검색 결과 HTML fetch(데스크톱 UA) → ytInitialData JSON 추출 → videoRenderer 파싱
 *  2) 보조: 주 수집 실패/0건 시 yt-dlp("ytsearchN:<쿼리>" --flat-playlist) 폴백 (설치돼 있을 때만)
 *
 * 계약(소비자 공유): boltYT/output/trend_topics.json
 *  { fetchedAt, categories: { <카테고리>: { query, topics: [{rank,title,channel,views,url}] } } }
 *
 * 파이프라인 안전: 네트워크 실패/타임아웃 → 경고 로그 + 기존 캐시 유지 + exit 0 (절대 throw 로 죽지 않음).
 * 24h 캐시: 기존 파일 fetchedAt 이 24h 이내면 스킵(--force 로 강제 갱신).
 *
 * CLI: npx tsx scripts/trend-topics.ts [--force] [--out <path>] [--categories 경제,역사,쇼핑]
 * env: TREND_CATEGORIES(카테고리 콤마 목록), TREND_SP(검색 sp 파라미터 오버라이드)
 */
import { execFile } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── 계약 타입 ────────────────────────────────────────────────────────────────
export interface TrendVideo {
	videoId: string;
	title: string;
	channel: string;
	views: number;
	viewCountText?: string;
	publishedTimeText?: string;
}
export interface TrendTopic {
	rank: number;
	title: string;
	channel: string;
	views: number;
	url: string;
}
export interface TrendCategoryResult {
	query: string;
	topics: TrendTopic[];
}
export interface TrendTopicsFile {
	fetchedAt: string;
	categories: Record<string, TrendCategoryResult>;
}

// ── 상수 ─────────────────────────────────────────────────────────────────────
export const DEFAULT_CATEGORIES = ["경제", "역사", "쇼핑"];
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_OUT_PATH = join(
	PROJECT_ROOT,
	"output",
	"trend_topics.json",
);
// sp=조회수순 정렬+업로드 필터(protobuf, 이미 URL 인코딩된 값). 라이브 검증 완료 — 잘못되면 TREND_SP 로 교체.
export const DEFAULT_SP = "CAMSBAgCEAE%3D";
const FETCH_TIMEOUT_MS = 15_000;
const YTDLP_TIMEOUT_MS = 20_000;
const YTDLP_SEARCH_COUNT = 30;
const DESKTOP_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ── 순수 함수: 조회수 텍스트 파싱 ────────────────────────────────────────────
// "조회수 12만회" / "조회수 1,234회" / "1.2M views" / "12K views" / "조회수 3.4억회" 등 지원.
// 복합 단위("1.2천만")는 단위 곱 누적으로 처리. 파싱 불가("No views" 등)는 0.
const VIEW_UNIT: Record<string, number> = {
	천: 1e3,
	만: 1e4,
	억: 1e8,
	k: 1e3,
	m: 1e6,
	b: 1e9,
};
export function parseViewCount(text: string | undefined | null): number {
	if (!text) return 0;
	// 라벨/구분자 제거 후 "숫자+단위문자열"만 남긴다.
	const cleaned = text.replace(/조회수|views?|watching|회|,|\s+/gi, "");
	const m = cleaned.match(/(\d+(?:\.\d+)?)([천만억kmb]*)/i);
	if (!m) return 0;
	const base = Number.parseFloat(m[1]);
	if (!Number.isFinite(base)) return 0;
	let mult = 1;
	for (const ch of m[2].toLowerCase()) mult *= VIEW_UNIT[ch] ?? 1;
	return Math.round(base * mult);
}

// ── 순수 함수: ytInitialData 추출 ────────────────────────────────────────────
// 문자열 리터럴/이스케이프를 존중하는 중괄호 균형 스캔 — lazy regex 보다 견고(JSON 내부 "};" 안전).
function extractBalancedJson(src: string, start: number): string | null {
	if (src[start] !== "{") return null;
	let depth = 0;
	let inStr = false;
	let esc = false;
	for (let i = start; i < src.length; i++) {
		const c = src[i];
		if (inStr) {
			if (esc) esc = false;
			else if (c === "\\") esc = true;
			else if (c === '"') inStr = false;
		} else if (c === '"') inStr = true;
		else if (c === "{") depth++;
		else if (c === "}") {
			depth--;
			if (depth === 0) return src.slice(start, i + 1);
		}
	}
	return null;
}

export function extractYtInitialData(html: string): unknown {
	const m =
		/(?:var\s+ytInitialData|window\s*\[\s*["']ytInitialData["']\s*\])\s*=\s*/.exec(
			html,
		);
	if (!m) return null;
	const start = m.index + m[0].length;
	const json = extractBalancedJson(html, start);
	if (!json) return null;
	try {
		return JSON.parse(json);
	} catch {
		return null; // 잘림/비정상 JSON — 호출부에서 폴백
	}
}

// title/ownerText 는 {simpleText} 또는 {runs:[{text}]} 두 형태가 혼재.
function textOf(node: unknown): string {
	if (!node || typeof node !== "object") return "";
	const rec = node as { simpleText?: unknown; runs?: unknown };
	if (typeof rec.simpleText === "string") return rec.simpleText;
	if (Array.isArray(rec.runs)) {
		return rec.runs
			.map((r) =>
				r &&
				typeof r === "object" &&
				typeof (r as { text?: unknown }).text === "string"
					? (r as { text: string }).text
					: "",
			)
			.join("");
	}
	return "";
}

function toTrendVideo(vr: Record<string, unknown>): TrendVideo | null {
	const videoId = typeof vr.videoId === "string" ? vr.videoId : "";
	const title = textOf(vr.title);
	if (!videoId || !title) return null;
	const channel = textOf(vr.ownerText) || textOf(vr.longBylineText);
	const viewCountText = textOf(vr.viewCountText);
	const publishedTimeText = textOf(vr.publishedTimeText);
	return {
		videoId,
		title,
		channel,
		views: parseViewCount(viewCountText),
		viewCountText,
		publishedTimeText,
	};
}

// ytInitialData 전체를 순회하며 videoRenderer 를 수집 — 검색 UI 트리 구조 변경에 비결합.
export function extractVideosFromHtml(html: string): TrendVideo[] {
	const data = extractYtInitialData(html);
	if (!data || typeof data !== "object") return [];
	const out: TrendVideo[] = [];
	const seen = new Set<string>();
	const stack: unknown[] = [data];
	while (stack.length > 0) {
		const cur = stack.pop();
		if (Array.isArray(cur)) {
			for (const v of cur) if (v && typeof v === "object") stack.push(v);
			continue;
		}
		if (!cur || typeof cur !== "object") continue;
		const rec = cur as Record<string, unknown>;
		const vr = rec.videoRenderer;
		if (vr && typeof vr === "object" && !Array.isArray(vr)) {
			const video = toTrendVideo(vr as Record<string, unknown>);
			if (video && !seen.has(video.videoId)) {
				seen.add(video.videoId);
				out.push(video);
			}
		}
		for (const v of Object.values(rec))
			if (v && typeof v === "object") stack.push(v);
	}
	return out;
}

// ── 순수 함수: yt-dlp --flat-playlist --dump-json 라인 파싱 ──────────────────
export function parseYtDlpLines(stdout: string): TrendVideo[] {
	const out: TrendVideo[] = [];
	for (const line of stdout.split("\n")) {
		const s = line.trim();
		if (!s) continue;
		try {
			const j = JSON.parse(s) as Record<string, unknown>;
			const videoId = typeof j.id === "string" ? j.id : "";
			const title = typeof j.title === "string" ? j.title : "";
			if (!videoId || !title) continue;
			const channel =
				typeof j.channel === "string" && j.channel !== ""
					? j.channel
					: typeof j.uploader === "string"
						? j.uploader
						: "";
			const views =
				typeof j.view_count === "number" && Number.isFinite(j.view_count)
					? j.view_count
					: 0;
			out.push({ videoId, title, channel, views });
		} catch {
			// 진행 로그 등 비 JSON 라인 무시
		}
	}
	return out;
}

// ── 순수 함수: 캐시 신선도 · 랭킹 · 설정 ─────────────────────────────────────
export function isCacheFresh(
	fetchedAt: string | undefined | null,
	nowMs: number,
	ttlMs = CACHE_TTL_MS,
): boolean {
	if (!fetchedAt) return false;
	const t = Date.parse(fetchedAt);
	if (!Number.isFinite(t)) return false;
	return nowMs - t < ttlMs;
}

export function rankTopics(videos: TrendVideo[], limit = 20): TrendTopic[] {
	return [...videos]
		.filter((v) => v.videoId !== "" && v.title !== "")
		.sort((a, b) => b.views - a.views)
		.slice(0, Math.max(0, limit))
		.map((v, i) => ({
			rank: i + 1,
			title: v.title,
			channel: v.channel,
			views: v.views,
			url: `https://www.youtube.com/watch?v=${v.videoId}`,
		}));
}

export function resolveCategories(
	envValue = process.env.TREND_CATEGORIES,
): string[] {
	if (!envValue) return DEFAULT_CATEGORIES;
	const list = envValue
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");
	return list.length > 0 ? list : DEFAULT_CATEGORIES;
}

// sp 는 이미 URL 인코딩된 protobuf 값이라 그대로 결합(재인코딩 금지).
export function buildSearchUrl(
	query: string,
	sp = process.env.TREND_SP ?? DEFAULT_SP,
): string {
	return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${sp}`;
}

// ── 수집 오케스트레이션 (in-process import 용) ───────────────────────────────
export interface CollectOptions {
	categories?: string[];
	outPath?: string;
	force?: boolean;
	limit?: number;
	/** 테스트용 시간 주입(비결정 로직 격리) */
	now?: () => number;
	/** 테스트용 fetch 주입(네트워크 격리) */
	fetchImpl?: typeof fetch;
	fetchTimeoutMs?: number;
	ytDlpTimeoutMs?: number;
	/** yt-dlp 보조 수집 사용 여부(테스트에서 서브프로세스 차단용) */
	useYtDlpFallback?: boolean;
	log?: (msg: string) => void;
}
export interface CollectResult {
	skipped: boolean;
	outPath: string;
	data: TrendTopicsFile | null;
	warnings: string[];
}

function readPrevCache(path: string): TrendTopicsFile | null {
	if (!existsSync(path)) return null;
	try {
		const j = JSON.parse(readFileSync(path, "utf-8")) as TrendTopicsFile;
		return j && typeof j === "object" && typeof j.fetchedAt === "string"
			? j
			: null;
	} catch {
		return null; // 손상 캐시는 무시하고 재수집
	}
}

async function fetchSearchHtml(
	query: string,
	fetchImpl: typeof fetch,
	timeoutMs: number,
): Promise<string> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetchImpl(buildSearchUrl(query), {
			signal: ctrl.signal,
			headers: {
				"user-agent": DESKTOP_UA,
				"accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
				// EU 동의 페이지 우회(있어도 무해)
				cookie: "CONSENT=YES+cb; SOCS=CAI",
			},
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.text();
	} finally {
		clearTimeout(timer);
	}
}

async function ytDlpSearch(
	query: string,
	timeoutMs: number,
): Promise<TrendVideo[]> {
	const { stdout } = await exec(
		"yt-dlp",
		[
			`ytsearch${YTDLP_SEARCH_COUNT}:${query}`,
			"--flat-playlist",
			"--dump-json",
			"--no-warnings",
		],
		{ timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
	);
	return parseYtDlpLines(stdout);
}

export async function collectTrendTopics(
	opts: CollectOptions = {},
): Promise<CollectResult> {
	const now = opts.now ?? Date.now;
	const log = opts.log ?? ((m: string) => process.stderr.write(`${m}\n`));
	const outPath = opts.outPath ?? DEFAULT_OUT_PATH;
	const categories = opts.categories ?? resolveCategories();
	const limit = opts.limit ?? 20;
	const warnings: string[] = [];

	// 24h 캐시: 신선 + 요청 카테고리 전부 "비어있지 않게" 보유일 때만 스킵.
	//   신선함만 보고 스킵하면, 이전에 --categories 로 일부만 만들었거나 수집 0건(topics:[])으로
	//   보존된 카테고리가 있을 때 기본 실행이 24h 동안 재수집 못 해 소비자(vlog-batch)가 굶는다.
	//   → 없음/빈 목록 카테고리는 stale 로 취급해 매 실행 재시도(파일 fetchedAt 은 전역이라 신뢰 불가).
	const prev = readPrevCache(outPath);
	// topics 가 배열이 아니거나(손상 캐시) 빈 배열이면 stale 취급 → 재수집으로 자가치유(비배열 .length 접근도 차단).
	const isFilled = (c: string): boolean => {
		const t = prev?.categories?.[c]?.topics;
		return Array.isArray(t) && t.length > 0;
	};
	const missing = categories.filter((c) => !isFilled(c));
	if (
		!opts.force &&
		prev &&
		isCacheFresh(prev.fetchedAt, now()) &&
		missing.length === 0
	) {
		log(
			`✓ 캐시 신선(24h 이내, fetchedAt=${prev.fetchedAt}) → 수집 스킵. --force 로 강제 갱신.`,
		);
		return { skipped: true, outPath, data: prev, warnings };
	}
	if (prev && isCacheFresh(prev.fetchedAt, now()) && missing.length > 0)
		log(`캐시 신선하나 누락 카테고리 수집: ${missing.join(", ")}`);

	const fetchImpl = opts.fetchImpl ?? fetch;
	const result: Record<string, TrendCategoryResult> = {};
	let collected = 0;
	for (const cat of categories) {
		const query = cat; // 쿼리 = 카테고리명 그대로 (계약)
		let videos: TrendVideo[] = [];
		try {
			videos = extractVideosFromHtml(
				await fetchSearchHtml(
					query,
					fetchImpl,
					opts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS,
				),
			);
			if (videos.length === 0)
				warnings.push(`${cat}: 검색 HTML 파싱 0건 → yt-dlp 폴백 시도`);
		} catch (e) {
			warnings.push(`${cat}: 검색 HTML 수집 실패(${e}) → yt-dlp 폴백 시도`);
		}
		if (videos.length === 0 && (opts.useYtDlpFallback ?? true)) {
			try {
				videos = await ytDlpSearch(
					query,
					opts.ytDlpTimeoutMs ?? YTDLP_TIMEOUT_MS,
				);
			} catch (e) {
				warnings.push(`${cat}: yt-dlp 폴백 실패(${e})`);
			}
		}
		const topics = rankTopics(videos, limit);
		const prevCat = prev?.categories?.[cat];
		if (topics.length === 0 && prevCat) {
			// 이번 수집 실패 카테고리는 이전 캐시 항목으로 보전 — 소비자에게 빈 목록 노출 방지
			result[cat] = prevCat;
			warnings.push(
				`${cat}: 신규 0건 → 이전 캐시 ${prevCat.topics.length}건 유지`,
			);
		} else {
			result[cat] = { query, topics };
			collected += topics.length;
		}
		log(`· ${cat}: ${topics.length}건 수집`);
	}

	if (collected === 0) {
		// 전 카테고리 실패: 기존 캐시를 절대 덮어쓰지 않는다 (파이프라인 계속)
		log(`⚠️ 전 카테고리 수집 실패 — 기존 캐시 유지, 파일 미갱신: ${outPath}`);
		return { skipped: false, outPath, data: prev, warnings };
	}

	const data: TrendTopicsFile = {
		fetchedAt: new Date(now()).toISOString(),
		categories: result,
	};
	mkdirSync(dirname(outPath), { recursive: true });
	// 원자적 쓰기: 같은 디렉토리 임시파일 → renameSync 로 교체. 두 cron(vlog-batch/economy)이 동시에
	//   trend:topics 를 돌려도 소비자가 truncate/부분write 중인 파일을 읽어 [] 폴백하는 경합 방지.
	//   임시파일명에 pid 를 붙여 생산자끼리도 서로의 temp 를 덮지 않게 한다.
	const tmpPath = `${outPath}.tmp-${process.pid}`;
	writeFileSync(tmpPath, JSON.stringify(data, null, 2));
	renameSync(tmpPath, outPath);
	log(
		`✓ 기록: ${outPath} (카테고리 ${categories.length}개, 토픽 총 ${collected}건)`,
	);
	return { skipped: false, outPath, data, warnings };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const argValue = (flag: string): string | undefined => {
		const i = args.indexOf(flag);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const res = await collectTrendTopics({
		force: args.includes("--force"),
		outPath: argValue("--out"),
		categories: argValue("--categories")
			?.split(",")
			.map((s) => s.trim())
			.filter((s) => s !== ""),
	});
	for (const w of res.warnings) process.stderr.write(`⚠️ ${w}\n`);
}

// 직접 실행 시에만 main (테스트/타 스크립트 import 시엔 함수만 노출).
// 어떤 실패도 exit 0 — 트렌드 수집은 보조 단계라 파이프라인을 중단시키지 않는다.
if (process.argv[1]?.endsWith("trend-topics.ts")) {
	main().catch((e) => {
		process.stderr.write(`⚠️ trend-topics 실패(파이프라인 계속 진행): ${e}\n`);
		process.exit(0);
	});
}
