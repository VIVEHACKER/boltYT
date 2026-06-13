import { describe, expect, it } from "vitest";
import {
	assessImportedBgmClaimReadiness,
	type BgmLicense,
	buildImportedBgmTrack,
	PAID_BGM_LIBRARIES,
} from "./bgm-import";

describe("PAID_BGM_LIBRARIES", () => {
	it("registers Epidemic Sound as safelist-cleared and recommended", () => {
		const epidemic = PAID_BGM_LIBRARIES.epidemic_sound;
		expect(epidemic.claimClearMethod).toBe("channel_safelist");
		expect(epidemic.recommendedForMonetization).toBe(true);
		expect(epidemic.downloadUrl).toContain("epidemicsound.com");
	});

	it("maps each library to a claim-clear method", () => {
		expect(PAID_BGM_LIBRARIES.artlist.claimClearMethod).toBe(
			"channel_clearlist",
		);
		expect(PAID_BGM_LIBRARIES.soundstripe.claimClearMethod).toBe(
			"per_video_code",
		);
		expect(PAID_BGM_LIBRARIES.envato_elements.claimClearMethod).toBe(
			"per_video_tool",
		);
		expect(PAID_BGM_LIBRARIES.uppbeat.claimClearMethod).toBe("claim_free");
	});

	it("includes Korean Shorts BGM sources for manual import", () => {
		expect(PAID_BGM_LIBRARIES.bgm_president.downloadUrl).toContain(
			"bgmpresident.com",
		);
		expect(PAID_BGM_LIBRARIES.mewpot.downloadUrl).toContain("mewpot.com");
		expect(PAID_BGM_LIBRARIES.sellbuymusic.downloadUrl).toContain(
			"sellbuymusic.com",
		);
	});
});

describe("assessImportedBgmClaimReadiness", () => {
	it("clears AI-generated / claim-free tracks", () => {
		const license: BgmLicense = {
			basis: "ai_generated",
			contentId: { claimExpected: false, clearMethod: "claim_free" },
		};
		const r = assessImportedBgmClaimReadiness(license);
		expect(r.cleared).toBe(true);
		expect(r.blockers).toHaveLength(0);
	});

	it("blocks an Epidemic track until the channel is safelisted", () => {
		const base: BgmLicense = {
			basis: "licensed",
			library: "epidemic_sound",
			contentId: {
				claimExpected: true,
				clearMethod: "channel_safelist",
				channelCleared: false,
			},
		};
		const blocked = assessImportedBgmClaimReadiness(base);
		expect(blocked.cleared).toBe(false);
		expect(blocked.blockers.join(" ")).toContain("Safelist");

		const cleared = assessImportedBgmClaimReadiness({
			...base,
			contentId: {
				claimExpected: true,
				clearMethod: "channel_safelist",
				channelCleared: true,
			},
		});
		expect(cleared.cleared).toBe(true);
	});

	it("blocks a per-video-code library until a code is supplied", () => {
		const noCode: BgmLicense = {
			basis: "licensed",
			library: "soundstripe",
			contentId: { claimExpected: true, clearMethod: "per_video_code" },
		};
		expect(assessImportedBgmClaimReadiness(noCode).cleared).toBe(false);

		const withCode = assessImportedBgmClaimReadiness({
			...noCode,
			contentId: {
				claimExpected: true,
				clearMethod: "per_video_code",
				clearCode: "ABC-123",
			},
		});
		expect(withCode.cleared).toBe(true);
	});

	it("warns but does not block per-video-tool libraries", () => {
		const license: BgmLicense = {
			basis: "licensed",
			library: "envato_elements",
			contentId: { claimExpected: true, clearMethod: "per_video_tool" },
		};
		const r = assessImportedBgmClaimReadiness(license);
		expect(r.cleared).toBe(true);
		expect(r.warnings.join(" ")).toContain("claim clear 도구");
	});

	it("blocks a claim-expected track with an unknown clearance method", () => {
		const license: BgmLicense = {
			basis: "licensed",
			library: "other",
			contentId: { claimExpected: true, clearMethod: "unknown" },
		};
		const r = assessImportedBgmClaimReadiness(license);
		expect(r.cleared).toBe(false);
		expect(r.blockers.join(" ")).toContain("불명확");
	});

	it("blocks an unrecognized license basis", () => {
		const r = assessImportedBgmClaimReadiness({ basis: "unknown" });
		expect(r.cleared).toBe(false);
		expect(r.blockers.join(" ")).toContain("라이선스 근거");
	});

	it("warns when a licensed track has no Content ID info", () => {
		const r = assessImportedBgmClaimReadiness({ basis: "licensed" });
		expect(r.cleared).toBe(true);
		expect(r.warnings.join(" ")).toContain("Content ID");
	});
});

describe("buildImportedBgmTrack", () => {
	it("builds an imported BgmTrack preserving license metadata", () => {
		const license: BgmLicense = {
			basis: "licensed",
			library: "epidemic_sound",
			licenseTier: "Epidemic Pro",
			contentId: {
				claimExpected: true,
				clearMethod: "channel_safelist",
				channelCleared: true,
			},
		};
		const track = buildImportedBgmTrack({
			title: "Night Drive",
			duration: 120,
			downloadUrl: "blob:local/abc",
			license,
		});
		expect(track.source).toBe("imported");
		expect(track.license).toEqual(license);
		expect(track.id).toContain("imported-");
		// 아티스트 미지정 → 라이브러리 라벨로 폴백
		expect(track.artist).toBe("Epidemic Sound");
		expect(track.downloadUrl).toBe("blob:local/abc");
	});
});
