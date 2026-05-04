import { getApiProxyUrl } from "./proxy";
import {
	isAllowedLongformDuration,
	LONGFORM_MAX_DURATION_SECONDS,
	LONGFORM_MIN_DURATION_SECONDS,
} from "./reference-duration-policy";

export interface NicheResearchOptions {
	maxResults: number;
	daysBack: number;
	order: "viewCount" | "date" | "relevance";
}

export interface NicheResearchVideo {
	videoId: string;
	title: string;
	description: string;
	thumbnail: string;
	channelId: string;
	channelTitle: string;
	publishedAt: string;
	durationSeconds: number;
	viewCount: number;
	likeCount: number;
	commentCount: number;
	channelSubscriberCount: number | null;
	channelVideoCount: number;
	channelViewCount: number;
	hiddenSubscriberCount: boolean;
}

export interface NicheResearchResult {
	query: string;
	fetchedAt: string;
	order: NicheResearchOptions["order"];
	daysBack: number;
	videos: NicheResearchVideo[];
}

export interface ScoredNicheVideo extends NicheResearchVideo {
	ageDays: number;
	viewsPerDay: number;
	engagementRate: number;
	viewSubscriberRatio: number | null;
	score: number;
	scoreParts: {
		velocity: number;
		leverage: number;
		engagement: number;
		longform: number;
		freshness: number;
	};
}

export interface NicheCandidateSummary {
	query: string;
	score: number;
	sampleSize: number;
	uniqueChannelCount: number;
	dominantChannelShare: number;
	medianViews: number;
	medianViewsPerDay: number;
	medianDurationSeconds: number;
	longformShare: number;
	hiddenSubscriberShare: number;
	topVideos: ScoredNicheVideo[];
	greenFlags: string[];
	redFlags: string[];
}

export interface NicheAnalysisQualityFactor {
	key:
		| "sample"
		| "diversity"
		| "dominance"
		| "longform"
		| "subscriber"
		| "format";
	label: string;
	score: number;
	status: "good" | "warn" | "bad";
	detail: string;
}

export interface NicheAnalysisQuality {
	score: number;
	label: "높음" | "보통" | "낮음";
	factors: NicheAnalysisQualityFactor[];
	warnings: string[];
}

export interface NicheVideoQualityTarget {
	key:
		| "opening"
		| "first_cut"
		| "cut_density"
		| "source_anchor"
		| "motion_density"
		| "premium_floor";
	label: string;
	target: string;
	rationale: string;
}

export interface NicheFormatVideoInput {
	videoId: string;
	title: string;
	durationSeconds: number;
	viewCount: number;
}

export interface NicheFormatVideoAnalysis {
	videoId: string;
	title: string;
	url: string;
	durationSeconds: number;
	sampleSeconds: number;
	hookPattern: "question" | "shock" | "claim" | "story" | "unknown";
	hookDurationSeconds: number | null;
	firstCutSeconds: number | null;
	cutsFirst10: number;
	cutsFirst30: number;
	avgCutIntervalSeconds: number | null;
	titleOpeningOverlap: number;
	openingText: string;
	transcriptAvailable: boolean;
	cutDetectionAvailable: boolean;
	rules: string[];
	warnings: string[];
}

export interface NicheFormatAnalysis {
	query: string;
	sampleSeconds: number;
	analyzedAt: string;
	videos: NicheFormatVideoAnalysis[];
	summary: {
		medianHookSeconds: number | null;
		medianFirstCutSeconds: number | null;
		medianCutsFirst10: number;
		medianCutsFirst30: number;
		medianTitleOpeningOverlap: number;
		commonHookPattern: NicheFormatVideoAnalysis["hookPattern"];
		rules: string[];
		warnings: string[];
	};
}

export interface NichePlaybook {
	query: string;
	decision: "scale" | "test" | "hold";
	score: number;
	headline: string;
	rules: string[];
	openingFormula: string[];
	productionConstraints: string[];
	videoQualityTargets?: NicheVideoQualityTarget[];
	pilotPlan: string[];
	pilotTopics: string[];
	analysisQuality?: NicheAnalysisQuality;
	prompt: string;
}

export interface NicheResearchSnapshot {
	id: string;
	createdAt: string;
	queries: string[];
	options: NicheResearchOptions;
	summaries: NicheCandidateSummary[];
	formatAnalyses: Record<string, NicheFormatAnalysis>;
}

export interface NicheResearchHandoff {
	id: string;
	createdAt: string;
	topic: string;
	sourceSnapshotId?: string;
	summary: NicheCandidateSummary;
	formatAnalysis?: NicheFormatAnalysis;
	playbook: NichePlaybook;
}

