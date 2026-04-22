/**
 * timeline-model 순수 함수 단위 테스트.
 */

import { describe, expect, it } from "vitest";
import {
	applySnap,
	buildSnapTargets,
	clearTransformProp,
	clipsOnTrack,
	createEmptyProject,
	deleteClip,
	endFrameOf,
	evaluateCurve,
	evaluateTransform,
	getMotionKnots,
	moveClip,
	newClipId,
	removeMotionKnot,
	removeTransformKeyframe,
	rippleDelete,
	rippleInsert,
	rollEdit,
	setKeyframe,
	setMotionKnot,
	setTransformKeyframe,
	slideClip,
	slipClip,
	splitClipAt,
	type TimelineClip,
	toggleSelect,
	totalDurationFrames,
	trimLeft,
	trimRight,
} from "./timeline-model";

function makeClip(
	overrides: Partial<TimelineClip> & {
		startFrame: number;
		durationFrames: number;
	},
): TimelineClip {
	return {
		id: newClipId(),
		trackId: "v1",
		kind: "video",
		sourceIn: 0,
		sourceOut: overrides.durationFrames,
		speed: 1,
		reverse: false,
		opacity: 1,
		position: { x: 0, y: 0 },
		scale: 1,
		rotation: 0,
		volume: 1,
		muted: false,
		locked: false,
		selected: false,
		meta: {},
		...overrides,
	};
}

describe("timeline-model basics", () => {
	it("endFrameOf", () => {
		const c = makeClip({ startFrame: 30, durationFrames: 60 });
		expect(endFrameOf(c)).toBe(90);
	});

	it("totalDurationFrames", () => {
		const p = createEmptyProject("s1");
		p.clips = [
			makeClip({ startFrame: 0, durationFrames: 30 }),
			makeClip({ startFrame: 60, durationFrames: 90 }),
		];
		expect(totalDurationFrames(p)).toBe(150);
	});

	it("clipsOnTrack sorts by startFrame", () => {
		const p = createEmptyProject("s1");
		p.clips = [
			makeClip({ startFrame: 100, durationFrames: 30 }),
			makeClip({ startFrame: 0, durationFrames: 30 }),
			makeClip({ startFrame: 50, durationFrames: 30 }),
		];
		const sorted = clipsOnTrack(p, "v1");
		expect(sorted.map((c) => c.startFrame)).toEqual([0, 50, 100]);
	});

	it("optional 확장 필드 (audioEffects / multicam / multicamGroups) 수용", () => {
		const clip = makeClip({ startFrame: 0, durationFrames: 30 });
		clip.audioEffects = [{ kind: "gain", db: -3 }];
		clip.multicam = { groupId: "g1", angle: 1 };
		const p = createEmptyProject("s1");
		p.multicamGroups = [
			{
				id: "g1",
				name: "Interview",
				angles: 3,
				activeAngle: 0,
				audioAngle: 0,
				cuts: [],
			},
		];
		p.clips = [clip];
		expect(p.clips[0].audioEffects?.[0].kind).toBe("gain");
		expect(p.clips[0].multicam?.groupId).toBe("g1");
		expect(p.multicamGroups?.[0].angles).toBe(3);
	});
});

