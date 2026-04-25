/**
 * 렌더 큐 인증 + ffmpeg 가용성 체크 — 순수 함수 (테스트 가능).
 */

import { execFile } from "node:child_process";

/**
 * RENDER_API_KEY 설정 여부에 따라 Bearer 토큰 검증.
 * apiKey 빈 문자열이면 항상 true (개발 모드).
 */
export function checkApiKey(
	authHeader: string | undefined,
	apiKey: string,
): boolean {
	if (!apiKey) return true;
	return authHeader === `Bearer ${apiKey}`;
}

/**
 * ffmpeg -version 실행 후 가용 여부를 콜백으로 전달.
 */
export function checkFfmpegAvailability(
	onResult: (available: boolean) => void,
): void {
	execFile("ffmpeg", ["-version"], { timeout: 5_000 }, (err) => {
		onResult(!err);
	});
}
