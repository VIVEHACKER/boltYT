import { describe, expect, it } from "vitest";
import {
	buildReferenceProductionPlan,
	type ReferenceProductionPlanInput,
} from "./reference-production-orchestrator";
import {
	getBuiltInReferenceTemplate,
	listBuiltInReferenceTemplates,
} from "./reference-template-presets";

function plan(input: Partial<ReferenceProductionPlanInput> = {}) {
	return buildReferenceProductionPlan({
		topicTitle: "기록에는 있는데 설명되지 않은 바다 위 왕릉 미스터리",
		mode: "research",
		selectedFormat: "both",
		referenceCandidates: listBuiltInReferenceTemplates(),
		...input,
	});
}

describe("reference-production-orchestrator", () => {
	it("주제와 레퍼런스 지식을 기준으로 최적 레퍼런스를 자동 선택한다", () => {
		const result = plan();

		expect(result.autoSelected).toBe(true);
		expect(result.selectedTemplate?.id).toBeTruthy();
		expect(result.selectedCandidate?.categoryId).toBe("mystery_doc");
		expect(result.selectedCandidate?.score).toBeGreaterThanOrEqual(70);
		expect(result.recommendationPlan.scripts[0]?.score).toBeGreaterThan(70);
		expect(result.promptContext).toContain("주제 맞춤 레퍼런스 오케스트레이션");
		expect(result.promptContext).toContain("품질 게이트");
	});

	it("사용자가 명시한 레퍼런스가 있으면 자동 선택보다 우선한다", () => {
		const explicit = getBuiltInReferenceTemplate("builtin-drama-recap-longform");
		const result = plan({
			referenceTemplate: explicit,
			topicTitle: "결말을 알고 다시 보면 달라지는 드라마 복선",
			selectedFormat: "longform",
		});

		expect(result.autoSelected).toBe(false);
		expect(result.selectedTemplate?.id).toBe("builtin-drama-recap-longform");
		expect(result.selectedCandidate?.categoryId).toBe("drama_recap");
		expect(result.promptContext).toContain("드라마");
	});

	it("프롬프트에는 대본, 훅, 썸네일, 복제 금지 지시가 함께 들어간다", () => {
		const result = plan();

		expect(result.directives.map((directive) => directive.id)).toEqual(
			expect.arrayContaining(["script-direction", "hook", "thumbnail"]),
		);
		expect(result.promptContext).toContain("1순위 대본");
		expect(result.promptContext).toContain("1순위 훅");
		expect(result.promptContext).toContain("1순위 썸네일");
		expect(result.promptContext).toContain("원본 영상, 음악, 대사");
	});
});
