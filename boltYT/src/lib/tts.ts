/**
 * 통합 TTS 서비스 — OpenAI + ElevenLabs
 *
 * 음성 선택, 속도 조절, 프로바이더 자동 라우팅
 */

import { storeLocalFile } from "./local-db";
import { getApiProxyUrl } from "./proxy";
import { supabase } from "./supabase";

// ─── 타입 ───

export type TtsProvider = "openai" | "elevenlabs";

export interface TtsVoice {
	id: string;
	name: string;
	provider: TtsProvider;
	/** 미리듣기 설명 */
	description: string;
	/** 한국어 지원 */
	korean: boolean;
}

export interface TtsOptions {
	voice?: string;
	provider?: TtsProvider;
	speed?: number;
}

export interface NarrationTtsSignal {
	narration?: string;
	mood?: string;
	type?: string;
}

// ─── 음성 목록 ───

export const OPENAI_VOICES: TtsVoice[] = [
	{
		id: "alloy",
		name: "Alloy",
		provider: "openai",
		description: "중성적, 균형 잡힌 톤",
		korean: true,
	},
	{
		id: "ash",
		name: "Ash",
		provider: "openai",
		description: "따뜻하고 부드러운 남성",
		korean: true,
	},
	{
		id: "ballad",
		name: "Ballad",
		provider: "openai",
		description: "감성적이고 표현력 있는",
		korean: true,
	},
	{
		id: "coral",
		name: "Coral",
		provider: "openai",
		description: "밝고 명확한 여성",
		korean: true,
	},
	{
		id: "echo",
		name: "Echo",
		provider: "openai",
		description: "차분하고 안정된 남���",
		korean: true,
	},
	{
		id: "fable",
		name: "Fable",
		provider: "openai",
		description: "이야기꾼 스타일, 표현력 풍부",
		korean: true,
	},
	{
		id: "nova",
		name: "Nova",
		provider: "openai",
		description: "자연스럽고 따뜻한 여성 (기본)",
		korean: true,
	},
	{
		id: "onyx",
		name: "Onyx",
		provider: "openai",
		description: "깊고 권위 있는 남성",
		korean: true,
	},
	{
		id: "sage",
		name: "Sage",
		provider: "openai",
		description: "지적이고 차분한",
		korean: true,
	},
	{
		id: "shimmer",
		name: "Shimmer",
		provider: "openai",
		description: "밝고 에너지 넘치는 여성",
		korean: true,
	},
];

/** ElevenLabs 인기 한국어 음성 (계정에 따라 다를 수 있음) */
export const ELEVENLABS_DEFAULT_VOICES: TtsVoice[] = [
	{
		id: "EXAVITQu4vr4xnSDxMaL",
		name: "Bella",
		provider: "elevenlabs",
		description: "젊은 여성, 부드럽고 따뜻한",
		korean: true,
	},
	{
		id: "ErXwobaYiN019PkySvjV",
		name: "Antoni",
		provider: "elevenlabs",
		description: "차분한 남성, 나레이션용",
		korean: true,
	},
	{
		id: "VR6AewLTigWG4xSOukaG",
		name: "Arnold",
		provider: "elevenlabs",
		description: "깊은 남성, 다큐멘터리 톤",
		korean: true,
	},
	{
		id: "pNInz6obpgDQGcFmaJgB",
		name: "Adam",
		provider: "elevenlabs",
		description: "명확한 남성, 뉴스 앵커 톤",
		korean: true,
	},
	{
		id: "21m00Tcm4TlvDq8ikWAM",
		name: "Rachel",
		provider: "elevenlabs",
		description: "성숙한 여성, 차분하고 신뢰감",
		korean: true,
	},
];

/**
 * 사용 가능한 모든 음성 목록
 * — 호출자가 현재 api-proxy의 ElevenLabs 키 활성 여부(useApiKeys)를 넘겨야 함
 */
export function getAvailableVoices(elevenLabsEnabled = false): TtsVoice[] {
	const voices = [...OPENAI_VOICES];
	if (elevenLabsEnabled) {
		voices.push(...ELEVENLABS_DEFAULT_VOICES);
	}
	return voices;
}

/** 특정 음성 찾기 */
export function findVoice(voiceId: string): TtsVoice | undefined {
	return [...OPENAI_VOICES, ...ELEVENLABS_DEFAULT_VOICES].find(
		(v) => v.id === voiceId,
	);
}

/** 저장된 기본 음성 설정 */
export function getDefaultVoice(): {
	voice: string;
	provider: TtsProvider;
	speed: number;
} {
	const storedVoice =
		typeof localStorage !== "undefined"
			? localStorage.getItem("tts_voice")
			: null;
	const storedProvider =
		typeof localStorage !== "undefined"
			? localStorage.getItem("tts_provider")
			: null;
	const storedSpeed =
		typeof localStorage !== "undefined"
			? localStorage.getItem("tts_speed")
			: null;
	return {
		voice: storedVoice ?? "sage",
		provider: (storedProvider as TtsProvider) ?? "openai",
		speed: Number(storedSpeed ?? "0.97"),
	};
}

