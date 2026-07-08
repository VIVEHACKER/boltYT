import { describe, expect, it } from "vitest";
import {
	adaptYouTubeMetadata,
	buildPlatformMeta,
	formatChapterTimestamp,
	type PlatformMetaInput,
	parseChapterLine,
} from "./platform-meta.ts";
import {
	buildYouTubeMetadata,
	type YouTubeMetadataInput,
} from "./youtube-metadata.ts";

function baseInput(
	overrides: Partial<PlatformMetaInput> = {},
): PlatformMetaInput {
	return {
		title: "미국 금리 인하가 한국 부동산에 미치는 영향",
		description: "연준의 금리 결정 이후 시장 흐름을 정리했습니다.",
		tags: ["금리", "부동산", "연준"],
		hashtags: ["#금리", "경제뉴스"],
		isShorts: false,
		...overrides,
	};
}

describe("buildPlatformMeta — 길이 컷", () => {
	it("틱톡 제목은 100자로 자른다", () => {
		const longTitle = "가".repeat(140);
		const result = buildPlatformMeta(baseInput({ title: longTitle }));
		expect(result.tiktok.title.length).toBeLessThanOrEqual(100);
		expect(result.youtube.title.length).toBeLessThanOrEqual(100);
	});

	it("틱톡/릴스 캡션은 2200자로 자른다", () => {
		const longBody = "경제 해설 문장입니다. ".repeat(300); // 약 3900자
		const result = buildPlatformMeta(baseInput({ description: longBody }));
		expect(result.tiktok.description.length).toBeLessThanOrEqual(2200);
		expect(result.reels.description.length).toBeLessThanOrEqual(2200);
		// 유튜브는 5000자 한도라 본문이 더 길게 살아남는다
		expect(result.youtube.description.length).toBeGreaterThan(
			result.tiktok.description.length,
		);
	});
});