const SNAPSHOT_STORAGE_KEY = "niche-research:snapshots:v1";
const HANDOFF_STORAGE_KEY = "niche-research:handoffs:v1";
const TOPIC_HANDOFF_STORAGE_KEY = "niche-research:topic-handoffs:v1";
const MAX_SNAPSHOTS = 20;
const MAX_HANDOFFS = 50;
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function fetchNicheResearch(
	query: string,
	options: NicheResearchOptions,
): Promise<NicheResearchResult> {
	const params = new URLSearchParams({
		q: query,
		maxResults: String(options.maxResults),
		daysBack: String(options.daysBack),
		order: options.order,
	});
	const res = await fetch(
		`${getApiProxyUrl()}/api/youtube/niche-research?${params.toString()}`,
	);

	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(
			(err as { error?: string }).error ?? `YouTube 리서치 실패: ${res.status}`,
		);
	}

	return res.json() as Promise<NicheResearchResult>;
}

export async function fetchNicheFormatAnalysis(params: {
	query: string;
	videos: NicheFormatVideoInput[];
	sampleSeconds?: number;
}): Promise<NicheFormatAnalysis> {
	const res = await fetch(`${getApiProxyUrl()}/api/youtube/format-analysis`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			query: params.query,
			videos: params.videos.slice(0, 3),
			sampleSeconds: params.sampleSeconds ?? 90,
		}),
	});

	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(
			(err as { error?: string }).error ?? `포맷 분석 실패: ${res.status}`,
		);
	}

	return res.json() as Promise<NicheFormatAnalysis>;
}

export function buildNichePlaybook(
	summary: NicheCandidateSummary,
	format?: NicheFormatAnalysis,
): NichePlaybook {
	const decision = decideNiche(summary, format);
	const analysisQuality = assessNicheAnalysisQuality(summary, format);
	const hookSeconds = format?.summary.medianHookSeconds;
	const firstCutSeconds = format?.summary.medianFirstCutSeconds;
	const cutsFirst10 = format?.summary.medianCutsFirst10 ?? 0;
	const cutsFirst30 = format?.summary.medianCutsFirst30 ?? 0;
	const hookPattern = format?.summary.commonHookPattern ?? "unknown";
	const titleOverlap = format?.summary.medianTitleOpeningOverlap ?? 0;
	const headline =
		decision === "scale"
			? "검증 신호가 강함. 파일럿 후 빠르게 증폭할 후보입니다."
			: decision === "test"
				? "가능성은 있습니다. 소량 파일럿으로 패턴을 먼저 검증하세요."
				: "아직 보류가 맞습니다. 표본/속도/포맷 신호가 약합니다.";

	const rules = [
		`니치 점수 ${summary.score}점, 표본 ${summary.sampleSize}개, 채널 ${summary.uniqueChannelCount}개 기준으로 판단`,
		`분석 신뢰도 ${analysisQuality.score}점(${analysisQuality.label}) 기준으로 파일럿 규모를 조절`,
		`중앙 조회수 ${formatCompactNumber(summary.medianViews)}, 중앙 일평균 조회 ${formatCompactNumber(summary.medianViewsPerDay)}/일`,
		`롱폼 비율 ${Math.round(summary.longformShare * 100)}%, 중앙 길이 ${formatDuration(summary.medianDurationSeconds)}`,
		...(hookSeconds !== undefined && hookSeconds !== null
			? [`오프닝 훅은 ${hookSeconds.toFixed(1)}초 안에 닫는 구조를 우선 테스트`]
			: []),
		...(firstCutSeconds !== undefined && firstCutSeconds !== null
			? [`첫 화면 전환은 ${firstCutSeconds.toFixed(1)}초 전후에 배치`]
			: []),
		...(cutsFirst10 > 0 ? [`첫 10초 컷 ${cutsFirst10}개 이상 유지`] : []),
		...(cutsFirst30 > 0 ? [`첫 30초 컷 ${cutsFirst30}개 안팎 유지`] : []),
		...(titleOverlap >= 0.2
			? ["제목 핵심어를 첫 10초 안에서 바로 회수"]
			: ["제목 핵심어와 첫 문장의 연결을 의도적으로 강화"]),
		...summary.greenFlags,
	].slice(0, 10);

	const openingFormula = [
		`${hookPatternLabel(hookPattern)} 훅으로 시작`,
		"첫 문장에는 결론/미스터리/손실 중 하나를 바로 제시",
		"인사말, 채널 소개, 긴 배경 설명 금지",
		"첫 10초 안에 제목의 핵심 단어를 한 번 이상 사용",
		"첫 30초 안에 시청자가 확인하고 싶은 질문을 2개 이상 남김",
	];

	const productionConstraints = [
		"영상 길이는 상위 표본 중앙값에 맞추고, 첫 씬은 길게 끌지 않음",
		"같은 포맷으로 최소 10개를 올린 뒤 CTR/평균 시청/구독 전환으로 판단",
		"조회수만 보지 말고 구독자 대비 조회수와 일평균 조회 속도를 같이 비교",
		"AI 생성/재사용 콘텐츠로 보이지 않게 해설, 구조, 시각 자료 선택에 원본성을 추가",
		...analysisQuality.warnings.map((warning) => `신뢰도 주의: ${warning}`),
		...summary.redFlags.map((flag) => `주의: ${flag}`),
		...(format?.summary.warnings ?? []).map((warning) => `분석 한계: ${warning}`),
	].slice(0, 10);
	const videoQualityTargets = buildVideoQualityTargets(summary, format);

	const pilotPlan = [
		"상위 영상 제목 20개를 모아 반복되는 명사/갈등/숫자 패턴을 분류",
		"첫 3개 영상은 같은 주제군에서 훅 문장만 다르게 테스트",
		"다음 3개 영상은 첫 컷 시점과 컷 밀도만 바꿔 테스트",
		"마지막 4개 영상은 썸네일 문구와 제목 회수율을 맞춰 테스트",
		"10개 업로드 후 48시간 기준으로 조회 속도 상위 2개 포맷만 남김",
	];
	const pilotTopics = buildPilotTopics(summary);

	const prompt = [
		`니치: ${summary.query}`,
		`목표: ${headline}`,
		`분석 신뢰도: ${analysisQuality.score}점(${analysisQuality.label})`,
		"규칙:",
		...rules.map((rule) => `- ${rule}`),
		"오프닝 공식:",
		...openingFormula.map((rule) => `- ${rule}`),
		"제작 제약:",
		...productionConstraints.map((rule) => `- ${rule}`),
		"영상 QC 목표:",
		...videoQualityTargets.map(
			(target) => `- ${target.label}: ${target.target}`,
		),
		"파일럿 후보:",
		...pilotTopics.map((topic, index) => `${index + 1}. ${topic}`),
		"이 규칙을 지키는 롱폼 영상 주제 10개와 각 영상의 첫 15초 대본을 생성해라.",
	].join("\n");

	return {
		query: summary.query,
		decision,
		score: summary.score,
		headline,
		rules,
		openingFormula,
		productionConstraints,
		videoQualityTargets,
		pilotPlan,
		pilotTopics,
		analysisQuality,
		prompt,
	};
}

