/**
 * vlog 양산 공유 저수준 유틸 — 장르 무관(history/economy 공용).
 * make-vlog(역사)·make-economy(경제)가 동일 ComfyUI/TTS/LLM/ffprobe 배선을 쓰도록 추출.
 * 장르별 워크플로(IPAdapter vs 카툰)·대본·썸네일 구도는 각 CLI 가 별도로 정의한다.
 */
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
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
export const SCENE_W = latentDimEnv("SCENE_W", 1344);
export const SCENE_H = latentDimEnv("SCENE_H", 768);
export const W = 1920;
export const H = 1080;

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

/** ElevenLabs(기본 Bella) TTS → mp3 파일. voice 미지정 시 TTS_VOICE env / Bella. */
export async function tts(
	text: string,
	out: string,
	voice = process.env.TTS_VOICE ?? "EXAVITQu4vr4xnSDxMaL",
): Promise<void> {
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
	writeFileSync(out, Buffer.from(await res.arrayBuffer()));
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
 * python -c 로 직접(디스크에 .py 안 남김). 1280x720 크롭 + 좌상단 거대 텍스트(흰+검은 외곽선).
 */
export async function overlayThumbnailText(
	rawPath: string,
	outPath: string,
	text: string,
): Promise<void> {
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
	await exec(COMFY_PYTHON, ["-c", overlayCode, rawPath, outPath, text]);
}
