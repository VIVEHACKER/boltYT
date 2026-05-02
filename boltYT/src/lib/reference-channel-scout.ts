import {
	fetchNicheResearch,
	formatCompactNumber,
	formatDuration,
	scoreNicheVideo,
	type NicheResearchOptions,
	type NicheResearchVideo,
	type ScoredNicheVideo,
} from "./niche-research";
import type { ReferenceAnalysisMode } from "./reference-import";

export interface ReferenceChannelCategory {
	id: string;
	label: string;
	description: string;
	queries: string[];
	modeHint: ReferenceAnalysisMode;
}

export interface ReferenceChannelScoutOptions {
	maxChannels: number;
	resultsPerQuery: number;
	daysBack: number;
	order: NicheResearchOptions["order"];
	format?: "auto" | "shorts" | "longform";
}

export interface ReferenceChannelCandidate {
	id: string;
	categoryId: string;
	categoryLabel: string;
	channelId: string;
	channelTitle: string;
	channelSubscriberCount: number | null;
	channelVideoCount: number;
	channelViewCount: number;
	hiddenSubscriberCount: boolean;
	score: number;
	videoCount: number;
	totalViews: number;
	avgViewsPerDay: number;
	longformShare: number;
	sourceQueries: string[];
	representativeVideo: ScoredNicheVideo;
	topVideos: ScoredNicheVideo[];
	representativeUrl: string;
	suggestedMode: ReferenceAnalysisMode;
}

export const REFERENCE_CHANNEL_CATEGORIES: ReferenceChannelCategory[] = [
	{
		id: "drama_recap",
		label: "드라마/영화 몰아보기",
		description: "결말포함, 정주행, 작품 해설형 롱폼 채널",
		queries: ["드라마 몰아보기", "영화 결말포함", "디즈니플러스 드라마 리뷰"],
		modeHint: "longform",
	},
	{
		id: "mystery_doc",
		label: "미스터리/사건 다큐",
		description: "사건, 역사, 미스터리 해설 채널",
		queries: ["미스터리 역사 다큐", "미제사건 다큐", "사건 타임라인 분석"],
		modeHint: "longform",
	},
	{
		id: "news_issue",
		label: "뉴스/이슈 해설",
		description: "현안, 사회 이슈, 자료 기반 분석 채널",
		queries: ["뉴스 이슈 해설", "사회 이슈 분석", "경제 뉴스 해설"],
		modeHint: "auto",
	},
	{
		id: "automation_business",
		label: "AI/비즈니스 자동화",
		description: "AI 도구, 자동화, 수익화 실험 채널",
		queries: ["AI 비즈니스 자동화", "AI 수익화 자동화", "업무 자동화 노코드"],
		modeHint: "auto",
	},
	{
		id: "money_psychology",
		label: "돈/심리/자기계발",
		description: "부자 심리, 경제 습관, 성장 서사 채널",
		queries: ["부자 심리 돈 공부", "자기계발 돈 버는 법", "성공 습관 심리"],
		modeHint: "auto",
	},
];

const DEFAULT_OPTIONS: ReferenceChannelScoutOptions = {
	maxChannels: 6,
	resultsPerQuery: 10,
	daysBack: 730,
	order: "viewCount",
};

export async function fetchReferenceChannelCandidates(
	category: ReferenceChannelCategory,
	options: Partial<ReferenceChannelScoutOptions> = {},
): Promise<ReferenceChannelCandidate[]> {
	const merged = { ...DEFAULT_OPTIONS, ...options };
	const videos: Array<ScoredNicheVideo & { sourceQuery: string }> = [];
	const now = new Date();
	const queries = buildFormatQueries(category, merged.format ?? "auto");

	for (const query of queries) {
		const result = await fetchNicheResearch(query, {
			maxResults: merged.resultsPerQuery,
			daysBack: merged.daysBack,
			order: merged.order,
		});
		videos.push(
			...result.videos.map((video) => ({
				...scoreNicheVideo(video, now),
				sourceQuery: query,
			})),
		);
		}

	return buildReferenceChannelCandidates(
		category,
		videos,
		merged.maxChannels,
		merged.format ?? "auto",
	);
}

export function buildReferenceChannelCandidates(
	category: ReferenceChannelCategory,
	videos: Array<NicheResearchVideo | (ScoredNicheVideo & { sourceQuery?: string })>,
	maxChannels = DEFAULT_OPTIONS.maxChannels,
	format: ReferenceChannelScoutOptions["format"] = "auto",
): ReferenceChannelCandidate[] {
	const scoredVideos = videos
		.map((video) => {
			const scored =
				"scoreParts" in video ? video : scoreNicheVideo(video as NicheResearchVideo);
			return {
				...scored,
				sourceQuery:
					"sourceQuery" in video && typeof video.sourceQuery === "string"
						? video.sourceQuery
					: category.queries[0],
			};
		})
		.filter((video) => matchesReferenceFormat(video.durationSeconds, format))
		.filter((video) => video.channelId && video.videoId);

	const groups = new Map<string, typeof scoredVideos>();
	for (const video of scoredVideos) {
		const list = groups.get(video.channelId) ?? [];
		list.push(video);
		groups.set(video.channelId, list);
	}

	return [...groups.entries()]
		.map(([channelId, group]) => buildCandidate(category, channelId, group, format))
		.filter((candidate) =>
			format === "longform" || (format === "auto" && category.modeHint === "longform")
				? candidate.representativeVideo.durationSeconds >= 8 * 60
				: true,
		)
		.sort((a, b) => scoreForFormat(b, format) - scoreForFormat(a, format))
		.slice(0, maxChannels);
}

