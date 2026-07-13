import { describe, expect, it } from "vitest";
import {
	fetchIndexQuote,
	naverIndexCode,
	parseIndexQuote,
} from "./chart-screen-record.ts";

describe("naverIndexCode", () => {
	it("KOSPI/KOSDAQ 지수 심볼만 폴링 코드로 변환한다", () => {
		expect(naverIndexCode("KRX:KOSPI")).toBe("KOSPI");
		expect(naverIndexCode("KRX:KOSDAQ")).toBe("KOSDAQ");
		expect(naverIndexCode("kospi")).toBe("KOSPI");
	});
	it("개별 종목·기타 심볼은 null(지수만 지원)", () => {
		expect(naverIndexCode("KRX:005930")).toBeNull();
		expect(naverIndexCode("FX_IDC:USDKRW")).toBeNull();
	});
});

const sample = {
	datas: [
		{
			stockName: "코스피",
			closePriceRaw: "6806.93",
			fluctuationsRatioRaw: "-8.95",
			compareToPreviousPrice: { code: "5", text: "하락", name: "FALLING" },
			marketStatus: "CLOSE",
			localTradedAt: "2026-07-13T18:59:00+09:00",
		},
	],
};

describe("parseIndexQuote", () => {
	it("네이버 폴링 응답에서 값·등락률·방향을 파싱한다", () => {
		const q = parseIndexQuote(sample, "KOSPI");
		expect(q).not.toBeNull();
		expect(q?.value).toBeCloseTo(6806.93);
		expect(q?.changeRate).toBeCloseTo(-8.95);
		expect(q?.direction).toBe("하락");
		expect(q?.name).toBe("코스피");
	});
	it("등락률 부호로 방향을 정한다(상승/보합)", () => {
		const up = parseIndexQuote(
			{ datas: [{ closePriceRaw: "2500", fluctuationsRatioRaw: "1.2" }] },
			"KOSDAQ",
		);
		expect(up?.direction).toBe("상승");
		const flat = parseIndexQuote(
			{ datas: [{ closePriceRaw: "2500", fluctuationsRatioRaw: "0" }] },
			"KOSDAQ",
		);
		expect(flat?.direction).toBe("보합");
	});
	it("형식 오류·빈 데이터는 null(파괴적 실패 대신 폴백)", () => {
		expect(parseIndexQuote(null, "KOSPI")).toBeNull();
		expect(parseIndexQuote({ datas: [] }, "KOSPI")).toBeNull();
		expect(
			parseIndexQuote({ datas: [{ closePriceRaw: "x" }] }, "KOSPI"),
		).toBeNull();
	});
});

describe("fetchIndexQuote", () => {
	it("지수 심볼을 폴링 코드로 취득한다(fetch 주입)", async () => {
		let url = "";
		const q = await fetchIndexQuote("KRX:KOSPI", (async (u: string) => {
			url = u;
			return {
				ok: true,
				json: async () => sample,
			} as Response;
		}) as unknown as typeof fetch);
		expect(url).toContain("/index/KOSPI");
		expect(q?.direction).toBe("하락");
	});
	it("개별 종목은 fetch 없이 null", async () => {
		let called = false;
		const q = await fetchIndexQuote("KRX:005930", (async () => {
			called = true;
			return { ok: true, json: async () => sample } as Response;
		}) as unknown as typeof fetch);
		expect(q).toBeNull();
		expect(called).toBe(false);
	});
	it("네트워크·HTTP 오류는 null(폴백)", async () => {
		const bad = await fetchIndexQuote("KRX:KOSPI", (async () => {
			return { ok: false, json: async () => ({}) } as Response;
		}) as unknown as typeof fetch);
		expect(bad).toBeNull();
		const threw = await fetchIndexQuote("KRX:KOSPI", (async () => {
			throw new Error("network");
		}) as unknown as typeof fetch);
		expect(threw).toBeNull();
	});
});
