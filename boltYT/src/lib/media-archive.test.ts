import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	__test,
	findArchivedMediaByQueries,
	findArchivedMediaByRemoteUrl,
	markMediaArchiveEntryUsed,
	recordMediaArchiveEntry,
} from "./media-archive";

const storage: Record<string, string> = {};

beforeEach(() => {
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage[key] ?? null,
		setItem: (key: string, value: string) => {
			storage[key] = value;
		},
		removeItem: (key: string) => {
			delete storage[key];
		},
		clear: () => {
			for (const key of Object.keys(storage)) delete storage[key];
		},
	});
	localStorage.clear();
});

describe("media-archive", () => {
	it("동일 remoteUrl 기록 시 쿼리를 병합한다", () => {
		recordMediaArchiveEntry({
			kind: "video",
			provider: "youtube",
			locale: "ko",
			storagePath: "scenes/a/video.mp4",
			remoteUrl: "https://youtu.be/abc",
			queries: ["사건 현장 CCTV"],
		});
		recordMediaArchiveEntry({
			kind: "video",
			provider: "youtube",
			locale: "ko",
			storagePath: "scenes/a/video.mp4",
			remoteUrl: "https://youtu.be/abc",
			queries: ["수사 현장 영상"],
		});

		const entries = __test.loadArchive();
		expect(entries).toHaveLength(1);
		expect(entries[0].queries).toEqual(
			expect.arrayContaining(["사건 현장 CCTV", "수사 현장 영상"]),
		);
	});

	it("query overlap 기준으로 아카이브 결과를 찾는다", () => {
		recordMediaArchiveEntry({
			kind: "image",
			provider: "naver",
			locale: "ko",
			storagePath: "scenes/evidence/photo.jpg",
			remoteUrl: "https://img.example/evidence.jpg",
			title: "증거 문건 사진",
			queries: ["증거 문건 사진", "포렌식 증거"],
		});
		recordMediaArchiveEntry({
			kind: "image",
			provider: "pexels",
			locale: "en",
			storagePath: "scenes/portrait/photo.jpg",
			remoteUrl: "https://img.example/portrait.jpg",
			title: "portrait photo",
			queries: ["portrait photo", "interview face"],
		});

		const hits = findArchivedMediaByQueries({
			kind: "image",
			locale: "ko",
			queries: ["포렌식 증거 사진"],
		});
		expect(hits[0]?.storagePath).toBe("scenes/evidence/photo.jpg");
	});

	it("remoteUrl로 기존 항목을 찾고 사용 횟수를 올린다", () => {
		const entry = recordMediaArchiveEntry({
			kind: "video",
			provider: "pexels",
			locale: "en",
			storagePath: "scenes/clip/video.mp4",
			remoteUrl: "https://cdn.example/clip.mp4",
			queries: ["night chase footage"],
		});

		const found = findArchivedMediaByRemoteUrl(
			"video",
			"https://cdn.example/clip.mp4",
		);
		expect(found?.id).toBe(entry.id);

		markMediaArchiveEntryUsed(entry.id);
		const after = __test.loadArchive()[0];
		expect(after.useCount).toBe(2);
	});
});
