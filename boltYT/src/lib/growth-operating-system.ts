import type {
	GrowthCommandCenter,
	GrowthExperiment,
} from "./growth-command-center";
import type {
	UploadAnalyticsSnapshot,
	UploadRenderSnapshot,
} from "./upload-growth";
import type { UploadListItem } from "./upload-management";
import { analyzeYouTubePolicyRisk } from "./youtube-policy-risk";

export type OpsSeverity = "good" | "watch" | "risk" | "blocked";
export type ExperimentStatus = "draft" | "running" | "completed" | "stopped";

export interface GrowthExperimentLog {
	id: string;
	upload_id?: string | null;
	type: GrowthExperiment["type"];
	title: string;
	hypothesis: string;
	metric: string;
	variant_a: string;
	variant_b: string;
	variant_c?: string | null;
	status: ExperimentStatus;
	success_criteria: string;
	created_at: string;
	updated_at?: string | null;
}

export interface GrowthCommentSignal {
	id: string;
	video_id: string;
	upload_id?: string | null;
	author?: string | null;
	text: string;
	like_count?: number | null;
	published_at?: string | null;
}

export interface RetentionEditFinding {
	id: string;
	uploadId: string;
	title: string;
	severity: OpsSeverity;
	dropAtSeconds: number | null;
	dropAtLabel: string;
	issue: string;
	action: string;
	evidence: string;
}

export interface RightsLedgerItem {
	id: string;
	uploadId: string;
	title: string;
	severity: OpsSeverity;
	transformScore: number;
	sourceCoverage: number;
	reuseRisk: string;
	requiredActions: string[];
}

export interface CommentInsight {
	id: string;
	label: string;
	count: number;
	sentiment: "question" | "request" | "positive" | "negative" | "neutral";
	example: string;
	recommendedAction: string;
	topicSeed: string;
}

export interface AutomationRoutine {
	id: string;
	label: string;
	frequency: string;
	nextRunHint: string;
	enabledByDefault: boolean;
	actions: string[];
	dataRequired: string[];
}

export interface AnalyticsSyncPlan {
	id: string;
	label: string;
	status: "ready" | "blocked" | "partial";
	endpoint: string;
	metrics: string[];
	reason: string;
}

export interface GrowthOperatingSystemPlan {
	analyticsSync: AnalyticsSyncPlan[];
	experimentBacklog: GrowthExperimentLog[];
	retentionFindings: RetentionEditFinding[];
	rightsLedger: RightsLedgerItem[];
	commentInsights: CommentInsight[];
	automationRoutines: AutomationRoutine[];
}

export function buildGrowthOperatingSystemPlan(params: {
	center: GrowthCommandCenter;
	uploads: UploadListItem[];
	analyticsByUploadId?: Record<string, UploadAnalyticsSnapshot | undefined>;
	rendersById?: Record<string, UploadRenderSnapshot | undefined>;
	comments?: GrowthCommentSignal[];
	savedExperiments?: GrowthExperimentLog[];
	now?: Date;
}): GrowthOperatingSystemPlan {
	const {
		center,
		uploads,
		analyticsByUploadId = {},
		rendersById = {},
		comments = [],
		savedExperiments = [],
		now = new Date(),
	} = params;

	return {
		analyticsSync: buildAnalyticsSyncPlan(uploads),
		experimentBacklog: buildExperimentBacklog({
			experiments: center.experiments,
			savedExperiments,
			now,
		}),
		retentionFindings: buildRetentionFindings({
			uploads,
			analyticsByUploadId,
			rendersById,
		}),
		rightsLedger: buildRightsLedger(uploads),
		commentInsights: mineCommentInsights(comments),
		automationRoutines: buildAutomationRoutines(center),
	};
}

