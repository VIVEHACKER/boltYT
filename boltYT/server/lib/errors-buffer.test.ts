import { beforeEach, describe, expect, it } from "vitest";
import {
	clearErrors,
	countErrors,
	listErrors,
	MAX_ERRORS,
	recordError,
} from "./errors-buffer.ts";

describe("errors-buffer", () => {
	beforeEach(() => clearErrors());

	it("최신이 앞에, id/ts 자동 부여", () => {
		recordError({
			service: "a",
			source: "server",
			level: "error",
			message: "first",
		});
		recordError({
			service: "a",
			source: "server",
			level: "error",
			message: "second",
		});
		const list = listErrors();
		expect(list[0].message).toBe("second");
		expect(list[1].message).toBe("first");
		expect(list[0].id).toBeTruthy();
		expect(list[0].ts).toBeGreaterThan(0);
	});

	it("MAX 초과 시 오래된 것 drop", () => {
		for (let i = 0; i < MAX_ERRORS + 50; i++) {
			recordError({
				service: "x",
				source: "server",
				level: "error",
				message: `m${i}`,
			});
		}
		expect(countErrors()).toBe(MAX_ERRORS);
		// 최신(= MAX_ERRORS+49)이 맨 앞
		expect(listErrors()[0].message).toBe(`m${MAX_ERRORS + 49}`);
	});

	it("filter by service/source/level/since/limit", () => {
		recordError({
			service: "api",
			source: "server",
			level: "error",
			message: "s1",
		});
		recordError({
			service: "api",
			source: "client",
			level: "warn",
			message: "c1",
		});
		recordError({
			service: "render",
			source: "server",
			level: "error",
			message: "s2",
		});
		expect(listErrors({ service: "api" })).toHaveLength(2);
		expect(listErrors({ source: "client" })).toHaveLength(1);
		expect(listErrors({ level: "warn" })).toHaveLength(1);
		expect(listErrors({ limit: 1 })).toHaveLength(1);
		expect(listErrors({ since: Date.now() + 10_000 })).toHaveLength(0);
	});

	it("명시 ts 존중", () => {
		const ts = Date.now() - 3600_000;
		recordError({
			service: "a",
			source: "server",
			level: "error",
			message: "old",
			ts,
		});
		expect(listErrors()[0].ts).toBe(ts);
	});
});
