import type {
	Analytics,
	Approval,
	Brief,
	Channel,
	MediaAsset,
	Profile,
	ReferenceTemplate,
	Render,
	Scene,
	Script,
	StyleBible,
	Topic,
	Upload,
} from "./database";

/** 테이블명 → Row 타입 매핑 */
export interface DatabaseSchema {
	channels: Channel;
	topics: Topic;
	briefs: Brief;
	scripts: Script;
	scenes: Scene;
	media_assets: MediaAsset;
	renders: Render;
	approvals: Approval;
	uploads: Upload;
	analytics: Analytics;
	profiles: Profile;
	style_bibles: StyleBible;
	reference_templates: ReferenceTemplate;
}

export type TableName = keyof DatabaseSchema;

/** 쿼리 결과 — 배열 (select 등) */
export interface QueryResult<T = Record<string, unknown>> {
	data: T[] | null;
	error: { message: string } | null;
	count?: number;
}

/** 쿼리 결과 — 단일 레코드 (maybeSingle/single) */
export interface QuerySingleResult<T = Record<string, unknown>> {
	data: T | null;
	error: { message: string } | null;
}

/** 체이닝 쿼리 빌더 인터페이스 */
export interface TypedQueryBuilder<T> extends PromiseLike<QueryResult<T>> {
	select(
		cols?: string,
		opts?: { count?: string; head?: boolean },
	): TypedQueryBuilder<T>;
	insert(data: Partial<T> | Partial<T>[]): TypedQueryBuilder<T>;
	update(data: Partial<T>): TypedQueryBuilder<T>;
	delete(): TypedQueryBuilder<T>;
	eq(col: string, val: unknown): TypedQueryBuilder<T>;
	neq(col: string, val: unknown): TypedQueryBuilder<T>;
	in(col: string, vals: unknown[]): TypedQueryBuilder<T>;
	order(col: string, opts?: { ascending?: boolean }): TypedQueryBuilder<T>;
	limit(n: number): TypedQueryBuilder<T>;
	single(): PromiseLike<QuerySingleResult<T>>;
	maybeSingle(): PromiseLike<QuerySingleResult<T>>;
	not(): TypedQueryBuilder<T>;
	or(): TypedQueryBuilder<T>;
	filter(): TypedQueryBuilder<T>;
	match(): TypedQueryBuilder<T>;
	textSearch(): TypedQueryBuilder<T>;
	contains(): TypedQueryBuilder<T>;
	containedBy(): TypedQueryBuilder<T>;
	range(): TypedQueryBuilder<T>;
	gt(): TypedQueryBuilder<T>;
	gte(): TypedQueryBuilder<T>;
	lt(): TypedQueryBuilder<T>;
	lte(): TypedQueryBuilder<T>;
	like(): TypedQueryBuilder<T>;
	ilike(): TypedQueryBuilder<T>;
	is(): TypedQueryBuilder<T>;
	upsert(): TypedQueryBuilder<T>;
}

/** 타입된 Supabase 호환 클라이언트 */
export interface TypedLocalClient {
	from<K extends TableName>(table: K): TypedQueryBuilder<DatabaseSchema[K]>;
	storage: {
		from: () => {
			upload: (
				storagePath: string,
				data: Uint8Array,
				opts?: { contentType?: string },
			) => Promise<{ error: null }>;
			getPublicUrl: (storagePath: string) => { data: { publicUrl: string } };
			download: () => Promise<{ data: null; error: null }>;
			remove: () => Promise<{ data: null; error: null }>;
		};
	};
	auth: {
		getSession: () => Promise<{
			data: {
				// biome-ignore lint/suspicious/noExplicitAny: must match @supabase/supabase-js Session type
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				session: any;
			};
			error: null;
		}>;
		getUser: (token?: string) => Promise<{
			data: { user: { id: string; email: string } | null };
			error: null;
		}>;
		signInWithPassword: (creds: unknown) => Promise<{
			data: { session: unknown; user: unknown };
			error: { message: string } | null;
		}>;
		signUp: (creds: unknown) => Promise<{
			data: { session: null; user: unknown };
			error: { message: string } | null;
		}>;
		signOut: () => Promise<{ error: null }>;
		onAuthStateChange: (
			// biome-ignore lint/suspicious/noExplicitAny: must match @supabase/supabase-js Session type
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			cb: (event: string, session: any) => void,
		) => {
			data: { subscription: { unsubscribe: () => void } };
		};
	};
	rpc: (...args: unknown[]) => Promise<{ data: null; error: null }>;
}
