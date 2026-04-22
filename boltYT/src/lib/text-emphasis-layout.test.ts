import { describe, expect, it } from "vitest";
import { computeTextEmphasisLayout } from "./text-emphasis-layout";

describe("text-emphasis-layout", () => {
	it("짧은 강조 문장은 single 레이아웃을 쓴다", () => {
		const layout = computeTextEmphasisLayout("결정적 단서");

		expect(layout.variant).toBe("single");
		expect(layout.focusText).toBe("결정적 단서");
	});

	it("긴 문장은 stacked 레이아웃으로 분리한다", () => {
		const layout = computeTextEmphasisLayout(
			"목격자의 한마디가 결국 수사 방향을 바꿨다",
		);

		expect(layout.variant).toBe("stacked");
		expect(layout.leadText).toBeTruthy();
		expect(layout.focusText).toBeTruthy();
		expect(layout.splitWordIndex).toBeGreaterThan(0);
	});

	it("문장 부호가 있으면 그 지점을 우선 split한다", () => {
		const layout = computeTextEmphasisLayout(
			"실종 당일, 마지막 목격 장소는 골목 끝이었다",
		);

		expect(layout.variant).toBe("stacked");
		expect(layout.leadText).toBe("실종 당일,");
	});
});
