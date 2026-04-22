/**
 * useTimelineStore 단위 테스트
 *
 * timeline-model.ts 의 순수 연산은 별도 테스트 존재 (timeline-model.test.ts).
 * 여기서는 Zustand store 계층의 책임을 검증한다:
 *   - 액션 → 상태 반영
 *   - history/undo/redo 관리
 *   - null guard (project 없을 때 no-op)
 *   - 파생 getter
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TimelineScene } from "./editor-store";
import { newClipId } from "./timeline-model";
import {
	effectiveTrackVolumeAtFrame,
	effectiveTransformAtFrame,
	effectiveVolumeAtFrame,
	useTimelineStore,
} from "./timeline-store";

// ─── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────

function makeScene(
	overrides: Partial<TimelineScene> = {},
	index = 0,
): TimelineScene {
	return {
		id: `scene-${index}-${Math.random().toString(36).slice(2, 6)}`,
		script_id: "script-1",
		order_index: index,
		narration_text: "테스트 나레이션",
		duration_seconds: 5,
		scene_type: "image",
		status: "draft",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	} as unknown as TimelineScene;
}

function loadTwo() {
	const { loadFromScenes } = useTimelineStore.getState();
	loadFromScenes([makeScene({}, 0), makeScene({}, 1)], {
		scriptId: "script-1",
	});
}

function loadOne() {
	const { loadFromScenes } = useTimelineStore.getState();
	loadFromScenes([makeScene({}, 0)], { scriptId: "script-1" });
}

// ─── 초기화 ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	useTimelineStore.setState({
		project: null,
		playhead: 0,
		zoom: 2,
		rubberBand: null,
		snap: {
			enabled: true,
			threshold: 6,
			includePlayhead: true,
			includeBeats: true,
			includeMarkers: true,
		},
		history: [],
		historyIndex: -1,
	});
});

// ─── 초기 상태 및 null guard ──────────────────────────────────────────────────

describe("초기 상태 및 null guard", () => {
	it("초기 project 는 null", () => {
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("project 없을 때 moveClip → no-op", () => {
		useTimelineStore.getState().moveClip("x", 10);
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("project 없을 때 totalFrames → 0", () => {
		expect(useTimelineStore.getState().totalFrames()).toBe(0);
	});

	it("project 없을 때 selected → 빈 배열", () => {
		expect(useTimelineStore.getState().selected()).toEqual([]);
	});

	it("project 없을 때 toRemotionScenes → 빈 배열", () => {
		expect(useTimelineStore.getState().toRemotionScenes()).toEqual([]);
	});
});

// ─── loadFromScenes ────────────────────────────────────────────────────────────

describe("loadFromScenes", () => {
	it("씬 2개 로드 → project 생성", () => {
		loadTwo();
		const { project } = useTimelineStore.getState();
		expect(project).not.toBeNull();
		expect(project!.clips.length).toBeGreaterThanOrEqual(2);
	});

	it("로드 후 playhead 0 초기화", () => {
		useTimelineStore.setState({ playhead: 100 });
		loadTwo();
		expect(useTimelineStore.getState().playhead).toBe(0);
	});

	it("로드 후 history 1개 스냅샷 존재", () => {
		loadTwo();
		const { history, historyIndex } = useTimelineStore.getState();
		expect(history.length).toBe(1);
		expect(historyIndex).toBe(0);
	});
});

// ─── 기본 setter ──────────────────────────────────────────────────────────────

describe("setPlayhead / setZoom / setSnap", () => {
	it("setPlayhead 정수 변환 + 0 하한", () => {
		const { setPlayhead } = useTimelineStore.getState();
		setPlayhead(37.9);
		expect(useTimelineStore.getState().playhead).toBe(38);
		setPlayhead(-5);
		expect(useTimelineStore.getState().playhead).toBe(0);
	});

	it("setZoom 0.2~20 클램프", () => {
		const { setZoom } = useTimelineStore.getState();
		setZoom(0.01);
		expect(useTimelineStore.getState().zoom).toBe(0.2);
		setZoom(999);
		expect(useTimelineStore.getState().zoom).toBe(20);
		setZoom(5);
		expect(useTimelineStore.getState().zoom).toBe(5);
	});

	it("setSnap partial 업데이트", () => {
		useTimelineStore.getState().setSnap({ enabled: false, threshold: 12 });
		const { snap } = useTimelineStore.getState();
		expect(snap.enabled).toBe(false);
		expect(snap.threshold).toBe(12);
		expect(snap.includePlayhead).toBe(true); // 기존 값 유지
	});
});

// ─── 프로젝트 메타데이터 ───────────────────────────────────────────────────────

describe("setBgmUrl / setBpmBeats", () => {
	it("setBgmUrl 저장", () => {
		loadOne();
		useTimelineStore.getState().setBgmUrl("https://cdn.example.com/bgm.mp3");
		expect(useTimelineStore.getState().project!.bgmUrl).toBe(
			"https://cdn.example.com/bgm.mp3",
		);
	});

	it("setBpmBeats 저장", () => {
		loadOne();
		useTimelineStore.getState().setBpmBeats(120, [0, 0.5, 1.0]);
		const p = useTimelineStore.getState().project;
		expect(p?.bpm).toBe(120);
		expect(p?.beats).toEqual([0, 0.5, 1.0]);
	});

	it("project 없으면 no-op", () => {
		useTimelineStore.getState().setBgmUrl("x");
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── 클립 추가 / 삭제 ─────────────────────────────────────────────────────────

describe("addClip / deleteClip / deleteSelected", () => {
	it("addClip → clips 에 추가 + snapshot", () => {
		loadOne();
		const { addClip, project } = useTimelineStore.getState();
		const trackId = project!.tracks[0].id;
		const before = project!.clips.length;
		addClip({
			id: newClipId(),
			trackId,
			startFrame: 300,
			durationFrames: 60,
			sourceIn: 0,
			sourceOut: 60,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			kind: "video",
			volume: 1,
			muted: false,
			selected: false,
			locked: false,
			meta: {},
		});
		const after = useTimelineStore.getState().project!.clips.length;
		expect(after).toBe(before + 1);
	});

	it("deleteClip → clips 에서 제거 + snapshot", () => {
		loadOne();
		const clipId = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().deleteClip(clipId);
		const found = useTimelineStore
			.getState()
			.project!.clips.find((c) => c.id === clipId);
		expect(found).toBeUndefined();
	});

	it("deleteSelected → 선택 클립만 제거", () => {
		loadTwo();
		const s = useTimelineStore.getState();
		const ids = (s.project!.clips ?? []).slice(0, 2).map((c) => c.id);
		for (const id of ids) s.select(id, true);
		const beforeCount = s.project!.clips.length ?? 0;
		useTimelineStore.getState().deleteSelected();
		const afterCount = useTimelineStore.getState().project!.clips.length ?? 0;
		expect(afterCount).toBeLessThan(beforeCount);
	});
});

// ─── 트랙 관리 ────────────────────────────────────────────────────────────────

describe("addTrack / removeTrack / updateTrack", () => {
	it("addTrack → tracks 에 추가, id 반환", () => {
		loadOne();
		const before = useTimelineStore.getState().project!.tracks.length;
		const id = useTimelineStore.getState().addTrack("audio", "BGM");
		expect(typeof id).toBe("string");
		const after = useTimelineStore.getState().project!.tracks.length;
		expect(after).toBe(before + 1);
	});

	it("removeTrack → tracks 에서 제거", () => {
		loadOne();
		const id = useTimelineStore.getState().addTrack("audio");
		useTimelineStore.getState().removeTrack(id);
		const found = useTimelineStore
			.getState()
			.project!.tracks.find((t) => t.id === id);
		expect(found).toBeUndefined();
	});

	it("updateTrack → name 패치", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.tracks[0].id;
		useTimelineStore.getState().updateTrack(id, { name: "Renamed" });
		const track = useTimelineStore
			.getState()
			.project!.tracks.find((t) => t.id === id);
		expect(track?.name).toBe("Renamed");
	});
});

// ─── 마커 ─────────────────────────────────────────────────────────────────────

describe("addMarker / removeMarker", () => {
	it("addMarker → markers 에 추가", () => {
		loadOne();
		useTimelineStore.getState().addMarker(60, "씬 시작");
		const markers = useTimelineStore.getState().project!.markers;
		expect(markers.some((m) => m.label === "씬 시작" && m.frame === 60)).toBe(
			true,
		);
	});

	it("removeMarker → 해당 marker 제거", () => {
		loadOne();
		useTimelineStore.getState().addMarker(60, "임시");
		const id = useTimelineStore.getState().project!.markers.at(-1)!.id;
		useTimelineStore.getState().removeMarker(id);
		const found = useTimelineStore
			.getState()
			.project!.markers.find((m) => m.id === id);
		expect(found).toBeUndefined();
	});
});

// ─── 선택 ─────────────────────────────────────────────────────────────────────

describe("select / clearSelection / selectAll", () => {
	it("select → 단일 선택", () => {
		loadTwo();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().select(id);
		expect(useTimelineStore.getState().selected().length).toBe(1);
		expect(useTimelineStore.getState().selected()[0].id).toBe(id);
	});

	it("select additive=true → 다중 선택", () => {
		loadTwo();
		const [a, b] = useTimelineStore.getState().project!.clips;
		useTimelineStore.getState().select(a.id);
		useTimelineStore.getState().select(b.id, true);
		expect(useTimelineStore.getState().selected().length).toBe(2);
	});

	it("clearSelection → 모두 해제", () => {
		loadTwo();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().select(id);
		useTimelineStore.getState().clearSelection();
		expect(useTimelineStore.getState().selected().length).toBe(0);
	});

	it("selectAll → 전체 선택", () => {
		loadTwo();
		useTimelineStore.getState().selectAll();
		const total = useTimelineStore.getState().project!.clips.length;
		expect(useTimelineStore.getState().selected().length).toBe(total);
	});
});

// ─── History: undo / redo ─────────────────────────────────────────────────────

describe("undo / redo", () => {
	it("undo → 이전 상태 복원", () => {
		loadOne();
		const { addClip, undo, project } = useTimelineStore.getState();
		const trackId = project!.tracks[0].id;
		const clipsBefore = project!.clips.length;
		addClip({
			id: newClipId(),
			trackId,
			startFrame: 300,
			durationFrames: 30,
			sourceIn: 0,
			sourceOut: 30,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			kind: "video",
			volume: 1,
			muted: false,
			selected: false,
			locked: false,
			meta: {},
		});
		expect(useTimelineStore.getState().project!.clips.length).toBe(
			clipsBefore + 1,
		);
		undo();
		expect(useTimelineStore.getState().project!.clips.length).toBe(clipsBefore);
	});

	it("redo → undo 후 재적용", () => {
		loadOne();
		const { addClip, undo, redo, project } = useTimelineStore.getState();
		const trackId = project!.tracks[0].id;
		const before = project!.clips.length;
		addClip({
			id: newClipId(),
			trackId,
			startFrame: 300,
			durationFrames: 30,
			sourceIn: 0,
			sourceOut: 30,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			kind: "video",
			volume: 1,
			muted: false,
			selected: false,
			locked: false,
			meta: {},
		});
		undo();
		redo();
		expect(useTimelineStore.getState().project!.clips.length).toBe(before + 1);
	});

	it("historyIndex=0 에서 undo → no-op", () => {
		loadOne();
		const clipsBefore = useTimelineStore.getState().project!.clips.length;
		useTimelineStore.getState().undo();
		expect(useTimelineStore.getState().project!.clips.length).toBe(clipsBefore);
	});

	it("undo 후 새 액션 → redo 스택 소거", () => {
		loadOne();
		const s = useTimelineStore.getState();
		const trackId = s.project!.tracks[0].id;
		const makeClip = (sf: number) => ({
			id: newClipId(),
			trackId,
			startFrame: sf,
			durationFrames: 30,
			sourceIn: 0,
			sourceOut: 30,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			kind: "video" as const,
			volume: 1,
			muted: false,
			selected: false,
			locked: false,
			meta: {},
		});
		s.addClip(makeClip(300));
		useTimelineStore.getState().undo();
		useTimelineStore.getState().addClip(makeClip(600)); // 새 액션
		// redo 스택 소거 → 이전 히스토리보다 길지 않아야
		expect(useTimelineStore.getState().historyIndex).toBe(
			useTimelineStore.getState().history.length - 1,
		);
	});

	it("MAX_HISTORY(50) 초과 시 오래된 항목 제거", () => {
		loadOne();
		// 50번 이상 addMarker 로 snapshot 유발
		for (let i = 0; i < 55; i++) {
			useTimelineStore.getState().addMarker(i * 10, `m${i}`);
		}
		expect(useTimelineStore.getState().history.length).toBeLessThanOrEqual(50);
	});
});

// ─── snapshot / updateClipSilent ──────────────────────────────────────────────

describe("snapshot / updateClipSilent", () => {
	it("snapshot 은 historyIndex 증가", () => {
		loadOne();
		const before = useTimelineStore.getState().historyIndex;
		useTimelineStore.getState().snapshot();
		expect(useTimelineStore.getState().historyIndex).toBe(before + 1);
	});

	it("updateClipSilent → 상태 변경 but historyIndex 불변", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		const hiBefore = useTimelineStore.getState().historyIndex;
		useTimelineStore.getState().updateClipSilent(id, { volume: 0.3 });
		expect(useTimelineStore.getState().historyIndex).toBe(hiBefore);
		expect(useTimelineStore.getState().getClip(id)?.volume).toBe(0.3);
	});
});

// ─── 파생 getter ──────────────────────────────────────────────────────────────

describe("totalFrames / getClip", () => {
	it("totalFrames → 전체 씬 프레임 합산", () => {
		loadTwo(); // 각 5초 × 30fps = 150프레임
		expect(useTimelineStore.getState().totalFrames()).toBeGreaterThan(0);
	});

	it("getClip → id 로 클립 조회", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		expect(useTimelineStore.getState().getClip(id)).toBeDefined();
		expect(useTimelineStore.getState().getClip("nonexistent")).toBeUndefined();
	});
});

// ─── effectiveVolume 헬퍼 ────────────────────────────────────────────────────

describe("effectiveVolumeAtFrame / effectiveTrackVolumeAtFrame", () => {
	it("muted=true → 0", () => {
		const clip = {
			id: "c1",
			trackId: "t1",
			startFrame: 0,
			durationFrames: 30,
			sourceIn: 0,
			sourceOut: 30,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			kind: "video" as const,
			volume: 0.8,
			muted: true,
			selected: false,
			locked: false,
			meta: {},
		};
		expect(effectiveVolumeAtFrame(clip, 0)).toBe(0);
	});

	it("muted=false, envelope 없음 → clip.volume 반환", () => {
		const clip = {
			id: "c1",
			trackId: "t1",
			startFrame: 0,
			durationFrames: 30,
			sourceIn: 0,
			sourceOut: 30,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			kind: "video" as const,
			volume: 0.7,
			muted: false,
			selected: false,
			locked: false,
			meta: {},
		};
		expect(effectiveVolumeAtFrame(clip, 10)).toBe(0.7);
	});

	it("track muted → 0", () => {
		const track = {
			id: "t1",
			kind: "video" as const,
			name: "V1",
			order: 0,
			height: 80,
			solo: false,
			visible: true,
			pan: 0,
			volume: 1,
			muted: true,
			locked: false,
		};
		expect(effectiveTrackVolumeAtFrame(track, 0)).toBe(0);
	});

	it("track volume, automation 없음 → track.volume", () => {
		const track = {
			id: "t1",
			kind: "video" as const,
			name: "V1",
			order: 0,
			height: 80,
			solo: false,
			visible: true,
			pan: 0,
			volume: 0.6,
			muted: false,
			locked: false,
		};
		expect(effectiveTrackVolumeAtFrame(track, 0)).toBe(0.6);
	});

	it("envelope 있을 때 — 보간값 반환 (number)", () => {
		const clip = {
			id: "c1",
			trackId: "t1",
			startFrame: 0,
			durationFrames: 30,
			sourceIn: 0,
			sourceOut: 30,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			kind: "video" as const,
			volume: 0.5,
			muted: false,
			selected: false,
			locked: false,
			meta: {},
			volumeEnvelope: {
				default: 0.5,
				keyframes: [{ frame: 0, value: 1.0, ease: "linear" as const }],
			},
		};
		expect(typeof effectiveVolumeAtFrame(clip, 0)).toBe("number");
	});

	it("track volumeAutomation 있을 때 — 보간값 반환 (number)", () => {
		const track = {
			id: "t1",
			kind: "video" as const,
			name: "V1",
			order: 0,
			height: 80,
			solo: false,
			visible: true,
			pan: 0,
			volume: 0.8,
			muted: false,
			locked: false,
			volumeAutomation: {
				default: 0.8,
				keyframes: [{ frame: 0, value: 1.0, ease: "linear" as const }],
			},
		};
		expect(typeof effectiveTrackVolumeAtFrame(track, 0)).toBe("number");
	});
});

// ─── effectiveTransformAtFrame ────────────────────────────────────────────────

describe("effectiveTransformAtFrame", () => {
	it("키프레임 없는 클립 → static transform 반환", () => {
		loadOne();
		const clip = useTimelineStore.getState().project!.clips[0];
		const t = effectiveTransformAtFrame(clip, 0);
		expect(t).toBeDefined();
	});
});

// ─── toRemotionScenes (project 있을 때) ───────────────────────────────────────

describe("toRemotionScenes (project 있을 때)", () => {
	it("loadOne 후 → 배열 반환", () => {
		loadOne();
		const scenes = useTimelineStore.getState().toRemotionScenes();
		expect(Array.isArray(scenes)).toBe(true);
	});
});

// ─── moveClip (project 있을 때) ────────────────────────────────────────────────

describe("moveClip (project 있을 때)", () => {
	it("클립 startFrame 변경 + snapshot", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().moveClip(id, 300);
		expect(useTimelineStore.getState().getClip(id)?.startFrame).toBe(300);
	});
});

// ─── moveSelection ────────────────────────────────────────────────────────────

describe("moveSelection", () => {
	it("선택 클립 일괄 이동", () => {
		loadTwo();
		const clips = useTimelineStore.getState().project!.clips.slice(0, 2);
		const prevFrames = clips.map((c) => c.startFrame);
		for (const c of clips) useTimelineStore.getState().select(c.id, true);
		useTimelineStore.getState().moveSelection(30);
		for (let i = 0; i < clips.length; i++) {
			const after =
				useTimelineStore.getState().getClip(clips[i].id)?.startFrame ?? 0;
			expect(after).toBeGreaterThanOrEqual(prevFrames[i]);
		}
	});

	it("선택 없으면 no-op", () => {
		loadOne();
		const before = JSON.stringify(useTimelineStore.getState().project);
		useTimelineStore.getState().moveSelection(30);
		expect(JSON.stringify(useTimelineStore.getState().project)).toBe(before);
	});

	it("project 없으면 no-op", () => {
		useTimelineStore.getState().moveSelection(10);
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── trimLeft / trimRight ─────────────────────────────────────────────────────

describe("trimLeft / trimRight", () => {
	it("trimLeft → startFrame 증가", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		const before = useTimelineStore.getState().getClip(id)!.startFrame;
		useTimelineStore.getState().trimLeft(id, 10);
		expect(useTimelineStore.getState().getClip(id)!.startFrame).toBe(
			before + 10,
		);
	});

	it("trimRight 음수 delta → durationFrames 감소", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		const before = useTimelineStore.getState().getClip(id)!.durationFrames;
		useTimelineStore.getState().trimRight(id, -10);
		expect(useTimelineStore.getState().getClip(id)!.durationFrames).toBe(
			before - 10,
		);
	});

	it("project 없으면 trimLeft no-op", () => {
		useTimelineStore.getState().trimLeft("x", 10);
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("project 없으면 trimRight no-op", () => {
		useTimelineStore.getState().trimRight("x", 10);
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── splitAt / splitSelectedAtPlayhead ───────────────────────────────────────

describe("splitAt / splitSelectedAtPlayhead", () => {
	it("splitAt → 클립 수 증가", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		const before = useTimelineStore.getState().project!.clips.length;
		useTimelineStore.getState().splitAt(id, 75);
		expect(useTimelineStore.getState().project!.clips.length).toBeGreaterThan(
			before,
		);
	});

	it("splitSelectedAtPlayhead → 선택된 클립 분할", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().select(id);
		useTimelineStore.setState({ playhead: 75 });
		const before = useTimelineStore.getState().project!.clips.length;
		useTimelineStore.getState().splitSelectedAtPlayhead();
		expect(useTimelineStore.getState().project!.clips.length).toBeGreaterThan(
			before,
		);
	});

	it("project 없으면 splitAt no-op", () => {
		useTimelineStore.getState().splitAt("x", 10);
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("project 없으면 splitSelectedAtPlayhead no-op", () => {
		useTimelineStore.getState().splitSelectedAtPlayhead();
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── rippleDelete / rippleDeleteSelected ─────────────────────────────────────

describe("rippleDelete / rippleDeleteSelected", () => {
	it("rippleDelete → 클립 제거", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().rippleDelete(id);
		expect(useTimelineStore.getState().getClip(id)).toBeUndefined();
	});

	it("rippleDeleteSelected → 선택 클립 모두 제거", () => {
		loadTwo();
		const [a, b] = useTimelineStore.getState().project!.clips;
		useTimelineStore.getState().select(a.id, true);
		useTimelineStore.getState().select(b.id, true);
		useTimelineStore.getState().rippleDeleteSelected();
		expect(useTimelineStore.getState().getClip(a.id)).toBeUndefined();
	});

	it("project 없으면 rippleDelete no-op", () => {
		useTimelineStore.getState().rippleDelete("x");
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("project 없으면 rippleDeleteSelected no-op", () => {
		useTimelineStore.getState().rippleDeleteSelected();
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── addClip ripple / rollEdit / slipClip / slideClip ────────────────────────

describe("addClip ripple / rollEdit / slipClip / slideClip", () => {
	it("addClip ripple=true → rippleInsert 경로", () => {
		loadOne();
		const { project } = useTimelineStore.getState();
		const trackId = project!.tracks[0].id;
		const before = project!.clips.length;
		useTimelineStore.getState().addClip(
			{
				id: newClipId(),
				trackId,
				startFrame: 0,
				durationFrames: 30,
				sourceIn: 0,
				sourceOut: 30,
				speed: 1,
				reverse: false,
				opacity: 1,
				position: { x: 0, y: 0 },
				scale: 1,
				rotation: 0,
				kind: "video",
				volume: 1,
				muted: false,
				selected: false,
				locked: false,
				meta: {},
			},
			true,
		);
		expect(useTimelineStore.getState().project!.clips.length).toBeGreaterThan(
			before,
		);
	});

	it("rollEdit → project 상태 변경", () => {
		loadTwo();
		const [a, b] = useTimelineStore.getState().project!.clips;
		useTimelineStore.getState().rollEdit(a.id, b.id, 5);
		expect(useTimelineStore.getState().project).not.toBeNull();
	});

	it("slipClip → project 상태 변경", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().slipClip(id, 5);
		expect(useTimelineStore.getState().project).not.toBeNull();
	});

	it("slideClip → project 상태 변경", () => {
		loadTwo();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().slideClip(id, 5);
		expect(useTimelineStore.getState().project).not.toBeNull();
	});

	it("project 없으면 rollEdit no-op", () => {
		useTimelineStore.getState().rollEdit("a", "b", 5);
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("project 없으면 slipClip no-op", () => {
		useTimelineStore.getState().slipClip("x", 5);
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("project 없으면 slideClip no-op", () => {
		useTimelineStore.getState().slideClip("x", 5);
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── updateClip / setColorGrade ───────────────────────────────────────────────

describe("updateClip / setColorGrade", () => {
	it("updateClip → 패치 적용 + snapshot", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		const hiBefore = useTimelineStore.getState().historyIndex;
		useTimelineStore.getState().updateClip(id, { opacity: 0.5 });
		expect(useTimelineStore.getState().getClip(id)?.opacity).toBe(0.5);
		expect(useTimelineStore.getState().historyIndex).toBe(hiBefore + 1);
	});

	it("setColorGrade → colorGrade 설정", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		const grade = { kind: "lut", intensity: 0.8 } as never;
		useTimelineStore.getState().setColorGrade(id, grade);
		expect(useTimelineStore.getState().getClip(id)?.colorGrade).toEqual(grade);
	});

	it("setColorGrade undefined → colorGrade 제거", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().setColorGrade(id, undefined);
		expect(useTimelineStore.getState().getClip(id)?.colorGrade).toBeUndefined();
	});

	it("project 없으면 updateClip no-op", () => {
		useTimelineStore.getState().updateClip("x", { opacity: 0.5 });
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── selectInRange / setRubberBand ────────────────────────────────────────────

describe("selectInRange / setRubberBand", () => {
	it("selectInRange → 범위 내 클립 선택", () => {
		loadTwo();
		useTimelineStore.getState().selectInRange(0, 300);
		expect(useTimelineStore.getState().selected().length).toBeGreaterThan(0);
	});

	it("selectInRange trackId 필터 — project 유지", () => {
		loadOne();
		const trackId = useTimelineStore.getState().project!.tracks[0].id;
		useTimelineStore.getState().selectInRange(0, 300, trackId);
		expect(useTimelineStore.getState().project).not.toBeNull();
	});

	it("setRubberBand → rubberBand 상태 저장", () => {
		useTimelineStore.getState().setRubberBand({ startFrame: 10, endFrame: 50 });
		expect(useTimelineStore.getState().rubberBand).toEqual({
			startFrame: 10,
			endFrame: 50,
		});
	});

	it("setRubberBand null → 초기화", () => {
		useTimelineStore.getState().setRubberBand(null);
		expect(useTimelineStore.getState().rubberBand).toBeNull();
	});
});

// ─── reorderTrack ─────────────────────────────────────────────────────────────

describe("reorderTrack", () => {
	it("track order 업데이트", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.tracks[0].id;
		useTimelineStore.getState().reorderTrack(id, 5);
		const track = useTimelineStore
			.getState()
			.project!.tracks.find((t) => t.id === id);
		expect(track?.order).toBe(5);
	});
});

// ─── Volume keyframes ─────────────────────────────────────────────────────────

describe("setClipVolumeKeyframe / removeClipVolumeKeyframe / setTrackVolumeKeyframe", () => {
	it("setClipVolumeKeyframe → volumeEnvelope 키프레임 생성", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().setClipVolumeKeyframe(id, 30, 0.5);
		const env = useTimelineStore.getState().getClip(id)?.volumeEnvelope;
		expect(env?.keyframes.length).toBeGreaterThan(0);
		expect(env?.keyframes[0]).toMatchObject({ frame: 30, value: 0.5 });
	});

	it("removeClipVolumeKeyframe → 해당 키프레임 제거", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().setClipVolumeKeyframe(id, 30, 0.5);
		useTimelineStore.getState().removeClipVolumeKeyframe(id, 30);
		const env = useTimelineStore.getState().getClip(id)?.volumeEnvelope;
		expect(env?.keyframes.find((k) => k.frame === 30)).toBeUndefined();
	});

	it("clip 없으면 setClipVolumeKeyframe no-op", () => {
		loadOne();
		expect(() =>
			useTimelineStore.getState().setClipVolumeKeyframe("ghost", 30, 0.5),
		).not.toThrow();
	});

	it("project 없으면 setClipVolumeKeyframe no-op", () => {
		useTimelineStore.getState().setClipVolumeKeyframe("x", 30, 0.5);
		expect(useTimelineStore.getState().project).toBeNull();
	});

	it("volumeEnvelope 없으면 removeClipVolumeKeyframe no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		expect(() =>
			useTimelineStore.getState().removeClipVolumeKeyframe(id, 30),
		).not.toThrow();
	});

	it("setTrackVolumeKeyframe → volumeAutomation 생성", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.tracks[0].id;
		useTimelineStore.getState().setTrackVolumeKeyframe(id, 60, 0.8);
		const track = useTimelineStore
			.getState()
			.project!.tracks.find((t) => t.id === id);
		expect(track?.volumeAutomation?.keyframes.length).toBeGreaterThan(0);
	});

	it("project 없으면 setTrackVolumeKeyframe no-op", () => {
		useTimelineStore.getState().setTrackVolumeKeyframe("x", 60, 0.8);
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── Transform keyframes ──────────────────────────────────────────────────────

describe("Transform keyframes", () => {
	it("setTransformKeyframeAtPlayhead → transformKeyframes 생성", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 10 });
		useTimelineStore
			.getState()
			.setTransformKeyframeAtPlayhead(id, "scale", 1.5);
		const clip = useTimelineStore.getState().getClip(id);
		expect(clip?.transformKeyframes?.scale?.keyframes.length).toBeGreaterThan(
			0,
		);
	});

	it("setTransformKeyframeAtPlayhead — playhead 밖이면 no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 9999 });
		useTimelineStore
			.getState()
			.setTransformKeyframeAtPlayhead(id, "scale", 1.5);
		expect(
			useTimelineStore.getState().getClip(id)?.transformKeyframes?.scale,
		).toBeUndefined();
	});

	it("removeTransformKeyframeAt → 키프레임 제거", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 10 });
		useTimelineStore
			.getState()
			.setTransformKeyframeAtPlayhead(id, "scale", 1.5);
		useTimelineStore.getState().removeTransformKeyframeAt(id, "scale", 10);
		const clip = useTimelineStore.getState().getClip(id);
		expect(
			clip?.transformKeyframes?.scale?.keyframes.find((k) => k.frame === 10),
		).toBeUndefined();
	});

	it("removeTransformKeyframeAt — prop 없으면 no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		expect(() =>
			useTimelineStore.getState().removeTransformKeyframeAt(id, "scale", 10),
		).not.toThrow();
	});

	it("updateKeyframeEase → ease 업데이트", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 10 });
		useTimelineStore
			.getState()
			.setTransformKeyframeAtPlayhead(id, "scale", 1.5, "linear");
		useTimelineStore.getState().updateKeyframeEase(id, "scale", 10, "smooth");
		const kf = useTimelineStore
			.getState()
			.getClip(id)
			?.transformKeyframes?.scale?.keyframes.find((k) => k.frame === 10);
		expect(kf?.ease).toBe("smooth");
	});

	it("updateKeyframeEase — keyframe 없으면 no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		expect(() =>
			useTimelineStore.getState().updateKeyframeEase(id, "scale", 10, "smooth"),
		).not.toThrow();
	});

	it("updateKeyframeValue → value 업데이트 + snapshot", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 10 });
		useTimelineStore
			.getState()
			.setTransformKeyframeAtPlayhead(id, "scale", 1.5);
		const hiBefore = useTimelineStore.getState().historyIndex;
		useTimelineStore.getState().updateKeyframeValue(id, "scale", 10, 2.0);
		const kf = useTimelineStore
			.getState()
			.getClip(id)
			?.transformKeyframes?.scale?.keyframes.find((k) => k.frame === 10);
		expect(kf?.value).toBe(2.0);
		expect(useTimelineStore.getState().historyIndex).toBeGreaterThan(hiBefore);
	});

	it("updateKeyframeValue silent=true → historyIndex 불변", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 10 });
		useTimelineStore
			.getState()
			.setTransformKeyframeAtPlayhead(id, "scale", 1.5);
		const hiBefore = useTimelineStore.getState().historyIndex;
		useTimelineStore.getState().updateKeyframeValue(id, "scale", 10, 2.0, true);
		expect(useTimelineStore.getState().historyIndex).toBe(hiBefore);
	});

	it("clearTransform → 해당 prop 키프레임 삭제", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 10 });
		useTimelineStore
			.getState()
			.setTransformKeyframeAtPlayhead(id, "scale", 1.5);
		useTimelineStore.getState().clearTransform(id, "scale");
		expect(
			useTimelineStore.getState().getClip(id)?.transformKeyframes?.scale,
		).toBeUndefined();
	});

	it("clearTransform — prop 없으면 no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		expect(() =>
			useTimelineStore.getState().clearTransform(id, "scale"),
		).not.toThrow();
	});

	it("project 없으면 setTransformKeyframeAtPlayhead no-op", () => {
		useTimelineStore.getState().setTransformKeyframeAtPlayhead("x", "scale", 1);
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── Motion knots ────────────────────────────────────────────────────────────

describe("setMotionKnotAt / setMotionKnotAtPlayhead / removeMotionKnotAt", () => {
	it("setMotionKnotAt → transformKeyframes 설정", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().setMotionKnotAt(id, 10, 100, 200);
		expect(
			useTimelineStore.getState().getClip(id)?.transformKeyframes,
		).toBeDefined();
	});

	it("setMotionKnotAt localFrame 범위 밖이면 no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().setMotionKnotAt(id, 9999, 100, 200);
		expect(
			useTimelineStore.getState().getClip(id)?.transformKeyframes?.positionX,
		).toBeUndefined();
	});

	it("setMotionKnotAt silent=true → historyIndex 불변", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		const hiBefore = useTimelineStore.getState().historyIndex;
		useTimelineStore
			.getState()
			.setMotionKnotAt(id, 10, 100, 200, "linear", true);
		expect(useTimelineStore.getState().historyIndex).toBe(hiBefore);
	});

	it("setMotionKnotAtPlayhead → playhead 위치에 knot 추가", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 10 });
		useTimelineStore.getState().setMotionKnotAtPlayhead(id, 100, 200);
		expect(
			useTimelineStore.getState().getClip(id)?.transformKeyframes,
		).toBeDefined();
	});

	it("setMotionKnotAtPlayhead playhead 밖이면 no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.setState({ playhead: 9999 });
		useTimelineStore.getState().setMotionKnotAtPlayhead(id, 100, 200);
		expect(
			useTimelineStore.getState().getClip(id)?.transformKeyframes?.positionX,
		).toBeUndefined();
	});

	it("removeMotionKnotAt → 제거 후 no-throw", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		useTimelineStore.getState().setMotionKnotAt(id, 10, 100, 200);
		expect(() =>
			useTimelineStore.getState().removeMotionKnotAt(id, 10),
		).not.toThrow();
	});

	it("removeMotionKnotAt — transformKeyframes 없으면 no-op", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		expect(() =>
			useTimelineStore.getState().removeMotionKnotAt(id, 10),
		).not.toThrow();
	});

	it("project 없으면 setMotionKnotAt no-op", () => {
		useTimelineStore.getState().setMotionKnotAt("x", 10, 0, 0);
		expect(useTimelineStore.getState().project).toBeNull();
	});
});

// ─── Multicam ────────────────────────────────────────────────────────────────

describe("Multicam operations", () => {
	function setupMulticam() {
		loadTwo();
		const clips = useTimelineStore.getState().project!.clips;
		const groupId = useTimelineStore
			.getState()
			.createMulticamGroupFromClips(clips.slice(0, 2).map((c) => c.id))!;
		return groupId;
	}

	it("createMulticamGroupFromClips → groupId(string) 반환 + group 생성", () => {
		const groupId = setupMulticam();
		expect(typeof groupId).toBe("string");
		expect(useTimelineStore.getState().project!.multicamGroups?.length).toBe(1);
	});

	it("clipIds < 2 → null 반환", () => {
		loadOne();
		const id = useTimelineStore.getState().project!.clips[0].id;
		expect(
			useTimelineStore.getState().createMulticamGroupFromClips([id]),
		).toBeNull();
	});

	it("project 없으면 createMulticamGroupFromClips null", () => {
		expect(
			useTimelineStore.getState().createMulticamGroupFromClips(["a", "b"]),
		).toBeNull();
	});

	it("setMulticamCut → cut 추가", () => {
		const groupId = setupMulticam();
		useTimelineStore.getState().setMulticamCut(groupId, 60, 1);
		const group = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId);
		expect(group?.cuts.length).toBeGreaterThan(0);
	});

	it("removeMulticamCut → cut 제거", () => {
		const groupId = setupMulticam();
		useTimelineStore.getState().setMulticamCut(groupId, 60, 1);
		useTimelineStore.getState().removeMulticamCut(groupId, 60);
		const group = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId);
		expect(group?.cuts.find((c) => c.frame === 60)).toBeUndefined();
	});

	it("setMulticamActiveAngle → activeAngle 변경", () => {
		const groupId = setupMulticam();
		useTimelineStore.getState().setMulticamActiveAngle(groupId, 1);
		const group = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId);
		expect(group?.activeAngle).toBe(1);
	});

	it("setMulticamAudioAngle → audioAngle 변경", () => {
		const groupId = setupMulticam();
		useTimelineStore.getState().setMulticamAudioAngle(groupId, 1);
		const group = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId);
		expect(group?.audioAngle).toBe(1);
	});

	it("disbandMulticamGroup → 그룹 제거", () => {
		const groupId = setupMulticam();
		useTimelineStore.getState().disbandMulticamGroup(groupId);
		expect(useTimelineStore.getState().project!.multicamGroups?.length).toBe(0);
	});

	it("renameMulticamGroup → 이름 변경", () => {
		const groupId = setupMulticam();
		useTimelineStore.getState().renameMulticamGroup(groupId, "새 이름");
		const group = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId);
		expect(group?.name).toBe("새 이름");
	});

	it("renameMulticamGroup 빈 문자열 → no-op", () => {
		const groupId = setupMulticam();
		const before = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId)?.name;
		useTimelineStore.getState().renameMulticamGroup(groupId, "   ");
		const after = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId)?.name;
		expect(after).toBe(before);
	});

	it("setMulticamAngleCount → angles 변경", () => {
		const groupId = setupMulticam();
		useTimelineStore.getState().setMulticamAngleCount(groupId, 4);
		const group = useTimelineStore
			.getState()
			.project!.multicamGroups?.find((g) => g.id === groupId);
		expect(group?.angles).toBe(4);
	});

	it("setMulticamCut 존재하지 않는 groupId → no-op", () => {
		loadTwo();
		expect(() =>
			useTimelineStore.getState().setMulticamCut("ghost-group", 60, 1),
		).not.toThrow();
	});
});

// ─── snapFrame ───────────────────────────────────────────────────────────────

describe("snapFrame", () => {
	it("project 없으면 입력 프레임 그대로", () => {
		const result = useTimelineStore.getState().snapFrame(100);
		expect(result.frame).toBe(100);
		expect(result.snapped).toBe(false);
	});

	it("snap.enabled=false → 입력 프레임 그대로", () => {
		loadOne();
		useTimelineStore.getState().setSnap({ enabled: false });
		const result = useTimelineStore.getState().snapFrame(100);
		expect(result.frame).toBe(100);
		expect(result.snapped).toBe(false);
	});

	it("snap 활성화 → frame/snapped 반환", () => {
		loadOne();
		const result = useTimelineStore.getState().snapFrame(152);
		expect(result).toHaveProperty("frame");
		expect(result).toHaveProperty("snapped");
	});
});

// ─── toSceneRecords / liveSceneIds ────────────────────────────────────────────

describe("toSceneRecords / liveSceneIds", () => {
	it("project 없으면 toSceneRecords → empty", () => {
		const result = useTimelineStore.getState().toSceneRecords();
		expect(result.update).toEqual([]);
		expect(result.insert).toEqual([]);
	});

	it("project 있으면 toSceneRecords → SceneRecordPlan", () => {
		loadOne();
		const result = useTimelineStore.getState().toSceneRecords();
		expect(result).toHaveProperty("update");
		expect(result).toHaveProperty("insert");
	});

	it("project 없으면 liveSceneIds → 빈 배열", () => {
		expect(useTimelineStore.getState().liveSceneIds()).toEqual([]);
	});

	it("project 있으면 liveSceneIds → string[]", () => {
		loadOne();
		expect(Array.isArray(useTimelineStore.getState().liveSceneIds())).toBe(
			true,
		);
	});
});
