/**
 * 무료 스택 시간여행 브이로그 영상 양산 CLI.
 *   대본(Claude 구독) → ComfyUI IP-Adapter 호스트 face-lock 이미지 → ElevenLabs 내레이션
 *   → ffmpeg(Ken Burns + 소프트 한글자막) → MP4 + .srt
 *
 * 핵심: 호스트 레퍼런스 포트레이트를 *채널당 1회* 생성·캐시 → 모든 에피소드 동일 인물(시리즈 일관성).
 *
 * 전제: ComfyUI(8188, SDXL+IP-Adapter) + api-proxy(3459, LLM_BACKEND=claude + ELEVENLABS) 가 떠 있어야 함.
 *
 * 사용:
 *   npm run vlog:make -- --era "고대 로마" --scenes 5
 *   npm run vlog:make -- --era titanic-1912 --channel my-history --out renders/
 *   COMFY_INPUT=~/ComfyUI/input npm run vlog:make -- --era 조선
 */
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	buildHistoricalChapters,
	buildHistoricalThumbnail,
	buildHistoricalTitle,
	buildPovVisualPrompt,
	type HistoricalEra,
	resolveEra,
} from "../src/lib/historical-vlog-format.ts";
import {
	buildHostIdentity,
	buildHostReferencePrompt,
	createStarterHost,
	type HostCharacter,
} from "../src/lib/host-character.ts";
import {
	END_CARD_FRAMES,
	TITLE_CARD_FRAMES,
} from "../src/remotion/cards/card-frames.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";

/** boltYT 루트(public/ + src/remotion/index.ts). scripts/ 의 부모. */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const exec = promisify(execFile);
const COMFY = process.env.COMFY_URL ?? "http://localhost:8188";
const PROXY = process.env.API_PROXY_URL ?? "http://localhost:3459";
const COMFY_INPUT = process.env.COMFY_INPUT ?? join(homedir(), "ComfyUI/input");
// 썸네일 텍스트 오버레이용(ffmpeg drawtext 부재 대비). ComfyUI venv 의 Pillow 사용.
const COMFY_PYTHON =
	process.env.COMFY_PYTHON ?? join(homedir(), "ComfyUI/venv/bin/python");
// ElevenLabs Bella(무료티어). 다른 보이스로 바꾸려면 --voice 또는 TTS_VOICE.
const TTS_VOICE = process.env.TTS_VOICE ?? "EXAVITQu4vr4xnSDxMaL";
const CKPT = process.env.COMFY_CKPT ?? "sd_xl_base_1.0.safetensors";
// 메모리/속도 튜닝(제약 하드웨어용). 기본은 고품질. 메모리 부족 시 낮춰서 SDXL 활성화 메모리·시간 절감.
// 예: SCENE_W=1024 SCENE_H=576 COMFY_STEPS=20 npm run vlog:make ...
/** 양의 정수 env 파싱. 잘못된 값(NaN/0/음수/소수)은 기본값 폴백 — ComfyUI 입력은 양의 정수 필수. */
function posIntEnv(name: string, def: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return def;
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 ? n : def;
}
/** ComfyUI 잠재 차원 env — 8의 배수로 반올림 + 최소 64(EmptyLatentImage는 8px 증분, 너무 작으면 큐 실패). */
function latentDimEnv(name: string, def: number): number {
	return Math.max(64, Math.round(posIntEnv(name, def) / 8) * 8);
}
const STEPS = Math.max(8, posIntEnv("COMFY_STEPS", 30));
const SCENE_W = latentDimEnv("SCENE_W", 1344);
const SCENE_H = latentDimEnv("SCENE_H", 768);
/** 양의 실수 env(0 초과). 잘못된 값은 기본값. */
function floatEnv(name: string, def: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return def;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : def;
}
/**
 * 비유럽 강문화 era 판정 — SDXL 이 강한 문화 프롬프트(조선/이집트 등)에서 호스트 ethnicity 를
 * 덮어써 드리프트가 나는 era. 이 경우 IPAdapter weight/end_at 를 올려 유럽계 호스트 얼굴을 고정한다.
 * (서구 era 는 낮은 weight 로 배경/군중을 더 살림.) env(IPA_WEIGHT/IPA_END_AT)가 항상 우선.
 */
