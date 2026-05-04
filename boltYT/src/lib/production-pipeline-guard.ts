import type {
	Brief,
	ReferenceTemplate,
	Render,
	Scene,
	Script,
	Topic,
	Upload,
} from "../types/database";
import {
	getReferenceTemplateReadiness,
} from "./reference-template-presets";
import { assessThumbnailReadiness } from "./thumbnail-intelligence";
import { analyzeYouTubePolicyRisk } from "./youtube-policy-risk";

export type PipelineGateStatus = "pass" | "warn" | "fail";
export type PipelineGateSeverity = "info" | "warning" | "blocking";
export type PipelineGuardVerdict = "ready" | "review" | "blocked";

export type ProductionPipelineGateId =
	| "topic-brief-contract"
	| "script-format-contract"
	| "script-content-floor"
	| "story-edit-contract"
	| "scene-timeline-integrity"
	| "source-index-integrity"
	| "shot-coverage-contract"
	| "reference-quality-contract"
	| "render-qc-contract"
	| "upload-readiness-contract";

export interface ProductionPipelineGate {
	id: ProductionPipelineGateId;
	label: string;
	blocking: boolean;
	phase: "topic" | "script" | "media" | "render" | "upload";
	rationale: string;
}

export interface ProductionPipelineGateResult extends ProductionPipelineGate {
	status: PipelineGateStatus;
	severity: PipelineGateSeverity;
	details: string;
	action: string;
}

export interface ProductionPipelineReport {
	verdict: PipelineGuardVerdict;
	score: number;
	passedCount: number;
	warnCount: number;
	failCount: number;
	blockers: ProductionPipelineGateResult[];
	warnings: ProductionPipelineGateResult[];
	results: ProductionPipelineGateResult[];
	nextActions: string[];
}

export interface PipelineSourceInput {
	id?: string | null;
	type?: string | null;
	title?: string | null;
	url?: string | null;
}

export interface ProductionPipelineInput {
	topic?: Partial<Topic> | null;
	brief?: Partial<Brief> | null;
	script?: Partial<Script> | null;
	scenes?: Array<Partial<Scene>> | null;
	render?: Partial<Render> | null;
	upload?: Partial<Upload> | null;
	referenceTemplate?: ReferenceTemplate | null;
	sources?: PipelineSourceInput[];
}

export const PRODUCTION_PIPELINE_GATES: ProductionPipelineGate[] = [
	{
		id: "topic-brief-contract",
		label: "1. 주제/브리프 연결",
		blocking: true,
		phase: "topic",
		rationale: "주제와 브리프가 끊기면 뒤 단계가 빈 대본 또는 다른 주제로 생성된다.",
	},
	{
		id: "script-format-contract",
		label: "2. 스크립트/렌더 포맷 일치",
		blocking: true,
		phase: "script",
		rationale: "쇼츠/롱폼 포맷 불일치는 렌더, 자막, 썸네일, 업로드 메타 충돌로 이어진다.",
	},
	{
		id: "script-content-floor",
		label: "3. 대본 최소 밀도",
		blocking: true,
		phase: "script",
		rationale: "대본이나 씬이 비어 있으면 렌더는 성공해도 실제 영상 품질은 실패한다.",
	},
	{
		id: "story-edit-contract",
		label: "4. 스토리 편집 계약",
		blocking: false,
		phase: "script",
		rationale: "훅, 각도, 질문, 결말 비트가 없으면 주제만 바꾼 복제물처럼 보인다.",
	},
	{
		id: "scene-timeline-integrity",
		label: "5. 씬 타임라인 무결성",
		blocking: true,
		phase: "media",
		rationale: "음수/0초 씬, 순서 누락, 렌더 길이 불일치는 영상 끊김의 직접 원인이다.",
	},
	{
		id: "source-index-integrity",
		label: "6. 자료 인덱스 무결성",
		blocking: true,
		phase: "media",
		rationale: "씬이 없는 자료를 참조하면 이미지/뉴스/영상 대체가 실패하거나 엉뚱한 자료가 들어간다.",
	},
	{
		id: "shot-coverage-contract",
		label: "7. 샷 커버리지",
		blocking: false,
		phase: "media",
		rationale: "롱폼/자료형 영상에서 샷이 부족하면 정적 이미지 흔들기 수준으로 퇴화한다.",
	},
	{
		id: "reference-quality-contract",
		label: "8. 레퍼런스 품질 계약",
		blocking: true,
		phase: "script",
		rationale: "차단 상태 레퍼런스나 약한 레퍼런스를 그대로 쓰면 복제/정책/품질 리스크가 커진다.",
	},
	{
		id: "render-qc-contract",
		label: "9. 렌더 QC 계약",
		blocking: true,
		phase: "render",
		rationale: "렌더 상태와 QC 결과를 확인하지 않으면 실패 파일이 업로드 대기열로 넘어간다.",
	},
	{
		id: "upload-readiness-contract",
		label: "10. 업로드 준비 계약",
		blocking: true,
		phase: "upload",
		rationale: "제목/설명/썸네일/정책 리스크가 비어 있으면 노출과 채널 안정성 모두 손상된다.",
	},
];

