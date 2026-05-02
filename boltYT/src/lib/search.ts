/** 네이버 검색 API + YouTube 검색 — 프록시 서버 경유 */

import { getApiProxyUrl } from "./proxy";

export interface NewsResult {
	title: string;
	description: string;
	link: string;
	pubDate: string;
	originallink: string;
}

export interface ImageResult {
	title: string;
	link: string;
	thumbnail: string;
	sizeheight: string;
	sizewidth: string;
}

export interface VideoResult {
	title: string;
	videoId: string;
	thumbnail: string;
	channelTitle: string;
	description: string;
}

export interface PexelsVideoResult {
	id: number;
	url: string;
	downloadUrl: string;
	thumbnail: string;
	duration: number;
	width: number;
	height: number;
}

export interface PexelsImageResult {
	id: number;
	url: string;
	downloadUrl: string;
	thumbnail: string;
	width: number;
	height: number;
	photographer: string;
}

export interface PixabayImageResult {
	id: number;
	pageUrl: string;
	downloadUrl: string;
	thumbnail: string;
	width: number;
	height: number;
	tags: string;
	user: string;
}

export interface WikimediaImageResult {
	id: number;
	title: string;
	pageUrl: string;
	downloadUrl: string;
	thumbnail: string;
	width: number;
	height: number;
	mime: string;
	license: string;
	artist: string;
}

export interface PixabayVideoResult {
	id: number;
	pageUrl: string;
	downloadUrl: string;
	thumbnail: string;
	duration: number;
	tags: string;
}

// ─── Raw API response types ───

interface NaverApiResponse {
	items: Array<{
		title: string;
		description: string;
		link: string;
		pubDate: string;
		originallink: string;
		thumbnail: string;
		sizeheight: string;
		sizewidth: string;
	}>;
}

interface YouTubeApiResponse {
	items: Array<{
		id: { videoId: string };
		snippet: {
			title: string;
			thumbnails: {
				medium?: { url: string };
				high?: { url: string };
				maxres?: { url: string };
			};
			channelTitle: string;
			description: string;
		};
	}>;
}

interface PexelsVideoFile {
	quality: string;
	width: number;
	height: number;
	link: string;
}

interface PexelsVideoApiResponse {
	videos: Array<{
		id: number;
		url: string;
		image: string;
		duration: number;
		video_files: PexelsVideoFile[];
	}>;
}

interface PexelsImageApiResponse {
	photos: Array<{
		id: number;
		url: string;
		src: { large2x: string; large: string; medium: string };
		width: number;
		height: number;
		photographer: string;
	}>;
}

interface PixabayVideoApiResponse {
	hits: Array<{
		id: number;
		pageURL: string;
		picture_id: string;
		duration: number;
		tags: string;
		videos: {
			large?: { url: string };
			medium?: { url: string };
			small?: { url: string };
		};
	}>;
}

interface PixabayImageApiResponse {
	hits: Array<{
		id: number;
		pageURL: string;
		largeImageURL: string;
		webformatURL: string;
		imageWidth: number;
		imageHeight: number;
		tags: string;
		user: string;
	}>;
}

interface WikimediaImageInfo {
	url?: string;
	thumburl?: string;
	width?: number;
	height?: number;
	mime?: string;
	descriptionshorturl?: string;
	extmetadata?: {
		LicenseShortName?: { value?: string };
		Artist?: { value?: string };
	};
}

interface WikimediaImageApiResponse {
	query?: {
		pages?: Record<
			string,
			{
				pageid: number;
				title: string;
				imageinfo?: WikimediaImageInfo[];
			}
		>;
	};
}

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&[^;]+;/g, " ")
		.trim();
}

/** 네이버 뉴스 검색 (프록시 경유) */
export async function searchNaverNews(
	query: string,
	count = 10,
	sort: "sim" | "date" = "date",
): Promise<NewsResult[]> {
	const proxy = getApiProxyUrl();
	const res = await fetch(
		`${proxy}/api/naver/news?query=${encodeURIComponent(query)}&display=${count}&sort=${sort}`,
	);

	if (!res.ok) throw new Error(`네이버 뉴스 검색 실패: ${res.status}`);
	const data: NaverApiResponse = await res.json();
	return (data.items ?? []).map((item) => ({
		...item,
		title: stripHtml(item.title),
		description: stripHtml(item.description),
	}));
}

