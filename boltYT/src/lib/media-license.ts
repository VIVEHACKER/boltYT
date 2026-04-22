/**
 * @AX:ANCHOR 미디어 소스별 라이선스 매트릭스
 * @AX:REASON 업로드/공개 결정, attribution 삽입, 경고 표시 등 여러 경로가 이 테이블을 공유.
 *
 * 주의: 이 데이터는 2026-04 기준 각 플랫폼 공개 ToS 요약이다.
 *       법적 최종 판단은 사용자 책임 — 경고/가이드 용도로만 사용.
 */

export type MediaSource =
	| "pexels"
	| "pixabay"
	| "youtube"
	| "naver"
	| "dalle"
	| "user-upload";

export type UsageKind = "personal" | "commercial";

export interface LicensePolicy {
	source: MediaSource;
	label: string;
	/** 라이선스 ID/문서 링크 표기용 */
	licenseName: string;
	/** 상업적 사용 허용 */
	allowsCommercial: boolean;
	/** 출처 표기가 법적으로 필수인지 */
	requiresAttribution: boolean;
	/** 권장 표기 형식 (렌더러/크레딧 자동 생성) */
	attributionTemplate?: string;
	/** 2차 저작물/재업로드 가능 여부 */
	allowsRedistribution: "yes" | "no" | "with-license";
	/** 사용자에게 보여줄 경고. 재사용 리스크 있는 소스에만 채움 */
	warning?: string;
	/** 플랫폼 약관 원문 링크 */
	sourceUrl?: string;
}

export const LICENSE_POLICIES: Record<MediaSource, LicensePolicy> = {
	pexels: {
		source: "pexels",
		label: "Pexels",
		licenseName: "Pexels License",
		allowsCommercial: true,
		requiresAttribution: false,
		attributionTemplate: "Photo by {author} on Pexels",
		allowsRedistribution: "yes",
		sourceUrl: "https://www.pexels.com/license/",
	},
	pixabay: {
		source: "pixabay",
		label: "Pixabay",
		licenseName: "Pixabay Content License",
		allowsCommercial: true,
		requiresAttribution: false,
		attributionTemplate: "Source: Pixabay",
		allowsRedistribution: "yes",
		sourceUrl: "https://pixabay.com/service/license-summary/",
	},
	dalle: {
		source: "dalle",
		label: "DALL-E 3",
		licenseName: "OpenAI Content Policy",
		allowsCommercial: true,
		requiresAttribution: false,
		allowsRedistribution: "yes",
		sourceUrl: "https://openai.com/policies/terms-of-use",
	},
	"user-upload": {
		source: "user-upload",
		label: "직접 업로드",
		licenseName: "User-owned",
		allowsCommercial: true,
		requiresAttribution: false,
		allowsRedistribution: "yes",
	},
	youtube: {
		source: "youtube",
		label: "YouTube",
		licenseName: "각 영상 저작권자 권리 (Standard YouTube License)",
		allowsCommercial: false,
		requiresAttribution: true,
		attributionTemplate: "원본 영상: {title} — {channel}",
		allowsRedistribution: "no",
		warning:
			"YouTube 영상은 원본 저작권자 권리가 유지됩니다. 분석·레퍼런스 용도로만 내부 사용하세요. 공개 재업로드는 저작권 침해 위험이 큽니다.",
		sourceUrl: "https://www.youtube.com/static?template=terms",
	},
	naver: {
		source: "naver",
		label: "네이버",
		licenseName: "각 언론사/발행자 저작권",
		allowsCommercial: false,
		requiresAttribution: true,
		attributionTemplate: "출처: {publisher}",
		allowsRedistribution: "with-license",
		warning:
			"네이버 검색에서 가져온 기사/이미지는 해당 언론사 저작권입니다. 공정 이용 범위(인용·논평) 안에서만 사용하고 반드시 출처를 표기하세요.",
		sourceUrl: "https://policy.naver.com/rules/rules_disclaimer.html",
	},
};

export function licenseOf(source: MediaSource): LicensePolicy {
	return LICENSE_POLICIES[source];
}

export function buildAttribution(
	source: MediaSource,
	vars: Record<string, string | undefined>,
): string {
	const tpl = LICENSE_POLICIES[source].attributionTemplate;
	if (!tpl) return "";
	return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

/** 공개 용도(commercial/upload) 필터. 업로드 전 검증용. */
export function canPubliclyRedistribute(
	source: MediaSource,
	usage: UsageKind,
): { ok: boolean; reason?: string } {
	const p = LICENSE_POLICIES[source];
	if (usage === "commercial" && !p.allowsCommercial) {
		return {
			ok: false,
			reason: `${p.label} 소스는 상업적 사용이 허용되지 않습니다 (${p.licenseName}).`,
		};
	}
	if (p.allowsRedistribution === "no") {
		return {
			ok: false,
			reason: `${p.label} 소스는 재배포가 금지됩니다. 내부 참조 용도로만 사용하세요.`,
		};
	}
	return { ok: true };
}

/** 사용 중 소스들을 일괄 검증 — 업로드 버튼 활성화 조건에 사용. */
export function auditSources(
	sources: MediaSource[],
	usage: UsageKind,
): { blockers: string[]; warnings: string[]; attributions: MediaSource[] } {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const attributions: MediaSource[] = [];
	const seen = new Set<MediaSource>();
	for (const s of sources) {
		if (seen.has(s)) continue;
		seen.add(s);
		const result = canPubliclyRedistribute(s, usage);
		if (!result.ok && result.reason) blockers.push(result.reason);
		const policy = LICENSE_POLICIES[s];
		if (policy.warning) warnings.push(`${policy.label}: ${policy.warning}`);
		if (policy.requiresAttribution) attributions.push(s);
	}
	return { blockers, warnings, attributions };
}
