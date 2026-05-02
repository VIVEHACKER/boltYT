import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	analyzeNicheResearch,
	assessNicheAnalysisQuality,
	buildNichePlaybook,
	findRecentNicheResearchSnapshot,
	formatNicheHandoffForPrompt,
	formatDuration,
	loadNicheResearchHandoff,
	loadNicheResearchHistory,
	persistNicheResearchHandoff,
	persistNicheResearchSnapshot,
	scoreNicheVideo,
	type NicheResearchResult,
	type NicheResearchVideo,
} from "./niche-research";

const NOW = new Date("2026-05-02T00:00:00.000Z");

function video(overrides: Partial<NicheResearchVideo>): NicheResearchVideo {
	return {
		videoId: "vid",
		title: "테스트 영상",
		description: "",
		thumbnail: "",
		channelId: "channel",
		channelTitle: "테스트 채널",
		publishedAt: "2026-04-02T00:00:00.000Z",
		durationSeconds: 900,
		viewCount: 300_000,
		likeCount: 9_000,
		commentCount: 600,
		channelSubscriberCount: 30_000,
		channelVideoCount: 80,
		channelViewCount: 9_000_000,
		hiddenSubscriberCount: false,
		...overrides,
	};
}

describe("niche-research", () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => store.set(key, value),
			removeItem: (key: string) => store.delete(key),
			clear: () => store.clear(),
		});
	});

	it("조회 속도, 구독자 대비 조회수, 롱폼 여부를 반영해 영상 점수를 계산한다", () => {
		const strong = scoreNicheVideo(video({}), NOW);
		const weak = scoreNicheVideo(
			video({
				publishedAt: "2025-05-02T00:00:00.000Z",
				durationSeconds: 80,
				viewCount: 8_000,
				likeCount: 50,
				commentCount: 2,
				channelSubscriberCount: 200_000,
			}),
			NOW,
		);

		expect(strong.score).toBeGreaterThan(weak.score);
		expect(strong.viewsPerDay).toBeGreaterThan(9_000);
		expect(strong.viewSubscriberRatio).toBe(10);
	});

	it("니치 단위 요약과 리스크 플래그를 만든다", () => {
		const result: NicheResearchResult = {
			query: "미스터리 역사 다큐",
			fetchedAt: NOW.toISOString(),
			order: "viewCount",
			daysBack: 365,
			videos: [
				video({ videoId: "a", channelId: "a" }),
				video({ videoId: "b", channelId: "b", viewCount: 250_000 }),
				video({ videoId: "c", channelId: "c", viewCount: 180_000 }),
				video({ videoId: "d", channelId: "d", viewCount: 150_000 }),
				video({ videoId: "e", channelId: "e", viewCount: 120_000 }),
				video({ videoId: "f", channelId: "f", viewCount: 90_000 }),
			],
		};

		const summary = analyzeNicheResearch(result, NOW);

		expect(summary.score).toBeGreaterThan(60);
		expect(summary.uniqueChannelCount).toBe(6);
		expect(summary.longformShare).toBe(1);
		expect(summary.greenFlags).toContain("롱폼 반복 제작에 적합");
		expect(summary.redFlags).not.toContain("표본이 적어 판단 보류");
	});

	it("duration을 UI 표시용 문자열로 변환한다", () => {
		expect(formatDuration(75)).toBe("1:15");
		expect(formatDuration(3_725)).toBe("1:02:05");
	});

	it("분석 결과를 제작 플레이북으로 변환한다", () => {
		const summary = analyzeNicheResearch(
			{
				query: "미스터리 역사 다큐",
				fetchedAt: NOW.toISOString(),
				order: "viewCount",
				daysBack: 365,
				videos: [
					video({ videoId: "a", channelId: "a" }),
					video({ videoId: "b", channelId: "b", viewCount: 250_000 }),
					video({ videoId: "c", channelId: "c", viewCount: 180_000 }),
					video({ videoId: "d", channelId: "d", viewCount: 150_000 }),
					video({ videoId: "e", channelId: "e", viewCount: 120_000 }),
				],
			},
			NOW,
		);

		const playbook = buildNichePlaybook(summary);

		expect(playbook.query).toBe("미스터리 역사 다큐");
		expect(playbook.rules.length).toBeGreaterThan(3);
		expect(playbook.analysisQuality?.score).toBeGreaterThan(50);
		expect(playbook.videoQualityTargets?.length).toBeGreaterThan(3);
		expect(playbook.prompt).toContain("첫 15초 대본");
		expect(playbook.prompt).toContain("영상 QC 목표");
	});

	it("표본 편향과 포맷 미분석 상태를 분석 신뢰도에 반영한다", () => {
		const weak = analyzeNicheResearch(
			{
				query: "좁은 니치",
				fetchedAt: NOW.toISOString(),
				order: "viewCount",
				daysBack: 365,
				videos: [
					video({ videoId: "a", channelId: "same", durationSeconds: 60 }),
					video({ videoId: "b", channelId: "same", durationSeconds: 70 }),
					video({ videoId: "c", channelId: "same", durationSeconds: 80 }),
				],
			},
			NOW,
		);
		const strong = analyzeNicheResearch(
			{
				query: "넓은 니치",
				fetchedAt: NOW.toISOString(),
				order: "viewCount",
				daysBack: 365,
				videos: Array.from({ length: 12 }, (_, index) =>
					video({
						videoId: `v${index}`,
						channelId: `c${index}`,
						durationSeconds: 900,
					}),
				),
			},
			NOW,
		);

		const weakQuality = assessNicheAnalysisQuality(weak);
		const strongQuality = assessNicheAnalysisQuality(strong);

		expect(strongQuality.score).toBeGreaterThan(weakQuality.score);
		expect(weakQuality.warnings).toContain("상위 결과가 한 채널에 치우침");
		expect(weakQuality.warnings).toContain("포맷 법칙 분석 전이라 훅/컷 근거가 약함");
	});

	it("분석 스냅샷을 저장하고 같은 조건의 최근 캐시를 찾는다", () => {
		const summary = analyzeNicheResearch(
			{
				query: "미스터리 역사 다큐",
				fetchedAt: NOW.toISOString(),
				order: "viewCount",
				daysBack: 365,
				videos: [video({ videoId: "a", channelId: "a" })],
			},
			NOW,
		);
		const options = { maxResults: 5, daysBack: 365, order: "viewCount" as const };

		const snapshot = persistNicheResearchSnapshot({
			createdAt: NOW.toISOString(),
			queries: ["미스터리 역사 다큐"],
			options,
			summaries: [summary],
			formatAnalyses: {},
		});

		expect(loadNicheResearchHistory()[0]?.id).toBe(snapshot.id);
		expect(
			findRecentNicheResearchSnapshot(["미스터리 역사 다큐"], options, NOW)?.id,
		).toBe(snapshot.id);
	});

	it("오래된 캐시는 재사용하지 않는다", () => {
		const summary = analyzeNicheResearch(
			{
				query: "미스터리 역사 다큐",
				fetchedAt: NOW.toISOString(),
				order: "viewCount",
				daysBack: 365,
				videos: [video({ videoId: "a", channelId: "a" })],
			},
			NOW,
		);
		const options = { maxResults: 5, daysBack: 365, order: "viewCount" as const };
		persistNicheResearchSnapshot({
			createdAt: new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString(),
			queries: ["미스터리 역사 다큐"],
			options,
			summaries: [summary],
			formatAnalyses: {},
		});

		expect(
			findRecentNicheResearchSnapshot(["미스터리 역사 다큐"], options, NOW),
		).toBeNull();
	});

	it("깨진 저장 데이터는 히스토리와 핸드오프에서 제외한다", () => {
		localStorage.setItem(
			"niche-research:snapshots:v1",
			JSON.stringify([
				{ id: "broken", createdAt: "not-a-date", queries: ["x"] },
			]),
		);
		localStorage.setItem(
			"niche-research:handoffs:v1",
			JSON.stringify([{ id: "broken", createdAt: "not-a-date" }]),
		);

		expect(loadNicheResearchHistory()).toEqual([]);
		expect(loadNicheResearchHandoff("broken")).toBeNull();
	});

	it("파일럿 주제 핸드오프를 제작 프롬프트 컨텍스트로 직렬화한다", () => {
		const summary = analyzeNicheResearch(
			{
				query: "AI 비즈니스 자동화",
				fetchedAt: NOW.toISOString(),
				order: "viewCount",
				daysBack: 365,
				videos: [
					video({
						videoId: "ai",
						title: "AI 자동화로 시간을 줄이는 법",
						channelId: "ai",
					}),
					video({ videoId: "biz", channelId: "biz" }),
					video({ videoId: "auto", channelId: "auto" }),
				],
			},
			NOW,
		);
		const playbook = buildNichePlaybook(summary);
		const handoff = persistNicheResearchHandoff({
			topic: playbook.pilotTopics[0] ?? "AI 자동화 파일럿",
			summary,
			playbook,
		});

		const promptContext = formatNicheHandoffForPrompt(handoff);

		expect(promptContext).toContain("선택 주제:");
		expect(promptContext).toContain("분석 신뢰도:");
		expect(promptContext).toContain("핵심 규칙:");
		expect(promptContext).toContain("오프닝 공식:");
		expect(promptContext).toContain("영상 QC 목표:");
	});
});
