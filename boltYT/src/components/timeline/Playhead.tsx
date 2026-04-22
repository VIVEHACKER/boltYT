/**
 * Playhead — 현재 재생 위치 표시 + 드래그로 scrub.
 *
 * props 로 playhead/setPlayhead 를 받으면 해당 값을 사용하고,
 * 없으면 기존 editor-store(v1)에서 읽어온다.
 */

import { useCallback, useState } from "react";
import { useEditorStore } from "../../lib/editor-store";

interface Props {
	zoom: number;
	totalFrames: number;
	playhead?: number;
	setPlayhead?: (frame: number) => void;
}

export function Playhead({
	zoom,
	totalFrames,
	playhead: playheadProp,
	setPlayhead: setPlayheadProp,
}: Props) {
	const playheadStore = useEditorStore((s) => s.playhead);
	const setPlayheadStore = useEditorStore((s) => s.setPlayhead);
	const playhead = playheadProp ?? playheadStore;
	const setPlayhead = setPlayheadProp ?? setPlayheadStore;
	const [dragging, setDragging] = useState(false);

	const leftPx = playhead * zoom;

	const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		e.currentTarget.setPointerCapture(e.pointerId);
		setDragging(true);
	}, []);

	const onPointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!dragging) return;
			const track = e.currentTarget.parentElement;
			if (!track) return;
			const rect = track.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const frame = Math.max(0, Math.min(totalFrames, Math.round(px / zoom)));
			setPlayhead(frame);
		},
		[dragging, zoom, totalFrames, setPlayhead],
	);

	const onPointerUp = useCallback(() => setDragging(false), []);

	return (
		<div
			role="slider"
			aria-label="Playhead"
			aria-valuenow={playhead}
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			style={{
				position: "absolute",
				left: leftPx - 8,
				top: 0,
				bottom: 0,
				width: 16,
				cursor: "ew-resize",
				zIndex: 50,
				pointerEvents: "auto",
			}}
		>
			<div
				style={{
					position: "absolute",
					left: 7,
					top: 0,
					bottom: 0,
					width: 2,
					background: "#ff3b30",
					boxShadow: "0 0 8px rgba(255,59,48,0.8)",
					pointerEvents: "none",
				}}
			/>
			<div
				style={{
					position: "absolute",
					left: 0,
					top: 0,
					width: 16,
					height: 16,
					background: "#ff3b30",
					clipPath: "polygon(0 0, 100% 0, 50% 100%)",
					boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
					pointerEvents: "none",
				}}
			/>
		</div>
	);
}
