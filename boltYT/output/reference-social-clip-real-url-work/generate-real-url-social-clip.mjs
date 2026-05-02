import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 24;
const DURATION = 16;
const TOTAL_FRAMES = Math.round(FPS * DURATION);
const MEDIA_TOP = 550;
const MEDIA_HEIGHT = 620;
const FOOTER_TOP = MEDIA_TOP + MEDIA_HEIGHT;
const stamp = Math.floor(Date.now() / 1000);
const root = resolve(process.cwd());
const sourceVideoUrl =
	"https://upload.wikimedia.org/wikipedia/commons/7/71/Entrevista_01.webm";
const sourcePageUrl =
	"https://commons.wikimedia.org/wiki/File:Entrevista_01.webm";
const cutPlan = [
	{ sourceStart: 0, duration: 2.6 },
	{ sourceStart: 5, duration: 2.7 },
	{ sourceStart: 11, duration: 2.9 },
	{ sourceStart: 18, duration: 2.6 },
	{ sourceStart: 25, duration: 2.6 },
	{ sourceStart: 32, duration: 2.6 },
];
const workDir = join(root, "output", `reference-social-clip-real-url-${stamp}`);
const frameDir = join(workDir, "overlays");
const sourcePath = join(workDir, "source-url-video.webm");
const bgmPath = join(workDir, "social-pop-bed.wav");
const finalPath = join(
	root,
	"public",
	"generated",
	`reference-social-clip-real-url-v5-${stamp}-shorts.mp4`,
);

mkdirSync(frameDir, { recursive: true });
mkdirSync(join(root, "public", "generated"), { recursive: true });

const scenes = [
	{
		start: 0,
		end: 2.6,
		caption: "요즘 제일 신박했던 플러팅은?",
		color: "#ffe21f",
	},
	{
		start: 2.6,
		end: 5.3,
		caption: "처음엔 장난인 줄 알았는데",
		color: "#ffffff",
	},
	{
		start: 5.3,
		end: 8.2,
		caption: "말투보다 타이밍이 더 중요함",
		color: "#ff72df",
	},
	{
		start: 8.2,
		end: 10.8,
		caption: "그래서 기억에 남았대요",
		color: "#ffffff",
	},
	{
		start: 10.8,
		end: 13.4,
		caption: "억지 멘트보다 상황을 읽는 게 포인트",
		color: "#ffe21f",
	},
	{
		start: 13.4,
		end: DURATION,
		caption: "이런 건 거절당해도 기억남음",
		color: "#ffffff",
	},
];

function esc(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function clamp(value, min = 0, max = 1) {
	return Math.max(min, Math.min(max, value));
}

function pulse(t, speed = 1, phase = 0) {
	return 0.5 + Math.sin((t * speed + phase) * Math.PI * 2) * 0.5;
}

function sceneAt(time) {
	return scenes.find((scene) => time >= scene.start && time < scene.end) ?? scenes[0];
}

function splitCaption(value, max = 14) {
	const words = value.split(" ");
	const lines = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length > max && current) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
	}
	if (current) lines.push(current);
	return lines.slice(0, 2);
}

function defs() {
	return `
  <defs>
    <linearGradient id="pageBg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.58" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#d7d7d7"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="13" stdDeviation="12" flood-color="#000" flood-opacity="0.32"/>
    </filter>
    <filter id="captionGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="0" flood-color="#000" flood-opacity="0.92"/>
      <feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="#000" flood-opacity="0.72"/>
    </filter>
  </defs>`;
}

function titleCard(t) {
	const pillOpacity = pulse(t, 0.7) * 0.14 + 0.8;
	return `
  <rect x="0" y="0" width="${WIDTH}" height="${MEDIA_TOP}" fill="#fff"/>
  <g font-family="AppleMyungjo, Hiragino Mincho ProN, serif" text-anchor="middle" fill="#050505" font-weight="900" letter-spacing="-6">
    <text x="540" y="292" font-size="88">요즘 MZ들의</text>
    <text x="540" y="410" font-size="88">신박한 플러팅 방식</text>
	  </g>
	  <g opacity="${pillOpacity}">
	    <rect x="322" y="252" width="436" height="58" rx="29" fill="#111" opacity="0.68"/>
	    <text x="540" y="290" font-family="Apple SD Gothic Neo, sans-serif" font-size="27" font-weight="800" fill="#fff" text-anchor="middle">처음 본 사람한테 이렇게 말했다고?</text>
	  </g>`;
}

