import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import { ImagePlus, Newspaper, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import TabButton from "../../components/TabButton";
import { generateResearchScript, generateScript } from "../../lib/ai";
import { planSceneSourceAssignments, researchTopic } from "../../lib/ai-agents";
import { snapDurationToBeat } from "../../lib/beat-sync";
import { suggestColorGrade } from "../../lib/color-grades";
import { assignMotionGraphicsForScene } from "../../lib/motion-graphics";
import { referenceToPreset } from "../../lib/reference-bridge";
import type { SceneShot } from "../../lib/scene-shot-types";
import {
	applyShortsVideoRules,
	buildSceneShots,
	ensureSceneShots,
	intensifyHookScenes,
	isSourceCompatible,
	rebalanceScenesForMotion,
	syncSceneMetadataFromSource,
	type ShotSource,
} from "../../lib/scene-shots";
import {
	applySceneSourcePlan,
	buildFallbackSceneSourcePlan,
} from "../../lib/scene-sequence";
import { supabase } from "../../lib/supabase";
import type { ReferenceTemplate } from "../../types/database";
import type { CollectedSource, ContentMode } from "./ContentWizardPage";

interface StepScriptProps {
	briefId: string;
	mode?: ContentMode;
	sources?: CollectedSource[];
	referenceTemplate?: ReferenceTemplate | null;
	onNext: (scriptId: string) => void;
	onBack: () => void;
}

interface SceneData {
	narration: string;
	type: "image" | "video" | "text_emphasis" | "news_overlay";
	visualPrompt: string;
	sourceIndex?: number;
	duration: number;
	newsTitle?: string;
	newsSource?: string;
	newsExcerpt?: string;
	newsDate?: string;
	transition?: string;
	mood?: string;
	textEffect?: string;
	shots?: SceneShot[];
}

export default function StepScript({
	briefId,
	mode = "ai",
	sources = [],
	referenceTemplate,
	onNext,
	onBack,
}: StepScriptProps) {
	const [format, setFormat] = useState<"shorts" | "longform" | "both">("both");
	const [shortsScript, setShortsScript] = useState("");
	const [longformScenes, setLongformScenes] = useState<SceneData[]>([]);
	const [generating, setGenerating] = useState(true);
	const [saving, setSaving] = useState(false);
	const [genError, setGenError] = useState("");
	const [submitError, setSubmitError] = useState("");
	const [searchKeywords, setSearchKeywords] = useState<string[]>([]);
	const [aligningSources, setAligningSources] = useState(false);

	const toShotSources = useCallback(
		(items: CollectedSource[]): ShotSource[] =>
			items.map((source) => ({
				type: source.type,
				title: source.title,
				url: source.url,
				thumbnail: source.thumbnail,
				description: source.description,
				bodyText: source.bodyText,
				publisher: source.publisher,
				eventDate: source.eventDate,
				eventTitle: source.eventTitle,
			})),
		[],
	);

	const applySceneShots = useCallback(
		(scene: SceneData): SceneData => ({
			...scene,
			shots: ensureSceneShots(scene, toShotSources(sources)),
		}),
		[sources, toShotSources],
	);

	const assignSourceToScene = useCallback(
		(scene: SceneData, sourceIndex: number): SceneData => {
			const source =
				sourceIndex >= 0 && sourceIndex < sources.length
					? sources[sourceIndex]
					: undefined;
			const next =
				sourceIndex >= 0
					? syncSceneMetadataFromSource({ ...scene, sourceIndex }, source)
					: {
							...scene,
							sourceIndex: -1,
							newsTitle: "",
							newsSource: "",
							newsDate: "",
							newsExcerpt: "",
						};

			return applySceneShots(next);
		},
		[applySceneShots, sources],
	);

	const updateSceneType = useCallback(
		(scene: SceneData, nextType: SceneData["type"]): SceneData => {
			const currentSource =
				typeof scene.sourceIndex === "number" && scene.sourceIndex >= 0
					? sources[scene.sourceIndex]
					: undefined;
			const nextSourceIndex =
				currentSource && isSourceCompatible(nextType, currentSource.type)
					? (scene.sourceIndex ?? -1)
					: -1;

			return assignSourceToScene({ ...scene, type: nextType }, nextSourceIndex);
		},
		[assignSourceToScene, sources],
	);

	const alignScenesToTimeline = useCallback(
		async (baseScenes: SceneData[]) => {
			if (baseScenes.length === 0) {
				return baseScenes;
			}

			const finalizeScenes = (scenesToFinalize: SceneData[]) => {
				const shotSources = toShotSources(sources);
				const motionScenes = rebalanceScenesForMotion(scenesToFinalize, shotSources);
				const shortsAdjusted =
					format === "longform"
						? motionScenes
						: applyShortsVideoRules(motionScenes, shotSources);
				return intensifyHookScenes(shortsAdjusted).map((scene) =>
					applySceneShots(scene),
				);
			};

			if (mode !== "research" || sources.length === 0) {
				return finalizeScenes(baseScenes);
			}

			setAligningSources(true);
			try {
				let plan: Awaited<
					ReturnType<typeof planSceneSourceAssignments>
				> | null = null;
				try {
					plan = await planSceneSourceAssignments(
						baseScenes.map((scene) => ({
							narration: scene.narration,
							type: scene.type,
							currentSourceIndex: scene.sourceIndex ?? -1,
						})),
						sources.map((source) => ({
							type: source.type,
							title: source.title,
							description: source.description,
							bodyText: source.bodyText,
							pubDate: source.pubDate,
							publisher: source.publisher,
							eventDate: source.eventDate,
							eventTitle: source.eventTitle,
						})),
					);
				} catch {
					// AI 정렬 실패 시 아래 fallback 사용
				}

				const sourceMeta = sources.map((source) => ({
					type: source.type,
					title: source.title,
					description: source.description,
					bodyText: source.bodyText,
					pubDate: source.pubDate,
					publisher: source.publisher,
					eventDate: source.eventDate,
					eventTitle: source.eventTitle,
				}));

				const effectivePlan = plan?.scenes?.length
					? plan
					: buildFallbackSceneSourcePlan(baseScenes, sourceMeta);

				return finalizeScenes(
					applySceneSourcePlan(baseScenes, sourceMeta, effectivePlan),
				);
			} finally {
				setAligningSources(false);
			}
		},
		[applySceneShots, format, mode, sources, toShotSources],
	);

	const doGenerate = useCallback(async () => {
		setGenerating(true);
		setGenError("");
		try {
			// Research Director: 주제 리서치 → 팩트 수집
			let brief: Awaited<ReturnType<typeof researchTopic>> | undefined;
			if (mode === "research") {
				try {
					const { data: topic } = await supabase
						.from("topics")
						.select("title")
						.eq("id", briefId)
						.maybeSingle();
					if (topic?.title) {
						brief = await researchTopic(topic.title);
						if (brief?.search_keywords?.length) {
							setSearchKeywords(brief.search_keywords);
						}
					}
				} catch {
					// 리서치 실패해도 스크립트 생성은 진행
				}
			}

			const preset = referenceTemplate
				? referenceToPreset(
						referenceTemplate,
						format === "shorts" ? "shorts" : "longform",
					)
				: undefined;

			const script =
				mode === "research"
					? await generateResearchScript(
							briefId,
							sources,
							format,
							brief,
							preset,
						)
					: await generateScript(briefId, format, preset);
			setShortsScript(script.shorts_script || "");
			const mappedScenes = (
				(script.longform_scenes as Array<{
					narration: string;
					type: string;
					visual_prompt: string;
					source_index?: number;
					duration: number;
					news_title?: string;
					news_source?: string;
					news_excerpt?: string;
					news_date?: string;
					transition?: string;
					mood?: string;
					text_effect?: string;
				}>) || []
			).map((s) => {
				// BGM 템포 기반 비트 스냅 — 레퍼런스 템플릿 있으면 활성화
				const snappedDuration = referenceTemplate?.bgm_tempo
					? snapDurationToBeat(s.duration, referenceTemplate.bgm_tempo)
					: s.duration;
				return {
					narration: s.narration,
					type: s.type as SceneData["type"],
					visualPrompt: s.visual_prompt,
					sourceIndex: s.source_index ?? -1,
					duration: snappedDuration,
					newsTitle: s.news_title ?? "",
					newsSource: s.news_source ?? "",
					newsExcerpt: s.news_excerpt ?? "",
					newsDate: s.news_date ?? "",
					transition: s.transition ?? "none",
					mood: s.mood ?? "neutral",
					textEffect: s.text_effect ?? "none",
					shots: [],
				};
			});
			const alignedScenes = await alignScenesToTimeline(mappedScenes);
			setLongformScenes(alignedScenes);
		} catch (err) {
			setGenError(
				err instanceof Error ? err.message : "스크립트 생성에 실패했습니다.",
			);
		} finally {
			setGenerating(false);
		}
	}, [
		alignScenesToTimeline,
		briefId,
		format,
		mode,
		sources,
		referenceTemplate,
	]);

	const lastAutoBriefId = useRef<string | null>(null);
	useEffect(() => {
		if (lastAutoBriefId.current === briefId) return;
		lastAutoBriefId.current = briefId;
		void doGenerate();
	}, [briefId, doGenerate]);

	function updateScene(
		index: number,
		field: keyof SceneData,
		value: string | number,
	) {
		setLongformScenes((prev) =>
			prev.map((scene, sceneIndex) => {
				if (sceneIndex !== index) return scene;
				if (field === "sourceIndex") {
					return assignSourceToScene(scene, Number(value));
				}
				if (field === "type") {
					return updateSceneType(scene, value as SceneData["type"]);
				}
				if (field === "duration") {
					return applySceneShots({
						...scene,
						duration: Number(value),
					});
				}
				const next = {
					...scene,
					[field]: value,
				};
				if (
					field === "narration" ||
					field === "visualPrompt" ||
					field === "newsTitle" ||
					field === "newsDate" ||
					field === "newsExcerpt"
				) {
					return applySceneShots(next);
				}
				return next;
			}),
		);
	}

	function updateShot(
		sceneIndex: number,
		shotIndex: number,
		field: keyof SceneShot,
		value: string | number,
	) {
		setLongformScenes((prev) =>
			prev.map((scene, currentSceneIndex) => {
				if (currentSceneIndex !== sceneIndex) return scene;
				const shots = (scene.shots ?? []).map((shot, currentShotIndex) =>
					currentShotIndex === shotIndex
						? {
								...shot,
								[field]:
									field === "duration_seconds" && !Number.isFinite(Number(value))
										? shot.duration_seconds
										: value,
							}
						: shot,
				);
				return applySceneShots({ ...scene, shots });
			}),
		);
	}

	function rebuildSceneShots(sceneIndex: number) {
		setLongformScenes((prev) =>
			prev.map((scene, currentSceneIndex) =>
				currentSceneIndex === sceneIndex
					? { ...scene, shots: buildSceneShots(scene, toShotSources(sources)) }
					: scene,
			),
		);
	}

	function rebuildAllSceneShots() {
		setLongformScenes((prev) =>
			prev.map((scene) => ({
				...scene,
				shots: buildSceneShots(scene, toShotSources(sources)),
			})),
		);
	}

	async function handleSubmit() {
		setSaving(true);
		setSubmitError("");

		const { data: script, error: scriptError } = await supabase
			.from("scripts")
			.insert({
				brief_id: briefId,
				format: format === "both" ? "longform" : format,
				content_json: {
					shorts_script: shortsScript,
					format_selection: format,
					search_keywords: searchKeywords,
				},
				status: "approved",
				reference_template_id: referenceTemplate?.id ?? null,
			})
			.select()
			.maybeSingle();

		if (scriptError || !script) {
			setSubmitError(
				scriptError?.message ??
					"스크립트 저장에 실패했습니다. 다시 시도해주세요.",
			);
			setSaving(false);
			return;
		}

		if (longformScenes.length > 0) {
			const scenesPayload = longformScenes.map((s, i) => {
				const srcIdx = s.sourceIndex ?? -1;
				const source = srcIdx >= 0 ? sources[srcIdx] : null;
				// 이미지/기사 자료의 URL을 source_url로 설정
				const sourceUrl = source?.url ?? "";

				const newsTitle =
					s.newsTitle?.trim() || source?.eventTitle || source?.title || "";
				const newsSource = s.newsSource?.trim() || source?.publisher || "";
				const newsExcerpt =
					s.newsExcerpt?.trim() ||
					source?.description ||
					source?.bodyText ||
					"";
				const newsDate = s.newsDate?.trim() || source?.eventDate || "";

				// 자동 모션 그래픽 할당 (숫자/인용/반전/출처 기반)
				const motionGraphics = assignMotionGraphicsForScene({
					narration_text: s.narration,
					scene_type: s.type,
					duration_seconds: s.duration,
					news_title: newsTitle,
					news_source: newsSource,
				});

				// LUT 색보정 프리셋 — 씬 mood + 템플릿 lighting
				const colorGrade = suggestColorGrade(
					s.mood ?? referenceTemplate?.visual_mood ?? "neutral",
					referenceTemplate?.lighting_style,
				);

				return {
					script_id: script.id,
					order_index: i,
					narration_text: s.narration,
					scene_type: s.type,
					visual_prompt: s.visualPrompt,
					duration_seconds: s.duration,
					source_index: srcIdx,
					source_url: sourceUrl,
					news_title: newsTitle,
					news_source: newsSource,
					news_excerpt: newsExcerpt,
					news_date: newsDate,
					shots: s.shots ?? [],
					motion_graphics: motionGraphics,
					color_grade: colorGrade,
				};
			});

			const { error: scenesError } = await supabase
				.from("scenes")
				.insert(scenesPayload);
			if (scenesError) {
				console.error("씬 저장 실패:", scenesError);
				setSaving(false);
				return;
			}
		}

		onNext(script.id);
	}

	if (generating) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg text-center py-fluid-lg">
				<PSpinner size="medium" />
				<PText className="mt-static-md" color="contrast-medium">
					쇼츠/롱폼 스크립트를 AI가 생성 중입니다...
				</PText>
				<PText size="x-small" color="contrast-medium" className="mt-static-xs">
					브리프를 바탕으로 씬 구성과 나레이션을 작성합니다
				</PText>
			</div>
		);
	}

	if (genError) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg">
				<PInlineNotification
					heading="스크립트 생성 실패"
					description={genError}
					state="error"
					dismissButton={false}
				/>
				<div className="flex gap-static-sm mt-static-lg">
					<PButton variant="secondary" onClick={onBack}>
						이전
					</PButton>
					<PButton onClick={() => doGenerate()}>다시 시도</PButton>
				</div>
			</div>
		);
	}

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<div className="flex items-center gap-static-sm mb-static-sm">
				<PHeading size="medium" tag="h2">
					3단계: 스크립트
				</PHeading>
				<PTag color="background-frosted" icon="ai-spark">
					AI 생성
				</PTag>
			</div>
			<PText size="small" color="contrast-medium" className="mb-static-lg">
				생성된 스크립트를 검토하고 수정하세요.
			</PText>

			<div className="flex gap-static-sm mb-static-lg">
				{(["both", "shorts", "longform"] as const).map((f) => (
					<TabButton key={f} active={format === f} onClick={() => setFormat(f)}>
						{f === "both"
							? "쇼츠 + 롱폼"
							: f === "shorts"
								? "쇼츠만"
								: "롱폼만"}
					</TabButton>
				))}
			</div>

			{(format === "shorts" || format === "both") && (
				<div className="mb-static-lg">
					<div className="flex items-center gap-static-sm mb-static-sm">
						<PHeading size="small" tag="h3">
							쇼츠 스크립트
						</PHeading>
						<PTag color="notification-info-soft">9:16</PTag>
					</div>
					<PTextarea
						name="shortsScript"
						label=""
						hideLabel
						value={shortsScript}
						rows={10}
						onInput={(e) =>
							setShortsScript((e.target as HTMLTextAreaElement).value)
						}
					/>
				</div>
			)}

			{(format === "longform" || format === "both") && (
				<div>
					<div className="flex items-center gap-static-sm mb-static-md">
						<PHeading size="small" tag="h3">
							롱폼 씬 구성
						</PHeading>
						<PTag color="notification-info-soft">16:9</PTag>
						<PText size="x-small" color="contrast-medium">
							{longformScenes.length}개 씬 / 총{" "}
							{longformScenes.reduce((sum, s) => sum + s.duration, 0)}초
						</PText>
						<PText size="x-small" color="contrast-medium">
							총{" "}
							{longformScenes.reduce(
								(sum, scene) => sum + (scene.shots?.length ?? 0),
								0,
							)}
							개 샷
						</PText>
						{mode === "research" && sources.length > 0 && (
							<PButton
								compact
								variant="secondary"
								loading={aligningSources}
								onClick={async () => {
									const alignedScenes =
										await alignScenesToTimeline(longformScenes);
									setLongformScenes(alignedScenes);
								}}
							>
								사건 순서대로 자료 재배치
							</PButton>
						)}
						<PButton compact variant="secondary" onClick={rebuildAllSceneShots}>
							샷 재구성
						</PButton>
					</div>

					<div className="flex flex-col gap-static-md">
						{longformScenes.map((scene, i) => {
							const assignedSource =
								scene.sourceIndex != null && scene.sourceIndex >= 0
									? sources[scene.sourceIndex]
									: null;
							const compatibleSources = sources.filter((source) =>
								isSourceCompatible(scene.type, source.type),
							);

							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: scenes have no stable ID in local state
								<div key={i} className="bg-canvas rounded-[4px] p-static-md">
									{/* 헤더: 씬 번호 + 타입 선택 + 길이 */}
									<div className="flex items-center justify-between mb-static-sm">
										<PText weight="semi-bold" size="small">
											씬 {i + 1}
										</PText>
										<div className="flex items-center gap-static-xs">
											{(
												[
													"image",
													"video",
													"text_emphasis",
													"news_overlay",
												] as const
											).map((t) => (
												<button
													key={t}
													type="button"
													className={`px-2 py-0.5 rounded text-[11px] border transition-colors cursor-pointer ${
														scene.type === t
															? "bg-primary text-[#fff] border-primary"
															: "bg-surface text-contrast-medium border-contrast-low hover:border-primary"
													}`}
													onClick={() => updateScene(i, "type", t)}
												>
													{t === "image"
														? "이미지"
														: t === "video"
															? "영상"
															: t === "text_emphasis"
																? "텍스트"
																: "뉴스"}
												</button>
											))}
											<PText size="x-small" color="contrast-medium">
												{scene.duration}초
											</PText>
										</div>
									</div>

									{/* 나레이션 */}
									<PTextarea
										name={`scene-${i}`}
										label="나레이션"
										hideLabel
										value={scene.narration}
										rows={2}
										onInput={(e) =>
											updateScene(
												i,
												"narration",
												(e.target as HTMLTextAreaElement).value,
											)
										}
									/>

									{(scene.newsDate || scene.newsTitle) && (
										<div className="mt-static-xs flex items-center gap-static-xs flex-wrap">
											{scene.newsDate && (
												<PTag color="background-surface">{scene.newsDate}</PTag>
											)}
											{scene.newsTitle && (
												<PText size="x-small" color="contrast-medium">
													{scene.newsTitle}
												</PText>
											)}
										</div>
									)}

									{/* 자료 매핑 — research 모드에서만 */}
									{mode === "research" && sources.length > 0 && (
										<div className="mt-static-sm">
											<PText
												size="x-small"
												color="contrast-medium"
												className="mb-1"
											>
												자료 연결:
											</PText>
											<div className="flex items-center gap-2 flex-wrap">
												{/* 현재 배정된 자료 표시 */}
												{assignedSource ? (
													<div className="flex items-center gap-2 bg-surface rounded px-2 py-1">
														{assignedSource.type === "image" &&
															assignedSource.thumbnail && (
																<img
																	src={assignedSource.thumbnail}
																	alt=""
																	className="w-10 h-7 rounded object-cover"
																/>
															)}
														{assignedSource.type === "article" && (
															<Newspaper size={14} className="text-[#e63946]" />
														)}
														<span className="text-[11px] max-w-[120px] truncate">
															{assignedSource.eventTitle ||
																assignedSource.title}
														</span>
														<button
															type="button"
															className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-contrast-low transition-colors cursor-pointer bg-transparent border-0"
															onClick={() => updateScene(i, "sourceIndex", -1)}
														>
															<X size={10} />
														</button>
													</div>
												) : (
													<span className="text-[11px] text-contrast-medium italic">
														{scene.type === "news_overlay"
															? "기사 자료를 선택하세요"
															: "AI 생성 (자료 미지정)"}
													</span>
												)}

												{/* 자료 선택 버튼들 */}
												<div className="flex gap-1 overflow-x-auto">
													{compatibleSources.map((src) => {
														const si = sources.findIndex(
															(candidate) => candidate.id === src.id,
														);
														const isAssigned = scene.sourceIndex === si;
														if (isAssigned) return null;
														return (
															<button
																key={src.id}
																type="button"
																className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border border-contrast-low hover:border-primary transition-colors cursor-pointer bg-transparent text-[10px]"
																title={src.eventTitle || src.title}
																onClick={() =>
																	updateScene(i, "sourceIndex", si)
																}
															>
																{src.type === "image" && src.thumbnail && (
																	<img
																		src={src.thumbnail}
																		alt=""
																		className="w-6 h-4 rounded-sm object-cover"
																	/>
																)}
																{src.type === "image" && !src.thumbnail && (
																	<ImagePlus size={10} />
																)}
																{src.type === "article" && (
																	<Newspaper
																		size={10}
																		className="text-[#e63946]"
																	/>
																)}
																<span className="max-w-[60px] truncate">
																	{src.eventTitle || src.title}
																</span>
															</button>
														);
													})}
													{compatibleSources.length === 0 && (
														<span className="text-[11px] text-contrast-medium italic">
															이 씬 타입에 맞는 자료가 없습니다
														</span>
													)}
												</div>
											</div>
										</div>
									)}

									<div className="mt-static-sm bg-surface rounded p-2">
										<div className="flex items-center justify-between gap-static-sm mb-2">
											<PText size="x-small" color="contrast-medium">
												샷 구성 ({scene.shots?.length ?? 0}개)
											</PText>
											<PButton
												compact
												variant="tertiary"
												onClick={() => rebuildSceneShots(i)}
											>
												샷 재구성
											</PButton>
										</div>
										<div className="flex flex-col gap-2">
											{(scene.shots ?? []).map((shot, shotIndex) => (
												<div
													key={shot.id}
													className="grid grid-cols-1 md:grid-cols-[76px_110px_88px_minmax(0,1fr)] gap-2"
												>
													<PTag color="background-surface">
														샷 {shotIndex + 1}
													</PTag>
													<select
														value={shot.motion ?? "static"}
														onChange={(e) =>
															updateShot(i, shotIndex, "motion", e.target.value)
														}
														className="text-[12px] px-2 py-1.5 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
													>
														<option value="static">고정</option>
														<option value="slow_zoom_in">줌 인</option>
														<option value="slow_zoom_out">줌 아웃</option>
														<option value="pan_left">좌 패닝</option>
														<option value="pan_right">우 패닝</option>
														<option value="drift">드리프트</option>
														<option value="push_in">강한 푸시인</option>
													</select>
													<input
														type="number"
														min="0.8"
														step="0.1"
														value={shot.duration_seconds}
														onChange={(e) =>
															updateShot(
																i,
																shotIndex,
																"duration_seconds",
																Number(e.target.value),
															)
														}
														className="text-[12px] px-2 py-1.5 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
													/>
													<input
														type="text"
														value={shot.caption ?? ""}
														onChange={(e) =>
															updateShot(
																i,
																shotIndex,
																"caption",
																e.target.value,
															)
														}
														placeholder="샷 설명 / 오버레이 문구"
														className="text-[12px] px-2 py-1.5 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
													/>
												</div>
											))}
										</div>
									</div>

									{/* news_overlay 필드 편집 */}
									{scene.type === "news_overlay" && (
										<div className="mt-static-sm bg-surface rounded p-2 flex flex-col gap-1.5 border-l-4 border-[#e63946]">
											<div className="flex gap-2">
												<input
													type="text"
													placeholder="헤드라인"
													value={scene.newsTitle ?? ""}
													onChange={(e) =>
														updateScene(i, "newsTitle", e.target.value)
													}
													className="flex-1 text-[13px] px-2 py-1 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
												/>
												<input
													type="text"
													placeholder="출처"
													value={scene.newsSource ?? ""}
													onChange={(e) =>
														updateScene(i, "newsSource", e.target.value)
													}
													className="w-28 text-[13px] px-2 py-1 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
												/>
											</div>
											<div className="flex gap-2">
												<input
													type="text"
													placeholder="핵심 발췌문"
													value={scene.newsExcerpt ?? ""}
													onChange={(e) =>
														updateScene(i, "newsExcerpt", e.target.value)
													}
													className="flex-1 text-[13px] px-2 py-1 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
												/>
												<input
													type="text"
													placeholder="날짜"
													value={scene.newsDate ?? ""}
													onChange={(e) =>
														updateScene(i, "newsDate", e.target.value)
													}
													className="w-28 text-[13px] px-2 py-1 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
												/>
											</div>
										</div>
									)}

									{/* 비주얼 프롬프트 (news_overlay가 아닌 경우) */}
									{scene.type !== "news_overlay" && (
										<div className="mt-static-sm">
											<PText size="x-small" color="contrast-medium">
												비주얼: {scene.visualPrompt}
											</PText>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			<PDivider className="my-static-lg" />

			{submitError && (
				<PInlineNotification
					state="error"
					heading="저장 실패"
					description={submitError}
					dismissButton={false}
					className="mb-static-md"
				/>
			)}

			<div className="flex justify-between">
				<PButton variant="secondary" onClick={onBack}>
					이전
				</PButton>
				<div className="flex gap-static-sm">
					<PButton
						variant="secondary"
						icon="ai-spark"
						onClick={() => doGenerate()}
					>
						다시 생성
					</PButton>
					<PButton loading={saving} onClick={handleSubmit}>
						다음: 미디어 생성
					</PButton>
				</div>
			</div>
		</div>
	);
}
