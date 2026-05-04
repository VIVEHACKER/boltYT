import { afterEach, describe, expect, it, vi } from "vitest";
import { GENERATED_REFERENCE_TEMPLATES } from "./generated-reference-template-presets";
import { loadGeneratedReferenceTemplates } from "./generated-reference-loader";
import { isBuiltInReference } from "./reference-template-presets";

describe("generated-reference-loader", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	it("정적 JSON 자산에서 자동 레퍼런스를 읽고 채널별 템플릿으로 변환", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(GENERATED_REFERENCE_TEMPLATES.slice(0, 2)),
		});
		vi.stubGlobal("fetch", fetchMock);

		const templates = await loadGeneratedReferenceTemplates("ch-loader");

		expect(fetchMock).toHaveBeenCalledWith(
			"/generated-reference-template-presets.json",
			{ cache: "force-cache" },
		);
		expect(templates).toHaveLength(2);
		expect(templates.every((template) => template.channel_id === "ch-loader")).toBe(
			true,
		);
		expect(templates.every(isBuiltInReference)).toBe(true);
	});
});
