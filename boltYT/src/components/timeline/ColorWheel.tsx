/**
 * ColorWheel — lift/gamma/gain 중 하나를 제어하는 원형 컨트롤.
 * 중심 = 중립, 가장자리 = 최대 shift. 드래그로 XY 변화 (R/B 축).
 */

import type React from "react";
import { useCallback, useRef } from "react";

interface Props {
	label: string;
	value: { r: number; g: number; b: number };
	onChange: (v: { r: number; g: number; b: number }) => void;
	/** 최대 편차 (default 0.5) */
	range?: number;
	size?: number;
}

export function ColorWheel({
	label,
	value,
	onChange,
	range = 0.5,
	size = 140,
}: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);

	// R 축 = 수평 (왼쪽 음수 = cyan, 오른쪽 양수 = red)
	// B 축 = 수직 (위 양수 = yellow-ish(낮은 B), 아래 = blue)
	// G 채널은 별도 세로 슬라이더로 제어 (아래)
	const center = size / 2;
	const radius = size / 2 - 4;
	const knobX = center + (value.r / range) * radius;
	const knobY = center - (-value.b / range) * radius;

	const handleFromEvent = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!ref.current) return;
			const rect = ref.current.getBoundingClientRect();
			const dx = e.clientX - rect.left - center;
			const dy = e.clientY - rect.top - center;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const clampedDist = Math.min(radius, dist);
			const nx = dist === 0 ? 0 : (dx / dist) * clampedDist;
			const ny = dist === 0 ? 0 : (dy / dist) * clampedDist;
			const r = (nx / radius) * range;
			const b = -(ny / radius) * range; // 위 = 양수 → 아래 = 음수
			onChange({ ...value, r: Number(r.toFixed(3)), b: Number(b.toFixed(3)) });
		},
		[center, radius, range, onChange, value],
	);

	const onPointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			draggingRef.current = true;
			handleFromEvent(e);
		},
		[handleFromEvent],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!draggingRef.current) return;
			handleFromEvent(e);
		},
		[handleFromEvent],
	);

	const onPointerUp = useCallback(() => {
		draggingRef.current = false;
	}, []);

	const onReset = useCallback(() => onChange({ r: 0, g: 0, b: 0 }), [onChange]);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 6,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					width: size,
				}}
			>
				<span
					style={{
						fontSize: 10,
						fontWeight: 700,
						color: "rgba(255,255,255,0.85)",
						textTransform: "uppercase",
						letterSpacing: "0.05em",
					}}
				>
					{label}
				</span>
				<button
					type="button"
					onClick={onReset}
					style={{
						fontSize: 9,
						padding: "1px 6px",
						background: "transparent",
						border: "1px solid rgba(255,255,255,0.2)",
						color: "rgba(255,255,255,0.55)",
						borderRadius: 3,
						cursor: "pointer",
					}}
				>
					reset
				</button>
			</div>

			<div
				ref={ref}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				style={{
					width: size,
					height: size,
					borderRadius: "50%",
					position: "relative",
					cursor: "crosshair",
					background:
						"conic-gradient(from 0deg, rgba(239,68,68,0.55), rgba(251,191,36,0.55), rgba(34,197,94,0.55), rgba(6,182,212,0.55), rgba(59,130,246,0.55), rgba(168,85,247,0.55), rgba(236,72,153,0.55), rgba(239,68,68,0.55))",
					border: "1px solid rgba(255,255,255,0.15)",
					boxShadow: "inset 0 0 24px rgba(0,0,0,0.55)",
				}}
			>
				{/* 중심 표시 */}
				<div
					style={{
						position: "absolute",
						left: center - 2,
						top: center - 2,
						width: 4,
						height: 4,
						background: "rgba(255,255,255,0.25)",
						borderRadius: "50%",
						pointerEvents: "none",
					}}
				/>
				{/* knob */}
				<div
					style={{
						position: "absolute",
						left: knobX - 6,
						top: knobY - 6,
						width: 12,
						height: 12,
						background: "#fff",
						borderRadius: "50%",
						border: "2px solid rgba(0,0,0,0.55)",
						boxShadow: "0 0 6px rgba(255,255,255,0.6)",
						pointerEvents: "none",
					}}
				/>
			</div>

			{/* G 슬라이더 (세로 대체로 가로로 표시) */}
			<div style={{ width: size }}>
				<input
					type="range"
					min={-range}
					max={range}
					step={0.001}
					value={value.g}
					onChange={(e) => onChange({ ...value, g: Number(e.target.value) })}
					style={{ width: "100%", accentColor: "#22c55e" }}
					aria-label={`${label} green channel`}
				/>
				<div
					style={{
						fontSize: 9,
						color: "rgba(255,255,255,0.55)",
						fontFamily: "monospace",
						textAlign: "center",
					}}
				>
					R {value.r.toFixed(2)} · G {value.g.toFixed(2)} · B{" "}
					{value.b.toFixed(2)}
				</div>
			</div>
		</div>
	);
}
