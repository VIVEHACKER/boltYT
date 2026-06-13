import { describe, expect, it } from "vitest";
import type { BundleScene, ContentBundle } from "./content-bundle";
import { getBuiltinBenchmark } from "./market-benchmark";
import { collectJudgeSignals } from "./quality-judge-signals";

function bscene(overrides: Partial<BundleScene> = {}): BundleScene {
	return {
		id: "s1",
		orderIndex: 0,
		narration: "사건 현장에는 단서가 거의 남지 않았습니다",
		durationSec: 6,
		type: "image",
		shotCount: 1,
		motionGraphicCount: 0,
		hasWordTimings: false,
		...overrides,
	};
}

function makeBundle(input: {
	scenes: BundleScene[];
	format?: "shorts" | "longform";
	tts?: Partial<ContentBundle["tts"]>;
	bgm?: Partial<ContentBundle["bgm"]>;
	scriptStructure?: string[];
}): ContentBundle {
	return {
		contentId: "c1",
		format: input.format ?? "shorts",
		durationSec: input.scenes.reduce((sum, s) => sum + s.durationSec, 0),
		scriptStructure: input.scriptStructure ?? ["hook", "body", "cta"],
		scenes: input.scenes,
		tts: { coverageRatio: 0, ...input.tts },
		bgm: { hasBeatGrid: false, ...input.bgm },
	};
}

/** 밀도 높은 쇼츠 — 멀티샷, 영상/모션그래픽 혼합, 강한 질문 훅, 자막 싱크 */
function denseBundle(): ContentBundle {
	const narrations = [
		"왜 이 사건은 30년째 풀리지 않았을까요?",
		"첫 번째 단서는 현장에서 발견된 낡은 사진이었습니다",
		"그런데 사진 속 인물은 이미 사라진 사람이었습니다",
		"경찰 기록과 증언은 서로 다른 시간을 가리켰습니다",
		"마지막 목격자는 끝내 입을 열지 않았습니다",
		"결국 확인된 것은 단 하나, 남은 의문은 아직 그대로입니다",
	];
	const types: BundleScene["type"][] = [
		"video",
		"video",
		"image",
		"video",
		"image",
		"image",
	];
	return makeBundle({
		scenes: narrations.map((narration, i) =>
			bscene({
				id: `d${i}`,
				orderIndex: i,
				narration,
				durationSec: 4,
				type: types[i] ?? "image",
				shotCount: 3,
				motionGraphicCount: i === 2 || i === 4 ? 1 : 0,
				hasWordTimings: true,
				transition: i % 2 === 0 ? "cut" : "whip",
			}),
		),
		tts: { coverageRatio: 0.9, speed: 1.05, profile: "suspense" },
		bgm: {
			source: "ai_generated",
			mood: "dark",
			qualityScore: 78,
			lufsEstimate: -15,
			hasBeatGrid: true,
		},
	});
}

/** 밋밋한 쇼츠 — 단일샷 긴 정지 이미지, 인사말 인트로, 싱크/BGM 없음 */
function flatBundle(): ContentBundle {
	const narrations = [
		"안녕하세요 오늘은 미제 사건을 알아보겠습니다",
		"긴 정지 화면이 계속 이어지는 구간입니다",
		"별다른 변화 없이 마무리되는 장면입니다",
	];
	return makeBundle({
		scenes: narrations.map((narration, i) =>
			bscene({
				id: `f${i}`,
				orderIndex: i,
				narration,
				durationSec: 10,
				type: "image",
				shotCount: 1,
			}),
		),
	});
}

const HORROR_SHORTS = getBuiltinBenchmark("horror_mystery", "shorts");
const GENERIC_SHORTS = getBuiltinBenchmark("generic", "shorts");
const DOCU_LONGFORM = getBuiltinBenchmark("docu_story", "longform");

describe("collectJudgeSignals — 결정론", () => {
	it("같은 번들 + 같은 벤치마크 2회 → 동일 신호", () => {
		const first = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		const second = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		expect(second).toEqual(first);
		expect(JSON.stringify(second)).toBe(JSON.stringify(first));
	});

	it("밋밋한 번들도 2회 호출 시 동일 신호", () => {
		const first = collectJudgeSignals(flatBundle(), HORROR_SHORTS);
		const second = collectJudgeSignals(flatBundle(), HORROR_SHORTS);
		expect(second).toEqual(first);
	});
});

