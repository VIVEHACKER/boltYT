/**
 * Timeline Editor 상태 관리 (Zustand).
 * Scene 배열, 재생헤드, 선택된 클립, undo/redo 스택.
 */

import { create } from "zustand";
import type { Scene } from "../types/database";

export type TimelineScene = Scene & {
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
};

interface HistorySnapshot {
	scenes: TimelineScene[];
	timestamp: number;
}

interface EditorState {
	// 현재 상태
	scenes: TimelineScene[];
	playhead: number; // 전역 프레임
	selectedSceneId: string | null;
	zoom: number; // pixel per frame (1-10)
	bpm: number; // 비트 그리드
	beats: number[]; // 실측 비트 (초)

	// 히스토리
	history: HistorySnapshot[];
	historyIndex: number;

	// Actions
	setScenes: (scenes: TimelineScene[]) => void;
	updateScene: (id: string, patch: Partial<TimelineScene>) => void;
	splitScene: (id: string, atFrame: number) => void;
	deleteScene: (id: string) => void;
	setPlayhead: (frame: number) => void;
	setSelected: (id: string | null) => void;
	setZoom: (zoom: number) => void;
	setBpmBeats: (bpm: number, beats: number[]) => void;

	undo: () => void;
	redo: () => void;
	saveSnapshot: () => void;

	// 계산된 값
	totalFrames: () => number;
}

const MAX_HISTORY = 50;

function cloneScenes(scenes: TimelineScene[]): TimelineScene[] {
	return scenes.map((s) => ({ ...s }));
}

export const useEditorStore = create<EditorState>((set, get) => ({
	scenes: [],
	playhead: 0,
	selectedSceneId: null,
	zoom: 2,
	bpm: 0,
	beats: [],
	history: [],
	historyIndex: -1,

	setScenes: (scenes) => {
		const initialSnap: HistorySnapshot = {
			scenes: cloneScenes(scenes),
			timestamp: Date.now(),
		};
		set({
			scenes,
			history: [initialSnap],
			historyIndex: 0,
		});
	},

	updateScene: (id, patch) => {
		const { scenes } = get();
		const next = scenes.map((s) => (s.id === id ? { ...s, ...patch } : s));
		set({ scenes: next });
		get().saveSnapshot();
	},

	splitScene: (id, atFrame) => {
		const { scenes } = get();
		const idx = scenes.findIndex((s) => s.id === id);
		if (idx < 0) return;
		const src = scenes[idx];
		const srcStart = (src.start_frame as number | undefined) ?? 0;
		const srcDur = Math.ceil(src.duration_seconds * 30);
		const local = atFrame - srcStart;
		if (local <= 4 || local >= srcDur - 4) return; // 너무 짧은 분할 방지

		const firstDur = local / 30;
		const secondDur = (srcDur - local) / 30;

		const first: TimelineScene = {
			...src,
			duration_seconds: Number(firstDur.toFixed(2)),
		};
		const second: TimelineScene = {
			...src,
			id: `${src.id}-split-${Date.now()}`,
			duration_seconds: Number(secondDur.toFixed(2)),
			start_frame: atFrame,
		};

		const next = [
			...scenes.slice(0, idx),
			first,
			second,
			...scenes.slice(idx + 1),
		];
		set({ scenes: next });
		get().saveSnapshot();
	},

	deleteScene: (id) => {
		const { scenes } = get();
		set({ scenes: scenes.filter((s) => s.id !== id) });
		get().saveSnapshot();
	},

	setPlayhead: (frame) => set({ playhead: Math.max(0, frame) }),
	setSelected: (id) => set({ selectedSceneId: id }),
	setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(10, zoom)) }),
	setBpmBeats: (bpm, beats) => set({ bpm, beats }),

	saveSnapshot: () => {
		const { scenes, history, historyIndex } = get();
		const snap: HistorySnapshot = {
			scenes: cloneScenes(scenes),
			timestamp: Date.now(),
		};
		// 현재 포인터 이후 히스토리 폐기 (새 분기)
		const truncated = history.slice(0, historyIndex + 1);
		const nextHistory = [...truncated, snap].slice(-MAX_HISTORY);
		set({
			history: nextHistory,
			historyIndex: nextHistory.length - 1,
		});
	},

	undo: () => {
		const { history, historyIndex } = get();
		if (historyIndex <= 0) return;
		const prev = history[historyIndex - 1];
		set({
			scenes: cloneScenes(prev.scenes),
			historyIndex: historyIndex - 1,
		});
	},

	redo: () => {
		const { history, historyIndex } = get();
		if (historyIndex >= history.length - 1) return;
		const next = history[historyIndex + 1];
		set({
			scenes: cloneScenes(next.scenes),
			historyIndex: historyIndex + 1,
		});
	},

	totalFrames: () => {
		const { scenes } = get();
		return scenes.reduce(
			(sum, s) => sum + Math.ceil(s.duration_seconds * 30),
			0,
		);
	},
}));
