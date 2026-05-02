import { describe, expect, it } from "vitest";
import { referenceToPreset } from "./reference-bridge";
import {
	formatReferenceOutputFormats,
	getGeneratedReferenceTemplateCoverage,
	getBuiltInReferenceTemplate,
	getReferenceTemplateMethodRules,
	getReferenceTemplateRecommendedMode,
	isBuiltInReference,
	isBuiltInReferenceTemplate,
	listBuiltInReferenceTemplates,
} from "./reference-template-presets";

describe("reference-template-presets", () => {
	it("내장 제작 방식 목록을 채널 ID에 맞춰 반환", () => {
		const templates = listBuiltInReferenceTemplates("ch-1");
		expect(templates.length).toBeGreaterThanOrEqual(4);
		expect(templates.every((template) => template.channel_id === "ch-1")).toBe(
			true,
		);
		expect(templates.every(isBuiltInReference)).toBe(true);
	});

	it("소셜 클립 내장 템플릿은 실제 영상 슬롯 레이아웃을 강제", () => {
		const template = getBuiltInReferenceTemplate(
			"builtin-social-clip-real-video",
		);
		expect(template).not.toBeNull();
		expect(isBuiltInReferenceTemplate(template?.id ?? "")).toBe(true);
		expect(template?.duration_seconds).toBe(38);
		expect(template?.scene_count).toBe(7);
		expect(getReferenceTemplateRecommendedMode(template)).toBe("research");
		expect(formatReferenceOutputFormats(template)).toBe("쇼츠 / 롱폼");
		expect(getReferenceTemplateMethodRules(template).join(" ")).toContain(
			"이미지 대체",
		);

		const preset = referenceToPreset(template!, "shorts");
		expect(preset.composition.sceneLayout).toBe("social_clip_card");
		expect(preset.script.targetDuration).toBe(38);
		expect(referenceToPreset(template!, "longform").composition.sceneLayout).toBe(
			"full",
		);
		expect(referenceToPreset(template!, "longform").script.targetDuration).toBe(
			180,
		);
	});

	it("사용자가 지정한 두 레퍼런스 원본 URL 메타데이터를 보존", () => {
		const urls = listBuiltInReferenceTemplates()
			.flatMap((template) => {
				const method = template.raw_analysis.production_method as
					| { referenceSources?: Array<{ url: string }> }
					| undefined;
				return method?.referenceSources?.map((source) => source.url) ?? [];
			});

		expect(urls).toContain("https://www.youtube.com/shorts/mlrp7Z4Ffkk");
		expect(urls).toContain("https://www.youtube.com/shorts/hmDt88ANJMI");
		expect(urls).toContain("https://www.youtube.com/watch?v=riYzzUg7KbI");
	});

	it("자동 생성된 카테고리별 레퍼런스 템플릿을 내장 목록에 포함", () => {
		const generated = listBuiltInReferenceTemplates().filter(
			(template) =>
				(template.raw_analysis as { generated_reference?: unknown })
					.generated_reference === true,
		);
		const counts = generated.reduce<Record<string, number>>((acc, template) => {
			const categoryId =
				(template.raw_analysis as { reference_category_id?: unknown })
					.reference_category_id;
			if (typeof categoryId === "string" && categoryId) {
				acc[categoryId] = (acc[categoryId] ?? 0) + 1;
			}
			return acc;
		}, {});

		expect(generated.length).toBeGreaterThanOrEqual(15);
		expect(counts.drama_recap).toBeGreaterThanOrEqual(3);
		expect(counts.mystery_doc).toBeGreaterThanOrEqual(3);
		expect(counts.news_issue).toBeGreaterThanOrEqual(3);
		expect(counts.automation_business).toBeGreaterThanOrEqual(3);
		expect(counts.money_psychology).toBeGreaterThanOrEqual(3);
	});

	it("자동 생성 레퍼런스 카테고리 커버리지를 노출", () => {
		const coverage = getGeneratedReferenceTemplateCoverage();

		expect(coverage.total).toBeGreaterThanOrEqual(15);
		expect(coverage.categories).toHaveLength(5);
		expect(coverage.categories.every((category) => category.count >= 3)).toBe(
			true,
		);
	});

	it("자동 생성 레퍼런스는 콘텐츠 생성 프리셋으로 변환 가능", () => {
		const generated = listBuiltInReferenceTemplates().filter(
			(template) =>
				(template.raw_analysis as { generated_reference?: unknown })
					.generated_reference === true,
		);

		for (const template of generated) {
			const preset = referenceToPreset(template, "longform");
			expect(preset.script.targetDuration).toBeGreaterThan(0);
			expect(preset.script.sceneCount).toBeGreaterThan(0);
			expect(preset.script.structure.length).toBeGreaterThan(0);
			expect(preset.image.promptTemplate.length).toBeGreaterThan(0);
			expect(preset.composition.sceneLayout).toBe("full");
		}
	});

	it("자동 생성 레퍼런스는 production DNA와 복사 금지 경계를 보존", () => {
		const generated = listBuiltInReferenceTemplates().filter(
			(template) =>
				(template.raw_analysis as { generated_reference?: unknown })
					.generated_reference === true,
		);

		expect(generated.length).toBeGreaterThanOrEqual(15);
		for (const template of generated) {
			const raw = template.raw_analysis as {
				production_dna?: {
					version?: string;
					analysisDepth?: string;
					copyBoundary?: { rawAssetsReusable?: boolean };
				};
			};
			expect(raw.production_dna?.version).toBe("production-dna-v1");
			expect(raw.production_dna?.analysisDepth).toMatch(
				/metadata_only|pixel_frame_audio_edit/,
			);
			expect(raw.production_dna?.copyBoundary?.rawAssetsReusable).toBe(false);
			expect(template.frame_urls).toEqual([]);
		}
	});

	it("드라마 몰아보기 내장 템플릿은 롱폼 전용 86분대 제작 목표를 보존", () => {
		const template = getBuiltInReferenceTemplate(
			"builtin-drama-recap-longform",
		);
		expect(template).not.toBeNull();
		expect(formatReferenceOutputFormats(template)).toBe("롱폼");
		expect(getReferenceTemplateRecommendedMode(template)).toBe("research");
		expect(getReferenceTemplateMethodRules(template).join(" ")).toContain(
			"원본 영상",
		);

		const preset = referenceToPreset(template!, "longform");
		expect(preset.script.targetDuration).toBe(5160);
		expect(preset.script.sceneCount).toBe(64);
		expect(preset.script.avgSceneDuration).toBe(80);
		expect(preset.composition.sceneLayout).toBe("full");
	});
});
