/**
 * 가스펠 재즈 AI 플리 — 완전 로컬·무료 생성기 (PoC 수직 슬라이스).
 *
 * 포맷 출처: X @OctoSurvivor 불교 재즈 채널 역분석(개사 보컬 + 일관 캐릭터 + 밈 제목 + 음원유통).
 * 톤 = 하이브리드: 가사는 경건(퍼블릭도메인 시편/찬송가 기반 개사), 제목·썸네일은 밈.
 *
 * 엔진 = **로컬 ComfyUI(키 불필요, $0)**:
 *   - 노래: ACE-Step v1 3.5B (tags+lyrics→보컬 노래, Apache-2.0, 한국어 지원). 노드 TextEncodeAceStepAudio 등.
 *           모델: ~/ComfyUI/models/checkpoints/ace_step_v1_3.5b.safetensors
 *   - 이미지: SDXL(COMFY_CKPT, 기본 sd_xl_base_1.0). 마스코트(신성모독 0, 로파이걸 풍).
 *   - 조립: ffmpeg.
 * provider 추상화: composeMusic()/genMascot() 만 교체하면 FAL·Suno·ElevenLabs 로 스왑(클라우드 fallback).
 * ⚠️ 한국어 가창 품질이 GO/NO-GO. 무료라 시드 바꿔가며 베스트 테이크 채굴 가능.
 *
 * 실행: `npx tsx scripts/make-gospeljazz.ts` (ComfyUI가 localhost:8188 에 떠 있어야 함)
 * 의존: 로컬 ComfyUI(ACE-Step 모델 + SDXL 체크포인트) · ffmpeg. 키/네트워크 불필요.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COMFY = process.env.COMFY_URL ?? "http://localhost:8188";
const CKPT = process.env.COMFY_CKPT ?? "sd_xl_base_1.0.safetensors";
const ACE_CKPT = process.env.ACE_CKPT ?? "ace_step_v1_3.5b.safetensors";
const ACE_PRICE_PER_SEC = 0.0002; // 참고: 클라우드(FAL ace-step) 가격. 로컬은 $0.

// ── 데이터 모델 ───────────────────────────────────────────────────────────────
export interface LyricSection {
	name: string; // intro|verse|chorus|bridge|outro (구조 태그 매핑용)
	styles: string[]; // 섹션별 뉘앙스(현재 ACE는 글로벌 tags 사용, 향후 provider용)
	lines: string[];
	durationMs: number;
}
export interface GospelTrack {
	id: string;
	title: string; // 밈 톤(YouTube 제목/썸네일)
	source: string; // 개사 출처(저작권 안전성 추적)
	globalStyles: string[]; // ACE tags
	negativeStyles: string[];
	sections: LyricSection[];
	imagePrompt: string; // 마스코트
}

// ── 순수 함수(테스트 대상) ────────────────────────────────────────────────────
/** 섹션명 → ACE-Step 구조 태그. */
export function aceSectionTag(name: string): string {
	const n = name.toLowerCase();
	if (n.includes("chorus")) return "[chorus]";
	if (n.includes("bridge")) return "[bridge]";
	if (n.includes("outro")) return "[outro]";
	if (n.includes("intro")) return "[intro]";
	return "[verse]";
}

/** GospelTrack → ACE-Step lyrics 문자열(구조 태그 + 줄). */
export function buildAceLyrics(t: GospelTrack): string {
	return t.sections
		.map((s) => `${aceSectionTag(s.name)}\n${s.lines.join("\n")}`)
		.join("\n\n");
}

/** GospelTrack → ACE-Step tags(쉼표 구분 스타일). */
export function buildAceTags(t: GospelTrack): string {
	return t.globalStyles.join(", ");
}

/** GospelTrack → ACE-Step negative tags(금지 스타일). KSampler negative 조건에 주입 → 회피. */
export function buildAceNegativeTags(t: GospelTrack): string {
	return t.negativeStyles.join(", ");
}

/** 총 길이(ms). */
export function totalDurationMs(t: GospelTrack): number {
	return t.sections.reduce((a, s) => a + s.durationMs, 0);
}

