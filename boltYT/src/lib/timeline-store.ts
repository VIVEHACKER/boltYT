/**
 * Timeline V2 Store — 프레임 기반 연속 타임라인.
 *
 * 기존 editor-store (Scene 배열) 대체.
 * 순수 오퍼레이션(timeline-model.ts)을 감싸 Zustand 상태/히스토리로 바인딩.
 */

import { create } from "zustand";
import type { RemotionScene } from "../remotion/types";
import type { TimelineScene } from "./editor-store";
import {
	createMulticamGroup as createGroupOp,
	removeCut as removeCutOp,
	setActiveAngle as setActiveAngleOp,
	setAngleCount as setAngleCountOp,
	setAudioAngle as setAudioAngleOp,
	setCut as setCutOp,
} from "./multicam";
import {
	existingSceneIds,
	fromScenes,
	type SceneRecordPlan,
	toRemotionScenes,
	toScenes,
} from "./timeline-adapter";
import {
	type AutomationKeyframe,
	applySnap,
	type BezierTangent,
	buildSnapTargets,
	type ColorGradeSpec,
	clearTransformProp,
	deleteClip as deleteClipOp,
	type EffectiveTransform,
	endFrameOf,
	evaluateCurve,
	evaluateTransform,
	moveClip as moveClipOp,
	moveClips as moveClipsOp,
	removeKeyframe,
	removeMotionKnot,
	removeTransformKeyframe,
	rippleDelete as rippleDeleteOp,
	rippleInsert as rippleInsertOp,
	rollEdit as rollEditOp,
	setKeyframe,
	setMotionKnot,
	setMotionKnotTangent,
	setSelection as setSelectionOp,
	setTransformKeyframe,
	slideClip as slideClipOp,
	slipClip as slipClipOp,
	splitClipAt as splitClipOp,
	type TimelineClip,
	type TimelineProject,
	type TimelineTrack,
	type TransformProp,
	toggleSelect as toggleSelectOp,
	totalDurationFrames,
	trimLeft as trimLeftOp,
	trimRight as trimRightOp,
} from "./timeline-model";

const MAX_HISTORY = 50;
const DEFAULT_SNAP_THRESHOLD = 6; // frames

interface HistorySnapshot {
	project: TimelineProject;
	ts: number;
}

interface SnapOptions {
	enabled: boolean;
	threshold: number;
	includePlayhead: boolean;
	includeBeats: boolean;
	includeMarkers: boolean;
}

interface TimelineState {
	// Core
	project: TimelineProject | null;
	playhead: number;
	zoom: number; // px per frame

	// Selection
	rubberBand: { startFrame: number; endFrame: number } | null;

	// Snap
	snap: SnapOptions;

	// History
	history: HistorySnapshot[];
	historyIndex: number;

	// Loaders
	loadFromScenes: (
		scenes: TimelineScene[],
		opts: {
			scriptId: string;
			fps?: number;
			width?: number;
			height?: number;
			bpm?: number;
			beats?: number[];
			bgmUrl?: string;
		},
	) => void;

	// Basic ops
	setPlayhead: (frame: number) => void;
	setZoom: (zoom: number) => void;
	setSnap: (snap: Partial<SnapOptions>) => void;
	setBpmBeats: (bpm: number, beats: number[]) => void;
	setBgmUrl: (url?: string) => void;

	// Clip ops (모두 자동 history save)
	moveClip: (id: string, toFrame: number, toTrackId?: string) => void;
	moveSelection: (deltaFrames: number, trackOffset?: number) => void;
	trimLeft: (id: string, deltaFrames: number) => void;
	trimRight: (id: string, deltaFrames: number) => void;
	splitAt: (id: string, frame: number) => void;
	splitSelectedAtPlayhead: () => void;
	deleteClip: (id: string) => void;
	rippleDelete: (id: string) => void;
	rippleDeleteSelected: () => void;
	deleteSelected: () => void;
	addClip: (clip: TimelineClip, ripple?: boolean) => void;
	rollEdit: (leftId: string, rightId: string, deltaFrames: number) => void;
	slipClip: (id: string, deltaFrames: number) => void;
	slideClip: (id: string, deltaFrames: number) => void;

