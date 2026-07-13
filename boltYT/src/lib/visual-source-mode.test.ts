import { afterEach, describe, expect, it, vi } from "vitest";
import { getVisualSourceMode, setVisualSourceMode } from "./visual-source-mode";

function stubLocalStorage() {
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => {
			store.set(k, v);
		},
		removeItem: (k: string) => {
			store.delete(k);
		},
		clear: () => store.clear(),
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getVisualSourceMode / setVisualSourceMode", () => {
	it("defaults to ai (audit: stock-stitch default caused low quality)", () => {
		stubLocalStorage();
		expect(getVisualSourceMode()).toBe("ai");
	});

	it("round-trips search and back to ai", () => {
		stubLocalStorage();
		setVisualSourceMode("search");
		expect(getVisualSourceMode()).toBe("search");
		setVisualSourceMode("ai");
		expect(getVisualSourceMode()).toBe("ai");
	});

	it("treats any non-'search' value as ai", () => {
		stubLocalStorage();
		localStorage.setItem("visual_source_mode", "garbage");
		expect(getVisualSourceMode()).toBe("ai");
	});
});
