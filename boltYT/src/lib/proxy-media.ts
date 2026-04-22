/**
 * 클라이언트: 프리뷰/플레이백에서 proxy 가 있으면 우선 사용.
 *
 * 원본 url 규약 하에 proxy url 을 계산 (실제 파일 존재 여부는 네트워크로만 확인).
 * - 원본: `/media/<path>.<ext>` → 프록시: `/media/<path>.proxy.mp4`
 * - 외부 URL (http://...) 은 proxy 생성 주체가 다르므로 그대로 반환
 */

const LOCAL_PREFIXES = ["/media/", "/renders/", "/public/", "blob:", "file://"];

export function isLocalMediaUrl(url: string): boolean {
	return LOCAL_PREFIXES.some((p) => url.startsWith(p));
}

export function proxyUrlFor(originalUrl: string): string {
	if (!isLocalMediaUrl(originalUrl)) return originalUrl;

	const qIdx = originalUrl.indexOf("?");
	const base = qIdx >= 0 ? originalUrl.slice(0, qIdx) : originalUrl;
	const qs = qIdx >= 0 ? originalUrl.slice(qIdx) : "";

	// 확장자 치환
	const lastDot = base.lastIndexOf(".");
	const lastSlash = base.lastIndexOf("/");
	if (lastDot <= lastSlash) {
		// 확장자 없음 → suffix 만 부여
		return `${base}.proxy.mp4${qs}`;
	}
	const stem = base.slice(0, lastDot);
	return `${stem}.proxy.mp4${qs}`;
}

/**
 * 프리뷰 플레이어용 소스 선택.
 * - 프록시 체크 요청 실패 또는 상태가 proxy-not-available 이면 원본 사용
 * - usage==="render" 는 무조건 원본 (풀 해상도 필요)
 */
export function pickPreviewSource(
	originalUrl: string,
	proxyAvailable: boolean,
	usage: "preview" | "render",
): string {
	if (usage === "render") return originalUrl;
	if (!proxyAvailable) return originalUrl;
	return proxyUrlFor(originalUrl);
}
