/**
 * vlog 양산 공유 저수준 유틸 — 장르 무관(history/economy 공용).
 * make-vlog(역사)·make-economy(경제)가 동일 ComfyUI/TTS/LLM/ffprobe 배선을 쓰도록 추출.
 * 장르별 워크플로(IPAdapter vs 카툰)·대본·썸네일 구도는 각 CLI 가 별도로 정의한다.
 */
import { execFile } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const exec = promisify(execFile);
export const COMFY = process.env.COMFY_URL ?? "http://localhost:8188";
export const PROXY = process.env.API_PROXY_URL ?? "http://localhost:3459";
export const COMFY_INPUT =
	process.env.COMFY_INPUT ?? join(homedir(), "ComfyUI/input");
/** 썸네일 텍스트 오버레이용(ffmpeg drawtext 부재 대비). ComfyUI venv 의 Pillow 사용. */
export const COMFY_PYTHON =
	process.env.COMFY_PYTHON ?? join(homedir(), "ComfyUI/venv/bin/python");
export const CKPT = process.env.COMFY_CKPT ?? "sd_xl_base_1.0.safetensors";

/** 양의 정수 env 파싱. 잘못된 값(NaN/0/음수/소수)은 기본값 폴백 — ComfyUI 입력은 양의 정수 필수. */
export function posIntEnv(name: string, def: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return def;
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : def;
}
/** ComfyUI 잠재 차원 env — 8의 배수로 반올림 + 최소 64(EmptyLatentImage는 8px 증분). */
export function latentDimEnv(name: string, def: number): number {
	return Math.max(64, Math.round(posIntEnv(name, def) / 8) * 8);
}
/** 양의 실수 env(0 초과). 잘못된 값은 기본값. */
export function floatEnv(name: string, def: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return def;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : def;
}

export const STEPS = Math.max(8, posIntEnv("COMFY_STEPS", 30));
// 기본 1344x768(SDXL 1MP 16:9 스위트스폿). FLUX(COMFY_MODEL=flux)로 가면 고해상도가 안전하므로
// SCENE_W=1920 SCENE_H=1080 으로 올려 업스케일 블러를 없앨 수 있다(롱폼 화질 레버 B).
export const SCENE_W = latentDimEnv("SCENE_W", 1344);
export const SCENE_H = latentDimEnv("SCENE_H", 768);
export const W = 1920;
export const H = 1080;

// ── 이미지 모델 선택(SDXL 기본 / FLUX 옵트인) ─────────────────────────────────
// COMFY_MODEL=flux 로 FLUX 경로 활성화. 기본 sdxl 이라 기존 동작 100% 보존.
// FLUX 는 IPAdapter 미사용 경로(일러스트/카툰)에만 적용 — 포토리얼 IPAdapter 얼굴락은 SDXL 전용 유지.
export type ImageModel = "sdxl" | "flux";
export const IMAGE_MODEL: ImageModel =
	(process.env.COMFY_MODEL ?? "sdxl").toLowerCase() === "flux"
		? "flux"
		: "sdxl";
// FLUX 가중치 파일명(표준 ComfyUI 설치 기본값). 설치 위치 다르면 env 로 덮어쓴다.
export const FLUX_UNET = process.env.FLUX_UNET ?? "flux1-schnell.safetensors";
export const FLUX_CLIP_L = process.env.FLUX_CLIP_L ?? "clip_l.safetensors";
export const FLUX_T5 = process.env.FLUX_T5 ?? "t5xxl_fp8_e4m3fn.safetensors";
export const FLUX_VAE = process.env.FLUX_VAE ?? "ae.safetensors";
// schnell=4스텝/cfg1(빠름·무료·Mac 적합), dev=20+스텝+guidance. 기본 schnell.
export const FLUX_STEPS = Math.max(1, posIntEnv("FLUX_STEPS", 4));
export const FLUX_GUIDANCE = floatEnv("FLUX_GUIDANCE", 3.5); // dev 전용. schnell 은 무시.

