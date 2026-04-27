/**
 * 렌더 옵션 — codec / CRF / bitrate / preset.
 *
 * 4 단계 quality preset + 고급 override 조합으로 resolveRenderOptions() 가
 * 서버/CLI/UI 공통으로 사용할 ResolvedRenderOptions 반환.
 *
 * codec 선택 영향:
 *   - h264: 범용 호환(YouTube 업로드 권장), x264Preset 유효
 *   - h265: 동일 품질 대비 파일 크기 ~40% 작음, 호환성↓, x264Preset 무효 (x265 preset 별도)
 *   - vp9:  웹 스트리밍 최적, 인코딩 느림, x264/x265 preset 무효
 */

export type RenderCodec = "h264" | "h265" | "vp9";

export type RenderQualityPreset =
	| "draft"
	| "balanced"
	| "high"
	| "archive"
	| "shorts_60";

/**
 * Remotion hardware acceleration 옵션.
 * - disable:     소프트웨어 인코딩 (x264/x265) — 품질 최상, 느림
 * - if-possible: HW 인코더 있으면 사용 (macOS VideoToolbox / NVENC 등), 없으면 SW fallback
 * - required:    HW 인코딩 강제, 없으면 렌더 실패. 주의: crf 옵션과 함께 쓸 수 없음
 */
export type HardwareAccel = "disable" | "if-possible" | "required";

export type X264Preset =
	| "ultrafast"
	| "superfast"
	| "veryfast"
	| "faster"
	| "fast"
	| "medium"
	| "slow"
	| "slower"
	| "veryslow";

export interface RenderOptionsInput {
	/** Quality preset — 단일 지정 시 나머지 필드는 프리셋에서 계산 */
	preset?: RenderQualityPreset;
	codec?: RenderCodec;
	/** Constant Rate Factor — 낮을수록 고화질. h264: 14~28, h265: 16~30, vp9: 10~40 */
	crf?: number;
	/** "Mbps" 형식 예: "12M". 미지정 시 프리셋 값 */
	videoBitrate?: string;
	audioBitrate?: string;
	/** h264 only — 인코딩 속도/효율 trade-off */
	x264Preset?: X264Preset;
	/** 0~100. 중간 프레임 JPEG 품질 */
	jpegQuality?: number;
	/** Remotion hardware-acceleration (disable | if-possible | required) */
	hardwareAccel?: HardwareAccel;
}

export interface ResolvedRenderOptions {
	preset: RenderQualityPreset;
	codec: RenderCodec;
	crf: number;
	videoBitrate: string;
	audioBitrate: string;
	x264Preset: X264Preset;
	jpegQuality: number;
	pixelFormat: "yuv420p";
	hardwareAccel: HardwareAccel;
	/** HW 가속 사용 시 crf 대신 bitrate 만으로 품질 결정 (crf 플래그 제외) */
	useCrf: boolean;
}

/**
 * 각 preset 의 기본 파라미터 (h264 기준).
 * draft/balanced 는 속도 우선이라 HW 가속 기본 on, high/archive 는 품질 우선이라 off.
 */
const PRESETS: Record<
	RenderQualityPreset,
	Omit<ResolvedRenderOptions, "preset">
> = {
	draft: {
		codec: "h264",
		crf: 28,
		videoBitrate: "4M",
		audioBitrate: "128k",
		x264Preset: "ultrafast",
		jpegQuality: 75,
		pixelFormat: "yuv420p",
		hardwareAccel: "if-possible",
		useCrf: true,
	},
	balanced: {
		codec: "h264",
		crf: 23,
		videoBitrate: "8M",
		audioBitrate: "192k",
		x264Preset: "fast",
		jpegQuality: 85,
		pixelFormat: "yuv420p",
		hardwareAccel: "if-possible",
		useCrf: true,
	},
	high: {
		codec: "h264",
		crf: 18,
		videoBitrate: "12M",
		audioBitrate: "192k",
		x264Preset: "slow",
		jpegQuality: 95,
		pixelFormat: "yuv420p",
		hardwareAccel: "if-possible",
		useCrf: true,
	},
	archive: {
		codec: "h264",
		crf: 15,
		videoBitrate: "20M",
		audioBitrate: "320k",
		x264Preset: "veryslow",
		jpegQuality: 100,
		pixelFormat: "yuv420p",
		hardwareAccel: "disable",
		useCrf: true,
	},
	// 60fps 쇼츠 — 부드러운 모션, YouTube Shorts/TikTok 권장
	// 1080x1920 60fps + h264 High@4.2 호환, HW 가속으로 빠른 인코딩
	shorts_60: {
		codec: "h264",
		crf: 19,
		videoBitrate: "16M",
		audioBitrate: "256k",
		x264Preset: "medium",
		jpegQuality: 95,
		pixelFormat: "yuv420p",
		hardwareAccel: "if-possible",
		useCrf: true,
	},
};

