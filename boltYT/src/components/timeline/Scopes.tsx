/**
 * Scopes — 선택된 클립의 이미지를 샘플링하여 Waveform + Vectorscope 캔버스에 그림.
 *
 * D5: colorGraph prop으로 색보정 후 샘플링 지원.
 * E1: 256×144 다운샘플링 (원본 코드 유지).
 * E2+E3: requestIdleCallback으로 4개 캔버스 단일 idle 콜백 통합.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ColorGraph } from "../../lib/color-graph";
import { applyColorGradeToCanvas } from "../../lib/color-graph-webgl";
import {
	computeVectorscope,
	computeWaveform,
	type ScopeFrame,
} from "../../lib/color-pipeline";
import {
	computeHistogram,
	computeParade,
	normalizeHistogram,
} from "../../lib/histogram";
import type { TimelineClip } from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";
import { useShallow } from "zustand/react/shallow";

const SAMPLE_WIDTH = 256;
const SAMPLE_HEIGHT = 144;

// E2: requestIdleCallback 폴리필
const scheduleIdle: (cb: IdleRequestCallback) => number =
	typeof window !== "undefined" && "requestIdleCallback" in window
		? (cb) => window.requestIdleCallback(cb)
		: (cb) => window.setTimeout(cb, 32) as unknown as number;

const cancelIdle: (id: number) => void =
	typeof window !== "undefined" && "cancelIdleCallback" in window
		? (id) => window.cancelIdleCallback(id)
		: (id) => window.clearTimeout(id);

export function Scopes() {
	const selected = useTimelineStore(useShallow((s) => s.selected()));
	const clip = selected[0];

	if (!clip || !clip.imageUrl) {
		return (
			<div
				style={{
					padding: 12,
					fontSize: 11,
					color: "#777",
				}}
			>
				이미지를 가진 클립을 선택하면 스코프가 표시됩니다.
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				gap: 12,
				padding: 12,
				background: "#0a0a0a",
				borderTop: "1px solid #2a2a2a",
				alignItems: "flex-start",
			}}
		>
			<AllScopes clip={clip} colorGraph={clip.colorGraph} />
		</div>
	);
}

/**
 * E3: 4개 캔버스를 단일 idle 콜백으로 통합 업데이트.
 */
function AllScopes({
	clip,
	colorGraph,
}: {
	clip: TimelineClip;
	colorGraph?: ColorGraph;
}) {
	const frame = useScopeFrame(clip.imageUrl, colorGraph);

	const waveformRef = useRef<HTMLCanvasElement>(null);
	const vectorscopeRef = useRef<HTMLCanvasElement>(null);
	const histogramRef = useRef<HTMLCanvasElement>(null);
	const paradeRef = useRef<HTMLCanvasElement>(null);

	const wf = useMemo(
		() => (frame ? computeWaveform(frame, 128) : null),
		[frame],
	);
	const vs = useMemo(
		() => (frame ? computeVectorscope(frame, 144) : null),
		[frame],
	);
	const hist = useMemo(
		() => (frame ? computeHistogram(frame.data, 64) : null),
		[frame],
	);
	const norm = useMemo(() => (hist ? normalizeHistogram(hist) : null), [hist]);
	const parade = useMemo(
		() =>
			frame ? computeParade(frame.data, frame.width, frame.height, 96) : null,
		[frame],
	);

	// E2+E3: 단일 idle 콜백으로 4개 캔버스 순차 업데이트
	useEffect(() => {
		if (!wf && !vs && !norm && !parade) return;

		const id = scheduleIdle(() => {
			// Waveform
			const wfCanvas = waveformRef.current;
			if (wfCanvas && wf) {
				const ctx = wfCanvas.getContext("2d");
				if (ctx) drawWaveform(ctx, wfCanvas, wf, frame);
			}
			// Vectorscope
			const vsCanvas = vectorscopeRef.current;
			if (vsCanvas && vs) {
				const ctx = vsCanvas.getContext("2d");
				if (ctx) drawVectorscope(ctx, vsCanvas, vs);
			}
			// Histogram
			const histCanvas = histogramRef.current;
			if (histCanvas && norm) {
				const ctx = histCanvas.getContext("2d");
				if (ctx) drawHistogram(ctx, histCanvas, norm);
			}
			// Parade
			const paradeCanvas = paradeRef.current;
			if (paradeCanvas && parade) {
				const ctx = paradeCanvas.getContext("2d");
				if (ctx) drawParade(ctx, paradeCanvas, parade);
			}
		});

		return () => cancelIdle(id);
	}, [wf, vs, norm, parade, frame]);

	return (
		<>
			<div>
				<div style={labelStyle}>WAVEFORM (Luma)</div>
				<canvas ref={waveformRef} style={canvasStyle} />
			</div>
			<div>
				<div style={labelStyle}>VECTORSCOPE</div>
				<canvas ref={vectorscopeRef} style={canvasStyle} />
			</div>
			<div>
				<div style={labelStyle}>HISTOGRAM (R/G/B)</div>
				<canvas ref={histogramRef} style={canvasStyle} />
			</div>
			<div>
				<div style={labelStyle}>PARADE</div>
				<canvas ref={paradeRef} style={canvasStyle} />
			</div>
		</>
	);
}

