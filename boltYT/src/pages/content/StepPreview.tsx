import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PInputText,
	PSpinner,
	PTag,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import { Player } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	clampShortsDuration,
	estimatedBpmFromTempo,
	retimeScenesToBeatGrid,
} from "../../lib/beat-sync";
import { buildHookFlags } from "../../lib/hook-detector";
import { autoPickBgm, inferAutoBgmPreset } from "../../lib/bgm";
import { isBpmReliable, type BgmAnalysis } from "../../lib/bgm-analyze";
import type { SceneShot } from "../../lib/scene-shot-types";
import { ensureBlobUrls } from "../../lib/local-db";
import { referenceToPreset } from "../../lib/reference-bridge";
import { prepareRenderPayload } from "../../lib/render-assets";
import {
	DEFAULT_PRESET,
	type HardwareAccel,
	HARDWARE_LABELS,
	QUALITY_DESCRIPTIONS,
	QUALITY_LABELS,
	type RenderQualityPreset,
	resolveRenderOptions,
} from "../../lib/render-options";
import { pollRenderProgress, submitRender } from "../../lib/render-queue";
import { assignSfxToScenes } from "../../lib/sfx";
import { supabase } from "../../lib/supabase";
import {
	calculateTotalFrames,
	VideoComposition,
} from "../../remotion/Composition";
import type { RemotionScene } from "../../remotion/types";
import {
	SHORTS_HEIGHT,
	SHORTS_SUBTITLE,
	SHORTS_WIDTH,
	VIDEO_FPS,
	VIDEO_HEIGHT,
	VIDEO_WIDTH,
} from "../../remotion/types";
import type { ReferenceTemplate, Scene } from "../../types/database";

interface StepPreviewProps {
	scriptId: string;
	referenceTemplate?: ReferenceTemplate | null;
	onBack: () => void;
}

type SceneWithAssets = Scene & { imageUrl?: string; audioUrl?: string };

/** 연속 나레이션 URL을 IndexedDB에서 복원 */
async function loadNarrationUrl(
	scriptId: string,
	ensureFn: (paths: string[]) => Promise<Map<string, string>>,
): Promise<string> {
	const narPath = localStorage.getItem(`narration_path_${scriptId}`);
	if (!narPath) return "";
	const blobMap = await ensureFn([narPath]);
	return blobMap.get(narPath) ?? "";
}

