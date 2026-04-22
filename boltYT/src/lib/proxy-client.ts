/**
 * video-proxy 서버의 /build-proxy 엔드포인트 클라이언트.
 *
 * 용도: Scene/Timeline 프리뷰가 프로젝트 내부 비디오 경로를 사용할 때
 *      proxy 가 이미 있는지 확인하고 없으면 빌드 요청.
 */

export interface ProxyBuildResponse {
	ok: boolean;
	/** 서버가 제시한 proxy 파일 경로 (fs path). 클라는 URL 로 변환해서 사용. */
	proxyPath?: string;
	alreadyExists?: boolean;
	queued?: boolean;
	error?: string;
}

const DEFAULT_BASE = "http://localhost:3456";
const DEFAULT_TIMEOUT_MS = 5_000;

export async function requestProxyBuild(
	path: string,
	opts: { base?: string; timeoutMs?: number } = {},
): Promise<ProxyBuildResponse> {
	const base = opts.base ?? DEFAULT_BASE;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	try {
		const res = await fetch(`${base}/build-proxy`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const data = (await res.json().catch(() => ({}))) as ProxyBuildResponse;
		if (!res.ok) {
			return {
				ok: false,
				error:
					typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
			};
		}
		return { ...data, ok: true };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : "proxy request failed",
		};
	}
}

/**
 * alreadyExists 반환 때만 proxy URL 을 쓰도록 결정 — 그 외엔 원본 유지.
 * UI 는 queued 상태에서 poll 없이 다음 세션에 proxy 가 준비되어 있을 것.
 */
export function shouldUseProxy(response: ProxyBuildResponse): boolean {
	return Boolean(response.ok && response.alreadyExists);
}
