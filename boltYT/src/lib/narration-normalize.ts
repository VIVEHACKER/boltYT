/**
 * 나레이션 텍스트 정규화 — TTS / 자막 일관성 보장.
 *
 * GPT 출력에 흔한 noise 를 제거:
 *  - 양 끝 공백
 *  - 중복 공백 (\s+ → space)
 *  - 굽은 따옴표 → 곧은 따옴표
 *  - 트리플 마침표 (...) → ellipsis (…) 단일화
 *  - 문장 끝 이중 구두점 (..!) → 단일 구두점
 *  - 영문 i 단독 → I (TTS 발음 일관성)
 */

export interface NormalizeOptions {
	/** 영문 i 단독 → I 자동 교정. 기본 true */
	fixIsolatedI?: boolean;
}

const SMART_QUOTE_MAP: Record<string, string> = {
	"\u201C": '"',
	"\u201D": '"',
	"\u2018": "'",
	"\u2019": "'",
	"\u00AB": '"',
	"\u00BB": '"',
};

export function normalizeNarration(
	raw: string,
	opts: NormalizeOptions = {},
): string {
	if (!raw) return "";
	let text = raw;

	// smart quotes
	text = text.replace(/[\u201C\u201D\u2018\u2019\u00AB\u00BB]/g, (c) => SMART_QUOTE_MAP[c] ?? c);

	// 트리플 dots → ellipsis
	text = text.replace(/\.{3,}/g, "…");

	// 이중 구두점 (..!! → !)
	text = text.replace(/[!?。！？]{2,}/g, (m) => m[0]);

	// 영문 i 단독 → I
	if (opts.fixIsolatedI !== false) {
		text = text.replace(/(^|\s)i(\s|$|[.,!?;:'"])/g, "$1I$2");
	}

	// 줄바꿈 보호 후 공백 정리
	text = text.replace(/[ \t]+/g, " ");
	text = text.replace(/\n{3,}/g, "\n\n");

	return text.trim();
}

/**
 * 씬 배열 일괄 정규화 — narration 필드만 변경, 나머지 보존.
 */
export function normalizeScenesNarration<T extends { narration?: string }>(
	scenes: T[],
	opts?: NormalizeOptions,
): T[] {
	return scenes.map((s) =>
		s.narration
			? { ...s, narration: normalizeNarration(s.narration, opts) }
			: s,
	);
}