/** 참고용 클라우드 비용(USD). 로컬 실행은 $0. */
export function estimateCostUsd(t: GospelTrack): number {
	return (totalDurationMs(t) / 1000) * ACE_PRICE_PER_SEC;
}

/** 기본 검증: 총 5000~240000ms(ACE-Step 길이 한계 5~240s), 줄≤200자. 위반 메시지 배열.
 *  composeMusic 이 totalDurationMs/1000 초를 ACE-Step 에 그대로 보내므로 범위를 제공자 한계에 맞춘다 —
 *  안 그러면 5초 미만/240초 초과 트랙이 preflight 통과 후 생성 단계서 422 로 죽는다(Codex). */
export function validateTrack(t: GospelTrack): string[] {
	const errs: string[] = [];
	const total = totalDurationMs(t);
	if (total < 5000 || total > 240000)
		errs.push(`총 길이 ${total}ms (ACE-Step 한계 5000~240000ms 벗어남)`);
	for (const s of t.sections)
		for (const ln of s.lines)
			if (ln.length > 200)
				errs.push(
					`섹션 '${s.name}' 줄 ${ln.length}자 (>200): ${ln.slice(0, 30)}…`,
				);
	return errs;
}

// ── ComfyUI 워크플로 빌더(순수) ──────────────────────────────────────────────
/** ACE-Step 텍스트→음악 그래프. tags+lyrics → 보컬 노래(seconds 길이). */
export function aceStepWorkflow(
	tags: string,
	lyrics: string,
	seconds: number,
	seed: number,
	steps = 60,
	negativeTags = "",
): Record<string, unknown> {
	return {
		"1": {
			class_type: "CheckpointLoaderSimple",
			inputs: { ckpt_name: ACE_CKPT },
		},
		"2": {
			class_type: "EmptyAceStepLatentAudio",
			inputs: { seconds, batch_size: 1 },
		},
		"3": {
			class_type: "TextEncodeAceStepAudio",
			inputs: { clip: ["1", 1], tags, lyrics, lyrics_strength: 1 },
		},
		"4": {
			class_type: "TextEncodeAceStepAudio",
			inputs: {
				clip: ["1", 1],
				tags: negativeTags,
				lyrics: "",
				lyrics_strength: 1,
			},
		},
		"5": {
			class_type: "KSampler",
			inputs: {
				seed,
				steps,
				cfg: 5,
				sampler_name: "euler",
				scheduler: "simple",
				denoise: 1,
				model: ["1", 0],
				positive: ["3", 0],
				negative: ["4", 0],
				latent_image: ["2", 0],
			},
		},
		"6": {
			class_type: "VAEDecodeAudio",
			inputs: { samples: ["5", 0], vae: ["1", 2] },
		},
		"7": {
			class_type: "SaveAudio",
			inputs: { audio: ["6", 0], filename_prefix: "gospel_jazz" },
		},
	};
}

