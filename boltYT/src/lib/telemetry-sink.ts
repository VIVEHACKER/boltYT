/**
 * @AX:WARN 클라이언트 → 서버 에러 beacon
 * @AX:REASON 무분별 beacon 은 서버 DoS. 배치/디바운스/크기/rate 제한 필수.
 *
 * 큐잉 → 2s 디바운스 또는 50개 도달 시 flush → sendBeacon 우선, fetch keepalive fallback.
 * pagehide 시 즉시 flush. flush 실패 시 재시도 없음 (무한 재시도 로그 폭주 방지).
 */

import { getApiProxyUrl } from "./proxy";

export interface TelemetryEvent {
	service?: string;
	level?: "error" | "warn";
	message: string;
	stack?: string;
	url?: string;
	status?: number;
}

const MAX_QUEUE = 50;
const FLUSH_DEBOUNCE_MS = 2000;

const queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

export function queueTelemetry(ev: TelemetryEvent): void {
	if (!ev.message) return;
	queue.push(ev);
	if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
	schedule();
}

function schedule() {
	if (timer || queue.length === 0) return;
	if (queue.length >= MAX_QUEUE) {
		void flush();
		return;
	}
	timer = setTimeout(() => {
		timer = null;
		void flush();
	}, FLUSH_DEBOUNCE_MS);
}

async function flush(): Promise<void> {
	if (queue.length === 0) return;
	const batch = queue.splice(0, queue.length);
	const url = `${getApiProxyUrl()}/api/telemetry`;
	const body = JSON.stringify({ events: batch });

	if (typeof navigator !== "undefined" && navigator.sendBeacon) {
		try {
			const blob = new Blob([body], { type: "application/json" });
			if (navigator.sendBeacon(url, blob)) return;
		} catch {
			/* fall through to fetch */
		}
	}

	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			keepalive: true,
		});
	} catch {
		// 실패 시 drop — 재시도 루프 방지
	}
}

/** pagehide/visibilitychange 시 강제 전송. 중복 호출 안전. */
export function installTelemetryFlushers(): void {
	if (installed) return;
	if (typeof window === "undefined") return;
	installed = true;
	window.addEventListener("pagehide", () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		void flush();
	});
	window.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") void flush();
	});
}

/** 테스트용 */
export function __drain(): TelemetryEvent[] {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	return queue.splice(0, queue.length);
}
