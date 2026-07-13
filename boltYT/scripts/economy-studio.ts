/**
 * Economy Studio — 하나의 검증된 기사에서 쇼츠와 롱폼을 함께 생산하는 오케스트레이터.
 *
 * 핵심 계약:
 *  - 기사 선택은 한 번만 수행하고 source.json으로 고정한다.
 *  - 쇼츠/롱폼은 서로 독립된 출력 디렉터리와 품질 게이트를 가진다.
 *  - 요청한 모든 포맷이 성공한 뒤에만 전역 중복 방지 원장에 기사를 기록한다.
 *  - 실패 시 manifest.json과 로그를 남기고 원장은 건드리지 않는다.
 */
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	DEFAULT_FEEDS,
	type EconomySourceManifest,
	fetchFeed,
	loadYoutubeTrendTerms,
	outputStem,
	parseEconomySourceManifest,
	pickArticle,
	type RssItem,
	readEconomySourceManifest,
	slugify,
} from "./make-economy.ts";
import { parseArgs } from "./vlog-shared.ts";

const execFileP = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_API_PROXY_URL = "http://localhost:3459";
const DEFAULT_COMFY_URL = "http://localhost:8188";
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_TIMEOUT_MS = 60 * 1000;
const RESERVATION_STALE_MS = 24 * 60 * 60 * 1000;

export type StudioFormat = "shorts" | "longform" | "both";
export type StudioOutputFormat = "shorts" | "longform";
export type ShortsStyle = "illustrated" | "real";
export type EpisodeStatus = "planned" | "running" | "complete" | "failed";
export type OutputStatus = "pending" | "running" | "complete" | "failed";

export interface StudioOptions {
	format: StudioFormat;
	shortsStyle: ShortsStyle;
	minutes: number;
	channel: string;
	topic?: string;
	feed?: string;
	angle?: string;
	outRoot: string;
	sourceFile?: string;
	runId?: string;
	autoStart: boolean;
	dryRun: boolean;
}

export interface EpisodePaths {
	runDir: string;
	shortsDir: string;
	longformDir: string;
	sourceFile: string;
	manifestFile: string;
	logDir: string;
}

export interface StudioJob {
	format: StudioOutputFormat;
	style: "illustrated" | "real";
	script: string;
	args: string[];
	env: Record<string, string>;
	outDir: string;
	expectedVideo: string;
}

export interface EpisodeOutput {
	status: OutputStatus;
	style: "illustrated" | "real";
	video?: string;
	srt?: string;
	thumbnail?: string;
	metadata?: string;
	qcReport?: string;
	renderQc?: string;
	verifyReport?: string;
	log?: string;
	error?: string;
}

export interface EpisodeManifest {
	version: 1;
	id: string;
	leaseId?: string;
	createdAt: string;
	updatedAt: string;
	status: EpisodeStatus;
	sourceFile: string;
	article: RssItem;
	requestedFormats: StudioOutputFormat[];
	outputs: {
		shorts?: EpisodeOutput;
		longform?: EpisodeOutput;
	};
	error?: string;
}

export interface UsedLedger {
	version: 1;
	links: string[];
	committedLeases?: Record<string, string>;
}

export interface ServiceEndpoint {
	baseUrl: string;
	healthUrl: string;
	host: string;
	listenHost: string;
	port: number;
	protocol: "http:" | "https:";
	pathPrefix: string;
	autoStartSupported: boolean;
	autoStartReason?: string;
}

export interface StudioServiceEndpoints {
	apiProxy: ServiceEndpoint;
	comfy: ServiceEndpoint;
}

export interface ArticleReservation {
	id: string;
	link: string;
	reservedAt: string;
	manifestFile: string;
	ownerPid?: number;
	ownerHost?: string;
	leaseId?: string;
}

export interface OwnedArticleReservation extends ArticleReservation {
	ownerPid: number;
	ownerHost: string;
	leaseId: string;
}

export interface ReservationLedger {
	version: 1;
	reservations: ArticleReservation[];
}

export interface StudioLedgerPaths {
	ledgerFile: string;
	reservationsFile: string;
	lockFile: string;
}

export interface ReservedEpisode {
	source: EconomySourceManifest;
	id: string;
	paths: EpisodePaths;
	reservation: OwnedArticleReservation;
}

export interface LockOptions {
	timeoutMs?: number;
	staleMs?: number;
	retryMs?: number;
}

export interface ReservationLivenessOptions {
	nowMs?: number;
	staleMs?: number;
	currentHost?: string;
	isPidAlive?: (pid: number) => boolean;
}

export type ShutdownSignal = "SIGINT" | "SIGTERM";

interface JobBuildContext {
	runDir: string;
	sourceFile: string;
	stamp: number;
	articleSlug?: string;
}

interface ManagedService {
	name: string;
	child: ChildProcess;
	stop: () => Promise<void>;
}