const labelStyle: React.CSSProperties = {
	fontSize: 10,
	fontWeight: 700,
	color: "rgba(255,255,255,0.7)",
	marginBottom: 4,
};
const canvasStyle: React.CSSProperties = { display: "block", borderRadius: 4 };

// ── D5: colorGraph 있으면 offscreen WebGL 색보정 후 샘플링 ──

function useScopeFrame(
	imageUrl: string | undefined,
	colorGraph?: ColorGraph,
): ScopeFrame | null {
	const frameKey = useMemo(
		() => (imageUrl ? `${imageUrl}:${JSON.stringify(colorGraph ?? [])}` : null),
		[imageUrl, colorGraph],
	);
	const [frameState, setFrameState] = useState<{
		key: string;
		frame: ScopeFrame | null;
	} | null>(null);

	useEffect(() => {
		if (!imageUrl || !frameKey) return;
		let cancelled = false;
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => {
			if (cancelled) return;

			// E1: 256×144 다운샘플 캔버스
			const srcCanvas = document.createElement("canvas");
			srcCanvas.width = SAMPLE_WIDTH;
			srcCanvas.height = SAMPLE_HEIGHT;
			const srcCtx = srcCanvas.getContext("2d");
			if (!srcCtx) return;
			srcCtx.drawImage(img, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

			if (colorGraph?.length) {
				// D5: WebGL 색보정 → 출력 캔버스에서 픽셀 추출
				const outCanvas = document.createElement("canvas");
				outCanvas.width = SAMPLE_WIDTH;
				outCanvas.height = SAMPLE_HEIGHT;
				applyColorGradeToCanvas(outCanvas, srcCanvas, colorGraph);

				// WebGL은 GPU로 읽기 불가 → 2D ctx로 blit 후 getImageData
				const readCanvas = document.createElement("canvas");
				readCanvas.width = SAMPLE_WIDTH;
				readCanvas.height = SAMPLE_HEIGHT;
				const readCtx = readCanvas.getContext("2d");
				if (!readCtx) return;
				readCtx.drawImage(outCanvas, 0, 0);
				const data = readCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
				if (!cancelled)
					setFrameState({
						key: frameKey,
						frame: {
							width: SAMPLE_WIDTH,
							height: SAMPLE_HEIGHT,
							data: data.data,
						},
					});
			} else {
				// colorGraph 없음 — 원본 샘플링
				const data = srcCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
				if (!cancelled)
					setFrameState({
						key: frameKey,
						frame: {
							width: SAMPLE_WIDTH,
							height: SAMPLE_HEIGHT,
							data: data.data,
						},
					});
			}
		};
		img.onerror = () => {
			if (!cancelled) setFrameState({ key: frameKey, frame: null });
		};
		img.src = imageUrl;
		return () => {
			cancelled = true;
		};
	}, [imageUrl, colorGraph, frameKey]);

	return frameState?.key === frameKey ? frameState.frame : null;
}

// ── 캔버스 드로잉 함수 (E3: idle 콜백에서 호출) ──

function drawWaveform(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	wf: ReturnType<typeof computeWaveform>,
	frame: ScopeFrame | null,
) {
	canvas.width = 260;
	canvas.height = 144;
	const W = 260;
	const H = 144;
	ctx.fillStyle = "#0a0a0a";
	ctx.fillRect(0, 0, W, H);

	ctx.strokeStyle = "rgba(255,255,255,0.1)";
	for (let p = 0; p <= 4; p++) {
		const y = (H * p) / 4;
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(W, y);
		ctx.stroke();
	}

	const bins = 128;
	const cols = frame?.width ?? SAMPLE_WIDTH;
	const colWidth = W / cols;

	let maxCount = 1;
	for (let i = 0; i < wf.length; i++) {
		if (wf[i] > maxCount) maxCount = wf[i];
	}

	const imgData = ctx.createImageData(W, H);
	const d = imgData.data;

	for (let x = 0; x < cols; x++) {
		const px = Math.floor(x * colWidth);
		for (let bin = 0; bin < bins; bin++) {
			const count = wf[x * bins + bin];
			if (count === 0) continue;
			const intensity = Math.min(
				1,
				Math.log(1 + count) / Math.log(1 + maxCount),
			);
			const y = Math.floor((bin / bins) * H);
			const idx = (y * W + px) * 4;
			d[idx] = 220 * intensity;
			d[idx + 1] = 255 * intensity;
			d[idx + 2] = 220 * intensity;
			d[idx + 3] = 255;
		}
	}
	ctx.putImageData(imgData, 0, 0);

	ctx.fillStyle = "rgba(255,255,255,0.35)";
	ctx.font = "9px monospace";
	ctx.fillText("100", 2, 10);
	ctx.fillText("50", 2, H / 2 + 3);
	ctx.fillText("0", 2, H - 2);
}

function drawVectorscope(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	vs: ReturnType<typeof computeVectorscope>,
) {
	const size = 144;
	canvas.width = size;
	canvas.height = size;
	ctx.fillStyle = "#0a0a0a";
	ctx.fillRect(0, 0, size, size);

	ctx.strokeStyle = "rgba(255,255,255,0.1)";
	ctx.beginPath();
	ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
	ctx.stroke();
	ctx.strokeStyle = "rgba(255,100,100,0.25)";
	ctx.beginPath();
	ctx.moveTo(size / 2, size / 2);
	ctx.lineTo(size * 0.75, size * 0.4);
	ctx.stroke();

	let maxCount = 1;
	for (let i = 0; i < vs.length; i++) if (vs[i] > maxCount) maxCount = vs[i];

	const imgData = ctx.createImageData(size, size);
	const d = imgData.data;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const c = vs[y * size + x];
			if (c === 0) continue;
			const t = Math.min(1, Math.log(1 + c) / Math.log(1 + maxCount));
			const idx = (y * size + x) * 4;
			d[idx] = 255 * t;
			d[idx + 1] = 150 * t;
			d[idx + 2] = 120 * t;
			d[idx + 3] = 255;
		}
	}
	ctx.putImageData(imgData, 0, 0);

	ctx.fillStyle = "rgba(255,255,255,0.45)";
	ctx.font = "9px monospace";
	ctx.fillText("R", size * 0.78, size * 0.35);
	ctx.fillText("B", size * 0.2, size * 0.75);
	ctx.fillText("G", size * 0.15, size * 0.3);
}

