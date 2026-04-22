/**
 * 타임라인 Clip — 드래그 가능한 씬 박스.
 * 좌우 핸들로 start/end 프레임 조정.
 */

import type React from "react";
import { useCallback, useRef, useState } from "react";
import { type TimelineScene, useEditorStore } from "../../lib/editor-store";

interface Props {
	scene: TimelineScene;
	startFrame: number;
	zoom: number;
}

export function Clip({ scene, startFrame, zoom }: Props) {
	const selected = useEditorStore((s) => s.selectedSceneId === scene.id);
	const setSelected = useEditorStore((s) => s.setSelected);
	const updateScene = useEditorStore((s) => s.updateScene);
	const deleteScene = useEditorStore((s) => s.deleteScene);

	const durationFrames = Math.ceil(scene.duration_seconds * 30);
	const widthPx = durationFrames * zoom;
	const leftPx = startFrame * zoom;

	const [dragState, setDragState] = useState<null | {
		mode: "resize-right" | "move";
		startX: number;
		startValue: number;
	}>(null);

	const clipRef = useRef<HTMLDivElement>(null);

	const onPointerDown = useCallback(
		(mode: "resize-right" | "move") =>
			(e: React.PointerEvent<HTMLDivElement>) => {
				e.stopPropagation();
				e.currentTarget.setPointerCapture(e.pointerId);
				setSelected(scene.id);
				setDragState({
					mode,
					startX: e.clientX,
					startValue: mode === "resize-right" ? durationFrames : startFrame,
				});
			},
		[scene.id, durationFrames, startFrame, setSelected],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!dragState) return;
			const dx = e.clientX - dragState.startX;
			const dFrames = Math.round(dx / zoom);

			if (dragState.mode === "resize-right") {
				const newFrames = Math.max(15, dragState.startValue + dFrames);
				updateScene(scene.id, {
					duration_seconds: Number((newFrames / 30).toFixed(2)),
				});
			}
			// move는 전체 타임라인 재정렬 필요 — 단순 start_frame만 변경
			if (dragState.mode === "move") {
				const newStart = Math.max(0, dragState.startValue + dFrames);
				updateScene(scene.id, { start_frame: newStart });
			}
		},
		[dragState, zoom, scene.id, updateScene],
	);

	const onPointerUp = useCallback(() => {
		setDragState(null);
	}, []);

	const sceneTypeColor: Record<string, string> = {
		image: "#3b82f6",
		video: "#a855f7",
		text_emphasis: "#f59e0b",
		news_overlay: "#e63946",
	};
	const color = sceneTypeColor[scene.scene_type as string] ?? "#6b7280";

	return (
		// biome-ignore lint/a11y/useSemanticElements: nested slider handle (resize) cannot be inside a <button>
		<div
			ref={clipRef}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === "Delete" || e.key === "Backspace") {
					deleteScene(scene.id);
				}
			}}
			onPointerDown={onPointerDown("move")}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			style={{
				position: "absolute",
				left: leftPx,
				top: 4,
				width: widthPx,
				height: "calc(100% - 8px)",
				background: `linear-gradient(180deg, ${color}dd, ${color}99)`,
				border: selected ? "2px solid #fff" : "1px solid rgba(255,255,255,0.2)",
				borderRadius: 4,
				cursor: dragState?.mode === "move" ? "grabbing" : "grab",
				overflow: "hidden",
				boxShadow: selected ? "0 0 12px rgba(255,255,255,0.3)" : "none",
				display: "flex",
				alignItems: "center",
				padding: "0 8px",
				userSelect: "none",
			}}
		>
			<span
				style={{
					color: "#fff",
					fontSize: 11,
					fontWeight: 600,
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
					textShadow: "0 1px 2px rgba(0,0,0,0.7)",
				}}
			>
				{scene.narration_text.slice(0, 40)}
			</span>

			{/* 오른쪽 리사이즈 핸들 */}
			<div
				role="slider"
				tabIndex={-1}
				aria-label="Resize clip"
				aria-valuenow={durationFrames}
				onPointerDown={onPointerDown("resize-right")}
				style={{
					position: "absolute",
					right: 0,
					top: 0,
					bottom: 0,
					width: 6,
					cursor: "ew-resize",
					background: selected ? "rgba(255,255,255,0.6)" : "transparent",
				}}
			/>
		</div>
	);
}
