import type { ReferenceTemplate } from "../types/database";
import { PROJECT_QUALITY_LEARNINGS } from "./post-generation-quality";
import {
	scoreReferenceQuality,
	type ReferenceQualityReport,
} from "./reference-quality";
import { finalizeReferenceThumbnailDna } from "./thumbnail-intelligence";
import type { ProductionQualityReport } from "./youtube-production-quality";

export type ProductionKnowledgeKind = "explicit" | "tacit" | "performance";

export interface ProductionKnowledgeItem {
	id: string;
	kind: ProductionKnowledgeKind;
	label: string;
	directive: string;
	source: string;
	confidence: number;
	weight: number;
	evidence?: string;
}

export interface RenderKnowledgeEvent {
	id: string;
	referenceTemplateId: string;
	at: string;
	format: string;
	score: number;
	passed: boolean;
	issues: string[];
	actions: string[];
	repaired: boolean;
	metrics: Record<string, unknown>;
	learnedRules: string[];
	avoidRules: string[];
}

export interface ProductionKnowledgeProfile {
	referenceTemplateId: string;
	explicit: ProductionKnowledgeItem[];
	tacit: ProductionKnowledgeItem[];
	performance: ProductionKnowledgeItem[];
	quality: ReferenceQualityReport;
	maturity: "thin" | "analysis-ready" | "outcome-calibrated";
	score: number;
	nextActions: string[];
}

export interface CompactKnowledgeProfile {
	referenceTemplateId: string;
	maturity: ProductionKnowledgeProfile["maturity"];
	score: number;
	explicitCount: number;
	tacitCount: number;
	performanceCount: number;
	qualityScore: number;
	qualityGrade: string;
	nextActions: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = record?.[key];
	return isRecord(value) ? value : undefined;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function numberField(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter(Boolean);
	}
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

function safeId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9가-힣]+/gi, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

function item(
	kind: ProductionKnowledgeKind,
	label: string,
	directive: string,
	source: string,
	confidence: number,
	weight: number,
	evidence?: string,
): ProductionKnowledgeItem {
	return {
		id: `${kind}-${safeId(source)}-${safeId(label || directive)}`,
		kind,
		label,
		directive,
		source,
		confidence,
		weight,
		evidence,
	};
}

function projectExplicitKnowledge(): ProductionKnowledgeItem[] {
	return PROJECT_QUALITY_LEARNINGS.map((learning) =>
		item(
			"explicit",
			learning.title,
			learning.rule,
			`project:${learning.id}`,
			0.96,
			10,
			learning.files.join(", "),
		),
	);
}

function referenceExplicitKnowledge(
	template: ReferenceTemplate,
): ProductionKnowledgeItem[] {
	const raw = isRecord(template.raw_analysis) ? template.raw_analysis : {};
	const method = nestedRecord(raw, "production_method");
	const copyBoundary =
		nestedRecord(raw, "copy_boundary") ??
		nestedRecord(nestedRecord(raw, "production_dna"), "copyBoundary");
	const rules = stringArray(method?.rules);
	const items = rules.slice(0, 8).map((rule, index) =>
		item(
			"explicit",
			`레퍼런스 제작 규칙 ${index + 1}`,
			rule,
			`reference:${template.id}:method`,
			0.9,
			9,
			template.source_title,
		),
	);

	if (
		copyBoundary?.rawAssetsReusable === false ||
		copyBoundary?.originalAssetsReusable === false
	) {
		items.push(
			item(
				"explicit",
				"원본 자산 비재사용",
				"원본 영상, 원본 음악, 원문 대사를 가져오지 말고 구조와 제작 문법만 재사용한다.",
				`reference:${template.id}:copy-boundary`,
				0.98,
				10,
			),
		);
	}

	const trendLearning = nestedRecord(raw, "trend_reference_learning");
	const trendLearningRules = [
		...stringArray(trendLearning?.learningDirectives),
		...stringArray(trendLearning?.safeTransformRules),
	];
	for (const [index, rule] of trendLearningRules.slice(0, 6).entries()) {
		items.push(
			item(
				"explicit",
				`트렌드 레퍼런스 학습 ${index + 1}`,
				rule,
				`reference:${template.id}:trend-learning`,
				0.98,
				11,
				stringField(trendLearning?.representativeUrl) || template.source_title,
			),
		);
	}

	const thumbnailDna = finalizeReferenceThumbnailDna(template);
	items.push(
		item(
			"explicit",
			"제목/썸네일 역할 분리",
			thumbnailDna.clickPackaging.titleThumbnailRelationship,
			`reference:${template.id}:thumbnail`,
			0.9,
			8,
			thumbnailDna.source.thumbnailUrl || thumbnailDna.source.title,
		),
	);

	return items;
}

