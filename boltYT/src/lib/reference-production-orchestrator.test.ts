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
		const explicit = getBuiltInReferenceTemplate(
			"builtin-drama-recap-longform",
		);
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

	it("명시한 레퍼런스의 편집 문법은 유지하되 제작 카테고리는 사용자가 입력한 주제를 따른다", () => {
		const explicit = getBuiltInReferenceTemplate(
			"builtin-drama-recap-longform",
		);
		const result = plan({
			referenceTemplate: explicit,
			topicTitle: "AI 자동화로 두 번 실패하고 성공한 개발자의 워크플로우",
			selectedFormat: "longform",
		});

		expect(result.autoSelected).toBe(false);
		expect(result.selectedTemplate?.id).toBe("builtin-drama-recap-longform");
		expect(result.selectedCandidate?.categoryId).toBe("drama_recap");
		expect(result.recommendationPlan.categoryId).toBe("business");
		expect(result.recommendationPlan.scripts[0]?.title).toBe(
			"실패 원인 해부형",
		);
		expect(result.promptContext).toContain("카테고리: 비즈니스/자동화");
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

	it("제작 지시서에 주제 고정 directive와 주제 충실도 블록이 들어간다", () => {
		const result = plan();

		const topicAnchor = result.directives.find((d) => d.id === "topic-anchor");
		expect(topicAnchor).toBeDefined();
		expect(topicAnchor?.priority).toBe("critical");
		expect(topicAnchor?.directive).toContain("왕릉");
		expect(result.promptContext).toContain("주제 충실도 (최우선)");
		expect(result.promptContext).toContain("핵심 시청자 질문");
	});

	it("scoreTopicFit이 같은 카테고리 안에서 주제 어휘와 겹치는 레퍼런스를 변별한다", () => {
		// 주제 토큰이 레퍼런스 식별 텍스트와 겹치면 topicFit이 카테고리 베이스보다 높아야 함
		const result = plan();
		const fits = result.candidates.map((c) => c.topicFit);
		// 이진값(전부 동일)이 아니라 분산이 존재해야 한다
		const unique = new Set(fits);
		expect(unique.size).toBeGreaterThan(1);
	});
});
