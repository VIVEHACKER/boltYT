/**
 * 외부 이미지/영상 다운로드 → IndexedDB 저장
 * CORS 우회: 설정된 프록시 사용 또는 로컬 비디오 프록시
 */

import { storeLocalFile } from "./local-db";
import {
	searchNaverImages,
	searchPexelsImages,
	searchPexelsVideos,
	searchPixabayVideos,
	searchYouTubeVideos,
} from "./search";
import { supabase } from "./supabase";

function getVideoProxyUrl(): string {
	return localStorage.getItem("video_proxy_url") || "http://localhost:3456";
}

/** 외부 이미지를 다운로드하여 IndexedDB에 저장 */
export async function downloadImageToPath(
	storagePath: string,
	imageUrl: string,
): Promise<{ url: string; storagePath: string }> {
	const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);

	const ct = res.headers.get("content-type") ?? "";
	if (!ct.startsWith("image/")) throw new Error(`이미지가 아님: ${ct}`);

	const buffer = await res.arrayBuffer();
	const ext = imageUrl.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1] ?? "jpg";
	const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
	const normalizedPath = storagePath.replace(/\.[a-z0-9]+$/i, `.${ext}`);

	const url = await storeLocalFile(
		normalizedPath,
		new Uint8Array(buffer),
		contentType,
	);

	return { url, storagePath: normalizedPath };
}

/** 외부 이미지를 다운로드하여 IndexedDB에 저장 */
export async function downloadImageToLocal(
	sceneId: string,
	imageUrl: string,
): Promise<string> {
	const storagePath = `scenes/${sceneId}/source-image.jpg`;
	const { url, storagePath: finalPath } = await downloadImageToPath(
		storagePath,
		imageUrl,
	);

	await supabase.from("media_assets").insert({
		scene_id: sceneId,
		type: "image",
		storage_path: finalPath,
		status: "complete",
	});

	return url;
}

/** 로컬 비디오 프록시를 통해 YouTube 영상 다운로드 */
export async function downloadYouTubeVideoToPath(
	storagePath: string,
	youtubeUrl: string,
	maxDuration = 30,
): Promise<{ url: string; storagePath: string }> {
	const proxyBase = getVideoProxyUrl();

	// 프록시 헬스체크
	try {
		const health = await fetch(`${proxyBase}/health`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!health.ok) throw new Error();
	} catch {
		throw new Error(
			"비디오 프록시가 실행되고 있지 않습니다. 터미널에서 `npm run proxy`를 실행하세요.",
		);
	}

	const res = await fetch(
		`${proxyBase}/download?url=${encodeURIComponent(youtubeUrl)}&maxDuration=${maxDuration}`,
		{ signal: AbortSignal.timeout(120_000) },
	);

	if (!res.ok) {
		const msg = await res.text().catch(() => "");
		throw new Error(`영상 다운로드 실패: ${res.status} ${msg}`);
	}

	const buffer = await res.arrayBuffer();
	const normalizedPath = storagePath.replace(/\.[a-z0-9]+$/i, ".mp4");

	const url = await storeLocalFile(
		normalizedPath,
		new Uint8Array(buffer),
		"video/mp4",
	);

	return { url, storagePath: normalizedPath };
}

/** 로컬 비디오 프록시를 통해 YouTube 영상 다운로드 */
export async function downloadYouTubeVideo(
	sceneId: string,
	youtubeUrl: string,
	maxDuration = 30,
): Promise<string> {
	const { url, storagePath } = await downloadYouTubeVideoToPath(
		`scenes/${sceneId}/video.mp4`,
		youtubeUrl,
		maxDuration,
	);

	await supabase.from("media_assets").insert({
		scene_id: sceneId,
		type: "video",
		storage_path: storagePath,
		status: "complete",
	});

	return url;
}

/** 직접 다운로드 가능한 mp4/webm URL을 IndexedDB에 저장 */
export async function downloadVideoToPath(
	storagePath: string,
	videoUrl: string,
): Promise<{ url: string; storagePath: string }> {
	return downloadDirectVideo(storagePath, videoUrl);
}

