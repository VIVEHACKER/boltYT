import type { RemotionScene } from "../remotion/types";
import { getRenderServer } from "./render-queue";

function encodeAssetPath(path: string): string {
	return path
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function getExtensionFromContentType(contentType: string): string {
	if (contentType.includes("png")) return "png";
	if (contentType.includes("jpeg")) return "jpg";
	if (contentType.includes("webp")) return "webp";
	if (contentType.includes("gif")) return "gif";
	if (contentType.includes("mp4")) return "mp4";
	if (contentType.includes("webm")) return "webm";
	if (contentType.includes("mpeg")) return "mp3";
	if (contentType.includes("wav")) return "wav";
	if (contentType.includes("ogg")) return "ogg";
	return "bin";
}

function getExtensionFromUrl(url: string, fallback: string): string {
	const clean = url.split("?")[0]?.split("#")[0] ?? "";
	const match = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
	return match?.[1]?.toLowerCase() ?? fallback;
}

function shouldMirrorToRenderServer(url: string): boolean {
	if (!url) return false;
	if (
		url.startsWith("blob:") ||
		url.startsWith("data:") ||
		url.startsWith("/")
	) {
		return true;
	}
	if (!url.startsWith("http://") && !url.startsWith("https://")) return true;
	if (typeof window === "undefined") return false;
	return url.startsWith(window.location.origin);
}

async function uploadAssetToRenderServer(
	logicalPath: string,
	sourceUrl: string,
): Promise<string> {
	const renderServer = getRenderServer();
	const fetchUrl =
		sourceUrl.startsWith("/") && typeof window !== "undefined"
			? `${window.location.origin}${sourceUrl}`
			: sourceUrl;

	const res = await fetch(fetchUrl);
	if (!res.ok) {
		throw new Error(`렌더 자산 준비 실패: ${res.status}`);
	}

	const blob = await res.blob();
	const contentType = blob.type || "application/octet-stream";
	const ext = getExtensionFromUrl(
		sourceUrl,
		getExtensionFromContentType(contentType),
	);
	const finalPath = logicalPath.includes(".")
		? logicalPath
		: `${logicalPath}.${ext}`;

	const uploadRes = await fetch(
		`${renderServer}/asset?path=${encodeURIComponent(finalPath)}`,
		{
			method: "POST",
			headers: { "Content-Type": contentType },
			body: blob,
		},
	);
	if (!uploadRes.ok) {
		const err = await uploadRes
			.json()
			.catch(() => ({ error: uploadRes.statusText }));
		throw new Error(
			(err as { error?: string }).error ??
				`렌더 자산 업로드 실패: ${uploadRes.status}`,
		);
	}

	return `${renderServer}/assets/${encodeAssetPath(finalPath)}`;
}

async function resolveRenderAssetUrl(
	cache: Map<string, string>,
	sourceUrl: string | undefined,
	logicalPath: string,
): Promise<string> {
	if (!sourceUrl) return "";
	if (cache.has(sourceUrl)) return cache.get(sourceUrl) ?? "";
	if (!shouldMirrorToRenderServer(sourceUrl)) {
		cache.set(sourceUrl, sourceUrl);
		return sourceUrl;
	}

	try {
		const uploadedUrl = await uploadAssetToRenderServer(logicalPath, sourceUrl);
		cache.set(sourceUrl, uploadedUrl);
		return uploadedUrl;
	} catch (error) {
		if (sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")) {
			cache.set(sourceUrl, sourceUrl);
			return sourceUrl;
		}
		throw error;
	}
}

export async function prepareRenderPayload(params: {
	scriptId: string;
	scenes: RemotionScene[];
	narrationUrl?: string;
	bgmUrl?: string;
}): Promise<{
	scenes: RemotionScene[];
	narrationUrl?: string;
	bgmUrl?: string;
}> {
	const cache = new Map<string, string>();
	const { scriptId, scenes, narrationUrl, bgmUrl } = params;

	const preparedScenes = await Promise.all(
		scenes.map(async (scene, sceneIndex) => {
			const preparedShots = await Promise.all(
				(scene.shots ?? []).map(async (shot, shotIndex) => ({
					...shot,
					source_url: await resolveRenderAssetUrl(
						cache,
						shot.source_url,
						`render-assets/${scriptId}/scene-${sceneIndex + 1}/shot-${shotIndex + 1}-${shot.id}`,
					),
				})),
			);

			return {
				...scene,
				imageUrl: await resolveRenderAssetUrl(
					cache,
					scene.imageUrl,
					`render-assets/${scriptId}/scene-${sceneIndex + 1}/image`,
				),
				videoUrl: await resolveRenderAssetUrl(
					cache,
					scene.videoUrl,
					`render-assets/${scriptId}/scene-${sceneIndex + 1}/video`,
				),
				audioUrl: await resolveRenderAssetUrl(
					cache,
					scene.audioUrl,
					`render-assets/${scriptId}/scene-${sceneIndex + 1}/audio`,
				),
				shots: preparedShots,
			};
		}),
	);

	return {
		scenes: preparedScenes,
		narrationUrl: narrationUrl
			? await resolveRenderAssetUrl(
					cache,
					narrationUrl,
					`render-assets/${scriptId}/narration`,
				)
			: undefined,
		bgmUrl: bgmUrl
			? await resolveRenderAssetUrl(
					cache,
					bgmUrl,
					`render-assets/${scriptId}/bgm`,
				)
			: undefined,
	};
}
