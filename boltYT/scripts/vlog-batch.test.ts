import { describe, expect, it } from "vitest";
import {
	canonicalRenderKey,
	computePlan,
	type JobSpec,
	jobId,
	jobToArgs,
	type Ledger,
	mergeTopupTopics,
	normalizeJob,
	parseManifest,
} from "./vlog-batch.ts";

const emptyLedger = (): Ledger => ({ version: 1, jobs: {} });
const hist = (era: string, extra: Partial<JobSpec> = {}): JobSpec => ({
	era,
	genre: "history",
	...extra,
});

describe("normalizeJob", () => {
	it("문자열 → era + 기본 장르", () => {
		expect(normalizeJob("고대 로마")).toEqual({
			era: "고대 로마",
			genre: "history",
		});
	});
	it("공백 트림", () => {
		expect(normalizeJob("  조선  ").era).toBe("조선");
	});
	it("객체 옵션 보존 + 숫자 강제", () => {
		expect(normalizeJob({ era: "조선", minutes: "10", channel: "ch" })).toEqual(
			{
				era: "조선",
				genre: "history",
				minutes: 10,
				channel: "ch",
			},
		);
	});
	it("defaults 로 누락 채움(잡 값이 우선)", () => {
		expect(normalizeJob("로마", { minutes: 8, genre: "history" }).minutes).toBe(
			8,
		);
		expect(
			normalizeJob({ era: "로마", minutes: 12 }, { minutes: 8 }).minutes,
		).toBe(12);
	});
	it("era 누락 → throw", () => {
		expect(() => normalizeJob({ minutes: 5 })).toThrow();
		expect(() => normalizeJob("")).toThrow();
	});
});

describe("parseManifest", () => {
	it("문자열/객체 혼용 배열", () => {
		const jobs = parseManifest('["로마", {"era":"조선","minutes":10}]');
		expect(jobs).toHaveLength(2);
		expect(jobs[0].era).toBe("로마");
		expect(jobs[1].minutes).toBe(10);
	});
	it("배열 아님 → throw", () => {
		expect(() => parseManifest('{"era":"로마"}')).toThrow();
	});
	it("깨진 JSON → throw", () => {
		expect(() => parseManifest("not json")).toThrow();
	});
});

describe("jobId", () => {
	it("동일 산출물 → 동일 ID", () => {
		expect(jobId(hist("로마", { minutes: 10 }))).toBe(
			jobId(hist("로마", { minutes: 10 })),
		);
	});
	it("필드 다르면 다른 ID", () => {
		const a = jobId(hist("로마", { minutes: 10 }));
		expect(jobId(hist("로마", { minutes: 5 }))).not.toBe(a);
		expect(jobId(hist("조선", { minutes: 10 }))).not.toBe(a);
		expect(jobId(hist("로마", { minutes: 10, channel: "x" }))).not.toBe(a);
		expect(jobId({ era: "로마", genre: "economy", minutes: 10 })).not.toBe(a);
	});
	it("minutes 있으면 scenes 무시(실효 렌더 인자 dedup, Codex P2)", () => {
		const base = jobId(hist("로마", { minutes: 10 }));
		expect(jobId(hist("로마", { minutes: 10, scenes: 4 }))).toBe(base);
		expect(jobId(hist("로마", { minutes: 10, scenes: 5 }))).toBe(base);
	});
	it("minutes 없으면 scenes 가 ID 에 반영", () => {
		expect(jobId(hist("로마", { scenes: 4 }))).not.toBe(
			jobId(hist("로마", { scenes: 6 })),
		);
	});
	it("resolveEra 별칭 dedup: '로마' = '고대 로마' (Codex P2)", () => {
		expect(jobId(hist("로마"))).toBe(jobId(hist("고대 로마")));
	});
	it("make-vlog 기본값 dedup: 미지정 = 명시 기본값", () => {
		expect(jobId(hist("로마"))).toBe(jobId(hist("로마", { scenes: 4 })));
		expect(jobId(hist("로마"))).toBe(
			jobId(hist("로마", { channel: "my-history" })),
		);
	});
	it("scenes [2,8] 클램프: 10 = 8", () => {
		expect(jobId(hist("로마", { scenes: 10 }))).toBe(
			jobId(hist("로마", { scenes: 8 })),
		);
	});
	it("style: 미지정=illustration(새 기본) ≠ photoreal(레거시 키 보존)", () => {
		const illus = jobId(hist("로마", { minutes: 10 }));
		expect(jobId(hist("로마", { minutes: 10, style: "illustration" }))).toBe(
			illus,
		);
		expect(jobId(hist("로마", { minutes: 10, style: "photoreal" }))).not.toBe(
			illus,
		);
	});
	it("photoreal 키는 style 필드 미추가(레거시 ledger 호환)", () => {
		// 과거(style 도입 전) 키 = genre|era|minutes|scenes|channel|ffmpeg, 끝에 style 없음.
		expect(
			canonicalRenderKey(hist("로마", { minutes: 10, style: "photoreal" })),
		).toBe("history|ancient-rome-44ad|10||my-history|0");
	});
});