/** 직접 다운로드 가능한 mp4/webm URL을 IndexedDB에 저장 */
export async function downloadVideoToLocal(
	sceneId: string,
	videoUrl: string,
): Promise<string> {
	const { url, storagePath } = await downloadDirectVideo(
		`scenes/${sceneId}/video.mp4`,
		videoUrl,
	);

	await supabase.from("media_assets").insert({
		scene_id: sceneId,
		type: "video",
		storage_path: storagePath,
		status: "complete",
	});

	return url;
}

/**
 * 이미지 자동 검색 → 다운로드
 * locale에 따라 소스 우선순위 변경:
 *   ko: 네이버 → Pexels → 빈 문자열
 *   en: Pexels → 네이버 → 빈 문자열
 */
export async function searchAndDownloadImage(
	sceneId: string,
	queryEn: string,
	queryKo?: string,
	locale: "ko" | "en" = "ko",
): Promise<string> {
	const storagePath = `scenes/${sceneId}/search-image.jpg`;
	const result = await searchAndDownloadImageToPath(
		storagePath,
		queryEn,
		queryKo,
		locale,
	);
	if (!result) return "";

	await supabase.from("media_assets").insert({
		scene_id: sceneId,
		type: "image",
		storage_path: result.storagePath,
		status: "complete",
	});
	return result.url;
}

export async function searchAndDownloadImageToPath(
	storagePath: string,
	queryEn: string,
	queryKo?: string,
	locale: "ko" | "en" = "ko",
): Promise<{ url: string; storagePath: string } | null> {
	const ko = queryKo || queryEn;

	async function tryPexels(): Promise<{ url: string; storagePath: string } | null> {
		const pexels = await searchPexelsImages(queryEn, 3);
		if (pexels.length > 0 && pexels[0].downloadUrl) {
			return await downloadImageToPath(storagePath, pexels[0].downloadUrl);
		}
		return null;
	}

	async function tryNaver(): Promise<{ url: string; storagePath: string } | null> {
		const results = await searchNaverImages(ko, 3);
		if (results.length === 0) return null;
		const sorted = [...results].sort(
			(a, b) =>
				Number(b.sizewidth) * Number(b.sizeheight) -
				Number(a.sizewidth) * Number(a.sizeheight),
		);
		return await downloadImageToPath(storagePath, sorted[0].link);
	}

	const pipeline =
		locale === "ko" ? [tryNaver, tryPexels] : [tryPexels, tryNaver];

	for (const trySource of pipeline) {
		try {
			const result = await trySource();
			if (result) return result;
		} catch {
			/* 해당 소스 미설정 → 다음 */
		}
	}
	return null;
}

/** YouTube 썸네일을 fallback 이미지로 다운로드 */
export async function downloadThumbnailToLocal(
	sceneId: string,
	thumbnailUrl: string,
): Promise<string> {
	try {
		const res = await fetch(thumbnailUrl);
		if (!res.ok) throw new Error(`썸네일 다운로드 실패: ${res.status}`);

		const buffer = await res.arrayBuffer();
		const storagePath = `scenes/${sceneId}/thumbnail.jpg`;

		const url = await storeLocalFile(
			storagePath,
			new Uint8Array(buffer),
			"image/jpeg",
		);

		await supabase.from("media_assets").insert({
			scene_id: sceneId,
			type: "image",
			storage_path: storagePath,
			status: "complete",
		});

		return url;
	} catch {
		return "";
	}
}

// 이미 사용된 videoId 추적 (세션 내 중복 방지)
const usedVideoIds = new Set<string>();

/** 세션 내 사용된 영상 ID 초기화 */
export function resetUsedVideoIds() {
	usedVideoIds.clear();
}

/**
 * 주제/나레이션 기반 영상 자동 검색 → 다운로드
 * locale에 따라 소스 우선순위 변경:
 *   ko: YouTube(한국어) → Pexels → Pixabay
 *   en: Pexels → Pixabay → YouTube
 */
