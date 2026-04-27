/**
 * Face-aware Ken Burns — 얼굴 bounding box → pan/zoom transformOrigin 추정.
 *
 * 외부 face detection (e.g. mediapipe) 결과를 받아 시청자 시선이 얼굴에
 * 머무르도록 transformOrigin 와 pan 방향을 결정.
 */

export interface FaceBox {
	/** 0-1 정규화 좌표 (이미지 너비 기준) */
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface KbOriginHint {
	originX: string; // CSS percent
	originY: string;
	suggestedPan: "left" | "right" | "up" | "down" | "center";
	zoomFactor: number;
}

/**
 * 얼굴 박스 → transformOrigin (얼굴 중심) + 적합한 pan 방향.
 * - 얼굴이 좌측에 있으면 → pan_right (시청자 시선이 좌측 얼굴로)
 *   → 단, 화면 중심으로 끌고 가야 좋아 보이므로 카메라는 좌→우 보다 우→좌 가 정답
 *   = 얼굴이 좌측이면 origin 을 좌측에, pan 을 좌측 향하게 (left)
 */
export function suggestKbFromFace(box: FaceBox): KbOriginHint {
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const originX = `${(cx * 100).toFixed(1)}%`;
	const originY = `${(cy * 100).toFixed(1)}%`;

	let suggestedPan: KbOriginHint["suggestedPan"] = "center";
	const offsetX = cx - 0.5;
	const offsetY = cy - 0.5;
	if (Math.abs(offsetX) > Math.abs(offsetY)) {
		suggestedPan = offsetX > 0.1 ? "left" : offsetX < -0.1 ? "right" : "center";
	} else {
		suggestedPan = offsetY > 0.1 ? "up" : offsetY < -0.1 ? "down" : "center";
	}

	// 얼굴이 작을수록 더 많이 줌 (close-up 효과)
	const faceArea = box.width * box.height;
	const zoomFactor =
		faceArea < 0.05 ? 1.4 : faceArea < 0.15 ? 1.2 : faceArea < 0.3 ? 1.1 : 1.05;

	return { originX, originY, suggestedPan, zoomFactor };
}

/** 가장 큰 얼굴 선택 (multiple face 일 때) */
export function pickPrimaryFace(faces: FaceBox[]): FaceBox | null {
	if (faces.length === 0) return null;
	return faces.reduce((biggest, f) =>
		f.width * f.height > biggest.width * biggest.height ? f : biggest,
	);
}