describe("collectJudgeSignals — editing", () => {
	it("밀도 높은 번들 vs 밋밋한 번들 → editing 신호 차이", () => {
		const dense = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		const flat = collectJudgeSignals(flatBundle(), HORROR_SHORTS);

		expect(dense.editing.editorialDensityScore).toBeGreaterThan(
			flat.editing.editorialDensityScore,
		);
		expect(dense.editing.premiumFloorScore).toBeGreaterThan(
			flat.editing.premiumFloorScore,
		);
		expect(dense.editing.openingRetentionScore).toBeGreaterThan(
			flat.editing.openingRetentionScore,
		);
		expect(dense.editing.avgCutSec).toBeLessThan(flat.editing.avgCutSec);
		expect(dense.editing.motionRatio).toBeGreaterThan(flat.editing.motionRatio);
	});

	it("avgCutSec = 총 길이 / 총 컷 수(씬당 최소 1컷)", () => {
		const dense = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		// 24초 / (6씬 × 3샷) = 1.33
		expect(dense.editing.avgCutSec).toBe(1.33);

		const flat = collectJudgeSignals(flatBundle(), HORROR_SHORTS);
		// 30초 / 3컷 = 10
		expect(flat.editing.avgCutSec).toBe(10);
	});

	it("벤치마크 바 미달 시 editing issues 에 결정론 코드 추가", () => {
		const flat = collectJudgeSignals(flatBundle(), HORROR_SHORTS);
		expect(flat.editing.issues).toContain("cut_density_below_bar");
		expect(flat.editing.issues).toContain("low_motion_ratio");
	});

	it("retention 분석기 이슈는 opening_ 프리픽스로 합류한다", () => {
		const flat = collectJudgeSignals(flatBundle(), HORROR_SHORTS);
		expect(flat.editing.issues).toContain("opening_generic_intro");
		expect(flat.editing.issues).toContain("opening_weak_opening_hook");
	});

	it("점수는 0..100 범위의 정수", () => {
		for (const bundle of [denseBundle(), flatBundle()]) {
			const { editing } = collectJudgeSignals(bundle, HORROR_SHORTS);
			for (const score of [
				editing.editorialDensityScore,
				editing.premiumFloorScore,
				editing.openingRetentionScore,
			]) {
				expect(Number.isInteger(score)).toBe(true);
				expect(score).toBeGreaterThanOrEqual(0);
				expect(score).toBeLessThanOrEqual(100);
			}
		}
	});
});

