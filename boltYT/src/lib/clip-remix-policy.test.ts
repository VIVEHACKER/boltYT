import { describe, expect, it } from "vitest";
import {
	buildClipRemixAttribution,
	evaluateClipRemixPlan,
	type ClipRemixPlan,
} from "./clip-remix-policy";

function basePlan(overrides: Partial<ClipRemixPlan> = {}): ClipRemixPlan {
	return {
		intent: "commentary",
		source: {
			url: "https://www.youtube.com/shorts/example",
			title: "Original short",
			creator: "Other Channel",
			rightsBasis: "permission",
		},
		totalShortSeconds: 45,
		sourceClipSeconds: 12,
		keepsOriginalSequence: false,
		hasNewNarration: true,
		hasOriginalCommentary: true,
		hasAttribution: true,
		hasSourceDisclosure: true,
		addsCaptionsOrGraphics: true,
		originalAudioUsage: "ducked",
		...overrides,
	};
}

describe("clip-remix-policy", () => {
	it("clears a rights-backed transformative clip remix", () => {
		const report = evaluateClipRemixPlan(basePlan());

		expect(report.verdict).toBe("cleared");
		expect(report.canFetchSourceClip).toBe(true);
		expect(report.canQueuePublicUpload).toBe(true);
		expect(report.blockers).toEqual([]);
		expect(report.transformationScore).toBeGreaterThanOrEqual(45);
	});

	it("blocks standard YouTube reuse without cleared rights", () => {
		const report = evaluateClipRemixPlan(
			basePlan({
				source: {
					url: "https://www.youtube.com/shorts/6sblJ7JxPOE",
					title: "Third-party short",
					creator: "Unknown channel",
					rightsBasis: "standard_youtube_license",
				},
			}),
		);

		expect(report.verdict).toBe("blocked");
		expect(report.canFetchSourceClip).toBe(false);
		expect(report.blockers.join(" ")).toContain("Source rights are not cleared");
	});

	it("requires manual review for fair-use commentary claims", () => {
		const report = evaluateClipRemixPlan(
			basePlan({
				source: {
					url: "https://www.youtube.com/watch?v=source",
					title: "News clip",
					creator: "News Channel",
					rightsBasis: "fair_use_commentary",
				},
				sourceClipSeconds: 8,
			}),
		);

		expect(report.verdict).toBe("review_required");
		expect(report.canFetchSourceClip).toBe(true);
		expect(report.canQueuePublicUpload).toBe(false);
		expect(report.warnings.join(" ")).toContain("manual review");
	});

	it("blocks direct reupload even with attribution", () => {
		const report = evaluateClipRemixPlan(
			basePlan({
				intent: "reupload",
				hasNewNarration: false,
				hasOriginalCommentary: false,
				addsCaptionsOrGraphics: false,
				originalAudioUsage: "primary",
				keepsOriginalSequence: true,
			}),
		);

		expect(report.verdict).toBe("blocked");
		expect(report.blockers.join(" ")).toContain("Direct reupload");
	});

	it("blocks weak transformation when the clip dominates the short", () => {
		const report = evaluateClipRemixPlan(
			basePlan({
				source: {
					url: "https://www.youtube.com/watch?v=uncleared",
					title: "Long source",
					creator: "Other Channel",
					rightsBasis: "fair_use_commentary",
				},
				totalShortSeconds: 40,
				sourceClipSeconds: 30,
				hasNewNarration: false,
				hasOriginalCommentary: true,
				addsCaptionsOrGraphics: false,
				originalAudioUsage: "primary",
			}),
		);

		expect(report.verdict).toBe("blocked");
		expect(report.sourceClipRatio).toBeGreaterThan(0.5);
		expect(report.blockers.join(" ")).toContain("dominates");
	});

	it("builds attribution from source title and creator", () => {
		expect(
			buildClipRemixAttribution({
				url: "https://youtu.be/x",
				title: "Clip",
				creator: "Channel",
				rightsBasis: "permission",
			}),
		).toBe("Source clip: Clip - Channel");
	});
});
