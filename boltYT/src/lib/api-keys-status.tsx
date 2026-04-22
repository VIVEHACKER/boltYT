/**
 * API 키 상태 Provider — 서버(api-proxy :3459 /api/keys/status)가 단일 진실 공급원.
 *
 * 설계 원칙:
 * - localStorage 캐시 **없음** (stale 데이터로 인한 장기 버그 방지)
 * - App 루트에서 한 번 fetch → Context 로 공유
 * - 창 포커스 복귀 시 자동 재fetch (`.env` 수정 후 복귀하는 워크플로우 지원)
 *
 * Context / 훅 / 타입은 `api-keys-context.ts` 에 분리 — react-refresh 규칙 만족.
 */

import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
	ApiKeysContext,
	type ApiKeysStatus,
	EMPTY_STATUS,
} from "./api-keys-context";
import { getApiProxyUrl } from "./proxy";

async function fetchStatus(): Promise<ApiKeysStatus | null> {
	try {
		const res = await fetch(`${getApiProxyUrl()}/api/keys/status`, {
			signal: AbortSignal.timeout(5_000),
		});
		if (!res.ok) return null;
		return {
			...EMPTY_STATUS,
			...((await res.json()) as Partial<ApiKeysStatus>),
		};
	} catch {
		return null;
	}
}

export function ApiKeysProvider({ children }: { children: ReactNode }) {
	const [status, setStatus] = useState<ApiKeysStatus>(EMPTY_STATUS);
	const [loaded, setLoaded] = useState(false);
	const [error, setError] = useState(false);

	const refresh = useCallback(async () => {
		const next = await fetchStatus();
		if (next) {
			setStatus(next);
			setError(false);
		} else {
			setError(true);
		}
		setLoaded(true);
	}, []);

	useEffect(() => {
		// 최초 마운트 시 서버에서 키 상태 fetch — setState 는 async 경계 이후에 발생
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void refresh();
		function onFocus() {
			void refresh();
		}
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [refresh]);

	return (
		<ApiKeysContext.Provider value={{ status, loaded, error, refresh }}>
			{children}
		</ApiKeysContext.Provider>
	);
}
