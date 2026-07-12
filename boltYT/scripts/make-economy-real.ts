/**
 * make-economy-real  (real-source economy short — the anti-cartoon path)
 *
 * "실제 경제 유튜버 편집" 룩을 REAL 소재로 조립하는 세로 숏폼:
 *   - real chart screen-recording (TradingView 지수) via chart-screen-record
 *   - real press-article screenshot via article-screenshot
 *   - black-bg big-caption text cards (hook / payoff)
 *   - local MeloTTS voice + Remotion burned-in 강조 자막
 *
 * 기본 = grounded: make-economy 의 RSS→기사선택→Claude 해설 파이프라인(export 재사용)으로
 * 실제 현재 뉴스 기사에 근거해 나레이션을 생성한다. 화면의 기사 스크린샷·지수 차트가
 * 나레이션과 일치한다. 지수 방향/수치는 단정하지 않는다(화면의 실제 차트가 값을 보여주므로 —
 * 하드코딩 방향 주장 회귀 방지). YMYL 안전: ECON_SYSTEM + looksLikeAdvice 사후 게이트(fail-closed).
 *
 * --sample: 백엔드(api-proxy) 없이 시각/편집 스타일만 검증하는 하드코딩 삼성전자 샘플 경로.
 *
 * 전제(grounded): api-proxy(:3459, LLM_BACKEND=claude) + MeloTTS + ffmpeg + Playwright chromium + 네트워크.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { evaluateRenderOutput } from "../server/lib/render-output-qc.ts";
import { remotionMotionFor } from "../src/lib/camera-movements.ts";
import { buildPlatformMeta } from "../src/lib/platform-meta.ts";
import { buildSceneGraphics } from "../src/remotion/scene-motion-graphics.ts";
import { captureArticle } from "./article-screenshot.ts";
import { recordChartClip } from "./chart-screen-record.ts";
import {
	assertGroundedEconomyClaims,
	DEFAULT_FEEDS,
	ECON_SYSTEM,
	fetchArticleBody,
	fetchFeed,
	findGroundingModalityViolations,
	findUngroundedNumberViolations,
	type Grounding,
	groundingContext,
	parseEconomySourceManifest,
	pickArticle,
	publisherFromUrl,
	type RssItem,
	readEconomySourceManifest,
	relatedArticles,
	requireGroundingBody,
	sourceGroundedThumbnailText,
} from "./make-economy.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";
import {
	probeDurationSec,
	runVerifyOutput,
	type VerifyReport,
} from "./verify-output.ts";
import {
	overlayThumbnailText,
	parseArgs,
	proxyChatJSON,
	srtTime,
} from "./vlog-shared.ts";

// 실사 경로 소비자도 동일한 결정적 출처-확실성 게이트를 직접 테스트/재사용할 수 있게 공개한다.
export {
	findGroundingModalityViolations,
	findUngroundedNumberViolations,
} from "./make-economy.ts";

const exec = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SHORTS_MAX_SEC = 60;
export const SHORTS_MIN_SEC = 45;
const SHORTS_AUDIO_TARGET_SEC = 46;
const SHORTS_AUDIO_CEILING_TARGET_SEC = 58;
const SHORTS_RENDER_SAFE_MAX_SEC = 59.8;
const REMOTION_FPS = 30;
const MIN_SCENE_FRAMES = 45;
const MIN_AUDIO_ATEMPO = 0.7;
const MAX_AUDIO_ATEMPO = 1.35;
const OUTPUT_STEM = "economy-real-short";
const PLAN_VERSION = 3;
const GENERATION_PROMPT_VERSION = "economy-real-grounding-v3-modality";
const RENDER_CONTRACT_VERSION = "economy-real-render-v3-hook-offthread-qc";
const YMYL_DISCLOSURE =
	"※ 본 영상은 실제 보도와 시장 자료를 바탕으로 한 뉴스 해설이며, 투자 조언이 아닙니다.";

// 하드 YMYL 게이트(fail-closed)는 '권유·예측' 어투만 잡는다. make-economy 의
// containsInvestmentAdvice 는 bare 매수|매도 를 매칭해 사실 서술형 수급 용어(순매수/매도세/
// 외국인 매수)에 오탐하므로, 여기선 권유·예측 문맥만 좁게 잡는 전용 패턴을 쓴다.
const ADVICE_RE =
	/사세요|파세요|사야\s*(합니다|해요|한다|된다|됩니다|겠)|팔아야|담으세요|담아라|손절|익절|목표\s*주?가|저점\s*매수|고점\s*매도|불타기|물타기|추천\s*종목|유망\s*종목|수익\s*(을|률)?\s*보장|반드시\s*(오른|내린|상승|하락)|지금\s*(사|들어가|매수|매도)|매수\s*(하세요|하라|해야|추천|타이밍|기회|시점|의견)|매도\s*(하세요|하라|해야|추천|신호|타이밍|시점|의견)|(오를|내릴|상승할|하락할)\s*(것|가능성|전망)|비중\s*(확대|축소)|사면\s*(됩니다|된다|돼)|보유해도\s*(됩니다|된다|좋)|장기\s*보유\s*(하|추천|권)|(상승|하락|강세|약세)\s*전망|투자\s*의견/;
export function looksLikeAdvice(text: string): boolean {
	return ADVICE_RE.test(text);
}

// 지수(KOSPI/KOSDAQ) 차트 비트가 기사 주제와 어긋나지 않도록 증시·시장 관련 기사만 후보로.
const MARKET_RE =
	/증시|코스피|코스닥|주가|증권|시장|지수|환율|금리|채권|외국인|기관|상장|실적|반도체|수출|무역|경기|성장률|물가|인플레|투자심리|나스닥|다우|국채/;

type Asset =
	| { kind: "chart"; source: "tradingview" | "naver"; symbol: string }
	| { kind: "article"; url: string }
	| { kind: "card" };

type CameraMove =
	| "slow-zoom-in"
	| "slider-right"
	| "crash-zoom-in"
	| "handheld";

export interface Beat {
	id: string;
	narration: string;
	asset: Asset;
	cameraMove: CameraMove;
}

export interface EconomyRealCliOptions {
	sample: boolean;
	sourceFile?: string;
	out?: string;
}

export interface EconomyRealOutputPaths {
	video: string;
	srt: string;
	thumbnail: string;
	title: string;
	description: string;
	platformMeta: string;
	renderQc: string;
	manifest: string;
	plan: string;
}

export interface HookVisualFrame {
	atSec: number;
	eyebrow: string;
	headline: string;
	detail: string;
	palette: "midnight" | "paper" | "signal";
}

export interface HookVisualPlan {
	durationSec: number;
	frames: HookVisualFrame[];
}

export interface EconomyRealGenerationPlan {
	version: 3;
	mode: "sample" | "grounded";
	article: RssItem;
	videoTitle: string;
	attribution: string;
	narrations: string[];
	grounding: Grounding;
	sourceSnapshotHash: string;
	renderConfigKey: string;
	fingerprint: string;
}

/** 공용 parseArgs 계약을 쓰되 값이 필요한 옵션의 누락을 즉시 거부한다. */
export function parseEconomyRealArgs(argv: string[]): EconomyRealCliOptions {
	const args = parseArgs(argv);
	for (const key of ["source-file", "out"] as const) {
		if (args[key] === "true") throw new Error(`--${key} 옵션 값이 필요합니다.`);
	}
	const sample = args.sample === "true";
	if (sample && args["source-file"])
		throw new Error("--sample 과 --source-file 은 함께 사용할 수 없습니다.");
	return {
		sample,
		...(args["source-file"] ? { sourceFile: args["source-file"] } : {}),
		...(args.out ? { out: args.out } : {}),
	};
}

