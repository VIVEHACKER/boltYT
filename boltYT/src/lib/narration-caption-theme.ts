import type { CSSProperties } from "react";
import type { NewsSurfaceTone } from "./news-surface-theme";

export type NarrationCaptionWordState = "active" | "past" | "future";

function hexToRgba(hex: string, alpha: number) {
	const normalized = hex.replace("#", "");
	if (normalized.length !== 6) return `rgba(255,255,255,${alpha})`;

	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);

	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function isNarrationTimelineCueWord(word: string) {
	return /\d{1,2}[.:]\d{2}|\d+일|당일|직후|이후|뒤|분 후|시간 후|오전|오후|새벽/u.test(
		word,
	);
}

/**
 * 자동 강조 단어 감지 — 숫자, 감탄사, 강조 부사, 고유명사 패턴.
 * 자막에서 highlight 컬러로 표시.
 */
export function isEmphasisWord(word: string): boolean {
	if (!word) return false;
	const w = word.trim().replace(/[!?.,。！？，、…]+$/, "");
	if (w.length === 0) return false;
	// 숫자 (백분율, 만/억/천/명 단위)
	if (/^\d+([.,]\d+)?(%|배|개|명|만|억|천|회|초|분|시간|일|년)?$/.test(w))
		return true;
	// 강조 부사
	if (
		/^(절대|반드시|무조건|꼭|결국|마침내|진짜|정말|완전|엄청|역대|사상|단|오직|유일)$/.test(
			w,
		)
	)
		return true;
	// 감탄형 어미
	if (/[!！]+$/.test(word)) return true;
	// 고유명사 추정 (대문자 시작 영단어 2글자+)
	if (/^[A-Z][a-zA-Z]{2,}$/.test(w)) return true;
	return false;
}

/**
 * 숫자 강조 단어(백분율·만/억/천/명/원 등 단위 포함)만 판정 — 순수.
 * 자막에서 핵심 수치를 청크 내내 지속 하이라이트하려고 isEmphasisWord 의 숫자 분기를 별도로 노출한다.
 * 감탄사·부사 같은 다른 강조어와 달리 숫자는 데이터라 활성 순간만이 아니라 계속 도드라지게 한다.
 */
export function isNumberEmphasisWord(word: string): boolean {
	if (!word) return false;
	const w = word.trim().replace(/[!?.,。！？，、…]+$/, "");
	// 단위는 0개 이상 — "12만원"(만+원) 같은 복합 단위도 하나의 수치로 인정.
	return /^\d+([.,]\d+)?(?:%|배|개|명|만|억|천|회|초|분|시간|일|년|원)*$/.test(
		w,
	);
}

export function getNarrationCaptionContainerToneStyle(params: {
	tone?: NewsSurfaceTone;
	accentColor: string;
	hookBoost?: boolean;
}): CSSProperties {
	const { tone = "generic", accentColor, hookBoost = false } = params;
	const glow = hexToRgba(accentColor, hookBoost ? 0.26 : 0.16);

	switch (tone) {
		case "witness":
			return {
				borderLeft: `2px solid ${hexToRgba(accentColor, 0.42)}`,
				paddingLeft: 10,
				boxShadow: `inset 1px 0 0 ${hexToRgba(accentColor, 0.12)}, 0 0 14px ${glow}`,
			};
		case "evidence":
			return {
				border: `1px dashed ${hexToRgba(accentColor, 0.26)}`,
				boxShadow: `0 0 0 1px ${hexToRgba(accentColor, 0.08)}, 0 8px 20px ${hexToRgba(accentColor, 0.08)}`,
				backgroundImage:
					"repeating-linear-gradient(180deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 10px)",
			};
		case "timeline":
			return {
				borderTop: `1px solid ${hexToRgba(accentColor, 0.26)}`,
				borderBottom: `1px solid ${hexToRgba(accentColor, 0.18)}`,
				boxShadow: `0 0 14px ${glow}`,
			};
		default:
			return {};
	}
}

export function getNarrationCaptionWordToneStyle(params: {
	tone?: NewsSurfaceTone;
	word: string;
	state: NarrationCaptionWordState;
	accentColor: string;
}): CSSProperties {
	const { tone = "generic", word, state, accentColor } = params;
	const isTimelineCue = isNarrationTimelineCueWord(word);

	switch (tone) {
		case "witness":
			return {
				fontStyle: state === "future" ? "normal" : "italic",
				transform:
					state === "active"
						? "translateX(-3px)"
						: state === "past"
							? "translateX(-1px)"
							: undefined,
				textShadow:
					state === "active"
						? `0 8px 22px ${hexToRgba(accentColor, 0.18)}`
						: undefined,
			};
		case "evidence":
			return state === "active" || state === "past"
				? {
						padding: "1px 6px",
						borderRadius: 7,
						background:
							state === "active"
								? hexToRgba(accentColor, 0.16)
								: hexToRgba(accentColor, 0.08),
						border: `1px solid ${hexToRgba(accentColor, state === "active" ? 0.28 : 0.14)}`,
						transform: state === "active" ? "rotate(-1deg)" : undefined,
					}
				: {};
		case "timeline":
			return isTimelineCue && state !== "future"
				? {
						padding: "1px 7px",
						borderRadius: 999,
						background:
							state === "active"
								? hexToRgba(accentColor, 0.16)
								: hexToRgba(accentColor, 0.08),
						border: `1px solid ${hexToRgba(accentColor, 0.24)}`,
					}
				: {};
		default:
			return {};
	}
}
