/**
 * LocalDB — localStorage 기반 경량 데이터베이스
 * Supabase 쿼리 빌더와 동일한 체이닝 API를 제공합니다.
 */

import type { TypedLocalClient } from "../types/supabase";

type Row = Record<string, unknown>;

interface QueryResult {
	data: Row[] | Row | null;
	error: null;
	count?: number;
}

/** 앱 최초 실행 시 기본 채널 시드 */
function seedDefaults() {
	if (localStorage.getItem("db:channels")) return;
	const now = new Date().toISOString();
	saveTable("channels", [
		{
			id: crypto.randomUUID(),
			user_id: "local-user",
			name: "내 채널",
			description: "AI로 유튜브 콘텐츠를 자동 생성하는 채널",
			language: "ko",
			category: "기술",
			tone: "친근하고 전문적인",
			forbidden_words: [],
			default_cta: "좋아요와 구독 부탁드려요!",
			visibility_policy: "public",
			created_at: now,
			updated_at: now,
		},
	]);
}

function loadTable(name: string): Row[] {
	const raw = localStorage.getItem(`db:${name}`);
	return raw ? JSON.parse(raw) : [];
}

function saveTable(name: string, rows: Row[]) {
	try {
		localStorage.setItem(`db:${name}`, JSON.stringify(rows));
	} catch (e) {
		if (e instanceof DOMException && e.name === "QuotaExceededError") {
			console.error(
				`[local-db] localStorage 용량 초과 (테이블: ${name}, 행수: ${rows.length})`,
			);
		}
		throw e;
	}
}

class QueryBuilder {
	private table: string;
	private rows: Row[];
	private filters: Array<(row: Row) => boolean> = [];
	private orderBy: { col: string; asc: boolean } | null = null;
	private limitN: number | null = null;
	private mode: "select" | "insert" | "update" | "delete" = "select";
	private payload: Row | Row[] | null = null;
	private returnSingle = false;
	private returnMaybeSingle = false;
	private doSelect = false;
	private headMode = false;

	constructor(table: string) {
		this.table = table;
		this.rows = loadTable(table);
	}

	select(_ = "*", opts?: { count?: string; head?: boolean }) {
		// insert/update 후 .select()는 결과 반환 플래그만 켠다
		if (this.mode === "insert" || this.mode === "update") {
			this.doSelect = true;
		} else {
			this.mode = "select";
		}
		if (opts?.head) this.headMode = true;
		return this;
	}

	insert(data: Row | Row[]) {
		this.mode = "insert";
		this.payload = data;
		return this;
	}

	update(data: Row) {
		this.mode = "update";
		this.payload = data;
		return this;
	}

	delete() {
		this.mode = "delete";
		return this;
	}

	eq(col: string, val: unknown) {
		this.filters.push((r) => r[col] === val);
		return this;
	}

	neq(col: string, val: unknown) {
		this.filters.push((r) => r[col] !== val);
		return this;
	}

	in(col: string, vals: unknown[]) {
		this.filters.push((r) => vals.includes(r[col]));
		return this;
	}

	order(col: string, opts?: { ascending?: boolean }) {
		this.orderBy = { col, asc: opts?.ascending ?? true };
		return this;
	}

	limit(n: number) {
		this.limitN = n;
		return this;
	}

	single() {
		this.returnSingle = true;
		return this;
	}

	maybeSingle() {
		this.returnMaybeSingle = true;
		return this;
	}

	// passthrough for chaining methods we don't implement
	not() {
		return this;
	}
	or() {
		return this;
	}
	filter() {
		return this;
	}
	match() {
		return this;
	}
	textSearch() {
		return this;
	}
	contains() {
		return this;
	}
	containedBy() {
		return this;
	}
	range() {
		return this;
	}
	gt() {
		return this;
	}
	gte() {
		return this;
	}
	lt() {
		return this;
	}
	lte() {
		return this;
	}
	like() {
		return this;
	}
	ilike() {
		return this;
	}
	is() {
		return this;
	}
	upsert() {
		return this;
	}

	private applyFilters(rows: Row[]): Row[] {
		let result = rows;
		for (const fn of this.filters) {
			result = result.filter(fn);
		}
		if (this.orderBy) {
			const { col, asc } = this.orderBy;
			result.sort((a, b) => {
				const va = a[col] as string | number;
				const vb = b[col] as string | number;
				if (va < vb) return asc ? -1 : 1;
				if (va > vb) return asc ? 1 : -1;
				return 0;
			});
		}
		if (this.limitN !== null) {
			result = result.slice(0, this.limitN);
		}
		return result;
	}

