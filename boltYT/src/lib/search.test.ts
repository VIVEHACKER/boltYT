/**
 * search.ts 단위 테스트
 *
 * 모든 함수가 proxy + fetch 의존 → vi.mock + vi.stubGlobal.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3456" }));

import {
	fetchArticleBody,
	searchNaverImages,
	searchNaverNews,
	searchPexelsImages,
	searchPexelsVideos,
	searchPixabayImages,
	searchPixabayVideos,
	searchWikimediaImages,
	searchYouTubeVideos,
} from "./search";

afterEach(() => vi.restoreAllMocks());

function okFetch(body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: () => Promise.resolve(body),
		}),
	);
}

function failFetch(status = 500) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: false,
			status,
			statusText: "Error",
			json: () => Promise.resolve({ error: "error" }),
		}),
	);
}

// ─── searchNaverNews ──────────────────────────────────────────────────────────
describe("searchNaverNews", () => {
	it("HTML 태그 제거 후 결과 반환", async () => {
		okFetch({
			items: [
				{
					title: "<b>충격</b> 사건",
					description: "설명&amp;내용",
					link: "https://n.com",
					pubDate: "2026-01-01",
					originallink: "https://orig.com",
				},
			],
		});
		const results = await searchNaverNews("테스트");
		expect(results[0].title).toBe("충격 사건");
		expect(results[0].description).toContain("설명");
	});

	it("items 없으면 빈 배열", async () => {
		okFetch({});
		expect(await searchNaverNews("테스트")).toEqual([]);
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchNaverNews("테스트")).rejects.toThrow("네이버 뉴스");
	});
});

// ─── searchNaverImages ────────────────────────────────────────────────────────
describe("searchNaverImages", () => {
	it("800x600 이상만 통과", async () => {
		okFetch({
			items: [
				{
					title: "img1",
					link: "u1",
					thumbnail: "t1",
					sizewidth: "1024",
					sizeheight: "768",
				},
				{
					title: "img2",
					link: "u2",
					thumbnail: "t2",
					sizewidth: "400",
					sizeheight: "300",
				}, // 필터
				{
					title: "img3",
					link: "u3",
					thumbnail: "t3",
					sizewidth: "1280",
					sizeheight: "960",
				},
			],
		});
		const results = await searchNaverImages("테스트", 10);
		expect(results).toHaveLength(2);
		expect(results[0].title).toBe("img1");
	});

	it("크기 정보 없으면 통과 (네이버 API 누락 케이스)", async () => {
		okFetch({
			items: [
				{
					title: "img",
					link: "u",
					thumbnail: "t",
					sizewidth: "0",
					sizeheight: "0",
				},
			],
		});
		expect(await searchNaverImages("테스트")).toHaveLength(1);
	});

	it("count 제한 적용", async () => {
		const items = Array(10).fill({
			title: "i",
			link: "u",
			thumbnail: "t",
			sizewidth: "1024",
			sizeheight: "768",
		});
		okFetch({ items });
		expect(await searchNaverImages("테스트", 3)).toHaveLength(3);
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchNaverImages("테스트")).rejects.toThrow("네이버 이미지");
	});
});

// ─── fetchArticleBody ─────────────────────────────────────────────────────────
describe("fetchArticleBody", () => {
	it("성공 → 본문 반환", async () => {
		okFetch({
			title: "제목",
			body: "본문",
			publisher: "언론사",
			thumbnail: "https://img.example.com/hero.jpg",
			images: ["https://img.example.com/hero.jpg"],
		});
		const r = await fetchArticleBody("https://example.com/article");
		expect(r.body).toBe("본문");
		expect(r.thumbnail).toBe("https://img.example.com/hero.jpg");
	});

	it("HTTP 오류 → hostname 추출 + 빈 본문", async () => {
		failFetch(403);
		const r = await fetchArticleBody("https://news.naver.com/article/123");
		expect(r.body).toBe("");
		expect(r.publisher).toBe("news.naver.com");
		expect(r.images).toEqual([]);
	});

	it("잘못된 URL + HTTP 오류 → publisher 빈 문자열", async () => {
		failFetch(500);
		const r = await fetchArticleBody("not-a-url");
		expect(r.publisher).toBe("");
	});

	it("네트워크 오류 → 빈 결과 반환 (throw 없음)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network error")),
		);
		const r = await fetchArticleBody("https://example.com");
		expect(r).toEqual({
			title: "",
			body: "",
			publisher: "",
			thumbnail: "",
			images: [],
		});
	});
});

// ─── searchYouTubeVideos ──────────────────────────────────────────────────────
describe("searchYouTubeVideos", () => {
	it("maxres 썸네일 우선 선택", async () => {
		okFetch({
			items: [
				{
					id: { videoId: "abc" },
					snippet: {
						title: "영상",
						thumbnails: {
							medium: { url: "med.jpg" },
							high: { url: "high.jpg" },
							maxres: { url: "maxres.jpg" },
						},
						channelTitle: "채널",
						description: "설명",
					},
				},
			],
		});
		const results = await searchYouTubeVideos("테스트");
		expect(results[0].thumbnail).toBe("maxres.jpg");
		expect(results[0].videoId).toBe("abc");
	});

	it("maxres 없으면 high 사용", async () => {
		okFetch({
			items: [
				{
					id: { videoId: "xyz" },
					snippet: {
						title: "영상",
						thumbnails: { high: { url: "high.jpg" } },
						channelTitle: "채널",
						description: "",
					},
				},
			],
		});
		expect((await searchYouTubeVideos("q"))[0].thumbnail).toBe("high.jpg");
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchYouTubeVideos("테스트")).rejects.toThrow("YouTube");
	});
});

// ─── searchPexelsVideos ───────────────────────────────────────────────────────
describe("searchPexelsVideos", () => {
	it("longSide 1280 이상 파일만 선택", async () => {
		okFetch({
			videos: [
				{
					id: 1,
					url: "https://pexels.com/v1",
					image: "thumb.jpg",
					duration: 10,
					video_files: [
						{ quality: "hd", width: 1920, height: 1080, link: "hd.mp4" },
						{ quality: "sd", width: 640, height: 360, link: "sd.mp4" }, // 제외
					],
				},
			],
		});
		const results = await searchPexelsVideos("테스트");
		expect(results[0].downloadUrl).toBe("hd.mp4");
		expect(results[0].width).toBe(1920);
	});

	it("1280 미만 파일만 있으면 제외", async () => {
		okFetch({
			videos: [
				{
					id: 2,
					url: "u",
					image: "",
					duration: 5,
					video_files: [
						{ quality: "sd", width: 640, height: 360, link: "sd.mp4" },
					],
				},
			],
		});
		expect(await searchPexelsVideos("테스트")).toHaveLength(0);
	});

	it("포트레이트 영상 (720×1280) → 허용 (longSide=1280)", async () => {
		okFetch({
			videos: [
				{
					id: 3,
					url: "u",
					image: "",
					duration: 10,
					video_files: [
						{ quality: "hd", width: 720, height: 1280, link: "v.mp4" },
					],
				},
			],
		});
		expect(await searchPexelsVideos("테스트")).toHaveLength(1);
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchPexelsVideos("테스트")).rejects.toThrow("Pexels 영상");
	});

	it("video_files 없으면 해당 동영상 제외 (null 필터링)", async () => {
		okFetch({
			videos: [
				{
					id: 10,
					url: "u",
					image: "",
					duration: 5,
					// video_files 없음
				},
			],
		});
		expect(await searchPexelsVideos("테스트")).toHaveLength(0);
	});

	it("복수 고화질 파일 → longSide 내림차순 정렬 후 최고 해상도 선택", async () => {
		okFetch({
			videos: [
				{
					id: 20,
					url: "https://pexels.com/v20",
					image: "t.jpg",
					duration: 8,
					video_files: [
						{ quality: "hd", width: 1280, height: 720, link: "hd.mp4" },
						{ quality: "4k", width: 3840, height: 2160, link: "4k.mp4" },
						{ quality: "fhd", width: 1920, height: 1080, link: "fhd.mp4" },
					],
				},
			],
		});
		const results = await searchPexelsVideos("테스트");
		expect(results[0].downloadUrl).toBe("4k.mp4");
		expect(results[0].width).toBe(3840);
	});
});

// ─── searchPexelsImages ───────────────────────────────────────────────────────
describe("searchPexelsImages", () => {
	it("width 1280 이상만 반환", async () => {
		okFetch({
			photos: [
				{
					id: 1,
					url: "u1",
					src: { large2x: "l2x.jpg", large: "l.jpg", medium: "m.jpg" },
					width: 2000,
					height: 1333,
					photographer: "Alice",
				},
				{
					id: 2,
					url: "u2",
					src: { large2x: "l2.jpg", large: "l2l.jpg", medium: "m2.jpg" },
					width: 800,
					height: 600,
					photographer: "Bob",
				},
			],
		});
		const results = await searchPexelsImages("테스트");
		expect(results).toHaveLength(1);
		expect(results[0].downloadUrl).toBe("l2x.jpg");
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchPexelsImages("테스트")).rejects.toThrow("Pexels 이미지");
	});
});

// ─── searchPixabayImages ─────────────────────────────────────────────────────
describe("searchPixabayImages", () => {
	it("긴 변 1280 이상만 통과", async () => {
		okFetch({
			hits: [
				{
					id: 1,
					pageURL: "https://pixabay.com/p/1",
					largeImageURL: "https://img/large.jpg",
					webformatURL: "https://img/web.jpg",
					imageWidth: 1920,
					imageHeight: 1080,
					tags: "crime, scene",
					user: "pixuser",
				},
				{
					id: 2,
					pageURL: "https://pixabay.com/p/2",
					largeImageURL: "https://img/small.jpg",
					webformatURL: "https://img/small-web.jpg",
					imageWidth: 640,
					imageHeight: 360,
					tags: "small",
					user: "smalluser",
				},
			],
		});
		const results = await searchPixabayImages("crime scene");
		expect(results).toHaveLength(1);
		expect(results[0].downloadUrl).toBe("https://img/large.jpg");
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchPixabayImages("테스트")).rejects.toThrow(
			"Pixabay 이미지",
		);
	});
});

// ─── searchWikimediaImages ───────────────────────────────────────────────────
describe("searchWikimediaImages", () => {
	it("MediaWiki imageinfo를 다운로드 가능한 이미지 후보로 변환한다", async () => {
		okFetch({
			query: {
				pages: {
					"1": {
						pageid: 1,
						title: "File:Amelia Earhart portrait.jpg",
						imageinfo: [
							{
								url: "https://upload.wikimedia.org/full.jpg",
								thumburl: "https://upload.wikimedia.org/thumb.jpg",
								width: 1600,
								height: 2200,
								mime: "image/jpeg",
								descriptionshorturl:
									"https://commons.wikimedia.org/wiki/File:Amelia",
								extmetadata: {
									LicenseShortName: { value: "Public domain" },
									Artist: { value: "<span>Unknown</span>" },
								},
							},
						],
					},
				},
			},
		});

		const results = await searchWikimediaImages("Amelia Earhart", 2);
		expect(results).toHaveLength(1);
		expect(results[0]).toEqual(
			expect.objectContaining({
				title: "Amelia Earhart portrait.jpg",
				downloadUrl: "https://upload.wikimedia.org/thumb.jpg",
				license: "Public domain",
				artist: "Unknown",
			}),
		);
	});

	it("이미지가 아니거나 해상도가 낮은 결과는 제외한다", async () => {
		okFetch({
			query: {
				pages: {
					"1": {
						pageid: 1,
						title: "File:Small.jpg",
						imageinfo: [
							{
								url: "https://upload.wikimedia.org/small.jpg",
								width: 500,
								height: 400,
								mime: "image/jpeg",
							},
						],
					},
					"2": {
						pageid: 2,
						title: "File:Audio.ogg",
						imageinfo: [
							{
								url: "https://upload.wikimedia.org/audio.ogg",
								width: 1600,
								height: 1200,
								mime: "audio/ogg",
							},
						],
					},
				},
			},
		});

		expect(await searchWikimediaImages("test")).toHaveLength(0);
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchWikimediaImages("테스트")).rejects.toThrow(
			"Wikimedia 이미지",
		);
	});
});

// ─── searchPixabayVideos ──────────────────────────────────────────────────────
describe("searchPixabayVideos", () => {
	it("large 우선 선택", async () => {
		okFetch({
			hits: [
				{
					id: 1,
					pageURL: "https://pixabay.com/v1",
					picture_id: "12345",
					duration: 15,
					tags: "nature",
					videos: {
						large: { url: "large.mp4" },
						medium: { url: "medium.mp4" },
					},
				},
			],
		});
		const results = await searchPixabayVideos("테스트");
		expect(results[0].downloadUrl).toBe("large.mp4");
	});

	it("large 없으면 medium 사용", async () => {
		okFetch({
			hits: [
				{
					id: 2,
					pageURL: "u",
					picture_id: "99",
					duration: 10,
					tags: "sky",
					videos: { medium: { url: "medium.mp4" } },
				},
			],
		});
		expect((await searchPixabayVideos("테스트"))[0].downloadUrl).toBe(
			"medium.mp4",
		);
	});

	it("large·medium 없으면 제외", async () => {
		okFetch({
			hits: [
				{
					id: 3,
					pageURL: "u",
					picture_id: "1",
					duration: 5,
					tags: "",
					videos: { small: { url: "small.mp4" } },
				},
			],
		});
		expect(await searchPixabayVideos("테스트")).toHaveLength(0);
	});

	it("HTTP 오류 → throw", async () => {
		failFetch(500);
		await expect(searchPixabayVideos("테스트")).rejects.toThrow("Pixabay");
	});
});
