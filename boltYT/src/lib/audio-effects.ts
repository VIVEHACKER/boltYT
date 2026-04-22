/**
 * @AX:ANCHOR 오디오 이펙트 체인 모델
 * @AX:REASON timeline clip 오디오 속성 / voice-dsp / 렌더 파이프라인이 공통 사용.
 *
 * 각 이펙트는 직렬 적용. 권장 순서(FX_ORDER): EQ → 컴프 → 딜레이 → 리버브 → 게인.
 * 값 범위/기본값은 preset 에 저장 — 실제 WebAudio 노드 빌드는 buildEffectNodes 에서.
 */

export type AudioEffectKind = "eq3" | "delay" | "reverb" | "gain";

export interface Eq3Effect {
	kind: "eq3";
	/** -12 ~ +12 dB */
	low: number;
	mid: number;
	high: number;
	/** 중역 중심 주파수 (Hz) — 기본 1000 */
	midFreq?: number;
}

export interface DelayEffect {
	kind: "delay";
	/** 딜레이 시간 (s), 0~2 */
	time: number;
	/** 피드백 (0-0.9) */
	feedback: number;
	/** wet mix (0-1) */
	wet: number;
}

export type ReverbPreset = "room" | "hall" | "plate";

export interface ReverbEffect {
	kind: "reverb";
	preset: ReverbPreset;
	/** wet mix (0-1) */
	wet: number;
	/** decay (s), 0.2-8 */
	decay: number;
}

export interface GainEffect {
	kind: "gain";
	/** dB, -24 ~ +12 */
	db: number;
}

export type AudioEffect = Eq3Effect | DelayEffect | ReverbEffect | GainEffect;

export const FX_ORDER: Record<AudioEffectKind, number> = {
	eq3: 1,
	gain: 2,
	delay: 3,
	reverb: 4,
};

export const REVERB_DECAY_DEFAULTS: Record<ReverbPreset, number> = {
	room: 0.8,
	hall: 2.4,
	plate: 1.6,
};

/** preset 호출용 factory — 각 타입 기본값 반환 */
export function defaultEffect(kind: AudioEffectKind): AudioEffect {
	switch (kind) {
		case "eq3":
			return { kind: "eq3", low: 0, mid: 0, high: 0, midFreq: 1000 };
		case "delay":
			return { kind: "delay", time: 0.25, feedback: 0.3, wet: 0.25 };
		case "reverb":
			return {
				kind: "reverb",
				preset: "room",
				wet: 0.2,
				decay: REVERB_DECAY_DEFAULTS.room,
			};
		case "gain":
			return { kind: "gain", db: 0 };
	}
}

/** 값 클램핑 — UI 슬라이더 범위 벗어나는 값 방지 */
export function clampEffect(e: AudioEffect): AudioEffect {
	switch (e.kind) {
		case "eq3":
			return {
				...e,
				low: clamp(e.low, -12, 12),
				mid: clamp(e.mid, -12, 12),
				high: clamp(e.high, -12, 12),
				midFreq: e.midFreq ? clamp(e.midFreq, 200, 5000) : 1000,
			};
		case "delay":
			return {
				...e,
				time: clamp(e.time, 0, 2),
				feedback: clamp(e.feedback, 0, 0.9),
				wet: clamp(e.wet, 0, 1),
			};
		case "reverb":
			return {
				...e,
				wet: clamp(e.wet, 0, 1),
				decay: clamp(e.decay, 0.2, 8),
			};
		case "gain":
			return { ...e, db: clamp(e.db, -24, 12) };
	}
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

/** 체인 정렬 — FX_ORDER 기준으로 안정적 재정렬 */
export function orderChain(effects: AudioEffect[]): AudioEffect[] {
	return [...effects].sort((a, b) => FX_ORDER[a.kind] - FX_ORDER[b.kind]);
}

/**
 * dB → linear gain
 */
export function dbToGain(db: number): number {
	return 10 ** (db / 20);
}

/**
 * 임펄스 리스펀스 합성 (리버브) — Noise with exponential decay.
 * 테스트 가능한 순수 함수 형태 (AudioContext 미사용 — 샘플 수 기반 Float32Array 반환).
 */
export function synthReverbIR(
	sampleRate: number,
	decay: number,
	preset: ReverbPreset,
): Float32Array {
	const length = Math.max(64, Math.floor(sampleRate * decay));
	const ir = new Float32Array(length);
	// plate 는 살짝 밝게 (low-pass 없이 원시 화이트노이즈)
	// hall 은 좀 더 매끄럽게 — 이웃 샘플 평균(간이 필터)
	for (let i = 0; i < length; i++) {
		const t = i / length;
		const env = (1 - t) ** 2;
		ir[i] = (Math.random() * 2 - 1) * env;
	}
	if (preset === "hall") {
		for (let i = 1; i < length; i++) {
			ir[i] = (ir[i] + ir[i - 1]) * 0.5;
		}
	}
	return ir;
}
