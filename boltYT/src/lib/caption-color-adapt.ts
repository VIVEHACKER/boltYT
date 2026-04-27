/**
 * 자막 색상 적응 — 배경 밝기에 따라 자막 색을 화이트/블랙으로 자동 전환.
 *
 * Composition / Scene 에서 배경 brightness 추정 (이미지 평균 또는 사용자 지정) 을
 * 받아 contrast 가 충분한 자막 색을 반환.
 */

export interface CaptionColorAdaptInput {
	/** 0-255 배경 평균 밝기 */
	bgBrightness: number;
	/** 강제 색상 — bgBrightness 무시 */
	override?: string;
}

/**
 * WCAG 4.5:1 contrast 보장 자막 컬러 반환.
 * - 배경 < 80 → 흰색
 * - 배경 > 175 → 검정 (밝은 BG 에 흰색 자막은 가시성 ↓)
 * - 중간 → 흰색 + 강한 stroke
 */
export function adaptiveCaptionColor(input: CaptionColorAdaptInput): {
	color: string;
	stroke: string;
	useStroke: boolean;
} {
	if (input.override) {
		return {
			color: input.override,
			stroke: "rgba(0,0,0,0.85)",
			useStroke: true,
		};
	}
	const b = input.bgBrightness;
	if (b > 175) {
		return {
			color: "#101010",
			stroke: "rgba(255,255,255,0.85)",
			useStroke: true,
		};
	}
	if (b < 80) {
		return {
			color: "#ffffff",
			stroke: "rgba(0,0,0,0.7)",
			useStroke: false,
		};
	}
	return {
		color: "#ffffff",
		stroke: "rgba(0,0,0,0.92)",
		useStroke: true,
	};
}
