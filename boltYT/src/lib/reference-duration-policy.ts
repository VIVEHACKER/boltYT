export const SHORTS_MAX_DURATION_SECONDS = 3 * 60;
export const LONGFORM_MIN_DURATION_SECONDS = 8 * 60;
export const LONGFORM_MAX_DURATION_SECONDS = 20 * 60;

export function isShortsDuration(durationSeconds: number): boolean {
	return durationSeconds > 0 && durationSeconds <= SHORTS_MAX_DURATION_SECONDS;
}

export function isAllowedLongformDuration(durationSeconds: number): boolean {
	return (
		durationSeconds >= LONGFORM_MIN_DURATION_SECONDS &&
		durationSeconds <= LONGFORM_MAX_DURATION_SECONDS
	);
}

export function clampLongformDurationSeconds(durationSeconds: number): number {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return LONGFORM_MAX_DURATION_SECONDS;
	}
	return Math.min(Math.round(durationSeconds), LONGFORM_MAX_DURATION_SECONDS);
}

export function referenceFormatForDuration(
	durationSeconds: number,
): "shorts" | "longform" | "other" {
	if (isShortsDuration(durationSeconds)) return "shorts";
	if (isAllowedLongformDuration(durationSeconds)) return "longform";
	return "other";
}
