/**
 * Color Grade — LUT 스타일 색보정 레이어.
 * SVG feColorMatrix 필터를 AbsoluteFill에 적용해 씬 전체 톤 조정.
 */

import { AbsoluteFill } from "remotion";
import {
	COLOR_MATRICES,
	type ColorGradePreset,
	matrixToSvgValues,
} from "../../lib/color-grades";

function expandMatrix(m: readonly number[]): number[] {
	return Array.from(m);
}

import { specToSvgMatrix } from "../../lib/color-pipeline";
import type { ColorGradeSpec } from "../../lib/timeline-model";

interface Props {
	preset?: ColorGradePreset;
	/** V2 전체 스펙 — preset + 3-way (lift/gamma/gain) + temp/tint/sat */
	spec?: ColorGradeSpec;
	/** 강도 (0-1, 기본 1.0 = 100%) — 원본과 블렌딩 */
	intensity?: number;
}

export function ColorGrade({ preset = "none", spec, intensity = 1.0 }: Props) {
	// spec 있으면 full pipeline, 없으면 preset 단독
	let svgValues: string;
	let filterId: string;

	if (spec) {
		const presetMatrix =
			spec.preset && spec.preset !== "none"
				? expandMatrix(COLOR_MATRICES[spec.preset])
				: undefined;
		svgValues = specToSvgMatrix(spec, presetMatrix);
		filterId = `colorgrade-spec-${spec.preset ?? "custom"}`;
	} else {
		if (preset === "none") return null;
		const matrix = COLOR_MATRICES[preset];
		if (!matrix) return null;
		svgValues = matrixToSvgValues(matrix);
		filterId = `colorgrade-${preset}`;
	}

	return (
		<>
			<svg
				width="0"
				height="0"
				style={{ position: "absolute" }}
				aria-hidden="true"
			>
				<title>Color grade</title>
				<defs>
					<filter id={filterId}>
						<feColorMatrix type="matrix" values={svgValues} />
					</filter>
				</defs>
			</svg>
			<AbsoluteFill
				style={{
					pointerEvents: "none",
					backdropFilter: `url(#${filterId})`,
					WebkitBackdropFilter: `url(#${filterId})`,
					opacity: intensity,
					mixBlendMode: "normal",
				}}
			/>
		</>
	);
}
