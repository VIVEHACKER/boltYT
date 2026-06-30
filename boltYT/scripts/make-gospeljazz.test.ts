import { describe, expect, it } from "vitest";
import {
	aceSectionTag,
	aceStepWorkflow,
	buildAceLyrics,
	buildAceTags,
	estimateCostUsd,
	type GospelTrack,
	mascotWorkflow,
	PSALM23,
	seedFor,
	totalDurationMs,
	validateTrack,
} from "./make-gospeljazz";

type ComfyNode = { class_type: string; inputs: Record<string, unknown> };
const node = (wf: Record<string, unknown>, k: string): ComfyNode =>
	wf[k] as ComfyNode;

describe("aceSectionTag", () => {
	it("섹션명을 ACE 구조 태그로 매핑", () => {
		expect(aceSectionTag("verse1")).toBe("[verse]");
		expect(aceSectionTag("chorus2")).toBe("[chorus]");
		expect(aceSectionTag("bridge")).toBe("[bridge]");
		expect(aceSectionTag("outro")).toBe("[outro]");
		expect(aceSectionTag("intro")).toBe("[intro]");
	});
	it("미지정 섹션명은 verse 로 폴백", () => {
		expect(aceSectionTag("hook")).toBe("[verse]");
		expect(aceSectionTag("")).toBe("[verse]");
	});
});

describe("buildAceLyrics", () => {
	it("구조 태그 + 줄을 합치고 섹션은 빈 줄로 구분", () => {
		const lyr = buildAceLyrics(PSALM23);
		expect(lyr).toContain("[verse]\n여호와는 나의 목자 내게 부족함 없네");
		expect(lyr).toContain("[chorus]\n오 주님 함께라면");
		expect(lyr).toContain("[outro]\n주의 집에 영원히 내가 거하리라");
		expect(lyr).toContain("\n\n"); // 섹션 구분
	});
});

describe("buildAceTags", () => {
	it("globalStyles 를 쉼표로 결합", () => {
		expect(buildAceTags(PSALM23)).toBe(PSALM23.globalStyles.join(", "));
		expect(buildAceTags(PSALM23)).toContain("korean female alto vocals");
	});
});

describe("totalDurationMs / estimateCostUsd", () => {
	it("시편23 트랙 = 120초", () => {
		expect(totalDurationMs(PSALM23)).toBe(120000);
	});
	it("참고 클라우드 비용 = 초 × $0.0002", () => {
		expect(estimateCostUsd(PSALM23)).toBeCloseTo(0.024, 5);
	});
});

describe("validateTrack", () => {
	it("PSALM23 는 통과(에러 0)", () => {
		expect(validateTrack(PSALM23)).toEqual([]);
	});
	it("200자 초과 줄을 잡아냄", () => {
		const bad: GospelTrack = {
			...PSALM23,
			sections: [
				{
					name: "verse",
					styles: [],
					lines: ["가".repeat(201)],
					durationMs: 10000,
				},
			],
		};
		expect(validateTrack(bad).some((e) => e.includes(">200"))).toBe(true);
	});
	it("총 길이 5초 미만을 잡아냄(ACE-Step 하한)", () => {
		const bad: GospelTrack = {
			...PSALM23,
			sections: [
				{ name: "verse", styles: [], lines: ["짧다"], durationMs: 1000 },
			],
		};
		expect(validateTrack(bad).some((e) => e.includes("총 길이"))).toBe(true);
	});
	it("총 길이 240초 초과를 잡아냄(ACE-Step 상한 — 422 사전차단, Codex)", () => {
		const bad: GospelTrack = {
			...PSALM23,
			sections: [
				{ name: "verse", styles: [], lines: ["길다"], durationMs: 241000 },
			],
		};
		expect(validateTrack(bad).some((e) => e.includes("총 길이"))).toBe(true);
	});
});

describe("aceStepWorkflow", () => {
	const wf = aceStepWorkflow("tag1, tag2", "[verse]\n가사", 120, 42);
	it("ACE-Step 노드 그래프를 구성", () => {
		expect(node(wf, "1").class_type).toBe("CheckpointLoaderSimple");
		expect(node(wf, "1").inputs.ckpt_name).toContain("ace_step");
		expect(node(wf, "2").class_type).toBe("EmptyAceStepLatentAudio");
		expect(node(wf, "2").inputs.seconds).toBe(120);
		expect(node(wf, "3").class_type).toBe("TextEncodeAceStepAudio");
		expect(node(wf, "3").inputs.tags).toBe("tag1, tag2");
		expect(String(node(wf, "3").inputs.lyrics)).toContain("[verse]");
		expect(node(wf, "7").class_type).toBe("SaveAudio");
	});
	it("KSampler 가 체크포인트/조건/라텐트에 배선됨", () => {
		const k = node(wf, "5").inputs;
		expect(k.model).toEqual(["1", 0]);
		expect(k.positive).toEqual(["3", 0]);
		expect(k.negative).toEqual(["4", 0]);
		expect(k.latent_image).toEqual(["2", 0]);
		expect(k.seed).toBe(42);
	});
});

describe("mascotWorkflow", () => {
	it("SDXL txt2img 그래프(SaveImage 출력)", () => {
		const wf = mascotWorkflow("a cozy scene", 7);
		expect(node(wf, "4").class_type).toBe("CheckpointLoaderSimple");
		expect(node(wf, "6").inputs.text).toBe("a cozy scene");
		expect(node(wf, "9").class_type).toBe("SaveImage");
		expect(node(wf, "3").inputs.seed).toBe(7);
	});
});

describe("seedFor", () => {
	it("결정적이며 0..2^31 범위", () => {
		expect(seedFor("psalm23")).toBe(seedFor("psalm23"));
		expect(seedFor("a")).not.toBe(seedFor("b"));
		const s = seedFor("psalm23-gospel-jazz");
		expect(s).toBeGreaterThanOrEqual(0);
		expect(s).toBeLessThan(2 ** 31);
	});
});