export function setDefaultVoice(
	voice: string,
	provider: TtsProvider,
	speed: number,
) {
	localStorage.setItem("tts_voice", voice);
	localStorage.setItem("tts_provider", provider);
	localStorage.setItem("tts_speed", String(speed));
}

export function hasStoredTtsSettings(): boolean {
	if (typeof localStorage === "undefined") return false;
	return Boolean(
		localStorage.getItem("tts_voice") ||
			localStorage.getItem("tts_provider") ||
			localStorage.getItem("tts_speed"),
	);
}

function countMatches(text: string, patterns: RegExp[]): number {
	return patterns.reduce(
		(sum, pattern) => sum + (pattern.test(text) ? 1 : 0),
		0,
	);
}

export function inferNarrationTtsOptions(
	scenes: NarrationTtsSignal[],
): TtsOptions {
	const combinedNarration = scenes
		.map((scene) => scene.narration?.trim() ?? "")
		.filter(Boolean)
		.join(" ");
	const lower = combinedNarration.toLowerCase();
	const moods = scenes.map((scene) => scene.mood ?? "");
	const mysteryMoodCount = moods.filter(
		(mood) => mood === "mystery" || mood === "horror",
	).length;
	const warmMoodCount = moods.filter((mood) => mood === "warm").length;
	const newsMoodCount = moods.filter((mood) => mood === "news").length;
	const videoSceneCount = scenes.filter(
		(scene) => scene.type === "video",
	).length;

	const suspenseScore =
		mysteryMoodCount +
		countMatches(lower, [
			/실종/u,
			/살해/u,
			/범인/u,
			/추적/u,
			/수사/u,
			/의혹/u,
			/미제/u,
			/협박/u,
			/cctv/u,
			/evidence/u,
			/missing/u,
			/murder/u,
			/investigation/u,
		]);
	const newsScore =
		newsMoodCount +
		countMatches(lower, [
			/속보/u,
			/발표/u,
			/공개/u,
			/확인/u,
			/브리핑/u,
			/news/u,
			/report/u,
		]);
	const warmScore =
		warmMoodCount +
		countMatches(lower, [
			/가족/u,
			/아이/u,
			/기억/u,
			/눈물/u,
			/희망/u,
			/마음/u,
			/family/u,
			/hope/u,
		]);
	const upbeatScore = countMatches(lower, [
		/반전/u,
		/놀라운/u,
		/드디어/u,
		/성공/u,
		/기록/u,
		/upbeat/u,
		/viral/u,
	]);

	if (suspenseScore >= 2) {
		return {
			voice: videoSceneCount >= Math.ceil(scenes.length / 2) ? "sage" : "ash",
			provider: "openai",
			speed: 0.93,
		};
	}

	if (newsScore >= 2) {
		return {
			voice: "sage",
			provider: "openai",
			speed: 0.96,
		};
	}

	if (warmScore >= 2) {
		return {
			voice: "ash",
			provider: "openai",
			speed: 0.95,
		};
	}

	if (upbeatScore >= 2) {
		return {
			voice: "coral",
			provider: "openai",
			speed: 1.01,
		};
	}

	return {
		voice: "sage",
		provider: "openai",
		speed: 0.97,
	};
}

// ─── TTS 생성 ───

/** AudioContext 동시 사용 제한 (브라우저 한계 6개) */
let activeAudioCtxCount = 0;
const audioCtxQueue: (() => void)[] = [];
const MAX_AUDIO_CTX = 4;

function acquireAudioCtx(): Promise<void> {
	if (activeAudioCtxCount < MAX_AUDIO_CTX) {
		activeAudioCtxCount++;
		return Promise.resolve();
	}
	return new Promise((resolve) =>
		audioCtxQueue.push(() => {
			activeAudioCtxCount++;
			resolve();
		}),
	);
}

function releaseAudioCtx() {
	activeAudioCtxCount--;
	const next = audioCtxQueue.shift();
	if (next) next();
}

/** 오디오 실제 재생 시간 측정 */
export async function getAudioDuration(buffer: ArrayBuffer): Promise<number> {
	await acquireAudioCtx();
	const audioCtx = new AudioContext();
	try {
		const decoded = await audioCtx.decodeAudioData(buffer.slice(0));
		return decoded.duration;
	} finally {
		await audioCtx.close();
		releaseAudioCtx();
	}
}

function durationToSceneSeconds(duration: number): number {
	return Math.max(1.2, Number(duration.toFixed(2)));
}