/** 네이버 이미지 검색 (프록시 경유) — 최소 800x600 해상도 필터 */
export async function searchNaverImages(
	query: string,
	count = 12,
): Promise<ImageResult[]> {
	const proxy = getApiProxyUrl();
	// 해상도 필터링 대비해 초과 요청 (일부 저해상도 제외됨)
	const overFetch = Math.ceil(count * 1.8);
	const res = await fetch(
		`${proxy}/api/naver/images?query=${encodeURIComponent(query)}&display=${overFetch}&sort=sim`,
	);

	if (!res.ok) throw new Error(`네이버 이미지 검색 실패: ${res.status}`);
	const data: NaverApiResponse = await res.json();
	const MIN_W = 800;
	const MIN_H = 600;
	return (data.items ?? [])
		.map((item) => ({
			...item,
			title: stripHtml(item.title),
		}))
		.filter((item) => {
			const w = Number(item.sizewidth) || 0;
			const h = Number(item.sizeheight) || 0;
			// 크기 정보가 없으면 통과(네이버 API가 가끔 누락), 있으면 하한 강제
			return w === 0 || h === 0 || (w >= MIN_W && h >= MIN_H);
		})
		.slice(0, count);
}

export interface ArticleBody {
	title: string;
	body: string;
	publisher: string;
	thumbnail?: string;
	images?: string[];
}

/**
 * 원문 URL에서 본문 텍스트 추출 (프록시 경유, 서버 스크래핑)
 * — 실패 시 빈 본문 반환 (snippet fallback용)
 */
export async function fetchArticleBody(
	articleUrl: string,
): Promise<ArticleBody> {
	const proxy = getApiProxyUrl();
	try {
		const res = await fetch(
			`${proxy}/api/fetch-article?url=${encodeURIComponent(articleUrl)}`,
			{ signal: AbortSignal.timeout(20_000) },
		);
		if (!res.ok) {
			const host = (() => {
				try {
					return new URL(articleUrl).hostname.replace(/^www\./, "");
				} catch {
					return "";
				}
			})();
			return { title: "", body: "", publisher: host, thumbnail: "", images: [] };
		}
		return (await res.json()) as ArticleBody;
	} catch {
		return { title: "", body: "", publisher: "", thumbnail: "", images: [] };
	}
}

/** YouTube 영상 검색 (프록시 경유) */
export async function searchYouTubeVideos(
	query: string,
	count = 8,
): Promise<VideoResult[]> {
	const proxy = getApiProxyUrl();
	const res = await fetch(
		`${proxy}/api/youtube/search?q=${encodeURIComponent(query)}&maxResults=${count}`,
	);

	if (!res.ok) throw new Error(`YouTube 검색 실패: ${res.status}`);
	const data: YouTubeApiResponse = await res.json();
	return (data.items ?? []).map((item) => ({
		title: item.snippet.title,
		videoId: item.id.videoId,
		thumbnail:
			item.snippet.thumbnails.maxres?.url ??
			item.snippet.thumbnails.high?.url ??
			item.snippet.thumbnails.medium?.url ??
			"",
		channelTitle: item.snippet.channelTitle,
		description: item.snippet.description,
	}));
}

/** Pexels 영상 검색 (프록시 경유) — 최소 Full HD (1920x1080) 우선 */
export async function searchPexelsVideos(
	query: string,
	count = 8,
): Promise<PexelsVideoResult[]> {
	const proxy = getApiProxyUrl();
	// size=large → 4K/Full HD 우선 응답
	const res = await fetch(
		`${proxy}/api/pexels/videos?query=${encodeURIComponent(query)}&per_page=${count * 2}&size=large`,
	);
	if (!res.ok) throw new Error(`Pexels 영상 검색 실패: ${res.status}`);
	const data: PexelsVideoApiResponse = await res.json();

	// 가로/세로 중 긴 변 기준. 720×1280 / 1080×1920 같은 9:16 포트레이트도 허용
	// (Codex P2 — Shorts/Reels 워크플로에서 가장 좋은 9:16 풋티지가 포트레이트).
	const MIN_LONG = 1280;
	const longSide = (f: { width: number; height: number }) =>
		Math.max(f.width, f.height);

	return (data.videos ?? [])
		.map((v) => {
			// 4K > Full HD > HD 순으로 선호, 720p 미만 제외
			const candidates = (v.video_files ?? [])
				.filter((f) => longSide(f) >= MIN_LONG)
				.sort((a, b) => longSide(b) - longSide(a));
			const file = candidates[0];
			if (!file) return null;
			return {
				id: v.id,
				url: v.url,
				downloadUrl: file.link,
				thumbnail: v.image ?? "",
				duration: v.duration ?? 0,
				width: file.width,
				height: file.height,
			};
		})
		.filter((v): v is PexelsVideoResult => v !== null)
		.slice(0, count);
}