export function buildAnalyticsSyncPlan(
	uploads: UploadListItem[],
): AnalyticsSyncPlan[] {
	const publishedWithVideo = uploads.filter((upload) => upload.youtube_video_id);
	const hasPublishedVideo = publishedWithVideo.length > 0;
	return [
		{
			id: "deep-video-analytics",
			label: "영상별 심화 분석",
			status: hasPublishedVideo ? "ready" : "blocked",
			endpoint: "/analytics/deep/:videoId",
			metrics: [
				"views",
				"estimatedMinutesWatched",
				"averageViewDuration",
				"averageViewPercentage",
				"subscribersGained/Lost",
				"shares",
			],
			reason: hasPublishedVideo
				? `${publishedWithVideo.length}개 게시 영상에서 심화 지표를 회수할 수 있습니다.`
				: "YouTube 게시 ID가 있는 영상이 있어야 심화 분석을 회수할 수 있습니다.",
		},
		{
			id: "traffic-source",
			label: "트래픽 소스 분해",
			status: hasPublishedVideo ? "ready" : "blocked",
			endpoint: "/analytics/deep/:videoId",
			metrics: ["insightTrafficSourceType", "views", "estimatedMinutesWatched"],
			reason: "검색/추천/채널/외부 유입을 분리해야 제목·썸네일·배포 위치의 원인을 나눌 수 있습니다.",
		},
		{
			id: "retention-curve",
			label: "리텐션 커브",
			status: hasPublishedVideo ? "partial" : "blocked",
			endpoint: "/analytics/deep/:videoId",
			metrics: ["elapsedVideoTimeRatio", "audienceWatchRatio"],
			reason:
				"YouTube Analytics API 권한과 보고서 지원 상태에 따라 일부 영상에서만 반환될 수 있습니다.",
		},
		{
			id: "comment-mining",
			label: "댓글/반응 채굴",
			status: hasPublishedVideo ? "ready" : "blocked",
			endpoint: "/comments/:videoId",
			metrics: ["text", "likeCount", "publishedAt", "authorDisplayName"],
			reason: "반복 질문과 불만을 다음 주제, 고정 댓글, 제목 보강으로 되돌립니다.",
		},
	];
}

export function buildExperimentBacklog(params: {
	experiments: GrowthExperiment[];
	savedExperiments?: GrowthExperimentLog[];
	now?: Date;
}): GrowthExperimentLog[] {
	const { experiments, savedExperiments = [], now = new Date() } = params;
	const savedIds = new Set(savedExperiments.map((experiment) => experiment.id));
	const backlog: GrowthExperimentLog[] = [];
	for (const experiment of experiments) {
		const id = stableExperimentId(experiment);
		if (savedIds.has(id)) continue;
		backlog.push({
			id,
			type: experiment.type,
			title: experiment.title,
			hypothesis: experiment.hypothesis,
			metric: experiment.metric,
			variant_a: experiment.actions[0] ?? "기준안 유지",
			variant_b: experiment.actions[1] ?? "제목/썸네일 한 변수만 변경",
			variant_c: experiment.actions[2] ?? null,
			status: "draft",
			success_criteria: experiment.successCriteria,
			created_at: now.toISOString(),
			updated_at: now.toISOString(),
		});
	}
	return backlog;
}

export function buildRetentionFindings(params: {
	uploads: UploadListItem[];
	analyticsByUploadId?: Record<string, UploadAnalyticsSnapshot | undefined>;
	rendersById?: Record<string, UploadRenderSnapshot | undefined>;
}): RetentionEditFinding[] {
	const { uploads, analyticsByUploadId = {}, rendersById = {} } = params;
	const findings: RetentionEditFinding[] = [];

	for (const upload of uploads) {
		const analytics = analyticsByUploadId[upload.id];
		const render = upload.render_id ? rendersById[upload.render_id] : undefined;
		const title = upload.title?.trim() || "제목 없음";
		const duration = Number(render?.duration_seconds ?? 0);
		const curve = normalizeRetentionCurve(analytics?.retention_curve);
		const avgWatch = Number(analytics?.avg_watch_duration ?? 0);
		const avgPercentage = Number(analytics?.avg_view_percentage ?? 0);

		if (curve.length > 1 && duration > 0) {
			const drop = largestRetentionDrop(curve);
			if (drop && drop.drop >= 0.18) {
				const dropAtSeconds = Math.round(drop.ratio * duration);
				findings.push({
					id: `${upload.id}-drop-${dropAtSeconds}`,
					uploadId: upload.id,
					title,
					severity: drop.drop >= 0.32 ? "risk" : "watch",
					dropAtSeconds,
					dropAtLabel: formatSeconds(dropAtSeconds),
					issue: `리텐션이 ${Math.round(drop.drop * 100)}%p 급락한 구간이 있습니다.`,
					action: "해당 지점 직전에 새 증거 컷, 인물 변화, 반론, 자막 리듬 전환 중 하나를 넣으세요.",
					evidence: `커브 ${Math.round(drop.from * 100)}% → ${Math.round(drop.to * 100)}%`,
				});
				continue;
			}
		}

		if (duration > 0 && avgWatch > 0 && avgWatch / duration < 0.32) {
			findings.push({
				id: `${upload.id}-avg-watch`,
				uploadId: upload.id,
				title,
				severity: "risk",
				dropAtSeconds: Math.round(avgWatch),
				dropAtLabel: formatSeconds(avgWatch),
				issue: "평균 시청시간이 전체 길이 대비 낮습니다.",
				action: "첫 10초에 결론/이상 장면을 먼저 보여주고, 중간 챕터 전환을 90-150초마다 넣으세요.",
				evidence: `평균 시청 ${formatSeconds(avgWatch)} / 전체 ${formatSeconds(duration)}`,
			});
			continue;
		}

		if (avgPercentage > 0 && avgPercentage < 38) {
			findings.push({
				id: `${upload.id}-avg-percent`,
				uploadId: upload.id,
				title,
				severity: "watch",
				dropAtSeconds: null,
				dropAtLabel: "전체 평균",
				issue: `평균 시청률이 ${Math.round(avgPercentage)}%입니다.`,
				action: "제목의 약속을 첫 3-5초에 회수하고, 반복 설명 구간을 컷다운하세요.",
				evidence: "averageViewPercentage 기반",
			});
		}
	}

	if (findings.length === 0) {
		const missing = uploads.filter((upload) => !analyticsByUploadId[upload.id]).length;
		if (missing > 0) {
			findings.push({
				id: "missing-retention-data",
				uploadId: "",
				title: "리텐션 데이터 미수집",
				severity: "watch",
				dropAtSeconds: null,
				dropAtLabel: "데이터 없음",
				issue: `${missing}개 영상의 리텐션/평균 시청 데이터가 없습니다.`,
				action: "성장 지휘실에서 심화 동기화를 실행한 뒤 편집 피드백을 다시 계산하세요.",
				evidence: "analytics.retention_curve 또는 avg_watch_duration 누락",
			});
		}
	}

	return findings.slice(0, 8);
}

