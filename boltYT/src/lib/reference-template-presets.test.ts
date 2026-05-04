import { describe, expect, it } from "vitest";
import { GENERATED_REFERENCE_TEMPLATES } from "./generated-reference-template-presets";
import { referenceToPreset } from "./reference-bridge";
import {
	calculateGeneratedReferenceTemplateCoverage,
	cloneReferenceTemplateInput,
	formatReferenceOutputFormats,
	getBuiltInReferenceTemplate,
	getReferenceTemplateQuality,
	getReferenceTemplateReadiness,
	getReferenceTemplateMethodRules,
	getReferenceTemplateRecommendedMode,
	isBuiltInReference,
	isBuiltInReferenceTemplate,
	listBuiltInReferenceTemplates,
	sortReferenceTemplatesByQuality,
} from "./reference-template-presets";

function generatedReferenceTemplates() {
	return sortReferenceTemplatesByQuality(
		GENERATED_REFERENCE_TEMPLATES.map((template) =>
			cloneReferenceTemplateInput(template),
		),
	);
}

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

	it("자동 생성된 카테고리별 레퍼런스 템플릿을 동적 목록에 포함", () => {
		const generated = generatedReferenceTemplates();
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
		const coverage = calculateGeneratedReferenceTemplateCoverage(
			generatedReferenceTemplates(),
		);

		expect(coverage.total).toBeGreaterThanOrEqual(15);
		expect(coverage.deep).toBe(coverage.total);
		expect(coverage.over20).toBe(0);
		expect(coverage.qualityAvg).toBeGreaterThanOrEqual(80);
		expect(coverage.total).toBeGreaterThanOrEqual(100);
		expect(coverage.qualityAvg).toBeGreaterThanOrEqual(90);
		expect(coverage.qualityMin).toBeGreaterThanOrEqual(70);
		expect(coverage.knowledgeAvg).toBeGreaterThanOrEqual(90);
		expect(coverage.blocked).toBe(0);
		expect(coverage.ready + coverage.review).toBe(coverage.total);
		expect(coverage.categories).toHaveLength(5);
		expect(coverage.categories.every((category) => category.count >= 20)).toBe(
			true,
		);
		expect(
			coverage.categories.every(
				(category) => category.deep === category.count && category.over20 === 0,
			),
		).toBe(true);
		expect(
			coverage.categories.every(
				(category) => category.qualityAvg >= 88 && category.blocked === 0,
			),
		).toBe(true);
		expect(
			coverage.categories.every((category) => category.knowledgeAvg >= 88),
		).toBe(true);
	});

	it("자동 생성 레퍼런스는 콘텐츠 생성 프리셋으로 변환 가능", () => {
		const generated = generatedReferenceTemplates();

		for (const template of generated) {
			const preset = referenceToPreset(template, "longform");
			expect(preset.script.targetDuration).toBeGreaterThan(0);
			expect(preset.script.sceneCount).toBeGreaterThan(0);
			expect(preset.script.structure.length).toBeGreaterThan(0);
			expect(preset.image.promptTemplate.length).toBeGreaterThan(0);
			expect(preset.composition.sceneLayout).toBe("full");
		}
	});

	it("자동 생성 롱폼 레퍼런스는 20분 초과 소스를 활성화하지 않음", () => {
		const generated = generatedReferenceTemplates();

		for (const template of generated) {
			expect(template.duration_seconds).toBeLessThanOrEqual(20 * 60);
			const raw = template.raw_analysis as {
				source_duration_seconds?: number;
				production_method?: {
					formatProfiles?: { longform?: { durationSeconds?: number } };
				};
			};
			expect(
				raw.source_duration_seconds ?? template.duration_seconds,
			).toBeLessThanOrEqual(20 * 60);
			const longformDuration =
				raw.production_method?.formatProfiles?.longform?.durationSeconds;
			if (typeof longformDuration === "number") {
				expect(longformDuration).toBeLessThanOrEqual(20 * 60);
			}
			expect(getReferenceTemplateQuality(template).score).toBeGreaterThanOrEqual(
				70,
			);
		}
	});

	it("자동 생성 레퍼런스는 production DNA와 복사 금지 경계를 보존", () => {
		const generated = generatedReferenceTemplates();

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

	it("드라마 몰아보기 내장 템플릿은 롱폼 전용 20분 제작 상한을 보존", () => {
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
		expect(preset.script.targetDuration).toBe(1200);
		expect(preset.script.sceneCount).toBe(30);
		expect(preset.script.avgSceneDuration).toBe(40);
		expect(preset.composition.sceneLayout).toBe("full");
	});

	it("레퍼런스 품질 정책으로 즉시 사용/검토 대상을 구분하고 정렬", () => {
		const generated = generatedReferenceTemplates();
		const ready = generated.find((template) => {
			const quality = getReferenceTemplateQuality(template);
			return quality.grade === "S" && quality.gaps.length === 0;
		});
		const review = generated.find((template) =>
			getReferenceTemplateQuality(template).gaps.includes("전사량 부족"),
		);

		expect(ready).toBeDefined();
		expect(review).toBeDefined();
		expect(getReferenceTemplateReadiness(ready).status).toBe("ready");
		expect(getReferenceTemplateReadiness(review).status).toBe("review");
		expect(sortReferenceTemplatesByQuality([review!, ready!])[0]).toBe(ready);
	});
});
