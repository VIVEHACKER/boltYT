import { describe, expect, it } from "vitest";
import type { ReferenceTemplate } from "../types/database";
import {
	BENCHMARK_OBSERVATION_KEY,
	buildBenchmarkObservation,
	collectBenchmarkSamples,
	extractBenchmarkSample,
} from "./benchmark-reference-adapter";
import type { AnalysisJobResult } from "./reference-import";
import { scoreReferenceQuality } from "./reference-quality";

function makeTemplate(
	overrides: Partial<ReferenceTemplate> = {},
): ReferenceTemplate {
	return {
		id: "ref-1",
		channel_id: "ch-1",
		name: "테스트 레퍼런스",
		source_type: "youtube",
		source_url: "https://youtu.be/abc",
		source_title: "타이틀",
		source_creator: "크리에이터",
		thumbnail_url: "",
		duration_seconds: 60,
		dominant_colors: [],
		visual_mood: "mystery",
		visual_prompt_template: "",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "md",
		subtitle_bg_style: "block",
		subtitle_accent_color: "#ffffff",
		scene_count: 8,
		avg_scene_duration: 7.5,
		hook_duration: 2.4,
		transition_style: "hardcut",
		pacing_preset: "fast",
		tts_voice_id: "voice-1",
		tts_provider: "openai",
		tts_speed: 1.05,
		tts_tone_keywords: ["dramatic", "tense"],
		bgm_mood: "dark",
		bgm_keywords: ["suspense", "drone"],
		bgm_tempo: "mid",
		bgm_reference_url: "",
		hook_pattern: "question",
		script_structure: [],
		transcript: "",
		frame_urls: [],
		raw_analysis: {},
		analysis_status: "complete",
		analysis_error: "",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

/** scoreReferenceQuality 기준 grade B 이상이 나오는 deep 분석 raw_analysis */
function goodRawAnalysis(): Record<string, unknown> {
	return {
		analysis_depth: "pixel_frame_audio_edit",
		production_dna: {
			camera: {
				mode: "cut_driven",
				cutDensityPerMinute: 30,
				avgCutIntervalSeconds: 2.1,
				firstCutSeconds: 0.5,
				sceneCutTimes: [0.5, 2, 4, 6, 8, 10, 12],
			},
			audio: {
				integratedLufs: -16.2,
				ttsSpeed: 1.1,
				bgmMood: "tense",
			},
		},
	};
}

function makeResult(
	overrides: Partial<AnalysisJobResult> = {},
): AnalysisJobResult {
	return {
		source_type: "youtube",
		source_url: "https://youtu.be/abc",
		source_title: "타이틀",
		source_creator: "크리에이터",
		thumbnail_url: "",
		duration_seconds: 60,
		dominant_colors: [],
		visual_mood: "mystery",
		visual_prompt_template: "",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "md",
		subtitle_bg_style: "block",
		subtitle_accent_color: "#ffffff",
		scene_count: 8,
		avg_scene_duration: 7.5,
		hook_duration: 2.4,
		transition_style: "hardcut",
		pacing_preset: "fast",
		tts_voice_id: "voice-1",
		tts_provider: "openai",
		tts_speed: 1.05,
		tts_tone_keywords: [],
		bgm_mood: "dark",
		bgm_keywords: [],
		bgm_tempo: "mid",
		hook_pattern: "question",
		script_structure: [],
		transcript: "",
		frame_urls: [],
		raw_analysis: {},
		...overrides,
	};
}

function expectNoNaN(value: unknown): void {
	for (const field of Object.values(value as Record<string, unknown>)) {
		if (typeof field === "number") {
			expect(Number.isNaN(field)).toBe(false);
		}
	}
}

describe("extractBenchmarkSample", () => {
	it("정상 production_dna 에서 cutDensityPerMinute→cutDensitySec 환산으로 샘플을 추출한다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({ raw_analysis: goodRawAnalysis() }),
			{ views: 120000, channelSubs: 4000 },
		);

		expect(sample).not.toBeNull();
		// 30컷/분 → 60/30 = 2초 간격 (avgCutIntervalSeconds 2.1 보다 환산값 우선)
		expect(sample?.cutDensitySec).toBe(2);
		expect(sample?.format).toBe("shorts");
		expect(sample?.hookSec).toBe(2.4);
		expect(sample?.integratedLufs).toBe(-16.2);
		// dna 관측치가 템플릿 필드(tts_speed 1.05 / bgm_mood dark)보다 우선
		expect(sample?.ttsSpeed).toBe(1.1);
		expect(sample?.bgmMood).toBe("tense");
		expect(sample?.url).toBe("https://youtu.be/abc");
		expect(sample?.views).toBe(120000);
		expect(sample?.channelSubs).toBe(4000);
		expect(sample?.sceneCount).toBe(8);
	});

	it("cutDensityPerMinute 부재 시 avgCutIntervalSeconds 로 폴백한다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({
				raw_analysis: {
					production_dna: { camera: { avgCutIntervalSeconds: 2.1 } },
				},
			}),
		);
		expect(sample?.cutDensitySec).toBe(2.1);
	});

	it("문자열/NaN 오염 필드는 제외하고 NaN 을 전파하지 않는다", () => {
		const polluted = {
			production_dna: {
				camera: {
					cutDensityPerMinute: "45",
					avgCutIntervalSeconds: Number.NaN,
				},
				audio: {
					integratedLufs: Number.NaN,
					ttsSpeed: "fast",
					bgmMood: 3,
				},
			},
		};

		// 오염 + 템플릿 hook 까지 없으면 핵심 필드 부재 → null
		expect(
			extractBenchmarkSample(
				makeTemplate({ raw_analysis: polluted, hook_duration: 0 }),
			),
		).toBeNull();

		// hook 이 살아 있으면 샘플은 나오되 오염 필드는 전부 제외
		const sample = extractBenchmarkSample(
			makeTemplate({ raw_analysis: polluted }),
		);
		expect(sample).not.toBeNull();
		expect(sample?.hookSec).toBe(2.4);
		expect(sample?.cutDensitySec).toBeUndefined();
		expect(sample?.integratedLufs).toBeUndefined();
		expect(sample?.bgmMood).toBe("dark"); // 템플릿 필드 폴백
		expect(sample?.ttsSpeed).toBe(1.05);
		expectNoNaN(sample);
	});

	it("핵심 필드(cutDensity/hook) 전부 부재 시 null 을 반환한다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({ raw_analysis: {}, hook_duration: 0 }),
		);
		expect(sample).toBeNull();
	});

	it("raw_analysis 가 레코드가 아니어도(배열/문자열) 터지지 않는다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({
				raw_analysis: ["broken"] as unknown as Record<string, unknown>,
			}),
		);
		expect(sample?.hookSec).toBe(2.4);
	});

	it("길이 정책 위반(3-8분 갭, 20분 초과) 템플릿은 null", () => {
		const gap = makeTemplate({
			raw_analysis: goodRawAnalysis(),
			duration_seconds: 300,
		});
		const tooLong = makeTemplate({
			raw_analysis: goodRawAnalysis(),
			duration_seconds: 1500,
		});
		const zero = makeTemplate({
			raw_analysis: goodRawAnalysis(),
			duration_seconds: 0,
		});
		expect(extractBenchmarkSample(gap)).toBeNull();
		expect(extractBenchmarkSample(tooLong)).toBeNull();
		expect(extractBenchmarkSample(zero)).toBeNull();
	});

	it("저장된 benchmark_observation 다이제스트가 production_dna 재파싱보다 우선한다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({
				raw_analysis: {
					...goodRawAnalysis(), // dna 환산값은 2
					[BENCHMARK_OBSERVATION_KEY]: {
						cutDensitySec: 3.2,
						integratedLufs: -14,
						extractedAt: "2026-01-01T00:00:00Z",
					},
				},
			}),
		);
		expect(sample?.cutDensitySec).toBe(3.2);
		expect(sample?.integratedLufs).toBe(-14);
	});

	it("전 필드가 오염된 다이제스트는 무시하고 production_dna 로 폴백한다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({
				raw_analysis: {
					...goodRawAnalysis(),
					[BENCHMARK_OBSERVATION_KEY]: {
						cutDensitySec: "3.2",
						integratedLufs: Number.NaN,
						bgmMood: "",
					},
				},
			}),
		);
		expect(sample?.cutDensitySec).toBe(2);
		expect(sample?.integratedLufs).toBe(-16.2);
	});

	it("meta 의 views/channelSubs 오염(NaN/음수/0)은 결측 처리한다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({ raw_analysis: goodRawAnalysis() }),
			{ views: Number.NaN, channelSubs: -10 },
		);
		expect(sample?.views).toBeUndefined();
		expect(sample?.channelSubs).toBeUndefined();
	});

	it("롱폼 chapters(start_time 2개 이상)에서 chapterEverySec 을 추정한다", () => {
		const sample = extractBenchmarkSample(
			makeTemplate({
				duration_seconds: 600,
				raw_analysis: {
					...goodRawAnalysis(),
					chapters: [
						{ start_time: 0, title: "인트로" },
						{ start_time: 200, title: "전개" },
						{ start_time: 420, title: "결말" },
						{ start_time: "oops" }, // 오염 챕터는 개수에서 제외
					],
				},
			}),
		);
		expect(sample?.format).toBe("longform");
		expect(sample?.chapterEverySec).toBe(200);

		// 챕터 1개 이하면 케이던스 추정 불가
		const single = extractBenchmarkSample(
			makeTemplate({
				duration_seconds: 600,
				raw_analysis: {
					...goodRawAnalysis(),
					chapters: [{ start_time: 0 }],
				},
			}),
		);
		expect(single?.chapterEverySec).toBeUndefined();
	});
});

