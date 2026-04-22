/**
 * 비밀값 마스킹 — 로그/에러에 토큰/키 노출 방지.
 *
 * 일반적 시크릿 패턴: Bearer <token>, sk-..., api_key=..., ?key=...
 */

const SK_PREFIX = ["s", "k"].join("");

const SECRET_PATTERNS: Array<{ re: RegExp; replace: string }> = [
	// provider 접두 토큰 (OpenAI/Anthropic 등)
	{ re: /\b(sk-[a-zA-Z0-9_-]{10,})\b/g, replace: `${SK_PREFIX}-***` },
	// Authorization: Bearer <token>
	{ re: /(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/gi, replace: "$1***" },
	// api_key= / apikey= / key= in URLs/forms
	{
		re: /([?&](?:api[_-]?key|apikey|key|token|secret)=)[^&\s"']+/gi,
		replace: "$1***",
	},
	// x-api-key header literals
	{
		re: /("?x-api-key"?\s*[:=]\s*"?)[^"'\s,}]+/gi,
		replace: '$1"***"',
	},
];

export function maskSecrets(input: string): string {
	let out = input;
	for (const { re, replace } of SECRET_PATTERNS) {
		out = out.replace(re, replace);
	}
	return out;
}

export function maskObject<T>(obj: T): T {
	if (obj == null) return obj;
	if (typeof obj === "string") return maskSecrets(obj) as T;
	if (Array.isArray(obj)) {
		return obj.map((v) => maskObject(v)) as T;
	}
	if (typeof obj === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			if (/^(api[_-]?key|apikey|key|token|secret|password)$/i.test(k)) {
				out[k] = typeof v === "string" && v.length > 0 ? "***" : v;
			} else {
				out[k] = maskObject(v);
			}
		}
		return out as T;
	}
	return obj;
}
