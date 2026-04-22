/**
 * ai-agents.ts 단위 테스트
 *
 * verifySceneQuality: 순수 함수 — 외부 의존 없음.
 * researchTopic / planSceneVisuals / planSceneSourceAssignments:
 *   fetch + proxy 의존 → vi.mock + vi.stubGlobal.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3456" }));

import {
	planSceneDirectives,
	planSceneSourceAssignments,
	planSceneVisuals,
	researchTopic,
	verifySceneQuality,
	verifySceneQualityWithVision,
} from "./ai-agents";

afterEach(() => vi.restoreAllMocks());

// ─── verifySceneQuality ───────────────────────────────────────────────────────

const baseScene = {
	narration_text: "테스트 나레이션 텍스트입니다.",
	scene_type: "image",
	duration_seconds: 10,
	imageUrl: "http://example.com/image.jpg",
	audioUrl: "http://example.com/audio.mp3",
};

describe("verifySceneQuality", () => {
	it("정상적인 씬들은 통과", () => {
		const report = verifySceneQuality([baseScene, baseScene]);
		expect(report.passed).toBe(true);
		expect(report.overall_score).toBeGreaterThanOrEqual(90);
	});

	it("비주얼 없는 씬은 critical", () => {
		const report = verifySceneQuality([
			{ ...baseScene, imageUrl: undefined, scene_type: "image" },
		]);
		expect(report.passed).toBe(false);
		expect(report.issues.some((i) => i.severity === "critical")).toBe(true);
	});

	it("text_emphasis는 비주얼 없어도 OK", () => {
		const report = verifySceneQuality([
			{
				...baseScene,
				imageUrl: undefined,
				scene_type: "text_emphasis",
			},
		]);
		const criticals = report.issues.filter(
			(i) => i.severity === "critical" && i.message.includes("배경"),
		);
		expect(criticals.length).toBe(0);
	});

	it("오디오 없는 씬은 warning", () => {
		const report = verifySceneQuality([{ ...baseScene, audioUrl: undefined }]);
		expect(report.issues.some((i) => i.message.includes("TTS 음성 없음"))).toBe(
			true,
		);
	});

	it("3초 미만 씬은 warning", () => {
		const report = verifySceneQuality([{ ...baseScene, duration_seconds: 2 }]);
		expect(report.issues.some((i) => i.message.includes("너무 짧음"))).toBe(
			true,
		);
	});

	it("30초 초과 씬은 info", () => {
		const report = verifySceneQuality([{ ...baseScene, duration_seconds: 35 }]);
		expect(report.issues.some((i) => i.severity === "info")).toBe(true);
	});

	it("나레이션이 과도하게 길면 warning", () => {
		const report = verifySceneQuality([
			{
				...baseScene,
				narration_text: "가".repeat(100),
				duration_seconds: 5,
			},
		]);
		// 100자 / 5초 = 20자/초 > 8자/초
		expect(
			report.issues.some((i) => i.message.includes("나레이션이 씬 길이")),
		).toBe(true);
	});

	it("30초 미만 총 영상은 suggestion", () => {
		const report = verifySceneQuality([{ ...baseScene, duration_seconds: 5 }]);
		expect(report.suggestions.some((s) => s.includes("30초 미만"))).toBe(true);
	});

	it("영상 클립 없으면 suggestion", () => {
		const report = verifySceneQuality([baseScene]);
		expect(
			report.suggestions.some((s) => s.includes("영상 클립이 하나도 없음")),
		).toBe(true);
	});

	it("text_emphasis가 40% 넘으면 suggestion", () => {
		const textScene = { ...baseScene, scene_type: "text_emphasis" };
		const report = verifySceneQuality([textScene, textScene, baseScene]);
		expect(
			report.suggestions.some((s) => s.includes("텍스트 강조 씬이 40%")),
		).toBe(true);
	});

	it("빈 배열은 통과 (이슈 없음)", () => {
		const report = verifySceneQuality([]);
		expect(report.passed).toBe(true);
		expect(report.overall_score).toBe(100);
	});

	it("videoUrl 있으면 영상 클립 suggestion 없음", () => {
		const r = verifySceneQuality([
			{ ...baseScene, videoUrl: "https://v.com/v.mp4", duration_seconds: 40 },
		]);
		expect(r.suggestions.some((s) => s.includes("영상 클립"))).toBe(false);
	});

	it("critical × 다수 → score 0 이상", () => {
		const bad = Array(10).fill({
			...baseScene,
			imageUrl: undefined,
			audioUrl: undefined,
		});
		expect(verifySceneQuality(bad).overall_score).toBeGreaterThanOrEqual(0);
	});
});

// ─── fetch 기반 함수 ──────────────────────────────────────────────────────────

function mockAiResponse(content: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: () =>
				Promise.resolve({
					choices: [{ message: { content: JSON.stringify(content) } }],
				}),
		}),
	);
}

function mockAiError(status = 500) {
	vi.stubGlobal(
		"fetch",
		vi.fn().mockResolvedValue({
			ok: false,
			status,
			json: () => Promise.resolve({ error: "server error" }),
		}),
	);
}

describe("researchTopic", () => {
	it("성공 → ResearchBrief 반환", async () => {
		const brief = {
			summary: "사건 요약",
			timeline: [],
			key_figures: [],
			facts: ["팩트1"],
			misconceptions: [],
			search_keywords: ["키워드"],
		};
		mockAiResponse(brief);
		expect(await researchTopic("화성 연쇄살인")).toEqual(brief);
	});

	it("HTTP 오류 → 예외 throw", async () => {
		mockAiError(500);
		await expect(researchTopic("테스트")).rejects.toThrow("AI 오류");
	});

	it("마크다운 코드 펜스 포함 JSON도 파싱", async () => {
		const brief = {
			summary: "요약",
			timeline: [],
			key_figures: [],
			facts: [],
			misconceptions: [],
			search_keywords: [],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						choices: [
							{
								message: {
									content: `\`\`\`json\n${JSON.stringify(brief)}\n\`\`\``,
								},
							},
						],
					}),
			}),
		);
		expect(await researchTopic("테스트")).toEqual(brief);
	});

	it("content 없는 응답 → 예외 throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ choices: [{ message: {} }] }),
			}),
		);
		await expect(researchTopic("테스트")).rejects.toThrow("content");
	});
});

describe("planSceneVisuals", () => {
	it("성공 → SceneVisualPlan 반환", async () => {
		const plan = {
			scenes: [
				{
					index: 1,
					search_query_ko: "화성 수사",
					search_query_en: "investigation night",
					visual_mood: "dark",
					preferred_source: "video",
				},
			],
		};
		mockAiResponse(plan);
		const result = await planSceneVisuals(
			[{ narration: "나레이션", type: "video" }],
			"주제",
			["키워드"],
		);
		expect(result.scenes[0].search_query_ko).toBe("화성 수사");
	});

	it("HTTP 오류 → 예외 throw", async () => {
		mockAiError(429);
		await expect(
			planSceneVisuals([{ narration: "N", type: "video" }], "T", []),
		).rejects.toThrow();
	});
});

describe("planSceneSourceAssignments", () => {
	it("성공 → SceneSourceAssignmentPlan 반환", async () => {
		const plan = {
			scenes: [{ index: 0, source_index: 1, event_title: "실종 당일" }],
		};
		mockAiResponse(plan);
		const result = await planSceneSourceAssignments(
			[{ narration: "나레이션", type: "video" }],
			[{ type: "article", title: "기사 제목" }],
		);
		expect(result.scenes[0].source_index).toBe(1);
	});
});

// ─── planSceneDirectives ─────────────────────────────────────────────────────

const mockBrief = {
	summary: "화성 연쇄살인 사건 요약",
	timeline: [],
	key_figures: [],
	facts: ["팩트1"],
	misconceptions: [],
	search_keywords: ["키워드1"],
};

describe("planSceneDirectives", () => {
	it("성공 → SceneDirective[] 반환", async () => {
		const directives = [
			{
				index: 0,
				shot_type: "wide",
				camera_motion: "zoom_in",
				bgm_mood: "tension",
				pacing: "fast",
				transition_to_next: "cut",
			},
			{
				index: 1,
				shot_type: "close_up",
				camera_motion: "static",
				bgm_mood: "mysterious",
				pacing: "slow",
				transition_to_next: "crossfade",
			},
		];
		mockAiResponse(directives);
		const result = await planSceneDirectives(
			[
				{ narration: "도입 나레이션", type: "video", index: 0 },
				{ narration: "증거 나레이션", type: "image", index: 1 },
			],
			mockBrief,
			"화성 연쇄살인",
		);
		expect(result).toHaveLength(2);
		expect(result[0].shot_type).toBe("wide");
		expect(result[0].camera_motion).toBe("zoom_in");
		expect(result[0].bgm_mood).toBe("tension");
		expect(result[1].shot_type).toBe("close_up");
	});

	it("HTTP 오류 → 예외 throw", async () => {
		mockAiError(500);
		await expect(
			planSceneDirectives(
				[{ narration: "N", type: "video", index: 0 }],
				mockBrief,
				"주제",
			),
		).rejects.toThrow("AI 오류");
	});

	it("씬이 없어도 빈 배열 반환", async () => {
		mockAiResponse([]);
		const result = await planSceneDirectives([], mockBrief, "주제");
		expect(result).toEqual([]);
	});

	it("마크다운 코드 펜스 JSON도 파싱", async () => {
		const directives = [
			{
				index: 0,
				shot_type: "aerial",
				camera_motion: "slow_pan",
				bgm_mood: "neutral",
				pacing: "normal",
				transition_to_next: "crossfade",
			},
		];
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						choices: [
							{
								message: {
									content: "```json\n" + JSON.stringify(directives) + "\n```",
								},
							},
						],
					}),
			}),
		);
		const result = await planSceneDirectives(
			[{ narration: "현장 묘사", type: "video", index: 0 }],
			mockBrief,
			"주제",
		);
		expect(result[0].shot_type).toBe("aerial");
	});
});

// ─── verifySceneQualityWithVision ────────────────────────────────────────────

describe("verifySceneQualityWithVision", () => {
	it("imageUrl 없으면 규칙 기반 fallback 반환", async () => {
		// fetch가 호출되지 않아야 함
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		const result = await verifySceneQualityWithVision([baseScene]);
		// imageUrl 있으므로 Vision 대상 — 하지만 규칙 기반 통과 씬이면 Vision 호출 없음
		expect(result.passed).toBe(true);
		expect(result.overall_score).toBeGreaterThanOrEqual(90);
	});

	it("비주얼 없는 씬 + imageUrl 없으면 규칙 기반 결과만 반환", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		const result = await verifySceneQualityWithVision([
			{ ...baseScene, imageUrl: undefined, scene_type: "image" },
		]);
		// imageUrl 없어서 Vision 호출 안 함
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.passed).toBe(false);
		expect(result.issues.some((i) => i.severity === "critical")).toBe(true);
	});

	it("critical 씬에 imageUrl 있으면 Vision 호출", async () => {
		// 규칙 기반 critical: audio 없음 + 씬이 짧음 (vision 대상 아님: warning만)
		// Vision 호출을 유도: imageUrl 있고 warning 있는 씬
		const sceneWithWarning = {
			...baseScene,
			audioUrl: undefined, // warning
		};
		const visionResponse = {
			issues: [{ severity: "warning" as const, message: "이미지 품질 낮음" }],
			score: 80,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						choices: [{ message: { content: JSON.stringify(visionResponse) } }],
					}),
			}),
		);

		const result = await verifySceneQualityWithVision([sceneWithWarning]);
		// Vision 이슈가 merge되어야 함
		expect(result.issues.some((i) => i.message.includes("[Vision]"))).toBe(
			true,
		);
	});

	it("Vision API 실패 시 graceful fallback — 규칙 기반 결과 반환", async () => {
		const sceneWithWarning = { ...baseScene, audioUrl: undefined };
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				json: () => Promise.resolve({}),
			}),
		);

		const result = await verifySceneQualityWithVision([sceneWithWarning]);
		// Vision 실패해도 규칙 기반 결과는 반환
		expect(result.issues.some((i) => i.message.includes("TTS 음성 없음"))).toBe(
			true,
		);
		// Vision 이슈는 없어야 함
		expect(result.issues.every((i) => !i.message.includes("[Vision]"))).toBe(
			true,
		);
	});

	it("빈 씬 배열 → 통과, Vision 미호출", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const result = await verifySceneQualityWithVision([]);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.passed).toBe(true);
	});
});
