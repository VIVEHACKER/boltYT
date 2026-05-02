import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 24;
const DURATION = 16;
const TOTAL_FRAMES = Math.round(FPS * DURATION);
const stamp = Math.floor(Date.now() / 1000);
const root = resolve(process.cwd());
const workDir = join(root, "output", `reference-social-clip-${stamp}`);
const frameDir = join(workDir, "frames");
const audioPath = join(workDir, "original-social-clip-pop.wav");
const finalPath = join(
	root,
	"public",
	"generated",
	`reference-social-clip-${stamp}-shorts.mp4`,
);

mkdirSync(frameDir, { recursive: true });
mkdirSync(join(root, "public", "generated"), { recursive: true });

const scenes = [
	{
		start: 0,
		end: 2.6,
		angle: "guy",
		caption: "제일 신박했던 헌팅 방법은?",
		color: "#ffe21f",
		comment: "첫 질문부터 답이 궁금해지는 구조",
	},
	{
		start: 2.6,
		end: 5.2,
		angle: "girl",
		caption: "지나가던 여자한테 말 걸었대요",
		color: "#ffffff",
		comment: "실제 인터뷰처럼 반응 컷을 먼저 보여줌",
	},
	{
		start: 5.2,
		end: 7.9,
		angle: "girl-close",
		caption: "비가 왜 오는지 알아요?",
		color: "#ff72df",
		comment: "핵심 대사는 컬러 자막으로 박음",
	},
	{
		start: 7.9,
		end: 10.4,
		angle: "reaction",
		caption: "뭐라고 했는데...?",
		color: "#ffffff",
		comment: "상대 반응 컷으로 체류 시간을 늘림",
	},
	{
		start: 10.4,
		end: 13.1,
		angle: "girl-answer",
		caption: "하늘도 분위기 맞춰주는 중이라면서요",
		color: "#ffe21f",
		comment: "한 문장 답변 뒤 바로 표정 클로즈업",
	},
	{
		start: 13.1,
		end: DURATION,
		angle: "group",
		caption: "이런 건 거절해도 기억에 남음",
		color: "#ffffff",
		comment: "댓글형 요약으로 끝까지 맥락 유지",
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

function ease(value) {
	const t = clamp(value);
	return t * t * (3 - 2 * t);
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
    <linearGradient id="clubBg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#140917"/>
      <stop offset="0.45" stop-color="#2b1722"/>
      <stop offset="1" stop-color="#5d2e16"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="13" stdDeviation="12" flood-color="#000" flood-opacity="0.32"/>
    </filter>
    <filter id="captionGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="0" flood-color="#000" flood-opacity="0.9"/>
      <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#000" flood-opacity="0.65"/>
    </filter>
    <clipPath id="mediaClip">
      <rect x="0" y="550" width="1080" height="620"/>
    </clipPath>
  </defs>`;
}

function titleCard(t) {
	const pillOpacity = pulse(t, 0.7) * 0.18 + 0.78;
	return `
  <rect x="0" y="0" width="1080" height="550" fill="#fff"/>
  <g font-family="AppleMyungjo, Hiragino Mincho ProN, serif" text-anchor="middle" fill="#050505" font-weight="900" letter-spacing="-6">
    <text x="540" y="302" font-size="92">요즘 MZ들의</text>
    <text x="540" y="420" font-size="92">신박한 헌팅 방법</text>
  </g>
  <g opacity="${pillOpacity}">
    <rect x="334" y="260" width="412" height="58" rx="29" fill="#111" opacity="0.68"/>
    <text x="540" y="298" font-family="Apple SD Gothic Neo, sans-serif" font-size="27" font-weight="800" fill="#fff" text-anchor="middle">제일 기억에 남는 한마디는?</text>
  </g>`;
}

function face(cx, cy, r, skin = "#f3c299", hair = "#15100f", expression = "smile") {
	const mouth =
		expression === "open"
			? `<ellipse cx="${cx}" cy="${cy + r * 0.34}" rx="${r * 0.18}" ry="${r * 0.11}" fill="#4a1e1c"/>`
			: `<path d="M${cx - r * 0.22} ${cy + r * 0.32} Q${cx} ${cy + r * 0.47} ${cx + r * 0.24} ${cy + r * 0.31}" stroke="#50211d" stroke-width="${r * 0.06}" fill="none" stroke-linecap="round"/>`;
	return `
  <g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${skin}"/>
    <path d="M${cx - r} ${cy - r * 0.2} C${cx - r * 0.95} ${cy - r * 1.08} ${cx + r * 0.82} ${cy - r * 1.2} ${cx + r} ${cy - r * 0.06} C${cx + r * 0.35} ${cy - r * 0.35} ${cx - r * 0.35} ${cy - r * 0.33} ${cx - r} ${cy - r * 0.2} Z" fill="${hair}"/>
    <circle cx="${cx - r * 0.32}" cy="${cy + r * 0.04}" r="${r * 0.055}" fill="#191919"/>
    <circle cx="${cx + r * 0.3}" cy="${cy + r * 0.04}" r="${r * 0.055}" fill="#191919"/>
    ${mouth}
  </g>`;
}

function person(x, y, scale, skin, hair, shirt, t, expression = "smile") {
	const bob = Math.sin(t * 3 + x * 0.02) * 5;
	return `
  <g transform="translate(${x} ${y + bob}) scale(${scale})">
    <path d="M-95 250 C-75 104 70 100 100 250 Z" fill="${shirt}"/>
    ${face(0, 55, 64, skin, hair, expression)}
    <path d="M-78 172 C-132 220 -142 300 -118 364" stroke="${skin}" stroke-width="26" fill="none" stroke-linecap="round"/>
    <path d="M82 173 C138 216 150 287 125 354" stroke="${skin}" stroke-width="26" fill="none" stroke-linecap="round"/>
  </g>`;
}

function microphone(x, y, angle = -18) {
	return `
  <g transform="translate(${x} ${y}) rotate(${angle})">
    <rect x="-12" y="0" width="24" height="128" rx="12" fill="#101010"/>
    <circle cx="0" cy="-18" r="34" fill="#111"/>
    <circle cx="0" cy="-18" r="21" fill="#2e394b"/>
  </g>`;
}

function backgroundCrowd(t) {
	const lights = Array.from({ length: 28 }, (_, i) => {
		const x = 28 + ((i * 83) % 1020);
		const y = 574 + ((i * 47) % 200);
		const r = 5 + (i % 5) * 4 + pulse(t, 1.3, i * 0.17) * 5;
		const colors = ["#46d6ff", "#ffcf28", "#ff4fc7", "#ff6d22", "#fff7b5"];
		return `<circle cx="${x}" cy="${y}" r="${r}" fill="${colors[i % colors.length]}" opacity="${0.35 + (i % 4) * 0.09}"/>`;
	}).join("");
	const silhouettes = Array.from({ length: 9 }, (_, i) => {
		const x = 90 + i * 120 + Math.sin(t * 1.5 + i) * 10;
		const y = 760 + (i % 3) * 38;
		return `
    <g opacity="${0.32 + (i % 2) * 0.16}">
      <circle cx="${x}" cy="${y}" r="${35 + (i % 3) * 8}" fill="#090909"/>
      <path d="M${x - 58} ${y + 124} C${x - 46} ${y + 52} ${x + 48} ${y + 50} ${x + 62} ${y + 124} Z" fill="#0d0d0f"/>
    </g>`;
	}).join("");
	return `
  <rect x="0" y="550" width="1080" height="620" fill="url(#clubBg)"/>
  <rect x="0" y="550" width="1080" height="620" fill="#000" opacity="0.16"/>
  ${lights}
  <rect x="0" y="1010" width="1080" height="160" fill="#1b0e12" opacity="0.82"/>
  ${silhouettes}`;
}

function mediaScene(scene, local, t) {
	const cameraX = scene.angle.includes("girl") ? -16 : scene.angle === "reaction" ? 38 : 0;
	const cameraScale = scene.angle.includes("close") ? 1.14 : scene.angle === "group" ? 0.96 : 1.03;
	const shake = Math.sin(t * 7) * 2.2;
	const guyExpression = scene.angle === "reaction" ? "open" : "smile";
	const girlExpression = scene.angle.includes("answer") ? "open" : "smile";
	return `
  <g clip-path="url(#mediaClip)">
    <g transform="translate(${cameraX + shake} ${Math.sin(t * 3) * 4}) scale(${cameraScale})">
      ${backgroundCrowd(t)}
      <rect x="30" y="612" width="116" height="66" rx="8" fill="#ffcf21"/>
      <text x="88" y="655" font-family="Apple SD Gothic Neo, sans-serif" font-size="30" font-weight="950" fill="#f20e55" text-anchor="middle">핫클립</text>
      ${person(305, 780, scene.angle === "guy" || scene.angle === "reaction" ? 1.22 : 0.88, "#e5b082", "#17110f", "#101010", t, guyExpression)}
      ${person(590, 760, scene.angle.includes("girl") ? 1.3 : 1.0, "#f2bd94", "#2b1714", "#fff1dc", t + 0.2, girlExpression)}
      ${person(875, 795, 1.05, "#e7b08e", "#3a1d1b", "#18141a", t + 0.7, "smile")}
      ${microphone(scene.angle.includes("girl") ? 454 : 410, 905, scene.angle.includes("girl") ? -24 : -16)}
      <path d="M0 1118 C230 1078 410 1138 584 1097 C755 1057 884 1112 1080 1068 L1080 1170 L0 1170 Z" fill="#0b0708" opacity="0.42"/>
    </g>
    <rect x="0" y="550" width="1080" height="620" fill="none"/>
    <rect x="0" y="980" width="1080" height="190" fill="url(#captionFade)" opacity="0"/>
  </g>`;
}

function caption(scene) {
	const lines = splitCaption(scene.caption);
	const y = lines.length === 1 ? 1078 : 1036;
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

function footer(scene, t) {
	const progress = clamp(t / DURATION);
	return `
  <rect x="0" y="1170" width="1080" height="750" fill="url(#pageBg)"/>
  <g font-family="Apple SD Gothic Neo, sans-serif">
    <g filter="url(#softShadow)">
      <rect x="118" y="1342" width="844" height="78" rx="39" fill="#565656" opacity="0.82"/>
      <circle cx="165" cy="1381" r="28" fill="#ffd8b7"/>
      <path d="M145 1372 C150 1349 182 1348 188 1373 C174 1363 158 1363 145 1372 Z" fill="#3b201a"/>
      <text x="215" y="1390" font-size="28" font-weight="850" fill="#fff">${esc(scene.comment)}</text>
    </g>
    <circle cx="150" cy="1524" r="34" fill="#ffd21f"/>
    <text x="150" y="1537" font-size="37" font-weight="950" fill="#fff" text-anchor="middle">♪</text>
    <text x="204" y="1536" font-size="31" font-weight="900" fill="#111">@mychannel</text>
    <rect x="365" y="1490" width="122" height="68" rx="34" fill="#fff"/>
    <text x="426" y="1533" font-size="30" font-weight="950" fill="#111" text-anchor="middle">구독</text>
    <text x="118" y="1642" font-size="30" font-weight="840" fill="#151515">내 채널 · interview clip format</text>
    <rect x="118" y="1732" width="844" height="34" rx="17" fill="#9e9e9e"/>
    <rect x="118" y="1732" width="${844 * progress}" height="34" rx="17" fill="#ff174b"/>
  </g>`;
}

function frameSvg(index) {
	const t = index / FPS;
	const scene = sceneAt(t);
	const local = (t - scene.start) / (scene.end - scene.start);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${defs()}
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#pageBg)"/>
  ${titleCard(t)}
  ${mediaScene(scene, ease(local), t)}
  ${caption(scene)}
  ${footer(scene, t)}
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
			const dt = withinBeat;
			const env = Math.exp(-dt * (idx === 0 ? 6 : 8));
			sample += Math.sin(Math.PI * 2 * freq * t) * 0.08 * env;
			sample += Math.sin(Math.PI * 2 * freq * 2.01 * t) * 0.018 * env;
		});

		const kickEnv = Math.exp(-withinBeat * 18);
		sample += Math.sin(Math.PI * 2 * (58 - withinBeat * 20) * t) * 0.32 * kickEnv;

		const snareBeat = beatIndex % 4 === 1 || beatIndex % 4 === 3;
		if (snareBeat && withinBeat < 0.11) {
			const noise = Math.sin(t * 15423.2) + Math.sin(t * 9271.8);
			sample += noise * 0.045 * Math.exp(-withinBeat * 22);
		}

		const hatPhase = t % (beat / 2);
		if (hatPhase < 0.055) {
			const noise = Math.sin(t * 22111.4) + Math.sin(t * 18371.9);
			sample += noise * 0.018 * Math.exp(-hatPhase * 48);
		}

		const melodyFreq = [659.25, 587.33, 523.25, 440, 523.25, 587.33][beatIndex % 6];
		if (withinBeat < 0.22) {
			sample +=
				Math.sin(Math.PI * 2 * melodyFreq * t) *
				0.045 *
				Math.exp(-withinBeat * 7);
		}

		const out = Math.max(-0.92, Math.min(0.92, sample * 1.55));
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
	writeFileSync(audioPath, Buffer.concat([header, pcm]));
}

for (let i = 0; i < TOTAL_FRAMES; i += 1) {
	const svgPath = join(frameDir, `frame-${String(i + 1).padStart(4, "0")}.svg`);
	const pngPath = join(frameDir, `frame-${String(i + 1).padStart(4, "0")}.png`);
	writeFileSync(svgPath, frameSvg(i));
	const result = spawnSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
		stdio: "ignore",
	});
	if (result.status !== 0) throw new Error(`sips failed on frame ${i + 1}`);
}

writeWav();

const ffmpeg = spawnSync(
	"ffmpeg",
	[
		"-y",
		"-framerate",
		String(FPS),
		"-i",
		join(frameDir, "frame-%04d.png"),
		"-i",
		audioPath,
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
		"-shortest",
		"-movflags",
		"+faststart",
		finalPath,
	],
	{ stdio: "inherit" },
);

if (ffmpeg.status !== 0) throw new Error("ffmpeg render failed");

console.log(JSON.stringify({ stamp, workDir, finalPath }, null, 2));
