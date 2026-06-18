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
export type OpenAiTtsModel = "tts-1" | "tts-1-hd" | "gpt-4o-mini-tts";

type NarrationProfile = "suspense" | "news" | "warm" | "upbeat" | "neutral";

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
	openAiModel?: OpenAiTtsModel;
	direction?: string;
	toneKeywords?: string[];
	endingHoldSeconds?: number;
}

export interface NarrationTtsSignal {
	narration?: string;
	mood?: string;
	type?: string;
}

const OPENAI_DEFAULT_MODEL: OpenAiTtsModel = "tts-1-hd";
const OPENAI_DIRECTION_MODEL: OpenAiTtsModel = "gpt-4o-mini-tts";

const PROFILE_TONE_KEYWORDS: Record<NarrationProfile, string[]> = {
	suspense: ["긴장감", "절제", "다큐 톤", "단서 강조"],
	news: ["정확함", "또박또박", "브리핑", "냉정함"],
	warm: ["따뜻함", "절제된 감정", "여운", "공감"],
	upbeat: ["속도감", "선명한 강조", "에너지", "반전 포인트"],
	neutral: ["차분함", "명료함", "다큐 톤"],
};

const PROFILE_ENDING_HOLD: Record<NarrationProfile, number> = {
	suspense: 0.42,
	news: 0.28,
	warm: 0.38,
	upbeat: 0.24,
	neutral: 0.32,
};

/**
 * 벤치마크 profile(suspense/news/warm/upbeat/neutral)을 실제 TtsOptions 로 변환한다.
 * TtsOptions 에는 profile 필드가 없어 provider 가 읽지 못하므로, toneKeywords/endingHold
 * 로 풀어야 retake 가 실제로 톤을 교정한다. 미지원 profile 은 빈 객체.
 */
export function ttsOverrideForProfile(profile: string): Partial<TtsOptions> {
	// own-key 체크 — profile 은 fix params 의 임의 문자열이라 'constructor'/'toString'
	// 같은 상속 키가 in 연산자를 통과하는 prototype pollution 을 막는다.
	if (!Object.hasOwn(PROFILE_TONE_KEYWORDS, profile)) return {};
	const resolved = profile as NarrationProfile;
	const toneKeywords = PROFILE_TONE_KEYWORDS[resolved];
	return {
		toneKeywords,
		endingHoldSeconds: PROFILE_ENDING_HOLD[resolved],
		// generateContinuousNarration 은 options.direction 을 그대로 OpenAI 에 전달하므로
		// (재합성 안 함) 타깃 profile 의 direction 까지 함께 줘야 톤이 실제로 바뀐다.
		direction: buildNarrationDirection(resolved, toneKeywords),
	};
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
	// ── 한국어 네이티브 보이스(ElevenLabs 라이브러리) ──
	// 무료 티어는 402(유료 필요). Starter($5/mo+) 전환 시 즉시 선택 가능 — 영어 음색이 아닌 진짜 한국어 발음.
	{
		id: "YDseIkMzKtO5bK1Ehnev",
		name: "Hanabad (한국어)",
		provider: "elevenlabs",
		description: "한국어 네이티브 여성, 차분·친근 — 브이로그 추천 (유료)",
		korean: true,
	},
	{
		id: "uD0jH1cfRqteeku18ODi",
		name: "Jiana (한국어)",
		provider: "elevenlabs",
		description: "한국어 네이티브 여성, 또렷한 — 정보전달 (유료)",
		korean: true,
	},
	{
		id: "abvGngm3lj2e4QONbyCH",
		name: "Gogh Lee (한국어)",
		provider: "elevenlabs",
		description: "한국어 네이티브 남성, 스토리텔링 (유료)",
		korean: true,
	},
	{
		id: "cuXUjH0CSJkKipo0Hy9i",
		name: "Hyunsu (한국어)",
		provider: "elevenlabs",
		description: "한국어 네이티브 남성, 팟캐스트 톤 (유료)",
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
		// 기본 ElevenLabs(유튜버 표준·고품질). 이 환경에선 OpenAI 가 빌링 한도라 ElevenLabs 가 기본.
		// 무료 티어는 클래식 보이스(Bella)만 — 한국어 네이티브(Hanabad 등)는 유료 플랜에서 선택.
		voice: storedVoice ?? "EXAVITQu4vr4xnSDxMaL",
		provider: (storedProvider as TtsProvider) ?? "elevenlabs",
		speed: Number(storedSpeed ?? "1.0"),
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

function uniqueToneKeywords(groups: Array<string[] | undefined>): string[] {
	const merged = groups
		.flatMap((group) => group ?? [])
		.map((item) => item.trim());
	return [...new Set(merged.filter(Boolean))].slice(0, 6);
}

function resolveNarrationProfile(
	scenes: NarrationTtsSignal[],
	extraToneKeywords: string[] = [],
): NarrationProfile {
	const combinedNarration = scenes
		.map((scene) => scene.narration?.trim() ?? "")
		.filter(Boolean)
		.join(" ");
	const lower = combinedNarration.toLowerCase();
	const toneHints = extraToneKeywords.join(" ").toLowerCase();
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
		]) +
		countMatches(toneHints, [/긴장/u, /서스펜스/u, /미스터리/u, /다큐/u]);
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
		]) +
		countMatches(toneHints, [/브리핑/u, /정확/u, /앵커/u, /또박/u]);
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
		]) +
		countMatches(toneHints, [/따뜻/u, /공감/u, /여운/u, /잔잔/u]);
	const upbeatScore =
		countMatches(lower, [
			/반전/u,
			/놀라운/u,
			/드디어/u,
			/성공/u,
			/기록/u,
			/upbeat/u,
			/viral/u,
		]) +
		countMatches(toneHints, [/속도/u, /에너지/u, /강조/u, /반전/u]) +
		(videoSceneCount >= Math.ceil(Math.max(scenes.length, 1) / 2) ? 1 : 0);

	if (suspenseScore >= 2) return "suspense";
	if (newsScore >= 2) return "news";
	if (warmScore >= 2) return "warm";
	if (upbeatScore >= 2) return "upbeat";
	return "neutral";
}