export const log = (m: string) => process.stdout.write(`${m}\n`);

export function parseArgs(argv: string[]): Record<string, string> {
	const o: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		const k = argv[i].slice(2);
		const v = argv[i + 1];
		if (v === undefined || v.startsWith("--")) o[k] = "true";
		else {
			o[k] = v;
			i++;
		}
	}
	return o;
}

/** ComfyUI 큐 제출 → 폴링 → 결과 이미지 저장. */
export async function runComfy(
	workflow: unknown,
	outPath: string,
): Promise<string> {
	const q = await fetch(`${COMFY}/prompt`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ prompt: workflow }),
	});
	if (!q.ok) throw new Error(`ComfyUI queue ${q.status} ${await q.text()}`);
	const { prompt_id } = (await q.json()) as { prompt_id: string };
	for (let i = 0; i < 600; i++) {
		await new Promise((r) => setTimeout(r, 1500));
		const h = await fetch(`${COMFY}/history/${prompt_id}`);
		if (!h.ok) continue;
		const rec = (
			(await h.json()) as Record<
				string,
				{
					outputs?: Record<
						string,
						{ images?: { filename: string; subfolder: string; type: string }[] }
					>;
				}
			>
		)[prompt_id];
		const img = rec?.outputs
			? Object.values(rec.outputs)[0]?.images?.[0]
			: undefined;
		if (img) {
			const v = await fetch(
				`${COMFY}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`,
			);
			writeFileSync(outPath, Buffer.from(await v.arrayBuffer()));
			return outPath;
		}
	}
	throw new Error(`ComfyUI timeout (${outPath})`);
}

/** 이미지가 사실상 단색/공백인지 — SDXL 흔한 실패(빈 캔버스/솔리드)는 grayscale stddev 가 매우 낮다. */
export function isDegenerateImageStats(
	stddev: number,
	threshold = 12,
): boolean {
	return Number.isFinite(stddev) && stddev < threshold;
}

/** 이미지 grayscale 표준편차(Pillow). 실패 시 null(게이트는 null 을 통과로 처리 — 영상 막지 않음). */
export async function imageStddev(path: string): Promise<number | null> {
	const code = [
		"import sys",
		"from PIL import Image, ImageStat",
		'im = Image.open(sys.argv[1]).convert("L")',
		"print(ImageStat.Stat(im).stddev[0])",
	].join("\n");
	try {
		const { stdout } = await exec(COMFY_PYTHON, ["-c", code, path]);
		const v = Number.parseFloat(stdout.trim());
		return Number.isFinite(v) ? v : null;
	} catch {
		return null;
	}
}

/**
 * runComfy + degenerate(빈/솔리드) 프레임 게이트. degenerate 면 시드를 바꿔 재생성(최대 retries).
 * 절대 실패하지 않는다 — stats 못 구하거나 재시도 소진 시 마지막 이미지를 반환(최악=현행 동작).
 * makeWorkflow: 시드를 받아 워크플로를 만드는 팩토리(재생성 시 다른 시드로 호출).
 */
export async function runComfyChecked(
	makeWorkflow: (seed: number) => unknown,
	baseSeed: number,
	outPath: string,
	retries = 2,
): Promise<string> {
	let path = await runComfy(makeWorkflow(baseSeed), outPath);
	for (let r = 0; r < retries; r++) {
		const sd = await imageStddev(path);
		if (sd === null || !isDegenerateImageStats(sd)) break;
		log(
			`   ⚠ 씬 이미지 단색/공백 의심(stddev ${sd.toFixed(1)}) → 재생성 ${r + 1}/${retries}`,
		);
		// 재생성 실패(타임아웃/큐 오류)는 렌더 전체를 죽이지 말고 직전(최선) 이미지 유지(Codex P2).
		// 첫 생성 실패는 폴백 이미지가 없어 위에서 그대로 throw.
		try {
			path = await runComfy(makeWorkflow(baseSeed + (r + 1) * 9973), outPath);
		} catch (e) {
			log(`   ⚠ 재생성 실패(${e}) → 직전 이미지 유지`);
			break;
		}
	}
	return path;
}

