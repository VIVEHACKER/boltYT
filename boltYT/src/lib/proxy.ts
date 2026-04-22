/**
 * API 프록시 서버 URL — 모든 외부 API 호출의 진입점
 *
 * 서버(api-proxy.ts)가 API 키를 관리하므로
 * 클라이언트는 키 없이 이 URL로 요청합니다.
 */
export function getApiProxyUrl(): string {
	return localStorage.getItem("api_proxy_url") || "http://localhost:3459";
}

/** Reference Analyzer 서버 URL (server/reference-analyzer.ts) */
export function getReferenceAnalyzerUrl(): string {
	return (
		localStorage.getItem("reference_analyzer_url") || "http://localhost:3460"
	);
}