export function assessNicheAnalysisQuality(
	summary: NicheCandidateSummary,
	format?: NicheFormatAnalysis,
): NicheAnalysisQuality {
	const expectedFormatSamples = Math.min(3, Math.max(1, summary.topVideos.length));
	const dominantChannelShare =
		summary.dominantChannelShare ?? estimateDominantChannelShare(summary);
	const formatCompleteness = format
		? format.videos.reduce((sum, video) => {
				const transcript = video.transcriptAvailable ? 1 : 0;
				const cuts = video.cutDetectionAvailable ? 1 : 0;
				return sum + (transcript + cuts) / 2;
			}, 0) / expectedFormatSamples
		: 0.45;
	const factors: NicheAnalysisQualityFactor[] = [
		{
			key: "sample",
			label: "표본 수",
			score: Math.round(clamp01(summary.sampleSize / 12) * 100),
			status:
				summary.sampleSize >= 10
					? "good"
					: summary.sampleSize >= 5
						? "warn"
						: "bad",
			detail: `${summary.sampleSize}개 영상`,
		},
		{
			key: "diversity",
			label: "채널 다양성",
			score: Math.round(clamp01((summary.uniqueChannelCount - 1) / 5) * 100),
			status:
				summary.uniqueChannelCount >= 5
					? "good"
					: summary.uniqueChannelCount >= 3
						? "warn"
						: "bad",
			detail: `${summary.uniqueChannelCount}개 채널`,
		},
		{
			key: "dominance",
			label: "채널 편향",
			score: Math.round((1 - clamp01((dominantChannelShare - 0.35) / 0.45)) * 100),
			status:
				dominantChannelShare <= 0.35
					? "good"
					: dominantChannelShare <= 0.55
						? "warn"
						: "bad",
			detail: `최대 채널 비중 ${Math.round(dominantChannelShare * 100)}%`,
		},
		{
			key: "longform",
			label: "롱폼 적합도",
			score: Math.round(clamp01(summary.longformShare) * 100),
			status:
				summary.longformShare >= 0.6
					? "good"
					: summary.longformShare >= 0.35
						? "warn"
						: "bad",
			detail: `롱폼 ${Math.round(summary.longformShare * 100)}%`,
		},
		{
			key: "subscriber",
			label: "구독자 공개성",
			score: Math.round((1 - clamp01(summary.hiddenSubscriberShare)) * 100),
			status:
				summary.hiddenSubscriberShare <= 0.25
					? "good"
					: summary.hiddenSubscriberShare <= 0.5
						? "warn"
						: "bad",
			detail: `비공개 ${Math.round(summary.hiddenSubscriberShare * 100)}%`,
		},
		{
			key: "format",
			label: "포맷 근거",
			score: Math.round(clamp01(formatCompleteness) * 100),
			status: format
				? formatCompleteness >= 0.75
					? "good"
					: formatCompleteness >= 0.45
						? "warn"
						: "bad"
				: "warn",
			detail: format
				? `상위 ${format.videos.length}개 분석`
				: "법칙 분석 전",
		},
	];
	const weights: Record<NicheAnalysisQualityFactor["key"], number> = {
		sample: 0.24,
		diversity: 0.18,
		dominance: 0.18,
		longform: 0.14,
		subscriber: 0.12,
		format: 0.14,
	};
	const score = Math.round(
		factors.reduce((sum, factor) => sum + factor.score * weights[factor.key], 0),
	);
	const warnings = buildQualityWarnings(summary, format, dominantChannelShare);
	return {
		score,
		label: score >= 75 ? "높음" : score >= 55 ? "보통" : "낮음",
		factors,
		warnings,
	};
}

