/**
 * Sentry 브라우저 초기화.
 * VITE_SENTRY_DSN 미설정 시 no-op (개발/테스트 환경).
 */

import * as Sentry from "@sentry/react";

export function initSentry(): void {
	const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
	if (!dsn) return;

	Sentry.init({
		dsn,
		integrations: [
			Sentry.browserTracingIntegration(),
			Sentry.replayIntegration(),
		],
		tracesSampleRate: 0.1,
		replaysSessionSampleRate: 0.05,
		replaysOnErrorSampleRate: 1.0,
		environment: import.meta.env.MODE,
	});
}

export { Sentry };
