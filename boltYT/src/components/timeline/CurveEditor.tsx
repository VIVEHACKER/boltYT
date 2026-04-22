/**
 * CurveEditor — 선택된 클립의 transform 각 property (positionX/Y/scale/rotation/opacity)
 * 자동화 커브를 작은 SVG 라인 그래프로 시각화. bezier knot 선택 시 tangent handle 표시.
 *
 * bezier/smooth/hold 보간을 evaluateCurve 샘플링으로 정확히 반영.
 * 현재 playhead 위치를 세로선으로 표시.
 */

import { useRef, useState } from "react";
import {
	type AutomationCurve,
	type AutomationKeyframe,
	type BezierTangent,
	evaluateCurve,
	type TransformProp,
} from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";

const EASE_CYCLE: Record<
	NonNullable<AutomationKeyframe["ease"]>,
	NonNullable<AutomationKeyframe["ease"]>
> = {
	linear: "smooth",
	smooth: "hold",
	hold: "bezier",
	bezier: "linear",
};

const PROPS: Array<{
	key: TransformProp;
	label: string;
	unit: string;
	/** 시각화 범위 패딩 — 모든 값이 같으면 라인 평평해져 안 보이므로 */
	defaultRange: [number, number];
}> = [
	{ key: "positionX", label: "pos X", unit: "px", defaultRange: [-100, 100] },
	{ key: "positionY", label: "pos Y", unit: "px", defaultRange: [-100, 100] },
	{ key: "scale", label: "scale", unit: "x", defaultRange: [0.5, 1.5] },
	{ key: "rotation", label: "rot", unit: "°", defaultRange: [-45, 45] },
	{ key: "opacity", label: "opacity", unit: "", defaultRange: [0, 1] },
];

const EASE_COLOR: Record<NonNullable<AutomationKeyframe["ease"]>, string> = {
	linear: "rgba(148,163,184,0.95)",
	smooth: "rgba(96,165,250,0.95)",
	hold: "rgba(239,68,68,0.95)",
	bezier: "rgba(168,85,247,0.95)",
};

interface CurveRowProps {
	label: string;
	unit: string;
	prop: TransformProp;
	clipId: string;
	curve: AutomationCurve | undefined;
	startFrame: number;
	durationFrames: number;
	playhead: number;
	defaultRange: [number, number];
}

