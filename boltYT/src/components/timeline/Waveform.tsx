/**
 * Waveform — 오디오 URL에서 peaks 추출해 canvas 렌더.
 */

import { useEffect, useRef, useState } from "react";

import { drawWaveform, extractPeaks } from "../../lib/waveform";

interface Props {
	audioUrl: string;
	widthPx: number;
	height: number;
	color?: string;
}

export function Waveform({ audioUrl, widthPx, height, color }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [peaks, setPeaks] = useState<Float32Array>(new Float32Array(0));

	// Snap to 50px buckets — avoids re-extracting peaks on every zoom frame
	const stableWidth = Math.max(10, Math.round(widthPx / 50) * 50);

	// Extract peaks only when url or quantized width changes
	useEffect(() => {
		if (!audioUrl) return;
		let cancelled = false;
		const numPeaks = Math.max(10, Math.floor(stableWidth / 2));
		void extractPeaks(audioUrl, numPeaks).then((extracted) => {
			if (cancelled) return;
			setPeaks(extracted);
		});
		return () => {
			cancelled = true;
		};
	}, [audioUrl, stableWidth]);

	// Redraw when peaks, canvas size, or color changes
	useEffect(() => {
		if (!canvasRef.current || peaks.length === 0) return;
		canvasRef.current.width = Math.max(1, widthPx);
		canvasRef.current.height = height;
		drawWaveform(canvasRef.current, peaks, { color });
	}, [peaks, widthPx, height, color]);

	return (
		<canvas
			ref={canvasRef}
			style={{ width: widthPx, height, display: "block" }}
			role="img"
			aria-label="audio waveform"
		/>
	);
}
