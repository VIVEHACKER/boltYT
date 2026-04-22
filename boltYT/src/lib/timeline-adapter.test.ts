/**
 * timeline-adapter 단위 테스트 — Scene ↔ Clip 왕복성 + DML 플랜 정합성.
 */

import { describe, expect, it } from "vitest";
import type { TimelineScene } from "./editor-store";
import { existingSceneIds, fromScenes, toScenes } from "./timeline-adapter";
import { splitClipAt } from "./timeline-model";

function makeScene(partial: Partial<TimelineScene>): TimelineScene {
	return {
		id: partial.id ?? "scene-x",
		script_id: partial.script_id ?? "scr-1",
		order_index: partial.order_index ?? 0,
		narration_text: partial.narration_text ?? "narration",
		scene_type: partial.scene_type ?? "image",
		visual_prompt: partial.visual_prompt ?? "",
		duration_seconds: partial.duration_seconds ?? 3,
		created_at: partial.created_at ?? "2026-01-01",
		audioUrl: partial.audioUrl,
		imageUrl: partial.imageUrl,
		videoUrl: partial.videoUrl,
	} as TimelineScene;
}

describe("timeline-adapter", () => {
	it("fromScenes creates video+audio+subtitle clips per scene", () => {
		const scenes = [
			makeScene({ id: "a", audioUrl: "blob:a" }),
			makeScene({ id: "b", audioUrl: "blob:b" }),
		];
		const p = fromScenes(scenes, { scriptId: "scr-1" });
		const videoClips = p.clips.filter((c) => c.trackId === "v1");
		const audioClips = p.clips.filter((c) => c.trackId === "a1");
		const subClips = p.clips.filter((c) => c.trackId === "s1");
		expect(videoClips).toHaveLength(2);
		expect(audioClips).toHaveLength(2);
		expect(subClips).toHaveLength(2);
		expect(videoClips.map((c) => c.sceneId)).toEqual(["a", "b"]);
	});

	it("toScenes returns update plan for existing scene ids, insert for new", () => {
		const scenes = [
			makeScene({ id: "a", duration_seconds: 3 }),
			makeScene({ id: "b", duration_seconds: 3 }),
		];
		const p = fromScenes(scenes, { scriptId: "scr-1" });

		// 초기 상태 — 모두 update 로 분류
		const plan1 = toScenes(p);
		expect(plan1.update.map((r) => r.id)).toEqual(["a", "b"]);
		expect(plan1.insert).toHaveLength(0);

		// 비디오 클립 하나를 split → right 는 insert 로 분류되어야 함
		const videoA = p.clips.find((c) => c.sceneId === "a" && c.trackId === "v1");
		if (!videoA) throw new Error("videoA missing");
		const atFrame = videoA.startFrame + Math.floor(videoA.durationFrames / 2);
		const p2 = splitClipAt(p, videoA.id, atFrame, () => "new-right");

		const plan2 = toScenes(p2);
		// update: a + b (기존 씬들)
		// insert: 1개 (split right)
		expect(plan2.update.map((r) => r.id).sort()).toEqual(["a", "b"]);
		expect(plan2.insert).toHaveLength(1);
		expect(plan2.insert[0].id).toBeUndefined(); // DB 가 id 부여
	});

	it("existingSceneIds returns only video clips that retain sceneId", () => {
		const scenes = [makeScene({ id: "a" }), makeScene({ id: "b" })];
		const p = fromScenes(scenes, { scriptId: "scr-1" });
		expect(existingSceneIds(p).sort()).toEqual(["a", "b"]);

		const videoA = p.clips.find((c) => c.sceneId === "a" && c.trackId === "v1");
		if (!videoA) throw new Error("videoA missing");
		const atFrame = videoA.startFrame + Math.floor(videoA.durationFrames / 2);
		const p2 = splitClipAt(p, videoA.id, atFrame);
		// split 후 video 트랙 클립 3개, 그 중 sceneId 가진 건 여전히 "a" + "b"
		expect(existingSceneIds(p2).sort()).toEqual(["a", "b"]);
	});
});

// ─── defaultTransitionFrames 분기 커버리지 ──────────────────────────────────
describe("timeline-adapter 트랜지션 분기", () => {
	it("crossfade transition → 15프레임", () => {
		const scenes = [
			{ ...makeScene({ id: "a" }), transition: "crossfade" as const },
			makeScene({ id: "b" }),
		];
		const p = fromScenes(scenes as typeof scenes, { scriptId: "s" });
		const clips = p.clips.filter((c) => c.trackId === "v1");
		// crossfade: 15 frames offset
		expect(clips.length).toBeGreaterThan(0);
	});

	it("zoom transition → 20프레임", () => {
		const scenes = [
			{ ...makeScene({ id: "a" }), transition: "zoom" as const },
			makeScene({ id: "b" }),
		];
		const p = fromScenes(scenes as typeof scenes, { scriptId: "s" });
		expect(p.clips.filter((c) => c.trackId === "v1")).toHaveLength(2);
	});

	it("slide_left transition → 15프레임", () => {
		const scenes = [
			{ ...makeScene({ id: "a" }), transition: "slide_left" as const },
			makeScene({ id: "b" }),
		];
		const p = fromScenes(scenes as typeof scenes, { scriptId: "s" });
		expect(p.clips.filter((c) => c.trackId === "v1")).toHaveLength(2);
	});

	it("slide_right transition → 15프레임", () => {
		const scenes = [
			{ ...makeScene({ id: "a" }), transition: "slide_right" as const },
			makeScene({ id: "b" }),
		];
		const p = fromScenes(scenes as typeof scenes, { scriptId: "s" });
		expect(p.clips.filter((c) => c.trackId === "v1")).toHaveLength(2);
	});

	it("glitch transition → 8프레임", () => {
		const scenes = [
			{ ...makeScene({ id: "a" }), transition: "glitch" as const },
			makeScene({ id: "b" }),
		];
		const p = fromScenes(scenes as typeof scenes, { scriptId: "s" });
		expect(p.clips.filter((c) => c.trackId === "v1")).toHaveLength(2);
	});

	it("whip_left transition → 5프레임", () => {
		const scenes = [
			{ ...makeScene({ id: "a" }), transition: "whip_left" as const },
			makeScene({ id: "b" }),
		];
		const p = fromScenes(scenes as typeof scenes, { scriptId: "s" });
		expect(p.clips.filter((c) => c.trackId === "v1")).toHaveLength(2);
	});

	it("whip_right transition → 5프레임", () => {
		const scenes = [
			{ ...makeScene({ id: "a" }), transition: "whip_right" as const },
			makeScene({ id: "b" }),
		];
		const p = fromScenes(scenes as typeof scenes, { scriptId: "s" });
		expect(p.clips.filter((c) => c.trackId === "v1")).toHaveLength(2);
	});
});