function referenceTacitKnowledge(
	template: ReferenceTemplate,
	quality: ReferenceQualityReport,
): ProductionKnowledgeItem[] {
	const raw = isRecord(template.raw_analysis) ? template.raw_analysis : {};
	const dna = nestedRecord(raw, "production_dna");
	const camera = nestedRecord(dna, "camera");
	const layout = nestedRecord(dna, "layout");
	const transitions = nestedRecord(dna, "transitions");
	const audio = nestedRecord(dna, "audio");
	const color = nestedRecord(dna, "color");
	const subtitles = nestedRecord(dna, "subtitles");
	const frameQc = nestedRecord(raw, "frame_qc");
	const thumbnailDna = finalizeReferenceThumbnailDna(template);
	const items: ProductionKnowledgeItem[] = [];

	const cameraMode = stringField(camera?.mode);
	if (cameraMode) {
		items.push(
			item(
				"tacit",
				"카메라 모드",
				`카메라/소스 움직임은 ${cameraMode} 계열로 설계한다.`,
				`reference:${template.id}:camera`,
				0.86,
				8,
			),
		);
	}

	const firstCut = numberField(camera?.firstCutSeconds);
	if (firstCut !== undefined) {
		items.push(
			item(
				"tacit",
				"초반 화면 전환",
				`첫 화면 변화는 ${firstCut.toFixed(1)}초 전후에 배치해 훅 정체를 막는다.`,
				`reference:${template.id}:camera`,
				0.86,
				9,
			),
		);
	}

	const cutDensity = numberField(camera?.cutDensityPerMinute);
	if (cutDensity !== undefined) {
		items.push(
			item(
				"tacit",
				"컷 밀도",
				`컷 밀도는 분당 ${cutDensity.toFixed(1)}컷 수준을 목표로 하되 문장 끝과 맞춘다.`,
				`reference:${template.id}:edit`,
				0.84,
				9,
			),
		);
	}

	const composition = stringField(layout?.compositionPattern);
	if (composition) {
		items.push(
			item(
				"tacit",
				"화면 배치",
				`구도는 ${composition} 패턴을 따르고 자막 안전영역을 먼저 확보한다.`,
				`reference:${template.id}:layout`,
				0.82,
				8,
			),
		);
	}

	const transitionRules = stringArray(transitions?.rules);
	for (const [index, rule] of transitionRules.slice(0, 3).entries()) {
		items.push(
			item(
				"tacit",
				`전환 리듬 ${index + 1}`,
				rule,
				`reference:${template.id}:transitions`,
				0.84,
				8,
			),
		);
	}

	const audioMood = stringField(audio?.bgmMood);
	const audioTempo = stringField(audio?.bgmTempo);
	if (audioMood || audioTempo) {
		items.push(
			item(
				"tacit",
				"BGM 에너지",
				`BGM은 ${[audioMood, audioTempo].filter(Boolean).join(" / ")} 에너지 곡선으로 새 음원을 선택한다.`,
				`reference:${template.id}:audio`,
				0.82,
				8,
			),
		);
	}

	const colorTemperature = stringField(color?.temperature);
	if (colorTemperature) {
		items.push(
			item(
				"tacit",
				"색온도",
				`색보정은 ${colorTemperature} 온도를 기준으로 장면별 톤을 맞춘다.`,
				`reference:${template.id}:color`,
				0.76,
				6,
			),
		);
	}

	const collisionRisk =
		stringField(subtitles?.collisionRisk) ||
		stringField(layout?.subtitleCollisionRisk);
	if (collisionRisk) {
		items.push(
			item(
				"tacit",
				"자막 충돌 회피",
				`자막 충돌 위험(${collisionRisk})을 고려해 피사체와 제목 영역을 분리한다.`,
				`reference:${template.id}:subtitles`,
				0.78,
				7,
			),
		);
	}

	const frameScore = numberField(frameQc?.score);
	if (frameScore !== undefined) {
		items.push(
			item(
				"tacit",
				"프레임 QC",
				`프레임 품질 기준은 Q${frameScore} 수준을 목표로 하고 낮은 구도 반복을 피한다.`,
				`reference:${template.id}:frame-qc`,
				0.78,
				7,
			),
		);
	}

	items.push(
		item(
			"tacit",
			"썸네일 텍스트 안전영역",
			`썸네일 텍스트는 ${thumbnailDna.layout.textZone}, 피사체는 ${thumbnailDna.layout.subjectZone}에 두고 ${thumbnailDna.layout.safeZones.join(", ")}를 침범하지 않는다.`,
			`reference:${template.id}:thumbnail-layout`,
			0.82,
			8,
		),
	);
	items.push(
		item(
			"tacit",
			"썸네일 클릭 감정",
			`클릭 감정은 ${thumbnailDna.clickPackaging.emotion}이며, ${thumbnailDna.clickPackaging.curiosityGap} 구조를 유지한다.`,
			`reference:${template.id}:thumbnail-click`,
			0.82,
			8,
		),
	);

	if (quality.gaps.length > 0) {
		items.push(
			item(
				"tacit",
				"약점 보정",
				`이 레퍼런스의 약점(${quality.gaps.join(", ")})은 생성 시 보강한다.`,
				`reference:${template.id}:quality-gap`,
				0.9,
				9,
			),
		);
	}

	return items;
}