function loadStoredBgmAnalysis(scriptId: string): BgmAnalysis | null {
	const raw = localStorage.getItem(`bgm_analysis_${scriptId}`);
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as BgmAnalysis;
		return isBpmReliable(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export default function StepPreview({
	scriptId,
	referenceTemplate,
	onBack,
}: StepPreviewProps) {
	const navigate = useNavigate();
	const [scenes, setScenes] = useState<SceneWithAssets[]>([]);
	const [remotionScenes, setRemotionScenes] = useState<RemotionScene[]>([]);
	const [shortsScript, setShortsScript] = useState("");
	const [loading, setLoading] = useState(true);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [tags, setTags] = useState("");
	const [rejecting, setRejecting] = useState(false);
	const [rejectionReason, setRejectionReason] = useState("");
	const [approving, setApproving] = useState(false);
	const [approved, setApproved] = useState(false);
	const [rendering, setRendering] = useState(false);
	const [renderProgress, setRenderProgress] = useState("");
	const [renderQuality, setRenderQuality] =
		useState<RenderQualityPreset>(DEFAULT_PRESET);
	const [hwAccelOverride, setHwAccelOverride] = useState<HardwareAccel | null>(
		null,
	);
	const effectiveHwAccel =
		hwAccelOverride ??
		resolveRenderOptions({ preset: renderQuality }).hardwareAccel;
	const [isShorts, setIsShorts] = useState(false);
	const [narrationUrl, setNarrationUrl] = useState("");

	const compositionOverrides = useMemo(() => {
		if (!referenceTemplate) return {};
		const preset = referenceToPreset(
			referenceTemplate,
			isShorts ? "shorts" : "longform",
		);
		return {
			subtitleStyle: preset.composition.subtitleStyle,
			captionStyle: preset.composition.captionStyle,
			subtitlePosition: preset.composition.subtitlePosition,
			subtitleBgStyle: preset.composition.subtitleBgStyle,
			subtitleAccentColor: referenceTemplate.subtitle_accent_color,
		};
	}, [referenceTemplate, isShorts]);

	useEffect(() => {
		async function load() {
			const [scenesRes, scriptRes] = await Promise.all([
				supabase
					.from("scenes")
					.select("*")
					.eq("script_id", scriptId)
					.order("order_index"),
				supabase
					.from("scripts")
					.select("*, briefs(*, topics(title, channels(name)))")
					.eq("id", scriptId)
					.maybeSingle(),
			]);

			const rawScenes = scenesRes.data ?? [];
			const scriptData = scriptRes.data as {
				format: string;
				content_json: { shorts_script?: string; format_selection?: string };
				briefs?: {
					topics?: { title?: string; channels?: { name?: string } };
				};
			} | null;
			const fmt =
				scriptData?.content_json?.format_selection ??
				scriptData?.format ??
				"longform";
			const shortsMode = fmt === "shorts";
			const preset = referenceTemplate
				? referenceToPreset(
						referenceTemplate,
						shortsMode ? "shorts" : "longform",
					)
				: undefined;

			const { data: assets } = await supabase
				.from("media_assets")
				.select("scene_id, storage_path, status, type")
				.in(
					"scene_id",
					(rawScenes as Scene[]).map((s) => s.id),
				)
				.eq("status", "complete");

			// IndexedDB에서 blob URL 일괄 복원 (새로고침 후에도 동작)
			const storagePaths = (assets ?? [])
				.map((a) => (a as { storage_path: string }).storage_path)
				.filter((p: string) => p?.startsWith("scenes/"));
			const shotPaths = (rawScenes as Scene[]).flatMap((scene) =>
				(
					((scene as Record<string, unknown>).shots as
						| SceneShot[]
						| undefined) ?? []
				)
					.map((shot) => shot.source_url)
					.filter(
						(path): path is string =>
							typeof path === "string" && path.startsWith("scenes/"),
					),
			);
			const allPaths = [...new Set([...storagePaths, ...shotPaths])];
			const blobUrls = await ensureBlobUrls(allPaths);

			const imageMap = new Map<string, string>();
			const videoMap = new Map<string, string>();
			const audioMap = new Map<string, string>();
			for (const a of assets ?? []) {
				if (!a.storage_path?.startsWith("scenes/")) continue;
				const publicUrl = blobUrls.get(a.storage_path) ?? "";
				if (!publicUrl) continue;

				if (a.type === "tts_audio") {
					audioMap.set(a.scene_id, publicUrl);
				} else if (a.type === "video") {
					videoMap.set(a.scene_id, publicUrl);
				} else if (a.type === "image") {
					imageMap.set(a.scene_id, publicUrl);
				}
			}

			const scenesWithAssets: SceneWithAssets[] = (rawScenes as Scene[]).map(
				(s) => {
					const sourceUrl = s.source_url as string | undefined;
					const shots =
						((s as Record<string, unknown>).shots as SceneShot[] | undefined) ??
						[];
					let imgUrl = imageMap.get(s.id as string);
					// IndexedDB에 이미지가 없으면 이미지 URL만 fallback (기사 URL 제외)
					if (!imgUrl && sourceUrl) {
						const isImageSrc = /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(
							sourceUrl,
						);
						if (isImageSrc) imgUrl = sourceUrl;
					}
					if (!imgUrl) {
						const firstShotUrl = shots
							.map((shot) => {
								if (!shot.source_url) return "";
								if (shot.source_url.startsWith("scenes/")) {
									return blobUrls.get(shot.source_url) ?? "";
								}
								return shot.source_url;
							})
							.find(Boolean);
						if (firstShotUrl) imgUrl = firstShotUrl;
					}

					return {
						...s,
						imageUrl: imgUrl,
						audioUrl: audioMap.get(s.id as string),
					};
				},
			);
			const bgmAnalysis = loadStoredBgmAnalysis(scriptId);
			const beatRaw = shortsMode
				? retimeScenesToBeatGrid(scenesWithAssets, {
						beats: bgmAnalysis?.beats,
						bpm:
							bgmAnalysis?.bpm ??
							(preset?.bgm.tempo
								? estimatedBpmFromTempo(preset.bgm.tempo)
								: undefined),
					})
				: scenesWithAssets;
			const beatRetimedScenes = shortsMode
				? clampShortsDuration(beatRaw)
				: beatRaw;
			setScenes(beatRetimedScenes);

			// 연속 나레이션 로드
			const narUrl = await loadNarrationUrl(scriptId, ensureBlobUrls);
			setNarrationUrl(narUrl);

			// 훅 패턴 감지 (콘텐츠 기반) + 시간 기반 hookBoost 통합
			const hookResults = buildHookFlags(
				beatRetimedScenes.map((s) => ({
					duration_seconds: Number(s.duration_seconds),
					narration: (s.narration as string | null | undefined) ?? "",
				})),
			);
			const hookFlags = hookResults.map((r) => r.hookBoost);

			// SFX 자동 배정
			const sfxList = assignSfxToScenes(
				beatRetimedScenes.map((s, idx) => ({
					type: s.scene_type,
					mood: s.mood,
					transition: s.transition,
					textEffect: s.text_effect,
					hookBoost: hookFlags[idx],
					durationInFrames: Math.ceil(Number(s.duration_seconds) * VIDEO_FPS),
					wordTimings: (s as Record<string, unknown>).word_timings as
						| Array<{ word: string; startFrame: number; endFrame: number }>
						| undefined,
					beatTimes: bgmAnalysis?.beats,
				})),
			);

			const rScenes: RemotionScene[] = beatRetimedScenes.map((s, idx) => {
				// 이미지 출처 판단: generation_params에 origin/width가 있으면 활용
				const genParams = (s as Record<string, unknown>).generation_params as
					| { origin?: string; width?: number }
					| undefined;
				const imgOrigin = genParams?.origin ?? "";
				const imgWidth = genParams?.width ?? 0;
				const isCollected =
					imgOrigin === "naver" ||
					imgOrigin === "direct_url" ||
					imgOrigin === "search";
				const isLowRes = imgWidth > 0 && imgWidth < 1280;
				// fallback: generation_params 없으면 source_url 존재 여부로 추정
				const hasSourceUrl = Boolean(s.source_url);
				const isNewsPhoto = genParams ? isCollected && isLowRes : hasSourceUrl;

				const resolvedShots = (
					((s as Record<string, unknown>).shots as SceneShot[] | undefined) ??
					[]
				).map((shot) => ({
					...shot,
					source_url:
						typeof shot.source_url === "string" &&
						shot.source_url.startsWith("scenes/")
							? (blobUrls.get(shot.source_url) ?? shot.source_url)
							: shot.source_url,
				}));

				return {
					imageUrl: s.imageUrl ?? "",
					videoUrl: videoMap.get(s.id as string) ?? "",
					audioUrl: s.audioUrl ?? "",
					narration: s.narration_text,
					durationInFrames: Math.ceil(Number(s.duration_seconds) * VIDEO_FPS),
					type: s.scene_type as RemotionScene["type"],
					newsTitle: s.news_title,
					newsSource: s.news_source,
					newsExcerpt: s.news_excerpt,
					newsDate: s.news_date,
					shots: resolvedShots,
					sourceAttribution: hasSourceUrl
						? s.news_source || "수집 자료"
						: undefined,
					isNewsPhoto,
					hookBoost: hookFlags[idx],
					transition: (((s as Record<string, unknown>).transition as string) ??
						"crossfade") as RemotionScene["transition"],
					mood: (((s as Record<string, unknown>).mood as string) ??
						"neutral") as RemotionScene["mood"],
					textEffect: (((s as Record<string, unknown>).text_effect as string) ??
						"none") as RemotionScene["textEffect"],
					// Whisper word timings (실제 발화 기반 자막 sync)
					wordTimings: (s as Record<string, unknown>).word_timings as
						| Array<{ word: string; startFrame: number; endFrame: number }>
						| undefined,
					// v3: 모션 그래픽
					motionGraphics: (s as Record<string, unknown>).motion_graphics as
						| Array<{
								type:
									| "number_counter"
									| "lower_third"
									| "progress_bar"
									| "arrow_callout"
									| "quote_bubble"
									| "emoji_burst";
								startFrame: number;
								duration: number;
								params: Record<string, unknown>;
						  }>
						| undefined,
					colorGrade: (s as Record<string, unknown>).color_grade as
						| RemotionScene["colorGrade"]
						| undefined,
					// SFX
					enterSfxFile: sfxList[idx]?.enterSfx?.file,
					enterSfxVolume: sfxList[idx]?.enterSfx?.volume,
					enterSfxFromFrame: sfxList[idx]?.enterOffsetFrames,
					enterSfxDurationFrames: sfxList[idx]?.enterSfx
						? Math.ceil((sfxList[idx]?.enterSfx?.duration ?? 0) * VIDEO_FPS)
						: undefined,
					transitionSfxFile: sfxList[idx]?.transitionSfx?.file,
					transitionSfxVolume: sfxList[idx]?.transitionSfx?.volume,
					transitionSfxFromFrame: sfxList[idx]?.transitionOffsetFrames,
					transitionSfxDurationFrames: sfxList[idx]?.transitionSfx
						? Math.ceil(sfxList[idx]!.transitionSfx!.duration * VIDEO_FPS)
						: undefined,
				};
			});
			setRemotionScenes(rScenes);

			if (scriptData) {
				setIsShorts(shortsMode);
				setShortsScript(scriptData.content_json?.shorts_script ?? "");
				const topicTitle = scriptData.briefs?.topics?.title ?? "";
				setTitle(topicTitle);
				setDescription(
					`${topicTitle}에 대해 알아봅니다.\n\n#shorts #유튜브 #자동화`,
				);
				setTags("AI, 유튜브, 자동화, 지식");
			}

			setLoading(false);
		}
		load();
	}, [scriptId, referenceTemplate]);

	async function handleApprove() {
		setApproving(true);
		setRendering(true);
		setRenderProgress("렌더 자산을 준비하고 있습니다...");

		const totalDuration = scenes.reduce(
			(sum, s) => sum + Number(s.duration_seconds),
			0,
		);

		const renderFormat = isShorts ? "shorts" : "longform";
		const { data: render } = await supabase
			.from("renders")
			.insert({
				script_id: scriptId,
				format: renderFormat,
				aspect_ratio: isShorts ? "9:16" : "16:9",
				storage_path: `renders/${scriptId}/final.mp4`,
				duration_seconds: totalDuration,
				status: "rendering",
				qc_result_json: {
					duration_ok: true,
					subtitles_ok: true,
					forbidden_words_ok: true,
					silence_gaps_ok: true,
				},
			})
			.select()
			.maybeSingle();

		if (render) {
			// 렌더큐 서버에 실제 렌더 요청 (템플릿 오버라이드 + quality preset + HW accel)
			try {
				let bgmUrl =
					localStorage.getItem(`bgm_url_${scriptId}`) ??
					localStorage.getItem("bgm_url") ??
					"";
				if (!bgmUrl) {
					const bgmResult = await autoPickBgm(
						scriptId,
						inferAutoBgmPreset(
							scenes.map((scene) => ({
								mood: scene.mood,
								durationSeconds: Number(scene.duration_seconds),
								sceneType: scene.scene_type,
							})),
						),
					);
					bgmUrl = bgmResult?.url ?? "";
					if (bgmUrl) {
						localStorage.setItem(`bgm_url_${scriptId}`, bgmUrl);
					}
				}
				const renderPayload = await prepareRenderPayload({
					scriptId,
					scenes: remotionScenes,
					narrationUrl,
					bgmUrl,
				});
				setRenderProgress("영상을 렌더링하고 있습니다...");
				const job = await submitRender(
					scriptId,
					renderFormat,
					{
						scenes: renderPayload.scenes,
						bgmUrl: renderPayload.bgmUrl,
						narrationUrl: renderPayload.narrationUrl,
						...compositionOverrides,
					},
					{
						preset: renderQuality,
						...(hwAccelOverride ? { hardwareAccel: hwAccelOverride } : {}),
					},
				);
				const completed = await pollRenderProgress(
					job.id,
					(progress, status) => {
						setRenderProgress(`렌더링 중... ${progress}% (${status})`);
					},
				);

				if (completed.status === "failed") {
					throw new Error(completed.error ?? "렌더링 실패");
				}

				await supabase
					.from("renders")
					.update({
						status: "complete",
						storage_path:
							completed.outputPath || `renders/${scriptId}/final.mp4`,
					})
					.eq("id", render.id);
			} catch (e) {
				const msg = e instanceof Error ? e.message : "렌더링 실패";
				await supabase
					.from("renders")
					.update({ status: "failed" })
					.eq("id", render.id);
				setRenderProgress(`렌더 실패: ${msg}`);
				setRendering(false);
				setApproving(false);
				return;
			}

			setRenderProgress("렌더링 완료, 업로드 정보 저장 중...");

			await supabase.from("approvals").insert({
				render_id: render.id,
				status: "approved",
				reviewed_at: new Date().toISOString(),
			});

			await supabase.from("uploads").insert({
				render_id: render.id,
				title,
				description,
				tags: tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean),
				status: "queued",
			});
		}

		setRendering(false);
		setApproved(true);
		setApproving(false);
	}

	if (loading) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg text-center py-fluid-lg">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (approved) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg text-center py-fluid-lg">
				<PInlineNotification state="success" dismissButton={false}>
					콘텐츠가 승인되어 업로드 대기열에 추가되었습니다.
				</PInlineNotification>
				<div className="flex justify-center gap-static-md mt-fluid-md">
					<PButton onClick={() => navigate("/uploads")}>업로드 관리</PButton>
					<PButton variant="secondary" onClick={() => navigate("/content")}>
						내 콘텐츠
					</PButton>
				</div>
			</div>
		);
	}

	const totalDuration = scenes.reduce(
		(sum, s) => sum + Number(s.duration_seconds),
		0,
	);
	const totalFrames =
		remotionScenes.length > 0 ? calculateTotalFrames(remotionScenes) : 1;

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<PHeading size="medium" tag="h2" className="mb-static-sm">
				5단계: 미리보기 / 승인
			</PHeading>
			<PText size="small" color="contrast-medium" className="mb-static-lg">
				최종 결과물을 검토하고 승인하거나 반려하세요.
			</PText>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-static-sm mb-static-lg">
				<div className="bg-canvas rounded-[4px] p-static-sm text-center">
					<PText size="x-small" color="contrast-medium">
						씬 수
					</PText>
					<PText weight="semi-bold">{scenes.length}</PText>
				</div>
				<div className="bg-canvas rounded-[4px] p-static-sm text-center">
					<PText size="x-small" color="contrast-medium">
						총 길이
					</PText>
					<PText weight="semi-bold">
						{Math.floor(totalDuration / 60)}:
						{String(Math.round(totalDuration % 60)).padStart(2, "0")}
					</PText>
				</div>
				<div className="bg-canvas rounded-[4px] p-static-sm text-center">
					<PText size="x-small" color="contrast-medium">
						미디어
					</PText>
					<PTag color="notification-success-soft">이미지+음성 완료</PTag>
				</div>
			</div>

			{/* Remotion Player - Real Video Preview */}
			{remotionScenes.length > 0 && (
				<div className="mb-static-lg rounded-[8px] overflow-hidden bg-[#000]">
					<Player
						component={VideoComposition}
						inputProps={{
							scenes: remotionScenes,
							// script-scoped BGM URL 우선 (리로드 후에도 안전), legacy 전역 키는 fallback
							bgmUrl:
								localStorage.getItem(`bgm_url_${scriptId}`) ??
								localStorage.getItem("bgm_url") ??
								"",
							narrationUrl,
							...(isShorts ? { subtitleStyle: SHORTS_SUBTITLE } : {}),
							...compositionOverrides,
						}}
						durationInFrames={totalFrames}
						fps={VIDEO_FPS}
						compositionWidth={isShorts ? SHORTS_WIDTH : VIDEO_WIDTH}
						compositionHeight={isShorts ? SHORTS_HEIGHT : VIDEO_HEIGHT}
						style={{ width: "100%" }}
						controls
						autoPlay={false}
					/>
				</div>
			)}

			{remotionScenes.length === 0 && (
				<div className="bg-canvas rounded-[8px] p-fluid-lg text-center mb-static-lg">
					<PText color="contrast-medium">씬 데이터가 없습니다.</PText>
				</div>
			)}

			{shortsScript && (
				<div className="bg-canvas rounded-[8px] p-static-lg mb-static-lg">
					<PHeading size="small" tag="h3" className="mb-static-sm">
						쇼츠 스크립트
					</PHeading>
					<pre className="whitespace-pre-wrap text-[14px] leading-relaxed font-[inherit]">
						{shortsScript}
					</pre>
				</div>
			)}

			<PDivider className="my-static-lg" />

			<PHeading size="small" tag="h3" className="mb-static-md">
				업로드 정보
			</PHeading>

			<div className="flex flex-col gap-static-md mb-static-lg">
				<PInputText
					name="title"
					label="제목"
					value={title}
					onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
				/>
				<PTextarea
					name="description"
					label="설명"
					value={description}
					rows={4}
					onInput={(e) =>
						setDescription((e.target as HTMLTextAreaElement).value)
					}
				/>
				<PInputText
					name="tags"
					label="태그 (쉼표로 구분)"
					value={tags}
					onInput={(e) => setTags((e.target as HTMLInputElement).value)}
				/>
			</div>

			{rendering && (
				<PInlineNotification
					state="info"
					dismissButton={false}
					className="mb-static-md"
				>
					{renderProgress}
				</PInlineNotification>
			)}

			{rejecting && (
				<div className="bg-canvas rounded-[4px] p-static-md mb-static-lg">
					<PHeading size="small" tag="h4" className="mb-static-sm">
						반려 사유
					</PHeading>
					<PTextarea
						name="rejectionReason"
						label="사유를 입력하세요"
						hideLabel
						value={rejectionReason}
						rows={3}
						onInput={(e) =>
							setRejectionReason((e.target as HTMLTextAreaElement).value)
						}
					/>
					<div className="flex gap-static-sm mt-static-md">
						<PButton
							variant="secondary"
							onClick={() => {
								setRejecting(false);
								onBack();
							}}
						>
							반려 후 수정
						</PButton>
						<PButton variant="ghost" onClick={() => setRejecting(false)}>
							취소
						</PButton>
					</div>
				</div>
			)}

			<div
				style={{
					padding: 16,
					background: "#0d0d0d",
					border: "1px solid #1f1f1f",
					borderRadius: 8,
					display: "flex",
					flexDirection: "column",
					gap: 12,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 16,
						flexWrap: "wrap",
					}}
				>
					<span
						style={{
							fontSize: 13,
							fontWeight: 600,
							color: "rgba(255,255,255,0.8)",
							minWidth: 80,
						}}
					>
						렌더 품질
					</span>
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
						{(
							["draft", "balanced", "high", "archive"] as RenderQualityPreset[]
						).map((p) => {
							const active = renderQuality === p;
							return (
								<button
									key={p}
									type="button"
									onClick={() => {
										setRenderQuality(p);
										setHwAccelOverride(null);
									}}
									disabled={approving || rendering}
									title={QUALITY_DESCRIPTIONS[p]}
									style={{
										padding: "8px 14px",
										fontSize: 12,
										fontWeight: 600,
										border: active
											? "1px solid rgba(251,191,36,0.6)"
											: "1px solid #2a2a2a",
										background: active ? "rgba(251,191,36,0.15)" : "#1a1a1a",
										color: active ? "#fcd34d" : "rgba(255,255,255,0.7)",
										borderRadius: 4,
										cursor: approving || rendering ? "not-allowed" : "pointer",
										display: "flex",
										flexDirection: "column",
										alignItems: "flex-start",
										minWidth: 120,
									}}
								>
									<span>{QUALITY_LABELS[p]}</span>
									<span
										style={{
											fontSize: 10,
											fontWeight: 400,
											color: active
												? "rgba(252,211,77,0.7)"
												: "rgba(255,255,255,0.4)",
											marginTop: 2,
										}}
									>
										{QUALITY_DESCRIPTIONS[p]}
									</span>
								</button>
							);
						})}
					</div>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						flexWrap: "wrap",
					}}
				>
					<span
						style={{
							fontSize: 12,
							fontWeight: 600,
							color: "rgba(255,255,255,0.55)",
							minWidth: 80,
						}}
					>
						인코더
					</span>
					<div style={{ display: "flex", gap: 4 }}>
						{(["disable", "if-possible", "required"] as HardwareAccel[]).map(
							(h) => {
								const active = effectiveHwAccel === h;
								return (
									<button
										key={h}
										type="button"
										onClick={() => setHwAccelOverride(h)}
										disabled={approving || rendering}
										style={{
											padding: "5px 10px",
											fontSize: 10,
											fontWeight: 600,
											border: active
												? "1px solid rgba(134,239,172,0.6)"
												: "1px solid #2a2a2a",
											background: active
												? "rgba(134,239,172,0.12)"
												: "transparent",
											color: active
												? "rgba(134,239,172,0.95)"
												: "rgba(255,255,255,0.55)",
											borderRadius: 3,
											cursor:
												approving || rendering ? "not-allowed" : "pointer",
										}}
									>
										{HARDWARE_LABELS[h]}
									</button>
								);
							},
						)}
					</div>
					<span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
						macOS VideoToolbox / NVENC 시 5-10x 빠름 · required 는 crf 무효
					</span>
				</div>
			</div>

			<div className="flex justify-between">
				<div className="flex gap-static-sm">
					<PButton variant="secondary" onClick={onBack}>
						이전
					</PButton>
					{!rejecting && (
						<PButton variant="tertiary" onClick={() => setRejecting(true)}>
							반려
						</PButton>
					)}
				</div>
				<PButton loading={approving} onClick={handleApprove}>
					승인 및 업로드 대기
				</PButton>
			</div>
		</div>
	);
}
