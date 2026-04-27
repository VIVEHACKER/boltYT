/**
 * 엔딩 CTA 자동 생성 — 스크립트 컨텐츠 / 카테고리에 맞는 콜투액션.
 *
 * Korean platform conventions:
 *  - 쇼츠: 짧고 강한 콜 (구독!, 좋아요!, 댓글로 알려주세요!)
 *  - 롱폼: 부드러운 마무리 (구독과 알림 설정 부탁드립니다)
 *  - 스토리/미스터리: 다음편 떡밥 (다음 영상에서 이어서)
 */

export type CtaIntent = "subscribe" | "engage" | "next_episode" | "share";

export interface CtaInput {
	scriptTitle?: string;
	scriptType?: "shorts" | "longform";
	mood?: string;
	hookPattern?: string;
}

export interface CtaResult {
	primary: string;
	secondary?: string;
	intent: CtaIntent;
}

/**
 * 입력 → CTA 텍스트 1-2줄.
 */
export function generateCta(input: CtaInput): CtaResult {
	const isShorts = input.scriptType === "shorts";
	const mood = input.mood;

	// 미스터리/공포 → 다음편
	if (mood === "mystery" || mood === "horror") {
		return {
			primary: isShorts ? "끝까지 보셨다면 좋아요!" : "다음 영상에서 이어집니다",
			secondary: isShorts ? "구독해주세요" : "구독과 알림 설정 부탁드립니다",
			intent: "next_episode",
		};
	}

	// news → engage
	if (mood === "news") {
		return {
			primary: isShorts
				? "어떻게 생각하세요?"
				: "댓글로 의견 남겨주세요",
			secondary: isShorts ? "구독!" : "구독과 알림 부탁드립니다",
			intent: "engage",
		};
	}

	// hook 패턴별
	if (input.hookPattern === "question") {
		return {
			primary: isShorts ? "정답은 댓글로!" : "여러분의 답변을 댓글로 남겨주세요",
			secondary: isShorts ? "구독!" : "구독과 알림 부탁드립니다",
			intent: "engage",
		};
	}

	// 기본: 구독 유도
	return {
		primary: isShorts ? "마음에 드셨다면 좋아요!" : "영상이 도움 되셨다면",
		secondary: isShorts
			? "구독으로 응원해주세요"
			: "구독과 좋아요 부탁드립니다",
		intent: "subscribe",
	};
}
