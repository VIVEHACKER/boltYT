/**
 * MotionPathPanel — positionX/Y 키프레임의 2D 궤적 시각화 + 드래그 편집.
 *
 * 캔버스 좌표계: 항상 9:16 (1080x1920) 또는 16:9 비율 기반. 패널 너비에 맞춰 축소.
 * (0,0) = 합성 중앙. TransformKeyframes 의 position 값은 CompositionV2 에서
 * translate3d(x, y) 로 적용되므로 픽셀 오프셋과 1:1 대응.
 *
 * 상호작용:
 *  - 기존 knot 드래그: setMotionKnotAt(frame, x, y)
 *  - 빈 영역 클릭: 현재 playhead 에 knot 추가 (setMotionKnotAtPlayhead)
 *  - Alt+클릭 기존 knot: 삭제
 *
 * 궤적 선: linear 보간 기준 (ease=smooth 도 시각적으론 직선으로 근사 — 실제 프리뷰는 정확)
 */

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
	type AutomationKeyframe,
	type BezierTangent,
	evaluateTransformKeyframes,
	getMotionKnots,
	type MotionKnot,
	type TimelineProject,
} from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";

const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 640; // 9:16 기본 — 프로젝트 비율 맞춰 동적

function computeDisplay(project: TimelineProject): {
	width: number;
	height: number;
	scale: number;
} {
	const projectAR = project.width / project.height;
	const viewAR = CANVAS_WIDTH / CANVAS_HEIGHT;
	let w = CANVAS_WIDTH;
	let h = CANVAS_HEIGHT;
	if (projectAR > viewAR) {
		w = CANVAS_WIDTH;
		h = CANVAS_WIDTH / projectAR;
	} else {
		h = CANVAS_HEIGHT;
		w = CANVAS_HEIGHT * projectAR;
	}
	const scale = w / project.width;
	return { width: w, height: h, scale };
}