// 내레이션 재생 속도 — 성장 플레이북 벤치마크(1.1~1.2x)로 페이싱·watch-time 개선.
// API/프록시 의존 없이 로컬 ffmpeg atempo(피치 보존)로 적용 → dur() 가 가속 후 길이를 측정하므로
// .srt·챕터·measure-and-extend 가 자동 동기. TTS_SPEED env 로 조정, [0.5,2.0] 클램프.
export const TTS_SPEED = Math.min(2, Math.max(0.5, floatEnv("TTS_SPEED", 1.1)));

/** TTS_PROVIDER 정규화 → "clova" | "elevenlabs". 빈값/미지원 값은 elevenlabs 로 폴백(기존 동작 보존). */
export function resolveTtsProvider(
	raw = process.env.TTS_PROVIDER,
): "clova" | "elevenlabs" {
	return (raw ?? "").trim().toLowerCase() === "clova" ? "clova" : "elevenlabs";
}

/** CLOVA Voice(NCP) 합성 → mp3 버퍼. speaker 미지정 시 CLOVA_SPEAKER env / nara.
 *  speed=0(정속)으로 받고 가속은 공용 atempo 경로에서 일괄 적용 → provider 간 TTS_SPEED 의미 동일.
 *  NOTE: CLOVA 1요청 텍스트 상한이 있으므로(씬 내레이션 1~2문장은 안전) 긴 단일 텍스트는 호출부에서 분할 전제. */
async function ttsClova(text: string): Promise<Buffer> {
	const speaker = process.env.CLOVA_SPEAKER ?? "nara";
	const res = await fetch(`${PROXY}/api/clova/tts`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ speaker, text, format: "mp3", speed: 0 }),
	});
	if (!res.ok) throw new Error(`CLOVA TTS ${res.status} ${await res.text()}`);
	return Buffer.from(await res.arrayBuffer());
}

/** ElevenLabs(기본 Bella) 합성 → mp3 버퍼. */
async function ttsElevenLabs(text: string, voice: string): Promise<Buffer> {
	const res = await fetch(`${PROXY}/api/elevenlabs/tts/${voice}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text,
			model_id: "eleven_multilingual_v2",
			voice_settings: { stability: 0.5, similarity_boost: 0.75 },
		}),
	});
	if (!res.ok) throw new Error(`TTS ${res.status} ${await res.text()}`);
	return Buffer.from(await res.arrayBuffer());
}

/** TTS → mp3 파일. TTS_PROVIDER 로 provider 선택(clova|elevenlabs), TTS_SPEED 는 공용 atempo 로 일괄 적용.
 *  voice 인자는 ElevenLabs 전용(CLOVA 는 CLOVA_SPEAKER 사용). */
export async function tts(
	text: string,
	out: string,
	voice = process.env.TTS_VOICE ?? "EXAVITQu4vr4xnSDxMaL",
): Promise<void> {
	const buf =
		resolveTtsProvider() === "clova"
			? await ttsClova(text)
			: await ttsElevenLabs(text, voice);
	if (TTS_SPEED === 1) {
		writeFileSync(out, buf);
		return;
	}
	// 가속: 원본을 tmp 에 쓰고 atempo 로 out 생성. 실패하면 원본(정속)으로 폴백 — 영상은 항상 살린다.
	const raw = `${out}.raw.mp3`;
	writeFileSync(raw, buf);
	try {
		await exec("ffmpeg", [
			"-y",
			"-i",
			raw,
			"-filter:a",
			`atempo=${TTS_SPEED}`,
			"-c:a",
			"libmp3lame",
			"-q:a",
			"2",
			out,
		]);
	} catch {
		writeFileSync(out, buf);
	} finally {
		rmSync(raw, { force: true }); // 중간 원본 정리(디스크 누수 방지, Codex P3)
	}
}

/** ffprobe 로 오디오 길이(초). 하한 1.5s. */
export async function dur(file: string): Promise<number> {
	const { stdout } = await exec("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		file,
	]);
	return Math.max(1.5, Number.parseFloat(stdout.trim()) || 3);
}

/**
 * 초 → SRT 타임스탬프(HH:MM:SS,mmm). 전체 ms 로 먼저 반올림한 뒤 분해 →
 * 1.9996 같은 경계에서 ms 가 1000 으로 넘쳐 "01,1000" 같은 잘못된 값이 나오는 것 방지(Codex P2).
 */
export function srtTime(s: number): string {
	const total = Math.max(0, Math.round(s * 1000));
	const ms = total % 1000;
	const sec = Math.floor(total / 1000) % 60;
	const m = Math.floor(total / 60000) % 60;
	const h = Math.floor(total / 3600000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/** api-proxy /api/openai/chat (LLM_BACKEND=claude) — JSON 응답 강제 후 파싱. */
export async function proxyChatJSON(
	system: string,
	user: string,
): Promise<Record<string, unknown>> {
	const cr = await fetch(`${PROXY}/api/openai/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			response_format: { type: "json_object" },
		}),
	});
	if (!cr.ok)
		throw new Error(`LLM ${cr.status} (api-proxy LLM_BACKEND=claude 확인)`);
	const content = (
		(await cr.json()) as { choices: { message: { content: string } }[] }
	).choices[0].message.content;
	return JSON.parse(content) as Record<string, unknown>;
}

