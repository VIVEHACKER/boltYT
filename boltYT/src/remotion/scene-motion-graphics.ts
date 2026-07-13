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

/**
 * 내레이션에서 경제 핵심 "퍼센트" 수치만 보수적으로 추출(순수). 지수/원/억 등은 단위 모호성과
 * YMYL 오독 위험이 커 이번 범위에서 제외 — 퍼센트가 가장 흔하고 명확하다. grounding 검증(소스에
 * 실제 존재하는 숫자인지)은 호출측이 책임진다. 반환 KeyFigure 는 delta 미포함(중립) — 자유 서술에서
 * 증감 방향을 신뢰성 있게 판정할 수 없어 색/화살표를 쓰지 않는다("하락을 막았다"=실제로는 상승 등).
 * 값+접미사 기준 중복 제거. %p/%포인트 는 접미사 "%p".
 */
export function parseEconomyPercentages(narration: string): KeyFigure[] {
	// 범위 표현(2~3% / 3-5% / "2에서 3%")은 단일 정밀 수치로 오해되므로 통째로 배제(모호 → 카운터 없음).
	if (
		/\d[\d.,]*\s*(?:[~\-–]|에서|부터)\s*\d[\d.,]*\s*(?:%|퍼센트)/.test(
			narration,
		)
	)
		return [];
	const out: KeyFigure[] = [];
	const seen = new Set<string>();
	// (?<![\d.]): 앞에 숫자·소수점이 붙은 수의 부분 매칭 방지(연도·큰 수 꼬리 오추출 차단).
	// 천단위 콤마 허용 + 정수부 전체 캡처(1,234% → 1234, 잘라서 234 로 조작 금지). 부호는 취하지
	// 않는다 — 중립 카운터는 크기만 표시하고, 방향(±)은 grounding 이 검증하지 않으므로 표시하지 않는다.
	const re = /(?<![\d.])(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:%|퍼센트)(p|포인트)?/g;
	let m: RegExpExecArray | null = re.exec(narration);
	while (m !== null) {
		const target = Number(m[1].replace(/,/g, ""));
		if (Number.isFinite(target)) {
			const suffix = m[2] ? "%p" : "%";
			const key = `${target}${suffix}`;
			if (!seen.has(key)) {
				seen.add(key);
				out.push({ target, suffix, format: "number" });
			}
		}
		m = re.exec(narration);
	}
	return out;
}

/** LLM(대본)이 비트별로 낸 구조화 핵심 수치 — regex 추출보다 정확(라벨·단위·방향 포함). */
export interface LlmKeyFigure {
	label?: string;
	value: number;
	unit?: string;
	direction?: "up" | "down" | "flat";
}

// 동음이의 부분매칭 주의: 오른쪽/인상적/건너뛴/빠져나가다 는 방향어가 아니라 lookahead·제외로 거른다.
const UP_WORDS =
	/상승|올라|올랐|오름|오른(?!쪽)|급등|증가|늘어|늘었|늘리|확대|인상(?!적)|상향|반등|강세|치솟/;
const DOWN_WORDS =
	/하락|내려|내렸|떨어|급락|감소|줄어|줄었|줄이|축소|인하|하향|약세|빠져(?!나)|고꾸라|꺾/;

/**
 * LLM 이 낸 방향(direction)을 씬 내레이션과 교차검증해 신뢰 가능한 delta 부호만 반환(순수).
 * YMYL 함정 방지: 자유서술 방향판정의 오류("하락을 막았다"=실제 상승)를 피하려고, LLM 방향과
 * 내레이션 방향 키워드가 '일치하고 반대 키워드가 없을 때'만 부호를 준다. 애매(양방향/무키워드/flat)
 * → undefined(중립, 화살표·색 없음). LLM 방향 환각과 텍스트 함정 양쪽에 대해 fail-closed.
 */
export function corroboratedDelta(
	narration: string,
	direction: LlmKeyFigure["direction"],
): number | undefined {
	if (direction !== "up" && direction !== "down") return undefined;
	const up = UP_WORDS.test(narration);
	const down = DOWN_WORDS.test(narration);
	if (up && down) return undefined; // 양방향 서술 → 모호 → 중립
	if (direction === "up" && up) return 1;
	if (direction === "down" && down) return -1;
	return undefined; // 내레이션이 LLM 방향을 뒷받침하지 않음 → 중립
}

/**
 * 검증 통과한 LlmKeyFigure + 교차검증된 delta → 렌더용 KeyFigure.
 * 방향 표시 규칙(YMYL): ▲/▼ 글리프는 '변화율'(%,%p)에만 붙인다 — 지수·가격 등 '수준' 값에 붙이면
 * 그 크기만큼의 '변화'로 오독된다("코스피 ▲2,650포인트"=+2,650 상승으로 읽힘). 수준 값의 방향은
 * 한국식 색(상승=빨강/하락=파랑, delta 부호로 numberCounterSpec 이 처리)으로만 표현한다.
 * value 의 grounding 검증은 호출측(생성기)이 끝냈다고 가정한다.
 */
export function llmKeyFigureToKeyFigure(
	fig: LlmKeyFigure,
	delta: number | undefined,
): KeyFigure {
	const unit = fig.unit?.trim() ?? "";
	const isRate = unit === "%" || unit === "%p";
	const glyph =
		isRate && delta !== undefined
			? delta > 0
				? "▲"
				: delta < 0
					? "▼"
					: ""
			: "";
	const label = fig.label?.trim() ?? "";
	const prefix = `${label ? `${label} ` : ""}${glyph}`;
	return {
		target: fig.value,
		...(prefix ? { prefix } : {}),
		...(unit ? { suffix: unit } : {}),
		...(delta !== undefined ? { delta } : {}),
	};
}

/**
 * LLM 응답의 임의 객체 → LlmKeyFigure(신뢰). value(유한수) 필수, 나머지는 타입가드.
 * 잘못된 형태는 undefined — 씬 자체를 무효화하지 않고 keyFigure 만 생략(비파괴 fail-closed).
 */
export function parseLlmKeyFigure(raw: unknown): LlmKeyFigure | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const o = raw as Record<string, unknown>;
	const value = typeof o.value === "number" ? o.value : Number(o.value);
	if (!Number.isFinite(value)) return undefined;
	const label = typeof o.label === "string" ? o.label.trim() : "";
	const unit = typeof o.unit === "string" ? o.unit.trim() : "";
	const direction =
		o.direction === "up" || o.direction === "down" || o.direction === "flat"
			? o.direction
			: undefined;
	return {
		value,
		...(label ? { label } : {}),
		...(unit ? { unit } : {}),
		...(direction ? { direction } : {}),
	};
}
