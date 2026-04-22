import { describe, expect, it } from "vitest";
import {
	angleAtFrame,
	compactCuts,
	createMulticamGroup,
	removeCut,
	setActiveAngle,
	setAngleCount,
	setAudioAngle,
	setCut,
} from "./multicam";

function g() {
	return createMulticamGroup("g1", "Interview", 3);
}

describe("multicam", () => {
	it("createMulticamGroup — 최소 angles=2 보장", () => {
		const group = createMulticamGroup("x", "mic", 1);
		expect(group.angles).toBe(2);
		expect(group.activeAngle).toBe(0);
		expect(group.audioAngle).toBe(0);
	});

	it("angleAtFrame — cuts 없으면 activeAngle 반환", () => {
		const group = g();
		expect(angleAtFrame(group, 100)).toBe(0);
	});

	it("setCut/angleAtFrame — 프레임 기반 스위칭", () => {
		let group = g();
		group = setCut(group, 60, 1);
		group = setCut(group, 120, 2);
		expect(angleAtFrame(group, 0)).toBe(0);
		expect(angleAtFrame(group, 59)).toBe(0);
		expect(angleAtFrame(group, 60)).toBe(1);
		expect(angleAtFrame(group, 100)).toBe(1);
		expect(angleAtFrame(group, 120)).toBe(2);
		expect(angleAtFrame(group, 9999)).toBe(2);
	});

	it("setCut — 같은 frame 덮어쓰기 + 정렬", () => {
		let group = g();
		group = setCut(group, 100, 1);
		group = setCut(group, 50, 2);
		group = setCut(group, 100, 2); // override
		expect(group.cuts.map((c) => c.frame)).toEqual([50, 100]);
		expect(group.cuts[1].angle).toBe(2);
	});

	it("setCut — angle 클램핑", () => {
		let group = g();
		group = setCut(group, 10, 99);
		expect(group.cuts[0].angle).toBe(2); // angles=3 → 최대 2
	});

	it("removeCut", () => {
		let group = g();
		group = setCut(group, 10, 1);
		group = setCut(group, 20, 2);
		group = removeCut(group, 10);
		expect(group.cuts).toHaveLength(1);
		expect(group.cuts[0].frame).toBe(20);
	});

	it("compactCuts — 연속 동일 angle 제거", () => {
		let group = g();
		group = setActiveAngle(group, 0);
		group = setCut(group, 10, 1);
		group = setCut(group, 20, 1);
		group = setCut(group, 30, 1);
		group = setCut(group, 40, 2);
		group = compactCuts(group);
		expect(group.cuts.map((c) => c.angle)).toEqual([1, 2]);
	});

	it("setAngleCount — 기존 cuts 클램핑", () => {
		let group = g();
		group = setCut(group, 10, 2);
		group = setCut(group, 20, 1);
		group = setAngleCount(group, 2);
		expect(group.angles).toBe(2);
		// 2 → 1 로 클램핑 (angles=2 최대 1)
		expect(group.cuts.map((c) => c.angle)).toEqual([1, 1]);
	});

	it("setAngleCount — 최소 2 강제", () => {
		let group = g();
		group = setAngleCount(group, 0);
		expect(group.angles).toBe(2);
	});

	it("setActiveAngle / setAudioAngle 클램핑", () => {
		let group = g();
		group = setActiveAngle(group, 99);
		expect(group.activeAngle).toBe(2);
		group = setAudioAngle(group, -5);
		expect(group.audioAngle).toBe(0);
	});
});