	private execute(): QueryResult {
		switch (this.mode) {
			case "select": {
				const filtered = this.applyFilters(this.rows);
				if (this.headMode) {
					return { data: null, error: null, count: filtered.length };
				}
				if (this.returnSingle || this.returnMaybeSingle) {
					return { data: filtered[0] ?? null, error: null };
				}
				return { data: filtered, error: null, count: filtered.length };
			}
			case "insert": {
				const items = Array.isArray(this.payload)
					? this.payload
					: [this.payload ?? {}];
				const inserted: Row[] = [];
				for (const item of items) {
					const row = {
						id: crypto.randomUUID(),
						created_at: new Date().toISOString(),
						...item,
					};
					this.rows.push(row);
					inserted.push(row);
				}
				saveTable(this.table, this.rows);
				if (this.doSelect || this.returnMaybeSingle || this.returnSingle) {
					return {
						data:
							this.returnMaybeSingle || this.returnSingle
								? (inserted[0] ?? null)
								: inserted.length === 1
									? inserted[0]
									: inserted,
						error: null,
					};
				}
				return { data: inserted, error: null };
			}
			case "update": {
				const filtered = this.applyFilters(this.rows);
				for (const row of filtered) {
					Object.assign(row, this.payload, {
						updated_at: new Date().toISOString(),
					});
				}
				saveTable(this.table, this.rows);
				return { data: filtered, error: null };
			}
			case "delete": {
				if (this.filters.length === 0) {
					console.warn(
						"[local-db] delete() 호출 시 필터 없음 — 전체 삭제 방지",
					);
					return { data: null, error: null, count: 0 };
				}
				const before = this.rows.length;
				const keep = this.rows.filter(
					(r: Row) => !this.filters.every((fn) => fn(r)),
				);
				this.rows = keep;
				saveTable(this.table, this.rows);
				return { data: null, error: null, count: before - keep.length };
			}
		}
	}

	// .select() after .insert() / .update()
	// biome-ignore lint/suspicious/noThenProperty: required for Supabase-compatible await/then chaining
	then(
		// biome-ignore lint/suspicious/noExplicitAny: Supabase-compatible thenable signature
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		resolve?: ((v: any) => any) | null,
		// biome-ignore lint/suspicious/noExplicitAny: Supabase-compatible thenable signature
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		reject?: ((e: unknown) => any) | null,
	) {
		try {
			const result = this.execute();
			return resolve ? resolve(result) : result;
		} catch (e) {
			if (reject) return reject(e);
			throw e;
		}
	}
}

// Make QueryBuilder thenable without triggering biome noThenProperty
// by defining `then` on the prototype
function makeThenable(
	builder: QueryBuilder,
): QueryBuilder & PromiseLike<QueryResult> {
	return builder as unknown as QueryBuilder & PromiseLike<QueryResult>;
}

/** IndexedDB-based file storage */
const IDB_NAME = "boltyt-media";
const IDB_STORE = "files";

let _idbInstance: IDBDatabase | null = null;
let _idbPending: Promise<IDBDatabase> | null = null;

function openIDB(): Promise<IDBDatabase> {
	if (_idbInstance) return Promise.resolve(_idbInstance);
	if (_idbPending) return _idbPending;
	_idbPending = new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(IDB_STORE);
		};
		req.onsuccess = () => {
			_idbInstance = req.result;
			_idbPending = null;
			resolve(_idbInstance);
		};
		req.onerror = () => {
			_idbPending = null;
			reject(req.error);
		};
	});
	return _idbPending;
}

async function idbPut(
	key: string,
	value: Uint8Array | ArrayBuffer,
): Promise<void> {
	const db = await openIDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readwrite");
		tx.objectStore(IDB_STORE).put(value, key);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
	const db = await openIDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IDB_STORE, "readonly");
		const req = tx.objectStore(IDB_STORE).get(key);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => reject(req.error);
	});
}

// Blob URL cache — LRU 방식으로 오래된 것부터 해제
const blobUrlCache = new Map<string, string>();
const MAX_BLOB_CACHE = 50;

/** 캐시 크기 초과 시 오래된 blob URL 해제 */
function evictBlobCache() {
	if (blobUrlCache.size <= MAX_BLOB_CACHE) return;
	const entries = [...blobUrlCache.entries()];
	const toRemove = entries.slice(0, entries.length - MAX_BLOB_CACHE);
	for (const [key, url] of toRemove) {
		URL.revokeObjectURL(url);
		blobUrlCache.delete(key);
	}
}