describe("edit ops", () => {
	it("moveClip updates startFrame", () => {
		const p = createEmptyProject("s1");
		const c = makeClip({ startFrame: 0, durationFrames: 60 });
		p.clips = [c];
		const p2 = moveClip(p, c.id, 120);
		expect(p2.clips[0].startFrame).toBe(120);
		// immutable
		expect(p.clips[0].startFrame).toBe(0);
	});

	it("trimRight extends duration, updates sourceOut", () => {
		const p = createEmptyProject("s1");
		const c = makeClip({ startFrame: 0, durationFrames: 60 });
		p.clips = [c];
		const p2 = trimRight(p, c.id, 30);
		expect(p2.clips[0].durationFrames).toBe(90);
		expect(p2.clips[0].sourceOut).toBe(90);
	});

	it("trimLeft pushes start, updates sourceIn", () => {
		const p = createEmptyProject("s1");
		const c = makeClip({ startFrame: 100, durationFrames: 60 });
		p.clips = [c];
		const p2 = trimLeft(p, c.id, 20); // delta +20 → start=120, dur=40, sourceIn=20
		expect(p2.clips[0].startFrame).toBe(120);
		expect(p2.clips[0].durationFrames).toBe(40);
		expect(p2.clips[0].sourceIn).toBe(20);
	});

	it("splitClipAt creates two clips at global frame", () => {
		const p = createEmptyProject("s1");
		const c = makeClip({
			startFrame: 0,
			durationFrames: 100,
			sceneId: "scene-A",
		});
		p.clips = [c];
		const p2 = splitClipAt(p, c.id, 40, () => "right-id");
		expect(p2.clips).toHaveLength(2);
		const left = p2.clips.find((x) => x.id === c.id);
		const right = p2.clips.find((x) => x.id === "right-id");
		expect(left?.durationFrames).toBe(40);
		expect(left?.sourceOut).toBe(40);
		expect(right?.startFrame).toBe(40);
		expect(right?.durationFrames).toBe(60);
		expect(right?.sourceIn).toBe(40);
		// P1-B fix: 분할된 오른쪽은 고유 sceneId 를 가져야 한다 (새 씬 레코드)
		expect(left?.sceneId).toBe("scene-A");
		expect(right?.sceneId).toBeUndefined();
		expect(right?.meta.split_from).toBe("scene-A");
	});

	it("splitClipAt rejects at clip boundary", () => {
		const p = createEmptyProject("s1");
		const c = makeClip({ startFrame: 0, durationFrames: 100 });
		p.clips = [c];
		const p2 = splitClipAt(p, c.id, 0);
		expect(p2.clips).toHaveLength(1);
	});

	it("deleteClip removes but keeps others", () => {
		const p = createEmptyProject("s1");
		const a = makeClip({ startFrame: 0, durationFrames: 30 });
		const b = makeClip({ startFrame: 30, durationFrames: 30 });
		p.clips = [a, b];
		const p2 = deleteClip(p, a.id);
		expect(p2.clips).toHaveLength(1);
		expect(p2.clips[0].id).toBe(b.id);
	});

	it("rippleDelete shifts subsequent clips left by deleted duration", () => {
		const p = createEmptyProject("s1");
		const a = makeClip({ startFrame: 0, durationFrames: 30 });
		const b = makeClip({ startFrame: 30, durationFrames: 30 });
		const c = makeClip({ startFrame: 60, durationFrames: 30 });
		p.clips = [a, b, c];
		const p2 = rippleDelete(p, a.id);
		const sorted = clipsOnTrack(p2, "v1");
		expect(sorted.map((x) => x.startFrame)).toEqual([0, 30]);
	});

	it("rippleInsert pushes later clips right by new clip's duration", () => {
		const p = createEmptyProject("s1");
		const a = makeClip({ startFrame: 0, durationFrames: 30 });
		const c = makeClip({ startFrame: 30, durationFrames: 30 });
		p.clips = [a, c];
		const inserted = makeClip({ startFrame: 30, durationFrames: 20 });
		const p2 = rippleInsert(p, inserted);
		const sorted = clipsOnTrack(p2, "v1");
		expect(sorted.map((x) => x.startFrame)).toEqual([0, 30, 50]);
	});

	it("rollEdit moves shared edge between two adjacent clips", () => {
		const p = createEmptyProject("s1");
		const a = makeClip({ startFrame: 0, durationFrames: 30 });
		const b = makeClip({ startFrame: 30, durationFrames: 30 });
		p.clips = [a, b];
		const p2 = rollEdit(p, a.id, b.id, 5); // a gains 5, b loses 5
		const aAfter = p2.clips.find((x) => x.id === a.id);
		const bAfter = p2.clips.find((x) => x.id === b.id);
		expect(aAfter?.durationFrames).toBe(35);
		expect(bAfter?.startFrame).toBe(35);
		expect(bAfter?.durationFrames).toBe(25);
	});

	it("slipClip shifts sourceIn/Out without moving clip", () => {
		const p = createEmptyProject("s1");
		const c = makeClip({ startFrame: 30, durationFrames: 60 });
		c.sourceIn = 10;
		c.sourceOut = 70;
		p.clips = [c];
		const p2 = slipClip(p, c.id, 10); // deltaFrames +10 → sourceIn,Out -10 (-1x direction)
		// Implementation: sourceIn += delta/speed, so actually +10
		expect(p2.clips[0].sourceIn).toBe(20);
		expect(p2.clips[0].sourceOut).toBe(80);
		expect(p2.clips[0].startFrame).toBe(30);
		expect(p2.clips[0].durationFrames).toBe(60);
	});

	it("slideClip moves clip and adjacent clips absorb", () => {
		const p = createEmptyProject("s1");
		const a = makeClip({ startFrame: 0, durationFrames: 30 });
		const b = makeClip({ startFrame: 30, durationFrames: 30 });
		const c = makeClip({ startFrame: 60, durationFrames: 30 });
		p.clips = [a, b, c];
		const p2 = slideClip(p, b.id, 10);
		const sorted = clipsOnTrack(p2, "v1");
		const aAfter = sorted.find((x) => x.id === a.id);
		const bAfter = sorted.find((x) => x.id === b.id);
		const cAfter = sorted.find((x) => x.id === c.id);
		expect(aAfter?.durationFrames).toBe(40);
		expect(bAfter?.startFrame).toBe(40);
		expect(cAfter?.startFrame).toBe(70);
		expect(cAfter?.durationFrames).toBe(20);
	});
});