function needsStrongIdentityLock(era: HistoricalEra): boolean {
	const t =
		`${era.settingKeywords} ${era.wardrobeKeywords} ${era.subjectEn}`.toLowerCase();
	// ASCII 마커: 선행 \b 경계로 부분매칭 차단(예: "looming"→ming, "tuxedo"→edo 오탐 방지).
	// 모호한 단편(ming/qing/tang/edo)은 제외 — china/japan 이 해당 왕조를 커버. 어미는 base 가 흡수
	// (korea→korean, japan→japanese, india→indian, africa→african, thai→thailand).
	const ascii =
		/\b(korea|joseon|hanok|hanbok|china|chinese|japan|samurai|mughal|india|persia|ottoman|egypt|pharaoh|nubian|aztec|maya|inca|africa|mongol|thai|vietnam)/;
	// 한글 마커(한글 era 명은 resolveEra 가 Hangul 을 settingKeywords 에 복사 — Codex). 다중자만.
	const hangul =
		/조선|한국|고려|신라|백제|고구려|중국|청나라|명나라|일본|사무라이|인도|무굴|페르시아|이집트|파라오|몽골|아즈텍|잉카|아프리카|베트남|태국|오스만/;
	return ascii.test(t) || hangul.test(t);
}
const W = 1920,
	H = 1080;
// 빈 배경 → 살아있는 장면. 레퍼런스(Chloe) 대비 최대 격차였던 "텅 빈 배경" 보정.
// (sceneWorkflow negative 에서 "multiple people" 제거와 짝 — 안 그러면 군중이 억제됨)
const CROWD =
	"bustling background crowd of period-accurate people going about daily life, lively populated scene, sense of depth";
const log = (m: string) => process.stdout.write(`${m}\n`);
const photoreal = (p: string) =>
	`Photorealistic cinematic still frame, 35mm film look, shallow depth of field, professional color grading, natural lighting, sharp focus, high detail, 8K: ${p}`;

