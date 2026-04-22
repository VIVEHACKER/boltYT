/**
 * useProxyAvailable — 주어진 클립 URL 에 대해 proxy 파일이 서버에 있는지 확인.
 *
 * - blob: / data: URL 은 프록시 불필요 → proxyUrl: null
 * - 외부 http URL 이면 proxyUrlFor() 가 원본을 그대로 반환하므로 skip
 * - /media/... 등 로컬 경로 → video-proxy 서버(:3456) 에 빌드 요청
 *   alreadyExists === true 이면 isReady=true, proxyUrl 반환
 */

import { useEffect, useRef, useState } from "react";
import { requestProxyBuild, shouldUseProxy } from "../lib/proxy-client";
import { isLocalMediaUrl, proxyUrlFor } from "../lib/proxy-media";

export interface ProxyAvailableResult {
	proxyUrl: string | null;
	isReady: boolean;
}

const SKIP_PREFIXES = ["blob:", "data:"];

function shouldSkipProxy(url: string): boolean {
	return SKIP_PREFIXES.some((p) => url.startsWith(p));
}

export function useProxyAvailable(
	_clipId: string,
	originalUrl: string,
): ProxyAvailableResult {
	const [resultState, setResultState] = useState<{
		originalUrl: string;
		result: ProxyAvailableResult;
	} | null>(null);

	// 직전 체크 URL 을 캐싱해 불필요한 재요청 방지
	const lastChecked = useRef<string>("");

	useEffect(() => {
		// 빈 URL or 동일 URL 재체크 방지
		if (!originalUrl || originalUrl === lastChecked.current) return;

		// blob/data/외부 URL 은 proxy 불필요
		if (shouldSkipProxy(originalUrl) || !isLocalMediaUrl(originalUrl)) return;

		let cancelled = false;
		lastChecked.current = originalUrl;

		requestProxyBuild(originalUrl).then((resp) => {
			if (cancelled) return;
			if (shouldUseProxy(resp)) {
				setResultState({
					originalUrl,
					result: { proxyUrl: proxyUrlFor(originalUrl), isReady: true },
				});
			} else {
				setResultState({
					originalUrl,
					result: { proxyUrl: null, isReady: false },
				});
			}
		});

		return () => {
			cancelled = true;
		};
	}, [originalUrl]);

	if (!originalUrl || shouldSkipProxy(originalUrl) || !isLocalMediaUrl(originalUrl)) {
		return { proxyUrl: null, isReady: false };
	}

	return resultState?.originalUrl === originalUrl
		? resultState.result
		: { proxyUrl: null, isReady: false };
}