describe("collectJudgeSignals — script", () => {
	it("첫 씬 질문 훅 → hookPattern=question, hookSec=0", () => {
		const dense = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		expect(dense.script.hookPattern).toBe("question");
		expect(dense.script.hookSec).toBe(0);
	});

	it("훅이 두 번째 씬에 있으면 hookSec = 첫 씬 길이", () => {
		const bundle = makeBundle({
			scenes: [
				bscene({ id: "a", orderIndex: 0, durationSec: 4 }),
				bscene({
					id: "b",
					orderIndex: 1,
					durationSec: 6,
					narration: "왜 아무도 그를 찾지 못했을까요?",
				}),
			],
		});
		const signals = collectJudgeSignals(bundle, HORROR_SHORTS);
		expect(signals.script.hookSec).toBe(4);
	});

	it("훅이 없으면 hookSec = 총 길이(최악값)", () => {
		// "~입니다" 종결은 hook-detector 의 claim 패턴이라 의도적으로 회피
		const noHook = makeBundle({
			scenes: [
				"사건 현장에는 단서가 거의 남지 않았고",
				"수사는 곧 답보 상태에 빠졌으며",
				"기록 일부는 끝내 공개되지 않았다고 전해진다",
			].map((narration, i) =>
				bscene({ id: `n${i}`, orderIndex: i, narration, durationSec: 6 }),
			),
		});
		const signals = collectJudgeSignals(noHook, HORROR_SHORTS);
		expect(signals.script.hookSec).toBe(18);
	});

	it("빈 나레이션 카운트 — 공백만 있는 나레이션도 빈 것으로 센다", () => {
		const bundle = makeBundle({
			scenes: [
				bscene({ id: "a", orderIndex: 0, narration: "" }),
				bscene({ id: "b", orderIndex: 1, narration: "   " }),
				bscene({ id: "c", orderIndex: 2, narration: "정상 나레이션 텍스트" }),
			],
		});
		const signals = collectJudgeSignals(bundle, HORROR_SHORTS);
		expect(signals.script.emptyNarrationCount).toBe(2);

		const dense = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		expect(dense.script.emptyNarrationCount).toBe(0);
	});

	it("structureRoles 는 번들 scriptStructure 의 복사본", () => {
		const bundle = denseBundle();
		const signals = collectJudgeSignals(bundle, HORROR_SHORTS);
		expect(signals.script.structureRoles).toEqual(bundle.scriptStructure);
		expect(signals.script.structureRoles).not.toBe(bundle.scriptStructure);
	});

	it("chapterCount — 롱폼은 벤치마크 chapterEverySec 기준 분할, 쇼츠는 1", () => {
		const longform = makeBundle({
			format: "longform",
			scenes: Array.from({ length: 6 }, (_, i) =>
				bscene({ id: `l${i}`, orderIndex: i, durationSec: 60 }),
			),
		});
		// 360초 / 150초 간격 — 씬 경계 기준 → 2챕터
		expect(
			collectJudgeSignals(longform, DOCU_LONGFORM).script.chapterCount,
		).toBe(2);
		expect(
			collectJudgeSignals(denseBundle(), HORROR_SHORTS).script.chapterCount,
		).toBe(1);
	});

	it("pacing — 글자/초 기준 fast/slow/normal", () => {
		const paced = (chars: number) =>
			collectJudgeSignals(
				makeBundle({
					scenes: [bscene({ narration: "가".repeat(chars), durationSec: 5 })],
				}),
				GENERIC_SHORTS,
			).script.pacing;
		expect(paced(35)).toBe("fast"); // 7.0 cps
		expect(paced(22)).toBe("normal"); // 4.4 cps
		expect(paced(10)).toBe("slow"); // 2.0 cps
	});
});

describe("collectJudgeSignals — bgm", () => {
	it("claimBlocked 패스스루 — true/false/미지정→false", () => {
		const scenes = [bscene({})];
		const blocked = collectJudgeSignals(
			makeBundle({ scenes, bgm: { hasBeatGrid: false, claimBlocked: true } }),
			HORROR_SHORTS,
		);
		expect(blocked.bgm.claimBlocked).toBe(true);

		const cleared = collectJudgeSignals(
			makeBundle({ scenes, bgm: { hasBeatGrid: false, claimBlocked: false } }),
			HORROR_SHORTS,
		);
		expect(cleared.bgm.claimBlocked).toBe(false);

		const unknown = collectJudgeSignals(makeBundle({ scenes }), HORROR_SHORTS);
		expect(unknown.bgm.claimBlocked).toBe(false);
	});

	it("qualityScore/lufsDelta — 있으면 패스스루/델타, 없으면 undefined", () => {
		const dense = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		expect(dense.bgm.qualityScore).toBe(78);
		// lufsEstimate -15 vs 벤치마크 -16 → +1 (추정치)
		expect(dense.bgm.lufsDelta).toBe(1);

		const flat = collectJudgeSignals(flatBundle(), HORROR_SHORTS);
		expect(flat.bgm.qualityScore).toBeUndefined();
		expect(flat.bgm.lufsDelta).toBeUndefined();
	});

	it("moodMatched — 정확 일치 + 근접 mood(dark↔mysterious) 허용", () => {
		const scenes = [bscene({})];
		const withMood = (mood?: string) =>
			collectJudgeSignals(
				makeBundle({ scenes, bgm: { hasBeatGrid: false, mood } }),
				HORROR_SHORTS, // bgm bar mood: dark
			).bgm.moodMatched;
		expect(withMood("dark")).toBe(true);
		expect(withMood(" Dark ")).toBe(true);
		expect(withMood("mysterious")).toBe(true);
		expect(withMood("upbeat")).toBe(false);
		expect(withMood(undefined)).toBe(false);
	});

	it("hasCuePlan = hasBeatGrid 패스스루", () => {
		expect(
			collectJudgeSignals(denseBundle(), HORROR_SHORTS).bgm.hasCuePlan,
		).toBe(true);
		expect(
			collectJudgeSignals(flatBundle(), HORROR_SHORTS).bgm.hasCuePlan,
		).toBe(false);
	});
});