function flag(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function requiredChoice<T extends string>(
	label: string,
	value: string,
	choices: readonly T[],
): T {
	if (!choices.includes(value as T))
		throw new Error(`Invalid ${label}: ${value} (${choices.join("|")})`);
	return value as T;
}

function resolveServiceEndpoint(
	rawUrl: string,
	healthPath: string,
	label: string,
): ServiceEndpoint {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid ${label}: ${rawUrl}`);
	}
	if (!["http:", "https:"].includes(url.protocol))
		throw new Error(`Invalid ${label} protocol: ${url.protocol}`);
	if (url.username || url.password)
		throw new Error(`Invalid ${label}: credentials are not allowed`);
	if (url.search || url.hash)
		throw new Error(`Invalid ${label}: query/hash are not allowed`);
	const port = Number(url.port || (url.protocol === "https:" ? "443" : "80"));
	if (!Number.isInteger(port) || port < 1 || port > 65_535)
		throw new Error(`Invalid ${label} port: ${url.port}`);
	const protocol = url.protocol as "http:" | "https:";
	url.pathname = url.pathname.replace(/\/+$/, "");
	const baseUrl = url.toString().replace(/\/$/, "");
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const pathPrefix = url.pathname || "/";
	const normalizedHost = host.toLowerCase();
	const localHost = hostname().toLowerCase();
	const isLocalHost =
		normalizedHost === "localhost" ||
		normalizedHost === localHost ||
		normalizedHost === "0.0.0.0" ||
		normalizedHost === "::" ||
		normalizedHost === "::1" ||
		/^127(?:\.\d{1,3}){3}$/.test(normalizedHost);
	const autoStartReasons = [
		...(protocol !== "http:" ? ["HTTPS endpoint"] : []),
		...(pathPrefix !== "/" ? [`path prefix ${pathPrefix}`] : []),
		...(!isLocalHost ? [`remote host ${host}`] : []),
	];
	return {
		baseUrl,
		healthUrl: `${baseUrl}${healthPath}`,
		host,
		listenHost: host === "localhost" ? "127.0.0.1" : host,
		port,
		protocol,
		pathPrefix,
		autoStartSupported: autoStartReasons.length === 0,
		...(autoStartReasons.length > 0
			? { autoStartReason: autoStartReasons.join(", ") }
			: {}),
	};
}

/** 서비스 URL과 자동 시작에 사용할 호스트/포트를 같은 환경값에서 계산한다. */
export function resolveServiceEndpoints(
	env: Pick<NodeJS.ProcessEnv, "API_PROXY_URL" | "COMFY_URL"> = process.env,
): StudioServiceEndpoints {
	return {
		apiProxy: resolveServiceEndpoint(
			env.API_PROXY_URL ?? DEFAULT_API_PROXY_URL,
			"/health",
			"API_PROXY_URL",
		),
		comfy: resolveServiceEndpoint(
			env.COMFY_URL ?? DEFAULT_COMFY_URL,
			"/system_stats",
			"COMFY_URL",
		),
	};
}

/** CLI 인자를 안전한 실행 옵션으로 정규화한다. */
export function normalizeStudioOptions(
	argv: string[],
	cwd = PROJECT_ROOT,
): StudioOptions {
	const args = parseArgs(argv);
	const format = requiredChoice(
		"format",
		(args.format ?? "both").trim().toLowerCase(),
		["shorts", "longform", "both"] as const,
	);
	const shortsStyle = requiredChoice(
		"shorts-style",
		(args["shorts-style"] ?? "illustrated").trim().toLowerCase(),
		["illustrated", "real"] as const,
	);
	const minutes = Number(args.minutes ?? "8");
	if (!Number.isFinite(minutes) || minutes < 1 || minutes > 16)
		throw new Error("Invalid minutes: expected a number between 1 and 16");
	const channel = (args.channel ?? "경제 한입").trim();
	if (!channel) throw new Error("Invalid channel: non-empty name required");
	const outRoot = resolve(cwd, args.out ?? "output/economy-studio");
	return {
		format,
		shortsStyle,
		minutes,
		channel,
		...(args.topic?.trim() ? { topic: args.topic.trim() } : {}),
		...(args.feed?.trim() ? { feed: args.feed.trim() } : {}),
		...(args.angle?.trim() ? { angle: args.angle.trim() } : {}),
		outRoot,
		...(args["source-file"]?.trim()
			? { sourceFile: resolve(cwd, args["source-file"].trim()) }
			: {}),
		...(args.id?.trim() ? { runId: slugify(args.id.trim()) } : {}),
		autoStart: flag(args["auto-start"], true),
		dryRun: flag(args["dry-run"], false),
	};
}

export function resolveEpisodePaths(
	outRoot: string,
	episodeId: string,
): EpisodePaths {
	const runDir = join(outRoot, episodeId);
	return {
		runDir,
		shortsDir: join(runDir, "shorts"),
		longformDir: join(runDir, "longform"),
		sourceFile: join(runDir, "source.json"),
		manifestFile: join(runDir, "manifest.json"),
		logDir: join(runDir, "logs"),
	};
}

export function parseUsedLedger(text: string): UsedLedger {
	try {
		const parsed = JSON.parse(text) as {
			links?: unknown;
			committedLeases?: unknown;
		};
		const links = Array.isArray(parsed.links)
			? [
					...new Set(
						parsed.links.filter(
							(link): link is string =>
								typeof link === "string" && link.trim().length > 0,
						),
					),
				]
			: [];
		const linkSet = new Set(links);
		const committedLeases =
			parsed.committedLeases &&
			typeof parsed.committedLeases === "object" &&
			!Array.isArray(parsed.committedLeases)
				? Object.fromEntries(
						Object.entries(parsed.committedLeases).filter(
							(entry): entry is [string, string] =>
								linkSet.has(entry[0]) &&
								typeof entry[1] === "string" &&
								entry[1].trim().length > 0,
						),
					)
				: {};
		return {
			version: 1,
			links,
			...(Object.keys(committedLeases).length > 0 ? { committedLeases } : {}),
		};
	} catch {
		return { version: 1, links: [] };
	}
}

export function parseReservationLedger(text: string): ReservationLedger {
	try {
		const parsed = JSON.parse(text) as { reservations?: unknown };
		if (!Array.isArray(parsed.reservations))
			return { version: 1, reservations: [] };
		const seenIds = new Set<string>();
		const seenLinks = new Set<string>();
		const reservations: ArticleReservation[] = [];
		for (const candidate of parsed.reservations) {
			if (!candidate || typeof candidate !== "object") continue;
			const item = candidate as Partial<ArticleReservation>;
			if (
				typeof item.id !== "string" ||
				!item.id.trim() ||
				typeof item.link !== "string" ||
				!item.link.trim() ||
				typeof item.reservedAt !== "string" ||
				!Number.isFinite(Date.parse(item.reservedAt)) ||
				typeof item.manifestFile !== "string" ||
				!item.manifestFile.trim() ||
				seenIds.has(item.id) ||
				seenLinks.has(item.link)
			)
				continue;
			seenIds.add(item.id);
			seenLinks.add(item.link);
			const ownerPid =
				typeof item.ownerPid === "number" &&
				Number.isInteger(item.ownerPid) &&
				item.ownerPid > 0
					? item.ownerPid
					: undefined;
			const ownerHost =
				typeof item.ownerHost === "string" && item.ownerHost.trim()
					? item.ownerHost.trim()
					: undefined;
			const leaseId =
				typeof item.leaseId === "string" && item.leaseId.trim()
					? item.leaseId.trim()
					: undefined;
			reservations.push({
				id: item.id,
				link: item.link,
				reservedAt: item.reservedAt,
				manifestFile: item.manifestFile,
				...(ownerPid ? { ownerPid } : {}),
				...(ownerHost ? { ownerHost } : {}),
				...(leaseId ? { leaseId } : {}),
			});
		}
		return { version: 1, reservations };
	} catch {
		return { version: 1, reservations: [] };
	}
}

export function resolveStudioLedgerPaths(outRoot: string): StudioLedgerPaths {
	return {
		ledgerFile: join(outRoot, "economy-used.json"),
		reservationsFile: join(outRoot, ".economy-reservations.json"),
		lockFile: join(outRoot, ".economy-ledger.lock"),
	};
}

function readUsedLedger(path: string): UsedLedger {
	if (!existsSync(path)) return { version: 1, links: [] };
	return parseUsedLedger(readFileSync(path, "utf8"));
}

function readReservationLedger(path: string): ReservationLedger {
	if (!existsSync(path)) return { version: 1, reservations: [] };
	return parseReservationLedger(readFileSync(path, "utf8"));
}

function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, path);
}

function isErrno(error: unknown, code: string): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}

function localPidIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but cannot be signalled.
		return !isErrno(error, "ESRCH");
	}
}

/** 로컬 owner PID가 죽으면 stale 시간 전이라도 lease를 즉시 회수한다. */
export function isReservationLeaseActive(
	reservation: ArticleReservation,
	options: ReservationLivenessOptions = {},
): boolean {
	const nowMs = options.nowMs ?? Date.now();
	const staleMs = options.staleMs ?? RESERVATION_STALE_MS;
	const currentHost = (options.currentHost ?? hostname()).toLowerCase();
	const isPidAlive = options.isPidAlive ?? localPidIsAlive;
	if (
		reservation.ownerPid !== undefined &&
		reservation.ownerHost?.toLowerCase() === currentHost
	) {
		// 크래시 후 OS가 PID를 재사용하면 isPidAlive가 영구 true가 되어 기사가 영원히
		// 차단될 수 있다. staleMs를 넘긴 예약은 PID 생존과 무관하게 회수한다.
		if (nowMs - Date.parse(reservation.reservedAt) >= staleMs) return false;
		return isPidAlive(reservation.ownerPid);
	}
	return nowMs - Date.parse(reservation.reservedAt) < staleMs;
}

export function createReservationSignalHandler(options: {
	cleanup: () => Promise<void>;
	terminate: (signal: ShutdownSignal) => void;
	onError?: (error: unknown) => void;
}): (signal: ShutdownSignal) => Promise<void> {
	let pending: Promise<void> | undefined;
	return (signal) => {
		if (pending) return pending;
		pending = (async () => {
			try {
				await options.cleanup();
			} catch (error) {
				try {
					options.onError?.(error);
				} catch {
					// Signal termination must continue even if error reporting fails.
				}
			} finally {
				options.terminate(signal);
			}
		})();
		return pending;
	};
}

export interface StaleLockFsOps {
	rename: (from: string, to: string) => void;
	statIno: (path: string) => number;
	unlink: (path: string) => void;
}

const REAL_STALE_LOCK_FS: StaleLockFsOps = {
	rename: renameSync,
	statIno: (path) => Number(statSync(path).ino),
	unlink: unlinkSync,
};

/**
 * stale 잠금 파일을 unique stalePath로 옮겨 회수한다. rename은 검증된 inode가 아니라
 * '경로'에 동작하므로, 검사~rename 사이에 다른 프로세스가 잠금을 정상 획득(새 inode)했다면
 * 이 rename이 갓 만들어진 유효 잠금을 치워버려 이중 획득이 된다. 이를 막기 위해 rename 후
 * 옮겨진 파일의 inode를 재확인해 observed와 다르면(=남의 fresh 잠금을 잘못 옮김) 즉시 원복하고
 * unlink하지 않는다. 일치할 때만 stale 파일을 삭제한다.
 * @returns "reclaimed"=우리가 stale 잠금을 치움 | "restored"=남의 fresh 잠금을 되돌림
 */
export function reclaimStaleLockFile(
	path: string,
	observedIno: number,
	stalePath: string,
	ops: StaleLockFsOps = REAL_STALE_LOCK_FS,
): "reclaimed" | "restored" {
	ops.rename(path, stalePath);
	const movedIno = ops.statIno(stalePath);
	if (movedIno !== observedIno) {
		// 검사~rename 사이에 다른 프로세스가 획득한 fresh 잠금을 잘못 옮겼다.
		// 원복하고 재시도한다(정상 대기 경로). 절대 unlink하지 않는다.
		ops.rename(stalePath, path);
		return "restored";
	}
	ops.unlink(stalePath);
	return "reclaimed";
}

async function acquireFileLock(
	path: string,
	options: LockOptions = {},
): Promise<() => void> {
	const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
	const staleMs = options.staleMs ?? LOCK_STALE_MS;
	const retryMs = options.retryMs ?? 75;
	const deadline = Date.now() + timeoutMs;
	mkdirSync(dirname(path), { recursive: true });
	while (true) {
		const token = randomUUID();
		let descriptor: number | undefined;
		try {
			descriptor = openSync(path, "wx", 0o600);
			writeFileSync(
				descriptor,
				JSON.stringify({
					pid: process.pid,
					token,
					createdAt: new Date().toISOString(),
				}),
			);
			closeSync(descriptor);
			descriptor = undefined;
			return () => {
				try {
					const owner = JSON.parse(readFileSync(path, "utf8")) as {
						token?: unknown;
					};
					if (owner.token === token) unlinkSync(path);
				} catch (error) {
					if (!isErrno(error, "ENOENT")) throw error;
				}
			};
		} catch (error) {
			if (descriptor !== undefined) {
				closeSync(descriptor);
				try {
					unlinkSync(path);
				} catch (unlinkError) {
					if (!isErrno(unlinkError, "ENOENT")) throw unlinkError;
				}
			}
			if (!isErrno(error, "EEXIST")) throw error;
			try {
				const observed = statSync(path);
				if (Date.now() - observed.mtimeMs >= staleMs) {
					const current = statSync(path);
					if (
						current.ino === observed.ino &&
						current.mtimeMs === observed.mtimeMs
					) {
						const stalePath = `${path}.stale-${process.pid}-${randomUUID()}`;
						reclaimStaleLockFile(path, Number(observed.ino), stalePath);
						continue;
					}
				}
			} catch (staleError) {
				if (!isErrno(staleError, "ENOENT")) throw staleError;
				continue;
			}
			if (Date.now() >= deadline)
				throw new Error(`원장 잠금 시간 초과: ${path}`);
			await new Promise((resolveWait) => setTimeout(resolveWait, retryMs));
		}
	}
}

async function withFileLock<T>(
	path: string,
	action: () => Promise<T> | T,
	options?: LockOptions,
): Promise<T> {
	const release = await acquireFileLock(path, options);
	try {
		return await action();
	} finally {
		release();
	}
}

function outputFormats(format: StudioFormat): StudioOutputFormat[] {
	if (format === "both") return ["shorts", "longform"];
	return [format];
}

function compactTimestamp(date: Date): string {
	const iso = date.toISOString();
	return iso.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function episodeIdFor(article: RssItem, now: Date, override?: string): string {
	if (override) return override;
	return `${compactTimestamp(now)}-${slugify(article.title).slice(0, 32)}`;
}

function sourceManifest(
	article: RssItem,
	feeds: string[],
	topic: string | undefined,
	now: Date,
): EconomySourceManifest {
	return parseEconomySourceManifest({
		version: 1,
		selectedAt: now.toISOString(),
		article,
		feeds,
		topic,
	});
}

async function chooseSource(
	options: StudioOptions,
	ledger: UsedLedger,
	now: Date,
): Promise<EconomySourceManifest> {
	if (options.sourceFile) return readEconomySourceManifest(options.sourceFile);
	const feeds = options.feed ? [options.feed] : DEFAULT_FEEDS;
	const articles = await fetchFeed(feeds);
	if (articles.length === 0)
		throw new Error("경제 RSS에서 기사를 수집하지 못했습니다.");
	const trendTerms = loadYoutubeTrendTerms();
	const article = pickArticle(
		articles,
		new Set(ledger.links),
		options.topic,
		trendTerms,
		options.angle === "emotional",
	);
	if (!article)
		throw new Error(
			options.topic
				? `미사용 '${options.topic}' 경제 기사를 찾지 못했습니다.`
				: "모든 수집 기사가 이미 제작되었습니다.",
		);
	return sourceManifest(article, feeds, options.topic, now);
}

/** 동일 source-file/stamp를 쓰는 포맷별 자식 잡을 만든다. */
export function buildStudioJobs(
	options: StudioOptions,
	context: JobBuildContext,
): StudioJob[] {
	const shortsDir = join(context.runDir, "shorts");
	const longformDir = join(context.runDir, "longform");
	const endpoints = resolveServiceEndpoints();
	const commonEnv = {
		SOURCE_DATE_EPOCH: String(context.stamp),
		API_PROXY_URL: endpoints.apiProxy.baseUrl,
		COMFY_URL: endpoints.comfy.baseUrl,
		COMFY_CKPT:
			process.env.COMFY_CKPT ?? "DreamShaperXL_Turbo_V2-SFW.safetensors",
		COMFY_PRESET: process.env.COMFY_PRESET ?? "fast",
		// 스튜디오는 render_qc.json 을 릴리스 게이트로 요구한다. 자식 잡이
		// RENDER_OUTPUT_QC=0 을 상속해 QC 파일을 건너뛰면 값비싼 렌더 뒤 실패하므로
		// 여기서 QC 를 강제로 켜 opt-out 상속을 차단한다.
		RENDER_OUTPUT_QC: "1",
	};
	const jobs: StudioJob[] = [];
	if (options.format === "shorts" || options.format === "both") {
		if (options.shortsStyle === "real") {
			jobs.push({
				format: "shorts",
				style: "real",
				script: join(PROJECT_ROOT, "scripts/make-economy-real.ts"),
				args: ["--source-file", context.sourceFile, "--out", shortsDir],
				env: commonEnv,
				outDir: shortsDir,
				expectedVideo: join(shortsDir, "economy-real-short.mp4"),
			});
		} else {
			const stem = outputStem(
				context.articleSlug ?? "source",
				context.stamp,
				true,
			);
			jobs.push({
				format: "shorts",
				style: "illustrated",
				script: join(PROJECT_ROOT, "scripts/make-economy.ts"),
				args: [
					"--source-file",
					context.sourceFile,
					"--record-used",
					"false",
					"--shorts",
					"true",
					"--channel",
					options.channel,
					"--out",
					shortsDir,
					...(options.angle ? ["--angle", options.angle] : []),
				],
				env: commonEnv,
				outDir: shortsDir,
				// 실제 slug는 source manifest 기사 제목으로 결정되므로 실행 후 탐색한다.
				expectedVideo: join(shortsDir, `${stem}.mp4`),
			});
		}
	}
	if (options.format === "longform" || options.format === "both") {
		const stem = outputStem(
			context.articleSlug ?? "source",
			context.stamp,
			false,
		);
		jobs.push({
			format: "longform",
			style: "illustrated",
			script: join(PROJECT_ROOT, "scripts/make-economy.ts"),
			args: [
				"--source-file",
				context.sourceFile,
				"--record-used",
				"false",
				"--shorts",
				"false",
				"--minutes",
				String(options.minutes),
				"--channel",
				options.channel,
				"--out",
				longformDir,
				...(options.angle ? ["--angle", options.angle] : []),
			],
			env: commonEnv,
			outDir: longformDir,
			expectedVideo: join(longformDir, `${stem}.mp4`),
		});
	}
	return jobs;
}

/** 요청 포맷 전체가 complete인 경우에만 전역 원장 반영을 허용한다. */
export function isCompleteReleaseOutput(
	output: EpisodeOutput | undefined,
): boolean {
	return !!(
		output?.status === "complete" &&
		output.video &&
		output.srt &&
		output.thumbnail &&
		output.metadata &&
		output.renderQc &&
		output.verifyReport
	);
}

export function canCommitEpisode(manifest: EpisodeManifest): boolean {
	return manifest.requestedFormats.every((format) =>
		isCompleteReleaseOutput(manifest.outputs[format]),
	);
}

function isCompleteManifestFile(
	path: string,
	expectedLink: string,
	expectedLeaseId: string | undefined,
): boolean {
	try {
		const parsed = JSON.parse(
			readFileSync(path, "utf8"),
		) as Partial<EpisodeManifest>;
		if (
			parsed.status !== "complete" ||
			parsed.article?.link !== expectedLink ||
			parsed.leaseId !== expectedLeaseId ||
			!Array.isArray(parsed.requestedFormats) ||
			!parsed.outputs
		)
			return false;
		return parsed.requestedFormats.every(
			(format) =>
				(format === "shorts" || format === "longform") &&
				isCompleteReleaseOutput(parsed.outputs?.[format]),
		);
	} catch {
		return false;
	}
}

function reconcileReservationState(
	paths: StudioLedgerPaths,
	nowMs: number,
	reservationStaleMs: number,
): { ledger: UsedLedger; reservations: ReservationLedger } {
	const currentLedger = readUsedLedger(paths.ledgerFile);
	const currentReservations = readReservationLedger(paths.reservationsFile);
	const used = new Set(currentLedger.links);
	const committedLeases = new Map(
		Object.entries(currentLedger.committedLeases ?? {}),
	);
	const active: ArticleReservation[] = [];
	for (const reservation of currentReservations.reservations) {
		if (
			isCompleteManifestFile(
				reservation.manifestFile,
				reservation.link,
				reservation.leaseId,
			)
		) {
			used.add(reservation.link);
			if (reservation.leaseId)
				committedLeases.set(reservation.link, reservation.leaseId);
			continue;
		}
		if (
			isReservationLeaseActive(reservation, {
				nowMs,
				staleMs: reservationStaleMs,
			})
		)
			active.push(reservation);
	}
	const ledger = {
		version: 1,
		links: [...used],
		...(committedLeases.size > 0
			? { committedLeases: Object.fromEntries(committedLeases) }
			: {}),
	} satisfies UsedLedger;
	const reservations = {
		version: 1,
		reservations: active,
	} satisfies ReservationLedger;
	if (
		ledger.links.length !== currentLedger.links.length ||
		ledger.links.some((link, index) => link !== currentLedger.links[index]) ||
		Object.keys(ledger.committedLeases ?? {}).length !==
			Object.keys(currentLedger.committedLeases ?? {}).length ||
		Object.entries(ledger.committedLeases ?? {}).some(
			([link, leaseId]) => currentLedger.committedLeases?.[link] !== leaseId,
		)
	)
		writeJsonAtomic(paths.ledgerFile, ledger);
	if (
		reservations.reservations.length !==
			currentReservations.reservations.length ||
		reservations.reservations.some(
			(reservation, index) =>
				reservation.id !== currentReservations.reservations[index]?.id,
		)
	) {
		try {
			writeJsonAtomic(paths.reservationsFile, reservations);
		} catch (error) {
			// used 기록이 끝났다면 stale 예약은 다음 잠금 구간에서 안전하게 재정리된다.
			process.stderr.write(
				`WARN: 예약 원장 정리 지연: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
	}
	return { ledger, reservations };
}

