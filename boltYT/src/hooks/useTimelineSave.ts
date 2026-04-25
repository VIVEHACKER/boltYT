/**
 * useTimelineSave — 타임라인 변경사항을 DB에 저장 (update/insert/delete).
 */

import { useCallback, useState } from "react";
import { supabase } from "../lib/supabase";
import { useTimelineStore } from "../lib/timeline-store";

export interface TimelineSaveResult {
	saving: boolean;
	message: string | null;
	handleSave: () => Promise<void>;
}

export function useTimelineSave(
	initialSceneIdsRef: React.MutableRefObject<Set<string>>,
): TimelineSaveResult {
	const toSceneRecords = useTimelineStore((s) => s.toSceneRecords);
	const liveSceneIds = useTimelineStore((s) => s.liveSceneIds);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setMessage(null);
		try {
			const plan = toSceneRecords();
			const surviving = new Set(liveSceneIds());

			// 1. UPDATE — 기존 씬 편집 결과
			for (const r of plan.update) {
				if (!r.id) continue;
				await supabase
					.from("scenes")
					.update({
						order_index: r.order_index,
						duration_seconds: r.duration_seconds,
						start_frame: r.start_frame,
						edit_keyframes: r.edit_keyframes,
						color_grade: r.color_grade,
						transition: r.transition,
					})
					.eq("id", r.id);
			}

			// 2. INSERT — split/신규 추가 씬
			let inserted = 0;
			if (plan.insert.length > 0) {
				const { error } = await supabase.from("scenes").insert(plan.insert);
				if (error) throw error;
				inserted = plan.insert.length;
			}

			// 3. DELETE — 로드 시 존재했으나 현재 없는 씬
			const toDelete: string[] = [];
			for (const id of initialSceneIdsRef.current) {
				if (!surviving.has(id)) toDelete.push(id);
			}
			if (toDelete.length > 0) {
				const { error } = await supabase
					.from("scenes")
					.delete()
					.in("id", toDelete);
				if (error) throw error;
			}

			// 4. 기준선 갱신
			initialSceneIdsRef.current = new Set([...surviving]);

			const msg = [
				`업데이트 ${plan.update.length}`,
				inserted > 0 ? `신규 ${inserted}` : null,
				toDelete.length > 0 ? `삭제 ${toDelete.length}` : null,
			]
				.filter(Boolean)
				.join(" · ");
			setMessage(`저장 완료 — ${msg}`);
		} catch (e) {
			setMessage(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setSaving(false);
		}
	}, [toSceneRecords, liveSceneIds, initialSceneIdsRef]);

	return { saving, message, handleSave };
}
