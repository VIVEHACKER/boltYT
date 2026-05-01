/**
 * AI 영상 생성 프롬프트 강화 — 씬 메타데이터 → cinematography 키워드.
 *
 * 입력: visual_prompt (raw) + scene 메타 (mood / shot_type / camera_motion /
 * lighting_style) + 출력 포맷 (shorts vs longform).
 * 출력: fal.ai prompt 문자열 + aspect_ratio + camera commands.
 *
 * 순수 함수 — DOM 의존 없음. 단위 테스트 용이.
 */

import type { SceneDirective } from "./ai-agents";

export type SceneMood = "horror" | "mystery" | "news" | "neutral" | "warm";
export type LightingStyle = "dark" | "natural" | "bright" | "mixed";
export type ScriptFormat = "shorts" | "longform";

export type AspectRatio = "9:16" | "16:9" | "1:1";

export interface SceneEnrichInput {
	rawPrompt: string;
	mood?: SceneMood;
	shotType?: SceneDirective["shot_type"];
	cameraMotion?: SceneDirective["camera_motion"];
	lighting?: LightingStyle;
	format?: ScriptFormat;
	/** 시청자 시선 → 핵심 피사체. 클로즈업 / 인서트 강조. */
	subjectFocus?: string;
	/**
	 * 레퍼런스 템플릿의 dominant_colors (hex 배열). 자연어 팔레트 키워드로 변환.
	 * 예: ["#1a2b3c", "#d2a36f"] → "deep navy and warm amber color palette"
	 */
	dominantColors?: string[];
	/** referenceTemplate.visual_prompt_template (있으면 raw 와 병합) */
	stylePromptTemplate?: string;
}

export interface EnrichedPrompt {
	prompt: string;
	aspectRatio: AspectRatio;
	cameraCommands: string[]; // hailuo 용 [Push in] 등
}

// ─── mood → cinematography 키워드 매핑 ────────────────────────────────────────

const MOOD_KEYWORDS: Record<SceneMood, string> = {
	horror:
		"tense low-key lighting, deep shadows, desaturated cool palette, slight handheld unease, ominous atmosphere",
	mystery:
		"misty atmosphere, soft volumetric haze, muted teal palette, suspenseful framing, cryptic mood",
	news: "clean documentary look, neutral white balance, sharp focus, balanced exposure, journalistic clarity",
	warm: "golden hour warm tones, soft natural backlight, gentle skin highlights, intimate inviting feel",
	neutral:
		"natural color balance, even ambient lighting, photorealistic, neutral grade",
};

const LIGHTING_KEYWORDS: Record<LightingStyle, string> = {
	dark: "low-key dramatic lighting, deep contrast, controlled rim light",
	natural: "natural daylight, soft window light, organic shadows",
	bright: "high-key bright lighting, soft fill, clean shadows",
	mixed: "mixed practical lighting, layered light sources",
};

// shot type 별 framing 지시
const SHOT_TYPE_KEYWORDS: Record<
	NonNullable<SceneEnrichInput["shotType"]>,
	string
> = {
	wide: "wide establishing shot, full environmental context",
	medium: "medium framing, eye-level perspective, natural body language",
	close_up: "close-up framing, expressive detail, shallow depth of field",
	extreme_close: "extreme close-up, ultra-shallow focus, emotive micro-detail",
	aerial: "high aerial perspective, sweeping overhead view, geographic scale",
};

// camera motion → 키워드
const CAMERA_MOTION_KEYWORDS: Record<
	NonNullable<SceneEnrichInput["cameraMotion"]>,
	{ keyword: string; hailuo: string }
> = {
	static: {
		keyword: "locked-off camera, stable composition",
		hailuo: "Static shot",
	},
	slow_pan: {
		keyword: "slow horizontal pan, smooth tracking",
		hailuo: "Pan right",
	},
	zoom_in: {
		keyword: "slow forward dolly, gradual zoom-in",
		hailuo: "Push in",
	},
	zoom_out: {
		keyword: "slow pull-back, revealing zoom-out",
		hailuo: "Pull out",
	},
	handheld: {
		keyword: "subtle handheld documentary motion, organic micro-shake",
		hailuo: "Tracking shot",
	},
	tilt_up: {
		keyword: "rising vertical tilt, ascending reveal",
		hailuo: "Tilt up",
	},
	tilt_down: {
		keyword: "descending vertical tilt, downward reveal",
		hailuo: "Tilt down",
	},
};

const SHARED_QUALITY =
	"cinematic, 35mm film look, shallow depth of field, professional color grading, sharp focus, 4K";

// ─── hex → 자연어 색상 라벨 ───────────────────────────────────────────────────