describe("collectBenchmarkSamples", () => {
	it("grade C/D 템플릿은 추출 가능해도 제외한다", () => {
		// 기본 fixture(raw_analysis 빈 객체)는 신호 부족으로 C/D 영역
		const weak = makeTemplate({ id: "weak", source_url: "https://yt/weak" });
		expect(["C", "D"]).toContain(scoreReferenceQuality(weak).grade);
		expect(extractBenchmarkSample(weak)).not.toBeNull(); // 제외 사유는 grade

		const good = makeTemplate({
			id: "good",
			source_url: "https://yt/good",
			raw_analysis: goodRawAnalysis(),
		});
		expect(["S", "A", "B"]).toContain(scoreReferenceQuality(good).grade);

		const samples = collectBenchmarkSamples([weak, good], "shorts");
		expect(samples).toHaveLength(1);
		expect(samples[0]?.url).toBe("https://yt/good");
	});

	it("포맷 길이 위반/포맷 불일치 템플릿을 제외한다", () => {
		const violating = makeTemplate({
			id: "violating",
			duration_seconds: 1500, // 20분 초과
			raw_analysis: goodRawAnalysis(),
		});
		const shorts = makeTemplate({
			id: "shorts",
			duration_seconds: 60,
			raw_analysis: goodRawAnalysis(),
		});
		const longform = makeTemplate({
			id: "longform",
			duration_seconds: 600,
			source_url: "https://yt/longform",
			raw_analysis: goodRawAnalysis(),
		});

		const samples = collectBenchmarkSamples(
			[violating, shorts, longform],
			"longform",
		);
		expect(samples).toHaveLength(1);
		expect(samples[0]?.url).toBe("https://yt/longform");
		expect(samples[0]?.format).toBe("longform");
	});

	it("metaByUrl 을 source_url 로 매칭해 가중치 메타를 주입한다", () => {
		const template = makeTemplate({ raw_analysis: goodRawAnalysis() });
		const samples = collectBenchmarkSamples([template], "shorts", {
			"https://youtu.be/abc": { views: 50000, channelSubs: 1000 },
			"https://youtu.be/other": { views: 1, channelSubs: 1 },
		});
		expect(samples[0]?.views).toBe(50000);
		expect(samples[0]?.channelSubs).toBe(1000);
	});

	it("빈 입력이면 빈 배열을 반환한다", () => {
		expect(collectBenchmarkSamples([], "shorts")).toEqual([]);
	});
});

