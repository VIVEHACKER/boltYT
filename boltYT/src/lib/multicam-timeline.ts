/**
 * 멀티캠 그룹과 타임라인 클립 간 조회 헬퍼.
 *
 * Scene.tsx / 스위처 UI / 렌더러가 공통 사용. 순수 함수.
 */

import { angleAtFrame, type MulticamGroup } from "./multicam";
import type { TimelineClip, TimelineProject } from "./timeline-model";

export function findGroup(
	project: TimelineProject,
	groupId: string,
): MulticamGroup | undefined {
	return project.multicamGroups?.find((g) => g.id === groupId);
}

/** groupId 에 속한 클립들을 angle 오름차순으로 반환. */
export function groupedMulticamClips(
	project: TimelineProject,
	groupId: string,
): TimelineClip[] {
	return project.clips
		.filter((c) => c.multicam?.groupId === groupId)
		.sort((a, b) => (a.multicam?.angle ?? 0) - (b.multicam?.angle ?? 0));
}

/** 주어진 global frame 에서 표시되어야 하는 비주얼 클립. 해당 angle 이 없으면 undefined. */
export function findActiveMulticamClip(
	project: TimelineProject,
	groupId: string,
	frame: number,
): TimelineClip | undefined {
	const group = findGroup(project, groupId);
	if (!group) return undefined;
	const angle = angleAtFrame(group, frame);
	return project.clips.find(
		(c) =>
			c.multicam?.groupId === groupId &&
			c.multicam.angle === angle &&
			frame >= c.startFrame &&
			frame < c.startFrame + c.durationFrames,
	);
}

/** 오디오 소스로 쓰일 클립 — audioAngle 기준. */
export function findMulticamAudioClip(
	project: TimelineProject,
	groupId: string,
	frame: number,
): TimelineClip | undefined {
	const group = findGroup(project, groupId);
	if (!group) return undefined;
	return project.clips.find(
		(c) =>
			c.multicam?.groupId === groupId &&
			c.multicam.angle === group.audioAngle &&
			frame >= c.startFrame &&
			frame < c.startFrame + c.durationFrames,
	);
}

/** 특정 그룹 안에서 비주얼 angle 만 activate — 이전 클립들은 숨김. */
export function isMulticamClipVisible(
	project: TimelineProject,
	clip: TimelineClip,
	frame: number,
): boolean {
	if (!clip.multicam) return true; // 일반 클립은 그대로
	const active = findActiveMulticamClip(project, clip.multicam.groupId, frame);
	return active?.id === clip.id;
}
