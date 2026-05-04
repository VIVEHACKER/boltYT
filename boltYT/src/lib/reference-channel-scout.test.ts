import { describe, expect, it } from "vitest";
import {
	buildReferenceChannelCandidates,
	buildReferenceTemplateName,
	REFERENCE_CHANNEL_CATEGORIES,
} from "./reference-channel-scout";
import type { NicheResearchVideo } from "./niche-research";

function video(
	overrides: Partial<NicheResearchVideo> & {
		videoId: string;
		channelId: string;
		channelTitle: string;
		viewCount: number;
		durationSeconds: number;
	},
): NicheResearchVideo {
	return {
		videoId: overrides.videoId,
		title: overrides.title ?? "Reference Video",
		description: "",
		thumbnail: "",
		channelId: overrides.channelId,
		channelTitle: overrides.channelTitle,
		publishedAt: overrides.publishedAt ?? "2026-01-01T00:00:00.000Z",
		durationSeconds: overrides.durationSeconds,
		viewCount: overrides.viewCount,
		likeCount: overrides.likeCount ?? Math.round(overrides.viewCount * 0.03),
		commentCount: overrides.commentCount ?? Math.round(overrides.viewCount * 0.002),
		channelSubscriberCount: overrides.channelSubscriberCount ?? 100_000,
		channelVideoCount: overrides.channelVideoCount ?? 200,
		channelViewCount: overrides.channelViewCount ?? 50_000_000,
		hiddenSubscriberCount: overrides.hiddenSubscriberCount ?? false,
	};
}

describe("reference-channel-scout", () => {
	it("채널별로 인기 영상을 묶고 대표 영상을 고른다", () => {
		const category = REFERENCE_CHANNEL_CATEGORIES[0];
		const candidates = buildReferenceChannelCandidates(
			category,
			[
				video({
					videoId: "a1",
					channelId: "channel-a",
					channelTitle: "A Channel",
					viewCount: 800_000,
					durationSeconds: 1200,
				}),
				video({
					videoId: "a2",
					channelId: "channel-a",
					channelTitle: "A Channel",
					viewCount: 500_000,
					durationSeconds: 900,
				}),
				video({
					videoId: "b1",
					channelId: "channel-b",
					channelTitle: "B Channel",
					viewCount: 100_000,
					durationSeconds: 700,
				}),
			],
			5,
		);

		expect(candidates).toHaveLength(2);
		expect(candidates[0].channelTitle).toBe("A Channel");
		expect(candidates[0].representativeUrl).toBe(
			"https://www.youtube.com/watch?v=a1",
		);
		expect(candidates[0].suggestedMode).toBe("longform");
	});

	it("저장용 템플릿 이름에 카테고리와 채널명을 포함한다", () => {
		const category = REFERENCE_CHANNEL_CATEGORIES[1];
		const [candidate] = buildReferenceChannelCandidates(category, [
			video({
				videoId: "m1",
				channelId: "mystery",
				channelTitle: "Mystery Lab",
				title: "풀리지 않는 사건의 모든 것",
				viewCount: 700_000,
				durationSeconds: 900,
			}),
		]);

		expect(buildReferenceTemplateName(candidate)).toContain(
			"미스터리/사건 다큐 · Mystery Lab",
		);
	});

	it("롱폼 카테고리는 쇼츠 전용 채널 후보를 제외한다", () => {
		const category = REFERENCE_CHANNEL_CATEGORIES[0];
		const candidates = buildReferenceChannelCandidates(category, [
			video({
				videoId: "short-only",
				channelId: "shorts",
				channelTitle: "Shorts Only",
				viewCount: 3_000_000,
				durationSeconds: 59,
			}),
			video({
				videoId: "long",
				channelId: "longform",
				channelTitle: "Longform",
				viewCount: 800_000,
				durationSeconds: 1200,
			}),
		]);

		expect(candidates.map((candidate) => candidate.channelTitle)).toEqual([
			"Longform",
		]);
	});

	it("20분 초과 영상은 롱폼 레퍼런스 후보에서 제외한다", () => {
		const category = REFERENCE_CHANNEL_CATEGORIES[0];
		const candidates = buildReferenceChannelCandidates(
			category,
			[
				video({
					videoId: "too-long",
					channelId: "too-long",
					channelTitle: "Too Long",
					viewCount: 5_000_000,
					durationSeconds: 1201,
				}),
				video({
					videoId: "within-cap",
					channelId: "within-cap",
					channelTitle: "Within Cap",
					viewCount: 300_000,
					durationSeconds: 900,
				}),
			],
			5,
			"longform",
		);

		expect(candidates.map((candidate) => candidate.channelTitle)).toEqual([
			"Within Cap",
		]);
	});
});
