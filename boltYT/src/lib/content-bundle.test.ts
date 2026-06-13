import { describe, expect, it } from "vitest";
import type { Scene } from "../types/database";
import {
	buildContentBundle,
	type ContentBundle,
	hashContentBundle,
	segmentBundleIntoChapters,
} from "./content-bundle";

function scene(overrides: Partial<Scene>): Scene {
	return {
		id: "s1",
		script_id: "script-1",
		order_index: 0,
		narration_text: "어두운 밤, 사건이 시작됐다",
		scene_type: "image",
		visual_prompt: "dark alley, rain",
		duration_seconds: 6,
		created_at: "2026-06-01T00:00:00Z",
		...overrides,
	};
}

function fullScene(overrides: Partial<Scene>): Scene {
	return scene({
		shots: [
			{ id: "shot-1", camera: "static" } as unknown as Scene["shots"] extends
				| Array<infer T>
				| undefined
				? T
				: never,
		],
		word_timings: [{ word: "어두운", startFrame: 0, endFrame: 12 }],
		motion_graphics: [],
		transition: "crossfade",
		mood: "horror",
		source_index: 2,
		...overrides,
	});
}

/** 객체 키 순서를 역순으로 재구성 (값 동일) */
function shuffleKeys<T extends Record<string, unknown>>(obj: T): T {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(obj).reverse()) {
		const value = obj[key];
		out[key] =
			value !== null && typeof value === "object" && !Array.isArray(value)
				? shuffleKeys(value as Record<string, unknown>)
				: value;
	}
	return out as T;
}

const FP = "bench-v1:fnv";

describe("buildContentBundle", () => {
	it("Scene 필드를 화이트리스트 투영으로 정규화한다", () => {
		const bundle = buildContentBundle({
			contentId: "c1",
			format: "shorts",
			scenes: [fullScene({})],
			scriptStructure: ["hook", "body", "cta"],
			tts: { provider: "openai", voiceId: "onyx", speed: 1.1 },
			bgm: { source: "ai_generated", hasBeatGrid: true, claimBlocked: false },
		});

		expect(bundle.scenes).toHaveLength(1);
		const s = bundle.scenes[0];
		expect(s).toMatchObject({
			id: "s1",
			orderIndex: 0,
			narration: "어두운 밤, 사건이 시작됐다",
			durationSec: 6,
			type: "image",
			shotCount: 1,
			motionGraphicCount: 0,
			hasWordTimings: true,
			sourceIndex: 2,
			transition: "crossfade",
			mood: "horror",
		});
		// 비결정 필드는 투영에 포함되지 않는다
		expect("created_at" in (s as unknown as Record<string, unknown>)).toBe(
			false,
		);
		expect(bundle.durationSec).toBe(6);
		expect(bundle.scriptStructure).toEqual(["hook", "body", "cta"]);
		expect(bundle.bgm.source).toBe("ai_generated");
		expect(bundle.bgm.claimBlocked).toBe(false);
	});

	it("shots/word_timings 결측 Scene 도 0/false 로 가드한다", () => {
		const bundle = buildContentBundle({
			contentId: "c1",
			format: "shorts",
			scenes: [scene({})],
		});

		const s = bundle.scenes[0];
		expect(s?.shotCount).toBe(0);
		expect(s?.motionGraphicCount).toBe(0);
		expect(s?.hasWordTimings).toBe(false);
		expect(s?.sourceIndex).toBeUndefined();
		expect(bundle.tts.coverageRatio).toBe(0);
		expect(bundle.bgm.hasBeatGrid).toBe(false);
	});

	it("durationSec 은 씬 합산이며 입력 순서와 무관하게 order_index 로 정렬한다", () => {
		const bundle = buildContentBundle({
			contentId: "c1",
			format: "longform",
			scenes: [
				scene({ id: "b", order_index: 1, duration_seconds: 10 }),
				scene({ id: "a", order_index: 0, duration_seconds: 4 }),
			],
		});

		expect(bundle.durationSec).toBe(14);
		expect(bundle.scenes.map((s) => s.id)).toEqual(["a", "b"]);
	});

	it("coverageRatio 미지정 시 word_timings 보유 씬 비율로 유도하고 지정 시 0..1 로 클램프한다", () => {
		const derived = buildContentBundle({
			contentId: "c1",
			format: "shorts",
			scenes: [
				fullScene({ id: "a", order_index: 0 }),
				scene({ id: "b", order_index: 1 }),
			],
		});
		expect(derived.tts.coverageRatio).toBe(0.5);

		const clamped = buildContentBundle({
			contentId: "c1",
			format: "shorts",
			scenes: [scene({})],
			tts: { coverageRatio: 3 },
		});
		expect(clamped.tts.coverageRatio).toBe(1);
	});

	it("duration_seconds 가 비정상(음수/NaN)이면 0 으로 가드한다", () => {
		const bundle = buildContentBundle({
			contentId: "c1",
			format: "shorts",
			scenes: [
				scene({ id: "a", order_index: 0, duration_seconds: -5 }),
				scene({ id: "b", order_index: 1, duration_seconds: Number.NaN }),
			],
		});
		expect(bundle.durationSec).toBe(0);
	});
});

