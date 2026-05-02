import { describe, expect, it, vi } from "vitest";

const mockStoreLocalFile = vi.hoisted(() => vi.fn(async (path: string) => `blob://${path}`));

vi.mock("./local-db", () => ({
	storeLocalFile: mockStoreLocalFile,
}));

import {
	buildSourceCardSvg,
	canUseSourceCard,
	generateSourceCardToPath,
} from "./source-card";

describe("source-card", () => {
	it("자료 메타데이터를 안전한 SVG 카드로 만든다", () => {
		const svg = buildSourceCardSvg({
			title: "사건 기록",
			source: "뉴스A",
			date: "2024-05-01",
			caption: "확인된 마지막 동선",
			narration: "현재까지 확인된 기록을 기준으로 정리합니다.",
			visualRole: "document",
		});

		expect(svg).toContain("<svg");
		expect(svg).toContain("DOCUMENT");
		expect(svg).toContain("뉴스A");
		expect(svg).toContain("확인된 마지막 동선");
		expect(svg).toContain("Not a claimed original photo/video");
	});

	it("reconstruction/transition 샷은 소스 카드로 숨기지 않는다", () => {
		expect(canUseSourceCard({ visual_role: "document" })).toBe(true);
		expect(canUseSourceCard({ visual_role: "reconstruction" })).toBe(false);
		expect(canUseSourceCard({ visual_role: "transition" })).toBe(false);
	});

	it("SVG를 image/svg+xml 로컬 파일로 저장한다", async () => {
		const url = await generateSourceCardToPath("scenes/s1/card.png", {
			title: "자료 카드",
			visualRole: "evidence",
		});

		expect(url).toBe("blob://scenes/s1/card.svg");
		expect(mockStoreLocalFile).toHaveBeenCalledWith(
			"scenes/s1/card.svg",
			expect.any(Uint8Array),
			"image/svg+xml",
		);
	});
});
