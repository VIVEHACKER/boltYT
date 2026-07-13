/**
 * Reference-style shopping-shorts interview video.
 *
 * Inspired by the public structure of https://www.youtube.com/watch?v=92P3_d6yXlM:
 * highlight montage -> interview Q/A -> screen-demo style explanation -> CTA.
 *
 * It does not copy the source footage, script, claims, or risky reuse advice.
 * It generates original ComfyUI visuals and local TTS, then renders with boltYT
 * Remotion.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { remotionMotionFor } from "../src/lib/camera-movements.ts";
import { TITLE_CARD_FRAMES } from "../src/remotion/cards/card-frames.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";
import { dur, runComfyChecked, textToImageWorkflow } from "./vlog-shared.ts";

const exec = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(PROJECT_ROOT, "output", "shopping-shorts-interview");
const MELO_TTS =
	process.env.MELO_TTS ?? "/Users/jjuni/AI/video-factory/bin/tts-melo.sh";

interface SceneSpec {
	id: string;
	narration: string;
	visual: string;
	motion:
		| "slow-zoom-in"
		| "slider-right"
		| "whip-pan-right"
		| "crash-zoom-in"
		| "handheld";
}

const SCENES: SceneSpec[] = [
	{
		id: "cold-open-proof",
		narration:
			"쇼핑 쇼츠 부업, 핵심은 조회수가 아니라 클릭과 구매로 이어지는 구조입니다.",
		visual:
			"Korean YouTube business interview opening montage, split screen of smartphone shopping shorts thumbnails, affiliate dashboard, product demo clips, clean studio lighting, documentary business video still, no readable text, no logo, original scene",
		motion: "crash-zoom-in",
	},
	{
		id: "office-intro",
		narration:
			"진행자 질문. 요즘 AI 쇼츠로 돈 번다는 말이 많은데, 실제로 어디서 수익이 생기나요?",
		visual:
			"Korean host and guest seated in a bright office interview set, two cameras, laptop on table, casual business attire, clean documentary interview frame, 16:9 composition, no text",
		motion: "slow-zoom-in",
	},
	{
		id: "expert-answer",
		narration:
			"전문가 답변. 영상 자체 광고비보다, 상품 링크로 넘어간 뒤 생기는 전환 수수료가 핵심입니다.",
		visual:
			"Korean AI commerce expert explaining with laptop, over-the-shoulder interview shot, product cards and funnel diagram on blurred monitor, professional YouTube education style, no readable text",
		motion: "slider-right",
	},
	{
		id: "wrong-product",
		narration:
			"아무 제품이나 올리면 안 됩니다. 사람들이 지금 당장 문제를 해결하고 싶어 하는 상품이어야 합니다.",
		visual:
			"screen-demo style scene, hands at laptop comparing many household product thumbnails, some products marked visually as weak and strong without words, Korean creator workspace, documentary still, no text",
		motion: "handheld",
	},
	{
		id: "selection-rule",
		narration:
			"좋은 후보는 세 가지입니다. 반복 구매, 계절성, 그리고 보기만 해도 쓰임이 이해되는 제품입니다.",
		visual:
			"clean studio table with three product categories represented by household item, summer fan, kitchen organizer, arrows and icons without letters, premium Korean explainer documentary still, no readable text",
		motion: "slow-zoom-in",
	},
	{
		id: "ai-workflow",
		narration:
			"제작 순서는 단순합니다. 제품을 고르고, 후킹 문장을 만들고, 장면을 생성하고, 링크 동선을 설계합니다.",
		visual:
			"AI video production workflow on a large monitor, product image to short video storyboard to upload checklist, Korean creator operating local AI tools, cinematic screen share scene, no readable text",
		motion: "slider-right",
	},
	{
		id: "content-safety",
		narration:
			"타인 영상을 좌우반전해서 쓰는 방식은 위험합니다. 직접 촬영, 허가된 소스, AI 생성 컷으로 가야 오래 갑니다.",
		visual:
			"Korean creator rejecting copied video clips on laptop and choosing original AI generated product shots, copyright safe production concept, red warning icons without text, documentary style, no readable text",
		motion: "crash-zoom-in",
	},
	{
		id: "testing-loop",
		narration:
			"처음부터 대박을 노리지 말고, 같은 포맷으로 서른 개를 테스트해서 클릭률과 구매 전환을 봐야 합니다.",
		visual:
			"wall of many vertical shorts drafts on monitors, analytics graphs, sticky notes, Korean solo creator testing multiple product videos, professional YouTube studio, no text, no logos",
		motion: "handheld",
	},
	{
		id: "final-advice",
		narration:
			"결론은 이겁니다. AI는 영상을 빨리 만들 뿐이고, 돈은 상품 선택과 이동 경로에서 나옵니다.",
		visual:
			"Korean interview closing shot, host and expert at table, laptop shows simple funnel from video to product to purchase as icons only, calm professional office, no readable text",
		motion: "slow-zoom-in",
	},
];

function parseArgs(argv: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		const key = argv[i].slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) out[key] = "true";
		else {
			out[key] = next;
			i++;
		}
	}
	return out;
}

function workflow(prompt: string, seed: number) {
	return textToImageWorkflow({
		positive: [
			"premium Korean YouTube business interview video still",
			"realistic documentary lighting",
			"clean office studio",
			"high-end educational creator video",
			"clear subject and action",
			prompt,
		].join(", "),
		negative:
			"low quality, blurry, messy, deformed, distorted hands, extra fingers, unreadable text, readable text, logos, watermark, brand names, copied footage, duplicate faces",
		seed,
		filenamePrefix: "shopping_interview",
		width: 1344,
		height: 768,
		cfg: 6.5,
	});
}

async function ttsLocal(text: string, wavPath: string, mp3Path: string) {
	if (!existsSync(MELO_TTS)) {
		throw new Error(
			"MeloTTS 스크립트를 찾을 수 없습니다: " +
				MELO_TTS +
				" — MELO_TTS 환경변수로 경로를 지정하세요.",
		);
	}
	await exec(MELO_TTS, [
		text,
		wavPath,
		"kr",
		String(Math.min(2, Math.max(0.5, Number(process.env.TTS_SPEED) || 1.08))),
	]);
	await exec("ffmpeg", [
		"-y",
		"-i",
		wavPath,
		"-c:a",
		"libmp3lame",
		"-q:a",
		"2",
		mp3Path,
	]);
}

function srtTimestamp(sec: number) {
	const total = Math.max(0, Math.round(sec * 1000));
	const ms = total % 1000;
	const s = Math.floor(total / 1000) % 60;
	const m = Math.floor(total / 60000) % 60;
	const h = Math.floor(total / 3600000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function writeSrt(
	scenes: { narration: string; durationSec: number }[],
	outPath: string,
	offsetSec = 0,
) {
	// 인트로 타이틀 카드 길이만큼 자막 시작을 밀어야 사이드카 .srt 가 최종 영상과 동기된다.
	let cursor = offsetSec;
	const blocks: string[] = [];
	for (let i = 0; i < scenes.length; i++) {
		const start = cursor;
		cursor += scenes[i].durationSec;
		blocks.push(
			`${i + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(cursor)}\n${scenes[i].narration}\n`,
		);
	}
	writeFileSync(outPath, blocks.join("\n"));
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const outDir = args.out ?? DEFAULT_OUT;
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
	const workDir = join(outDir, `shopping-interview-${stamp}`);
	mkdirSync(workDir, { recursive: true });

	const made = [];
	for (let i = 0; i < SCENES.length; i++) {
		const sc = SCENES[i];
		const image = join(workDir, `${sc.id}.png`);
		const wav = join(workDir, `${sc.id}.wav`);
		const mp3 = join(workDir, `${sc.id}.mp3`);
		if (!existsSync(image) || args.force === "true") {
			process.stdout.write(
				`\n[${i + 1}/${SCENES.length}] ComfyUI visual: ${sc.id}\n`,
			);
			await runComfyChecked(
				(seed) => workflow(sc.visual, seed),
				9200 + i * 83,
				image,
			);
		}
		if (!existsSync(mp3) || args.force === "true") {
			process.stdout.write(`[${i + 1}/${SCENES.length}] Local TTS: ${sc.id}\n`);
			await ttsLocal(sc.narration, wav, mp3);
		}
		made.push({
			imageUrl: image,
			audioUrl: mp3,
			narration: sc.narration,
			durationSec: await dur(mp3),
			cameraMove: remotionMotionFor(sc.motion),
		});
	}

	const outPath = join(workDir, "shopping-shorts-interview-original.mp4");
	process.stdout.write("\nRemotion YouTubeVideo render...\n");
	await renderVlogRemotion({
		scenes: made,
		outPath,
		projectRoot: PROJECT_ROOT,
		compositionId: "YouTubeVideo",
		runId: `shopping-interview-${stamp}`,
		intro: {
			title: "AI 쇼핑 쇼츠 부업, 진짜 구조",
			subtitle: "조회수보다 전환 동선이 먼저입니다",
			channelName: "수익 구조 연구소",
		},
		outro: {
			channelName: "수익 구조 연구소",
			ctaText: "복붙 말고, 직접 만든 포맷으로 테스트하세요",
		},
		onProgress: (pct) => process.stdout.write(`\rrender ${pct}%`),
	});
	process.stdout.write("\n");

	writeFileSync(
		join(workDir, "storyboard.json"),
		JSON.stringify(SCENES, null, 2),
	);
	// YouTubeVideo 는 인트로 타이틀 카드(TITLE_CARD_FRAMES @30fps)가 앞에 붙으므로 자막을 그만큼 오프셋.
	writeSrt(
		made,
		join(workDir, "shopping-shorts-interview-original.srt"),
		TITLE_CARD_FRAMES / 30,
	);
	writeFileSync(
		join(workDir, "manifest.json"),
		JSON.stringify(
			{
				reference: "https://www.youtube.com/watch?v=92P3_d6yXlM",
				referencePattern:
					"highlight montage -> interview Q/A -> screen-demo explanation -> CTA",
				note: "Original generated visuals and narration. Does not reuse source footage or transcript.",
				output: outPath,
				stack: ["ComfyUI", "local MeloTTS", "boltYT Remotion YouTubeVideo"],
				scenes: made,
			},
			null,
			2,
		),
	);
	process.stdout.write(`${outPath}\n`);
}

main().catch((error) => {
	process.stderr.write(
		`ERROR: ${error instanceof Error ? error.stack : error}\n`,
	);
	process.exit(1);
});