function buildNarrationDirection(
	profile: NarrationProfile,
	toneKeywords: string[],
): string {
	const toneSuffix =
		toneKeywords.length > 0
			? ` 톤 키워드는 ${toneKeywords.join(", ")} 중심으로 유지할 것.`
			: "";

	switch (profile) {
		case "suspense":
			return `한국어 사건 다큐 나레이션. 차분하고 낮은 톤으로 시작하고, 핵심 단서에서만 짧게 힘을 줄 것. 과장하거나 감탄사처럼 읽지 말고 문장 끝을 서두르지 말 것.${toneSuffix}`;
		case "news":
			return `한국어 브리핑 나레이션. 또박또박 정확하게 읽고, 숫자와 고유명사를 선명하게 발음할 것. 감정 과장을 줄이고 단정한 앵커 톤을 유지할 것.${toneSuffix}`;
		case "warm":
			return `한국어 휴먼스토리 나레이션. 부드럽고 절제된 감정으로 읽고, 문장 사이에 짧게 숨을 둘 것. 울먹이거나 지나치게 감상적으로 읽지 말 것.${toneSuffix}`;
		case "upbeat":
			return `한국어 숏폼 나레이션. 템포는 빠르되 발음은 분명하게 유지하고, 반전 포인트에서만 짧게 에너지를 줄 것. 과한 하이텐션보다 리듬감 있는 전달을 우선할 것.${toneSuffix}`;
		default:
			return `한국어 설명형 나레이션. 차분하고 명료하게 읽고, 문장마다 짧은 호흡을 유지할 것. 과장 없이 다큐멘터리 톤을 유지할 것.${toneSuffix}`;
	}
}

function inferProfileFromOptions(options?: TtsOptions): NarrationProfile {
	const hints = [options?.direction, (options?.toneKeywords ?? []).join(" ")]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();

	if (/긴장|서스펜스|미스터리|단서|추적/.test(hints)) return "suspense";
	if (/브리핑|정확|앵커|뉴스|또박/.test(hints)) return "news";
	if (/따뜻|공감|여운|잔잔|휴먼/.test(hints)) return "warm";
	if (/속도|에너지|반전|강조|숏폼/.test(hints)) return "upbeat";
	return "neutral";
}

function getElevenLabsVoiceSettings(options: TtsOptions, speed: number) {
	const profile = inferProfileFromOptions(options);
	switch (profile) {
		case "suspense":
			return {
				stability: 0.5,
				similarity_boost: 0.76,
				style: 0.28,
				use_speaker_boost: true,
				speed,
			};
		case "news":
			return {
				stability: 0.68,
				similarity_boost: 0.74,
				style: 0.1,
				use_speaker_boost: true,
				speed,
			};
		case "warm":
			return {
				stability: 0.62,
				similarity_boost: 0.7,
				style: 0.18,
				use_speaker_boost: true,
				speed,
			};
		case "upbeat":
			return {
				stability: 0.52,
				similarity_boost: 0.74,
				style: 0.22,
				use_speaker_boost: true,
				speed,
			};
		default:
			return {
				stability: 0.58,
				similarity_boost: 0.72,
				style: 0.12,
				use_speaker_boost: true,
				speed,
			};
	}
}

