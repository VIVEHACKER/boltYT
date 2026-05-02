import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 24;
const DURATION = 15.5;
const TOTAL_FRAMES = Math.round(FPS * DURATION);
const stamp = Math.floor(Date.now() / 1000);
const root = resolve(process.cwd());
const workDir = join(root, "output", `reference-style-v4-${stamp}`);
const frameDir = join(workDir, "frames");
const audioPath = join(workDir, "original-waltz-editorial.wav");
const finalPath = join(
  root,
  "public",
  "generated",
  `reference-style-mystery-v4-${stamp}-shorts.mp4`,
);

mkdirSync(frameDir, { recursive: true });
mkdirSync(join(root, "public", "generated"), { recursive: true });

const titleLines = ["바다 한가운데 잠든 왕릉", "사람들이 가장 궁금해한", "3가지"];
const scenes = [
  {
    start: 0,
    end: 2.45,
    type: "seaTomb",
    caption: ["병합된 암초가 아니라", "왕릉처럼 솟은 지형이 발견됨"],
  },
  {
    start: 2.45,
    end: 4.95,
    type: "sonar",
    caption: ["위성 사진을 확대하자", "입구 같은 그림자가 보였음"],
  },
  {
    start: 4.95,
    end: 7.55,
    type: "archive",
    caption: ["기록을 뒤지니 같은 좌표가", "세 번이나 반복됐음"],
  },
  {
    start: 7.55,
    end: 10.1,
    type: "surveyShip",
    caption: ["조사선이 접근한 밤마다", "안개가 바다 위를 덮었다고 함"],
  },
  {
    start: 10.1,
    end: 12.65,
    type: "threeQuestions",
    caption: ["첫째, 왜 그 입구는", "항상 닫힌 채였을까"],
  },
  {
    start: 12.65,
    end: DURATION,
    type: "stoneGate",
    caption: ["셋째, 묻힌 것은 무덤인지", "누군가 숨긴 기록인지"],
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
  return scenes.find((scene) => time >= scene.start && time < scene.end) ?? scenes[scenes.length - 1];
}

function globalDefs() {
  return `
  <defs>
    <linearGradient id="paper" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#fffdf8"/>
      <stop offset="1" stop-color="#f3f0e8"/>
    </linearGradient>
    <linearGradient id="sea" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#062836"/>
      <stop offset="0.58" stop-color="#0e3c4b"/>
      <stop offset="1" stop-color="#dceff3"/>
    </linearGradient>
    <linearGradient id="nightSea" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#061a29"/>
      <stop offset="0.65" stop-color="#0a3443"/>
      <stop offset="1" stop-color="#164f5f"/>
    </linearGradient>
    <linearGradient id="oldMap" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f5daa1"/>
      <stop offset="1" stop-color="#d4b66f"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#000" flood-opacity="0.25"/>
    </filter>
    <filter id="inkShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="0" flood-color="#111" flood-opacity="0.16"/>
    </filter>
    <clipPath id="artClip">
      <rect x="20" y="334" width="1040" height="948" rx="20"/>
    </clipPath>
  </defs>`;
}

function header(t) {
  const bob = Math.sin(t * 1.6) * 2;
  return `
  <rect x="0" y="0" width="${WIDTH}" height="338" fill="url(#paper)"/>
  <path d="M0 326 C165 344 298 318 455 333 C626 349 777 318 1080 330 L1080 356 L0 356 Z" fill="#07313d"/>
  <g transform="translate(58 ${55 + bob})">
    <circle cx="0" cy="0" r="24" fill="#071821"/>
    <circle cx="0" cy="0" r="14" fill="#00a6d6"/>
    <circle cx="0" cy="0" r="7" fill="#fff"/>
    <text x="42" y="-5" font-family="Apple SD Gothic Neo, sans-serif" font-size="25" font-weight="900" fill="#111" letter-spacing="-1">내 채널</text>
    <text x="42" y="18" font-family="Apple SD Gothic Neo, sans-serif" font-size="17" font-weight="800" fill="#656565">@mychannel</text>
  </g>
  <g font-family="Apple SD Gothic Neo, sans-serif" text-anchor="middle" fill="#070707" font-weight="900" letter-spacing="-2.4">
    <text x="540" y="132" font-size="54">${esc(titleLines[0])}</text>
    <text x="540" y="199" font-size="54">${esc(titleLines[1])}</text>
    <text x="540" y="266" font-size="62">${esc(titleLines[2])}</text>
  </g>`;
}

function drawStickFigure(x, y, scale = 1, pose = 0) {
  const arm = Math.sin(pose) * 24;
  return `
  <g transform="translate(${x} ${y}) scale(${scale})" stroke="#050505" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <circle cx="0" cy="-102" r="38" fill="#050505" stroke="none"/>
    <path d="M0 -62 L0 55"/>
    <path d="M0 -26 L-70 ${-6 + arm}"/>
    <path d="M0 -26 L78 ${-42 - arm}"/>
    <path d="M0 55 L-52 150"/>
    <path d="M0 55 L52 150"/>
  </g>`;
}

function seaTomb(local, t) {
  const drift = (local - 0.5) * 28;
  const glow = 0.22 + pulse(t, 1.1) * 0.22;
  const waves = Array.from({ length: 18 }, (_, i) => {
    const y = 450 + i * 35;
    const offset = (i % 2) * 35 + Math.sin(t * 1.7 + i) * 16;
    return `<path d="M20 ${y} C160 ${y - 24 + offset * 0.08}, 252 ${y + 22}, 390 ${y} S636 ${y - 22}, 794 ${y} S960 ${y + 28}, 1060 ${y - 2}" stroke="#a6d4db" stroke-width="4" fill="none" opacity="${0.38 + (i % 3) * 0.08}"/>`;
  }).join("");
  return `
  <g clip-path="url(#artClip)">
    <rect x="20" y="334" width="1040" height="948" fill="url(#sea)"/>
    <rect x="20" y="334" width="1040" height="948" fill="#001824" opacity="${glow}"/>
    ${waves}
    <g transform="translate(${555 + drift} 828) scale(${1.25 + local * 0.08})" filter="url(#inkShadow)">
      <path d="M-260 45 C-146 -62 -14 -108 119 -62 C216 -28 285 32 318 91 C166 154 -29 168 -184 102 Z" fill="#111914" stroke="#e2b942" stroke-width="15"/>
      <path d="M-176 55 C-96 -18 10 -40 102 15" stroke="#ffdf75" stroke-width="11" fill="none" stroke-linecap="round"/>
      <path d="M-236 107 C-110 184 95 191 274 118" stroke="#0c302f" stroke-width="18" fill="none"/>
    </g>
    <path d="M20 1118 C210 1072 337 1160 520 1106 C689 1056 845 1108 1060 1068 L1060 1282 L20 1282 Z" fill="#e4f2f5" opacity="0.96"/>
    ${drawStickFigure(154, 1108, 1.28, t * 2.7)}
    <circle cx="${823 + drift * 0.2}" cy="${673 + Math.sin(t * 2) * 8}" r="56" fill="none" stroke="#ffd45a" stroke-width="5" opacity="0.45"/>
  </g>`;
}

function sonar(local, t) {
  const sweep = -90 + local * 360;
  const rings = [120, 220, 320, 420].map((r, i) => {
    const opacity = 0.22 + pulse(t, 1.2, i * 0.2) * 0.18;
    return `<circle cx="540" cy="804" r="${r + local * 26}" fill="none" stroke="#1f7d8f" stroke-width="4" opacity="${opacity}"/>`;
  }).join("");
  return `
  <g clip-path="url(#artClip)">
    <rect x="20" y="334" width="1040" height="948" fill="#061b29"/>
    <g opacity="0.18" stroke="#7ddbe8" stroke-width="2">
      ${Array.from({ length: 11 }, (_, i) => `<path d="M20 ${420 + i * 78} H1060"/>`).join("")}
      ${Array.from({ length: 10 }, (_, i) => `<path d="M${80 + i * 104} 334 V1282"/>`).join("")}
    </g>
    ${rings}
    <g transform="rotate(${sweep} 540 804)">
      <path d="M540 804 L540 390" stroke="#ffd75d" stroke-width="11" stroke-linecap="round"/>
      <path d="M540 804 C640 725 745 685 892 626" stroke="#8df6ef" stroke-width="8" fill="none" stroke-linecap="round"/>
    </g>
    <path d="M386 925 C470 809 570 823 620 706 C676 579 775 562 896 628" stroke="#88fff4" stroke-width="10" fill="none" opacity="0.9"/>
    <rect x="836" y="520" width="74" height="74" fill="#111" stroke="#ffd65d" stroke-width="6"/>
    <circle cx="876" cy="556" r="${13 + pulse(t, 3.4) * 7}" fill="#f04635"/>
    ${drawStickFigure(133, 1112, 1.18, t * 2.1)}
  </g>`;
}

function archive(local, t) {
  const swing = Math.sin(t * 2.1) * 2.8;
  return `
  <g clip-path="url(#artClip)">
    <rect x="20" y="334" width="1040" height="948" fill="#18130f"/>
    <circle cx="245" cy="1190" r="360" fill="#000" opacity="0.22"/>
    <g transform="translate(540 792) rotate(${swing}) scale(${1.04 + pulse(t, 0.8) * 0.02})" filter="url(#softShadow)">
      <rect x="-355" y="-360" width="710" height="720" rx="28" fill="#f0d39a" stroke="#191611" stroke-width="8"/>
      <text x="-266" y="-260" font-family="Georgia, serif" font-size="39" fill="#59472c" font-weight="700">ARCHIVE 1978</text>
      <path d="M-260 -178 H232 M-260 -98 H250 M-260 -18 H230 M-260 62 H218 M-260 142 H245" stroke="#8c7045" stroke-width="8"/>
      <rect x="-246" y="-126" width="120" height="50" fill="#050505"/>
      <rect x="-246" y="30" width="370" height="54" fill="#050505"/>
      <rect x="-246" y="188" width="278" height="54" fill="#050505"/>
      <circle cx="275" cy="-235" r="45" fill="none" stroke="#c23e32" stroke-width="10" opacity="0.86"/>
      <path d="M-52 262 C24 194 112 190 210 246" stroke="#a33f2f" stroke-width="8" fill="none" opacity="0.74"/>
    </g>
    <path d="M20 1182 C230 1137 412 1195 622 1150 C786 1114 917 1137 1060 1095 L1060 1282 L20 1282 Z" fill="#070707" opacity="0.34"/>
    ${drawStickFigure(129, 1118, 1.2, t * 2.4)}
  </g>`;
}

function surveyShip(local, t) {
  const x = 188 + local * 590;
  const fog = Math.sin(t * 1.6) * 42;
  return `
  <g clip-path="url(#artClip)">
    <rect x="20" y="334" width="1040" height="948" fill="url(#nightSea)"/>
    <g fill="#d9f6ff">
      ${Array.from({ length: 34 }, (_, i) => `<circle cx="${55 + ((i * 97) % 980)}" cy="${392 + ((i * 59) % 285)}" r="${1.8 + (i % 3)}" opacity="${0.42 + (i % 5) * 0.08}"/>`).join("")}
    </g>
    <path d="M20 935 C240 870 396 940 584 880 C745 829 900 895 1060 858 L1060 1282 L20 1282 Z" fill="#245d6f" opacity="0.95"/>
    <path d="M20 1062 C235 1015 412 1082 617 1030 C774 990 911 1030 1060 1002 L1060 1282 L20 1282 Z" fill="#113c4b" opacity="0.9"/>
    <g transform="translate(${x} ${820 + Math.sin(t * 3) * 8})" filter="url(#inkShadow)">
      <path d="M-174 102 L190 102 L140 190 L-108 190 Z" fill="#111" stroke="#f4d56b" stroke-width="9"/>
      <rect x="-58" y="16" width="118" height="86" fill="#f4f5ee" stroke="#111" stroke-width="8"/>
      <circle cx="138" cy="142" r="22" fill="#ffd45b"/>
      <path d="M-102 191 C-190 239 -264 256 -352 257" stroke="#d8eef0" stroke-width="11" fill="none" opacity="0.72"/>
    </g>
    <path d="M${x - 312} 384 C${x - 188 + fog} 560 ${x - 274 - fog} 746 ${x - 150} 976" stroke="#d9f3f4" stroke-width="26" fill="none" opacity="0.45" stroke-linecap="round"/>
    <path d="M${x - 410} 431 C${x - 278 - fog} 620 ${x - 360 + fog} 820 ${x - 242} 1114" stroke="#d9f3f4" stroke-width="16" fill="none" opacity="0.32" stroke-linecap="round"/>
  </g>`;
}

function threeQuestions(local, t) {
  const reveal = ease(local);
  const circles = [
    { x: 252, y: 676, n: "1", d: 0.08 },
    { x: 540, y: 795, n: "2", d: 0.28 },
    { x: 828, y: 676, n: "3", d: 0.48 },
  ].map((item) => {
    const show = clamp((local - item.d) / 0.2);
    const scale = 0.75 + ease(show) * 0.25 + pulse(t, 1.8, item.d) * 0.03;
    return `<g transform="translate(${item.x} ${item.y}) scale(${scale})" opacity="${show}">
      <circle cx="0" cy="0" r="104" fill="#1f3843" stroke="#ffd75d" stroke-width="9"/>
      <text x="0" y="26" font-family="Apple SD Gothic Neo, sans-serif" font-size="82" font-weight="900" fill="#ffe073" text-anchor="middle">${item.n}</text>
    </g>`;
  }).join("");
  return `
  <g clip-path="url(#artClip)">
    <rect x="20" y="334" width="1040" height="948" fill="#102b35"/>
    <g transform="translate(540 808) scale(${0.92 + reveal * 0.08})" filter="url(#softShadow)">
      <rect x="-445" y="-368" width="890" height="735" rx="28" fill="#213b46" stroke="#8bb5bd" stroke-width="6"/>
      <path d="M-306 -120 C-80 -230 142 -54 320 -166" stroke="#355c64" stroke-width="20" fill="none" opacity="0.35"/>
      <path d="M-278 144 C-82 36 160 204 330 62" stroke="#355c64" stroke-width="18" fill="none" opacity="0.32"/>
      <path d="M252 676 L540 795 L828 676" transform="translate(-540 -808)" stroke="#ffd75d" stroke-width="8" opacity="${reveal}" fill="none"/>
    </g>
    ${circles}
    ${drawStickFigure(132, 1118, 1.17, t * 2)}
  </g>`;
}

function stoneGate(local, t) {
  const open = ease(local);
  const left = -open * 92;
  const right = open * 92;
  return `
  <g clip-path="url(#artClip)">
    <rect x="20" y="334" width="1040" height="948" fill="#071c2d"/>
    <path d="M20 1038 C208 979 385 1041 549 1002 C747 954 887 1017 1060 966 L1060 1282 L20 1282 Z" fill="#e6f1f4"/>
    <g opacity="0.72">
      ${Array.from({ length: 52 }, (_, i) => `<circle cx="${20 + ((i * 83 + Math.floor(t * 24) * 9) % 1040)}" cy="${365 + ((i * 47 + Math.floor(t * 20) * 7) % 690)}" r="${2 + (i % 4)}" fill="#fff"/>`).join("")}
    </g>
    <g transform="translate(540 824) scale(1.2)" filter="url(#inkShadow)">
      <path d="M-308 -295 C-204 -432 209 -432 308 -295 L334 372 H-334 Z" fill="#111" stroke="#e8c859" stroke-width="12"/>
      <path d="M-260 -254 C-178 -358 178 -358 260 -254 L284 330 H-284 Z" fill="#201e18" stroke="#ffdf68" stroke-width="8"/>
      <path d="M0 -330 V338" stroke="#ffdf68" stroke-width="7"/>
      <g transform="translate(${left} 0) rotate(${-open * 6} -8 40)">
        <path d="M-250 -246 C-152 -338 -48 -363 -8 -320 L-8 338 H-250 Z" fill="#181711" stroke="#ffdf68" stroke-width="7"/>
        <path d="M-150 -210 V292 M-54 -280 V317" stroke="#40331b" stroke-width="10"/>
      </g>
      <g transform="translate(${right} 0) rotate(${open * 6} 8 40)">
        <path d="M250 -246 C152 -338 48 -363 8 -320 L8 338 H250 Z" fill="#181711" stroke="#ffdf68" stroke-width="7"/>
        <path d="M150 -210 V292 M54 -280 V317" stroke="#40331b" stroke-width="10"/>
      </g>
      <path d="M-56 -35 C-14 -90 36 -90 66 -35 L88 338 H-96 Z" fill="#ffd760" opacity="${0.18 + open * 0.45}"/>
    </g>
    ${drawStickFigure(169, 1118, 1.14, t * 2.6)}
  </g>`;
}

function art(scene, time) {
  const local = (time - scene.start) / (scene.end - scene.start);
  if (scene.type === "seaTomb") return seaTomb(local, time);
  if (scene.type === "sonar") return sonar(local, time);
  if (scene.type === "archive") return archive(local, time);
  if (scene.type === "surveyShip") return surveyShip(local, time);
  if (scene.type === "threeQuestions") return threeQuestions(local, time);
  return stoneGate(local, time);
}

function captions(scene) {
  return `
  <g font-family="Apple SD Gothic Neo, sans-serif" fill="#090909" text-anchor="middle" font-weight="900" letter-spacing="-2.2">
    <text x="540" y="1378" font-size="68">${esc(scene.caption[0])}</text>
    <text x="540" y="1460" font-size="68">${esc(scene.caption[1])}</text>
  </g>`;
}

function footer(time) {
  const progress = clamp(time / DURATION);
  return `
  <g transform="translate(0 0)" font-family="Apple SD Gothic Neo, sans-serif">
    <rect x="70" y="1620" width="62" height="62" rx="31" fill="#080808"/>
    <text x="150" y="1658" font-size="22" font-weight="900" fill="#111">@mychannel</text>
    <rect x="292" y="1623" width="85" height="44" rx="22" fill="#f2f2f2" stroke="#d7d7d7"/>
    <text x="334" y="1653" font-size="20" font-weight="900" fill="#111" text-anchor="middle">구독</text>
    <rect x="70" y="1705" width="940" height="44" rx="12" fill="#a1a1a1"/>
    <rect x="70" y="1705" width="${940 * progress}" height="44" rx="12" fill="#111"/>
    <text x="94" y="1734" font-size="18" font-weight="800" fill="#fff">original edit with mystery beat</text>
  </g>`;
}

function svgForFrame(index) {
  const time = index / FPS;
  const scene = sceneAt(time);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${globalDefs()}
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f7f5ee"/>
  ${header(time)}
  ${art(scene, time)}
  ${captions(scene)}
  ${footer(time)}
</svg>`;
}

function writeWav() {
  const sampleRate = 48000;
  const channels = 2;
  const totalSamples = Math.floor(DURATION * sampleRate);
  const pcm = Buffer.alloc(totalSamples * channels * 2);
  const chords = [
    [392, 493.88, 587.33],
    [349.23, 440, 523.25],
    [329.63, 392, 493.88],
    [392, 493.88, 587.33],
  ];
  const melody = [783.99, 739.99, 659.25, 587.33, 659.25, 739.99, 783.99, 880];
  const beat = 1.68;

  function env(x, decay = 5.5) {
    return Math.exp(-x * decay);
  }

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const bar = Math.floor(t / beat);
    const within = t % beat;
    const chord = chords[bar % chords.length];
    let sample = 0;

    chord.forEach((freq, idx) => {
      [0, 0.56, 1.12].forEach((offset, beatIndex) => {
        const dt = within - offset;
        if (dt >= 0 && dt < 0.7) {
          const amp = beatIndex === 0 ? 0.12 : 0.065;
          sample += Math.sin(Math.PI * 2 * freq * t) * amp * env(dt, beatIndex === 0 ? 4.2 : 6.4);
          sample += Math.sin(Math.PI * 2 * freq * 2.01 * t) * amp * 0.18 * env(dt, 7.2 + idx);
        }
      });
    });

    const noteDur = 0.42;
    const noteIndex = Math.floor(t / noteDur) % melody.length;
    const noteT = t % noteDur;
    if (noteT < 0.32) {
      const freq = melody[(noteIndex + Math.floor(bar / 2)) % melody.length];
      sample += Math.sin(Math.PI * 2 * freq * t) * 0.075 * env(noteT, 7.5);
      sample += Math.sin(Math.PI * 2 * freq * 2 * t) * 0.018 * env(noteT, 11);
    }

    const vinyl = (Math.sin(t * 2713.7) + Math.sin(t * 3911.3)) * 0.0032;
    const swell = 0.88 + Math.sin(t * Math.PI * 2 * 0.07) * 0.08;
    const out = Math.max(-0.92, Math.min(0.92, (sample * swell + vinyl) * 2.24));
    const left = out * (0.94 + Math.sin(t * 0.6) * 0.04);
    const right = out * (0.94 - Math.sin(t * 0.6) * 0.04);
    pcm.writeInt16LE(Math.round(left * 32767), i * 4);
    pcm.writeInt16LE(Math.round(right * 32767), i * 4 + 2);
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
  writeFileSync(svgPath, svgForFrame(i));
  const result = spawnSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
    stdio: "ignore",
  });
  if (result.status !== 0) {
    throw new Error(`sips failed on frame ${i + 1}`);
  }
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

if (ffmpeg.status !== 0) {
  throw new Error("ffmpeg render failed");
}

console.log(JSON.stringify({ stamp, workDir, finalPath }, null, 2));