export function buildRightsLedger(
	uploads: UploadListItem[],
): RightsLedgerItem[] {
	return uploads.slice(0, 20).map((upload) => {
		const text = `${upload.title ?? ""} ${upload.description ?? ""} ${(upload.tags ?? []).join(" ")}`;
		const policyReport = analyzeYouTubePolicyRisk({
			title: upload.title ?? "",
			description: upload.description ?? "",
			scenes: [],
		});
		const sourceCoverage = sourceCoverageScore(text);
		const transformScore = transformScoreFor(text);
		const hasExternalClipSignal =
			/(clip|clips|뉴스|news|foreign|외국|drama|movie|영화|드라마|원본|full video|cctv)/i.test(
				text,
			);
		const requiredActions = new Set<string>();
		if (sourceCoverage < 70) {
			requiredActions.add("설명 첫 2줄 또는 고정 댓글에 출처/자료 링크를 남기세요.");
		}
		if (transformScore < 70) {
			requiredActions.add("원본 장면 나열이 아니라 해설, 비교, 반론, 결론을 명시하세요.");
		}
		if (hasExternalClipSignal) {
			requiredActions.add("외부 영상/뉴스/영화 소재는 사용권, 인용 목적, 변형 정도를 기록하세요.");
		}
		for (const action of policyReport.requiredActions.slice(0, 2)) {
			requiredActions.add(action);
		}

		const blocked = policyReport.issues.some((issue) => issue.severity === "critical");
		const severity: OpsSeverity = blocked
			? "blocked"
			: sourceCoverage < 45 || transformScore < 45
				? "risk"
				: sourceCoverage < 70 || transformScore < 70
					? "watch"
					: "good";

		return {
			id: `${upload.id}-rights`,
			uploadId: upload.id,
			title: upload.title?.trim() || "제목 없음",
			severity,
			transformScore,
			sourceCoverage,
			reuseRisk: blocked
				? "정책 차단 후보"
				: hasExternalClipSignal
					? "외부 자료 사용 기록 필요"
					: "일반 운영 리스크",
			requiredActions: [...requiredActions].slice(0, 4),
		};
	});
}

