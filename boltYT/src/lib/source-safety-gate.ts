import type { SceneShot } from "./scene-shot-types";

export type SourceSafetySeverity = "critical" | "warning" | "info";

export interface SourceSafetyIssue {
	code: string;
	severity: SourceSafetySeverity;
	message: string;
	sceneIndex?: number;
}

export interface SourceSafetySource {
	type?: "image" | "video" | "article" | string;
	url?: string;
	title?: string;
	publisher?: string;
	description?: string;
	bodyText?: string;
}

export interface SourceSafetyScene {
	sourceIndex?: number;
	source_index?: number;
	source_url?: string;
	news_source?: string;
	scene_type?: string;
	type?: string;
	shots?: SceneShot[];
}

export interface SourceSafetyReport {
	passed: boolean;
	score: number;
	disclosureRequired: boolean;
	issues: SourceSafetyIssue[];
	requiredActions: string[];
	metrics: {
		sourceCount: number;
		articleCount: number;
		videoCount: number;
		imageCount: number;
		scenesWithSourceRatio: number;
		unattributedVideoSceneCount: number;
		syntheticShotCount: number;
	};
}

function isVideoUrl(value?: string): boolean {
	return /youtube\.com|youtu\.be|vimeo\.com|\.mp4(\?|#|$)|\.webm(\?|#|$)|\.mov(\?|#|$)/i.test(
		value ?? "",
	);
}

function isSyntheticShot(shot: SceneShot): boolean {
	return (
		shot.selection_provider === "ai" ||
		shot.selection_provider === "generated" ||
		shot.visual_role === "reconstruction" ||
		Boolean(shot.rejection_reason)
	);
}

function sceneSourceIndex(scene: SourceSafetyScene): number {
	const value = Number(scene.sourceIndex ?? scene.source_index ?? -1);
	return Number.isFinite(value) ? value : -1;
}

function sceneType(scene: SourceSafetyScene): string {
	return scene.scene_type ?? scene.type ?? "";
}

function pushAction(actions: string[], action: string) {
	if (!actions.includes(action)) actions.push(action);
}

export function analyzeSourceSafety(
	sources: SourceSafetySource[],
	scenes: SourceSafetyScene[],
): SourceSafetyReport {
	const issues: SourceSafetyIssue[] = [];
	const requiredActions: string[] = [];
	const articleCount = sources.filter((source) => source.type === "article").length;
	const videoCount = sources.filter((source) => source.type === "video").length;
	const imageCount = sources.filter((source) => source.type === "image").length;
	const scenesWithSource = scenes.filter((scene) => {
		const sourceIndex = sceneSourceIndex(scene);
		return sourceIndex >= 0 || Boolean(scene.source_url);
	});
	let unattributedVideoSceneCount = 0;
	let syntheticShotCount = 0;

	scenes.forEach((scene, index) => {
		const sourceIndex = sceneSourceIndex(scene);
		const source = sourceIndex >= 0 ? sources[sourceIndex] : undefined;
		const shotSyntheticCount = (scene.shots ?? []).filter(isSyntheticShot).length;
		syntheticShotCount += shotSyntheticCount;
		const hasVideo =
			sceneType(scene) === "video" ||
			source?.type === "video" ||
			isVideoUrl(scene.source_url) ||
			(scene.shots ?? []).some((shot) => isVideoUrl(shot.source_url));
		const hasAttribution = Boolean(
			scene.news_source || source?.publisher || source?.title,
		);
		if (hasVideo && !hasAttribution) {
			unattributedVideoSceneCount += 1;
			issues.push({
				code: "video_without_attribution",
				severity: "warning",
				sceneIndex: index + 1,
				message: "영상 자료가 연결됐지만 출처/채널명 표시가 약합니다.",
			});
			pushAction(
				requiredActions,
				"영상 자료를 쓰는 씬은 news_source 또는 source title을 채워 출처 로워서드가 가능하게 하세요.",
			);
		}
		if (shotSyntheticCount > 0 && hasVideo) {
			issues.push({
				code: "mixed_real_and_synthetic",
				severity: "info",
				sceneIndex: index + 1,
				message: "실제 영상과 AI 재구성 컷이 섞였습니다. 업로드 설명에 재구성 고지가 필요할 수 있습니다.",
			});
			pushAction(
				requiredActions,
				'설명란에 "일부 장면은 이해를 돕기 위한 AI 재구성입니다" 고지를 추가하세요.',
			);
		}
	});

	if (sources.length === 0 && scenes.length >= 3) {
		issues.push({
			code: "no_external_sources",
			severity: "warning",
			message: "자료 기반 제작인데 연결된 외부 자료가 없습니다.",
		});
		pushAction(
			requiredActions,
			"최소 2개 이상의 기사/이미지/영상 자료를 수집하거나 AI 재구성 영상임을 명확히 하세요.",
		);
	}

	if (articleCount === 0 && videoCount > 0 && scenes.length >= 4) {
		issues.push({
			code: "video_only_context",
			severity: "warning",
			message: "영상 자료만 있고 검증 가능한 기사/문서 맥락이 부족합니다.",
		});
		pushAction(
			requiredActions,
			"핵심 주장에는 기사, 공식 문서, 지도, 설명 가능한 출처를 함께 붙이세요.",
		);
	}

	const scenesWithSourceRatio =
		scenes.length > 0 ? scenesWithSource.length / scenes.length : 0;
	if (scenes.length >= 4 && scenesWithSourceRatio < 0.35) {
		issues.push({
			code: "low_scene_source_ratio",
			severity: "critical",
			message: "출처와 직접 연결된 씬 비율이 낮아 아무 자료나 붙인 영상처럼 보일 수 있습니다.",
		});
		pushAction(
			requiredActions,
			"핵심 씬마다 source_index, source_url, news_source 중 하나 이상을 채우세요.",
		);
	}

	const criticals = issues.filter((issue) => issue.severity === "critical").length;
	const warnings = issues.filter((issue) => issue.severity === "warning").length;
	const score = Math.max(0, 100 - criticals * 32 - warnings * 9);

	return {
		passed: criticals === 0,
		score,
		disclosureRequired: syntheticShotCount > 0,
		issues,
		requiredActions,
		metrics: {
			sourceCount: sources.length,
			articleCount,
			videoCount,
			imageCount,
			scenesWithSourceRatio: Number(scenesWithSourceRatio.toFixed(2)),
			unattributedVideoSceneCount,
			syntheticShotCount,
		},
	};
}
