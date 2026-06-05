/**
 * 썸네일 자동 생성 — Canvas 기반
 *
 * 씬 이미지 + 타이틀 텍스트 오버레이 → 1280x720 YouTube 표준 썸네일
 */

import { storeLocalFile } from "./local-db";
import type {
	ReferenceThumbnailDna,
	ThumbnailTextZone,
} from "./thumbnail-intelligence";

const THUMB_WIDTH = 1280;
const THUMB_HEIGHT = 720;

export interface ThumbnailOptions {
	/** 배경 이미지 URL (씬 이미지 중 선택) */
	backgroundUrl: string;
	/** 메인 타이틀 (큰 글씨) */
	title: string;
	/** 서브타이틀 (선택) */
	subtitle?: string;
	/** 채널명 (좌상단) */
	channelName?: string;
	/** 색상 테마 */
	accentColor?: string;
	/** 스타일 프리셋 */
	preset?: ThumbnailPreset;
	/** 레퍼런스 기반 클릭 패키징 배지 */
	badgeText?: string;
	/** 레퍼런스 기반 텍스트 안전 영역 */
	textZone?: ThumbnailTextZone;
	/** 레퍼런스 썸네일 DNA */
	referenceDna?: ReferenceThumbnailDna;
}

export type ThumbnailPreset =
	| "mystery"
	| "news"
	| "dramatic"
	| "minimal"
	| "bold";

interface PresetConfig {
	overlayColor: string;
	overlayOpacity: number;
	titleColor: string;
	titleSize: number;
	titleStroke: string;
	titleStrokeWidth: number;
	subtitleColor: string;
	accentBar: boolean;
	vignetteStrength: number;
}

const PRESETS: Record<ThumbnailPreset, PresetConfig> = {
	mystery: {
		overlayColor: "#0a0a2e",
		overlayOpacity: 0.55,
		titleColor: "#ffffff",
		titleSize: 72,
		titleStroke: "#000000",
		titleStrokeWidth: 4,
		subtitleColor: "#f59e0b",
		accentBar: true,
		vignetteStrength: 0.7,
	},
	news: {
		overlayColor: "#1a1a1a",
		overlayOpacity: 0.4,
		titleColor: "#ffffff",
		titleSize: 68,
		titleStroke: "#000000",
		titleStrokeWidth: 3,
		subtitleColor: "#ef4444",
		accentBar: true,
		vignetteStrength: 0.4,
	},
	dramatic: {
		overlayColor: "#000000",
		overlayOpacity: 0.5,
		titleColor: "#ffffff",
		titleSize: 80,
		titleStroke: "#000000",
		titleStrokeWidth: 5,
		subtitleColor: "#fbbf24",
		accentBar: false,
		vignetteStrength: 0.8,
	},
	minimal: {
		overlayColor: "#000000",
		overlayOpacity: 0.3,
		titleColor: "#ffffff",
		titleSize: 64,
		titleStroke: "#000000",
		titleStrokeWidth: 2,
		subtitleColor: "#d1d5db",
		accentBar: false,
		vignetteStrength: 0.3,
	},
	bold: {
		overlayColor: "#1e1b4b",
		overlayOpacity: 0.6,
		titleColor: "#fbbf24",
		titleSize: 84,
		titleStroke: "#000000",
		titleStrokeWidth: 6,
		subtitleColor: "#ffffff",
		accentBar: true,
		vignetteStrength: 0.6,
	},
};

/** 이미지 로드 헬퍼 */
function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});
}

/** 텍스트 자동 줄바꿈 */
function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string[] {
	const words = text.split("");
	const lines: string[] = [];
	let currentLine = "";

	for (const char of words) {
		const testLine = currentLine + char;
		const metrics = ctx.measureText(testLine);
		if (metrics.width > maxWidth && currentLine.length > 0) {
			lines.push(currentLine);
			currentLine = char;
		} else {
			currentLine = testLine;
		}
	}
	if (currentLine) lines.push(currentLine);

	return lines;
}

function fitTitleText(
	ctx: CanvasRenderingContext2D,
	title: string,
	baseSize: number,
	maxWidth: number,
	maxLines = 3,
): { lines: string[]; fontSize: number } {
	for (let fontSize = baseSize; fontSize >= 48; fontSize -= 4) {
		ctx.font = `900 ${fontSize}px 'Noto Sans KR', sans-serif`;
		const lines = wrapText(ctx, title, maxWidth);
		if (lines.length <= maxLines) {
			return { lines, fontSize };
		}
	}

	ctx.font = "900 48px 'Noto Sans KR', sans-serif";
	const lines = wrapText(ctx, title, maxWidth).slice(0, maxLines);
	const last = lines[maxLines - 1] ?? "";
	lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : last;
	return { lines, fontSize: 48 };
}

