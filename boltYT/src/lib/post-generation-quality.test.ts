import { describe, expect, it } from "vitest";
import {
	POST_GENERATION_QUALITY_GATES,
	PROJECT_QUALITY_LEARNINGS,
	judgePostGenerationQuality,
	type QualityCheckResult,
} from "./post-generation-quality";

const pass = (id: string): QualityCheckResult => ({
	id,
	label: id,
	status: "pass",
	details: "ok",
});

describe("post-generation-quality", () => {
	it("모든 게이트가 pass면 ship 판정", () => {
		const report = judgePostGenerationQuality(
			POST_GENERATION_QUALITY_GATES.map((gate) => pass(gate.id)),
		);

		expect(report.verdict).toBe("ship");
		expect(report.score).toBe(100);
		expect(report.nextActions.join(" ")).toContain("통과");
	});

	it("blocking 게이트 실패는 blocked 판정", () => {
		const report = judgePostGenerationQuality([
			pass("reference-coverage"),
			{ id: "build", label: "build", status: "fail", details: "compile error" },
		]);

		expect(report.verdict).toBe("blocked");
		expect(report.score).toBeLessThan(60);
		expect(report.nextActions.join(" ")).toContain("build");
	});

	it("warning만 있으면 improve 판정", () => {
		const report = judgePostGenerationQuality([
			pass("reference-coverage"),
			{
				id: "visual-note",
				label: "visual",
				status: "warn",
				details: "visual polish required",
			},
		]);

		expect(report.verdict).toBe("improve");
		expect(report.nextActions.join(" ")).toContain("visual polish");
	});

	it("지금까지 만든 제작/레퍼런스 학습 항목을 포함", () => {
		const ids = PROJECT_QUALITY_LEARNINGS.map((learning) => learning.id);

		expect(ids).toContain("reference-dna");
		expect(ids).toContain("generated-reference-library");
		expect(ids).toContain("video-quality-floor");
		expect(ids).toContain("audio-bgm-gate");
		expect(ids).toContain("browser-risk-e2e");
		expect(ids).toContain("policy-boundary");
		expect(ids).toContain("reference-quality-routing");
		expect(ids).toContain("tacit-explicit-knowledge-loop");
	});
});