function storedPerformanceEvents(template: ReferenceTemplate): RenderKnowledgeEvent[] {
	const raw = isRecord(template.raw_analysis) ? template.raw_analysis : {};
	const events = Array.isArray(raw.knowledge_events) ? raw.knowledge_events : [];
	return events.filter(isRenderKnowledgeEvent);
}

function isRenderKnowledgeEvent(value: unknown): value is RenderKnowledgeEvent {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.referenceTemplateId === "string" &&
		typeof value.score === "number" &&
		typeof value.passed === "boolean"
	);
}

export function readRenderKnowledgeEvent(value: unknown): RenderKnowledgeEvent | null {
	return isRenderKnowledgeEvent(value) ? value : null;
}

function performanceKnowledge(
	template: ReferenceTemplate,
	events: RenderKnowledgeEvent[],
): ProductionKnowledgeItem[] {
	return events.slice(-5).flatMap((event) => {
		const source = `render:${event.id}`;
		const confidence = event.passed ? 0.92 : 0.78;
		const weight = event.passed ? 10 : 8;
		const learned = event.learnedRules.slice(0, 3).map((rule, index) =>
			item(
				"performance",
				`성과 학습 ${index + 1}`,
				rule,
				source,
				confidence,
				weight,
				`score ${event.score}, template ${template.id}`,
			),
		);
		const avoid = event.avoidRules.slice(0, 3).map((rule, index) =>
			item(
				"performance",
				`회피 학습 ${index + 1}`,
				rule,
				source,
				confidence,
				weight,
				event.issues.join(", "),
			),
		);
		return [...learned, ...avoid];
	});
}

