import { describe, expect, it } from "vitest";
import type { ClipRemixPolicyReport } from "./clip-remix-policy";
import {
	evaluateShortsMonetizationReadiness,
	type ShortsMonetizationReadinessInput,
} from "./shorts-monetization-readiness";

function clipPolicy(overrides: Partial<ClipRemixPolicyReport> = {}): ClipRemixPolicyReport {
	return {
		verdict: "cleared",
		canFetchSourceClip: true,
		canQueuePublicUpload: true,
		transformationScore: 88,
		sourceClipRatio: 0.38,
		blockers: [],
		warnings: [],
		requiredActions: [],
		attribution: "Source clip: NASA Artemis - NASA",
		...overrides,
	};
}

function input(
	overrides: Partial<ShortsMonetizationReadinessInput> = {},
): ShortsMonetizationReadinessInput {
	return {
		durationSeconds: 24,
		sceneCount: 8,
		captions: [
			"NASA가 달 가려고\n처음 한 일",
			"사람 대신\n빈 우주선부터 보냄",
			"목표는 착륙이 아니라\n귀환",
			"마지막 착수까지\n성공해야 함",
		],
		clipPolicy: clipPolicy(),
		narration: {
			kind: "premium_tts",
			hasOriginalScript: true,
		},
		audio: {
			bgmLicenseBasis: "owned",
			hasBgmAttribution: true,
			hasSoundDesign: true,
			integratedLufs: -14.6,
			truePeakDb: -2.6,
		},
		brandSafety: {
			thirdPartyLogoUse: "incidental",
			impliesThirdPartyEndorsement: false,
			hasNoEndorsementDisclaimer: true,
		},
		metadata: {
			hasSourceCreditInDescription: true,
			hasSyntheticOrAlteredDisclosure: true,
		},
		...overrides,
	};
}

describe("shorts-monetization-readiness", () => {
	it("marks a rights-cleared, narrated, mastered short as upload ready", () => {
		const report = evaluateShortsMonetizationReadiness(input());

		expect(report.verdict).toBe("upload_ready");
		expect(report.score).toBeGreaterThanOrEqual(82);
		expect(report.blockers).toEqual([]);
	});

	it("blocks unknown BGM licensing", () => {
		const report = evaluateShortsMonetizationReadiness(
			input({
				audio: {
					bgmLicenseBasis: "unknown",
					hasBgmAttribution: false,
					hasSoundDesign: true,
					integratedLufs: -14.6,
					truePeakDb: -2.6,
				},
			}),
		);

		expect(report.verdict).toBe("blocked");
		expect(report.blockers.join(" ")).toContain("BGM license");
	});

	it("keeps caption-only source remixes in review instead of upload-ready", () => {
		const report = evaluateShortsMonetizationReadiness(
			input({
				narration: {
					kind: "none",
					hasOriginalScript: true,
				},
			}),
		);

		expect(report.verdict).toBe("needs_review");
		expect(report.warnings.join(" ")).toContain("No narration");
	});

	it("keeps source-dominant edits in review even when rights are cleared", () => {
		const report = evaluateShortsMonetizationReadiness(
			input({
				clipPolicy: clipPolicy({
					sourceClipRatio: 0.82,
					transformationScore: 94,
				}),
			}),
		);

		expect(report.verdict).toBe("needs_review");
		expect(report.sourceClipRatio).toBe(0.82);
		expect(report.requiredActions.join(" ")).toContain("55%");
	});

	it("blocks third-party logos used as branding", () => {
		const report = evaluateShortsMonetizationReadiness(
			input({
				brandSafety: {
					thirdPartyLogoUse: "branding",
					impliesThirdPartyEndorsement: true,
					hasNoEndorsementDisclaimer: false,
				},
			}),
		);

		expect(report.verdict).toBe("blocked");
		expect(report.blockers.join(" ")).toContain("endorsement");
	});

	it("penalizes meta captions that explain the production format", () => {
		const report = evaluateShortsMonetizationReadiness(
			input({
				captions: ["소스 기반 해설 쇼츠", "타임라인 구성", "AI 보조 제작 샘플"],
			}),
		);

		expect(report.breakdown.captionTone).toBeLessThan(80);
		expect(report.warnings.join(" ")).toContain("production-meta");
	});

	it("blocks missing description source credit", () => {
		const report = evaluateShortsMonetizationReadiness(
			input({
				metadata: {
					hasSourceCreditInDescription: false,
					hasSyntheticOrAlteredDisclosure: true,
				},
			}),
		);

		expect(report.verdict).toBe("blocked");
		expect(report.blockers.join(" ")).toContain("Description source credit");
	});
});
