/**
 * Waveform — 오디오 URL에서 peak array 추출 + 캐시.
 * 타임라인 에디터에서 시각화용.
 */

const cache = new Map<string, Float32Array>();

/**
 * 오디오 URL → peak array (정규화된 0-1 값들).
 * @param url 오디오 blob URL 또는 정적 경로
 * @param numPeaks 반환할 peak 개수 (타임라인 너비 × pixel-per-peak)
 */
export async function extractPeaks(
	url: string,
	numPeaks = 500,
): Promise<Float32Array> {
	const cacheKey = `${url}:${numPeaks}`;
	const cached = cache.get(cacheKey);
	if (cached) return cached;

	try {
		const res = await fetch(url);
		if (!res.ok) return new Float32Array(0);
		const arrayBuf = await res.arrayBuffer();

		const AudioCtx =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext: typeof AudioContext })
				.webkitAudioContext;
		const ctx = new AudioCtx();
		const audioBuffer = await ctx.decodeAudioData(arrayBuf);
		const channel = audioBuffer.getChannelData(0);

		const samplesPerPeak = Math.floor(channel.length / numPeaks);
		const peaks = new Float32Array(numPeaks);

		for (let i = 0; i < numPeaks; i++) {
			let max = 0;
			const start = i * samplesPerPeak;
			const end = Math.min(start + samplesPerPeak, channel.length);
			for (let j = start; j < end; j++) {
				const v = Math.abs(channel[j]);
				if (v > max) max = v;
			}
			peaks[i] = max;
		}

		void ctx.close();
		cache.set(cacheKey, peaks);
		return peaks;
	} catch {
		return new Float32Array(0);
	}
}

/** Canvas에 waveform 그리기 */
export function drawWaveform(
	canvas: HTMLCanvasElement,
	peaks: Float32Array,
	options?: { color?: string; background?: string },
): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const { width, height } = canvas;
	const mid = height / 2;
	const color = options?.color ?? "rgba(0, 200, 255, 0.85)";
	const background = options?.background ?? "transparent";

	ctx.clearRect(0, 0, width, height);
	if (background !== "transparent") {
		ctx.fillStyle = background;
		ctx.fillRect(0, 0, width, height);
	}

	if (peaks.length === 0) return;

	const barWidth = width / peaks.length;
	ctx.fillStyle = color;
	for (let i = 0; i < peaks.length; i++) {
		const barHeight = peaks[i] * mid * 0.95;
		const x = i * barWidth;
		ctx.fillRect(
			x,
			mid - barHeight,
			Math.max(1, barWidth - 0.5),
			barHeight * 2,
		);
	}
}

export function clearWaveformCache(): void {
	cache.clear();
}