export function buildReferenceKnowledgeProfile(
	template: ReferenceTemplate,
	options: { events?: RenderKnowledgeEvent[] } = {},
): ProductionKnowledgeProfile {
	const quality = scoreReferenceQuality(template);
	const explicit = [
		...projectExplicitKnowledge(),
		...referenceExplicitKnowledge(template),
	];
	const tacit = referenceTacitKnowledge(template, quality);
	const events = [...storedPerformanceEvents(template), ...(options.events ?? [])];
	const performance = performanceKnowledge(template, events);
	const rawScore =
		quality.score * 0.44 +
		Math.min(28, explicit.length * 3.2) +
		Math.min(28, tacit.length * 3.6) +
		Math.min(18, performance.length * 4.5);
	const score = Math.max(0, Math.min(100, Math.round(rawScore)));
	const maturity =
		performance.length > 0
			? "outcome-calibrated"
			: explicit.length >= 6 && tacit.length >= 6
				? "analysis-ready"
				: "thin";
	const nextActions: string[] = [];
	if (performance.length === 0) {
		nextActions.push("렌더 QC 결과를 knowledge_event로 누적해 성과 기반 랭킹을 보정하세요.");
	}
	if (tacit.length < 6) {
		nextActions.push("프레임, 컷, 오디오, 자막 충돌 신호를 deep 분석으로 보강하세요.");
	}
	if (quality.gaps.length > 0) {
		nextActions.push(`레퍼런스 약점 보강: ${quality.gaps.join(", ")}`);
	}
	const thumbnailDna = finalizeReferenceThumbnailDna(template);
	if (thumbnailDna.quality.requiredActions.length > 0) {
		nextActions.push(
			`썸네일 보강: ${thumbnailDna.quality.requiredActions.slice(0, 2).join(", ")}`,
		);
	}

	return {
		referenceTemplateId: template.id,
		explicit,
		tacit,
		performance,
		quality,
		maturity,
		score,
		nextActions,
	};
}

export function compactKnowledgeProfile(
	profile: ProductionKnowledgeProfile,
): CompactKnowledgeProfile {
	return {
		referenceTemplateId: profile.referenceTemplateId,
		maturity: profile.maturity,
		score: profile.score,
		explicitCount: profile.explicit.length,
		tacitCount: profile.tacit.length,
		performanceCount: profile.performance.length,
		qualityScore: profile.quality.score,
		qualityGrade: profile.quality.grade,
		nextActions: profile.nextActions.slice(0, 4),
	};
}

export function buildKnowledgePrompt(
	profile: ProductionKnowledgeProfile | undefined,
): string {
	if (!profile) return "";
	const topExplicit = profile.explicit
		.sort((a, b) => b.weight * b.confidence - a.weight * a.confidence)
		.slice(0, 6);
	const topTacit = profile.tacit
		.sort((a, b) => b.weight * b.confidence - a.weight * a.confidence)
		.slice(0, 8);
	const topPerformance = profile.performance
		.sort((a, b) => b.weight * b.confidence - a.weight * a.confidence)
		.slice(0, 5);
	const section = (title: string, items: ProductionKnowledgeItem[]) =>
		items.length > 0
			? `\n${title}:\n${items.map((entry) => `- ${entry.directive}`).join("\n")}`
			: "";

	return `
지식 프로필(${profile.maturity}, K${profile.score}):
- 명시지는 반드시 지키되 원본 자산/대사/음악은 복제하지 않는다.
- 암묵지는 화면 호흡, 컷 밀도, 구도, 오디오 에너지로 변환해 적용한다.
- 성과지는 이전 렌더 QC의 성공/실패를 다음 생성 선택에 반영한다.
${section("명시지", topExplicit)}
${section("암묵지", topTacit)}
${section("성과지", topPerformance)}
`.trim();
}

