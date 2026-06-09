/**
 * AI BGM 생성 — Stable Audio 2.5(fal.ai)로 고유 인스트루멘탈 BGM을 직접 생성하는 경로.
 *
 * 왜 AI 생성인가(리서치 검증): 나레이션 채널의 BGM은 ① 고유해야 하고("싸구려·반복" 회피)
 * ② Content ID claim이 안 걸려야 수익 풀 희석을 피한다. Stable Audio 2.5는 라이선스 학습데이터
 * 기반이라 Content ID에 매칭되지 않아(claim-free) 이 두 조건을 동시에 만족한다.
 * boltYT는 이미 fal.ai(영상)를 쓰므로 같은 큐 인프라를 재사용한다.
 *
 * 주의: 모델 출력에는 negative prompt 파라미터가 없어 "보컬 없음/저에너지/루프"를
 * 프롬프트 텍스트로 강제한다. raw 출력은 사람 큐레이션 + AI 고지 후 사용해야 수익화 안전.
 *
 * 순수 함수(buildBgmGenerationRequest/aiGeneratedBgmLicense)는 테스트 가능하고,
 * 실제 fal 호출(generateBgmTrack)은 얇은 래퍼다.
 */

import type { BgmMood, BgmTrack } from "./bgm";
import type { BgmLicense } from "./bgm-import";
import { getApiProxyUrl } from "./proxy";

export interface BgmGenerationRequest {
	prompt: string;
	seconds_total: number;
	guidance_scale?: number;
	num_inference_steps?: number;
	seed?: number;
}

export interface BgmGenerationOptions {
	/** 영상/씬 길이(초). seconds_total로 [10,190] clamp. 기본 60. */
	durationSeconds?: number;
	/** 나레이션 밑에 까는 베드인가 — 기본 true(저에너지·보컬 없음 강조). */
	forNarrationBed?: boolean;
	/** 추가 스타일 키워드(악기/장르). */
	styleHint?: string;
	/** 재현용 시드. */
	seed?: number;
	/** 실측/목표 BPM. */
	bpm?: number;
}

/** mood → Stable Audio 프롬프트(인스트루멘탈 언더스코어 묘사). */
const MOOD_PROMPTS: Record<BgmMood, string> = {
	dark: "dark ambient underscore, low drone, ominous cinematic horror tension",
	tense: "suspenseful tension bed, pulsing low strings, thriller underscore",
	mysterious:
		"mysterious investigative underscore, sparse piano, subtle pads, detective mood",
	dramatic:
		"dramatic cinematic underscore, emotional strings, slow build swell",
	calm: "calm peaceful ambient bed, soft piano and warm pads, gentle",
	upbeat: "light upbeat background, soft pop groove, positive but unobtrusive",
	epic: "epic cinematic bed, restrained orchestral, trailer underscore",
	sad: "melancholic emotional underscore, slow piano, reflective",
};

const MIN_SECONDS = 10;
/** Stable Audio 2.5 기본 최대 길이. */
const MAX_SECONDS = 190;
const DEFAULT_SECONDS = 60;

/**
 * mood + 옵션 → Stable Audio 생성 요청. 나레이션 베드는 보컬 없음/저에너지/루프를
 * 프롬프트로 강제해 음성 위를 덮지 않게 한다.
 */
export function buildBgmGenerationRequest(
	mood: BgmMood,
	opts: BgmGenerationOptions = {},
): BgmGenerationRequest {
	const moodDesc = MOOD_PROMPTS[mood] ?? MOOD_PROMPTS.calm;
	const parts = [moodDesc];
	if (opts.styleHint?.trim()) parts.push(opts.styleHint.trim());
	if (opts.bpm && opts.bpm > 0)
		parts.push(`around ${Math.round(opts.bpm)} BPM`);
	if (opts.forNarrationBed !== false) {
		parts.push(
			"instrumental only, no vocals, no lyrics, low energy, minimal percussion, loopable background bed, leaves headroom for a voiceover",
		);
	} else {
		parts.push("instrumental, no vocals");
	}
	const requested = opts.durationSeconds ?? DEFAULT_SECONDS;
	const seconds_total = Math.round(
		Math.max(MIN_SECONDS, Math.min(MAX_SECONDS, requested)),
	);
	const request: BgmGenerationRequest = {
		prompt: parts.join(", "),
		seconds_total,
		guidance_scale: 1,
		num_inference_steps: 8,
	};
	if (opts.seed !== undefined) request.seed = opts.seed;
	return request;
}

/**
 * AI 생성 트랙의 라이선스 — 우리가 생성했으므로 owned 성격, Content ID claim 없음(claim-free).
 * bgm-import의 assessImportedBgmClaimReadiness에서 cleared로 판정된다.
 */
export function aiGeneratedBgmLicense(): BgmLicense {
	return {
		basis: "ai_generated",
		contentId: { claimExpected: false, clearMethod: "claim_free" },
		attribution: "Generated with Stable Audio 2.5 (fal.ai)",
	};
}

export interface GenerateBgmResult {
	track: BgmTrack;
	audioUrl: string;
	requestId?: string;
}

/**
 * Stable Audio 2.5(fal.ai)로 BGM 생성 → BgmTrack 반환.
 * 서버 /api/fal/audio-gen 이 fal 큐를 폴링하고 audio_url을 돌려준다.
 */
export async function generateBgmTrack(
	mood: BgmMood,
	opts: BgmGenerationOptions = {},
): Promise<GenerateBgmResult> {
	const request = buildBgmGenerationRequest(mood, opts);
	const proxy = getApiProxyUrl();
	const res = await fetch(`${proxy}/api/fal/audio-gen`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ provider: "stableAudio25", input: request }),
		signal: AbortSignal.timeout(300_000),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`BGM 생성 실패: ${res.status} ${text.slice(0, 200)}`);
	}
	const data = (await res.json()) as {
		audio_url?: string;
		request_id?: string;
	};
	if (!data.audio_url) {
		throw new Error("BGM 생성 응답에 audio_url 이 없습니다");
	}
	const seedSuffix = opts.seed !== undefined ? `-${opts.seed}` : "";
	const track: BgmTrack = {
		id: `ai-${mood}-${request.seconds_total}s${seedSuffix}`,
		title: `AI ${mood} bed (${request.seconds_total}s)`,
		artist: "Stable Audio 2.5",
		duration: request.seconds_total,
		previewUrl: data.audio_url,
		downloadUrl: data.audio_url,
		tags: [mood, "ai-generated", "instrumental"],
		source: "ai-generated",
		license: aiGeneratedBgmLicense(),
	};
	return { track, audioUrl: data.audio_url, requestId: data.request_id };
}
