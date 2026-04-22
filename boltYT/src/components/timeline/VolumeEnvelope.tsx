/**
 * VolumeEnvelope — 오디오 클립 위에 볼륨 자동화 곡선 + 키프레임 드래그.
 *
 * X축: 클립 시작(0) ~ 끝(durationFrames)
 * Y축: 볼륨 0(바닥) ~ 1.5(천장)
 *
 * 더블클릭: 새 키프레임 추가
 * 드래그: 키프레임 이동
 * Alt+클릭: 키프레임 삭제
 */

import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
	type AutomationCurve,
	evaluateCurve,
	type TimelineClip,
} from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";

interface Props {
	clip: TimelineClip;
	zoom: number;
	height: number;
	/** 최대 볼륨 값 (YAxis 상단) */
	maxVolume?: number;
}

const DEFAULT_MAX = 1.5;

export function VolumeEnvelope({
	clip,
	zoom,
	height,
	maxVolume = DEFAULT_MAX,
}: Props) {
	const setKeyframe = useTimelineStore((s) => s.setClipVolumeKeyframe);
	const removeKeyframe = useTimelineStore((s) => s.removeClipVolumeKeyframe);

	const svgRef = useRef<SVGSVGElement>(null);
	const [dragging, setDragging] = useState<number | null>(null);

	const curve: AutomationCurve = useMemo(
		() =>
			clip.volumeEnvelope ?? {
				default: clip.volume,
				keyframes: [],
			},
		[clip.volumeEnvelope, clip.volume],
	);

	const width = clip.durationFrames * zoom;

	const yOf = useCallback(
		(v: number) => height - (v / maxVolume) * height,
		[height, maxVolume],
	);
	const xOf = useCallback((f: number) => f * zoom, [zoom]);

	const path = useMemo(() => {
		if (clip.durationFrames <= 0) return "";
		const steps = Math.max(4, Math.min(120, Math.floor(width / 8)));
		const pts: string[] = [];
		for (let i = 0; i <= steps; i++) {
			const f = (i / steps) * clip.durationFrames;
			const v = evaluateCurve(curve, f);
			pts.push(`${xOf(f).toFixed(1)},${yOf(v).toFixed(1)}`);
		}
		return `M ${pts.join(" L ")}`;
	}, [curve, width, clip.durationFrames, xOf, yOf]);

	const svgXYToFrameValue = useCallback(
		(clientX: number, clientY: number) => {
			if (!svgRef.current) return null;
			const rect = svgRef.current.getBoundingClientRect();
			const px = clientX - rect.left;
			const py = clientY - rect.top;
			const frame = Math.max(
				0,
				Math.min(clip.durationFrames, Math.round(px / zoom)),
			);
			const v = Math.max(
				0,
				Math.min(maxVolume, ((height - py) / height) * maxVolume),
			);
			return { frame, value: Number(v.toFixed(3)) };
		},
		[zoom, height, maxVolume, clip.durationFrames],
	);

	const onDoubleClick = useCallback(
		(e: React.MouseEvent<SVGSVGElement>) => {
			const p = svgXYToFrameValue(e.clientX, e.clientY);
			if (!p) return;
			setKeyframe(clip.id, p.frame, p.value, "linear");
		},
		[clip.id, setKeyframe, svgXYToFrameValue],
	);

	const onKeyframePointerDown = useCallback(
		(frame: number) => (e: React.PointerEvent<SVGCircleElement>) => {
			e.stopPropagation();
			if (e.altKey) {
				removeKeyframe(clip.id, frame);
				return;
			}
			e.currentTarget.setPointerCapture(e.pointerId);
			setDragging(frame);
		},
		[clip.id, removeKeyframe],
	);

	const onKeyframePointerMove = useCallback(
		(original: number) => (e: React.PointerEvent<SVGCircleElement>) => {
			if (dragging !== original) return;
			const p = svgXYToFrameValue(e.clientX, e.clientY);
			if (!p) return;
			if (p.frame !== original) removeKeyframe(clip.id, original);
			setKeyframe(clip.id, p.frame, p.value, "linear");
			setDragging(p.frame);
		},
		[dragging, svgXYToFrameValue, setKeyframe, removeKeyframe, clip.id],
	);

	const onKeyframePointerUp = useCallback(() => {
		setDragging(null);
	}, []);

	if (width < 8) return null;

	return (
		<svg
			ref={svgRef}
			width={width}
			height={height}
			onDoubleClick={onDoubleClick}
			style={{
				position: "absolute",
				left: 0,
				top: 0,
				pointerEvents: "auto",
				cursor: "crosshair",
			}}
			aria-label="Volume envelope"
		>
			{/* 기준선 (default 볼륨) */}
			<line
				x1={0}
				y1={yOf(curve.default)}
				x2={width}
				y2={yOf(curve.default)}
				stroke="rgba(255,255,255,0.08)"
				strokeDasharray="2 3"
			/>
			{/* 곡선 */}
			<path
				d={path}
				fill="none"
				stroke="rgba(251,191,36,0.85)"
				strokeWidth={1.5}
				pointerEvents="none"
			/>
			{/* 키프레임 점 */}
			{curve.keyframes.map((k) => (
				<circle
					key={k.frame}
					cx={xOf(k.frame)}
					cy={yOf(k.value)}
					r={4}
					fill="rgba(251,191,36,1)"
					stroke="rgba(0,0,0,0.8)"
					strokeWidth={1}
					onPointerDown={onKeyframePointerDown(k.frame)}
					onPointerMove={onKeyframePointerMove(k.frame)}
					onPointerUp={onKeyframePointerUp}
					style={{ cursor: "grab" }}
				/>
			))}
		</svg>
	);
}