describe("computePlan", () => {
	// resolveEra 가 짧은 문자열을 프리셋에 느슨히 매칭하므로(예 "a"⊂"ancient rome") 테스트는
	// 서로 다른 era.id 로 해소되는 실제 시대명을 쓴다(조선/이집트/로마 = joseon/egypt/rome).
	it("never-seen → 모두 대기", () => {
		const plan = computePlan([hist("조선"), hist("이집트")], emptyLedger());
		expect(plan.pending).toHaveLength(2);
		expect(plan.doneCount).toBe(0);
	});
	it("완료는 스킵", () => {
		const jobs = [hist("조선"), hist("이집트")];
		const l = emptyLedger();
		l.jobs[jobId(jobs[0])] = {
			spec: jobs[0],
			status: "done",
			attempts: 1,
			updatedAt: 0,
		};
		const plan = computePlan(jobs, l);
		expect(plan.doneCount).toBe(1);
		expect(plan.pending.map((j) => j.era)).toEqual(["이집트"]);
	});
	it("실패는 한도 내 재시도", () => {
		const jobs = [hist("a")];
		const l = emptyLedger();
		l.jobs[jobId(jobs[0])] = {
			spec: jobs[0],
			status: "failed",
			attempts: 1,
			updatedAt: 0,
		};
		expect(computePlan(jobs, l, { maxAttempts: 3 }).pending).toHaveLength(1);
	});
	it("실패 한도 초과 → 보류(parked), retryFailed 면 재시도", () => {
		const jobs = [hist("a")];
		const l = emptyLedger();
		l.jobs[jobId(jobs[0])] = {
			spec: jobs[0],
			status: "failed",
			attempts: 3,
			updatedAt: 0,
		};
		expect(computePlan(jobs, l, { maxAttempts: 3 }).parkedCount).toBe(1);
		expect(computePlan(jobs, l, { maxAttempts: 3 }).pending).toHaveLength(0);
		expect(
			computePlan(jobs, l, { maxAttempts: 3, retryFailed: true }).pending,
		).toHaveLength(1);
	});
	it("--max 캡(pendingTotal 은 캡 전)", () => {
		const jobs = [hist("조선"), hist("이집트"), hist("로마")];
		const plan = computePlan(jobs, emptyLedger(), { max: 2 });
		expect(plan.pending).toHaveLength(2);
		expect(plan.pendingTotal).toBe(3);
	});
	it("매니페스트 내 중복 잡 제거", () => {
		const plan = computePlan([hist("a"), hist("a")], emptyLedger());
		expect(plan.pending).toHaveLength(1);
	});
});

describe("mergeTopupTopics", () => {
	it("seenIds 및 내부 중복 제거", () => {
		const seen = new Set([jobId(hist("로마"))]);
		const fresh = mergeTopupTopics(
			["로마", "조선", "조선", "이집트"],
			{ genre: "history" },
			seen,
		);
		expect(fresh.map((j) => j.era)).toEqual(["조선", "이집트"]);
	});
	it("빈/공백 토픽 무시", () => {
		expect(
			mergeTopupTopics(["", "  ", "로마"], { genre: "history" }, new Set()),
		).toHaveLength(1);
	});
});

describe("jobToArgs", () => {
	it("history minutes 우선, --out 포함", () => {
		expect(jobToArgs(hist("로마", { minutes: 10, scenes: 4 }), "/o")).toEqual([
			"--era",
			"로마",
			"--minutes",
			"10",
			"--out",
			"/o",
		]);
	});
	it("minutes 없으면 scenes", () => {
		expect(jobToArgs(hist("로마", { scenes: 6 }), "/o")).toContain("--scenes");
	});
	it("미지원 장르 → throw", () => {
		expect(() => jobToArgs({ era: "x", genre: "economy" }, "/o")).toThrow();
	});
	it("style 전달 시 --style 포함", () => {
		const a = jobToArgs(
			hist("로마", { minutes: 10, style: "photoreal" }),
			"/o",
		);
		expect(a).toContain("--style");
		expect(a[a.indexOf("--style") + 1]).toBe("photoreal");
	});
	it("style 미지정 시 --style 미포함(make-vlog 기본 illustration)", () => {
		expect(jobToArgs(hist("로마", { minutes: 10 }), "/o")).not.toContain(
			"--style",
		);
	});
});
