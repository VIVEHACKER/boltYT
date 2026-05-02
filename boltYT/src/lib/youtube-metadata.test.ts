import { describe, expect, it } from "vitest";
import { buildYouTubeMetadata } from "./youtube-metadata";

describe("buildYouTubeMetadata", () => {
	const scenes = Array.from({ length: 8 }, (_, index) => ({
		narration_text: `실종 사건의 수사 흐름과 핵심 단서를 정리합니다 ${index + 1}`,
		scene_type: index % 3 === 0 ? "video" : "image",
		duration_seconds: 50,
		news_title:
			index === 0
				? "실종 당일 마지막 목격"
				: index === 4
					? "수사 방향 전환"
					: `사건 전개 ${index + 1}`,
		news_source: index % 2 === 0 ? "뉴스A" : "뉴스B",
	}));

	it("롱폼 제목/설명/챕터/태그를 검색 친화적으로 만든다", () => {
		const metadata = buildYouTubeMetadata({
			topicTitle: "한강 실종 사건",
			format: "longform",
			scenes,
		});

		expect(metadata.title).toContain("한강 실종 사건");
		expect(metadata.title.length).toBeLessThanOrEqual(96);
		expect(metadata.description).toContain("핵심 키워드");
		expect(metadata.description).toContain("챕터");
		expect(metadata.chapters[0]).toMatch(/^0:00 /);
		expect(metadata.tags.length).toBeGreaterThan(3);
		expect(metadata.tags.length).toBeLessThanOrEqual(14);
		expect(metadata.hashtags.length).toBeLessThanOrEqual(3);
		expect(metadata.thumbnail.title.length).toBeLessThanOrEqual(18);
		expect(metadata.thumbnail.subtitle).toBeTruthy();
	});

	it("쇼츠는 #shorts를 넣고 챕터를 만들지 않는다", () => {
		const metadata = buildYouTubeMetadata({
			topicTitle: "미스터리 사건",
			format: "shorts",
			scenes,
		});

		expect(metadata.title).toContain("60초");
		expect(metadata.hashtags).toContain("#shorts");
		expect(metadata.chapters).toEqual([]);
		expect(metadata.thumbnail.subtitle).toBe("핵심 60초");
	});

	it("AI 재구성 샷이 있으면 설명에 고지 문구를 넣는다", () => {
		const metadata = buildYouTubeMetadata({
			topicTitle: "사건 재구성",
			format: "longform",
			scenes: [
				{
					narration_text: "당시 상황을 재구성합니다.",
					scene_type: "image",
					duration_seconds: 30,
					shots: [{ id: "s1", kind: "context", duration_seconds: 3, media_type: "image", visual_role: "reconstruction" }],
				},
			],
		});

		expect(metadata.description).toContain("AI 재구성");
	});
});
