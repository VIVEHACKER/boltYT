/**
 * ColorGraph 를 Canvas 픽셀 배열(Uint8ClampedArray RGBA) 에 적용.
 *
 * CSS filter 로 표현 불가한 hsl-qualifier 등을 포함한 그래프를 이미지 썸네일/프리뷰에
 * 사전 렌더링하는 용도. 비디오 실시간에는 비용 커 부적합 — 정적 이미지 전용.
 *
 * transformImageData 는 순수 함수(Canvas 의존 0) — 테스트 가능.
 */

import { type ColorGraph, evaluateGraph } from "./color-graph";

/**
 * RGBA 바이트 배열(0-255) 을 in-place 아닌 새 배열로 변환.
 * graph 빈 배열이면 원본 복사본 반환 (identity).
 */
export function transformImageData(
	data: Uint8ClampedArray,
	graph: ColorGraph,
): Uint8ClampedArray {
	const out = new Uint8ClampedArray(data.length);
	if (graph.length === 0) {
		out.set(data);
		return out;
	}
	for (let i = 0; i < data.length; i += 4) {
		const px = {
			r: data[i] / 255,
			g: data[i + 1] / 255,
			b: data[i + 2] / 255,
		};
		const result = evaluateGraph(px, graph);
		out[i] = Math.round(result.r * 255);
		out[i + 1] = Math.round(result.g * 255);
		out[i + 2] = Math.round(result.b * 255);
		out[i + 3] = data[i + 3]; // alpha 패스스루
	}
	return out;
}

/**
 * 이미지 URL → Canvas 에 그려 ColorGraph 적용 → dataURL 반환.
 * 브라우저 전용. 실패/Canvas 미지원 환경에서는 원본 URL 반환.
 */
export async function applyGraphToImage(
	imageUrl: string,
	graph: ColorGraph,
): Promise<string> {
	if (graph.length === 0) return imageUrl;
	if (typeof document === "undefined") return imageUrl;
	try {
		const img = await loadImage(imageUrl);
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth || img.width;
		canvas.height = img.naturalHeight || img.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) return imageUrl;
		ctx.drawImage(img, 0, 0);
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const transformed = transformImageData(imageData.data, graph);
		// ImageData 재생성 시 Uint8ClampedArray buffer 타입 제약 회피 — 원본 data 에 set
		imageData.data.set(transformed);
		ctx.putImageData(imageData, 0, 0);
		return canvas.toDataURL("image/png");
	} catch {
		return imageUrl;
	}
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`image load failed: ${url}`));
		img.src = url;
	});
}