export function inferNarrationTtsOptions(
	scenes: NarrationTtsSignal[],
): TtsOptions {
	const profile = resolveNarrationProfile(scenes);
	const videoSceneCount = scenes.filter(
		(scene) => scene.type === "video",
	).length;

	if (profile === "suspense") {
		return {
			voice: videoSceneCount >= Math.ceil(scenes.length / 2) ? "sage" : "ash",
			provider: "openai",
			speed: 0.93,
		};
	}

	if (profile === "news") {
		return {
			voice: "sage",
			provider: "openai",
			speed: 0.96,
		};
	}

	if (profile === "warm") {
		return {
			voice: "ash",
			provider: "openai",
			speed: 0.95,
		};
	}

	if (profile === "upbeat") {
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

export function composeNarrationTtsOptions(
	scenes: NarrationTtsSignal[],
	baseOptions: TtsOptions = {},
): TtsOptions {
	const inferred = inferNarrationTtsOptions(scenes);
	const profile = resolveNarrationProfile(
		scenes,
		baseOptions.toneKeywords ?? [],
	);
	const provider = baseOptions.provider ?? inferred.provider;
	const toneKeywords = uniqueToneKeywords([
		PROFILE_TONE_KEYWORDS[profile],
		baseOptions.toneKeywords,
	]);
	const direction =
		baseOptions.direction ?? buildNarrationDirection(profile, toneKeywords);

	return {
		...inferred,
		...baseOptions,
		toneKeywords,
		direction,
		openAiModel:
			provider === "openai"
				? (baseOptions.openAiModel ??
					(direction ? OPENAI_DIRECTION_MODEL : OPENAI_DEFAULT_MODEL))
				: undefined,
		endingHoldSeconds: Math.max(
			baseOptions.endingHoldSeconds ?? 0,
			PROFILE_ENDING_HOLD[profile],
		),
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

export function inferNarrationEndingHoldSeconds(
	text: string,
	options?: TtsOptions,
): number {
	const trimmed = text.trim();
	let hold = options?.endingHoldSeconds ?? PROFILE_ENDING_HOLD.neutral;

	if (!trimmed) {
		return Number(hold.toFixed(2));
	}
	if (/[.!?]$/.test(trimmed)) hold += 0.04;
	if (/[!?]$/.test(trimmed)) hold += 0.03;
	if (/(?:\.\.\.|…)$/.test(trimmed)) hold += 0.06;
	if (trimmed.length >= 70) hold += 0.04;
	if (trimmed.length >= 130) hold += 0.03;

	return Math.min(0.52, Number(hold.toFixed(2)));
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
	options?: TtsOptions,
): Promise<ArrayBuffer> {
	const proxy = getApiProxyUrl();
	const model =
		options?.openAiModel ??
		(options?.direction ? OPENAI_DIRECTION_MODEL : OPENAI_DEFAULT_MODEL);
	const body: Record<string, unknown> = {
		model,
		input: text,
		voice,
		response_format: "mp3",
		speed,
	};
	if (options?.direction && model === OPENAI_DIRECTION_MODEL) {
		body.instructions = options.direction;
	}

	const res = await fetch(`${proxy}/api/openai/tts`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
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
	options?: TtsOptions,
): Promise<ArrayBuffer> {
	const proxy = getApiProxyUrl();

	const res = await fetch(`${proxy}/api/elevenlabs/tts/${voiceId}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text,
			model_id: "eleven_multilingual_v2",
			voice_settings: getElevenLabsVoiceSettings(options ?? {}, speed),
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
		return callElevenLabsTts(text, voice, speed, options);
	}
	return callOpenAiTts(text, voice, speed, options);
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
			false,
		);
		const endingHoldSeconds =
			index === scenes.length - 1
				? inferNarrationEndingHoldSeconds(scene.narration_text, options)
				: 0;
		const sceneDuration = durationToSceneSeconds(
			decoded.duration + pauseSeconds + endingHoldSeconds,
		);
		const durationFrames = Math.max(1, Math.round(decoded.duration * 30));
		const wordTimings = await transcribeToWordTimings(
			rawBuffer,
			durationFrames,
		);

		preparedSegments.push({
			sceneId: scene.id,
			buffer: decoded,
			pauseSeconds: pauseSeconds + endingHoldSeconds,
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
