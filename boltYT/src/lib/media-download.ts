/**
 * 외부 이미지/영상 다운로드 → IndexedDB 저장
 * CORS 우회: 설정된 프록시 사용 또는 로컬 비디오 프록시
 */

import {
	findArchivedMediaByQueries,
	findArchivedMediaByRemoteUrl,
	markMediaArchiveEntryUsed,
	recordMediaArchiveEntry,
} from "./media-archive";
import {
	buildMediaSearchVariants,
	isAcceptableImageCandidate,
	isAcceptableVideoCandidate,
	MIN_IMAGE_CANDIDATE_SCORE,
	MIN_VIDEO_CANDIDATE_SCORE,
	rankImageCandidates,
	rankVideoCandidates,
} from "./media-search-quality";
import {
	assessVideoDynamics,
	isVideoDynamicsAcceptable,
	type VideoDynamicsReport,
} from "./video-dynamics";
import { ensureBlobUrls, storeLocalFile } from "./local-db";
import {
	searchNaverImages,
	searchPexelsImages,
	searchPexelsVideos,
	searchPixabayImages,
	searchPixabayVideos,
	searchWikimediaImages,
	searchYouTubeVideos,
} from "./search";
import { supabase } from "./supabase";

// 이미 사용된 videoId 추적 (세션 내 중복 방지)
const usedVideoIds = new Set<string>();

export interface MediaSearchOptions {
	rejectTerms?: string[];
	minScore?: number;
	minRelevance?: number;
	minDynamicScore?: number;
	allowLowMotionVideo?: boolean;
}

export interface DownloadedImageResult {
	url: string;
	storagePath: string;
	provider?: string;
	qualityScore?: number;
	sourceTitle?: string;
}

export interface DownloadedVideoResult {
	videoUrl: string;
	storagePath: string;
	thumbnailUrl: string;
	provider?: string;
	qualityScore?: number;
	dynamicScore?: number;
	dynamicIssues?: string[];
	sourceTitle?: string;
}

function getVideoProxyUrl(): string {
	return localStorage.getItem("video_proxy_url") || "http://localhost:3456";
}

