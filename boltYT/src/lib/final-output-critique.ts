import type { ReferenceApplicationScoreReport } from "./reference-application-score";
import type { SourceSafetyReport } from "./source-safety-gate";
import type { ThumbnailReadiness } from "./thumbnail-intelligence";
import type { PolicyRiskReport } from "./youtube-policy-risk";
import type { ProductionQualityReport } from "./youtube-production-quality";

export interface FinalOutputCritiqueReport {
	passed: boolean;
	score: number;
	label: string;
	blockers: string[];
	warnings: string[];
	strengths: string[];
	nextActions: string[];
}

function clampScore(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function thumbnailScore(readiness: ThumbnailReadiness): number {
	if (typeof readiness.score === "number") return readiness.score;
	if (readiness.level === "ready") return 88;
	if (readiness.level === "warning") return 68;
	return 42;
}

export function buildFinalOutputCritique(input: {
	production: ProductionQualityReport;
	policy: PolicyRiskReport;
	thumbnail: ThumbnailReadiness;
	reference?: ReferenceApplicationScoreReport | null;
	sourceSafety?: SourceSafetyReport | null;
	hasRenderOutputQc?: boolean;
	renderOutputQcPassed?: boolean;
}): FinalOutputCritiqueReport {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const strengths: string[] = [];
	const nextActions: string[] = [];

	if (!input.production.passed) {
		blockers.push("제작 QC가 렌더 승인 기준을 통과하지 못했습니다.");
		nextActions.push(...input.production.requiredActions.slice(0, 3));
	} else {
		strengths.push("씬/컷/자막/BGM 제작 QC 통과");
	}
	if (!input.policy.passed) {
		blockers.push("YouTube 정책/기만 리스크가 남아 있습니다.");
		nextActions.push(...input.policy.requiredActions.slice(0, 3));
	} else {
		strengths.push("정책 치명 리스크 없음");
	}
	if (input.thumbnail.level === "blocked") {
		blockers.push("썸네일 패키지가 업로드 품질 기준을 통과하지 못했습니다.");
		nextActions.push(...input.thumbnail.requiredActions.slice(0, 3));
	} else if (input.thumbnail.level === "warning") {
		warnings.push("썸네일은 통과 가능하지만 클릭 패키징 보강 여지가 있습니다.");
		nextActions.push(...input.thumbnail.requiredActions.slice(0, 2));
	} else {
		strengths.push("썸네일 패키지 준비");
	}
	if (input.reference && !input.reference.passed) {
		warnings.push("선택 레퍼런스의 컷/훅/자료 문법 반영도가 낮습니다.");
		nextActions.push(...input.reference.requiredActions.slice(0, 3));
	} else if (input.reference?.passed) {
		strengths.push(`레퍼런스 적합도 ${input.reference.score}점`);
	}
	if (input.sourceSafety && !input.sourceSafety.passed) {
		blockers.push("자료 출처/저작권 안전 게이트가 통과되지 않았습니다.");
		nextActions.push(...input.sourceSafety.requiredActions.slice(0, 3));
	} else if (input.sourceSafety?.score) {
		strengths.push(`자료 안전 점수 ${input.sourceSafety.score}점`);
	}
	if (input.hasRenderOutputQc && !input.renderOutputQcPassed) {
		blockers.push("실제 렌더 mp4 QC가 실패했습니다. 화면 변화량/컷 밀도/BGM을 보강해야 합니다.");
		nextActions.push("렌더 산출물 QC 결과의 issue code에 따라 자동 보강 후 재렌더하세요.");
	}

	const score = clampScore(
		input.production.score * 0.36 +
			input.policy.score * 0.16 +
			thumbnailScore(input.thumbnail) * 0.16 +
			(input.reference?.score ?? 72) * 0.16 +
			(input.sourceSafety?.score ?? 76) * 0.12 +
			(input.hasRenderOutputQc ? (input.renderOutputQcPassed ? 100 : 35) : 72) *
				0.04,
	);
	if (score < 82 && blockers.length === 0) {
		warnings.push("최종 종합 점수가 낮습니다. 업로드 전 가장 낮은 항목부터 보강하세요.");
	}

	return {
		passed: blockers.length === 0 && score >= 78,
		score,
		label:
			score >= 90
				? "업로드 강함"
				: score >= 78
					? "업로드 가능"
					: score >= 62
						? "보강 필요"
						: "업로드 보류",
		blockers: [...new Set(blockers)],
		warnings: [...new Set(warnings)],
		strengths: [...new Set(strengths)].slice(0, 5),
		nextActions: [...new Set(nextActions)].slice(0, 6),
	};
}