type GateEvaluator = (
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
) => ProductionPipelineGateResult;

const STORY_EDIT_REQUIRED_FIELDS = [
	"hook",
	"storyAngle",
	"viewerQuestion",
	"endingBeat",
] as const;
const COMPLETED_RENDER_STATUSES = new Set(["completed", "done", "ready"]);
const TEXT_ONLY_SCENE_TYPE = "text_emphasis";
const MIN_SHORTS_SCRIPT_COMPACT_LENGTH = 80;
const MIN_VISUAL_PROMPT_LENGTH = 24;
const MIN_RENDER_QC_SCORE = 72;
const MAX_NEXT_ACTIONS = 5;

const PIPELINE_GATE_EVALUATORS: Record<ProductionPipelineGateId, GateEvaluator> = {
	"topic-brief-contract": topicBriefGate,
	"script-format-contract": scriptFormatGate,
	"script-content-floor": scriptContentGate,
	"story-edit-contract": storyEditGate,
	"scene-timeline-integrity": sceneTimelineGate,
	"source-index-integrity": sourceIndexGate,
	"shot-coverage-contract": shotCoverageGate,
	"reference-quality-contract": referenceQualityGate,
	"render-qc-contract": renderQcGate,
	"upload-readiness-contract": uploadReadinessGate,
};

export function evaluateProductionPipeline(
	input: ProductionPipelineInput,
): ProductionPipelineReport {
	const results = PRODUCTION_PIPELINE_GATES.map((gate) =>
		evaluateGate(gate, input),
	);
	const blockers = results.filter(
		(result) => result.blocking && result.status === "fail",
	);
	const warnings = results.filter((result) => result.status === "warn");
	const passedCount = results.filter((result) => result.status === "pass").length;
	const warnCount = warnings.length;
	const failCount = results.filter((result) => result.status === "fail").length;
	const score = calculatePipelineScore(results);
	const verdict: PipelineGuardVerdict =
		blockers.length > 0 ? "blocked" : warnings.length > 0 ? "review" : "ready";

	return {
		verdict,
		score,
		passedCount,
		warnCount,
		failCount,
		blockers,
		warnings,
		results,
		nextActions: buildNextActions(blockers, warnings),
	};
}

function evaluateGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	return PIPELINE_GATE_EVALUATORS[gate.id](gate, input);
}

function topicBriefGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const topicTitle = input.topic?.title?.trim() ?? "";
	const coreMessage = input.brief?.core_message?.trim() ?? "";
	if (!topicTitle) {
		return fail(gate, "주제 제목이 없습니다.", "주제를 저장한 뒤 브리프/대본 생성을 시작하세요.");
	}
	if (!coreMessage && input.brief) {
		return fail(gate, "브리프 핵심 메시지가 비어 있습니다.", "브리프를 재생성하거나 핵심 메시지를 직접 보강하세요.");
	}
	if (!input.brief && input.script) {
		return warn(gate, "스크립트가 있지만 브리프 행이 연결되지 않았습니다.", "스크립트 저장 전 brief_id와 topic_id 연결을 확인하세요.");
	}
	return pass(gate, `주제 "${topicTitle}" 기준으로 브리프 연결을 확인했습니다.`);
}

function scriptFormatGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const scriptFormat = input.script?.format;
	const selection = stringValue(input.script?.content_json?.format_selection);
	const renderFormat = input.render?.format;
	if (!scriptFormat && input.script) {
		return fail(gate, "스크립트 format이 없습니다.", "스크립트 저장 시 shorts 또는 longform을 명시하세요.");
	}
	if (scriptFormat && selection && selection !== "both" && selection !== scriptFormat) {
		return fail(gate, `format_selection(${selection})과 script.format(${scriptFormat})이 다릅니다.`, "스크립트 저장 시 선택 포맷과 대표 포맷을 맞추세요.");
	}
	if (scriptFormat && renderFormat && scriptFormat !== renderFormat) {
		return fail(gate, `렌더 포맷(${renderFormat})과 스크립트 포맷(${scriptFormat})이 다릅니다.`, "렌더 생성 전 포맷을 다시 선택하거나 렌더를 재생성하세요.");
	}
	if (!input.script) {
		return warn(gate, "스크립트가 아직 없습니다.", "스크립트 단계 진입 후 포맷 계약을 다시 확인하세요.");
	}
	return pass(gate, `스크립트 포맷 ${scriptFormat} 계약이 유효합니다.`);
}

function scriptContentGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const content = input.script?.content_json ?? {};
	const shortsScript = stringValue(content.shorts_script);
	const longformScenes = Array.isArray(content.longform_scenes)
		? content.longform_scenes
		: [];
	const persistedScenes = input.scenes ?? [];
	const selection = stringValue(content.format_selection) || input.script?.format || "";
	const wantsShorts = selection === "shorts" || selection === "both";
	const wantsLongform = selection === "longform" || selection === "both";
	if (
		wantsShorts &&
		shortsScript.replace(/\s+/g, "").length < MIN_SHORTS_SCRIPT_COMPACT_LENGTH
	) {
		return fail(gate, `쇼츠 대본이 ${MIN_SHORTS_SCRIPT_COMPACT_LENGTH}자 미만입니다.`, "훅, 전개, 결말을 포함하도록 쇼츠 대본을 보강하세요.");
	}
	if (wantsLongform && longformScenes.length === 0 && persistedScenes.length === 0) {
		return fail(gate, "롱폼 씬 구성이 없습니다.", "롱폼은 최소 3개 이상의 씬 또는 저장된 scenes가 필요합니다.");
	}
	if (!wantsShorts && !wantsLongform && input.script) {
		return warn(gate, "대본 포맷 선택 정보가 불분명합니다.", "content_json.format_selection을 저장하세요.");
	}
	return pass(gate, "요구 포맷에 필요한 대본/씬 최소 밀도를 통과했습니다.");
}

function storyEditGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const story = recordValue(input.script?.content_json?.story_edit);
	const missing = STORY_EDIT_REQUIRED_FIELDS.filter(
		(key) => !stringValue(story?.[key]).trim(),
	);
	if (missing.length >= 3) {
		return warn(gate, `스토리 편집 필드가 대부분 비어 있습니다: ${missing.join(", ")}`, "추천 대본 방향을 적용하거나 훅/질문/결말 비트를 먼저 고정하세요.");
	}
	if (missing.length > 0) {
		return warn(gate, `스토리 편집 필드 일부가 비어 있습니다: ${missing.join(", ")}`, "비어 있는 필드를 채워 대본과 씬 편집 기준을 고정하세요.");
	}
	return pass(gate, "훅, 각도, 시청자 질문, 결말 비트가 고정돼 있습니다.");
}

function sceneTimelineGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const scenes = input.scenes ?? [];
	if (scenes.length === 0) {
		return warn(gate, "저장된 씬이 아직 없습니다.", "미디어 단계 이후 씬 duration/order_index를 다시 검증하세요.");
	}
	const invalidDuration = scenes.find(
		(scene) => !isPositiveFiniteNumber(scene.duration_seconds),
	);
	if (invalidDuration) {
		return fail(gate, "0초 이하 또는 숫자가 아닌 씬 길이가 있습니다.", "모든 씬 duration_seconds를 1초 이상으로 보정하세요.");
	}
	const orderSet = new Set<number>();
	for (const scene of scenes) {
		if (typeof scene.order_index !== "number" || !Number.isInteger(scene.order_index)) {
			return fail(gate, "씬 order_index가 정수가 아닙니다.", "씬 순서를 0부터 연속 정수로 재정렬하세요.");
		}
		orderSet.add(scene.order_index);
	}
	if (orderSet.size !== scenes.length) {
		return fail(gate, "중복된 씬 order_index가 있습니다.", "씬 순서를 중복 없이 다시 저장하세요.");
	}
	const totalDuration = scenes.reduce(
		(sum, scene) => sum + Number(scene.duration_seconds ?? 0),
		0,
	);
	const renderDuration = Number(input.render?.duration_seconds ?? 0);
	if (renderDuration > 0 && Math.abs(totalDuration - renderDuration) > Math.max(12, renderDuration * 0.25)) {
		return warn(gate, `씬 합계 ${Math.round(totalDuration)}초와 렌더 ${Math.round(renderDuration)}초 차이가 큽니다.`, "렌더 재생성 전 씬 duration과 실제 렌더 길이를 맞추세요.");
	}
	return pass(gate, `씬 ${scenes.length}개, 총 ${Math.round(totalDuration)}초 타임라인이 유효합니다.`);
}

function sourceIndexGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const scenes = input.scenes ?? [];
	const sources = input.sources ?? [];
	for (const scene of scenes) {
		const sourceIndex = Number(scene.source_index ?? -1);
		if (sourceIndex < 0) continue;
		if (!Number.isInteger(sourceIndex) || sourceIndex >= sources.length) {
			return fail(gate, `씬 ${scene.order_index ?? "?"}의 source_index(${sourceIndex})가 자료 목록 범위를 벗어났습니다.`, "자료 재배치 또는 source_index 재계산을 실행하세요.");
		}
		const source = sources[sourceIndex];
		if (!source?.url && scene.scene_type !== TEXT_ONLY_SCENE_TYPE) {
			return warn(gate, `씬 ${scene.order_index ?? "?"}가 URL 없는 자료를 참조합니다.`, "자료 URL 또는 원본 출처를 보강하세요.");
		}
	}
	return pass(gate, "씬 자료 인덱스가 현재 sources 범위 안에 있습니다.");
}

function shotCoverageGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const visualScenes = (input.scenes ?? []).filter(
		(scene) => scene.scene_type !== TEXT_ONLY_SCENE_TYPE,
	);
	if (visualScenes.length === 0) {
		return warn(gate, "시각 씬이 아직 없습니다.", "미디어 단계에서 샷을 생성한 뒤 다시 확인하세요.");
	}
	const weakScenes = visualScenes.filter((scene) => {
		const shots = Array.isArray(scene.shots) ? scene.shots : [];
		const prompt = scene.visual_prompt?.trim() ?? "";
		return shots.length === 0 && prompt.length < MIN_VISUAL_PROMPT_LENGTH;
	});
	if (weakScenes.length > 0) {
		return warn(gate, `${weakScenes.length}개 시각 씬에 샷 또는 충분한 visual_prompt가 없습니다.`, "샷 재구성 또는 자료 기반 visual_prompt 보강을 실행하세요.");
	}
	return pass(gate, `${visualScenes.length}개 시각 씬의 샷/프롬프트 커버리지가 있습니다.`);
}

function referenceQualityGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	if (!input.referenceTemplate) {
		if (input.script?.reference_template_id) {
			return fail(gate, "스크립트가 레퍼런스를 참조하지만 템플릿 본문이 없습니다.", "reference_template_id로 템플릿을 다시 로드한 뒤 생성하세요.");
		}
		return warn(gate, "레퍼런스 템플릿 없이 제작 중입니다.", "레퍼런스 없이 만들 경우 편집 문법 기준을 별도 저장하세요.");
	}
	const readiness = getReferenceTemplateReadiness(input.referenceTemplate);
	if (readiness.status === "blocked") {
		return fail(gate, `레퍼런스가 차단 상태입니다: ${readiness.summary}`, readiness.action);
	}
	if (readiness.status === "review") {
		return warn(gate, `레퍼런스 보강 필요: ${readiness.summary}`, readiness.action);
	}
	return pass(gate, `레퍼런스 준비도 ${readiness.label} 상태입니다.`);
}

function renderQcGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	if (!input.render) {
		return warn(gate, "렌더가 아직 없습니다.", "미리보기 단계에서 렌더 생성 후 QC를 확인하세요.");
	}
	const status = input.render.status;
	if (status && !COMPLETED_RENDER_STATUSES.has(status)) {
		return fail(gate, `렌더 상태가 완료가 아닙니다: ${status}`, "렌더 작업을 재시도하거나 실패 원인을 먼저 수정하세요.");
	}
	const qc = recordValue(input.render.qc_result_json);
	const qcPassed = booleanValue(qc?.passed ?? qc?.render_output_qc_passed);
	const score = numberValue(qc?.score ?? qc?.render_output_qc_score);
	if (qcPassed === false) {
		return fail(gate, "렌더 QC가 실패했습니다.", "QC requiredActions를 처리한 뒤 렌더를 재생성하세요.");
	}
	if (typeof score === "number" && score < MIN_RENDER_QC_SCORE) {
		return warn(gate, `렌더 QC 점수가 낮습니다: ${score}`, "자막, 샷 밀도, 오디오, 썸네일 연동 품질을 보강하세요.");
	}
	return pass(gate, "렌더 상태와 QC 결과가 업로드 대기열 진입 기준을 통과했습니다.");
}