export function inferNarrationPauseSeconds(
	text: string,
	isLastScene = false,
): number {
	if (isLastScene) return 0;

	const trimmed = text.trim();
	if (!trimmed) return 0.14;

	let pause = 0.14;

	if (/[.!?]$/.test(trimmed)) pause += 0.06;
	if (/[!?]$/.test(trimmed)) pause += 0.04;
	if (/(?:\.\.\.|…)$/.test(trimmed)) pause += 0.06;
	if (/[:;]$/.test(trimmed)) pause += 0.03;

	const commaCount = (trimmed.match(/[,，]/g) ?? []).length;
	pause += Math.min(0.05, commaCount * 0.015);

	if (trimmed.length >= 70) pause += 0.03;
	if (trimmed.length >= 130) pause += 0.02;

	return Math.min(0.34, Number(pause.toFixed(2)));
}

function concatNarrationBuffers(
	audioContext: AudioContext,
	segments: Array<{ buffer: AudioBuffer; pauseSeconds: number }>,
): AudioBuffer {
	if (segments.length === 0) {
		return audioContext.createBuffer(1, 1, audioContext.sampleRate);
	}

	const channelCount = Math.max(
		1,
		...segments.map((segment) => segment.buffer.numberOfChannels),
	);
	const sampleRate = segments[0].buffer.sampleRate;
	const totalFrames = segments.reduce((sum, segment) => {
		const pauseFrames = Math.max(
			0,
			Math.round(segment.pauseSeconds * sampleRate),
		);
		return sum + segment.buffer.length + pauseFrames;
	}, 0);

	const merged = audioContext.createBuffer(
		channelCount,
		totalFrames,
		sampleRate,
	);
	let offset = 0;

	for (const segment of segments) {
		for (let channel = 0; channel < channelCount; channel++) {
			const target = merged.getChannelData(channel);
			const sourceChannel =
				segment.buffer.numberOfChannels === 1
					? 0
					: Math.min(channel, segment.buffer.numberOfChannels - 1);
			const source = segment.buffer.getChannelData(sourceChannel);
			target.set(source, offset);
		}
		offset += segment.buffer.length;
		offset += Math.max(0, Math.round(segment.pauseSeconds * sampleRate));
	}

	return merged;
}

/** OpenAI TTS 호출 (프록시 경유) */
async function callOpenAiTts(
	text: string,
	voice: string,
	speed: number,
): Promise<ArrayBuffer> {
	const proxy = getApiProxyUrl();

	const res = await fetch(`${proxy}/api/openai/tts`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "tts-1-hd",
			input: text,
			voice,
			response_format: "mp3",
			speed,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenAI TTS 오류: ${res.status} ${err}`);
	}

	return res.arrayBuffer();
}

/** ElevenLabs TTS 호출 (프록시 경유) */
async function callElevenLabsTts(
	text: string,
	voiceId: string,
	speed: number,
): Promise<ArrayBuffer> {
	const proxy = getApiProxyUrl();

	const res = await fetch(`${proxy}/api/elevenlabs/tts/${voiceId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text,
			model_id: "eleven_multilingual_v2",
			voice_settings: {
				stability: 0.58,
				similarity_boost: 0.72,
				style: 0.12,
				use_speaker_boost: true,
				speed,
			},
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`ElevenLabs 오류: ${res.status} ${err}`);
	}

	return res.arrayBuffer();
}

/** 통합 TTS 단일 청크 생성 */
export async function generateTtsChunk(
	text: string,
	options?: TtsOptions,
): Promise<ArrayBuffer> {
	const defaults = getDefaultVoice();
	const provider = options?.provider ?? defaults.provider;
	const voice = options?.voice ?? defaults.voice;
	const speed = options?.speed ?? defaults.speed;

	if (provider === "elevenlabs") {
		return callElevenLabsTts(text, voice, speed);
	}
	return callOpenAiTts(text, voice, speed);
}

/** Whisper로 오디오 전사 → word timings 추출 (프레임 단위) */
async function transcribeToWordTimings(
	audioBuffer: ArrayBuffer,
	durationFrames: number,
	fps = 30,
): Promise<Array<{ word: string; startFrame: number; endFrame: number }>> {
	const proxy = getApiProxyUrl();

	const form = new FormData();
	form.append(
		"file",
		new Blob([audioBuffer], { type: "audio/mpeg" }),
		"audio.mp3",
	);
	form.append("model", "whisper-1");
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "word");

	try {
		const res = await fetch(`${proxy}/api/openai/transcribe`, {
			method: "POST",
			body: form,
		});
		if (!res.ok) return [];

		const data = (await res.json()) as {
			words?: Array<{ word: string; start: number; end: number }>;
		};
		if (!data.words || data.words.length === 0) return [];

		return data.words.map((w) => ({
			word: w.word.trim(),
			startFrame: Math.max(0, Math.round(w.start * fps)),
			endFrame: Math.min(durationFrames, Math.round(w.end * fps)),
		}));
	} catch {
		return [];
	}
}

