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
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { callOpenAI, generateContinuousNarration } from "../../lib/ai";
import type { AutoFixContext } from "../../lib/auto-fix-executor";
import {
	clampShortsDuration,
	estimatedBpmFromTempo,
	retimeScenesToBeatGrid,
} from "../../lib/beat-sync";
import { collectBenchmarkSamples } from "../../lib/benchmark-reference-adapter";
import { autoPickBgm, inferAutoBgmPreset } from "../../lib/bgm";
import { type BgmAnalysis, isBpmReliable } from "../../lib/bgm-analyze";
import { type BgmCuePlan, planBgmCuePlan } from "../../lib/bgm-cue-plan";
import {
	assessImportedBgmClaimReadiness,
	type BgmLicense,
} from "../../lib/bgm-import";
import {
	type ChannelBranding,
	loadChannelBranding,
} from "../../lib/channel-branding";
import {
	type BundleBgm,
	type BundleTts,
	buildContentBundle,
	type ContentBundle,
} from "../../lib/content-bundle";
import {
	buildFinalOutputCritique,
	type FinalOutputCritiqueReport,
} from "../../lib/final-output-critique";
import { buildHookFlags } from "../../lib/hook-detector";
import { buildRenderKnowledgeEvent } from "../../lib/knowledge-system";
import { ensureBlobUrls } from "../../lib/local-db";
import {
	classifyBenchmarkGenre,
	resolveMarketBenchmark,
} from "../../lib/market-benchmark";
import { scheduleQualityLoop } from "../../lib/quality-loop-orchestrator";
import {
	type AutoFixPlan,
	combineWithExistingVerdicts,
	type DimensionVerdict,
	type QualityDimension,
	type QualityVerdict,
	type QualityVerdictReport,
} from "../../lib/quality-verdict";
import {
	assessReferenceApplicationScore,
	type ReferenceApplicationScoreReport,
} from "../../lib/reference-application-score";
import { referenceToPreset } from "../../lib/reference-bridge";
import { prepareRenderPayload } from "../../lib/render-assets";
import {
	DEFAULT_PRESET,
	HARDWARE_LABELS,
	type HardwareAccel,
	QUALITY_DESCRIPTIONS,
	QUALITY_LABELS,
	type RenderQualityPreset,
	resolveRenderOptions,
} from "../../lib/render-options";
import {
	isRenderJobError,
	pollRenderProgress,
	type RenderJob,
	submitRender,
} from "../../lib/render-queue";
import type { SceneShot } from "../../lib/scene-shot-types";
import {
	assignSfxToScenes,
	type SfxCategory,
	withMoodVolume,
} from "../../lib/sfx";
import {
	applyCooldownToSfx,
	createCooldownTracker,
} from "../../lib/sfx-cooldown";
import type { SourceSafetyReport } from "../../lib/source-safety-gate";
import { supabase } from "../../lib/supabase";
import { generateAndSaveThumbnail } from "../../lib/thumbnail";
import {
	assessThumbnailReadiness,
	type ThumbnailReadiness,
} from "../../lib/thumbnail-intelligence";
import type { TtsOptions } from "../../lib/tts";
import {
	buildYouTubeMetadata,
	type YouTubeMetadata,
} from "../../lib/youtube-metadata";
import { analyzeYouTubePolicyRisk } from "../../lib/youtube-policy-risk";
import {
	analyzeProductionQuality,
	type ProductionQualityReport,
	type ProductionQualityScene,
} from "../../lib/youtube-production-quality";
import {
	buildMotionRepairPatch,
	buildReferenceRepairGuidance,
	renderOutputIssueCodesToProductionIssueCodes,
	type SceneRepairPatch,
	shouldRepairMotionDesign,
	shouldRepairNarrationEnding,
	shouldRepairRenderOutput,
	strengthenEndingNarration,
} from "../../lib/youtube-production-repair";
import { analyzeOpeningRetention } from "../../lib/youtube-retention";
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

type SceneWithAssets = Scene & {
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;
};

function sceneShots(scene: SceneWithAssets | Scene): SceneShot[] {
	return (
		((scene as Record<string, unknown>).shots as SceneShot[] | undefined) ?? []
	);
}

function animationSfxHints(scene: SceneWithAssets | Scene) {
	const animationShots = sceneShots(scene).filter(
		(shot) => shot.selection_provider === "animation" || shot.animation_family,
	);
	const productionFamily = animationShots.find(
		(shot) => typeof shot.animation_family === "string",
	)?.animation_family;
	const needsActionSfx = animationShots.some(
		(shot) =>
			shot.kind === "detail" ||
			shot.kind === "punch" ||
			(shot.animation_rig?.actionIntensity ?? 0) >= 0.65 ||
			(shot.sfx_cue?.intensity ?? 0) >= 0.65,
	);
	const animationEndingShot = animationShots.some(
		(shot) => shot.kind === "punch" || shot.visual_role === "ending",
	);
	const sfxCues = animationShots
		.map((shot) => shot.sfx_cue)
		.filter((cue): cue is NonNullable<SceneShot["sfx_cue"]> =>
			Boolean(cue?.category),
		)
		.sort((a, b) => b.intensity - a.intensity);
	const firstCue = sfxCues.find((cue) => cue.category !== "none");
	const endingCue =
		animationShots
			.filter((shot) => shot.kind === "punch" || shot.visual_role === "ending")
			.map((shot) => shot.sfx_cue)
			.filter((cue): cue is NonNullable<SceneShot["sfx_cue"]> =>
				Boolean(cue?.category && cue.category !== "none"),
			)
			.sort((a, b) => b.intensity - a.intensity)[0] ?? firstCue;
	return {
		productionType: animationShots.length > 0 ? "animation" : undefined,
		productionFamily,
		animationShotCount: animationShots.length,
		animationEndingShot,
		needsActionSfx,
		preferredEnterSfxCategory: firstCue?.category as SfxCategory | undefined,
		preferredTransitionSfxCategory: endingCue?.category as
			| SfxCategory
			| undefined,
	};
}

function toPolicyScene(scene: SceneWithAssets) {
	return {
		narration_text: scene.narration_text,
		scene_type: scene.scene_type,
		visual_prompt: scene.visual_prompt,
		news_title: scene.news_title,
		news_source: scene.news_source,
		source_url: scene.source_url,
		shots: sceneShots(scene),
	};
}

function toProductionScene(
	scene: SceneWithAssets,
	remotionScene?: RemotionScene,
): ProductionQualityScene {
	return {
		narration_text: scene.narration_text,
		scene_type: scene.scene_type,
		duration_seconds: Number(scene.duration_seconds),
		imageUrl: scene.imageUrl ?? remotionScene?.imageUrl,
		videoUrl: scene.videoUrl ?? remotionScene?.videoUrl,
		audioUrl: scene.audioUrl ?? remotionScene?.audioUrl,
		visual_prompt: scene.visual_prompt,
		news_title: scene.news_title,
		news_source: scene.news_source,
		news_date: scene.news_date,
		source_url: scene.source_url,
		sourceAttribution: remotionScene?.sourceAttribution,
		transition: scene.transition ?? remotionScene?.transition,
		wordTimings: scene.word_timings ?? remotionScene?.wordTimings,
		motionGraphics: scene.motion_graphics ?? remotionScene?.motionGraphics,
		shots: remotionScene?.shots ?? sceneShots(scene),
	};
}

type RenderOutputQcLike = {
	passed?: boolean;
	score?: number;
	verdict?: string;
	metrics?: unknown;
	referenceComparison?: unknown;
	issues?: unknown[];
	requiredActions?: unknown[];
};

type PreviewNicheVideoQualityTarget = {
	key?: string;
	label?: string;
	target?: string;
	rationale?: string;
};

type PreviewNicheResearch = {
	id?: string;
	topic?: string;
	query?: string;
	decision?: "scale" | "test" | "hold";
	score?: number;
	playbook?: {
		headline?: string;
		openingFormula?: string[];
		productionConstraints?: string[];
		videoQualityTargets?: PreviewNicheVideoQualityTarget[];
		analysisQuality?: {
			score?: number;
			label?: string;
			warnings?: string[];
		};
	};
};

function referenceFrameProfileFromTemplate(
	referenceTemplate?: ReferenceTemplate | null,
): Record<string, unknown> | undefined {
	const raw = referenceTemplate?.raw_analysis;
	if (!raw || typeof raw !== "object") return undefined;
	const profile = (raw as { frame_profile?: unknown }).frame_profile;
	return profile && typeof profile === "object"
		? (profile as Record<string, unknown>)
		: undefined;
}

function referenceProductionDnaFromTemplate(
	referenceTemplate?: ReferenceTemplate | null,
): unknown {
	const raw = referenceTemplate?.raw_analysis;
	if (!raw || typeof raw !== "object") return undefined;
	return (raw as { production_dna?: unknown }).production_dna;
}

function renderOutputIssueCodes(qc: RenderOutputQcLike | undefined): string[] {
	return (qc?.issues ?? []).filter(
		(issue): issue is string => typeof issue === "string",
	);
}

function mergeRenderOutputQc(
	base: Record<string, unknown>,
	qc: RenderOutputQcLike | undefined,
	extra: Record<string, unknown> = {},
) {
	return {
		...base,
		render_output_qc_passed: qc?.passed ?? false,
		render_output_qc_score: qc?.score,
		render_output_qc_verdict: qc?.verdict,
		render_output_qc_metrics: qc?.metrics,
		render_output_reference_comparison: qc?.referenceComparison,
		render_output_qc_issues: qc?.issues ?? [],
		render_output_qc_actions: qc?.requiredActions ?? [],
		...extra,
	};
}

function renderFailureMessage(error: unknown): string {
	if (!isRenderJobError(error)) {
		return error instanceof Error ? error.message : "렌더링 실패";
	}
	const qc = error.job.qcResult as RenderOutputQcLike | undefined;
	if (error.job.errorCategory === "quality_gate" && qc) {
		const issues = renderOutputIssueCodes(qc).slice(0, 3).join(", ");
		return `렌더 산출물 품질 기준 미달: ${qc.score ?? "?"}/100${
			issues ? ` (${issues})` : ""
		}`;
	}
	return error.message || "렌더링 실패";
}

function formatMetricRatio(value: number): string {
	if (!Number.isFinite(value)) return "--";
	return `${Math.round(value * 100)}%`;
}

function formatMetricScore(value: number): string {
	if (!Number.isFinite(value)) return "--";
	return `${Math.round(value)}점`;
}

