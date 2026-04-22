/**
 * 타임라인 오케스트레이터 — 리서치 브리프 + 수집 자료 → 시간순 이벤트 정렬
 *
 * 파이프라인: extractResearchBrief → buildChronologicalTimeline → generateResearchScript
 * 결과 타임라인은 AI 스크립트 생성에 "씬 순서 강제" 제약으로 주입됨.
 */

import type { ResearchBrief } from "./ai-agents";

export interface TimelineEvent {
	date: string;
	dateSortKey: number;
	event: string;
	sourceIndices: number[];
}

export interface ChronologicalTimeline {
	events: TimelineEvent[];
}

interface TimelineSource {
	title: string;
	bodyText?: string;
	eventDate?: string;
	pubDate?: string;
}

interface EventDatedItem {
	eventDate?: string;
}

/** 한국어 날짜 문자열 → unix timestamp (정렬용). 파싱 실패 시 0 */
export function parseDateToSortKey(raw: string): number {
	if (!raw) return 0;
	const cleaned = raw
		.replace(/년|월/g, "-")
		.replace(/일/g, "")
		.replace(/\./g, "-")
		.replace(/\s+/g, "")
		.trim();

	// "2024-05-10", "1991-01-29" 패턴
	const isoMatch = cleaned.match(/(\d{4})-(\d{1,2})-?(\d{1,2})?/);
	if (isoMatch) {
		const y = Number(isoMatch[1]);
		const m = Number(isoMatch[2]) - 1;
		const d = Number(isoMatch[3] || 1);
		const ts = new Date(y, m, d).getTime();
		if (!Number.isNaN(ts)) return ts;
	}

	// "Mon, 29 Jan 2026" RFC 2822 (Naver pubDate)
	const rfc = Date.parse(raw);
	if (!Number.isNaN(rfc)) return rfc;

	// 년도만 ("2006")
	const yearOnly = raw.match(/(\d{4})/);
	if (yearOnly) return new Date(Number(yearOnly[1]), 0, 1).getTime();

	return 0;
}

export function sortByEventDate<T extends EventDatedItem>(items: T[]): T[] {
	return items
		.map((item, index) => ({
			item,
			index,
			sortKey: parseDateToSortKey(item.eventDate?.trim() ?? ""),
		}))
		.sort((a, b) => {
			if (a.sortKey === 0 && b.sortKey === 0) return a.index - b.index;
			if (a.sortKey === 0) return 1;
			if (b.sortKey === 0) return -1;
			if (a.sortKey === b.sortKey) return a.index - b.index;
			return a.sortKey - b.sortKey;
		})
		.map(({ item }) => item);
}

/** 이벤트 텍스트가 소스 본문/제목에 언급되는지 간이 매칭 */
function eventMentionedInSource(
	event: string,
	source: TimelineSource,
): boolean {
	const keywords = event
		.replace(/[^가-힣a-zA-Z0-9\s]/g, "")
		.split(/\s+/)
		.filter((w) => w.length >= 2);
	if (keywords.length === 0) return false;

	const corpus = `${source.title} ${source.bodyText ?? ""}`.toLowerCase();
	let hits = 0;
	for (const kw of keywords) {
		if (corpus.includes(kw.toLowerCase())) hits++;
	}
	return hits / keywords.length >= 0.3;
}

/**
 * 리서치 브리프 타임라인 + 수집 자료 → 시간순 정렬된 이벤트 배열.
 * 각 이벤트에 관련 소스 인덱스 매핑.
 */
export function buildChronologicalTimeline(
	brief: ResearchBrief,
	sources: TimelineSource[],
): ChronologicalTimeline {
	const events: TimelineEvent[] = brief.timeline.map((t) => {
		const sortKey = parseDateToSortKey(t.date);
		const matchedSources: number[] = [];
		for (let i = 0; i < sources.length; i++) {
			if (eventMentionedInSource(t.event, sources[i])) {
				matchedSources.push(i);
			}
		}
		// 매칭 안 되면 날짜로 가장 가까운 소스 1개 할당
		if (matchedSources.length === 0 && sortKey > 0) {
			let closest = -1;
			let minDiff = Number.MAX_SAFE_INTEGER;
			for (let i = 0; i < sources.length; i++) {
				const sk = parseDateToSortKey(sources[i].eventDate ?? "");
				if (sk > 0) {
					const diff = Math.abs(sk - sortKey);
					if (diff < minDiff) {
						minDiff = diff;
						closest = i;
					}
				}
			}
			if (closest >= 0) matchedSources.push(closest);
		}
		return {
			date: t.date,
			dateSortKey: sortKey,
			event: t.event,
			sourceIndices: matchedSources,
		};
	});

	// 시간순 정렬 (sortKey=0은 뒤로 보내고, 무날짜끼리는 원래 순서 유지)
	events.sort((a, b) => {
		if (a.dateSortKey === 0 && b.dateSortKey === 0) return 0;
		if (a.dateSortKey === 0) return 1;
		if (b.dateSortKey === 0) return -1;
		return a.dateSortKey - b.dateSortKey;
	});

	return { events };
}

/** AI 프롬프트에 주입할 타임라인 제약 텍스트 생성 */
export function formatTimelineConstraint(
	timeline: ChronologicalTimeline,
): string {
	if (timeline.events.length === 0) return "";
	const lines = timeline.events.map((e, i) => {
		const srcTag =
			e.sourceIndices.length > 0 ? ` (자료${e.sourceIndices.join(",")})` : "";
		return `[${i + 1}] ${e.date}: ${e.event}${srcTag}`;
	});
	return `=== 사건 타임라인 (이 순서대로 씬을 구성하세요) ===\n${lines.join("\n")}`;
}
