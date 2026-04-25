/**
 * useTimelineLoad — 스크립트 ID로 씬/에셋/BGM을 로드하고 타임라인 스토어에 주입.
 */

import { useEffect, useRef, useState } from "react";
import type { TimelineScene } from "../lib/editor-store";
import { ensureBlobUrls } from "../lib/local-db";
import { supabase } from "../lib/supabase";
import { useTimelineStore } from "../lib/timeline-store";
import {
	SHORTS_HEIGHT,
	SHORTS_WIDTH,
	VIDEO_FPS,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
} from "../remotion/types";

const FPS = VIDEO_FPS;

export interface TimelineLoadResult {
	loading: boolean;
	isShorts: boolean;
	initialSceneIdsRef: React.MutableRefObject<Set<string>>;
}

export function useTimelineLoad(scriptId: string): TimelineLoadResult {
	const loadFromScenes = useTimelineStore((s) => s.loadFromScenes);
	const [loading, setLoading] = useState(true);
	const [isShorts, setIsShorts] = useState(true);
	const initialSceneIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (!scriptId) return;

		void (async () => {
			setLoading(true);
			const [scenesRes, scriptRes] = await Promise.all([
				supabase
					.from("scenes")
					.select("*")
					.eq("script_id", scriptId)
					.order("order_index"),
				supabase
					.from("scripts")
					.select("format")
					.eq("id", scriptId)
					.maybeSingle(),
			]);

			const raw = scenesRes.data ?? [];
			const { data: assets } = await supabase
				.from("media_assets")
				.select("scene_id, storage_path, status, type")
				.in(
					"scene_id",
					raw.map((s) => s.id),
				)
				.eq("status", "complete");

			const paths = (assets ?? [])
				.map((a) => (a as { storage_path: string }).storage_path)
				.filter((p: string) => p?.startsWith("scenes/"));
			const blobMap = await ensureBlobUrls(paths);

			const withAssets: TimelineScene[] = raw.map((s) => {
				const pathOfType = (t: string) =>
					(assets ?? []).find(
						(a) =>
							a.scene_id === s.id && a.type === t && a.status === "complete",
					) as { storage_path?: string } | undefined;
				const audioP = pathOfType("tts_audio")?.storage_path;
				const imageP = pathOfType("image")?.storage_path;
				const videoP = pathOfType("video")?.storage_path;
				return {
					...s,
					audioUrl: audioP ? blobMap.get(audioP) : undefined,
					imageUrl: imageP ? blobMap.get(imageP) : undefined,
					videoUrl: videoP ? blobMap.get(videoP) : undefined,
				} as TimelineScene;
			});

			const format = Boolean(
				scriptRes.data &&
					(scriptRes.data as { format?: string }).format === "shorts",
			);
			setIsShorts(format);

			let bpm = 0;
			let beats: number[] = [];
			const bgmAnalysis = localStorage.getItem(`bgm_analysis_${scriptId}`);
			if (bgmAnalysis) {
				try {
					const parsed = JSON.parse(bgmAnalysis) as {
						bpm: number;
						beats: number[];
					};
					bpm = parsed.bpm;
					beats = parsed.beats;
				} catch {
					/* ignore */
				}
			}
			const bgmUrl = localStorage.getItem(`bgm_url_${scriptId}`) ?? undefined;

			initialSceneIdsRef.current = new Set(
				withAssets.map((s) => s.id).filter(Boolean),
			);

			loadFromScenes(withAssets, {
				scriptId,
				fps: FPS,
				width: format ? SHORTS_WIDTH : VIDEO_WIDTH,
				height: format ? SHORTS_HEIGHT : VIDEO_HEIGHT,
				bpm,
				beats,
				bgmUrl,
			});
			setLoading(false);
		})();
	}, [scriptId, loadFromScenes]);

	return { loading, isShorts, initialSceneIdsRef };
}
