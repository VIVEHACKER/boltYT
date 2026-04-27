/**
 * editor-store.ts 단위 테스트 — Zustand store 직접 조작
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { TimelineScene } from "./editor-store";
import { useEditorStore } from "./editor-store";

function makeScene(
	overrides: Partial<TimelineScene> = {},
	index = 0,
): TimelineScene {
	return {
		id: `scene-${index}`,
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

beforeEach(() => {
	useEditorStore.setState({
		scenes: [],
		playhead: 0,
		selectedSceneId: null,
		zoom: 2,
		bpm: 0,
		beats: [],
		history: [],
		historyIndex: -1,
	});
});

// ─── setScenes ────────────────────────────────────────────────────────────────
describe("setScenes", () => {
	it("씬 목록 설정 + 초기 스냅샷 저장", () => {
		const scenes = [makeScene({}, 0), makeScene({}, 1)];
		useEditorStore.getState().setScenes(scenes);
		const { scenes: s, history, historyIndex } = useEditorStore.getState();
		expect(s).toHaveLength(2);
		expect(history).toHaveLength(1);
		expect(historyIndex).toBe(0);
	});
});

// ─── updateScene ──────────────────────────────────────────────────────────────
describe("updateScene", () => {
	it("id로 씬 업데이트 + 스냅샷 저장", () => {
		const scenes = [makeScene({ id: "s1" }, 0)];
		useEditorStore.getState().setScenes(scenes);
		useEditorStore.getState().updateScene("s1", { duration_seconds: 8 });
		const { scenes: s } = useEditorStore.getState();
		expect(s[0].duration_seconds).toBe(8);
	});

	it("없는 id → 변경 없음", () => {
		const scenes = [makeScene({ id: "s1", duration_seconds: 5 }, 0)];
		useEditorStore.getState().setScenes(scenes);
		useEditorStore
			.getState()
			.updateScene("nonexistent", { duration_seconds: 99 });
		expect(useEditorStore.getState().scenes[0].duration_seconds).toBe(5);
	});
});

// ─── splitScene ───────────────────────────────────────────────────────────────
describe("splitScene", () => {
	it("중간 지점에서 2개로 분할", () => {
		// duration=10초 → 300 프레임. atFrame=150 (중간)
		const scenes = [
			makeScene({ id: "s1", duration_seconds: 10, start_frame: 0 }, 0),
		];
		useEditorStore.getState().setScenes(scenes);
		useEditorStore.getState().splitScene("s1", 150);
		const { scenes: s } = useEditorStore.getState();
		expect(s).toHaveLength(2);
		expect(s[0].duration_seconds).toBeCloseTo(5, 1);
		expect(s[1].duration_seconds).toBeCloseTo(5, 1);
	});

	it("너무 짧은 분할(4프레임 이내) → 변경 없음", () => {
		const scenes = [
			makeScene({ id: "s1", duration_seconds: 10, start_frame: 0 }, 0),
		];
		useEditorStore.getState().setScenes(scenes);
		useEditorStore.getState().splitScene("s1", 3); // local=3 ≤ 4
		expect(useEditorStore.getState().scenes).toHaveLength(1);
	});

	it("끝 4프레임 이내 분할 → 변경 없음", () => {
		// duration=10초 → 300프레임. atFrame=297 → local=297, srcDur-4=296 이상 → 차단
		const scenes = [
			makeScene({ id: "s1", duration_seconds: 10, start_frame: 0 }, 0),
		];
		useEditorStore.getState().setScenes(scenes);
		useEditorStore.getState().splitScene("s1", 297);
		expect(useEditorStore.getState().scenes).toHaveLength(1);
	});

	it("없는 id → 변경 없음", () => {
		useEditorStore.getState().setScenes([makeScene({ id: "s1" })]);
		useEditorStore.getState().splitScene("missing", 150);
		expect(useEditorStore.getState().scenes).toHaveLength(1);
	});
});

// ─── deleteScene ──────────────────────────────────────────────────────────────
describe("deleteScene", () => {
	it("id로 씬 삭제", () => {
		useEditorStore
			.getState()
			.setScenes([makeScene({ id: "s1" }), makeScene({ id: "s2" })]);
		useEditorStore.getState().deleteScene("s1");
		const { scenes } = useEditorStore.getState();
		expect(scenes).toHaveLength(1);
		expect(scenes[0].id).toBe("s2");
	});
});

// ─── setPlayhead ──────────────────────────────────────────────────────────────
describe("setPlayhead", () => {
	it("양수 프레임 → 그대로", () => {
		useEditorStore.getState().setPlayhead(42);
		expect(useEditorStore.getState().playhead).toBe(42);
	});

	it("음수 → 0으로 클램프", () => {
		useEditorStore.getState().setPlayhead(-10);
		expect(useEditorStore.getState().playhead).toBe(0);
	});
});

// ─── setSelected ──────────────────────────────────────────────────────────────
describe("setSelected", () => {
	it("id 설정", () => {
		useEditorStore.getState().setSelected("s1");
		expect(useEditorStore.getState().selectedSceneId).toBe("s1");
	});

	it("null 설정", () => {
		useEditorStore.getState().setSelected("s1");
		useEditorStore.getState().setSelected(null);
		expect(useEditorStore.getState().selectedSceneId).toBeNull();
	});
});

// ─── setZoom ──────────────────────────────────────────────────────────────────
describe("setZoom", () => {
	it("범위 내 값 → 그대로", () => {
		useEditorStore.getState().setZoom(5);
		expect(useEditorStore.getState().zoom).toBe(5);
	});

	it("0.5 미만 → 0.5 클램프", () => {
		useEditorStore.getState().setZoom(0.1);
		expect(useEditorStore.getState().zoom).toBe(0.5);
	});

	it("10 초과 → 10 클램프", () => {
		useEditorStore.getState().setZoom(15);
		expect(useEditorStore.getState().zoom).toBe(10);
	});
});

// ─── setBpmBeats ──────────────────────────────────────────────────────────────
describe("setBpmBeats", () => {
	it("bpm · beats 저장", () => {
		useEditorStore.getState().setBpmBeats(120, [0.5, 1.0, 1.5]);
		const { bpm, beats } = useEditorStore.getState();
		expect(bpm).toBe(120);
		expect(beats).toEqual([0.5, 1.0, 1.5]);
	});
});

// ─── undo / redo ──────────────────────────────────────────────────────────────
describe("undo / redo", () => {
	it("undo → 이전 상태 복원", () => {
		useEditorStore
			.getState()
			.setScenes([makeScene({ id: "s1", duration_seconds: 5 })]);
		useEditorStore.getState().updateScene("s1", { duration_seconds: 8 });
		useEditorStore.getState().undo();
		// undo 후 이전 스냅샷(초기 setScenes 스냅샷) 복원
		expect(useEditorStore.getState().scenes[0].duration_seconds).toBe(5);
	});

	it("undo 후 redo → 최신 상태 복원", () => {
		useEditorStore
			.getState()
			.setScenes([makeScene({ id: "s1", duration_seconds: 5 })]);
		useEditorStore.getState().updateScene("s1", { duration_seconds: 8 });
		useEditorStore.getState().undo();
		useEditorStore.getState().redo();
		expect(useEditorStore.getState().scenes[0].duration_seconds).toBe(8);
	});

	it("historyIndex=0에서 undo → 변경 없음", () => {
		useEditorStore.getState().setScenes([makeScene({ id: "s1" })]);
		const before = useEditorStore.getState().historyIndex;
		useEditorStore.getState().undo();
		expect(useEditorStore.getState().historyIndex).toBe(before);
	});

	it("최신 상태에서 redo → 변경 없음", () => {
		useEditorStore.getState().setScenes([makeScene({ id: "s1" })]);
		const before = useEditorStore.getState().historyIndex;
		useEditorStore.getState().redo();
		expect(useEditorStore.getState().historyIndex).toBe(before);
	});
});

// ─── totalFrames ──────────────────────────────────────────────────────────────
describe("totalFrames", () => {
	it("씬 없음 → 0", () => {
		expect(useEditorStore.getState().totalFrames()).toBe(0);
	});

	it("씬 2개 → 프레임 합계", () => {
		useEditorStore
			.getState()
			.setScenes([
				makeScene({ duration_seconds: 5 }),
				makeScene({ duration_seconds: 3 }),
			]);
		// Math.ceil(5*30) + Math.ceil(3*30) = 150 + 90 = 240
		expect(useEditorStore.getState().totalFrames()).toBe(240);
	});
});
