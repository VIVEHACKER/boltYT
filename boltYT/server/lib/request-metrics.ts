/**
 * HTTP 요청 메트릭 미들웨어
 *
 * 각 서버의 createServer 콜백 최상단에서 호출. res.finish/close 에서 자동 기록.
 * - counter http_requests_total{service,route,status}
 * - histogram http_request_duration_ms{service,route}
 * - counter http_errors_total{service,route,status} (5xx만)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { counter, histogram } from "./metrics.ts";

/**
 * 동적 path 세그먼트를 정규화 — 카디널리티 폭발 방지.
 * - UUID → :uuid
 * - 숫자 → :id
 * - 해시성 긴 토큰 (16자+ hex) → :hash
 */
export function normalizeRoute(pathname: string): string {
	return pathname
		.replace(
			/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
			"/:uuid",
		)
		.replace(/\/[0-9a-f]{16,}/gi, "/:hash")
		.replace(/\/\d+(?=\/|$)/g, "/:id");
}

const SKIP_ROUTES = new Set(["/health", "/api/metrics", "/api/errors"]);

export function trackRequest(
	req: IncomingMessage,
	res: ServerResponse,
	service: string,
): void {
	const urlPath = (req.url ?? "/").split("?")[0];
	if (SKIP_ROUTES.has(urlPath)) return;

	const start = performance.now();
	const route = normalizeRoute(urlPath);
	const method = req.method ?? "GET";
	let recorded = false;

	const finish = () => {
		if (recorded) return;
		recorded = true;
		const duration = performance.now() - start;
		const status = String(res.statusCode);
		const labels = { service, method, route, status };
		counter("http_requests_total", labels);
		histogram("http_request_duration_ms", duration, {
			service,
			method,
			route,
		});
		if (res.statusCode >= 500) {
			counter("http_errors_total", labels);
		}
	};

	res.once("finish", finish);
	res.once("close", finish);
}