	// Clip effect updates
	updateClip: (id: string, patch: Partial<TimelineClip>) => void;
	/** snapshot 호출 없는 경량 업데이트 — drag 중 고빈도 patch 용 */
	updateClipSilent: (id: string, patch: Partial<TimelineClip>) => void;
	setColorGrade: (id: string, grade: ColorGradeSpec | undefined) => void;
	setClipAudioEffects: (
		id: string,
		effects: import("./audio-effects").AudioEffect[],
	) => void;

	// Selection
	select: (id: string, additive?: boolean) => void;
	selectAll: () => void;
	selectInRange: (
		startFrame: number,
		endFrame: number,
		trackId?: string,
	) => void;
	clearSelection: () => void;
	setRubberBand: (range: TimelineState["rubberBand"]) => void;

	// Tracks
	addTrack: (kind: TimelineTrack["kind"], name?: string) => string;
	removeTrack: (id: string) => void;
	updateTrack: (id: string, patch: Partial<TimelineTrack>) => void;
	reorderTrack: (id: string, newOrder: number) => void;

	// Keyframes / automation
	setClipVolumeKeyframe: (
		id: string,
		frame: number,
		value: number,
		ease?: "linear" | "hold" | "smooth",
	) => void;
	removeClipVolumeKeyframe: (id: string, frame: number) => void;
	setTrackVolumeKeyframe: (
		id: string,
		frame: number,
		value: number,
		ease?: "linear" | "hold" | "smooth",
	) => void;

	// Transform keyframes (Phase 6)
	setTransformKeyframeAtPlayhead: (
		id: string,
		prop: TransformProp,
		value: number,
		ease?: "linear" | "hold" | "smooth",
	) => void;
	removeTransformKeyframeAt: (
		id: string,
		prop: TransformProp,
		localFrame: number,
	) => void;
	/** 기존 keyframe 의 ease 만 변경 (value/frame 유지). 없는 frame 이면 no-op */
	updateKeyframeEase: (
		id: string,
		prop: TransformProp,
		localFrame: number,
		ease: "linear" | "smooth" | "hold" | "bezier",
	) => void;
	/** 기존 keyframe 의 value 만 변경 (frame/ease 유지). silent 면 snapshot 생략 — drag 중 사용 */
	updateKeyframeValue: (
		id: string,
		prop: TransformProp,
		localFrame: number,
		value: number,
		silent?: boolean,
	) => void;
	clearTransform: (id: string, prop: TransformProp) => void;

	/** automation curve keyframe bezier tangent 설정. silent=true 면 snapshot 생략 (drag 중) */
	updateAutomationTangent: (
		id: string,
		prop: TransformProp,
		localFrame: number,
		tangent: { in?: BezierTangent; out?: BezierTangent },
		silent?: boolean,
	) => void;

	/** motion knot bezier tangent 설정. silent=true 면 snapshot 생략 (drag 중) */
	updateKeyframeTangent: (
		id: string,
		localFrame: number,
		tangent: { in?: BezierTangent; out?: BezierTangent },
		silent?: boolean,
	) => void;

	// Motion path (Phase 9/17)
	setMotionKnotAt: (
		id: string,
		localFrame: number,
		x: number,
		y: number,
		ease?: "linear" | "hold" | "smooth" | "bezier",
		/** true 면 history 스냅샷 생략 — drag 중 고빈도 호출용 */
		silent?: boolean,
	) => void;
	setMotionKnotAtPlayhead: (id: string, x: number, y: number) => void;
	removeMotionKnotAt: (id: string, localFrame: number) => void;

	// Multicam (Phase 19/19.5)
	setMulticamCut: (groupId: string, frame: number, angle: number) => void;
	removeMulticamCut: (groupId: string, frame: number) => void;
	setMulticamActiveAngle: (groupId: string, angle: number) => void;
	setMulticamAudioAngle: (groupId: string, angle: number) => void;
	/** 선택 2+ 클립 → 새 그룹 생성, startFrame 순 angle 바인딩. 반환=groupId */
	createMulticamGroupFromClips: (
		clipIds: string[],
		name?: string,
	) => string | null;
	/** 그룹 해제 — 해당 groupId 참조 모든 클립의 multicam 바인딩 제거 + 그룹 삭제 */
	disbandMulticamGroup: (groupId: string) => void;
	/** 그룹 이름 변경 */
	renameMulticamGroup: (groupId: string, name: string) => void;
	/** angle 개수 변경 — 기존 cuts/active/audio 자동 clamp (multicam.setAngleCount 위임).
	 *  줄일 때 해당 angle 보다 높은 클립은 multicam 해제 (고아 방지). */
	setMulticamAngleCount: (groupId: string, count: number) => void;