/** `{article:{title,link,description,pubDate}}` JSON 텍스트를 고정 기사로 파싱한다. */
export function parseSourceFileJson(text: string): RssItem {
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(
			`source-file JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		return parseEconomySourceManifest(value).article;
	} catch (error) {
		throw new Error(
			`source-file 형식 오류: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** 파일 I/O 경계. 파싱/검증은 parseSourceFileJson 순수 함수에 위임한다. */
export function readSourceArticle(path: string): RssItem {
	try {
		return readEconomySourceManifest(path).article;
	} catch (error) {
		throw new Error(
			`source-file 읽기 실패(${path}): ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/** --out 은 그 디렉터리 자체, 미지정 때만 기존 timestamp 하위 디렉터리를 쓴다. */
export function resolveEconomyRealWorkDir(input: {
	out?: string;
	sample: boolean;
	stamp: string;
	projectRoot: string;
	cwd: string;
}): string {
	if (input.out) return resolve(input.cwd, input.out);
	return join(
		input.projectRoot,
		"output",
		"economy-real",
		`${input.sample ? "sam" : "eco"}-${input.stamp}`,
	);
}

/** 최종 산출물의 표준 경로를 한 곳에서 결정한다. */
export function economyRealOutputPaths(
	workDir: string,
): EconomyRealOutputPaths {
	const base = join(workDir, OUTPUT_STEM);
	return {
		video: `${base}.mp4`,
		srt: `${base}.srt`,
		thumbnail: `${base}_thumb.jpg`,
		title: `${base}.title.txt`,
		description: `${base}.description.txt`,
		platformMeta: `${base}.platform_meta.json`,
		renderQc: `${base}.render_qc.json`,
		manifest: join(workDir, "manifest.json"),
		plan: join(workDir, "generation-plan.json"),
	};
}

function stableJson(value: unknown): string {
	const normalize = (candidate: unknown): unknown => {
		if (Array.isArray(candidate)) return candidate.map(normalize);
		if (candidate && typeof candidate === "object")
			return Object.fromEntries(
				Object.entries(candidate as Record<string, unknown>)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, nested]) => [key, normalize(nested)]),
			);
		return candidate;
	};
	return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** 기사 메타 + 실제 본문(또는 보존된 source snapshot)을 묶은 출처 지문. */
export function buildSourceSnapshotHash(
	article: RssItem,
	sourceSnapshot: string,
): string {
	return sha256(stableJson({ article, sourceSnapshot }));
}

/** 현재 실행의 결과에 영향을 주는 렌더/TTS 설정을 결정적 문자열로 정규화한다. */
export function economyRealRenderConfigKey(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const meloTts = resolveMeloTtsExecutable({
		envPath: env.MELO_TTS,
		projectRoot: PROJECT_ROOT,
		homeDir: homedir(),
		cwd: process.cwd(),
		pathExists: existsSync,
	});
	const ttsSpeed = Math.min(2, Math.max(0.5, Number(env.TTS_SPEED) || 0.9));
	const meloLanguage =
		env.MELO_LANGUAGE?.trim() || env.MELO_LANG?.trim() || "kr";
	const scaleRaw = Number(env.RENDER_SCALE);
	const renderScale =
		Number.isFinite(scaleRaw) && scaleRaw > 0 ? Math.min(4, scaleRaw) : 1;
	const jpegRaw = Number(env.JPEG_QUALITY);
	const jpegQuality =
		Number.isInteger(jpegRaw) && jpegRaw > 0 ? Math.min(100, jpegRaw) : 100;
	return stableJson({
		contract: RENDER_CONTRACT_VERSION,
		compositionId: "YouTubeShorts",
		canvas: "1080x1920",
		fps: REMOTION_FPS,
		offthreadVideo: true,
		hookVisual: "three-phase-0-1-2s",
		subtitles: "chunked-pill-gold",
		bgm: "sfx/dark-ambient.mp3",
		meloExecutable: meloTts.executable ?? "<unresolved>",
		meloTtsOverride: meloTts.normalizedOverride,
		meloLanguage,
		meloVoice: env.MELO_VOICE?.trim() || "",
		meloSpeaker: env.MELO_SPEAKER?.trim() || "",
		ttsVoice: env.TTS_VOICE?.trim() || "",
		ttsSpeed,
		renderScale,
		jpegQuality,
	});
}

export interface EconomyRealFingerprintInput {
	article: RssItem;
	videoTitle: string;
	attribution: string;
	sourceSnapshotHash: string;
	narrations: string[];
	renderConfigKey: string;
}

/** source/prompt/plan/narration/render config 전체를 묶은 asset 재사용 SHA-256. */
export function buildEconomyRealFingerprint(
	input: EconomyRealFingerprintInput,
): string {
	return sha256(
		stableJson({
			planVersion: PLAN_VERSION,
			promptVersion: GENERATION_PROMPT_VERSION,
			article: input.article,
			videoTitle: input.videoTitle,
			// 출처 로워서드로 영상에 렌더되므로 attribution 정정 시 지문도 갱신되어야
			// 낡은 출처표기 영상이 resume 재사용되지 않는다(fail-toward-regenerate).
			attribution: input.attribution,
			sourceSnapshotHash: input.sourceSnapshotHash,
			narrations: input.narrations,
			renderConfigKey: input.renderConfigKey,
		}),
	);
}

/** videoTitle/attribution이 지문에 추가되기 전 v3 저장 계획만 검증하기 위한 호환 공식. */
export function buildLegacyEconomyRealFingerprintV3(
	input: Omit<EconomyRealFingerprintInput, "videoTitle" | "attribution">,
): string {
	return sha256(
		stableJson({
			planVersion: PLAN_VERSION,
			promptVersion: GENERATION_PROMPT_VERSION,
			article: input.article,
			sourceSnapshotHash: input.sourceSnapshotHash,
			narrations: input.narrations,
			renderConfigKey: input.renderConfigKey,
		}),
	);
}

type GenerationPlanCore = Pick<
	EconomyRealGenerationPlan,
	"mode" | "article" | "videoTitle" | "attribution" | "narrations" | "grounding"
>;

function fingerprintGenerationPlan(
	core: GenerationPlanCore,
	sourceSnapshotHash: string,
	renderConfigKey = economyRealRenderConfigKey(),
): EconomyRealGenerationPlan {
	const fingerprint = buildEconomyRealFingerprint({
		article: core.article,
		videoTitle: core.videoTitle,
		attribution: core.attribution,
		sourceSnapshotHash,
		narrations: core.narrations,
		renderConfigKey,
	});
	return {
		version: PLAN_VERSION,
		...core,
		sourceSnapshotHash,
		renderConfigKey,
		fingerprint,
	};
}

/** 저장 콘텐츠는 유지하고 현재 렌더/TTS 계약으로만 계획 지문을 갱신한다. */
export function refreshGenerationPlanRenderContract(
	plan: EconomyRealGenerationPlan,
	renderConfigKey = economyRealRenderConfigKey(),
): EconomyRealGenerationPlan {
	return fingerprintGenerationPlan(
		{
			mode: plan.mode,
			article: plan.article,
			videoTitle: plan.videoTitle,
			attribution: plan.attribution,
			narrations: plan.narrations,
			grounding: plan.grounding,
		},
		plan.sourceSnapshotHash,
		renderConfigKey,
	);
}

/**
 * grounded 계획에만 LLM 백스톱(assertGroundedEconomyClaims)을 적용한다.
 * --sample 은 백엔드(api-proxy) 없이 시각 스타일만 검증하는 계약이라 proxyChatJSON을
 * 부르는 이 LLM 대조를 건너뛴다(백엔드 없으면 크래시). 앞선 findYmylViolation/
 * findGroundingModalityViolations/findUngroundedNumberViolations 순수·로컬 게이트는
 * sample 에서도 그대로 적용된다. assertFn 은 테스트 주입용.
 */
export async function assertGroundedClaimsForPlan(
	plan: Pick<EconomyRealGenerationPlan, "mode" | "grounding">,
	narrations: string[],
	assertFn: typeof assertGroundedEconomyClaims = assertGroundedEconomyClaims,
): Promise<void> {
	if (plan.mode === "sample") return;
	await assertFn(plan.grounding, narrations);
}

function compactText(value: string, maxCodePoints: number): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	const points = Array.from(normalized);
	return points.length > maxCodePoints
		? `${points.slice(0, maxCodePoints).join("")}…`
		: normalized;
}

/** 첫 3초: 0s/1s/2s 세 카드로 두 번 하드 전환하는 실사 경제쇼츠 hook 계약. */
export function buildHookVisualPlan(
	title: string,
	narration: string,
): HookVisualPlan {
	const signalMatch = `${title} ${narration}`.match(
		/\d[\d,.]*(?:\s*(?:%|조|억|만|원|배|포인트|bp))?/i,
	);
	const coreSignal =
		signalMatch?.[0].replace(/\s+/g, "") ?? compactText(title, 18);
	return {
		durationSec: SHORTS_MAX_SEC,
		frames: [
			{
				atSec: 0,
				eyebrow: signalMatch ? "지금 봐야 할 핵심 숫자" : "오늘의 경제 핵심",
				headline: coreSignal || "경제 브리핑",
				detail: compactText(title, 44),
				palette: "midnight",
			},
			{
				atSec: 1,
				eyebrow: "1초 핵심",
				headline: "왜 지금?",
				detail: compactText(narration, 56),
				palette: "paper",
			},
			{
				atSec: 2,
				eyebrow: "FACT CHECK",
				headline: "기사 + 차트",
				detail: "실제 보도와 시장 화면으로 바로 확인합니다",
				palette: "signal",
			},
		],
	};
}

/** weak opening hook을 출고 전에 결정적으로 판정하는 순수 품질 계약. */
export function hookVisualContractFailures(plan: HookVisualPlan): string[] {
	const failures: string[] = [];
	if (plan.durationSec < 3) failures.push("hook-duration");
	if (plan.frames[0]?.atSec !== 0) failures.push("hook-first-frame");
	const changesInFirst3Sec = new Set(
		plan.frames
			.map((frame) => frame.atSec)
			.filter((atSec) => atSec > 0 && atSec <= 3),
	).size;
	if (changesInFirst3Sec < 2) failures.push("hook-visual-changes");
	if (
		plan.frames.some((frame) => !frame.headline.trim() || !frame.detail.trim())
	)
		failures.push("hook-big-copy");
	if (new Set(plan.frames.map((frame) => frame.palette)).size < 3)
		failures.push("hook-palette-contrast");
	return failures;
}

/** env → 저장소 내부 → 사용자 로컬 설치 순서. 사용자명 하드코딩은 없다. */
export function meloTtsCandidates(input: {
	envPath?: string;
	projectRoot: string;
	homeDir: string;
}): string[] {
	const workspaceRoot = dirname(input.projectRoot);
	return [
		input.envPath?.trim(),
		join(input.projectRoot, "scripts", "tts-melo.sh"),
		join(input.projectRoot, "bin", "tts-melo.sh"),
		join(workspaceRoot, "scripts", "tts-melo.sh"),
		join(workspaceRoot, "bin", "tts-melo.sh"),
		join(input.homeDir, ".local", "bin", "tts-melo.sh"),
		join(input.homeDir, "bin", "tts-melo.sh"),
		join(input.homeDir, "AI", "video-factory", "bin", "tts-melo.sh"),
	].filter((candidate, index, all): candidate is string =>
		Boolean(candidate && all.indexOf(candidate) === index),
	);
}

/** 후보 탐색은 exists 주입이 가능해 테스트에서 파일시스템과 분리된다. */
export function firstExistingPath(
	candidates: string[],
	pathExists: (path: string) => boolean,
): string | null {
	return candidates.find(pathExists) ?? null;
}

interface MeloTtsExecutableSelection {
	candidates: string[];
	executable: string | null;
	normalizedOverride: string;
}

/** ttsLocal과 render fingerprint가 반드시 같은 Melo 실행 파일 선택 순서를 쓴다. */
function resolveMeloTtsExecutable(input: {
	envPath?: string;
	projectRoot: string;
	homeDir: string;
	cwd: string;
	pathExists: (path: string) => boolean;
}): MeloTtsExecutableSelection {
	const candidates = meloTtsCandidates(input).map((candidate) =>
		resolve(input.cwd, candidate),
	);
	const executable = firstExistingPath(candidates, input.pathExists);
	const override = input.envPath?.trim();
	return {
		candidates,
		executable,
		normalizedOverride: override ? resolve(input.cwd, override) : "",
	};
}

/** 빈 본문으로는 구버전 계획의 modality를 재검증할 수 없으므로 승격을 중단한다. */
export function requireLegacyGroundingBody(body: string): string {
	try {
		return requireGroundingBody(body);
	} catch {
		throw new Error(
			"legacy plan 본문 재수집 실패: primary-only 근거로 계획을 승격할 수 없습니다 (fail-closed)",
		);
	}
}

/** 제목·요약·나레이션 중 첫 YMYL 위반 위치. 없으면 null. */
export function findYmylViolation(input: {
	title: string;
	description?: string;
	narrations: string[];
}): string | null {
	if (looksLikeAdvice(input.title)) return "title";
	if (input.description && looksLikeAdvice(input.description))
		return "description";
	const index = input.narrations.findIndex(looksLikeAdvice);
	return index >= 0 ? `narration:${index + 1}` : null;
}

/** Remotion Shorts(카드 없음)와 같은 0초 시작 씬별 SRT. */
export function buildEconomyRealSrt(
	scenes: { narration: string; durationSec: number }[],
): string {
	let cursor = 0;
	return scenes
		.map((scene, index) => {
			if (!Number.isFinite(scene.durationSec) || scene.durationSec <= 0)
				throw new Error(`SRT duration 오류(씬 ${index + 1})`);
			const start = cursor;
			cursor += scene.durationSec;
			return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${scene.narration.trim()}`;
		})
		.join("\n\n")
		.concat("\n");
}

/** runVerifyOutput 경고 정책보다 엄격한 실사 쇼츠 출고 게이트(contact sheet 포함). */
export function finalQcFailures(
	report: VerifyReport,
	videoSec: number,
	maxSec = SHORTS_MAX_SEC,
	minSec = SHORTS_MIN_SEC,
): string[] {
	const failures: string[] = [];
	if (!Number.isFinite(videoSec) || videoSec <= 0 || videoSec > maxSec)
		failures.push(`duration:${videoSec}`);
	else if (videoSec < minSec) failures.push(`duration-under:${videoSec}`);
	for (const name of [
		"video-duration",
		"srt-tail",
		"cut-count",
		"contact-sheet",
	]) {
		const check = report.checks.find((candidate) => candidate.name === name);
		if (!check?.ok) failures.push(name);
	}
	if (!report.ok && failures.length === 0) failures.push("verify-report");
	return failures;
}

/** 실사 쇼츠 강한 QC: 세로 1080x1920 + 85점 이상 + issues 0건을 모두 요구한다. */
export function isStrongRenderQcAcceptable(report: {
	score: number;
	issues: string[];
	metrics: { video: { width: number; height: number } | null };
}): boolean {
	const video = report.metrics.video;
	return (
		video?.width === 1080 &&
		video.height === 1920 &&
		Number.isFinite(report.score) &&
		report.score >= 85 &&
		report.issues.length === 0
	);
}

/** import 테스트에서 main 이 실행되지 않도록 절대경로 기반으로 판별한다. */
export function isMainModule(
	moduleUrl: string,
	argvEntry: string | undefined,
): boolean {
	if (!argvEntry) return false;
	try {
		return fileURLToPath(moduleUrl) === resolve(argvEntry);
	} catch {
		return false;
	}
}

// 비트 골격(역할/자산/카메라무빙) — narration 은 grounded LLM 이 채운다. 지수 차트는
// KOSPI/KOSDAQ(시장 전체 지수)만 사용: 항상 사실적으로 유효 + 종목→티커 매핑 불필요 +
// 개별종목 방향 단정 회피(YMYL). 역할 문자열은 LLM 프롬프트에 그대로 들어간다.
const GROUNDED_PLAN: {
	id: string;
	role: string;
	asset: Asset;
	cameraMove: CameraMove;
}[] = [
	{
		id: "hook",
		role: "hook: 숫자나 반전으로 강하게 시작해 0~3초 이탈을 막는 훅 한 문장",
		asset: { kind: "card" },
		cameraMove: "crash-zoom-in",
	},
	{
		id: "evidence",
		role: "evidence: '실제 기사를 보자'는 흐름으로 이 뉴스가 왜 중요한지 한 문장",
		asset: { kind: "article", url: "" },
		cameraMove: "slow-zoom-in",
	},
	{
		id: "chart-kospi",
		role: "market_kospi: 코스피(시장 전체) 지수를 왜 같이 봐야 하는지. 지수의 방향·수치는 단정하지 말 것(화면 차트가 실제 값을 보여준다)",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSPI" },
		cameraMove: "handheld",
	},
	{
		id: "chart-kosdaq",
		role: "market_kosdaq: 코스닥(성장주 시장)까지 넓혀 보는 맥락. 역시 방향·수치 단정 금지",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSDAQ" },
		cameraMove: "slider-right",
	},
	{
		id: "payoff",
		role: "payoff: 투자 조언 없이 이 뉴스를 어떻게 바라보면 좋을지 관점으로 마무리",
		asset: { kind: "card" },
		cameraMove: "slow-zoom-in",
	},
];

// --sample: 백엔드 없이 시각/편집 스타일만 검증하는 하드코딩 삼성전자 경로(방향 주장은 샘플용).
const SAMPLE_BEATS: Beat[] = [
	{
		id: "hook",
		narration:
			"삼성전자를 두고 시장의 시선이 엇갈립니다. 차트부터 같이 보시죠.",
		asset: { kind: "card" },
		cameraMove: "crash-zoom-in",
	},
	{
		id: "evidence",
		narration:
			"최근 증권가에서는 삼성전자를 두고 의견이 크게 엇갈리고 있습니다. 실제 기사부터 같이 보시죠.",
		asset: { kind: "article", url: "" },
		cameraMove: "slow-zoom-in",
	},
	{
		id: "chart-kospi",
		narration:
			"개별 종목만이 아닙니다. 코스피 지수 흐름과 같이 봐야 시장 전체 분위기가 보입니다.",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSPI" },
		cameraMove: "handheld",
	},
	{
		id: "chart-kosdaq",
		narration:
			"코스닥까지 넓혀 보면 성장주 시장의 온도까지 함께 읽을 수 있습니다.",
		asset: { kind: "chart", source: "tradingview", symbol: "KRX:KOSDAQ" },
		cameraMove: "slider-right",
	},
	{
		id: "payoff",
		narration:
			"핵심은 타이밍이 아니라 방향입니다. 지수와 실적을 같이 보는 습관이 먼저입니다.",
		asset: { kind: "card" },
		cameraMove: "slow-zoom-in",
	},
];

async function poster(clip: string, out: string): Promise<string> {
	await exec("ffmpeg", ["-y", "-ss", "1", "-i", clip, "-frames:v", "1", out]);
	return out;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function editorialCardHtml(frame: HookVisualFrame, index: number): string {
	const colors = {
		midnight: { bg: "#070b14", fg: "#f8f4ea", accent: "#ffd51f" },
		paper: { bg: "#f0eadc", fg: "#101116", accent: "#d81f3e" },
		signal: { bg: "#c90f36", fg: "#fff8ea", accent: "#ffe447" },
	}[frame.palette];
	const headlineSize = Array.from(frame.headline).length > 14 ? 108 : 168;
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
		*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
		body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;background:${colors.bg};color:${colors.fg}}
		.card{position:relative;width:100%;height:100%;padding:110px 86px 104px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
		.card:before{content:"";position:absolute;width:720px;height:720px;border:70px solid ${colors.accent};border-radius:50%;right:-420px;top:-330px;opacity:.95}
		.card:after{content:"";position:absolute;width:760px;height:42px;background:${colors.accent};left:-170px;bottom:330px;transform:rotate(-11deg)}
		.top{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;border-top:8px solid ${colors.accent};padding-top:32px}
		.eyebrow{font-size:36px;font-weight:900;letter-spacing:-1px;text-transform:uppercase}
		.index{font:900 74px/1 Menlo,monospace;color:${colors.accent}}
		.main{position:relative;z-index:2;margin-top:-80px}
		.signal{display:inline-block;background:${colors.accent};color:${colors.bg};font-size:32px;font-weight:1000;padding:16px 24px;margin-bottom:44px;letter-spacing:1px}
		h1{font-size:${headlineSize}px;line-height:.98;letter-spacing:-7px;margin:0;max-width:920px;font-weight:1000;word-break:keep-all;text-wrap:balance;text-shadow:0 8px 0 rgba(0,0,0,.12)}
		.detail{font-size:58px;line-height:1.24;letter-spacing:-2.5px;font-weight:800;max-width:900px;margin-top:56px;word-break:keep-all;text-wrap:balance}
		.footer{position:relative;z-index:2;display:flex;align-items:flex-end;justify-content:space-between;border-bottom:8px solid ${colors.accent};padding-bottom:32px;font:800 25px/1.3 Menlo,monospace;letter-spacing:1px}
		.live{display:flex;align-items:center;gap:14px}.dot{width:22px;height:22px;border-radius:50%;background:${colors.accent};box-shadow:0 0 0 12px color-mix(in srgb,${colors.accent} 24%,transparent)}
	</style></head><body><main class="card">
		<div class="top"><div class="eyebrow">${escapeHtml(frame.eyebrow)}</div><div class="index">0${index + 1}</div></div>
		<section class="main"><div class="signal">ECONOMY / REAL SOURCE</div><h1>${escapeHtml(frame.headline)}</h1><div class="detail">${escapeHtml(frame.detail)}</div></section>
		<footer class="footer"><div class="live"><span class="dot"></span>FACTS ON SCREEN</div><div>MARKET BRIEF / 9:16</div></footer>
	</main></body></html>`;
}

async function renderEditorialCards(
	frames: HookVisualFrame[],
	outPaths: string[],
): Promise<void> {
	if (frames.length !== outPaths.length)
		throw new Error("editorial card frame/path 개수 불일치");
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1080, height: 1920 },
			deviceScaleFactor: 1,
		});
		for (let index = 0; index < frames.length; index++) {
			await page.setContent(editorialCardHtml(frames[index], index), {
				waitUntil: "load",
			});
			await page.screenshot({
				path: outPaths[index],
				animations: "disabled",
			});
		}
	} finally {
		await browser.close();
	}
}

export async function renderHookVisualAssets(
	plan: HookVisualPlan,
	framePaths: string[],
	videoPath: string,
): Promise<void> {
	const contractFailures = hookVisualContractFailures(plan);
	if (contractFailures.length)
		throw new Error(`hook 시각 계약 실패: ${contractFailures.join(", ")}`);
	await renderEditorialCards(plan.frames, framePaths);
	const durations = plan.frames.map((frame, index) => {
		const next = plan.frames[index + 1]?.atSec ?? plan.durationSec;
		return Math.max(0.1, next - frame.atSec);
	});
	const inputs = framePaths.flatMap((path, index) => [
		"-loop",
		"1",
		"-framerate",
		"30",
		"-t",
		String(durations[index]),
		"-i",
		path,
	]);
	const filters = framePaths
		.map(
			(_, index) =>
				`[${index}:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v${index}]`,
		)
		.join(";");
	const concatInputs = framePaths.map((_, index) => `[v${index}]`).join("");
	await exec("ffmpeg", [
		"-y",
		...inputs,
		"-filter_complex",
		`${filters};${concatInputs}concat=n=${framePaths.length}:v=1:a=0[out]`,
		"-map",
		"[out]",
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-crf",
		"18",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		videoPath,
	]);
}

async function ttsLocal(text: string, wav: string, mp3: string) {
	const selection = resolveMeloTtsExecutable({
		envPath: process.env.MELO_TTS,
		projectRoot: PROJECT_ROOT,
		homeDir: homedir(),
		cwd: process.cwd(),
		pathExists: existsSync,
	});
	const meloTts = selection.executable;
	if (!meloTts) {
		throw new Error(
			`MeloTTS 스크립트를 찾을 수 없습니다. 검색 경로: ${selection.candidates.join(", ")} — MELO_TTS 환경변수로 경로를 지정하세요.`,
		);
	}
	await exec(meloTts, [
		text,
		wav,
		process.env.MELO_LANGUAGE?.trim() || process.env.MELO_LANG?.trim() || "kr",
		String(Math.min(2, Math.max(0.5, Number(process.env.TTS_SPEED) || 0.9))),
	]);
	await exec("ffmpeg", [
		"-y",
		"-i",
		wav,
		"-c:a",
		"libmp3lame",
		"-q:a",
		"2",
		mp3,
	]);
}

async function dur(mp3: string): Promise<number> {
	const { stdout } = await exec("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		mp3,
	]);
	return Math.max(1.5, Number.parseFloat(stdout.trim()) || 3);
}

/** 45초 미만 음성을 46초 목표로 자연스럽게 늘릴 atempo 비율(1이면 변경 없음). */
export function audioStretchFactor(
	totalSec: number,
	targetSec = SHORTS_AUDIO_TARGET_SEC,
): number {
	if (!Number.isFinite(totalSec) || totalSec <= 0 || targetSec <= 0) return 0;
	return Math.min(1, totalSec / targetSec);
}

/**
 * Remotion Shorts 실길이 예측. 렌더러는 비트마다 `ceil(audioSec*30)` 한 뒤
 * 전환 패딩/오버랩을 정확히 상쇄하므로 총길이는 씬별 ceil 프레임 합이다.
 */
export function estimateRenderedShortsSec(
	durationsSec: number[],
	fps = REMOTION_FPS,
): number {
	if (
		!Number.isFinite(fps) ||
		fps <= 0 ||
		durationsSec.some((duration) => !Number.isFinite(duration) || duration <= 0)
	)
		return Number.POSITIVE_INFINITY;
	const frames = durationsSec.reduce(
		(sum, duration) =>
			sum + Math.max(MIN_SCENE_FRAMES, Math.ceil(duration * fps)),
		0,
	);
	return frames / fps;
}

/** 45~60초 계약을 만족시키기 위한 보정 목표. 59.8초에서 미리 보정해 ceil 여유를 둔다. */
export function shortsAudioNormalizationTarget(
	durationsSec: number[],
): number | null {
	const audioSec = durationsSec.reduce((sum, duration) => sum + duration, 0);
	if (!Number.isFinite(audioSec) || audioSec <= 0)
		return SHORTS_AUDIO_TARGET_SEC;
	if (audioSec < SHORTS_MIN_SEC) return SHORTS_AUDIO_TARGET_SEC;
	if (estimateRenderedShortsSec(durationsSec) > SHORTS_RENDER_SAFE_MAX_SEC)
		return SHORTS_AUDIO_CEILING_TARGET_SEC;
	return null;
}

async function normalizeAudioWindow(
	scenes: { audioUrl: string; durationSec: number }[],
): Promise<boolean> {
	const current = scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
	const target = shortsAudioNormalizationTarget(
		scenes.map((scene) => scene.durationSec),
	);
	if (target === null) return false;
	const factor = current / target;
	if (factor < MIN_AUDIO_ATEMPO || factor > MAX_AUDIO_ATEMPO)
		throw new Error(
			`쇼츠 음성이 ${current.toFixed(2)}초로 자동 보정 범위를 벗어났습니다(atempo ${factor.toFixed(3)}, 허용 ${MIN_AUDIO_ATEMPO}~${MAX_AUDIO_ATEMPO}).`,
		);
	for (const scene of scenes) {
		const stretched = `${scene.audioUrl}.stretch.mp3`;
		await exec("ffmpeg", [
			"-y",
			"-i",
			scene.audioUrl,
			"-filter:a",
			`atempo=${factor.toFixed(6)}`,
			"-c:a",
			"libmp3lame",
			"-q:a",
			"2",
			stretched,
		]);
		renameSync(stretched, scene.audioUrl);
		scene.durationSec = await dur(scene.audioUrl);
	}
	return true;
}

async function realSamsungArticleUrl(): Promise<string> {
	// --sample 전용: 실제 현재 삼성전자 기사를 네이버 뉴스 검색에서 1건.
	try {
		const res = await fetch(
			"https://search.naver.com/search.naver?where=news&query=" +
				encodeURIComponent("삼성전자 주가"),
			{ headers: { "User-Agent": "Mozilla/5.0" } },
		);
		const html = await res.text();
		const m = html.match(
			/https:\/\/n\.news\.naver\.com\/mnews\/article\/\d+\/\d+/,
		);
		if (m) return m[0];
	} catch {
		/* fall through */
	}
	// Fallback: economy section top article. 네트워크 실패해도 기본 URL 반환 —
	// 이 함수의 예외가 전체 파이프라인을 중단시키지 않도록 fetch 를 감싼다.
	try {
		const res = await fetch("https://news.naver.com/section/101", {
			headers: { "User-Agent": "Mozilla/5.0" },
		});
		const html = await res.text();
		const m = html.match(
			/https:\/\/n\.news\.naver\.com\/mnews\/article\/\d+\/\d+/,
		);
		if (m) return m[0];
	} catch {
		/* 네트워크 실패 → 기본 섹션 URL 로 폴백 */
	}
	return "https://news.naver.com/section/101";
}

/**
 * grounded 나레이션 — 실제 기사(grounding)에 근거해 GROUNDED_PLAN 역할별 문장 생성.
 * YMYL: 투자조언 + 출처 확실성(기대/추진을 완료 사실로 승격 금지) 이중 사후 게이트.
 * 개수/YMYL/확실성 위반 시 교정 지시로 정확히 1회 재생성 후에도 불만족이면 fail-closed.
 */
async function groundedNarrations(g: Grounding): Promise<string[]> {
	const roles = GROUNDED_PLAN.map((b, i) => `${i + 1}. ${b.role}`).join("\n");
	const usr = `${groundingContext(g)}\n\n위 자료의 '사실에만' 근거해, 세로 숏폼 경제 뉴스 해설의 ${GROUNDED_PLAN.length}개 씬 나레이션을 쓴다. 각 씬은 한국어 1문장, 35~55자(약 8~10초), 짧고 임팩트 있는 구어체로 쓴다. 전체 음성은 45~60초가 되게 하고 아래 역할·순서를 그대로 따르며 각 항목 1문장씩 작성한다:\n${roles}\n기사에서 기대·전망·예정·추진·가능성으로 표현한 기업 이벤트는 나레이션에서도 같은 불확실성 수준과 표현을 반드시 유지한다. 예: '40조 조달 추진'을 '40조를 조달합니다'로 확정하지 말고 '40조 조달을 추진합니다'로 쓴다.\n투자 조언·종목 추천·매수매도 권유·가격 예측·기사에 없는 수치 창작 절대 금지(YMYL).\nJSON: {"beats":[{"narration":"..."}]}`;
	const attempt = async (prompt: string): Promise<string[]> => {
		const parsed = (await proxyChatJSON(ECON_SYSTEM, prompt)) as {
			beats?: { narration?: string }[];
		};
		return (Array.isArray(parsed.beats) ? parsed.beats : [])
			.map((b) => (b?.narration ?? "").trim())
			.filter(Boolean);
	};
	const validate = (lines: string[]) => {
		const selected = lines.slice(0, GROUNDED_PLAN.length);
		return {
			incomplete: lines.length < GROUNDED_PLAN.length,
			adviceIndex: selected.findIndex(looksLikeAdvice),
			modalityViolations: findGroundingModalityViolations(g, selected),
		};
	};

	let lines = await attempt(usr);
	let validation = validate(lines);
	if (
		validation.incomplete ||
		validation.adviceIndex >= 0 ||
		validation.modalityViolations.length > 0
	) {
		const reasons = [
			validation.incomplete ? "씬 개수 미달" : "",
			validation.adviceIndex >= 0
				? `투자조언 씬 ${validation.adviceIndex + 1}`
				: "",
			validation.modalityViolations.length > 0
				? `출처 확실성 승격 씬 ${validation.modalityViolations.map((index) => index + 1).join(", ")}`
				: "",
		]
			.filter(Boolean)
			.join(" / ");
		process.stdout.write(`   grounded 나레이션 교정 재생성(${reasons})...\n`);
		const correctivePrompt = `${usr}\n\n이전 출력은 다음 검증에 실패했다: ${reasons}. 이전 출력: ${JSON.stringify(lines)}\n전체 ${GROUNDED_PLAN.length}개 씬을 다시 작성하라. 특히 출처가 기대·전망·예정·추진·가능성으로 표현한 조달·상장·승인·발행·유입 등 기업 이벤트를 완료/확정형으로 바꾸지 말고 동일한 불확실성 표현을 문장 안에 명시하라.`;
		lines = await attempt(correctivePrompt);
		validation = validate(lines);
	}
	if (validation.incomplete)
		throw new Error(
			`grounded 나레이션 불완전(${lines.length}/${GROUNDED_PLAN.length}씬) — 재실행 권장`,
		);
	if (validation.adviceIndex >= 0)
		throw new Error(
			`YMYL 위반 나레이션(씬 ${validation.adviceIndex + 1}) — 재실행 권장(fail-closed)`,
		);
	if (validation.modalityViolations.length > 0)
		throw new Error(
			`YMYL 출처 확실성 게이트 실패(씬 ${validation.modalityViolations.map((index) => index + 1).join(", ")}) — 기대/추진을 확정 사실로 바꿀 수 없습니다.`,
		);
	return lines.slice(0, GROUNDED_PLAN.length);
}

/** grounded 비트 조립 — 역할 골격 + LLM 나레이션 + 실제 기사 URL. */
export function buildGroundedBeats(
	narrations: string[],
	articleUrl: string,
): Beat[] {
	if (narrations.length !== GROUNDED_PLAN.length)
		throw new Error(
			`grounded 나레이션 개수 오류(${narrations.length}/${GROUNDED_PLAN.length})`,
		);
	return GROUNDED_PLAN.map((p, i) => ({
		id: p.id,
		narration: narrations[i],
		asset:
			p.asset.kind === "article" ? { ...p.asset, url: articleUrl } : p.asset,
		cameraMove: p.cameraMove,
	}));
}

/** 재실행용 콘텐츠 계획 JSON. 미디어 파일을 재사용해도 나레이션-음성 불일치가 없게 고정한다. */
function parseStoredGrounding(value: unknown, article: RssItem): Grounding {
	if (!value || typeof value !== "object")
		return { primary: article, body: article.description, related: [] };
	const root = value as Record<string, unknown>;
	const body = typeof root.body === "string" ? root.body.trim() : "";
	const related = Array.isArray(root.related)
		? root.related.map((candidate, index) => {
				try {
					return parseEconomySourceManifest({ article: candidate }).article;
				} catch (error) {
					throw new Error(
						`generation-plan grounding.related[${index}] 오류: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			})
		: [];
	return { primary: article, body, related };
}

export interface EconomyRealGenerationPlanLoad {
	plan: EconomyRealGenerationPlan;
	fingerprintContract: "current" | "legacy-v3" | "migrated";
	trustedForAssetReuse: boolean;
}

function parseGenerationPlanJsonInternal(
	text: string,
	validateModality: boolean,
	currentRenderConfigKey = economyRealRenderConfigKey(),
): EconomyRealGenerationPlanLoad {
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(
			`generation-plan JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!value || typeof value !== "object")
		throw new Error("generation-plan 형식 오류: object required");
	const root = value as Record<string, unknown>;
	if (root.version !== 1 && root.version !== 2 && root.version !== PLAN_VERSION)
		throw new Error(`generation-plan 버전 오류: ${String(root.version)}`);
	if (root.mode !== "sample" && root.mode !== "grounded")
		throw new Error("generation-plan mode 오류");
	const article = parseEconomySourceManifest({ article: root.article }).article;
	if (
		root.version === PLAN_VERSION &&
		(!root.grounding || typeof root.grounding !== "object")
	)
		throw new Error("generation-plan v3 grounding snapshot 누락");
	const grounding = parseStoredGrounding(root.grounding, article);
	const videoTitle =
		typeof root.videoTitle === "string" ? root.videoTitle.trim() : "";
	const attribution =
		typeof root.attribution === "string" ? root.attribution.trim() : "";
	if (
		!Array.isArray(root.narrations) ||
		root.narrations.length !== GROUNDED_PLAN.length ||
		root.narrations.some(
			(line) => typeof line !== "string" || line.trim().length === 0,
		)
	)
		throw new Error("generation-plan 제목/나레이션 형식 오류");
	const narrations = root.narrations.map((line) => (line as string).trim());
	if (!videoTitle) throw new Error("generation-plan 제목/나레이션 형식 오류");
	const violation = findYmylViolation({
		title: videoTitle,
		description: article.description,
		narrations,
	});
	if (violation) throw new Error(`generation-plan YMYL 위반: ${violation}`);
	const modalityViolations = findGroundingModalityViolations(
		grounding,
		narrations,
	);
	if (validateModality && modalityViolations.length > 0)
		throw new Error(
			`generation-plan 출처 확실성 위반(씬 ${modalityViolations.map((index) => index + 1).join(", ")})`,
		);
	const numberViolations = findUngroundedNumberViolations(
		grounding,
		narrations,
	);
	if (validateModality && numberViolations.length > 0)
		throw new Error(
			`generation-plan 출처 숫자 위반(씬 ${numberViolations.map((index) => index + 1).join(", ")})`,
		);
	const hasSourceSnapshotHash =
		typeof root.sourceSnapshotHash === "string" &&
		/^[a-f0-9]{64}$/.test(root.sourceSnapshotHash);
	const hasRenderConfigKey =
		typeof root.renderConfigKey === "string" && root.renderConfigKey.length > 0;
	if (
		root.version === PLAN_VERSION &&
		(!hasSourceSnapshotHash ||
			!hasRenderConfigKey ||
			typeof root.fingerprint !== "string")
	)
		throw new Error("generation-plan v3 fingerprint 계약 누락");
	const computedSourceSnapshotHash = buildSourceSnapshotHash(
		article,
		stableJson({ body: grounding.body, related: grounding.related }),
	);
	if (
		root.version === PLAN_VERSION &&
		root.sourceSnapshotHash !== computedSourceSnapshotHash
	)
		throw new Error("generation-plan grounding snapshot hash 불일치");
	const sourceSnapshotHash =
		root.version === PLAN_VERSION
			? (root.sourceSnapshotHash as string)
			: computedSourceSnapshotHash;
	const renderConfigKey = hasRenderConfigKey
		? (root.renderConfigKey as string)
		: economyRealRenderConfigKey();
	const plan = fingerprintGenerationPlan(
		{
			mode: root.mode,
			article,
			videoTitle,
			attribution,
			narrations,
			grounding,
		},
		sourceSnapshotHash,
		renderConfigKey,
	);
	let fingerprintContract: EconomyRealGenerationPlanLoad["fingerprintContract"] =
		"migrated";
	if (root.version === PLAN_VERSION && typeof root.fingerprint === "string") {
		if (root.fingerprint === plan.fingerprint) {
			fingerprintContract = "current";
		} else {
			const legacyFingerprint = buildLegacyEconomyRealFingerprintV3({
				article,
				sourceSnapshotHash,
				narrations,
				renderConfigKey,
			});
			if (root.fingerprint !== legacyFingerprint)
				throw new Error("generation-plan fingerprint 불일치");
			fingerprintContract = "legacy-v3";
		}
	}
	return {
		plan,
		fingerprintContract,
		trustedForAssetReuse:
			fingerprintContract === "current" &&
			renderConfigKey === currentRenderConfigKey,
	};
}

/**
 * 현재/알려진 구형 v3를 구조적으로 읽고 자산 신뢰 상태를 별도로 반환한다.
 * 임의의 지문 불일치는 계속 거부한다.
 */
export function loadGenerationPlanJson(
	text: string,
	currentRenderConfigKey = economyRealRenderConfigKey(),
): EconomyRealGenerationPlanLoad {
	return parseGenerationPlanJsonInternal(text, true, currentRenderConfigKey);
}

/** 현재 v3 plan은 저장된 full Grounding까지 즉시 semantic 검증한다. */
export function parseGenerationPlanJson(
	text: string,
): EconomyRealGenerationPlan {
	return loadGenerationPlanJson(text).plan;
}

/**
 * v1/v2 전용 구조 마이그레이션 파서. 불완전한 primary-only snapshot으로 의미 판정을
 * 내리지 않고, main이 본문을 다시 가져온 뒤 full Grounding으로 검사/재생성한다.
 */
export function parseLegacyGenerationPlanJson(
	text: string,
): EconomyRealGenerationPlan {
	let version: unknown;
	try {
		version = (JSON.parse(text) as { version?: unknown }).version;
	} catch {
		// 내부 파서가 일관된 JSON 오류를 생성한다.
		return parseGenerationPlanJsonInternal(text, false).plan;
	}
	if (version !== 1 && version !== 2)
		throw new Error(`legacy generation-plan 버전 오류: ${String(version)}`);
	return parseGenerationPlanJsonInternal(text, false).plan;
}

/** 구버전 manifest.json을 generation-plan으로 승격해 기존 음성/차트도 안전하게 재사용한다. */
export function parseLegacyManifestJson(
	text: string,
	fixedArticle?: RssItem,
): EconomyRealGenerationPlan {
	let value: unknown;
	try {
		value = JSON.parse(text) as unknown;
	} catch (error) {
		throw new Error(
			`legacy manifest JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!value || typeof value !== "object")
		throw new Error("legacy manifest 형식 오류");
	const root = value as Record<string, unknown>;
	const videoTitle = typeof root.title === "string" ? root.title.trim() : "";
	const articleUrl =
		typeof root.articleUrl === "string"
			? root.articleUrl.trim()
			: root.article && typeof root.article === "object"
				? String((root.article as Record<string, unknown>).link ?? "").trim()
				: "";
	if (fixedArticle && fixedArticle.link !== articleUrl)
		throw new Error("legacy manifest와 --source-file 기사 URL 불일치");
	const article =
		fixedArticle ??
		parseEconomySourceManifest({
			article:
				root.article && typeof root.article === "object"
					? root.article
					: {
							title: videoTitle,
							link: articleUrl,
							description: "",
							pubDate: "",
						},
		}).article;
	const narrations = Array.isArray(root.beats)
		? root.beats.map((beat) =>
				beat && typeof beat === "object"
					? (beat as Record<string, unknown>).narration
					: "",
			)
		: [];
	return parseLegacyGenerationPlanJson(
		JSON.stringify({
			version: 1,
			mode: root.grounded === false ? "sample" : "grounded",
			article,
			videoTitle,
			attribution: typeof root.attribution === "string" ? root.attribution : "",
			narrations,
		}),
	);
}

/** 마지막 성공 manifest와 계획의 콘텐츠가 같을 때만 음성/렌더를 재사용한다. */
export function generationPlanMatchesManifest(
	manifestText: string,
	plan: EconomyRealGenerationPlan,
): boolean {
	try {
		const value = JSON.parse(manifestText) as unknown;
		if (!value || typeof value !== "object") return false;
		const root = value as Record<string, unknown>;
		const assetContract =
			root.assetContract && typeof root.assetContract === "object"
				? (root.assetContract as Record<string, unknown>)
				: null;
		const rawContractedAssets = assetContract?.assets;
		const contractedAssets = Array.isArray(rawContractedAssets)
			? rawContractedAssets
			: [];
		const manifestTitle =
			typeof root.title === "string" ? root.title.trim() : "";
		const manifestArticleUrl =
			typeof root.articleUrl === "string"
				? root.articleUrl.trim()
				: root.article && typeof root.article === "object"
					? String((root.article as Record<string, unknown>).link ?? "").trim()
					: "";
		const narrations = Array.isArray(root.beats)
			? root.beats.map((beat) =>
					beat &&
					typeof beat === "object" &&
					typeof (beat as Record<string, unknown>).narration === "string"
						? String((beat as Record<string, unknown>).narration).trim()
						: "",
				)
			: [];
		return (
			root.fingerprint === plan.fingerprint &&
			root.sourceSnapshotHash === plan.sourceSnapshotHash &&
			assetContract?.fingerprint === plan.fingerprint &&
			assetContract.renderConfigKey === plan.renderConfigKey &&
			contractedAssets.length === plan.narrations.length &&
			contractedAssets.every(
				(asset) =>
					asset &&
					typeof asset === "object" &&
					(asset as Record<string, unknown>).fingerprint === plan.fingerprint,
			) &&
			manifestTitle === plan.videoTitle &&
			manifestArticleUrl === plan.article.link &&
			narrations.length === plan.narrations.length &&
			narrations.every(
				(narration, index) => narration === plan.narrations[index],
			)
		);
	} catch {
		return false;
	}
}

/** 최종 manifest가 없으면 부분 산출물은 출처를 증명할 수 없으므로 재사용하지 않는다. */
export function canReuseGeneratedAssets(
	plan: EconomyRealGenerationPlan,
	manifestText: string | undefined,
): boolean {
	return Boolean(
		manifestText && generationPlanMatchesManifest(manifestText, plan),
	);
}

/** 업로드 설명문도 순수 조립해 txt/플랫폼 JSON이 같은 출처·면책을 공유한다. */
export function buildEconomyRealDescription(input: {
	title: string;
	attribution: string;
	article: RssItem;
}): string {
	const sourceLabel = [input.attribution, input.article.title]
		.filter(Boolean)
		.join(" · ");
	return [
		input.title,
		"",
		"실제 경제 기사와 코스피·코스닥 시장 화면을 바탕으로 핵심 맥락을 짧게 정리했습니다.",
		"",
		"참고/출처",
		`- ${sourceLabel ? `${sourceLabel} · ` : ""}${input.article.link}`,
		"",
		YMYL_DISCLOSURE,
	].join("\n");
}

function sameArticle(a: RssItem, b: RssItem): boolean {
	return (
		a.title === b.title &&
		a.link === b.link &&
		a.description === b.description &&
		a.pubDate === b.pubDate
	);
}

function beatsFromPlan(plan: EconomyRealGenerationPlan): Beat[] {
	if (plan.mode === "grounded")
		return buildGroundedBeats(plan.narrations, plan.article.link);
	return SAMPLE_BEATS.map((beat, index) => ({
		...beat,
		narration: plan.narrations[index],
		asset:
			beat.asset.kind === "article"
				? { ...beat.asset, url: plan.article.link }
				: beat.asset,
	}));
}

async function createGenerationPlan(
	options: EconomyRealCliOptions,
	cwd: string,
): Promise<EconomyRealGenerationPlan> {
	if (options.sample) {
		process.stdout.write("모드: --sample (하드코딩 삼성전자, 백엔드 불필요)\n");
		const articleUrl = await realSamsungArticleUrl();
		const article: RssItem = {
			title: "삼성전자 시장 기사",
			link: articleUrl,
			description: "삼성전자와 국내 증시 흐름을 다룬 실사 편집 샘플",
			pubDate: "",
		};
		const grounding: Grounding = {
			primary: article,
			body: article.description,
			related: [],
		};
		return fingerprintGenerationPlan(
			{
				mode: "sample",
				article,
				videoTitle: "삼성전자, 지금 시장은 어떻게 볼까?",
				attribution: publisherFromUrl(articleUrl),
				narrations: SAMPLE_BEATS.map((beat) => beat.narration),
				grounding,
			},
			buildSourceSnapshotHash(
				article,
				stableJson({ body: grounding.body, related: grounding.related }),
			),
		);
	}

	let article: RssItem;
	let items: RssItem[] = [];
	if (options.sourceFile) {
		article = readSourceArticle(resolve(cwd, options.sourceFile));
		process.stdout.write(`1) 고정 기사 사용: ${article.title}\n`);
	} else {
		process.stdout.write("1) 경제 RSS 수집 + 기사 선택...\n");
		items = await fetchFeed(DEFAULT_FEEDS);
		if (items.length === 0)
			throw new Error("RSS 수집 실패 (네트워크/피드 확인)");
		const safeItems = items.filter(
			(item) => !looksLikeAdvice(`${item.title} ${item.description ?? ""}`),
		);
		const marketItems = safeItems.filter((item) =>
			MARKET_RE.test(`${item.title} ${item.description ?? ""}`),
		);
		const selected =
			pickArticle(marketItems, new Set<string>()) ??
			pickArticle(safeItems, new Set<string>());
		if (!selected) throw new Error("영상화 가능한 미사용(비-조언) 기사 없음");
		article = selected;
		process.stdout.write(`   선택: ${article.title}\n`);
	}

	const sourceViolation = findYmylViolation({
		title: article.title,
		description: article.description,
		narrations: [],
	});
	if (sourceViolation)
		throw new Error(`YMYL 위반 고정 기사: ${sourceViolation}`);

	process.stdout.write("2) 본문 + grounded 나레이션(Claude)...\n");
	const body = requireGroundingBody(await fetchArticleBody(article.link));
	const grounding: Grounding = {
		primary: article,
		body,
		// --source-file 은 지정 기사 외 다른 기사를 자동 선택/혼입하지 않는다.
		related: options.sourceFile
			? []
			: relatedArticles(items, article, new Set<string>()),
	};
	const narrations = await groundedNarrations(grounding);
	return fingerprintGenerationPlan(
		{
			mode: "grounded",
			article,
			videoTitle: article.title,
			attribution: publisherFromUrl(article.link),
			narrations,
			grounding,
		},
		buildSourceSnapshotHash(
			article,
			stableJson({ body: grounding.body, related: grounding.related }),
		),
	);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
	const options = parseEconomyRealArgs(argv);
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
	const cwd = process.cwd();
	const workDir = resolveEconomyRealWorkDir({
		out: options.out,
		sample: options.sample,
		stamp,
		projectRoot: PROJECT_ROOT,
		cwd,
	});
	mkdirSync(workDir, { recursive: true });
	const paths = economyRealOutputPaths(workDir);
	const currentRenderConfigKey = economyRealRenderConfigKey();
	let reusePlannedAssets = existsSync(paths.plan);
	let storedPlanTrustedForAssetReuse = false;

	let plan: EconomyRealGenerationPlan;
	let refreshGroundingSnapshot = false;
	if (reusePlannedAssets) {
		const storedPlanText = readFileSync(paths.plan, "utf8");
		const storedPlanValue = JSON.parse(storedPlanText) as {
			version?: unknown;
			grounding?: unknown;
		};
		const legacyPlan = storedPlanValue.version !== PLAN_VERSION;
		refreshGroundingSnapshot =
			legacyPlan ||
			!storedPlanValue.grounding ||
			typeof storedPlanValue.grounding !== "object";
		if (legacyPlan) {
			plan = parseLegacyGenerationPlanJson(storedPlanText);
		} else {
			const loaded = loadGenerationPlanJson(
				storedPlanText,
				currentRenderConfigKey,
			);
			plan = loaded.plan;
			storedPlanTrustedForAssetReuse = loaded.trustedForAssetReuse;
			if (!loaded.trustedForAssetReuse)
				process.stdout.write(
					`저장 계획 계약 갱신 필요(${loaded.fingerprintContract}) — 기존 자산을 재생성합니다.\n`,
				);
		}
		const expectedMode = options.sample ? "sample" : "grounded";
		if (plan.mode !== expectedMode)
			throw new Error(
				`기존 --out 계획 mode=${plan.mode}, 요청 mode=${expectedMode} 불일치`,
			);
		if (options.sourceFile) {
			const requested = readSourceArticle(resolve(cwd, options.sourceFile));
			if (!sameArticle(plan.article, requested))
				throw new Error(
					"기존 --out 은 다른 기사로 생성되었습니다. 별도 --out 디렉터리를 사용하세요.",
				);
		}
		process.stdout.write(`기존 생성 계획 로드: ${paths.plan}\n`);
	} else if (existsSync(paths.manifest)) {
		const fixedArticle = options.sourceFile
			? readSourceArticle(resolve(cwd, options.sourceFile))
			: undefined;
		plan = parseLegacyManifestJson(
			readFileSync(paths.manifest, "utf8"),
			fixedArticle,
		);
		const expectedMode = options.sample ? "sample" : "grounded";
		if (plan.mode !== expectedMode)
			throw new Error(
				`기존 manifest mode=${plan.mode}, 요청 mode=${expectedMode} 불일치`,
			);
		reusePlannedAssets = true;
		refreshGroundingSnapshot = true;
		process.stdout.write(`구버전 manifest 계획 승격 준비: ${paths.plan}\n`);
	} else {
		plan = await createGenerationPlan(options, cwd);
	}
	if (refreshGroundingSnapshot) {
		const body = requireLegacyGroundingBody(
			await fetchArticleBody(plan.article.link),
		);
		const grounding: Grounding = {
			primary: plan.article,
			body,
			related: plan.grounding.related,
		};
		let narrations = plan.narrations;
		const modalityViolations = findGroundingModalityViolations(
			grounding,
			narrations,
		);
		const numberViolations = findUngroundedNumberViolations(
			grounding,
			narrations,
		);
		if (modalityViolations.length > 0 || numberViolations.length > 0) {
			process.stdout.write(
				`legacy plan grounding 위반(확실성 ${modalityViolations.map((index) => index + 1).join(", ") || "없음"}, 숫자 ${numberViolations.map((index) => index + 1).join(", ") || "없음"}) — full Grounding으로 나레이션을 재생성합니다.\n`,
			);
			narrations = await groundedNarrations(grounding);
		}
		plan = fingerprintGenerationPlan(
			{
				mode: plan.mode,
				article: plan.article,
				videoTitle: plan.videoTitle,
				attribution: plan.attribution,
				narrations,
				grounding,
			},
			buildSourceSnapshotHash(
				plan.article,
				stableJson({ body, related: plan.grounding.related }),
			),
			currentRenderConfigKey,
		);
	}
	plan = refreshGenerationPlanRenderContract(plan, currentRenderConfigKey);
	writeFileSync(paths.plan, `${JSON.stringify(plan, null, 2)}\n`);
	const beats = beatsFromPlan(plan);
	const finalManifestText = existsSync(paths.manifest)
		? readFileSync(paths.manifest, "utf8")
		: undefined;
	const trustedAssetReuse =
		reusePlannedAssets &&
		storedPlanTrustedForAssetReuse &&
		canReuseGeneratedAssets(plan, finalManifestText);
	if (reusePlannedAssets && !trustedAssetReuse)
		process.stdout.write(
			"신뢰 가능한 최종 manifest/fingerprint 없음 — 기존 자산 전체를 재생성합니다.\n",
		);
	const forceEditorialUpgrade = !existsSync(join(workDir, "hook-visual.mp4"));

	process.stdout.write(`article: ${plan.article.link}\n`);

	const finalViolation = findYmylViolation({
		title: plan.videoTitle,
		description: plan.article.description,
		narrations: beats.map((beat) => beat.narration),
	});
	if (finalViolation)
		throw new Error(`YMYL 최종 게이트 위반: ${finalViolation}`);
	const finalModalityViolations = findGroundingModalityViolations(
		plan.grounding,
		beats.map((beat) => beat.narration),
	);
	if (finalModalityViolations.length > 0)
		throw new Error(
			`YMYL 최종 출처 확실성 위반(씬 ${finalModalityViolations.map((index) => index + 1).join(", ")})`,
		);
	const finalNumberViolations = findUngroundedNumberViolations(
		plan.grounding,
		beats.map((beat) => beat.narration),
	);
	if (finalNumberViolations.length > 0)
		throw new Error(
			`YMYL 최종 출처 숫자 위반(씬 ${finalNumberViolations.map((index) => index + 1).join(", ")})`,
		);
	await assertGroundedClaimsForPlan(
		plan,
		beats.map((beat) => beat.narration),
	);

	const made: {
		imageUrl: string;
		videoUrl?: string;
		audioUrl: string;
		narration: string;
		durationSec: number;
		cameraMove: ReturnType<typeof remotionMotionFor>;
	}[] = [];
	let renderInputsChanged = !trustedAssetReuse;

	for (let i = 0; i < beats.length; i++) {
		const b = beats[i];
		process.stdout.write(
			`\n[${i + 1}/${beats.length}] ${b.id} (${b.asset.kind})\n`,
		);
		let imageUrl = "";
		let videoUrl: string | undefined;

		if (b.asset.kind === "chart") {
			const clip = join(workDir, `${b.id}.mp4`);
			if (!trustedAssetReuse || !existsSync(clip)) {
				await recordChartClip({
					symbol: b.asset.symbol,
					source: b.asset.source,
					seconds: 7,
					orientation: "portrait",
					outPath: clip,
				});
				renderInputsChanged = true;
			}
			videoUrl = clip;
			imageUrl = join(workDir, `${b.id}.png`);
			if (!trustedAssetReuse || !existsSync(imageUrl)) {
				await poster(clip, imageUrl);
				renderInputsChanged = true;
			}
		} else if (b.asset.kind === "article") {
			imageUrl = join(workDir, `${b.id}.png`);
			if (!trustedAssetReuse || !existsSync(imageUrl)) {
				await captureArticle({ url: b.asset.url, outPath: imageUrl });
				renderInputsChanged = true;
			}
		} else if (b.id === "hook") {
			const hookPlan = buildHookVisualPlan(plan.videoTitle, b.narration);
			const contractFailures = hookVisualContractFailures(hookPlan);
			if (contractFailures.length)
				throw new Error(`weak opening hook: ${contractFailures.join(", ")}`);
			const framePaths = [
				join(workDir, "hook.png"),
				join(workDir, "hook-flash-1.png"),
				join(workDir, "hook-flash-2.png"),
			];
			const hookVideo = join(workDir, "hook-visual.mp4");
			if (
				!trustedAssetReuse ||
				!existsSync(hookVideo) ||
				framePaths.some((path) => !existsSync(path))
			) {
				await renderHookVisualAssets(hookPlan, framePaths, hookVideo);
				renderInputsChanged = true;
			}
			imageUrl = framePaths[0];
			videoUrl = hookVideo;
		} else {
			imageUrl = join(workDir, `${b.id}.png`);
			if (
				forceEditorialUpgrade ||
				!trustedAssetReuse ||
				!existsSync(imageUrl)
			) {
				await renderEditorialCards(
					[
						{
							atSec: 0,
							eyebrow: "한 줄 결론",
							headline: "관점이 먼저",
							detail: compactText(b.narration, 72),
							palette: "paper",
						},
					],
					[imageUrl],
				);
				renderInputsChanged = true;
			}
		}

		const wav = join(workDir, `${b.id}.wav`);
		const mp3 = join(workDir, `${b.id}.mp3`);
		if (!trustedAssetReuse || !existsSync(mp3)) {
			await ttsLocal(b.narration, wav, mp3);
			renderInputsChanged = true;
		}

		made.push({
			imageUrl,
			videoUrl,
			audioUrl: mp3,
			narration: b.narration,
			durationSec: await dur(mp3),
			cameraMove: remotionMotionFor(b.cameraMove),
		});
	}

	const articleBeatIndex = beats.findIndex(
		(beat) => beat.asset.kind === "article",
	);
	const thumbnailBackground =
		made[articleBeatIndex]?.imageUrl ?? made[0]?.imageUrl;
	if (!thumbnailBackground)
		throw new Error("실사 쇼츠 썸네일 배경 장면이 없습니다.");
	await overlayThumbnailText(
		thumbnailBackground,
		paths.thumbnail,
		sourceGroundedThumbnailText(plan.article.title),
	);

	if (await normalizeAudioWindow(made)) renderInputsChanged = true;
	const audioSecTotal = made.reduce((sum, scene) => sum + scene.durationSec, 0);
	const estimatedRenderSec = estimateRenderedShortsSec(
		made.map((scene) => scene.durationSec),
	);
	if (
		audioSecTotal < SHORTS_MIN_SEC ||
		audioSecTotal > SHORTS_MAX_SEC ||
		estimatedRenderSec > SHORTS_RENDER_SAFE_MAX_SEC
	)
		throw new Error(
			`쇼츠 길이 계약 실패: audio=${audioSecTotal.toFixed(2)}s, Remotion ceil 예상=${estimatedRenderSec.toFixed(2)}s (요구 ${SHORTS_MIN_SEC}~${SHORTS_RENDER_SAFE_MAX_SEC}s).`,
		);
	writeFileSync(paths.srt, buildEconomyRealSrt(made));

	if (renderInputsChanged || !existsSync(paths.video)) {
		process.stdout.write("\nRemotion Shorts render...\n");
		await renderVlogRemotion({
			// chart 씬의 videoUrl 을 유지 → 실제 렌더에서 Scene.tsx OffthreadVideo 경로 사용.
			// 편집 수준↑: news 무드(가독성) + 첫 씬 출처 로워서드(신뢰). 차트 파이프라인은 검증된
			// 수치 소스가 없어 숫자 카운터/화살표는 배선하지 않는다(YMYL — 코드의 기존 설계 준수).
			scenes: made.map((m, i) => {
				const graphics =
					i === 0 && plan.attribution.trim()
						? buildSceneGraphics({
								sceneFrames: Math.ceil(m.durationSec * 30),
								source: {
									title: plan.attribution.trim(),
									subtitle: "인용 보도",
								},
							})
						: [];
				return {
					...m,
					mood: "news" as const,
					...(graphics.length ? { motionGraphics: graphics } : {}),
				};
			}),
			outPath: paths.video,
			projectRoot: PROJECT_ROOT,
			compositionId: "YouTubeShorts",
			runId: `economy-real-${stamp}`,
			onProgress: (pct) => process.stdout.write(`\rrender ${pct}%`),
		});
		process.stdout.write("\n");
	} else {
		process.stdout.write(`기존 렌더 재사용: ${paths.video}\n`);
	}

	process.stdout.write("최종 검수(60초/자막/컷/contact sheet)...\n");
	const report = await runVerifyOutput({
		videoPath: paths.video,
		srtPath: paths.srt,
		audioSecTotal,
		cutCount: made.length,
		introOffsetSec: 0,
		outroSec: 0,
		contactSheet: true,
	});
	const videoSec = await probeDurationSec(paths.video);
	const qcFailures = finalQcFailures(report, videoSec);
	if (qcFailures.length > 0)
		throw new Error(
			`최종 검수 실패(${qcFailures.join(", ")}) — ${report.reportPath} 확인`,
		);

	process.stdout.write(
		"심층 렌더 QC(해상도/FPS/오디오/LUFS/검은 구간/시각 변화)...\n",
	);
	const renderQc = await evaluateRenderOutput(paths.video, {
		windowSeconds: 10,
	});
	writeFileSync(paths.renderQc, `${JSON.stringify(renderQc, null, 2)}\n`);
	if (!isStrongRenderQcAcceptable(renderQc))
		throw new Error(
			`심층 렌더 QC 실패(${renderQc.score}/100: ${renderQc.issues.join(", ") || "score below 85"}) — ${paths.renderQc}`,
		);

	const description = buildEconomyRealDescription({
		title: plan.videoTitle,
		attribution: plan.attribution,
		article: plan.article,
	});
	writeFileSync(paths.title, `${plan.videoTitle}\n`);
	writeFileSync(paths.description, `${description}\n`);
	writeFileSync(
		paths.platformMeta,
		`${JSON.stringify(
			buildPlatformMeta({
				title: plan.videoTitle,
				description: plan.videoTitle,
				tags: ["경제", "경제뉴스", "시장해설", "실사쇼츠"],
				hashtags: ["경제뉴스", "경제", "시장해설"],
				isShorts: true,
				sourceList: [
					[plan.attribution, plan.article.title, plan.article.link]
						.filter(Boolean)
						.join(" · "),
				],
				disclosure: YMYL_DISCLOSURE,
			}),
			null,
			2,
		)}\n`,
	);

	writeFileSync(
		paths.manifest,
		JSON.stringify(
			{
				fingerprint: plan.fingerprint,
				sourceSnapshotHash: plan.sourceSnapshotHash,
				grounded: plan.mode === "grounded",
				title: plan.videoTitle,
				attribution: plan.attribution,
				output: paths.video,
				article: plan.article,
				srt: paths.srt,
				thumbnail: paths.thumbnail,
				platformMeta: paths.platformMeta,
				verifyReport: report.reportPath,
				renderQc: paths.renderQc,
				renderQcScore: renderQc.score,
				videoSec,
				beats: made,
				assetContract: {
					fingerprint: plan.fingerprint,
					renderConfigKey: plan.renderConfigKey,
					promptVersion: GENERATION_PROMPT_VERSION,
					planVersion: PLAN_VERSION,
					assets: made.map((scene, index) => ({
						id: beats[index].id,
						fingerprint: plan.fingerprint,
						imageUrl: scene.imageUrl,
						videoUrl: scene.videoUrl,
						audioUrl: scene.audioUrl,
					})),
				},
			},
			null,
			2,
		),
	);
	process.stdout.write(`\n✅ 완성(검수 통과): ${paths.video}\n`);
}

if (isMainModule(import.meta.url, process.argv[1])) {
	main().catch((error) => {
		process.stderr.write(
			`ERROR: ${error instanceof Error ? error.stack : error}\n`,
		);
		process.exitCode = 1;
	});
}
