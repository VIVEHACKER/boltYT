/**
 * 무음 제거 유틸리티
 *
 * 1. Web Audio API로 오디오 분석 → 무음 구간 감지
 * 2. 서버(렌더 큐)에서 ffmpeg로 무음 구간 제거
 *
 * 쇼츠 최적화: 무음 구간을 제거하여 빠른 페이싱 유지
 */

// ─── 타입 ───

export interface SilenceSegment {
	/** 시작 시간 (초) */
	start: number;
	/** 끝 시간 (초) */
	end: number;
	/** 무음 구간 길이 (초) */
	duration: number;
}

export interface SilenceAnalysis {
	/** 전체 오디오 길이 (초) */
	totalDuration: number;
	/** 감지된 무음 구간들 */
	silences: SilenceSegment[];
	/** 무음 비율 (0-1) */
	silenceRatio: number;
	/** 무음 제거 후 예상 길이 (초) */
	estimatedTrimmedDuration: number;
}

// ─── 클라이언트 분석 (Web Audio API) ───

/**
 * 오디오 버퍼에서 무음 구간 감지
 *
 * @param audioBuffer Web Audio AudioBuffer
 * @param thresholdDb 무음 임계값 (dB). 기본 -40dB
 * @param minSilenceSec 최소 무음 길이 (초). 이보다 짧으면 무시. 기본 0.3초
 */
export function detectSilence(
	audioBuffer: AudioBuffer,
	thresholdDb = -40,
	minSilenceSec = 0.3,
): SilenceAnalysis {
	const sampleRate = audioBuffer.sampleRate;
	const channelData = audioBuffer.getChannelData(0);
	const totalDuration = audioBuffer.duration;

	// dB → 선형 진폭
	const thresholdLinear = 10 ** (thresholdDb / 20);

	// RMS 윈도우 크기 (50ms 단위)
	const windowSize = Math.floor(sampleRate * 0.05);
	const silences: SilenceSegment[] = [];

	let silenceStart: number | null = null;

	for (let i = 0; i < channelData.length; i += windowSize) {
		const end = Math.min(i + windowSize, channelData.length);

		// RMS 계산
		let sumSquares = 0;
		for (let j = i; j < end; j++) {
			sumSquares += channelData[j] * channelData[j];
		}
		const rms = Math.sqrt(sumSquares / (end - i));

		const currentTime = i / sampleRate;
		const isSilent = rms < thresholdLinear;

		if (isSilent && silenceStart === null) {
			silenceStart = currentTime;
		} else if (!isSilent && silenceStart !== null) {
			const duration = currentTime - silenceStart;
			if (duration >= minSilenceSec) {
				silences.push({
					start: silenceStart,
					end: currentTime,
					duration,
				});
			}
			silenceStart = null;
		}
	}

	// 끝까지 무음인 경우
	if (silenceStart !== null) {
		const duration = totalDuration - silenceStart;
		if (duration >= minSilenceSec) {
			silences.push({
				start: silenceStart,
				end: totalDuration,
				duration,
			});
		}
	}

	const totalSilence = silences.reduce((sum, s) => sum + s.duration, 0);

	return {
		totalDuration,
		silences,
		silenceRatio: totalDuration > 0 ? totalSilence / totalDuration : 0,
		estimatedTrimmedDuration: totalDuration - totalSilence,
	};
}

/**
 * ArrayBuffer에서 무음 분석 (편의 함수)
 */
export async function analyzeSilence(
	audioData: ArrayBuffer,
	options?: { thresholdDb?: number; minSilenceSec?: number },
): Promise<SilenceAnalysis> {
	const ctx = new AudioContext();
	try {
		const buffer = await ctx.decodeAudioData(audioData.slice(0));
		return detectSilence(
			buffer,
			options?.thresholdDb ?? -40,
			options?.minSilenceSec ?? 0.3,
		);
	} finally {
		await ctx.close();
	}
}

/**
 * 무음 구간을 고려한 씬 타이밍 재조정
 *
 * TTS 오디오에서 무음이 감지되면 씬 duration을 줄여서
 * 쇼츠 포맷의 빠른 페이싱을 유지합니다.
 *
 * @param sceneDurations 각 씬의 현재 duration (초)
 * @param sceneAnalyses 각 씬의 무음 분석 결과 (없으면 null)
 * @param minSceneDuration 최소 씬 길이 (초)
 * @returns 조정된 씬 duration 배열
 */
export function adjustSceneDurations(
	sceneDurations: number[],
	sceneAnalyses: Array<SilenceAnalysis | null>,
	minSceneDuration = 2,
): number[] {
	return sceneDurations.map((d, i) => {
		const analysis = sceneAnalyses[i];
		if (!analysis || analysis.silences.length === 0) return d;

		// 끝부분 무음만 제거 (TTS 후 trailing silence)
		const trailingSilence = analysis.silences.find(
			(s) => s.end >= analysis.totalDuration - 0.1,
		);
		if (trailingSilence) {
			const trimmed = d - trailingSilence.duration + 0.2; // 0.2초 버퍼
			return Math.max(minSceneDuration, Math.ceil(trimmed));
		}

		return d;
	});
}
