/**
 * 서버 간 proxy 빌드 위임 — reference-analyzer / render-queue 같은 파일 생성 서버가
 * video-proxy(:3456) 의 POST /build-proxy 에 fire-and-forget 제출.
 *
 * 실패 시 소리 없이 drop (프록시는 프리뷰 편의 기능이라 실 워크플로우 영향 없음).
 */

const DEFAULT_BASE =
	process.env.VIDEO_PROXY_BASE_URL ?? "http://localhost:3456";
const DEFAULT_TIMEOUT_MS = 5_000;

export interface EnqueueProxyOptions {
	base?: string;
	timeoutMs?: number;
}

export interface EnqueueProxyResult {
	ok: boolean;
	status?: number;
	error?: string;
}

export async function enqueueProxyBuild(
	path: string,
	opts: EnqueueProxyOptions = {},
): Promise<EnqueueProxyResult> {
	const base = opts.base ?? DEFAULT_BASE;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	try {
		const res = await fetch(`${base}/build-proxy`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		return { ok: res.ok, status: res.status };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : "enqueue failed",
		};
	}
}

/** fire-and-forget 래퍼 — 로그 남기되 예외/결과 무시. */
export function enqueueProxyBuildBackground(
	path: string,
	onResult?: (r: EnqueueProxyResult) => void,
	opts?: EnqueueProxyOptions,
): void {
	void enqueueProxyBuild(path, opts).then((r) => {
		onResult?.(r);
	});
}
