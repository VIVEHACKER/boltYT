/**
 * 간이 언어 감지 — 문자 분포 기반.
 * Whisper 호출 실패 시 fallback, TTS provider 선택용.
 *
 * 지원: ko / en / ja / zh / und (기타)
 */

export type DetectedLanguage = "ko" | "en" | "ja" | "zh" | "und";

interface LangScores {
	ko: number;
	en: number;
	ja: number;
	zh: number;
}

function classifyChar(c: number): keyof LangScores | null {
	// 한글: AC00-D7AF
	if (c >= 0xac00 && c <= 0xd7af) return "ko";
	if (c >= 0x3131 && c <= 0x318e) return "ko"; // 자모
	// 일본어 히라가나/가타카나: 3040-30FF
	if (c >= 0x3040 && c <= 0x30ff) return "ja";
	// 중국어 한자 + 일본 한자 — CJK Unified Ideographs (4E00-9FFF)
	// 일본 가나 함께 있으면 ja, 없으면 zh 로 판정 (후처리)
	if (c >= 0x4e00 && c <= 0x9fff) return "zh";
	// ASCII 영문
	if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return "en";
	return null;
}

export function detectLanguage(text: string): DetectedLanguage {
	if (!text || text.trim().length === 0) return "und";
	const scores: LangScores = { ko: 0, en: 0, ja: 0, zh: 0 };
	for (let i = 0; i < text.length; i++) {
		const k = classifyChar(text.charCodeAt(i));
		if (k) scores[k]++;
	}
	// 일본어 가나가 1개라도 있으면 ko/zh 보다 ja 우대 (CJK 한자는 ja 가 borrow)
	if (scores.ja > 0 && scores.ja >= scores.zh * 0.2) {
		scores.ja += scores.zh; // 한자 흡수
		scores.zh = 0;
	}
	const total = scores.ko + scores.en + scores.ja + scores.zh;
	if (total === 0) return "und";
	const winner = (
		Object.entries(scores) as [DetectedLanguage, number][]
	).reduce((a, b) => (b[1] > a[1] ? b : a));
	// 5% 이상 점유해야 confident
	if (winner[1] / total < 0.05) return "und";
	return winner[0];
}