	// Markers
	addMarker: (frame: number, label: string) => void;
	removeMarker: (id: string) => void;

	// Snap helper
	snapFrame: (
		frame: number,
		excludeClipId?: string,
	) => {
		frame: number;
		snapped: boolean;
	};

	// Derived
	totalFrames: () => number;
	getClip: (id: string) => TimelineClip | undefined;
	selected: () => TimelineClip[];

	// Converters (렌더/저장)
	toRemotionScenes: () => RemotionScene[];
	toSceneRecords: () => SceneRecordPlan;
	liveSceneIds: () => string[];

	// History
	undo: () => void;
	redo: () => void;
	snapshot: () => void;

	/**
	 * 저장된 TimelineProject 를 로드하면서 blob URL 재발급.
	 * - clip.src 계열이 blob: 이고 storagePath 있음 → 재발급 (fetch + createObjectURL)
	 * - blob: 이지만 storagePath 없음 → "" 로 초기화 (손실 클립 표시)
	 * - 그 외 → 그대로 사용
	 */
	loadProject: (project: TimelineProject) => Promise<void>;
}

function cloneProject(p: TimelineProject): TimelineProject {
	return {
		...p,
		tracks: p.tracks.map((t) => ({ ...t })),
		clips: p.clips.map((c) => ({
			...c,
			position: { ...c.position },
			meta: { ...c.meta },
			motionGraphics: c.motionGraphics ? [...c.motionGraphics] : undefined,
		})),
		markers: p.markers.map((m) => ({ ...m })),
	};
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
	project: null,
	playhead: 0,
	zoom: 2,
	rubberBand: null,
	snap: {
		enabled: true,
		threshold: DEFAULT_SNAP_THRESHOLD,
		includePlayhead: true,
		includeBeats: true,
		includeMarkers: true,
	},
	history: [],
	historyIndex: -1,

	loadFromScenes: (scenes, opts) => {
		const project = fromScenes(scenes, opts);
		const snap: HistorySnapshot = {
			project: cloneProject(project),
			ts: Date.now(),
		};
		set({
			project,
			playhead: 0,
			history: [snap],
			historyIndex: 0,
		});
	},

	loadProject: async (project) => {
		/** blob URL 이 유효한지 간단히 확인 (HEAD fetch로 접근 테스트). */
		async function isBlobAlive(url: string): Promise<boolean> {
			try {
				const res = await fetch(url, { method: "HEAD" });
				return res.ok;
			} catch {
				return false;
			}
		}

		/** storagePath 에서 새 blob URL 재발급. 실패 시 null 반환. */
		async function reissueBlobUrl(storagePath: string): Promise<string | null> {
			try {
				const res = await fetch(storagePath);
				if (!res.ok) return null;
				const blob = await res.blob();
				return URL.createObjectURL(blob);
			} catch {
				return null;
			}
		}

		// URL 필드를 한 번에 정규화
		const urlFields = [
			"videoUrl",
			"audioUrl",
			"imageUrl",
			"mediaUrl",
		] as const satisfies ReadonlyArray<
			"videoUrl" | "audioUrl" | "imageUrl" | "mediaUrl"
		>;

		const repairedClips = await Promise.all(
			project.clips.map(async (clip) => {
				const patched: Partial<TimelineClip> = {};
				for (const field of urlFields) {
					const url = clip[field];
					if (!url?.startsWith("blob:")) continue;
					// blob URL 이 살아있으면 그대로
					if (await isBlobAlive(url)) continue;
					// storagePath 있으면 재발급
					if (clip.storagePath) {
						const fresh = await reissueBlobUrl(clip.storagePath);
						patched[field] = fresh ?? "";
					} else {
						// storagePath 없으면 손실 처리
						patched[field] = "";
					}
				}
				return Object.keys(patched).length > 0 ? { ...clip, ...patched } : clip;
			}),
		);

		const repaired: TimelineProject = { ...project, clips: repairedClips };
		const snap: HistorySnapshot = {
			project: cloneProject(repaired),
			ts: Date.now(),
		};
		set({
			project: repaired,
			playhead: 0,
			history: [snap],
			historyIndex: 0,
		});
	},

	setPlayhead: (frame) => set({ playhead: Math.max(0, Math.round(frame)) }),
	setZoom: (zoom) => set({ zoom: Math.max(0.2, Math.min(20, zoom)) }),
	setSnap: (partial) => set((s) => ({ snap: { ...s.snap, ...partial } })),
	setBpmBeats: (bpm, beats) => {
		const { project } = get();
		if (!project) return;
		set({ project: { ...project, bpm, beats } });
	},
	setBgmUrl: (url) => {
		const { project } = get();
		if (!project) return;
		set({ project: { ...project, bgmUrl: url } });
	},

	moveClip: (id, toFrame, toTrackId) => {
		const { project, snap } = get();
		if (!project) return;
		let finalFrame = toFrame;
		if (snap.enabled) {
			const targets = buildSnapTargets(project, {
				includePlayhead: snap.includePlayhead,
				playhead: get().playhead,
				includeBeats: snap.includeBeats,
				includeMarkers: snap.includeMarkers,
				excludeClipId: id,
			});
			finalFrame = applySnap(toFrame, targets, snap.threshold).frame;
		}
		set({ project: moveClipOp(project, id, finalFrame, toTrackId) });
		get().snapshot();
	},

	moveSelection: (deltaFrames, trackOffset = 0) => {
		const { project } = get();
		if (!project) return;
		const ids = project.clips.filter((c) => c.selected).map((c) => c.id);
		if (ids.length === 0) return;
		set({ project: moveClipsOp(project, ids, deltaFrames, trackOffset) });
		get().snapshot();
	},

	trimLeft: (id, deltaFrames) => {
		const { project } = get();
		if (!project) return;
		set({ project: trimLeftOp(project, id, deltaFrames) });
		get().snapshot();
	},

	trimRight: (id, deltaFrames) => {
		const { project } = get();
		if (!project) return;
		set({ project: trimRightOp(project, id, deltaFrames) });
		get().snapshot();
	},

	splitAt: (id, frame) => {
		const { project } = get();
		if (!project) return;
		set({ project: splitClipOp(project, id, frame) });
		get().snapshot();
	},

	splitSelectedAtPlayhead: () => {
		const { project, playhead } = get();
		if (!project) return;
		// 분할 전에 대상 클립 목록을 확정 — splitClipOp 이후 next에서 원본 id 소멸 방지
		const targets = project.clips
			.filter(
				(c) =>
					c.selected &&
					playhead > c.startFrame + 1 &&
					playhead < endFrameOf(c) - 1,
			)
			.map((c) => c.id);
		let next = project;
		for (const id of targets) {
			next = splitClipOp(next, id, playhead);
		}
		set({ project: next });
		get().snapshot();
	},

	deleteClip: (id) => {
		const { project } = get();
		if (!project) return;
		set({ project: deleteClipOp(project, id) });
		get().snapshot();
	},

	rippleDelete: (id) => {
		const { project } = get();
		if (!project) return;
		set({ project: rippleDeleteOp(project, id) });
		get().snapshot();
	},

	rippleDeleteSelected: () => {
		const { project } = get();
		if (!project) return;
		const ids = project.clips.filter((c) => c.selected).map((c) => c.id);
		let next = project;
		// 뒤에서 앞으로 삭제해야 프레임 shift 이 중첩 안됨
		const sorted = ids
			.map((id) => project.clips.find((c) => c.id === id))
			.filter((c): c is TimelineClip => !!c)
			.sort((a, b) => b.startFrame - a.startFrame);
		for (const c of sorted) next = rippleDeleteOp(next, c.id);
		set({ project: next });
		get().snapshot();
	},

	deleteSelected: () => {
		const { project } = get();
		if (!project) return;
		const ids = new Set(
			project.clips.filter((c) => c.selected).map((c) => c.id),
		);
		if (ids.size === 0) return;
		set({
			project: {
				...project,
				clips: project.clips.filter((c) => !ids.has(c.id)),
			},
		});
		get().snapshot();
	},

	addClip: (clip, ripple = false) => {
		const { project } = get();
		if (!project) return;
		if (ripple) {
			set({ project: rippleInsertOp(project, clip) });
		} else {
			set({ project: { ...project, clips: [...project.clips, clip] } });
		}
		get().snapshot();
	},

	rollEdit: (leftId, rightId, deltaFrames) => {
		const { project } = get();
		if (!project) return;
		set({ project: rollEditOp(project, leftId, rightId, deltaFrames) });
		get().snapshot();
	},

	slipClip: (id, deltaFrames) => {
		const { project } = get();
		if (!project) return;
		set({ project: slipClipOp(project, id, deltaFrames) });
		get().snapshot();
	},

	slideClip: (id, deltaFrames) => {
		const { project } = get();
		if (!project) return;
		set({ project: slideClipOp(project, id, deltaFrames) });
		get().snapshot();
	},

	updateClip: (id, patch) => {
		const { project } = get();
		if (!project) return;
		set({
			project: {
				...project,
				clips: project.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
			},
		});
		get().snapshot();
	},

	updateClipSilent: (id, patch) => {
		const { project } = get();
		if (!project) return;
		set({
			project: {
				...project,
				clips: project.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
			},
		});
	},

	setColorGrade: (id, grade) => {
		get().updateClip(id, { colorGrade: grade });
	},

	setClipAudioEffects: (id, effects) => {
		get().snapshot();
		get().updateClip(id, { audioEffects: effects });
	},

	select: (id, additive = false) => {
		const { project } = get();
		if (!project) return;
		set({ project: toggleSelectOp(project, id, additive) });
	},

	selectAll: () => {
		const { project } = get();
		if (!project) return;
		set({
			project: setSelectionOp(
				project,
				project.clips.map((c) => c.id),
			),
		});
	},

	selectInRange: (startFrame, endFrame, trackId) => {
		const { project } = get();
		if (!project) return;
		const ids = project.clips
			.filter(
				(c) =>
					(!trackId || c.trackId === trackId) &&
					c.startFrame < endFrame &&
					endFrameOf(c) > startFrame,
			)
			.map((c) => c.id);
		set({ project: setSelectionOp(project, ids) });
	},

	clearSelection: () => {
		const { project } = get();
		if (!project) return;
		set({ project: setSelectionOp(project, []) });
	},

	setRubberBand: (range) => set({ rubberBand: range }),

	addTrack: (kind, name) => {
		const { project } = get();
		if (!project) return "";
		const existingCount = project.tracks.filter((t) => t.kind === kind).length;
		const id = `${kind[0]}${existingCount + 1}-${Date.now()}`;
		const maxOrder = project.tracks.reduce((m, t) => Math.max(m, t.order), -1);
		const track: TimelineTrack = {
			id,
			kind,
			name: name ?? `${kind} ${existingCount + 1}`,
			height: kind === "video" ? 70 : kind === "audio" ? 60 : 36,
			muted: false,
			solo: false,
			visible: true,
			locked: false,
			volume: 1,
			pan: 0,
			order: maxOrder + 1,
		};
		set({ project: { ...project, tracks: [...project.tracks, track] } });
		get().snapshot();
		return id;
	},

	removeTrack: (id) => {
		const { project } = get();
		if (!project) return;
		set({
			project: {
				...project,
				tracks: project.tracks.filter((t) => t.id !== id),
				clips: project.clips.filter((c) => c.trackId !== id),
			},
		});
		get().snapshot();
	},

	updateTrack: (id, patch) => {
		const { project } = get();
		if (!project) return;
		set({
			project: {
				...project,
				tracks: project.tracks.map((t) =>
					t.id === id ? { ...t, ...patch } : t,
				),
			},
		});
		get().snapshot();
	},

	reorderTrack: (id, newOrder) => {
		get().updateTrack(id, { order: newOrder });
	},

	setClipVolumeKeyframe: (id, frame, value, ease) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip) return;
		const curve = clip.volumeEnvelope ?? {
			default: clip.volume,
			keyframes: [],
		};
		const updated = setKeyframe(curve, frame, value, ease);
		get().updateClip(id, { volumeEnvelope: updated });
	},

	removeClipVolumeKeyframe: (id, frame) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip?.volumeEnvelope) return;
		get().updateClip(id, {
			volumeEnvelope: removeKeyframe(clip.volumeEnvelope, frame),
		});
	},

	setTrackVolumeKeyframe: (id, frame, value, ease) => {
		const { project } = get();
		if (!project) return;
		const track = project.tracks.find((t) => t.id === id);
		if (!track) return;
		const curve = track.volumeAutomation ?? {
			default: track.volume,
			keyframes: [],
		};
		const updated = setKeyframe(curve, frame, value, ease);
		get().updateTrack(id, { volumeAutomation: updated });
	},

	setTransformKeyframeAtPlayhead: (id, prop, value, ease) => {
		const { project, playhead } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip) return;
		// 클립 영역 바깥이면 무시 (키프레임은 클립 로컬 시간)
		const local = playhead - clip.startFrame;
		if (local < 0 || local > clip.durationFrames) return;
		const updated = setTransformKeyframe(clip, prop, local, value, ease);
		get().updateClip(id, { transformKeyframes: updated });
	},

	removeTransformKeyframeAt: (id, prop, localFrame) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip?.transformKeyframes?.[prop]) return;
		const updated = removeTransformKeyframe(clip, prop, localFrame);
		get().updateClip(id, { transformKeyframes: updated });
		get().snapshot();
	},

	updateKeyframeEase: (id, prop, localFrame, ease) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		const curve = clip?.transformKeyframes?.[prop];
		if (!clip || !curve) return;
		const kf = curve.keyframes.find((k) => k.frame === localFrame);
		if (!kf) return;
		const nextCurve = setKeyframe(curve, localFrame, kf.value, ease);
		const tk = { ...clip.transformKeyframes, [prop]: nextCurve };
		get().updateClip(id, { transformKeyframes: tk });
		get().snapshot();
	},

	updateKeyframeValue: (id, prop, localFrame, value, silent = false) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		const curve = clip?.transformKeyframes?.[prop];
		if (!clip || !curve) return;
		const kf = curve.keyframes.find((k) => k.frame === localFrame);
		if (!kf) return;
		const nextCurve = setKeyframe(curve, localFrame, value, kf.ease);
		const tk = { ...clip.transformKeyframes, [prop]: nextCurve };
		if (silent) {
			get().updateClipSilent(id, { transformKeyframes: tk });
		} else {
			get().updateClip(id, { transformKeyframes: tk });
			get().snapshot();
		}
	},

	updateAutomationTangent: (id, prop, localFrame, tangent, silent = false) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		const curve = clip?.transformKeyframes?.[prop];
		if (!clip || !curve) return;
		const kfIdx = curve.keyframes.findIndex((k) => k.frame === localFrame);
		if (kfIdx === -1) return;
		const kf = curve.keyframes[kfIdx];
		const updatedKf: AutomationKeyframe = {
			...kf,
			...(tangent.in !== undefined ? { inTangent: tangent.in } : {}),
			...(tangent.out !== undefined ? { outTangent: tangent.out } : {}),
		};
		const updatedKfs = curve.keyframes.map((k, i) =>
			i === kfIdx ? updatedKf : k,
		);
		const updatedCurve = { ...curve, keyframes: updatedKfs };
		const tk = { ...clip.transformKeyframes, [prop]: updatedCurve };
		if (silent) {
			get().updateClipSilent(id, { transformKeyframes: tk });
		} else {
			get().updateClip(id, { transformKeyframes: tk });
			get().snapshot();
		}
	},

	clearTransform: (id, prop) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip?.transformKeyframes?.[prop]) return;
		const updated = clearTransformProp(clip, prop);
		get().updateClip(id, { transformKeyframes: updated });
	},

	setMotionKnotAt: (id, localFrame, x, y, ease = "linear", silent = false) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip) return;
		if (localFrame < 0 || localFrame > clip.durationFrames) return;
		const updated = setMotionKnot(clip, localFrame, x, y, ease);
		if (silent) {
			get().updateClipSilent(id, { transformKeyframes: updated });
		} else {
			get().updateClip(id, { transformKeyframes: updated });
		}
	},

	setMotionKnotAtPlayhead: (id, x, y) => {
		const { project, playhead } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip) return;
		const local = playhead - clip.startFrame;
		if (local < 0 || local > clip.durationFrames) return;
		const updated = setMotionKnot(clip, local, x, y);
		get().updateClip(id, { transformKeyframes: updated });
	},

	removeMotionKnotAt: (id, localFrame) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip?.transformKeyframes) return;
		const updated = removeMotionKnot(clip, localFrame);
		get().updateClip(id, { transformKeyframes: updated });
	},

	updateKeyframeTangent: (id, localFrame, tangent, silent = false) => {
		const { project } = get();
		if (!project) return;
		const clip = project.clips.find((c) => c.id === id);
		if (!clip) return;
		const updated = setMotionKnotTangent(clip, localFrame, tangent);
		if (!updated) return; // no matching keyframe — no-op
		if (silent) {
			get().updateClipSilent(id, { transformKeyframes: updated });
		} else {
			get().updateClip(id, { transformKeyframes: updated });
			get().snapshot();
		}
	},

	setMulticamCut: (groupId, frame, angle) => {
		const { project } = get();
		if (!project?.multicamGroups) return;
		const idx = project.multicamGroups.findIndex((g) => g.id === groupId);
		if (idx < 0) return;
		const updated = setCutOp(project.multicamGroups[idx], frame, angle);
		const groups = [...project.multicamGroups];
		groups[idx] = updated;
		set({ project: { ...project, multicamGroups: groups } });
		get().snapshot();
	},

	removeMulticamCut: (groupId, frame) => {
		const { project } = get();
		if (!project?.multicamGroups) return;
		const idx = project.multicamGroups.findIndex((g) => g.id === groupId);
		if (idx < 0) return;
		const updated = removeCutOp(project.multicamGroups[idx], frame);
		const groups = [...project.multicamGroups];
		groups[idx] = updated;
		set({ project: { ...project, multicamGroups: groups } });
		get().snapshot();
	},

	setMulticamActiveAngle: (groupId, angle) => {
		const { project } = get();
		if (!project?.multicamGroups) return;
		const idx = project.multicamGroups.findIndex((g) => g.id === groupId);
		if (idx < 0) return;
		const updated = setActiveAngleOp(project.multicamGroups[idx], angle);
		const groups = [...project.multicamGroups];
		groups[idx] = updated;
		set({ project: { ...project, multicamGroups: groups } });
		get().snapshot();
	},

	setMulticamAudioAngle: (groupId, angle) => {
		const { project } = get();
		if (!project?.multicamGroups) return;
		const idx = project.multicamGroups.findIndex((g) => g.id === groupId);
		if (idx < 0) return;
		const updated = setAudioAngleOp(project.multicamGroups[idx], angle);
		const groups = [...project.multicamGroups];
		groups[idx] = updated;
		set({ project: { ...project, multicamGroups: groups } });
		get().snapshot();
	},

	createMulticamGroupFromClips: (clipIds, name) => {
		const { project } = get();
		if (!project || clipIds.length < 2) return null;
		const chosen = project.clips
			.filter((c) => clipIds.includes(c.id))
			.sort((a, b) => a.startFrame - b.startFrame);
		if (chosen.length < 2) return null;
		const groupId = `mc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const groupName =
			name ?? `Multicam ${(project.multicamGroups?.length ?? 0) + 1}`;
		const group = createGroupOp(groupId, groupName, chosen.length);
		const updatedClips = project.clips.map((c) => {
			const angle = chosen.findIndex((x) => x.id === c.id);
			if (angle < 0) return c;
			return { ...c, multicam: { groupId, angle } };
		});
		set({
			project: {
				...project,
				clips: updatedClips,
				multicamGroups: [...(project.multicamGroups ?? []), group],
			},
		});
		get().snapshot();
		return groupId;
	},

	disbandMulticamGroup: (groupId) => {
		const { project } = get();
		if (!project?.multicamGroups) return;
		const updatedClips = project.clips.map((c) =>
			c.multicam?.groupId === groupId ? { ...c, multicam: undefined } : c,
		);
		set({
			project: {
				...project,
				clips: updatedClips,
				multicamGroups: project.multicamGroups.filter((g) => g.id !== groupId),
			},
		});
		get().snapshot();
	},

	renameMulticamGroup: (groupId, name) => {
		const { project } = get();
		if (!project?.multicamGroups) return;
		const trimmed = name.trim().slice(0, 40);
		if (!trimmed) return;
		const groups = project.multicamGroups.map((g) =>
			g.id === groupId ? { ...g, name: trimmed } : g,
		);
		set({ project: { ...project, multicamGroups: groups } });
		get().snapshot();
	},

	setMulticamAngleCount: (groupId, count) => {
		const { project } = get();
		if (!project?.multicamGroups) return;
		const idx = project.multicamGroups.findIndex((g) => g.id === groupId);
		if (idx < 0) return;
		const updated = setAngleCountOp(project.multicamGroups[idx], count);
		const groups = [...project.multicamGroups];
		groups[idx] = updated;
		// 축소 시 초과 angle 클립은 고아 처리 (multicam 제거)
		const updatedClips = project.clips.map((c) => {
			if (c.multicam?.groupId !== groupId) return c;
			if (c.multicam.angle >= updated.angles) {
				return { ...c, multicam: undefined };
			}
			return c;
		});
		set({
			project: { ...project, clips: updatedClips, multicamGroups: groups },
		});
		get().snapshot();
	},

	addMarker: (frame, label) => {
		const { project } = get();
		if (!project) return;
		const m = { id: `m-${Date.now()}`, frame, label };
		set({ project: { ...project, markers: [...project.markers, m] } });
		get().snapshot();
	},

	removeMarker: (id) => {
		const { project } = get();
		if (!project) return;
		set({
			project: {
				...project,
				markers: project.markers.filter((m) => m.id !== id),
			},
		});
		get().snapshot();
	},

	snapFrame: (frame, excludeClipId) => {
		const { project, snap, playhead } = get();
		if (!project || !snap.enabled) return { frame, snapped: false };
		const targets = buildSnapTargets(project, {
			includePlayhead: snap.includePlayhead,
			playhead,
			includeBeats: snap.includeBeats,
			includeMarkers: snap.includeMarkers,
			excludeClipId,
		});
		return applySnap(frame, targets, snap.threshold);
	},

	totalFrames: () => {
		const { project } = get();
		return project ? totalDurationFrames(project) : 0;
	},

	getClip: (id) => {
		const { project } = get();
		return project?.clips.find((c) => c.id === id);
	},

	selected: () => {
		const { project } = get();
		return project ? project.clips.filter((c) => c.selected) : [];
	},

	toRemotionScenes: () => {
		const { project } = get();
		return project ? toRemotionScenes(project) : [];
	},

	toSceneRecords: () => {
		const { project } = get();
		return project ? toScenes(project) : { update: [], insert: [] };
	},

	liveSceneIds: () => {
		const { project } = get();
		return project ? existingSceneIds(project) : [];
	},

	snapshot: () => {
		const { project, history, historyIndex } = get();
		if (!project) return;
		const snap: HistorySnapshot = {
			project: cloneProject(project),
			ts: Date.now(),
		};
		const truncated = history.slice(0, historyIndex + 1);
		const next = [...truncated, snap].slice(-MAX_HISTORY);
		set({ history: next, historyIndex: next.length - 1 });
	},

	undo: () => {
		const { history, historyIndex } = get();
		if (historyIndex <= 0) return;
		const prev = history[historyIndex - 1];
		set({
			project: cloneProject(prev.project),
			historyIndex: historyIndex - 1,
		});
	},

	redo: () => {
		const { history, historyIndex } = get();
		if (historyIndex >= history.length - 1) return;
		const next = history[historyIndex + 1];
		set({
			project: cloneProject(next.project),
			historyIndex: historyIndex + 1,
		});
	},
}));

/** 자동화 커브 평가 헬퍼 — 컴포지션/미리보기에서 사용 */
export function effectiveVolumeAtFrame(
	clip: TimelineClip,
	frame: number,
): number {
	if (clip.muted) return 0;
	if (!clip.volumeEnvelope) return clip.volume;
	const local = frame - clip.startFrame;
	return evaluateCurve(clip.volumeEnvelope, local);
}

export function effectiveTrackVolumeAtFrame(
	track: TimelineTrack,
	frame: number,
): number {
	if (track.muted) return 0;
	if (!track.volumeAutomation) return track.volume;
	return evaluateCurve(track.volumeAutomation, frame);
}

/** 프레임별 effective transform (키프레임 보간 or static) */
export function effectiveTransformAtFrame(
	clip: TimelineClip,
	globalFrame: number,
): EffectiveTransform {
	return evaluateTransform(clip, globalFrame);
}