export function mineCommentInsights(
	comments: GrowthCommentSignal[],
): CommentInsight[] {
	const clusters = new Map<
		string,
		{ count: number; examples: string[]; sentiment: CommentInsight["sentiment"] }
	>();

	for (const comment of comments) {
		const text = normalizeText(comment.text);
		if (!text) continue;
		const sentiment = classifyComment(text);
		const tokens = tokenizeComment(text);
		const clusterKey = tokens[0] ?? sentiment;
		const current =
			clusters.get(clusterKey) ?? { count: 0, examples: [], sentiment };
		current.count += 1 + Math.min(3, Number(comment.like_count ?? 0) / 10);
		current.examples.push(text);
		current.sentiment = prioritySentiment(current.sentiment, sentiment);
		clusters.set(clusterKey, current);
	}

	return [...clusters.entries()]
		.map(([label, cluster]) => ({
			id: `comment-${label}`,
			label,
			count: Math.round(cluster.count),
			sentiment: cluster.sentiment,
			example: cluster.examples[0] ?? "",
			recommendedAction: commentAction(cluster.sentiment, label),
			topicSeed: topicSeedFromComment(label, cluster.examples[0] ?? ""),
		}))
		.sort((a, b) => b.count - a.count)
		.slice(0, 8);
}

export function buildAutomationRoutines(
	center: GrowthCommandCenter,
): AutomationRoutine[] {
	const needsAnalytics = center.missingData.some((item) => item.id === "analytics");
	const hasExperiments = center.experiments.length > 0;
	const hasRisks = center.riskControls.length > 0;

	return [
		{
			id: "daily-analytics-sync",
			label: "매일 성과 회수",
			frequency: "매일 09:00",
			nextRunHint: "전날 게시 영상의 24시간 지표 회수",
			enabledByDefault: needsAnalytics,
			actions: [
				"게시된 YouTube 영상 심화 분석 동기화",
				"댓글 상위 100개 채굴",
				"성장 지휘실 KPI 재계산",
			],
			dataRequired: ["YouTube OAuth", "YouTube Analytics API scope"],
		},
		{
			id: "experiment-review",
			label: "실험 판정",
			frequency: "48시간마다",
			nextRunHint: "제목/썸네일/시간대 실험 승패 판정",
			enabledByDefault: hasExperiments,
			actions: [
				"CTR과 평균 시청 기준으로 실험 상태 갱신",
				"승자 패키징은 다음 업로드 메타데이터 후보로 승격",
				"패자 패키징은 금지 패턴으로 기록",
			],
			dataRequired: ["analytics.ctr", "analytics.avg_watch_duration"],
		},
		{
			id: "policy-rights-audit",
			label: "정책/권리 점검",
			frequency: "업로드 직전",
			nextRunHint: "공개 전 차단 후보 제거",
			enabledByDefault: hasRisks,
			actions: [
				"제목/설명/썸네일 약속과 영상 내용 일치 확인",
				"외부 자료 출처/변형 정도 기록",
				"critical 리스크가 있으면 업로드 버튼 차단",
			],
			dataRequired: ["업로드 메타데이터", "권리 장부", "정책 리스크 리포트"],
		},
		{
			id: "weekly-trend-refresh",
			label: "주간 트렌드/레퍼런스 갱신",
			frequency: "주 1회",
			nextRunHint: "카테고리별 레퍼런스 후보와 채널 추천 순위 갱신",
			enabledByDefault: true,
			actions: [
				"카테고리별 인기 영상 후보 수집",
				"트렌드 발견 시 별도 deep 레퍼런스 생성",
				"채널 추천 순위와 주제 추천 탭 갱신",
			],
			dataRequired: ["YouTube Data API", "레퍼런스 템플릿 저장소"],
		},
	];
}

function stableExperimentId(experiment: GrowthExperiment): string {
	return `auto-${experiment.type}-${slug(experiment.title)}`;
}

function normalizeRetentionCurve(
	curve: unknown,
): Array<{ ratio: number; value: number }> {
	if (!Array.isArray(curve)) return [];
	return curve
		.map((point) => {
			if (!point || typeof point !== "object") return null;
			const record = point as Record<string, unknown>;
			const ratio = Number(
				record.elapsedVideoTimeRatio ?? record.ratio ?? record.x ?? 0,
			);
			const value = Number(
				record.audienceWatchRatio ?? record.value ?? record.y ?? 0,
			);
			if (!Number.isFinite(ratio) || !Number.isFinite(value)) return null;
			return {
				ratio: clampRatio(ratio),
				value: value > 1 ? value / 100 : value,
			};
		})
		.filter((point): point is { ratio: number; value: number } => Boolean(point))
		.sort((a, b) => a.ratio - b.ratio);
}

