/**
 * TrackV2 — 단일 트랙 렌더 + 클립 배치 + 트랙 레벨 컨트롤.
 */

import type React from "react";
import { Lock, Unlock, Volume2, VolumeX } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { TimelineClip, TimelineTrack } from "../../lib/timeline-model";
import { clipsOnTrack } from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";
import { ClipV2 } from "./ClipV2";
import { VolumeEnvelope } from "./VolumeEnvelope";
import { Waveform } from "./Waveform";

interface Props {
	track: TimelineTrack;
	zoom: number;
	totalFrames: number;
	onClipDoubleClick?: (clip: TimelineClip) => void;
}

export function TrackV2({
	track,
	zoom,
	totalFrames,
	onClipDoubleClick,
}: Props) {
	const project = useTimelineStore((s) => s.project);
	const setPlayhead = useTimelineStore((s) => s.setPlayhead);
	const selectInRange = useTimelineStore((s) => s.selectInRange);
	const clearSelection = useTimelineStore((s) => s.clearSelection);
	const updateTrack = useTimelineStore((s) => s.updateTrack);
	const rubberBand = useTimelineStore((s) => s.rubberBand);
	const setRubberBand = useTimelineStore((s) => s.setRubberBand);

	const lanesRef = useRef<HTMLButtonElement>(null);
	const [rubberStart, setRubberStart] = useState<number | null>(null);

	const clips = project ? clipsOnTrack(project, track.id) : [];

	const onPointerDownLane = useCallback(
		(e: React.PointerEvent<HTMLButtonElement>) => {
			if (!lanesRef.current) return;
			const rect = lanesRef.current.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const frame = Math.max(0, Math.min(totalFrames, Math.round(px / zoom)));
			// Empty area → start rubber-band or move playhead
			if ((e.target as HTMLElement).closest("[data-clip]")) return;
			if (e.shiftKey) {
				setRubberStart(frame);
				setRubberBand({ startFrame: frame, endFrame: frame });
			} else {
				setPlayhead(frame);
				clearSelection();
			}
		},
		[zoom, totalFrames, setPlayhead, setRubberBand, clearSelection],
	);

	const onPointerMoveLane = useCallback(
		(e: React.PointerEvent<HTMLButtonElement>) => {
			if (rubberStart === null || !lanesRef.current) return;
			const rect = lanesRef.current.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const frame = Math.max(0, Math.round(px / zoom));
			setRubberBand({
				startFrame: Math.min(rubberStart, frame),
				endFrame: Math.max(rubberStart, frame),
			});
		},
		[rubberStart, zoom, setRubberBand],
	);

	const onPointerUpLane = useCallback(() => {
		if (rubberStart !== null && rubberBand) {
			selectInRange(rubberBand.startFrame, rubberBand.endFrame, track.id);
		}
		setRubberStart(null);
		setRubberBand(null);
	}, [rubberStart, rubberBand, selectInRange, setRubberBand, track.id]);

	return (
		<div
			style={{
				display: "flex",
				borderBottom: "1px solid #2a2a2a",
				background: track.locked ? "rgba(255,255,0,0.03)" : "transparent",
			}}
		>
			{/* 트랙 헤더 */}
			<div
				style={{
					width: 140,
					minWidth: 140,
					height: track.height,
					background: "#1a1a1a",
					borderRight: "1px solid #2a2a2a",
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					padding: "4px 10px",
					gap: 4,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						fontSize: 10,
						fontWeight: 700,
						color: "rgba(255,255,255,0.8)",
						textTransform: "uppercase",
						letterSpacing: "0.05em",
					}}
				>
					<span>{track.name}</span>
					<div style={{ display: "flex", gap: 4 }}>
						<button
							type="button"
							onClick={() => updateTrack(track.id, { muted: !track.muted })}
							title={track.muted ? "Unmute" : "Mute"}
							style={{
								background: "none",
								border: "none",
								color: track.muted
									? "rgba(239,68,68,0.9)"
									: "rgba(255,255,255,0.5)",
								cursor: "pointer",
								padding: 0,
							}}
						>
							{track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
						</button>
						{track.kind === "audio" && (
							<button
								type="button"
								onClick={() => updateTrack(track.id, { solo: !track.solo })}
								title="Solo"
								style={{
									background: track.solo
										? "rgba(234,179,8,0.25)"
										: "transparent",
									border: "none",
									color: track.solo
										? "rgba(250,204,21,0.95)"
										: "rgba(255,255,255,0.5)",
									cursor: "pointer",
									padding: "0 4px",
									borderRadius: 2,
									fontSize: 9,
									fontWeight: 700,
								}}
							>
								S
							</button>
						)}
						<button
							type="button"
							onClick={() => updateTrack(track.id, { locked: !track.locked })}
							title={track.locked ? "Unlock" : "Lock"}
							style={{
								background: "none",
								border: "none",
								color: track.locked
									? "rgba(234,179,8,0.9)"
									: "rgba(255,255,255,0.4)",
								cursor: "pointer",
								padding: 0,
							}}
						>
							{track.locked ? <Lock size={11} /> : <Unlock size={11} />}
						</button>
					</div>
				</div>

				{/* 볼륨 슬라이더 (audio) */}
				{track.kind === "audio" && (
					<input
						type="range"
						min={0}
						max={1.5}
						step={0.01}
						value={track.volume}
						onChange={(e) =>
							updateTrack(track.id, { volume: Number(e.target.value) })
						}
						style={{ width: "100%", height: 4 }}
					/>
				)}
			</div>

			{/* 클립 레인 */}
			<button
				ref={lanesRef}
				type="button"
				onPointerDown={onPointerDownLane}
				onPointerMove={onPointerMoveLane}
				onPointerUp={onPointerUpLane}
				style={{
					position: "relative",
					flex: 1,
					height: track.height,
					width: Math.max(200, totalFrames * zoom),
					background: "#0f0f0f",
					cursor: "default",
					padding: 0,
					border: "none",
					textAlign: "left",
				}}
			>
				{clips.map((c) => (
					<div key={c.id} data-clip={c.id}>
						{track.kind === "audio" && c.audioUrl && (
							<div
								style={{
									position: "absolute",
									left: c.startFrame * zoom,
									top: 4,
									width: c.durationFrames * zoom,
									height: track.height - 8,
									opacity: 0.65,
									pointerEvents: "none",
									borderRadius: 2,
									overflow: "hidden",
								}}
							>
								<Waveform
									audioUrl={c.audioUrl}
									widthPx={c.durationFrames * zoom}
									height={track.height - 8}
									color="rgba(134, 239, 172, 0.85)"
								/>
							</div>
						)}
						<ClipV2 clip={c} zoom={zoom} onDoubleClick={onClipDoubleClick} />
						{track.kind === "audio" &&
							c.audioUrl &&
							(c.selected || c.volumeEnvelope) && (
								<div
									style={{
										position: "absolute",
										left: c.startFrame * zoom,
										top: 4,
										width: c.durationFrames * zoom,
										height: track.height - 8,
										pointerEvents: c.selected ? "auto" : "none",
										opacity: c.selected ? 1 : 0.55,
									}}
								>
									<VolumeEnvelope
										clip={c}
										zoom={zoom}
										height={track.height - 8}
									/>
								</div>
							)}
					</div>
				))}

				{/* 러버밴드 오버레이 (이 트랙 대상일 때만) */}
				{rubberBand && (
					<div
						style={{
							position: "absolute",
							left: rubberBand.startFrame * zoom,
							top: 0,
							width: (rubberBand.endFrame - rubberBand.startFrame) * zoom,
							height: track.height,
							background: "rgba(99,102,241,0.15)",
							border: "1px dashed rgba(99,102,241,0.6)",
							pointerEvents: "none",
						}}
					/>
				)}
			</button>
		</div>
	);
}
