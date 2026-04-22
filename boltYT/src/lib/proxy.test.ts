import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiProxyUrl, getReferenceAnalyzerUrl } from "./proxy";

describe("getApiProxyUrl", () => {
	const mockStorage: Record<string, string> = {};

	beforeEach(() => {
		// Node 환경에 localStorage mock
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => mockStorage[key] ?? null,
			setItem: (key: string, val: string) => {
				mockStorage[key] = val;
			},
			removeItem: (key: string) => {
				delete mockStorage[key];
			},
		});
	});

	afterEach(() => {
		for (const k of Object.keys(mockStorage)) delete mockStorage[k];
		vi.unstubAllGlobals();
	});

	it("기본값은 localhost:3459", () => {
		expect(getApiProxyUrl()).toBe("http://localhost:3459");
	});

	it("localStorage에 저장된 URL 반환", () => {
		mockStorage.api_proxy_url = "http://custom:9999";
		expect(getApiProxyUrl()).toBe("http://custom:9999");
	});
});

describe("getReferenceAnalyzerUrl", () => {
	const mockStorage: Record<string, string> = {};

	beforeEach(() => {
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => mockStorage[key] ?? null,
			setItem: (key: string, val: string) => {
				mockStorage[key] = val;
			},
			removeItem: (key: string) => {
				delete mockStorage[key];
			},
		});
	});

	afterEach(() => {
		for (const k of Object.keys(mockStorage)) delete mockStorage[k];
		vi.unstubAllGlobals();
	});

	it("기본값은 localhost:3460", () => {
		expect(getReferenceAnalyzerUrl()).toBe("http://localhost:3460");
	});

	it("localStorage에 저장된 URL 반환", () => {
		mockStorage.reference_analyzer_url = "http://custom:8888";
		expect(getReferenceAnalyzerUrl()).toBe("http://custom:8888");
	});
});