/** 모든 blob URL 해제 (페이지 전환 시 호출) */
export function releaseAllBlobUrls() {
	for (const url of blobUrlCache.values()) {
		URL.revokeObjectURL(url);
	}
	blobUrlCache.clear();
}

export function getLocalBlobUrl(path: string): string {
	return blobUrlCache.get(path) ?? "";
}

export async function storeLocalFile(
	path: string,
	data: Uint8Array | ArrayBuffer,
	contentType: string,
): Promise<string> {
	await idbPut(path, data);
	// 기존 blob URL 해제
	const old = blobUrlCache.get(path);
	if (old) URL.revokeObjectURL(old);

	const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
	const blob = new Blob([buf as BlobPart], { type: contentType });
	const url = URL.createObjectURL(blob);
	blobUrlCache.set(path, url);
	evictBlobCache();
	return url;
}

export async function loadLocalFileUrl(
	path: string,
	contentType: string,
): Promise<string> {
	const cached = blobUrlCache.get(path);
	if (cached) return cached;
	const data = await idbGet(path);
	if (!data) return "";
	const blob = new Blob([new Uint8Array(data) as BlobPart], {
		type: contentType,
	});
	const url = URL.createObjectURL(blob);
	blobUrlCache.set(path, url);
	evictBlobCache();
	return url;
}

/** storage_path → content-type 추론 */
function guessContentType(path: string): string {
	if (path.endsWith(".png")) return "image/png";
	if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
	if (path.endsWith(".webp")) return "image/webp";
	if (path.endsWith(".mp3")) return "audio/mpeg";
	if (path.endsWith(".wav")) return "audio/wav";
	if (path.endsWith(".mp4")) return "video/mp4";
	return "application/octet-stream";
}

/** 여러 storage path의 blob URL을 일괄 복원 (IndexedDB → blobUrlCache) */
export async function ensureBlobUrls(
	paths: string[],
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	const toLoad: string[] = [];

	for (const p of paths) {
		const cached = blobUrlCache.get(p);
		if (cached) {
			result.set(p, cached);
		} else {
			toLoad.push(p);
		}
	}

	await Promise.all(
		toLoad.map(async (p) => {
			const url = await loadLocalFileUrl(p, guessContentType(p));
			if (url) result.set(p, url);
		}),
	);

	return result;
}

/** Storage mock that uses IndexedDB */
function createLocalStorage() {
	return {
		from: () => ({
			upload: async (
				storagePath: string,
				data: Uint8Array,
				opts?: { contentType?: string },
			) => {
				await storeLocalFile(
					storagePath,
					data,
					opts?.contentType ?? "application/octet-stream",
				);
				return { error: null };
			},
			getPublicUrl: (storagePath: string) => {
				const url = blobUrlCache.get(storagePath) ?? storagePath;
				return { data: { publicUrl: url } };
			},
			download: async () => ({ data: null, error: null }),
			remove: async () => ({ data: null, error: null }),
		}),
	};
}

/** Auth mock — always authenticated locally */
function createLocalAuth() {
	return {
		getSession: async () => ({
			data: {
				session: {
					user: { id: "local-user", email: "local@boltyt.local" },
					expires_in: 99999,
					token_type: "bearer",
				},
			},
			error: null,
		}),
		getUser: async (token?: string) => ({
			data: {
				user: token ? { id: "local-user", email: "local@boltyt.local" } : null,
			},
			error: null,
		}),
		signInWithPassword: async () => ({
			data: {
				session: {
					user: { id: "local-user" },
					expires_in: 99999,
					token_type: "bearer",
				},
				user: { id: "local-user", email: "local@boltyt.local" },
			},
			error: null,
		}),
		signUp: async () => ({
			data: { session: null, user: { id: "local-user" } },
			error: null,
		}),
		signOut: async () => ({ error: null }),
		onAuthStateChange: () => ({
			data: { subscription: { unsubscribe: () => {} } },
		}),
	};
}

export function createLocalClient(): TypedLocalClient {
	seedDefaults();
	return {
		from: (table: string) => makeThenable(new QueryBuilder(table)),
		storage: createLocalStorage(),
		auth: createLocalAuth(),
		rpc: async () => ({ data: null, error: null }),
	};
}