/** SDXL 마스코트 txt2img 그래프(16:9). */
export function mascotWorkflow(
	prompt: string,
	seed: number,
): Record<string, unknown> {
	return {
		"4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CKPT } },
		"5": {
			class_type: "EmptyLatentImage",
			inputs: { width: 1344, height: 768, batch_size: 1 },
		},
		"6": {
			class_type: "CLIPTextEncode",
			inputs: { text: prompt, clip: ["4", 1] },
		},
		"7": {
			class_type: "CLIPTextEncode",
			inputs: {
				text: "photorealistic, 3d render, text, letters, watermark, signature, ugly, deformed, extra limbs, blurry, low quality, cluttered",
				clip: ["4", 1],
			},
		},
		"3": {
			class_type: "KSampler",
			inputs: {
				seed,
				steps: 30,
				cfg: 7,
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
			inputs: { filename_prefix: "gospel_mascot", images: ["8", 0] },
		},
	};
}

// ── ComfyUI 클라이언트(로컬, 키 불필요) ───────────────────────────────────────
interface ComfyFileRef {
	filename: string;
	subfolder: string;
	type: string;
}

/** 워크플로 제출 → 완료 폴링 → 첫 출력(audio|images) 파일 ref 반환. */
async function runComfyGetFile(
	workflow: Record<string, unknown>,
	kind: "audio" | "images",
	timeoutMs = 1500000,
): Promise<ComfyFileRef> {
	const q = await fetch(`${COMFY}/prompt`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ prompt: workflow }),
	});
	if (!q.ok) throw new Error(`ComfyUI queue ${q.status}: ${await q.text()}`);
	const { prompt_id } = (await q.json()) as { prompt_id: string };

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await sleep(3000);
		const h = await fetch(`${COMFY}/history/${prompt_id}`);
		if (!h.ok) continue;
		const hist = (await h.json()) as Record<
			string,
			{
				status?: { completed?: boolean; status_str?: string };
				outputs?: Record<string, Record<string, ComfyFileRef[]>>;
			}
		>;
		const rec = hist[prompt_id];
		if (!rec) continue;
		for (const node of Object.values(rec.outputs ?? {})) {
			const ref = node[kind]?.[0];
			if (ref) return ref;
		}
		if (rec.status?.completed) {
			throw new Error(
				`ComfyUI 완료됐으나 ${kind} 출력 없음 (status=${rec.status?.status_str})`,
			);
		}
	}
	throw new Error(`ComfyUI 타임아웃(${Math.round(timeoutMs / 1000)}s)`);
}

/** ComfyUI /view 로 출력 파일 다운로드. */
async function fetchComfyFile(
	ref: ComfyFileRef,
	outPath: string,
): Promise<void> {
	const url = `${COMFY}/view?filename=${encodeURIComponent(ref.filename)}&subfolder=${encodeURIComponent(ref.subfolder)}&type=${ref.type}`;
	const v = await fetch(url);
	if (!v.ok) throw new Error(`ComfyUI view ${v.status}`);
	writeFileSync(outPath, Buffer.from(await v.arrayBuffer()));
}

// ── IO / 엔진(로컬) ───────────────────────────────────────────────────────────
/** 노래 생성 — 로컬 ComfyUI ACE-Step. (provider 교체 지점) */
async function composeMusic(t: GospelTrack, outPath: string): Promise<string> {
	const wf = aceStepWorkflow(
		buildAceTags(t),
		buildAceLyrics(t),
		Math.round(totalDurationMs(t) / 1000),
		seedFor(t.id),
		undefined,
		buildAceNegativeTags(t),
	);
	const ref = await runComfyGetFile(wf, "audio");
	const ext = ref.filename.split(".").pop() ?? "flac";
	const finalPath = `${outPath}.${ext}`;
	await fetchComfyFile(ref, finalPath);
	return finalPath;
}

/** 마스코트 정지컷 — 로컬 ComfyUI SDXL. */
async function genMascot(t: GospelTrack, outPath: string): Promise<void> {
	const wf = mascotWorkflow(t.imagePrompt, seedFor(`${t.id}-img`));
	const ref = await runComfyGetFile(wf, "images");
	await fetchComfyFile(ref, outPath);
}

/** 정지컷 + 오디오 → mp4(롱폼 조립의 최소 버전). loudnorm 마스터링 포함. */
async function assembleVideo(
	image: string,
	audio: string,
	out: string,
): Promise<void> {
	await exec("ffmpeg", [
		"-y",
		"-loop",
		"1",
		"-i",
		image,
		"-i",
		audio,
		"-af",
		"loudnorm=I=-14:TP=-1.5:LRA=11",
		"-c:v",
		"libx264",
		"-tune",
		"stillimage",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-pix_fmt",
		"yuv420p",
		"-shortest",
		out,
	]);
}

/** 결정적 시드(트랙 id 기반) — 정체성 일관성. */
export function seedFor(key: string): number {
	let h = 2166136261;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return Math.abs(h) % 2 ** 31;
}

