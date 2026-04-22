/**
 * ColorPanel — 선택된 클립의 3-way 색보정 + temp/tint + saturation + LUT 업로드.
 * 실시간 SVG feColorMatrix 미리보기.
 */

import { RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	COLOR_GRADE_LABELS,
	COLOR_MATRICES,
	type ColorGradePreset,
} from "../../lib/color-grades";
import { applyGraphToImage } from "../../lib/color-graph-canvas";
import { parseCubeLut, specToSvgMatrix } from "../../lib/color-pipeline";
import type { ColorGradeSpec } from "../../lib/timeline-model";
import { useTimelineStore } from "../../lib/timeline-store";
import { ColorWheel } from "./ColorWheel";

/** LUT 캐시 — 클립 spec 에는 lutId 만 저장, 실체는 이 맵에 */
const lutCache = new Map<string, import("../../lib/color-pipeline").CubeLUT>();

const PRESETS: ColorGradePreset[] = [
	"none",
	"teal-orange",
	"warm-film",
	"cold-noir",
	"vibrant-pop",
	"muted-doc",
	"retro-vhs",
];

export function ColorPanel() {
	const selected = useTimelineStore((s) => s.selected());
	const setColorGrade = useTimelineStore((s) => s.setColorGrade);

	const clip = selected[0];
	const fileRef = useRef<HTMLInputElement>(null);

	const spec: ColorGradeSpec = useMemo(
		() => clip?.colorGrade ?? { preset: "none" },
		[clip],
	);

	const update = useCallback(
		(patch: Partial<ColorGradeSpec>) => {
			if (!clip) return;
			setColorGrade(clip.id, { ...spec, ...patch });
		},
		[clip, spec, setColorGrade],
	);

	const reset = useCallback(() => {
		if (!clip) return;
		setColorGrade(clip.id, { preset: "none" });
	}, [clip, setColorGrade]);

	// colorGraph → 캔버스 픽셀 처리 결과 (hsl-qualifier 포함 정확 미리보기)
	const graphPreviewKey = useMemo(
		() =>
			clip?.colorGraph && clip.imageUrl
				? `${clip.id}:${clip.imageUrl}:${JSON.stringify(clip.colorGraph)}`
				: null,
		[clip],
	);
	const [graphPreviewState, setGraphPreviewState] = useState<{
		key: string;
		url: string;
	} | null>(null);
	const graphPreviewUrl =
		graphPreviewState?.key === graphPreviewKey ? graphPreviewState.url : null;
	useEffect(() => {
		if (!graphPreviewKey || !clip?.colorGraph || !clip.imageUrl) return;
		let cancelled = false;
		applyGraphToImage(clip.imageUrl, clip.colorGraph).then((url) => {
			if (!cancelled) setGraphPreviewState({ key: graphPreviewKey, url });
		});
		return () => {
			cancelled = true;
		};
	}, [clip?.colorGraph, clip?.imageUrl, graphPreviewKey]);

	const onLoadLut = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			if (!clip) return;
			const file = e.target.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				const lut = parseCubeLut(text);
				const id = `${clip.id}-lut-${Date.now()}`;
				// LUT 데이터를 Map 에 캐시 (global)
				lutCache.set(id, lut);
				update({ lutId: id, lutAmount: 1 });
			} catch (err) {
				alert(`LUT 파싱 실패: ${err instanceof Error ? err.message : err}`);
			}
		},
		[clip, update],
	);

	if (!clip) {
		return (
			<div style={{ padding: 16, color: "#777", fontSize: 12 }}>
				컬러 보정을 적용할 클립을 선택하세요.
			</div>
		);
	}

	const presetMatrix =
		spec.preset && spec.preset !== "none"
			? expandMatrix(COLOR_MATRICES[spec.preset])
			: undefined;
	const svgMatrix = specToSvgMatrix(spec, presetMatrix);

	return (
		<div
			style={{
				padding: 12,
				background: "#0a0a0a",
				borderTop: "1px solid #2a2a2a",
				display: "flex",
				flexDirection: "column",
				gap: 12,
				maxHeight: 360,
				overflowY: "auto",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span style={{ fontSize: 11, fontWeight: 700, color: "#ddd" }}>
					컬러: {clip.label || clip.id}
				</span>
				<button
					type="button"
					onClick={reset}
					style={{
						fontSize: 10,
						padding: "3px 8px",
						background: "#1a1a1a",
						border: "1px solid #333",
						color: "rgba(255,255,255,0.65)",
						borderRadius: 3,
						cursor: "pointer",
						display: "flex",
						alignItems: "center",
						gap: 4,
					}}
				>
					<RotateCcw size={10} /> 초기화
				</button>
			</div>

			{/* 프리셋 칩 */}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{PRESETS.map((p) => (
					<button
						key={p}
						type="button"
						onClick={() => update({ preset: p })}
						style={{
							fontSize: 10,
							padding: "4px 10px",
							background:
								spec.preset === p ? "rgba(251,191,36,0.25)" : "#1a1a1a",
							border:
								spec.preset === p
									? "1px solid rgba(251,191,36,0.6)"
									: "1px solid #333",
							color: spec.preset === p ? "#fcd34d" : "rgba(255,255,255,0.7)",
							borderRadius: 3,
							cursor: "pointer",
						}}
					>
						{COLOR_GRADE_LABELS[p]}
					</button>
				))}
			</div>

			{/* 3-way wheels */}
			<div
				style={{
					display: "flex",
					gap: 12,
					justifyContent: "center",
					flexWrap: "wrap",
				}}
			>
				<ColorWheel
					label="Lift (Shadows)"
					value={spec.lift ?? { r: 0, g: 0, b: 0 }}
					onChange={(v) => update({ lift: v })}
					range={0.5}
				/>
				<ColorWheel
					label="Gamma (Midtones)"
					value={spec.gamma ?? { r: 0, g: 0, b: 0 }}
					onChange={(v) => update({ gamma: v })}
					range={0.5}
				/>
				<ColorWheel
					label="Gain (Highlights)"
					value={spec.gain ?? { r: 1, g: 1, b: 1 }}
					onChange={(v) => update({ gain: v })}
					range={1.0}
				/>
			</div>

			{/* 온도/틴트/채도 */}
			<div style={{ display: "flex", gap: 16 }}>
				<Slider
					label="온도"
					value={spec.temperature ?? 0}
					min={-100}
					max={100}
					step={1}
					unit="K"
					onChange={(v) => update({ temperature: v })}
				/>
				<Slider
					label="틴트"
					value={spec.tint ?? 0}
					min={-100}
					max={100}
					step={1}
					unit=""
					onChange={(v) => update({ tint: v })}
				/>
				<Slider
					label="채도"
					value={spec.saturation ?? 0}
					min={-1}
					max={1}
					step={0.01}
					unit=""
					onChange={(v) => update({ saturation: v })}
				/>
			</div>

			{/* LUT 업로드 */}
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<button
					type="button"
					onClick={() => fileRef.current?.click()}
					style={{
						fontSize: 10,
						padding: "4px 10px",
						background: "#1a1a1a",
						border: "1px solid #333",
						color: "rgba(255,255,255,0.75)",
						borderRadius: 3,
						cursor: "pointer",
						display: "flex",
						alignItems: "center",
						gap: 4,
					}}
				>
					<Upload size={11} /> .cube LUT 업로드
				</button>
				{spec.lutId && (
					<>
						<span style={{ fontSize: 10, color: "#fcd34d" }}>
							LUT 적용됨 · amount {(spec.lutAmount ?? 1).toFixed(2)}
						</span>
						<input
							type="range"
							min={0}
							max={1}
							step={0.01}
							value={spec.lutAmount ?? 1}
							onChange={(e) => update({ lutAmount: Number(e.target.value) })}
							style={{ width: 100, accentColor: "#fcd34d" }}
						/>
						<button
							type="button"
							onClick={() => update({ lutId: undefined, lutAmount: undefined })}
							style={{
								fontSize: 9,
								padding: "2px 6px",
								background: "transparent",
								border: "1px solid #444",
								color: "rgba(255,255,255,0.55)",
								borderRadius: 3,
								cursor: "pointer",
							}}
						>
							제거
						</button>
					</>
				)}
				<input
					ref={fileRef}
					type="file"
					accept=".cube,.CUBE"
					onChange={onLoadLut}
					style={{ display: "none" }}
				/>
			</div>

			{/* 프리뷰: 클립 썸네일에 live 필터 적용 */}
			{clip.imageUrl && (
				<div
					style={{
						display: "flex",
						gap: 8,
						alignItems: "flex-start",
					}}
				>
					<div style={{ position: "relative", width: 220, height: 124 }}>
						<svg
							width={0}
							height={0}
							style={{ position: "absolute" }}
							aria-hidden="true"
						>
							<title>Color grade preview</title>
							<filter id={`grade-${clip.id}`}>
								<feColorMatrix type="matrix" values={svgMatrix} />
							</filter>
						</svg>
						<img
							src={graphPreviewUrl ?? clip.imageUrl}
							alt="preview"
							style={{
								width: "100%",
								height: "100%",
								objectFit: "cover",
								borderRadius: 4,
								filter: graphPreviewUrl ? undefined : `url(#grade-${clip.id})`,
							}}
						/>
						<div
							style={{
								position: "absolute",
								bottom: 4,
								left: 6,
								fontSize: 9,
								color: "rgba(255,255,255,0.8)",
								textShadow: "0 1px 2px rgba(0,0,0,0.7)",
								fontWeight: 600,
							}}
						>
							{graphPreviewUrl ? "After ✦" : "After"}
						</div>
					</div>
					<div style={{ width: 220, height: 124 }}>
						<img
							src={clip.imageUrl}
							alt="original"
							style={{
								width: "100%",
								height: "100%",
								objectFit: "cover",
								borderRadius: 4,
								opacity: 0.85,
							}}
						/>
						<div
							style={{
								marginTop: -118,
								marginLeft: 6,
								fontSize: 9,
								color: "rgba(255,255,255,0.65)",
								textShadow: "0 1px 2px rgba(0,0,0,0.7)",
								fontWeight: 600,
							}}
						>
							Before
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function Slider({
	label,
	value,
	min,
	max,
	step,
	unit,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	unit: string;
	onChange: (v: number) => void;
}) {
	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
			<div
				style={{
					fontSize: 10,
					fontWeight: 700,
					color: "rgba(255,255,255,0.8)",
					display: "flex",
					justifyContent: "space-between",
				}}
			>
				<span>{label}</span>
				<span
					style={{ fontFamily: "monospace", color: "rgba(255,255,255,0.6)" }}
				>
					{typeof value === "number" ? value.toFixed(step < 1 ? 2 : 0) : value}
					{unit}
				</span>
			</div>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				style={{ width: "100%" }}
			/>
		</div>
	);
}

/** 4x5 튜플을 20-원소 배열로 */
function expandMatrix(m: readonly number[]): number[] {
	return Array.from(m);
}