function CurveRow({
	label,
	unit,
	prop,
	clipId,
	curve,
	startFrame,
	durationFrames,
	playhead,
	defaultRange,
}: CurveRowProps) {
	const updateKeyframeEase = useTimelineStore((s) => s.updateKeyframeEase);
	const updateKeyframeValue = useTimelineStore((s) => s.updateKeyframeValue);
	const updateAutomationTangent = useTimelineStore(
		(s) => s.updateAutomationTangent,
	);
	const removeTransformKeyframeAt = useTimelineStore(
		(s) => s.removeTransformKeyframeAt,
	);
	const snapshot = useTimelineStore((s) => s.snapshot);
	const svgRef = useRef<SVGSVGElement>(null);

	// hooks before any early return (Rules of Hooks)
	const [selectedKnotFrame, setSelectedKnotFrame] = useState<number | null>(
		null,
	);

	const W = 260;
	const H = 60;
	const padY = 6;
	const hasKf = (curve?.keyframes.length ?? 0) > 0;

	// 값 범위
	let min = defaultRange[0];
	let max = defaultRange[1];
	if (curve) {
		const values = [curve.default, ...curve.keyframes.map((k) => k.value)];
		min = Math.min(...values, defaultRange[0]);
		max = Math.max(...values, defaultRange[1]);
		if (max - min < 1e-6) {
			max = min + 1;
		}
	}

	const valueRange = max - min;
	const xOf = (frame: number) => (frame / Math.max(1, durationFrames)) * W;
	const yOf = (v: number) =>
		H - padY - ((v - min) / valueRange) * (H - 2 * padY);
	const valueOfY = (sy: number) => {
		const norm = (H - padY - sy) / (H - 2 * padY);
		const v = norm * valueRange + min;
		return Math.min(max, Math.max(min, v));
	};

	// interval width (px) between consecutive keyframes — used for tangent scaling
	const intervalWidth = durationFrames > 0 ? W / durationFrames : W;

	function startDragValue(
		e: React.MouseEvent<SVGCircleElement>,
		kFrame: number,
	) {
		if (e.altKey) return; // Alt+클릭은 삭제 경로
		e.preventDefault();
		e.stopPropagation();
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect) return;
		let moved = false;
		function onMove(ev: MouseEvent) {
			if (!rect) return;
			moved = true;
			const sy = ev.clientY - rect.top;
			const v = valueOfY(sy);
			updateKeyframeValue(clipId, prop, kFrame, v, true);
		}
		function onUp() {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			if (moved) snapshot();
		}
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}

	/**
	 * Tangent handle drag. side: "in" | "out".
	 * baseTangent: the current tangent value (drag baseline).
	 * kfIdx used to compute neighboring interval for normalization.
	 */
	function startDragTangent(
		e: React.MouseEvent<SVGCircleElement>,
		kFrame: number,
		side: "in" | "out",
		baseTangent: BezierTangent,
		neighborIntervalFrames: number,
	) {
		e.stopPropagation();
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		let moved = false;

		// px per frame for this interval
		const pxPerFrame = durationFrames > 0 ? W / durationFrames : 1;
		const intervalPx = neighborIntervalFrames * pxPerFrame;

		function onMove(ev: MouseEvent) {
			moved = true;
			const dx = (ev.clientX - startX) / (intervalPx || 1);
			// y: up = positive value. SVG y increases downward so negate
			const dy = -(ev.clientY - startY) / (intervalPx || 1);
			const newTangent: BezierTangent = {
				x: Math.max(0, Math.min(1, baseTangent.x + dx)),
				y: baseTangent.y + dy,
			};
			const tangentArg =
				side === "out" ? { out: newTangent } : { in: newTangent };
			updateAutomationTangent(clipId, prop, kFrame, tangentArg, true);
		}
		function onUp() {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			if (moved) snapshot();
		}
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}

	// 샘플 path
	const SAMPLE_STEP = Math.max(2, Math.floor(durationFrames / 80));
	let path = "";
	if (curve && hasKf) {
		const pts: string[] = [];
		for (let f = 0; f <= durationFrames; f += SAMPLE_STEP) {
			const v = evaluateCurve(curve, f);
			pts.push(`${xOf(f).toFixed(1)},${yOf(v).toFixed(1)}`);
		}
		path = `M ${pts.join(" L ")}`;
	}

	// playhead 로컬 프레임
	const local = playhead - startFrame;
	const inRange = local >= 0 && local <= durationFrames;
	const effectiveNow = curve ? evaluateCurve(curve, local) : undefined;

	// compute tangent handle SVG positions for selected bezier knot
	const selectedKf =
		selectedKnotFrame !== null
			? curve?.keyframes.find((k) => k.frame === selectedKnotFrame)
			: undefined;
	const showHandles = selectedKf?.ease === "bezier";

	let outHx = 0;
	let outHy = 0;
	let inHx = 0;
	let inHy = 0;
	let outTan: BezierTangent = { x: 0.3, y: 0 };
	let inTan: BezierTangent = { x: 0.3, y: 0 };
	let outIntervalFrames = 30;
	let inIntervalFrames = 30;
	let hasNextKnot = false;
	let hasPrevKnot = false;

	if (showHandles && selectedKf && curve) {
		const kf = selectedKf;
		const knotIdx = curve.keyframes.findIndex((k) => k.frame === kf.frame);
		const nextKf = curve.keyframes[knotIdx + 1];
		const prevKf = curve.keyframes[knotIdx - 1];
		hasNextKnot = nextKf !== undefined;
		hasPrevKnot = prevKf !== undefined;

		outIntervalFrames = nextKf ? nextKf.frame - kf.frame : 30;
		inIntervalFrames = prevKf ? kf.frame - prevKf.frame : 30;
		outTan = kf.outTangent ?? { x: 0.3, y: 0 };
		inTan = kf.inTangent ?? { x: 0.3, y: 0 };

		const kx = xOf(kf.frame);
		const ky = yOf(kf.value);
		// outTangent: positive x → right, positive y → up (negate SVG y)
		outHx = kx + outTan.x * outIntervalFrames * intervalWidth;
		outHy = ky - outTan.y * outIntervalFrames * intervalWidth;
		// inTangent: negative x direction (left of knot)
		inHx = kx - inTan.x * inIntervalFrames * intervalWidth;
		inHy = ky - inTan.y * inIntervalFrames * intervalWidth;
	}

	return (
		<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
			<div
				style={{
					width: 54,
					fontSize: 10,
					color: "rgba(255,255,255,0.65)",
					fontFamily: "monospace",
				}}
			>
				{label}
			</div>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: SVG canvas deselect — keyboard nav is handled by individual knot buttons */}
			<svg
				ref={svgRef}
				width={W}
				height={H}
				style={{
					background: "#050505",
					border: "1px solid #1f1f1f",
					borderRadius: 3,
				}}
				onClick={() => setSelectedKnotFrame(null)}
			>
				<title>{`${label} automation curve`}</title>
				{/* 수평 중앙선 (값 mid) */}
				<line
					x1={0}
					y1={yOf((min + max) / 2)}
					x2={W}
					y2={yOf((min + max) / 2)}
					stroke="rgba(255,255,255,0.06)"
					strokeWidth={1}
				/>
				{/* 커브 */}
				{path && (
					<path
						d={path}
						fill="none"
						stroke="rgba(251,191,36,0.75)"
						strokeWidth={1.4}
					/>
				)}
				{/* 기본값 + 키프레임 없을 때 flat 라인 */}
				{!hasKf && curve && (
					<line
						x1={0}
						y1={yOf(curve.default)}
						x2={W}
						y2={yOf(curve.default)}
						stroke="rgba(148,163,184,0.5)"
						strokeWidth={1}
						strokeDasharray="2,2"
					/>
				)}

				{/* bezier tangent handles — 선택된 knot 이고 ease=bezier 일 때만 표시 */}
				{showHandles && selectedKf && (
					<g>
						{/* out tangent arm + handle */}
						{hasNextKnot && (
							<>
								<line
									x1={xOf(selectedKf.frame)}
									y1={yOf(selectedKf.value)}
									x2={outHx}
									y2={outHy}
									stroke="rgba(38,101,253,0.5)"
									strokeWidth={1}
									pointerEvents="none"
								/>
								{/* biome-ignore lint/a11y/useSemanticElements: SVG <circle> cannot be replaced by <button>; role=button is the correct SVG a11y pattern */}
								<circle
									cx={outHx}
									cy={outHy}
									r={4}
									fill="white"
									stroke="rgba(38,101,253,0.8)"
									strokeWidth={1}
									role="button"
									aria-label="out tangent handle"
									style={{ cursor: "crosshair" }}
									onMouseDown={(e) =>
										startDragTangent(
											e,
											selectedKf.frame,
											"out",
											outTan,
											outIntervalFrames,
										)
									}
								>
									<title>out tangent — drag to adjust</title>
								</circle>
							</>
						)}
						{/* in tangent arm + handle */}
						{hasPrevKnot && (
							<>
								<line
									x1={xOf(selectedKf.frame)}
									y1={yOf(selectedKf.value)}
									x2={inHx}
									y2={inHy}
									stroke="rgba(38,101,253,0.5)"
									strokeWidth={1}
									pointerEvents="none"
								/>
								{/* biome-ignore lint/a11y/useSemanticElements: SVG <circle> cannot be replaced by <button>; role=button is the correct SVG a11y pattern */}
								<circle
									cx={inHx}
									cy={inHy}
									r={4}
									fill="white"
									stroke="rgba(38,101,253,0.8)"
									strokeWidth={1}
									role="button"
									aria-label="in tangent handle"
									style={{ cursor: "crosshair" }}
									onMouseDown={(e) =>
										startDragTangent(
											e,
											selectedKf.frame,
											"in",
											inTan,
											inIntervalFrames,
										)
									}
								>
									<title>in tangent — drag to adjust</title>
								</circle>
							</>
						)}
					</g>
				)}

				{/* knot 점 — 드래그: value 변경, Click: ease 순환, Alt+클릭: 삭제 */}
				{curve?.keyframes.map((k) => {
					const isSelected = k.frame === selectedKnotFrame;
					return (
						// biome-ignore lint/a11y/useSemanticElements: SVG <circle> — <button> cannot be nested in <svg>; role=button is idiomatic for SVG interactive handles
						<circle
							key={k.frame}
							cx={xOf(k.frame)}
							cy={yOf(k.value)}
							r={isSelected ? 5 : 4}
							fill={EASE_COLOR[k.ease ?? "linear"]}
							stroke={isSelected ? "#ffffff" : "rgba(0,0,0,0.8)"}
							strokeWidth={isSelected ? 1.5 : 0.8}
							role="button"
							aria-label={`keyframe f${k.frame} ease ${k.ease ?? "linear"}`}
							style={{ cursor: "ns-resize" }}
							onMouseDown={(e) => startDragValue(e, k.frame)}
							onClick={(e) => {
								e.stopPropagation();
								if (e.altKey) {
									removeTransformKeyframeAt(clipId, prop, k.frame);
									if (selectedKnotFrame === k.frame) setSelectedKnotFrame(null);
								} else if (e.detail === 1 && !e.defaultPrevented) {
									// 이미 선택된 knot: ease 순환. 미선택: 선택
									if (selectedKnotFrame === k.frame) {
										const nextEase = EASE_CYCLE[k.ease ?? "linear"];
										updateKeyframeEase(clipId, prop, k.frame, nextEase);
										// bezier → linear 로 빠지면 선택 해제
										if (nextEase === "linear") setSelectedKnotFrame(null);
									} else {
										setSelectedKnotFrame(k.frame);
									}
								}
							}}
						>
							<title>{`f${k.frame} ${k.value.toFixed(2)} · ease ${k.ease ?? "linear"} — 드래그=값 · 클릭=선택/ease · Alt=삭제`}</title>
						</circle>
					);
				})}
				{/* playhead */}
				{inRange && (
					<line
						x1={xOf(local)}
						y1={0}
						x2={xOf(local)}
						y2={H}
						stroke="rgba(134,239,172,0.7)"
						strokeWidth={1}
					/>
				)}
			</svg>
			<div
				style={{
					width: 60,
					fontSize: 10,
					color: inRange ? "rgba(134,239,172,0.9)" : "rgba(255,255,255,0.4)",
					fontFamily: "monospace",
					textAlign: "right",
				}}
			>
				{inRange && effectiveNow !== undefined
					? `${effectiveNow.toFixed(unit === "x" ? 2 : 0)}${unit}`
					: "—"}
			</div>
		</div>
	);
}