export function persistNicheResearchSnapshot(
	snapshot: Omit<NicheResearchSnapshot, "id" | "createdAt"> &
		Partial<Pick<NicheResearchSnapshot, "id" | "createdAt">>,
): NicheResearchSnapshot {
	const next: NicheResearchSnapshot = {
		id: snapshot.id ?? crypto.randomUUID(),
		createdAt: snapshot.createdAt ?? new Date().toISOString(),
		queries: snapshot.queries,
		options: snapshot.options,
		summaries: snapshot.summaries,
		formatAnalyses: snapshot.formatAnalyses,
	};
	const snapshots = loadNicheResearchHistory().filter(
		(item) => item.id !== next.id,
	);
	writeJson(SNAPSHOT_STORAGE_KEY, [next, ...snapshots].slice(0, MAX_SNAPSHOTS));
	return next;
}

export function loadNicheResearchHistory(): NicheResearchSnapshot[] {
	const value = readJson<unknown>(SNAPSHOT_STORAGE_KEY, []);
	if (!Array.isArray(value)) return [];
	return value
		.filter(isNicheResearchSnapshot)
		.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
}

export function findRecentNicheResearchSnapshot(
	queries: string[],
	options: NicheResearchOptions,
	now = new Date(),
): NicheResearchSnapshot | null {
	const normalizedQueries = normalizeQueriesForCache(queries);
	return (
		loadNicheResearchHistory().find((snapshot) => {
			const age = now.getTime() - new Date(snapshot.createdAt).getTime();
			return (
				age >= 0 &&
				age <= CACHE_MAX_AGE_MS &&
				sameQuerySet(normalizedQueries, normalizeQueriesForCache(snapshot.queries)) &&
				snapshot.options.maxResults === options.maxResults &&
				snapshot.options.daysBack === options.daysBack &&
				snapshot.options.order === options.order
			);
		}) ?? null
	);
}

export function persistNicheResearchHandoff(input: {
	topic: string;
	sourceSnapshotId?: string;
	summary: NicheCandidateSummary;
	formatAnalysis?: NicheFormatAnalysis;
	playbook: NichePlaybook;
}): NicheResearchHandoff {
	const handoff: NicheResearchHandoff = {
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		topic: input.topic,
		sourceSnapshotId: input.sourceSnapshotId,
		summary: input.summary,
		formatAnalysis: input.formatAnalysis,
		playbook: input.playbook,
	};
	const handoffs = loadNicheResearchHandoffs().filter(
		(item) => item.id !== handoff.id,
	);
	writeJson(HANDOFF_STORAGE_KEY, [handoff, ...handoffs].slice(0, MAX_HANDOFFS));
	return handoff;
}

export function loadNicheResearchHandoff(
	id: string | null | undefined,
): NicheResearchHandoff | null {
	if (!id) return null;
	return loadNicheResearchHandoffs().find((item) => item.id === id) ?? null;
}

export function attachNicheHandoffToTopic(topicId: string, handoffId: string) {
	if (!topicId || !handoffId) return;
	const mapping = readJson<Record<string, string>>(TOPIC_HANDOFF_STORAGE_KEY, {});
	writeJson(TOPIC_HANDOFF_STORAGE_KEY, {
		...mapping,
		[topicId]: handoffId,
	});
}

export function loadNicheHandoffForTopic(
	topicId: string,
): NicheResearchHandoff | null {
	const mapping = readJson<Record<string, string>>(TOPIC_HANDOFF_STORAGE_KEY, {});
	return loadNicheResearchHandoff(mapping[topicId]);
}

