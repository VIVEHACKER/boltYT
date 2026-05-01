import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	generateImage as aiGenerateImage,
	generateImageToPath as aiGenerateImageToPath,
	generateTts as aiGenerateTts,
	generateContinuousNarration,
} from "../../lib/ai";
import {
	planSceneDirectives,
	planSceneVisuals,
	type ResearchBrief,
	type SceneDirective,
	verifySceneQuality,
} from "../../lib/ai-agents";
import { autoPickBgm, inferAutoBgmPreset } from "../../lib/bgm";
import { ensureBlobUrls } from "../../lib/local-db";
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
} from "../../lib/media-download";
import { referenceToPreset } from "../../lib/reference-bridge";
import {
	buildSceneImagePrompt,
	buildSceneSearchQueries,
	buildShotImagePrompt,
	buildShotSearchQueries,
	isDirectImageUrl,
	isDirectVideoUrl,
} from "../../lib/scene-media";
import type { SceneShot } from "../../lib/scene-shot-types";
import { supabase } from "../../lib/supabase";
import {
	hasStoredTtsSettings,
	inferNarrationTtsOptions,
	type TtsOptions,
} from "../../lib/tts";
import {
	detectVideoGen,
	generateSceneVideo,
	getActiveVideoProvider,
	setActiveVideoProvider,
	VIDEO_COST_PER_SCENE,
	type VideoGenProvider,
} from "../../lib/video-gen";
import {
	deriveLockedSeed,
	enrichVideoPrompt,
	type ScriptFormat,
} from "../../lib/video-prompt-enrich";
import type { ReferenceTemplate, Scene } from "../../types/database";
import type { CollectedSource, ContentMode } from "./ContentWizardPage";

interface StepMediaProps {
	scriptId: string;
	mode?: ContentMode;
	sources?: CollectedSource[];
	referenceTemplate?: ReferenceTemplate | null;
	onNext: () => void;
	onBack: () => void;
}

type MediaStatus =
	| "pending"
	| "generating"
	| "complete"
	| "error"
	| "not_needed";

type SceneWithMedia = Scene & {
	imageStatus: MediaStatus;
	ttsStatus: MediaStatus;
	videoStatus: MediaStatus;
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
	sourceUrl?: string;
	errorMsg?: string;
	searchQueryKo?: string;
	/** Pexels/Pixabay용 영어 검색 쿼리 (Scene Director 생성) */
	searchQueryEn?: string;
	/** 채널 언어 기반 검색 소스 우선순위 */
	locale?: "ko" | "en";
};

function isLocalMediaPath(value?: string): boolean {
	return Boolean(value?.startsWith("scenes/"));
}

function getSceneShots(
	scene: Pick<Scene, "shots"> | Record<string, unknown>,
): SceneShot[] {
	return (
		((scene as Record<string, unknown>).shots as SceneShot[] | undefined) ?? []
	).map((shot) => ({ ...shot }));
}

function getImageShots(
	scene: Pick<Scene, "shots"> | Record<string, unknown>,
): SceneShot[] {
	return getSceneShots(scene).filter((shot) => shot.media_type === "image");
}

function getVideoShots(
	scene: Pick<Scene, "shots"> | Record<string, unknown>,
): SceneShot[] {
	return getSceneShots(scene).filter(
		(shot) => (shot.media_type ?? "video") === "video",
	);
}

function resolveShotUrl(
	shot: SceneShot,
	blobUrls: Map<string, string>,
): string {
	if (!shot.source_url) return "";
	return isLocalMediaPath(shot.source_url)
		? (blobUrls.get(shot.source_url) ?? "")
		: shot.source_url;
}

function getShotStoragePaths(scene: Scene): string[] {
	const shots = getSceneShots(scene);
	return shots
		.map((shot) => shot.source_url)
		.filter(
			(value): value is string =>
				typeof value === "string" && isLocalMediaPath(value),
		);
}

