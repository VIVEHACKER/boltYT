/**
 * 품질 루프 활성 판정 — feature flag(전역) + 장르별 기본 ON 정책.
 *
 * 배경: quality_loop_v2(judge→auto-fix→재판정 루프)는 localStorage 플래그로만
 *   켜져 라이브 경로에서 사실상 꺼져 있었다(기본 off). 하지만 역사 시간여행
 *   브이로그처럼 *시리즈 일관성·시장 바 준수가 수익에 직결*되는 포맷은
 *   자동보정 루프가 켜져 있어야 "별로"를 막는다.
 *
 * 그래서: 전역 플래그가 off 여도 historical_vlog 장르는 루프를 기본 ON 으로 둔다.
 * 순수 함수 — DOM 의존 없음(플래그 값은 호출부에서 주입).
 */

import type { BenchmarkGenre } from "./market-benchmark";

export interface QualityLoopDecisionInput {
	/** localStorage 'quality_loop_v2' === '1' 등 전역 플래그 값 */
	flagEnabled: boolean;
	/** 분류된 장르 (없으면 장르 정책 미적용) */
	genre?: BenchmarkGenre;
}

/** 장르 단위로 품질 루프를 기본 ON 으로 강제하는 화이트리스트. */
export const QUALITY_LOOP_ALWAYS_ON_GENRES: readonly BenchmarkGenre[] = [
	"historical_vlog",
];

/** 전역 플래그가 켜졌거나, 장르가 always-on 화이트리스트면 활성. */
export function isQualityLoopEnabled(input: QualityLoopDecisionInput): boolean {
	if (input.flagEnabled) return true;
	if (input.genre && QUALITY_LOOP_ALWAYS_ON_GENRES.includes(input.genre)) {
		return true;
	}
	return false;
}
