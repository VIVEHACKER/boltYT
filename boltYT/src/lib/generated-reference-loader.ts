import type { ReferenceTemplate } from "../types/database";
import {
	BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
	calculateGeneratedReferenceTemplateCoverage,
	cloneReferenceTemplateInput,
	sortReferenceTemplatesByQuality,
	type BuiltInReferenceTemplateInput,
} from "./reference-template-presets";

const GENERATED_REFERENCE_ASSET_PATH = "/generated-reference-template-presets.json";
let generatedInputsPromise: Promise<BuiltInReferenceTemplateInput[]> | null = null;

async function loadGeneratedInputs(): Promise<BuiltInReferenceTemplateInput[]> {
	generatedInputsPromise ??= fetch(GENERATED_REFERENCE_ASSET_PATH, {
		cache: "force-cache",
	})
		.then(async (response) => {
			if (!response.ok) {
				throw new Error(
					`자동 레퍼런스 데이터 로드 실패: ${response.status}`,
				);
			}
			return (await response.json()) as BuiltInReferenceTemplateInput[];
		})
		.catch((error) => {
			generatedInputsPromise = null;
			throw error;
		});
	return generatedInputsPromise;
}

export async function loadGeneratedReferenceTemplates(
	channelId = BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
): Promise<ReferenceTemplate[]> {
	const inputs = await loadGeneratedInputs();
	return sortReferenceTemplatesByQuality(
		inputs.map((template) => cloneReferenceTemplateInput(template, channelId)),
	);
}

export async function getGeneratedReferenceTemplate(
	id: string,
	channelId = BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
): Promise<ReferenceTemplate | null> {
	const inputs = await loadGeneratedInputs();
	const template = inputs.find((item) => item.id === id);
	return template ? cloneReferenceTemplateInput(template, channelId) : null;
}

export async function loadGeneratedReferenceTemplateCoverage() {
	const templates = await loadGeneratedReferenceTemplates();
	return calculateGeneratedReferenceTemplateCoverage(templates);
}
