import { describe, expect, it } from "vitest";
import { getBuiltinBenchmark } from "./market-benchmark";
import type { QualityHistoryStore } from "./quality-fix-history";
import {
	buildQualityProfile,
	loadQualityProfile,
	type QualityProfile,
	qualityProfileToBgmContext,
	qualityProfileToPromptContext,
	qualityProfileToReferencePresetPatch,
	qualityProfileToTtsOptions,
	saveQualityProfile,
} from "./quality-profile";

function memStore(): QualityHistoryStore & { dump(): Map<string, string> } {
	const m = new Map<string, string>();
	return {
		get: (k) => m.get(k) ?? null,
		set: (k, v) => {
			m.set(k, v);
		},
		dump: () => m,
	};
}

function shortsProfile(): QualityProfile {
	return buildQualityProfile({
		topic: "한밤 폐병원 괴담",
		format: "shorts",
		durationSec: 55,
	});
}

function longformProfile(durationSec = 600): QualityProfile {
	return buildQualityProfile({
		topic: "한밤 폐병원 괴담",
		format: "longform",
		durationSec,
	});
}

describe("buildQualityProfile", () => {
	it("쇼츠는 chapters 없이 cuePlan hook_climax_resolve", () => {
		const p = shortsProfile();

		expect(p.script.chapters).toBeUndefined();
		expect(p.bgm.cuePlan).toBe("hook_climax_resolve");
		expect(p.benchmark.format).toBe("shorts");
	});

	it("롱폼은 chapterEverySec 기반 chapters + cuePlan chapter_pulse", () => {
		const p = longformProfile(600);
		const everySec = p.benchmark.script.chapterEverySec ?? 0;

		expect(p.bgm.cuePlan).toBe("chapter_pulse");
		expect(p.script.chapters).toEqual({
			everySec,
			count: Math.ceil(600 / everySec),
		});
	});

	it("topic 장르 분류가 벤치마크에 반영된다 (괴담 → horror_mystery)", () => {
		const p = shortsProfile();

		expect(p.benchmark.genre).toBe("horror_mystery");
		expect(p.tts.profile).toBe("suspense");
		expect(p.bgm.mood).toBe("dark");
	});

	it("benchmark 명시 주입 시 해석을 건너뛰고 그대로 사용한다", () => {
		const injected = getBuiltinBenchmark("news_issue", "shorts");
		const p = buildQualityProfile({
			topic: "한밤 폐병원 괴담",
			format: "shorts",
			durationSec: 55,
			benchmark: injected,
		});

		expect(p.benchmark).toBe(injected);
		expect(p.tts.profile).toBe("news");
	});

	it("captionsPerMin → captionStyle 결정론 분류 (쇼츠 dense / 롱폼 standard)", () => {
		expect(shortsProfile().editing.captionStyle).toBe("dense");
		expect(longformProfile().editing.captionStyle).toBe("standard");
	});

	it("같은 입력이면 benchmark fingerprint 까지 동일 (멱등)", () => {
		const a = shortsProfile();
		const b = shortsProfile();

		expect(a.benchmark.fingerprint).toBe(b.benchmark.fingerprint);
		expect({ ...a, benchmark: null }).toEqual({ ...b, benchmark: null });
	});

	it("durationSec 0/음수여도 롱폼 챕터는 최소 1개", () => {
		expect(longformProfile(0).script.chapters?.count).toBe(1);
		expect(longformProfile(-10).script.chapters?.count).toBe(1);
	});

	it("durationSec 가 everySec 미만이면 count 1, 경계 초과 시 올림", () => {
		const p = longformProfile(600);
		const everySec = p.script.chapters?.everySec ?? 0;

		expect(longformProfile(everySec - 1).script.chapters?.count).toBe(1);
		expect(longformProfile(everySec + 1).script.chapters?.count).toBe(2);
	});
});

describe("qualityProfileToPromptContext", () => {
	it("섹션 헤더와 핵심 수치(훅/컷 밀도/자막/구조)를 포함한다", () => {
		const p = shortsProfile();
		const text = qualityProfileToPromptContext(p);

		expect(text).toContain("=== 시장 품질 기준 ===");
		expect(text).toContain(`첫 ${p.script.hookSec}초`);
		expect(text).toContain(`${p.editing.cutDensitySec}초마다`);
		expect(text).toContain(`분당 ${p.editing.captionsPerMin}개`);
		expect(text).toContain(p.script.structureRoles.join(" → "));
		expect(text).toContain(`${p.bgm.duckingDb}dB`);
		expect(text).not.toContain("챕터:");
	});

	it("롱폼은 챕터 간격/개수 지시문을 포함한다", () => {
		const p = longformProfile(600);
		const text = qualityProfileToPromptContext(p);
		const chapters = p.script.chapters;

		expect(chapters).toBeDefined();
		expect(text).toContain(
			`약 ${chapters?.everySec}초 간격으로 총 ${chapters?.count}개`,
		);
		expect(text).toContain("chapter_pulse");
	});
});