export async function searchAndDownloadVideo(
	sceneId: string,
	queryEn: string,
	queryKo?: string,
	maxDuration = 20,
	locale: "ko" | "en" = "ko",
): Promise<{ videoUrl: string; thumbnailUrl: string }> {
	const result = await searchAndDownloadVideoToPath(
		`scenes/${sceneId}/video.mp4`,
		queryEn,
		queryKo,
		maxDuration,
		locale,
	);
	if (!result) return { videoUrl: "", thumbnailUrl: "" };

	await supabase.from("media_assets").insert({
		scene_id: sceneId,
		type: "video",
		storage_path: result.storagePath,
		status: "complete",
	});

	return { videoUrl: result.videoUrl, thumbnailUrl: result.thumbnailUrl };
}

export async function searchAndDownloadVideoToPath(
	storagePath: string,
	queryEn: string,
	queryKo?: string,
	maxDuration = 20,
	locale: "ko" | "en" = "ko",
): Promise<
	| { videoUrl: string; storagePath: string; thumbnailUrl: string }
	| null
> {
	const ko = queryKo || queryEn;
	type VResult =
		| { videoUrl: string; storagePath: string; thumbnailUrl: string }
		| null;

	async function tryPexels(): Promise<VResult> {
		const pexels = await searchPexelsVideos(queryEn, 5);
		const available = pexels.filter(
			(v) =>
				v.downloadUrl &&
				v.duration <= maxDuration + 10 &&
				!usedVideoIds.has(`pexels-${v.id}`),
		);
		if (available.length === 0) return null;
		const pick = available[0];
		usedVideoIds.add(`pexels-${pick.id}`);
		const downloaded = await downloadDirectVideo(storagePath, pick.downloadUrl);
		return {
			videoUrl: downloaded.url,
			storagePath: downloaded.storagePath,
			thumbnailUrl: pick.thumbnail,
		};
	}

	async function tryPixabay(): Promise<VResult> {
		const pixabay = await searchPixabayVideos(queryEn, 5);
		const available = pixabay.filter(
			(v) =>
				v.downloadUrl &&
				v.duration <= maxDuration + 10 &&
				!usedVideoIds.has(`pixabay-${v.id}`),
		);
		if (available.length === 0) return null;
		const pick = available[0];
		usedVideoIds.add(`pixabay-${pick.id}`);
		const downloaded = await downloadDirectVideo(storagePath, pick.downloadUrl);
		return {
			videoUrl: downloaded.url,
			storagePath: downloaded.storagePath,
			thumbnailUrl: pick.thumbnail,
		};
	}

	async function tryYouTube(): Promise<VResult> {
		const results = await searchYouTubeVideos(ko, 5);
		const available = results.filter(
			(r) => !usedVideoIds.has(`yt-${r.videoId}`),
		);
		if (available.length === 0) return null;
		const pick = available[0];
		usedVideoIds.add(`yt-${pick.videoId}`);
		const youtubeUrl = `https://www.youtube.com/watch?v=${pick.videoId}`;
		const downloaded = await downloadYouTubeVideoToPath(
			storagePath,
			youtubeUrl,
			maxDuration,
		);
		return {
			videoUrl: downloaded.url,
			storagePath: downloaded.storagePath,
			thumbnailUrl: pick.thumbnail,
		};
	}

	const pipeline =
		locale === "ko"
			? [tryYouTube, tryPexels, tryPixabay]
			: [tryPexels, tryPixabay, tryYouTube];

	for (const trySource of pipeline) {
		try {
			const result = await trySource();
			if (result) return result;
		} catch {
			/* 해당 소스 미설정 → 다음 */
		}
	}

	return null;
}

/** Pexels/Pixabay 등 직접 다운로드 가능한 영상 URL → IndexedDB */
async function downloadDirectVideo(
	storagePath: string,
	videoUrl: string,
): Promise<{ url: string; storagePath: string }> {
	const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok) throw new Error(`영상 다운로드 실패: ${res.status}`);

	const buffer = await res.arrayBuffer();
	const normalizedPath = storagePath.replace(/\.[a-z0-9]+$/i, ".mp4");

	const url = await storeLocalFile(
		normalizedPath,
		new Uint8Array(buffer),
		"video/mp4",
	);

	return { url, storagePath: normalizedPath };
}
