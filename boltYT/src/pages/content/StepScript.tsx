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
import {
	ArrowDown,
	ArrowUp,
	Copy,
	FilePlus2,
	ImagePlus,
	Newspaper,
	PencilLine,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TabButton from "../../components/TabButton";
import {
	analyzeAnimationProductionReadiness,
	applyAnimationPacingRules,
	ensureAnimationSceneShots,
	formatAnimationReadinessForPrompt,
	summarizeAnimationBible,
	type AnimationBible,
	type AnimationProductionFamily,
	type AnimationProductionReadinessReport,
} from "../../lib/animation-production";
import { generateResearchScript, generateScript } from "../../lib/ai";
import { planSceneSourceAssignments, researchTopic } from "../../lib/ai-agents";
import { snapDurationToBeat } from "../../lib/beat-sync";
import { suggestColorGrade } from "../../lib/color-grades";
import {
	type ContentPerformanceSample,
	type RankedScriptRecommendation,
} from "../../lib/content-recommendation-ranker";
import {
	buildReferenceKnowledgeProfile,
	compactKnowledgeProfile,
} from "../../lib/knowledge-system";
import {
	assessReferenceApplicationScore,
	type ReferenceApplicationScoreReport,
} from "../../lib/reference-application-score";
import { buildReferenceProductionPlan } from "../../lib/reference-production-orchestrator";
import { assignMotionGraphicsForScene } from "../../lib/motion-graphics";
import { referenceToPreset } from "../../lib/reference-bridge";
import {
	getReferenceTemplateReadiness,
	getReferenceTemplateSupportedFormats,
} from "../../lib/reference-template-presets";
import {
	formatNicheHandoffForPrompt,
	type NicheResearchHandoff,
} from "../../lib/niche-research";
import {
	applySceneSourcePlan,
	buildFallbackSceneSourcePlan,
} from "../../lib/scene-sequence";
import type { SceneShot } from "../../lib/scene-shot-types";
import {
	analyzeSourceSafety,
	type SourceSafetyReport,
} from "../../lib/source-safety-gate";
import {
	applyLongformVideoRules,
	applyShortsVideoRules,
	buildSceneShots,
	ensureSceneShots,
	intensifyHookScenes,
	isSourceCompatible,
	rebalanceScenesForMotion,
	type ShotSource,
	syncSceneMetadataFromSource,
} from "../../lib/scene-shots";
import { supabase } from "../../lib/supabase";
import {
	buildStoryEditDraft,
	createEmptyStoryEditDraft,
	deleteStoryScene,
	duplicateStoryScene,
	insertStorySceneAfter,
	moveStoryScene,
	summarizeStoryEditDraft,
	type StoryEditDraft,
} from "../../lib/story-editing";
import {
	analyzeTopicProductionReadiness,
	type TopicProductionReadinessReport,
} from "../../lib/topic-production-readiness";
import { strengthenOpeningRetention } from "../../lib/youtube-retention";
import type { ReferenceTemplate } from "../../types/database";
import type { CollectedSource, ContentMode } from "./ContentWizardPage";

interface StepScriptProps {
	briefId: string;
	mode?: ContentMode;
	sources?: CollectedSource[];
	referenceTemplate?: ReferenceTemplate | null;
	referenceCandidates?: ReferenceTemplate[];
	nicheHandoff?: NicheResearchHandoff | null;
	topicTitle?: string;
	performanceHistory?: ContentPerformanceSample[];
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
	productionFamily?: AnimationProductionFamily;
}

export default function StepScript({
	briefId,
	mode = "ai",
	sources = [],
	referenceTemplate,
	referenceCandidates = [],
	nicheHandoff,
	topicTitle: initialTopicTitle = "",
	performanceHistory = [],
	onNext,
	onBack,
}: StepScriptProps) {
	const [format, setFormat] = useState<"shorts" | "longform" | "both">(() => {
		if (!referenceTemplate) return "both";
		const supported = getReferenceTemplateSupportedFormats(referenceTemplate);
		if (supported.length === 1) return supported[0];
		return "both";
	});
	const [storyDraft, setStoryDraft] = useState<StoryEditDraft>(() =>
		createEmptyStoryEditDraft(),
	);
	const [shortsScript, setShortsScript] = useState("");
	const [longformScenes, setLongformScenes] = useState<SceneData[]>([]);
	const [generating, setGenerating] = useState(true);
	const [saving, setSaving] = useState(false);
	const [genError, setGenError] = useState("");
	const [submitError, setSubmitError] = useState("");
	const [searchKeywords, setSearchKeywords] = useState<string[]>([]);
	const [resolvedTopicTitle, setResolvedTopicTitle] = useState(initialTopicTitle);
	const [aligningSources, setAligningSources] = useState(false);
	const [topicReadiness, setTopicReadiness] =
		useState<TopicProductionReadinessReport | null>(null);
	const [animationReadiness, setAnimationReadiness] =
		useState<AnimationProductionReadinessReport | null>(null);
	const [animationBible, setAnimationBible] = useState<
		AnimationBible | undefined
	>(undefined);
	const productionPlan = useMemo(
		() =>
			buildReferenceProductionPlan({
				topicTitle: resolvedTopicTitle || initialTopicTitle,
				mode,
				selectedFormat: format,
				sources,
				referenceTemplate,
				referenceCandidates,
				nicheHandoff,
				performanceHistory,
			}),
		[
			resolvedTopicTitle,
			initialTopicTitle,
			mode,
			format,
			sources,
			referenceTemplate,
			referenceCandidates,
			nicheHandoff,
			performanceHistory,
		],
	);
	const effectiveReferenceTemplate =
		referenceTemplate ?? productionPlan.selectedTemplate;
	const recommendationPlan = productionPlan.recommendationPlan;
	const referenceApplicationReport = useMemo(
		() =>
			assessReferenceApplicationScore({
				referenceTemplate: effectiveReferenceTemplate,
				format,
				topicTitle: resolvedTopicTitle || initialTopicTitle,
				shortsScript,
				scenes: longformScenes,
				sourceCount: sources.length,
			}),
		[
			effectiveReferenceTemplate,
			format,
			resolvedTopicTitle,
			initialTopicTitle,
			shortsScript,
			longformScenes,
			sources.length,
		],
	);
	const sourceSafetyReport = useMemo<SourceSafetyReport | null>(
		() =>
			mode === "research"
				? analyzeSourceSafety(sources, longformScenes)
				: null,
		[mode, sources, longformScenes],
	);

	useEffect(() => {
		if (!effectiveReferenceTemplate) return;
		const supported = getReferenceTemplateSupportedFormats(effectiveReferenceTemplate);
		if (supported.length !== 1) return;
		setFormat((current) => (current === supported[0] ? current : supported[0]));
	}, [effectiveReferenceTemplate]);

	useEffect(() => {
		if (!initialTopicTitle.trim()) return;
		setResolvedTopicTitle(initialTopicTitle.trim());
	}, [initialTopicTitle]);

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
			shots:
				mode === "animation"
					? ensureAnimationSceneShots(
							scene,
							animationBible,
							animationReadiness?.productionFamily,
						)
					: ensureSceneShots(scene, toShotSources(sources)),
		}),
		[animationBible, animationReadiness?.productionFamily, mode, sources, toShotSources],
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
		async (
			baseScenes: SceneData[],
			currentAnimationBible?: AnimationBible,
			currentAnimationFamily?: AnimationProductionFamily,
		) => {
			if (baseScenes.length === 0) {
				return baseScenes;
			}

			const finalizeScenes = (scenesToFinalize: SceneData[]) => {
				const shotSources = toShotSources(sources);
				const family =
					currentAnimationFamily ?? animationReadiness?.productionFamily;
				const referenceLongformTarget =
					effectiveReferenceTemplate && format !== "shorts"
						? referenceToPreset(effectiveReferenceTemplate, "longform").script
								.targetDuration
						: undefined;
				const adjusted =
					mode === "animation"
						? applyAnimationPacingRules(scenesToFinalize, format, family)
						: format === "shorts"
							? intensifyHookScenes(
									applyShortsVideoRules(
										rebalanceScenesForMotion(scenesToFinalize, shotSources),
										shotSources,
									),
								)
							: applyLongformVideoRules(scenesToFinalize, shotSources, {
									targetTotalSeconds: referenceLongformTarget,
								});
				const retentionAdjusted = strengthenOpeningRetention(adjusted, {
					format,
				});
				return retentionAdjusted.map((scene) =>
					mode === "animation"
						? {
								...scene,
								shots: ensureAnimationSceneShots(
									scene,
									currentAnimationBible ?? animationBible,
									family,
								),
							}
						: applySceneShots(scene),
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
		[
			animationBible,
			animationReadiness?.productionFamily,
			applySceneShots,
			format,
			mode,
			effectiveReferenceTemplate,
			sources,
			toShotSources,
		],
	);

	const doGenerate = useCallback(async () => {
		setGenerating(true);
		setGenError("");
		try {
			// Research Director: 주제 리서치 → 팩트 수집
			let brief: Awaited<ReturnType<typeof researchTopic>> | undefined;
			let currentTopicTitle = initialTopicTitle.trim();
			setTopicReadiness(null);
			setAnimationReadiness(null);
			if (mode === "research") {
				try {
					const { data: topic } = await supabase
						.from("topics")
						.select("title")
						.eq("id", briefId)
						.maybeSingle();
					currentTopicTitle = currentTopicTitle || topic?.title || "";
					if (currentTopicTitle) {
						brief = await researchTopic(currentTopicTitle);
						if (brief?.search_keywords?.length) {
							setSearchKeywords(brief.search_keywords);
						}
					}
				} catch {
					// 리서치 실패해도 스크립트 생성은 진행
				}
			} else {
				try {
					const { data: briefRow } = await supabase
						.from("briefs")
						.select("core_message, topics(title)")
						.eq("id", briefId)
						.maybeSingle();
					const topic = (briefRow as Record<string, unknown> | null)?.topics as
						| Record<string, unknown>
						| undefined;
					const fetchedTopicTitle =
						(topic?.title as string | undefined) ??
						((briefRow as Record<string, unknown> | null)?.core_message as
							| string
							| undefined) ??
						"";
					currentTopicTitle = currentTopicTitle || fetchedTopicTitle;
				} catch {
					// 브리프 제목 조회 실패 시 아래 게이트가 보수적으로 판단
				}
			}
			setResolvedTopicTitle(currentTopicTitle);

			const readiness =
				mode === "research"
					? analyzeTopicProductionReadiness({
							topicTitle: currentTopicTitle,
							format,
							sources,
							researchBrief: brief,
						})
					: null;
			setTopicReadiness(readiness);
			if (readiness && !readiness.canGenerate) {
				setShortsScript("");
				setLongformScenes([]);
				setGenError(
					`제작 보류: ${readiness.requiredActions[0] ?? "자료를 보강한 뒤 다시 생성하세요."}`,
				);
				return;
			}
			const animationGate =
				mode === "animation"
					? analyzeAnimationProductionReadiness({
							topicTitle: currentTopicTitle,
							format,
						})
					: null;
			setAnimationReadiness(animationGate);
			if (animationGate && !animationGate.canGenerate) {
				setShortsScript("");
				setLongformScenes([]);
				setGenError(
					`애니메이션 제작 보류: ${
						animationGate.requiredActions[0] ??
						"주인공과 갈등이 드러나도록 주제를 보강하세요."
					}`,
				);
				return;
			}
			const referenceReadiness = referenceTemplate
				? getReferenceTemplateReadiness(referenceTemplate)
				: null;
			if (referenceReadiness?.status === "blocked") {
				setShortsScript("");
				setLongformScenes([]);
				setGenError(
					`레퍼런스 품질 보류: ${referenceReadiness.summary}. ${referenceReadiness.action}`,
				);
				return;
			}

			const preset = effectiveReferenceTemplate
				? referenceToPreset(
						effectiveReferenceTemplate,
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
							readiness ?? undefined,
							nicheHandoff
								? formatNicheHandoffForPrompt(nicheHandoff)
								: undefined,
							productionPlan.promptContext,
						)
					: await generateScript(
							briefId,
							format,
							preset,
							mode === "animation" ? "animation" : "standard",
							animationGate ?? undefined,
							productionPlan.promptContext,
						);
			setAnimationBible(script.animation_bible);
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
				const snappedDuration = effectiveReferenceTemplate?.bgm_tempo
					? snapDurationToBeat(s.duration, effectiveReferenceTemplate.bgm_tempo)
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
					productionFamily: animationGate?.productionFamily,
				};
			});
			const alignedScenes = await alignScenesToTimeline(
				mappedScenes,
				script.animation_bible,
				animationGate?.productionFamily,
			);
			setLongformScenes(alignedScenes);
			setStoryDraft(
				buildStoryEditDraft({
					shortsScript: script.shorts_script || "",
					scenes: alignedScenes,
					referenceName: effectiveReferenceTemplate?.name,
					format,
				}),
			);
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
		initialTopicTitle,
		format,
		mode,
		sources,
		referenceTemplate,
		effectiveReferenceTemplate,
		nicheHandoff,
		productionPlan.promptContext,
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

	function updateStoryDraft(field: keyof StoryEditDraft, value: string) {
		setStoryDraft((current) => ({
			...current,
			[field]: value,
			updatedAt: new Date().toISOString(),
		}));
	}

	function applyScriptRecommendation(candidate: RankedScriptRecommendation) {
		if (candidate.format === "shorts" || candidate.format === "longform") {
			setFormat(candidate.format);
		}
		setStoryDraft((current) => ({
			...current,
			hook: candidate.hook,
			storyAngle: candidate.structure,
			viewerQuestion: candidate.viewerQuestion,
			endingBeat: candidate.endingBeat,
			mustKeep: [
				candidate.durationLabel,
				...candidate.scriptBeats.slice(0, 2),
			].join(" · "),
			avoid: candidate.risks.slice(0, 3).join(" · "),
			editorNotes: [
				`추천 #${candidate.rank} ${candidate.title} (${candidate.score}점)`,
				`근거: ${candidate.reasons.slice(0, 2).join(" / ")}`,
				`썸네일: ${candidate.thumbnailAngle}`,
			].join("\n"),
			updatedAt: new Date().toISOString(),
		}));
		if (!shortsScript.trim()) {
			setShortsScript(
				[
					`[훅] ${candidate.hook}`,
					"",
					...candidate.scriptBeats.map((beat) => `- ${beat}`),
					"",
					`[마무리] ${candidate.endingBeat}`,
				].join("\n"),
			);
		}
	}

	function applyHookRecommendation(hook: string) {
		updateStoryDraft("hook", hook);
	}

	function moveScene(index: number, direction: -1 | 1) {
		setLongformScenes((prev) => moveStoryScene(prev, index, direction));
	}

	function duplicateScene(index: number) {
		setLongformScenes((prev) =>
			duplicateStoryScene(prev, index).map((scene, sceneIndex) =>
				sceneIndex === index + 1 ? applySceneShots(scene) : scene,
			),
		);
	}

	function insertSceneAfter(index: number) {
		setLongformScenes((prev) =>
			insertStorySceneAfter(prev, index, {
				narration:
					"새 장면입니다. 여기서 스토리 전환, 반전, 추가 증거를 작성하세요.",
				type: "image",
				visualPrompt:
					"cinematic documentary insert shot, relevant evidence, clean composition",
				duration: 8,
			}).map((scene, sceneIndex) =>
				sceneIndex === index + 1 ? applySceneShots(scene) : scene,
			),
		);
	}

	function deleteSceneAt(index: number) {
		setLongformScenes((prev) => deleteStoryScene(prev, index));
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
									field === "duration_seconds" &&
									!Number.isFinite(Number(value))
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
					? {
							...scene,
							shots:
								mode === "animation"
									? ensureAnimationSceneShots(
											{ ...scene, shots: [] },
											animationBible,
											animationReadiness?.productionFamily,
										)
									: buildSceneShots(scene, toShotSources(sources)),
						}
					: scene,
			),
		);
	}

	function rebuildAllSceneShots() {
		setLongformScenes((prev) =>
			prev.map((scene) => ({
				...scene,
				shots:
					mode === "animation"
						? ensureAnimationSceneShots(
								{ ...scene, shots: [] },
								animationBible,
								animationReadiness?.productionFamily,
							)
						: buildSceneShots(scene, toShotSources(sources)),
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
					production_type:
						mode === "animation"
							? "animation"
							: mode === "research"
								? "documentary"
								: "standard",
					animation_bible: animationBible,
					animation_readiness: animationReadiness,
					production_family: animationReadiness?.productionFamily,
					production_family_label: animationReadiness?.productionFamilyLabel,
					topic_readiness: topicReadiness,
					story_edit: storyDraft,
					story_edit_summary: summarizeStoryEditDraft(storyDraft),
					content_recommendation_plan: recommendationPlan,
					reference_application_report: referenceApplicationReport,
					source_safety_report: sourceSafetyReport,
					reference_knowledge: effectiveReferenceTemplate
						? compactKnowledgeProfile(
								buildReferenceKnowledgeProfile(effectiveReferenceTemplate),
							)
						: null,
					niche_research: nicheHandoff
						? {
								id: nicheHandoff.id,
								topic: nicheHandoff.topic,
								query: nicheHandoff.summary.query,
								decision: nicheHandoff.playbook.decision,
								score: nicheHandoff.playbook.score,
								playbook: nicheHandoff.playbook,
							}
						: null,
				},
				status: "approved",
				reference_template_id: effectiveReferenceTemplate?.id ?? null,
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
					s.mood ?? effectiveReferenceTemplate?.visual_mood ?? "neutral",
					effectiveReferenceTemplate?.lighting_style,
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

	function renderTopicReadinessPanel() {
		if (!topicReadiness || mode !== "research") return null;
		const state: "error" | "warning" | "info" =
			topicReadiness.status === "blocked"
				? "error"
				: topicReadiness.status === "needs_reframe"
					? "warning"
					: "info";
		const heading =
			topicReadiness.status === "blocked"
				? "제작 보류: 입력 자료 부족"
				: topicReadiness.status === "needs_reframe"
					? "재기획 권고: 자료 밀도 부족"
					: "프리프로덕션 통과";
		const primaryIssue =
			topicReadiness.issues[0]?.message ??
			"현재 자료로 사건 흐름 기반 제작이 가능합니다.";

		return (
			<div className="mb-static-md">
				<PInlineNotification
					state={state}
					heading={`${heading} · ${topicReadiness.score}/100`}
					description={primaryIssue}
					dismissButton={false}
				/>
				<div className="mt-static-sm bg-canvas rounded-[4px] p-static-sm">
					<div className="flex items-center gap-static-xs flex-wrap mb-static-xs">
						<PTag color="background-frosted">
							각도: {topicReadiness.recommendedAngle}
						</PTag>
						<PTag color="background-surface">
							추천 형식: {topicReadiness.recommendedFormat}
						</PTag>
						<PTag color="background-surface">
							팩트 자료 {topicReadiness.metrics.factualSourceCount}개
						</PTag>
						<PTag color="background-surface">
							본문 {topicReadiness.metrics.totalTextChars}자
						</PTag>
						<PTag color="background-surface">
							영상 {topicReadiness.metrics.videoSourceCount}개
						</PTag>
					</div>
					{topicReadiness.requiredActions.length > 0 && (
						<div className="mb-static-xs">
							<PText size="x-small" weight="semi-bold">
								필수 보강
							</PText>
							<ul className="mt-1 list-disc pl-4 text-[12px] text-contrast-medium">
								{topicReadiness.requiredActions.slice(0, 3).map((action) => (
									<li key={action}>{action}</li>
								))}
							</ul>
						</div>
					)}
					{topicReadiness.reframeOptions.length > 0 && (
						<div>
							<PText size="x-small" weight="semi-bold">
								재기획 방향
							</PText>
							<ul className="mt-1 list-disc pl-4 text-[12px] text-contrast-medium">
								{topicReadiness.reframeOptions.slice(0, 3).map((option) => (
									<li key={option}>{option}</li>
								))}
							</ul>
						</div>
					)}
				</div>
			</div>
		);
	}

	function renderAnimationReadinessPanel() {
		if (!animationReadiness || mode !== "animation") return null;
		const state: "error" | "warning" | "info" =
			animationReadiness.status === "blocked"
				? "error"
				: animationReadiness.status === "needs_development"
					? "warning"
					: "info";
		const heading =
			animationReadiness.status === "blocked"
				? "애니메이션 제작 보류"
				: animationReadiness.status === "needs_development"
					? "스토리 개발 권고"
					: "애니메이션 프리프로덕션 통과";
		const primaryIssue =
			animationReadiness.issues[0]?.message ??
			"현재 입력으로 캐릭터/스토리보드 기반 제작이 가능합니다.";

		return (
			<div className="mb-static-md">
				<PInlineNotification
					state={state}
					heading={`${heading} · ${animationReadiness.score}/100`}
					description={primaryIssue}
					dismissButton={false}
				/>
				<div className="mt-static-sm bg-canvas rounded-[4px] p-static-sm">
					<div className="flex items-center gap-static-xs flex-wrap mb-static-xs">
						<PTag color="background-frosted">
							포맷: {animationReadiness.productionFamilyLabel}
						</PTag>
						<PTag color="background-surface">
							스타일: {animationReadiness.recommendedAnimationStyle}
						</PTag>
						<PTag color="background-surface">
							각도: {animationReadiness.storyAngle}
						</PTag>
						<PTag color="background-surface">
							추천 형식: {animationReadiness.recommendedFormat}
						</PTag>
					</div>
					{animationBible && (
						<PText size="x-small" color="contrast-medium" className="mb-1">
							캐릭터 바이블: {summarizeAnimationBible(animationBible)}
						</PText>
					)}
					{animationReadiness.requiredActions.length > 0 && (
						<ul className="mt-1 list-disc pl-4 text-[12px] text-contrast-medium">
							{animationReadiness.requiredActions
								.slice(0, 3)
								.map((action) => (
									<li key={action}>{action}</li>
							))}
						</ul>
					)}
					{animationReadiness.qualityGates.length > 0 && (
						<div className="mt-static-xs">
							<PText size="x-small" weight="semi-bold">
								포맷별 품질 게이트
							</PText>
							<ul className="mt-1 list-disc pl-4 text-[12px] text-contrast-medium">
								{animationReadiness.qualityGates.slice(0, 3).map((gate) => (
									<li key={gate}>{gate}</li>
								))}
							</ul>
						</div>
					)}
					{animationReadiness.riskControls.length > 0 && (
						<div className="mt-static-xs">
							<PText size="x-small" weight="semi-bold">
								레퍼런스 리스크 제어
							</PText>
							<ul className="mt-1 list-disc pl-4 text-[12px] text-contrast-medium">
								{animationReadiness.riskControls
									.slice(0, 2)
									.map((control) => (
										<li key={control}>{control}</li>
									))}
							</ul>
						</div>
					)}
					<details className="mt-static-xs text-[12px] text-contrast-medium">
						<summary className="cursor-pointer">프롬프트 지시 보기</summary>
						<pre className="mt-1 whitespace-pre-wrap text-[11px]">
							{formatAnimationReadinessForPrompt(animationReadiness)}
						</pre>
					</details>
				</div>
			</div>
		);
	}

	function renderReferenceApplicationPanel() {
		return (
			<ReferenceApplicationPanel
				report={referenceApplicationReport}
				sourceSafetyReport={sourceSafetyReport}
			/>
		);
	}

	function renderNicheHandoffPanel(handoff: NicheResearchHandoff) {
		return (
			<div className="mb-static-md bg-canvas rounded-[4px] p-static-sm border border-contrast-low">
				<div className="flex items-center gap-static-xs flex-wrap mb-static-xs">
					<PTag color="notification-info-soft">니치 플레이북 적용</PTag>
					<PTag color="background-surface">{handoff.playbook.score}점</PTag>
					<PTag color="background-surface">{handoff.summary.query}</PTag>
				</div>
				<PText size="small" weight="semi-bold">
					{handoff.topic}
				</PText>
				<PText size="x-small" color="contrast-medium" className="mt-1">
					{handoff.playbook.openingFormula.slice(0, 2).join(" · ")}
				</PText>
			</div>
		);
	}

	function renderRecommendationPanel() {
		const topScript = recommendationPlan.scripts[0];
		if (!topScript) return null;
		return (
			<div className="mb-static-lg rounded-[18px] border border-[#d7c3a4] bg-[#fbf3e4] p-static-md shadow-[0_18px_45px_rgba(81,54,22,0.10)]">
				<div className="flex flex-col gap-static-sm md:flex-row md:items-start md:justify-between mb-static-md">
					<div>
						<div className="flex items-center gap-static-xs flex-wrap mb-1">
							<PTag color="notification-info-soft">추천 순위</PTag>
							<PTag color="background-surface">
								{recommendationPlan.categoryLabel}
							</PTag>
							<PTag color="background-surface">
								신뢰도 {recommendationPlan.confidence}
							</PTag>
							{recommendationPlan.performanceFeedback.sampleCount > 0 && (
								<PTag color="background-surface">
									성과 {recommendationPlan.performanceFeedback.sampleCount}개 반영
								</PTag>
							)}
							{productionPlan.selectedCandidate && (
								<PTag color="notification-success-soft">
									{productionPlan.autoSelected ? "자동 레퍼런스" : "선택 레퍼런스"} R
									{productionPlan.selectedCandidate.score}
								</PTag>
							)}
						</div>
						<PHeading size="small" tag="h3">
							주제 맞춤 레퍼런스 제작 지시서
						</PHeading>
						<PText size="small" color="contrast-medium" className="mt-1">
							{recommendationPlan.topSummary}
						</PText>
						{productionPlan.selectedCandidate && (
							<PText size="x-small" color="contrast-medium" className="mt-1">
								적용 레퍼런스:{" "}
								{productionPlan.selectedCandidate.template.name ||
									productionPlan.selectedCandidate.template.source_title}{" "}
								· Q{productionPlan.selectedCandidate.qualityScore} · K
								{productionPlan.selectedCandidate.knowledgeScore} ·{" "}
								{productionPlan.selectedCandidate.categoryLabel}
							</PText>
						)}
						{recommendationPlan.performanceFeedback.sampleCount > 0 && (
							<div className="mt-2 flex flex-wrap gap-1">
								{recommendationPlan.performanceFeedback.topSignals
									.slice(0, 4)
									.map((signal) => (
										<PTag key={signal} color="background-frosted">
											{signal}
										</PTag>
									))}
							</div>
						)}
					</div>
					<PButton
						compact
						variant="secondary"
						onClick={() => applyScriptRecommendation(topScript)}
					>
						1순위 적용
					</PButton>
				</div>

				<div className="grid grid-cols-1 lg:grid-cols-3 gap-static-sm mb-static-md">
					{recommendationPlan.scripts.slice(0, 3).map((script) => (
						<div
							key={script.id}
							className={`rounded-[14px] border p-static-sm ${
								script.rank === 1
									? "bg-[#fff8ea] border-[#b8842d]"
									: "bg-[#fffdf8] border-[#e4d2b2]"
							}`}
						>
							<div className="flex items-center justify-between gap-static-xs mb-1">
								<PText size="small" weight="semi-bold">
									#{script.rank} {script.title}
								</PText>
								<PTag color="background-frosted">{script.score}점</PTag>
							</div>
							<PText size="x-small" color="contrast-medium" className="mb-2">
								{script.hook}
							</PText>
							<PText size="x-small" className="mb-2">
								{script.structure}
							</PText>
							<div className="flex flex-wrap gap-1 mb-2">
								<PTag color="background-surface">
									{script.format === "both"
										? "쇼츠+롱폼"
										: script.format === "shorts"
											? "쇼츠"
											: "롱폼"}
								</PTag>
								<PTag color="background-surface">{script.durationLabel}</PTag>
							</div>
							<ul className="list-disc pl-4 text-[11px] text-contrast-medium mb-2">
								{script.scriptBeats.slice(0, 3).map((beat) => (
									<li key={beat}>{beat}</li>
								))}
							</ul>
							<PButton
								compact
								variant="secondary"
								onClick={() => applyScriptRecommendation(script)}
							>
								이 방향 적용
							</PButton>
						</div>
					))}
				</div>

				<div className="mb-static-md grid grid-cols-1 md:grid-cols-3 gap-static-sm">
					{productionPlan.directives.slice(0, 6).map((directive) => (
						<div
							key={directive.id}
							className="rounded-[12px] border border-[#d9c5a5] bg-[#fffaf1] p-static-sm"
						>
							<div className="mb-1 flex items-center justify-between gap-2">
								<PText size="x-small" weight="semi-bold">
									{directive.label}
								</PText>
								<PTag color="background-frosted">{directive.priority}</PTag>
							</div>
							<PText size="x-small" color="contrast-medium">
								{directive.directive}
							</PText>
						</div>
					))}
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-static-sm">
					<div className="rounded-[12px] bg-[#fffdf8] border border-[#e4d2b2] p-static-sm">
						<PText size="small" weight="semi-bold" className="mb-1">
							훅 추천
						</PText>
						<div className="flex flex-col gap-1">
							{recommendationPlan.hooks.slice(0, 3).map((hook) => (
								<button
									key={hook.text}
									type="button"
									className="text-left rounded-[8px] border border-[#ead9bd] bg-[#fff8ea] p-2 hover:border-[#b8842d] transition-colors cursor-pointer"
									onClick={() => applyHookRecommendation(hook.text)}
								>
									<span className="block text-[11px] font-semibold">
										#{hook.rank} {hook.score}점 · {hook.pattern}
									</span>
									<span className="block text-[12px] text-contrast-medium">
										{hook.text}
									</span>
								</button>
							))}
						</div>
					</div>

					<div className="rounded-[12px] bg-[#fffdf8] border border-[#e4d2b2] p-static-sm">
						<PText size="small" weight="semi-bold" className="mb-1">
							썸네일 추천
						</PText>
						<div className="flex flex-col gap-1">
							{recommendationPlan.thumbnails.slice(0, 3).map((thumb) => (
								<div
									key={thumb.text}
									className="rounded-[8px] border border-[#ead9bd] bg-[#fff8ea] p-2"
								>
									<PText size="x-small" weight="semi-bold">
										#{thumb.rank} {thumb.text} · {thumb.score}점
									</PText>
									<PText size="x-small" color="contrast-medium">
										{thumb.layout}
									</PText>
								</div>
							))}
						</div>
					</div>

					<div className="rounded-[12px] bg-[#fffdf8] border border-[#e4d2b2] p-static-sm">
						<PText size="small" weight="semi-bold" className="mb-1">
							포맷 추천
						</PText>
						<div className="flex flex-col gap-1">
							{recommendationPlan.formats.slice(0, 3).map((choice) => (
								<button
									key={choice.format}
									type="button"
									className="text-left rounded-[8px] border border-[#ead9bd] bg-[#fff8ea] p-2 hover:border-[#b8842d] transition-colors cursor-pointer"
									onClick={() => setFormat(choice.format)}
								>
									<span className="block text-[11px] font-semibold">
										#{choice.rank} {choice.label} · {choice.score}점
									</span>
									<span className="block text-[12px] text-contrast-medium">
										{choice.durationRange}
									</span>
								</button>
							))}
						</div>
					</div>
				</div>

				<details className="mt-static-sm text-[12px] text-contrast-medium">
					<summary className="cursor-pointer">
						추천 근거, 레퍼런스 후보, 품질 게이트
					</summary>
					<div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-static-sm">
						<ul className="list-disc pl-4">
							{productionPlan.evidence.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
						<ul className="list-disc pl-4">
							{productionPlan.qualityGates.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					</div>
					{productionPlan.candidates.length > 1 && (
						<div className="mt-2 rounded-[10px] border border-[#e4d2b2] bg-[#fffdf8] p-2">
							<PText size="x-small" weight="semi-bold">
								레퍼런스 후보 순위
							</PText>
							<ol className="mt-1 list-decimal pl-4">
								{productionPlan.candidates.slice(0, 5).map((candidate) => (
									<li key={candidate.template.id}>
										{candidate.template.name || candidate.template.source_title} · R
										{candidate.score} · {candidate.categoryLabel}
									</li>
								))}
							</ol>
						</div>
					)}
				</details>
			</div>
		);
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
				{renderTopicReadinessPanel()}
				{renderAnimationReadinessPanel()}
				{renderRecommendationPanel()}
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

	const formatChoices: Array<"both" | "shorts" | "longform"> = (() => {
		if (!effectiveReferenceTemplate) return ["both", "shorts", "longform"];
		const supported = getReferenceTemplateSupportedFormats(effectiveReferenceTemplate);
		if (supported.length === 1) return [supported[0]];
		return ["both", ...supported];
	})();

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

			{renderTopicReadinessPanel()}
			{renderAnimationReadinessPanel()}
			{nicheHandoff && renderNicheHandoffPanel(nicheHandoff)}
			{renderRecommendationPanel()}
			{renderReferenceApplicationPanel()}
			<StoryEditPanel
				draft={storyDraft}
				referenceTemplate={effectiveReferenceTemplate}
				sceneCount={longformScenes.length}
				totalDuration={longformScenes.reduce((sum, s) => sum + s.duration, 0)}
				onChange={updateStoryDraft}
			/>

			<div className="flex gap-static-sm mb-static-lg">
				{formatChoices.map((f) => (
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
										<div className="flex items-center gap-2">
											<PText weight="semi-bold" size="small">
												씬 {i + 1}
											</PText>
											<div className="flex items-center gap-1">
												<SceneActionButton
													label="위로"
													disabled={i === 0}
													onClick={() => moveScene(i, -1)}
												>
													<ArrowUp size={12} />
												</SceneActionButton>
												<SceneActionButton
													label="아래로"
													disabled={i === longformScenes.length - 1}
													onClick={() => moveScene(i, 1)}
												>
													<ArrowDown size={12} />
												</SceneActionButton>
												<SceneActionButton
													label="복제"
													onClick={() => duplicateScene(i)}
												>
													<Copy size={12} />
												</SceneActionButton>
												<SceneActionButton
													label="추가"
													onClick={() => insertSceneAfter(i)}
												>
													<FilePlus2 size={12} />
												</SceneActionButton>
												<SceneActionButton
													label="삭제"
													disabled={longformScenes.length <= 1}
													danger
													onClick={() => deleteSceneAt(i)}
												>
													<Trash2 size={12} />
												</SceneActionButton>
											</div>
										</div>
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

									<div className="mt-static-sm">
										<PTextarea
											name={`scene-visual-${i}`}
											label="비주얼 프롬프트"
											value={scene.visualPrompt}
											rows={2}
											onInput={(e) =>
												updateScene(
													i,
													"visualPrompt",
													(e.target as HTMLTextAreaElement).value,
												)
											}
										/>
									</div>
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
					<PButton
						loading={saving}
						disabled={
							topicReadiness?.status === "blocked" ||
							animationReadiness?.status === "blocked" ||
							sourceSafetyReport?.passed === false
						}
						onClick={handleSubmit}
					>
						다음: 미디어 생성
					</PButton>
				</div>
			</div>
		</div>
	);
}

function StoryEditPanel({
	draft,
	referenceTemplate,
	sceneCount,
	totalDuration,
	onChange,
}: {
	draft: StoryEditDraft;
	referenceTemplate?: ReferenceTemplate | null;
	sceneCount: number;
	totalDuration: number;
	onChange: (field: keyof StoryEditDraft, value: string) => void;
}) {
	return (
		<section className="mb-static-lg overflow-hidden rounded-[18px] border border-[#d8c9b5] bg-[#fffaf2]">
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eadcc8] bg-[#211a12] px-4 py-3 text-[#fff9ed]">
				<div>
					<div className="mb-1 inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[.18em] text-[#f0b957]">
						<PencilLine size={14} />
						Story edit layer
					</div>
					<PHeading size="small" tag="h3">
						레퍼런스 생성 전 스토리 직접 편집
					</PHeading>
					<PText size="x-small" className="mt-1 text-[#d8cbb9]">
						레퍼런스는 화면 문법만 가져오고, 내용·전개·결말은 여기서 바꾼 뒤
						저장됩니다.
					</PText>
				</div>
				<div className="flex flex-wrap gap-2">
					{referenceTemplate && (
						<PTag color="notification-info-soft">{referenceTemplate.name}</PTag>
					)}
					<PTag color="background-frosted">{sceneCount}개 씬</PTag>
					<PTag color="background-frosted">{Math.round(totalDuration)}초</PTag>
				</div>
			</div>

			<div className="grid gap-3 p-4 lg:grid-cols-2">
				<StoryTextField
					label="첫 훅"
					value={draft.hook}
					onChange={(value) => onChange("hook", value)}
					placeholder="첫 3-8초에 시청자가 멈추는 질문/충격 문장"
				/>
				<StoryTextField
					label="스토리 각도"
					value={draft.storyAngle}
					onChange={(value) => onChange("storyAngle", value)}
					placeholder="이 주제를 어떤 관점으로 전개할지"
				/>
				<StoryTextField
					label="시청자 질문"
					value={draft.viewerQuestion}
					onChange={(value) => onChange("viewerQuestion", value)}
					placeholder="끝까지 봐야 풀리는 핵심 질문"
				/>
				<StoryTextField
					label="결말/회수"
					value={draft.endingBeat}
					onChange={(value) => onChange("endingBeat", value)}
					placeholder="마지막에 밝혀질 반전, 결론, 다음 영상 연결"
				/>
				<StoryTextField
					label="반드시 유지"
					value={draft.mustKeep}
					onChange={(value) => onChange("mustKeep", value)}
					placeholder="유지할 장면, 인물, 증거, 톤"
				/>
				<StoryTextField
					label="금지/제외"
					value={draft.avoid}
					onChange={(value) => onChange("avoid", value)}
					placeholder="원본 복제, 과장, 특정 소재 등 제외할 것"
				/>
				<div className="lg:col-span-2">
					<PTextarea
						name="storyEditorNotes"
						label="편집 메모"
						value={draft.editorNotes}
						rows={3}
						onInput={(event) =>
							onChange(
								"editorNotes",
								(event.target as HTMLTextAreaElement).value,
							)
						}
					/>
				</div>
			</div>
		</section>
	);
}

function scoreColor(score: number):
	| "notification-success-soft"
	| "notification-warning-soft"
	| "notification-error-soft" {
	if (score >= 78) return "notification-success-soft";
	if (score >= 58) return "notification-warning-soft";
	return "notification-error-soft";
}

function ReferenceApplicationPanel({
	report,
	sourceSafetyReport,
}: {
	report: ReferenceApplicationScoreReport;
	sourceSafetyReport: SourceSafetyReport | null;
}) {
	const visibleReferenceIssues = report.issues
		.filter((issue) => issue.severity !== "info")
		.slice(0, 3);
	const visibleSourceIssues =
		sourceSafetyReport?.issues
			.filter((issue) => issue.severity !== "info")
			.slice(0, 3) ?? [];
	return (
		<section className="mb-static-lg rounded-[14px] border border-[#d8c9b5] bg-[#fffdf8] p-static-md">
			<div className="flex flex-wrap items-start justify-between gap-static-sm">
				<div>
					<PText size="small" weight="semi-bold">
						레퍼런스 적용 점수 · 자료 안전 게이트
					</PText>
					<PText size="x-small" color="contrast-medium" className="mt-1">
						훅 시간, 컷 밀도, 씬 수, 출처 앵커, 원본 복제 경계를 저장 전에 점검합니다.
					</PText>
				</div>
				<div className="flex flex-wrap gap-static-xs">
					<PTag color={scoreColor(report.score)}>
						{report.label} · {report.score}점
					</PTag>
					{sourceSafetyReport && (
						<PTag color={scoreColor(sourceSafetyReport.score)}>
							자료 안전 {sourceSafetyReport.score}점
						</PTag>
					)}
				</div>
			</div>

			<div className="mt-static-sm grid grid-cols-2 lg:grid-cols-4 gap-static-xs">
				<PTag color="background-surface">
					훅 {report.metrics.hookFit}점
				</PTag>
				<PTag color="background-surface">
					컷밀도 {report.metrics.cutDensityFit}점
				</PTag>
				<PTag color="background-surface">
					출처 {report.metrics.sourceFit}점
				</PTag>
				<PTag color="background-surface">
					샷 {report.metrics.shotCount}개
				</PTag>
				{sourceSafetyReport && (
					<PTag color="background-surface">
						자료 {sourceSafetyReport.metrics.sourceCount}개
					</PTag>
				)}
				{sourceSafetyReport && (
					<PTag color="background-surface">
						출처씬 {Math.round(sourceSafetyReport.metrics.scenesWithSourceRatio * 100)}%
					</PTag>
				)}
				{sourceSafetyReport?.disclosureRequired && (
					<PTag color="notification-warning-soft">AI 재구성 고지 필요</PTag>
				)}
			</div>

			{(visibleReferenceIssues.length > 0 || visibleSourceIssues.length > 0) && (
				<div className="mt-static-sm grid grid-cols-1 lg:grid-cols-2 gap-static-sm">
					{visibleReferenceIssues.length > 0 && (
						<div className="rounded-[10px] bg-[#fff8ea] border border-[#ead9bd] p-static-sm">
							<PText size="x-small" weight="semi-bold">
								레퍼런스 보강
							</PText>
							<ul className="mt-1 list-disc pl-4 text-[12px] text-contrast-medium">
								{visibleReferenceIssues.map((issue) => (
									<li key={issue.code}>{issue.message}</li>
								))}
							</ul>
						</div>
					)}
					{visibleSourceIssues.length > 0 && (
						<div className="rounded-[10px] bg-[#fff8ea] border border-[#ead9bd] p-static-sm">
							<PText size="x-small" weight="semi-bold">
								자료/저작권 안전
							</PText>
							<ul className="mt-1 list-disc pl-4 text-[12px] text-contrast-medium">
								{visibleSourceIssues.map((issue) => (
									<li key={`${issue.code}-${issue.sceneIndex ?? "global"}`}>
										{issue.message}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</section>
	);
}

function StoryTextField({
	label,
	value,
	placeholder,
	onChange,
}: {
	label: string;
	value: string;
	placeholder: string;
	onChange: (value: string) => void;
}) {
	return (
		<label className="block">
			<span className="mb-1 block text-[11px] font-black uppercase tracking-[.14em] text-[#6d5d48]">
				{label}
			</span>
			<input
				type="text"
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				className="h-10 w-full rounded-xl border border-[#d8c9b5] bg-white px-3 text-[13px] font-semibold text-[#211a12] outline-none transition focus:border-[#9b6b2f] focus:ring-4 focus:ring-[#d69a3a]/15"
			/>
		</label>
	);
}

function SceneActionButton({
	label,
	children,
	onClick,
	disabled = false,
	danger = false,
}: {
	label: string;
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={`grid h-6 w-6 place-items-center rounded-full border text-[11px] transition disabled:cursor-not-allowed disabled:opacity-35 ${
				danger
					? "border-[#f3b4aa] bg-[#fff1ef] text-[#a33725] hover:bg-[#ffe2dd]"
					: "border-[#d8c9b5] bg-[#fffaf2] text-[#4d3f2f] hover:border-[#9b6b2f]"
			}`}
		>
			{children}
		</button>
	);
}