interface TextLayout {
	x: number;
	centerY: number;
	maxWidth: number;
	align: CanvasTextAlign;
}

function resolveTextLayout(zone: ThumbnailTextZone | undefined): TextLayout {
	switch (zone) {
		case "left_third":
			return { x: 76, centerY: 375, maxWidth: 560, align: "left" };
		case "right_third":
			return {
				x: THUMB_WIDTH - 76,
				centerY: 375,
				maxWidth: 560,
				align: "right",
			};
		case "top_left":
			return { x: 76, centerY: 215, maxWidth: 650, align: "left" };
		case "bottom_band":
			return {
				x: THUMB_WIDTH / 2,
				centerY: 505,
				maxWidth: 960,
				align: "center",
			};
		case "center_band":
		default:
			return {
				x: THUMB_WIDTH / 2,
				centerY: 360,
				maxWidth: THUMB_WIDTH - 160,
				align: "center",
			};
	}
}

function drawBadge(
	ctx: CanvasRenderingContext2D,
	text: string | undefined,
	accentColor: string,
	channelName?: string,
) {
	const clean = text?.trim();
	if (!clean) return;
	ctx.font = "900 24px 'Noto Sans KR', sans-serif";
	const width = Math.min(260, Math.max(92, ctx.measureText(clean).width + 36));
	const x = channelName ? THUMB_WIDTH - width - 40 : 40;
	const y = 32;
	ctx.fillStyle = "rgba(0,0,0,0.72)";
	ctx.fillRect(x + 4, y + 5, width, 44);
	ctx.fillStyle = accentColor;
	ctx.fillRect(x, y, width, 44);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = "#111111";
	ctx.fillText(clean, x + width / 2, y + 23);
}

