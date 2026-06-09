import { describe, expect, it } from "vitest";
import {
	aiGeneratedBgmLicense,
	buildBgmGenerationRequest,
} from "./bgm-ai-generation";
import { assessImportedBgmClaimReadiness } from "./bgm-import";

describe("buildBgmGenerationRequest", () => {
	it("maps mood to an instrumental underscore prompt", () => {
		const req = buildBgmGenerationRequest("tense");
		expect(req.prompt).toContain("tension");
		expect(req.prompt.toLowerCase()).toContain("no vocals");
	});

	it("adds narration-bed constraints by default (loopable, low energy)", () => {
		const req = buildBgmGenerationRequest("calm");
		expect(req.prompt).toContain("loopable background bed");
		expect(req.prompt).toContain("leaves headroom for a voiceover");
	});

	it("omits the loopable bed text when forNarrationBed is false", () => {
		const req = buildBgmGenerationRequest("epic", { forNarrationBed: false });
		expect(req.prompt).not.toContain("loopable background bed");
		expect(req.prompt).toContain("no vocals");
	});

	it("clamps duration into [10, 190] and defaults to 60", () => {
		expect(buildBgmGenerationRequest("calm").seconds_total).toBe(60);
		expect(
			buildBgmGenerationRequest("calm", { durationSeconds: 5 }).seconds_total,
		).toBe(10);
		expect(
			buildBgmGenerationRequest("calm", { durationSeconds: 9999 })
				.seconds_total,
		).toBe(190);
		expect(
			buildBgmGenerationRequest("calm", { durationSeconds: 45.4 })
				.seconds_total,
		).toBe(45);
	});

	it("includes seed only when provided", () => {
		expect(buildBgmGenerationRequest("calm").seed).toBeUndefined();
		expect(buildBgmGenerationRequest("calm", { seed: 7 }).seed).toBe(7);
	});

	it("appends style hint and BPM", () => {
		const req = buildBgmGenerationRequest("dramatic", {
			styleHint: "lofi piano",
			bpm: 90,
		});
		expect(req.prompt).toContain("lofi piano");
		expect(req.prompt).toContain("around 90 BPM");
	});

	it("sets safe inference defaults", () => {
		const req = buildBgmGenerationRequest("calm");
		expect(req.guidance_scale).toBe(1);
		expect(req.num_inference_steps).toBe(8);
	});
});

describe("aiGeneratedBgmLicense", () => {
	it("is claim-free and monetization-cleared", () => {
		const license = aiGeneratedBgmLicense();
		expect(license.basis).toBe("ai_generated");
		expect(license.contentId?.claimExpected).toBe(false);
		// 생성 트랙은 import 정책상 바로 cleared 여야 한다
		expect(assessImportedBgmClaimReadiness(license).cleared).toBe(true);
	});
});
