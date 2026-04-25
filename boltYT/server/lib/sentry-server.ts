/**
 * Sentry 서버 초기화.
 * SENTRY_DSN 미설정 시 no-op.
 *
 * 렌더 큐 / API 프록시 등 서버 진입점 최상단에서 호출.
 */

import * as Sentry from "@sentry/node";

export function initSentryServer(service: string): void {
	const dsn = process.env.SENTRY_DSN;
	if (!dsn) return;

	Sentry.init({
		dsn,
		serverName: service,
		tracesSampleRate: 0.05,
		environment: process.env.NODE_ENV ?? "production",
	});
}

export { Sentry };
