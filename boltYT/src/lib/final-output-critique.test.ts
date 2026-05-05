import { describe, expect, it } from "vitest";
import { buildFinalOutputCritique } from "./final-output-critique";
import type { ThumbnailReadiness } from "./thumbnail-intelligence";
import type { PolicyRiskReport } from "./youtube-policy-risk";
import type { ProductionQualityReport } from "./youtube-production-quality";

const production = {
	passed: true,
	score: 91,
	issues: [],
	requiredActions: [],
	metrics: {} as ProductionQualityReport["metrics"],
} as ProductionQualityReport;

const policy: PolicyRiskReport = {
	passed: true,
	score: 100,
	issues: [],
	requiredActions: [],
	disclosureRequired: false,
};

const thumbnail = {
	level: "ready",
	score: 88,
	label: "ready",
	requiredActions: [],
	warnings: [],
} as unknown as ThumbnailReadiness;

describe("final-output-critique", () => {
	it("passes when production, policy, thumbnail, reference and source safety pass", () => {
		const report = buildFinalOutputCritique({
			production,
			policy,
			thumbnail,
			reference: {
				passed: true,
				score: 84,
				label: "ok",
				issues: [],
				requiredActions: [],
				metrics: {} as never,
			},
			sourceSafety: {
				passed: true,
				score: 90,
				disclosureRequired: false,
				issues: [],
				requiredActions: [],
				metrics: {} as never,
			},
		});
		expect(report.passed).toBe(true);
		expect(report.score).toBeGreaterThanOrEqual(78);
	});

	it("blocks on failed production qc", () => {
		const report = buildFinalOutputCritique({
			production: { ...production, passed: false, score: 50, requiredActions: ["보강"] },
			policy,
			thumbnail,
		});
		expect(report.passed).toBe(false);
		expect(report.blockers.join(" ")).toContain("제작 QC");
	});
});