/**
 * 썸네일 텍스트 오버레이 — 이 ffmpeg 빌드엔 drawtext 가 없어 Pillow(ComfyUI venv)로 인라인 실행.
 * python -c 로 직접(디스크에 .py 안 남김). 1280x720 크롭 + 좌상단 거대 텍스트.
 *
 * 색상 공식(검증된 한국 AI 롱폼 썸네일, 김재민TV 케이스 스터디): 흰색이 아니라 **밝은 노랑 + 두꺼운 검은
 * 외곽선** 2색 대비가 CTR 을 끌어올린다. 가독성 보강을 위해 텍스트 뒤에 반투명 검은 대비밴드를 깐다.
 * opts 로 색/밴드를 끌 수 있어 하위호환(기존 호출은 노랑 공식으로 자동 업그레이드).
 */
export interface ThumbnailTextOptions {
	/** 텍스트 채움색. 기본 검증값 = 밝은 노랑. */
	fill?: string;
	/** 외곽선 색/두께. */
	strokeFill?: string;
	strokeWidth?: number;
	/** 텍스트 뒤 반투명 대비밴드(가독성). 기본 on. */
	band?: boolean;
}

export async function overlayThumbnailText(
	rawPath: string,
	outPath: string,
	text: string,
	opts: ThumbnailTextOptions = {},
): Promise<void> {
	const fill = opts.fill ?? "#FFE000";
	const strokeFill = opts.strokeFill ?? "black";
	const strokeWidth = opts.strokeWidth ?? 12;
	const band = opts.band ?? true;
	const overlayCode = [
		"import sys",
		"from PIL import Image, ImageDraw, ImageFont",
		"src, out, text = sys.argv[1], sys.argv[2], sys.argv[3]",
		"fill, stroke_fill, stroke_width, band = sys.argv[4], sys.argv[5], int(sys.argv[6]), sys.argv[7] == '1'",
		'im = Image.open(src).convert("RGB")',
		"tw, th = 1280, 720",
		"w, h = im.size",
		"s = max(tw / w, th / h)",
		"im = im.resize((int(w * s), int(h * s)))",
		"w, h = im.size",
		"left, top = (w - tw) // 2, (h - th) // 2",
		"im = im.crop((left, top, left + tw, top + th))",
		'f = ImageFont.truetype("/System/Library/Fonts/AppleSDGothicNeo.ttc", 150, index=0)',
		"x, y = 44, 28",
		"if band:",
		"    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))",
		"    ld = ImageDraw.Draw(layer)",
		"    bb = ld.textbbox((x, y), text, font=f, stroke_width=stroke_width)",
		"    ld.rectangle((bb[0]-28, bb[1]-18, bb[2]+28, bb[3]+18), fill=(0, 0, 0, 150))",
		"    im = Image.alpha_composite(im.convert('RGBA'), layer).convert('RGB')",
		"d = ImageDraw.Draw(im)",
		"d.text((x, y), text, font=f, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)",
		"im.save(out, quality=90)",
	].join("\n");
	await exec(COMFY_PYTHON, [
		"-c",
		overlayCode,
		rawPath,
		outPath,
		text,
		fill,
		strokeFill,
		String(strokeWidth),
		band ? "1" : "0",
	]);
}

