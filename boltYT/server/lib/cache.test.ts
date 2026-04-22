import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./cache";

describe("createTtlCache", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("set/get 저장된 값 반환", () => {
		const cache = createTtlCache<string>(1000);
		cache.set("k", "v");
		expect(cache.get("k")).toBe("v");
	});

	it("존재하지 않는 키 → undefined", () => {
		const cache = createTtlCache<string>(1000);
		expect(cache.get("missing")).toBeUndefined();
	});

	it("TTL 만료 후 undefined 반환 (lazy delete)", () => {
		const cache = createTtlCache<string>(1000);
		cache.set("k", "v");
		vi.advanceTimersByTime(1001);
		expect(cache.get("k")).toBeUndefined();
	});

	it("per-entry TTL이 기본 TTL보다 우선", () => {
		const cache = createTtlCache<string>(10_000);
		cache.set("k", "v", 500);
		vi.advanceTimersByTime(501);
		expect(cache.get("k")).toBeUndefined();
	});

	it("만료 전까지 값 유지", () => {
		const cache = createTtlCache<string>(1000);
		cache.set("k", "v");
		vi.advanceTimersByTime(999);
		expect(cache.get("k")).toBe("v");
	});

	it("clear() 전체 삭제 후 개수 반환", () => {
		const cache = createTtlCache<string>(1000);
		cache.set("a", "1");
		cache.set("b", "2");
		expect(cache.clear()).toBe(2);
		expect(cache.size).toBe(0);
	});

	it("size: lazy delete 후 감소", () => {
		const cache = createTtlCache<string>(500);
		cache.set("k", "v");
		expect(cache.size).toBe(1);
		vi.advanceTimersByTime(501);
		cache.get("k"); // lazy delete 트리거
		expect(cache.size).toBe(0);
	});

	it("cleanup interval: 만료 항목만 제거", () => {
		const cache = createTtlCache<string>(1000);
		cache.set("expire", "v", 500);
		cache.set("keep", "v", 90_000);
		vi.advanceTimersByTime(60_001); // 60초 cleanup 인터벌 트리거
		expect(cache.get("keep")).toBe("v");
		expect(cache.size).toBe(1);
	});

	it("동일 키 재설정 시 새 TTL 적용", () => {
		const cache = createTtlCache<string>(1000);
		cache.set("k", "old");
		cache.set("k", "new", 5000);
		vi.advanceTimersByTime(1001);
		expect(cache.get("k")).toBe("new");
	});
});