function uploadReadinessGate(
	gate: ProductionPipelineGate,
	input: ProductionPipelineInput,
): ProductionPipelineGateResult {
	const upload = input.upload;
	if (!upload) {
		return warn(gate, "업로드 항목이 아직 없습니다.", "렌더 승인 후 업로드 대기열에서 다시 검증하세요.");
	}
	const title = upload.title?.trim() ?? "";
	const description = upload.description?.trim() ?? "";
	if (!title) return fail(gate, "업로드 제목이 없습니다.", "제목을 작성한 뒤 업로드하세요.");
	if (!description) return fail(gate, "업로드 설명이 없습니다.", "설명 첫 2줄에 주제 요약과 출처/맥락을 넣으세요.");
	const thumbnailReadiness = assessThumbnailReadiness({
		title,
		description,
		thumbnailPath: upload.thumbnail_path,
		requirePlan: false,
	});
	if (thumbnailReadiness.level === "blocked") {
		return fail(gate, thumbnailReadiness.blockers[0] ?? "썸네일 준비가 차단 상태입니다.", "썸네일 파일과 클릭 패키지를 보강하세요.");
	}
	const policy = analyzeYouTubePolicyRisk({
		title,
		description,
		scenes: [],
	});
	const critical = policy.issues.find((issue) => issue.severity === "critical");
	if (critical) {
		return fail(gate, `정책 critical 리스크: ${critical.message}`, policy.requiredActions[0] ?? "정책 리스크 문구를 제거하세요.");
	}
	if (upload.status === "published" && !upload.youtube_video_id && upload.platform === "youtube") {
		return fail(gate, "YouTube published 상태인데 youtube_video_id가 없습니다.", "게시 상태를 되돌리거나 YouTube 영상 ID를 저장하세요.");
	}
	if (upload.scheduled_at && Number.isNaN(new Date(upload.scheduled_at).getTime())) {
		return fail(gate, "예약 시간이 유효한 날짜가 아닙니다.", "scheduled_at을 ISO 날짜로 저장하세요.");
	}
	if (thumbnailReadiness.level === "warning" || policy.issues.length > 0) {
		return warn(gate, "업로드는 가능하지만 썸네일/정책 경고가 있습니다.", "업로드 전 경고를 줄이면 CTR과 채널 안정성이 개선됩니다.");
	}
	return pass(gate, "업로드 제목, 설명, 썸네일, 정책 리스크 기준을 통과했습니다.");
}

function pass(
	gate: ProductionPipelineGate,
	details: string,
): ProductionPipelineGateResult {
	return {
		...gate,
		status: "pass",
		severity: "info",
		details,
		action: "추가 조치 없음",
	};
}

function warn(
	gate: ProductionPipelineGate,
	details: string,
	action: string,
): ProductionPipelineGateResult {
	return {
		...gate,
		status: "warn",
		severity: "warning",
		details,
		action,
	};
}

function fail(
	gate: ProductionPipelineGate,
	details: string,
	action: string,
): ProductionPipelineGateResult {
	return {
		...gate,
		status: "fail",
		severity: gate.blocking ? "blocking" : "warning",
		details,
		action,
	};
}

function calculatePipelineScore(results: ProductionPipelineGateResult[]): number {
	if (results.length === 0) return 0;
	const score = results.reduce((sum, result) => {
		if (result.status === "pass") return sum + 100;
		if (result.status === "warn") return sum + 72;
		return sum + (result.blocking ? 0 : 45);
	}, 0);
	return Math.round(score / results.length);
}

function buildNextActions(
	blockers: ProductionPipelineGateResult[],
	warnings: ProductionPipelineGateResult[],
): string[] {
	const targets = blockers.length > 0 ? blockers : warnings;
	if (targets.length === 0) {
		return ["10개 제작 파이프라인 게이트를 모두 통과했습니다."];
	}
	return targets
		.slice(0, MAX_NEXT_ACTIONS)
		.map((result) => `${result.label}: ${result.action}`);
}

function recordValue(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function isPositiveFiniteNumber(value: unknown): boolean {
	const numeric = Number(value);
	return Number.isFinite(numeric) && numeric > 0;
}