// ── 일러스트 미학(검증된 김재민TV 스타일) ─────────────────────────────────────

/**
 * 손그림 색연필/수채 "교과서 삽화" 스타일 프롬프트. 케이스 스터디(김재민TV)의 핵심 레버 —
 * 단일 일관 일러스트체가 캐릭터/장면 일관성을 싸게 풀고, 언캐니밸리를 피하며, "오리지널"로 보인다.
 * 포토리얼/IPAdapter 얼굴락 없이 스타일만으로 시리즈 일관성 확보. 텍스트/글자 억제.
 */
export function buildTextbookIllustrationPrompt(visual: string): string {
	return `hand-drawn colored pencil and soft watercolor textbook illustration, warm muted palette, clean confident linework, educational explainer diorama, consistent storybook art direction, gentle paper texture, no text no letters no words: ${visual}`;
}

// ── 공유 text-to-image 워크플로(SDXL/FLUX) ───────────────────────────────────
// 일러스트(make-vlog)·카툰(make-economy) 모두 동일한 비-IPAdapter t2i 그래프를 쓴다.
// 한 곳에서 SDXL↔FLUX 를 분기 → 모델 교체가 호출부 수정 없이 IMAGE_MODEL 한 곳으로 끝난다.
export interface T2IParams {
	/** 양성 프롬프트(스타일 빌더가 이미 적용된 최종 텍스트). */
	positive: string;
	/** SDXL 음성 프롬프트. FLUX 는 cfg=1 이라 무시(빈 conditioning 으로 전달). */
	negative: string;
	seed: number;
	/** 결과 파일 접두사(ComfyUI SaveImage). */
	filenamePrefix: string;
	/** 생성 해상도. 미지정 시 SCENE_W/H(가로). 숏폼은 세로 차원을 넘긴다. */
	width?: number;
	height?: number;
	/** SDXL classifier-free guidance(기본 7, 스타일 충실도). FLUX 는 항상 1. */
	cfg?: number;
}

/** SDXL t2i 그래프(CheckpointLoaderSimple → EmptyLatentImage → CLIP×2 → KSampler → VAE → Save). */
function sdxlT2IWorkflow(p: T2IParams, width: number, height: number) {
	return {
		"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width, height, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: p.positive, clip: ["4", 1] },
		},
		"7": {
			class_type: "CLIPTextEncode",
			inputs: { text: p.negative, clip: ["4", 1] },
		},
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: p.seed,
				steps: STEPS,
				cfg: p.cfg ?? 7,
				sampler_name: "dpmpp_2m",
				scheduler: "karras",
				denoise: 1,
				model: ["4", 0],
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"8": {
			class_type: "VAEDecode",
			inputs: { samples: ["3", 0], vae: ["4", 2] },
		},
		"9": {
			class_type: "SaveImage",
			inputs: { filename_prefix: p.filenamePrefix, images: ["8", 0] },
		},
	};
}

