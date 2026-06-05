import { getApiProxyUrl, getReferenceAnalyzerUrl } from "./proxy";
import { getRenderServer } from "./render-queue";

export type PipelineServiceId =
	| "api-proxy"
	| "reference-analyzer"
	| "render-queue"
	| "youtube-upload";

export type PipelineServiceRole =
	| "generation"
	| "reference"
	| "render"
	| "upload";

export interface PipelineServiceProbe {
	id: PipelineServiceId;
	label: string;
	role: PipelineServiceRole;
	url: string;
	requiredFor: Array<"topic" | "script" | "media" | "render" | "upload">;
}

export interface PipelineServiceHealth {
	id: PipelineServiceId;
	label: string;
	role: PipelineServiceRole;
	url: string;
	ok: boolean;
	requiredFor: PipelineServiceProbe["requiredFor"];
	status: "online" | "offline" | "degraded";
	message: string;
	latencyMs?: number;
	details?: Record<string, unknown>;
}

export interface ContentPipelineHealthReport {
	checkedAt: string;
	overall: "ready" | "degraded" | "blocked";
	services: PipelineServiceHealth[];
	blockers: string[];
	warnings: string[];
	nextActions: string[];
}

const DEFAULT_TIMEOUT_MS = 2500;

function localStorageUrl(key: string, fallback: string): string {
	if (typeof localStorage === "undefined") return fallback;
	return localStorage.getItem(key) || fallback;
}

