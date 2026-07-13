import { describe, expect, it } from "vitest";
import {
	type BenchmarkGenre,
	type BenchmarkReferenceSample,
	benchmarkFingerprint,
	classifyBenchmarkGenre,
	getBuiltinBenchmark,
	learnBenchmarkFromSamples,
	type MarketBenchmark,
	resolveMarketBenchmark,
} from "./market-benchmark";

const GENRES: BenchmarkGenre[] = [
	"horror_mystery",
	"news_issue",
	"drama_recap",
	"docu_story",
	"generic",
];
function shortsSample(
	overrides: Partial<BenchmarkReferenceSample> = {},
): BenchmarkReferenceSample {
	return { format: "shorts", ...overrides };
}

/** 키 순서를 뒤집어 재구성 — fingerprint 키 순서 무관 검증용 */
function reverseKeys<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => reverseKeys(item)) as T;
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const rebuilt: Record<string, unknown> = {};
		for (const key of Object.keys(record).reverse()) {
			rebuilt[key] = reverseKeys(record[key]);
		}
		return rebuilt as T;
	}
	return value;
}

function asCore(
	benchmark: MarketBenchmark,
): Omit<MarketBenchmark, "fingerprint" | "updatedAt"> {
	const { fingerprint: _f, updatedAt: _u, ...core } = benchmark;
	return core;
}

describe("getBuiltinBenchmark", () => {
	it("5장르×2포맷 전 조합에 프리셋이 존재하고 수치 sanity 를 만족한다", () => {
		for (const genre of GENRES) {
			const shorts = getBuiltinBenchmark(genre, "shorts");
			const longform = getBuiltinBenchmark(genre, "longform");

			for (const b of [shorts, longform]) {
				expect(b.genre).toBe(genre);
				expect(b.source).toBe("builtin");
				expect(b.sampleCount).toBe(0);
				expect(b.confidence).toBeGreaterThan(0);
				expect(b.confidence).toBeLessThan(1);
				expect(b.fingerprint).toMatch(/^[0-9a-f]{8}$/);
				expect(b.bgm.integratedLufs).toBeLessThan(0);
				expect(b.bgm.duckingDb).toBeLessThan(0);
				expect(b.script.structureRoles.length).toBeGreaterThan(0);
				expect(b.script.minScenes).toBeGreaterThan(0);
			}

			// 쇼츠: 컷 밀도 2.5-3.0s, 훅 3s 이내, 자막 25-30/min
			expect(shorts.editing.cutDensitySec).toBeGreaterThanOrEqual(2.5);
			expect(shorts.editing.cutDensitySec).toBeLessThanOrEqual(3.0);
			expect(shorts.editing.hookSec).toBeLessThanOrEqual(3);
			expect(shorts.script.hookSec).toBeLessThanOrEqual(3);
			expect(shorts.editing.captionsPerMin).toBeGreaterThanOrEqual(25);
			expect(shorts.editing.captionsPerMin).toBeLessThanOrEqual(30);
			expect(shorts.script.chapterEverySec).toBeUndefined();

			// 롱폼: 컷 4-5s, 챕터 2-3분 간격, b-roll 40%+
			expect(longform.editing.cutDensitySec).toBeGreaterThanOrEqual(4);
			expect(longform.editing.cutDensitySec).toBeLessThanOrEqual(5);
			expect(longform.editing.bRollRatio).toBeGreaterThanOrEqual(0.4);
			expect(longform.script.chapterEverySec).toBeGreaterThanOrEqual(120);
			expect(longform.script.chapterEverySec).toBeLessThanOrEqual(180);

			// 쇼츠 컷 밀도 < 롱폼 컷 밀도
			expect(shorts.editing.cutDensitySec).toBeLessThan(
				longform.editing.cutDensitySec,
			);

			// 쇼츠 TTS 속도 ≥1.1x(느리면 넘겨짐), 롱폼은 자연 템포(≤1.1 허용)
			expect(shorts.tts.speed).toBeGreaterThanOrEqual(1.1);
			expect(longform.tts.speed).toBeLessThanOrEqual(shorts.tts.speed);
		}
	});
});

