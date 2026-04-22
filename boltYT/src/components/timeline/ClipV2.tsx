/**
 * ClipV2 — 프레임 기반 타임라인 클립 (V2 store 연동).
 *
 * 기능:
 *   - 좌/우 트림 핸들 (sourceIn / sourceOut 변경)
 *   - 드래그 이동 (snap 적용)
 *   - 드래그 중 shift 키 → slip 편집
 *   - 드래그 중 alt 키 → slide 편집
 *   - 클릭: 선택 (shift 시 추가 선택)
 *   - 더블클릭: 인스펙터 (부모가 처리)
 */

import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { compileColorGraphToCss } from "../../lib/color-graph-css";
import type { TimelineClip } from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";

interface Props {
	clip: TimelineClip;
	zoom: number;
	onDoubleClick?: (clip: TimelineClip) => void;
}

type DragMode = "move" | "trim-left" | "trim-right" | "slip" | "slide";

const KIND_COLORS: Record<
	string,
	{ bg: string; border: string; text: string }
> = {
	video: {
		bg: "linear-gradient(180deg, #a855f7dd, #a855f799)",
		border: "rgba(168,85,247,0.6)",
		text: "#fff",
	},
	image: {
		bg: "linear-gradient(180deg, #3b82f6dd, #3b82f699)",
		border: "rgba(59,130,246,0.6)",
		text: "#fff",
	},
	audio: {
		bg: "linear-gradient(180deg, #10b981cc, #10b98177)",
		border: "rgba(16,185,129,0.5)",
		text: "#e6fff5",
	},
	caption: {
		bg: "rgba(255,255,255,0.08)",
		border: "rgba(255,255,255,0.25)",
		text: "rgba(255,255,255,0.85)",
	},
	title: {
		bg: "linear-gradient(180deg, #f59e0bcc, #f59e0b77)",
		border: "rgba(245,158,11,0.6)",
		text: "#fff",
	},
	bgm: {
		bg: "linear-gradient(180deg, #6366f1cc, #6366f177)",
		border: "rgba(99,102,241,0.6)",
		text: "#e0e7ff",
	},
};

function clipColor(clip: TimelineClip): (typeof KIND_COLORS)[string] {
	const sceneType = clip.meta.scene_type as string | undefined;
	if (clip.kind === "video" && sceneType === "image") return KIND_COLORS.image;
	return KIND_COLORS[clip.kind] ?? KIND_COLORS.video;
}

