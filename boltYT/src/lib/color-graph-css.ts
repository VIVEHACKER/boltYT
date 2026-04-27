/**
 * ColorGraph → CSS filter 문자열 컴파일러.
 *
 * WebGL shader 대용 경로 — 대부분의 노드 타입은 CSS filter 로 근사 가능하지만
 * hsl-qualifier 같은 마스크 기반 노드는 CSS 로 표현 불가 → 무시하고 경고.
 */

import type { ColorGraph, ColorNode } from "./color-graph";

export interface CompileResult {
	css: string;
	/** CSS 로 표현 불가해 건너뛴 노드 종류 목록 */
	skipped: string[];
}

function cssFilterOf(node: ColorNode): string | null {
	switch (node.kind) {
		case "exposure":
			// 2^ev 배 밝기 → CSS brightness (1.0 = 원본)
			return `brightness(${(2 ** node.ev).toFixed(4)})`;
		case "contrast":
			// applyNode contrast amount=a 는 `(v-0.5)*(1+a)+0.5` → 1+a 가 CSS 계수
			return `contrast(${(1 + node.amount).toFixed(4)})`;
		case "saturation":
			return `saturate(${(1 + node.amount).toFixed(4)})`;
		case "temp-tint": {
			// temp+ 은 warm 쪽 색 시프트 — CSS hue-rotate 음수/양수로 근사 (정확하지 않지만
			// 눈에 띄는 변화 제공). tint 는 magenta-green 축 → hue-rotate 보조.
			// ±100 범위를 ±30deg 로 매핑.
			const deg = -node.temperature * 0.3 + node.tint * 0.1;
			return `hue-rotate(${deg.toFixed(2)}deg)`;
		}
		case "hsl-qualifier":
			// CSS filter 로 마스크 기반 부분 수정 불가 — WebGL shader 경로 필요
			return null;
		case "sharpen": {
			// CSS 에 sharpen 직접 없음 — contrast(1+a*0.5) 로 근사
			return `contrast(${(1 + node.amount * 0.5).toFixed(4)})`;
		}
		case "bloom": {
			// CSS 에 bloom 직접 없음 — brightness 살짝 + drop-shadow 글로우로 근사
			const b = (1 + node.intensity * 0.2).toFixed(4);
			return `brightness(${b})`;
		}
	}
}

export function compileColorGraphToCss(graph: ColorGraph): CompileResult {
	const parts: string[] = [];
	const skipped: string[] = [];
	for (const node of graph) {
		const fragment = cssFilterOf(node);
		if (fragment) parts.push(fragment);
		else skipped.push(node.kind);
	}
	return { css: parts.length ? parts.join(" ") : "none", skipped };
}
