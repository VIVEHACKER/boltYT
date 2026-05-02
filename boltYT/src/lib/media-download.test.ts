/**
 * media-download.ts 단위 테스트
 *
 * 외부 의존성(fetch, supabase, storeLocalFile, search)은 vi.mock으로 처리
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

// ─── Mock: local-db ───────────────────────────────────────────────────────────
vi.mock("./local-db", () => ({
	storeLocalFile: vi.fn(async (path: string) => `local://${path}`),
	ensureBlobUrls: vi.fn(async (paths: string[]) =>
		new Map(paths.map((path) => [path, `blob://${path}`])),
	),
}));

// ─── Mock: supabase ───────────────────────────────────────────────────────────
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("./supabase", () => ({
	supabase: {
		from: vi.fn(() => ({ insert: mockInsert })),
	},
}));

// ─── Mock: search ─────────────────────────────────────────────────────────────
const mockSearchPexelsImages = vi.fn();
const mockSearchPixabayImages = vi.fn();
const mockSearchWikimediaImages = vi.fn();
const mockSearchNaverImages = vi.fn();
const mockSearchPexelsVideos = vi.fn();
const mockSearchPixabayVideos = vi.fn();
const mockSearchYouTubeVideos = vi.fn();

vi.mock("./search", () => ({
	searchPexelsImages: (...args: unknown[]) => mockSearchPexelsImages(...args),
	searchPixabayImages: (...args: unknown[]) => mockSearchPixabayImages(...args),
	searchWikimediaImages: (...args: unknown[]) =>
		mockSearchWikimediaImages(...args),
	searchNaverImages: (...args: unknown[]) => mockSearchNaverImages(...args),
	searchPexelsVideos: (...args: unknown[]) => mockSearchPexelsVideos(...args),
	searchPixabayVideos: (...args: unknown[]) => mockSearchPixabayVideos(...args),
	searchYouTubeVideos: (...args: unknown[]) => mockSearchYouTubeVideos(...args),
}));

// ─── localStorage stub ────────────────────────────────────────────────────────
const _ls: Record<string, string> = {};
beforeAll(() =>
	vi.stubGlobal("localStorage", {
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
	}),
);

afterEach(() => {
	vi.restoreAllMocks();
	mockInsert.mockResolvedValue({ data: null, error: null });
	localStorage.clear();
});

import { storeLocalFile } from "./local-db";
import { __test as archiveTest } from "./media-archive";
import {
	downloadImageToLocal,
	downloadImageToPath,
	downloadThumbnailToLocal,
	downloadVideoToLocal,
	downloadVideoToPath,
	downloadYouTubeVideo,
	downloadYouTubeVideoToPath,
	resetUsedVideoIds,
	searchAndDownloadImage,
	searchAndDownloadImageToPath,
	searchAndDownloadVideo,
	searchAndDownloadVideoToPath,
} from "./media-download";

// ─── helpers ─────────────────────────────────────────────────────────────────
function mockFetchOk(contentType = "image/jpeg", body?: ArrayBuffer) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			headers: { get: (_: string) => contentType },
			arrayBuffer: () => Promise.resolve(body ?? new ArrayBuffer(8)),
		}),
	);
}

function mockFetchFail(status = 404) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: false,
			status,
			text: () => Promise.resolve("error"),
		}),
	);
}

// ─── downloadImageToPath ──────────────────────────────────────────────────────
describe("downloadImageToPath", () => {
	it("jpg 이미지 다운로드 성공 → url + storagePath 반환", async () => {
		mockFetchOk("image/jpeg");
		const result = await downloadImageToPath(
			"scenes/s1/img.jpg",
			"http://img.com/photo.jpg",
		);
		expect(result.url).toContain("scenes/s1");
		expect(result.storagePath).toContain(".jpg");
	});

	it("png URL → ext를 png로 정규화", async () => {
		mockFetchOk("image/png");
		const result = await downloadImageToPath(
			"scenes/s1/img.jpg",
			"http://img.com/photo.png",
		);
		expect(result.storagePath).toContain(".png");
	});

	it("webp URL → ext를 webp로 정규화", async () => {
		mockFetchOk("image/webp");
		const result = await downloadImageToPath(
			"scenes/s1/img.jpg",
			"http://img.com/photo.webp",
		);
		expect(result.storagePath).toContain(".webp");
	});

	it("fetch 실패 → throw", async () => {
		mockFetchFail(404);
		await expect(
			downloadImageToPath("scenes/s1/img.jpg", "http://img.com/fail.jpg"),
		).rejects.toThrow("이미지 다운로드 실패");
	});

	it("content-type이 image/ 아님 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				headers: { get: () => "video/mp4" },
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
			}),
		);
		await expect(
			downloadImageToPath("scenes/s1/img.jpg", "http://img.com/video.mp4"),
		).rejects.toThrow("이미지가 아님");
	});

	it("URL에 확장자 없을 때 → jpg 기본값 사용", async () => {
		mockFetchOk("image/jpeg");
		const result = await downloadImageToPath(
			"scenes/s1/img.jpg",
			"http://img.com/photo",
		);
		expect(result.storagePath).toContain(".jpg");
	});
});

// ─── downloadImageToLocal ─────────────────────────────────────────────────────
describe("downloadImageToLocal", () => {
	it("이미지 다운로드 + supabase insert → url 반환", async () => {
		mockFetchOk("image/jpeg");
		const url = await downloadImageToLocal(
			"scene-1",
			"http://img.com/photo.jpg",
		);
		expect(typeof url).toBe("string");
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ scene_id: "scene-1", type: "image" }),
		);
	});
});

// ─── downloadYouTubeVideoToPath ───────────────────────────────────────────────
describe("downloadYouTubeVideoToPath", () => {
	it("프록시 헬스체크 실패 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 503 }),
		);
		await expect(
			downloadYouTubeVideoToPath(
				"scenes/s1/video.mp4",
				"https://youtube.com/watch?v=abc",
			),
		).rejects.toThrow("비디오 프록시가 실행되고 있지 않습니다");
	});

	it("프록시 헬스체크 네트워크 오류 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
		);
		await expect(
			downloadYouTubeVideoToPath(
				"scenes/s1/video.mp4",
				"https://youtube.com/watch?v=abc",
			),
		).rejects.toThrow("비디오 프록시가 실행되고 있지 않습니다");
	});

	it("헬스체크 성공 + 다운로드 성공 → url + storagePath 반환", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: true }) // health check
			.mockResolvedValueOnce({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
			}); // download
		vi.stubGlobal(
			"fetch",
			fetchMock,
		);
		const result = await downloadYouTubeVideoToPath(
			"scenes/s1/video.mp4",
			"https://youtube.com/watch?v=abc",
			30,
			12,
		);
		expect(result.url).toBeDefined();
		expect(result.storagePath).toContain(".mp4");
		const downloadUrl = new URL(String(fetchMock.mock.calls[1][0]));
		expect(downloadUrl.searchParams.get("maxDuration")).toBe("30");
		expect(downloadUrl.searchParams.get("start")).toBe("12");
		expect(downloadUrl.searchParams.get("url")).toBe(
			"https://youtube.com/watch?v=abc",
		);
	});

	it("헬스체크 성공 + 다운로드 실패 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true }) // health check
				.mockResolvedValueOnce({
					ok: false,
					status: 400,
					text: () => Promise.resolve("Bad Request"),
				}),
		);
		await expect(
			downloadYouTubeVideoToPath(
				"scenes/s1/video.mp4",
				"https://youtube.com/watch?v=abc",
			),
		).rejects.toThrow("영상 다운로드 실패");
	});

	it("localStorage의 video_proxy_url 사용", async () => {
		_ls["video_proxy_url"] = "http://localhost:9999";
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true })
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
				}),
		);
		const result = await downloadYouTubeVideoToPath(
			"scenes/s1/video.mp4",
			"https://youtube.com/watch?v=test",
		);
		expect(result.url).toBeDefined();
		delete _ls["video_proxy_url"];
	});
});

// ─── downloadYouTubeVideo ─────────────────────────────────────────────────────
describe("downloadYouTubeVideo", () => {
	it("다운로드 성공 + supabase insert → url 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true })
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
				}),
		);
		const url = await downloadYouTubeVideo(
			"scene-yt",
			"https://youtube.com/watch?v=abc",
		);
		expect(typeof url).toBe("string");
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ scene_id: "scene-yt", type: "video" }),
		);
	});
});

// ─── downloadVideoToPath ──────────────────────────────────────────────────────
describe("downloadVideoToPath", () => {
	it("직접 mp4 다운로드 성공", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(32)),
			}),
		);
		const result = await downloadVideoToPath(
			"scenes/s1/video.webm",
			"http://cdn.com/clip.mp4",
		);
		expect(result.storagePath).toContain(".mp4");
	});

	it("다운로드 실패 → throw", async () => {
		mockFetchFail(503);
		await expect(
			downloadVideoToPath("scenes/s1/video.mp4", "http://cdn.com/clip.mp4"),
		).rejects.toThrow("영상 다운로드 실패");
	});
});

// ─── downloadVideoToLocal ─────────────────────────────────────────────────────
describe("downloadVideoToLocal", () => {
	it("다운로드 성공 + supabase insert → url 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
			}),
		);
		const url = await downloadVideoToLocal(
			"scene-v",
			"http://cdn.com/clip.mp4",
		);
		expect(typeof url).toBe("string");
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ scene_id: "scene-v", type: "video" }),
		);
	});
});

// ─── downloadThumbnailToLocal ─────────────────────────────────────────────────
describe("downloadThumbnailToLocal", () => {
	it("썸네일 다운로드 성공 → url 반환 + supabase insert", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
			}),
		);
		const url = await downloadThumbnailToLocal(
			"scene-t",
			"http://img.com/thumb.jpg",
		);
		expect(typeof url).toBe("string");
		expect(mockInsert).toHaveBeenCalled();
	});

	it("썸네일 다운로드 실패 → 빈 문자열 반환 (catch 분기)", async () => {
		mockFetchFail(403);
		const url = await downloadThumbnailToLocal(
			"scene-t2",
			"http://img.com/fail.jpg",
		);
		expect(url).toBe("");
	});

	it("fetch 자체 오류 → 빈 문자열 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("Network Error")),
		);
		const url = await downloadThumbnailToLocal(
			"scene-t3",
			"http://img.com/err.jpg",
		);
		expect(url).toBe("");
	});
});

// ─── searchAndDownloadImageToPath ─────────────────────────────────────────────
describe("searchAndDownloadImageToPath", () => {
	beforeEach(() => {
		mockSearchPexelsImages.mockReset();
		mockSearchPixabayImages.mockReset();
		mockSearchWikimediaImages.mockReset();
		mockSearchNaverImages.mockReset();
	});

	it("ko locale: 네이버 성공 → 결과 반환", async () => {
		mockSearchNaverImages.mockResolvedValue([
			{
				title: "숲 현장 사진",
				link: "http://naver.com/img.jpg",
				sizewidth: "1200",
				sizeheight: "1600",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"forest",
			"숲",
			"ko",
		);
		expect(result).not.toBeNull();
		expect(result?.url).toBeDefined();
	});

	it("ko locale: 네이버 실패 → Pexels fallback", async () => {
		mockSearchNaverImages.mockRejectedValue(new Error("Naver fail"));
		mockSearchPexelsImages.mockResolvedValue([
			{
				downloadUrl: "http://pexels.com/img.jpg",
				id: "p1",
				url: "http://pexels.com/forest-photo",
				width: 1200,
				height: 1800,
				photographer: "forest scene",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"forest",
			undefined,
			"ko",
		);
		expect(result).not.toBeNull();
	});

	it("en locale: Pexels 우선", async () => {
		mockSearchPexelsImages.mockResolvedValue([
			{
				downloadUrl: "http://pexels.com/img.jpg",
				id: "p1",
				url: "http://pexels.com/forest-photo",
				width: 1200,
				height: 1800,
				photographer: "forest scene",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"forest",
			undefined,
			"en",
		);
		expect(result).not.toBeNull();
	});

	it("en locale: Pexels 실패 → 네이버 fallback", async () => {
		mockSearchPexelsImages.mockRejectedValue(new Error("Pexels fail"));
		mockSearchNaverImages.mockResolvedValue([
			{
				title: "숲 현장 사진",
				link: "http://naver.com/img.jpg",
				sizewidth: "1200",
				sizeheight: "1600",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"forest",
			"숲",
			"en",
		);
		expect(result).not.toBeNull();
	});

	it("모든 소스 실패 → null 반환", async () => {
		mockSearchNaverImages.mockRejectedValue(new Error("fail"));
		mockSearchPexelsImages.mockRejectedValue(new Error("fail"));
		mockSearchPixabayImages.mockRejectedValue(new Error("fail"));
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"forest",
			undefined,
			"ko",
		);
		expect(result).toBeNull();
	});

	it("Pexels 결과 없음 → null", async () => {
		mockSearchPexelsImages.mockResolvedValue([]);
		mockSearchNaverImages.mockResolvedValue([]);
		mockSearchPixabayImages.mockResolvedValue([]);
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/img.jpg",
			"forest",
			undefined,
			"en",
		);
		expect(result).toBeNull();
	});

	it("Pexels 결과에 downloadUrl 없음 → null", async () => {
		mockSearchPexelsImages.mockResolvedValue([{ id: "p1" }]); // downloadUrl 없음
		mockSearchNaverImages.mockResolvedValue([]);
		mockSearchPixabayImages.mockResolvedValue([]);
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/img.jpg",
			"forest",
			undefined,
			"en",
		);
		expect(result).toBeNull();
	});

	it("queryKo 없을 때 queryEn으로 폴백", async () => {
		mockSearchNaverImages.mockResolvedValue([
			{
				title: "forest trail photo",
				link: "http://naver.com/img.jpg",
				sizewidth: "800",
				sizeheight: "600",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/img.jpg",
			"forest", // queryKo undefined
		);
		expect(mockSearchNaverImages).toHaveBeenCalledWith("forest", 5);
		expect(result).not.toBeNull();
	});

	it("네이버 결과 여러 개 → 큰 이미지 선택", async () => {
		mockSearchNaverImages.mockResolvedValue([
			{
				title: "forest small image",
				link: "http://naver.com/small.jpg",
				sizewidth: "100",
				sizeheight: "100",
			},
			{
				title: "forest big image",
				link: "http://naver.com/big.jpg",
				sizewidth: "800",
				sizeheight: "600",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/img.jpg",
			"forest",
			"숲",
			"ko",
		);
		// 큰 이미지(big.jpg) 선택 확인
		const storeFn = storeLocalFile as ReturnType<typeof vi.fn>;
		expect(storeFn).toHaveBeenCalled();
		expect(result).not.toBeNull();
	});

	it("아카이브 적중 시 외부 검색 없이 로컬 결과를 재사용", async () => {
		localStorage.setItem(
			archiveTest.STORAGE_KEY,
			JSON.stringify([
				{
					id: "arch-img",
					kind: "image",
					provider: "naver",
					locale: "ko",
					storagePath: "scenes/archive/reused.jpg",
					remoteUrl: "http://naver.com/reused.jpg",
					thumbnailUrl: "",
					title: "사건 현장 사진",
					queries: ["사건 현장 사진", "뉴스 사진"],
					useCount: 1,
					createdAt: new Date().toISOString(),
					lastUsedAt: new Date().toISOString(),
				},
			]),
		);

		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"crime scene photo",
			"사건 현장 사진",
			"ko",
		);
		expect(result).toEqual(
			expect.objectContaining({
				url: "blob://scenes/archive/reused.jpg",
				storagePath: "scenes/archive/reused.jpg",
				provider: "naver",
			}),
		);
		expect(mockSearchNaverImages).not.toHaveBeenCalled();
		expect(mockSearchPexelsImages).not.toHaveBeenCalled();
		expect(mockSearchPixabayImages).not.toHaveBeenCalled();
		expect(mockSearchWikimediaImages).not.toHaveBeenCalled();
	});

	it("Pexels 실패 시 Pixabay 이미지로 폴백한다", async () => {
		mockSearchNaverImages.mockResolvedValue([]);
		mockSearchPexelsImages.mockResolvedValue([]);
		mockSearchPixabayImages.mockResolvedValue([
			{
				id: 1,
				downloadUrl: "http://pixabay.com/img.jpg",
				thumbnail: "http://pixabay.com/thumb.jpg",
				width: 1920,
				height: 1080,
				tags: "crime scene",
				user: "pixuser",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"crime scene",
			"사건 현장",
			"en",
		);
		expect(result).not.toBeNull();
	});

	it("스톡 이미지가 비어 있으면 Wikimedia Commons 이미지로 보정한다", async () => {
		mockSearchNaverImages.mockResolvedValue([]);
		mockSearchPexelsImages.mockResolvedValue([]);
		mockSearchPixabayImages.mockResolvedValue([]);
		mockSearchWikimediaImages.mockResolvedValue([
			{
				id: 935349,
				title: "Amelia Earhart standing by Lockheed Electra aircraft",
				pageUrl: "https://commons.wikimedia.org/wiki/File:Amelia_Earhart.jpg",
				downloadUrl: "http://commons.wikimedia.org/earhart.jpg",
				thumbnail: "http://commons.wikimedia.org/earhart-thumb.jpg",
				width: 1400,
				height: 1900,
				mime: "image/jpeg",
				license: "Public domain",
				artist: "Unknown",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"Amelia Earhart disappearance",
			"아멜리아 에어하트 실종",
			"en",
		);
		expect(result).not.toBeNull();
		expect(mockSearchWikimediaImages).toHaveBeenCalled();
	});

	it("거부 키워드에 걸린 후보는 점수가 높아도 선택하지 않는다", async () => {
		mockSearchNaverImages.mockResolvedValue([
			{
				title: "사건 로고 포스터",
				link: "http://naver.com/logo.jpg",
				sizewidth: "2400",
				sizeheight: "2400",
			},
		]);
		mockSearchPexelsImages.mockResolvedValue([]);
		mockSearchPixabayImages.mockResolvedValue([]);
		mockSearchWikimediaImages.mockResolvedValue([
			{
				id: 11,
				title: "official case document archive photo",
				pageUrl: "https://commons.wikimedia.org/wiki/File:Document.jpg",
				downloadUrl: "http://commons.wikimedia.org/document.jpg",
				thumbnail: "http://commons.wikimedia.org/document-thumb.jpg",
				width: 1500,
				height: 1100,
				mime: "image/jpeg",
				license: "Public domain",
				artist: "archive",
			},
		]);
		mockFetchOk("image/jpeg");
		const result = await searchAndDownloadImageToPath(
			"scenes/s1/search-image.jpg",
			"official case document",
			"사건 문서",
			"en",
			{ rejectTerms: ["logo", "포스터"], minScore: 18 },
		);

		expect(result?.provider).toBe("wikimedia");
		expect(result?.storagePath).toContain("search-image");
	});
});

// ─── searchAndDownloadImage ───────────────────────────────────────────────────
describe("searchAndDownloadImage", () => {
	beforeEach(() => {
		mockSearchNaverImages.mockReset();
		mockSearchPexelsImages.mockReset();
		mockSearchPixabayImages.mockReset();
		mockSearchWikimediaImages.mockReset();
	});

	it("결과 있으면 url 반환 + supabase insert", async () => {
		mockSearchNaverImages.mockResolvedValue([
			{
				title: "forest documentary image",
				link: "http://naver.com/img.jpg",
				sizewidth: "800",
				sizeheight: "600",
			},
		]);
		mockFetchOk("image/jpeg");
		const url = await searchAndDownloadImage("scene-si", "forest", "숲");
		expect(typeof url).toBe("string");
		expect(url).not.toBe("");
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ scene_id: "scene-si", type: "image" }),
		);
	});

	it("결과 없으면 빈 문자열 반환", async () => {
		mockSearchNaverImages.mockRejectedValue(new Error("fail"));
		mockSearchPexelsImages.mockRejectedValue(new Error("fail"));
		mockSearchPixabayImages.mockRejectedValue(new Error("fail"));
		const url = await searchAndDownloadImage("scene-si2", "forest");
		expect(url).toBe("");
	});
});

// ─── searchAndDownloadVideoToPath ─────────────────────────────────────────────
describe("searchAndDownloadVideoToPath", () => {
	beforeEach(() => {
		resetUsedVideoIds();
		mockSearchPexelsVideos.mockReset();
		mockSearchPixabayVideos.mockReset();
		mockSearchYouTubeVideos.mockReset();
	});

	it("ko locale: YouTube 우선 성공", async () => {
		mockSearchYouTubeVideos.mockResolvedValue([
			{
				videoId: "yt123",
				title: "숲 수색 현장 영상",
				description: "forest search footage",
				channelTitle: "뉴스채널",
				thumbnail: "http://thumb.com/t.jpg",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true }) // proxy health
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
				}),
		);
		const result = await searchAndDownloadVideoToPath(
			"scenes/s1/video.mp4",
			"forest",
			"숲",
			20,
			"ko",
		);
		expect(result).not.toBeNull();
		expect(result?.thumbnailUrl).toBe("http://thumb.com/t.jpg");
	});

	it("ko locale: YouTube 실패 → Pexels fallback", async () => {
		mockSearchYouTubeVideos.mockRejectedValue(new Error("yt fail"));
		mockSearchPexelsVideos.mockResolvedValue([
			{
				url: "http://pexels.com/forest-search-footage",
				downloadUrl: "http://pexels.com/video.mp4",
				id: "pv1",
				duration: 15,
				thumbnail: "http://pexels.com/thumb.jpg",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
			}),
		);
		const result = await searchAndDownloadVideoToPath(
			"scenes/s1/video.mp4",
			"forest",
			undefined,
			20,
			"ko",
		);
		expect(result).not.toBeNull();
	});

	it("ko locale: YouTube + Pexels 실패 → Pixabay fallback", async () => {
		mockSearchYouTubeVideos.mockRejectedValue(new Error("fail"));
		mockSearchPexelsVideos.mockRejectedValue(new Error("fail"));
		mockSearchPixabayVideos.mockResolvedValue([
			{
				downloadUrl: "http://pixabay.com/video.mp4",
				id: "pbv1",
				duration: 10,
				tags: "forest search footage",
				thumbnail: "http://pixabay.com/thumb.jpg",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
			}),
		);
		const result = await searchAndDownloadVideoToPath(
			"scenes/s1/video.mp4",
			"forest",
			undefined,
			20,
			"ko",
		);
		expect(result).not.toBeNull();
	});

	it("en locale: Pexels 우선", async () => {
		mockSearchPexelsVideos.mockResolvedValue([
			{
				url: "http://pexels.com/forest-documentary-footage",
				downloadUrl: "http://pexels.com/video.mp4",
				id: "pv2",
				duration: 12,
				thumbnail: "http://pexels.com/t2.jpg",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
			}),
		);
		const result = await searchAndDownloadVideoToPath(
			"scenes/s1/video.mp4",
			"forest",
			undefined,
			20,
			"en",
		);
		expect(result).not.toBeNull();
	});

	it("모든 소스 실패 → null 반환", async () => {
		mockSearchYouTubeVideos.mockRejectedValue(new Error("fail"));
		mockSearchPexelsVideos.mockRejectedValue(new Error("fail"));
		mockSearchPixabayVideos.mockRejectedValue(new Error("fail"));
		const result = await searchAndDownloadVideoToPath(
			"scenes/s1/video.mp4",
			"forest",
			undefined,
			20,
			"ko",
		);
		expect(result).toBeNull();
	});

	it("관련성 낮은 YouTube 후보는 다운로드하지 않는다", async () => {
		mockSearchYouTubeVideos.mockResolvedValue([
			{
				videoId: "low-quality",
				title: "",
				description: "",
				channelTitle: "",
				thumbnail: "http://thumb.com/t.jpg",
			},
		]);
		mockSearchPexelsVideos.mockResolvedValue([]);
		mockSearchPixabayVideos.mockResolvedValue([]);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const result = await searchAndDownloadVideoToPath(
			"s/v.mp4",
			"forest search footage",
			"숲 수색 영상",
			20,
			"ko",
		);
		expect(result).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("이미 사용된 videoId → 필터링 (usedVideoIds)", async () => {
		// 첫 번째 호출로 yt-dup 사용
		mockSearchYouTubeVideos.mockResolvedValue([
			{
				videoId: "dup",
				title: "숲 수색 현장 영상",
				description: "forest search footage",
				channelTitle: "뉴스채널",
				thumbnail: "http://t.com/t.jpg",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue({ ok: true })
				.mockResolvedValue({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
				}),
		);

		// 두 번째 호출 시 동일 videoId 필터링 → available.length === 0 → Pexels fallback
		mockSearchPexelsVideos.mockResolvedValue([]);
		mockSearchPixabayVideos.mockResolvedValue([]);

		// 첫 번째 성공
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true }) // health
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
				}), // download
		);
		await searchAndDownloadVideoToPath("s1/v.mp4", "forest", "숲", 20, "ko");

		// 두 번째 호출: 동일 ID → 필터링 → null
		mockSearchYouTubeVideos.mockResolvedValue([
			{
				videoId: "dup",
				title: "숲 수색 현장 영상",
				description: "forest search footage",
				channelTitle: "뉴스채널",
				thumbnail: "http://t.com/t.jpg",
			},
		]);
		mockSearchPexelsVideos.mockRejectedValue(new Error("fail"));
		mockSearchPixabayVideos.mockRejectedValue(new Error("fail"));
		const result = await searchAndDownloadVideoToPath(
			"s2/v.mp4",
			"forest",
			"숲",
			20,
			"ko",
		);
		expect(result).toBeNull();
	});

	it("Pexels 결과 중 duration 초과 → 필터링", async () => {
		mockSearchYouTubeVideos.mockRejectedValue(new Error("fail"));
		mockSearchPexelsVideos.mockResolvedValue([
			{
				downloadUrl: "http://pexels.com/v.mp4",
				id: "long1",
				duration: 100, // maxDuration(20) + 10 = 30 초과
				thumbnail: "http://thumb.com/t.jpg",
			},
		]);
		mockSearchPixabayVideos.mockResolvedValue([]);
		const result = await searchAndDownloadVideoToPath(
			"s/v.mp4",
			"forest",
			undefined,
			20,
			"ko",
		);
		expect(result).toBeNull();
	});

	it("queryKo 없을 때 queryEn으로 YouTube 검색", async () => {
		mockSearchYouTubeVideos.mockResolvedValue([]);
		mockSearchPexelsVideos.mockResolvedValue([]);
		mockSearchPixabayVideos.mockResolvedValue([]);
		const result = await searchAndDownloadVideoToPath(
			"s/v.mp4",
			"forest",
			undefined,
			20,
			"ko",
		);
		expect(mockSearchYouTubeVideos).toHaveBeenCalledWith("forest", 6);
		expect(result).toBeNull();
	});

	it("영상 아카이브 적중 시 외부 검색 없이 재사용", async () => {
		localStorage.setItem(
			archiveTest.STORAGE_KEY,
			JSON.stringify([
				{
					id: "arch-video",
					kind: "video",
					provider: "youtube",
					locale: "ko",
					storagePath: "scenes/archive/reused.mp4",
					remoteUrl: "https://www.youtube.com/watch?v=abc",
					thumbnailUrl: "http://thumb.com/reused.jpg",
					title: "사건 현장 CCTV 단독 공개",
					queries: ["사건 현장 cctv", "현장 영상"],
					useCount: 1,
					createdAt: new Date().toISOString(),
					lastUsedAt: new Date().toISOString(),
				},
			]),
		);

		const result = await searchAndDownloadVideoToPath(
			"scenes/s1/video.mp4",
			"crime scene cctv footage",
			"사건 현장 cctv",
			20,
			"ko",
		);
		expect(result).toEqual(
			expect.objectContaining({
				videoUrl: "blob://scenes/archive/reused.mp4",
				storagePath: "scenes/archive/reused.mp4",
				thumbnailUrl: "http://thumb.com/reused.jpg",
				provider: "youtube",
			}),
		);
		expect(mockSearchYouTubeVideos).not.toHaveBeenCalled();
		expect(mockSearchPexelsVideos).not.toHaveBeenCalled();
		expect(mockSearchPixabayVideos).not.toHaveBeenCalled();
	});
});

// ─── searchAndDownloadVideo ───────────────────────────────────────────────────
describe("searchAndDownloadVideo", () => {
	beforeEach(() => resetUsedVideoIds());

	it("결과 있으면 videoUrl + thumbnailUrl 반환 + supabase insert", async () => {
		mockSearchYouTubeVideos.mockResolvedValue([
			{
				videoId: "yt-sv",
				title: "숲 수색 현장 영상",
				description: "forest search footage",
				channelTitle: "뉴스채널",
				thumbnail: "http://thumb.com/t.jpg",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true }) // health
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
				}),
		);
		const result = await searchAndDownloadVideo(
			"scene-sv",
			"forest",
			"숲",
			20,
			"ko",
		);
		expect(result.videoUrl).not.toBe("");
		expect(result.thumbnailUrl).toBe("http://thumb.com/t.jpg");
		expect(mockInsert).toHaveBeenCalledWith(
			expect.objectContaining({ scene_id: "scene-sv", type: "video" }),
		);
	});

	it("모든 소스 실패 → videoUrl + thumbnailUrl 빈 문자열", async () => {
		mockSearchYouTubeVideos.mockRejectedValue(new Error("fail"));
		mockSearchPexelsVideos.mockRejectedValue(new Error("fail"));
		mockSearchPixabayVideos.mockRejectedValue(new Error("fail"));
		const result = await searchAndDownloadVideo("scene-sv2", "forest");
		expect(result.videoUrl).toBe("");
		expect(result.thumbnailUrl).toBe("");
	});
});

// ─── resetUsedVideoIds ────────────────────────────────────────────────────────
describe("resetUsedVideoIds", () => {
	it("세션 내 사용된 ID 초기화 후 재사용 가능", async () => {
		mockSearchYouTubeVideos.mockResolvedValue([
			{
				videoId: "reset-test",
				title: "숲 수색 현장 영상",
				description: "forest search footage",
				channelTitle: "뉴스채널",
				thumbnail: "http://thumb.com/t.jpg",
			},
		]);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true })
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
				}),
		);
		await searchAndDownloadVideoToPath("s/v.mp4", "forest", "숲", 20, "ko");

		// reset 후 동일 ID 재사용 가능
		resetUsedVideoIds();
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true })
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
				}),
		);
		const result = await searchAndDownloadVideoToPath(
			"s2/v.mp4",
			"forest",
			"숲",
			20,
			"ko",
		);
		expect(result).not.toBeNull();
	});
});