function productionStatusColor(
	report: ProductionQualityReport,
):
	| "notification-success-soft"
	| "notification-warning-soft"
	| "notification-error-soft" {
	if (report.passed) return "notification-success-soft";
	if (report.score >= 70 && report.metrics.premiumFloorScore >= 78) {
		return "notification-warning-soft";
	}
	return "notification-error-soft";
}

function productionStatusLabel(report: ProductionQualityReport): string {
	if (report.passed) return "렌더 가능";
	if (report.score < 78) return "QC 점수 미달";
	if (report.metrics.premiumFloorScore < 86) return "프리미엄 기준 미달";
	return "보강 필요";
}

function nicheDecisionLabel(
	decision?: PreviewNicheResearch["decision"],
): string {
	if (decision === "scale") return "증폭 후보";
	if (decision === "test") return "파일럿 후보";
	if (decision === "hold") return "보류";
	return "니치 기준";
}

function ProductionQualityPanel({
	report,
	nicheResearch,
}: {
	report: ProductionQualityReport;
	nicheResearch: PreviewNicheResearch | null;
}) {
	const metrics = report.metrics;
	const visibleIssues = report.issues
		.filter(
			(issue) => issue.severity === "critical" || issue.severity === "warning",
		)
		.slice(0, 4);
	const visibleActions = report.requiredActions.slice(0, 4);
	const nicheTargets =
		nicheResearch?.playbook?.videoQualityTargets
			?.filter((target) => target.label || target.target)
			.slice(0, 4) ?? [];
	const openingFormula =
		nicheResearch?.playbook?.openingFormula?.filter(Boolean).slice(0, 2) ?? [];
	const nicheQuality = nicheResearch?.playbook?.analysisQuality;

	return (
		<div className="rounded-[8px] border border-contrast-low bg-canvas p-static-lg mb-static-lg">
			<div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-static-md mb-static-md">
				<div className="min-w-0">
					<PHeading size="small" tag="h3">
						실제 영상 수준 리포트
					</PHeading>
					<PText size="small" color="contrast-medium" className="mt-static-xs">
						렌더 승인 전에 씬, 컷 밀도, 출처, 모션, 자막, BGM, 썸네일 기준을
						수치로 검증합니다.
					</PText>
				</div>
				<div className="flex flex-wrap gap-static-xs">
					<PTag color={productionStatusColor(report)}>
						{productionStatusLabel(report)}
					</PTag>
					<PTag color="notification-info-soft">
						QC {formatMetricScore(report.score)}
					</PTag>
				</div>
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-4 gap-static-sm">
				<ProductionMetric
					label="제작 QC"
					value={formatMetricScore(report.score)}
				/>
				<ProductionMetric
					label="프리미엄 바닥선"
					value={formatMetricScore(metrics.premiumFloorScore)}
				/>
				<ProductionMetric
					label="출처 앵커"
					value={formatMetricRatio(metrics.sourceAnchorRatio)}
				/>
				<ProductionMetric
					label="모션 비주얼"
					value={formatMetricRatio(metrics.motionVisualRatio)}
				/>
				<ProductionMetric
					label="디자인 비주얼"
					value={formatMetricRatio(metrics.designedVisualRatio)}
				/>
				<ProductionMetric
					label="자막 싱크"
					value={formatMetricRatio(metrics.captionSyncRatio)}
				/>
				<ProductionMetric
					label="초반 비트"
					value={`${metrics.openingDynamicBeatCount}개`}
				/>
				<ProductionMetric
					label="평균 컷"
					value={`${metrics.averageShotsPerVisualScene.toFixed(1)}컷/씬`}
				/>
			</div>

			{nicheResearch && (
				<div className="mt-static-md rounded-[8px] bg-surface p-static-md">
					<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-static-sm">
						<div className="min-w-0">
							<PText size="small" weight="semi-bold">
								니치 목표:{" "}
								{nicheResearch.query ?? nicheResearch.topic ?? "선택 주제"}
							</PText>
							<PText
								size="x-small"
								color="contrast-medium"
								className="mt-static-xs"
							>
								{nicheResearch.playbook?.headline ??
									"니치 리서치에서 넘어온 제작 기준을 프리뷰 QC와 대조합니다."}
							</PText>
						</div>
						<div className="flex flex-wrap gap-static-xs">
							<PTag color="notification-info-soft">
								{nicheDecisionLabel(nicheResearch.decision)}
							</PTag>
							{typeof nicheResearch.score === "number" && (
								<PTag color="notification-info-soft">
									니치 {nicheResearch.score}점
								</PTag>
							)}
							{typeof nicheQuality?.score === "number" && (
								<PTag color="notification-info-soft">
									신뢰도 {nicheQuality.score}점
								</PTag>
							)}
						</div>
					</div>

					{nicheTargets.length > 0 && (
						<div className="mt-static-sm grid grid-cols-1 lg:grid-cols-2 gap-static-xs">
							{nicheTargets.map((target, index) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: key/label 접두사 + index 복합키(안정적)
									key={`${target.key ?? target.label ?? "target"}-${index}`}
									className="rounded-[6px] bg-canvas p-static-sm"
								>
									<PText size="x-small" weight="semi-bold">
										{target.label ?? "영상 목표"}
									</PText>
									<PText
										size="x-small"
										color="contrast-medium"
										className="mt-static-xs"
									>
										{target.target ?? target.rationale ?? "목표 기준 없음"}
									</PText>
								</div>
							))}
						</div>
					)}

					{openingFormula.length > 0 && (
						<div className="mt-static-sm flex flex-wrap gap-static-xs">
							{openingFormula.map((formula) => (
								<PTag key={formula} color="notification-info-soft">
									{formula}
								</PTag>
							))}
						</div>
					)}
				</div>
			)}

			<div className="mt-static-md grid grid-cols-1 lg:grid-cols-2 gap-static-sm">
				<div className="rounded-[8px] bg-surface p-static-md">
					<PText size="small" weight="semi-bold" className="mb-static-xs">
						차단/주의 항목
					</PText>
					<div className="flex flex-wrap gap-static-xs">
						{visibleIssues.length > 0 ? (
							visibleIssues.map((issue) => (
								<PTag
									key={`${issue.code}-${issue.sceneIndex ?? "global"}`}
									color={
										issue.severity === "critical"
											? "notification-error-soft"
											: "notification-warning-soft"
									}
								>
									{issue.message}
								</PTag>
							))
						) : (
							<PTag color="notification-success-soft">치명 이슈 없음</PTag>
						)}
					</div>
				</div>

				<div className="rounded-[8px] bg-surface p-static-md">
					<PText size="small" weight="semi-bold" className="mb-static-xs">
						필수 보강 액션
					</PText>
					<div className="flex flex-wrap gap-static-xs">
						{visibleActions.length > 0 ? (
							visibleActions.map((action) => (
								<PTag key={action} color="notification-warning-soft">
									{action}
								</PTag>
							))
						) : (
							<PTag color="notification-success-soft">렌더 전 보강 없음</PTag>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function ProductionMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[8px] bg-surface p-static-sm min-w-0">
			<PText size="x-small" color="contrast-medium">
				{label}
			</PText>
			<PText weight="semi-bold" className="truncate">
				{value}
			</PText>
		</div>
	);
}

function critiqueColor(
	report: FinalOutputCritiqueReport,
):
	| "notification-success-soft"
	| "notification-warning-soft"
	| "notification-error-soft" {
	if (report.passed) return "notification-success-soft";
	if (report.score >= 62) return "notification-warning-soft";
	return "notification-error-soft";
}

function FinalOutputCritiquePanel({
	report,
	referenceReport,
	sourceSafetyReport,
}: {
	report: FinalOutputCritiqueReport;
	referenceReport: ReferenceApplicationScoreReport;
	sourceSafetyReport: SourceSafetyReport | null;
}) {
	const blockers = report.blockers.slice(0, 3);
	const warnings = report.warnings.slice(0, 3);
	const nextActions = report.nextActions.slice(0, 4);
	return (
		<div className="mb-static-lg rounded-[8px] border border-contrast-low bg-canvas p-static-lg">
			<div className="flex flex-col gap-static-sm lg:flex-row lg:items-start lg:justify-between">
				<div>
					<PHeading size="small" tag="h3">
						최종 산출물 자동 비평
					</PHeading>
					<PText size="small" color="contrast-medium" className="mt-static-xs">
						레퍼런스 반영, 자료 안전, 썸네일, 정책, 제작 QC를 업로드 직전 한 번
						더 합산합니다.
					</PText>
				</div>
				<div className="flex flex-wrap gap-static-xs">
					<PTag color={critiqueColor(report)}>
						{report.label} · {report.score}점
					</PTag>
					<PTag color="background-surface">
						레퍼런스 {referenceReport.score}점
					</PTag>
					{sourceSafetyReport && (
						<PTag color="background-surface">
							자료 안전 {sourceSafetyReport.score}점
						</PTag>
					)}
				</div>
			</div>

			<div className="mt-static-md grid grid-cols-1 lg:grid-cols-3 gap-static-sm">
				<div className="rounded-[8px] bg-surface p-static-md">
					<PText size="small" weight="semi-bold" className="mb-static-xs">
						강점
					</PText>
					<div className="flex flex-wrap gap-static-xs">
						{report.strengths.length > 0 ? (
							report.strengths.map((item) => (
								<PTag key={item} color="notification-success-soft">
									{item}
								</PTag>
							))
						) : (
							<PTag color="notification-warning-soft">강점 부족</PTag>
						)}
					</div>
				</div>
				<div className="rounded-[8px] bg-surface p-static-md">
					<PText size="small" weight="semi-bold" className="mb-static-xs">
						차단/경고
					</PText>
					<div className="flex flex-wrap gap-static-xs">
						{blockers.map((item) => (
							<PTag key={item} color="notification-error-soft">
								{item}
							</PTag>
						))}
						{warnings.map((item) => (
							<PTag key={item} color="notification-warning-soft">
								{item}
							</PTag>
						))}
						{blockers.length === 0 && warnings.length === 0 && (
							<PTag color="notification-success-soft">차단 없음</PTag>
						)}
					</div>
				</div>
				<div className="rounded-[8px] bg-surface p-static-md">
					<PText size="small" weight="semi-bold" className="mb-static-xs">
						다음 보강
					</PText>
					<div className="flex flex-wrap gap-static-xs">
						{nextActions.length > 0 ? (
							nextActions.map((item) => (
								<PTag key={item} color="notification-warning-soft">
									{item}
								</PTag>
							))
						) : (
							<PTag color="notification-success-soft">추가 보강 없음</PTag>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function thumbnailReadinessColor(level: ThumbnailReadiness["level"]) {
	if (level === "ready") return "notification-success-soft";
	if (level === "warning") return "notification-warning-soft";
	return "notification-error-soft";
}

function ThumbnailPlanPanel({
	plan,
	readiness,
	isShorts,
}: {
	plan: YouTubeMetadata["thumbnail"] | null;
	readiness: ThumbnailReadiness;
	isShorts: boolean;
}) {
	if (!plan) {
		return (
			<div className="rounded-[8px] border border-contrast-low bg-canvas p-static-md">
				<PText size="small" weight="semi-bold">
					썸네일 제작 계획 없음
				</PText>
				<PText size="x-small" color="contrast-medium" className="mt-static-xs">
					승인 전에 레퍼런스 기반 제목/이미지/배치 계획을 다시 생성해야 합니다.
				</PText>
			</div>
		);
	}

	return (
		<div className="rounded-[8px] border border-contrast-low bg-canvas p-static-lg mb-static-lg">
			<div className="mb-static-md flex flex-col gap-static-sm lg:flex-row lg:items-start lg:justify-between">
				<div>
					<PHeading size="small" tag="h3">
						레퍼런스 썸네일 패키지
					</PHeading>
					<PText size="small" color="contrast-medium" className="mt-static-xs">
						제목을 반복하지 않고 썸네일은 클릭 감정, 단서, 첫 프레임 역할을
						담당하도록 생성합니다.
					</PText>
				</div>
				<div className="flex flex-wrap gap-static-xs">
					<PTag color={thumbnailReadinessColor(readiness.level)}>
						{readiness.label} · {readiness.score}점
					</PTag>
					<PTag color="notification-info-soft">
						{isShorts ? "Shorts cover frame" : "1280x720 thumbnail"}
					</PTag>
				</div>
			</div>

			<div className="grid gap-static-sm lg:grid-cols-[.9fr_1.1fr]">
				<div
					className="relative min-h-[190px] overflow-hidden rounded-[10px] border border-contrast-low p-static-lg"
					style={{
						background:
							"radial-gradient(circle at 78% 24%, rgba(245,158,11,.28), transparent 34%), linear-gradient(135deg, #0b0b0b, #21170f 58%, #090909)",
					}}
				>
					<div
						className="absolute inset-x-0 bottom-0 h-1.5"
						style={{ backgroundColor: plan.accentColor }}
					/>
					<div className="relative flex h-full flex-col justify-between gap-static-md">
						<div className="flex items-center justify-between gap-static-sm">
							<span
								className="rounded-full px-static-sm py-static-xs text-[11px] font-black uppercase tracking-[.12em] text-[#111]"
								style={{ backgroundColor: plan.accentColor }}
							>
								{plan.badgeText}
							</span>
							<PTag color="background-surface">{plan.layout}</PTag>
						</div>
						<div>
							<div className="max-w-[520px] text-[clamp(28px,4vw,48px)] font-black leading-[.98] tracking-[-.05em] text-white drop-shadow-[0_3px_0_rgba(0,0,0,.85)]">
								{plan.title}
							</div>
							<div
								className="mt-static-sm text-[18px] font-black"
								style={{ color: plan.accentColor }}
							>
								{plan.subtitle}
							</div>
						</div>
					</div>
				</div>

				<div className="grid gap-static-sm">
					<div className="rounded-[8px] bg-surface p-static-md">
						<PText size="small" weight="semi-bold">
							클릭 역할
						</PText>
						<PText
							size="x-small"
							color="contrast-medium"
							className="mt-static-xs"
						>
							{plan.referenceDna.clickPackaging.titleThumbnailRelationship}
						</PText>
					</div>
					<div className="grid gap-static-xs md:grid-cols-3">
						{plan.variants.slice(0, 3).map((variant) => (
							<div
								key={variant.id}
								className="rounded-[8px] bg-surface p-static-sm"
							>
								<PText size="x-small" weight="semi-bold">
									{variant.titlePattern}
								</PText>
								<PText
									size="x-small"
									color="contrast-medium"
									className="mt-static-xs"
								>
									{variant.testGoal}
								</PText>
							</div>
						))}
					</div>
					{[...readiness.warnings, ...plan.quality.requiredActions]
						.slice(0, 3)
						.map((action) => (
							<PTag key={action} color="notification-warning-soft">
								{action}
							</PTag>
						))}
				</div>
			</div>
		</div>
	);
}

function buildProductionScenes(
	scenes: SceneWithAssets[],
	remotionScenes: RemotionScene[],
): ProductionQualityScene[] {
	return scenes.map((scene, index) =>
		toProductionScene(scene, remotionScenes[index]),
	);
}

function cloneShots(shots?: SceneShot[]): SceneShot[] {
	return (shots ?? []).map((shot) => ({ ...shot }));
}

function thumbnailPathForScript(scriptId: string): string {
	return `scripts/${scriptId}/thumbnail.jpg`;
}

function compactThumbnailTitle(title: string, fallback: string): string {
	const primary = (title.split("|")[0] ?? title)
		.replace(
			/\s*(타임라인 분석|확인된 사실과 남은 의문|핵심만 60초 요약)$/g,
			"",
		)
		.trim();
	if (primary.length > 0 && primary.length <= 18) return primary;
	return (primary || fallback).slice(0, 18).trim() || "사건 타임라인";
}

function chooseThumbnailBackground(scenes: SceneWithAssets[]): string {
	const ranked = scenes
		.map((scene, index) => {
			const url = scene.imageUrl ?? "";
			const hasPunchShot = sceneShots(scene).some(
				(shot) => shot.kind === "punch",
			);
			return {
				url,
				score:
					(url ? 100 : 0) +
					(index < 3 ? 35 - index * 8 : 0) +
					(scene.scene_type === "video" ? 18 : 0) +
					(hasPunchShot ? 12 : 0),
			};
		})
		.filter((item) => item.url)
		.sort((a, b) => b.score - a.score);
	return ranked[0]?.url ?? "";
}

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

async function loadStoredBgmUrl(
	scriptId: string,
	ensureFn: (paths: string[]) => Promise<Map<string, string>>,
): Promise<string> {
	const storedUrl =
		localStorage.getItem(`bgm_url_${scriptId}`) ??
		localStorage.getItem("bgm_url") ??
		"";
	if (storedUrl) return storedUrl;

	const storedPath = localStorage.getItem(`bgm_path_${scriptId}`);
	if (!storedPath) return "";
	if (storedPath.startsWith("/")) return storedPath;

	const blobMap = await ensureFn([storedPath]);
	return blobMap.get(storedPath) ?? "";
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

async function updateSceneRecord(
	sceneId: string,
	patch: Record<string, unknown>,
) {
	const { error } = await supabase
		.from("scenes")
		.update(patch)
		.eq("id", sceneId);
	if (error) throw new Error(`씬 품질 보강 저장 실패: ${error.message}`);
}

/** quality_loop_v2 feature flag — localStorage 'quality_loop_v2' === '1' 일 때만 활성 (기본 off) */
function isQualityLoopV2Enabled(): boolean {
	try {
		return localStorage.getItem("quality_loop_v2") === "1";
	} catch {
		return false;
	}
}

const QUALITY_DIMENSION_LABELS: Record<QualityDimension, string> = {
	editing: "편집",
	script: "대본",
	bgm: "BGM",
	tts: "TTS",
};

function marketVerdictColor(
	verdict: QualityVerdict,
):
	| "notification-success-soft"
	| "notification-warning-soft"
	| "notification-error-soft" {
	if (verdict === "ship") return "notification-success-soft";
	if (verdict === "improve") return "notification-warning-soft";
	return "notification-error-soft";
}

function marketVerdictLabel(verdict: QualityVerdict): string {
	if (verdict === "ship") return "출고 가능";
	if (verdict === "improve") return "보강 필요";
	return "차단";
}

function marketDimensionStatusColor(
	status: DimensionVerdict["status"],
):
	| "notification-success-soft"
	| "notification-warning-soft"
	| "notification-error-soft" {
	if (status === "pass") return "notification-success-soft";
	if (status === "below_bar") return "notification-warning-soft";
	return "notification-error-soft";
}

/** 이미 매핑된 scenes/tts/bgm 상태를 판정 입력 번들로 투영 (결측 가드 포함) */
/** import한 BGM의 Content ID claim 차단 여부. 라이선스 기록이 없으면 판단 보류(undefined). */
function loadBgmClaimBlocked(scriptId: string): boolean | undefined {
	try {
		const raw = localStorage.getItem(`bgm_license_${scriptId}`);
		if (!raw) return undefined;
		const license = JSON.parse(raw) as BgmLicense;
		return !assessImportedBgmClaimReadiness(license).cleared;
	} catch {
		return undefined;
	}
}

function buildPreviewContentBundle(input: {
	scriptId: string;
	isShorts: boolean;
	scenes: SceneWithAssets[];
	ttsPreset?: { voice?: string; provider?: string; speed?: number };
	bgmMood?: string;
	hasBeatGrid: boolean;
	/** 연속 나레이션 오디오 존재 — word timing 누락 콘텐츠의 tts_zero_coverage 오탐 방지 */
	hasNarrationAudio: boolean;
	bgmClaimBlocked?: boolean;
}): ContentBundle {
	const tts: Partial<BundleTts> = {};
	if (
		typeof input.ttsPreset?.speed === "number" &&
		Number.isFinite(input.ttsPreset.speed)
	) {
		tts.speed = input.ttsPreset.speed;
	}
	if (input.ttsPreset?.provider) {
		tts.provider = input.ttsPreset.provider;
	}
	if (input.ttsPreset?.voice) {
		tts.voiceId = input.ttsPreset.voice;
	}
	if (input.hasNarrationAudio) {
		// 연속 나레이션이 전 구간을 커버 — word timing 보유율과는 별개 신호다
		tts.coverageRatio = 1;
	}
	const bgm: Partial<BundleBgm> = { hasBeatGrid: input.hasBeatGrid };
	if (input.bgmMood) {
		bgm.mood = input.bgmMood;
	}
	if (input.bgmClaimBlocked !== undefined) {
		bgm.claimBlocked = input.bgmClaimBlocked;
	}
	return buildContentBundle({
		contentId: input.scriptId,
		format: input.isShorts ? "shorts" : "longform",
		scenes: input.scenes,
		tts,
		bgm,
	});
}

function MarketQualityVerdictPanel({
	report,
	combinedVerdict,
}: {
	report: QualityVerdictReport;
	combinedVerdict: QualityVerdict;
}) {
	const dimensionEntries = (
		Object.keys(QUALITY_DIMENSION_LABELS) as QualityDimension[]
	).map((dimension) => [dimension, report.dimensions[dimension]] as const);
	const fixActions = report.autoFixPlan.actions.slice(0, 4);

	return (
		<div className="mb-static-lg rounded-[8px] border border-contrast-low bg-canvas p-static-lg">
			<div className="flex flex-col gap-static-sm lg:flex-row lg:items-start lg:justify-between">
				<div>
					<PHeading size="small" tag="h3">
						시장 품질 판정 (베타)
					</PHeading>
					<PText size="small" color="contrast-medium" className="mt-static-xs">
						시장 벤치마크 대비 편집/대본/BGM/TTS 품질을 자동 판정하고 보강
						비용을 추정합니다.
					</PText>
				</div>
				<div className="flex flex-wrap gap-static-xs">
					<PTag color={marketVerdictColor(combinedVerdict)}>
						종합 {marketVerdictLabel(combinedVerdict)}
					</PTag>
					<PTag color={marketVerdictColor(report.verdict)}>
						시장 {marketVerdictLabel(report.verdict)} · {report.overallScore}/
						{report.marketBar}점
					</PTag>
					<PTag color="notification-info-soft">라운드 {report.round}</PTag>
					{report.judgeMode === "heuristic_only" && (
						<PTag color="notification-warning-soft">
							AI 검수 불가 — 휴먼 리뷰 필요
						</PTag>
					)}
				</div>
			</div>

			{report.hardBlocks.length > 0 && (
				<div className="mt-static-md flex flex-wrap gap-static-xs">
					{report.hardBlocks.map((code) => (
						<PTag key={code} color="notification-error-soft">
							차단: {code}
						</PTag>
					))}
				</div>
			)}

			<div className="mt-static-md grid grid-cols-2 gap-static-sm lg:grid-cols-4">
				{dimensionEntries.map(([dimension, verdict]) => (
					<div key={dimension} className="rounded-[8px] bg-surface p-static-md">
						<div className="flex items-center justify-between gap-static-xs">
							<PText size="small" weight="semi-bold">
								{QUALITY_DIMENSION_LABELS[dimension]}
							</PText>
							<PTag color={marketDimensionStatusColor(verdict.status)}>
								{verdict.score}/{verdict.bar}점
							</PTag>
						</div>
						<PText
							size="x-small"
							color="contrast-medium"
							className="mt-static-xs"
						>
							{verdict.findings[0] ?? "지적 사항 없음"}
						</PText>
						{verdict.fixIds.length > 0 && (
							<PText
								size="x-small"
								color="contrast-medium"
								className="mt-static-xs"
							>
								보강 {verdict.fixIds.length}건:{" "}
								{verdict.fixIds.slice(0, 2).join(", ")}
							</PText>
						)}
					</div>
				))}
			</div>

			<div className="mt-static-md flex flex-wrap gap-static-xs">
				<PTag
					color={
						report.estimatedFixCost.withinBudget
							? "notification-success-soft"
							: "notification-warning-soft"
					}
				>
					예상 보강 비용 ${report.estimatedFixCost.usd.toFixed(2)} · LLM{" "}
					{report.estimatedFixCost.llmCalls}콜
				</PTag>
				{fixActions.map((action) => (
					<PTag key={action.id} color="background-surface">
						{action.type}
					</PTag>
				))}
			</div>
		</div>
	);
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
	const [channelName, setChannelName] = useState("");
	const [channelBranding, setChannelBranding] = useState<ChannelBranding>(() =>
		loadChannelBranding(),
	);
	const [thumbnailPlan, setThumbnailPlan] = useState<
		YouTubeMetadata["thumbnail"] | null
	>(null);
	const [nicheResearch, setNicheResearch] =
		useState<PreviewNicheResearch | null>(null);
	const [rejecting, setRejecting] = useState(false);
	const [rejectionReason, setRejectionReason] = useState("");
	const [approving, setApproving] = useState(false);
	const [approvalError, setApprovalError] = useState("");
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
	const [bgmUrl, setBgmUrl] = useState("");
	const [bgmCuePlan, setBgmCuePlan] = useState<BgmCuePlan | null>(null);
	const [savedReferenceApplicationReport, setSavedReferenceApplicationReport] =
		useState<ReferenceApplicationScoreReport | null>(null);
	const [savedSourceSafetyReport, setSavedSourceSafetyReport] =
		useState<SourceSafetyReport | null>(null);

	// ── quality_loop_v2 (feature flag, 기본 off): 시장 품질 루프 상태 ──
	const qualityLoopEnabled = isQualityLoopV2Enabled();
	const [marketVerdictReport, setMarketVerdictReport] =
		useState<QualityVerdictReport | null>(null);
	const [marketLoopError, setMarketLoopError] = useState("");
	const marketVerdictReportRef = useRef<QualityVerdictReport | null>(null);
	const scenesRef = useRef<SceneWithAssets[]>([]);
	const remotionScenesRef = useRef<RemotionScene[]>([]);
	const bgmCuePlanRef = useRef<BgmCuePlan | null>(null);
	// 로컬 프리셋(/bgm/...) BGM 의 claim 차단 여부 — 메타데이터 fetch 가 비동기라 state
	const [presetClaimBlocked, setPresetClaimBlocked] = useState<
		boolean | undefined
	>(undefined);
	const titleRef = useRef("");
	const regenerateNarrationRef = useRef<typeof regenerateNarration | null>(
		null,
	);
	useEffect(() => {
		scenesRef.current = scenes;
	}, [scenes]);
	useEffect(() => {
		remotionScenesRef.current = remotionScenes;
	}, [remotionScenes]);
	useEffect(() => {
		bgmCuePlanRef.current = bgmCuePlan;
	}, [bgmCuePlan]);
	useEffect(() => {
		titleRef.current = title;
	}, [title]);
	useEffect(() => {
		// bgm:import 로컬 프리셋 경로면 옆에 기록된 라이선스 메타데이터로 claim 판정
		if (!qualityLoopEnabled) return undefined;
		const storedPath = localStorage.getItem(`bgm_path_${scriptId}`) ?? "";
		if (!storedPath.startsWith("/bgm/")) {
			setPresetClaimBlocked(undefined);
			return undefined;
		}
		let active = true;
		const metaPath = storedPath.replace(/\.[a-z0-9]+$/i, ".json");
		void fetch(metaPath)
			.then(async (res) => {
				if (!res.ok) return undefined;
				const meta = (await res.json()) as {
					licenseBasis?: string;
					library?: string;
					contentId?: BgmLicense["contentId"];
				};
				const license = {
					basis: meta.licenseBasis,
					library: meta.library,
					contentId: meta.contentId,
				} as BgmLicense;
				return !assessImportedBgmClaimReadiness(license).cleared;
			})
			.then((blocked) => {
				if (active) setPresetClaimBlocked(blocked);
			})
			.catch(() => {
				// 메타데이터 부재/파싱 실패 = 증적 없음 — 판단 보류(undefined)
				if (active) setPresetClaimBlocked(undefined);
			});
		return () => {
			active = false;
		};
	}, [qualityLoopEnabled, scriptId]);
	useEffect(() => {
		// 함수 선언 호이스팅 — 매 렌더 최신 클로저로 갱신 (deps 없음 = 의도)
		regenerateNarrationRef.current = regenerateNarration;
	});

	const referencePreset = useMemo(() => {
		if (!referenceTemplate) return undefined;
		return referenceToPreset(
			referenceTemplate,
			isShorts ? "shorts" : "longform",
		);
	}, [referenceTemplate, isShorts]);

	const compositionOverrides = useMemo(() => {
		if (!referenceTemplate || !referencePreset) return {};
		return {
			subtitleStyle: referencePreset.composition.subtitleStyle,
			captionStyle: referencePreset.composition.captionStyle,
			subtitlePosition: referencePreset.composition.subtitlePosition,
			subtitleBgStyle: referencePreset.composition.subtitleBgStyle,
			subtitleAccentColor: referenceTemplate.subtitle_accent_color,
			sceneLayout: referencePreset.composition.sceneLayout,
		};
	}, [referenceTemplate, referencePreset]);

	useEffect(() => {
		async function load() {
			const branding = loadChannelBranding();
			setChannelBranding(branding);
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
				content_json: {
					shorts_script?: string;
					format_selection?: string;
					niche_research?: PreviewNicheResearch | null;
					reference_application_report?: ReferenceApplicationScoreReport | null;
					source_safety_report?: SourceSafetyReport | null;
				};
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
					const shots = sceneShots(s);
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
			let activeBgmUrl = await loadStoredBgmUrl(scriptId, ensureBlobUrls);
			if (activeBgmUrl) {
				localStorage.setItem(`bgm_url_${scriptId}`, activeBgmUrl);
			} else {
				try {
					const bgmResult = await autoPickBgm(
						scriptId,
						preset?.bgm ??
							inferAutoBgmPreset(
								beatRetimedScenes.map((scene) => ({
									mood: scene.mood,
									durationSeconds: Number(scene.duration_seconds),
									sceneType: scene.scene_type,
								})),
							),
					);
					activeBgmUrl = bgmResult?.url ?? "";
					if (activeBgmUrl) {
						localStorage.setItem(`bgm_url_${scriptId}`, activeBgmUrl);
					}
				} catch (error) {
					console.warn("Preview BGM auto-pick failed:", error);
				}
			}
			setBgmUrl(activeBgmUrl);

			// 훅 패턴 감지 (콘텐츠 기반) + 시간 기반 hookBoost 통합
			const hookResults = buildHookFlags(
				beatRetimedScenes.map((s) => ({
					duration_seconds: Number(s.duration_seconds),
					narration: (s.narration as string | null | undefined) ?? "",
				})),
			);
			const hookFlags = hookResults.map((r) => r.hookBoost);

			// SFX 자동 배정
			const rawSfxList = assignSfxToScenes(
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
					...animationSfxHints(s),
				})),
			);
			// SFX 마감: ① 무드별 볼륨 보정(horror↑/news↓) ② 같은 카테고리 효과음이
			// 연속 씬에 반복돼 청각 피로를 주는 것을 쿨다운으로 억제.
			const sfxTracker = createCooldownTracker();
			let sfxFrameCursor = 0;
			const sfxList = rawSfxList.map((sceneSfx, idx) => {
				const startFrame = sfxFrameCursor;
				sfxFrameCursor += Math.ceil(
					Number(beatRetimedScenes[idx].duration_seconds) * VIDEO_FPS,
				);
				const mood = beatRetimedScenes[idx].mood;
				return applyCooldownToSfx(
					{
						...sceneSfx,
						enterSfx: withMoodVolume(sceneSfx.enterSfx, mood),
						transitionSfx: withMoodVolume(sceneSfx.transitionSfx, mood),
					},
					startFrame,
					sfxTracker,
				);
			});

			// beat-pulse용 절대 BGM 비트(초). export 경로(submitRender)는 bgmCuePlan을 beats 없이
			// 재계산해 startFrom=0(seek 안 함)으로 내보내므로, 트랙 비트시간=컴포지션 시간 → shift 없이
			// 그대로 전달해야 export(=최종 산출물) 영상에서 정렬된다(로컬 remotion render 로 검증함).
			// 알려진 한계(P3): 인앱 프리뷰는 state cuePlan(beats 포함)으로 BGM 을 startFrom seek 하므로,
			// firstBeat∈[0.35,2.2]일 때 프리뷰 펄스가 startFrom/fps 만큼 늦게 보일 수 있다. export 는 정상.
			// 근본 해결은 preview/export 의 bgmCuePlan startFrom 통일(선행 불일치 버그)과 함께 처리할 것.
			const allBeatTimes = bgmAnalysis?.beats ?? [];
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
					// beat-pulse용 절대 BGM 비트(초). export startFrom=0 기준이라 shift 없이 전달.
					beatTimes: allBeatTimes.length > 0 ? allBeatTimes : undefined,
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
						? Math.ceil(
								(sfxList[idx]?.transitionSfx?.duration ?? 0) * VIDEO_FPS,
							)
						: undefined,
				};
			});
			setRemotionScenes(rScenes);
			setBgmCuePlan(
				planBgmCuePlan(rScenes, {
					beats: bgmAnalysis?.beats,
					bpm:
						bgmAnalysis?.bpm ??
						(preset?.bgm.tempo
							? estimatedBpmFromTempo(preset.bgm.tempo)
							: undefined),
					fps: VIDEO_FPS,
				}),
			);

			if (scriptData) {
				setIsShorts(shortsMode);
				setShortsScript(scriptData.content_json?.shorts_script ?? "");
				setNicheResearch(scriptData.content_json?.niche_research ?? null);
				setSavedReferenceApplicationReport(
					scriptData.content_json?.reference_application_report ?? null,
				);
				setSavedSourceSafetyReport(
					scriptData.content_json?.source_safety_report ?? null,
				);
				const effectiveChannelName =
					scriptData.briefs?.topics?.channels?.name?.trim() ||
					branding.channelName;
				setChannelName(effectiveChannelName);
				const metadata = buildYouTubeMetadata({
					topicTitle: scriptData.briefs?.topics?.title ?? "",
					channelName: effectiveChannelName,
					format: shortsMode ? "shorts" : "longform",
					referenceTemplate,
					scenes: beatRetimedScenes.map((scene) => ({
						narration_text: scene.narration_text,
						scene_type: scene.scene_type,
						duration_seconds: Number(scene.duration_seconds),
						news_title: scene.news_title,
						news_source: scene.news_source,
						news_date: scene.news_date,
						shots: sceneShots(scene),
					})),
				});
				setTitle(metadata.title);
				setDescription(metadata.description);
				setTags(metadata.tags.join(", "));
				setThumbnailPlan(metadata.thumbnail);
			}

			setLoading(false);
		}
		load();
	}, [scriptId, referenceTemplate]);

	const uploadPolicyReport = useMemo(
		() =>
			analyzeYouTubePolicyRisk({
				title,
				description,
				format: isShorts ? "shorts" : "longform",
				scenes: scenes.map(toPolicyScene),
			}),
		[title, description, isShorts, scenes],
	);

	const blockingPolicyIssue = uploadPolicyReport.issues.find(
		(issue) => issue.severity === "critical",
	);
	const visiblePolicyIssue = uploadPolicyReport.issues.find(
		(issue) => issue.severity === "critical" || issue.severity === "warning",
	);
	const openingRetentionReport = useMemo(
		() =>
			analyzeOpeningRetention({
				title,
				format: isShorts ? "shorts" : "longform",
				scenes: scenes.map((scene) => ({
					narration_text: scene.narration_text,
					scene_type: scene.scene_type,
					duration_seconds: Number(scene.duration_seconds),
					news_title: scene.news_title,
					shots: sceneShots(scene),
				})),
			}),
		[title, isShorts, scenes],
	);
	const visibleRetentionIssue = openingRetentionReport.issues.find(
		(issue) => issue.severity === "critical" || issue.severity === "warning",
	);
	const productionScenes = useMemo(
		() => buildProductionScenes(scenes, remotionScenes),
		[scenes, remotionScenes],
	);
	const buildProductionReport = (
		finalBgmUrl = bgmUrl,
		thumbnailPath = localStorage.getItem(`thumbnail_path_${scriptId}`) ?? "",
		sourceScenes = scenes,
		sourceRemotionScenes = remotionScenes,
		finalNarrationUrl = narrationUrl,
	): ProductionQualityReport =>
		analyzeProductionQuality({
			title,
			description,
			format: isShorts ? "shorts" : "longform",
			scenes: buildProductionScenes(sourceScenes, sourceRemotionScenes),
			narrationUrl: finalNarrationUrl,
			bgmUrl: finalBgmUrl,
			thumbnailPath,
			thumbnailPlanned: Boolean(thumbnailPlan),
		});
	const productionQualityReport = useMemo(
		() =>
			analyzeProductionQuality({
				title,
				description,
				format: isShorts ? "shorts" : "longform",
				scenes: productionScenes,
				narrationUrl,
				bgmUrl,
				thumbnailPath: localStorage.getItem(`thumbnail_path_${scriptId}`) ?? "",
				thumbnailPlanned: Boolean(thumbnailPlan),
			}),
		[
			title,
			description,
			isShorts,
			productionScenes,
			narrationUrl,
			bgmUrl,
			thumbnailPlan,
			scriptId,
		],
	);
	const thumbnailReadiness = useMemo(
		() =>
			assessThumbnailReadiness({
				title,
				description,
				thumbnailPath: localStorage.getItem(`thumbnail_path_${scriptId}`) ?? "",
				thumbnailPlan,
				isShorts,
			}),
		[title, description, thumbnailPlan, isShorts, scriptId],
	);
	const referenceApplicationReport = useMemo(
		() =>
			savedReferenceApplicationReport?.score
				? savedReferenceApplicationReport
				: assessReferenceApplicationScore({
						referenceTemplate,
						format: isShorts ? "shorts" : "longform",
						topicTitle: title,
						shortsScript,
						scenes,
						sourceCount: savedSourceSafetyReport?.metrics.sourceCount,
					}),
		[
			savedReferenceApplicationReport,
			referenceTemplate,
			isShorts,
			title,
			shortsScript,
			scenes,
			savedSourceSafetyReport,
		],
	);
	const finalOutputCritique = useMemo(
		() =>
			buildFinalOutputCritique({
				production: productionQualityReport,
				policy: uploadPolicyReport,
				thumbnail: thumbnailReadiness,
				reference: referenceApplicationReport,
				sourceSafety: savedSourceSafetyReport,
			}),
		[
			productionQualityReport,
			uploadPolicyReport,
			thumbnailReadiness,
			referenceApplicationReport,
			savedSourceSafetyReport,
		],
	);
	const visibleProductionIssue = productionQualityReport.issues.find(
		(issue) =>
			(issue.severity === "critical" || issue.severity === "warning") &&
			!issue.code.startsWith("policy_") &&
			!issue.code.startsWith("opening_"),
	);

	// ── quality_loop_v2: 시장 벤치마크 + 판정 입력 번들 (critique 블록 직후) ──
	const benchmarkGenre = useMemo(() => classifyBenchmarkGenre(title), [title]);
	const marketBenchmark = useMemo(() => {
		const format = isShorts ? "shorts" : "longform";
		const samples = referenceTemplate
			? collectBenchmarkSamples([referenceTemplate], format)
			: [];
		return resolveMarketBenchmark({
			genre: benchmarkGenre,
			format,
			...(samples.length > 0 ? { samples } : {}),
		});
	}, [benchmarkGenre, isShorts, referenceTemplate]);
	const marketQualityBundle = useMemo<ContentBundle | null>(() => {
		if (!qualityLoopEnabled || scenes.length === 0) return null;
		return buildPreviewContentBundle({
			scriptId,
			isShorts,
			scenes,
			ttsPreset: referencePreset?.tts,
			bgmMood: referencePreset?.bgm.mood || undefined,
			hasBeatGrid:
				loadStoredBgmAnalysis(scriptId) !== null || bgmCuePlan !== null,
			hasNarrationAudio: narrationUrl !== "",
			bgmClaimBlocked: loadBgmClaimBlocked(scriptId) ?? presetClaimBlocked,
		});
	}, [
		qualityLoopEnabled,
		scenes,
		scriptId,
		isShorts,
		referencePreset,
		narrationUrl,
		bgmCuePlan,
		presetClaimBlocked,
	]);
	const combinedMarketVerdict = useMemo<QualityVerdict | null>(() => {
		if (!qualityLoopEnabled || !marketVerdictReport) return null;
		return combineWithExistingVerdicts(marketVerdictReport.verdict, [
			finalOutputCritique.passed ? "ready" : "review",
			productionQualityReport.passed ? "ready" : "review",
		]);
	}, [
		qualityLoopEnabled,
		marketVerdictReport,
		finalOutputCritique,
		productionQualityReport,
	]);
	const marketVerdictBlocked =
		qualityLoopEnabled && combinedMarketVerdict === "blocked";
	// 첫 판정 리포트 도착 전(pending)에는 승인 불가 — 백그라운드 루프 경합으로
	// 하드 블록이 나중에 발견되는 우회를 차단한다. 루프 오류 시에는 pending 해제
	// 후 레거시 repair 경로로 폴백한다.
	const marketVerdictPending =
		qualityLoopEnabled &&
		marketQualityBundle !== null &&
		marketVerdictReport === null &&
		marketLoopError === "";

	// quality_loop_v2: 백그라운드 품질 루프 — await 없이 시작,
	// 씬 편집(deps 변경)/단계 이탈(unmount) 시 cleanup 에서 cancel()
	useEffect(() => {
		if (!marketQualityBundle) return undefined;

		// 번들 입력이 바뀌면 이전 판정은 stale — null 로 리셋해 pending 게이트가 걸리게
		// 한다. 새 루프의 첫 판정이 나오기 전 승인되어 나중에 발견될 하드 블록을 우회하는
		// 경합을 막는다.
		marketVerdictReportRef.current = null;
		setMarketVerdictReport(null);

		let active = true;
		// 대사 텍스트를 바꾸는 fix(opening_hook_rewrite/ending_narration_patch)가 적용되면
		// 나레이션 오디오가 stale 해진다 — 루프 종료 후 1회 재합성해 자막/오디오를 일치시킨다.
		let narrationTextChanged = false;
		const getBundle = (): ContentBundle =>
			buildPreviewContentBundle({
				scriptId,
				isShorts,
				scenes: scenesRef.current,
				ttsPreset: referencePreset?.tts,
				bgmMood: referencePreset?.bgm.mood || undefined,
				hasBeatGrid:
					loadStoredBgmAnalysis(scriptId) !== null ||
					bgmCuePlanRef.current !== null,
				hasNarrationAudio: narrationUrl !== "",
				bgmClaimBlocked: loadBgmClaimBlocked(scriptId) ?? presetClaimBlocked,
			});

		// 기존 repair 의 setState 로직 재사용 — scenes/remotionScenes 를 인덱스 정합으로 갱신.
		// ref 를 동기 갱신해야 같은 루프의 다음 라운드 getBundle() 이 보강 후 번들을 판정한다.
		const applyScenePatch = (
			sceneId: string,
			patch: SceneRepairPatch,
		): void => {
			const index = scenesRef.current.findIndex(
				(scene) => scene.id === sceneId,
			);
			if (index < 0) return;
			const nextScenes = scenesRef.current.map((scene) =>
				scene.id === sceneId ? { ...scene, ...patch } : scene,
			);
			const nextRemotionScenes = remotionScenesRef.current.map(
				(scene, sceneIndex) => {
					if (sceneIndex !== index) return scene;
					return {
						...scene,
						...(patch.narration_text !== undefined
							? { narration: patch.narration_text }
							: {}),
						...(typeof patch.duration_seconds === "number"
							? {
									durationInFrames: Math.ceil(
										patch.duration_seconds * VIDEO_FPS,
									),
								}
							: {}),
						...(patch.transition !== undefined
							? {
									transition: patch.transition as RemotionScene["transition"],
								}
							: {}),
						...(patch.shots !== undefined ? { shots: patch.shots } : {}),
						...(patch.motion_graphics !== undefined
							? { motionGraphics: patch.motion_graphics }
							: {}),
					};
				},
			);
			scenesRef.current = nextScenes;
			remotionScenesRef.current = nextRemotionScenes;
			setScenes(nextScenes);
			setRemotionScenes(nextRemotionScenes);
			// state 와 DB 를 함께 갱신 — 새로고침/단계 이탈 시에도 보강이 보존돼야
			// fix history(이미 적용됨)와 실제 콘텐츠가 어긋나지 않는다
			void updateSceneRecord(
				sceneId,
				patch as unknown as Record<string, unknown>,
			).catch((error: unknown) => {
				if (!active) return;
				// DB 영속 실패 → 멱등 레저가 미저장 패치의 재시도를 막지 않도록 이 콘텐츠의
				// fix 이력을 무효화한다(다음 루프에서 재적용·재저장). render 는 state 기반이라
				// 이번 세션 산출물은 정상이며, 에러는 사용자에게 노출한다.
				try {
					localStorage.removeItem(`quality_fix_history_${scriptId}`);
				} catch {
					/* localStorage 불가 환경 무시 */
				}
				setMarketLoopError(
					error instanceof Error ? error.message : String(error),
				);
			});
		};

		const fixContext: AutoFixContext = {
			// orchestrator 가 실행 직전 spread 하므로 getter 가 항상 최신 씬을 공급한다
			get scenes() {
				return scenesRef.current;
			},
			applyScenePatch,
			replaceNarration: (sceneId, narration) => {
				applyScenePatch(sceneId, { narration_text: narration });
				narrationTextChanged = true;
			},
			// 기존 핸들러(regenerateNarration) 연결 — 연속 나레이션 전체 재합성.
			// 벤치마크가 지시한 TTS 옵션을 그대로 넘겨 retake 가 실제로 설정을 교정한다.
			retakeTts: async (_sceneIds, options) => {
				const regenerate = regenerateNarrationRef.current;
				if (!regenerate) {
					throw new Error("TTS 재생성 핸들러가 아직 준비되지 않았습니다.");
				}
				const workingScenes = scenesRef.current.map((scene) => ({
					...scene,
					shots: cloneShots(sceneShots(scene)),
				}));
				const workingRemotionScenes = remotionScenesRef.current.map(
					(scene) => ({ ...scene, shots: cloneShots(scene.shots) }),
				);
				await regenerate(
					workingScenes,
					workingRemotionScenes,
					options as Partial<TtsOptions>,
				);
				if (!active) return;
				// 오디오를 새로 합성했으므로 텍스트-오디오는 다시 일치 — stale 플래그 해제
				narrationTextChanged = false;
				// 다음 라운드 재판정이 재합성 결과를 읽도록 ref 도 동기 갱신
				scenesRef.current = workingScenes;
				remotionScenesRef.current = workingRemotionScenes;
				setScenes(workingScenes);
				setRemotionScenes(workingRemotionScenes);
			},
			// swapBgm/normalizeBgm 은 기존 무드 지정 핸들러가 없어 미연결 → unsupported skip
			replanBgmCues: (plan) => {
				// ref 동기 갱신 — 다음 라운드 번들의 hasBeatGrid 신호에 즉시 반영
				bgmCuePlanRef.current = plan;
				setBgmCuePlan(plan);
			},
			referenceDna: referenceProductionDnaFromTemplate(referenceTemplate),
			format: isShorts ? "shorts" : "longform",
			get topicTitle() {
				return titleRef.current;
			},
		};

		const scheduled = scheduleQualityLoop(
			{ getBundle, benchmark: marketBenchmark, fixContext },
			{
				llm: callOpenAI,
				onRound: (report) => {
					if (!active) return;
					marketVerdictReportRef.current = report;
					setMarketVerdictReport(report);
				},
				approveOverBudget: async (plan: AutoFixPlan) =>
					window.confirm(
						`품질 자동 보강 예산 초과 — 예상 비용 $${plan.totalCost.usd.toFixed(2)}, LLM ${plan.totalCost.llmCalls}콜.${plan.approvalReason ? ` 사유: ${plan.approvalReason}` : ""} 계속할까요?`,
					),
			},
		);
		void scheduled.promise
			.then(async (result) => {
				if (!active) return;
				// 대사 텍스트만 바뀌고 오디오 재합성이 안 된 fix 가 있었다면, 승인 전에
				// 나레이션을 1회 재합성해 자막(새 텍스트)과 오디오(이전)가 어긋나지 않게 한다.
				const regenerate = regenerateNarrationRef.current;
				if (narrationTextChanged && regenerate) {
					const workingScenes = scenesRef.current.map((scene) => ({
						...scene,
						shots: cloneShots(sceneShots(scene)),
					}));
					const workingRemotionScenes = remotionScenesRef.current.map(
						(scene) => ({ ...scene, shots: cloneShots(scene.shots) }),
					);
					await regenerate(workingScenes, workingRemotionScenes);
					if (!active) return;
					scenesRef.current = workingScenes;
					remotionScenesRef.current = workingRemotionScenes;
					setScenes(workingScenes);
					setRemotionScenes(workingRemotionScenes);
				}
				marketVerdictReportRef.current = result.finalReport;
				setMarketVerdictReport(result.finalReport);
			})
			.catch((error: unknown) => {
				if (!active) return;
				setMarketLoopError(
					error instanceof Error ? error.message : String(error),
				);
			});

		return () => {
			active = false;
			scheduled.cancel();
		};
	}, [
		marketQualityBundle,
		marketBenchmark,
		scriptId,
		isShorts,
		referencePreset,
		referenceTemplate,
		narrationUrl,
		presetClaimBlocked,
	]);

	async function ensureBgmUrl(): Promise<string> {
		const current =
			bgmUrl ||
			localStorage.getItem(`bgm_url_${scriptId}`) ||
			localStorage.getItem("bgm_url") ||
			"";
		if (current) return current;

		const restored = await loadStoredBgmUrl(scriptId, ensureBlobUrls);
		if (restored) {
			localStorage.setItem(`bgm_url_${scriptId}`, restored);
			setBgmUrl(restored);
			return restored;
		}

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
		const pickedUrl = bgmResult?.url ?? "";
		if (pickedUrl) {
			localStorage.setItem(`bgm_url_${scriptId}`, pickedUrl);
			setBgmUrl(pickedUrl);
			return pickedUrl;
		}
		throw new Error(
			"BGM 자동 선택에 실패했습니다. 기본 BGM 또는 로컬 BGM을 먼저 설정하세요.",
		);
	}

	async function regenerateNarration(
		workingScenes: SceneWithAssets[],
		workingRemotionScenes: RemotionScene[],
		ttsOverride?: Partial<TtsOptions>,
	): Promise<string> {
		setRenderProgress("품질 자동 보강: 엔딩 TTS를 다시 생성하고 있습니다...");
		// 벤치마크가 지시한 TTS 옵션(profile/speed)을 프리셋 위에 덮어써 retake 가
		// 실제로 문제된 설정을 교정하도록 한다. override 없으면 기존 동작 보존.
		const ttsOptions = ttsOverride
			? { ...referencePreset?.tts, ...ttsOverride }
			: referencePreset?.tts;
		const { url, sceneDurations } = await generateContinuousNarration(
			scriptId,
			workingScenes.map((scene) => ({
				id: scene.id,
				narration_text: scene.narration_text,
			})),
			ttsOptions,
		);
		setNarrationUrl(url);

		const { data: refreshed } = await supabase
			.from("scenes")
			.select("id, duration_seconds, word_timings")
			.in(
				"id",
				workingScenes.map((scene) => scene.id),
			);
		const timingMap = new Map(
			(refreshed ?? []).map((scene) => [
				scene.id as string,
				scene as {
					id: string;
					duration_seconds?: number;
					word_timings?: RemotionScene["wordTimings"];
				},
			]),
		);

		for (let index = 0; index < workingScenes.length; index++) {
			const refreshedScene = timingMap.get(workingScenes[index].id);
			const duration =
				Number(refreshedScene?.duration_seconds) ||
				sceneDurations[index] ||
				Number(workingScenes[index].duration_seconds);
			const wordTimings = refreshedScene?.word_timings;
			workingScenes[index] = {
				...workingScenes[index],
				duration_seconds: duration,
				word_timings: wordTimings,
			};
			workingRemotionScenes[index] = {
				...workingRemotionScenes[index],
				durationInFrames: Math.ceil(duration * VIDEO_FPS),
				narration: workingScenes[index].narration_text,
				wordTimings,
			};
		}

		return url;
	}

	async function repairProductionQuality(
		finalBgmUrl: string,
		options: {
			forcedIssueCodes?: string[];
			denseMotion?: boolean;
			progressMessage?: string;
		} = {},
	): Promise<{
		report: ProductionQualityReport;
		scenes: SceneWithAssets[];
		remotionScenes: RemotionScene[];
		narrationUrl: string;
		repaired: boolean;
	}> {
		const workingScenes = scenes.map((scene) => ({
			...scene,
			shots: cloneShots(sceneShots(scene)),
		}));
		const workingRemotionScenes = remotionScenes.map((scene) => ({
			...scene,
			shots: cloneShots(scene.shots),
		}));
		let report = buildProductionReport(
			finalBgmUrl,
			"",
			workingScenes,
			workingRemotionScenes,
		);
		if (report.passed && !options.forcedIssueCodes?.length) {
			return {
				report,
				scenes: workingScenes,
				remotionScenes: workingRemotionScenes,
				narrationUrl,
				repaired: false,
			};
		}

		let repaired = false;
		let narrationDirty = false;
		let finalNarrationUrl = narrationUrl;
		const issueCodes = [
			...new Set([
				...report.issues.map((issue) => issue.code),
				...(options.forcedIssueCodes ?? []),
			]),
		];
		const referenceRepairGuidance = buildReferenceRepairGuidance(
			referenceProductionDnaFromTemplate(referenceTemplate),
		);
		if (issueCodes.includes("missing_narration")) {
			narrationDirty = true;
			repaired = true;
		}

		if (shouldRepairMotionDesign(issueCodes)) {
			setRenderProgress(
				options.progressMessage ??
					"품질 자동 보강: 정적 이미지 씬에 모션/출처 표시를 보강하고 있습니다...",
			);
			for (let index = 0; index < workingScenes.length; index++) {
				if (workingScenes[index].scene_type === "text_emphasis") continue;
				const patch = buildMotionRepairPatch(workingScenes[index], index, {
					dense: options.denseMotion,
					forceMotion: options.denseMotion,
					reason: options.denseMotion
						? "실제 렌더 QC 실패 후 화면 변화량/컷 밀도 강제 보강"
						: undefined,
					referenceGuidance: referenceRepairGuidance,
				});
				await updateSceneRecord(
					workingScenes[index].id,
					patch as unknown as Record<string, unknown>,
				);
				workingScenes[index] = {
					...workingScenes[index],
					...patch,
				};
				workingRemotionScenes[index] = {
					...workingRemotionScenes[index],
					transition:
						(patch.transition as RemotionScene["transition"]) ??
						workingRemotionScenes[index].transition,
					shots: patch.shots ?? workingRemotionScenes[index].shots,
					motionGraphics:
						patch.motion_graphics ??
						workingRemotionScenes[index].motionGraphics,
				};
				repaired = true;
			}
		}

		if (shouldRepairNarrationEnding(issueCodes) && workingScenes.length > 0) {
			const lastIndex = workingScenes.length - 1;
			const last = workingScenes[lastIndex];
			const narration = strengthenEndingNarration(
				last.narration_text,
				isShorts ? "shorts" : "longform",
			);
			const duration = Math.max(
				Number(last.duration_seconds) || 0,
				isShorts ? 3 : 7,
			);
			await updateSceneRecord(last.id, {
				narration_text: narration,
				duration_seconds: duration,
			});
			workingScenes[lastIndex] = {
				...last,
				narration_text: narration,
				duration_seconds: duration,
			};
			workingRemotionScenes[lastIndex] = {
				...workingRemotionScenes[lastIndex],
				narration,
				durationInFrames: Math.ceil(duration * VIDEO_FPS),
			};
			narrationDirty = true;
			repaired = true;
		}

		if (narrationDirty) {
			finalNarrationUrl = await regenerateNarration(
				workingScenes,
				workingRemotionScenes,
			);
		}

		report = buildProductionReport(
			finalBgmUrl,
			"",
			workingScenes,
			workingRemotionScenes,
			finalNarrationUrl,
		);
		setScenes(workingScenes);
		setRemotionScenes(workingRemotionScenes);
		setBgmCuePlan(planBgmCuePlan(workingRemotionScenes, { fps: VIDEO_FPS }));

		return {
			report,
			scenes: workingScenes,
			remotionScenes: workingRemotionScenes,
			narrationUrl: finalNarrationUrl,
			repaired,
		};
	}

	async function handleApprove() {
		if (blockingPolicyIssue) {
			setApprovalError(blockingPolicyIssue.message);
			return;
		}
		if (!openingRetentionReport.passed && visibleRetentionIssue) {
			setApprovalError(
				`초반 유지율 기준 미달: ${visibleRetentionIssue.message}`,
			);
			return;
		}
		if (marketVerdictBlocked) {
			const hardBlocks = marketVerdictReportRef.current?.hardBlocks ?? [];
			setApprovalError(
				`시장 품질 판정 차단: ${
					hardBlocks.length > 0 ? hardBlocks.join(", ") : "하드 블록"
				} — 보강 후 다시 시도하세요.`,
			);
			return;
		}
		if (marketVerdictPending) {
			setApprovalError(
				"시장 품질 판정이 진행 중입니다 — 첫 판정이 끝난 뒤 승인할 수 있습니다.",
			);
			return;
		}
		setApprovalError("");
		setApproving(true);
		setRendering(true);
		setRenderProgress("품질 게이트를 검증하고 있습니다...");

		try {
			const ensuredBgmUrl = await ensureBgmUrl();
			// quality_loop_v2: ad-hoc repair 대신 백그라운드 품질 루프가 보강을 담당.
			// 기존 repair 블록은 플래그 off 경로로 보존되며, 루프가 오류로 죽었을
			// 때도 레거시 repair 로 폴백해 무보강 승인을 막는다.
			const repaired =
				qualityLoopEnabled && marketLoopError === ""
					? {
							report: buildProductionReport(ensuredBgmUrl, ""),
							scenes,
							remotionScenes,
							narrationUrl,
							repaired: false,
						}
					: await repairProductionQuality(ensuredBgmUrl);
			if (!repaired.report.passed) {
				const blockingIssue =
					repaired.report.issues.find(
						(issue) => issue.severity === "critical",
					) ??
					repaired.report.issues.find((issue) => issue.severity === "warning");
				setApprovalError(
					`품질 기준 미달: ${
						blockingIssue?.message ??
						"자동 보강 후에도 영상 품질 점수가 기준보다 낮습니다."
					}`,
				);
				setRenderProgress(
					"자동 보강 후에도 품질 기준 미달이라 렌더를 시작하지 않았습니다.",
				);
				return;
			}

			setRenderProgress("썸네일을 생성하고 있습니다...");
			await generateAndSaveThumbnail(scriptId, {
				backgroundUrl: chooseThumbnailBackground(repaired.scenes),
				title: compactThumbnailTitle(
					title,
					thumbnailPlan?.title ?? "사건 타임라인",
				),
				subtitle:
					thumbnailPlan?.subtitle ?? (isShorts ? "핵심 60초" : "확인된 흐름"),
				channelName,
				accentColor: thumbnailPlan?.accentColor,
				preset: thumbnailPlan?.preset ?? "mystery",
				badgeText: thumbnailPlan?.badgeText,
				textZone: thumbnailPlan?.layout,
				referenceDna: thumbnailPlan?.referenceDna,
			});
			const thumbnailPath = thumbnailPathForScript(scriptId);
			const finalReport = buildProductionReport(
				ensuredBgmUrl,
				thumbnailPath,
				repaired.scenes,
				repaired.remotionScenes,
				repaired.narrationUrl,
			);
			if (!finalReport.passed) {
				const blockingIssue =
					finalReport.issues.find((issue) => issue.severity === "critical") ??
					finalReport.issues.find((issue) => issue.severity === "warning");
				setApprovalError(
					`품질 기준 미달: ${
						blockingIssue?.message ??
						"썸네일 생성 후 품질 기준을 통과하지 못했습니다."
					}`,
				);
				setRenderProgress("품질 기준 미달로 렌더를 시작하지 않았습니다.");
				return;
			}
			const approvalCritique = buildFinalOutputCritique({
				production: finalReport,
				policy: uploadPolicyReport,
				thumbnail: assessThumbnailReadiness({
					title,
					description,
					thumbnailPath,
					thumbnailPlan,
					isShorts,
				}),
				reference: referenceApplicationReport,
				sourceSafety: savedSourceSafetyReport,
			});
			if (!approvalCritique.passed) {
				setApprovalError(
					`최종 산출물 비평 기준 미달: ${
						approvalCritique.blockers[0] ??
						approvalCritique.warnings[0] ??
						"업로드 전 추가 보강이 필요합니다."
					}`,
				);
				setRenderProgress("최종 비평 기준 미달로 렌더를 시작하지 않았습니다.");
				return;
			}

			setRenderProgress("렌더 자산을 준비하고 있습니다...");
			const totalDuration = repaired.scenes.reduce(
				(sum, s) => sum + Number(s.duration_seconds),
				0,
			);

			const renderFormat = isShorts ? "shorts" : "longform";
			const initialKnowledgeEvent = buildRenderKnowledgeEvent({
				referenceTemplate,
				productionReport: finalReport,
				format: renderFormat,
				repaired: repaired.repaired,
			});
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
						subtitles_ok:
							finalReport.metrics.captionSyncRatio >= 0.65 ||
							remotionScenes.every((scene) => scene.type === "text_emphasis"),
						premium_floor_ok: finalReport.metrics.premiumFloorScore >= 86,
						forbidden_words_ok: !uploadPolicyReport.issues.some(
							(issue) => issue.severity === "critical",
						),
						silence_gaps_ok: finalReport.metrics.hasNarration,
						auto_repair_applied: repaired.repaired,
						production_quality_score: finalReport.score,
						production_quality_passed: finalReport.passed,
						production_quality_metrics: finalReport.metrics,
						production_quality_issues: finalReport.issues,
						production_quality_actions: finalReport.requiredActions,
						knowledge_event: initialKnowledgeEvent,
						// quality_loop_v2: 시장 판정 최종 리포트를 JSON 필드로 중첩
						// (스키마 마이그레이션 없음)
						...(qualityLoopEnabled && marketVerdictReportRef.current
							? { market_verdict: marketVerdictReportRef.current }
							: {}),
					},
				})
				.select()
				.maybeSingle();

			if (!render) {
				throw new Error("렌더 레코드 생성에 실패했습니다.");
			}

			const submitRenderAttempt = async (
				input: Awaited<ReturnType<typeof repairProductionQuality>>,
				progressLabel: string,
			): Promise<RenderJob> => {
				const referenceFrameProfile =
					referenceFrameProfileFromTemplate(referenceTemplate);
				const renderPayload = await prepareRenderPayload({
					scriptId,
					scenes: input.remotionScenes,
					narrationUrl: input.narrationUrl,
					bgmUrl: ensuredBgmUrl,
				});
				setRenderProgress(progressLabel);
				const job = await submitRender(
					scriptId,
					renderFormat,
					{
						scenes: renderPayload.scenes,
						bgmUrl: renderPayload.bgmUrl,
						bgmCuePlan:
							planBgmCuePlan(input.remotionScenes, { fps: VIDEO_FPS }) ??
							bgmCuePlan ??
							undefined,
						narrationUrl: renderPayload.narrationUrl,
						brand: channelBranding,
						...compositionOverrides,
						...(referenceFrameProfile ? { referenceFrameProfile } : {}),
					},
					{
						preset: renderQuality,
						...(hwAccelOverride ? { hardwareAccel: hwAccelOverride } : {}),
					},
				);
				return pollRenderProgress(job.id, (progress, status) => {
					setRenderProgress(`렌더링 중... ${progress}% (${status})`);
				});
			};

			let renderQcBase =
				(render.qc_result_json as Record<string, unknown> | null) ?? {};
			let finalRenderResult = repaired;
			let renderOutputRepairAttempted = false;

			// 렌더큐 서버에 실제 렌더 요청 (템플릿 오버라이드 + quality preset + HW accel)
			try {
				let completed: RenderJob | null = null;
				const maxRenderOutputRepairAttempts = 2;
				for (
					let attempt = 0;
					attempt <= maxRenderOutputRepairAttempts;
					attempt++
				) {
					try {
						completed = await submitRenderAttempt(
							finalRenderResult,
							attempt === 0
								? "영상을 렌더링하고 있습니다..."
								: `보강 ${attempt}차 후 영상을 다시 렌더링하고 있습니다...`,
						);
						break;
					} catch (renderError) {
						const failedJob = isRenderJobError(renderError)
							? renderError.job
							: null;
						const qc = failedJob?.qcResult as RenderOutputQcLike | undefined;
						const issueCodes = renderOutputIssueCodes(qc);
						if (
							failedJob?.errorCategory !== "quality_gate" ||
							!shouldRepairRenderOutput(issueCodes) ||
							attempt >= maxRenderOutputRepairAttempts
						) {
							throw renderError;
						}

						renderOutputRepairAttempted = true;
						renderQcBase = mergeRenderOutputQc(renderQcBase, qc, {
							render_output_repair_attempted: true,
							render_output_repair_attempt: attempt + 1,
							render_output_repair_reason: issueCodes,
							render_output_repair_stage: `render_failed_attempt_${attempt + 1}`,
						});
						await supabase
							.from("renders")
							.update({
								status: "rendering",
								...(failedJob.outputPath
									? { storage_path: failedJob.outputPath }
									: {}),
								qc_result_json: renderQcBase,
							})
							.eq("id", render.id);

						const forcedIssueCodes =
							renderOutputIssueCodesToProductionIssueCodes(issueCodes);
						finalRenderResult = await repairProductionQuality(ensuredBgmUrl, {
							forcedIssueCodes,
							denseMotion: true,
							progressMessage: `실제 렌더 QC 실패(${attempt + 1}/${maxRenderOutputRepairAttempts}): 레퍼런스 대비 화면 변화량과 컷 밀도를 보강하고 있습니다...`,
						});
						if (!finalRenderResult.report.passed) {
							const blockingIssue =
								finalRenderResult.report.issues.find(
									(issue) => issue.severity === "critical",
								) ??
								finalRenderResult.report.issues.find(
									(issue) => issue.severity === "warning",
								);
							throw new Error(
								`실제 렌더 QC 보강 실패: ${
									blockingIssue?.message ??
									"자동 보강 후에도 제작 품질 기준을 통과하지 못했습니다."
								}`,
							);
						}

						renderQcBase = {
							...renderQcBase,
							auto_repair_applied: true,
							render_output_repair_production_score:
								finalRenderResult.report.score,
							render_output_repair_production_metrics:
								finalRenderResult.report.metrics,
						};
					}
				}

				if (!completed) throw new Error("렌더링 결과를 확인하지 못했습니다.");
				if (completed.status === "failed") {
					throw new Error(completed.error ?? "렌더링 실패");
				}

				await supabase
					.from("renders")
					.update({
						status: "complete",
						storage_path:
							completed.outputPath || `renders/${scriptId}/final.mp4`,
						qc_result_json: mergeRenderOutputQc(
							renderQcBase,
							completed.qcResult as RenderOutputQcLike | undefined,
							{
								render_output_repair_attempted: renderOutputRepairAttempted,
								render_output_repair_succeeded:
									renderOutputRepairAttempted || undefined,
								knowledge_event: buildRenderKnowledgeEvent({
									referenceTemplate,
									productionReport: finalRenderResult.report,
									format: renderFormat,
									renderOutputQc: completed.qcResult as
										| RenderOutputQcLike
										| undefined,
									repaired:
										finalRenderResult.repaired || renderOutputRepairAttempted,
								}),
							},
						),
					})
					.eq("id", render.id);
			} catch (e) {
				const msg = renderFailureMessage(e);
				const failedJob = isRenderJobError(e) ? e.job : null;
				await supabase
					.from("renders")
					.update({
						status: "failed",
						...(failedJob?.outputPath
							? { storage_path: failedJob.outputPath }
							: {}),
						qc_result_json: mergeRenderOutputQc(
							renderQcBase,
							failedJob?.qcResult as RenderOutputQcLike | undefined,
							{
								render_output_repair_attempted: renderOutputRepairAttempted,
								render_output_repair_succeeded: false,
								knowledge_event: buildRenderKnowledgeEvent({
									referenceTemplate,
									productionReport: finalRenderResult.report,
									format: renderFormat,
									renderOutputQc: failedJob?.qcResult as
										| RenderOutputQcLike
										| undefined,
									repaired:
										finalRenderResult.repaired || renderOutputRepairAttempted,
								}),
							},
						),
					})
					.eq("id", render.id);
				throw new Error(msg);
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
				thumbnail_path: thumbnailPath,
				status: "queued",
			});
			setApproved(true);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "승인 처리 실패";
			setApprovalError(msg);
			setRenderProgress(`처리 실패: ${msg}`);
		} finally {
			setRendering(false);
			setApproving(false);
		}
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
					<PTag color="notification-success-soft">영상/이미지+음성 완료</PTag>
				</div>
			</div>

			<ProductionQualityPanel
				report={productionQualityReport}
				nicheResearch={nicheResearch}
			/>
			<FinalOutputCritiquePanel
				report={finalOutputCritique}
				referenceReport={referenceApplicationReport}
				sourceSafetyReport={savedSourceSafetyReport}
			/>
			{qualityLoopEnabled && marketVerdictReport && combinedMarketVerdict && (
				<MarketQualityVerdictPanel
					report={marketVerdictReport}
					combinedVerdict={combinedMarketVerdict}
				/>
			)}
			{qualityLoopEnabled && marketLoopError && (
				<PInlineNotification
					state="warning"
					dismissButton={false}
					className="mb-static-md"
				>
					시장 품질 루프 오류: {marketLoopError}
				</PInlineNotification>
			)}

			{/* Remotion Player - Real Video Preview */}
			{remotionScenes.length > 0 && (
				<div className="mb-static-lg rounded-[8px] overflow-hidden bg-[#000]">
					<Player
						component={VideoComposition}
						inputProps={{
							scenes: remotionScenes,
							// script-scoped BGM URL 우선 (리로드 후에도 안전), legacy 전역 키는 fallback
							bgmUrl,
							bgmCuePlan: bgmCuePlan ?? undefined,
							narrationUrl,
							brand: channelBranding,
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

			<ThumbnailPlanPanel
				plan={thumbnailPlan}
				readiness={thumbnailReadiness}
				isShorts={isShorts}
			/>

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
					rows={7}
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

			{approvalError && (
				<PInlineNotification
					state="error"
					dismissButton={false}
					className="mb-static-md"
				>
					{approvalError}
				</PInlineNotification>
			)}

			{visiblePolicyIssue && !approvalError && (
				<PInlineNotification
					state={
						visiblePolicyIssue.severity === "critical" ? "error" : "warning"
					}
					dismissButton={false}
					className="mb-static-md"
				>
					{visiblePolicyIssue.message}
					{uploadPolicyReport.requiredActions[0]
						? ` ${uploadPolicyReport.requiredActions[0]}`
						: ""}
				</PInlineNotification>
			)}

			{visibleRetentionIssue && !approvalError && (
				<PInlineNotification
					state={
						visibleRetentionIssue.severity === "critical" ? "error" : "warning"
					}
					dismissButton={false}
					className="mb-static-md"
				>
					{visibleRetentionIssue.message}
					{openingRetentionReport.requiredActions[0]
						? ` ${openingRetentionReport.requiredActions[0]}`
						: ""}
				</PInlineNotification>
			)}

			{visibleProductionIssue && !approvalError && (
				<PInlineNotification
					state={
						visibleProductionIssue.severity === "critical" ? "error" : "warning"
					}
					dismissButton={false}
					className="mb-static-md"
				>
					{visibleProductionIssue.message}
					{productionQualityReport.requiredActions[0]
						? ` ${productionQualityReport.requiredActions[0]}`
						: ""}
				</PInlineNotification>
			)}

			{marketVerdictBlocked && marketVerdictReport && !approvalError && (
				<PInlineNotification
					state="error"
					dismissButton={false}
					className="mb-static-md"
				>
					시장 품질 판정 차단:{" "}
					{marketVerdictReport.hardBlocks.join(", ") || "하드 블록"} — 보강
					전에는 렌더를 시작할 수 없습니다.
				</PInlineNotification>
			)}

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
									aria-pressed={active}
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
										aria-pressed={active}
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
				<PButton
					loading={approving}
					disabled={marketVerdictBlocked || marketVerdictPending}
					onClick={handleApprove}
				>
					{marketVerdictPending
						? "시장 품질 판정 중..."
						: "승인 및 업로드 대기"}
				</PButton>
			</div>
		</div>
	);
}