describe("snap", () => {
	it("buildSnapTargets collects clip boundaries", () => {
		const p = createEmptyProject("s1");
		p.clips = [
			makeClip({ startFrame: 0, durationFrames: 30 }),
			makeClip({ startFrame: 60, durationFrames: 40 }),
		];
		const t = buildSnapTargets(p);
		expect(t).toContain(0);
		expect(t).toContain(30);
		expect(t).toContain(60);
		expect(t).toContain(100);
	});

	it("applySnap returns nearest within threshold", () => {
		const r = applySnap(32, [0, 30, 60], 5);
		expect(r.snapped).toBe(true);
		expect(r.frame).toBe(30);
	});

	it("applySnap returns unsnapped outside threshold", () => {
		const r = applySnap(50, [0, 30, 60], 5);
		expect(r.snapped).toBe(false);
		expect(r.frame).toBe(50);
	});
});

describe("selection", () => {
	it("toggleSelect single selection replaces selection", () => {
		const p = createEmptyProject("s1");
		const a = makeClip({ startFrame: 0, durationFrames: 30 });
		const b = makeClip({ startFrame: 40, durationFrames: 30 });
		p.clips = [a, b];
		const p2 = toggleSelect(p, a.id, false);
		expect(p2.clips.find((c) => c.id === a.id)?.selected).toBe(true);
		expect(p2.clips.find((c) => c.id === b.id)?.selected).toBe(false);
		const p3 = toggleSelect(p2, b.id, false);
		expect(p3.clips.find((c) => c.id === a.id)?.selected).toBe(false);
		expect(p3.clips.find((c) => c.id === b.id)?.selected).toBe(true);
	});

	it("toggleSelect additive keeps prior selection", () => {
		const p = createEmptyProject("s1");
		const a = makeClip({ startFrame: 0, durationFrames: 30, selected: true });
		const b = makeClip({ startFrame: 40, durationFrames: 30 });
		p.clips = [a, b];
		const p2 = toggleSelect(p, b.id, true);
		expect(p2.clips.find((c) => c.id === a.id)?.selected).toBe(true);
		expect(p2.clips.find((c) => c.id === b.id)?.selected).toBe(true);
	});
});

