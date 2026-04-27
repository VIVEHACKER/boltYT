/**
 * 오디오 페이드 헬퍼 — 순수 함수 (테스트 가능, Remotion 무관).
 * Composition / Player 양쪽에서 재사용.
 */

/** linear fade-in volume (0→1) for given frame */
export function linearFadeIn(frame: number, durationFrames: number): number {
	if (durationFrames <= 0) return 1;
	if (frame <= 0) return 0;
	if (frame >= durationFrames) return 1;
	return frame / durationFrames;
}

/** linear fade-out volume (1→0) ending at totalFrames */
export function linearFadeOut(
	frame: number,
	totalFrames: number,
	durationFrames: number,
): number {
	if (durationFrames <= 0 || totalFrames <= 0) return 1;
	const fadeStart = totalFrames - durationFrames;
	if (frame <= fadeStart) return 1;
	if (frame >= totalFrames) return 0;
	return 1 - (frame - fadeStart) / durationFrames;
}

/** smooth (cubic ease-in-out) fade-in */
export function smoothFadeIn(frame: number, durationFrames: number): number {
	const t = linearFadeIn(frame, durationFrames);
	return t * t * (3 - 2 * t);
}

export function smoothFadeOut(
	frame: number,
	totalFrames: number,
	durationFrames: number,
): number {
	const t = linearFadeOut(frame, totalFrames, durationFrames);
	return t * t * (3 - 2 * t);
}

/** 양쪽 fade 결합 — fade-in 과 fade-out 의 최소값 (envelope) */
export function fadeEnvelope(
	frame: number,
	totalFrames: number,
	fadeInFrames: number,
	fadeOutFrames: number,
	curve: "linear" | "smooth" = "smooth",
): number {
	const fnIn = curve === "smooth" ? smoothFadeIn : linearFadeIn;
	const fnOut = curve === "smooth" ? smoothFadeOut : linearFadeOut;
	return Math.min(
		fnIn(frame, fadeInFrames),
		fnOut(frame, totalFrames, fadeOutFrames),
	);
}