describe("learnBenchmarkFromSamples", () => {
	it("터진 영상(구독자 대비 조회수↑)에 가중치를 둔 중앙값을 학습한다", () => {
		// 가중치: 2.0(w1), 3.0(w1), 4.0(views/subs=100 → 상한 10)
		// 누적 가중치 절반(6)에 닿는 값 = 4.0 (비가중 중앙값 3.0 과 다름)
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ cutDensitySec: 2.0 }),
				shortsSample({ cutDensitySec: 3.0 }),
				shortsSample({
					cutDensitySec: 4.0,
					views: 1_000_000,
					channelSubs: 10_000,
				}),
			],
			genre: "generic",
			format: "shorts",
		});

		expect(learned.source).toBe("learned");
		expect(learned.sampleCount).toBe(3);
		expect(learned.editing.cutDensitySec).toBe(4.0);
	});

	it("가중치 없는 샘플들은 일반 중앙값으로 수렴한다", () => {
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ cutDensitySec: 2.0 }),
				shortsSample({ cutDensitySec: 3.0 }),
				shortsSample({ cutDensitySec: 4.0 }),
			],
			genre: "generic",
			format: "shorts",
		});

		expect(learned.editing.cutDensitySec).toBe(3.0);
	});

	it("결측 필드 샘플은 해당 필드 계산에서만 제외된다 (sampleCount 에는 포함)", () => {
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ cutDensitySec: 2.0 }),
				shortsSample({ cutDensitySec: 3.0 }),
				shortsSample({
					cutDensitySec: 4.0,
					views: 1_000_000,
					channelSubs: 10_000,
				}),
				// cutDensitySec 결측 — 컷 밀도 중앙값에 영향 없어야 함
				shortsSample({ hookSec: 1.5 }),
			],
			genre: "generic",
			format: "shorts",
		});

		expect(learned.sampleCount).toBe(4);
		expect(learned.editing.cutDensitySec).toBe(4.0);
		// hookSec 은 유일한 신호 1.5 로 학습
		expect(learned.editing.hookSec).toBe(1.5);
		expect(learned.script.hookSec).toBe(1.5);
	});

	it("모든 샘플이 결측인 필드는 프리셋 값을 유지한다", () => {
		const base = getBuiltinBenchmark("generic", "shorts");
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ cutDensitySec: 2.0 }),
				shortsSample({ cutDensitySec: 2.5 }),
				shortsSample({ cutDensitySec: 3.0 }),
			],
			genre: "generic",
			format: "shorts",
		});

		expect(learned.editing.captionsPerMin).toBe(base.editing.captionsPerMin);
		expect(learned.tts.speed).toBe(base.tts.speed);
		expect(learned.bgm.integratedLufs).toBe(base.bgm.integratedLufs);
	});

	it("느린 샘플을 학습해도 쇼츠 TTS 속도는 1.1x 하한을 지킨다", () => {
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ ttsSpeed: 1.0 }),
				shortsSample({ ttsSpeed: 1.0 }),
				shortsSample({ ttsSpeed: 1.0 }),
			],
			genre: "generic",
			format: "shorts",
		});
		expect(learned.tts.speed).toBeGreaterThanOrEqual(1.1);
	});

	it("sampleCount<3 이면 confidence<0.5 + 프리셋과 블렌딩된 hybrid 가 된다", () => {
		const base = getBuiltinBenchmark("generic", "shorts");
		const hybrid = learnBenchmarkFromSamples({
			samples: [shortsSample({ cutDensitySec: 6.0 })],
			genre: "generic",
			format: "shorts",
		});

		expect(hybrid.source).toBe("hybrid");
		expect(hybrid.confidence).toBeLessThan(0.5);
		// 블렌딩: 프리셋(2.7)과 샘플(6.0) 사이 — 1/3 비율
		expect(hybrid.editing.cutDensitySec).toBeGreaterThan(
			base.editing.cutDensitySec,
		);
		expect(hybrid.editing.cutDensitySec).toBeLessThan(6.0);
		expect(hybrid.editing.cutDensitySec).toBeCloseTo(
			base.editing.cutDensitySec + (6.0 - base.editing.cutDensitySec) / 3,
			4,
		);
	});

	it("학습(3+)이면 bgm mood 를 가중 최빈값으로 교체, hybrid 는 프리셋 유지", () => {
		const base = getBuiltinBenchmark("generic", "shorts");
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ bgmMood: "dark" }),
				shortsSample({ bgmMood: "DARK " }),
				shortsSample({ bgmMood: "calm" }),
			],
			genre: "generic",
			format: "shorts",
		});
		expect(learned.bgm.mood).toBe("dark");

		const hybrid = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ bgmMood: "epic" }),
				shortsSample({ bgmMood: "epic" }),
			],
			genre: "generic",
			format: "shorts",
		});
		expect(hybrid.bgm.mood).toBe(base.bgm.mood);
	});

	it("포맷 불일치 샘플은 학습에서 제외된다", () => {
		const mixed = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ cutDensitySec: 2.0 }),
				shortsSample({ cutDensitySec: 2.4 }),
				{ format: "longform", cutDensitySec: 9.0 },
			],
			genre: "generic",
			format: "shorts",
		});
		// 롱폼 샘플 제외 → 2개만 남아 hybrid
		expect(mixed.source).toBe("hybrid");
		expect(mixed.sampleCount).toBe(2);

		const allWrong = learnBenchmarkFromSamples({
			samples: [{ format: "longform", cutDensitySec: 9.0 }],
			genre: "generic",
			format: "shorts",
		});
		expect(allWrong.source).toBe("builtin");
		expect(allWrong.sampleCount).toBe(0);
	});

	it("NaN/음수 views·메트릭은 결측으로 처리하고 크래시하지 않는다", () => {
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ cutDensitySec: 2.0, views: Number.NaN }),
				shortsSample({ cutDensitySec: 3.0, views: -10, channelSubs: 0 }),
				shortsSample({ cutDensitySec: Number.NaN, hookSec: 2.0 }),
			],
			genre: "generic",
			format: "shorts",
		});

		expect(learned.sampleCount).toBe(3);
		// 유효한 컷 밀도는 [2.0, 3.0] — 가중치 모두 1 → 중앙값 2.0
		expect(learned.editing.cutDensitySec).toBe(2.0);
	});

	it("롱폼 chapterEverySec 도 학습 신호로 블렌딩된다", () => {
		const learned = learnBenchmarkFromSamples({
			samples: [
				{ format: "longform", chapterEverySec: 120 },
				{ format: "longform", chapterEverySec: 120 },
				{ format: "longform", chapterEverySec: 180 },
			],
			genre: "docu_story",
			format: "longform",
		});
		expect(learned.script.chapterEverySec).toBe(120);
	});
});