function drawHistogram(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	norm: ReturnType<typeof normalizeHistogram>,
) {
	canvas.width = 200;
	canvas.height = 144;
	const W = 200;
	const H = 144;
	ctx.fillStyle = "#0a0a0a";
	ctx.fillRect(0, 0, W, H);

	const binW = W / norm.r.length;
	const drawChannel = (arr: Float32Array, color: string) => {
		ctx.fillStyle = color;
		for (let i = 0; i < arr.length; i++) {
			const h = arr[i] * (H - 4);
			ctx.fillRect(i * binW, H - h, Math.max(1, binW - 0.5), h);
		}
	};
	ctx.globalCompositeOperation = "lighter";
	drawChannel(norm.r, "rgba(239,68,68,0.5)");
	drawChannel(norm.g, "rgba(34,197,94,0.5)");
	drawChannel(norm.b, "rgba(59,130,246,0.5)");
	ctx.globalCompositeOperation = "source-over";
}

function drawParade(
	ctx: CanvasRenderingContext2D,
	canvas: HTMLCanvasElement,
	parade: ReturnType<typeof computeParade>,
) {
	canvas.width = 240;
	canvas.height = 144;
	const W = 240;
	const H = 144;
	ctx.fillStyle = "#0a0a0a";
	ctx.fillRect(0, 0, W, H);

	const colW = W / parade.r.length;
	const drawChannel = (arr: Float32Array, color: string) => {
		ctx.fillStyle = color;
		for (let i = 0; i < arr.length; i++) {
			const v = arr[i] * (H - 4);
			ctx.fillRect(i * colW, H - v, Math.max(1, colW - 0.5), v);
		}
	};
	ctx.globalCompositeOperation = "lighter";
	drawChannel(parade.r, "rgba(239,68,68,0.45)");
	drawChannel(parade.g, "rgba(34,197,94,0.45)");
	drawChannel(parade.b, "rgba(59,130,246,0.45)");
	ctx.globalCompositeOperation = "source-over";
}