// ── PoC 트랙: 시편 23편 가스펠 재즈(퍼블릭도메인) ─────────────────────────────
export const PSALM23: GospelTrack = {
	id: "psalm23-gospel-jazz",
	title:
		"주님이 목자라는데 왜 이렇게 세련됐냐🎷 | 시편 23편 가스펠 재즈 (lo-fi)",
	source: "시편 23편 (public domain) 자유 개사",
	globalStyles: [
		"lo-fi gospel jazz",
		"brushed drums",
		"soft rhodes piano",
		"upright bass",
		"korean female alto vocals",
		"mellow",
		"72 bpm",
		"reverent",
		"cozy sunday",
		"vinyl warmth",
	],
	negativeStyles: ["aggressive", "edm", "distorted", "fast"],
	sections: [
		{
			name: "verse1",
			styles: ["soft intro", "gentle rhodes"],
			durationMs: 28000,
			lines: [
				"여호와는 나의 목자 내게 부족함 없네",
				"푸른 풀밭 그 위에 나를 누이시고",
				"쉴 만한 물가로 내 영혼 이끄시네",
			],
		},
		{
			name: "chorus1",
			styles: ["fuller band", "smooth gospel jazz"],
			durationMs: 24000,
			lines: [
				"오 주님 함께라면",
				"어두운 골짜기도 두렵지 않아",
				"주의 지팡이 막대기 날 위로하시네",
			],
		},
		{
			name: "verse2",
			styles: ["soft", "piano-led"],
			durationMs: 24000,
			lines: [
				"원수의 앞에서도 상을 베푸시고",
				"머리에 기름 부으니 내 잔이 넘치네",
			],
		},
		{
			name: "chorus2",
			styles: ["fuller band"],
			durationMs: 24000,
			lines: ["오 주님 함께라면", "선하심과 인자하심 날 따르리"],
		},
		{
			name: "outro",
			styles: ["soft fade", "humming"],
			durationMs: 20000,
			lines: ["주의 집에 영원히 내가 거하리라", "영원히 영원히 거하리라"],
		},
	],
	imagePrompt:
		"cozy lo-fi anime illustration, a young Korean woman in a knit sweater sitting by a sunlit window reading an open Bible, warm golden afternoon light through soft stained glass, a small white lamb resting nearby, potted plants and a vinyl player, muted warm color palette, peaceful reverent mood, lofi-girl aesthetic, 16:9, no text no letters",
};

async function main(): Promise<void> {
	const t = PSALM23;
	const errs = validateTrack(t);
	if (errs.length) {
		console.error(`❌ 트랙 검증 실패:\n - ${errs.join("\n - ")}`);
		process.exit(1);
	}
	const outDir = join(process.cwd(), "output", "gospel-jazz");
	mkdirSync(outDir, { recursive: true });
	const image = join(outDir, `${t.id}.png`);
	const video = join(outDir, `${t.id}.mp4`);

	const secs = Math.round(totalDurationMs(t) / 1000);
	console.log(
		`🎼 ${t.title}\n   출처: ${t.source} · 길이 ~${secs}s · 엔진 로컬 ComfyUI(ACE-Step) · 비용 $0\n   ComfyUI=${COMFY}\n`,
	);
	console.log("[1/3] 🎵 ACE-Step 가창 생성(로컬, 수 분 소요 가능)…");
	const audio = await composeMusic(t, join(outDir, t.id));
	console.log(`   → ${audio}`);
	console.log("[2/3] 🖼️  마스코트 정지컷(로컬 SDXL)…");
	await genMascot(t, image);
	console.log(`   → ${image}`);
	console.log("[3/3] 🎬 ffmpeg 조립 + 라우드니스 마스터링…");
	await assembleVideo(image, audio, video);
	console.log(`   → ${video}`);
	console.log(
		`\n✅ 완료. 들어보고 한국어 가창 품질로 GO/NO-GO 판정. (전부 로컬·무료)`,
	);
}

// 정확한 엔트리포인트 일치만(make-economy 컨벤션). .includes 면 make-gospeljazz.test.ts 를
// tsx 로 직접 실행 시에도 매치돼 import 만으로 유료 FAL 호출 main()이 돌 수 있음(Codex).
if (process.argv[1]?.endsWith("make-gospeljazz.ts")) {
	main().catch((e) => {
		console.error("❌", e?.message ?? e);
		process.exit(1);
	});
}