export function formatNicheHandoffForPrompt(
	handoff: NicheResearchHandoff,
): string {
	const summary = handoff.summary;
	const format = handoff.formatAnalysis?.summary;
	const quality =
		handoff.playbook.analysisQuality ??
		assessNicheAnalysisQuality(summary, handoff.formatAnalysis);
	const lines = [
		`선택 주제: ${handoff.topic}`,
		`원본 니치: ${summary.query}`,
		`판정: ${decisionLabelForPrompt(handoff.playbook.decision)} / ${handoff.playbook.score}점`,
		`분석 신뢰도: ${quality.score}점(${quality.label})`,
		`표본: 영상 ${summary.sampleSize}개, 채널 ${summary.uniqueChannelCount}개`,
		`성과 기준: 중앙 조회수 ${formatCompactNumber(summary.medianViews)}, 중앙 일평균 조회 ${formatCompactNumber(summary.medianViewsPerDay)}/일, 중앙 길이 ${formatDuration(summary.medianDurationSeconds)}`,
		`제작 목표: ${handoff.playbook.headline}`,
		"핵심 규칙:",
		...handoff.playbook.rules.map((rule) => `- ${rule}`),
		"오프닝 공식:",
		...handoff.playbook.openingFormula.map((rule) => `- ${rule}`),
		"제작 제약:",
		...handoff.playbook.productionConstraints.map((rule) => `- ${rule}`),
	];
	const videoQualityTargets = handoff.playbook.videoQualityTargets ?? [];
	if (videoQualityTargets.length > 0) {
		lines.push(
			"영상 QC 목표:",
			...videoQualityTargets.map(
				(target) => `- ${target.label}: ${target.target}`,
			),
		);
	}
	if (quality.warnings.length > 0) {
		lines.push(
			"신뢰도 주의:",
			...quality.warnings.map((warning) => `- ${warning}`),
		);
	}
	if (format) {
		lines.push(
			"측정된 포맷 법칙:",
			`- 대표 훅 ${format.medianHookSeconds === null ? "미확인" : `${format.medianHookSeconds.toFixed(1)}초`}`,
			`- 첫 컷 ${format.medianFirstCutSeconds === null ? "미확인" : `${format.medianFirstCutSeconds.toFixed(1)}초`}`,
			`- 첫 10초 컷 ${format.medianCutsFirst10}개, 첫 30초 컷 ${format.medianCutsFirst30}개`,
			`- 제목 회수율 ${Math.round(format.medianTitleOpeningOverlap * 100)}%`,
		);
	}
	return lines.join("\n");
}

export function analyzeNicheResearch(
	result: NicheResearchResult,
	now = new Date(),
): NicheCandidateSummary {
	const scored = result.videos
		.map((video) => scoreNicheVideo(video, now))
		.sort((a, b) => b.score - a.score);
	const topVideos = scored.slice(0, 8);
	const sampleSize = scored.length;
	const uniqueChannelCount = new Set(scored.map((video) => video.channelId)).size;
	const durations = scored.map((video) => video.durationSeconds);
	const views = scored.map((video) => video.viewCount);
	const velocities = scored.map((video) => video.viewsPerDay);
	const longformCount = scored.filter(
		(video) => isAllowedLongformDuration(video.durationSeconds),
	).length;
	const hiddenSubscriberCount = scored.filter(
		(video) => video.hiddenSubscriberCount,
	).length;
	const dominantChannelShare = calculateDominantChannelShare(scored);
	const medianDurationSeconds = median(durations);
	const medianViews = median(views);
	const medianViewsPerDay = median(velocities);
	const longformShare = sampleSize ? longformCount / sampleSize : 0;
	const hiddenSubscriberShare = sampleSize
		? hiddenSubscriberCount / sampleSize
		: 0;
	const score = sampleSize
		? Math.round(topVideos.reduce((sum, video) => sum + video.score, 0) / topVideos.length)
		: 0;

	return {
		query: result.query,
		score,
		sampleSize,
		uniqueChannelCount,
		dominantChannelShare,
		medianViews,
		medianViewsPerDay,
		medianDurationSeconds,
		longformShare,
		hiddenSubscriberShare,
		topVideos,
		greenFlags: buildGreenFlags({
			score,
			sampleSize,
			uniqueChannelCount,
			medianViews,
			medianViewsPerDay,
			medianDurationSeconds,
			longformShare,
			hiddenSubscriberShare,
		}),
		redFlags: buildRedFlags({
			sampleSize,
			uniqueChannelCount,
			medianViewsPerDay,
			longformShare,
			hiddenSubscriberShare,
		}),
	};
}

export function scoreNicheVideo(
	video: NicheResearchVideo,
	now = new Date(),
): ScoredNicheVideo {
	const ageDays = Math.max(
		1,
		(now.getTime() - new Date(video.publishedAt).getTime()) / 86_400_000,
	);
	const viewsPerDay = video.viewCount / ageDays;
	const engagementRate =
		video.viewCount > 0
			? (video.likeCount + video.commentCount * 2) / video.viewCount
			: 0;
	const viewSubscriberRatio =
		video.channelSubscriberCount && video.channelSubscriberCount > 0
			? video.viewCount / video.channelSubscriberCount
			: null;

	const velocity = logScore(viewsPerDay, 25_000);
	const leverage =
		viewSubscriberRatio === null ? 0.48 : logScore(viewSubscriberRatio, 4);
	const engagement = clamp01(engagementRate / 0.045);
	const longform = !isAllowedLongformDuration(video.durationSeconds)
		? video.durationSeconds > LONGFORM_MAX_DURATION_SECONDS
			? 0.22
			: video.durationSeconds >= 4 * 60
				? 0.52
				: 0.18
		: video.durationSeconds >= 12 * 60
			? 1
			: video.durationSeconds >= LONGFORM_MIN_DURATION_SECONDS
				? 0.84
				: 0.52;
	const freshness = clamp01(1 - ageDays / 730);

	const score = Math.round(
		(velocity * 0.34 +
			leverage * 0.24 +
			engagement * 0.14 +
			longform * 0.2 +
			freshness * 0.08) *
			100,
	);

	return {
		...video,
		ageDays,
		viewsPerDay,
		engagementRate,
		viewSubscriberRatio,
		score,
		scoreParts: {
			velocity,
			leverage,
			engagement,
			longform,
			freshness,
		},
	};
}