function largestRetentionDrop(
	curve: Array<{ ratio: number; value: number }>,
): { ratio: number; from: number; to: number; drop: number } | null {
	let largest: { ratio: number; from: number; to: number; drop: number } | null = null;
	for (let i = 1; i < curve.length; i += 1) {
		const prev = curve[i - 1];
		const next = curve[i];
		if (!prev || !next) continue;
		const drop = prev.value - next.value;
		if (drop > (largest?.drop ?? 0)) {
			largest = {
				ratio: next.ratio,
				from: prev.value,
				to: next.value,
				drop,
			};
		}
	}
	return largest;
}

function sourceCoverageScore(text: string): number {
	let score = 35;
	if (/https?:\/\//i.test(text)) score += 26;
	if (/(출처|source|자료|기록|공식|보고서|기사|뉴스|지도|archive)/i.test(text)) {
		score += 20;
	}
	if (/(ai 재구성|재구성|commentary|해설|분석|비평|요약)/i.test(text)) {
		score += 10;
	}
	return Math.min(100, score);
}

function transformScoreFor(text: string): number {
	let score = 42;
	if (/(해설|분석|비교|반론|결론|타임라인|근거|commentary|explained|analysis)/i.test(text)) {
		score += 30;
	}
	if (/(원본 풀영상|full movie|download now|무편집|그대로|clips compilation)/i.test(text)) {
		score -= 34;
	}
	if (/(시리즈|챕터|증거|가설|왜|어떻게|이유)/i.test(text)) score += 14;
	return Math.max(0, Math.min(100, score));
}

function classifyComment(text: string): CommentInsight["sentiment"] {
	const lower = text.toLowerCase();
	if (/[?？]|왜|뭐야|어떻게|궁금|알려|where|why|how|what/.test(lower)) {
		return "question";
	}
	if (/다음|해주세요|해줘|보고싶|추천|please|next|cover/.test(lower)) {
		return "request";
	}
	if (/좋|대박|재밌|구독|감사|love|great|good|amazing/.test(lower)) {
		return "positive";
	}
	if (/별로|싫|틀렸|가짜|낚시|나쁨|bad|fake|wrong|boring/.test(lower)) {
		return "negative";
	}
	return "neutral";
}

function prioritySentiment(
	a: CommentInsight["sentiment"],
	b: CommentInsight["sentiment"],
): CommentInsight["sentiment"] {
	const order: CommentInsight["sentiment"][] = [
		"negative",
		"request",
		"question",
		"positive",
		"neutral",
	];
	return order.indexOf(b) < order.indexOf(a) ? b : a;
}

function tokenizeComment(text: string): string[] {
	return normalizeText(text)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s#]/gu, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^#+/, "").trim())
		.filter((token) => token.length >= 2 && !COMMENT_STOPWORDS.has(token))
		.slice(0, 6);
}

function commentAction(sentiment: CommentInsight["sentiment"], label: string): string {
	if (sentiment === "question") {
		return `"${label}" 질문을 다음 영상의 첫 훅 또는 고정 댓글 Q&A로 회수하세요.`;
	}
	if (sentiment === "request") {
		return `"${label}" 요청을 주제 추천 후보로 올리고 관련 레퍼런스 템플릿을 연결하세요.`;
	}
	if (sentiment === "negative") {
		return `"${label}" 관련 불만은 제목/썸네일 약속과 본문 회수 여부를 먼저 점검하세요.`;
	}
	if (sentiment === "positive") {
		return `"${label}" 반응이 좋은 표현을 다음 제목/썸네일 문구 후보로 저장하세요.`;
	}
	return `"${label}" 반복 언급을 다음 소재 검증 키워드로 추적하세요.`;
}

function topicSeedFromComment(label: string, example: string): string {
	const clean = normalizeText(example).replace(/[?？!！]/g, "");
	if (clean.length >= 8 && clean.length <= 48) return clean;
	return `${label}에 대해 사람들이 가장 궁금해하는 것`;
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
}

function clampRatio(value: number): number {
	if (value > 1) return Math.max(0, Math.min(1, value / 100));
	return Math.max(0, Math.min(1, value));
}

function formatSeconds(value: number): string {
	const seconds = Math.round(value);
	if (seconds >= 60) {
		const minutes = Math.floor(seconds / 60);
		const rest = seconds % 60;
		return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
	}
	return `${seconds}초`;
}

const COMMENT_STOPWORDS = new Set([
	"그리고",
	"근데",
	"진짜",
	"영상",
	"너무",
	"이거",
	"저거",
	"그냥",
	"것",
	"수",
	"the",
	"and",
	"for",
	"this",
	"that",
	"video",
	"please",
]);
