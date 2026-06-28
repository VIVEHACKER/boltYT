import { describe, expect, it } from "vitest";
import {
	buildChapterMarkers,
	buildSourceDescription,
	buildSourceListLines,
	buildTextbookIllustrationPrompt,
	formatTimestamp,
	illustrationWorkflow,
	isDegenerateImageStats,
	resolveTtsProvider,
	SCENE_H,
	SCENE_W,
	SDXL_FAST_SAMPLER,
	SDXL_FAST_SCHEDULER,
	SDXL_FAST_STEPS,
	type SourceRef,
	STEPS,
	sdxlSamplerSettings,
	srtTime,
	textToImageWorkflow,
} from "./vlog-shared.ts";

// ComfyUI 노드 그래프(Record<id,{class_type,inputs}>)에서 class_type 으로 노드 찾기.
type WfNode = { class_type: string; inputs: Record<string, unknown> };
const node = (wf: Record<string, WfNode>, type: string): WfNode | undefined =>
	Object.values(wf).find((n) => n.class_type === type);
// 모델 무관 latent 노드(SDXL=EmptyLatentImage / FLUX=EmptySD3LatentImage).
// illustrationWorkflow 는 model 인자를 안 받아 IMAGE_MODEL(env COMFY_MODEL)을 따르므로,
// 차원 검증은 노드 타입을 가정하지 않고 둘 중 존재하는 latent 노드에서 읽어야 env 비결합(Codex).
const latentNode = (wf: Record<string, WfNode>): WfNode | undefined =>
	node(wf, "EmptyLatentImage") ?? node(wf, "EmptySD3LatentImage");

describe("isDegenerateImageStats", () => {
	it("낮은 stddev(빈/솔리드) → degenerate", () => {
		expect(isDegenerateImageStats(0)).toBe(true);
		expect(isDegenerateImageStats(5)).toBe(true);
	});
	it("정상 이미지 stddev → 통과", () => {
		expect(isDegenerateImageStats(45)).toBe(false);
		expect(isDegenerateImageStats(12)).toBe(false); // 경계(threshold 미만만 reject)
	});
	it("threshold 커스텀", () => {
		expect(isDegenerateImageStats(20, 30)).toBe(true);
	});
	it("비유한 값 방어", () => {
		expect(isDegenerateImageStats(Number.NaN)).toBe(false);
	});
});

describe("buildTextbookIllustrationPrompt", () => {
	it("일러스트 스타일 prefix + 텍스트 억제 + visual 포함", () => {
		const p = buildTextbookIllustrationPrompt("a roman forum at dawn");
		expect(p).toContain("colored pencil");
		expect(p).toContain("watercolor");
		expect(p).toContain("no text");
		expect(p).toContain("a roman forum at dawn");
	});
});

