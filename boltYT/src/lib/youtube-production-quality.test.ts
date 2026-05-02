import { describe, expect, it } from "vitest";
import { analyzeProductionQuality } from "./youtube-production-quality";

function timedWords(text: string) {
	return text.split(/\s+/).map((word, index) => ({
		word,
		startFrame: index * 8,
		endFrame: index * 8 + 7,
	}));
}

describe("analyzeProductionQuality", () => {
	it("BGM, TTS, 영상 컷, 썸네일, 엔딩이 갖춰진 쇼츠는 통과한다", () => {
		const scenes = [
			{
				narration_text: "왜 한강 실종 사건은 이 한 장면에서 달라졌을까요?",
				scene_type: "video",
				duration_seconds: 5,
				videoUrl: "blob:video-1",
				audioUrl: "blob:audio-1",
				wordTimings: timedWords("왜 한강 실종 사건은 이 한 장면에서 달라졌을까요"),
				shots: [
					{
						media_type: "video" as const,
						source_url: "https://youtube.com/watch?v=abc",
						selection_provider: "youtube",
						visual_role: "archive",
						motion: "push_in",
						source_confidence: 91,
					},
					{
						media_type: "image" as const,
						source_url: "https://example.com/opening-document.jpg",
						selection_provider: "direct",
						visual_role: "document",
						motion: "pan_left",
						source_confidence: 89,
						sfx_cue: { category: "reveal", intensity: 0.52 },
					},
				],
			},
			{
				narration_text: "첫 목격 기록은 수사의 방향을 바꿨습니다.",
				scene_type: "video",
				duration_seconds: 5,
				videoUrl: "blob:video-2",
				audioUrl: "blob:audio-2",
				wordTimings: timedWords("첫 목격 기록은 수사의 방향을 바꿨습니다"),
				shots: [
					{
						media_type: "video" as const,
						source_url: "https://commons.wikimedia.org/file",
						selection_provider: "wikimedia",
						visual_role: "archive",
						motion: "slow_zoom_in",
						source_confidence: 88,
					},
				],
			},
			{
				narration_text: "지도와 문서 기록은 시간 순서를 다시 보여줍니다.",
				scene_type: "image",
				duration_seconds: 5,
				imageUrl: "blob:image-1",
				audioUrl: "blob:audio-3",
				wordTimings: timedWords("지도와 문서 기록은 시간 순서를 다시 보여줍니다"),
				shots: [
					{
						media_type: "image" as const,
						source_url: "https://example.com/document.jpg",
						selection_provider: "direct",
						visual_role: "document",
						motion: "pan_left",
						source_confidence: 86,
					},
				],
			},
			{
				narration_text: "현재까지 확인된 것은 마지막 동선 하나가 핵심이라는 점입니다.",
				scene_type: "video",
				duration_seconds: 5,
				videoUrl: "blob:video-3",
				audioUrl: "blob:audio-4",
				wordTimings: timedWords("현재까지 확인된 것은 마지막 동선 하나가 핵심이라는 점입니다"),
				shots: [
					{
						media_type: "video" as const,
						source_url: "https://youtube.com/watch?v=def",
						selection_provider: "youtube",
						visual_role: "evidence",
						motion: "push_in",
						source_confidence: 93,
					},
				],
			},
		];

		const report = analyzeProductionQuality({
			title: "한강 실종 사건 핵심만 60초 요약",
			description: "확인된 자료 기준으로 정리합니다.",
			format: "shorts",
			scenes,
			narrationUrl: "blob:narration",
			bgmUrl: "blob:bgm",
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(true);
		expect(report.metrics.hasBgm).toBe(true);
		expect(report.metrics.videoSceneRatio).toBeGreaterThanOrEqual(0.45);
		expect(report.metrics.hasEndingCue).toBe(true);
	});

	it("BGM과 나레이션이 없으면 승인 차단 이슈로 보고한다", () => {
		const report = analyzeProductionQuality({
			title: "사건 타임라인",
			format: "shorts",
			scenes: [
				{
					narration_text: "왜 사건의 흐름은 여기서 달라졌을까요?",
					scene_type: "video",
					duration_seconds: 5,
					videoUrl: "blob:video",
					shots: [
						{
							media_type: "video" as const,
							source_url: "https://youtube.com/watch?v=abc",
							selection_provider: "youtube",
							visual_role: "archive",
							motion: "push_in",
						},
					],
				},
			],
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(false);
		expect(report.issues.some((issue) => issue.code === "missing_bgm")).toBe(
			true,
		);
		expect(
			report.issues.some((issue) => issue.code === "missing_narration"),
		).toBe(true);
	});

	it("영상 컷이 없어도 모션 설계된 자료화면이면 통과한다", () => {
		const report = analyzeProductionQuality({
			title: "한강 실종 사건 핵심만 60초 요약",
			format: "shorts",
			scenes: Array.from({ length: 4 }, (_, index) => ({
				narration_text:
					index === 0
						? "왜 한강 실종 사건은 여기서 방향이 바뀌었을까요?"
						: index === 3
							? "현재까지 확인된 것은 시간 순서가 핵심이라는 점입니다."
							: "확인된 기록을 시간 순서로 정리합니다.",
				scene_type: "image",
				duration_seconds: 5,
				imageUrl: `blob:image-${index}`,
				audioUrl: `blob:audio-${index}`,
				wordTimings: timedWords("확인된 기록을 시간 순서로 정리합니다"),
				shots: [
					{
						media_type: "image" as const,
						source_url: `https://example.com/${index}.jpg`,
						selection_provider: "direct",
						visual_role: index === 1 ? "map" : "document",
						motion:
							index % 4 === 0
								? "push_in"
								: index % 4 === 1
									? "pan_left"
									: index % 4 === 2
										? "slow_zoom_out"
										: "drift",
						source_confidence: 86,
						sfx_cue: {
							category: index % 2 === 0 ? "whoosh" : "reveal",
							intensity: 0.5,
						},
					},
					{
						media_type: "image" as const,
						source_url: `https://example.com/${index}-detail.jpg`,
						selection_provider: "direct",
						visual_role: index === 2 ? "data" : "evidence",
						motion:
							index % 2 === 0 ? "pan_right" : "slow_zoom_in",
						source_confidence: 84,
						sfx_cue: {
							category: index % 2 === 0 ? "impact" : "tension_rise",
							intensity: 0.48,
						},
					},
				],
				transition: index % 2 === 0 ? "zoom_punch" : "light_leak",
			})),
			narrationUrl: "blob:narration",
			bgmUrl: "blob:bgm",
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(true);
		expect(report.metrics.videoSceneRatio).toBe(0);
		expect(report.metrics.designedVisualRatio).toBe(1);
		expect(report.issues.some((issue) => issue.code === "no_video_visuals")).toBe(
			true,
		);
	});

	it("그냥 이미지 나열이면 설계된 자료화면 비율 부족으로 차단한다", () => {
		const report = analyzeProductionQuality({
			title: "한강 실종 사건 핵심만 60초 요약",
			format: "shorts",
			scenes: Array.from({ length: 4 }, (_, index) => ({
				narration_text:
					index === 0
						? "왜 한강 실종 사건은 여기서 방향이 바뀌었을까요?"
						: index === 3
							? "현재까지 확인된 것은 시간 순서가 핵심이라는 점입니다."
							: "확인된 기록을 시간 순서로 정리합니다.",
				scene_type: "image",
				duration_seconds: 5,
				imageUrl: `blob:image-${index}`,
				audioUrl: `blob:audio-${index}`,
				wordTimings: timedWords("확인된 기록을 시간 순서로 정리합니다"),
				shots: [
					{
						media_type: "image" as const,
						source_url: `https://example.com/${index}.jpg`,
						selection_provider: "direct",
						visual_role: "context",
						motion: "static",
						source_confidence: 80,
					},
				],
			})),
			narrationUrl: "blob:narration",
			bgmUrl: "blob:bgm",
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(false);
		expect(
			report.issues.some((issue) => issue.code === "low_designed_visual_ratio"),
		).toBe(true);
		expect(
			report.issues.some((issue) => issue.code === "weak_visual_scene"),
		).toBe(true);
	});

	it("저동작 영상 소스와 약한 초반 컷 밀도는 실제 영상처럼 보이지 않아 차단한다", () => {
		const report = analyzeProductionQuality({
			title: "정적인 영상 소스 테스트",
			format: "shorts",
			scenes: [
				{
					narration_text: "왜 이 영상은 실제 영상처럼 보이지 않을까요?",
					scene_type: "video",
					duration_seconds: 6,
					videoUrl: "blob:video-static",
					audioUrl: "blob:audio-1",
					wordTimings: timedWords("왜 이 영상은 실제 영상처럼 보이지 않을까요"),
					shots: [
						{
							media_type: "video" as const,
							source_url: "scenes/static.mp4",
							selection_provider: "youtube",
							visual_role: "archive",
							motion: "push_in",
							source_confidence: 90,
							dynamic_score: 4,
							dynamic_issues: ["low_motion_video"],
						},
					],
				},
				{
					narration_text: "현재까지 확인된 것은 이 컷이 정지 화면에 가깝다는 점입니다.",
					scene_type: "image",
					duration_seconds: 4,
					imageUrl: "blob:image",
					audioUrl: "blob:audio-2",
					wordTimings: timedWords("현재까지 확인된 것은 이 컷이 정지 화면에 가깝다는 점입니다"),
					shots: [
						{
							media_type: "image" as const,
							source_url: "scenes/doc.jpg",
							selection_provider: "direct",
							visual_role: "document",
							motion: "static",
							source_confidence: 86,
						},
					],
				},
			],
			narrationUrl: "blob:narration",
			bgmUrl: "blob:bgm",
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(false);
		expect(
			report.issues.some((issue) => issue.code === "low_motion_video_scene"),
		).toBe(true);
		expect(
			report.issues.some(
				(issue) => issue.code === "high_low_motion_video_ratio",
			),
		).toBe(true);
		expect(
			report.issues.some(
				(issue) => issue.code === "low_opening_visual_density",
			),
		).toBe(true);
		expect(report.metrics.lowMotionVideoShotRatio).toBe(1);
	});

	it("source card는 낮은 외부 품질 점수여도 설계된 출처 화면으로 인정한다", () => {
		const report = analyzeProductionQuality({
			title: "기록 하나가 바꾼 흐름",
			format: "shorts",
			scenes: Array.from({ length: 4 }, (_, index) => ({
				narration_text:
					index === 0
						? "왜 이 기록 하나가 전체 흐름을 바꿨을까요?"
						: index === 3
							? "현재까지 확인된 것은 남은 의문이 이 기록에 모인다는 점입니다."
							: "확인된 자료를 근거로 흐름을 정리합니다.",
				scene_type: "image",
				duration_seconds: 3,
				imageUrl: `blob:source-card-${index}`,
				audioUrl: `blob:audio-${index}`,
				wordTimings: timedWords("확인된 자료를 근거로 흐름을 정리합니다"),
				shots: [
					{
						media_type: "image" as const,
						source_url: `scenes/card-${index}.svg`,
						selection_provider: "source_card",
						visual_role: index % 2 === 0 ? "document" : "map",
						motion:
							index % 4 === 0
								? "push_in"
								: index % 4 === 1
									? "pan_left"
									: index % 4 === 2
										? "slow_zoom_out"
										: "drift",
						source_confidence: 72,
						quality_score: 34,
						sfx_cue: {
							category: index % 2 === 0 ? "whoosh" : "reveal",
							intensity: 0.52,
						},
					},
				],
				transition: index % 2 === 0 ? "zoom_punch" : "light_leak",
			})),
			narrationUrl: "blob:narration",
			bgmUrl: "blob:bgm",
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(true);
		expect(report.metrics.lowConfidenceShotRatio).toBe(0);
		expect(report.metrics.premiumFloorScore).toBeGreaterThanOrEqual(86);
		expect(report.metrics.editorialDensityScore).toBeGreaterThanOrEqual(62);
	});

	it("핵심 자료 자리에 일반 스톡 컷이 과하면 최종 승인에서 차단한다", () => {
		const report = analyzeProductionQuality({
			title: "사건 타임라인 분석",
			format: "longform",
			scenes: Array.from({ length: 4 }, (_, index) => ({
				narration_text:
					index === 0
						? "왜 이 사건은 첫 기록부터 흐름이 달라졌을까요?"
						: index === 3
							? "현재까지 확인된 것은 기록의 순서가 핵심이라는 점입니다."
							: "확인된 자료를 시간 순서로 다시 보겠습니다.",
				scene_type: "image",
				duration_seconds: 8,
				imageUrl: `blob:image-${index}`,
				audioUrl: `blob:audio-${index}`,
				wordTimings: timedWords("확인된 자료를 시간 순서로 다시 보겠습니다"),
				shots: [
					{
						media_type: "image" as const,
						source_url: `scenes/stock-${index}.jpg`,
						selection_provider: "pexels",
						visual_role: index === 1 ? "archive" : "evidence",
						motion: "slow_zoom_in",
						source_confidence: 80,
						quality_score: 30,
					},
				],
			})),
			narrationUrl: "blob:narration",
			bgmUrl: "blob:bgm",
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(false);
		expect(report.metrics.genericStockShotRatio).toBe(1);
		expect(
			report.issues.some((issue) => issue.code === "high_generic_stock_ratio"),
		).toBe(true);
		expect(
			report.issues.some((issue) => issue.code === "very_low_quality_shot"),
		).toBe(true);
	});

	it("롱폼 엔딩이 결론 없이 짧게 끝나면 critical로 막는다", () => {
		const report = analyzeProductionQuality({
			title: "사건 타임라인 분석",
			format: "longform",
			scenes: [
				{
					narration_text: "왜 이 사건은 단순한 기록으로 끝나지 않았을까요?",
					scene_type: "video",
					duration_seconds: 12,
					videoUrl: "blob:video-1",
					audioUrl: "blob:audio-1",
					wordTimings: timedWords("왜 이 사건은 단순한 기록으로 끝나지 않았을까요"),
					shots: [
						{
							media_type: "video" as const,
							source_url: "https://youtube.com/watch?v=abc",
							selection_provider: "youtube",
							visual_role: "archive",
							motion: "push_in",
						},
					],
				},
				{
					narration_text: "끝.",
					scene_type: "video",
					duration_seconds: 1,
					videoUrl: "blob:video-2",
					audioUrl: "blob:audio-2",
					wordTimings: timedWords("끝"),
					shots: [
						{
							media_type: "video" as const,
							source_url: "https://youtube.com/watch?v=def",
							selection_provider: "youtube",
							visual_role: "archive",
							motion: "push_in",
						},
					],
				},
			],
			narrationUrl: "blob:narration",
			bgmUrl: "blob:bgm",
			thumbnailPlanned: true,
		});

		expect(report.passed).toBe(false);
		expect(
			report.issues.some((issue) => issue.code === "thin_ending_narration"),
		).toBe(true);
		expect(
			report.issues.some((issue) => issue.code === "abrupt_ending_duration"),
		).toBe(true);
	});
});