describe("automation curves", () => {
	it("evaluateCurve returns default when empty", () => {
		expect(evaluateCurve({ default: 0.5, keyframes: [] }, 30)).toBe(0.5);
	});

	it("evaluateCurve linear interpolation", () => {
		const c = {
			default: 0,
			keyframes: [
				{ frame: 0, value: 0, ease: "linear" as const },
				{ frame: 100, value: 1, ease: "linear" as const },
			],
		};
		expect(evaluateCurve(c, 50)).toBeCloseTo(0.5);
	});

	it("evaluateCurve hold (step)", () => {
		const c = {
			default: 0,
			keyframes: [
				{ frame: 0, value: 0.2, ease: "hold" as const },
				{ frame: 100, value: 0.8, ease: "linear" as const },
			],
		};
		expect(evaluateCurve(c, 50)).toBe(0.2);
	});

	it("evaluateCurve smooth (S-curve) endpoints match linear", () => {
		const c = {
			default: 0,
			keyframes: [
				{ frame: 0, value: 0, ease: "smooth" as const },
				{ frame: 100, value: 1, ease: "smooth" as const },
			],
		};
		expect(evaluateCurve(c, 0)).toBeCloseTo(0);
		expect(evaluateCurve(c, 100)).toBeCloseTo(1);
		expect(evaluateCurve(c, 50)).toBeCloseTo(0.5); // symmetric
	});

	it("evaluateCurve bezier — 양 끝은 정확히 start/end 값", () => {
		const c = {
			default: 0,
			keyframes: [
				{
					frame: 0,
					value: 0,
					ease: "bezier" as const,
					outTangent: { x: 0.42, y: 0 },
				},
				{
					frame: 100,
					value: 1,
					ease: "bezier" as const,
					inTangent: { x: 0.42, y: 0 },
				},
			],
		};
		expect(evaluateCurve(c, 0)).toBeCloseTo(0);
		expect(evaluateCurve(c, 100)).toBeCloseTo(1);
		// ease-in-out 모양 → 중간은 0.5 근처 (정확히 0.5는 아닐 수 있음)
		const mid = evaluateCurve(c, 50);
		expect(mid).toBeGreaterThan(0.3);
		expect(mid).toBeLessThan(0.7);
	});

	it("evaluateCurve bezier — 강한 ease-in (초반 느림 → 후반 가속)", () => {
		// P1=(0.95, 0), P2=(0.05, 1) — 양쪽 핸들 모두 출발 쪽으로 밀착
		const c = {
			default: 0,
			keyframes: [
				{
					frame: 0,
					value: 0,
					ease: "bezier" as const,
					outTangent: { x: 0.95, y: 0 },
				},
				{
					frame: 100,
					value: 1,
					ease: "bezier" as const,
					// inTangent 는 b 기준 왼쪽 거리 → x2 = 1 - 0.95 = 0.05
					inTangent: { x: 0.95, y: 0 },
				},
			],
		};
		expect(evaluateCurve(c, 25)).toBeLessThan(0.2);
		expect(evaluateCurve(c, 75)).toBeGreaterThan(0.8);
	});

	it("evaluateCurve bezier — 핸들 없으면 기본(0.42/0) 로 smooth 근사", () => {
		const c = {
			default: 0,
			keyframes: [
				{ frame: 0, value: 0, ease: "bezier" as const },
				{ frame: 100, value: 1, ease: "bezier" as const },
			],
		};
		// 핸들 기본값은 CSS ease 근사 → 중간은 0.3-0.7 사이
		const mid = evaluateCurve(c, 50);
		expect(mid).toBeGreaterThan(0.3);
		expect(mid).toBeLessThan(0.7);
	});

	it("setKeyframe sorts and dedupes by frame", () => {
		let curve: import("./timeline-model").AutomationCurve = {
			default: 0,
			keyframes: [],
		};
		curve = setKeyframe(curve, 30, 0.5);
		curve = setKeyframe(curve, 10, 0.1);
		curve = setKeyframe(curve, 30, 0.9);
		expect(curve.keyframes.map((k) => k.frame)).toEqual([10, 30]);
		expect(curve.keyframes[1].value).toBe(0.9);
	});
});

