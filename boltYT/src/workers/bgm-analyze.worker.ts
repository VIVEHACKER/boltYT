/**
 * bgm-analyze Web Worker — analyzeAudioBuffer 분석 루프를 메인 스레드 밖으로 이동.
 *
 * 메시지 입력:  { channelData: Float32Array, sampleRate: number, duration: number }
 * 메시지 출력:  BgmAnalysis
 */

import type { BgmAnalysis } from "../lib/bgm-analyze";

const MIN_BPM = 60;
const MAX_BPM = 180;
const WINDOW_SIZE_SEC = 0.05;
const ENERGY_THRESHOLD_MULT = 1.4;

function analyzeChannelData(
	channelData: Float32Array,
	sampleRate: number,
	duration: number,
): BgmAnalysis {
	const windowSize = Math.floor(sampleRate * WINDOW_SIZE_SEC);

	const envelope: number[] = [];
	for (let i = 0; i < channelData.length; i += windowSize) {
		let sum = 0;
		const end = Math.min(i + windowSize, channelData.length);
		for (let j = i; j < end; j++) {
			const s = channelData[j];
			sum += s * s;
		}
		envelope.push(Math.sqrt(sum / (end - i)));
	}

	if (envelope.length === 0) return { bpm: 0, beats: [], confidence: 0 };

	const avgEnergy = envelope.reduce((a, b) => a + b, 0) / envelope.length;
	const onsets: number[] = [];
	const threshold = avgEnergy * ENERGY_THRESHOLD_MULT;
	for (let i = 2; i < envelope.length - 1; i++) {
		const prev = (envelope[i - 1] + envelope[i - 2]) / 2;
		const curr = envelope[i];
		if (curr > threshold && curr > prev * 1.15) {
			const timeSec = (i * windowSize) / sampleRate;
			if (onsets.length === 0 || timeSec - onsets[onsets.length - 1] > 0.1) {
				onsets.push(timeSec);
			}
		}
	}

	if (onsets.length < 4) return { bpm: 0, beats: [], confidence: 0 };

	const intervals: number[] = [];
	for (let i = 1; i < onsets.length; i++) {
		const d = onsets[i] - onsets[i - 1];
		if (d >= 60 / MAX_BPM && d <= 60 / MIN_BPM) intervals.push(d);
	}

	if (intervals.length < 3) return { bpm: 0, beats: [], confidence: 0 };

	const sortedIntervals = [...intervals].sort((a, b) => a - b);
	const medianInterval =
		sortedIntervals[Math.floor(sortedIntervals.length / 2)];

	let bpm = Math.round(60 / medianInterval);
	while (bpm > MAX_BPM) bpm = Math.round(bpm / 2);
	while (bpm < MIN_BPM) bpm = Math.round(bpm * 2);

	const tolerance = medianInterval * 0.1;
	const inBand = intervals.filter(
		(i) => Math.abs(i - medianInterval) <= tolerance,
	).length;
	const confidence = Math.min(1, inBand / intervals.length);

	const beatInterval = 60 / bpm;
	const firstBeat = onsets[0];
	const beats: number[] = [];
	for (let t = firstBeat; t < duration; t += beatInterval) {
		beats.push(Number(t.toFixed(3)));
	}

	return { bpm, beats, confidence };
}

self.onmessage = (
	e: MessageEvent<{
		channelData: Float32Array;
		sampleRate: number;
		duration: number;
	}>,
) => {
	const { channelData, sampleRate, duration } = e.data;
	const result = analyzeChannelData(channelData, sampleRate, duration);
	self.postMessage(result);
};