export function formatCompactNumber(value: number): string {
	return new Intl.NumberFormat("ko-KR", {
		notation: "compact",
		maximumFractionDigits: value >= 10_000 ? 1 : 0,
	}).format(Math.round(value));
}

export function formatDuration(totalSeconds: number): string {
	const seconds = Math.max(0, Math.round(totalSeconds));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const restMinutes = minutes % 60;
	const restSeconds = seconds % 60;
	if (hours > 0) {
		return `${hours}:${String(restMinutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
	}
	return `${restMinutes}:${String(restSeconds).padStart(2, "0")}`;
}

function buildGreenFlags(input: {
	score: number;
	sampleSize: number;
	uniqueChannelCount: number;
	medianViews: number;
	medianViewsPerDay: number;
	medianDurationSeconds: number;
	longformShare: number;
	hiddenSubscriberShare: number;
}) {
	const flags: string[] = [];
	if (input.score >= 70) flags.push("상위 영상 점수가 높음");
	if (input.medianViewsPerDay >= 5_000) flags.push("일평균 조회 속도 강함");
	if (input.medianViews >= 100_000) flags.push("중앙 조회수가 검증 구간");
	if (input.longformShare >= 0.6) flags.push("롱폼 반복 제작에 적합");
	if (input.uniqueChannelCount >= 5) flags.push("한 채널 의존도가 낮음");
	if (input.hiddenSubscriberShare <= 0.25) flags.push("구독자 대비 조회수 판별 가능");
	return flags.slice(0, 4);
}

function buildRedFlags(input: {
	sampleSize: number;
	uniqueChannelCount: number;
	medianViewsPerDay: number;
	longformShare: number;
	hiddenSubscriberShare: number;
}) {
	const flags: string[] = [];
	if (input.sampleSize < 5) flags.push("표본이 적어 판단 보류");
	if (input.uniqueChannelCount <= 2) flags.push("소수 채널이 결과를 지배");
	if (input.medianViewsPerDay < 1_000) flags.push("최근 조회 속도 약함");
	if (input.longformShare < 0.35) flags.push("쇼츠/짧은 영상 비중 높음");
	if (input.hiddenSubscriberShare > 0.5) flags.push("구독자 비공개 채널 비중 높음");
	return flags.slice(0, 4);
}

function buildQualityWarnings(
	summary: NicheCandidateSummary,
	format: NicheFormatAnalysis | undefined,
	dominantChannelShare: number,
) {
	const warnings: string[] = [];
	if (summary.sampleSize < 8) warnings.push("표본이 8개 미만이라 우연값 가능성 있음");
	if (summary.uniqueChannelCount < 4) warnings.push("채널 다양성이 낮아 특정 채널 착시 가능");
	if (dominantChannelShare > 0.45) warnings.push("상위 결과가 한 채널에 치우침");
	if (summary.longformShare < 0.5) warnings.push("롱폼 표본이 부족해 장편 제작 판단 약함");
	if (summary.hiddenSubscriberShare > 0.4) {
		warnings.push("구독자 비공개 비율이 높아 레버리지 판단 약함");
	}
	if (!format) {
		warnings.push("포맷 법칙 분석 전이라 훅/컷 근거가 약함");
	} else {
		const analyzedSignals = format.videos.flatMap((video) => [
			video.transcriptAvailable,
			video.cutDetectionAvailable,
		]);
		const successRatio = analyzedSignals.length
			? analyzedSignals.filter(Boolean).length / analyzedSignals.length
			: 0;
		if (successRatio < 0.6) warnings.push("자막/컷 감지 성공률이 낮음");
	}
	return warnings.slice(0, 5);
}

function decideNiche(
	summary: NicheCandidateSummary,
	format?: NicheFormatAnalysis,
): NichePlaybook["decision"] {
	const formatReady =
		!format ||
		((format.summary.medianHookSeconds ?? 99) <= 8 &&
			format.summary.medianCutsFirst10 >= 1);
	if (
		summary.score >= 70 &&
		summary.sampleSize >= 5 &&
		summary.longformShare >= 0.45 &&
		formatReady
	) {
		return "scale";
	}
	if (
		summary.score >= 50 &&
		summary.sampleSize >= 3 &&
		summary.medianViewsPerDay >= 800
	) {
		return "test";
	}
	return "hold";
}

function buildPilotTopics(summary: NicheCandidateSummary): string[] {
	const seeds = summary.topVideos
		.map((video) => cleanupTitle(video.title))
		.filter(Boolean)
		.slice(0, 6);
	const query = summary.query;
	const templates = [
		`${query}: 가장 많이 터진 상위 영상들이 반복한 질문 7가지`,
		`${query}: 지금도 풀리지 않은 결정적 장면의 진실`,
		`${query}: 모두가 놓친 첫 번째 단서`,
		`${query}: 전문가들이 끝까지 설명하지 못한 이유`,
	];
	const derived = seeds.flatMap((title) => [
		`${title} 이후 사람들이 가장 궁금해한 3가지`,
		`${title}를 다른 관점에서 다시 보면 보이는 것`,
	]);
	return [...new Set([...derived, ...templates])].slice(0, 10);
}

function cleanupTitle(title: string): string {
	return title
		.replace(/[｜|ㅣ].*$/g, "")
		.replace(/\[[^\]]+\]|\([^)]*\)/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
}

function hookPatternLabel(
	pattern: NicheFormatAnalysis["summary"]["commonHookPattern"],
): string {
	const labels: Record<
		NicheFormatAnalysis["summary"]["commonHookPattern"],
		string
	> = {
		question: "질문형",
		shock: "충격/미스터리형",
		claim: "주장/법칙형",
		story: "스토리형",
		unknown: "검증형",
	};
	return labels[pattern];
}

function buildVideoQualityTargets(
	summary: NicheCandidateSummary,
	format?: NicheFormatAnalysis,
): NicheVideoQualityTarget[] {
	const hookSeconds = format?.summary.medianHookSeconds;
	const firstCutSeconds = format?.summary.medianFirstCutSeconds;
	const cutsFirst10 = format?.summary.medianCutsFirst10 ?? 0;
	const cutsFirst30 = format?.summary.medianCutsFirst30 ?? 0;
	const medianMinutes = Math.max(1, Math.round(summary.medianDurationSeconds / 60));

	return [
		{
			key: "opening",
			label: "초반 훅",
			target:
				hookSeconds !== undefined && hookSeconds !== null
					? `${hookSeconds.toFixed(1)}초 안에 결론/의문/손실을 제시`
					: "첫 5초 안에 결론/의문/손실을 제시",
			rationale: "상위 영상의 초반 이탈 구간을 따라잡기 위한 최소 조건",
		},
		{
			key: "first_cut",
			label: "첫 컷",
			target:
				firstCutSeconds !== undefined && firstCutSeconds !== null
					? `${firstCutSeconds.toFixed(1)}초 전후 첫 화면 전환`
					: "3초 안팎에서 첫 화면 전환",
			rationale: "정적인 도입부를 피하고 시각 리듬을 시작하는 기준",
		},
		{
			key: "cut_density",
			label: "컷 밀도",
			target:
				cutsFirst10 > 0 || cutsFirst30 > 0
					? `첫 10초 ${Math.max(3, cutsFirst10)}컷, 첫 30초 ${Math.max(8, cutsFirst30)}컷 이상`
					: "첫 10초 3컷 이상, 첫 30초 8컷 이상",
			rationale: "잘되는 영상의 앞부분 편집 밀도를 제작 단계에서 강제",
		},
		{
			key: "source_anchor",
			label: "출처 앵커",
			target: "근거형 씬 70% 이상에 출처/자료 카드 표시",
			rationale: "다큐/해설형 콘텐츠가 AI 재사용물처럼 보이지 않게 하는 기준",
		},
		{
			key: "motion_density",
			label: "모션 밀도",
			target: "비주얼 씬 80% 이상에 줌, 패닝, 콜아웃, 모션 그래픽 적용",
			rationale: "이미지 나열 수준을 피하고 실제 영상감으로 끌어올리는 기준",
		},
		{
			key: "premium_floor",
			label: "렌더 승인선",
			target: `제작 QC 78점+, 프리미엄 바닥선 86점+, ${medianMinutes}분 내외 구조 유지`,
			rationale: "아이디어 성과와 별개로 완성도 미달 영상을 렌더 전 차단",
		},
	];
}

function calculateDominantChannelShare(videos: ScoredNicheVideo[]): number {
	if (videos.length === 0) return 0;
	const counts = new Map<string, number>();
	for (const video of videos) {
		counts.set(video.channelId, (counts.get(video.channelId) ?? 0) + 1);
	}
	return Math.max(...counts.values()) / videos.length;
}

function estimateDominantChannelShare(summary: NicheCandidateSummary): number {
	return summary.sampleSize
		? Math.max(0, Math.min(1, 1 / Math.max(1, summary.uniqueChannelCount)))
		: 0;
}

function loadNicheResearchHandoffs(): NicheResearchHandoff[] {
	const value = readJson<unknown>(HANDOFF_STORAGE_KEY, []);
	if (!Array.isArray(value)) return [];
	return value.filter(isNicheResearchHandoff);
}

function normalizeQueriesForCache(queries: string[]) {
	return queries.map((query) => query.trim().toLocaleLowerCase()).sort();
}

function sameQuerySet(a: string[], b: string[]) {
	return a.length === b.length && a.every((query, index) => query === b[index]);
}

function readJson<T>(key: string, fallback: T): T {
	if (typeof localStorage === "undefined") return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
}

function writeJson<T>(key: string, value: T, allowQuotaTrim = true) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (error) {
		if (
			allowQuotaTrim &&
			error instanceof DOMException &&
			error.name === "QuotaExceededError"
		) {
			const snapshots = readJson<NicheResearchSnapshot[]>(
				SNAPSHOT_STORAGE_KEY,
				[],
			);
			writeJson(SNAPSHOT_STORAGE_KEY, snapshots.slice(0, 8), false);
		}
	}
}

function isNicheResearchSnapshot(value: unknown): value is NicheResearchSnapshot {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		isValidDateString(value.createdAt) &&
		isStringArray(value.queries) &&
		isNicheResearchOptions(value.options) &&
		Array.isArray(value.summaries) &&
		value.summaries.every(isNicheCandidateSummary) &&
		isRecord(value.formatAnalyses) &&
		Object.values(value.formatAnalyses).every(isNicheFormatAnalysis)
	);
}

function isNicheResearchHandoff(value: unknown): value is NicheResearchHandoff {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		isValidDateString(value.createdAt) &&
		typeof value.topic === "string" &&
		isNicheCandidateSummary(value.summary) &&
		isNichePlaybook(value.playbook) &&
		(value.formatAnalysis === undefined ||
			isNicheFormatAnalysis(value.formatAnalysis)) &&
		(value.sourceSnapshotId === undefined ||
			typeof value.sourceSnapshotId === "string")
	);
}

function isNicheFormatAnalysis(value: unknown): value is NicheFormatAnalysis {
	if (!isRecord(value) || !isRecord(value.summary)) return false;
	return (
		typeof value.query === "string" &&
		isFiniteNumber(value.sampleSeconds) &&
		isValidDateString(value.analyzedAt) &&
		Array.isArray(value.videos) &&
		(value.summary.medianHookSeconds === null ||
			isFiniteNumber(value.summary.medianHookSeconds)) &&
		(value.summary.medianFirstCutSeconds === null ||
			isFiniteNumber(value.summary.medianFirstCutSeconds)) &&
		isFiniteNumber(value.summary.medianCutsFirst10) &&
		isFiniteNumber(value.summary.medianCutsFirst30) &&
		isFiniteNumber(value.summary.medianTitleOpeningOverlap) &&
		(value.summary.commonHookPattern === "question" ||
			value.summary.commonHookPattern === "shock" ||
			value.summary.commonHookPattern === "claim" ||
			value.summary.commonHookPattern === "story" ||
			value.summary.commonHookPattern === "unknown") &&
		isStringArray(value.summary.rules) &&
		isStringArray(value.summary.warnings)
	);
}

function isNicheResearchOptions(value: unknown): value is NicheResearchOptions {
	if (!isRecord(value)) return false;
	return (
		isFiniteNumber(value.maxResults) &&
		isFiniteNumber(value.daysBack) &&
		(value.order === "viewCount" ||
			value.order === "date" ||
			value.order === "relevance")
	);
}

function isNicheCandidateSummary(
	value: unknown,
): value is NicheCandidateSummary {
	if (!isRecord(value)) return false;
	return (
		typeof value.query === "string" &&
		isFiniteNumber(value.score) &&
		isFiniteNumber(value.sampleSize) &&
		isFiniteNumber(value.uniqueChannelCount) &&
		isFiniteNumber(value.medianViews) &&
		isFiniteNumber(value.medianViewsPerDay) &&
		isFiniteNumber(value.medianDurationSeconds) &&
		isFiniteNumber(value.longformShare) &&
		isFiniteNumber(value.hiddenSubscriberShare) &&
		Array.isArray(value.topVideos) &&
		isStringArray(value.greenFlags) &&
		isStringArray(value.redFlags)
	);
}

function isNichePlaybook(value: unknown): value is NichePlaybook {
	if (!isRecord(value)) return false;
	return (
		typeof value.query === "string" &&
		(value.decision === "scale" ||
			value.decision === "test" ||
			value.decision === "hold") &&
		isFiniteNumber(value.score) &&
		typeof value.headline === "string" &&
		isStringArray(value.rules) &&
		isStringArray(value.openingFormula) &&
		isStringArray(value.productionConstraints) &&
		(value.videoQualityTargets === undefined ||
			(Array.isArray(value.videoQualityTargets) &&
				value.videoQualityTargets.every(isNicheVideoQualityTarget))) &&
		isStringArray(value.pilotPlan) &&
		isStringArray(value.pilotTopics) &&
		typeof value.prompt === "string"
	);
}

function isNicheVideoQualityTarget(
	value: unknown,
): value is NicheVideoQualityTarget {
	if (!isRecord(value)) return false;
	return (
		typeof value.key === "string" &&
		typeof value.label === "string" &&
		typeof value.target === "string" &&
		typeof value.rationale === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isValidDateString(value: unknown): value is string {
	return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function decisionLabelForPrompt(decision: NichePlaybook["decision"]) {
	if (decision === "scale") return "증폭 후보";
	if (decision === "test") return "파일럿 후보";
	return "보류";
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
	return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function logScore(value: number, target: number): number {
	if (value <= 0) return 0;
	return clamp01(Math.log10(value + 1) / Math.log10(target + 1));
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}