describe("transform keyframes (Phase 6)", () => {
	function makePlainClip(): TimelineClip {
		return {
			id: newClipId(),
			trackId: "v1",
			kind: "video",
			startFrame: 30,
			durationFrames: 120,
			sourceIn: 0,
			sourceOut: 120,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			volume: 1,
			muted: false,
			locked: false,
			selected: false,
			meta: {},
		};
	}

	it("evaluateTransform returns static values when no keyframes", () => {
		const clip = makePlainClip();
		clip.position = { x: 50, y: -20 };
		clip.scale = 1.2;
		clip.rotation = 15;
		clip.opacity = 0.8;
		const t = evaluateTransform(clip, 60);
		expect(t.x).toBe(50);
		expect(t.y).toBe(-20);
		expect(t.scale).toBe(1.2);
		expect(t.rotation).toBe(15);
		expect(t.opacity).toBe(0.8);
	});

	it("setTransformKeyframe seeds curve with static base value", () => {
		const clip = makePlainClip();
		clip.scale = 1.5;
		const tk = setTransformKeyframe(clip, "scale", 0, 1.5);
		expect(tk.scale).toBeDefined();
		expect(tk.scale?.default).toBe(1.5);
		expect(tk.scale?.keyframes.length).toBe(1);
		expect(tk.scale?.keyframes[0]).toEqual({
			frame: 0,
			value: 1.5,
			ease: "linear",
		});
	});

	it("setTransformKeyframe at localFrame > 0 seeds frame 0 with static base", () => {
		const clip = makePlainClip();
		clip.scale = 1;
		clip.transformKeyframes = setTransformKeyframe(clip, "scale", 60, 2);
		// frame 0 에 base 시드가 있어야 앞구간이 1 로 유지됨
		const frames = clip.transformKeyframes.scale?.keyframes.map((k) => k.frame);
		expect(frames).toEqual([0, 60]);
		// 앞구간은 base, 중간은 보간, keyframe은 값
		expect(evaluateTransform(clip, clip.startFrame + 0).scale).toBeCloseTo(1);
		expect(evaluateTransform(clip, clip.startFrame + 30).scale).toBeCloseTo(
			1.5,
		);
		expect(evaluateTransform(clip, clip.startFrame + 60).scale).toBeCloseTo(2);
	});

	it("setTransformKeyframe at localFrame 0 does not double-seed", () => {
		const clip = makePlainClip();
		clip.opacity = 0.5;
		clip.transformKeyframes = setTransformKeyframe(clip, "opacity", 0, 1);
		const frames = clip.transformKeyframes.opacity?.keyframes.map(
			(k) => k.frame,
		);
		expect(frames).toEqual([0]);
	});

	it("evaluateTransform interpolates between two keyframes (local frame)", () => {
		const clip = makePlainClip();
		// 두 키프레임: localFrame 0 → scale 1, localFrame 120 → scale 2
		let tk = setTransformKeyframe(clip, "scale", 0, 1);
		clip.transformKeyframes = tk;
		tk = setTransformKeyframe(clip, "scale", 120, 2);
		clip.transformKeyframes = tk;

		// global frame 90 = local 60 = 절반
		const mid = evaluateTransform(clip, 30 + 60);
		expect(mid.scale).toBeCloseTo(1.5);

		// 클립 시작 전 = 첫 키프레임 clamp
		const before = evaluateTransform(clip, 0);
		expect(before.scale).toBe(1);
	});

	it("evaluateTransform uses static for props without keyframes", () => {
		const clip = makePlainClip();
		clip.position = { x: 10, y: 20 };
		clip.opacity = 0.5;
		const tk = setTransformKeyframe(clip, "scale", 0, 2);
		clip.transformKeyframes = tk;
		const t = evaluateTransform(clip, 60);
		expect(t.scale).toBe(2);
		expect(t.x).toBe(10); // static
		expect(t.opacity).toBe(0.5); // static
	});

	it("removeTransformKeyframe deletes single frame, preserves others", () => {
		const clip = makePlainClip();
		clip.transformKeyframes = setTransformKeyframe(clip, "opacity", 0, 1);
		clip.transformKeyframes = setTransformKeyframe(clip, "opacity", 60, 0);
		clip.transformKeyframes = setTransformKeyframe(clip, "opacity", 120, 1);
		const tk = removeTransformKeyframe(clip, "opacity", 60);
		expect(tk?.opacity?.keyframes.map((k) => k.frame)).toEqual([0, 120]);
	});

	it("removeTransformKeyframe drops prop when last keyframe removed", () => {
		const clip = makePlainClip();
		clip.transformKeyframes = setTransformKeyframe(clip, "rotation", 0, 0);
		const tk = removeTransformKeyframe(clip, "rotation", 0);
		expect(tk?.rotation).toBeUndefined();
		// 다른 prop 남아 있으면 객체는 유지
		clip.transformKeyframes = setTransformKeyframe(clip, "scale", 0, 1);
		clip.transformKeyframes = setTransformKeyframe(clip, "rotation", 0, 0);
		const tk2 = removeTransformKeyframe(clip, "rotation", 0);
		expect(tk2?.scale).toBeDefined();
		expect(tk2?.rotation).toBeUndefined();
	});

	it("clearTransformProp removes entire curve", () => {
		const clip = makePlainClip();
		clip.transformKeyframes = setTransformKeyframe(clip, "scale", 0, 1);
		clip.transformKeyframes = setTransformKeyframe(clip, "scale", 60, 2);
		const tk = clearTransformProp(clip, "scale");
		expect(tk).toBeUndefined();
	});
});

