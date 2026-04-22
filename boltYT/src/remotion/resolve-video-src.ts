/**
 * Scene/CompositionV2 의 videoSrc 결정 로직 중앙화.
 *
 * 규약:
 * - data:/http/blob: → 그대로 (외부 또는 IndexedDB blob URL)
 * - 그 외 (상대 경로) → Remotion staticFile() 로 asset 경로 해소
 * - 빈 값 / null / undefined → ""
 *
 * useProxy 옵션은 후속 Phase(프리뷰 전용 proxy 소비) 용 예약 인자.
 * 현재는 no-op. 실 사용 시 pickPreviewSource(url, proxyAvailable, "preview") 경로 연결.
 */

import { pickPreviewSource } from "../lib/proxy-media";

export type StaticFileFn = (path: string) => string;

export interface ResolveVideoSrcOptions {
	/** 프리뷰 모드에서 프록시 파일이 준비된 경우 true. render 경로는 false 유지. */
	proxyAvailable?: boolean;
	/** 사용 목적. 기본 "render" (원본 보장). 브라우저 Player 프리뷰에서만 "preview". */
	usage?: "preview" | "render";
}

export function resolveVideoSrc(
	raw: string | null | undefined,
	staticFile: StaticFileFn,
	opts: ResolveVideoSrcOptions = {},
): string {
	if (!raw) return "";
	const usage = opts.usage ?? "render";
	const url =
		usage === "preview"
			? pickPreviewSource(raw, Boolean(opts.proxyAvailable), "preview")
			: raw;

	if (url.startsWith("data:")) return url;
	if (url.startsWith("http")) return url;
	if (url.startsWith("blob:")) return url;
	return staticFile(url);
}