function parseArgs(argv: string[]): Record<string, string> {
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

async function runComfy(workflow: unknown, outPath: string): Promise<string> {
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

function portraitWorkflow(prompt: string, seed: number) {
	return {
		"3": {
			class_type: "KSampler",
			inputs: {
				seed,
				steps: STEPS,
				cfg: 6.5,
				sampler_name: "dpmpp_2m",
				scheduler: "karras",
				denoise: 1,
				model: ["4", 0],
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: 832, height: 1024, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: prompt, clip: ["4", 1] },
		},
		"7": {
			class_type: "CLIPTextEncode",
			inputs: {
				text: "ugly, blurry, low quality, deformed, multiple people, cartoon, text, watermark",
				clip: ["4", 1],
			},
		},
		"8": {
			class_type: "VAEDecode",
			inputs: { samples: ["3", 0], vae: ["4", 2] },
		},
		"9": {
			class_type: "SaveImage",
			inputs: { filename_prefix: "vlog_host", images: ["8", 0] },
		},
	};
}

// weight: IPAdapter 얼굴 영향력. 높을수록 얼굴 고정↑ 배경/표정↓. 셀카/썸네일은 낮춰 배경·표정 살림.
function sceneWorkflow(
	prompt: string,
	seed: number,
	ref: string,
	weight = 0.6,
	endAt = 0.7,
) {
	return {
		"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
		"10": {
			class_type: "IPAdapterModelLoader",
			inputs: {
				ipadapter_file: "sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
			},
		},
		"11": {
			class_type: "CLIPVisionLoader",
			inputs: { clip_name: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors" },
		},
		"12": { class_type: "LoadImage", inputs: { image: ref } },
		"13": {
			class_type: "IPAdapterAdvanced",
			inputs: {
				model: ["4", 0],
				ipadapter: ["10", 0],
				image: ["12", 0],
				clip_vision: ["11", 0],
				weight,
				weight_type: "ease in-out",
				combine_embeds: "concat",
				start_at: 0,
				end_at: endAt,
				embeds_scaling: "V only",
			},
		},
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: SCENE_W, height: SCENE_H, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: prompt, clip: ["4", 1] },
		},
		"7": {
			class_type: "CLIPTextEncode",
			inputs: {
				text: "ugly, blurry, low quality, deformed, different face, cartoon, text, watermark, cropped face",
				clip: ["4", 1],
			},
		},
		"3": {
			class_type: "KSampler",
			inputs: {
				seed,
				steps: STEPS,
				cfg: 6.5,
				sampler_name: "dpmpp_2m",
				scheduler: "karras",
				denoise: 1,
				model: ["13", 0],
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
			inputs: { filename_prefix: "vlog_scene", images: ["8", 0] },
		},
	};
}

/** 와이드 환경샷 — 호스트 얼굴 없이 "그들이 보는 것"(군중·장소). 셀카 단조로움 깨기. */
function wideWorkflow(prompt: string, seed: number) {
	return {
		"3": {
			class_type: "KSampler",
			inputs: {
				seed,
				steps: STEPS,
				cfg: 6.5,
				sampler_name: "dpmpp_2m",
				scheduler: "karras",
				denoise: 1,
				model: ["4", 0],
				positive: ["6", 0],
				negative: ["7", 0],
				latent_image: ["5", 0],
			},
		},
		"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: SCENE_W, height: SCENE_H, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: prompt, clip: ["4", 1] },
		},
		"7": {
			class_type: "CLIPTextEncode",
			inputs: {
				text: "ugly, blurry, low quality, deformed, cartoon, text, watermark, selfie, close-up face, empty deserted",
				clip: ["4", 1],
			},
		},
		"8": {
			class_type: "VAEDecode",
			inputs: { samples: ["3", 0], vae: ["4", 2] },
		},
		"9": {
			class_type: "SaveImage",
			inputs: { filename_prefix: "vlog_wide", images: ["8", 0] },
		},
	};
}

async function tts(text: string, out: string): Promise<void> {
	const res = await fetch(`${PROXY}/api/elevenlabs/tts/${TTS_VOICE}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			text,
			model_id: "eleven_multilingual_v2",
			voice_settings: { stability: 0.5, similarity_boost: 0.75 },
		}),
	});
	if (!res.ok) throw new Error(`TTS ${res.status} ${await res.text()}`);
	writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

async function dur(file: string): Promise<number> {
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

function srtTime(s: number): string {
	const h = Math.floor(s / 3600),
		m = Math.floor((s % 3600) / 60),
		sec = Math.floor(s % 60),
		ms = Math.round((s % 1) * 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * 채널당 1회 호스트 포트레이트 생성·캐시 → 얼굴 크롭 → ComfyUI input. 재실행 시 재사용.
 * opts.shocked: 동일 styleSeed(동일 인물) + 놀란 표정 변형(썸네일용, 별도 캐시).
 */
async function ensureHostReference(
	host: HostCharacter,
	dir: string,
	opts: { shocked?: boolean } = {},
): Promise<string> {
	const id = buildHostIdentity(host);
	const suffix = opts.shocked ? "_shocked" : "";
	// 채널별 전체 styleSeed 를 키에 포함 — 같은 host.id 라도 채널 다르면 캐시 충돌 방지(Codex).
	// (생성 seed 는 ComfyUI 한도로 mod 하지만, 캐시 키는 절단하면 충돌하므로 전체 seed 사용)
	const refName = `vloghost_${host.id}_${id.styleSeed}${suffix}.png`;
	const refInInput = join(COMFY_INPUT, refName);
	if (existsSync(refInInput)) {
		log(`   호스트 레퍼런스 재사용: ${refName} (동일 인물 유지)`);
		return refName;
	}
	log(
		`   호스트 레퍼런스 최초 생성(채널당 1회)${opts.shocked ? " — 놀란 표정" : ""}...`,
	);
	// shocked 는 기본 프롬프트의 "neutral friendly expression" 을 치환(append 시 표정 충돌→중립으로 묻힘).
	const basePrompt = buildHostReferencePrompt(id);
	const prompt = opts.shocked
		? basePrompt.replace(
				"neutral friendly expression",
				"shocked surprised open-mouth wide-eyed expression",
			)
		: basePrompt;
	const portrait = await runComfy(
		portraitWorkflow(photoreal(prompt), id.styleSeed % 1_000_000),
		join(dir, `host${suffix}.png`),
	);
	const face = join(dir, `host_face${suffix}.png`);
	await exec("sips", [
		"-c",
		"620",
		"560",
		"--cropOffset",
		"0",
		"120",
		portrait,
		"--out",
		face,
	]);
	copyFileSync(face, refInInput);
	return refName;
}

interface VlogScene {
	narration: string;
	visual: string;
}

/** 단일 LLM 호출 → 씬 배열. 숏폼 1회 / 롱폼 챕터별 호출에서 공용. */
async function genScenes(userPrompt: string): Promise<VlogScene[]> {
	const cr = await fetch(`${PROXY}/api/openai/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [
				{
					role: "system",
					content: "한국 유튜브 시간여행 역사 브이로그 작가. JSON만 출력.",
				},
				{ role: "user", content: userPrompt },
			],
			response_format: { type: "json_object" },
		}),
	});
	if (!cr.ok)
		throw new Error(`대본 ${cr.status} (api-proxy LLM_BACKEND=claude 확인)`);
	const parsed = JSON.parse((await cr.json()).choices[0].message.content);
	return (Array.isArray(parsed.scenes) ? parsed.scenes : []) as VlogScene[];
}