describe("hashContentBundle — 멱등 불변량", () => {
	function baseBundle(): ContentBundle {
		return buildContentBundle({
			contentId: "c1",
			format: "shorts",
			scenes: [
				fullScene({ id: "a", order_index: 0 }),
				scene({ id: "b", order_index: 1 }),
			],
			scriptStructure: ["hook", "body"],
			tts: { provider: "openai", coverageRatio: 0.5 },
			bgm: { source: "preset", hasBeatGrid: true },
		});
	}

	it("같은 입력 2회 → 같은 해시", () => {
		expect(hashContentBundle(baseBundle(), FP)).toBe(
			hashContentBundle(baseBundle(), FP),
		);
	});

	it("객체 키 순서를 셔플해도 같은 해시", () => {
		const original = baseBundle();
		const shuffled = shuffleKeys(
			original as unknown as Record<string, unknown>,
		) as unknown as ContentBundle;
		expect(Object.keys(shuffled)).not.toEqual(Object.keys(original));
		expect(hashContentBundle(shuffled, FP)).toBe(
			hashContentBundle(original, FP),
		);
	});

	it("created_at/updatedAt/judgedAt 등 비결정 필드가 끼어들어도 같은 해시", () => {
		const original = baseBundle();
		const polluted = {
			...baseBundle(),
			created_at: "2026-06-11T09:00:00Z",
			updatedAt: Date.now(),
			judgedAt: "later",
		} as unknown as ContentBundle;
		expect(hashContentBundle(polluted, FP)).toBe(
			hashContentBundle(original, FP),
		);
	});

	it("undefined 값 필드는 키 부재와 동일하게 취급한다", () => {
		const original = baseBundle();
		const withUndefined = {
			...baseBundle(),
			extraneous: undefined,
		} as unknown as ContentBundle;
		expect(hashContentBundle(withUndefined, FP)).toBe(
			hashContentBundle(original, FP),
		);
	});

	it("내용이 바뀌면 해시도 바뀐다 (narration / bgm / fingerprint)", () => {
		const original = baseBundle();
		const base = hashContentBundle(original, FP);

		const edited = baseBundle();
		const firstScene = edited.scenes[0];
		if (firstScene) firstScene.narration = "전혀 다른 내레이션";
		expect(hashContentBundle(edited, FP)).not.toBe(base);

		const bgmChanged = baseBundle();
		bgmChanged.bgm.claimBlocked = true;
		expect(hashContentBundle(bgmChanged, FP)).not.toBe(base);

		expect(hashContentBundle(original, "bench-v2:fnv")).not.toBe(base);
	});

	it("property: 랜덤 번들 50개 각각에서 키 셔플 해시 = 원본 해시", () => {
		for (let i = 0; i < 50; i++) {
			const bundle = buildContentBundle({
				contentId: `c${i}`,
				format: i % 2 === 0 ? "shorts" : "longform",
				scenes: Array.from({ length: (i % 5) + 1 }, (_, j) =>
					scene({
						id: `s${i}-${j}`,
						order_index: j,
						duration_seconds: (j + 1) * 3,
						narration_text: `narration ${i}-${j}`,
					}),
				),
				bgm: { hasBeatGrid: i % 3 === 0 },
			});
			const shuffled = shuffleKeys(
				bundle as unknown as Record<string, unknown>,
			) as unknown as ContentBundle;
			expect(hashContentBundle(shuffled, FP)).toBe(
				hashContentBundle(bundle, FP),
			);
		}
	});
});

