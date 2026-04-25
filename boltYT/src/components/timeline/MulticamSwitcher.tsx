/**
 * MulticamSwitcher — 멀티캠 그룹 angle 버튼 + cut 추가 패널.
 *
 * C3 변경:
 * - multicamGroups.length > 0 이면 클립 선택 여부 무관 항상 렌더 (C3-a)
 * - 표시 그룹: playhead 에 활성 클립이 속한 그룹 우선, 없으면 첫 번째 그룹
 * - 숫자키 1-9 실행 시 0.8s HUD 오버레이 표시 (C3-b, C3-c)
 * - 활성 각도 버튼에 ring-2 강조 + 단축키 번호 표시 (C3-d)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { angleAtFrame } from "../../lib/multicam";
import { findGroup } from "../../lib/multicam-timeline";
import { useShallow } from "zustand/react/shallow";
import { useTimelineStore } from "../../lib/timeline-store";
import { useMulticamShortcuts } from "../../lib/use-multicam-shortcuts";

/** 각도 이름 생성: A, B, C … */
function angleName(i: number): string {
	return String.fromCharCode(65 + i); // 0→A, 1→B …
}

// ---------------------------------------------------------------------------
// HUD 서브컴포넌트
// ---------------------------------------------------------------------------
interface HudState {
	angle: number; // 0-based
	name: string;
	visible: boolean;
}

