/**
 * TimelineEditor (V2) — 프레임 기반 연속 트랙 에디터.
 *
 * V1(Scene 배열) 에서 V2(Clip-on-Track) 로 이관.
 * 로드 시 fromScenes() 로 TimelineProject 생성, 저장 시 toSceneRecords() 역변환.
 */

import {
	PButton,
	PHeading,
	PSpinner,
	PText,
} from "@porsche-design-system/components-react";
import { Player } from "@remotion/player";
import {
	Activity,
	ArrowLeft,
	Layers,
	LineChart,
	Magnet,
	Minus,
	Move,
	Palette,
	Plus,
	Redo2,
	Route,
	Save,
	Scissors,
	Sliders,
	Trash2,
	Undo2,
} from "lucide-react";
import { type CSSProperties, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { AudioEffectsPanel } from "../../components/timeline/AudioEffectsPanel";
import { BgmSourcePanel } from "../../components/timeline/BgmSourcePanel";
import { ColorPanel } from "../../components/timeline/ColorPanel";
import { CurveEditor } from "../../components/timeline/CurveEditor";
import { MixerPanel } from "../../components/timeline/MixerPanel";
import { MotionPathPanel } from "../../components/timeline/MotionPathPanel";
import { MulticamSwitcher } from "../../components/timeline/MulticamSwitcher";
import { Scopes } from "../../components/timeline/Scopes";
import { TimelineV2 } from "../../components/timeline/TimelineV2";
import { TransformPanel } from "../../components/timeline/TransformPanel";
import { useEditorPanels } from "../../hooks/useEditorPanels";
import { useTimelineLoad } from "../../hooks/useTimelineLoad";
import { useTimelineSave } from "../../hooks/useTimelineSave";
import { useTimelineStore } from "../../lib/timeline-store";
import { useMulticamShortcuts } from "../../lib/use-multicam-shortcuts";
import {
	calculateTotalFrames,
	VideoComposition,
} from "../../remotion/Composition";
import {
	SHORTS_HEIGHT,
	SHORTS_WIDTH,
	VIDEO_FPS,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
} from "../../remotion/types";

const FPS = VIDEO_FPS;

const toolbarToggleClass =
	"inline-flex h-9 w-9 items-center justify-center rounded-[6px] border transition-colors";

function toolbarToggleStyle(
	active: boolean,
	activeColor: string,
): CSSProperties {
	return {
		color: active ? activeColor : "rgba(255,255,255,0.52)",
		background: active ? "rgba(255,255,255,0.08)" : "transparent",
		borderColor: active ? activeColor : "transparent",
	};
}

export default function TimelineEditor() {
	const { id: scriptId = "" } = useParams<{ id: string }>();
	const navigate = useNavigate();

	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);
	const zoom = useTimelineStore((s) => s.zoom);
	const snap = useTimelineStore((s) => s.snap);
	const historyIndex = useTimelineStore((s) => s.historyIndex);
	const historyLen = useTimelineStore((s) => s.history.length);

	const setZoom = useTimelineStore((s) => s.setZoom);
	const setSnap = useTimelineStore((s) => s.setSnap);
	const undo = useTimelineStore((s) => s.undo);
	const redo = useTimelineStore((s) => s.redo);
	const splitSelected = useTimelineStore((s) => s.splitSelectedAtPlayhead);
	const deleteSelected = useTimelineStore((s) => s.deleteSelected);
	const rippleDeleteSelected = useTimelineStore((s) => s.rippleDeleteSelected);
	const toRemotionScenes = useTimelineStore((s) => s.toRemotionScenes);
	const selected = useTimelineStore(useShallow((s) => s.selected()));
	const createMulticamGroupFromClips = useTimelineStore(
		(s) => s.createMulticamGroupFromClips,
	);
	const disbandMulticamGroup = useTimelineStore((s) => s.disbandMulticamGroup);

	useMulticamShortcuts();

	const groupable = selected.filter((c) => c.kind === "video" && !c.multicam);
	const canGroup = groupable.length >= 2;
	const existingGroupId = selected.find((c) => c.multicam)?.multicam?.groupId;

	const { loading, isShorts, initialSceneIdsRef } = useTimelineLoad(scriptId);
	const { saving, message, handleSave } = useTimelineSave(initialSceneIdsRef);
	const {
		mixerOpen,
		setMixerOpen,
		colorOpen,
		setColorOpen,
		scopesOpen,
		setScopesOpen,
		transformOpen,
		setTransformOpen,
		motionOpen,
		setMotionOpen,
		curvesOpen,
		setCurvesOpen,
		fxOpen,
		setFxOpen,
	} = useEditorPanels();

	const playerRef = useRef(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: project 변경 감지 필수 — toRemotionScenes 는 zustand action 참조 고정
	const remotionScenes = useMemo(
		() => toRemotionScenes(),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[toRemotionScenes, project],
	);
	const playerFrames = useMemo(
		() => Math.max(1, calculateTotalFrames(remotionScenes)),
		[remotionScenes],
	);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-96">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (!project || project.clips.length === 0) {
		return (
			<div className="max-w-xl text-center py-16">
				<PText>이 스크립트에 씬이 없습니다.</PText>
				<PButton
					variant="secondary"
					onClick={() => navigate(`/content/${scriptId}`)}
					className="mt-4"
				>
					되돌아가기
				</PButton>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-[calc(100vh-80px)]">
			<div className="flex items-center justify-between p-3 bg-[#151515] border-b border-[#2a2a2a]">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={() => navigate(`/content/${scriptId}`)}
						className="flex items-center gap-1 text-sm opacity-60 hover:opacity-100 px-2"
					>
						<ArrowLeft size={14} /> 돌아가기
					</button>
					<PHeading tag="h1" size="small">
						타임라인 편집기 V2
					</PHeading>
					{project.bpm > 0 && (
						<span className="text-xs px-2 py-1 bg-[#1a1a1a] rounded border border-[#333] ml-2">
							🥁 {project.bpm} BPM
						</span>
					)}
				</div>

				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={undo}
						disabled={historyIndex <= 0}
						className="p-1.5 rounded hover:bg-[#2a2a2a] disabled:opacity-30"
						aria-label="Undo"
					>
						<Undo2 size={16} />
					</button>
					<button
						type="button"
						onClick={redo}
						disabled={historyIndex >= historyLen - 1}
						className="p-1.5 rounded hover:bg-[#2a2a2a] disabled:opacity-30"
						aria-label="Redo"
					>
						<Redo2 size={16} />
					</button>

					<div className="w-px h-6 bg-[#333] mx-1" />

					<button
						type="button"
						onClick={() => setSnap({ enabled: !snap.enabled })}
						aria-label="자석 스냅"
						aria-pressed={snap.enabled}
						title="Toggle magnetic snap (M)"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={toolbarToggleStyle(snap.enabled, "rgba(134,239,172,0.95)")}
					>
						<Magnet size={16} />
					</button>

					<button
						type="button"
						onClick={() => setMixerOpen((v) => !v)}
						aria-label="오디오 믹서"
						aria-pressed={mixerOpen}
						title="Mixer"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={toolbarToggleStyle(mixerOpen, "rgba(251,191,36,0.95)")}
					>
						<Sliders size={16} />
					</button>

					<button
						type="button"
						onClick={() => setColorOpen((v) => !v)}
						aria-label="컬러 그레이딩"
						aria-pressed={colorOpen}
						title="Color Grading"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={toolbarToggleStyle(colorOpen, "rgba(251,191,36,0.95)")}
					>
						<Palette size={16} />
					</button>

					<button
						type="button"
						onClick={() => setScopesOpen((v) => !v)}
						aria-label="스코프"
						aria-pressed={scopesOpen}
						title="Scopes (Waveform + Vectorscope)"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={toolbarToggleStyle(scopesOpen, "rgba(134,239,172,0.95)")}
					>
						<Activity size={16} />
					</button>

					<button
						type="button"
						onClick={() => setTransformOpen((v) => !v)}
						aria-label="트랜스폼 키프레임"
						aria-pressed={transformOpen}
						title="Transform keyframes (position/scale/rotation/opacity)"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={toolbarToggleStyle(transformOpen, "rgba(251,191,36,0.95)")}
					>
						<Move size={16} />
					</button>

					<button
						type="button"
						onClick={() => setMotionOpen((v) => !v)}
						aria-label="모션 경로"
						aria-pressed={motionOpen}
						title="Motion path (2D position keyframe 궤적)"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={toolbarToggleStyle(motionOpen, "rgba(251,191,36,0.95)")}
					>
						<Route size={16} />
					</button>

					<button
						type="button"
						onClick={() => setCurvesOpen((v) => !v)}
						aria-label="커브 편집"
						aria-pressed={curvesOpen}
						title="Curves — transform automation 커브 시각화"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={toolbarToggleStyle(curvesOpen, "rgba(251,191,36,0.95)")}
					>
						<LineChart size={16} />
					</button>

					<button
						type="button"
						onClick={() => setFxOpen((v) => !v)}
						aria-label="오디오 FX"
						aria-pressed={fxOpen}
						title="Audio FX — 클립 오디오 이펙트 체인 (EQ / Reverb / Delay / Gain)"
						className={`${toolbarToggleClass} hover:bg-[#2a2a2a]`}
						style={{
							...toolbarToggleStyle(fxOpen, "rgba(251,191,36,0.95)"),
							fontSize: 11,
							fontWeight: 700,
						}}
					>
						FX
					</button>

					<button
						type="button"
						onClick={() => {
							if (existingGroupId) {
								disbandMulticamGroup(existingGroupId);
							} else if (canGroup) {
								createMulticamGroupFromClips(groupable.map((c) => c.id));
							}
						}}
						disabled={!canGroup && !existingGroupId}
						title={
							existingGroupId
								? "선택 클립의 멀티캠 그룹 해제"
								: canGroup
									? `${groupable.length}개 비디오 클립을 멀티캠 그룹으로 묶기 (startFrame 순 angle)`
									: "비디오 클립 2개 이상 선택 시 활성"
						}
						className="p-1.5 rounded hover:bg-[#2a2a2a] disabled:opacity-30 disabled:cursor-not-allowed"
						style={{
							color: existingGroupId
								? "rgba(251,191,36,0.95)"
								: canGroup
									? "rgba(134,239,172,0.9)"
									: "rgba(255,255,255,0.45)",
						}}
					>
						<Layers size={16} />
					</button>

					<div className="w-px h-6 bg-[#333] mx-1" />

					<button
						type="button"
						onClick={() => setZoom(zoom - 0.5)}
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						aria-label="Zoom out"
					>
						<Minus size={16} />
					</button>
					<span className="text-xs font-mono w-12 text-center">
						{zoom.toFixed(1)}x
					</span>
					<button
						type="button"
						onClick={() => setZoom(zoom + 0.5)}
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						aria-label="Zoom in"
					>
						<Plus size={16} />
					</button>

					<div className="w-px h-6 bg-[#333] mx-1" />

					<button
						type="button"
						onClick={splitSelected}
						className="text-xs px-3 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#3a3a3a] flex items-center gap-1"
						title="Split selected at playhead (S)"
					>
						<Scissors size={12} />
						Split
					</button>
					<button
						type="button"
						onClick={deleteSelected}
						className="p-1.5 rounded hover:bg-red-900/50"
						aria-label="Delete selection"
						title="Delete (Backspace) · Shift+Backspace = Ripple"
					>
						<Trash2 size={16} />
					</button>
					<button
						type="button"
						onClick={rippleDeleteSelected}
						className="text-xs px-2 py-1.5 rounded bg-[#2a2a2a] hover:bg-red-900/50"
						title="Ripple delete (Shift+Backspace)"
					>
						⇆ Ripple
					</button>

					<div className="w-px h-6 bg-[#333] mx-1" />

					<PButton loading={saving} onClick={handleSave} compact>
						<Save size={14} className="mr-1 inline" />
						저장
					</PButton>
				</div>
			</div>

			<div className="flex flex-1 overflow-hidden">
				<div className="w-1/3 bg-[#000] flex items-center justify-center p-4">
					{remotionScenes.length > 0 && (
						<Player
							ref={playerRef}
							component={VideoComposition}
							inputProps={{ scenes: remotionScenes, bgmUrl: project.bgmUrl }}
							durationInFrames={playerFrames}
							fps={FPS}
							compositionWidth={isShorts ? SHORTS_WIDTH : VIDEO_WIDTH}
							compositionHeight={isShorts ? SHORTS_HEIGHT : VIDEO_HEIGHT}
							style={{ maxWidth: "100%", maxHeight: "100%" }}
							controls
						/>
					)}
				</div>

				<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
					<TimelineV2 />
					{mixerOpen && <MixerPanel />}
					{mixerOpen && <BgmSourcePanel scriptId={scriptId} />}
					{scopesOpen && <Scopes />}
					{colorOpen && <ColorPanel />}
					{transformOpen && <TransformPanel />}
					{motionOpen && <MotionPathPanel />}
					{curvesOpen && <CurveEditor />}
					{fxOpen && <AudioEffectsPanel />}
					{/* 선택된 클립이 multicam 바인딩일 때만 자동 노출 */}
					<MulticamSwitcher />
				</div>
			</div>

			<div
				style={{
					padding: 8,
					background: "#111",
					borderTop: "1px solid #2a2a2a",
					fontSize: 11,
					color: "rgba(255,255,255,0.55)",
					fontFamily: "monospace",
					display: "flex",
					justifyContent: "space-between",
				}}
			>
				<span>
					Frame {playhead} / {playerFrames} · {(playhead / FPS).toFixed(2)}s
				</span>
				<span>
					S = Split · Del = Delete · Shift+Del = Ripple · M = Snap · ⌘Z /
					Shift+⌘Z = Undo/Redo · Shift+← → = Nudge selection · Alt+← → = Single
					frame
				</span>
				{message && <span style={{ color: "#8f8" }}>{message}</span>}
			</div>
		</div>
	);
}
