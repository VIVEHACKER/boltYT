import { beforeEach, describe, expect, it } from "vitest";
import { counter, gauge, histogram, reset, snapshot } from "./metrics.ts";

describe("metrics", () => {
	beforeEach(() => reset());

	it("counter 누적 + 라벨별 독립", () => {
		counter("req", { s: "a" });
		counter("req", { s: "a" }, 2);
		counter("req", { s: "b" });
		const snap = snapshot();
		const a = snap.counters.find((c) => c.key === "req|s=a");
		const b = snap.counters.find((c) => c.key === "req|s=b");
		expect(a?.value).toBe(3);
		expect(b?.value).toBe(1);
	});

	it("counter — 라벨 키 정렬 안정성", () => {
		counter("x", { b: "2", a: "1" });
		counter("x", { a: "1", b: "2" }); // 입력 순서 달라도 같은 키
		const snap = snapshot();
		const found = snap.counters.filter((c) => c.key.startsWith("x|"));
		expect(found).toHaveLength(1);
		expect(found[0].value).toBe(2);
	});

	it("gauge 마지막 값 유지", () => {
		gauge("cpu", 0.5);
		gauge("cpu", 0.8);
		const snap = snapshot();
		expect(snap.gauges.find((g) => g.key === "cpu")?.value).toBe(0.8);
	});

	it("histogram p50/p95/p99 근사", () => {
		for (let i = 1; i <= 100; i++) histogram("lat", i);
		const snap = snapshot();
		const h = snap.histograms.find((x) => x.key === "lat");
		expect(h).toBeDefined();
		if (!h) return;
		expect(h.count).toBe(100);
		expect(h.p50).toBeGreaterThanOrEqual(49);
		expect(h.p50).toBeLessThanOrEqual(51);
		expect(h.p95).toBeGreaterThanOrEqual(94);
		expect(h.p99).toBeGreaterThanOrEqual(98);
		expect(h.min).toBe(1);
		expect(h.max).toBe(100);
	});

	it("histogram 1000 샘플 window 유지", () => {
		for (let i = 0; i < 1500; i++) histogram("w", i);
		const snap = snapshot();
		const h = snap.histograms.find((x) => x.key === "w");
		expect(h?.count).toBe(1500); // 누적 count는 유지
		expect(h).toBeDefined();
		if (!h) return;
		// 최근 1000개: 500-1499 → min 500
		expect(h.min).toBe(500);
		expect(h.max).toBe(1499);
	});

	it("NaN/Infinity 입력은 무시", () => {
		counter("x", undefined, Number.NaN);
		histogram("y", Number.POSITIVE_INFINITY);
		gauge("z", Number.NaN);
		const snap = snapshot();
		expect(snap.counters.find((c) => c.key === "x")).toBeUndefined();
		expect(snap.histograms.find((h) => h.key === "y")).toBeUndefined();
		expect(snap.gauges.find((g) => g.key === "z")).toBeUndefined();
	});

	it("reset 모두 비움", () => {
		counter("a");
		histogram("b", 1);
		gauge("c", 1);
		reset();
		const snap = snapshot();
		expect(snap.counters).toHaveLength(0);
		expect(snap.histograms).toHaveLength(0);
		expect(snap.gauges).toHaveLength(0);
	});
});