interface ColorLabel {
	name: string;
	hue: [number, number]; // [min, max] degrees
	minSat: number; // 0~1
	maxVal: number; // 0~1 (어두움 판정)
	minVal: number; // 0~1 (밝음 판정)
}

// 우선순위: 어두움/밝음/회색 먼저 판정 → 색상 그룹
const COLOR_LABELS: ColorLabel[] = [
	{ name: "deep red", hue: [0, 15], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "warm amber", hue: [15, 50], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "golden yellow", hue: [50, 70], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "olive green", hue: [70, 100], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "forest green", hue: [100, 160], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "teal", hue: [160, 200], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "deep navy", hue: [200, 240], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "violet", hue: [240, 290], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "magenta", hue: [290, 340], minSat: 0.3, maxVal: 1, minVal: 0 },
	{ name: "crimson", hue: [340, 360], minSat: 0.3, maxVal: 1, minVal: 0 },
];

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
	const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
	if (!m) return null;
	const n = Number.parseInt(m[1], 16);
	const r = ((n >> 16) & 0xff) / 255;
	const g = ((n >> 8) & 0xff) / 255;
	const b = (n & 0xff) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const s = max === 0 ? 0 : d / max;
	const v = max;
	return { h, s, v };
}

function colorLabel(hex: string): string | null {
	const hsv = hexToHsv(hex);
	if (!hsv) return null;
	if (hsv.v < 0.18) return "deep charcoal";
	if (hsv.s < 0.15) {
		if (hsv.v > 0.85) return "soft white";
		if (hsv.v > 0.55) return "muted gray";
		return "slate gray";
	}
	const found = COLOR_LABELS.find((l) => hsv.h >= l.hue[0] && hsv.h < l.hue[1]);
	return found?.name ?? null;
}

/** dominant hex 배열 → 자연어 팔레트 키워드. 중복 제거 + 최대 3개. */
export function colorsToKeyword(colors: string[]): string {
	const labels = new Set<string>();
	for (const c of colors) {
		const label = colorLabel(c);
		if (label) labels.add(label);
		if (labels.size >= 3) break;
	}
	if (labels.size === 0) return "";
	const list = Array.from(labels);
	if (list.length === 1) return `${list[0]} color palette`;
	if (list.length === 2) return `${list[0]} and ${list[1]} color palette`;
	return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]} color palette`;
}

// ─── 본 함수 ──────────────────────────────────────────────────────────────────

export function enrichVideoPrompt(input: SceneEnrichInput): EnrichedPrompt {
	const parts: string[] = [];

	const raw = (input.rawPrompt ?? "").trim();
	if (raw) parts.push(raw);

	if (input.subjectFocus?.trim()) {
		parts.push(`focus on ${input.subjectFocus.trim()}`);
	}

	if (input.shotType && SHOT_TYPE_KEYWORDS[input.shotType]) {
		parts.push(SHOT_TYPE_KEYWORDS[input.shotType]);
	}

	const motionMap = input.cameraMotion
		? CAMERA_MOTION_KEYWORDS[input.cameraMotion]
		: undefined;
	if (motionMap) parts.push(motionMap.keyword);

	if (input.mood && MOOD_KEYWORDS[input.mood]) {
		parts.push(MOOD_KEYWORDS[input.mood]);
	}

	if (input.lighting && LIGHTING_KEYWORDS[input.lighting]) {
		parts.push(LIGHTING_KEYWORDS[input.lighting]);
	}

	if (input.dominantColors && input.dominantColors.length > 0) {
		const palette = colorsToKeyword(input.dominantColors);
		if (palette) parts.push(palette);
	}

	if (input.stylePromptTemplate?.trim()) {
		parts.push(input.stylePromptTemplate.trim());
	}

	// 중복 cinematic 방지: raw 에 이미 포함이면 스킵
	if (!/cinematic|film look|color grading/i.test(raw)) {
		parts.push(SHARED_QUALITY);
	}

	const prompt = parts.join(", ");

	const aspectRatio: AspectRatio =
		input.format === "shorts"
			? "9:16"
			: input.format === "longform"
				? "16:9"
				: "16:9";

	const cameraCommands: string[] = [];
	if (motionMap?.hailuo) cameraCommands.push(motionMap.hailuo);

	return { prompt, aspectRatio, cameraCommands };
}

/** 시드를 모든 씬에 동일하게 적용하기 위한 결정론적 시드 생성기 (script_id 해시) */
export function deriveLockedSeed(scriptId: string): number {
	// FNV-1a hash → 31-bit 정수
	let hash = 2166136261;
	for (let i = 0; i < scriptId.length; i++) {
		hash ^= scriptId.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 1; // 양의 정수 (0 ~ 2^31-1)
}
