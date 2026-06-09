import { afterEach, describe, expect, it, vi } from "vitest";
import { getBgmSourceMode, setBgmSourceMode } from "./bgm";

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

describe("getBgmSourceMode / setBgmSourceMode", () => {
	it("defaults to library", () => {
		stubLocalStorage();
		expect(getBgmSourceMode()).toBe("library");
	});

	it("round-trips the ai mode and back", () => {
		stubLocalStorage();
		setBgmSourceMode("ai");
		expect(getBgmSourceMode()).toBe("ai");
		setBgmSourceMode("library");
		expect(getBgmSourceMode()).toBe("library");
	});

	it("treats any non-'ai' stored value as library", () => {
		stubLocalStorage();
		localStorage.setItem("bgm_source_mode", "garbage");
		expect(getBgmSourceMode()).toBe("library");
	});
});
