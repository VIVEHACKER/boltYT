/**
 * bgm.ts 단위 테스트
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3456" }));
vi.mock("./local-db", () => ({
	storeLocalFile: vi.fn().mockResolvedValue("blob://test"),
}));
vi.mock("./bgm-library", () => ({
	LOCAL_PRESETS: { dark: "/bgm/dark/default.mp3" },
	PIXABAY_QUERIES: { dark: ["dark ambient"], tense: ["tension"] },
	getUserDefaultBgm: vi.fn(() => null),
	checkLocalPresetExists: vi.fn(async () => false),
}));

import {
	BGM_MOODS,
	autoPickBgm,
	downloadBgm,
	inferAutoBgmPreset,
	searchBgm,
	searchBgmFromPreset,
	setBgmFromFile,
	setBgmFromUrl,
} from "./bgm";
import type { AutoBgmSceneHint, BgmTrack } from "./bgm";
import { checkLocalPresetExists, getUserDefaultBgm } from "./bgm-library";

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
afterEach(() => {
	mockStorage.clear();
	vi.restoreAllMocks();
});

function okFetch(body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) }),
	);
}
function failFetch(status = 500) {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
}

// ─── BGM_MOODS ────────────────────────────────────────────────────────────────
describe("BGM_MOODS", () => {
	it("8개 분위기 항목 존재", () => {
		expect(BGM_MOODS).toHaveLength(8);
	});

	it("각 항목에 id·label·emoji 필드 존재", () => {
		for (const m of BGM_MOODS) {
			expect(m).toHaveProperty("id");
			expect(m).toHaveProperty("label");
			expect(m).toHaveProperty("emoji");
		}
	});

	it("'dark' 항목 포함", () => {
		expect(BGM_MOODS.some((m) => m.id === "dark")).toBe(true);
	});
});

// ─── inferAutoBgmPreset ────────────────────────────────────────────────────────
describe("inferAutoBgmPreset", () => {
	it("씬 없음 → mood 'dramatic'(기본), tempo 'slow'", () => {
		const result = inferAutoBgmPreset([]);
		expect(result.mood).toBe("dramatic");
		expect(result.tempo).toBe("slow");
		expect(result.keywords).toEqual([]);
	});

	it("horror 씬 → mood 'dark'", () => {
		const scenes: AutoBgmSceneHint[] = [
			{ mood: "horror", durationSeconds: 5 },
			{ mood: "horror", durationSeconds: 5 },
		];
		expect(inferAutoBgmPreset(scenes).mood).toBe("dark");
	});

	it("mystery 씬 → mood 'mysterious'", () => {
		const scenes: AutoBgmSceneHint[] = [
			{ mood: "mystery", durationSeconds: 4 },
		];
		expect(inferAutoBgmPreset(scenes).mood).toBe("mysterious");
	});

	it("warm 씬 → mood 'calm'", () => {
		const scenes: AutoBgmSceneHint[] = [{ mood: "warm", durationSeconds: 6 }];
		expect(inferAutoBgmPreset(scenes).mood).toBe("calm");
	});

	it("news 씬(video) → tense 보너스 포인트 추가", () => {
		const scenes: AutoBgmSceneHint[] = [
			{ mood: "news", sceneType: "video", durationSeconds: 5 },
		];
		const result = inferAutoBgmPreset(scenes);
		// dramatic=1, tense=1 → 정렬 후 첫번째
		expect(["dramatic", "tense"]).toContain(result.mood);
	});

	it("avgDuration ≤ 2.5 → tempo 'fast'", () => {
		const scenes: AutoBgmSceneHint[] = [
			{ mood: "neutral", durationSeconds: 2 },
			{ mood: "neutral", durationSeconds: 2 },
		];
		expect(inferAutoBgmPreset(scenes).tempo).toBe("fast");
	});

	it("avgDuration 2.6~5 → tempo 'mid'", () => {
		const scenes: AutoBgmSceneHint[] = [
			{ mood: "neutral", durationSeconds: 4 },
		];
		expect(inferAutoBgmPreset(scenes).tempo).toBe("mid");
	});

	it("avgDuration > 5 → tempo 'slow'", () => {
		const scenes: AutoBgmSceneHint[] = [
			{ mood: "neutral", durationSeconds: 8 },
		];
		expect(inferAutoBgmPreset(scenes).tempo).toBe("slow");
	});

	it("mood 없는 씬은 집계 건너뜀", () => {
		const scenes: AutoBgmSceneHint[] = [
			{ durationSeconds: 3 },
			{ mood: "horror", durationSeconds: 3 },
		];
		expect(inferAutoBgmPreset(scenes).mood).toBe("dark");
	});
});

// ─── searchBgm ────────────────────────────────────────────────────────────────
describe("searchBgm", () => {
	it("성공 → BgmTrack 배열 반환", async () => {
		okFetch({
			hits: [
				{
					id: 1,
					title: "Dark Track",
					user: "Artist",
					duration: 180,
					audio_url: "https://cdn.pixabay.com/dark.mp3",
					tags: "dark, ambient, horror",
				},
			],
		});
		const tracks = await searchBgm("dark ambient");
		expect(tracks).toHaveLength(1);
		expect(tracks[0].id).toBe("pixabay-1");
		expect(tracks[0].title).toBe("Dark Track");
		expect(tracks[0].tags).toContain("dark");
	});

	it("mood 옵션 → 쿼리 조합", async () => {
		okFetch({ hits: [] });
		await searchBgm("mystery", { mood: "mysterious" });
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("mystery");
	});

	it("minDuration/maxDuration 파라미터 전달", async () => {
		okFetch({ hits: [] });
		await searchBgm("calm", { minDuration: 60, maxDuration: 300 });
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("min_duration=60");
		expect(url).toContain("max_duration=300");
	});

	it("editorsChoice=true → editors_choice=true 파라미터", async () => {
		okFetch({ hits: [] });
		await searchBgm("epic", { editorsChoice: true });
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("editors_choice=true");
	});

	it("HTTP 오류 → 빈 배열 반환", async () => {
		failFetch(500);
		const tracks = await searchBgm("dark");
		expect(tracks).toEqual([]);
	});

	it("hits 없으면 빈 배열", async () => {
		okFetch({});
		expect(await searchBgm("test")).toEqual([]);
	});
});

// ─── searchBgmFromPreset ──────────────────────────────────────────────────────
describe("searchBgmFromPreset", () => {
	it("mood 없고 keywords 없음 → 빈 배열 (fetch 없이)", async () => {
		const tracks = await searchBgmFromPreset({
			mood: "",
			keywords: [],
			tempo: "mid",
		});
		expect(tracks).toEqual([]);
	});

	it("mood 있으면 MOOD_QUERIES로 검색", async () => {
		okFetch({ hits: [] });
		await searchBgmFromPreset({ mood: "dark", keywords: [], tempo: "slow" });
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("dark");
	});

	it("keywords 우선 사용", async () => {
		okFetch({ hits: [] });
		await searchBgmFromPreset({
			mood: "calm",
			keywords: ["piano", "rain"],
			tempo: "mid",
		});
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("piano");
	});

	it("tempo fast → min_duration=45", async () => {
		okFetch({ hits: [] });
		await searchBgmFromPreset({ mood: "upbeat", keywords: [], tempo: "fast" });
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("min_duration=45");
	});
});

// ─── downloadBgm ─────────────────────────────────────────────────────────────
describe("downloadBgm", () => {
	const track: BgmTrack = {
		id: "pixabay-1",
		title: "Test",
		artist: "Artist",
		duration: 120,
		previewUrl: "",
		downloadUrl: "https://cdn.pixabay.com/test.mp3",
		tags: ["test"],
		source: "pixabay",
	};

	it("성공 → 로컬 URL 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
			}),
		);
		const url = await downloadBgm(track, "script-1");
		expect(url).toBe("blob://test");
	});

	it("downloadUrl 없으면 throw", async () => {
		const emptyTrack = { ...track, downloadUrl: "" };
		await expect(downloadBgm(emptyTrack, "script-1")).rejects.toThrow(
			"다운로드 URL이 없습니다",
		);
	});

	it("HTTP 오류 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 404 }),
		);
		await expect(downloadBgm(track, "script-1")).rejects.toThrow(
			"BGM 다운로드 실패",
		);
	});
});

// ─── setBgmFromUrl ────────────────────────────────────────────────────────────
describe("setBgmFromUrl", () => {
	it("성공 → 로컬 URL 반환 + localStorage 저장", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
			}),
		);
		const url = await setBgmFromUrl("https://cdn.example.com/bgm.mp3", "sc-1");
		expect(url).toBe("blob://test");
		expect(mockStorage.getItem("bgm_path_sc-1")).toBe("scripts/sc-1/bgm.mp3");
	});

	it("HTTP 오류 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 403 }),
		);
		await expect(
			setBgmFromUrl("https://cdn.example.com/bad.mp3", "sc-1"),
		).rejects.toThrow("BGM 다운로드 실패");
	});
});

// ─── setBgmFromFile ───────────────────────────────────────────────────────────
describe("setBgmFromFile", () => {
	it("mp3 파일 → 로컬 URL 반환 + localStorage 저장", async () => {
		const file = new File([new Uint8Array(8)], "track.mp3", {
			type: "audio/mpeg",
		});
		const url = await setBgmFromFile(file, "sc-2");
		expect(url).toBe("blob://test");
		expect(mockStorage.getItem("bgm_path_sc-2")).toBe("scripts/sc-2/bgm.mp3");
	});

	it("wav 파일 → 확장자 보존", async () => {
		const file = new File([new Uint8Array(8)], "track.wav", {
			type: "audio/wav",
		});
		const url = await setBgmFromFile(file, "sc-3");
		expect(url).toBe("blob://test");
		expect(mockStorage.getItem("bgm_path_sc-3")).toBe("scripts/sc-3/bgm.wav");
	});
});

// ─── autoPickBgm ─────────────────────────────────────────────────────────────
describe("autoPickBgm", () => {
	it("mood 없으면 키워드 검색, 결과 없으면 null", async () => {
		okFetch({ hits: [] });
		const result = await autoPickBgm("sc-x", {
			mood: "",
			keywords: [],
			tempo: "mid",
		});
		expect(result).toBeNull();
	});

	it("getUserDefaultBgm 반환 → user_default 사용", async () => {
		vi.mocked(getUserDefaultBgm).mockReturnValueOnce({
			path: "custom/bgm.mp3",
			url: "blob://user-bgm",
		});
		const result = await autoPickBgm("sc-y", {
			mood: "dark",
			keywords: [],
			tempo: "slow",
		});
		expect(result?.source).toBe("user_default");
		expect(result?.url).toBe("blob://user-bgm");
	});

	it("로컬 프리셋 존재 → local_preset 사용", async () => {
		vi.mocked(checkLocalPresetExists).mockResolvedValueOnce(true);
		const result = await autoPickBgm("sc-z", {
			mood: "dark",
			keywords: [],
			tempo: "slow",
		});
		expect(result?.source).toBe("local_preset");
		expect(result?.storagePath).toBe("/bgm/dark/default.mp3");
	});

	it("curated 검색 성공 → curated_pixabay 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							hits: [
								{
									id: 99,
									title: "Dark Ambient",
									user: "Artist",
									duration: 180,
									audio_url: "https://cdn.pixabay.com/dark.mp3",
									tags: "dark",
								},
							],
						}),
				})
				.mockResolvedValue({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
				}),
		);
		const result = await autoPickBgm("sc-a", {
			mood: "dark",
			keywords: [],
			tempo: "slow",
		});
		expect(result?.source).toBe("curated_pixabay");
	});
});