/** 기사 선택과 활성 예약 기록을 하나의 잠금 구간에서 처리한다. */
export async function reserveEpisodeSource(
	options: StudioOptions,
	now = new Date(),
	lockOptions?: LockOptions,
	reservationStaleMs = RESERVATION_STALE_MS,
): Promise<ReservedEpisode> {
	const ledgerPaths = resolveStudioLedgerPaths(options.outRoot);
	return withFileLock(
		ledgerPaths.lockFile,
		async () => {
			const state = reconcileReservationState(
				ledgerPaths,
				now.getTime(),
				reservationStaleMs,
			);
			const excludedLinks = [
				...state.ledger.links,
				...state.reservations.reservations.map(
					(reservation) => reservation.link,
				),
			];
			const source = await chooseSource(
				options,
				{ version: 1, links: excludedLinks },
				now,
			);
			if (
				state.reservations.reservations.some(
					(reservation) => reservation.link === source.article.link,
				)
			)
				throw new Error(`이미 제작 중인 기사입니다: ${source.article.link}`);
			const id = episodeIdFor(source.article, now, options.runId);
			const paths = resolveEpisodePaths(options.outRoot, id);
			if (
				state.reservations.reservations.some(
					(reservation) => reservation.id === id,
				) ||
				existsSync(paths.manifestFile)
			)
				throw new Error(`이미 존재하는 에피소드 ID입니다: ${id}`);
			const reservation: OwnedArticleReservation = {
				id,
				link: source.article.link,
				reservedAt: now.toISOString(),
				manifestFile: paths.manifestFile,
				ownerPid: process.pid,
				ownerHost: hostname(),
				leaseId: randomUUID(),
			};
			writeJsonAtomic(ledgerPaths.reservationsFile, {
				version: 1,
				reservations: [...state.reservations.reservations, reservation],
			} satisfies ReservationLedger);
			return { source, id, paths, reservation };
		},
		lockOptions,
	);
}

