/**
 * TransformPanel — 선택 클립의 position/scale/rotation/opacity 키프레임 편집.
 *
 * - 슬라이더 값 변경 → 현재 플레이헤드에 키프레임 자동 기록
 * - 다이아몬드 버튼 → 값 변경 없이 현재 값으로 키프레임 추가
 * - 프롭별 키프레임 목록 + 개별 삭제 + 전체 초기화
 *
 * 플레이헤드가 클립 영역 밖이면 키프레임 추가 비활성 (로컬 프레임이 음수 방지).
 */

import { Diamond, RotateCcw, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
	type TimelineClip,
	type TransformProp,
	evaluateTransform,
} from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";

type PropDef = {
	key: TransformProp;
	label: string;
	unit: string;
	min: number;
	max: number;
	step: number;
	format: (v: number) => string;
};

const PROPS: PropDef[] = [
	{
		key: "positionX",
		label: "Position X",
		unit: "px",
		min: -1080,
		max: 1080,
		step: 1,
		format: (v) => `${Math.round(v)}`,
	},
	{
		key: "positionY",
		label: "Position Y",
		unit: "px",
		min: -1920,
		max: 1920,
		step: 1,
		format: (v) => `${Math.round(v)}`,
	},
	{
		key: "scale",
		label: "Scale",
		unit: "x",
		min: 0.1,
		max: 4,
		step: 0.01,
		format: (v) => v.toFixed(2),
	},
	{
		key: "rotation",
		label: "Rotation",
		unit: "°",
		min: -180,
		max: 180,
		step: 0.5,
		format: (v) => v.toFixed(1),
	},
	{
		key: "opacity",
		label: "Opacity",
		unit: "",
		min: 0,
		max: 1,
		step: 0.01,
		format: (v) => v.toFixed(2),
	},
];

