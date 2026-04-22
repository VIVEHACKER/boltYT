/**
 * @AX:ANCHOR 멀티캠 그룹 모델
 * @AX:REASON 타임라인 / 렌더러 / 스위처 UI 공통 참조.
 *
 * 멀티캠 = 동일 시간 축을 공유하는 여러 비디오 소스 (angle 0,1,2,...).
 * - activeAngle: 프리뷰에 표시되는 기본 angle
 * - audioAngle: 오디오 소스로 쓰이는 angle (보통 activeAngle 과 같지만 독립 지정 가능)
 * - cuts: 프레임 → angle 스위칭 포인트 (한번 스위치된 angle 은 다음 cut 까지 유지)
 */

export interface MulticamAngleCut {
	/** 전역 타임라인 프레임 */
	frame: number;
	angle: number;
}

export interface MulticamGroup {
	id: string;
	name: string;
	angles: number;
	activeAngle: number;
	audioAngle: number;
	/** 비어 있으면 activeAngle 만 사용. 정렬된 상태 유지 */
	cuts: MulticamAngleCut[];
}

/** angles 수를 안전한 유한 정수로 정규화 (NaN/Infinity → 2) */
function normalizeAngles(n: number): number {
	if (!Number.isFinite(n) || n < 2) return 2;
	return Math.floor(n);
}

export function createMulticamGroup(
	id: string,
	name: string,
	angles: number,
): MulticamGroup {
	return {
		id,
		name,
		angles: normalizeAngles(angles),
		activeAngle: 0,
		audioAngle: 0,
		cuts: [],
	};
}

/** 특정 프레임의 활성 angle 반환 (cuts 가 있으면 이진/선형 탐색). */
export function angleAtFrame(group: MulticamGroup, frame: number): number {
	const { cuts, activeAngle, angles } = group;
	if (cuts.length === 0) return activeAngle;
	let current = activeAngle;
	for (const cut of cuts) {
		if (cut.frame <= frame) current = cut.angle;
		else break;
	}
	return clampAngle(current, angles);
}

/** cut 추가/갱신 — 같은 frame 에 있으면 덮어쓰기. 정렬 유지. */
export function setCut(
	group: MulticamGroup,
	frame: number,
	angle: number,
): MulticamGroup {
	// NaN/Infinity/음수 frame → 정렬 불변식 보호
	if (!Number.isFinite(frame) || frame < 0) return group;
	const safeFrame = Math.floor(frame);
	const safeAngle = clampAngle(angle, group.angles);
	const withoutSame = group.cuts.filter((c) => c.frame !== safeFrame);
	withoutSame.push({ frame: safeFrame, angle: safeAngle });
	withoutSame.sort((a, b) => a.frame - b.frame);
	return { ...group, cuts: withoutSame };
}

/** cut 삭제 */
export function removeCut(group: MulticamGroup, frame: number): MulticamGroup {
	return { ...group, cuts: group.cuts.filter((c) => c.frame !== frame) };
}

/** 연속된 동일 angle cut 축소 — 같은 angle 중복 제거 (스위치 없는 포인트). */
export function compactCuts(group: MulticamGroup): MulticamGroup {
	const out: MulticamAngleCut[] = [];
	let lastAngle = group.activeAngle;
	for (const cut of group.cuts) {
		if (cut.angle === lastAngle) continue;
		out.push(cut);
		lastAngle = cut.angle;
	}
	return { ...group, cuts: out };
}

/** angles 수 변경 — cuts 중 초과 angle 은 최대로 클램핑. */
export function setAngleCount(group: MulticamGroup, n: number): MulticamGroup {
	const angles = normalizeAngles(n);
	return {
		...group,
		angles,
		activeAngle: clampAngle(group.activeAngle, angles),
		audioAngle: clampAngle(group.audioAngle, angles),
		cuts: group.cuts.map((c) => ({
			frame: c.frame,
			angle: clampAngle(c.angle, angles),
		})),
	};
}

/** activeAngle 변경 (baseline). cuts 없을 때 즉시 반영 */
export function setActiveAngle(
	group: MulticamGroup,
	angle: number,
): MulticamGroup {
	return { ...group, activeAngle: clampAngle(angle, group.angles) };
}

export function setAudioAngle(
	group: MulticamGroup,
	angle: number,
): MulticamGroup {
	return { ...group, audioAngle: clampAngle(angle, group.angles) };
}

function clampAngle(angle: number, total: number): number {
	if (!Number.isFinite(angle)) return 0;
	const n = Math.floor(angle);
	if (n < 0) return 0;
	if (n >= total) return total - 1;
	return n;
}

/** 클립 멀티캠 바인딩 — 어느 그룹의 몇 번 angle 인지 */
export interface ClipMulticamRef {
	groupId: string;
	angle: number;
}
