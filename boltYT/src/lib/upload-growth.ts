import type { UploadListItem } from "./upload-management";
import {
	getYouTubeDomainIntelligence,
	type DomainRecommendation,
} from "./youtube-domain-intelligence";

export interface UploadAnalyticsSnapshot {
	upload_id: string;
	views?: number | null;
	ctr?: number | null;
	avg_watch_duration?: number | null;
	avg_view_percentage?: number | null;
	estimated_minutes_watched?: number | null;
	likes?: number | null;
	comments?: number | null;
	shares?: number | null;
	subscribers_gained?: number | null;
	subscribers_lost?: number | null;
	fetched_at?: string | null;
	traffic_sources?: Array<{
		source: string;
		views: number;
		estimatedMinutesWatched?: number;
		averageViewDuration?: number;
	}> | null;
	retention_curve?: Array<{
		elapsedVideoTimeRatio: number;
		audienceWatchRatio: number;
		relativeRetentionPerformance?: number | null;
	}> | null;
	sync_warnings?: string[] | null;
}

export interface UploadRenderSnapshot {
	id: string;
	format?: "shorts" | "longform" | string | null;
	duration_seconds?: number | null;
}

export interface KeywordRecommendation {
	keyword: string;
	score: number;
	sourceCount: number;
	reason: string;
}

export interface PublishWindowRecommendation {
	label: string;
	weekday: number;
	hour: number;
	score: number;
	source: "history" | "fallback";
	reason: string;
}

export interface GrowthPlan {
	confidence: "low" | "medium" | "high";
	keywords: KeywordRecommendation[];
	publishWindows: PublishWindowRecommendation[];
	cadence: {
		targetPerWeek: number;
		publishedLast7Days: number;
		scheduledNext7Days: number;
		queuedCount: number;
		action: string;
	};
	length: {
		shortsTarget: string;
		longformTarget: string;
		currentShortsMedianSeconds: number | null;
		currentLongformMedianSeconds: number | null;
		action: string;
	};
	metadataActions: string[];
	thumbnailActions: string[];
	domainActions: string[];
	domainMetrics: Array<{
		label: string;
		displayValue: string;
		implication: string;
	}>;
	trendSignals: Array<{
		label: string;
		score: number;
		risk: "low" | "medium" | "high";
		examples: string[];
	}>;
	nextActions: string[];
}

const STOPWORDS = new Set([
	"그리고",
	"하지만",
	"입니다",
	"합니다",
	"하는",
	"있는",
	"없는",
	"영상",
	"shorts",
	"youtube",
	"유튜브",
	"그리고",
	"about",
	"with",
	"from",
	"this",
	"that",
	"the",
	"and",
	"for",
]);

const FALLBACK_WINDOWS: PublishWindowRecommendation[] = [
	{
		label: "화 19:00-21:00",
		weekday: 2,
		hour: 19,
		score: 70,
		source: "fallback",
		reason: "성과 데이터가 부족할 때는 퇴근 후 시청 가능성이 높은 저녁 슬롯부터 검증합니다.",
	},
	{
		label: "목 20:00-22:00",
		weekday: 4,
		hour: 20,
		score: 68,
		source: "fallback",
		reason: "평일 후반 저녁 슬롯으로 제목/썸네일 반응을 비교하기 좋습니다.",
	},
	{
		label: "토 10:00-12:00",
		weekday: 6,
		hour: 10,
		score: 64,
		source: "fallback",
		reason: "주말 오전 슬롯은 롱폼/몰아보기 후보의 초기 반응을 보기 좋습니다.",
	},
];