/**
 * FLUX t2i 그래프(표준 ComfyUI 템플릿): UNETLoader + DualCLIPLoader + VAELoader,
 * cfg=1(distilled), EmptySD3LatentImage(16ch), FluxGuidance(dev용·schnell 무시), euler/simple.
 * 음성 프롬프트는 cfg=1 에서 무시되지만 KSampler 입력 슬롯이 필요해 빈 conditioning 으로 연결.
 */
function fluxWorkflow(p: T2IParams, width: number, height: number) {
	return {
		"10": {
			class_type: "UNETLoader",
			inputs: { unet_name: FLUX_UNET, weight_dtype: "default" },
		},
		"11": {
			class_type: "DualCLIPLoader",
			inputs: {
				clip_name1: FLUX_CLIP_L,
				clip_name2: FLUX_T5,
				type: "flux",
			},
		},
		"12": { class_type: "VAELoader", inputs: { vae_name: FLUX_VAE } },
		"5": {
			class_type: "EmptySD3LatentImage",
			inputs: { width, height, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: p.positive, clip: ["11", 0] },
		},
		"13": {
			class_type: "FluxGuidance",
			inputs: { conditioning: ["6", 0], guidance: FLUX_GUIDANCE },
		},
		"14": {
			class_type: "CLIPTextEncode",
			inputs: { text: "", clip: ["11", 0] },
		},
		"3": {
			class_type: "KSampler",
			inputs: {
				seed: p.seed,
				steps: FLUX_STEPS,
				cfg: 1,
				sampler_name: "euler",
				scheduler: "simple",
				denoise: 1,
				model: ["10", 0],
				positive: ["13", 0],
				negative: ["14", 0],
				latent_image: ["5", 0],
			},
		},
		"8": {
			class_type: "VAEDecode",
			inputs: { samples: ["3", 0], vae: ["12", 0] },
		},
		"9": {
			class_type: "SaveImage",
			inputs: { filename_prefix: p.filenamePrefix, images: ["8", 0] },
		},
	};
}

/**
 * SDXL/FLUX 분기 디스패처. 기본은 IMAGE_MODEL(env COMFY_MODEL).
 * model 인자는 테스트/특수 호출에서 분기를 명시할 때만 사용(런타임 호출부는 생략 → env 따름).
 */
export function textToImageWorkflow(
	p: T2IParams,
	model: ImageModel = IMAGE_MODEL,
): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
	const width = p.width ?? SCENE_W;
	const height = p.height ?? SCENE_H;
	return model === "flux"
		? fluxWorkflow(p, width, height)
		: sdxlT2IWorkflow(p, width, height);
}

/**
 * 일러스트 워크플로(SDXL/FLUX 공용) — IPAdapter/호스트 레퍼런스 없음(스타일이 일관성을 운반).
 * make-vlog(--style illustration)·확장 장르 공용. cfg 7 로 스타일 충실도↑.
 * width/height 미지정 시 가로(SCENE_W/H). 숏폼은 세로 차원을 넘겨 크롭/업스케일 블러를 없앤다.
 */
export function illustrationWorkflow(
	prompt: string,
	seed: number,
	width: number = SCENE_W,
	height: number = SCENE_H,
) {
	return textToImageWorkflow({
		positive: buildTextbookIllustrationPrompt(prompt),
		negative:
			"photorealistic, realistic, 3d render, photograph, text, letters, words, watermark, signature, ugly, blurry, jpeg artifacts, deformed, extra fingers",
		seed,
		filenamePrefix: "vlog_illus",
		width,
		height,
		cfg: 7,
	});
}

// ── 출처 리스트(YouTube 재사용 콘텐츠 비수익화 회피) ──────────────────────────

/** 영상에 인용된 실제 자료 1건. */
export interface SourceRef {
	title?: string;
	/** 매체명(예: 연합뉴스). */
	source?: string;
	/** 게재일(원문 그대로). */
	date?: string;
	url?: string;
}

