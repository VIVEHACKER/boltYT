import { describe, expect, it } from "vitest";
import { canFireSfx, createCooldownTracker, filterByCooldown } from "./sfx-cooldown";
import type { SfxEntry } from "./sfx";

const e = (id: string, category: SfxEntry["category"]): SfxEntry => ({
	id,
	category,
	file: `${id}.mp3`,
	duration: 1,
	volume: 0.5,
});

describe("canFireSfx", () => {
	it("첫 호출은 통과", () => {
		const t = createCooldownTracker();
		expect(canFireSfx(t, "whoosh", 0, 60)).toBe(true);
	});

	it("쿨다운 안에서는 차단", () => {
		const t = createCooldownTracker();
		canFireSfx(t, "whoosh", 0, 60);
		expect(canFireSfx(t, "whoosh", 30, 60)).toBe(false);
	});

	it("쿨다운 지나면 통과", () => {
		const t = createCooldownTracker();
		canFireSfx(t, "whoosh", 0, 60);
		expect(canFireSfx(t, "whoosh", 60, 60)).toBe(true);
	});

	it("다른 카테고리는 독립적", () => {
		const t = createCooldownTracker();
		canFireSfx(t, "whoosh", 0, 60);
		expect(canFireSfx(t, "impact", 0, 60)).toBe(true);
	});
});

describe("filterByCooldown", () => {
	it("연속 같은 카테고리는 첫 것만 통과", () => {
		const out = filterByCooldown(
			[
				{ entry: e("a", "whoosh"), frame: 0 },
				{ entry: e("b", "whoosh"), frame: 30 },
				{ entry: e("c", "whoosh"), frame: 70 },
			],
			60,
		);
		expect(out.map((x) => x.id)).toEqual(["a", "c"]);
	});
});