export function buildRenderKnowledgeEvent(input: {
	referenceTemplate?: ReferenceTemplate | null;
	productionReport: ProductionQualityReport;
	format: string;
	renderOutputQc?: {
		score?: number;
		passed?: boolean;
		issues?: unknown[];
		requiredActions?: unknown[];
		metrics?: unknown;
	};
	repaired?: boolean;
}): RenderKnowledgeEvent | null {
	const template = input.referenceTemplate;
	if (!template) return null;
	const outputScore = numberField(input.renderOutputQc?.score);
	const score = outputScore ?? input.productionReport.score;
	const passed = input.renderOutputQc?.passed ?? input.productionReport.passed;
	const issues = [
		...input.productionReport.issues.map((issue) => issue.code),
		...stringArray(input.renderOutputQc?.issues),
	].filter(Boolean);
	const actions = [
		...input.productionReport.requiredActions,
		...stringArray(input.renderOutputQc?.requiredActions),
	].filter(Boolean);
	const learnedRules = buildLearnedRules(score, passed, input.productionReport);
	const avoidRules = buildAvoidRules(issues, actions);

	return {
		id: `${template.id}-${Date.now()}`,
		referenceTemplateId: template.id,
		at: new Date().toISOString(),
		format: input.format,
		score,
		passed,
		issues: [...new Set(issues)].slice(0, 12),
		actions: [...new Set(actions)].slice(0, 8),
		repaired: input.repaired ?? false,
		metrics: {
			production: input.productionReport.metrics,
			renderOutput: isRecord(input.renderOutputQc?.metrics)
				? input.renderOutputQc.metrics
				: {},
		},
		learnedRules,
		avoidRules,
	};
}

function buildLearnedRules(
	score: number,
	passed: boolean,
	report: ProductionQualityReport,
): string[] {
	const rules: string[] = [];
	if (passed && score >= 86) {
		rules.push(
			`이 레퍼런스 조합은 QC ${score}점으로 통과했으므로 현재 컷/모션/자료 배합을 우선 재사용한다.`,
		);
	}
	if (report.metrics.videoSceneRatio >= 0.45) {
		rules.push("영상/이미지 배합은 현재 video scene ratio를 유지해 정적 슬라이드화를 피한다.");
	}
	if (report.metrics.openingDynamicBeatCount >= 2) {
		rules.push("첫 10초 안에 최소 2개 이상의 동적 비트를 유지한다.");
	}
	if (report.metrics.premiumFloorScore >= 86) {
		rules.push("프리미엄 플로어를 통과한 자막/모션/자료 밀도 조합을 유지한다.");
	}
	return rules.slice(0, 5);
}

function buildAvoidRules(issues: string[], actions: string[]): string[] {
	const joined = `${issues.join(" ")} ${actions.join(" ")}`.toLowerCase();
	const rules: string[] = [];
	if (/low_visual_variation|low_motion|motion|정적/.test(joined)) {
		rules.push("정적 이미지 반복을 피하고 컷, 줌, 자료 전환, 오버레이 모션을 늘린다.");
	}
	if (/cut_density|reference_cut_density|컷/.test(joined)) {
		rules.push("레퍼런스 대비 컷 밀도가 낮으면 문장 끝마다 컷 또는 자료 화면 변화를 배치한다.");
	}
	if (/audio|lufs|bgm|오디오|음량/.test(joined)) {
		rules.push("TTS/BGM 덕킹과 LUFS 기준을 맞추고 한 곡 반복처럼 들리지 않게 에너지를 나눈다.");
	}
	if (/caption|subtitle|자막/.test(joined)) {
		rules.push("자막 싱크와 피사체 충돌을 먼저 보정한 뒤 렌더한다.");
	}
	if (/policy|copyright|source|출처|권리/.test(joined)) {
		rules.push("출처, 권리, AI 재구성 고지 리스크가 있으면 자료를 교체하거나 표현을 낮춘다.");
	}
	return rules.slice(0, 5);
}