describe("resolveMarketBenchmark", () => {
	it("샘플 0 → builtin, 1-2 → hybrid, 3+ → learned 로 전환된다", () => {
		const none = resolveMarketBenchmark({
			genre: "horror_mystery",
			format: "shorts",
		});
		expect(none.source).toBe("builtin");
		expect(none.confidence).toBeLessThan(0.5);

		const one = resolveMarketBenchmark({
			genre: "horror_mystery",
			format: "shorts",
			samples: [shortsSample({ cutDensitySec: 2.8 })],
		});
		expect(one.source).toBe("hybrid");
		expect(one.sampleCount).toBe(1);
		expect(one.confidence).toBeLessThan(0.5);

		const two = resolveMarketBenchmark({
			genre: "horror_mystery",
			format: "shorts",
			samples: [
				shortsSample({ cutDensitySec: 2.8 }),
				shortsSample({ cutDensitySec: 2.6 }),
			],
		});
		expect(two.source).toBe("hybrid");
		expect(two.sampleCount).toBe(2);
		expect(two.confidence).toBeLessThan(0.5);

		const three = resolveMarketBenchmark({
			genre: "horror_mystery",
			format: "shorts",
			samples: [
				shortsSample({ cutDensitySec: 2.8 }),
				shortsSample({ cutDensitySec: 2.6 }),
				shortsSample({ cutDensitySec: 2.4 }),
			],
		});
		expect(three.source).toBe("learned");
		expect(three.sampleCount).toBe(3);
		expect(three.confidence).toBeGreaterThanOrEqual(0.5);
	});

	it("빈 samples 배열은 builtin 과 동일하다", () => {
		const resolved = resolveMarketBenchmark({
			genre: "generic",
			format: "longform",
			samples: [],
		});
		const builtin = getBuiltinBenchmark("generic", "longform");
		expect(resolved.fingerprint).toBe(builtin.fingerprint);
		expect(resolved.source).toBe("builtin");
	});
});

