import type { ReferenceTemplate } from "../types/database";
import { referenceToPreset } from "./reference-bridge";
import type { SceneShot } from "./scene-shot-types";

export type ReferenceApplicationSeverity = "critical" | "warning" | "info";

export interface ReferenceApplicationIssue {
	code: string;
	severity: ReferenceApplicationSeverity;
	message: string;
}

export interface ReferenceApplicationScene {
	narration?: string;
	narration_text?: string;
	type?: string;
	scene_type?: string;
	duration?: number;
	duration_seconds?: number;
	transition?: string;
	mood?: string;
	shots?: SceneShot[];
}

export interface ReferenceApplicationScoreInput {
	referenceTemplate?: ReferenceTemplate | null;
	format: "shorts" | "longform" | "both" | string;
	topicTitle?: string;
	shortsScript?: string;
	scenes: ReferenceApplicationScene[];
	sourceCount?: number;
}

export interface ReferenceApplicationScoreReport {
	passed: boolean;
	score: number;
	label: string;
	issues: ReferenceApplicationIssue[];
	requiredActions: string[];
	metrics: {
		sceneCountFit: number;
		durationFit: number;
		hookFit: number;
		cutDensityFit: number;
		sourceFit: number;
		motionFit: number;
		audioCueFit: number;
		copyBoundaryFit: number;
		totalDurationSeconds: number;
		shotCount: number;
		sourceAnchoredShotRatio: number;
	};
}

const COPY_BOUNDARY_PATTERNS = [
	/그대로\s*복제/,
	/원본\s*그대로/,
	/무단/,
	/copy\s*exactly/i,
	/reupload/i,
];