/** Pexels 이미지 검색 (프록시 경유) — 최소 1280px 너비 */
export async function searchPexelsImages(
	query: string,
	count = 8,
): Promise<PexelsImageResult[]> {
	const proxy = getApiProxyUrl();
	const res = await fetch(
		`${proxy}/api/pexels/images?query=${encodeURIComponent(query)}&per_page=${count * 2}`,
	);
	if (!res.ok) throw new Error(`Pexels 이미지 검색 실패: ${res.status}`);
	const data: PexelsImageApiResponse = await res.json();

	const MIN_W = 1280;

	return (data.photos ?? [])
		.filter((p) => (p.width ?? 0) >= MIN_W)
		.map((p) => ({
			id: p.id,
			url: p.url,
			downloadUrl: p.src?.large2x ?? p.src?.large ?? "",
			thumbnail: p.src?.medium ?? "",
			width: p.width ?? 0,
			height: p.height ?? 0,
			photographer: p.photographer ?? "",
		}))
		.slice(0, count);
}

/** Pixabay 이미지 검색 (프록시 경유) — 최소 1280px 긴 변 */
export async function searchPixabayImages(
	query: string,
	count = 8,
): Promise<PixabayImageResult[]> {
	const proxy = getApiProxyUrl();
	const res = await fetch(
		`${proxy}/api/pixabay/images?q=${encodeURIComponent(query)}&per_page=${count * 2}`,
	);
	if (!res.ok) throw new Error(`Pixabay 이미지 검색 실패: ${res.status}`);
	const data: PixabayImageApiResponse = await res.json();

	return (data.hits ?? [])
		.filter((hit) => Math.max(hit.imageWidth ?? 0, hit.imageHeight ?? 0) >= 1280)
		.map((hit) => ({
			id: hit.id,
			pageUrl: hit.pageURL ?? "",
			downloadUrl: hit.largeImageURL ?? hit.webformatURL ?? "",
			thumbnail: hit.webformatURL ?? "",
			width: hit.imageWidth ?? 0,
			height: hit.imageHeight ?? 0,
			tags: hit.tags ?? "",
			user: hit.user ?? "",
		}))
		.filter((hit) => Boolean(hit.downloadUrl))
		.slice(0, count);
}

/** Wikimedia Commons 이미지 검색 — 고유명사/장소/역사 주제 보정용 */
export async function searchWikimediaImages(
	query: string,
	count = 8,
): Promise<WikimediaImageResult[]> {
	const proxy = getApiProxyUrl();
	const res = await fetch(
		`${proxy}/api/wikimedia/images?query=${encodeURIComponent(query)}&limit=${count * 2}`,
	);
	if (!res.ok) throw new Error(`Wikimedia 이미지 검색 실패: ${res.status}`);
	const data: WikimediaImageApiResponse = await res.json();

	return Object.values(data.query?.pages ?? {})
		.map((page) => {
			const info = page.imageinfo?.[0];
			if (!info?.url && !info?.thumburl) return null;
			const mime = info.mime ?? "";
			if (mime && !mime.startsWith("image/")) return null;
			const downloadUrl = info.thumburl ?? info.url ?? "";
			return {
				id: page.pageid,
				title: page.title.replace(/^File:/, ""),
				pageUrl:
					info.descriptionshorturl ??
					`https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
				downloadUrl,
				thumbnail: info.thumburl ?? info.url ?? "",
				width: info.width ?? 0,
				height: info.height ?? 0,
				mime,
				license: stripHtml(info.extmetadata?.LicenseShortName?.value ?? ""),
				artist: stripHtml(info.extmetadata?.Artist?.value ?? ""),
			};
		})
		.filter((item): item is WikimediaImageResult => Boolean(item?.downloadUrl))
		.filter((item) => Math.max(item.width, item.height) >= 900)
		.slice(0, count);
}

/** Pixabay 영상 검색 (프록시 경유) — large (1920x1080) 또는 medium (1280x720)만 */
export async function searchPixabayVideos(
	query: string,
	count = 8,
): Promise<PixabayVideoResult[]> {
	const proxy = getApiProxyUrl();
	const res = await fetch(
		`${proxy}/api/pixabay/videos?q=${encodeURIComponent(query)}&per_page=${count * 2}`,
	);
	if (!res.ok) throw new Error(`Pixabay 영상 검색 실패: ${res.status}`);
	const data: PixabayVideoApiResponse = await res.json();

	return (data.hits ?? [])
		.map((h) => {
			// small(960x540)은 제외 — large 또는 medium만
			const vid = h.videos?.large ?? h.videos?.medium;
			if (!vid?.url) return null;
			return {
				id: h.id,
				pageUrl: h.pageURL ?? "",
				downloadUrl: vid.url,
				thumbnail: `https://i.vimeocdn.com/video/${h.picture_id}_640x360.jpg`,
				duration: h.duration ?? 0,
				tags: h.tags ?? "",
			};
		})
		.filter((v): v is PixabayVideoResult => v !== null)
		.slice(0, count);
}
