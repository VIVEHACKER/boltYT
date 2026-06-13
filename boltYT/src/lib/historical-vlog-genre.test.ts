/**
 * historical_vlog 장르 통합 커버리지 — market-benchmark.test.ts 와 분리(되돌림 방지).
 * 시간여행 신호 분류 + 내장 프리셋 sanity + 오분류 회귀를 검증한다.
 */
import { describe, expect, it } from "vitest";
import {
	classifyBenchmarkGenre,
	getBuiltinBenchmark,
} from "./market-benchmark";

describe("historical_vlog 분류", () => {
	it("시간여행 신호(한/영)는 historical_vlog", () => {
		expect(classifyBenchmarkGenre("고대 로마 시간여행 브이로그")).toBe(
			"historical_vlog",
		);
		expect(classifyBenchmarkGenre("조선시대 타임슬립")).toBe("historical_vlog");
		expect(classifyBenchmarkGenre("I time traveled to ancient Rome")).toBe(
			"historical_vlog",
		);
		expect(classifyBenchmarkGenre("타임머신 타고 1912 타이타닉")).toBe(
			"historical_vlog",
		);
	});

	it("일반 브이로그/역사 다큐/사극은 historical_vlog 로 오분류되지 않는다", () => {
		// 범용 브이로그 → generic (시간여행 신호 없음)
		expect(classifyBenchmarkGenre("고양이 브이로그")).toBe("generic");
		// 역사 다큐 → docu_story 유지
		expect(classifyBenchmarkGenre("로마 제국 역사 다큐멘터리")).toBe(
			"docu_story",
		);
		// 사극(시대물)은 시간여행이 아니므로 historical_vlog 아님 (리뷰 지적 반영: 사극 키워드 제거)
		expect(classifyBenchmarkGenre("인기 사극 추천")).not.toBe(
			"historical_vlog",
		);
		expect(classifyBenchmarkGenre("시대극 어떤 게 좋을까")).not.toBe(
			"historical_vlog",
		);
	});

	it("내장 프리셋 sanity — historical_vlog × shorts/longform", () => {
		for (const format of ["shorts", "longform"] as const) {
			const b = getBuiltinBenchmark("historical_vlog", format);
			expect(b.genre).toBe("historical_vlog");
			expect(b.format).toBe(format);
			expect(b.confidence).toBeGreaterThan(0);
			expect(b.script.structureRoles).toContain("immersion");
			expect(b.script.minScenes).toBeGreaterThan(0);
		}
		// 롱폼이 쇼츠보다 컷이 느리다
		expect(
			getBuiltinBenchmark("historical_vlog", "longform").editing.cutDensitySec,
		).toBeGreaterThan(
			getBuiltinBenchmark("historical_vlog", "shorts").editing.cutDensitySec,
		);
	});
});