export const DEFAULT_PRESET: RenderQualityPreset = "high";

/** UI 표시용 한국어 라벨 */
export const QUALITY_LABELS: Record<RenderQualityPreset, string> = {
	draft: "빠른 미리보기",
	balanced: "표준 화질",
	high: "고화질 (권장)",
	archive: "최고 품질",
	shorts_60: "쇼츠 60fps",
};

export const QUALITY_DESCRIPTIONS: Record<RenderQualityPreset, string> = {
	draft: "약 3배 빠름 · 4 Mbps · 하드웨어 가속 · 빠른 검수에 적합",
	balanced: "8 Mbps · 하드웨어 가속 · SNS 업로드용 균형 옵션",
	high: "12 Mbps · 소프트웨어 인코딩 · YouTube 업로드 권장",
	archive: "20 Mbps · 최고 화질 · 원본 보관 / 후속 편집용",
	shorts_60: "60fps 부드러운 모션 · 16 Mbps · TikTok / 쇼츠 최적화",
};

export const HARDWARE_LABELS: Record<HardwareAccel, string> = {
	disable: "SW 인코딩",
	"if-possible": "HW 가속 (가능 시)",
	required: "HW 가속 (강제)",
};

/** CRF 유효 범위 (codec 별 현실적 범위) */
export function crfRangeFor(codec: RenderCodec): { min: number; max: number } {
	switch (codec) {
		case "h265":
			return { min: 16, max: 30 };
		case "vp9":
			return { min: 10, max: 40 };
		default:
			return { min: 14, max: 28 };
	}
}

function clampCrf(codec: RenderCodec, crf: number): number {
	const { min, max } = crfRangeFor(codec);
	if (!Number.isFinite(crf)) return PRESETS.high.crf;
	return Math.max(min, Math.min(max, Math.round(crf)));
}

/**
 * preset + override 를 합쳐 실제 사용할 옵션을 확정.
 * - codec 이 h264 외일 때 x264Preset 은 CLI/API 에서 드롭
 * - hardwareAccel="required" 면 crf 옵션 비활성 (Remotion 가 crf+HW 조합 금지)
 *   → useCrf=false, bitrate 만 사용
 */
export function resolveRenderOptions(
	input: RenderOptionsInput = {},
): ResolvedRenderOptions {
	const preset = input.preset ?? DEFAULT_PRESET;
	const base = PRESETS[preset];
	const codec = input.codec ?? base.codec;
	const hardwareAccel = input.hardwareAccel ?? base.hardwareAccel;
	const useCrf = hardwareAccel !== "required";
	return {
		preset,
		codec,
		crf: clampCrf(codec, input.crf ?? base.crf),
		videoBitrate: input.videoBitrate ?? base.videoBitrate,
		audioBitrate: input.audioBitrate ?? base.audioBitrate,
		x264Preset: input.x264Preset ?? base.x264Preset,
		jpegQuality: Math.max(
			1,
			Math.min(100, Math.round(input.jpegQuality ?? base.jpegQuality)),
		),
		pixelFormat: "yuv420p",
		hardwareAccel,
		useCrf,
	};
}

/** Remotion CLI argv 배열로 변환 (`npx remotion render ...` 뒤에 append) */
export function toRemotionCliArgs(opts: ResolvedRenderOptions): string[] {
	const args = [
		"--codec",
		opts.codec,
		"--pixel-format",
		opts.pixelFormat,
		"--video-bitrate",
		opts.videoBitrate,
		"--audio-bitrate",
		opts.audioBitrate,
		"--jpeg-quality",
		String(opts.jpegQuality),
		"--hardware-acceleration",
		opts.hardwareAccel,
	];
	if (opts.useCrf) {
		args.push("--crf", String(opts.crf));
	}
	if (opts.codec === "h264") {
		args.push("--x264-preset", opts.x264Preset);
	}
	return args;
}

/** @remotion/renderer renderMedia() 에 넘길 옵션 객체 (CLI 외 경로) */
export function toRenderMediaOptions(
	opts: ResolvedRenderOptions,
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		codec: opts.codec,
		pixelFormat: opts.pixelFormat,
		videoBitrate: opts.videoBitrate,
		audioBitrate: opts.audioBitrate,
		jpegQuality: opts.jpegQuality,
		hardwareAcceleration: opts.hardwareAccel,
	};
	if (opts.useCrf) base.crf = opts.crf;
	if (opts.codec === "h264") base.x264Preset = opts.x264Preset;
	return base;
}