export function buildUploadGrowthPlan(params: {
	uploads: UploadListItem[];
	analyticsByUploadId?: Record<string, UploadAnalyticsSnapshot | undefined>;
	rendersById?: Record<string, UploadRenderSnapshot | undefined>;
	now?: Date;
}): GrowthPlan {
	const {
		uploads,
		analyticsByUploadId = {},
		rendersById = {},
		now = new Date(),
	} = params;
	const queued = uploads.filter((upload) => upload.status === "queued");
	const scheduled = uploads.filter((upload) => upload.scheduled_at);
	const published = uploads.filter((upload) => upload.published_at);
	const performanceRows = published.filter(
		(upload) => analyticsByUploadId[upload.id],
	);
	const keywords = recommendKeywords(uploads, analyticsByUploadId);
	const publishWindows = recommendPublishWindows(uploads, analyticsByUploadId);
	const cadence = recommendCadence(uploads, now);
	const length = recommendLength(uploads, rendersById);
	const metadataActions = recommendMetadataActions(queued.length ? queued : uploads, keywords);
	const thumbnailActions = recommendThumbnailActions(
		queued.length ? queued : uploads,
		keywords,
	);
	const domainIntel = getYouTubeDomainIntelligence({
		format: hasLongformRenders(rendersById) ? "longform" : "shorts",
	});
	const domainActions = recommendDomainActions(queued.length ? queued : uploads, domainIntel);
	const confidence =
		performanceRows.length >= 12 ? "high" : performanceRows.length >= 4 ? "medium" : "low";

	const nextActions = [
		keywords[0]
			? `다음 업로드 제목 첫 45자 안에 "${keywords[0].keyword}" 계열 키워드를 넣으세요.`
			: "성과 키워드 데이터가 부족합니다. 다음 3개 영상의 제목/설명 키워드를 일관되게 실험하세요.",
		publishWindows[0]
			? `${publishWindows[0].label} 슬롯에 다음 예약 1개를 배치하세요.`
			: "다음 업로드는 저녁 슬롯 1개와 주말 슬롯 1개로 A/B 비교하세요.",
		cadence.action,
		length.action,
		thumbnailActions[0] ?? "",
		domainActions[0] ?? "",
	].filter(Boolean);

	return {
		confidence,
		keywords,
		publishWindows,
		cadence: {
			...cadence,
			scheduledNext7Days: scheduled.filter((upload) =>
				isWithinDays(upload.scheduled_at, now, 7),
			).length,
		},
		length,
		metadataActions,
		thumbnailActions,
		domainActions,
		domainMetrics: domainIntel.enforcementMetrics.slice(2, 6).map((metric) => ({
			label: metric.label,
			displayValue: metric.displayValue,
			implication: metric.implication,
		})),
		trendSignals: domainIntel.trendClusters.slice(0, 3).map((cluster) => ({
			label: cluster.label,
			score: cluster.score,
			risk: cluster.risk,
			examples: cluster.examples.slice(0, 3),
		})),
		nextActions,
	};
}

export function recommendKeywords(
	uploads: UploadListItem[],
	analyticsByUploadId: Record<string, UploadAnalyticsSnapshot | undefined> = {},
): KeywordRecommendation[] {
	const map = new Map<string, { score: number; sourceIds: Set<string> }>();
	for (const upload of uploads) {
		const perf = performanceScore(analyticsByUploadId[upload.id]);
		const fields: Array<[string, number]> = [
			[upload.title ?? "", 3.5],
			[(upload.description ?? "").slice(0, 240), 1.2],
			[(upload.tags ?? []).join(" "), 2.3],
		];
		for (const [text, multiplier] of fields) {
			for (const token of tokenize(text)) {
				const current = map.get(token) ?? { score: 0, sourceIds: new Set<string>() };
				current.score += perf * multiplier;
				current.sourceIds.add(upload.id);
				map.set(token, current);
			}
		}
	}

	return [...map.entries()]
		.map(([keyword, item]) => ({
			keyword,
			score: Math.round(item.score),
			sourceCount: item.sourceIds.size,
			reason:
				item.sourceIds.size >= 2
					? "여러 업로드 메타데이터에서 반복된 신호입니다."
					: "성과가 높은 후보 메타데이터에서 나온 신호입니다.",
		}))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || b.sourceCount - a.sourceCount)
		.slice(0, 10);
}