describe("buildBenchmarkObservation", () => {
	it("정상 분석 결과에서 환산 포함 다이제스트를 만든다", () => {
		const observation = buildBenchmarkObservation(
			makeResult({ raw_analysis: goodRawAnalysis() }),
		);
		expect(observation).not.toBeNull();
		expect(observation?.cutDensitySec).toBe(2);
		expect(observation?.hookSec).toBe(2.4);
		expect(observation?.integratedLufs).toBe(-16.2);
		expect(observation?.ttsSpeed).toBe(1.1);
		expect(observation?.bgmMood).toBe("tense");
		expect(Number.isNaN(Date.parse(observation?.extractedAt ?? ""))).toBe(
			false,
		);
		expectNoNaN(observation);
	});

	it("관측 신호가 하나도 없으면 null (빈 다이제스트 저장 금지)", () => {
		const observation = buildBenchmarkObservation(
			makeResult({
				raw_analysis: {},
				hook_duration: 0,
				tts_speed: 0,
				bgm_mood: "",
			}),
		);
		expect(observation).toBeNull();
	});

	it("부분 신호(tts_speed 만)로도 다이제스트를 만든다", () => {
		const observation = buildBenchmarkObservation(
			makeResult({
				raw_analysis: {},
				hook_duration: 0,
				tts_speed: 1.0,
				bgm_mood: "",
			}),
		);
		expect(observation?.ttsSpeed).toBe(1.0);
		expect(observation?.cutDensitySec).toBeUndefined();
	});

	it("다이제스트를 raw_analysis 에 중첩하면 판정 시 그대로 재사용된다 (라운드트립)", () => {
		const result = makeResult({ raw_analysis: goodRawAnalysis() });
		const observation = buildBenchmarkObservation(result);
		expect(observation).not.toBeNull();

		const template = makeTemplate({
			raw_analysis: {
				...result.raw_analysis,
				[BENCHMARK_OBSERVATION_KEY]: observation,
			},
		});
		const sample = extractBenchmarkSample(template);
		expect(sample?.cutDensitySec).toBe(observation?.cutDensitySec);
		expect(sample?.hookSec).toBe(observation?.hookSec);
		expect(sample?.integratedLufs).toBe(observation?.integratedLufs);
		expect(sample?.ttsSpeed).toBe(observation?.ttsSpeed);
		expect(sample?.bgmMood).toBe(observation?.bgmMood);
	});
});
