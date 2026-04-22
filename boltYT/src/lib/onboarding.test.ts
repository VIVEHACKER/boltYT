import { beforeEach, describe, expect, it } from "vitest";
import {
	hasSeenOnboarding,
	markOnboardingSeen,
	ONBOARDING_STEPS,
	resetOnboarding,
} from "./onboarding";

describe("onboarding", () => {
	beforeEach(() => {
		// vitest node env — localStorage 폴리필 필요
		if (typeof globalThis.localStorage === "undefined") {
			const store = new Map<string, string>();
			Object.defineProperty(globalThis, "localStorage", {
				configurable: true,
				value: {
					getItem: (k: string) => store.get(k) ?? null,
					setItem: (k: string, v: string) => store.set(k, v),
					removeItem: (k: string) => store.delete(k),
					clear: () => store.clear(),
				},
			});
		}
		resetOnboarding();
	});

	it("초기에는 미완료", () => {
		expect(hasSeenOnboarding()).toBe(false);
	});

	it("markOnboardingSeen 후 완료", () => {
		markOnboardingSeen();
		expect(hasSeenOnboarding()).toBe(true);
	});

	it("reset 후 다시 미완료", () => {
		markOnboardingSeen();
		resetOnboarding();
		expect(hasSeenOnboarding()).toBe(false);
	});

	it("4단계 구성, welcome 이 첫 스텝", () => {
		expect(ONBOARDING_STEPS).toHaveLength(4);
		expect(ONBOARDING_STEPS[0].id).toBe("welcome");
		// 마지막 3 스텝은 CTA 있음
		for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
			expect(ONBOARDING_STEPS[i].cta).toBeDefined();
		}
	});
});
