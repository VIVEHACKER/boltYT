import { describe, expect, it } from "vitest";
import {
	type HistoricalVlogChannelInput,
	planHistoricalVlogChannel,
} from "./historical-vlog-factory";

function input(
	overrides: Partial<HistoricalVlogChannelInput> = {},
): HistoricalVlogChannelInput {
	return { channelId: "chan-1", ...overrides };
}

describe("planHistoricalVlogChannel — 기본 동작", () => {
	it("호스트 없으면 스타터 호스트를 자동 생성하고 정체성을 고정", () => {
		const plan = planHistoricalVlogChannel(input());
		expect(plan.host.channelId).toBe("chan-1");
		expect(plan.hostIdentity.styleSeed).toBeGreaterThan(0);
		expect(plan.hostReferencePrompt).toContain("headshot");
	});

	it("시대 미지정 시 큐레이션 풀에서 자동 제안(4개)", () => {
		const plan = planHistoricalVlogChannel(input());
		expect(plan.episodes.length).toBe(4);
	});

	it("historical_vlog × longform 시장 바를 사용", () => {
		const plan = planHistoricalVlogChannel(input());
		expect(plan.benchmark.genre).toBe("historical_vlog");
		expect(plan.benchmark.format).toBe("longform");
	});
});

describe("키스톤 — 모든 에피소드가 동일 호스트 잠금을 받는다", () => {
	it("hostMediaLock 이 에피소드 전체에서 동일(동일 인물 보장)", () => {
		const plan = planHistoricalVlogChannel(
			input({
				eras: ["ancient-rome-44ad", "titanic-1912", "ice-age"],
			}),
		);
		const locks = plan.episodes.map((ep) => ep.hostMediaLock);
		const first = locks[0];
		for (const lock of locks) {
			expect(lock.seed).toBe(first.seed);
			expect(lock.referenceImagePath).toBe(first.referenceImagePath);
		}
		// 잠금은 호스트 정체성에서 나온다
		expect(first.seed).toBe(plan.hostIdentity.styleSeed);
		expect(first.referenceImagePath).toBe(plan.hostIdentity.referenceSheetPath);
	});

	it("레퍼런스 시트는 채널 스코프(에피소드/스크립트 무관)", () => {
		const plan = planHistoricalVlogChannel(input());
		expect(plan.hostIdentity.referenceSheetPath).toContain(
			"channels/chan-1/host/",
		);
	});
});

describe("제목/썸네일/챕터 — 검증된 공식", () => {
	it("각 에피소드에 KO/EN 제목, 썸네일, 6비트 챕터", () => {
		const plan = planHistoricalVlogChannel(
			input({ eras: ["ancient-rome-44ad"], locale: "ko" }),
		);
		const ep = plan.episodes[0];
		expect(ep.title).toContain("시간 여행");
		expect(ep.titleEn).toContain("Time Traveled");
		expect(ep.thumbnail.bigText).toBe("44 AD");
		expect(ep.chapters).toHaveLength(6);
	});
});

describe("듀얼언어 — KO→EN 현지화", () => {
	it("ko 기본은 en-US 를 타깃으로 현지화 계획을 만든다", () => {
		const plan = planHistoricalVlogChannel(input({ locale: "ko" }));
		expect(plan.episodes[0].localization).not.toBeNull();
		const variants = plan.episodes[0].localization?.variants ?? [];
		expect(variants.some((v) => v.language === "en")).toBe(true);
	});

	it("estimatedOutputs = 에피소드 × (1 + 현지화 변형 수)", () => {
		const plan = planHistoricalVlogChannel(
			input({ eras: ["ancient-rome-44ad", "titanic-1912"] }),
		);
		const perEp = plan.episodes[0].localization?.variants.length ?? 0;
		expect(plan.estimatedOutputs).toBe(2 * (1 + perEp));
	});

	it("targetLocales=[] 면 현지화 없음", () => {
		const plan = planHistoricalVlogChannel(input({ targetLocales: [] }));
		expect(plan.episodes[0].localization).toBeNull();
		expect(plan.estimatedOutputs).toBe(plan.episodes.length);
	});
});

describe("다양성/슬롭 위험 경고", () => {
	it("서로 다른 시대는 다양성이 높다", () => {
		const plan = planHistoricalVlogChannel(
			input({ eras: ["ancient-rome-44ad", "titanic-1912", "ice-age"] }),
		);
		expect(plan.variation.score).toBeGreaterThanOrEqual(70);
	});

	it("결정론 — 같은 입력은 같은 핵심 출력", () => {
		const a = planHistoricalVlogChannel(input({ eras: ["ice-age"] }));
		const b = planHistoricalVlogChannel(input({ eras: ["ice-age"] }));
		expect(a.episodes[0].title).toBe(b.episodes[0].title);
		expect(a.hostIdentity.styleSeed).toBe(b.hostIdentity.styleSeed);
		expect(a.estimatedOutputs).toBe(b.estimatedOutputs);
	});

	it("summary 에 호스트/시대수/다양성이 요약된다", () => {
		const plan = planHistoricalVlogChannel(input());
		expect(plan.summary).toContain("호스트");
		expect(plan.summary).toContain("다양성");
	});
});