/** 씬별 TTS 생성 → DSP 처리 → IndexedDB 저장 → Whisper word timings */
export async function generateSceneTts(
	sceneId: string,
	narrationText: string,
	options?: TtsOptions,
	audioEffects?: import("./audio-effects").AudioEffect[],
): Promise<{ url: string; duration: number }> {
	const rawBuffer = await generateTtsChunk(narrationText, options);

	// Voice DSP 처리 (HP + presence + deesser + comp + loudness) + 선택적 clip effects
	const { processVoice } = await import("./voice-dsp");
	const dsp = await processVoice(rawBuffer, audioEffects ?? []);
	const finalBuffer = dsp.buffer;

	const duration = await getAudioDuration(finalBuffer);
	const sceneDuration = Math.ceil(duration) + 1;

	// Whisper — 원본 버퍼로 전사 (DSP로 인한 artifact 방지)
	const durationFrames = Math.ceil(duration * 30);
	const wordTimings = await transcribeToWordTimings(rawBuffer, durationFrames);

	await supabase
		.from("scenes")
		.update({
			duration_seconds: sceneDuration,
			word_timings: wordTimings,
		})
		.eq("id", sceneId);

	const bytes = new Uint8Array(finalBuffer);
	const ext = dsp.mimeType === "audio/wav" ? "wav" : "mp3";
	const storagePath = `scenes/${sceneId}/tts.${ext}`;
	const url = await storeLocalFile(storagePath, bytes, dsp.mimeType);

	await supabase.from("media_assets").insert({
		scene_id: sceneId,
		type: "tts_audio",
		storage_path: storagePath,
		status: "complete",
		generation_params: { voice_dsp: dsp.processed },
	});

	return { url, duration: sceneDuration };
}

/**
 * 전체 나레이션을 하나의 연속 오디오로 생성
 * — 씬별 TTS를 생성한 뒤 실제 발화 길이 + 숨 고르기 pause 기준으로 합성
 */
export async function generateContinuousNarration(
	scriptId: string,
	scenes: Array<{ id: string; narration_text: string }>,
	options?: TtsOptions,
): Promise<{ url: string; totalDuration: number; sceneDurations: number[] }> {
	if (scenes.length === 0) {
		return { url: "", totalDuration: 0, sceneDurations: [] };
	}

	const { encodeWav, getAudioContext, processVoice } = await import(
		"./voice-dsp"
	);
	const audioContext = getAudioContext();
	const preparedSegments: Array<{
		sceneId: string;
		buffer: AudioBuffer;
		pauseSeconds: number;
		sceneDuration: number;
		wordTimings: Array<{ word: string; startFrame: number; endFrame: number }>;
	}> = [];

	for (let index = 0; index < scenes.length; index++) {
		const scene = scenes[index];
		const rawBuffer = await generateTtsChunk(scene.narration_text, options);
		const dsp = await processVoice(rawBuffer, []);
		const decoded = await audioContext.decodeAudioData(dsp.buffer.slice(0));
		const pauseSeconds = inferNarrationPauseSeconds(
			scene.narration_text,
			index === scenes.length - 1,
		);
		const sceneDuration = durationToSceneSeconds(
			decoded.duration + pauseSeconds,
		);
		const durationFrames = Math.max(1, Math.round(decoded.duration * 30));
		const wordTimings = await transcribeToWordTimings(
			rawBuffer,
			durationFrames,
		);

		preparedSegments.push({
			sceneId: scene.id,
			buffer: decoded,
			pauseSeconds,
			sceneDuration,
			wordTimings,
		});
	}

	const merged = concatNarrationBuffers(
		audioContext,
		preparedSegments.map((segment) => ({
			buffer: segment.buffer,
			pauseSeconds: segment.pauseSeconds,
		})),
	);
	const wavBuffer = encodeWav(merged);
	const storagePath = `scripts/${scriptId}/narration.wav`;
	const url = await storeLocalFile(
		storagePath,
		new Uint8Array(wavBuffer),
		"audio/wav",
	);
	const totalDuration = Number(merged.duration.toFixed(2));
	const sceneDurations = preparedSegments.map(
		(segment) => segment.sceneDuration,
	);

	await Promise.all(
		preparedSegments.map((segment, index) =>
			supabase
				.from("scenes")
				.update({
					duration_seconds: sceneDurations[index],
					word_timings: segment.wordTimings,
				})
				.eq("id", segment.sceneId),
		),
	);

	localStorage.setItem(`narration_path_${scriptId}`, storagePath);

	return { url, totalDuration, sceneDurations };
}