function caption(scene) {
	const lines = splitCaption(scene.caption);
	const y = lines.length === 1 ? 1078 : 1034;
	return `
  <g font-family="Apple SD Gothic Neo, sans-serif" text-anchor="middle" font-weight="950" letter-spacing="-2.4" filter="url(#captionGlow)">
    ${lines
			.map(
				(line, index) =>
					`<text x="540" y="${y + index * 68}" font-size="58" fill="${scene.color}">${esc(line)}</text>`,
			)
			.join("")}
  </g>`;
}

function footer(t) {
	const progress = clamp(t / DURATION);
	return `
	  <rect x="0" y="${FOOTER_TOP}" width="${WIDTH}" height="${HEIGHT - FOOTER_TOP}" fill="url(#pageBg)"/>
	  <g font-family="Apple SD Gothic Neo, sans-serif">
	    <rect x="118" y="1716" width="844" height="34" rx="17" fill="#9e9e9e"/>
	    <rect x="118" y="1716" width="${844 * progress}" height="34" rx="17" fill="#ff174b"/>
	  </g>`;
}

function mediaTransitionAccent(t) {
	const boundaries = [0.72, 1.62, ...scenes.slice(1).map((scene) => scene.start)];
	const nearest = boundaries.reduce(
		(best, boundary) => Math.min(best, Math.abs(t - boundary)),
		999,
	);
	if (nearest > 0.18) return "";
	const strength = 1 - nearest / 0.18;
	const whiteOpacity = (0.1 + strength * 0.26).toFixed(3);
	const yellowOpacity = (0.12 + strength * 0.26).toFixed(3);
	const offset = Math.round(strength * 90);
	return `
  <g opacity="${strength.toFixed(3)}">
    <rect x="0" y="${MEDIA_TOP}" width="${WIDTH}" height="${MEDIA_HEIGHT}" fill="#fff" opacity="${whiteOpacity}"/>
    <path d="M${-220 + offset} ${MEDIA_TOP} L${80 + offset} ${MEDIA_TOP} L${-120 + offset} ${MEDIA_TOP + MEDIA_HEIGHT} L${-420 + offset} ${MEDIA_TOP + MEDIA_HEIGHT} Z" fill="#ffe21f" opacity="${yellowOpacity}"/>
    <path d="M${850 - offset} ${MEDIA_TOP} L${1190 - offset} ${MEDIA_TOP} L${990 - offset} ${MEDIA_TOP + MEDIA_HEIGHT} L${650 - offset} ${MEDIA_TOP + MEDIA_HEIGHT} Z" fill="#ff174b" opacity="${yellowOpacity}"/>
  </g>`;
}