function durationOf(scene: ReferenceApplicationScene): number {
	const value = Number(scene.duration_seconds ?? scene.duration ?? 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function narrationOf(scene: ReferenceApplicationScene): string {
	return (scene.narration_text ?? scene.narration ?? "").replace(/\s+/g, " ").trim();
}

function typeOf(scene: ReferenceApplicationScene): string {
	return scene.scene_type ?? scene.type ?? "";
}

function clampScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function ratioFit(actual: number, target: number, tolerance = 0.35): number {
	if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return 50;
	const delta = Math.abs(actual - target) / target;
	if (delta <= tolerance) return 100;
	return clampScore(100 - (delta - tolerance) * 120);
}

function hasSourceAnchor(shot: SceneShot): boolean {
	if (!shot.source_url) return false;
	if (shot.selection_provider === "ai" || shot.visual_role === "reconstruction") {
		return false;
	}
	return true;
}

function hasMotion(shot: SceneShot): boolean {
	return Boolean(shot.motion && shot.motion !== "static");
}

function pushIssue(
	issues: ReferenceApplicationIssue[],
	severity: ReferenceApplicationSeverity,
	code: string,
	message: string,
) {
	issues.push({ severity, code, message });
}

export function assessReferenceApplicationScore(
	input: ReferenceApplicationScoreInput,
): ReferenceApplicationScoreReport {
	const reference = input.referenceTemplate;
	const scenes = input.scenes;
	const format =
		input.format === "shorts" || input.format === "longform"
			? input.format
			: reference && reference.duration_seconds >= 180
				? "longform"
				: "shorts";
	const preset = reference ? referenceToPreset(reference, format) : null;
	const issues: ReferenceApplicationIssue[] = [];
	const actions: string[] = [];

	if (!reference || !preset) {
		return {
			passed: false,
			score: 42,
			label: "레퍼런스 없음",
			issues: [
				{
					severity: "warning",
					code: "missing_reference",
					message: "선택되거나 자동 매칭된 레퍼런스가 없어 기본 도메인 규칙만 적용됩니다.",
				},
			],
			requiredActions: ["레퍼런스 템플릿을 선택하거나 자동 추천 후보를 먼저 확보하세요."],
			metrics: {
				sceneCountFit: 0,
				durationFit: 0,
				hookFit: 0,
				cutDensityFit: 0,
				sourceFit: 0,
				motionFit: 0,
				audioCueFit: 0,
				copyBoundaryFit: 100,
				totalDurationSeconds: 0,
				shotCount: 0,
				sourceAnchoredShotRatio: 0,
			},
		};
	}

	const totalDurationSeconds = scenes.reduce((sum, scene) => sum + durationOf(scene), 0);
	const allShots = scenes.flatMap((scene) => scene.shots ?? []);
	const sourceAnchoredShots = allShots.filter(hasSourceAnchor);
	const motionShots = allShots.filter(hasMotion);
	const visualScenes = scenes.filter((scene) => typeOf(scene) !== "text_emphasis");
	const firstSceneDuration = durationOf(scenes[0] ?? {});
	const firstNarration = narrationOf(scenes[0] ?? {});
	const firstShotChange =
		(scenes[0]?.shots ?? []).reduce((sum, shot) => sum + (shot.duration_seconds ?? 0), 0) >
		0;
	const sceneCountFit = ratioFit(scenes.length, preset.script.sceneCount, 0.4);
	const durationFit = ratioFit(totalDurationSeconds, preset.script.targetDuration, 0.45);
	const hookFit = clampScore(
		ratioFit(firstSceneDuration || preset.script.hookDuration, preset.script.hookDuration, 0.6) *
			0.45 +
			(/[?？!！]|왜|무엇|진짜|기록|비밀|소름/.test(firstNarration) ? 35 : 12) +
			(firstShotChange ? 20 : 8),
	);
	const cutDensityTarget =
		typeof preset.productionDna?.camera === "object" &&
		preset.productionDna.camera &&
		"cutDensityPerMinute" in preset.productionDna.camera &&
		typeof preset.productionDna.camera.cutDensityPerMinute === "number"
			? preset.productionDna.camera.cutDensityPerMinute
			: format === "shorts"
				? 12
				: 4;
	const cutDensity =
		totalDurationSeconds > 0 ? (Math.max(allShots.length, scenes.length) / totalDurationSeconds) * 60 : 0;
	const cutDensityFit = ratioFit(cutDensity, cutDensityTarget, 0.55);
	const sourceAnchoredShotRatio =
		allShots.length > 0 ? sourceAnchoredShots.length / allShots.length : 0;
	const sourceFit = clampScore(
		sourceAnchoredShotRatio * 72 +
			Math.min(20, (input.sourceCount ?? 0) * 5) +
			(reference.source_url ? 8 : 0),
	);
	const motionFit =
		allShots.length > 0
			? clampScore((motionShots.length / allShots.length) * 100)
			: visualScenes.length > 0
				? 35
				: 0;
	const audioCueFit = clampScore(
		(reference.bgm_mood ? 36 : 0) +
			(reference.bgm_tempo ? 22 : 0) +
			(reference.tts_tone_keywords?.length ? 22 : 0) +
			(reference.tts_provider ? 20 : 0),
	);
	const copyBoundaryFit = COPY_BOUNDARY_PATTERNS.some((pattern) =>
		pattern.test(`${input.topicTitle ?? ""} ${input.shortsScript ?? ""}`),
	)
		? 25
		: 100;

	if (sceneCountFit < 55) {
		pushIssue(
			issues,
			"warning",
			"scene_count_gap",
			`레퍼런스 씬 수(${preset.script.sceneCount})와 현재 씬 수(${scenes.length}) 차이가 큽니다.`,
		);
		actions.push("씬 수를 레퍼런스 목표의 ±40% 안으로 맞추거나 포맷을 다시 선택하세요.");
	}
	if (hookFit < 65) {
		pushIssue(
			issues,
			"critical",
			"weak_reference_hook",
			"레퍼런스 훅 시간/질문/첫 화면 변화 규칙이 약하게 반영됐습니다.",
		);
		actions.push("첫 씬을 더 짧게 나누고 질문형 훅과 첫 3초 화면 변화를 추가하세요.");
	}
	if (cutDensityFit < 55) {
		pushIssue(
			issues,
			"warning",
			"cut_density_gap",
			"레퍼런스 대비 컷 밀도가 낮아 정적 영상처럼 보일 수 있습니다.",
		);
		actions.push("샷 재구성으로 씬당 샷 수와 모션/SFX cue를 늘리세요.");
	}
	if (sourceFit < 55) {
		pushIssue(
			issues,
			"critical",
			"source_anchor_gap",
			"자료 기반 레퍼런스인데 출처 앵커가 부족합니다.",
		);
		actions.push("핵심 씬은 뉴스, 문서, 지도, 원본 이미지, 직접 관련 영상으로 연결하세요.");
	}
	if (copyBoundaryFit < 80) {
		pushIssue(
			issues,
			"critical",
			"copy_boundary_risk",
			"원본을 그대로 복제하겠다는 표현이 포함되어 있습니다.",
		);
		actions.push("원본 콘텐츠가 아니라 편집 문법, 컷 호흡, 화면 배치만 변환 적용하도록 문구를 바꾸세요.");
	}

	const score = clampScore(
		sceneCountFit * 0.13 +
			durationFit * 0.12 +
			hookFit * 0.18 +
			cutDensityFit * 0.15 +
			sourceFit * 0.16 +
			motionFit * 0.12 +
			audioCueFit * 0.08 +
			copyBoundaryFit * 0.06,
	);
	const criticals = issues.filter((issue) => issue.severity === "critical").length;

	return {
		passed: criticals === 0 && score >= 72,
		score,
		label:
			score >= 84
				? "레퍼런스 강함"
				: score >= 72
					? "레퍼런스 통과"
					: score >= 58
						? "레퍼런스 보강"
						: "레퍼런스 약함",
		issues,
		requiredActions: [...new Set(actions)],
		metrics: {
			sceneCountFit,
			durationFit,
			hookFit,
			cutDensityFit,
			sourceFit,
			motionFit,
			audioCueFit,
			copyBoundaryFit,
			totalDurationSeconds: Math.round(totalDurationSeconds),
			shotCount: allShots.length,
			sourceAnchoredShotRatio: Number(sourceAnchoredShotRatio.toFixed(2)),
		},
	};
}
