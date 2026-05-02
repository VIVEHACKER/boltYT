import { describe, expect, it } from "vitest";
import {
	buildMediaSearchVariants,
	buildSearchVariants,
	compactSearchQuery,
	isAcceptableImageCandidate,
	isAcceptableVideoCandidate,
	rankImageCandidates,
	rankVideoCandidates,
} from "./media-search-quality";

describe("media-search-quality", () => {
	it("검색어 variant는 날짜를 제거하고 압축형을 만든다", () => {
		const variants = buildSearchVariants(
			"1991-01-29 사건 현장 CCTV 공개 화면",
			"crime scene CCTV footage at night",
		);

		expect(variants[0]).toContain("1991-01-29");
		expect(variants.some((variant) => !variant.includes("1991-01-29"))).toBe(
			true,
		);
		expect(compactSearchQuery("crime scene footage at night")).toBe(
			"crime night",
		);
	});

	it("영상 검색 variant는 장면 단서에 맞는 대체 표현을 늘린다", () => {
		const variants = buildMediaSearchVariants(
			"사건 현장 CCTV 공개",
			"crime scene cctv footage",
			{ media: "video", locale: "en", maxVariants: 8 },
		);

		expect(variants).toContain("crime scene cctv footage");
		expect(variants.some((variant) => variant.includes("cctv footage"))).toBe(
			true,
		);
		expect(
			variants.some((variant) => variant.includes("documentary footage")),
		).toBe(true);
	});

	it("이미지 검색 variant는 증거/인물 단서에 맞는 확장 표현을 만든다", () => {
		const variants = buildMediaSearchVariants(
			"목격자 진술과 증거 문건",
			"witness statement evidence document",
			{ media: "image", locale: "ko", maxVariants: 8 },
		);

		expect(variants.some((variant) => variant.includes("증거 자료 사진"))).toBe(
			true,
		);
		expect(variants.some((variant) => variant.includes("인물 사진"))).toBe(
			true,
		);
	});

	it("이미지 랭킹은 로고/일러스트보다 실제 고해상도 이미지를 우선한다", () => {
		const ranked = rankImageCandidates(
			[
				{
					provider: "naver",
					item: {
						title: "사건 로고 일러스트 포스터",
						link: "http://bad.example/logo.jpg",
						thumbnail: "",
						sizewidth: "2400",
						sizeheight: "2400",
					},
				},
				{
					provider: "naver",
					item: {
						title: "사건 현장 CCTV 공개 사진",
						link: "http://good.example/photo.jpg",
						thumbnail: "",
						sizewidth: "1800",
						sizeheight: "2600",
					},
				},
			],
			["사건 현장 cctv"],
			"ko",
		);

		expect(ranked[0]?.downloadUrl).toBe("http://good.example/photo.jpg");
	});

	it("Wikimedia 후보는 고유명사 주제에서 일반 스톡 이미지보다 우선된다", () => {
		const ranked = rankImageCandidates(
			[
				{
					provider: "pexels",
					item: {
						id: 1,
						url: "https://pexels.example/generic-person",
						downloadUrl: "https://pexels.example/generic.jpg",
						thumbnail: "",
						width: 1920,
						height: 1080,
						photographer: "studio portrait",
					},
				},
				{
					provider: "wikimedia",
					item: {
						id: 2,
						title: "Amelia Earhart standing by Lockheed Electra aircraft",
						pageUrl: "https://commons.wikimedia.org/wiki/File:Amelia.jpg",
						downloadUrl: "https://upload.wikimedia.org/amelia.jpg",
						thumbnail: "",
						width: 1400,
						height: 1900,
						mime: "image/jpeg",
						license: "Public domain",
						artist: "Unknown",
					},
				},
			],
			["Amelia Earhart disappearance", "아멜리아 에어하트 실종"],
			"en",
		);

		expect(ranked[0]?.provider).toBe("wikimedia");
		expect(isAcceptableImageCandidate(ranked[0])).toBe(true);
	});

	it("영상 랭킹은 반응형/게임 영상보다 실제 풋티지를 우선한다", () => {
		const ranked = rankVideoCandidates(
			[
				{
					provider: "youtube",
					item: {
						videoId: "bad",
						title: "사건 리액션 방송 다시보기",
						thumbnail: "http://yt/bad.jpg",
						channelTitle: "리액션 채널",
						description: "reaction stream",
					},
				},
				{
					provider: "youtube",
					item: {
						videoId: "good",
						title: "사건 현장 CCTV 단독 공개",
						thumbnail: "http://yt/good.jpg",
						channelTitle: "뉴스채널",
						description: "exclusive cctv footage",
					},
				},
			],
			["사건 현장 cctv"],
			18,
			"ko",
		);

		expect(ranked[0]?.videoId).toBe("good");
	});

	it("영상 랭킹은 세로형 고해상도 Pexels를 더 높게 평가한다", () => {
		const ranked = rankVideoCandidates(
			[
				{
					provider: "pexels",
					item: {
						id: 1,
						url: "http://pexels.example/mountain-landscape",
						downloadUrl: "http://pexels.example/1.mp4",
						thumbnail: "http://pexels.example/1.jpg",
						duration: 10,
						width: 1920,
						height: 1080,
					},
				},
				{
					provider: "pexels",
					item: {
						id: 2,
						url: "http://pexels.example/night-city-chase-footage",
						downloadUrl: "http://pexels.example/2.mp4",
						thumbnail: "http://pexels.example/2.jpg",
						duration: 11,
						width: 1080,
						height: 1920,
					},
				},
			],
			["night city chase footage"],
			16,
			"en",
		);

		expect(ranked[0]?.id).toBe("pexels-2");
	});

	it("해상도만 높은 무관 스톡 후보는 품질 게이트에서 거른다", () => {
		const rankedImages = rankImageCandidates(
			[
				{
					provider: "pexels",
					item: {
						id: 1,
						url: "https://pexels.example/beach-sunset",
						downloadUrl: "https://pexels.example/beach.jpg",
						thumbnail: "",
						width: 1440,
						height: 2560,
						photographer: "studio",
					},
				},
			],
			["specific court evidence document"],
			"en",
		);
		expect(isAcceptableImageCandidate(rankedImages[0])).toBe(false);

		const rankedVideos = rankVideoCandidates(
			[
				{
					provider: "pexels",
					item: {
						id: 2,
						url: "https://pexels.example/ocean-waves",
						downloadUrl: "https://pexels.example/ocean.mp4",
						thumbnail: "",
						width: 1080,
						height: 1920,
						duration: 10,
					},
				},
			],
			["specific court evidence footage"],
			12,
			"en",
		);
		expect(isAcceptableVideoCandidate(rankedVideos[0])).toBe(false);
	});

	it("품질 게이트는 관련성 낮은 후보를 거른다", () => {
		expect(isAcceptableVideoCandidate({ score: 12 })).toBe(false);
		expect(isAcceptableVideoCandidate({ score: 44 })).toBe(true);
		expect(isAcceptableImageCandidate({ score: 10 })).toBe(false);
		expect(isAcceptableImageCandidate({ score: 30 })).toBe(true);
	});
});
