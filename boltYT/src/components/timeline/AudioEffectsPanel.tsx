/**
 * AudioEffectsPanel — 선택된 클립의 AudioEffect 체인 편집.
 * FX_ORDER(eq3→gain→delay→reverb) 고정 순서 표시.
 */

import { Music2, Square, Triangle, X } from "lucide-react";
import { useAudioPreview } from "../../hooks/useAudioPreview";
import type {
	AudioEffect,
	AudioEffectKind,
	ReverbPreset,
} from "../../lib/audio-effects";
import { defaultEffect, orderChain } from "../../lib/audio-effects";
import { useTimelineStore } from "../../lib/timeline-store";

const FX_LABEL: Record<AudioEffectKind, string> = {
	eq3: "EQ 3-Band",
	gain: "Gain",
	delay: "Delay",
	reverb: "Reverb",
};

const REVERB_PRESETS: ReverbPreset[] = ["room", "hall", "plate"];

// ──────────────────────────────────────────────
// Sub-editors
// ──────────────────────────────────────────────

interface EqEditorProps {
	effect: Extract<AudioEffect, { kind: "eq3" }>;
	onChange: (patch: Partial<Extract<AudioEffect, { kind: "eq3" }>>) => void;
}
function EqEditor({ effect, onChange }: EqEditorProps) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			{(["low", "mid", "high"] as const).map((band) => (
				<SliderRow
					key={band}
					label={band.toUpperCase()}
					value={effect[band]}
					min={-12}
					max={12}
					step={0.5}
					unit="dB"
					onChange={(v) => onChange({ [band]: v })}
				/>
			))}
		</div>
	);
}

interface ReverbEditorProps {
	effect: Extract<AudioEffect, { kind: "reverb" }>;
	onChange: (patch: Partial<Extract<AudioEffect, { kind: "reverb" }>>) => void;
}
function ReverbEditor({ effect, onChange }: ReverbEditorProps) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
				<span
					style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", width: 32 }}
				>
					TYPE
				</span>
				{REVERB_PRESETS.map((p) => (
					<button
						key={p}
						type="button"
						onClick={() => onChange({ preset: p })}
						style={{
							fontSize: 10,
							padding: "2px 8px",
							borderRadius: 4,
							border: "none",
							cursor: "pointer",
							background:
								effect.preset === p
									? "rgba(38,101,253,0.85)"
									: "rgba(255,255,255,0.08)",
							color: effect.preset === p ? "#fff" : "rgba(255,255,255,0.55)",
							fontWeight: effect.preset === p ? 600 : 400,
							textTransform: "capitalize",
						}}
					>
						{p}
					</button>
				))}
			</div>
			<SliderRow
				label="DECAY"
				value={effect.decay}
				min={0.2}
				max={8}
				step={0.1}
				unit="s"
				onChange={(v) => onChange({ decay: v })}
			/>
			<SliderRow
				label="WET"
				value={effect.wet}
				min={0}
				max={1}
				step={0.01}
				unit=""
				onChange={(v) => onChange({ wet: v })}
			/>
		</div>
	);
}

interface DelayEditorProps {
	effect: Extract<AudioEffect, { kind: "delay" }>;
	onChange: (patch: Partial<Extract<AudioEffect, { kind: "delay" }>>) => void;
}
function DelayEditor({ effect, onChange }: DelayEditorProps) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<SliderRow
				label="TIME"
				value={effect.time}
				min={0}
				max={2}
				step={0.01}
				unit="s"
				onChange={(v) => onChange({ time: v })}
			/>
			<SliderRow
				label="FB"
				value={effect.feedback}
				min={0}
				max={0.9}
				step={0.01}
				unit=""
				onChange={(v) => onChange({ feedback: v })}
			/>
			<SliderRow
				label="WET"
				value={effect.wet}
				min={0}
				max={1}
				step={0.01}
				unit=""
				onChange={(v) => onChange({ wet: v })}
			/>
		</div>
	);
}

interface GainEditorProps {
	effect: Extract<AudioEffect, { kind: "gain" }>;
	onChange: (patch: Partial<Extract<AudioEffect, { kind: "gain" }>>) => void;
}
function GainEditor({ effect, onChange }: GainEditorProps) {
	return (
		<SliderRow
			label="GAIN"
			value={effect.db}
			min={-24}
			max={24}
			step={0.5}
			unit="dB"
			onChange={(v) => onChange({ db: v })}
		/>
	);
}

