/**
 * use-multicam-shortcuts.ts 단위 테스트
 *
 * React hook 이라 useEffect 를 vi.mock 으로 동기 실행,
 * window.addEventListener/removeEventListener 는 vi.stubGlobal 로 교체.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
	useEffect: vi.fn(),
}));

vi.mock("./timeline-store", () => ({
	useTimelineStore: vi.fn(),
}));

vi.mock("./multicam-timeline", () => ({
	findGroup: vi.fn(),
}));

import { useEffect } from "react";
import { findGroup } from "./multicam-timeline";
import { useTimelineStore } from "./timeline-store";
import { useMulticamShortcuts } from "./use-multicam-shortcuts";

type KeyHandler = (e: KeyboardEvent) => void;

const mockGroup = {
	id: "g1",
	angles: 4,
	cuts: [],
	activeAngle: 0,
	audioAngle: 0,
};
const mockProject = { tracks: [], multicamGroups: [mockGroup] };
const mockClip = {
	id: "c1",
	multicam: { groupId: "g1" },
	sceneId: "s1",
	trackIndex: 0,
	startFrame: 0,
	durationFrames: 60,
};

describe("useMulticamShortcuts", () => {
	let capturedHandler: KeyHandler | undefined;
	let capturedCleanup: (() => void) | undefined;
	let setMulticamCutMock: ReturnType<typeof vi.fn>;
	let onCutMock: ReturnType<typeof vi.fn>;

	function setupStore(selected: (typeof mockClip)[] = []) {
		vi.mocked(useTimelineStore).mockImplementation(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(selector: (s: any) => unknown) => {
				const state = {
					project: mockProject,
					playhead: 10,
					selected: () => selected,
					setMulticamCut: setMulticamCutMock,
				};
				return selector(state);
			},
		);
	}

	function fireKey(key: string, target: object | null = null) {
		capturedHandler?.({
			key,
			target,
			preventDefault: vi.fn(),
		} as unknown as KeyboardEvent);
	}

	beforeEach(() => {
		capturedHandler = undefined;
		capturedCleanup = undefined;
		setMulticamCutMock = vi.fn();
		onCutMock = vi.fn();

		vi.stubGlobal("window", {
			addEventListener: vi.fn((ev: string, fn: KeyHandler) => {
				if (ev === "keydown") capturedHandler = fn;
			}),
			removeEventListener: vi.fn(),
		});

		vi.mocked(useEffect).mockImplementation((cb) => {
			capturedCleanup = (cb as () => (() => void) | undefined)() ?? undefined;
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("선택 없음 → addEventListener 미호출", () => {
		setupStore([]);
		vi.mocked(findGroup).mockReturnValue(undefined);
		useMulticamShortcuts();
		expect(window.addEventListener).not.toHaveBeenCalled();
	});

	it("multicam 없는 클립 → addEventListener 미호출", () => {
		const plain = {
			...mockClip,
			multicam: undefined,
		} as unknown as typeof mockClip;
		setupStore([plain]);
		useMulticamShortcuts();
		expect(window.addEventListener).not.toHaveBeenCalled();
	});

	it("findGroup → undefined → addEventListener 미호출", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(undefined);
		useMulticamShortcuts();
		expect(window.addEventListener).not.toHaveBeenCalled();
	});

	it("멀티캠 클립 선택 → keydown 리스너 등록", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		expect(window.addEventListener).toHaveBeenCalledWith(
			"keydown",
			expect.any(Function),
		);
	});

	it("키 1 → setMulticamCut(groupId, playhead, 0)", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("1");
		expect(setMulticamCutMock).toHaveBeenCalledWith("g1", 10, 0);
	});

	it("키 4 → setMulticamCut(groupId, playhead, 3)", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("4");
		expect(setMulticamCutMock).toHaveBeenCalledWith("g1", 10, 3);
	});

	it("angles(4) 초과 키 5 → 무시", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("5");
		expect(setMulticamCutMock).not.toHaveBeenCalled();
	});

	it("키 0 (범위 1-4 밖) → 무시", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("0");
		expect(setMulticamCutMock).not.toHaveBeenCalled();
	});

	it("문자 키 → 무시", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("a");
		expect(setMulticamCutMock).not.toHaveBeenCalled();
	});

	it("target=INPUT → 무시", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("1", { tagName: "INPUT" });
		expect(setMulticamCutMock).not.toHaveBeenCalled();
	});

	it("target=TEXTAREA → 무시", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("2", { tagName: "TEXTAREA" });
		expect(setMulticamCutMock).not.toHaveBeenCalled();
	});

	it("contentEditable target → 무시", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		fireKey("1", { tagName: "DIV", isContentEditable: true });
		expect(setMulticamCutMock).not.toHaveBeenCalled();
	});

	it("cleanup → removeEventListener 호출", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		capturedCleanup?.();
		expect(window.removeEventListener).toHaveBeenCalledWith(
			"keydown",
			expect.any(Function),
		);
	});

	it("onCut 콜백 — 키 1 누르면 angle 0 으로 호출", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts({ onCut: onCutMock as (angle: number) => void });
		fireKey("1");
		expect(onCutMock).toHaveBeenCalledWith(0);
	});

	it("onCut 콜백 — 키 3 누르면 angle 2 로 호출", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts({ onCut: onCutMock as (angle: number) => void });
		fireKey("3");
		expect(onCutMock).toHaveBeenCalledWith(2);
	});

	it("onCut 콜백 없으면 에러 없이 동작", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts();
		expect(() => fireKey("2")).not.toThrow();
		expect(setMulticamCutMock).toHaveBeenCalledWith("g1", 10, 1);
	});

	it("onCut 콜백 — 범위 밖 키는 호출 안 됨", () => {
		setupStore([mockClip]);
		vi.mocked(findGroup).mockReturnValue(
			mockGroup as unknown as ReturnType<typeof findGroup>,
		);
		useMulticamShortcuts({ onCut: onCutMock as (angle: number) => void });
		fireKey("5"); // angles=4 초과
		expect(onCutMock).not.toHaveBeenCalled();
	});
});
