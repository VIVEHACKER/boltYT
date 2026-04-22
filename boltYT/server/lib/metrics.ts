/**
 * @AX:ANCHOR 경량 인메모리 메트릭
 * @AX:REASON 모든 서버가 공유하는 관측 기반. API 변경 시 미들웨어/대시보드/테스트 연쇄 영향.
 *
 * counter: 단조 증가 | gauge: 현재값 | histogram: 최근 N 샘플 기반 p50/p95/p99
 * 라벨 조합별로 독립 저장 — key = `${name}|k1=v1,k2=v2` (정렬됨)
 */

export type Labels = Record<string, string>;

interface Histogram {
	samples: number[];
	count: number;
	sum: number;
}

const HISTOGRAM_WINDOW = 1000;

const counters = new Map<string, number>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<string, number>();

function keyOf(name: string, labels?: Labels): string {
	if (!labels) return name;
	const keys = Object.keys(labels).sort();
	if (keys.length === 0) return name;
	const parts = keys.map((k) => `${k}=${labels[k]}`);
	return `${name}|${parts.join(",")}`;
}

export function counter(name: string, labels?: Labels, by = 1): void {
	if (!Number.isFinite(by)) return;
	const k = keyOf(name, labels);
	counters.set(k, (counters.get(k) ?? 0) + by);
}

export function gauge(name: string, value: number, labels?: Labels): void {
	if (!Number.isFinite(value)) return;
	gauges.set(keyOf(name, labels), value);
}

export function histogram(name: string, value: number, labels?: Labels): void {
	if (!Number.isFinite(value)) return;
	const k = keyOf(name, labels);
	let h = histograms.get(k);
	if (!h) {
		h = { samples: [], count: 0, sum: 0 };
		histograms.set(k, h);
	}
	if (h.samples.length >= HISTOGRAM_WINDOW) h.samples.shift();
	h.samples.push(value);
	h.count += 1;
	h.sum += value;
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0];
	const rank = p * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	if (lo === hi) return sorted[lo];
	const frac = rank - lo;
	return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export interface HistogramSnapshot {
	key: string;
	count: number;
	mean: number;
	p50: number;
	p95: number;
	p99: number;
	min: number;
	max: number;
}

export interface MetricsSnapshot {
	ts: number;
	counters: Array<{ key: string; value: number }>;
	histograms: HistogramSnapshot[];
	gauges: Array<{ key: string; value: number }>;
}

export function snapshot(): MetricsSnapshot {
	const cList = Array.from(counters, ([key, value]) => ({ key, value })).sort(
		(a, b) => a.key.localeCompare(b.key),
	);
	const gList = Array.from(gauges, ([key, value]) => ({ key, value })).sort(
		(a, b) => a.key.localeCompare(b.key),
	);
	const hList: HistogramSnapshot[] = [];
	for (const [key, h] of histograms) {
		if (h.samples.length === 0) continue;
		const sorted = [...h.samples].sort((a, b) => a - b);
		hList.push({
			key,
			count: h.count,
			mean: h.sum / h.count,
			p50: percentile(sorted, 0.5),
			p95: percentile(sorted, 0.95),
			p99: percentile(sorted, 0.99),
			min: sorted[0],
			max: sorted[sorted.length - 1],
		});
	}
	hList.sort((a, b) => a.key.localeCompare(b.key));
	return { ts: Date.now(), counters: cList, histograms: hList, gauges: gList };
}

export function reset(): void {
	counters.clear();
	histograms.clear();
	gauges.clear();
}
