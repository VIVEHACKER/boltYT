/**
 * Motion Graphics 자동 할당 — 씬 나레이션을 분석해 적절한 모션 그래픽 배정.
 *
 * 휴리스틱 기반 (GPT 호출 없음 — 비용 0):
 * - 숫자 포함 → NumberCounter
 * - 인용 표현 → QuoteBubble
 * - 충격/반전 키워드 → EmojiBurst
 * - news_overlay/출처 있는 → LowerThirdV2
 * - 퍼센트 → ProgressBar
 * - "여기/이/봐주세요" → ArrowCallout
 */

import type { MotionGraphicSpec } from "../types/database";

const VIDEO_FPS = 30;

/**
 * 숫자 + 한국어 단위 추출: "147만 명", "30년", "4.2%"
 *
 * NOTE: 과거에는 /g 플래그가 붙어 있었다. `exec()` 가 stateful 하므로 씬별
 * 호출에서 lastIndex 가 이월되어 "이전 씬에서 숫자를 찾았으면 다음 씬은 null"
 * 이 되는 누수 버그가 있었다 (Codex P2). 한 번만 매칭하므로 /g 불필요.
 */
const NUMBER_PATTERN =
	/(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(만|억|천|년|월|일|명|건|%|억원|만원|회|차|번|kg|km|cm|m)/;

const QUOTE_PATTERNS = [
	/"([^"]{4,80})"/,
	/"([^"]{4,80})"/,
	/「([^」]{4,80})」/,
	/'([^']{4,80})'/,
];

const SHOCK_WORDS = [
	"충격",
	"반전",
	"놀라운",
	"경악",
	"믿을 수 없",
	"결국",
	"그런데",
	"놀랍게도",
	"어이없",
	"결정적",
];

const ARROW_CUES = [
	"여기",
	"이 부분",
	"보세요",
	"주목",
	"바로",
	"바로 이",
	"눈여겨",
];

/** 퍼센트 추출 */
function extractPercent(text: string): number | null {
	const match = text.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
	if (!match) return null;
	const v = Number(match[1]);
	return v >= 0 && v <= 100 ? v : null;
}

/** 첫 숫자+단위 추출 */
function extractNumber(
	text: string,
): { target: number; prefix?: string; suffix: string } | null {
	const match = NUMBER_PATTERN.exec(text);
	if (!match) return null;
	const numStr = match[1].replace(/,/g, "");
	const target = Number(numStr);
	if (!Number.isFinite(target) || target <= 0) return null;

	return {
		target: Math.round(target),
		suffix: match[2],
	};
}

/** 인용 추출 */
function extractQuote(text: string): string | null {
	for (const pattern of QUOTE_PATTERNS) {
		const match = text.match(pattern);
		if (match?.[1]) return match[1];
	}
	return null;
}

function hasShockWord(text: string): boolean {
	return SHOCK_WORDS.some((w) => text.includes(w));
}

function hasArrowCue(text: string): boolean {
	return ARROW_CUES.some((w) => text.includes(w));
}

export interface SceneInput {
	narration_text: string;
	scene_type: string;
	duration_seconds: number;
	news_title?: string;
	news_source?: string;
}

/**
 * 씬 하나에 대해 적절한 모션 그래픽 1-2개 배정.
 */
export function assignMotionGraphicsForScene(
	scene: SceneInput,
): MotionGraphicSpec[] {
	const graphics: MotionGraphicSpec[] = [];
	const text = scene.narration_text;
	const totalFrames = Math.ceil(scene.duration_seconds * VIDEO_FPS);

	if (totalFrames < 30) return graphics; // 1초 미만 씬은 건너뜀

	// 1. 숫자 카운터 — 숫자+단위 포함 시 (text_emphasis 아닌 경우)
	const percent = extractPercent(text);
	if (percent !== null && scene.scene_type !== "text_emphasis") {
		graphics.push({
			type: "progress_bar",
			startFrame: Math.round(totalFrames * 0.15),
			duration: Math.round(totalFrames * 0.6),
			params: {
				target: percent,
				label: "",
				position: "center",
			},
		});
	} else {
		const num = extractNumber(text);
		if (num && scene.scene_type !== "text_emphasis") {
			graphics.push({
				type: "number_counter",
				startFrame: Math.round(totalFrames * 0.2),
				duration: Math.round(totalFrames * 0.5),
				params: {
					target: num.target,
					suffix: num.suffix,
					format: num.target >= 10000 ? "comma" : "number",
					position: "center",
				},
			});
		}
	}

	// 2. 인용 — 인용 표현 있고 news_overlay/text_emphasis 아닐 때
	const quote = extractQuote(text);
	if (quote && scene.scene_type !== "text_emphasis") {
		graphics.push({
			type: "quote_bubble",
			startFrame: Math.round(totalFrames * 0.2),
			duration: Math.round(totalFrames * 0.6),
			params: {
				text: quote.length > 60 ? `${quote.slice(0, 57)}...` : quote,
				position: "center",
			},
		});
	}

	// 3. 로워서드 — 명시적 news_title 이 있되 기본 소스 속성과 겹치지 않을 때만.
	//    OverlayStack 은 news_source/sourceAttribution 이 있으면 이미 LowerThird 를 띄우므로
	//    news_source 기반 씬에서 이 분기까지 넣으면 중복 배너가 생긴다 (Codex P2).
	//    → news_source 가 없고 news_title 만 있는 순수 제목 카드 케이스에만 추가.
	if (scene.news_title && !scene.news_source) {
		graphics.push({
			type: "lower_third",
			startFrame: 12,
			duration: Math.min(totalFrames - 12, 120),
			params: {
				title: scene.news_title.slice(0, 40),
				subtitle: "",
				accent: "#e63946",
			},
		});
	}

	// 4. 이모지 버스트 — 충격/반전 키워드 (text_emphasis만)
	if (scene.scene_type === "text_emphasis" && hasShockWord(text)) {
		graphics.push({
			type: "emoji_burst",
			startFrame: Math.round(totalFrames * 0.1),
			duration: Math.min(totalFrames - 6, 36), // 1.2초
			params: {
				emojis: ["💥", "⚡", "❗", "🔥"],
				count: 16,
				radius: 38,
			},
		});
	}

	// 5. 화살표 — "여기/보세요" 등 지시어, 이미지 씬만
	if (hasArrowCue(text) && scene.scene_type === "image") {
		graphics.push({
			type: "arrow_callout",
			startFrame: Math.round(totalFrames * 0.25),
			duration: Math.round(totalFrames * 0.4),
			params: {
				text: "여기!",
				targetX: 0.5,
				targetY: 0.5,
				direction: "top-right",
			},
		});
	}

	return graphics;
}

/** 씬 배열 일괄 처리 */
export function assignMotionGraphicsForScenes<T extends SceneInput>(
	scenes: T[],
): Array<T & { motion_graphics: MotionGraphicSpec[] }> {
	return scenes.map((s) => ({
		...s,
		motion_graphics: assignMotionGraphicsForScene(s),
	}));
}