describe("변환기 — 실제 다운스트림 타입 충족", () => {
	it("qualityProfileToTtsOptions: speed + 프로파일 톤 키워드", () => {
		const p = shortsProfile();
		const options = qualityProfileToTtsOptions(p);

		expect(options.speed).toBe(p.tts.speed);
		// suspense 어휘 — tts.ts inferProfileFromOptions 가 suspense 로 역추론하는 키워드
		expect(options.toneKeywords).toContain("긴장감");
		expect(Object.keys(options).sort()).toEqual(["speed", "toneKeywords"]);
	});

	it("qualityProfileToBgmContext: BgmMood 리터럴 보존 + 컷 밀도 기반 tempo", () => {
		const p = shortsProfile();
		const context = qualityProfileToBgmContext(p);

		// "dark" 는 normalizeMood 사각(→calm)이 있으므로 리터럴 우선 매칭 검증
		expect(context.mood).toBe("dark");
		expect(context.keywords).toContain("dark");
		expect(context.tempo).toBe("fast");
		expect(qualityProfileToBgmContext(longformProfile()).tempo).not.toBe(
			"fast",
		);
	});

	it("qualityProfileToBgmContext: 비리터럴 mood 는 정규화한다", () => {
		const p = shortsProfile();
		p.bgm.mood = "Horror Drone";
		const context = qualityProfileToBgmContext(p);

		expect(context.mood).toBe("dark");
		expect(context.keywords).toEqual(["dark", "horror drone"]);
	});

	it("qualityProfileToReferencePresetPatch: tts/bgm 섹션만 완전 구성", () => {
		const p = longformProfile();
		const patch = qualityProfileToReferencePresetPatch(p);

		expect(Object.keys(patch).sort()).toEqual(["bgm", "tts"]);
		expect(patch.tts?.speed).toBe(p.tts.speed);
		expect(patch.tts?.toneKeywords.length).toBeGreaterThan(0);
		expect(patch.bgm?.mood).toBe("dark");
		expect(["slow", "mid", "fast"]).toContain(patch.bgm?.tempo);
		expect(Array.isArray(patch.bgm?.keywords)).toBe(true);
		// script 패치 없음 — 기존 프리셋 값 보존이 계약
		expect(patch.script).toBeUndefined();
	});
});

describe("영속 (saveQualityProfile / loadQualityProfile)", () => {
	it("scriptId 키 라운드트립", () => {
		const store = memStore();
		const p = longformProfile();

		saveQualityProfile("script-1", p, store);
		const loaded = loadQualityProfile("script-1", store);

		expect(loaded).toEqual(p);
		expect(store.dump().has("quality_profile_script-1")).toBe(true);
	});

	it("scriptId 별로 격리되고, 미저장 키는 null", () => {
		const store = memStore();
		saveQualityProfile("script-1", shortsProfile(), store);

		expect(loadQualityProfile("script-2", store)).toBeNull();
	});

	it("깨진 JSON → null", () => {
		const store = memStore();
		store.set("quality_profile_broken", "{not json");

		expect(loadQualityProfile("broken", store)).toBeNull();
	});

	it("형식 불일치(타입가드 실패) → null", () => {
		const store = memStore();
		store.set(
			"quality_profile_bad-shape",
			JSON.stringify({ editing: { cutDensitySec: "3" } }),
		);
		const valid = shortsProfile();
		store.set(
			"quality_profile_bad-cueplan",
			JSON.stringify({
				...valid,
				bgm: { ...valid.bgm, cuePlan: "llm_override" },
			}),
		);

		expect(loadQualityProfile("bad-shape", store)).toBeNull();
		expect(loadQualityProfile("bad-cueplan", store)).toBeNull();
	});

	it("store 미주입(node) 환경에서도 메모리 폴백으로 동작", () => {
		const p = shortsProfile();
		saveQualityProfile("node-fallback", p);

		expect(loadQualityProfile("node-fallback")).toEqual(p);
	});
});