export function MotionPathPanel() {
	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);
	const setMotionKnotAt = useTimelineStore((s) => s.setMotionKnotAt);
	const setMotionKnotAtPlayhead = useTimelineStore(
		(s) => s.setMotionKnotAtPlayhead,
	);
	const removeMotionKnotAt = useTimelineStore((s) => s.removeMotionKnotAt);
	const clearTransform = useTimelineStore((s) => s.clearTransform);

	const updateKeyframeTangent = useTimelineStore(
		(s) => s.updateKeyframeTangent,
	);

	const svgRef = useRef<SVGSVGElement>(null);
	const [dragFrame, setDragFrame] = useState<number | null>(null);
	/** 선택된 knot frame — null 이면 비선택, 같은 knot 재클릭 시 토글 해제 */
	const [selectedKnot, setSelectedKnot] = useState<number | null>(null);

	const selected = useMemo(
		() => project?.clips.filter((c) => c.selected) ?? [],
		[project],
	);
	// 단일 선택일 때만 편집 대상 — 다중 선택 시 의도치 않은 클립 수정 방지
	const clip = selected.length === 1 ? selected[0] : undefined;
	const snapshot = useTimelineStore((s) => s.snapshot);

	const display = useMemo(
		() => (project ? computeDisplay(project) : null),
		[project],
	);

	const fromSvg = useCallback(
		(sx: number, sy: number): { x: number; y: number } => {
			if (!display) return { x: 0, y: 0 };
			const cx = display.width / 2;
			const cy = display.height / 2;
			return { x: (sx - cx) / display.scale, y: (sy - cy) / display.scale };
		},
		[display],
	);

	const onCanvasMouseDown = useCallback(
		(e: React.MouseEvent<SVGSVGElement>) => {
			if (!clip) return;
			if ((e.target as SVGElement).tagName !== "svg") return;
			const local = playhead - clip.startFrame;
			if (local < 0 || local > clip.durationFrames) return;
			const rect = svgRef.current?.getBoundingClientRect();
			if (!rect) return;
			const sx = e.clientX - rect.left;
			const sy = e.clientY - rect.top;
			const { x, y } = fromSvg(sx, sy);
			setMotionKnotAtPlayhead(clip.id, Math.round(x), Math.round(y));
		},
		[clip, playhead, setMotionKnotAtPlayhead, fromSvg],
	);

	const onKnotMouseDown = useCallback(
		(e: React.MouseEvent, knot: MotionKnot) => {
			e.stopPropagation();
			if (!clip) return;
			const clipId = clip.id;
			if (e.altKey) {
				removeMotionKnotAt(clipId, knot.frame);
				return;
			}
			// 클릭 시 선택 토글 (같은 knot 재클릭 = 해제)
			setSelectedKnot((prev) => (prev === knot.frame ? null : knot.frame));
			setDragFrame(knot.frame);

			const rect = svgRef.current?.getBoundingClientRect();
			if (!rect) return;

			let moved = false;

			function onMove(evt: MouseEvent) {
				if (!rect) return;
				moved = true;
				const sx = evt.clientX - rect.left;
				const sy = evt.clientY - rect.top;
				const { x, y } = fromSvg(sx, sy);
				// silent update — drag 중엔 history snapshot 생략
				setMotionKnotAt(
					clipId,
					knot.frame,
					Math.round(x),
					Math.round(y),
					knot.ease,
					true,
				);
			}
			function onUp() {
				setDragFrame(null);
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				// drag 끝에 한 번만 snapshot → undo 는 drag 직전 상태로 돌아감
				if (moved) snapshot();
			}
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[clip, setMotionKnotAt, removeMotionKnotAt, fromSvg, snapshot],
	);

	/**
	 * Tangent handle drag handler.
	 * side: "in" | "out" — 드래그하는 핸들 방향.
	 * knot: 해당 motion knot.
	 * baseSvgPos: 핸들의 초기 SVG 좌표 (drag 시작점 계산용).
	 */
	const onTangentMouseDown = useCallback(
		(
			e: React.MouseEvent,
			knot: MotionKnot,
			side: "in" | "out",
			baseTangent: BezierTangent,
		) => {
			e.stopPropagation();
			if (!clip) return;
			const clipId = clip.id;
			const rect = svgRef.current?.getBoundingClientRect();
			if (!rect) return;

			const startX = e.clientX;
			const startY = e.clientY;
			let moved = false;

			// 프레임 구간 크기 (정규화 → SVG 변환용)
			const knots = getMotionKnots(clip);
			const knotIdx = knots.findIndex((k) => k.frame === knot.frame);
			// 구간 길이 (out: 이 knot→다음, in: 이전→이 knot)
			const neighborKnot =
				side === "out" ? knots[knotIdx + 1] : knots[knotIdx - 1];
			const intervalFrames = neighborKnot
				? Math.abs(neighborKnot.frame - knot.frame)
				: 30; // fallback

			function onMove(evt: MouseEvent) {
				moved = true;
				// 마우스 delta (SVG px)
				const dx =
					(evt.clientX - startX) / (intervalFrames > 0 ? intervalFrames : 1);
				const dy =
					(evt.clientY - startY) / (intervalFrames > 0 ? intervalFrames : 1);
				// 새 tangent = 기존값 + delta (정규화 좌표)
				const newTangent: BezierTangent = {
					x: Math.max(0, Math.min(1, baseTangent.x + dx)),
					y: baseTangent.y + dy,
				};
				const tangentArg =
					side === "out" ? { out: newTangent } : { in: newTangent };
				// silent — drag 중 snapshot 생략
				updateKeyframeTangent(clipId, knot.frame, tangentArg, true);
			}
			function onUp() {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				if (moved) snapshot();
			}
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[clip, updateKeyframeTangent, snapshot],
	);

	if (!project) return null;
	if (!clip || !display) {
		const msg =
			selected.length > 1
				? `${selected.length}개 클립 선택됨 — 단일 클립을 선택해야 motion path 편집이 가능합니다.`
				: "클립을 선택하면 motion path 를 편집할 수 있습니다.";
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
				{msg}
			</div>
		);
	}

	const knots = getMotionKnots(clip);
	const local = playhead - clip.startFrame;
	const inRange = local >= 0 && local <= clip.durationFrames;
	const viewW = display.width;
	const viewH = display.height;
	const viewScale = display.scale;
	const cx = viewW / 2;
	const cy = viewH / 2;

	const toSvg = (x: number, y: number): { sx: number; sy: number } => ({
		sx: cx + x * viewScale,
		sy: cy + y * viewScale,
	});

	/**
	 * evaluateTransform 샘플링으로 실제 렌더와 1:1 매칭 궤적.
	 * ease=smooth 면 cubic smoothstep, hold 면 계단 — SVG path 가 그대로 반영.
	 * 샘플 간격: 4프레임 (30fps 기준 ~133ms). knot 가 많지 않은 일반적 사용에 충분.
	 */
	const SAMPLE_STEP = 4;
	const sampleFrames: number[] = [];
	if (knots.length >= 2) {
		const first = knots[0].frame;
		const last = knots[knots.length - 1].frame;
		for (let f = first; f <= last; f += SAMPLE_STEP) sampleFrames.push(f);
		if (sampleFrames[sampleFrames.length - 1] !== last) sampleFrames.push(last);
	}
	const pathD =
		sampleFrames.length >= 2
			? sampleFrames
					.map((f, i) => {
						const t = evaluateTransformKeyframes(clip.transformKeyframes, f);
						const { sx, sy } = toSvg(t.x, t.y);
						return `${i === 0 ? "M" : "L"} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
					})
					.join(" ")
			: "";

	// 현재 playhead 시점의 effective position
	const currentKnotFrame = knots.find((k) => k.frame === local);

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
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 10,
				}}
			>
				<div
					style={{
						fontSize: 11,
						fontWeight: 600,
						color: "rgba(255,255,255,0.75)",
					}}
				>
					Motion Path · {clip.label ?? clip.id.slice(0, 8)}
					{knots.length > 0 && (
						<span style={{ marginLeft: 8, color: "rgba(251,191,36,0.85)" }}>
							◆ {knots.length} knots
						</span>
					)}
				</div>
				<div style={{ display: "flex", gap: 6 }}>
					<button
						type="button"
						onClick={() => {
							if (!inRange) return;
							const { x, y } = { x: 0, y: 0 };
							setMotionKnotAtPlayhead(clip.id, x, y);
						}}
						disabled={!inRange}
						style={{
							fontSize: 10,
							padding: "4px 8px",
							border: "1px solid #2a2a2a",
							background: "#1a1a1a",
							color: "rgba(255,255,255,0.7)",
							borderRadius: 3,
							cursor: inRange ? "pointer" : "not-allowed",
							display: "flex",
							alignItems: "center",
							gap: 4,
						}}
					>
						<Plus size={10} /> 현재 프레임 (0,0)
					</button>
					{knots.length > 0 && (
						<>
							<button
								type="button"
								onClick={() => clearTransform(clip.id, "positionX")}
								style={{
									fontSize: 10,
									padding: "4px 8px",
									border: "1px solid #2a2a2a",
									background: "#1a1a1a",
									color: "rgba(255,150,150,0.75)",
									borderRadius: 3,
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									gap: 4,
								}}
								title="positionX 키프레임 전체 제거"
							>
								<Trash2 size={10} /> X
							</button>
							<button
								type="button"
								onClick={() => clearTransform(clip.id, "positionY")}
								style={{
									fontSize: 10,
									padding: "4px 8px",
									border: "1px solid #2a2a2a",
									background: "#1a1a1a",
									color: "rgba(255,150,150,0.75)",
									borderRadius: 3,
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									gap: 4,
								}}
								title="positionY 키프레임 전체 제거"
							>
								<Trash2 size={10} /> Y
							</button>
						</>
					)}
				</div>
			</div>

			<div style={{ display: "flex", gap: 16 }}>
				<svg
					ref={svgRef}
					width={display.width}
					height={display.height}
					viewBox={`0 0 ${display.width} ${display.height}`}
					onMouseDown={onCanvasMouseDown}
					style={{
						background: "#050505",
						border: "1px solid #1f1f1f",
						borderRadius: 4,
						cursor: inRange ? "crosshair" : "not-allowed",
					}}
					role="img"
					aria-label="Motion path editor"
				>
					<title>Motion path editor</title>
					{/* 3분할 가이드 */}
					<g stroke="rgba(255,255,255,0.06)" strokeWidth={1}>
						<line
							x1={display.width / 3}
							y1={0}
							x2={display.width / 3}
							y2={display.height}
						/>
						<line
							x1={(display.width / 3) * 2}
							y1={0}
							x2={(display.width / 3) * 2}
							y2={display.height}
						/>
						<line
							x1={0}
							y1={display.height / 3}
							x2={display.width}
							y2={display.height / 3}
						/>
						<line
							x1={0}
							y1={(display.height / 3) * 2}
							x2={display.width}
							y2={(display.height / 3) * 2}
						/>
					</g>
					{/* 중심 십자 */}
					<g stroke="rgba(255,255,255,0.15)" strokeWidth={1}>
						<line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} />
						<line x1={cx} y1={cy - 6} x2={cx} y2={cy + 6} />
					</g>

					{/* 궤적 */}
					{knots.length > 1 && (
						<path
							d={pathD}
							fill="none"
							stroke="rgba(251,191,36,0.55)"
							strokeWidth={1.5}
							strokeDasharray="3,3"
						/>
					)}

					{/* 현재 프레임 effective 위치 (playhead indicator) */}
					{(() => {
						const tkX = clip.transformKeyframes?.positionX;
						const tkY = clip.transformKeyframes?.positionY;
						const effX = tkX
							? knots.length > 0
								? // 보간 위해 evaluateCurve 대신 getMotionKnots 를 기반 linear (간이)
									(() => {
										let x = clip.position.x;
										for (const k of knots) if (k.frame <= local) x = k.x;
										for (let i = 0; i < knots.length - 1; i++) {
											if (
												knots[i].frame <= local &&
												knots[i + 1].frame > local
											) {
												const a = knots[i];
												const b = knots[i + 1];
												const t = (local - a.frame) / (b.frame - a.frame);
												x = a.x + (b.x - a.x) * t;
											}
										}
										return x;
									})()
								: clip.position.x
							: clip.position.x;
						const effY = tkY
							? knots.length > 0
								? (() => {
										let y = clip.position.y;
										for (const k of knots) if (k.frame <= local) y = k.y;
										for (let i = 0; i < knots.length - 1; i++) {
											if (
												knots[i].frame <= local &&
												knots[i + 1].frame > local
											) {
												const a = knots[i];
												const b = knots[i + 1];
												const t = (local - a.frame) / (b.frame - a.frame);
												y = a.y + (b.y - a.y) * t;
											}
										}
										return y;
									})()
								: clip.position.y
							: clip.position.y;
						const { sx, sy } = toSvg(effX, effY);
						return (
							<circle
								cx={sx}
								cy={sy}
								r={6}
								fill="rgba(134,239,172,0.25)"
								stroke="rgba(134,239,172,0.8)"
								strokeWidth={1.5}
								pointerEvents="none"
							/>
						);
					})()}

					{/* bezier tangent handles — 선택된 knot 이고 ease=bezier 일 때만 표시 */}
					{knots.map((k) => {
						if (k.ease !== "bezier") return null;
						if (selectedKnot !== k.frame) return null;
						const { sx: ksx, sy: ksy } = toSvg(k.x, k.y);
						// 실제 tangent 값을 positionX 키프레임에서 읽음
						const xKfs = clip.transformKeyframes?.positionX?.keyframes ?? [];
						const kf = xKfs.find((f) => f.frame === k.frame);
						const outTan: BezierTangent = kf?.outTangent ?? { x: 0.3, y: 0 };
						const inTan: BezierTangent = kf?.inTangent ?? { x: 0.3, y: 0 };
						// 이웃 knot 구간 프레임 수
						const knotIdx = knots.findIndex((n) => n.frame === k.frame);
						const nextKnot = knots[knotIdx + 1];
						const prevKnot = knots[knotIdx - 1];
						const outInterval = nextKnot ? nextKnot.frame - k.frame : 30;
						const inInterval = prevKnot ? k.frame - prevKnot.frame : 30;
						// 핸들 SVG 오프셋 (정규화 → px: interval * viewScale)
						const outHx = ksx + outTan.x * outInterval * viewScale;
						const outHy = ksy + outTan.y * outInterval * viewScale;
						const inHx = ksx - inTan.x * inInterval * viewScale;
						const inHy = ksy - inTan.y * inInterval * viewScale;
						return (
							<g key={`tan-${k.frame}`} pointerEvents="none">
								{/* out tangent arm + handle */}
								{nextKnot && (
									<>
										<line
											x1={ksx}
											y1={ksy}
											x2={outHx}
											y2={outHy}
											stroke="rgba(38,101,253,0.5)"
											strokeWidth={1}
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
											style={{ cursor: "crosshair", pointerEvents: "all" }}
											onMouseDown={(e) =>
												onTangentMouseDown(e, k, "out", outTan)
											}
										/>
									</>
								)}
								{/* in tangent arm + handle */}
								{prevKnot && (
									<>
										<line
											x1={ksx}
											y1={ksy}
											x2={inHx}
											y2={inHy}
											stroke="rgba(38,101,253,0.5)"
											strokeWidth={1}
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
											style={{ cursor: "crosshair", pointerEvents: "all" }}
											onMouseDown={(e) => onTangentMouseDown(e, k, "in", inTan)}
										/>
									</>
								)}
							</g>
						);
					})}

					{/* knots */}
					{knots.map((k) => {
						const { sx, sy } = toSvg(k.x, k.y);
						const isCurrent = currentKnotFrame?.frame === k.frame;
						const isDragging = dragFrame === k.frame;
						const isSelected = selectedKnot === k.frame;
						return (
							// biome-ignore lint/a11y/useSemanticElements: <button> cannot be nested in <svg>; role=button on <g> is idiomatic for SVG interactive handles
							<g
								key={k.frame}
								transform={`translate(${sx}, ${sy})`}
								onMouseDown={(e) => onKnotMouseDown(e, k)}
								onKeyDown={(e) => {
									if (e.key === "Delete" || e.key === "Backspace") {
										if (clip) removeMotionKnotAt(clip.id, k.frame);
									}
								}}
								role="button"
								tabIndex={0}
								aria-label={`Motion knot at frame ${k.frame}, x ${Math.round(k.x)}, y ${Math.round(k.y)}`}
								style={{ cursor: "grab" }}
							>
								<rect
									x={-5}
									y={-5}
									width={10}
									height={10}
									transform="rotate(45)"
									fill={
										isCurrent
											? "rgba(251,191,36,0.95)"
											: isDragging
												? "rgba(251,191,36,0.7)"
												: isSelected
													? "rgba(251,191,36,0.85)"
													: "rgba(251,191,36,0.45)"
									}
									stroke={isSelected ? "#2665fd" : "rgba(0,0,0,0.8)"}
									strokeWidth={isSelected ? 1.5 : 1}
								/>
								<text
									x={8}
									y={-6}
									fontSize={9}
									fill="rgba(255,255,255,0.55)"
									style={{ fontFamily: "monospace", pointerEvents: "none" }}
								>
									f{k.frame}
								</text>
								{/* ease 뱃지 — L/S/H/B 클릭하면 순환 (linear→smooth→hold→bezier→linear) */}
								{/* biome-ignore lint/a11y/useSemanticElements: SVG 내부에 <button> 중첩 불가, role=button 로 접근성 유지 */}
								<g
									transform={`translate(8, 6)`}
									onClick={(e) => {
										e.stopPropagation();
										if (!clip) return;
										const next: AutomationKeyframe["ease"] =
											k.ease === "linear"
												? "smooth"
												: k.ease === "smooth"
													? "hold"
													: k.ease === "hold"
														? "bezier"
														: "linear";
										setMotionKnotAt(clip.id, k.frame, k.x, k.y, next);
									}}
									style={{ cursor: "pointer" }}
									role="button"
									tabIndex={-1}
									aria-label={`ease ${k.ease}, click to toggle`}
								>
									<rect
										x={0}
										y={-7}
										width={10}
										height={9}
										rx={1.5}
										fill={
											k.ease === "smooth"
												? "rgba(96,165,250,0.35)"
												: k.ease === "hold"
													? "rgba(239,68,68,0.35)"
													: k.ease === "bezier"
														? "rgba(168,85,247,0.35)"
														: "rgba(148,163,184,0.3)"
										}
										stroke="rgba(0,0,0,0.6)"
										strokeWidth={0.5}
									/>
									<text
										x={5}
										y={0}
										fontSize={7}
										textAnchor="middle"
										fill="rgba(255,255,255,0.95)"
										style={{ fontFamily: "monospace", pointerEvents: "none" }}
									>
										{k.ease === "smooth"
											? "S"
											: k.ease === "hold"
												? "H"
												: k.ease === "bezier"
													? "B"
													: "L"}
									</text>
								</g>
							</g>
						);
					})}
				</svg>

				<div
					style={{
						fontSize: 10,
						color: "rgba(255,255,255,0.55)",
						lineHeight: 1.6,
						maxWidth: 240,
					}}
				>
					<div
						style={{
							marginBottom: 6,
							color: inRange
								? "rgba(134,239,172,0.85)"
								: "rgba(255,150,150,0.75)",
							fontFamily: "monospace",
						}}
					>
						{inRange
							? `local f${local} / ${clip.durationFrames}`
							: "playhead out of clip range"}
					</div>
					<div>
						· <strong>빈 영역 클릭</strong> — 현재 playhead 에 knot 추가
					</div>
					<div>
						· <strong>knot 드래그</strong> — x/y 동시 조정
					</div>
					<div>
						· <strong>Alt + knot 클릭</strong> — knot 삭제
					</div>
					<div>
						· <strong>L/S/H/B 뱃지 클릭</strong> — ease 순환
						(Linear→Smooth→Hold→Bezier)
					</div>
					<div style={{ fontSize: 9, opacity: 0.6, marginLeft: 6 }}>
						B (bezier): knot 클릭 → 파란 핸들 드래그로 곡선 제어
					</div>
					<div style={{ marginTop: 6, opacity: 0.7 }}>
						궤적은 4-프레임 샘플링으로 실제 렌더와 1:1 일치 (smooth 곡선·hold
						계단 그대로 반영).
					</div>
					{currentKnotFrame && (
						<div
							style={{
								marginTop: 8,
								padding: 6,
								background: "rgba(251,191,36,0.08)",
								border: "1px solid rgba(251,191,36,0.3)",
								borderRadius: 3,
								color: "rgba(251,191,36,0.9)",
								fontFamily: "monospace",
							}}
						>
							현재 knot: ({Math.round(currentKnotFrame.x)},{" "}
							{Math.round(currentKnotFrame.y)}) · ease {currentKnotFrame.ease}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
