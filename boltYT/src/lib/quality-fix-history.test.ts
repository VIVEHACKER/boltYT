import { describe, expect, it } from "vitest";
import {
	cacheVerdict,
	type FixHistoryEntry,
	hasAppliedFix,
	loadCachedVerdict,
	loadFixHistory,
	type QualityHistoryStore,
	recordFixApplications,
} from "./quality-fix-history";

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

function entry(overrides: Partial<FixHistoryEntry>): FixHistoryEntry {
	return {
		idempotencyKey: "fix-1",
		actionType: "rewrite_hook",
		bundleHash: "abc123",
		round: 1,
		appliedAt: "2026-06-11T00:00:00.000Z",
		...overrides,
	};
}

describe("quality-fix-history", () => {
	it("주입 store 로 기록한 fix 이력을 그대로 다시 읽는다 (라운드트립)", () => {
		const store = memStore();
		const a = entry({
			idempotencyKey: "fix-a",
			scoreBefore: 50,
			scoreAfter: 70,
		});
		const b = entry({ idempotencyKey: "fix-b", round: 2 });

		recordFixApplications("content-1", [a, b], store);
		const history = loadFixHistory("content-1", store);

		expect(history).toEqual([a, b]);
		expect(hasAppliedFix(history, "fix-a")).toBe(true);
		expect(hasAppliedFix(history, "fix-b")).toBe(true);
		expect(hasAppliedFix(history, "fix-c")).toBe(false);
	});

	it("contentId 별로 이력이 격리된다", () => {
		const store = memStore();
		recordFixApplications("content-1", [entry({})], store);

		expect(loadFixHistory("content-2", store)).toEqual([]);
		expect(loadFixHistory("content-1", store)).toHaveLength(1);
	});

	it("이미 기록된 idempotencyKey 는 덮어쓰지 않고 skip 한다", () => {
		const store = memStore();
		const original = entry({ idempotencyKey: "fix-dup", scoreAfter: 70 });
		recordFixApplications("content-1", [original], store);

		// 같은 키, 다른 내용으로 재시도 — 원본이 유지되어야 멱등 차단이 성립
		const replay = entry({
			idempotencyKey: "fix-dup",
			actionType: "different_action",
			scoreAfter: 99,
		});
		const fresh = entry({ idempotencyKey: "fix-new" });
		recordFixApplications("content-1", [replay, fresh], store);

		const history = loadFixHistory("content-1", store);
		expect(history).toHaveLength(2);
		expect(history[0]).toEqual(original);
		expect(history[1]).toEqual(fresh);
	});

	it("같은 배치 안의 중복 idempotencyKey 도 첫 항목만 기록한다", () => {
		const store = memStore();
		recordFixApplications(
			"content-1",
			[
				entry({ idempotencyKey: "fix-x", round: 1 }),
				entry({ idempotencyKey: "fix-x", round: 2 }),
			],
			store,
		);

		const history = loadFixHistory("content-1", store);
		expect(history).toHaveLength(1);
		expect(history[0]?.round).toBe(1);
	});

	it("깨진 JSON 저장값은 [] 로 안전 복구한다", () => {
		const store = memStore();
		store.set("quality_fix_history_content-1", "{not json!!");

		expect(loadFixHistory("content-1", store)).toEqual([]);

		// 복구 후 다시 기록 가능해야 한다
		recordFixApplications("content-1", [entry({})], store);
		expect(loadFixHistory("content-1", store)).toHaveLength(1);
	});

	it("배열이 아니거나 형식이 다른 항목은 걸러낸다", () => {
		const store = memStore();
		store.set("quality_fix_history_obj", JSON.stringify({ foo: 1 }));
		expect(loadFixHistory("obj", store)).toEqual([]);

		store.set(
			"quality_fix_history_mixed",
			JSON.stringify([entry({}), { idempotencyKey: 123 }, null, "junk"]),
		);
		const history = loadFixHistory("mixed", store);
		expect(history).toHaveLength(1);
		expect(history[0]?.idempotencyKey).toBe("fix-1");
	});

	it("verdict 캐시 set/get 라운드트립, 미스는 null", () => {
		const store = memStore();
		const report = {
			verdict: "improve",
			score: 61,
			findings: ["hook weak"],
		};

		expect(loadCachedVerdict<typeof report>("hash-1", store)).toBeNull();

		cacheVerdict("hash-1", report, store);
		expect(loadCachedVerdict<typeof report>("hash-1", store)).toEqual(report);
		// 다른 해시는 miss — 같은 번들+벤치마크일 때만 캐시 히트
		expect(loadCachedVerdict<typeof report>("hash-2", store)).toBeNull();
	});

	it("깨진 verdict 캐시 값은 null 로 처리한다", () => {
		const store = memStore();
		store.set("quality_verdict_bad", "<<corrupt>>");
		expect(loadCachedVerdict("bad", store)).toBeNull();
	});

	it("node 환경(localStorage 부재)에서 store 미주입 시 크래시 없이 메모리 폴백으로 동작한다", () => {
		// 테스트 setup 이 window=globalThis 를 노출하지만 localStorage 는 없음 (node 환경)
		expect(
			typeof window === "undefined" || window.localStorage === undefined,
		).toBe(true);

		expect(() => {
			recordFixApplications("node-content", [
				entry({ idempotencyKey: "fix-node" }),
			]);
			cacheVerdict("node-hash", { verdict: "ship" });
		}).not.toThrow();

		const history = loadFixHistory("node-content");
		expect(hasAppliedFix(history, "fix-node")).toBe(true);
		expect(loadCachedVerdict<{ verdict: string }>("node-hash")).toEqual({
			verdict: "ship",
		});
		expect(loadCachedVerdict("node-miss")).toBeNull();
	});
});
