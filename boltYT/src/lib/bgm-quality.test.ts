import { describe, expect, it } from "vitest";
import type { BgmTrack } from "./bgm";
import {
	assessBgmTrackQuality,
	pickProfessionalBgmTrack,
	rankBgmTracks,
} from "./bgm-quality";

function track(overrides: Partial<BgmTrack>): BgmTrack {
	return {
		id: "t",
		title: "Dark Documentary Ambient",
		artist: "Artist",
		duration: 140,
		previewUrl: "https://example.com/preview.mp3",
		downloadUrl: "https://example.com/download.mp3",
		tags: ["dark", "ambient", "documentary"],
		source: "pixabay",
		...overrides,
	};
}

describe("bgm-quality", () => {
	it("주제 분위기에 맞는 배경음은 통과시킨다", () => {
		const result = assessBgmTrackQuality(track({}), {
			mood: "dark",
			tempo: "slow",
		});

		expect(result.passed).toBe(true);
		expect(result.score).toBeGreaterThanOrEqual(64);
		expect(result.reasons).toContain("dark mood match");
	});

	it("mood 지정 시 분위기 긍정 키워드가 없으면 통과시키지 않는다 (mood gate)", () => {
		// 긴 무난한 트랙이라 다른 보너스로 64를 넘길 수 있지만, mood 미스매치면 캡되어 탈락
		const result = assessBgmTrackQuality(
			track({
				title: "Generic Calm Background Loop",
				tags: ["calm", "ambient", "loop"],
				duration: 180,
			}),
			{ mood: "tense" },
		);
		expect(result.passed).toBe(false);
		expect(result.warnings).toContain("mood gate: no positive mood match");
	});

	it("보컬/가사/징글성 후보는 배경음으로 탈락시킨다", () => {
		const result = assessBgmTrackQuality(
			track({
				title: "Funny Christmas Corporate Vocal Jingle Song",
				tags: ["happy", "vocals", "jingle", "kids", "corporate"],
				duration: 28,
			}),
			{ mood: "tense", tempo: "mid" },
		);

		expect(result.passed).toBe(false);
		expect(result.score).toBeLessThan(40);
		expect(result.warnings).toContain("vocal or lyrics risk");
		expect(result.warnings).toContain("background-music reject term");
	});

	it("후보들을 점수순으로 정렬하고 기준 미달 후보는 선택하지 않는다", () => {
		const bad = track({
			id: "bad",
			title: "Corporate Funny Logo",
			tags: ["corporate", "funny", "logo"],
			duration: 20,
		});
		const good = track({
			id: "good",
			title: "Tension Suspense Thriller Pulse",
			tags: ["tension", "suspense", "thriller", "dark"],
			duration: 120,
		});

		const ranked = rankBgmTracks([bad, good], { mood: "tense" });
		expect(ranked[0].id).toBe("good");
		expect(pickProfessionalBgmTrack([bad], { mood: "tense" })).toBeNull();
		expect(pickProfessionalBgmTrack([bad, good], { mood: "tense" })?.id).toBe(
			"good",
		);
	});
});