function getContentPipelineServiceProbes(): PipelineServiceProbe[] {
	return [
		{
			id: "api-proxy",
			label: "API Proxy",
			role: "generation",
			url: `${getApiProxyUrl()}/health`,
			requiredFor: ["topic", "script", "media"],
		},
		{
			id: "reference-analyzer",
			label: "Reference Analyzer",
			role: "reference",
			url: `${getReferenceAnalyzerUrl()}/health`,
			requiredFor: ["script"],
		},
		{
			id: "render-queue",
			label: "Render Queue",
			role: "render",
			url: `${getRenderServer()}/health`,
			requiredFor: ["render"],
		},
		{
			id: "youtube-upload",
			label: "YouTube Upload",
			role: "upload",
			url: `${localStorageUrl("youtube_server_url", "http://localhost:3457")}/health`,
			requiredFor: ["upload"],
		},
	];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasUnrecoveredOpenAiQuota(runtime: Record<string, unknown>): boolean {
	const quotaAt = Date.parse(String(runtime.lastQuotaAt ?? ""));
	const okAt = Date.parse(String(runtime.lastOkAt ?? ""));
	return (
		Number.isFinite(quotaAt) &&
		quotaAt > (Number.isFinite(okAt) ? okAt : 0)
	);
}

function serviceMessage(
	probe: PipelineServiceProbe,
	ok: boolean,
	payload: unknown,
): string {
	if (!isRecord(payload)) return `${probe.label} 응답 확인`;
	if (probe.id === "api-proxy") {
		const runtime = isRecord(payload.openaiRuntime)
			? payload.openaiRuntime
			: {};
		if (runtime.quotaBlocked === true) {
			return typeof runtime.quotaBlockedUntil === "string"
				? `OpenAI 쿼터 대기: ${runtime.quotaBlockedUntil}`
				: "OpenAI 쿼터 대기 중";
		}
		if (hasUnrecoveredOpenAiQuota(runtime)) {
			return "OpenAI 쿼터 실패 이후 정상 응답이 아직 없습니다.";
		}
		if (
			Array.isArray(payload.missing) &&
			payload.missing.includes("openai")
		) {
			return "OpenAI 키 미설정, 룰 기반 기능만 가능";
		}
		const configured = Array.isArray(payload.configured)
			? payload.configured.join(", ")
			: "";
		return configured ? `키 활성: ${configured}` : "서버는 켜짐, 키 상태 확인 필요";
	}
	if (probe.id === "render-queue") {
		return typeof payload.pendingJobs === "number"
			? `대기 ${payload.pendingJobs}개`
			: "렌더 서버 준비";
	}
	if (probe.id === "youtube-upload") {
		if (payload.authenticated === true) return "YouTube 인증 완료";
		if (payload.configured === true) return "키 설정됨, OAuth 필요";
		return "업로드 서버 준비 상태 확인 필요";
	}
	if (!ok) return `${probe.label} 연결 실패`;
	return "서버 준비";
}

function isApiProxyDegraded(payload: unknown): boolean {
	if (!isRecord(payload)) return false;
	const runtime = isRecord(payload.openaiRuntime) ? payload.openaiRuntime : {};
	return (
		runtime.quotaBlocked === true ||
		hasUnrecoveredOpenAiQuota(runtime) ||
		(Array.isArray(payload.missing) && payload.missing.includes("openai"))
	);
}

async function probeService(
	probe: PipelineServiceProbe,
	options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<PipelineServiceHealth> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const started = Date.now();
	try {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(),
			options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
		const response = await fetchImpl(probe.url, {
			signal: controller.signal,
		});
		clearTimeout(timeout);
		const payload = await response.json().catch(() => ({}));
		const baseOk =
			response.ok &&
			(!isRecord(payload) ||
				payload.ok === undefined ||
				payload.ok === true ||
				payload.configured === true);
		const degraded =
			isRecord(payload) &&
			((probe.id === "youtube-upload" &&
				(payload.configured !== true || payload.authenticated !== true)) ||
				(probe.id === "api-proxy" && isApiProxyDegraded(payload)));
		const ok = baseOk && !degraded;
		return {
			...probe,
			ok,
			status: ok ? "online" : degraded ? "degraded" : "offline",
			message: serviceMessage(probe, ok, payload),
			latencyMs: Date.now() - started,
			details: isRecord(payload) ? payload : undefined,
		};
	} catch {
		return {
			...probe,
			ok: false,
			status: "offline",
			message: `${probe.label}가 꺼져 있거나 접근할 수 없습니다.`,
			latencyMs: Date.now() - started,
		};
	}
}

export async function checkContentPipelineHealth(options: {
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
	services?: PipelineServiceProbe[];
} = {}): Promise<ContentPipelineHealthReport> {
	const services = await Promise.all(
		(options.services ?? getContentPipelineServiceProbes()).map((probe) =>
			probeService(probe, options),
		),
	);
	return summarizeContentPipelineHealth(services);
}

export function summarizeContentPipelineHealth(
	services: PipelineServiceHealth[],
	checkedAt = new Date().toISOString(),
): ContentPipelineHealthReport {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const nextActions: string[] = [];

	const byId = new Map(services.map((service) => [service.id, service]));
	const api = byId.get("api-proxy");
	const render = byId.get("render-queue");
	const reference = byId.get("reference-analyzer");
	const youtube = byId.get("youtube-upload");

	if (api?.status === "offline" || !api) {
		blockers.push("AI 추천, 대본 생성, TTS/이미지 생성에 필요한 api-proxy가 꺼져 있습니다.");
		nextActions.push("`npm run api-proxy`를 실행하고 설정 페이지에서 키 상태를 확인하세요.");
	} else if (api.status === "degraded") {
		warnings.push("api-proxy는 켜져 있지만 OpenAI 키/쿼터 상태 때문에 AI 생성은 제한됩니다.");
		nextActions.push("OpenAI 키/쿼터가 정상화될 때까지 룰 기반 추천과 기존 레퍼런스 제작 규칙을 사용하세요.");
	}
	if (!render?.ok) {
		blockers.push("최종 mp4 렌더와 렌더 QC에 필요한 render-queue가 꺼져 있습니다.");
		nextActions.push("`npm run render-queue`를 실행한 뒤 미리보기에서 다시 승인하세요.");
	}
	if (reference && !reference.ok) {
		warnings.push("레퍼런스 신규 분석/딥승격 서버가 꺼져 있어 자동 레퍼런스 보강은 제한됩니다.");
		nextActions.push("새 레퍼런스를 분석하려면 `npm run reference-analyzer`를 실행하세요.");
	}
	if (youtube && !youtube.ok) {
		warnings.push("YouTube 업로드 서버 또는 OAuth가 준비되지 않아 업로드 대기 이후 자동 업로드는 제한됩니다.");
		nextActions.push("배포 전 `npm run youtube`와 YouTube OAuth 상태를 확인하세요.");
	}

	const overall: ContentPipelineHealthReport["overall"] =
		blockers.length > 0
			? "blocked"
			: warnings.length > 0
				? "degraded"
				: "ready";

	return {
		checkedAt,
		overall,
		services,
		blockers,
		warnings,
		nextActions: [...new Set(nextActions)],
	};
}