export default function StepMedia({
	scriptId,
	mode: _mode = "ai",
	sources = [],
	referenceTemplate,
	onNext,
	onBack,
}: StepMediaProps) {
	const referencePreset = referenceTemplate
		? referenceToPreset(referenceTemplate, "shorts")
		: undefined;
	const ttsOptions = useMemo<TtsOptions | undefined>(
		() =>
			referencePreset
				? {
						voice: referencePreset.tts.voice,
						provider: referencePreset.tts.provider,
						speed: referencePreset.tts.speed,
					}
				: undefined,
		[referencePreset],
	);
	const [scenes, setScenes] = useState<SceneWithMedia[]>([]);
	const effectiveTtsOptions = useMemo<TtsOptions | undefined>(() => {
		if (ttsOptions) return ttsOptions;
		if (hasStoredTtsSettings()) return undefined;
		return inferNarrationTtsOptions(
			scenes.map((scene) => ({
				narration: scene.narration_text,
				mood: scene.mood,
				type: scene.scene_type,
			})),
		);
	}, [scenes, ttsOptions]);
	const [bgmAutoPicked, setBgmAutoPicked] = useState<string>("");
	const scenesRef = useRef<SceneWithMedia[]>([]);
	useEffect(() => {
		scenesRef.current = scenes;
	}, [scenes]);
	const [loading, setLoading] = useState(true);
	const [generating, setGenerating] = useState(false);
	const [narrationStatus, setNarrationStatus] = useState<
		"idle" | "generating" | "complete" | "error"
	>("idle");
	const [narrationError, setNarrationError] = useState("");
	const [aiVideoAvailable, setAiVideoAvailable] = useState(false);
	const [aiVideoProvider, setAiVideoProvider] = useState<VideoGenProvider>(
		getActiveVideoProvider(),
	);
	const [scriptFormat, setScriptFormat] = useState<ScriptFormat>("shorts");
	const [aiVideoBatch, setAiVideoBatch] = useState<{
		current: number;
		total: number;
	} | null>(null);
	useEffect(() => {
		detectVideoGen()
			.then((s) => setAiVideoAvailable(s.available))
			.catch(() => setAiVideoAvailable(false));
	}, []);
	useEffect(() => {
		(async () => {
			try {
				const { data } = await supabase
					.from("scripts")
					.select("format")
					.eq("id", scriptId)
					.maybeSingle();
				const fmt = (data as { format?: string } | null)?.format;
				if (fmt === "longform" || fmt === "shorts") setScriptFormat(fmt);
			} catch {
				// ignore — 기본 shorts 유지
			}
		})();
	}, [scriptId]);

	const loadScenes = useCallback(async () => {
		resetUsedVideoIds();
		const { data: sceneData } = await supabase
			.from("scenes")
			.select("*")
			.eq("script_id", scriptId)
			.order("order_index");

		const scenesRaw = sceneData ?? [];

		const { data: existingAssets } = await supabase
			.from("media_assets")
			.select("scene_id, storage_path, status, type")
			.in(
				"scene_id",
				scenesRaw.map((s) => s.id),
			);

		// IndexedDB에서 blob URL 일괄 복원
		const assetPaths = (existingAssets ?? [])
			.map((a) => (a as { storage_path: string }).storage_path)
			.filter((p: string) => p?.startsWith("scenes/"));
		const shotPaths = scenesRaw.flatMap((scene) =>
			getShotStoragePaths(scene as Scene),
		);
		const storagePaths = [...new Set([...assetPaths, ...shotPaths])];
		const blobUrls = await ensureBlobUrls(storagePaths);

		type AssetInfo = { storage_path: string; status: string };
		const imageMap = new Map<string, AssetInfo>();
		const videoMap = new Map<string, AssetInfo>();
		const ttsMap = new Map<string, AssetInfo>();
		for (const a of existingAssets ?? []) {
			if (a.type === "tts_audio") ttsMap.set(a.scene_id, a);
			else if (a.type === "video") videoMap.set(a.scene_id, a);
			else if (a.type === "image") imageMap.set(a.scene_id, a);
		}

		const mapped: SceneWithMedia[] = scenesRaw.map((s) => {
			const imgAsset = imageMap.get(s.id as string);
			const vidAsset = videoMap.get(s.id as string);
			const ttsAsset = ttsMap.get(s.id as string);
			const sceneType = s.scene_type as string;
			const sourceUrl = s.source_url as string | undefined;
			const shots = getSceneShots(s as Scene);
			const imageShots = getImageShots(s as Scene);
			const videoShots = getVideoShots(s as Scene);
			const firstShotUrl = shots
				.map((shot) => resolveShotUrl(shot, blobUrls))
				.find(Boolean);
			const allShotImagesReady =
				imageShots.length > 0 &&
				imageShots.every((shot) => Boolean(resolveShotUrl(shot, blobUrls)));
			const allShotVideosReady =
				videoShots.length > 0 &&
				videoShots.every((shot) => Boolean(resolveShotUrl(shot, blobUrls)));

			// --- 영상 상태 ---
			let videoStatus: MediaStatus = "not_needed";
			let videoUrl: string | undefined;
			if (sceneType === "video" || videoShots.length > 0) {
				if (allShotVideosReady) {
					videoStatus = "complete";
					videoUrl = resolveShotUrl(videoShots[0], blobUrls) || undefined;
				} else if (
					vidAsset?.status === "complete" &&
					vidAsset.storage_path?.startsWith("scenes/")
				) {
					videoStatus = "complete";
					videoUrl = blobUrls.get(vidAsset.storage_path) ?? "";
				} else if (
					videoShots.length > 0 ||
					(sceneType === "video" && sourceUrl)
				) {
					videoStatus = "pending";
				}
			}

			// --- 이미지 상태 ---
			let imageStatus: MediaStatus = "pending";
			let imageUrl: string | undefined;

			if (sceneType === "video") {
				if (allShotImagesReady) {
					imageStatus = "complete";
					imageUrl = firstShotUrl || undefined;
				} else if (imageShots.length > 0) {
					imageStatus = "pending";
				} else {
					imageStatus = "not_needed";
				}
				if (
					imgAsset?.status === "complete" &&
					imgAsset.storage_path?.startsWith("scenes/")
				) {
					imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
				}
			} else if (sceneType === "text_emphasis") {
				if (
					imgAsset?.status === "complete" &&
					imgAsset.storage_path?.startsWith("scenes/")
				) {
					imageStatus = "complete";
					imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
				} else {
					imageStatus = "not_needed";
				}
			} else if (sceneType === "news_overlay") {
				// 이미 IndexedDB에 이미지가 있으면 사용, 아니면 생성 필요
				if (
					imgAsset?.status === "complete" &&
					imgAsset.storage_path?.startsWith("scenes/")
				) {
					imageStatus = "complete";
					imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
				} else {
					imageStatus = "pending";
				}
			} else if (
				imgAsset?.status === "complete" &&
				imgAsset.storage_path?.startsWith("scenes/")
			) {
				imageStatus = "complete";
				imageUrl = blobUrls.get(imgAsset.storage_path) ?? "";
			} else if (imageShots.length === 0 && videoShots.length > 0) {
				imageStatus = "not_needed";
			} else if (allShotImagesReady) {
				imageStatus = "complete";
				imageUrl = firstShotUrl || undefined;
			} else if (sourceUrl) {
				// 외부 이미지 URL — 다운로드 필요
				imageStatus = "pending";
			}

			// --- TTS 상태 ---
			let ttsStatus: MediaStatus = "pending";
			let audioUrl: string | undefined;
			if (
				ttsAsset?.status === "complete" &&
				ttsAsset.storage_path?.startsWith("scenes/")
			) {
				ttsStatus = "complete";
				audioUrl = blobUrls.get(ttsAsset.storage_path) ?? "";
			}

			return {
				...s,
				imageStatus,
				ttsStatus,
				videoStatus,
				imageUrl,
				videoUrl,
				audioUrl,
				sourceUrl,
				shots,
			};
		});

		setScenes(mapped);

		// 연속 나레이션 존재 여부 확인
		const narPath = localStorage.getItem(`narration_path_${scriptId}`);
		if (narPath) setNarrationStatus("complete");

		setLoading(false);
	}, [scriptId]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadScenes();
	}, [loadScenes]);

	// 레퍼런스 템플릿 있으면 BGM 자동 배정 (한 번만)
	// — URL은 항상 script-scoped 키(`bgm_url_<scriptId>`)에 저장하여 리로드 후에도 복원 가능
	useEffect(() => {
		if (!referencePreset || bgmAutoPicked) return;
		const existingPath = localStorage.getItem(`bgm_path_${scriptId}`);
		let cancelled = false;

		void (async () => {
			// 이미 이 스크립트용 BGM이 할당되어 있으면 URL만 복원
			if (existingPath) {
				try {
					// 정적 경로(public/bgm/...)면 그대로 사용
					if (existingPath.startsWith("/")) {
						if (!cancelled) {
							localStorage.setItem(`bgm_url_${scriptId}`, existingPath);
							setBgmAutoPicked("restored_static");
						}
						return;
					}
					// IndexedDB path는 blob URL 재생성
					const blobMap = await ensureBlobUrls([existingPath]);
					const url = blobMap.get(existingPath);
					if (url && !cancelled) {
						localStorage.setItem(`bgm_url_${scriptId}`, url);
						setBgmAutoPicked("restored_indexeddb");
					}
				} catch (e) {
					console.warn("BGM restore failed:", e);
				}
				return;
			}

			// 최초 자동 선택
			try {
				const result = await autoPickBgm(scriptId, referencePreset.bgm);
				if (!cancelled && result) {
					localStorage.setItem(`bgm_url_${scriptId}`, result.url);
					setBgmAutoPicked(result.source);
				}
			} catch (e) {
				console.warn("BGM auto-pick failed:", e);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [scriptId, referencePreset, bgmAutoPicked]);

	function updateScene(index: number, patch: Partial<SceneWithMedia>) {
		setScenes((prev) => {
			const next = prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
			scenesRef.current = next;
			return next;
		});
	}

	async function persistSceneShots(sceneId: string, shots: SceneShot[]) {
		const { error } = await supabase
			.from("scenes")
			.update({ shots })
			.eq("id", sceneId);
		if (error) throw error;
	}

	async function generateShotImages(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		if (shots.length === 0 || scene.scene_type === "text_emphasis") {
			return false;
		}
		const imageShots = shots.filter((shot) => shot.media_type === "image");
		if (imageShots.length === 0 && scene.scene_type === "video") return false;

		let previewImageUrl = scene.imageUrl;
		let changed = false;

		for (const shot of shots) {
			if (shot.media_type === "video") continue;

			const storagePath = `scenes/${scene.id}/shots/${shot.id}.png`;
			const queries = buildShotSearchQueries(scene, shot);
			const imagePrompt = buildShotImagePrompt(scene, shot);

			if (isLocalMediaPath(shot.source_url)) {
				const localPath = shot.source_url!;
				if (!previewImageUrl) {
					const blobMap = await ensureBlobUrls([localPath]);
					previewImageUrl = blobMap.get(localPath) ?? previewImageUrl;
				}
				continue;
			}

			let url = "";
			if (isDirectImageUrl(shot.source_url)) {
				const downloaded = await downloadImageToPath(
					storagePath,
					shot.source_url!,
				);
				url = downloaded.url;
				shot.source_url = downloaded.storagePath;
			} else {
				const searched = await searchAndDownloadImageToPath(
					storagePath,
					queries.queryEn,
					queries.queryKo,
					queries.locale,
				);
				if (searched) {
					url = searched.url;
					shot.source_url = searched.storagePath;
				} else {
					url = await aiGenerateImageToPath(
						storagePath,
						imagePrompt,
						referencePreset,
					);
					shot.source_url = storagePath;
				}
			}

			if (!previewImageUrl) previewImageUrl = url;
			changed = true;
		}

		if (
			!shots.every(
				(shot) => shot.media_type === "video" || Boolean(shot.source_url),
			)
		) {
			return false;
		}

		if (changed) {
			await persistSceneShots(scene.id, shots);
		}

		updateScene(sceneIndex, {
			shots,
			imageStatus: "complete",
			imageUrl: previewImageUrl,
		});
		return true;
	}

	async function fallbackVideoShotsToImages(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		if (shots.length === 0) return false;

		let previewImageUrl = scene.imageUrl;
		let changed = false;

		for (const shot of shots) {
			if ((shot.media_type ?? "video") !== "video") continue;
			if (
				shot.source_url &&
				!isDirectVideoUrl(shot.source_url) &&
				!isLocalMediaPath(shot.source_url)
			) {
				continue;
			}
			if (shot.source_url && isLocalMediaPath(shot.source_url)) continue;
			const storagePath = `scenes/${scene.id}/shots/${shot.id}.png`;
			const queries = buildShotSearchQueries(scene, shot);
			const imagePrompt = buildShotImagePrompt(scene, shot);
			const searched = await searchAndDownloadImageToPath(
				storagePath,
				queries.queryEn,
				queries.queryKo,
				queries.locale,
			);
			if (searched) {
				shot.media_type = "image";
				shot.source_url = searched.storagePath;
				shot.trim_start = undefined;
				shot.trim_end = undefined;
				if (!previewImageUrl) previewImageUrl = searched.url;
				changed = true;
				continue;
			}

			const generatedUrl = await aiGenerateImageToPath(
				storagePath,
				imagePrompt,
				referencePreset,
			);
			shot.media_type = "image";
			shot.source_url = storagePath;
			shot.trim_start = undefined;
			shot.trim_end = undefined;
			if (!previewImageUrl) previewImageUrl = generatedUrl;
			changed = true;
		}

		if (!changed) return false;
		await persistSceneShots(scene.id, shots);
		updateScene(sceneIndex, {
			shots,
			videoStatus: "not_needed",
			imageStatus: "complete",
			imageUrl: previewImageUrl,
		});
		return true;
	}

	async function generateShotVideos(sceneIndex: number) {
		const scene = scenesRef.current[sceneIndex];
		const shots = getSceneShots(scene);
		const videoShots = shots.filter(
			(shot) => (shot.media_type ?? "video") === "video",
		);
		if (videoShots.length === 0) return false;

		let previewVideoUrl = scene.videoUrl;
		let changed = false;

		for (const shot of videoShots) {
			if (isLocalMediaPath(shot.source_url)) {
				const localPath = shot.source_url!;
				if (!previewVideoUrl) {
					const blobMap = await ensureBlobUrls([localPath]);
					previewVideoUrl = blobMap.get(localPath) ?? previewVideoUrl;
				}
				continue;
			}
			if (isDirectVideoUrl(shot.source_url)) {
				const storagePath = `scenes/${scene.id}/shots/${shot.id}.mp4`;
				const downloaded = /youtu\.be|youtube\.com/i.test(shot.source_url ?? "")
					? await downloadYouTubeVideoToPath(
							storagePath,
							shot.source_url!,
							Math.min(
								30,
								Math.max(8, Math.ceil(Number(shot.duration_seconds)) + 4),
							),
						)
					: await downloadVideoToPath(storagePath, shot.source_url!);
				shot.source_url = downloaded.storagePath;
				if (!previewVideoUrl) previewVideoUrl = downloaded.url;
				changed = true;
				continue;
			}

			const indexedSource =
				typeof shot.source_index === "number" && shot.source_index >= 0
					? sources[shot.source_index]
					: undefined;
			if (indexedSource?.url && isDirectVideoUrl(indexedSource.url)) {
				const storagePath = `scenes/${scene.id}/shots/${shot.id}.mp4`;
				const downloaded = /youtu\.be|youtube\.com/i.test(indexedSource.url)
					? await downloadYouTubeVideoToPath(
							storagePath,
							indexedSource.url,
							Math.min(
								30,
								Math.max(8, Math.ceil(Number(shot.duration_seconds)) + 4),
							),
						)
					: await downloadVideoToPath(storagePath, indexedSource.url);
				shot.source_url = downloaded.storagePath;
				if (!previewVideoUrl) previewVideoUrl = downloaded.url;
				changed = true;
				continue;
			}

			const queries = buildShotSearchQueries(scene, shot);
			const searched = await searchAndDownloadVideoToPath(
				`scenes/${scene.id}/shots/${shot.id}.mp4`,
				queries.queryEn,
				queries.queryKo,
				Math.min(30, Math.max(8, Math.ceil(Number(shot.duration_seconds)) + 4)),
				queries.locale,
			);
			if (searched) {
				shot.source_url = searched.storagePath;
				if (!previewVideoUrl) previewVideoUrl = searched.videoUrl;
				changed = true;
			}
		}

		if (changed) {
			await persistSceneShots(scene.id, shots);
		}

		const allResolved = shots
			.filter((shot) => (shot.media_type ?? "video") === "video")
			.every((shot) => Boolean(shot.source_url));
		updateScene(sceneIndex, {
			shots,
			videoStatus: allResolved ? "complete" : "pending",
			videoUrl: previewVideoUrl,
		});
		return allResolved;
	}

	async function generateImage(sceneIndex: number, retryCount = 0) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { imageStatus: "generating", errorMsg: undefined });

		try {
			const usedShotImages = await generateShotImages(sceneIndex);
			if (usedShotImages) return;

			let url: string;
			const { queryKo, queryEn, locale } = buildSceneSearchQueries(scene);
			const imagePrompt = buildSceneImagePrompt(scene);

			if (isDirectImageUrl(scene.sourceUrl)) {
				url = await downloadImageToLocal(scene.id, scene.sourceUrl!);
			} else {
				// 1순위: 이미지 검색
				url = await searchAndDownloadImage(scene.id, queryEn, queryKo, locale);

				// 2순위: AI 이미지 생성
				if (!url) {
					url = await aiGenerateImage(scene.id, imagePrompt, referencePreset);
				}
			}
			updateScene(sceneIndex, { imageStatus: "complete", imageUrl: url });
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";

			// 자가 복구: 최대 2회 자동 재시도
			if (retryCount < 2) {
				const isRateLimit = msg.includes("429");
				const delay = isRateLimit ? 15000 : 3000;
				updateScene(sceneIndex, {
					errorMsg: `자동 복구 중 (${retryCount + 1}/2)...`,
				});
				await new Promise((r) => setTimeout(r, delay));

				// 수집 자료 실패 시 → AI 생성으로 전환
				if (scene.sourceUrl?.startsWith("http") && retryCount === 1) {
					updateScene(sceneIndex, { sourceUrl: undefined });
				}

				return generateImage(sceneIndex, retryCount + 1);
			}

			updateScene(sceneIndex, { imageStatus: "error", errorMsg: msg });
		}
	}

	async function generateVideo(sceneIndex: number, retryCount = 0) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { videoStatus: "generating", errorMsg: undefined });

		try {
			await generateShotImages(sceneIndex);
			const latestScene = scenesRef.current[sceneIndex];
			const { queryKo, queryEn, locale } = buildSceneSearchQueries(latestScene);
			const imagePrompt = buildSceneImagePrompt(latestScene);
			const videoShots = getVideoShots(latestScene);
			if (videoShots.length === 0) {
				updateScene(sceneIndex, { videoStatus: "not_needed" });
				return;
			}
			const shotVideosReady = await generateShotVideos(sceneIndex);
			if (shotVideosReady) return;
			const refreshedScene = scenesRef.current[sceneIndex];
			const unresolvedVideoShots = getVideoShots(refreshedScene).filter(
				(shot) => !shot.source_url,
			);
			if (unresolvedVideoShots.length === 0) {
				updateScene(sceneIndex, { videoStatus: "complete" });
				return;
			}
			const maxDuration = Math.min(
				40,
				Math.max(8, Math.ceil(Number(scene.duration_seconds)) + 4),
			);

			if (isDirectVideoUrl(latestScene.sourceUrl)) {
				const isYouTube = /youtu\.be|youtube\.com/i.test(
					latestScene.sourceUrl ?? "",
				);
				const url = isYouTube
					? await downloadYouTubeVideo(
							latestScene.id,
							latestScene.sourceUrl!,
							maxDuration,
						)
					: await downloadVideoToLocal(latestScene.id, latestScene.sourceUrl!);
				updateScene(sceneIndex, { videoStatus: "complete", videoUrl: url });

				// 썸네일도 fallback으로 저장
				const thumbnailUrl =
					sources.find((src) => src.url === latestScene.sourceUrl)?.thumbnail ??
					"";
				if (thumbnailUrl) {
					const imgUrl = await downloadThumbnailToLocal(
						latestScene.id,
						thumbnailUrl,
					);
					if (imgUrl) {
						updateScene(sceneIndex, {
							imageStatus: "complete",
							imageUrl: latestScene.imageUrl || imgUrl,
						});
					}
				}
				return;
			}

			const { videoUrl, thumbnailUrl } = await searchAndDownloadVideo(
				latestScene.id,
				queryEn,
				queryKo,
				maxDuration,
				locale,
			);
			if (videoUrl) {
				updateScene(sceneIndex, {
					videoStatus: "complete",
					videoUrl,
					imageStatus:
						latestScene.imageStatus === "complete"
							? "complete"
							: thumbnailUrl
								? "complete"
								: latestScene.imageStatus,
					imageUrl:
						latestScene.imageUrl || thumbnailUrl || latestScene.imageUrl,
				});
				return;
			}

			const converted = await fallbackVideoShotsToImages(sceneIndex);
			if (converted) return;

			const fallbackImage =
				(await searchAndDownloadImage(
					latestScene.id,
					queryEn,
					queryKo,
					locale,
				)) ||
				(await aiGenerateImage(latestScene.id, imagePrompt, referencePreset));
			updateScene(sceneIndex, {
				videoStatus: "not_needed",
				imageStatus: "complete",
				imageUrl: latestScene.imageUrl || fallbackImage,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";

			if (retryCount < 2) {
				const delay = msg.includes("429") ? 15000 : 3000;
				updateScene(sceneIndex, {
					errorMsg: `영상 자동 복구 중 (${retryCount + 1}/2)...`,
				});
				await new Promise((r) => setTimeout(r, delay));
				return generateVideo(sceneIndex, retryCount + 1);
			}

			updateScene(sceneIndex, { videoStatus: "error", errorMsg: msg });
		}
	}

	/** scenes 테이블에 directives 일괄 update — 페이지 리로드 후에도 재사용 */
	async function persistDirectivesToDb(
		currentScenes: SceneWithMedia[],
		directiveMap: Map<number, SceneDirective>,
	) {
		const updates: Array<PromiseLike<unknown>> = [];
		for (let i = 0; i < currentScenes.length; i++) {
			const directive = directiveMap.get(i);
			if (!directive) continue;
			updates.push(
				supabase
					.from("scenes")
					.update({
						shot_type: directive.shot_type,
						camera_motion: directive.camera_motion,
						scene_bgm_mood: directive.bgm_mood,
						pacing: directive.pacing,
					})
					.eq("id", currentScenes[i].id),
			);
		}
		try {
			await Promise.all(updates);
		} catch (err) {
			// 컬럼 없거나 RLS 차단 시 — 비치명. 다음 세션 재계산.
			console.warn(
				"[directives persist] supabase update 실패:",
				(err as Error).message,
			);
		}
	}

	async function generateAiVideo(
		sceneIndex: number,
		options: { chainFromVideoUrl?: string } = {},
		retryCount = 0,
	) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { videoStatus: "generating", errorMsg: undefined });

		try {
			// 이미지가 없으면 먼저 생성
			let imageUrl = scene.imageUrl;
			if (!imageUrl) {
				const imagePrompt = buildSceneImagePrompt(scene);
				imageUrl = await aiGenerateImage(
					scene.id,
					imagePrompt,
					referencePreset,
				);
				updateScene(sceneIndex, {
					imageStatus: "complete",
					imageUrl,
				});
			}

			const rawPrompt = buildSceneImagePrompt(scene);
			const duration = Math.min(
				10,
				Math.max(3, Math.ceil(Number(scene.duration_seconds) || 5)),
			);

			// referencePreset.image: { mood, lighting, dominantColors, promptTemplate }
			// 우선순위: scene 고유값 > ref. directives 는 [key:string]:unknown 으로 저장됨.
			const refImage = referencePreset?.image;
			const sceneShotType = scene.shot_type as
				| SceneDirective["shot_type"]
				| undefined;
			const sceneCameraMotion = scene.camera_motion as
				| SceneDirective["camera_motion"]
				| undefined;
			const sceneLighting = scene.lighting_style as
				| "dark"
				| "natural"
				| "bright"
				| "mixed"
				| undefined;
			const enriched = enrichVideoPrompt({
				rawPrompt,
				mood: scene.mood ?? refImage?.mood,
				lighting: sceneLighting ?? refImage?.lighting,
				shotType: sceneShotType,
				cameraMotion: sceneCameraMotion,
				dominantColors: refImage?.dominantColors,
				stylePromptTemplate: refImage?.promptTemplate,
				format: scriptFormat,
			});

			const { url } = await generateSceneVideo(scene.id, {
				provider: aiVideoProvider,
				prompt: enriched.prompt,
				imageUrl,
				duration,
				aspectRatio: enriched.aspectRatio,
				cameraCommands: enriched.cameraCommands,
				seed: deriveLockedSeed(scriptId),
				chainFromVideoUrl: options.chainFromVideoUrl,
			});

			updateScene(sceneIndex, { videoStatus: "complete", videoUrl: url });
			return url;
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			if (retryCount < 1) {
				updateScene(sceneIndex, {
					errorMsg: `AI 영상 자동 복구 중 (${retryCount + 1}/1)...`,
				});
				await new Promise((r) => setTimeout(r, 5000));
				return generateAiVideo(sceneIndex, options, retryCount + 1);
			}
			updateScene(sceneIndex, { videoStatus: "error", errorMsg: msg });
			return undefined;
		}
	}

	/**
	 * 모든 씬 AI 영상 일괄 생성 — 순차 처리 + last-frame chaining.
	 * 이전 씬의 결과 비디오 마지막 프레임이 다음 씬의 init_image 가 되어
	 * 시각 연속성 확보 (스톱 모션 같은 끊김 방지).
	 */
	async function handleGenerateAllAiVideos() {
		setGenerating(true);
		const eligible = scenesRef.current.filter(
			(s) => s.scene_type !== "text_emphasis",
		).length;
		setAiVideoBatch({ current: 0, total: eligible });
		try {
			// directives 누락 시 lazy 계산 (촬영지시 → enrichVideoPrompt 활용 극대화)
			const hasAnyDirective = scenesRef.current.some(
				(s) => s.camera_motion || s.shot_type,
			);
			if (!hasAnyDirective) {
				try {
					const briefStub = {
						summary: "",
						timeline: [],
						key_figures: [],
						facts: [],
						misconceptions: [],
						search_keywords: [],
					};
					const directives = await planSceneDirectives(
						scenesRef.current.map((s, i) => ({
							narration: s.narration_text,
							type: s.scene_type,
							index: i,
						})),
						briefStub,
						"",
					);
					const dirMap = new Map(directives.map((d) => [d.index, d]));
					setScenes((prev) => {
						const next = prev.map((s, i) => {
							const d = dirMap.get(i);
							if (!d) return s;
							return {
								...s,
								shot_type: d.shot_type,
								camera_motion: d.camera_motion,
								scene_bgm_mood: d.bgm_mood,
								pacing: d.pacing,
							};
						});
						scenesRef.current = next;
						return next;
					});
					await persistDirectivesToDb(scenesRef.current, dirMap);
				} catch (err) {
					console.warn(
						"[ai-video] directives lazy 계산 실패 — mood만 사용:",
						(err as Error).message,
					);
				}
			}

			let prevVideoUrl: string | undefined;
			let processed = 0;
			for (let i = 0; i < scenesRef.current.length; i++) {
				const scene = scenesRef.current[i];
				if (scene.scene_type === "text_emphasis") continue;
				processed++;
				setAiVideoBatch({ current: processed, total: eligible });
				const url = await generateAiVideo(i, {
					chainFromVideoUrl: prevVideoUrl,
				});
				if (url) prevVideoUrl = url;
			}
		} finally {
			setAiVideoBatch(null);
			setGenerating(false);
		}
	}

	async function generateTts(sceneIndex: number, retryCount = 0) {
		const scene = scenesRef.current[sceneIndex];
		updateScene(sceneIndex, { ttsStatus: "generating", errorMsg: undefined });

		try {
			const { url, duration } = await aiGenerateTts(
				scene.id,
				scene.narration_text,
				effectiveTtsOptions,
			);
			updateScene(sceneIndex, {
				ttsStatus: "complete",
				audioUrl: url,
				duration_seconds: duration,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";

			// 자가 복구: 최대 2회 자동 재시도
			if (retryCount < 2) {
				const delay = msg.includes("429") ? 15000 : 3000;
				updateScene(sceneIndex, {
					errorMsg: `TTS 자동 복구 중 (${retryCount + 1}/2)...`,
				});
				await new Promise((r) => setTimeout(r, delay));
				return generateTts(sceneIndex, retryCount + 1);
			}

			updateScene(sceneIndex, { ttsStatus: "error", errorMsg: msg });
		}
	}

	async function handleGenerateNarration() {
		setNarrationStatus("generating");
		setNarrationError("");
		try {
			const sceneData = scenesRef.current.map((s) => ({
				id: s.id,
				narration_text: s.narration_text,
			}));
			const { sceneDurations } = await generateContinuousNarration(
				scriptId,
				sceneData,
				effectiveTtsOptions,
			);
			// 씬 duration 업데이트 + TTS 상태 완료 처리
			setScenes((prev) =>
				prev.map((s, i) => ({
					...s,
					duration_seconds: sceneDurations[i] ?? s.duration_seconds,
					ttsStatus: "complete" as MediaStatus,
				})),
			);
			setNarrationStatus("complete");
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setNarrationError(msg);
			setNarrationStatus("error");
		}
	}

	async function handleGenerateAll() {
		setGenerating(true);
		resetUsedVideoIds();

		// 스크립트 → 채널 언어 + 리서치 키워드 조회
		let locale: "ko" | "en" = "ko";
		let researchKeywords: string[] = [];
		let visualPlan: Awaited<ReturnType<typeof planSceneVisuals>> | null = null;
		let directivePlan: SceneDirective[] | null = null;
		try {
			const { data: scriptData } = await supabase
				.from("scripts")
				.select("*, content_json, briefs(*, topics(title, channels(language)))")
				.eq("id", scriptId)
				.maybeSingle();
			const sd = scriptData as Record<string, unknown> | null;
			const briefs = sd?.briefs as Record<string, unknown> | undefined;
			const topics = briefs?.topics as Record<string, unknown> | undefined;
			const channels = topics?.channels as Record<string, string> | undefined;
			const topicTitle = (topics?.title as string) ?? "";
			locale = channels?.language === "en" ? "en" : "ko";
			const contentJson = sd?.content_json as
				| Record<string, unknown>
				| undefined;
			researchKeywords = Array.isArray(contentJson?.search_keywords)
				? (contentJson.search_keywords as string[])
				: [];

			if (topicTitle) {
				// Scene Director: 씬별 최적 검색쿼리 생성
				visualPlan = await planSceneVisuals(
					scenesRef.current.map((s) => ({
						narration: s.narration_text,
						type: s.scene_type,
						sourceTitle: s.news_title,
						sourceDate: s.news_date,
					})),
					topicTitle,
					researchKeywords,
				);

				// Scene Director: 샷/카메라무브/BGM 무드 배정 (brief 있을 때만)
				if (contentJson?.summary) {
					const brief: ResearchBrief = {
						summary: (contentJson.summary as string) ?? "",
						timeline: (contentJson.timeline as ResearchBrief["timeline"]) ?? [],
						key_figures:
							(contentJson.key_figures as ResearchBrief["key_figures"]) ?? [],
						facts: (contentJson.facts as string[]) ?? [],
						misconceptions: (contentJson.misconceptions as string[]) ?? [],
						search_keywords: researchKeywords,
					};
					try {
						directivePlan = await planSceneDirectives(
							scenesRef.current.map((s, i) => ({
								narration: s.narration_text,
								type: s.scene_type,
								index: i,
							})),
							brief,
							topicTitle,
						);
					} catch {
						// 촬영 지시 실패해도 기본값으로 진행
					}
				}
			}
		} catch {
			// Scene Director 실패해도 기본 쿼리로 진행
		}

		// Scene Director 검색쿼리 + 촬영 지시 + locale → 즉시 반영용 패치맵 + state 업데이트
		const planMap = new Map(
			(visualPlan?.scenes ?? []).map((p) => [p.index - 1, p]),
		);
		const directiveMap = new Map(
			(directivePlan ?? []).map((d) => [d.index, d]),
		);
		const patchMap = new Map<number, Partial<SceneWithMedia>>();
		for (const [idx, plan] of planMap) {
			if (idx >= 0 && idx < scenes.length) {
				const directive = directiveMap.get(idx);
				patchMap.set(idx, {
					searchQueryKo: plan.search_query_ko,
					searchQueryEn: plan.search_query_en,
					locale,
					...(directive
						? {
								camera_motion: directive.camera_motion,
								bgm_mood: directive.bgm_mood,
								pacing: directive.pacing,
								shot_type: directive.shot_type,
							}
						: {}),
				});
			}
		}
		for (let i = 0; i < scenes.length; i++) {
			if (!patchMap.has(i)) {
				const directive = directiveMap.get(i);
				patchMap.set(i, {
					locale,
					...(directive
						? {
								camera_motion: directive.camera_motion,
								bgm_mood: directive.bgm_mood,
								pacing: directive.pacing,
								shot_type: directive.shot_type,
							}
						: {}),
				});
			}
		}
		// state + ref를 한 번에 동기 반영
		setScenes((prev) => {
			const next = prev.map((s, i) => ({ ...s, ...(patchMap.get(i) ?? {}) }));
			scenesRef.current = next;
			return next;
		});

		// directives DB 영속화 (페이지 리로드 후 재계산 비용 절약)
		await persistDirectivesToDb(scenesRef.current, directiveMap);

		const existingBgm =
			localStorage.getItem(`bgm_path_${scriptId}`) ??
			localStorage.getItem(`bgm_url_${scriptId}`);
		if (!existingBgm) {
			try {
				const bgmPreset =
					referencePreset?.bgm ??
					inferAutoBgmPreset(
						scenesRef.current.map((scene) => ({
							mood: scene.mood,
							durationSeconds: Number(scene.duration_seconds),
							sceneType: scene.scene_type,
						})),
					);
				const bgmResult = await autoPickBgm(scriptId, bgmPreset);
				if (bgmResult) {
					localStorage.setItem(`bgm_url_${scriptId}`, bgmResult.url);
					setBgmAutoPicked(bgmResult.source);
				}
			} catch (error) {
				console.warn("BGM auto-pick failed during generation:", error);
			}
		}

		// 이미지/영상 생성 (동시 3씬, patchMap으로 최신 값 보장)
		const CONCURRENCY = 3;
		const pending: Array<{ idx: number; tasks: Promise<void>[] }> = [];
		for (let i = 0; i < scenesRef.current.length; i++) {
			const s = { ...scenesRef.current[i], ...(patchMap.get(i) ?? {}) };
			const tasks: Promise<void>[] = [];
			if (s.imageStatus === "pending") tasks.push(generateImage(i));
			if (s.videoStatus === "pending") tasks.push(generateVideo(i));
			if (tasks.length > 0) pending.push({ idx: i, tasks });
		}
		for (let i = 0; i < pending.length; i += CONCURRENCY) {
			const batch = pending.slice(i, i + CONCURRENCY);
			await Promise.all(batch.flatMap((b) => b.tasks));
		}

		// 연속 나레이션 생성
		if (narrationStatus !== "complete") {
			await handleGenerateNarration();
		}

		setGenerating(false);

		// QC Director: 품질 검증 (functional state update로 최신 state 보장)
		setScenes((latest) => {
			const qc = verifySceneQuality(latest);
			if (!qc.passed) {
				return latest.map((s, i) => {
					const issue = qc.issues.find(
						(iss) => iss.scene_index === i + 1 && iss.severity === "critical",
					);
					return issue ? { ...s, errorMsg: issue.message } : s;
				});
			}
			return latest;
		});
	}

	if (loading) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg text-center py-fluid-lg">
				<PSpinner size="medium" />
			</div>
		);
	}

	const isDone = (st: MediaStatus) => st === "complete" || st === "not_needed";
	const allComplete =
		narrationStatus === "complete" &&
		scenes.every((s) => isDone(s.imageStatus) && isDone(s.videoStatus));
	const imageCount = scenes.filter((s) => isDone(s.imageStatus)).length;
	const videoCount = scenes.filter((s) => isDone(s.videoStatus)).length;
	const totalDuration = scenes.reduce(
		(sum, s) => sum + Number(s.duration_seconds),
		0,
	);

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<PHeading size="medium" tag="h2" className="mb-static-sm">
				4단계: 미디어 생성
			</PHeading>
			<PText size="small" color="contrast-medium" className="mb-static-md">
				각 씬의 AI 이미지와 나레이션 음성을 생성합니다.
			</PText>

			<div className="flex items-center gap-static-md mb-static-lg flex-wrap">
				<PText size="small">{scenes.length}개 씬</PText>
				<PText size="small" color="contrast-medium">
					총 {Math.round(totalDuration)}초
				</PText>
				<PText size="small" color="contrast-medium">
					이미지 {imageCount}/{scenes.length}
				</PText>
				{scenes.some((s) => s.scene_type === "video") && (
					<PText size="small" color="contrast-medium">
						영상 {videoCount}/{scenes.length}
					</PText>
				)}
				{narrationStatus === "complete" ? (
					<PTag color="notification-success-soft">연속 나레이션 완료</PTag>
				) : narrationStatus === "generating" ? (
					<PTag color="notification-info-soft">나레이션 생성중...</PTag>
				) : (
					<PText size="small" color="contrast-medium">
						나레이션 대기
					</PText>
				)}
				{!generating && !allComplete && (
					<PButton compact onClick={handleGenerateAll}>
						미디어 일괄 생성
					</PButton>
				)}
				{!generating &&
					narrationStatus !== "complete" &&
					narrationStatus !== "generating" && (
						<PButton
							compact
							variant="secondary"
							onClick={handleGenerateNarration}
						>
							나레이션만 생성
						</PButton>
					)}
				{allComplete && (
					<PTag color="notification-success-soft">모든 미디어 생성 완료</PTag>
				)}
			</div>

			{aiVideoAvailable && (
				<div className="flex items-center gap-static-sm mb-static-md flex-wrap p-static-sm bg-canvas rounded-[4px]">
					<PText size="small" color="contrast-high">
						🎬 AI 영상 생성
					</PText>
					<select
						className="bg-surface text-[12px] rounded-[4px] px-static-xs py-[4px] border border-[var(--p-color-state-base)]"
						value={aiVideoProvider}
						onChange={(e) => {
							const next = e.target.value as VideoGenProvider;
							setAiVideoProvider(next);
							setActiveVideoProvider(next);
						}}
					>
						<option value="wan26">Wan 2.6 (가성비)</option>
						<option value="kling3">Kling 3.0 (고품질)</option>
						<option value="ltx2">LTX-2 (빠름)</option>
						<option value="hailuo">Hailuo (T2V + 카메라)</option>
						<option value="klingO1">Kling O1 (보간)</option>
					</select>
					<PText size="x-small" color="contrast-medium">
						씬당 약 ${VIDEO_COST_PER_SCENE[aiVideoProvider].toFixed(2)} · 총 ~$
						{(VIDEO_COST_PER_SCENE[aiVideoProvider] * scenes.length).toFixed(2)}
					</PText>
					{!generating && (
						<PButton
							compact
							variant="primary"
							onClick={handleGenerateAllAiVideos}
						>
							🎬 모든 씬 일괄 (체이닝)
						</PButton>
					)}
					{aiVideoBatch && (
						<PTag color="notification-info-soft">
							일괄 생성중 {aiVideoBatch.current}/{aiVideoBatch.total}
						</PTag>
					)}
					<PText size="x-small" color="contrast-low">
						{scriptFormat === "shorts" ? "9:16 세로" : "16:9 가로"} · 시드 잠금
					</PText>
				</div>
			)}

			{narrationError && (
				<PInlineNotification
					state="error"
					dismissButton={false}
					className="mb-static-md"
				>
					나레이션 생성 실패: {narrationError}
				</PInlineNotification>
			)}

			{generating && (
				<PInlineNotification
					state="info"
					dismissButton={false}
					className="mb-static-md"
				>
					AI 이미지와 음성을 생성하고 있습니다. 씬당 약 15-20초가 소요됩니다...
				</PInlineNotification>
			)}

			<div className="flex flex-col gap-static-sm">
				{scenes.map((scene, i) => (
					<div
						key={scene.id}
						className="bg-canvas rounded-[4px] overflow-hidden"
					>
						<div className="p-static-md flex items-start gap-static-md">
							<div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center text-[12px] font-semibold shrink-0 mt-1">
								{i + 1}
							</div>

							{scene.imageUrl && (
								<div className="w-32 h-20 rounded-[4px] overflow-hidden shrink-0">
									<img
										src={scene.imageUrl}
										alt={`씬 ${i + 1}`}
										className="w-full h-full object-cover"
									/>
								</div>
							)}

							<div className="flex-1 min-w-0">
								<PText size="small" ellipsis>
									{scene.narration_text}
								</PText>
								<div className="flex items-center gap-static-xs mt-static-xs flex-wrap">
									<PTag
										color={
											scene.scene_type === "news_overlay"
												? "notification-error-soft"
												: scene.scene_type === "video"
													? "notification-info-soft"
													: "background-surface"
										}
									>
										{scene.scene_type === "news_overlay"
											? "뉴스"
											: scene.scene_type === "video"
												? "영상"
												: scene.scene_type === "text_emphasis"
													? "텍스트"
													: "이미지"}
									</PTag>
									<PText size="x-small" color="contrast-medium">
										{scene.duration_seconds}초
									</PText>
									{/* Image status */}
									{scene.imageStatus === "complete" && (
										<PTag color="notification-success-soft">
											{scene.sourceUrl?.startsWith("http")
												? "수집자료"
												: "이미지"}
										</PTag>
									)}
									{scene.imageStatus === "generating" && (
										<PTag color="notification-info-soft">
											{scene.sourceUrl?.startsWith("http")
												? "자료 다운로드중"
												: "이미지 생성중"}
										</PTag>
									)}
									{scene.videoStatus === "complete" && (
										<PTag color="notification-success-soft">영상</PTag>
									)}
									{scene.videoStatus === "generating" && (
										<PTag color="notification-info-soft">영상 다운로드중</PTag>
									)}
									{scene.ttsStatus === "complete" && (
										<PTag color="notification-success-soft">음성</PTag>
									)}
									{scene.ttsStatus === "generating" && (
										<PTag color="notification-info-soft">음성 생성중</PTag>
									)}
								</div>
								{scene.errorMsg && (
									<PText
										size="x-small"
										color="notification-error"
										className="mt-static-xs"
									>
										{scene.errorMsg}
									</PText>
								)}
							</div>

							<div className="shrink-0 flex items-center gap-static-xs">
								{aiVideoAvailable &&
									!generating &&
									scene.scene_type !== "text_emphasis" &&
									scene.videoStatus !== "generating" && (
										<PButton
											compact
											variant="tertiary"
											onClick={() => generateAiVideo(i)}
										>
											🎬 AI 영상
										</PButton>
									)}
								{(scene.imageStatus === "pending" ||
									scene.videoStatus === "pending" ||
									scene.ttsStatus === "pending") &&
									!generating && (
										<PButton
											compact
											variant="secondary"
											onClick={() => {
												if (scene.imageStatus === "pending") generateImage(i);
												if (scene.videoStatus === "pending") generateVideo(i);
												if (scene.ttsStatus === "pending") generateTts(i);
											}}
										>
											생성
										</PButton>
									)}
								{(scene.imageStatus === "generating" ||
									scene.videoStatus === "generating" ||
									scene.ttsStatus === "generating") && (
									<PSpinner size="small" />
								)}
								{(scene.imageStatus === "complete" ||
									scene.imageStatus === "not_needed") &&
									scene.ttsStatus === "complete" && (
										<PTag color="notification-success-soft">완료</PTag>
									)}
								{(scene.imageStatus === "error" ||
									scene.videoStatus === "error" ||
									scene.ttsStatus === "error") &&
									!generating && (
										<PButton
											compact
											variant="secondary"
											onClick={() => {
												if (scene.imageStatus === "error") generateImage(i);
												if (scene.videoStatus === "error") generateVideo(i);
												if (scene.ttsStatus === "error") generateTts(i);
											}}
										>
											재시도
										</PButton>
									)}
							</div>
						</div>
					</div>
				))}
			</div>

			<PDivider className="my-static-lg" />

			<div className="flex justify-between">
				<PButton variant="secondary" onClick={onBack}>
					이전
				</PButton>
				<PButton disabled={!allComplete} onClick={onNext}>
					다음: 미리보기
				</PButton>
			</div>
		</div>
	);
}