function frameSvg(index) {
	const t = index / FPS;
	const scene = sceneAt(t);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${defs()}
  ${titleCard(t)}
  ${mediaTransitionAccent(t)}
  ${caption(scene)}
  ${footer(t)}
</svg>`;
}

function writeWav() {
	const sampleRate = 48000;
	const channels = 2;
	const totalSamples = Math.floor(DURATION * sampleRate);
	const pcm = Buffer.alloc(totalSamples * channels * 2);
	const tempo = 112;
	const beat = 60 / tempo;
	const chords = [
		[261.63, 329.63, 392],
		[293.66, 369.99, 440],
		[246.94, 329.63, 392],
		[349.23, 440, 523.25],
	];

	for (let i = 0; i < totalSamples; i += 1) {
		const t = i / sampleRate;
		const bar = Math.floor(t / (beat * 4));
		const withinBeat = t % beat;
		const beatIndex = Math.floor(t / beat);
		const chord = chords[bar % chords.length];
		let sample = 0;

		chord.forEach((freq, idx) => {
			const env = Math.exp(-withinBeat * (idx === 0 ? 5.5 : 7));
			sample += Math.sin(Math.PI * 2 * freq * t) * 0.075 * env;
			sample += Math.sin(Math.PI * 2 * freq * 2.01 * t) * 0.015 * env;
		});

		const kickEnv = Math.exp(-withinBeat * 18);
		sample += Math.sin(Math.PI * 2 * (58 - withinBeat * 20) * t) * 0.28 * kickEnv;

		const snareBeat = beatIndex % 4 === 1 || beatIndex % 4 === 3;
		if (snareBeat && withinBeat < 0.11) {
			const noise = Math.sin(t * 15423.2) + Math.sin(t * 9271.8);
			sample += noise * 0.038 * Math.exp(-withinBeat * 22);
		}

		const hatPhase = t % (beat / 2);
		if (hatPhase < 0.055) {
			const noise = Math.sin(t * 22111.4) + Math.sin(t * 18371.9);
			sample += noise * 0.015 * Math.exp(-hatPhase * 48);
		}

		const melodyFreq = [659.25, 587.33, 523.25, 440, 523.25, 587.33][beatIndex % 6];
		if (withinBeat < 0.2) {
			sample += Math.sin(Math.PI * 2 * melodyFreq * t) * 0.036 * Math.exp(-withinBeat * 7);
		}

		const out = Math.max(-0.88, Math.min(0.88, sample * 1.35));
		pcm.writeInt16LE(Math.round(out * 32767), i * 4);
		pcm.writeInt16LE(Math.round(out * 0.92 * 32767), i * 4 + 2);
	}

	const dataSize = pcm.length;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + dataSize, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * channels * 2, 28);
	header.writeUInt16LE(channels * 2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(dataSize, 40);
	writeFileSync(bgmPath, Buffer.concat([header, pcm]));
}

const curl = spawnSync("curl", ["-L", "--fail", "--max-time", "120", "-o", sourcePath, sourceVideoUrl], {
	stdio: "inherit",
});
if (curl.status !== 0) throw new Error("source video download failed");

for (let i = 0; i < TOTAL_FRAMES; i += 1) {
	const svgPath = join(frameDir, `overlay-${String(i + 1).padStart(4, "0")}.svg`);
	const pngPath = join(frameDir, `overlay-${String(i + 1).padStart(4, "0")}.png`);
	writeFileSync(svgPath, frameSvg(i));
	const result = spawnSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
		stdio: "ignore",
	});
	if (result.status !== 0) throw new Error(`sips failed on overlay ${i + 1}`);
}

writeWav();

const cutFilters = cutPlan.flatMap((cut, index) => [
	`[0:v]trim=start=${cut.sourceStart}:duration=${cut.duration},setpts=PTS-STARTPTS,fps=${FPS},scale=${WIDTH}:${MEDIA_HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${MEDIA_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[cv${index}]`,
	`[0:a]atrim=start=${cut.sourceStart}:duration=${cut.duration},asetpts=PTS-STARTPTS[ca${index}]`,
]);
const concatInputs = cutPlan.map((_, index) => `[cv${index}][ca${index}]`).join("");
const fillEnable =
	"between(t,2.6,5.3)+between(t,8.2,10.8)+between(t,13.4,16)";
const portraitEnable =
	"between(t,0,2.6)+between(t,5.3,8.2)+between(t,10.8,13.4)";

const filter = [
	`color=c=white:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION}[canvas]`,
	...cutFilters,
	`${concatInputs}concat=n=${cutPlan.length}:v=1:a=1[cutv][cuta]`,
	`[cutv]split=3[srcbg][srcportrait][srcfill]`,
	`[srcbg]scale=${WIDTH}:${MEDIA_HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${MEDIA_HEIGHT},gblur=sigma=20,eq=brightness=-0.06:saturation=1.08[bg]`,
	`[srcportrait]scale=-2:${MEDIA_HEIGHT},eq=contrast=1.03:saturation=1.06[fgportrait]`,
	`[srcfill]scale=${WIDTH}:${MEDIA_HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${MEDIA_HEIGHT},eq=contrast=1.08:saturation=1.12[fgfill]`,
	`[canvas][bg]overlay=0:${MEDIA_TOP}[v0]`,
	`[v0][fgfill]overlay=0:${MEDIA_TOP}:enable='${fillEnable}'[v1]`,
	`[v1][fgportrait]overlay=(W-w)/2:${MEDIA_TOP}:enable='${portraitEnable}'[v2]`,
	`[v2][1:v]overlay=0:0:format=auto[v]`,
	`[cuta]volume=0.42[srca]`,
	`[2:a]volume=1.05[bed]`,
	`[srca][bed]amix=inputs=2:duration=shortest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=7[a]`,
].join(";");

const ffmpeg = spawnSync(
	"ffmpeg",
	[
		"-y",
		"-i",
		sourcePath,
		"-framerate",
		String(FPS),
		"-i",
		join(frameDir, "overlay-%04d.png"),
		"-i",
		bgmPath,
		"-filter_complex",
		filter,
		"-map",
		"[v]",
		"-map",
		"[a]",
		"-t",
		String(DURATION),
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-crf",
		"17",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-movflags",
		"+faststart",
		finalPath,
	],
	{ stdio: "inherit" },
);

if (ffmpeg.status !== 0) throw new Error("ffmpeg render failed");

console.log(
	JSON.stringify(
		{
			stamp,
			sourceVideoUrl,
			sourcePageUrl,
			workDir,
			finalPath,
		},
		null,
		2,
	),
);