describe("buildSourceListLines", () => {
	const sources: SourceRef[] = [
		{
			title: "SK하이닉스 45조 유상증자",
			source: "연합뉴스",
			date: "2026-06-26",
			url: "https://x/a",
		},
		{ url: "https://x/b" },
	];
	it("날짜·매체·제목 조합", () => {
		const lines = buildSourceListLines(sources);
		expect(lines[0]).toContain(
			"2026-06-26 · 연합뉴스 — SK하이닉스 45조 유상증자",
		);
		expect(lines[0].startsWith("· ")).toBe(true);
	});
	it("제목 없으면 URL 폴백", () => {
		expect(buildSourceListLines(sources)[1]).toContain("https://x/b");
	});
	it("max 로 개수 제한", () => {
		const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}` }));
		expect(buildSourceListLines(many, 14)).toHaveLength(14);
	});
	it("긴 줄은 말줄임", () => {
		const long = [{ title: "가".repeat(200) }];
		expect(buildSourceListLines(long)[0].length).toBeLessThanOrEqual(68);
	});
});

describe("buildSourceDescription", () => {
	it("헤더 + 메타 + URL 줄", () => {
		const d = buildSourceDescription([
			{ title: "제목", source: "연합뉴스", date: "2026", url: "https://x/a" },
		]);
		expect(d).toContain("출처 / Sources");
		expect(d).toContain("연합뉴스");
		expect(d).toContain("https://x/a");
	});
});

describe("formatTimestamp", () => {
	it("분:초 (1시간 미만)", () => {
		expect(formatTimestamp(0)).toBe("0:00");
		expect(formatTimestamp(65)).toBe("1:05");
		expect(formatTimestamp(599)).toBe("9:59");
	});
	it("시:분:초 (1시간 이상)", () => {
		expect(formatTimestamp(3661)).toBe("1:01:01");
	});
	it("음수/소수 방어", () => {
		expect(formatTimestamp(-5)).toBe("0:00");
		expect(formatTimestamp(5.9)).toBe("0:05");
	});
});

describe("buildChapterMarkers", () => {
	it("첫 챕터는 0:00 강제, 이후는 startSec", () => {
		const lines = buildChapterMarkers([
			{ title: "도입", startSec: 3 },
			{ title: "도착", startSec: 40 },
			{ title: "마무리", startSec: 120 },
		]);
		expect(lines[0]).toBe("0:00 도입");
		expect(lines[1]).toBe("0:40 도착");
		expect(lines[2]).toBe("2:00 마무리");
	});
});

describe("srtTime", () => {
	it("기본 포맷 HH:MM:SS,mmm", () => {
		expect(srtTime(0)).toBe("00:00:00,000");
		expect(srtTime(3.0)).toBe("00:00:03,000");
		expect(srtTime(75.5)).toBe("00:01:15,500");
		expect(srtTime(3661.25)).toBe("01:01:01,250");
	});
	it("ms 1000 오버플로 방지 — 초로 carry (Codex P2)", () => {
		expect(srtTime(1.9996)).toBe("00:00:02,000"); // 01,1000 아님
		expect(srtTime(59.9999)).toBe("00:01:00,000"); // 분 carry
	});
	it("음수 방어", () => {
		expect(srtTime(-1)).toBe("00:00:00,000");
	});
});

describe("resolveTtsProvider", () => {
	it("clova(대소문자/공백 무관) → clova", () => {
		expect(resolveTtsProvider("clova")).toBe("clova");
		expect(resolveTtsProvider("CLOVA")).toBe("clova");
		expect(resolveTtsProvider("  Clova ")).toBe("clova");
	});
	it("빈값/미지원 값 → elevenlabs 폴백(기존 동작 보존)", () => {
		expect(resolveTtsProvider("")).toBe("elevenlabs");
		expect(resolveTtsProvider("elevenlabs")).toBe("elevenlabs");
		expect(resolveTtsProvider("openai")).toBe("elevenlabs");
	});
	it("env 미설정 시 elevenlabs 기본(env 격리 — 셸 TTS_PROVIDER 비결합, Codex P2)", () => {
		// 기본인자 = process.env.TTS_PROVIDER 이므로 셸에 clova 가 떠 있어도 폴백을 보장해야 함.
		const prev = process.env.TTS_PROVIDER;
		delete process.env.TTS_PROVIDER;
		try {
			expect(resolveTtsProvider()).toBe("elevenlabs");
		} finally {
			if (prev === undefined) delete process.env.TTS_PROVIDER;
			else process.env.TTS_PROVIDER = prev;
		}
	});
});

describe("sdxlSamplerSettings", () => {
	it("기본(fast=off) — 고품질 STEPS/cfg per-call/dpmpp_2m/karras", () => {
		const s = sdxlSamplerSettings(false, 7);
		expect(s.cfg).toBe(7);
		expect(s.sampler_name).toBe("dpmpp_2m");
		expect(s.scheduler).toBe("karras");
		expect(s.steps).toBe(STEPS); // export 상수에 단언(env COMFY_STEPS 비결합, Codex)
	});
	it("fast=on — 저스텝/cfg2 + env 샘플러·스케줄러(cfg 인자 무시)", () => {
		const s = sdxlSamplerSettings(true, 7);
		expect(s.cfg).toBe(2);
		// 샘플러/스케줄러/스텝은 export 상수에 단언 — env(COMFY_FAST_*) 비결합(Codex 패턴).
		expect(s.sampler_name).toBe(SDXL_FAST_SAMPLER);
		expect(s.scheduler).toBe(SDXL_FAST_SCHEDULER);
		expect(s.steps).toBe(SDXL_FAST_STEPS);
	});
});

describe("textToImageWorkflow", () => {
	const params = {
		positive: "a forum",
		negative: "ugly",
		seed: 42,
		filenamePrefix: "test_pref",
	};

	it("sdxl(기본) — CheckpointLoaderSimple + EmptyLatentImage + cfg + 음성 프롬프트", () => {
		const wf = textToImageWorkflow(params, "sdxl");
		expect(node(wf, "CheckpointLoaderSimple")).toBeDefined();
		expect(node(wf, "UNETLoader")).toBeUndefined();
		const latent = node(wf, "EmptyLatentImage");
		expect(latent?.inputs.width).toBe(SCENE_W);
		expect(latent?.inputs.height).toBe(SCENE_H);
		const k = node(wf, "KSampler");
		// cfg/sampler 는 COMFY_PRESET(SDXL_FAST)에 따라 달라지므로 여기서 값 고정 단언 금지(env 비결합).
		// 분기 값은 sdxlSamplerSettings 테스트가 커버. 여기선 env 무관한 seed 전달만 확인.
		expect(k?.inputs.seed).toBe(42);
		// 음성 프롬프트는 두 번째 CLIPTextEncode 로 전달
		const negText = Object.values(wf).some(
			(n) => n.class_type === "CLIPTextEncode" && n.inputs.text === "ugly",
		);
		expect(negText).toBe(true);
		expect(node(wf, "SaveImage")?.inputs.filename_prefix).toBe("test_pref");
	});

	it("flux — UNETLoader/DualCLIPLoader/VAELoader + EmptySD3LatentImage + cfg 1/euler + FluxGuidance", () => {
		const wf = textToImageWorkflow(params, "flux");
		expect(node(wf, "UNETLoader")).toBeDefined();
		expect(node(wf, "DualCLIPLoader")?.inputs.type).toBe("flux");
		expect(node(wf, "VAELoader")).toBeDefined();
		expect(node(wf, "CheckpointLoaderSimple")).toBeUndefined();
		expect(node(wf, "EmptySD3LatentImage")).toBeDefined();
		expect(node(wf, "FluxGuidance")).toBeDefined();
		const k = node(wf, "KSampler");
		expect(k?.inputs.cfg).toBe(1); // distilled — CFG 비활성
		expect(k?.inputs.sampler_name).toBe("euler");
		expect(node(wf, "SaveImage")?.inputs.filename_prefix).toBe("test_pref");
	});

	it("width/height 오버라이드 반영(숏폼 세로) — sdxl/flux 공통", () => {
		const sdxl = textToImageWorkflow(
			{ ...params, width: 768, height: 1344 },
			"sdxl",
		);
		expect(node(sdxl, "EmptyLatentImage")?.inputs.width).toBe(768);
		expect(node(sdxl, "EmptyLatentImage")?.inputs.height).toBe(1344);
		const flux = textToImageWorkflow(
			{ ...params, width: 1080, height: 1920 },
			"flux",
		);
		expect(node(flux, "EmptySD3LatentImage")?.inputs.width).toBe(1080);
		expect(node(flux, "EmptySD3LatentImage")?.inputs.height).toBe(1920);
	});
});

describe("illustrationWorkflow", () => {
	it("기본 차원 = SCENE_W/H, 양성 프롬프트에 교과서 일러스트 스타일 포함", () => {
		const wf = illustrationWorkflow("a roman forum", 7);
		const latent = latentNode(wf); // 모델 무관(env COMFY_MODEL 따름)
		expect(latent?.inputs.width).toBe(SCENE_W);
		expect(latent?.inputs.height).toBe(SCENE_H);
		const pos = Object.values(wf).find(
			(n) =>
				n.class_type === "CLIPTextEncode" &&
				String(n.inputs.text).includes("a roman forum"),
		);
		expect(String(pos?.inputs.text)).toContain("colored pencil");
		expect(node(wf, "SaveImage")?.inputs.filename_prefix).toBe("vlog_illus");
	});

	it("width/height 인자 → 숏폼 세로 차원 적용", () => {
		const wf = illustrationWorkflow("x", 1, 768, 1344);
		expect(latentNode(wf)?.inputs.width).toBe(768);
		expect(latentNode(wf)?.inputs.height).toBe(1344);
	});
});
