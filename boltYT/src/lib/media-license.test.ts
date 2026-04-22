import { describe, expect, it } from "vitest";
import {
	auditSources,
	buildAttribution,
	canPubliclyRedistribute,
	LICENSE_POLICIES,
	licenseOf,
} from "./media-license";

describe("media-license", () => {
	it("모든 소스에 라벨+licenseName 있음", () => {
		for (const p of Object.values(LICENSE_POLICIES)) {
			expect(p.label).toBeTruthy();
			expect(p.licenseName).toBeTruthy();
		}
	});

	it("licenseOf — Pexels 상업·재배포 허용", () => {
		const p = licenseOf("pexels");
		expect(p.allowsCommercial).toBe(true);
		expect(p.allowsRedistribution).toBe("yes");
	});

	it("YouTube 는 상업 금지 + 재배포 금지 + warning 존재", () => {
		const p = licenseOf("youtube");
		expect(p.allowsCommercial).toBe(false);
		expect(p.allowsRedistribution).toBe("no");
		expect(p.warning).toBeTruthy();
	});

	it("Naver 는 재배포 with-license + attribution 필수", () => {
		const p = licenseOf("naver");
		expect(p.allowsRedistribution).toBe("with-license");
		expect(p.requiresAttribution).toBe(true);
	});

	it("buildAttribution 변수 치환", () => {
		expect(buildAttribution("pexels", { author: "Jane Doe" })).toBe(
			"Photo by Jane Doe on Pexels",
		);
		expect(buildAttribution("youtube", { title: "X", channel: "Y" })).toBe(
			"원본 영상: X — Y",
		);
	});

	it("canPubliclyRedistribute — YouTube/commercial 거부", () => {
		const r = canPubliclyRedistribute("youtube", "commercial");
		expect(r.ok).toBe(false);
		expect(r.reason).toContain("YouTube");
	});

	it("canPubliclyRedistribute — Pexels/commercial 허용", () => {
		expect(canPubliclyRedistribute("pexels", "commercial")).toEqual({
			ok: true,
		});
	});

	it("auditSources — 혼합 소스 blockers+warnings+attributions 집계", () => {
		const audit = auditSources(
			["pexels", "youtube", "naver", "pexels" /* dup */],
			"commercial",
		);
		expect(audit.blockers.length).toBe(2); // youtube(상업/재배포), naver(상업)
		expect(audit.warnings.length).toBe(2); // youtube, naver warning
		expect(new Set(audit.attributions)).toEqual(new Set(["youtube", "naver"]));
	});

	it("auditSources — personal 사용은 pexels/pixabay/dalle 통과", () => {
		const audit = auditSources(["pexels", "pixabay", "dalle"], "personal");
		expect(audit.blockers).toEqual([]);
	});
});