/** 한 줄 truncate(말줄임). */
function clip(s: string, max: number): string {
	const t = s.trim();
	return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
}

/**
 * 출처 슬라이드용 표시 줄 — "· {날짜} · {매체} — {제목}". 날짜/매체/제목/URL 중 있는 것만 조합.
 * 케이스 스터디의 "출처 리스트" 슬라이드(실뉴스 + URL)를 화면에 표기해 transformative commentary 로 만든다.
 */
export function buildSourceListLines(sources: SourceRef[], max = 14): string[] {
	const lines: string[] = [];
	for (const s of sources.slice(0, max)) {
		const head = [s.date, s.source].filter(Boolean).join(" · ");
		const title = s.title ?? s.url ?? "";
		const body = [head, title].filter(Boolean).join(" — ") || (s.url ?? "");
		if (body) lines.push(`· ${clip(body, 64)}`);
	}
	return lines;
}

/** 출처 리스트의 YouTube 설명란용 블록(URL 포함). */
export function buildSourceDescription(
	sources: SourceRef[],
	header = "출처 / Sources",
): string {
	const lines = sources
		.map((s) => {
			const head = [s.date, s.source, s.title].filter(Boolean).join(" · ");
			return [head, s.url].filter(Boolean).join("\n");
		})
		.filter(Boolean);
	return `${header}\n${lines.join("\n")}`;
}

/**
 * 출처 리스트 1920x1080 엔드슬라이드(Pillow). 어두운 배경 + 제목 + 줄 목록.
 * 영상 마지막 씬으로 끼워 어느 렌더 경로에서도 노출되게 한다.
 */
export async function renderSourceListSlide(
	header: string,
	lines: string[],
	outPath: string,
): Promise<string> {
	const code = [
		"import sys",
		"from PIL import Image, ImageDraw, ImageFont",
		"out, header, body = sys.argv[1], sys.argv[2], sys.argv[3]",
		"W, Hh = 1920, 1080",
		'im = Image.new("RGB", (W, Hh), (11, 19, 38))',
		"d = ImageDraw.Draw(im)",
		'fp = "/System/Library/Fonts/AppleSDGothicNeo.ttc"',
		"ftitle = ImageFont.truetype(fp, 72, index=0)",
		"fline = ImageFont.truetype(fp, 38, index=0)",
		'd.text((120, 90), header, font=ftitle, fill="#FFE000", stroke_width=2, stroke_fill="black")',
		"d.line((120, 200, 1800, 200), fill=(120, 130, 160), width=4)",
		"y = 250",
		'for ln in [l for l in body.split("\\n") if l.strip()][:14]:',
		'    d.text((120, y), ln, font=fline, fill="#DDE2FD")',
		"    y += 56",
		"im.save(out, quality=92)",
	].join("\n");
	await exec(COMFY_PYTHON, ["-c", code, outPath, header, lines.join("\n")]);
	return outPath;
}

// ── 챕터 타임스탬프(YouTube 챕터 + 업로드 메타) ───────────────────────────────

/** 초 → YouTube 타임스탬프(m:ss 또는 h:mm:ss). 첫 챕터는 항상 0:00 이어야 한다(YouTube 규칙). */
export function formatTimestamp(sec: number): string {
	const t = Math.max(0, Math.floor(sec));
	const h = Math.floor(t / 3600);
	const m = Math.floor((t % 3600) / 60);
	const s = t % 60;
	return h > 0
		? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
		: `${m}:${String(s).padStart(2, "0")}`;
}

/** {title, startSec}[] → YouTube 챕터 줄 배열("0:00 제목"). 첫 줄은 0:00 으로 강제. */
export function buildChapterMarkers(
	chapters: { title: string; startSec: number }[],
): string[] {
	return chapters.map((c, i) => {
		const start = i === 0 ? 0 : c.startSec;
		return `${formatTimestamp(start)} ${c.title}`;
	});
}