export function recommendPublishWindows(
	uploads: UploadListItem[],
	analyticsByUploadId: Record<string, UploadAnalyticsSnapshot | undefined> = {},
): PublishWindowRecommendation[] {
	const slots = new Map<string, { score: number; count: number; weekday: number; hour: number }>();
	for (const upload of uploads) {
		if (!upload.published_at) continue;
		const analytics = analyticsByUploadId[upload.id];
		if (!analytics) continue;
		const date = new Date(upload.published_at);
		if (Number.isNaN(date.getTime())) continue;
		const weekday = date.getDay();
		const hour = date.getHours();
		const key = `${weekday}:${hour}`;
		const current = slots.get(key) ?? { score: 0, count: 0, weekday, hour };
		current.score += performanceScore(analytics);
		current.count += 1;
		slots.set(key, current);
	}

	const history = [...slots.values()]
		.filter((slot) => slot.count >= 1)
		.map((slot) => ({
			label: `${weekdayLabel(slot.weekday)} ${String(slot.hour).padStart(2, "0")}:00-${String((slot.hour + 2) % 24).padStart(2, "0")}:00`,
			weekday: slot.weekday,
			hour: slot.hour,
			score: Math.round(slot.score / slot.count),
			source: "history" as const,
			reason: `${slot.count}개 게시 성과 기준 추천 슬롯입니다.`,
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, 3);

	return history.length >= 2 ? history : FALLBACK_WINDOWS;
}

export function recommendCadence(uploads: UploadListItem[], now = new Date()) {
	const queuedCount = uploads.filter(
		(upload) => upload.status === "queued" || upload.status === "failed",
	).length;
	const publishedLast7Days = uploads.filter((upload) =>
		isWithinPastDays(upload.published_at, now, 7),
	).length;
	const targetPerWeek = queuedCount >= 7 ? 5 : queuedCount >= 3 ? 3 : 2;
	let action = `이번 주 목표는 ${targetPerWeek}개 게시입니다.`;
	if (publishedLast7Days >= targetPerWeek) {
		action = "이번 주 게시량은 충분합니다. 새 업로드보다 성과 데이터 회수와 제목/썸네일 보강을 우선하세요.";
	} else if (queuedCount > 0) {
		action = `대기열에서 ${targetPerWeek - publishedLast7Days}개를 우선 예약해 주간 리듬을 채우세요.`;
	}
	return {
		targetPerWeek,
		publishedLast7Days,
		scheduledNext7Days: 0,
		queuedCount,
		action,
	};
}

export function recommendLength(
	uploads: UploadListItem[],
	rendersById: Record<string, UploadRenderSnapshot | undefined> = {},
) {
	const durations = uploads
		.map((upload) => (upload.render_id ? rendersById[upload.render_id] : undefined))
		.filter((render): render is UploadRenderSnapshot => Boolean(render));
	const shorts = durations
		.filter((render) => render.format === "shorts" || Number(render.duration_seconds) <= 180)
		.map((render) => Number(render.duration_seconds))
		.filter((value) => Number.isFinite(value) && value > 0);
	const longform = durations
		.filter((render) => render.format === "longform" || Number(render.duration_seconds) > 180)
		.map((render) => Number(render.duration_seconds))
		.filter((value) => Number.isFinite(value) && value > 0);
	const currentShortsMedianSeconds = median(shorts);
	const currentLongformMedianSeconds = median(longform);
	const action = currentLongformMedianSeconds
		? "롱폼은 8-20분 안에서 유지하고, 중간 이탈을 막기 위해 90-150초마다 새 챕터/증거 컷을 넣으세요."
		: "쇼츠는 35-70초를 기본 실험값으로 두고, 스토리형만 90-180초까지 늘리세요.";
	return {
		shortsTarget: "35-70초 기본, 스토리형은 최대 180초 실험",
		longformTarget: "8-20분, 챕터형 5-9구간",
		currentShortsMedianSeconds,
		currentLongformMedianSeconds,
		action,
	};
}

function recommendMetadataActions(
	uploads: UploadListItem[],
	keywords: KeywordRecommendation[],
): string[] {
	const actions = new Set<string>();
	const primaryKeyword = keywords[0]?.keyword;
	for (const upload of uploads.slice(0, 12)) {
		const title = upload.title?.trim() ?? "";
		const description = upload.description?.trim() ?? "";
		const tags = upload.tags ?? [];
		if (title.length < 18) actions.add("제목이 짧은 후보가 있습니다. 핵심 키워드 + 궁금증 구조로 28자 이상 보강하세요.");
		if (title.length > 72) actions.add("제목이 긴 후보가 있습니다. 모바일 첫 줄에 핵심 키워드가 보이도록 압축하세요.");
		if (description.length < 120) actions.add("설명 첫 2줄에 핵심 키워드와 영상 요약을 넣어 검색 매칭을 보강하세요.");
		if (tags.length > 12) actions.add("태그 과다 사용을 줄이고 오탈자/동의어 보조 키워드 중심으로 정리하세요.");
		if (primaryKeyword && !`${title} ${description}`.toLowerCase().includes(primaryKeyword.toLowerCase())) {
			actions.add(`대기열 메타데이터에 성과 키워드 "${primaryKeyword}" 계열을 반영하세요.`);
		}
	}
	return [...actions].slice(0, 5);
}

function recommendThumbnailActions(
	uploads: UploadListItem[],
	keywords: KeywordRecommendation[],
): string[] {
	const actions = new Set<string>();
	const missingThumbnailCount = uploads.filter(
		(upload) => !upload.thumbnail_path,
	).length;
	const primaryKeyword = keywords[0]?.keyword;
	if (missingThumbnailCount > 0) {
		actions.add(
			`대기열 ${missingThumbnailCount}개에 썸네일 파일이 없습니다. 업로드 전 1280x720 패키지 또는 Shorts 첫 프레임을 생성하세요.`,
		);
	}
	if (primaryKeyword) {
		actions.add(
			`썸네일 문구에는 "${primaryKeyword}"를 그대로 반복하기보다 감정/증거 단어 3-5개로 역할을 분리하세요.`,
		);
	}
	if (uploads.length >= 2) {
		actions.add(
			"동일 주제는 호기심형/증거형/직접형 썸네일 3안을 만들어 CTR 데이터를 비교하세요.",
		);
	}
	if (actions.size === 0) {
		actions.add(
			"다음 업로드부터 썸네일 제목, 보조문구, 피사체 위치를 저장해 CTR 학습 데이터로 누적하세요.",
		);
	}
	return [...actions].slice(0, 5);
}

function recommendDomainActions(
	uploads: UploadListItem[],
	domainIntel: DomainRecommendation,
): string[] {
	const actions = new Set<string>();
	const q3Metric = domainIntel.enforcementMetrics.find(
		(metric) => metric.id === "terminated-q3-2025",
	);
	const spamMetric = domainIntel.enforcementMetrics.find(
		(metric) => metric.id === "q3-spam-share",
	);
	if (q3Metric && spamMetric) {
		actions.add(
			`${q3Metric.label} ${q3Metric.displayValue}, ${spamMetric.label} ${spamMetric.displayValue}. 대량 삭제 핵심은 AI 사용 자체보다 스팸/기만/반복양산 신호입니다.`,
		);
	}

	const riskyMetadataCount = uploads.filter((upload) =>
		/(텔레그램|카톡방|telegram|whatsapp|free money|수익 보장|원본 풀영상|download now)/i.test(
			`${upload.title ?? ""} ${upload.description ?? ""} ${(upload.tags ?? []).join(" ")}`,
		),
	).length;
	if (riskyMetadataCount > 0) {
		actions.add(
			`${riskyMetadataCount}개 업로드에서 외부 유도/기만성 문구 후보가 보입니다. 공개 전 제목·설명·태그에서 제거하세요.`,
		);
	}

	const topTrend = domainIntel.trendClusters[0];
	if (topTrend) {
		actions.add(
			`다음 파일럿은 "${topTrend.label}" 클러스터로 묶고 ${topTrend.examples.slice(0, 3).join(", ")} 계열의 질문형 주제를 3개 실험하세요.`,
		);
	}
	actions.add(domainIntel.safeActions[0] ?? "각 영상마다 고유 출처, 해석, 결론을 남기세요.");
	actions.add(domainIntel.productionRules[0] ?? "첫 3-5초 안에 제목의 약속을 회수하세요.");
	return [...actions].slice(0, 5);
}

function hasLongformRenders(
	rendersById: Record<string, UploadRenderSnapshot | undefined>,
): boolean {
	return Object.values(rendersById).some(
		(render) =>
			render?.format === "longform" || Number(render?.duration_seconds ?? 0) > 180,
	);
}

function performanceScore(analytics?: UploadAnalyticsSnapshot): number {
	if (!analytics) return 1;
	return Math.max(
		1,
		Number(analytics.views ?? 0) +
			Number(analytics.likes ?? 0) * 12 +
			Number(analytics.comments ?? 0) * 18 +
			Number(analytics.subscribers_gained ?? 0) * 60 +
			Number(analytics.ctr ?? 0) * 120 +
			Number(analytics.avg_watch_duration ?? 0) * 1.5,
	);
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s#]/gu, " ")
		.split(/\s+/)
		.map((token) => token.replace(/^#+/, "").trim())
		.filter((token) => token.length >= 2 && !STOPWORDS.has(token))
		.slice(0, 80);
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const value =
		sorted.length % 2 === 0
			? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
			: (sorted[mid] ?? 0);
	return Math.round(value);
}

function isWithinPastDays(value: string | null | undefined, now: Date, days: number): boolean {
	if (!value) return false;
	const time = new Date(value).getTime();
	if (!Number.isFinite(time)) return false;
	const diff = now.getTime() - time;
	return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function isWithinDays(value: string | null | undefined, now: Date, days: number): boolean {
	if (!value) return false;
	const time = new Date(value).getTime();
	if (!Number.isFinite(time)) return false;
	const diff = time - now.getTime();
	return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function weekdayLabel(weekday: number): string {
	return ["일", "월", "화", "수", "목", "금", "토"][weekday] ?? "일";
}
