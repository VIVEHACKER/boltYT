/**
 * bgm-library.ts 단위 테스트
 *
 * checkLocalPresetExists → fetch 의존 (vi.stubGlobal).
 * getUserDefaultBgm / setUserDefaultBgm / clearUserDefaultBgm → localStorage 의존.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	checkLocalPresetExists,
	clearUserDefaultBgm,
	getUserDefaultBgm,
	LOCAL_PRESETS,
	PIXABAY_QUERIES,
	setUserDefaultBgm,
} from "./bgm-library";

// ─── localStorage stub ────────────────────────────────────────────────────────
const _ls: Record<string, string> = {};
const mockStorage = {
	getItem: (k: string) => _ls[k] ?? null,
	setItem: (k: string, v: string) => {
		_ls[k] = v;
	},
	removeItem: (k: string) => {
		delete _ls[k];
	},
	clear: () => {
		for (const k of Object.keys(_ls)) delete _ls[k];
	},
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => mockStorage.clear());

// ─── 상수 구조 검증 ────────────────────────────────────────────────────────────
describe("LOCAL_PRESETS", () => {
	it("8개 mood 프리셋 정의", () => {
		expect(Object.keys(LOCAL_PRESETS)).toHaveLength(8);
	});

	it("각 경로가 /bgm/로 시작하고 .mp3로 끝남", () => {
		for (const path of Object.values(LOCAL_PRESETS)) {
			expect(path).toMatch(/^\/bgm\/.+\.mp3$/);
		}
	});
});

describe("PIXABAY_QUERIES", () => {
	it("8개 mood 쿼리 정의", () => {
		expect(Object.keys(PIXABAY_QUERIES)).toHaveLength(8);
	});

	it("각 mood마다 쿼리 1개 이상", () => {
		for (const queries of Object.values(PIXABAY_QUERIES)) {
			expect(queries.length).toBeGreaterThan(0);
			expect(queries.every((q) => typeof q === "string" && q.length > 0)).toBe(
				true,
			);
		}
	});

	it("자동 검색어에는 싼 느낌의 범용 배경음 키워드를 넣지 않는다", () => {
		const allQueries = Object.values(PIXABAY_QUERIES).flat().join(" ");
		expect(allQueries).not.toMatch(/corporate|meditation|lo-fi|jingle/i);
	});
});

// ─── getUserDefaultBgm / setUserDefaultBgm / clearUserDefaultBgm ──────────────
describe("getUserDefaultBgm / setUserDefaultBgm / clearUserDefaultBgm", () => {
	it("설정 없으면 null 반환", () => {
		expect(getUserDefaultBgm("dark")).toBeNull();
	});

	it("setUserDefaultBgm 후 getUserDefaultBgm 복원", () => {
		setUserDefaultBgm("dark", "/files/dark.mp3", "blob:http://localhost/1234");
		expect(getUserDefaultBgm("dark")).toEqual({
			path: "/files/dark.mp3",
			url: "blob:http://localhost/1234",
		});
	});

	it("path 없으면 null 반환", () => {
		mockStorage.setItem("custom_bgm_url_calm", "blob:http://localhost/x");
		expect(getUserDefaultBgm("calm")).toBeNull();
	});

	it("url 없으면 null 반환", () => {
		mockStorage.setItem("custom_bgm_path_calm", "/f.mp3");
		expect(getUserDefaultBgm("calm")).toBeNull();
	});

	it("clearUserDefaultBgm → 이후 null 반환", () => {
		setUserDefaultBgm("upbeat", "/up.mp3", "blob:url");
		clearUserDefaultBgm("upbeat");
		expect(getUserDefaultBgm("upbeat")).toBeNull();
	});

	it("mood별 독립 저장", () => {
		setUserDefaultBgm("dark", "/d.mp3", "blob:d");
		setUserDefaultBgm("calm", "/c.mp3", "blob:c");
		expect(getUserDefaultBgm("dark")?.path).toBe("/d.mp3");
		expect(getUserDefaultBgm("calm")?.path).toBe("/c.mp3");
	});

	it("localStorage undefined → getUserDefaultBgm null 반환", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(getUserDefaultBgm("dark")).toBeNull();
		vi.stubGlobal("localStorage", mockStorage);
	});

	it("localStorage undefined → setUserDefaultBgm throw 없음", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(() => setUserDefaultBgm("dark", "/d.mp3", "blob:d")).not.toThrow();
		vi.stubGlobal("localStorage", mockStorage);
	});

	it("localStorage undefined → clearUserDefaultBgm throw 없음", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(() => clearUserDefaultBgm("dark")).not.toThrow();
		vi.stubGlobal("localStorage", mockStorage);
	});
});

// ─── checkLocalPresetExists ───────────────────────────────────────────────────
describe("checkLocalPresetExists", () => {
	it("HEAD 요청 성공(ok) → true", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200 }),
		);
		expect(await checkLocalPresetExists("dark")).toBe(true);
	});

	it("HEAD 요청 실패(404) → false", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 404 }),
		);
		expect(await checkLocalPresetExists("calm")).toBe(false);
	});

	it("네트워크 오류 → false", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network error")),
		);
		expect(await checkLocalPresetExists("epic")).toBe(false);
	});

	it("fetch에 올바른 경로 전달", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		vi.stubGlobal("fetch", fetchMock);
		await checkLocalPresetExists("mysterious");
		expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
			LOCAL_PRESETS.mysterious,
		);
	});
});
