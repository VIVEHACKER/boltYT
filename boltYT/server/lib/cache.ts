/**
 * 인메모리 TTL 캐시 — 검색 API 응답 캐싱
 */

interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

export function createTtlCache<T>(defaultTtlMs = 300_000) {
	const store = new Map<string, CacheEntry<T>>();

	function get(key: string): T | undefined {
		const entry = store.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			store.delete(key);
			return undefined;
		}
		return entry.data;
	}

	function set(key: string, data: T, ttlMs = defaultTtlMs) {
		store.set(key, { data, expiresAt: Date.now() + ttlMs });
	}

	function clear(): number {
		const n = store.size;
		store.clear();
		return n;
	}

	// 만료된 항목 주기적 정리
	const cleanup = setInterval(() => {
		const now = Date.now();
		for (const [key, entry] of store) {
			if (now > entry.expiresAt) store.delete(key);
		}
	}, 60_000);
	cleanup.unref();

	return {
		get,
		set,
		clear,
		get size() {
			return store.size;
		},
	};
}
