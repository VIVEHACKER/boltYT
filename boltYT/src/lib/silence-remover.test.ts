import { describe, expect, it } from "vitest";
import {
	adjustSceneDurations,
	detectSilence,
	type SilenceAnalysis,
} from "./silence-remover";

function makeAudioBuffer(samples: number[], sampleRate = 44100): AudioBuffer {
	return {
		sampleRate,
		duration: samples.length / sampleRate,
		numberOfChannels: 1,
		length: samples.length,
		getChannelData: () => new Float32Array(samples),
		copyFromChannel: () => {},
		copyToChannel: () => {},
	} as unknown as AudioBuffer;
}

describe("adjustSceneDurations", () => {
	it("trailing silence가 없으면 원래 duration 유지", () => {
		const durations = [5, 8, 10];
		const analyses: Array<SilenceAnalysis | null> = [null, null, null];
		expect(adjustSceneDurations(durations, analyses)).toEqual([5, 8, 10]);
	});

	it("trailing silence가 있으면 duration 줄임", () => {
		const durations = [10, 8, 12];
		const analyses: Array<SilenceAnalysis | null> = [
			{
				totalDuration: 10,
				silences: [{ start: 7.5, end: 10, duration: 2.5 }],
				silenceRatio: 0.25,
				estimatedTrimmedDuration: 7.5,
			},
			null,
			null,
		];
		const result = adjustSceneDurations(durations, analyses);
		// 10 - 2.5 + 0.2 = 7.7 → ceil → 8
		expect(result[0]).toBe(8);
		expect(result[1]).toBe(8);
		expect(result[2]).toBe(12);
	});

	it("minSceneDuration 미만으로 줄이지 않음", () => {
		const durations = [3];
		const analyses: Array<SilenceAnalysis | null> = [
			{
				totalDuration: 3,
				silences: [{ start: 0.5, end: 3, duration: 2.5 }],
				silenceRatio: 0.83,
				estimatedTrimmedDuration: 0.5,
			},
		];
		const result = adjustSceneDurations(durations, analyses, 2);
		expect(result[0]).toBe(2);
	});

	it("중간 무음은 무시 (trailing만 처리)", () => {
		const durations = [10];
		const analyses: Array<SilenceAnalysis | null> = [
			{
				totalDuration: 10,
				silences: [{ start: 3, end: 5, duration: 2 }],
				silenceRatio: 0.2,
				estimatedTrimmedDuration: 8,
			},
		];
		// 중간 무음 — end(5) < totalDuration(10) - 0.1 이므로 trailing 아님
		expect(adjustSceneDurations(durations, analyses)).toEqual([10]);
	});

	it("빈 배열 처리", () => {
		expect(adjustSceneDurations([], [])).toEqual([]);
	});
});

// ─── detectSilence ────────────────────────────────────────────────────────────
describe("detectSilence", () => {
	it("빈 버퍼 → silences 빈 배열, ratio 0", () => {
		const buf = makeAudioBuffer([]);
		const result = detectSilence(buf);
		expect(result.silences).toEqual([]);
		expect(result.silenceRatio).toBe(0);
	});

	it("완전 무음 버퍼 → 무음 구간 감지", () => {
		// 1초 분량 44100 샘플 모두 0 → 완전 무음
		const samples = new Array(44100).fill(0);
		const buf = makeAudioBuffer(samples, 44100);
		const result = detectSilence(buf);
		expect(result.silenceRatio).toBeGreaterThan(0);
		expect(result.totalDuration).toBeCloseTo(1, 1);
	});

	it("완전 유음 버퍼 → 무음 없음", () => {
		// 모든 샘플이 1.0 (최대 진폭) → 무음 없음
		const samples = new Array(44100).fill(1.0);
		const buf = makeAudioBuffer(samples, 44100);
		const result = detectSilence(buf);
		expect(result.silences).toHaveLength(0);
		expect(result.silenceRatio).toBe(0);
	});

	it("중간 무음 구간 감지", () => {
		const sampleRate = 44100;
		// 0.5초 유음 + 0.5초 무음 + 0.5초 유음 = 1.5초
		const loud = new Array(Math.floor(sampleRate * 0.5)).fill(1.0);
		const silent = new Array(Math.floor(sampleRate * 0.5)).fill(0.0);
		const buf = makeAudioBuffer([...loud, ...silent, ...loud], sampleRate);
		const result = detectSilence(buf, -40, 0.1);
		expect(result.silences.length).toBeGreaterThan(0);
	});

	it("estimatedTrimmedDuration = totalDuration - totalSilence", () => {
		const sampleRate = 44100;
		const loud = new Array(Math.floor(sampleRate * 0.5)).fill(1.0);
		const silent = new Array(Math.floor(sampleRate * 0.5)).fill(0.0);
		const buf = makeAudioBuffer([...loud, ...silent], sampleRate);
		const result = detectSilence(buf, -40, 0.1);
		const totalSilence = result.silences.reduce(
			(s, seg) => s + seg.duration,
			0,
		);
		expect(result.estimatedTrimmedDuration).toBeCloseTo(
			result.totalDuration - totalSilence,
			1,
		);
	});
});