export function ClipV2({ clip, zoom, onDoubleClick }: Props) {
	const moveClip = useTimelineStore((s) => s.moveClip);
	const trimLeft = useTimelineStore((s) => s.trimLeft);
	const trimRight = useTimelineStore((s) => s.trimRight);
	const slipClip = useTimelineStore((s) => s.slipClip);
	const slideClip = useTimelineStore((s) => s.slideClip);
	const select = useTimelineStore((s) => s.select);
	const clearSelection = useTimelineStore((s) => s.clearSelection);

	const ref = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<null | {
		mode: DragMode;
		startX: number;
		snapshot: {
			startFrame: number;
			durationFrames: number;
			sourceIn: number;
			sourceOut: number;
		};
	}>(null);

	const widthPx = clip.durationFrames * zoom;
	const leftPx = clip.startFrame * zoom;
	const colors = clipColor(clip);

	const beginDrag = useCallback(
		(mode: DragMode) => (e: React.PointerEvent<HTMLDivElement>) => {
			e.stopPropagation();
			e.currentTarget.setPointerCapture(e.pointerId);
			setDrag({
				mode,
				startX: e.clientX,
				snapshot: {
					startFrame: clip.startFrame,
					durationFrames: clip.durationFrames,
					sourceIn: clip.sourceIn,
					sourceOut: clip.sourceOut,
				},
			});
		},
		[clip.startFrame, clip.durationFrames, clip.sourceIn, clip.sourceOut],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!drag) return;
			const dx = e.clientX - drag.startX;
			const dFrames = Math.round(dx / zoom);

			// Modifiers change mode on the fly
			let mode = drag.mode;
			if (mode === "move" && e.shiftKey) mode = "slip";
			else if (mode === "move" && e.altKey) mode = "slide";

			switch (mode) {
				case "move": {
					const target = drag.snapshot.startFrame + dFrames;
					moveClip(clip.id, target);
					break;
				}
				case "trim-left": {
					const actualClip = useTimelineStore
						.getState()
						.project?.clips.find((c) => c.id === clip.id);
					if (!actualClip) break;
					const delta =
						drag.snapshot.startFrame + dFrames - actualClip.startFrame;
					if (delta !== 0) trimLeft(clip.id, delta);
					break;
				}
				case "trim-right": {
					const actualClip = useTimelineStore
						.getState()
						.project?.clips.find((c) => c.id === clip.id);
					if (!actualClip) break;
					const target = drag.snapshot.durationFrames + dFrames;
					const delta = target - actualClip.durationFrames;
					if (delta !== 0) trimRight(clip.id, delta);
					break;
				}
				case "slip": {
					slipClip(clip.id, -dFrames);
					// reset snapshot so we apply incrementally
					setDrag({
						...drag,
						startX: e.clientX,
					});
					break;
				}
				case "slide": {
					slideClip(clip.id, dFrames);
					setDrag({
						...drag,
						startX: e.clientX,
					});
					break;
				}
			}
		},
		[drag, zoom, clip.id, moveClip, trimLeft, trimRight, slipClip, slideClip],
	);

	const onPointerUp = useCallback(() => setDrag(null), []);

	const onClick = useCallback(
		(e: React.MouseEvent) => {
			if (drag) return;
			if (!e.shiftKey) clearSelection();
			select(clip.id, e.shiftKey);
		},
		[clip.id, drag, select, clearSelection],
	);

	const label =
		clip.label ?? clip.narration?.slice(0, 40) ?? clip.text?.slice(0, 40) ?? "";

	const thumbnailUrl =
		clip.kind === "video" ? clip.imageUrl || clip.videoUrl : undefined;

	const colorFilter = useMemo(
		() =>
			clip.colorGraph ? compileColorGraphToCss(clip.colorGraph).css : undefined,
		[clip.colorGraph],
	);

	return (
		// biome-ignore lint/a11y/useSemanticElements: nested slider handles inside
		<div
			ref={ref}
			role="button"
			tabIndex={0}
			onPointerDown={beginDrag("move")}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onClick={onClick}
			onDoubleClick={() => onDoubleClick?.(clip)}
			onKeyDown={(e) => {
				if (e.key === "Enter") select(clip.id, e.shiftKey);
			}}
			style={{
				position: "absolute",
				left: leftPx,
				top: 4,
				width: Math.max(8, widthPx),
				height: "calc(100% - 8px)",
				background: colors.bg,
				border: clip.selected ? "2px solid #fff" : `1px solid ${colors.border}`,
				borderRadius: 4,
				cursor: drag?.mode === "move" ? "grabbing" : "grab",
				overflow: "hidden",
				boxShadow: clip.selected
					? "0 0 12px rgba(255,255,255,0.35)"
					: clip.locked
						? "inset 0 0 0 1px rgba(255,255,0,0.3)"
						: "none",
				display: "flex",
				alignItems: "center",
				padding: "0 8px",
				userSelect: "none",
				opacity: clip.muted ? 0.45 : 1,
			}}
		>
			{/* 이미지 썸네일 배경 (video 클립만) */}
			{thumbnailUrl && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						backgroundImage: `url(${thumbnailUrl})`,
						backgroundSize: "cover",
						backgroundPosition: "center",
						opacity: 0.32,
						filter: colorFilter ?? undefined,
						pointerEvents: "none",
					}}
				/>
			)}

			{/* 왼쪽 트림 핸들 */}
			<div
				role="slider"
				tabIndex={-1}
				aria-label="Trim left"
				aria-valuenow={clip.sourceIn}
				onPointerDown={beginDrag("trim-left")}
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					bottom: 0,
					width: 6,
					cursor: "ew-resize",
					background: clip.selected ? "rgba(255,255,255,0.6)" : "transparent",
				}}
			/>

			<span
				style={{
					color: colors.text,
					fontSize: 11,
					fontWeight: 600,
					whiteSpace: "nowrap",
					overflow: "hidden",
					textOverflow: "ellipsis",
					textShadow: "0 1px 2px rgba(0,0,0,0.7)",
					flex: 1,
					paddingLeft: 8,
					paddingRight: 8,
				}}
			>
				{label}
			</span>

			{/* 속도 배지 */}
			{clip.speed !== 1 && (
				<span
					style={{
						fontSize: 9,
						padding: "1px 4px",
						background: "rgba(0,0,0,0.5)",
						borderRadius: 2,
						color: "#ffd",
						marginRight: 4,
					}}
				>
					{clip.speed}x
				</span>
			)}

			{/* 트랜지션 인디케이터 */}
			{clip.transitionIn && clip.transitionIn.frames > 0 && (
				<div
					style={{
						position: "absolute",
						left: 0,
						top: 0,
						bottom: 0,
						width: clip.transitionIn.frames * zoom,
						background:
							"linear-gradient(90deg, rgba(255,255,255,0.25), transparent)",
						pointerEvents: "none",
					}}
				/>
			)}

			{/* 오른쪽 트림 핸들 */}
			<div
				role="slider"
				tabIndex={-1}
				aria-label="Trim right"
				aria-valuenow={clip.sourceOut}
				onPointerDown={beginDrag("trim-right")}
				style={{
					position: "absolute",
					right: 0,
					top: 0,
					bottom: 0,
					width: 6,
					cursor: "ew-resize",
					background: clip.selected ? "rgba(255,255,255,0.6)" : "transparent",
				}}
			/>
		</div>
	);
}
