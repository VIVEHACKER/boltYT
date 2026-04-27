/**
 * SFX 카테고리별 쿨다운 — 연속된 같은 카테고리 SFX 재발 방지.
 *
 * 동일 mood/category 의 효과음이 연속 씬에 반복되면 청각 피로 누적.
 * 마지막 사용 시점 (frame) 을 추적하여 윈도우 안이면 skip.
 */

import type { SceneSfx, SfxCategory, SfxEntry } from "./sfx";

export interface CooldownTracker {
	/** 카테고리별 마지막 사용 frame */
	lastUseFrame: Partial<Record<SfxCategory, number>>;
}

export function createCooldownTracker(): CooldownTracker {
	return { lastUseFrame: {} };
}

/**
 * SFX 적용 가능 여부 판정. 가능하면 lastUseFrame 갱신.
 */
export function canFireSfx(
	tracker: CooldownTracker,
	category: SfxCategory,
	currentFrame: number,
	cooldownFrames = 60,
): boolean {
	const last = tracker.lastUseFrame[category];
	if (last === undefined || currentFrame - last >= cooldownFrames) {
		tracker.lastUseFrame[category] = currentFrame;
		return true;
	}
	return false;
}

/**
 * SceneSfx 의 enter/transition SFX 를 cooldown 필터에 통과시켜 반환.
 * 통과 못한 SFX 는 undefined 처리.
 */
export function applyCooldownToSfx(
	sceneSfx: SceneSfx,
	sceneStartFrame: number,
	tracker: CooldownTracker,
	cooldownFrames = 60,
): SceneSfx {
	const out: SceneSfx = { ...sceneSfx };
	const enter = sceneSfx.enterSfx;
	if (enter && !canFireSfx(tracker, enter.category, sceneStartFrame, cooldownFrames)) {
		out.enterSfx = undefined;
	}
	const trans = sceneSfx.transitionSfx;
	if (
		trans &&
		!canFireSfx(
			tracker,
			trans.category,
			sceneStartFrame + (sceneSfx.transitionOffsetFrames ?? 0),
			cooldownFrames,
		)
	) {
		out.transitionSfx = undefined;
	}
	return out;
}

/** SfxEntry 배열에 cooldown 필터 적용 — 통과한 entry 만 반환 */
export function filterByCooldown(
	entries: { entry: SfxEntry; frame: number }[],
	cooldownFrames = 60,
): SfxEntry[] {
	const tracker = createCooldownTracker();
	const out: SfxEntry[] = [];
	for (const { entry, frame } of entries) {
		if (canFireSfx(tracker, entry.category, frame, cooldownFrames)) {
			out.push(entry);
		}
	}
	return out;
}