// ──────────────────────────────────────────────
// Shared slider row
// ──────────────────────────────────────────────

interface SliderRowProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	onChange: (v: number) => void;
}
function SliderRow({
	label,
	value,
	min,
	max,
	step,
	unit,
	onChange,
}: SliderRowProps) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
			<span
				style={{
					fontSize: 9,
					fontWeight: 700,
					color: "rgba(255,255,255,0.45)",
					letterSpacing: "0.05em",
					width: 30,
					flexShrink: 0,
				}}
			>
				{label}
			</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				style={{ flex: 1, accentColor: "#2665fd" }}
			/>
			<span
				style={{
					fontSize: 9,
					fontFamily: "monospace",
					color: "rgba(255,255,255,0.65)",
					width: 44,
					textAlign: "right",
					flexShrink: 0,
				}}
			>
				{value.toFixed(2)}
				{unit}
			</span>
		</div>
	);
}

// ──────────────────────────────────────────────
// Effect card
// ──────────────────────────────────────────────

interface EffectCardProps {
	effect: AudioEffect;
	onChange: (updated: AudioEffect) => void;
	onRemove: () => void;
}
function EffectCard({ effect, onChange, onRemove }: EffectCardProps) {
	function patch<T extends AudioEffect>(p: Partial<T>) {
		onChange({ ...effect, ...p } as AudioEffect);
	}

	return (
		<div
			style={{
				background: "#161616",
				border: "1px solid #2a2a2a",
				borderRadius: 8,
				padding: "10px 12px",
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<span
					style={{
						fontSize: 11,
						fontWeight: 700,
						color: "rgba(255,255,255,0.85)",
						textTransform: "uppercase",
						letterSpacing: "0.06em",
					}}
				>
					{FX_LABEL[effect.kind]}
				</span>
				<button
					type="button"
					onClick={onRemove}
					title="이펙트 제거"
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						color: "rgba(255,255,255,0.35)",
						padding: 2,
						display: "flex",
						alignItems: "center",
						borderRadius: 4,
					}}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLButtonElement).style.color = "#ffb4ab";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLButtonElement).style.color =
							"rgba(255,255,255,0.35)";
					}}
				>
					<X size={14} />
				</button>
			</div>

			{effect.kind === "eq3" && <EqEditor effect={effect} onChange={patch} />}
			{effect.kind === "reverb" && (
				<ReverbEditor effect={effect} onChange={patch} />
			)}
			{effect.kind === "delay" && (
				<DelayEditor effect={effect} onChange={patch} />
			)}
			{effect.kind === "gain" && (
				<GainEditor effect={effect} onChange={patch} />
			)}
		</div>
	);
}

// ──────────────────────────────────────────────
// Panel
// ──────────────────────────────────────────────

const ADD_KINDS: AudioEffectKind[] = ["eq3", "reverb", "delay", "gain"];
const ADD_LABELS: Record<AudioEffectKind, string> = {
	eq3: "EQ",
	reverb: "Reverb",
	delay: "Delay",
	gain: "Gain",
};

// ──────────────────────────────────────────────
// Preview bar (미리보기 컨트롤)
// ──────────────────────────────────────────────

interface PreviewBarProps {
	clipId: string;
	effects: AudioEffect[];
}
function PreviewBar({ clipId, effects }: PreviewBarProps) {
	const { isPlaying, isSupported, hasSource, play, stop } = useAudioPreview(
		clipId,
		effects,
	);

	if (!isSupported) return null;

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				background: "#0b1326",
				borderRadius: 8,
				padding: "6px 10px",
				border: "1px solid rgba(38,101,253,0.25)",
			}}
		>
			<button
				type="button"
				disabled={!hasSource}
				onClick={isPlaying ? stop : play}
				title={
					!hasSource
						? "오디오 소스 없음"
						: isPlaying
							? "미리보기 중지"
							: "미리보기 재생"
				}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 26,
					height: 26,
					borderRadius: 8,
					border: "none",
					cursor: hasSource ? "pointer" : "not-allowed",
					background: hasSource
						? isPlaying
							? "rgba(255,180,171,0.2)"
							: "rgba(38,101,253,0.85)"
						: "rgba(255,255,255,0.06)",
					color: hasSource
						? isPlaying
							? "#ffb4ab"
							: "#fff"
						: "rgba(255,255,255,0.2)",
					flexShrink: 0,
				}}
			>
				{isPlaying ? <Square size={11} /> : <Triangle size={11} />}
			</button>
			<span
				style={{
					fontSize: 10,
					color: hasSource
						? isPlaying
							? "rgba(255,180,171,0.85)"
							: "rgba(221,226,253,0.6)"
						: "rgba(255,255,255,0.25)",
					letterSpacing: "0.03em",
				}}
			>
				{!hasSource
					? "오디오 소스 없음"
					: isPlaying
						? "재생 중 — 슬라이더 조작 즉시 반영"
						: "FX 미리보기"}
			</span>
		</div>
	);
}

