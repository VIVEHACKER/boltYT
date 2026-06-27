import { describe, expect, it } from "vitest";
import { srtTime } from "./vlog-shared.ts";

describe("srtTime", () => {
	it("기본 포맷 HH:MM:SS,mmm", () => {
		expect(srtTime(0)).toBe("00:00:00,000");
		expect(srtTime(3.0)).toBe("00:00:03,000");
		expect(srtTime(75.5)).toBe("00:01:15,500");
		expect(srtTime(3661.25)).toBe("01:01:01,250");
	});
	it("ms 1000 오버플로 방지 — 초로 carry (Codex P2)", () => {
		expect(srtTime(1.9996)).toBe("00:00:02,000"); // 01,1000 아님
		expect(srtTime(59.9999)).toBe("00:01:00,000"); // 분 carry
	});
	it("음수 방어", () => {
		expect(srtTime(-1)).toBe("00:00:00,000");
	});
});