describe("benchmarkFingerprint", () => {
	it("같은 입력 2회 → 같은 fingerprint (멱등)", () => {
		const a = getBuiltinBenchmark("horror_mystery", "shorts");
		const b = getBuiltinBenchmark("horror_mystery", "shorts");
		expect(a.fingerprint).toBe(b.fingerprint);
		expect(benchmarkFingerprint(asCore(a))).toBe(a.fingerprint);
	});

	it("키 순서가 달라도 fingerprint 는 동일하다", () => {
		const core = asCore(getBuiltinBenchmark("news_issue", "longform"));
		const reversed = reverseKeys(core);
		expect(benchmarkFingerprint(reversed)).toBe(benchmarkFingerprint(core));
	});

	it("updatedAt 이 달라도 fingerprint 는 동일하다 (비결정 필드 제외)", () => {
		const benchmark = getBuiltinBenchmark("docu_story", "shorts");
		const withStaleTimestamp = {
			...benchmark,
			updatedAt: "2020-01-01T00:00:00.000Z",
		} as unknown as Omit<MarketBenchmark, "fingerprint" | "updatedAt">;
		expect(benchmarkFingerprint(withStaleTimestamp)).toBe(
			benchmark.fingerprint,
		);
	});

	it("내용이 다르면 fingerprint 도 다르다", () => {
		const builtin = getBuiltinBenchmark("generic", "shorts");
		const learned = learnBenchmarkFromSamples({
			samples: [
				shortsSample({ cutDensitySec: 2.0 }),
				shortsSample({ cutDensitySec: 2.2 }),
				shortsSample({ cutDensitySec: 2.4 }),
			],
			genre: "generic",
			format: "shorts",
		});
		expect(learned.fingerprint).not.toBe(builtin.fingerprint);

		const otherGenre = getBuiltinBenchmark("horror_mystery", "shorts");
		expect(otherGenre.fingerprint).not.toBe(builtin.fingerprint);
	});

	it("같은 샘플 입력이면 학습 결과 fingerprint 도 항상 같다", () => {
		const samples = [
			shortsSample({ cutDensitySec: 2.0, views: 500_000, channelSubs: 5_000 }),
			shortsSample({ cutDensitySec: 2.4 }),
			shortsSample({ cutDensitySec: 2.8, bgmMood: "dark" }),
		];
		const first = learnBenchmarkFromSamples({
			samples,
			genre: "horror_mystery",
			format: "shorts",
		});
		const second = learnBenchmarkFromSamples({
			samples: [...samples],
			genre: "horror_mystery",
			format: "shorts",
		});
		expect(first.fingerprint).toBe(second.fingerprint);
	});
});

describe("classifyBenchmarkGenre", () => {
	it("한국어 키워드를 분류한다", () => {
		expect(classifyBenchmarkGenre("한밤중 폐가에서 들린 귀신 소리 괴담")).toBe(
			"horror_mystery",
		);
		expect(classifyBenchmarkGenre("오늘자 속보: 반도체 수출 이슈 정리")).toBe(
			"news_issue",
		);
		expect(classifyBenchmarkGenre("인기 드라마 결말 몰아보기 리캡")).toBe(
			"drama_recap",
		);
		expect(classifyBenchmarkGenre("조선시대 실화 다큐멘터리")).toBe(
			"docu_story",
		);
	});

	it("영어 키워드를 분류한다", () => {
		expect(
			classifyBenchmarkGenre("The unsolved mystery of the haunted house"),
		).toBe("horror_mystery");
		expect(classifyBenchmarkGenre("Breaking news: market scandal")).toBe(
			"news_issue",
		);
		expect(classifyBenchmarkGenre("Movie ending explained recap")).toBe(
			"drama_recap",
		);
		expect(classifyBenchmarkGenre("History documentary about Rome")).toBe(
			"docu_story",
		);
	});

	it("매칭 실패 시 generic 폴백", () => {
		expect(classifyBenchmarkGenre("고양이 브이로그")).toBe("generic");
		expect(classifyBenchmarkGenre("")).toBe("generic");
	});

	it("hints(categoryId/visualMood)가 분류를 보강한다", () => {
		expect(classifyBenchmarkGenre("평범한 주제", { categoryId: "25" })).toBe(
			"news_issue",
		);
		expect(classifyBenchmarkGenre("평범한 주제", { visualMood: "dark" })).toBe(
			"horror_mystery",
		);
		expect(classifyBenchmarkGenre("평범한 주제", { categoryId: "999" })).toBe(
			"generic",
		);
	});

	it("동률이면 우선순위(공포·미스터리 우선)로 결정한다", () => {
		// "미제"(horror +1) vs "사건"(news +1) → 동률 → horror_mystery
		expect(classifyBenchmarkGenre("미제 사건")).toBe("horror_mystery");
	});

	it("대소문자를 무시한다", () => {
		expect(classifyBenchmarkGenre("HORROR Ghost Story")).toBe("horror_mystery");
	});
});
