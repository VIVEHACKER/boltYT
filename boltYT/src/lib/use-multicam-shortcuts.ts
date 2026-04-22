/**
 * 선택된 멀티캠 클립이 있을 때 숫자 키 1-9 로 현재 playhead 에 cut 추가.
 * input/textarea 포커스 중에는 무시 (입력 방해 방지).
 *
 * onCut(angleIndex) 콜백 — HUD 트리거용 옵션 파라미터.
 */

import { useEffect } from "react";
import { findGroup } from "./multicam-timeline";
import { useTimelineStore } from "./timeline-store";

export interface UseMulticamShortcutsOptions {
	/** 단축키로 cut 이 추가될 때 호출. angle 은 0-based 인덱스. */
	onCut?: (angle: number) => void;
}

export function useMulticamShortcuts(
	options?: UseMulticamShortcutsOptions,
): void {
	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);
	const selected = useTimelineStore((s) => s.selected());
	const setMulticamCut = useTimelineStore((s) => s.setMulticamCut);

	const onCut = options?.onCut;

	useEffect(() => {
		const clip = selected.find((c) => c.multicam);
		const groupId = clip?.multicam?.groupId;
		const group = project && groupId ? findGroup(project, groupId) : undefined;
		if (!group) return;

		function onKey(e: KeyboardEvent) {
			const t = e.target as HTMLElement | null;
			if (
				t &&
				(t.tagName === "INPUT" ||
					t.tagName === "TEXTAREA" ||
					t.isContentEditable)
			) {
				return;
			}
			if (!group) return;
			const n = Number(e.key);
			if (!Number.isInteger(n) || n < 1 || n > group.angles) return;
			e.preventDefault();
			setMulticamCut(group.id, playhead, n - 1);
			onCut?.(n - 1);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [project, playhead, selected, setMulticamCut, onCut]);
}
