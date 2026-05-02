import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	DEFAULT_CHANNEL_BRANDING,
	loadChannelBranding,
	saveChannelBranding,
} from "./channel-branding";

const store: Record<string, string> = {};

beforeAll(() => {
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => store[key] ?? null,
			setItem: (key: string, value: string) => {
				store[key] = value;
			},
			removeItem: (key: string) => {
				delete store[key];
			},
			clear: () => {
				for (const key of Object.keys(store)) delete store[key];
			},
		},
	});
});

afterEach(() => {
	localStorage.clear();
});

describe("channel branding", () => {
	it("returns defaults when no branding is saved", () => {
		expect(loadChannelBranding()).toEqual(DEFAULT_CHANNEL_BRANDING);
	});

	it("normalizes handle and trims values when saved", () => {
		const saved = saveChannelBranding({
			channelName: "  미스터리 채널  ",
			channelHandle: "mystery",
			tagline: "  original shorts  ",
		});

		expect(saved).toEqual({
			channelName: "미스터리 채널",
			channelHandle: "@mystery",
			tagline: "original shorts",
		});
		expect(loadChannelBranding()).toEqual(saved);
	});

	it("falls back for empty fields", () => {
		const saved = saveChannelBranding({
			channelName: "",
			channelHandle: "",
			tagline: "",
		});

		expect(saved).toEqual(DEFAULT_CHANNEL_BRANDING);
	});
});
