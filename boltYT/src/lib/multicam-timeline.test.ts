import { describe, expect, it } from "vitest";
import { createMulticamGroup, setCut } from "./multicam";
import {
	findActiveMulticamClip,
	findGroup,
	findMulticamAudioClip,
	groupedMulticamClips,
	isMulticamClipVisible,
} from "./multicam-timeline";
import type { TimelineClip, TimelineProject } from "./timeline-model";
import { createEmptyProject } from "./timeline-model";

function mkClip(
	id: string,
	angle: number,
	groupId = "g1",
	start = 0,
	dur = 300,
): TimelineClip {
	return {
		id,
		trackId: "v1",
		kind: "video",
		startFrame: start,
		durationFrames: dur,
		sourceIn: 0,
		sourceOut: dur,
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
		multicam: { groupId, angle },
	} as TimelineClip;
}

function setup(): TimelineProject {
	const p = createEmptyProject("s1");
	const group = createMulticamGroup("g1", "Interview", 3);
	p.multicamGroups = [group];
	p.clips = [mkClip("cam0", 0), mkClip("cam1", 1), mkClip("cam2", 2)];
	return p;
}

describe("multicam-timeline", () => {
	it("findGroup / missing", () => {
		const p = setup();
		expect(findGroup(p, "g1")?.name).toBe("Interview");
		expect(findGroup(p, "xx")).toBeUndefined();
	});

	it("groupedMulticamClips — angle 오름차순", () => {
		const p = setup();
		p.clips = [mkClip("c2", 2), mkClip("c0", 0), mkClip("c1", 1)];
		const grouped = groupedMulticamClips(p, "g1");
		expect(grouped.map((c) => c.multicam?.angle)).toEqual([0, 1, 2]);
	});

	it("findActiveMulticamClip — cuts 없으면 activeAngle 클립", () => {
		const p = setup();
		const active = findActiveMulticamClip(p, "g1", 50);
		expect(active?.id).toBe("cam0");
	});

	it("findActiveMulticamClip — cut 이후 angle 클립으로 스위치", () => {
		const p = setup();
		p.multicamGroups = [
			setCut(
				p.multicamGroups?.[0] ?? (setup().multicamGroups?.[0] as never),
				100,
				2,
			),
		];
		expect(findActiveMulticamClip(p, "g1", 50)?.id).toBe("cam0");
		expect(findActiveMulticamClip(p, "g1", 150)?.id).toBe("cam2");
	});

	it("findActiveMulticamClip — 프레임이 클립 범위 밖이면 undefined", () => {
		const p = setup();
		p.clips = [mkClip("cam0", 0, "g1", 0, 100)];
		expect(findActiveMulticamClip(p, "g1", 500)).toBeUndefined();
	});

	it("findMulticamAudioClip — audioAngle 기준", () => {
		const p = setup();
		const group = p.multicamGroups?.[0];
		if (!group) throw new Error();
		group.audioAngle = 1;
		const audio = findMulticamAudioClip(p, "g1", 50);
		expect(audio?.id).toBe("cam1");
	});

	it("isMulticamClipVisible — 비활성 angle 은 숨김", () => {
		const p = setup();
		const clip0 = p.clips[0];
		const clip1 = p.clips[1];
		expect(isMulticamClipVisible(p, clip0, 50)).toBe(true); // active
		expect(isMulticamClipVisible(p, clip1, 50)).toBe(false); // hidden
	});

	it("isMulticamClipVisible — 일반 (non-multicam) 클립은 그대로 true", () => {
		const p = setup();
		const plain = { ...p.clips[0], multicam: undefined };
		expect(isMulticamClipVisible(p, plain, 50)).toBe(true);
	});

	it("groupedMulticamClips — multicam.angle undefined 클립 포함 시 0으로 정렬", () => {
		const p = setup();
		const noAngleClip = { ...mkClip("noangle", 0), multicam: { groupId: "g1" } } as TimelineClip;
		p.clips = [mkClip("c2", 2), noAngleClip, mkClip("c1", 1)];
		const grouped = groupedMulticamClips(p, "g1");
		expect(grouped[0].multicam?.angle ?? 0).toBe(0);
	});

	it("findMulticamAudioClip — group 없으면 undefined", () => {
		const p = setup();
		expect(findMulticamAudioClip(p, "missing-group", 50)).toBeUndefined();
	});
});