function extractYouTubeVideoId(url: string): string {
	const matched =
		url.match(/[?&]v=([^&#]+)/)?.[1] ?? url.match(/youtu\.be\/([^?&#/]+)/)?.[1];
	return matched ?? "";
}

function normalizeClipSeconds(value: number, max: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.round(Math.max(0, Math.min(max, value)) * 100) / 100;
}

function buildYouTubeClipDescriptor(
	youtubeUrl: string,
	maxDuration: number,
	startSeconds = 0,
): {
	archiveKey?: string;
	duration: number;
	remoteUrl: string;
	start: number;
} {
	const start = normalizeClipSeconds(startSeconds, 7200);
	const duration = normalizeClipSeconds(maxDuration || 30, 300) || 30;
	const videoId = extractYouTubeVideoId(youtubeUrl);
	const archiveKey = videoId ? `yt-${videoId}:${start}-${duration}` : undefined;
	const separator = youtubeUrl.includes("#") ? "&" : "#";
	return {
		archiveKey,
		duration,
		remoteUrl: `${youtubeUrl}${separator}clip=${start}-${duration}`,
		start,
	};
}

function videoArchiveKeyWasUsed(archiveKey?: string): boolean {
	if (!archiveKey) return false;
	if (usedVideoIds.has(archiveKey)) return true;
	const baseKey = archiveKey.split(":")[0];
	return Boolean(baseKey && usedVideoIds.has(baseKey));
}

function markVideoArchiveKeyUsed(archiveKey?: string) {
	if (!archiveKey) return;
	usedVideoIds.add(archiveKey);
	const baseKey = archiveKey.split(":")[0];
	if (baseKey) usedVideoIds.add(baseKey);
}

async function resolveArchivedStoragePath(
	storagePath: string,
): Promise<string> {
	const blobMap = await ensureBlobUrls([storagePath]);
	return blobMap.get(storagePath) ?? "";
}

async function tryReuseArchivedRemote(
	kind: "image" | "video",
	remoteUrl: string,
): Promise<{ url: string; storagePath: string } | null> {
	const archived = findArchivedMediaByRemoteUrl(kind, remoteUrl);
	if (!archived) return null;
	const url = await resolveArchivedStoragePath(archived.storagePath);
	if (!url) return null;
	markMediaArchiveEntryUsed(archived.id);
	return { url, storagePath: archived.storagePath };
}

function archiveQualityIsAcceptable(
	entry: { qualityScore?: number },
	minScore: number,
): boolean {
	return (
		typeof entry.qualityScore !== "number" || entry.qualityScore >= minScore
	);
}

function archiveDynamicsIsAcceptable(
	entry: { dynamicScore?: number; dynamicIssues?: string[] },
	options: MediaSearchOptions,
): boolean {
	if (options.allowLowMotionVideo) return true;
	if (typeof entry.dynamicScore !== "number") return true;
	if (entry.dynamicScore < (options.minDynamicScore ?? 22)) return false;
	return !(entry.dynamicIssues ?? []).includes("low_motion_video");
}

function candidateText(candidate: {
	text?: string;
	title?: string;
	description?: string;
	channelTitle?: string;
	tags?: string;
}): string {
	return [
		candidate.text,
		candidate.title,
		candidate.description,
		candidate.channelTitle,
		candidate.tags,
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
}

function isRejectedByTerms(
	candidate: Parameters<typeof candidateText>[0],
	rejectTerms?: string[],
): boolean {
	if (!rejectTerms?.length) return false;
	const haystack = candidateText(candidate);
	return rejectTerms
		.map((term) => term.trim().toLowerCase())
		.filter(Boolean)
		.some((term) => haystack.includes(term));
}

async function validateDownloadedVideoDynamics(
	videoUrl: string,
	options: MediaSearchOptions,
): Promise<VideoDynamicsReport | null> {
	if (options.allowLowMotionVideo) return null;
	const report = await assessVideoDynamics(videoUrl, {
		minDynamicScore: options.minDynamicScore,
	});
	if (!report.available) return report;
	if (!isVideoDynamicsAcceptable(report, options.minDynamicScore ?? 22)) {
		throw new Error(
			`저동작 영상 후보 제외: dynamicScore=${report.score}, issues=${report.issues.join(",")}`,
		);
	}
	return report;
}

/** 외부 이미지를 다운로드하여 IndexedDB에 저장 */
export async function downloadImageToPath(
	storagePath: string,
	imageUrl: string,
): Promise<{ url: string; storagePath: string }> {
	const archived = await tryReuseArchivedRemote("image", imageUrl);
	if (archived) return archived;

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
	recordMediaArchiveEntry({
		kind: "image",
		provider: "direct",
		locale: "ko",
		storagePath: normalizedPath,
		remoteUrl: imageUrl,
		queries: [],
	});

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
	startSeconds = 0,
): Promise<{ url: string; storagePath: string }> {
	const clip = buildYouTubeClipDescriptor(youtubeUrl, maxDuration, startSeconds);
	const archived = await tryReuseArchivedRemote("video", clip.remoteUrl);
	if (archived) return archived;

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

	const params = new URLSearchParams({
		url: youtubeUrl,
		maxDuration: String(clip.duration),
		start: String(clip.start),
	});
	const res = await fetch(`${proxyBase}/download?${params.toString()}`, {
		signal: AbortSignal.timeout(120_000),
	});

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
	recordMediaArchiveEntry({
		kind: "video",
		provider: "youtube",
		locale: "ko",
		storagePath: normalizedPath,
		remoteUrl: clip.remoteUrl,
		queries: [],
		archiveKey: clip.archiveKey,
		duration: clip.duration,
	});

	return { url, storagePath: normalizedPath };
}

/** 로컬 비디오 프록시를 통해 YouTube 영상 다운로드 */
export async function downloadYouTubeVideo(
	sceneId: string,
	youtubeUrl: string,
	maxDuration = 30,
	startSeconds = 0,
): Promise<string> {
	const { url, storagePath } = await downloadYouTubeVideoToPath(
		`scenes/${sceneId}/video.mp4`,
		youtubeUrl,
		maxDuration,
		startSeconds,
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
	options: MediaSearchOptions = {},
): Promise<DownloadedImageResult | null> {
	const ko = queryKo || queryEn;
	const koQueries = buildMediaSearchVariants(ko, queryEn, {
		media: "image",
		locale: "ko",
		maxVariants: 5,
	});
	const enQueries = buildMediaSearchVariants(queryEn || ko, ko, {
		media: "image",
		locale: "en",
		maxVariants: 5,
	});
	const allQueries = [...new Set([...koQueries, ...enQueries])];
	const archived = findArchivedMediaByQueries({
		kind: "image",
		locale,
		queries: allQueries,
		limit: 3,
	}).filter((entry) =>
		archiveQualityIsAcceptable(
			entry,
			options.minScore ?? MIN_IMAGE_CANDIDATE_SCORE,
		) && !isRejectedByTerms({ text: entry.title }, options.rejectTerms),
	);
	for (const entry of archived) {
		const url = await resolveArchivedStoragePath(entry.storagePath);
		if (url) {
			markMediaArchiveEntryUsed(entry.id);
			return {
				url,
				storagePath: entry.storagePath,
				provider: entry.provider,
				qualityScore: entry.qualityScore,
				sourceTitle: entry.title,
			};
		}
	}
	const ranked = rankImageCandidates(
		[
			...(
				await Promise.allSettled(
					koQueries.map((query) => searchNaverImages(query, 5)),
				)
			).flatMap((result) =>
				result.status === "fulfilled" && Array.isArray(result.value)
					? result.value.map((item) => ({ provider: "naver" as const, item }))
					: [],
			),
			...(
				await Promise.allSettled(
					enQueries.map((query) => searchPexelsImages(query, 5)),
				)
			).flatMap((result) =>
				result.status === "fulfilled" && Array.isArray(result.value)
					? result.value.map((item) => ({ provider: "pexels" as const, item }))
					: [],
			),
			...(
				await Promise.allSettled(
					enQueries.map((query) => searchPixabayImages(query, 5)),
				)
			).flatMap((result) =>
				result.status === "fulfilled" && Array.isArray(result.value)
					? result.value.map((item) => ({ provider: "pixabay" as const, item }))
					: [],
			),
			...(
				await Promise.allSettled(
					allQueries.slice(0, 6).map((query) => searchWikimediaImages(query, 4)),
				)
			).flatMap((result) =>
				result.status === "fulfilled" && Array.isArray(result.value)
					? result.value.map((item) => ({
							provider: "wikimedia" as const,
							item,
						}))
					: [],
			),
		],
		allQueries,
		locale,
	).filter(
		(candidate) =>
			isAcceptableImageCandidate(
				candidate,
				options.minScore ?? MIN_IMAGE_CANDIDATE_SCORE,
				options.minRelevance,
			) && !isRejectedByTerms(candidate, options.rejectTerms),
	);

	for (const candidate of ranked) {
		try {
			const downloaded = await downloadImageToPath(
				storagePath,
				candidate.downloadUrl,
			);
			recordMediaArchiveEntry({
				kind: "image",
				provider: candidate.provider,
				locale,
				storagePath: downloaded.storagePath,
				remoteUrl: candidate.downloadUrl,
				title: candidate.text,
				queries: allQueries,
				qualityScore: candidate.score,
				width: candidate.width,
				height: candidate.height,
			});
			return {
				...downloaded,
				provider: candidate.provider,
				qualityScore: candidate.score,
				sourceTitle: candidate.text,
			};
		} catch {
			/* 다운로드 실패 시 다음 후보 */
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
	options: MediaSearchOptions = {},
): Promise<DownloadedVideoResult | null> {
	const ko = queryKo || queryEn;
	const koQueries = buildMediaSearchVariants(ko, queryEn, {
		media: "video",
		locale: "ko",
		maxVariants: 5,
	});
	const enQueries = buildMediaSearchVariants(queryEn || ko, ko, {
		media: "video",
		locale: "en",
		maxVariants: 5,
	});
	const allQueries = [...new Set([...koQueries, ...enQueries])];
	const archived = findArchivedMediaByQueries({
		kind: "video",
		locale,
		queries: allQueries,
		limit: 4,
	}).filter(
		(entry) =>
			!videoArchiveKeyWasUsed(entry.archiveKey) &&
			archiveQualityIsAcceptable(
				entry,
				options.minScore ?? MIN_VIDEO_CANDIDATE_SCORE,
			) &&
			archiveDynamicsIsAcceptable(entry, options) &&
			!isRejectedByTerms({ title: entry.title }, options.rejectTerms),
	);
	for (const entry of archived) {
		const url = await resolveArchivedStoragePath(entry.storagePath);
		if (url) {
			let dynamics: VideoDynamicsReport | null = null;
			try {
				dynamics = await validateDownloadedVideoDynamics(url, options);
			} catch {
				continue;
			}
			markMediaArchiveEntryUsed(entry.id);
			markVideoArchiveKeyUsed(entry.archiveKey);
			return {
				videoUrl: url,
				storagePath: entry.storagePath,
				thumbnailUrl: entry.thumbnailUrl ?? "",
				provider: entry.provider,
				qualityScore: entry.qualityScore,
				dynamicScore: dynamics?.available ? dynamics.score : entry.dynamicScore,
				dynamicIssues: dynamics?.available ? dynamics.issues : entry.dynamicIssues,
				sourceTitle: entry.title,
			};
		}
	}
	const ranked = rankVideoCandidates(
		[
			...(
				await Promise.allSettled(
					koQueries.map((query) => searchYouTubeVideos(query, 6)),
				)
			).flatMap((result) =>
				result.status === "fulfilled" && Array.isArray(result.value)
					? result.value
							.filter((item) => !usedVideoIds.has(`yt-${item.videoId}`))
							.map((item) => ({ provider: "youtube" as const, item }))
					: [],
			),
			...(
				await Promise.allSettled(
					enQueries.map((query) => searchPexelsVideos(query, 6)),
				)
			).flatMap((result) =>
				result.status === "fulfilled" && Array.isArray(result.value)
					? result.value
							.filter(
								(item) =>
									item.downloadUrl &&
									item.duration <= maxDuration + 10 &&
									!usedVideoIds.has(`pexels-${item.id}`),
							)
							.map((item) => ({ provider: "pexels" as const, item }))
					: [],
			),
			...(
				await Promise.allSettled(
					enQueries.map((query) => searchPixabayVideos(query, 6)),
				)
			).flatMap((result) =>
				result.status === "fulfilled" && Array.isArray(result.value)
					? result.value
							.filter(
								(item) =>
									item.downloadUrl &&
									item.duration <= maxDuration + 10 &&
									!usedVideoIds.has(`pixabay-${item.id}`),
							)
							.map((item) => ({ provider: "pixabay" as const, item }))
					: [],
			),
		],
		allQueries,
		maxDuration,
		locale,
	).filter(
		(candidate) =>
			isAcceptableVideoCandidate(
				candidate,
				options.minScore ?? MIN_VIDEO_CANDIDATE_SCORE,
				options.minRelevance,
			) && !isRejectedByTerms(candidate, options.rejectTerms),
	);

	for (const candidate of ranked) {
		const candidateKey =
			candidate.provider === "youtube"
				? candidate.videoId
					? `yt-${candidate.videoId}`
					: ""
				: candidate.id;
		try {
			if (candidate.provider === "youtube" && candidate.videoId) {
				markVideoArchiveKeyUsed(candidateKey);
				const youtubeUrl = `https://www.youtube.com/watch?v=${candidate.videoId}`;
				const downloaded = await downloadYouTubeVideoToPath(
					storagePath,
					youtubeUrl,
					maxDuration,
				);
				const dynamics = await validateDownloadedVideoDynamics(
					downloaded.url,
					options,
				);
				const clip = buildYouTubeClipDescriptor(youtubeUrl, maxDuration);
				recordMediaArchiveEntry({
					kind: "video",
					provider: "youtube",
					locale,
					storagePath: downloaded.storagePath,
					remoteUrl: clip.remoteUrl,
					thumbnailUrl: candidate.thumbnail,
					title: candidate.title,
					queries: allQueries,
					archiveKey: clip.archiveKey ?? candidateKey,
					qualityScore: candidate.score,
					dynamicScore: dynamics?.available ? dynamics.score : undefined,
					dynamicIssues: dynamics?.available ? dynamics.issues : undefined,
					width: candidate.width,
					height: candidate.height,
					duration: clip.duration,
				});
				return {
					videoUrl: downloaded.url,
					storagePath: downloaded.storagePath,
					thumbnailUrl: candidate.thumbnail,
					provider: candidate.provider,
					qualityScore: candidate.score,
					dynamicScore: dynamics?.available ? dynamics.score : undefined,
					dynamicIssues: dynamics?.available ? dynamics.issues : undefined,
					sourceTitle: candidate.title,
				};
			}
			if (candidate.downloadUrl) {
				usedVideoIds.add(candidateKey);
				const downloaded = await downloadDirectVideo(
					storagePath,
					candidate.downloadUrl,
				);
				const dynamics = await validateDownloadedVideoDynamics(
					downloaded.url,
					options,
				);
				recordMediaArchiveEntry({
					kind: "video",
					provider: candidate.provider,
					locale,
					storagePath: downloaded.storagePath,
					remoteUrl: candidate.downloadUrl,
					thumbnailUrl: candidate.thumbnail,
					title: candidate.title,
					queries: allQueries,
					archiveKey: candidateKey || undefined,
					qualityScore: candidate.score,
					dynamicScore: dynamics?.available ? dynamics.score : undefined,
					dynamicIssues: dynamics?.available ? dynamics.issues : undefined,
					width: candidate.width,
					height: candidate.height,
					duration: candidate.duration,
				});
				return {
					videoUrl: downloaded.url,
					storagePath: downloaded.storagePath,
					thumbnailUrl: candidate.thumbnail,
					provider: candidate.provider,
					qualityScore: candidate.score,
					dynamicScore: dynamics?.available ? dynamics.score : undefined,
					dynamicIssues: dynamics?.available ? dynamics.issues : undefined,
					sourceTitle: candidate.title,
				};
			}
		} catch {
			if (candidateKey) usedVideoIds.delete(candidateKey);
			/* 다운로드 실패 시 다음 후보 */
		}
	}

	return null;
}

/** Pexels/Pixabay 등 직접 다운로드 가능한 영상 URL → IndexedDB */
async function downloadDirectVideo(
	storagePath: string,
	videoUrl: string,
): Promise<{ url: string; storagePath: string }> {
	const archived = await tryReuseArchivedRemote("video", videoUrl);
	if (archived) return archived;

	const res = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok) throw new Error(`영상 다운로드 실패: ${res.status}`);

	const buffer = await res.arrayBuffer();
	const normalizedPath = storagePath.replace(/\.[a-z0-9]+$/i, ".mp4");

	const url = await storeLocalFile(
		normalizedPath,
		new Uint8Array(buffer),
		"video/mp4",
	);
	recordMediaArchiveEntry({
		kind: "video",
		provider: "direct",
		locale: "en",
		storagePath: normalizedPath,
		remoteUrl: videoUrl,
		queries: [],
		archiveKey: `direct:${videoUrl}`,
	});

	return { url, storagePath: normalizedPath };
}
