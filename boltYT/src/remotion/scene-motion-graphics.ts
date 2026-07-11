/**
 * 씬 데이터 → MotionGraphicSpec 빌더 (순수·테스트 가능).
 *
 * 경제/뉴스 해설 영상의 "편집 수준"을 올리는 핵심 계층: 이미 만들어져 있으나 어떤 생성기도
 * 데이터를 안 넣어 죽어 있던 모션그래픽(NumberCounter·ArrowCallout·LowerThirdV2)을 실제
 * 데이터(핵심 수치·증감·출처)로부터 배선한다. Scene.tsx:961 이 scene.motionGraphics 를 이미 렌더한다.
 *
 * 색 규약: 한국 시장 관례 — 상승/플러스 = 빨강, 하락/마이너스 = 파랑 (미국과 반대). YMYL 오독 방지.
 */

import type { MotionGraphicSpec } from "./types";

/** buildVlogRemotionScenes 와 동일한 씬 FPS. */
export const MG_FPS = 30;
/** 상승/플러스 (한국 시장 = 빨강). */
export const KR_UP = "#e5443b";
/** 하락/마이너스 (한국 시장 = 파랑). */
export const KR_DOWN = "#2f6fe4";

const clampFrames = (n: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, Math.round(n)));

/** delta 부호 → 한국식 색상(0 이상=빨강, 미만=파랑). undefined 면 색 미지정(컴포넌트 기본). */
export function krDeltaColor(delta: number | undefined): string | undefined {
	if (delta === undefined || Number.isNaN(delta)) return undefined;
	return delta >= 0 ? KR_UP : KR_DOWN;
}

/**
 * 출처/기관 로워서드 — 씬 0.4s 진입, 최대 4s(씬이 짧으면 씬 길이). YMYL 신뢰(출처 표기)용.
 * title 이 공백이면 null(스펙 미생성 → 출력 불변).
 */
export function sourceLowerThird(
	title: string,
	subtitle: string | undefined,
	sceneFrames: number,
	accent = "#2665fd",
): MotionGraphicSpec | null {
	const t = title.trim();
	if (!t || sceneFrames < MG_FPS) return null;
	const startFrame = clampFrames(MG_FPS * 0.4, 0, sceneFrames - MG_FPS);
	const duration = clampFrames(
		Math.min(sceneFrames - startFrame, MG_FPS * 4),
		MG_FPS,
		sceneFrames - startFrame,
	);
	return {
		type: "lower_third",
		startFrame,
		duration,
		params: {
			title: t,
			...(subtitle?.trim() ? { subtitle: subtitle.trim() } : {}),
			accent,
			position: "bottom",
		},
	};
}

export interface KeyFigure {
	/** 카운트업 목표값. */
	target: number;
	prefix?: string;
	suffix?: string;
	/** 증감(부호로 색 결정). 지수/원 등 절대치만 있으면 생략. */
	delta?: number;
	format?: "comma" | "number";
	position?: "top" | "center" | "bottom";
}

/**
 * 핵심 수치 카운터 스펙 — 씬 0.5s 진입, 씬 끝까지. delta 부호로 한국식 색상.
 * format 미지정이면 |target|≥1000 은 comma(지수·원), 그 외 number(%·배수).
 */
export function numberCounterSpec(
	fig: KeyFigure,
	sceneFrames: number,
): MotionGraphicSpec | null {
	if (!Number.isFinite(fig.target) || sceneFrames < MG_FPS) return null;
	const startFrame = clampFrames(MG_FPS * 0.5, 0, sceneFrames - MG_FPS);
	const duration = clampFrames(
		sceneFrames - startFrame,
		MG_FPS,
		sceneFrames - startFrame,
	);
	return {
		type: "number_counter",
		startFrame,
		duration,
		params: {
			target: fig.target,
			...(fig.prefix ? { prefix: fig.prefix } : {}),
			...(fig.suffix ? { suffix: fig.suffix } : {}),
			format: fig.format ?? (Math.abs(fig.target) >= 1000 ? "comma" : "number"),
			position: fig.position ?? "center",
			...(krDeltaColor(fig.delta) ? { color: krDeltaColor(fig.delta) } : {}),
		},
	};
}

/**
 * 증감 화살표 콜아웃 — 씬 0.8s 진입. targetX/Y 는 0-1 화면 비율(차트 영역 지시).
 * 색·라벨은 delta 부호 따름.
 */
export function deltaArrowSpec(
	delta: number,
	text: string,
	target: { x: number; y: number },
	sceneFrames: number,
): MotionGraphicSpec | null {
	if (!Number.isFinite(delta) || !text.trim() || sceneFrames < MG_FPS)
		return null;
	const startFrame = clampFrames(MG_FPS * 0.8, 0, sceneFrames - MG_FPS);
	const duration = clampFrames(
		sceneFrames - startFrame,
		MG_FPS,
		sceneFrames - startFrame,
	);
	return {
		type: "arrow_callout",
		startFrame,
		duration,
		params: {
			text: text.trim(),
			targetX: Math.max(0, Math.min(1, target.x)),
			targetY: Math.max(0, Math.min(1, target.y)),
			direction: delta >= 0 ? "top-right" : "bottom-right",
			color: delta >= 0 ? KR_UP : KR_DOWN,
		},
	};
}

/**
 * 편의 조립: 씬 하나에 얹을 그래픽 배열을 만든다(null 은 제외). 생성기가 가진 데이터만 넘기면 됨.
 * 아무 데이터도 없으면 빈 배열 → 호출측이 length 검사로 키를 안 만들면 출력 불변.
 */
export function buildSceneGraphics(input: {
	sceneFrames: number;
	source?: { title: string; subtitle?: string };
	keyFigure?: KeyFigure;
	arrow?: { delta: number; text: string; x: number; y: number };
}): MotionGraphicSpec[] {
	const out: MotionGraphicSpec[] = [];
	if (input.source) {
		const s = sourceLowerThird(
			input.source.title,
			input.source.subtitle,
			input.sceneFrames,
		);
		if (s) out.push(s);
	}
	if (input.keyFigure) {
		const n = numberCounterSpec(input.keyFigure, input.sceneFrames);
		if (n) out.push(n);
	}
	if (input.arrow) {
		const a = deltaArrowSpec(
			input.arrow.delta,
			input.arrow.text,
			{ x: input.arrow.x, y: input.arrow.y },
			input.sceneFrames,
		);
		if (a) out.push(a);
	}
	return out;
}