describe("collectJudgeSignals — tts", () => {
	it("coverageRatio 패스스루 + 0..1 클램프", () => {
		const dense = collectJudgeSignals(denseBundle(), HORROR_SHORTS);
		expect(dense.tts.coverageRatio).toBe(0.9);

		const over = collectJudgeSignals(
			makeBundle({ scenes: [bscene({})], tts: { coverageRatio: 1.5 } }),
			HORROR_SHORTS,
		);
		expect(over.tts.coverageRatio).toBe(1);
	});

	it("speedDelta = speed - 벤치마크 speed, 미지정 시 기본 1.0 가정", () => {
		const scenes = [bscene({})];
		// generic shorts bar: 1.05
		const fast = collectJudgeSignals(
			makeBundle({ scenes, tts: { coverageRatio: 0, speed: 1.25 } }),
			GENERIC_SHORTS,
		);
		expect(fast.tts.speedDelta).toBe(0.2);

		const unknown = collectJudgeSignals(makeBundle({ scenes }), GENERIC_SHORTS);
		expect(unknown.tts.speedDelta).toBe(-0.05);
	});

	it("profileMatched — 정규화 비교, 미지정 시 false", () => {
		const scenes = [bscene({})];
		const withProfile = (profile?: string) =>
			collectJudgeSignals(
				makeBundle({ scenes, tts: { coverageRatio: 0, profile } }),
				HORROR_SHORTS, // tts bar profile: suspense
			).tts.profileMatched;
		expect(withProfile("suspense")).toBe(true);
		expect(withProfile(" Suspense ")).toBe(true);
		expect(withProfile("news")).toBe(false);
		expect(withProfile(undefined)).toBe(false);
	});

	it("wordTimingCoverage — 나레이션 있는 씬 중 타이밍 보유 비율", () => {
		const bundle = makeBundle({
			scenes: [
				bscene({ id: "a", orderIndex: 0, hasWordTimings: true }),
				bscene({ id: "b", orderIndex: 1, hasWordTimings: false }),
				// 빈 나레이션 씬은 분모/분자에서 제외
				bscene({
					id: "c",
					orderIndex: 2,
					narration: "",
					hasWordTimings: true,
				}),
			],
		});
		const signals = collectJudgeSignals(bundle, HORROR_SHORTS);
		expect(signals.tts.wordTimingCoverage).toBe(0.5);
	});
});

describe("collectJudgeSignals — 빈 번들 fail-closed", () => {
	it("씬 0개 → 모든 점수 0 + zero_scenes 이슈", () => {
		const empty = makeBundle({ scenes: [] });
		const signals = collectJudgeSignals(empty, HORROR_SHORTS);

		expect(signals.editing.editorialDensityScore).toBe(0);
		expect(signals.editing.premiumFloorScore).toBe(0);
		expect(signals.editing.openingRetentionScore).toBe(0);
		expect(signals.editing.avgCutSec).toBe(0);
		expect(signals.editing.motionRatio).toBe(0);
		expect(signals.editing.captionsPerMin).toBe(0);
		expect(signals.editing.issues).toContain("zero_scenes");
		expect(signals.editing.issues).toContain("opening_no_scenes");

		expect(signals.script.hookPattern).toBe("");
		expect(signals.script.hookSec).toBe(0);
		expect(signals.script.chapterCount).toBe(0);
		expect(signals.script.pacing).toBe("normal");
		expect(signals.script.emptyNarrationCount).toBe(0);
	});
});