/** 완료 manifest를 먼저 확인한 뒤, 잠금 하에서 used 원장 반영 + 예약 해제한다. */
export async function commitEpisodeReservation(
	outRoot: string,
	reservation: ArticleReservation,
	lockOptions?: LockOptions,
): Promise<void> {
	if (!reservation.leaseId)
		throw new Error(
			`leaseId 없는 예약은 커밋할 수 없습니다: ${reservation.id}`,
		);
	const paths = resolveStudioLedgerPaths(outRoot);
	await withFileLock(
		paths.lockFile,
		() => {
			const state = reconcileReservationState(
				paths,
				Date.now(),
				RESERVATION_STALE_MS,
			);
			const active = state.reservations.reservations.find(
				(item) => item.id === reservation.id,
			);
			const committedLease = state.ledger.committedLeases?.[reservation.link];
			if (active) {
				if (
					active.leaseId !== reservation.leaseId ||
					active.link !== reservation.link ||
					active.manifestFile !== reservation.manifestFile
				)
					throw new Error(
						`기사 예약 lease 소유권이 다릅니다: ${reservation.id}`,
					);
				if (
					!isCompleteManifestFile(
						reservation.manifestFile,
						reservation.link,
						reservation.leaseId,
					)
				)
					throw new Error(
						`완료 manifest 없이는 원장을 반영할 수 없습니다: ${reservation.id}`,
					);
			}
			if (!active) {
				if (committedLease === reservation.leaseId) return;
				if (state.ledger.links.includes(reservation.link))
					throw new Error(
						`커밋된 기사 lease 소유권이 다릅니다: ${reservation.id}`,
					);
				throw new Error(`기사 예약을 찾지 못했습니다: ${reservation.id}`);
			}
			if (
				!state.ledger.links.includes(reservation.link) ||
				committedLease !== reservation.leaseId
			) {
				writeJsonAtomic(paths.ledgerFile, {
					version: 1,
					links: state.ledger.links.includes(reservation.link)
						? state.ledger.links
						: [...state.ledger.links, reservation.link],
					committedLeases: {
						...(state.ledger.committedLeases ?? {}),
						[reservation.link]: reservation.leaseId,
					},
				} satisfies UsedLedger);
			}
			const remaining = state.reservations.reservations.filter(
				(item) =>
					item.id !== reservation.id || item.leaseId !== reservation.leaseId,
			);
			try {
				writeJsonAtomic(paths.reservationsFile, {
					version: 1,
					reservations: remaining,
				} satisfies ReservationLedger);
			} catch (error) {
				// used 원장이 이미 내구성 있게 기록되었으므로 다음 실행의 reconcile로 정리한다.
				process.stderr.write(
					`WARN: 완료 예약 정리 지연: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		},
		lockOptions,
	);
}

export async function releaseEpisodeReservation(
	outRoot: string,
	reservation: Pick<ArticleReservation, "id" | "link" | "leaseId">,
	lockOptions?: LockOptions,
): Promise<void> {
	if (!reservation.leaseId)
		throw new Error(
			`leaseId 없는 예약은 해제할 수 없습니다: ${reservation.id}`,
		);
	const paths = resolveStudioLedgerPaths(outRoot);
	await withFileLock(
		paths.lockFile,
		() => {
			const state = reconcileReservationState(
				paths,
				Date.now(),
				RESERVATION_STALE_MS,
			);
			const active = state.reservations.reservations.find(
				(item) => item.id === reservation.id,
			);
			if (active && active.leaseId !== reservation.leaseId)
				throw new Error(`기사 예약 lease 소유권이 다릅니다: ${reservation.id}`);
			if (
				!active &&
				state.ledger.committedLeases?.[reservation.link] !== undefined &&
				state.ledger.committedLeases[reservation.link] !== reservation.leaseId
			)
				throw new Error(
					`커밋된 기사 lease 소유권이 다릅니다: ${reservation.id}`,
				);
			const remaining = state.reservations.reservations.filter(
				(item) =>
					item.id !== reservation.id || item.leaseId !== reservation.leaseId,
			);
			if (remaining.length !== state.reservations.reservations.length)
				writeJsonAtomic(paths.reservationsFile, {
					version: 1,
					reservations: remaining,
				} satisfies ReservationLedger);
		},
		lockOptions,
	);
}

async function healthOk(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
		return response.ok;
	} catch {
		return false;
	}
}

function assertManagedAutoStartSupported(
	name: string,
	endpoint: ServiceEndpoint,
): void {
	if (endpoint.autoStartSupported) return;
	throw new Error(
		`${name} 자동 시작을 지원하지 않는 URL입니다 (${endpoint.autoStartReason ?? endpoint.baseUrl}). ` +
			`해당 원격/프록시 서비스를 먼저 실행하거나 root HTTP 로컬 URL을 사용하세요: ${endpoint.baseUrl}`,
	);
}

async function waitForHealth(
	name: string,
	url: string,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await healthOk(url)) return;
		await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
	}
	throw new Error(`${name} 시작 시간 초과: ${url}`);
}

function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.killed) return Promise.resolve();
	return new Promise((resolveStop) => {
		const timer = setTimeout(() => {
			if (child.exitCode === null) child.kill("SIGKILL");
			resolveStop();
		}, 5000);
		child.once("exit", () => {
			clearTimeout(timer);
			resolveStop();
		});
		child.kill("SIGTERM");
	});
}

async function startService(options: {
	name: string;
	command: string;
	args: string[];
	cwd: string;
	healthUrl: string;
	logFile: string;
	timeoutMs: number;
	env?: NodeJS.ProcessEnv;
	onSpawn?: (service: ManagedService) => void;
}): Promise<ManagedService> {
	mkdirSync(dirname(options.logFile), { recursive: true });
	const log = createWriteStream(options.logFile, { flags: "a" });
	const child = spawn(options.command, options.args, {
		cwd: options.cwd,
		stdio: ["ignore", "pipe", "pipe"],
		env: options.env ?? process.env,
	});
	child.stdout?.pipe(log, { end: false });
	child.stderr?.pipe(log, { end: false });
	child.once("exit", () => log.end());
	const service: ManagedService = {
		name: options.name,
		child,
		stop: () => stopChild(child),
	};
	options.onSpawn?.(service);
	const childFailed = new Promise<never>((_resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			reject(
				new Error(
					`${options.name}가 health 확인 전에 종료되었습니다 (code=${code ?? "null"}, signal=${signal ?? "none"})`,
				),
			);
		});
	});
	try {
		await Promise.race([
			waitForHealth(options.name, options.healthUrl, options.timeoutMs),
			childFailed,
		]);
	} catch (error) {
		await stopChild(child);
		throw error;
	}
	return service;
}

/** 시작된 서비스는 역순으로 모두 정리하며, 한 stop 실패가 나머지 정리를 막지 않는다. */
export async function stopStartedServices(
	services: readonly Pick<ManagedService, "stop">[],
): Promise<void> {
	const errors: unknown[] = [];
	for (const service of [...services].reverse()) {
		try {
			await service.stop();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length > 0)
		throw new AggregateError(errors, "서비스 종료 중 오류가 발생했습니다.");
}

async function cleanupEpisodeRuntime(options: {
	jobChild: ChildProcess | null;
	services: readonly ManagedService[];
	outRoot: string;
	reservation: OwnedArticleReservation;
}): Promise<void> {
	const errors: unknown[] = [];
	if (options.jobChild) {
		try {
			await stopChild(options.jobChild);
		} catch (error) {
			errors.push(error);
		}
	}
	try {
		await stopStartedServices(options.services);
	} catch (error) {
		errors.push(error);
	}
	try {
		await releaseEpisodeReservation(options.outRoot, options.reservation);
	} catch (error) {
		errors.push(error);
	}
	if (errors.length > 0)
		throw new AggregateError(
			errors,
			"에피소드 런타임 정리 중 오류가 발생했습니다.",
		);
}

async function ensureServices(
	jobs: StudioJob[],
	paths: EpisodePaths,
	autoStart: boolean,
	onManagedChange?: (services: readonly ManagedService[]) => void,
): Promise<ManagedService[]> {
	await execFileP("ffmpeg", ["-version"]);
	await execFileP("ffprobe", ["-version"]);
	const endpoints = resolveServiceEndpoints();
	const managed: ManagedService[] = [];
	const register = (service: ManagedService): void => {
		managed.push(service);
		onManagedChange?.([...managed]);
	};
	try {
		if (!(await healthOk(endpoints.apiProxy.healthUrl))) {
			if (!autoStart)
				throw new Error(
					`api-proxy가 실행 중이 아닙니다: ${endpoints.apiProxy.healthUrl}`,
				);
			assertManagedAutoStartSupported("api-proxy", endpoints.apiProxy);
			await startService({
				name: "api-proxy",
				command: "npx",
				args: ["tsx", join(PROJECT_ROOT, "server/api-proxy.ts")],
				cwd: PROJECT_ROOT,
				healthUrl: endpoints.apiProxy.healthUrl,
				logFile: join(paths.logDir, "api-proxy.log"),
				timeoutMs: 30_000,
				env: {
					...process.env,
					API_PROXY_URL: endpoints.apiProxy.baseUrl,
					API_PROXY_HOST: endpoints.apiProxy.listenHost,
					API_PROXY_PORT: String(endpoints.apiProxy.port),
					COMFY_URL: endpoints.comfy.baseUrl,
				},
				onSpawn: register,
			});
		}
		const needsComfy = jobs.some((job) => job.style === "illustrated");
		if (needsComfy && !(await healthOk(endpoints.comfy.healthUrl))) {
			if (!autoStart)
				throw new Error(
					`ComfyUI가 실행 중이 아닙니다: ${endpoints.comfy.healthUrl}`,
				);
			assertManagedAutoStartSupported("ComfyUI", endpoints.comfy);
			const comfyRoot = process.env.COMFY_ROOT ?? join(homedir(), "ComfyUI");
			const python =
				process.env.COMFY_PYTHON ?? join(comfyRoot, "venv/bin/python");
			const mainFile = join(comfyRoot, "main.py");
			if (!existsSync(python) || !existsSync(mainFile))
				throw new Error(
					`ComfyUI 자동 시작 파일이 없습니다: ${python}, ${mainFile}`,
				);
			await startService({
				name: "ComfyUI",
				command: python,
				args: [
					mainFile,
					"--listen",
					endpoints.comfy.listenHost,
					"--port",
					String(endpoints.comfy.port),
				],
				cwd: comfyRoot,
				healthUrl: endpoints.comfy.healthUrl,
				logFile: join(paths.logDir, "comfyui.log"),
				timeoutMs: 120_000,
				env: {
					...process.env,
					API_PROXY_URL: endpoints.apiProxy.baseUrl,
					COMFY_URL: endpoints.comfy.baseUrl,
				},
				onSpawn: register,
			});
		}
		return managed;
	} catch (error) {
		try {
			await stopStartedServices(managed);
		} catch (cleanupError) {
			process.stderr.write(
				`WARN: 서비스 롤백 중 오류: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
			);
		}
		managed.length = 0;
		onManagedChange?.([]);
		throw error;
	}
}

function findGeneratedVideo(job: StudioJob): string {
	if (existsSync(job.expectedVideo)) return job.expectedVideo;
	const suffix = job.format === "shorts" ? "_shorts.mp4" : ".mp4";
	const entries = existsSync(job.outDir) ? readdirSync(job.outDir) : [];
	const candidates = entries
		.filter(
			(name) =>
				name.startsWith("economy_") &&
				name.endsWith(suffix) &&
				!name.includes("preview"),
		)
		.sort();
	const selected = candidates.at(-1);
	if (!selected)
		throw new Error(
			`${job.format} 렌더가 종료됐지만 MP4를 찾지 못했습니다: ${job.outDir}`,
		);
	return join(job.outDir, selected);
}

function artifactIfExists(path: string): string | undefined {
	try {
		return existsSync(path) && statSync(path).size > 0 ? path : undefined;
	} catch {
		return undefined;
	}
}

function requireArtifact(
	value: string | undefined,
	label: string,
	job: StudioJob,
): string {
	if (!value)
		throw new Error(`${job.format} ${label} 산출물 누락: ${job.outDir}`);
	return value;
}

function assertReleaseReports(
	renderQcPath: string,
	verifyReportPath: string,
	job: StudioJob,
): void {
	let renderQc: Record<string, unknown>;
	let verifyReport: Record<string, unknown>;
	try {
		renderQc = JSON.parse(readFileSync(renderQcPath, "utf8"));
		verifyReport = JSON.parse(readFileSync(verifyReportPath, "utf8"));
	} catch (error) {
		throw new Error(
			`${job.format} QC JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const issues = Array.isArray(renderQc.issues) ? renderQc.issues : [];
	if (
		renderQc.passed !== true ||
		typeof renderQc.score !== "number" ||
		renderQc.score < 85 ||
		issues.length > 0
	)
		throw new Error(`${job.format} 심층 렌더 QC 통과 증거가 없습니다.`);
	if (verifyReport.ok !== true)
		throw new Error(`${job.format} 영상/SRT 검수 통과 증거가 없습니다.`);
}

function discoverArtifacts(
	job: StudioJob,
	video: string,
	logFile: string,
): EpisodeOutput {
	const stem = video.replace(/\.mp4$/i, "");
	const srt = requireArtifact(artifactIfExists(`${stem}.srt`), "SRT", job);
	const thumbnail = requireArtifact(
		artifactIfExists(`${stem}_thumb.jpg`) ??
			artifactIfExists(join(job.outDir, "thumbnail.jpg")),
		"썸네일",
		job,
	);
	const metadata = requireArtifact(
		artifactIfExists(`${stem}.platform_meta.json`) ??
			artifactIfExists(join(job.outDir, "platform_meta.json")),
		"플랫폼 메타데이터",
		job,
	);
	const renderQc = requireArtifact(
		artifactIfExists(`${stem}.render_qc.json`),
		"심층 렌더 QC",
		job,
	);
	const verifyReport = requireArtifact(
		artifactIfExists(`${stem}.verify_report.json`) ??
			artifactIfExists(`${stem}.verify.json`) ??
			artifactIfExists(join(job.outDir, "verify-report.json")),
		"영상/SRT 검수",
		job,
	);
	assertReleaseReports(renderQc, verifyReport, job);
	return {
		status: "complete",
		style: job.style,
		video,
		srt,
		thumbnail,
		metadata,
		qcReport: renderQc,
		renderQc,
		verifyReport,
		log: logFile,
	};
}

async function runJob(
	job: StudioJob,
	logFile: string,
	onChild?: (child: ChildProcess | null) => void,
): Promise<string> {
	mkdirSync(job.outDir, { recursive: true });
	mkdirSync(dirname(logFile), { recursive: true });
	const log = createWriteStream(logFile, { flags: "a" });
	const child = spawn("npx", ["tsx", job.script, ...job.args], {
		cwd: PROJECT_ROOT,
		env: { ...process.env, ...job.env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	onChild?.(child);
	child.stdout?.on("data", (chunk: Buffer) => {
		process.stdout.write(chunk);
		log.write(chunk);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		process.stderr.write(chunk);
		log.write(chunk);
	});
	let code: number;
	try {
		code = await new Promise<number>((resolveCode, rejectCode) => {
			child.once("error", rejectCode);
			child.once("exit", (exitCode) => resolveCode(exitCode ?? 1));
		});
	} finally {
		onChild?.(null);
		log.end();
	}
	if (code !== 0)
		throw new Error(`${job.format} 생성 실패(exit ${code}) — ${logFile}`);
	return findGeneratedVideo(job);
}

function initialManifest(
	id: string,
	paths: EpisodePaths,
	source: EconomySourceManifest,
	options: StudioOptions,
	now: Date,
	reservation: OwnedArticleReservation,
): EpisodeManifest {
	const requestedFormats = outputFormats(options.format);
	const outputs: EpisodeManifest["outputs"] = {};
	if (requestedFormats.includes("shorts"))
		outputs.shorts = {
			status: "pending",
			style: options.shortsStyle,
		};
	if (requestedFormats.includes("longform"))
		outputs.longform = { status: "pending", style: "illustrated" };
	return {
		version: 1,
		id,
		leaseId: reservation.leaseId,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		status: options.dryRun ? "planned" : "running",
		sourceFile: paths.sourceFile,
		article: source.article,
		requestedFormats,
		outputs,
	};
}

function updateManifest(
	path: string,
	manifest: EpisodeManifest,
	changes: Partial<EpisodeManifest>,
): EpisodeManifest {
	const next: EpisodeManifest = {
		...manifest,
		...changes,
		updatedAt: new Date().toISOString(),
	};
	writeJsonAtomic(path, next);
	return next;
}

function printHelp(): void {
	process.stdout.write(
		`Economy Studio — 같은 기사로 쇼츠와 롱폼 한 세트 생성\n\n`,
	);
	process.stdout.write(`사용법:\n`);
	process.stdout.write(`  npm run economy:studio -- --topic "금리"\n`);
	process.stdout.write(
		`  npm run economy:studio -- --format both --minutes 8 --shorts-style real\n`,
	);
	process.stdout.write(`\n옵션:\n`);
	process.stdout.write(`  --format both|shorts|longform       기본 both\n`);
	process.stdout.write(
		`  --shorts-style illustrated|real    기본 illustrated\n`,
	);
	process.stdout.write(
		`  --minutes 1..16                    롱폼 길이, 기본 8\n`,
	);
	process.stdout.write(`  --topic <키워드>                   기사 필터\n`);
	process.stdout.write(`  --channel <채널명>                 기본 경제 한입\n`);
	process.stdout.write(
		`  --source-file <source.json>        같은 기사 재실행\n`,
	);
	process.stdout.write(`  --out <디렉터리>                   작업 루트\n`);
	process.stdout.write(
		`  --dry-run true                     기사 선택/계획만 저장\n`,
	);
	process.stdout.write(
		`  --auto-start false                 서비스 자동 기동 금지\n`,
	);
}

async function main(): Promise<void> {
	if (process.argv.slice(2).includes("--help")) {
		printHelp();
		return;
	}
	const options = normalizeStudioOptions(process.argv.slice(2));
	mkdirSync(options.outRoot, { recursive: true });
	const now = new Date();
	const reserved = await reserveEpisodeSource(options, now);
	const { source, id, paths, reservation } = reserved;
	let manifest: EpisodeManifest | null = null;
	let services: ManagedService[] = [];
	let activeJob: StudioJob | null = null;
	let activeJobChild: ChildProcess | null = null;
	let episodeCommitted = false;
	const signalHandler = createReservationSignalHandler({
		cleanup: async () => {
			if (!episodeCommitted && manifest && existsSync(paths.manifestFile)) {
				try {
					manifest = updateManifest(paths.manifestFile, manifest, {
						status: "failed",
						outputs: manifest.outputs,
						error: "사용자 신호로 제작이 중단되었습니다.",
					});
				} catch (error) {
					process.stderr.write(
						`WARN: 신호 manifest 기록 오류: ${error instanceof Error ? error.message : String(error)}\n`,
					);
				}
			}
			await cleanupEpisodeRuntime({
				jobChild: activeJobChild,
				services,
				outRoot: options.outRoot,
				reservation,
			});
		},
		terminate: (signal) => {
			process.exit(signal === "SIGINT" ? 130 : 143);
		},
		onError: (error) => {
			process.stderr.write(
				`WARN: 신호 정리 오류: ${error instanceof Error ? error.message : String(error)}\n`,
			);
		},
	});
	const onSigint = () => void signalHandler("SIGINT");
	const onSigterm = () => void signalHandler("SIGTERM");
	process.once("SIGINT", onSigint);
	process.once("SIGTERM", onSigterm);
	try {
		for (const path of [
			paths.runDir,
			paths.shortsDir,
			paths.longformDir,
			paths.logDir,
		])
			mkdirSync(path, { recursive: true });
		writeJsonAtomic(paths.sourceFile, source);
		manifest = initialManifest(id, paths, source, options, now, reservation);
		writeJsonAtomic(paths.manifestFile, manifest);
		const stamp = Math.floor(now.getTime() / 1000);
		const jobs = buildStudioJobs(options, {
			runDir: paths.runDir,
			sourceFile: paths.sourceFile,
			stamp,
			articleSlug: slugify(source.article.title),
		});
		process.stdout.write(`\n경제 에피소드: ${source.article.title}\n`);
		process.stdout.write(`작업 폴더: ${paths.runDir}\n`);
		if (options.dryRun) {
			process.stdout.write(`dry-run 완료: ${paths.manifestFile}\n`);
			return;
		}

		services = await ensureServices(
			jobs,
			paths,
			options.autoStart,
			(current) => {
				services = [...current];
			},
		);
		for (const job of jobs) {
			activeJob = job;
			const logFile = join(paths.logDir, `${job.format}.log`);
			manifest.outputs[job.format] = {
				status: "running",
				style: job.style,
				log: logFile,
			};
			manifest = updateManifest(paths.manifestFile, manifest, {
				status: "running",
				outputs: manifest.outputs,
			});
			process.stdout.write(`\n[${job.format}] ${job.style} 제작 시작\n`);
			const video = await runJob(job, logFile, (child) => {
				activeJobChild = child;
			});
			manifest.outputs[job.format] = discoverArtifacts(job, video, logFile);
			manifest = updateManifest(paths.manifestFile, manifest, {
				outputs: manifest.outputs,
			});
			activeJob = null;
		}
		if (!canCommitEpisode(manifest))
			throw new Error("요청한 포맷 중 완료되지 않은 작업이 있습니다.");
		manifest = updateManifest(paths.manifestFile, manifest, {
			status: "complete",
			outputs: manifest.outputs,
		});
		await commitEpisodeReservation(options.outRoot, reservation);
		episodeCommitted = true;
		process.stdout.write(`\n✅ 쇼츠·롱폼 제작 완료\n`);
		for (const format of manifest.requestedFormats) {
			const video = manifest.outputs[format]?.video;
			if (video) process.stdout.write(`  ${format}: ${video}\n`);
		}
		process.stdout.write(`  manifest: ${paths.manifestFile}\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (manifest && activeJob) {
			manifest.outputs[activeJob.format] = {
				...manifest.outputs[activeJob.format],
				status: "failed",
				style: activeJob.style,
				error: message,
			};
		}
		if (manifest && existsSync(paths.manifestFile)) {
			try {
				updateManifest(paths.manifestFile, manifest, {
					status: "failed",
					outputs: manifest.outputs,
					error: message,
				});
			} catch (manifestError) {
				process.stderr.write(
					`WARN: 실패 manifest 기록 오류: ${manifestError instanceof Error ? manifestError.message : String(manifestError)}\n`,
				);
			}
		}
		throw error;
	} finally {
		try {
			await cleanupEpisodeRuntime({
				jobChild: activeJobChild,
				services,
				outRoot: options.outRoot,
				reservation,
			});
		} catch (cleanupError) {
			process.stderr.write(
				`WARN: 런타임 정리 오류: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
			);
		} finally {
			process.removeListener("SIGINT", onSigint);
			process.removeListener("SIGTERM", onSigterm);
		}
	}
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		process.stderr.write(
			`ERROR: ${error instanceof Error ? error.stack : String(error)}\n`,
		);
		process.exit(1);
	});
}