describe("buildPlatformMeta — 해시태그 상한", () => {
	it("플랫폼별 해시태그 상한을 지키고 # 접두어를 통일한다", () => {
		const hashtags = Array.from({ length: 20 }, (_, i) => `태그${i}`);
		const result = buildPlatformMeta(baseInput({ hashtags }));
		expect(result.tiktok.hashtags).toHaveLength(5);
		expect(result.reels.hashtags).toHaveLength(8);
		expect(result.naver_clip.hashtags).toHaveLength(10);
		expect(result.youtube.hashtags).toHaveLength(15);
		for (const tag of result.tiktok.hashtags) {
			expect(tag).toMatch(/^#[^#\s]+$/);
		}
	});

	it("중복 해시태그(# 유무 차이 포함)를 제거한다", () => {
		const result = buildPlatformMeta(
			baseInput({ hashtags: ["#금리", "금리", "#부동산"] }),
		);
		expect(result.youtube.hashtags).toEqual(["#금리", "#부동산"]);
	});
});

describe("buildPlatformMeta — 네이버클립 한글 태그 우선", () => {
	it("한글 태그가 앞, 비한글 태그가 뒤로 정렬된다(상대 순서 유지)", () => {
		const result = buildPlatformMeta(
			baseInput({
				tags: ["bitcoin", "비트코인", "fed", "금리"],
				hashtags: ["fomc", "연준", "rate", "부동산"],
			}),
		);
		expect(result.naver_clip.tags).toEqual([
			"비트코인",
			"금리",
			"bitcoin",
			"fed",
		]);
		expect(result.naver_clip.hashtags).toEqual([
			"#연준",
			"#부동산",
			"#fomc",
			"#rate",
		]);
		// 다른 플랫폼은 원본 순서 유지
		expect(result.youtube.tags).toEqual(["bitcoin", "비트코인", "fed", "금리"]);
	});
});

describe("buildPlatformMeta — YMYL 안전레인 전파", () => {
	const disclosure =
		"본 영상은 투자 자문이 아니며 정보 제공 목적입니다. 투자 판단의 책임은 본인에게 있습니다.";
	const sourceList = ["한국은행 금융통화위원회 의사록", "연합뉴스 2026-07-01"];

	it("출처와 면책이 4개 플랫폼 모두에 포함된다", () => {
		const result = buildPlatformMeta(baseInput({ sourceList, disclosure }));
		for (const meta of [
			result.youtube,
			result.tiktok,
			result.reels,
			result.naver_clip,
		]) {
			expect(meta.description).toContain(disclosure);
			expect(meta.description).toContain("참고/출처");
			expect(meta.description).toContain("- 한국은행 금융통화위원회 의사록");
		}
	});

	it("캡션이 잘려도 면책이 우선 생존한다(본문이 먼저 희생)", () => {
		const longBody = "장문의 경제 해설. ".repeat(500); // 2200자 훌쩍 초과
		const result = buildPlatformMeta(
			baseInput({ description: longBody, sourceList, disclosure }),
		);
		expect(result.tiktok.description.length).toBeLessThanOrEqual(2200);
		expect(result.tiktok.description).toContain(disclosure);
		expect(result.tiktok.description.endsWith(disclosure)).toBe(true);
		// 출처는 면책 다음 순위로 생존
		expect(result.tiktok.description).toContain("참고/출처");
	});
});

describe("buildPlatformMeta — 챕터 타임스탬프", () => {
	const chapters = [
		{ sec: 0, label: "도입" },
		{ sec: 75, label: "전개" },
		{ sec: 3661, label: "결론" },
	];

	it("유튜브 설명에 M:SS / H:MM:SS 포맷으로 붙는다", () => {
		const result = buildPlatformMeta(baseInput({ chapters }));
		expect(result.youtube.description).toContain("챕터");
		expect(result.youtube.description).toContain("0:00 도입");
		expect(result.youtube.description).toContain("1:15 전개");
		expect(result.youtube.description).toContain("1:01:01 결론");
	});

	it("첫 챕터가 0초가 아니면 0:00으로 보정한다(유튜브 규칙)", () => {
		const result = buildPlatformMeta(
			baseInput({
				chapters: [
					{ sec: 90, label: "본론" },
					{ sec: 5, label: "인트로" },
				],
			}),
		);
		// 정렬 후 첫 챕터(인트로, 5초)가 0:00으로 강제된다
		expect(result.youtube.description).toContain("0:00 인트로");
		expect(result.youtube.description).toContain("1:30 본론");
	});

	it("챕터는 유튜브 롱폼에만 붙는다 (쇼츠/타 플랫폼 제외)", () => {
		const longform = buildPlatformMeta(baseInput({ chapters }));
		expect(longform.tiktok.description).not.toContain("0:00 도입");
		expect(longform.reels.description).not.toContain("0:00 도입");
		expect(longform.naver_clip.description).not.toContain("0:00 도입");

		const shorts = buildPlatformMeta(baseInput({ chapters, isShorts: true }));
		expect(shorts.youtube.description).not.toContain("0:00 도입");
	});

	it("formatChapterTimestamp 포맷 규칙", () => {
		expect(formatChapterTimestamp(0)).toBe("0:00");
		expect(formatChapterTimestamp(75)).toBe("1:15");
		expect(formatChapterTimestamp(600)).toBe("10:00");
		expect(formatChapterTimestamp(3661)).toBe("1:01:01");
		expect(formatChapterTimestamp(-3)).toBe("0:00");
	});
});

describe("parseChapterLine", () => {
	it("M:SS / H:MM:SS 라인을 파싱한다", () => {
		expect(parseChapterLine("1:15 전개")).toEqual({ sec: 75, label: "전개" });
		expect(parseChapterLine("1:01:01 결론")).toEqual({
			sec: 3661,
			label: "결론",
		});
		expect(parseChapterLine("0:00 도입")).toEqual({ sec: 0, label: "도입" });
	});

	it("타임스탬프가 없는 라인은 null", () => {
		expect(parseChapterLine("그냥 텍스트")).toBeNull();
		expect(parseChapterLine("")).toBeNull();
	});
});

describe("adaptYouTubeMetadata — 실출력 필드 매핑", () => {
	// buildYouTubeMetadata 실호출로 필드 불일치를 실물 검증한다
	const longformInput: YouTubeMetadataInput = {
		topicTitle: "환율 급등 사태",
		channelName: "경제읽음이",
		format: "longform",
		scenes: Array.from({ length: 6 }, (_, i) => ({
			narration_text: `환율 급등의 ${i + 1}번째 국면을 짚어봅니다. 외환 시장과 수출 기업의 반응을 정리합니다.`,
			duration_seconds: 40,
			news_source: i < 2 ? "한국은행 보도자료" : undefined,
		})),
	};

	it("tags/hashtags 가 비지 않게 매핑된다", () => {
		const meta = buildYouTubeMetadata(longformInput);
		const adapted = adaptYouTubeMetadata(meta, { isShorts: false });
		expect(adapted.tags.length).toBeGreaterThan(0);
		expect(adapted.title).toBe(meta.title);
		expect(adapted.hashtags).toEqual(meta.hashtags);
	});

	it("chapters 문자열이 {sec,label} 로 파싱된다", () => {
		const meta = buildYouTubeMetadata(longformInput);
		expect(meta.chapters.length).toBeGreaterThan(0);
		const adapted = adaptYouTubeMetadata(meta, { isShorts: false });
		expect(adapted.chapters?.length).toBe(meta.chapters.length);
		expect(adapted.chapters?.[0]?.sec).toBe(0);
		expect(typeof adapted.chapters?.[0]?.label).toBe("string");
	});

	it("description 의 챕터/출처/해시태그 블록을 벗겨 중복 부착을 막는다", () => {
		const meta = buildYouTubeMetadata(longformInput);
		const adapted = adaptYouTubeMetadata(meta, { isShorts: false });
		expect(adapted.description).not.toContain("챕터\n");
		expect(adapted.description).not.toContain("참고/출처");
		const rebuilt = buildPlatformMeta(adapted);
		const occurrences = rebuilt.youtube.description.split("챕터\n").length - 1;
		expect(occurrences).toBe(1);
	});

	it("tags 가 빈 배열이면 hashtags → title 순으로 폴백한다", () => {
		const meta = buildYouTubeMetadata(longformInput);
		const noTags = adaptYouTubeMetadata(
			{ ...meta, tags: [] },
			{ isShorts: false },
		);
		expect(noTags.tags.length).toBeGreaterThan(0);
		expect(noTags.tags.every((tag) => !tag.startsWith("#"))).toBe(true);

		const bare = adaptYouTubeMetadata(
			{ ...meta, tags: [], hashtags: [] },
			{ isShorts: false },
		);
		expect(bare.tags).toEqual([meta.title]);
	});
});