describe("segmentBundleIntoChapters", () => {
	function longformBundle(sceneCount: number, sceneDur: number): ContentBundle {
		return buildContentBundle({
			contentId: "long-1",
			format: "longform",
			scenes: Array.from({ length: sceneCount }, (_, i) =>
				scene({ id: `s${i}`, order_index: i, duration_seconds: sceneDur }),
			),
		});
	}

	it("600초를 120초 단위로 → 5챕터, 경계 연속", () => {
		const bundle = longformBundle(10, 60); // 600초
		const chapters = segmentBundleIntoChapters(bundle, 120);

		expect(chapters).toHaveLength(5);
		expect(chapters.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
		expect(chapters[0]).toMatchObject({ startSec: 0, endSec: 120 });
		expect(chapters[4]).toMatchObject({ startSec: 480, endSec: 600 });
		// 챕터 경계는 빈틈 없이 연속
		for (let i = 1; i < chapters.length; i++) {
			expect(chapters[i]?.startSec).toBe(chapters[i - 1]?.endSec);
		}
	});

	it("씬 경계를 보존한다 — 씬이 챕터에 걸쳐 쪼개지지 않는다", () => {
		// 70초 씬 × 9 = 630초, 120초 단위 → 씬 경계에서만 닫힘
		const bundle = longformBundle(9, 70);
		const chapters = segmentBundleIntoChapters(bundle, 120);

		const allIds = chapters.flatMap((c) => c.scenes.map((s) => s.id));
		expect(allIds).toEqual(bundle.scenes.map((s) => s.id));
		for (const chapter of chapters) {
			const dur = chapter.scenes.reduce((sum, s) => sum + s.durationSec, 0);
			expect(chapter.endSec - chapter.startSec).toBe(dur);
			// 씬 경계 기준이므로 챕터 길이는 임계 이상이거나(닫힘) 마지막 잔여
			expect(dur % 70).toBe(0);
		}
	});

	it("마지막 잔여 씬들은 마지막 챕터로 포함한다", () => {
		// 60초 × 10 + 50초 1개 = 650초 → 5개 풀 챕터 + 잔여 50초 챕터
		const bundle = buildContentBundle({
			contentId: "long-2",
			format: "longform",
			scenes: [
				...Array.from({ length: 10 }, (_, i) =>
					scene({ id: `s${i}`, order_index: i, duration_seconds: 60 }),
				),
				scene({ id: "tail", order_index: 10, duration_seconds: 50 }),
			],
		});
		const chapters = segmentBundleIntoChapters(bundle, 120);

		expect(chapters).toHaveLength(6);
		const last = chapters[5];
		expect(last).toMatchObject({ startSec: 600, endSec: 650 });
		expect(last?.scenes.map((s) => s.id)).toEqual(["tail"]);
	});

	it("씬이 없으면 빈 배열", () => {
		const bundle = buildContentBundle({
			contentId: "empty",
			format: "shorts",
			scenes: [],
		});
		expect(segmentBundleIntoChapters(bundle, 120)).toEqual([]);
	});

	it("chapterEverySec 이 0 이하/비유한이면 전체를 챕터 1개로 반환", () => {
		const bundle = longformBundle(3, 60);
		for (const invalid of [0, -10, Number.NaN]) {
			const chapters = segmentBundleIntoChapters(bundle, invalid);
			expect(chapters).toHaveLength(1);
			expect(chapters[0]).toMatchObject({ startSec: 0, endSec: 180 });
			expect(chapters[0]?.scenes).toHaveLength(3);
		}
	});

	it("임계보다 긴 단일 씬은 자기 챕터 하나를 차지한다", () => {
		const bundle = buildContentBundle({
			contentId: "long-3",
			format: "longform",
			scenes: [
				scene({ id: "big", order_index: 0, duration_seconds: 300 }),
				scene({ id: "next", order_index: 1, duration_seconds: 60 }),
			],
		});
		const chapters = segmentBundleIntoChapters(bundle, 120);
		expect(chapters).toHaveLength(2);
		expect(chapters[0]?.scenes.map((s) => s.id)).toEqual(["big"]);
		expect(chapters[1]?.scenes.map((s) => s.id)).toEqual(["next"]);
	});
});