// ──────────────────────────────────────────────
// Panel
// ──────────────────────────────────────────────

export function AudioEffectsPanel() {
	const project = useTimelineStore((s) => s.project);
	const setClipAudioEffects = useTimelineStore((s) => s.setClipAudioEffects);

	const selectedClips = project?.clips.filter((c) => c.selected) ?? [];

	// hooks는 early return 앞에 배치 — Rules of Hooks
	const singleClipId = selectedClips.length === 1 ? selectedClips[0].id : null;
	const singleEffects: AudioEffect[] =
		selectedClips.length === 1
			? orderChain(selectedClips[0].audioEffects ?? [])
			: [];

	if (!project) return null;

	if (selectedClips.length !== 1) {
		return (
			<div
				style={{
					padding: 16,
					background: "#0a0a0a",
					borderTop: "1px solid #2a2a2a",
					color: "rgba(255,255,255,0.35)",
					fontSize: 11,
					display: "flex",
					alignItems: "center",
					gap: 8,
				}}
			>
				<Music2 size={14} />
				클립 하나를 선택하면 FX 체인을 편집할 수 있습니다.
			</div>
		);
	}

	const clip = selectedClips[0];
	const effects = singleEffects;

	function handleChange(idx: number, updated: AudioEffect) {
		const next = effects.map((e, i) => (i === idx ? updated : e));
		setClipAudioEffects(clip.id, next);
	}

	function handleRemove(idx: number) {
		const next = effects.filter((_, i) => i !== idx);
		setClipAudioEffects(clip.id, next);
	}

	function handleAdd(kind: AudioEffectKind) {
		// 동일 kind 중복 방지
		if (effects.some((e) => e.kind === kind)) return;
		const next = orderChain([...effects, defaultEffect(kind)]);
		setClipAudioEffects(clip.id, next);
	}

	return (
		<div
			style={{
				background: "#0a0a0a",
				borderTop: "1px solid #2a2a2a",
				padding: 12,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				maxHeight: 340,
				overflowY: "auto",
			}}
		>
			{/* Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 11,
						fontWeight: 700,
						color: "rgba(255,255,255,0.7)",
						textTransform: "uppercase",
						letterSpacing: "0.07em",
					}}
				>
					<Music2 size={13} />
					FX Chain — {clip.label ?? clip.id.slice(0, 8)}
				</div>

				{/* Add buttons */}
				<div style={{ display: "flex", gap: 4 }}>
					{ADD_KINDS.map((kind) => {
						const already = effects.some((e) => e.kind === kind);
						return (
							<button
								key={kind}
								type="button"
								disabled={already}
								onClick={() => handleAdd(kind)}
								title={
									already
										? `${ADD_LABELS[kind]} 이미 추가됨`
										: `${ADD_LABELS[kind]} 추가`
								}
								style={{
									fontSize: 10,
									fontWeight: 600,
									padding: "3px 8px",
									borderRadius: 8,
									border: "none",
									cursor: already ? "not-allowed" : "pointer",
									background: already
										? "rgba(255,255,255,0.05)"
										: "rgba(38,101,253,0.75)",
									color: already ? "rgba(255,255,255,0.25)" : "#fff",
								}}
							>
								{ADD_LABELS[kind]}
							</button>
						);
					})}
				</div>
			</div>

			{/* Preview bar */}
			{singleClipId && <PreviewBar clipId={singleClipId} effects={effects} />}

			{/* Effect cards */}
			{effects.length === 0 ? (
				<div
					style={{
						padding: "12px 0",
						color: "rgba(255,255,255,0.25)",
						fontSize: 11,
						textAlign: "center",
					}}
				>
					이펙트가 없습니다. 위의 버튼으로 추가하세요.
				</div>
			) : (
				effects.map((fx, idx) => (
					<EffectCard
						key={fx.kind}
						effect={fx}
						onChange={(updated) => handleChange(idx, updated)}
						onRemove={() => handleRemove(idx)}
					/>
				))
			)}
		</div>
	);
}
