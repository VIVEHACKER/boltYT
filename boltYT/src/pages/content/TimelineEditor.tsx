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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AudioEffectsPanel } from "../../components/timeline/AudioEffectsPanel";
import { ColorPanel } from "../../components/timeline/ColorPanel";
import { CurveEditor } from "../../components/timeline/CurveEditor";
import { MixerPanel } from "../../components/timeline/MixerPanel";
import { MotionPathPanel } from "../../components/timeline/MotionPathPanel";
import { MulticamSwitcher } from "../../components/timeline/MulticamSwitcher";
import { Scopes } from "../../components/timeline/Scopes";
import { TimelineV2 } from "../../components/timeline/TimelineV2";
import { TransformPanel } from "../../components/timeline/TransformPanel";
import type { TimelineScene } from "../../lib/editor-store";
import { ensureBlobUrls } from "../../lib/local-db";
import { supabase } from "../../lib/supabase";
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

export default function TimelineEditor() {
	const { id: scriptId = "" } = useParams<{ id: string }>();
	const navigate = useNavigate();

	const project = useTimelineStore((s) => s.project);
	const playhead = useTimelineStore((s) => s.playhead);
	const zoom = useTimelineStore((s) => s.zoom);
	const snap = useTimelineStore((s) => s.snap);
	const historyIndex = useTimelineStore((s) => s.historyIndex);
	const historyLen = useTimelineStore((s) => s.history.length);

	const loadFromScenes = useTimelineStore((s) => s.loadFromScenes);
	const setZoom = useTimelineStore((s) => s.setZoom);
	const setSnap = useTimelineStore((s) => s.setSnap);
	const undo = useTimelineStore((s) => s.undo);
	const redo = useTimelineStore((s) => s.redo);
	const splitSelected = useTimelineStore((s) => s.splitSelectedAtPlayhead);
	const deleteSelected = useTimelineStore((s) => s.deleteSelected);
	const rippleDeleteSelected = useTimelineStore((s) => s.rippleDeleteSelected);
	const toSceneRecords = useTimelineStore((s) => s.toSceneRecords);
	const liveSceneIds = useTimelineStore((s) => s.liveSceneIds);
	const toRemotionScenes = useTimelineStore((s) => s.toRemotionScenes);
	const selected = useTimelineStore((s) => s.selected());
	const createMulticamGroupFromClips = useTimelineStore(
		(s) => s.createMulticamGroupFromClips,
	);
	const disbandMulticamGroup = useTimelineStore((s) => s.disbandMulticamGroup);

	// 숫자 키 1-9 로 멀티캠 angle 스위칭 (선택된 클립이 multicam 바인딩일 때만 활성)
	useMulticamShortcuts();

	// 멀티캠 그룹화 가능 조건: 2개+ 비디오 클립 선택, multicam 바인딩 아직 없음
	const groupable = selected.filter((c) => c.kind === "video" && !c.multicam);
	const canGroup = groupable.length >= 2;
	const existingGroupId = selected.find((c) => c.multicam)?.multicam?.groupId;

	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [isShorts, setIsShorts] = useState(true);
	const [mixerOpen, setMixerOpen] = useState(false);
	const [colorOpen, setColorOpen] = useState(false);
	const [scopesOpen, setScopesOpen] = useState(false);
	const [transformOpen, setTransformOpen] = useState(false);
	const [motionOpen, setMotionOpen] = useState(false);
	const [curvesOpen, setCurvesOpen] = useState(false);
	const [fxOpen, setFxOpen] = useState(false);
	const playerRef = useRef(null);
	/** 로드 시점의 DB sceneId 집합 — 저장 시 삭제 대상 계산 기준 */
	const initialSceneIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (!scriptId) return;
		setLoading(true);
		void (async () => {
			const [scenesRes, scriptRes] = await Promise.all([
				supabase
					.from("scenes")
					.select("*")
					.eq("script_id", scriptId)
					.order("order_index"),
				supabase
					.from("scripts")
					.select("format")
					.eq("id", scriptId)
					.maybeSingle(),
			]);

			const raw = scenesRes.data ?? [];
			const { data: assets } = await supabase
				.from("media_assets")
				.select("scene_id, storage_path, status, type")
				.in(
					"scene_id",
					raw.map((s) => s.id),
				)
				.eq("status", "complete");

			const paths = (assets ?? [])
				.map((a) => (a as { storage_path: string }).storage_path)
				.filter((p: string) => p?.startsWith("scenes/"));
			const blobMap = await ensureBlobUrls(paths);

			const withAssets: TimelineScene[] = raw.map((s) => {
				const pathOfType = (t: string) =>
					(assets ?? []).find(
						(a) =>
							a.scene_id === s.id && a.type === t && a.status === "complete",
					) as { storage_path?: string } | undefined;
				const audioP = pathOfType("tts_audio")?.storage_path;
				const imageP = pathOfType("image")?.storage_path;
				const videoP = pathOfType("video")?.storage_path;
				return {
					...s,
					audioUrl: audioP ? blobMap.get(audioP) : undefined,
					imageUrl: imageP ? blobMap.get(imageP) : undefined,
					videoUrl: videoP ? blobMap.get(videoP) : undefined,
				} as TimelineScene;
			});

			const format = Boolean(
				scriptRes.data &&
					(scriptRes.data as { format?: string }).format === "shorts",
			);
			setIsShorts(format);

			let bpm = 0;
			let beats: number[] = [];
			const bgmAnalysis = localStorage.getItem(`bgm_analysis_${scriptId}`);
			if (bgmAnalysis) {
				try {
					const parsed = JSON.parse(bgmAnalysis) as {
						bpm: number;
						beats: number[];
					};
					bpm = parsed.bpm;
					beats = parsed.beats;
				} catch {
					/* ignore */
				}
			}
			const bgmUrl = localStorage.getItem(`bgm_url_${scriptId}`) ?? undefined;

			// 로드 시점의 DB sceneId 스냅샷 (저장 시 삭제 대상 계산 기준)
			initialSceneIdsRef.current = new Set(
				withAssets.map((s) => s.id).filter(Boolean),
			);

			loadFromScenes(withAssets, {
				scriptId,
				fps: FPS,
				width: format ? SHORTS_WIDTH : VIDEO_WIDTH,
				height: format ? SHORTS_HEIGHT : VIDEO_HEIGHT,
				bpm,
				beats,
				bgmUrl,
			});
			setLoading(false);
		})();
	}, [scriptId, loadFromScenes]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setMessage(null);
		try {
			const plan = toSceneRecords();
			const surviving = new Set(liveSceneIds());
			// 1. UPDATE — 기존 씬의 편집 결과 반영
			for (const r of plan.update) {
				if (!r.id) continue;
				await supabase
					.from("scenes")
					.update({
						order_index: r.order_index,
						duration_seconds: r.duration_seconds,
						start_frame: r.start_frame,
						edit_keyframes: r.edit_keyframes,
						color_grade: r.color_grade,
						transition: r.transition,
					})
					.eq("id", r.id);
			}
			// 2. INSERT — split/신규 추가된 씬
			let inserted = 0;
			if (plan.insert.length > 0) {
				const { error } = await supabase.from("scenes").insert(plan.insert);
				if (error) throw error;
				inserted = plan.insert.length;
			}
			// 3. DELETE — 로드 시에 있었으나 지금 없는 씬
			const toDelete: string[] = [];
			for (const id of initialSceneIdsRef.current) {
				if (!surviving.has(id)) toDelete.push(id);
			}
			if (toDelete.length > 0) {
				const { error } = await supabase
					.from("scenes")
					.delete()
					.in("id", toDelete);
				if (error) throw error;
			}
			// 4. 새 기준선 갱신 (다음 저장이 새 씬을 다시 delete 하지 않도록)
			initialSceneIdsRef.current = new Set([
				...surviving,
				// insert 된 씬은 DB 가 id 를 돌려주지 않는 이상 알 수 없으므로
				// 다음 편집 세션까지는 reload 권장
			]);
			const msg = [
				`업데이트 ${plan.update.length}`,
				inserted > 0 ? `신규 ${inserted}` : null,
				toDelete.length > 0 ? `삭제 ${toDelete.length}` : null,
			]
				.filter(Boolean)
				.join(" · ");
			setMessage(`저장 완료 — ${msg}`);
		} catch (e) {
			setMessage(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setSaving(false);
		}
	}, [toSceneRecords, liveSceneIds]);

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
						title="Toggle magnetic snap (M)"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: snap.enabled
								? "rgba(134,239,172,0.95)"
								: "rgba(255,255,255,0.45)",
						}}
					>
						<Magnet size={16} />
					</button>

					<button
						type="button"
						onClick={() => setMixerOpen((v) => !v)}
						title="Mixer"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: mixerOpen
								? "rgba(251,191,36,0.95)"
								: "rgba(255,255,255,0.45)",
						}}
					>
						<Sliders size={16} />
					</button>

					<button
						type="button"
						onClick={() => setColorOpen((v) => !v)}
						title="Color Grading"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: colorOpen
								? "rgba(251,191,36,0.95)"
								: "rgba(255,255,255,0.45)",
						}}
					>
						<Palette size={16} />
					</button>

					<button
						type="button"
						onClick={() => setScopesOpen((v) => !v)}
						title="Scopes (Waveform + Vectorscope)"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: scopesOpen
								? "rgba(134,239,172,0.95)"
								: "rgba(255,255,255,0.45)",
						}}
					>
						<Activity size={16} />
					</button>

					<button
						type="button"
						onClick={() => setTransformOpen((v) => !v)}
						title="Transform keyframes (position/scale/rotation/opacity)"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: transformOpen
								? "rgba(251,191,36,0.95)"
								: "rgba(255,255,255,0.45)",
						}}
					>
						<Move size={16} />
					</button>

					<button
						type="button"
						onClick={() => setMotionOpen((v) => !v)}
						title="Motion path (2D position keyframe 궤적)"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: motionOpen
								? "rgba(251,191,36,0.95)"
								: "rgba(255,255,255,0.45)",
						}}
					>
						<Route size={16} />
					</button>

					<button
						type="button"
						onClick={() => setCurvesOpen((v) => !v)}
						title="Curves — transform automation 커브 시각화"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: curvesOpen
								? "rgba(251,191,36,0.95)"
								: "rgba(255,255,255,0.45)",
						}}
					>
						<LineChart size={16} />
					</button>

					<button
						type="button"
						onClick={() => setFxOpen((v) => !v)}
						title="Audio FX — 클립 오디오 이펙트 체인 (EQ / Reverb / Delay / Gain)"
						className="p-1.5 rounded hover:bg-[#2a2a2a]"
						style={{
							color: fxOpen
								? "rgba(251,191,36,0.95)"
								: "rgba(255,255,255,0.45)",
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