describe("motion path (Phase 9)", () => {
	function makePlainClip(): TimelineClip {
		return {
			id: newClipId(),
			trackId: "v1",
			kind: "video",
			startFrame: 0,
			durationFrames: 120,
			sourceIn: 0,
			sourceOut: 120,
			speed: 1,
			reverse: false,
			opacity: 1,
			position: { x: 0, y: 0 },
			scale: 1,
			rotation: 0,
			volume: 1,
			muted: false,
			locked: false,
			selected: false,
			meta: {},
		};
	}

	it("setMotionKnot creates both positionX and positionY curves", () => {
		const clip = makePlainClip();
		clip.transformKeyframes = setMotionKnot(clip, 60, 100, -50);
		expect(clip.transformKeyframes.positionX).toBeDefined();
		expect(clip.transformKeyframes.positionY).toBeDefined();
		expect(evaluateTransform(clip, 60).x).toBeCloseTo(100);
		expect(evaluateTransform(clip, 60).y).toBeCloseTo(-50);
	});

	it("getMotionKnots merges frame union of X and Y curves", () => {
		const clip = makePlainClip();
		clip.transformKeyframes = setMotionKnot(clip, 0, 0, 0);
		clip.transformKeyframes = setMotionKnot(clip, 60, 100, 50);
		clip.transformKeyframes = setMotionKnot(clip, 120, 200, 100);
		const knots = getMotionKnots(clip);
		expect(knots.map((k) => k.frame)).toEqual([0, 60, 120]);
		expect(knots[1]).toMatchObject({ frame: 60, x: 100, y: 50 });
	});

	it("removeMotionKnot drops both X and Y at same frame", () => {
		const clip = makePlainClip();
		clip.transformKeyframes = setMotionKnot(clip, 0, 0, 0);
		clip.transformKeyframes = setMotionKnot(clip, 60, 100, 50);
		clip.transformKeyframes = removeMotionKnot(clip, 60);
		const knots = getMotionKnots(clip);
		expect(knots.map((k) => k.frame)).toEqual([0]);
	});

	it("removeMotionKnot can dissolve whole transformKeyframes when last knot removed", () => {
		const clip = makePlainClip();
		// frame 0 에 직접 설정해야 base seed 없이 단일 knot 유지
		clip.transformKeyframes = setMotionKnot(clip, 0, 10, 10);
		const tk = removeMotionKnot(clip, 0);
		expect(tk).toBeUndefined();
	});

	it("setTransformKeyframe at localFrame > 0 auto-seeds frame 0, motion knots reflect it", () => {
		const clip = makePlainClip();
		clip.transformKeyframes = setMotionKnot(clip, 60, 100, 50);
		const knots = getMotionKnots(clip);
		// seed 된 frame 0 + 60 으로 두 개
		expect(knots).toHaveLength(2);
		expect(knots[0]).toMatchObject({ frame: 0, x: 0, y: 0 });
		expect(knots[1]).toMatchObject({ frame: 60, x: 100, y: 50 });
	});

	it("getMotionKnots handles X-only (frame 0 direct) keyframes", () => {
		const clip = makePlainClip();
		// frame 0 에 직접 설정해 seed 없음
		clip.transformKeyframes = setTransformKeyframe(clip, "positionX", 0, 50);
		const knots = getMotionKnots(clip);
		expect(knots).toHaveLength(1);
		expect(knots[0]).toMatchObject({ frame: 0, x: 50, y: 0 });
	});
});
