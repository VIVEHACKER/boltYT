/**
 * TimelineV2 — 전체 타임라인 패널 (ruler + tracks + playhead + beat grid).
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TimelineClip } from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";
import { BeatGrid } from "./BeatGrid";
import { Playhead } from "./Playhead";
import { Ruler } from "./Ruler";
import { TrackV2 } from "./TrackV2";

const FPS = 30;
const HEADER_WIDTH = 140;

interface Props {
	onClipDoubleClick?: (clip: TimelineClip) => void;
}

export function TimelineV2({ onClipDoubleClick }: Props) {
	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);
	const zoom = useTimelineStore((s) => s.zoom);
	const snap = useTimelineStore((s) => s.snap);
	const setSnap = useTimelineStore((s) => s.setSnap);
	const setPlayhead = useTimelineStore((s) => s.setPlayhead);
	const totalFrames = useTimelineStore((s) => s.totalFrames());

	const undo = useTimelineStore((s) => s.undo);
	const redo = useTimelineStore((s) => s.redo);
	const splitSelectedAtPlayhead = useTimelineStore(
		(s) => s.splitSelectedAtPlayhead,
	);
	const rippleDeleteSelected = useTimelineStore((s) => s.rippleDeleteSelected);
	const deleteSelected = useTimelineStore((s) => s.deleteSelected);
	const selectAll = useTimelineStore((s) => s.selectAll);
	const clearSelection = useTimelineStore((s) => s.clearSelection);
	const moveSelection = useTimelineStore((s) => s.moveSelection);

	const selectedFn = useTimelineStore((s) => s.selected);
	const createMulticamGroupFromClips = useTimelineStore(
		(s) => s.createMulticamGroupFromClips,
	);
	const disbandMulticamGroup = useTimelineStore((s) => s.disbandMulticamGroup);

	// 선택된 video 클립 기반 멀티캠 툴바 상태
	const multicamToolbar = useMemo(() => {
		const sel = selectedFn().filter((c) => c.kind === "video");
		if (sel.length < 2) return null;
		const grouped = sel.filter((c) => c.multicam?.groupId);
		const groupId = grouped[0]?.multicam?.groupId;
		if (grouped.length > 0 && groupId) {
			return { mode: "disband" as const, groupId };
		}
		return { mode: "create" as const, clipIds: sel.map((c) => c.id) };
	}, [selectedFn]);

	const scrollRef = useRef<HTMLDivElement>(null);
	const sortedTracks = useMemo(
		() =>
			project ? [...project.tracks].sort((a, b) => a.order - b.order) : [],
		[project],
	);

	// 전역 단축키
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable
			) {
				return;
			}
			const meta = e.metaKey || e.ctrlKey;
			if (meta && e.key === "z") {
				e.preventDefault();
				if (e.shiftKey) redo();
				else undo();
			} else if (meta && e.key === "a") {
				e.preventDefault();
				selectAll();
			} else if (e.key === "Escape") {
				clearSelection();
			} else if (e.key === "s" && !meta) {
				e.preventDefault();
				splitSelectedAtPlayhead();
			} else if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				if (e.shiftKey) rippleDeleteSelected();
				else deleteSelected();
			} else if (e.key === "ArrowLeft") {
				e.preventDefault();
				if (e.shiftKey) moveSelection(-1);
				else setPlayhead(playhead - (e.altKey ? 1 : FPS));
			} else if (e.key === "ArrowRight") {
				e.preventDefault();
				if (e.shiftKey) moveSelection(1);
				else setPlayhead(playhead + (e.altKey ? 1 : FPS));
			} else if (e.key === "m") {
				// toggle magnetic snap
				setSnap({ enabled: !snap.enabled });
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		undo,
		redo,
		selectAll,
		clearSelection,
		splitSelectedAtPlayhead,
		deleteSelected,
		rippleDeleteSelected,
		moveSelection,
		setPlayhead,
		setSnap,
		snap.enabled,
		playhead,
	]);

	const onRulerClick = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const rect = e.currentTarget.getBoundingClientRect();
			const px = e.clientX - rect.left;
			setPlayhead(Math.max(0, Math.round(px / zoom)));
		},
		[zoom, setPlayhead],
	);

	if (!project) {
		return (
			<div style={{ color: "#888", padding: 16 }}>타임라인이 비어있습니다.</div>
		);
	}

	const canvasWidth = Math.max(200, totalFrames * zoom + 100);

	return (
		<div
			ref={scrollRef}
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "auto",
				background: "#0a0a0a",
			}}
		>
			{/* 멀티캠 툴바 — 2+ 비디오 선택 시 노출 */}
			{multicamToolbar && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						padding: "4px 10px",
						background: "#111",
						borderBottom: "1px solid #2a2a2a",
					}}
				>
					{multicamToolbar.mode === "create" ? (
						<button
							type="button"
							onClick={() =>
								createMulticamGroupFromClips(multicamToolbar.clipIds)
							}
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "#86efac",
								background: "rgba(134,239,172,0.1)",
								border: "1px solid rgba(134,239,172,0.3)",
								borderRadius: 4,
								padding: "2px 10px",
								cursor: "pointer",
							}}
						>
							⊞ Create Multicam Group
						</button>
					) : (
						<button
							type="button"
							onClick={() => disbandMulticamGroup(multicamToolbar.groupId)}
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "#fca5a5",
								background: "rgba(252,165,165,0.1)",
								border: "1px solid rgba(252,165,165,0.3)",
								borderRadius: 4,
								padding: "2px 10px",
								cursor: "pointer",
							}}
						>
							⊟ Disband Group
						</button>
					)}
					<span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
						{multicamToolbar.mode === "create"
							? `${multicamToolbar.clipIds.length} clips selected`
							: "group selected"}
					</span>
				</div>
			)}

			<div
				style={{ position: "relative", minWidth: canvasWidth + HEADER_WIDTH }}
			>
				{/* Ruler */}
				<div style={{ display: "flex" }}>
					<div
						style={{
							width: HEADER_WIDTH,
							minWidth: HEADER_WIDTH,
							height: 24,
							background: "#1a1a1a",
							borderRight: "1px solid #2a2a2a",
							borderBottom: "1px solid #2a2a2a",
							display: "flex",
							alignItems: "center",
							justifyContent: "flex-end",
							padding: "0 10px",
							fontSize: 10,
							color: snap.enabled
								? "rgba(134,239,172,0.85)"
								: "rgba(255,255,255,0.4)",
							fontWeight: 600,
						}}
					>
						{snap.enabled ? "⊞ SNAP" : "○ snap"}
					</div>
					<button
						type="button"
						onClick={onRulerClick}
						style={{
							position: "relative",
							flex: 1,
							padding: 0,
							border: "none",
							background: "transparent",
							cursor: "pointer",
							textAlign: "left",
						}}
					>
						<Ruler zoom={zoom} fps={FPS} totalFrames={totalFrames} />
					</button>
				</div>

				{/* Tracks */}
				<div style={{ position: "relative" }}>
					{sortedTracks.map((t) => (
						<TrackV2
							key={t.id}
							track={t}
							zoom={zoom}
							totalFrames={totalFrames}
							onClipDoubleClick={onClipDoubleClick}
						/>
					))}

					{/* Beat Grid + Playhead 오버레이 */}
					<div
						style={{
							position: "absolute",
							left: HEADER_WIDTH,
							top: 0,
							bottom: 0,
							width: totalFrames * zoom,
							pointerEvents: "none",
						}}
					>
						<BeatGrid
							bpm={project.bpm}
							beats={project.beats}
							zoom={zoom}
							fps={FPS}
							totalFrames={totalFrames}
						/>
						<Playhead
							zoom={zoom}
							totalFrames={totalFrames}
							playhead={playhead}
							setPlayhead={setPlayhead}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