export function CurveEditor() {
	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);
	const selected = useTimelineStore((s) => s.selected());
	const clip = selected.length === 1 ? selected[0] : undefined;

	if (!project || !clip) {
		return (
			<div
				style={{
					borderTop: "1px solid #1a1a1a",
					background: "#0d0d0d",
					padding: 12,
					fontSize: 11,
					color: "rgba(255,255,255,0.5)",
				}}
			>
				클립을 하나 선택하면 transform automation curve 를 볼 수 있습니다.
			</div>
		);
	}

	return (
		<div
			style={{
				borderTop: "1px solid #1a1a1a",
				background: "#0d0d0d",
				padding: 12,
			}}
		>
			<div
				style={{
					fontSize: 11,
					fontWeight: 600,
					color: "rgba(255,255,255,0.75)",
					marginBottom: 8,
				}}
			>
				Curves · {clip.label ?? clip.id.slice(0, 8)} (f{clip.startFrame}–
				{clip.startFrame + clip.durationFrames})
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
				{PROPS.map((p) => (
					<CurveRow
						key={p.key}
						label={p.label}
						unit={p.unit}
						prop={p.key}
						clipId={clip.id}
						curve={clip.transformKeyframes?.[p.key]}
						startFrame={clip.startFrame}
						durationFrames={clip.durationFrames}
						playhead={playhead}
						defaultRange={p.defaultRange}
					/>
				))}
			</div>
			<div
				style={{
					fontSize: 9,
					color: "rgba(255,255,255,0.4)",
					marginTop: 8,
					lineHeight: 1.5,
				}}
			>
				knot 클릭 = 선택 · 재클릭 = ease 순환 (L→S→H→B) · bezier 선택 시 tangent
				handle 표시 · 드래그 = value 수직 조정 · Alt+클릭 = 삭제
			</div>
		</div>
	);
}
