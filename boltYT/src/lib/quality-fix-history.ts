/**
 * Quality Fix History — 멱등 레저
 *
 * - fix 적용 이력: idempotencyKey 기준으로 같은 수정의 중복 적용을 영구 차단
 * - verdict 캐시: 같은 bundleHash(번들+벤치마크 fingerprint) → 같은 판정, LLM 재호출 생략
 *
 * storage 주입형(QualityHistoryStore)이라 node 테스트 가능.
 * 기본은 localStorage, window 부재 환경(node)에서는 in-memory Map 폴백.
 */

export interface FixHistoryEntry {
	idempotencyKey: string;
	actionType: string;
	bundleHash: string;
	round: number;
	appliedAt: string;
	scoreBefore?: number;
	scoreAfter?: number;
}

export interface QualityHistoryStore {
	get(k: string): string | null;
	set(k: string, v: string): void;
}

const FIX_HISTORY_KEY_PREFIX = "quality_fix_history_";
const VERDICT_KEY_PREFIX = "quality_verdict_";

/** node 폴백 — 프로세스 생애 동안만 유지되는 메모리 저장소 */
const memoryFallback = new Map<string, string>();

function resolveStore(store?: QualityHistoryStore): QualityHistoryStore {
	if (store) return store;
	if (typeof window !== "undefined" && window.localStorage) {
		return {
			get: (k) => window.localStorage.getItem(k),
			set: (k, v) => {
				window.localStorage.setItem(k, v);
			},
		};
	}
	return {
		get: (k) => memoryFallback.get(k) ?? null,
		set: (k, v) => {
			memoryFallback.set(k, v);
		},
	};
}

function isFixHistoryEntry(value: unknown): value is FixHistoryEntry {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.idempotencyKey === "string" &&
		typeof v.actionType === "string" &&
		typeof v.bundleHash === "string" &&
		typeof v.round === "number" &&
		typeof v.appliedAt === "string" &&
		(v.scoreBefore === undefined || typeof v.scoreBefore === "number") &&
		(v.scoreAfter === undefined || typeof v.scoreAfter === "number")
	);
}

/**
 * fix 적용 이력 로드. 저장값이 없거나 파싱 실패/형식 불일치면 안전하게 [].
 */
export function loadFixHistory(
	contentId: string,
	store?: QualityHistoryStore,
): FixHistoryEntry[] {
	const s = resolveStore(store);
	const raw = s.get(`${FIX_HISTORY_KEY_PREFIX}${contentId}`);
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isFixHistoryEntry);
	} catch {
		// 깨진 JSON — 이력 없음으로 복구 (멱등 차단은 보수적으로 해제됨)
		return [];
	}
}

/**
 * fix 적용 이력 append. 이미 기록된 idempotencyKey 는 덮어쓰지 않고 skip —
 * 같은 fix 의 중복 적용을 영구 차단하는 멱등 레저의 핵심 규칙.
 */
export function recordFixApplications(
	contentId: string,
	entries: FixHistoryEntry[],
	store?: QualityHistoryStore,
): void {
	const s = resolveStore(store);
	const existing = loadFixHistory(contentId, s);
	const seen = new Set(existing.map((e) => e.idempotencyKey));
	const merged = [...existing];
	for (const entry of entries) {
		if (seen.has(entry.idempotencyKey)) continue;
		seen.add(entry.idempotencyKey);
		merged.push(entry);
	}
	s.set(`${FIX_HISTORY_KEY_PREFIX}${contentId}`, JSON.stringify(merged));
}

/** 해당 idempotencyKey 의 fix 가 이미 적용됐는지 */
export function hasAppliedFix(
	history: FixHistoryEntry[],
	idempotencyKey: string,
): boolean {
	return history.some((e) => e.idempotencyKey === idempotencyKey);
}

/**
 * bundleHash 키 verdict 캐시 조회. 미스/파싱 실패 시 null.
 * 같은 번들+벤치마크 fingerprint → 같은 판정이므로 LLM 재호출을 생략할 수 있다.
 */
export function loadCachedVerdict<T>(
	bundleHash: string,
	store?: QualityHistoryStore,
): T | null {
	const s = resolveStore(store);
	const raw = s.get(`${VERDICT_KEY_PREFIX}${bundleHash}`);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

/** bundleHash 키로 verdict 저장 */
export function cacheVerdict<T>(
	bundleHash: string,
	report: T,
	store?: QualityHistoryStore,
): void {
	const s = resolveStore(store);
	s.set(`${VERDICT_KEY_PREFIX}${bundleHash}`, JSON.stringify(report));
}
