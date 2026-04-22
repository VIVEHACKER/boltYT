/**
 * Track — 트랙 레이블 + Clip 들 + Waveform 등.
 * scrollLeft 동기화, 클릭 시 플레이헤드 이동.
 */

import type React from "react";
import { useCallback } from "react";
import { useEditorStore } from "../../lib/editor-store";
import { Clip } from "./Clip";
import { Waveform } from "./Waveform";

interface Props {
	label: string;
	type: "video" | "audio" | "caption";
	height: number;
	zoom: number;
	totalFrames: number;
}

export function Track({ label, type, height, zoom, totalFrames }: Props) {
	const scenes = useEditorStore((s) => s.scenes);
	const setPlayhead = useEditorStore((s) => s.setPlayhead);

	// 씬 시작 프레임을 순차 계산 (start_frame 없으면 누적)
	let running = 0;
	const startFrames: number[] = [];
	for (const s of scenes) {
		const explicit = (s.start_frame as number | undefined) ?? null;
		const f = explicit !== null && explicit > 0 ? explicit : running;
		startFrames.push(f);
		running = f + Math.ceil(s.duration_seconds * 30);
	}

	const onClickTrack = useCallback(
		(e: React.MouseEvent<HTMLButtonElement>) => {
			const rect = e.currentTarget.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const frame = Math.max(0, Math.min(totalFrames, Math.round(px / zoom)));
			setPlayhead(frame);
		},
		[zoom, totalFrames, setPlayhead],
	);

	return (
		<div style={{ display: "flex", borderBottom: "1px solid #2a2a2a" }}>
			{/* 레이블 */}
			<div
				style={{
					width: 100,
					minWidth: 100,
					height,
					background: "#1a1a1a",
					borderRight: "1px solid #2a2a2a",
					display: "flex",
					alignItems: "center",
					padding: "0 12px",
					fontSize: 11,
					fontWeight: 600,
					color: "rgba(255,255,255,0.7)",
					textTransform: "uppercase",
					letterSpacing: "0.05em",
				}}
			>
				{label}
			</div>

			{/* 클립 영역 */}
			<button
				type="button"
				onClick={onClickTrack}
				style={{
					position: "relative",
					flex: 1,
					height,
					width: totalFrames * zoom,
					background: "#0f0f0f",
					cursor: "pointer",
					padding: 0,
					border: "none",
					textAlign: "left",
				}}
			>
				{type === "video" &&
					scenes.map((s, i) => (
						<Clip
							key={s.id}
							scene={s}
							startFrame={startFrames[i]}
							zoom={zoom}
						/>
					))}

				{type === "audio" &&
					scenes.map((s, i) => {
						if (!s.audioUrl) return null;
						const durationFrames = Math.ceil(s.duration_seconds * 30);
						const widthPx = durationFrames * zoom;
						return (
							<div
								key={`audio-${s.id}`}
								style={{
									position: "absolute",
									left: startFrames[i] * zoom,
									top: 4,
									width: widthPx,
									height: height - 8,
									borderRadius: 2,
									overflow: "hidden",
									opacity: 0.85,
								}}
							>
								<Waveform
									audioUrl={s.audioUrl}
									widthPx={widthPx}
									height={height - 8}
									color="rgba(100, 220, 255, 0.85)"
								/>
							</div>
						);
					})}

				{type === "caption" &&
					scenes.map((s, i) => {
						const durationFrames = Math.ceil(s.duration_seconds * 30);
						return (
							<div
								key={`cap-${s.id}`}
								style={{
									position: "absolute",
									left: startFrames[i] * zoom,
									top: 4,
									width: durationFrames * zoom,
									height: height - 8,
									background: "rgba(255, 255, 255, 0.08)",
									border: "1px solid rgba(255,255,255,0.15)",
									borderRadius: 2,
									padding: "2px 6px",
									fontSize: 10,
									color: "rgba(255,255,255,0.6)",
									whiteSpace: "nowrap",
									overflow: "hidden",
									textOverflow: "ellipsis",
								}}
							>
								{s.narration_text.slice(0, 60)}
							</div>
						);
					})}
			</button>
		</div>
	);
}
