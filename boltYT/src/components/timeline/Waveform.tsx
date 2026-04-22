/**
 * Waveform — 오디오 URL에서 peaks 추출해 canvas 렌더.
 */

import { useEffect, useRef } from "react";
import { drawWaveform, extractPeaks } from "../../lib/waveform";

interface Props {
	audioUrl: string;
	widthPx: number;
	height: number;
	color?: string;
}

export function Waveform({ audioUrl, widthPx, height, color }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (!audioUrl || !canvasRef.current) return;
		let cancelled = false;

		const canvas = canvasRef.current;
		canvas.width = Math.max(1, widthPx);
		canvas.height = height;

		const numPeaks = Math.max(10, Math.floor(widthPx / 2));
		void extractPeaks(audioUrl, numPeaks).then((peaks) => {
			if (cancelled || !canvasRef.current) return;
			drawWaveform(canvasRef.current, peaks, { color });
		});

		return () => {
			cancelled = true;
		};
	}, [audioUrl, widthPx, height, color]);

	return (
		<canvas
			ref={canvasRef}
			style={{ width: widthPx, height, display: "block" }}
			aria-hidden="true"
		/>
	);
}
