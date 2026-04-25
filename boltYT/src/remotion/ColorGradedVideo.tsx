/**
 * ColorGradedVideo — Remotion 컴포넌트.
 *
 * WebGL 색보정된 비디오를 렌더. WebGL 미지원 시 Remotion <Video> fallback.
 * rAF 루프: video → offscreen canvas → WebGL 처리 → 출력 canvas.
 */

import { useEffect, useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig, Video } from "remotion";
import type { ColorGraph } from "../lib/color-graph";
import { applyColorGradeToCanvas } from "../lib/color-graph-webgl";

export interface ColorGradedVideoProps {
	src: string;
	colorGraph: ColorGraph;
	width: number;
	height: number;
	startFrom?: number;
	endAt?: number;
	volume?: number;
	muted?: boolean;
}

export function ColorGradedVideo({
	src,
	colorGraph,
	width,
	height,
	startFrom,
	endAt,
	volume,
	muted,
}: ColorGradedVideoProps) {
	// Remotion hooks — early return 전에 (Rules of Hooks)
	const frame = useCurrentFrame();
	useVideoConfig();

	const videoRef = useRef<HTMLVideoElement>(null);
	const outputCanvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef<number>(0);

	// offscreen canvas — document 없는 환경 방어
	const offscreenCanvas = useMemo(() => {
		if (typeof document === "undefined") return null;
		const c = document.createElement("canvas");
		c.width = width;
		c.height = height;
		return c;
	}, [width, height]);

	// WebGL 지원 여부 — 출력 canvas 의 WebGL context 로 검사
	const webglSupported = useMemo(() => {
		if (typeof document === "undefined") return false;
		const probe = document.createElement("canvas");
		const gl = probe.getContext("webgl");
		return gl !== null;
	}, []);

	// rAF 루프: 재생 중 매 프레임 WebGL 색보정 적용
	useEffect(() => {
		const video = videoRef.current;
		const outputCanvas = outputCanvasRef.current;
		if (!video || !outputCanvas || !offscreenCanvas || !webglSupported) return;

		const offCtx = offscreenCanvas.getContext("2d");
		if (!offCtx) return;

		let active = true;
		const oc = offscreenCanvas;
		const ctx = offCtx;
		const out = outputCanvas;

		function tick() {
			if (!active) return;
			if (video && !video.paused && !video.ended) {
				oc.width = video.videoWidth || width;
				oc.height = video.videoHeight || height;
				ctx.drawImage(video, 0, 0, oc.width, oc.height);
				applyColorGradeToCanvas(out, oc, colorGraph);
			}
			rafRef.current = requestAnimationFrame(tick);
		}

		rafRef.current = requestAnimationFrame(tick);
		return () => {
			active = false;
			cancelAnimationFrame(rafRef.current);
		};
	}, [offscreenCanvas, webglSupported, colorGraph, width, height]);

	// Frame-driven draw: Remotion scrub/pause 시에도 색보정이 적용되도록.
	// rAF callback 안에서 mutation — react-hooks/immutability rule 준수 (rAF tick 패턴과 동일)
	useEffect(() => {
		const video = videoRef.current;
		const out = outputCanvasRef.current;
		if (!video || !out || !offscreenCanvas || !webglSupported) return;
		const offCtx = offscreenCanvas.getContext("2d");
		if (!offCtx) return;
		const oc = offscreenCanvas;
		const ctx = offCtx;
		const rafId = requestAnimationFrame(() => {
			oc.width = video.videoWidth || width;
			oc.height = video.videoHeight || height;
			ctx.drawImage(video, 0, 0, oc.width, oc.height);
			applyColorGradeToCanvas(out, oc, colorGraph);
		});
		return () => cancelAnimationFrame(rafId);
	}, [frame, offscreenCanvas, webglSupported, colorGraph, width, height]);

	// WebGL 미지원 → Remotion Video fallback
	if (!webglSupported) {
		return (
			<Video
				src={src}
				startFrom={startFrom}
				endAt={endAt}
				volume={volume ?? 1}
				muted={muted}
				style={{ width, height }}
			/>
		);
	}

	return (
		<>
			{/* 숨겨진 video 요소 — rAF 루프가 프레임 읽기 */}
			<video
				ref={videoRef}
				src={src}
				style={{ display: "none" }}
				muted={muted ?? true}
				playsInline
				crossOrigin="anonymous"
			/>
			{/* WebGL 출력 canvas */}
			<canvas
				ref={outputCanvasRef}
				width={width}
				height={height}
				style={{ width, height, display: "block" }}
			/>
		</>
	);
}
