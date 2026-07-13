/**
 * Product shopping Shorts generator.
 *
 * Applies the method learned from the referenced video:
 *   product with obvious use case -> quick hook -> usage scenes -> benefit stack
 *   -> simple CTA.
 *
 * Uses original local generation only: ComfyUI key visuals + local MeloTTS +
 * boltYT Remotion Shorts. No scraped/reuploaded source clips.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { remotionMotionFor } from "../src/lib/camera-movements.ts";
import { renderVlogRemotion } from "./remotion-vlog-render.ts";
import { dur, runComfyChecked, textToImageWorkflow } from "./vlog-shared.ts";

const exec = promisify(execFile);
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(PROJECT_ROOT, "output", "shopping-product-shorts");
const MELO_TTS =
	process.env.MELO_TTS ?? "/Users/jjuni/AI/video-factory/bin/tts-melo.sh";

interface ProductScene {
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

const PRODUCT = {
	name: "여행용 압축 파우치",
	angle: "캐리어 부피 압축·짐 정리·호텔 unpack 편의성",
};

const SCENES: ProductScene[] = [
	{
		id: "suitcase-hook",
		narration: "여행 갈 때 캐리어가 안 닫히는 사람, 이 장면부터 보세요.",
		visual:
			"vertical Korean shopping shorts product scene, open suitcase overloaded with summer clothes, zipper almost cannot close, travel packing problem, realistic product-commercial style, clean bright lighting, no readable text, no logo",
		motion: "crash-zoom-in",
	},
	{
		id: "product-reveal",
		narration:
			"옷을 압축 파우치에 넣고, 지퍼를 한 번 더 잠그면 부피가 줄어듭니다.",
		visual:
			"hero close-up of travel compression packing cubes, shirts folded inside a mesh packing pouch, second compression zipper visible, premium Korean product ad, shallow depth of field, no text, no logo",
		motion: "slow-zoom-in",
	},
	{
		id: "category-sort",
		narration: "티셔츠, 속옷, 양말을 따로 넣어 두면 찾는 시간도 줄어듭니다.",
		visual:
			"top-down flatlay of three travel compression packing cubes, neatly sorted shirts underwear socks in separate pouches, tidy suitcase packing setup, Korean commerce shorts style, realistic product photography, no text, no logo",
		motion: "slider-right",
	},
	{
		id: "fit-proof",
		narration: "캐리어 한쪽 면에 딱 맞게 들어가서, 남는 공간이 바로 보입니다.",
		visual:
			"open carry-on suitcase with travel compression packing cubes fitting perfectly on one side, empty space left for shoes and toiletry bag, clean realistic commercial still, no text, no logo",
		motion: "handheld",
	},
	{
		id: "hotel-use",
		narration:
			"호텔에서는 파우치째 꺼내면 끝이라, 짐을 다시 뒤집을 일이 줄어듭니다.",
		visual:
			"hotel room luggage rack, travel compression packing cubes lifted from suitcase and placed neatly into wardrobe shelf, lifestyle product demo, warm clean lighting, Korean shopping shorts visual, no text, no logo",
		motion: "slow-zoom-in",
	},
	{
		id: "cta",
		narration: "여행 짐이 매번 터지는 분들은, 압축 파우치부터 확인하세요.",
		visual:
			"final clean product beauty shot, several travel compression packing cubes in an open suitcase, passport and sunglasses nearby, premium Korean travel shopping ad, bright morning light, no readable text, no logo",
		motion: "slider-right",
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
			"premium Korean vertical product shopping shorts frame",
			"realistic commercial lifestyle photography",
			"clear product use case",
			"summer shopping ad",
			"high conversion product demo",
			prompt,
		].join(", "),
		negative:
			"low quality, blurry, distorted product, deformed hands, extra fingers, readable text, Korean text, watermark, logo, brand name, fake label, cluttered, duplicate product",
		seed,
		filenamePrefix: "shopping_product_short",
		width: 768,
		height: 1344,
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
		String(Math.min(2, Math.max(0.5, Number(process.env.TTS_SPEED) || 1.12))),
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
) {
	let cursor = 0;
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
	const workDir = join(outDir, `packing-cube-${stamp}`);
	mkdirSync(workDir, { recursive: true });

	const made = [];
	for (let i = 0; i < SCENES.length; i++) {
		const sc = SCENES[i];
		const image = join(workDir, `${sc.id}.png`);
		const wav = join(workDir, `${sc.id}.wav`);
		const mp3 = join(workDir, `${sc.id}.mp3`);
		if (!existsSync(image) || args.force === "true") {
			process.stdout.write(
				`\n[${i + 1}/${SCENES.length}] ComfyUI product shot: ${sc.id}\n`,
			);
			await runComfyChecked(
				(seed) => workflow(sc.visual, seed),
				5100 + i * 97,
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

	const outPath = join(workDir, "packing-cube-shopping-short.mp4");
	process.stdout.write("\nRemotion Shorts render...\n");
	await renderVlogRemotion({
		scenes: made,
		outPath,
		projectRoot: PROJECT_ROOT,
		compositionId: "YouTubeShorts",
		runId: `packing-cube-${stamp}`,
		subtitleBgStyle: "stroke",
		onProgress: (pct) => process.stdout.write(`\rrender ${pct}%`),
	});
	process.stdout.write("\n");

	writeFileSync(
		join(workDir, "storyboard.json"),
		JSON.stringify({ product: PRODUCT, scenes: SCENES }, null, 2),
	);
	writeSrt(made, join(workDir, "packing-cube-shopping-short.srt"));
	writeFileSync(
		join(workDir, "method-notes.md"),
		[
			"# Method Applied",
			"",
			"- Product: travel packing item with an obvious before/after use case.",
			"- Hook: starts from a concrete pain point before naming the product.",
			"- Scenes: overloaded suitcase, product reveal, category sorting, fit proof, hotel use, final CTA.",
			"- Safety: original AI-generated visuals only; no mirrored/reuploaded source clips.",
			"- Monetization logic: viewer attention -> product interest -> link click.",
			"",
			`Reference studied: https://www.youtube.com/watch?v=92P3_d6yXlM`,
		].join("\n"),
	);
	writeFileSync(
		join(workDir, "manifest.json"),
		JSON.stringify(
			{
				product: PRODUCT,
				output: outPath,
				stack: [
					"ComfyUI product key visuals",
					"local MeloTTS",
					"boltYT Remotion Shorts",
				],
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