// 6-비트 챕터별 분량 가중치(Chloe Rome 아크 기반: 훅 짧게→클라이맥스 최장→아웃트로 짧게).
const CHAPTER_WEIGHTS: Record<string, number> = {
	hook: 0.6,
	arrival: 1.0,
	immersion: 1.2,
	conflict: 1.4,
	revelation: 1.1,
	farewell: 0.7,
};

/** 롱폼 대본 — buildHistoricalChapters 6역할별 개별 호출(truncation 회피 + 챕터 구조 + 페이싱). */
async function generateLongformScript(
	era: HistoricalEra,
	minutes: number,
): Promise<VlogScene[]> {
	const chapters = buildHistoricalChapters(era, "ko"); // [{ role, note }]
	const totalScenes = Math.max(12, Math.round(minutes * 5)); // ~5 씬/분
	const sumW = chapters.reduce((s, c) => s + (CHAPTER_WEIGHTS[c.role] ?? 1), 0);
	const all: VlogScene[] = [];
	for (let i = 0; i < chapters.length; i++) {
		const ch = chapters[i];
		const n = Math.max(
			2,
			Math.round((totalScenes * (CHAPTER_WEIGHTS[ch.role] ?? 1)) / sumW),
		);
		const guide =
			ch.role === "hook"
				? " 첫 씬은 0-3초 강력한 패턴 인터럽트 훅(시청자를 멈추게). 느리고 몰입감 있게."
				: i === chapters.length - 1
					? " 마지막은 현재로 귀환 + 다음 시대 티저(시리즈 훅)."
					: " 챕터 끝은 다음으로 이어지는 궁금증(open loop)으로.";
		const usr = `${era.subjectKo} 시간여행 1인칭 한국어 브이로그의 "${ch.role}" 챕터. 연출 의도: ${ch.note}. 정확히 ${n}개 씬.${guide} 각 씬: narration(한국어 1-2문장, 1인칭·몰입·생생), visual(영어, 그 장면 시각 묘사). 직전 흐름과 자연스럽게 연결. JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
		log(`   챕터 ${i + 1}/${chapters.length} (${ch.role}, ${n}씬)...`);
		// 챕터당 n 으로 캡 — LLM 초과 반환 시 이미지/TTS 비용 폭증 방지(Codex).
		all.push(...(await genScenes(usr)).slice(0, n));
	}
	return all;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const era: HistoricalEra = resolveEra(args.era ?? "고대 로마");
	// 비서구 강문화 era 는 IPAdapter 를 강하게(호스트 ethnicity 드리프트 방지). env 가 항상 우선.
	const strongLock = needsStrongIdentityLock(era);
	// 서양 셀카 0.72: A/B 검증값(0.5=씬 간 호스트 드리프트, 0.72=신원 고정+배경 유지, 0.85=배경 과압축).
	// 비서양 0.85: ethnicity 드리프트(강문화 프롬프트가 유럽계 얼굴을 덮어씀) 방어용 — 더 강해야 함.
	const ipaWeight = Math.min(
		1,
		floatEnv("IPA_WEIGHT", strongLock ? 0.85 : 0.72),
	);
	const ipaEndAt = Math.min(1, floatEnv("IPA_END_AT", strongLock ? 0.9 : 0.7));
	const sceneCount = Math.max(2, Math.min(8, Number(args.scenes ?? "4")));
	// 롱폼 모드: --minutes N → 6챕터 구조. 미지정 시 숏폼(--scenes).
	const minutes = args.minutes ? Math.max(1, Number(args.minutes)) : 0;
	const channel = args.channel ?? "my-history";
	const stamp =
		Number(process.env.SOURCE_DATE_EPOCH) || Math.floor(Date.now() / 1000);
	const outDir = args.out ?? join(process.cwd(), "renders");
	mkdirSync(outDir, { recursive: true });
	const work = join(outDir, `vlog_${era.id}_${stamp}`);
	mkdirSync(work, { recursive: true });
	log(
		`▶ ${era.subjectKo} 시간여행 브이로그 (${minutes ? `롱폼 ~${minutes}분` : `${sceneCount}씬`}) — 채널 ${channel}`,
	);

	// 1) 대본 (Claude)
	let scenes: VlogScene[];
	if (minutes) {
		log(`1) 롱폼 대본 — 6챕터 구조 (목표 ~${minutes}분)...`);
		scenes = await generateLongformScript(era, minutes);
	} else {
		log("1) 대본(Claude)...");
		const usr = `${era.subjectKo}로 시간여행한 1인칭 한국어 브이로그. 정확히 ${sceneCount}개 씬. 각 씬: narration(한국어 1문장, 1인칭·몰입·생생), visual(영어, 그 장면 시각 묘사). JSON: {"scenes":[{"narration":"...","visual":"..."}]}`;
		scenes = (await genScenes(usr)).slice(0, sceneCount);
	}
	if (scenes.length === 0) throw new Error("대본 생성 실패 (씬 0개)");
	log(
		`   ${scenes.length}씬 생성${minutes ? " (6챕터)" : ""}: ${scenes
			.map((s) => s.narration.slice(0, 12))
			.join(" / ")
			.slice(0, 110)}`,
	);

	// 2) 호스트 레퍼런스(채널 캐시)
	log("2) 호스트 레퍼런스...");
	const host = createStarterHost(channel, "ko");
	const ref = await ensureHostReference(host, work);

	// 3) 씬별 이미지 + 내레이션 (메타 수집 — 렌더는 4단계)
	const made: { img: string; mp3: string; narration: string; d: number }[] = [];
	const srt: string[] = [];
	// 카드는 롱폼 Remotion(YouTubeVideo) 전용 — Shorts/ffmpeg 경로엔 미적용(Codex P2).
	const useCards =
		!!minutes && args.shorts !== "true" && args.ffmpeg !== "true";
	// 인트로 카드가 씬 블록을 TITLE_CARD_FRAMES(90f@30fps=3s)만큼 뒤로 민다 → .srt 도 동일 오프셋
	// (Codex P2: 안 그러면 업로드 자막이 3초 빠름). 씬0 전치=none(overlap 0)이라 강체 이동만 보정하면 충분.
	const introOffsetSec = useCards ? TITLE_CARD_FRAMES / 30 : 0;
	let cursor = introOffsetSec;
	for (let i = 0; i < scenes.length; i++) {
		// 셀카(호스트 face-lock) ↔ 와이드(환경+군중) 교차. 0=셀카 훅, 1=와이드, 2=셀카 ...
		const isWide = i % 2 === 1;
		log(
			`3.${i + 1}) ${isWide ? "와이드 환경샷(군중)" : "셀카 face-lock"} + 내레이션...`,
		);
		const img = await runComfy(
			isWide
				? wideWorkflow(
						photoreal(
							`${scenes[i].visual}, ${era.settingKeywords}, wide establishing shot, ${CROWD}`,
						),
						1000 + i * 137,
					)
				: sceneWorkflow(
						// medium 셀카(허리 위) + 중간 weight(서양 0.72/비서양 0.85) → 호스트 신원 고정하며 배경/군중 유지
						photoreal(
							`${buildPovVisualPrompt(scenes[i].visual, era)}, medium selfie shot waist-up, host positioned to one side, expansive detailed background with ${CROWD} clearly visible`,
						),
						1000 + i * 137,
						ref,
						ipaWeight,
						ipaEndAt,
					),
			join(work, `scene${i}.png`),
		);
		const mp3 = join(work, `scene${i}.mp3`);
		await tts(scenes[i].narration, mp3);
		const d = await dur(mp3);
		made.push({ img, mp3, narration: scenes[i].narration, d });
		srt.push(
			`${i + 1}\n${srtTime(cursor)} --> ${srtTime(cursor + d)}\n${scenes[i].narration}\n`,
		);
		cursor += d;
	}

	// 썸네일 — 공식(놀란 호스트 + 거대 텍스트 + 시대 배경). CTR 자산. 실패해도 영상엔 무영향.
	const thumbPath = join(outDir, `vlog_${era.id}_${stamp}_thumb.jpg`);
	try {
		log("3.t) 썸네일(놀란 호스트 + 거대 텍스트)...");
		const thumb = buildHistoricalThumbnail(era, "ko");
		// 놀란 표정 레퍼런스(동일 인물) → 표정은 ref 가 운반하므로 weight 0.6 으로 identity 확보.
		const shockedRef = await ensureHostReference(host, work, { shocked: true });
		const thumbRaw = await runComfy(
			sceneWorkflow(
				photoreal(
					`${era.settingKeywords}, ${CROWD}, the host reacting with a ${thumb.expression} shocked surprised open mouth, medium selfie shot waist-up, dramatic cinematic lighting, vivid high-contrast YouTube thumbnail`,
				),
				777,
				shockedRef,
				Math.max(0.6, ipaWeight),
				ipaEndAt,
			),
			join(work, "thumb_raw.png"),
		);
		// 텍스트 오버레이 — 이 ffmpeg 빌드엔 drawtext 필터가 없어 Pillow(ComfyUI venv)로 인라인 실행.
		// python -c 로 직접 실행(디스크에 .py 안 남김). 1280x720 크롭 + 좌상단 거대 텍스트(흰+검은 외곽선).
		const overlayCode = [
			"import sys",
			"from PIL import Image, ImageDraw, ImageFont",
			"src, out, text = sys.argv[1], sys.argv[2], sys.argv[3]",
			'im = Image.open(src).convert("RGB")',
			"tw, th = 1280, 720",
			"w, h = im.size",
			"s = max(tw / w, th / h)",
			"im = im.resize((int(w * s), int(h * s)))",
			"w, h = im.size",
			"left, top = (w - tw) // 2, (h - th) // 2",
			"im = im.crop((left, top, left + tw, top + th))",
			"d = ImageDraw.Draw(im)",
			'f = ImageFont.truetype("/System/Library/Fonts/AppleSDGothicNeo.ttc", 150, index=0)',
			'd.text((44, 28), text, font=f, fill="white", stroke_width=9, stroke_fill="black")',
			"im.save(out, quality=90)",
		].join("\n");
		await exec(COMFY_PYTHON, [
			"-c",
			overlayCode,
			thumbRaw,
			thumbPath,
			thumb.bigText,
		]);
		log(`   썸네일: ${thumbPath}`);
	} catch (e) {
		log(`   썸네일 생략(${e})`);
	}

	// .srt 는 어느 렌더 경로든 YouTube 업로드용으로 항상 출력
	const srtPath = join(outDir, `vlog_${era.id}_${stamp}.srt`);
	writeFileSync(srtPath, srt.join("\n"));
	const finalPath = join(outDir, `vlog_${era.id}_${stamp}.mp4`);

	if (args.ffmpeg === "true") {
		// 4a) 폴백: ffmpeg 슬라이드쇼(Ken Burns + 소프트 자막만). 동적 자막/전환/BGM 없음.
		log("4) 합성(ffmpeg 폴백)...");
		const clips: string[] = [];
		for (let i = 0; i < made.length; i++) {
			const { img, mp3, d } = made[i];
			const clip = join(work, `clip${i}.mp4`);
			await exec("ffmpeg", [
				"-y",
				"-loop",
				"1",
				"-i",
				img,
				"-i",
				mp3,
				"-filter_complex",
				`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},zoompan=z='min(zoom+0.0004,1.07)':d=${Math.round(d * 30)}:s=${W}x${H}:fps=30,setsar=1[v]`,
				"-map",
				"[v]",
				"-map",
				"1:a",
				"-t",
				String(d),
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-c:a",
				"aac",
				"-b:a",
				"128k",
				clip,
			]);
			clips.push(clip);
		}
		writeFileSync(
			join(work, "concat.txt"),
			clips.map((c) => `file '${c}'`).join("\n"),
		);
		const merged = join(work, "merged.mp4");
		await exec("ffmpeg", [
			"-y",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			join(work, "concat.txt"),
			"-c",
			"copy",
			merged,
		]);
		try {
			await exec("ffmpeg", [
				"-y",
				"-i",
				merged,
				"-i",
				srtPath,
				"-map",
				"0:v",
				"-map",
				"0:a",
				"-map",
				"1",
				"-c:v",
				"copy",
				"-c:a",
				"copy",
				"-c:s",
				"mov_text",
				"-metadata:s:s:0",
				"language=kor",
				finalPath,
			]);
		} catch {
			copyFileSync(merged, finalPath);
		}
	} else {
		// 4b) 기본: Remotion 렌더 — 동적 자막(chunked) + 전환 + BGM 덕킹 + Ken Burns.
		log("4) Remotion 렌더(동적 자막 + 전환 + BGM)...");
		await renderVlogRemotion({
			scenes: made.map((m) => ({
				imageUrl: m.img,
				audioUrl: m.mp3,
				narration: m.narration,
				durationSec: m.d,
			})),
			outPath: finalPath,
			projectRoot: PROJECT_ROOT,
			compositionId: args.shorts === "true" ? "YouTubeShorts" : "YouTubeVideo",
			runId: `${era.id}_${stamp}`,
			// 롱폼 Remotion 경로만 인트로/아웃트로 카드(숏폼은 8s 오버헤드 과함 + Shorts 컴포지션 미지원).
			intro: useCards
				? { title: buildHistoricalTitle(era, "ko"), channelName: channel }
				: undefined,
			outro: useCards
				? { channelName: channel, ctaText: "다음 시대도 곧 공개!" }
				: undefined,
			onProgress: (pct) => process.stdout.write(`\r   렌더: ${pct}%`),
		});
		log("");
	}

	// cursor = 인트로오프셋 + Σ씬오디오. 아웃트로 카드 길이를 더해 실제 영상 총길이 보고.
	const totalSec = cursor + (useCards ? END_CARD_FRAMES / 30 : 0);
	log(
		`\n✅ 완성: ${finalPath} (${Math.round(totalSec)}초)\n   자막: ${srtPath} (YouTube 업로드용)`,
	);
}

main().catch((e) => {
	process.stderr.write(`ERROR: ${e}\n`);
	process.exit(1);
});