function PropRow({
	def,
	clip,
	playhead,
	inRange,
	currentValue,
	hasKeyframes,
}: {
	def: PropDef;
	clip: TimelineClip;
	playhead: number;
	inRange: boolean;
	currentValue: number;
	hasKeyframes: boolean;
}) {
	const setKf = useTimelineStore((s) => s.setTransformKeyframeAtPlayhead);
	const removeKf = useTimelineStore((s) => s.removeTransformKeyframeAt);
	const clearProp = useTimelineStore((s) => s.clearTransform);

	const kfs = clip.transformKeyframes?.[def.key]?.keyframes ?? [];

	return (
		<div
			style={{
				padding: 10,
				borderBottom: "1px solid #1a1a1a",
				opacity: inRange ? 1 : 0.45,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 6,
					fontSize: 11,
					fontWeight: 600,
					color: hasKeyframes
						? "rgba(251,191,36,0.95)"
						: "rgba(255,255,255,0.75)",
				}}
			>
				<span>
					{def.label}
					{hasKeyframes && (
						<span style={{ marginLeft: 6, fontSize: 10 }}>◆ {kfs.length}</span>
					)}
				</span>
				<span
					style={{ fontFamily: "monospace", color: "rgba(255,255,255,0.6)" }}
				>
					{def.format(currentValue)}
					{def.unit}
				</span>
			</div>

			<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
				<input
					type="range"
					min={def.min}
					max={def.max}
					step={def.step}
					value={currentValue}
					disabled={!inRange}
					onChange={(e) => {
						const v = Number.parseFloat(e.target.value);
						if (Number.isFinite(v)) setKf(clip.id, def.key, v);
					}}
					style={{ flex: 1, accentColor: "#fbbf24" }}
				/>
				<button
					type="button"
					onClick={() => setKf(clip.id, def.key, currentValue)}
					disabled={!inRange}
					title="Set keyframe at playhead"
					style={{
						border: "none",
						background: hasKeyframes
							? "rgba(251,191,36,0.15)"
							: "rgba(255,255,255,0.08)",
						color: hasKeyframes
							? "rgba(251,191,36,0.95)"
							: "rgba(255,255,255,0.7)",
						borderRadius: 4,
						padding: "4px 6px",
						cursor: inRange ? "pointer" : "not-allowed",
					}}
				>
					<Diamond size={12} />
				</button>
				{hasKeyframes && (
					<button
						type="button"
						onClick={() => clearProp(clip.id, def.key)}
						title="Clear all keyframes for this property"
						style={{
							border: "none",
							background: "rgba(255,255,255,0.08)",
							color: "rgba(255,255,255,0.6)",
							borderRadius: 4,
							padding: "4px 6px",
							cursor: "pointer",
						}}
					>
						<RotateCcw size={12} />
					</button>
				)}
			</div>

			{kfs.length > 0 && (
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						gap: 4,
						marginTop: 6,
					}}
				>
					{kfs.map((k) => (
						<div
							key={k.frame}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								fontSize: 10,
								fontFamily: "monospace",
								background: "rgba(251,191,36,0.08)",
								border: "1px solid rgba(251,191,36,0.3)",
								borderRadius: 3,
								padding: "2px 6px",
								color: "rgba(251,191,36,0.9)",
							}}
						>
							<span>
								f{clip.startFrame + k.frame}
								{playhead === clip.startFrame + k.frame ? " ●" : ""}
							</span>
							<span style={{ color: "rgba(255,255,255,0.55)" }}>
								{def.format(k.value)}
							</span>
							<button
								type="button"
								onClick={() => removeKf(clip.id, def.key, k.frame)}
								title="Remove keyframe"
								style={{
									border: "none",
									background: "transparent",
									color: "rgba(255,120,120,0.8)",
									cursor: "pointer",
									padding: 0,
									display: "flex",
								}}
							>
								<Trash2 size={10} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export function TransformPanel() {
	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);

	const selected = useMemo(
		() => (project ? project.clips.filter((c) => c.selected) : []),
		[project],
	);

	if (!project) return null;

	if (selected.length === 0) {
		return (
			<div
				style={{
					padding: 16,
					fontSize: 12,
					color: "rgba(255,255,255,0.5)",
					borderTop: "1px solid #1a1a1a",
					background: "#0d0d0d",
				}}
			>
				클립을 선택하면 transform 키프레임을 편집할 수 있습니다.
			</div>
		);
	}
	if (selected.length > 1) {
		return (
			<div
				style={{
					padding: 16,
					fontSize: 12,
					color: "rgba(255,255,255,0.5)",
					borderTop: "1px solid #1a1a1a",
					background: "#0d0d0d",
				}}
			>
				{selected.length}개 클립 선택됨 — 단일 클립을 선택하면 transform 편집이
				가능합니다.
			</div>
		);
	}

	const clip = selected[0];
	const local = playhead - clip.startFrame;
	const inRange = local >= 0 && local <= clip.durationFrames;
	const effective = evaluateTransform(clip, playhead);
	const valueByProp: Record<TransformProp, number> = {
		positionX: effective.x,
		positionY: effective.y,
		scale: effective.scale,
		rotation: effective.rotation,
		opacity: effective.opacity,
	};

	return (
		<div
			style={{
				borderTop: "1px solid #1a1a1a",
				background: "#0d0d0d",
				maxHeight: 360,
				overflowY: "auto",
			}}
		>
			<div
				style={{
					padding: "8px 12px",
					borderBottom: "1px solid #1a1a1a",
					fontSize: 11,
					color: "rgba(255,255,255,0.75)",
					display: "flex",
					justifyContent: "space-between",
					background: "#121212",
				}}
			>
				<span style={{ fontWeight: 600 }}>
					Transform · {clip.label ?? clip.id.slice(0, 8)}
				</span>
				<span
					style={{
						fontFamily: "monospace",
						color: inRange
							? "rgba(134,239,172,0.85)"
							: "rgba(255,150,150,0.75)",
					}}
				>
					{inRange
						? `local f${local} / ${clip.durationFrames}`
						: "playhead out of range"}
				</span>
			</div>

			{PROPS.map((def) => (
				<PropRow
					key={def.key}
					def={def}
					clip={clip}
					playhead={playhead}
					inRange={inRange}
					currentValue={valueByProp[def.key]}
					hasKeyframes={!!clip.transformKeyframes?.[def.key]}
				/>
			))}
		</div>
	);
}