export function buildReferenceTemplateName(
	candidate: ReferenceChannelCandidate,
): string {
	const title = candidate.representativeVideo.title
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 42);
	return `${candidate.categoryLabel} · ${candidate.channelTitle}${title ? ` · ${title}` : ""}`;
}

export function formatCandidateMetric(candidate: ReferenceChannelCandidate): string {
	return [
		`점수 ${candidate.score}`,
		`대표 조회 ${formatCompactNumber(candidate.representativeVideo.viewCount)}`,
		`일평균 ${formatCompactNumber(candidate.avgViewsPerDay)}`,
		`길이 ${formatDuration(candidate.representativeVideo.durationSeconds)}`,
	].join(" · ");
}

function buildCandidate(
	category: ReferenceChannelCategory,
	channelId: string,
	group: Array<ScoredNicheVideo & { sourceQuery: string }>,
	format: ReferenceChannelScoutOptions["format"] = "auto",
): ReferenceChannelCandidate {
	const sorted = [...group].sort((a, b) => b.score - a.score);
	const topVideos = sorted.slice(0, 4);
	const representativeVideo =
		pickRepresentativeVideo(category, sorted, format) ?? sorted[0];
	const totalViews = group.reduce((sum, video) => sum + video.viewCount, 0);
	const avgViewsPerDay =
		group.reduce((sum, video) => sum + video.viewsPerDay, 0) / group.length;
	const longformShare =
		group.filter((video) => video.durationSeconds >= 8 * 60).length /
		group.length;
	const avgScore =
		topVideos.reduce((sum, video) => sum + video.score, 0) / topVideos.length;
	const score = Math.round(
		Math.min(
			100,
			representativeVideo.score * 0.52 +
				avgScore * 0.28 +
				Math.min(12, Math.log10(totalViews + 1) * 2) +
				longformShare * 8,
		),
	);

	return {
		id: `${category.id}:${channelId}`,
		categoryId: category.id,
		categoryLabel: category.label,
		channelId,
		channelTitle: representativeVideo.channelTitle,
		channelSubscriberCount: representativeVideo.channelSubscriberCount,
		channelVideoCount: representativeVideo.channelVideoCount,
		channelViewCount: representativeVideo.channelViewCount,
		hiddenSubscriberCount: representativeVideo.hiddenSubscriberCount,
		score,
		videoCount: group.length,
		totalViews,
		avgViewsPerDay,
		longformShare,
		sourceQueries: [...new Set(group.map((video) => video.sourceQuery))],
		representativeVideo,
		topVideos,
		representativeUrl: `https://www.youtube.com/watch?v=${representativeVideo.videoId}`,
		suggestedMode: suggestedMode(category, representativeVideo, format),
	};
}

function pickRepresentativeVideo(
	category: ReferenceChannelCategory,
	videos: ScoredNicheVideo[],
	format: ReferenceChannelScoutOptions["format"] = "auto",
): ScoredNicheVideo | undefined {
	if (format === "shorts") {
		return videos
			.filter((video) => video.durationSeconds <= 180)
			.sort((a, b) => shortformScore(b) - shortformScore(a))[0];
	}
	const longformPreferred =
		format === "longform" || (format === "auto" && category.modeHint === "longform")
			? videos.filter((video) => video.durationSeconds >= 8 * 60)
			: [];
	return (longformPreferred.length > 0 ? longformPreferred : videos).sort(
		(a, b) => b.score - a.score || b.viewCount - a.viewCount,
	)[0];
}

function suggestedMode(
	category: ReferenceChannelCategory,
	video: ScoredNicheVideo,
	format: ReferenceChannelScoutOptions["format"] = "auto",
): ReferenceAnalysisMode {
	if (format === "shorts") return "shortform";
	if (format === "longform") return "longform";
	if (video.durationSeconds <= 180) return "shortform";
	if (category.modeHint === "longform") return "longform";
	if (category.modeHint === "shortform") return "shortform";
	return video.durationSeconds > 180 ? "longform" : "shortform";
}

function buildFormatQueries(
	category: ReferenceChannelCategory,
	format: ReferenceChannelScoutOptions["format"],
): string[] {
	if (format === "shorts") {
		return [
			...category.queries.map((query) => `${query} 쇼츠`),
			...category.queries.map((query) => `${query} shorts`),
			...category.queries.map((query) => `${query} #shorts`),
		];
	}
	if (format === "longform") {
		return [
			...category.queries,
			...category.queries.map((query) => `${query} 롱폼`),
			...category.queries.map((query) => `${query} 몰아보기`),
		];
	}
	return category.queries;
}

function matchesReferenceFormat(
	durationSeconds: number,
	format: ReferenceChannelScoutOptions["format"],
) {
	if (format === "shorts") return durationSeconds > 0 && durationSeconds <= 180;
	if (format === "longform") return durationSeconds >= 8 * 60;
	return true;
}

function scoreForFormat(
	candidate: ReferenceChannelCandidate,
	format: ReferenceChannelScoutOptions["format"],
) {
	if (format !== "shorts") return candidate.score;
	return shortformScore(candidate.representativeVideo);
}

function shortformScore(video: ScoredNicheVideo) {
	const durationFit =
		video.durationSeconds <= 75
			? 1
			: video.durationSeconds <= 120
				? 0.82
				: 0.58;
	return Math.round(
		(video.scoreParts.velocity * 0.44 +
			video.scoreParts.leverage * 0.18 +
			video.scoreParts.engagement * 0.22 +
			video.scoreParts.freshness * 0.1 +
			durationFit * 0.06) *
			100,
	);
}