/** 썸네일 생성 → data URL 반환 */
export async function generateThumbnail(
	options: ThumbnailOptions,
): Promise<string> {
	const preset =
		PRESETS[
			options.preset ?? options.referenceDna?.generation.preset ?? "mystery"
		];
	const accentColor =
		options.accentColor ??
		options.referenceDna?.color.accentColor ??
		preset.subtitleColor;
	const textZone = options.textZone ?? options.referenceDna?.layout.textZone;
	const maxLines = options.referenceDna?.text.lineCount ?? 3;
	const canvas = document.createElement("canvas");
	canvas.width = THUMB_WIDTH;
	canvas.height = THUMB_HEIGHT;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D context not available");

	// 레퍼런스 썸네일 DNA 가 고대비면 배경에 대비·채도 부스트 (CTR 1차 변수인 시각 임팩트↑).
	const dnaContrast = options.referenceDna?.color.contrast;
	const contrastBoost =
		dnaContrast === "extreme"
			? "contrast(1.3) saturate(1.25)"
			: dnaContrast === "high"
				? "contrast(1.18) saturate(1.15)"
				: "";

	// ─── 1. 배경 이미지 ───
	try {
		const bg = await loadImage(options.backgroundUrl);
		// Cover 방식으로 채우기
		const scale = Math.max(THUMB_WIDTH / bg.width, THUMB_HEIGHT / bg.height);
		const w = bg.width * scale;
		const h = bg.height * scale;
		if (contrastBoost) ctx.filter = contrastBoost;
		ctx.drawImage(bg, (THUMB_WIDTH - w) / 2, (THUMB_HEIGHT - h) / 2, w, h);
		if (contrastBoost) ctx.filter = "none";
	} catch {
		// 이미지 로드 실패 시 그라데이션 배경
		const grad = ctx.createLinearGradient(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
		grad.addColorStop(0, "#1a1a2e");
		grad.addColorStop(0.5, "#16213e");
		grad.addColorStop(1, "#0f3460");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
	}

	// ─── 2. 어두운 오버레이 ───
	ctx.fillStyle = preset.overlayColor;
	ctx.globalAlpha = preset.overlayOpacity;
	ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
	ctx.globalAlpha = 1;

	// ─── 3. 비네트 ───
	if (preset.vignetteStrength > 0) {
		const grad = ctx.createRadialGradient(
			THUMB_WIDTH / 2,
			THUMB_HEIGHT / 2,
			THUMB_WIDTH * 0.3,
			THUMB_WIDTH / 2,
			THUMB_HEIGHT / 2,
			THUMB_WIDTH * 0.8,
		);
		grad.addColorStop(0, "rgba(0,0,0,0)");
		grad.addColorStop(1, `rgba(0,0,0,${preset.vignetteStrength})`);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
	}

	// ─── 4. 액센트 바 (하단) ───
	if (preset.accentBar) {
		ctx.fillStyle = accentColor;
		ctx.fillRect(0, THUMB_HEIGHT - 8, THUMB_WIDTH, 8);
	}

	// ─── 5. 채널명 (좌상단) ───
	if (options.channelName) {
		ctx.font = "600 22px 'Noto Sans KR', sans-serif";
		ctx.fillStyle = "rgba(255,255,255,0.7)";
		ctx.fillText(options.channelName, 40, 50);
	}

	// ─── 5.5. 클릭 패키징 배지 ───
	drawBadge(
		ctx,
		options.badgeText ?? options.referenceDna?.generation.badgeText,
		accentColor,
		options.channelName,
	);

	// ─── 6. 메인 타이틀 ───
	const layout = resolveTextLayout(textZone);
	ctx.textAlign = layout.align;
	ctx.textBaseline = "middle";

	const { lines, fontSize } = fitTitleText(
		ctx,
		options.title,
		preset.titleSize,
		layout.maxWidth,
		maxLines,
	);
	ctx.font = `900 ${fontSize}px 'Noto Sans KR', sans-serif`;
	const lineHeight = fontSize * 1.16;
	const totalHeight = lines.length * lineHeight;
	const startY =
		layout.centerY - totalHeight / 2 + (options.subtitle ? -20 : 0);

	for (let i = 0; i < lines.length; i++) {
		const y = startY + i * lineHeight + lineHeight / 2;

		// 텍스트 스트로크 (외곽선)
		if (preset.titleStrokeWidth > 0) {
			ctx.strokeStyle = preset.titleStroke;
			ctx.lineWidth = preset.titleStrokeWidth;
			ctx.lineJoin = "round";
			ctx.strokeText(lines[i], layout.x, y);
		}

		// 텍스트 채우기
		ctx.fillStyle = preset.titleColor;
		ctx.fillText(lines[i], layout.x, y);
	}

	// ─── 7. 서브타이틀 ───
	if (options.subtitle) {
		const subY = Math.min(THUMB_HEIGHT - 72, startY + totalHeight + 24);
		ctx.font = "600 32px 'Noto Sans KR', sans-serif";
		ctx.fillStyle = preset.subtitleColor;
		ctx.strokeStyle = "#000000";
		ctx.lineWidth = 2;
		ctx.strokeText(options.subtitle, layout.x, subY);
		ctx.fillText(options.subtitle, layout.x, subY);
	}

	return canvas.toDataURL("image/jpeg", 0.92);
}

/** 썸네일 생성 → IndexedDB 저장 */
export async function generateAndSaveThumbnail(
	scriptId: string,
	options: ThumbnailOptions,
): Promise<string> {
	const dataUrl = await generateThumbnail(options);

	// data URL → Uint8Array
	const base64 = dataUrl.split(",")[1];
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	const storagePath = `scripts/${scriptId}/thumbnail.jpg`;
	const url = await storeLocalFile(storagePath, bytes, "image/jpeg");
	localStorage.setItem(`thumbnail_path_${scriptId}`, storagePath);

	return url;
}

/** 프리셋 목록 */
export const THUMBNAIL_PRESETS: Array<{
	id: ThumbnailPreset;
	label: string;
	description: string;
}> = [
	{
		id: "mystery",
		label: "미스터리",
		description: "어두운 톤 + 비네트 + 앰버 악센트",
	},
	{
		id: "news",
		label: "뉴스",
		description: "차분한 톤 + 레드 악센트 바",
	},
	{
		id: "dramatic",
		label: "드라마틱",
		description: "강한 비네트 + 골드 서브타이틀",
	},
	{
		id: "minimal",
		label: "미니멀",
		description: "가벼운 오버레이 + 깔끔한 텍스트",
	},
	{
		id: "bold",
		label: "강렬한",
		description: "골드 타이틀 + 큰 글씨 + 딥 퍼플 톤",
	},
];
