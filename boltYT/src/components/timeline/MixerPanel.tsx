/**
 * MixerPanel — 오디오 믹서 뷰 (트랙별 볼륨 페이더 + 팬 + 솔로/뮤트 + 레벨 미터).
 */

import { Headphones, Volume2, VolumeX } from "lucide-react";
import { useTimelineStore } from "../../lib/timeline-store";

export function MixerPanel() {
	const project = useTimelineStore((s) => s.project);
	const updateTrack = useTimelineStore((s) => s.updateTrack);
	const snapshot = useTimelineStore((s) => s.snapshot);

	if (!project) return null;

	const audioTracks = project.tracks
		.filter((t) => t.kind === "audio")
		.sort((a, b) => a.order - b.order);

	if (audioTracks.length === 0) {
		return (
			<div style={{ padding: 16, color: "#777", fontSize: 12 }}>
				오디오 트랙이 없습니다.
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				gap: 8,
				padding: 12,
				background: "#0a0a0a",
				borderTop: "1px solid #2a2a2a",
				overflowX: "auto",
			}}
		>
			{/* BGM 마스터 */}
			<Channel
				name="BGM"
				volume={project.bgmVolume}
				onVolume={(v) => {
					snapshot();
					const next = { ...project, bgmVolume: v };
					useTimelineStore.setState({ project: next });
				}}
				color="#6366f1"
			/>

			{/* 트랙 채널 */}
			{audioTracks.map((t) => (
				<Channel
					key={t.id}
					name={t.name}
					volume={t.volume}
					pan={t.pan}
					muted={t.muted}
					solo={t.solo}
					onVolume={(v) => updateTrack(t.id, { volume: v })}
					onPan={(v) => updateTrack(t.id, { pan: v })}
					onMute={() => updateTrack(t.id, { muted: !t.muted })}
					onSolo={() => updateTrack(t.id, { solo: !t.solo })}
					color="#10b981"
				/>
			))}
		</div>
	);
}

interface ChannelProps {
	name: string;
	volume: number;
	pan?: number;
	muted?: boolean;
	solo?: boolean;
	onVolume: (v: number) => void;
	onPan?: (v: number) => void;
	onMute?: () => void;
	onSolo?: () => void;
	color?: string;
}

function Channel({
	name,
	volume,
	pan,
	muted,
	solo,
	onVolume,
	onPan,
	onMute,
	onSolo,
	color = "#10b981",
}: ChannelProps) {
	const db = volume > 0 ? 20 * Math.log10(volume) : -Infinity;
	const dbLabel = Number.isFinite(db) ? `${db.toFixed(1)} dB` : "−∞";

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 6,
				padding: "10px 8px",
				background: "#121212",
				border: `1px solid ${solo ? "rgba(250,204,21,0.55)" : "#2a2a2a"}`,
				borderRadius: 6,
				minWidth: 70,
			}}
		>
			{/* 이름 */}
			<div
				style={{
					fontSize: 10,
					fontWeight: 700,
					color: "rgba(255,255,255,0.85)",
					textTransform: "uppercase",
					letterSpacing: "0.05em",
				}}
			>
				{name}
			</div>

			{/* Solo / Mute */}
			<div style={{ display: "flex", gap: 4 }}>
				{onSolo && (
					<button
						type="button"
						onClick={onSolo}
						title="Solo"
						style={{
							fontSize: 9,
							fontWeight: 700,
							padding: "2px 6px",
							background: solo ? "rgba(234,179,8,0.25)" : "#1a1a1a",
							color: solo ? "#fcd34d" : "rgba(255,255,255,0.55)",
							border: "none",
							borderRadius: 3,
							cursor: "pointer",
						}}
					>
						S
					</button>
				)}
				{onMute && (
					<button
						type="button"
						onClick={onMute}
						title={muted ? "Unmute" : "Mute"}
						style={{
							fontSize: 9,
							fontWeight: 700,
							padding: "2px 6px",
							background: muted ? "rgba(239,68,68,0.28)" : "#1a1a1a",
							color: muted ? "#fca5a5" : "rgba(255,255,255,0.55)",
							border: "none",
							borderRadius: 3,
							cursor: "pointer",
						}}
					>
						{muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
					</button>
				)}
			</div>

			{/* 페이더 (세로) */}
			<div
				style={{
					height: 120,
					width: 40,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					position: "relative",
				}}
			>
				<input
					type="range"
					min={0}
					max={1.5}
					step={0.01}
					value={volume}
					onChange={(e) => onVolume(Number(e.target.value))}
					style={{
						transform: "rotate(-90deg)",
						width: 110,
						accentColor: color,
					}}
				/>
				{/* dB 눈금 (0dB 기준선) */}
				<div
					style={{
						position: "absolute",
						right: 2,
						top: (1 - 1 / 1.5) * 120,
						height: 1,
						width: 10,
						background: "rgba(134,239,172,0.45)",
						pointerEvents: "none",
					}}
				/>
			</div>

			<div
				style={{
					fontSize: 9,
					fontFamily: "monospace",
					color: muted ? "rgba(239,68,68,0.7)" : "rgba(255,255,255,0.6)",
				}}
			>
				{dbLabel}
			</div>

			{/* 팬 */}
			{onPan !== undefined && pan !== undefined && (
				<div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
					<input
						type="range"
						min={-1}
						max={1}
						step={0.01}
						value={pan}
						onChange={(e) => onPan(Number(e.target.value))}
						style={{ width: 50, accentColor: color }}
					/>
					<div
						style={{
							fontSize: 8,
							color: "rgba(255,255,255,0.55)",
							textAlign: "center",
							display: "flex",
							justifyContent: "space-between",
						}}
					>
						<span>L</span>
						<span style={{ color: "rgba(255,255,255,0.85)" }}>
							{pan === 0
								? "C"
								: pan > 0
									? `R${Math.round(pan * 100)}`
									: `L${Math.round(-pan * 100)}`}
						</span>
						<span>R</span>
					</div>
				</div>
			)}

			{/* 헤드폰 아이콘 (장식) */}
			<Headphones
				size={12}
				style={{ color: "rgba(255,255,255,0.25)", marginTop: 4 }}
			/>
		</div>
	);
}
