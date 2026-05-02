import { describe, expect, it } from "vitest";
import {
	analyzeOpeningRetention,
	strengthenOpeningRetention,
} from "./youtube-retention";

describe("analyzeOpeningRetention", () => {
	it("쇼츠 첫 문장이 설명형이면 critical로 막는다", () => {
		const report = analyzeOpeningRetention({
			title: "한강 실종 사건 핵심만 60초 요약",
			format: "shorts",
			scenes: [
				{
					narration: "오늘은 한강 실종 사건에 대해 알아봅니다.",
					type: "image",
					duration: 3,
				},
				{ narration: "두 번째 장면입니다.", type: "image", duration: 3 },
			],
		});

		expect(report.passed).toBe(false);
		expect(report.issues.some((issue) => issue.code === "generic_intro")).toBe(
			true,
		);
	});

	it("질문 훅과 초반 영상 비중이 있으면 통과한다", () => {
		const report = analyzeOpeningRetention({
			title: "한강 실종 사건 핵심만 60초 요약",
			format: "shorts",
			scenes: [
				{
					narration: "왜 한강 실종 사건은 이 한 장면에서 달라졌을까요?",
					type: "video",
					duration: 2.4,
					shots: [{ media_type: "video", motion: "push_in" }],
				},
				{ narration: "첫 목격 기록입니다.", type: "video", duration: 2.6 },
				{ narration: "수사는 여기서 방향을 바꿉니다.", type: "image", duration: 2.4 },
				{ narration: "남은 의문은 하나입니다.", type: "video", duration: 2.2 },
			],
		});

		expect(report.passed).toBe(true);
		expect(report.firstTenSeconds.hasStrongHook).toBe(true);
		expect(report.firstTenSeconds.videoSeconds).toBeGreaterThanOrEqual(5.5);
	});

	it("롱폼 첫 씬이 너무 길면 경고한다", () => {
		const report = analyzeOpeningRetention({
			title: "사건 타임라인 분석",
			format: "longform",
			scenes: [
				{
					narration: "왜 이 사건은 단순한 실종으로 끝나지 않았을까요?",
					type: "image",
					duration: 24,
					shots: [{ motion: "slow_zoom_in" }],
				},
			],
		});

		expect(report.issues.some((issue) => issue.code === "long_opening_scene")).toBe(
			true,
		);
	});
});

describe("strengthenOpeningRetention", () => {
	it("약한 쇼츠 도입을 질문 훅으로 바꾼다", () => {
		const result = strengthenOpeningRetention(
			[
				{
					narration: "오늘은 사건을 알아봅니다.",
					type: "image",
					duration: 2,
					newsTitle: "마지막 목격",
				},
			],
			{ format: "shorts" },
		);

		expect(result[0].narration).toContain("왜 마지막 목격");
		expect(result[0].narration).not.toContain("오늘은");
	});
});
