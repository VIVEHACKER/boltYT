/**
 * 입력 검증 유틸리티
 */

/** 문자열 길이 제한 + 제어문자 제거 */
export function sanitizeString(input: unknown, maxLength = 500): string {
	if (typeof input !== "string") return "";
	// 제어문자 제거 (탭/개행 제외)
	const cleaned = input.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char stripping
		// eslint-disable-next-line no-control-regex
		/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
		"",
	);
	return cleaned.slice(0, maxLength);
}

/** 양의 정수 범위 검증 */
export function sanitizeInt(
	input: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	const n = Number(input);
	if (!Number.isFinite(n) || n < min || n > max) return fallback;
	return Math.floor(n);
}

/** HTML 이스케이프 (에러 메시지 렌더링 시) */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