function MulticamHUD({ hud }: { hud: HudState | null }) {
	if (!hud) return null;
	return (
		<div
			aria-live="polite"
			aria-atomic="true"
			style={{
				position: "fixed",
				top: 12,
				right: 16,
				zIndex: 9999,
				background: "rgba(11,19,38,0.92)",
				border: "1px solid rgba(38,101,253,0.6)",
				borderRadius: 6,
				padding: "8px 14px",
				display: "flex",
				alignItems: "center",
				gap: 8,
				pointerEvents: "none",
				opacity: hud.visible ? 1 : 0,
				transition: "opacity 0.8s ease-out",
			}}
		>
			<span
				style={{
					fontSize: 20,
					fontWeight: 700,
					fontFamily: "monospace",
					color: "#2665fd",
					lineHeight: 1,
				}}
			>
				{hud.angle + 1}
			</span>
			<span
				style={{
					fontSize: 12,
					color: "rgba(221,226,253,0.9)",
					letterSpacing: "0.04em",
				}}
			>
				— Angle {hud.name}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function MulticamSwitcher() {
	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);
	const selected = useTimelineStore(useShallow((s) => s.selected()));
	const setMulticamCut = useTimelineStore((s) => s.setMulticamCut);
	const setActive = useTimelineStore((s) => s.setMulticamActiveAngle);
	const setAudio = useTimelineStore((s) => s.setMulticamAudioAngle);
	const renameGroup = useTimelineStore((s) => s.renameMulticamGroup);
	const setAngleCount = useTimelineStore((s) => s.setMulticamAngleCount);

	// C3-a: multicamGroups 직접 구독
	const multicamGroups = project?.multicamGroups ?? [];

	// C3-b/c: HUD 상태
	const [hud, setHud] = useState<HudState | null>(null);
	const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showHud = useCallback((angle: number) => {
		if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
		setHud({ angle, name: angleName(angle), visible: true });
		// visible → false 로 전환해서 CSS transition 발동
		hudTimerRef.current = setTimeout(() => {
			setHud((prev) => (prev ? { ...prev, visible: false } : null));
			// transition 완료 후 DOM 제거
			hudTimerRef.current = setTimeout(() => setHud(null), 850);
		}, 50); // 마운트 직후 fade-out 시작 방지 위한 최소 지연
	}, []);

	useEffect(() => {
		return () => {
			if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
		};
	}, []);

	// C3-c: 단축키 훅에 onCut 콜백 연결
	useMulticamShortcuts({ onCut: showHud });

	// 그룹이 없으면 null
	if (multicamGroups.length === 0) return null;

	// C3-a: 활성 그룹 결정 로직
	// 1) 선택된 클립 중 multicam 바인딩 있는 것의 groupId
	const selectedGroupId = selected.find((c) => c.multicam)?.multicam?.groupId;
	const group =
		(project && selectedGroupId
			? findGroup(project, selectedGroupId)
			: undefined) ?? multicamGroups[0];

	if (!group) return null;

	const currentAngle = angleAtFrame(group, playhead);

	return (
		<>
			{/* C3-b: HUD 오버레이 */}
			<MulticamHUD hud={hud} />

			<div
				style={{
					borderTop: "1px solid #1a1a1a",
					background: "#0d0d0d",
					padding: 10,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						marginBottom: 8,
					}}
				>
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: "rgba(255,255,255,0.75)",
						}}
					>
						MULTICAM ·
					</span>
					<input
						type="text"
						defaultValue={group.name}
						onBlur={(e) => {
							const v = e.target.value.trim();
							if (v && v !== group.name) renameGroup(group.id, v);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") (e.target as HTMLInputElement).blur();
						}}
						maxLength={40}
						style={{
							background: "transparent",
							border: "1px solid #1f1f1f",
							color: "rgba(255,255,255,0.85)",
							fontSize: 11,
							padding: "2px 6px",
							borderRadius: 3,
							width: 140,
							fontFamily: "inherit",
						}}
						aria-label="멀티캠 그룹 이름"
					/>
					<span style={{ color: "rgba(255,255,255,0.4)", fontSize: 9 }}>
						({group.angles} angles · cuts {group.cuts.length})
					</span>
					<div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
						<button
							type="button"
							onClick={() => setAngleCount(group.id, group.angles - 1)}
							disabled={group.angles <= 2}
							title="angle 1 감소 (최소 2). 초과 angle 클립은 멀티캠 해제"
							style={{
								width: 20,
								height: 20,
								fontSize: 12,
								background: "#1a1a1a",
								border: "1px solid #2a2a2a",
								color: "rgba(255,255,255,0.7)",
								borderRadius: 3,
								cursor: group.angles > 2 ? "pointer" : "not-allowed",
								opacity: group.angles > 2 ? 1 : 0.3,
							}}
						>
							−
						</button>
						<button
							type="button"
							onClick={() => setAngleCount(group.id, group.angles + 1)}
							disabled={group.angles >= 9}
							title="angle 1 증가 (최대 9, 숫자키 매핑 한계)"
							style={{
								width: 20,
								height: 20,
								fontSize: 12,
								background: "#1a1a1a",
								border: "1px solid #2a2a2a",
								color: "rgba(255,255,255,0.7)",
								borderRadius: 3,
								cursor: group.angles < 9 ? "pointer" : "not-allowed",
								opacity: group.angles < 9 ? 1 : 0.3,
							}}
						>
							+
						</button>
					</div>
				</div>

				{/* C3-d: 각도 버튼 — 활성 ring 강조 + 단축키 번호 표시 */}
				<div style={{ display: "flex", gap: 4 }}>
					{Array.from({ length: group.angles }, (_, i) => {
						const isActive = currentAngle === i;
						const isAudio = group.audioAngle === i;
						return (
							<button
								type="button"
								// biome-ignore lint/suspicious/noArrayIndexKey: i 는 angle 식별자 자체 (0-based, 그룹 내 고정 인덱스)
								key={i}
								onClick={() => setMulticamCut(group.id, playhead, i)}
								onContextMenu={(e) => {
									e.preventDefault();
									setActive(group.id, i);
								}}
								onDoubleClick={() => setAudio(group.id, i)}
								title={`클릭: ${playhead}프레임에 angle ${i + 1} cut 추가\n우클릭: 기본 angle 설정\n더블클릭: 오디오 소스로 지정`}
								style={{
									padding: "5px 9px",
									fontSize: 11,
									fontFamily: "monospace",
									borderRadius: 3,
									// C3-d: 활성 각도는 Primary 색상 ring
									border: isActive ? "2px solid #2665fd" : "1px solid #2a2a2a",
									outline: isActive
										? "1px solid rgba(38,101,253,0.35)"
										: "none",
									background: isActive ? "rgba(38,101,253,0.18)" : "#1a1a1a",
									color: isActive ? "#dde2fd" : "rgba(255,255,255,0.7)",
									cursor: "pointer",
									position: "relative",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									gap: 2,
									minWidth: 38,
								}}
							>
								{/* 단축키 번호 표시 */}
								<span
									style={{
										fontSize: 9,
										color: isActive
											? "rgba(38,101,253,0.9)"
											: "rgba(255,255,255,0.3)",
										lineHeight: 1,
									}}
								>
									[{i + 1}]
								</span>
								{/* Angle 이름 */}
								<span style={{ lineHeight: 1 }}>{angleName(i)}</span>
								{isAudio && (
									<span
										style={{
											position: "absolute",
											top: -2,
											right: -2,
											fontSize: 7,
											background: "rgba(134,239,172,0.9)",
											color: "#000",
											padding: "1px 3px",
											borderRadius: 2,
										}}
									>
										A
									</span>
								)}
							</button>
						);
					})}
				</div>

				<div
					style={{
						fontSize: 9,
						color: "rgba(255,255,255,0.45)",
						marginTop: 6,
						lineHeight: 1.5,
					}}
				>
					클릭 = cut 추가 · 우클릭 = 기본 angle · 더블클릭 = 오디오 소스 ·
					숫자키 1-9
				</div>
			</div>
		</>
	);
}
