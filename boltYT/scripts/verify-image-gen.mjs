// 이미지 생성 수정 검증 하네스 — OpenAI 결제 복구 시 1줄로 9:16·mood 변경을 눈으로 확인.
//   node scripts/verify-image-gen.mjs   (DALL-E 호출, 결과 PNG를 /tmp 에 저장)
// image-gen.ts 의 dalleSize / mood별 style 로직을 그대로 재현(코드 진실과 일치).
// 시크릿은 .env 에서 로드만 하고 출력하지 않는다.
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
	readFileSync(new URL("../.env", import.meta.url), "utf8")
		.split("\n")
		.map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/))
		.filter(Boolean)
		.map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);
const KEY = env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY missing");

// ── image-gen.ts 와 동일한 매핑 ──
const dalleSize = (ratio) =>
	ratio === "9:16" ? "1024x1792" : ratio === "1:1" ? "1024x1024" : "1792x1024";
const naturalMoodRe = /news|neutral|proof|evidence|document/i;
const styleFor = (mood, styleMode) =>
	styleMode === "photo" || naturalMoodRe.test(mood ?? "") ? "natural" : "vivid";

const SCENE = "강원도 인제 빙어호 밤, 우비 입은 형사들이 손전등으로 얼음 위 현장을 수색";
const SCENE_EN =
	"night frozen lake in Inje Korea, detectives in raincoats searching the ice with flashlights, cinematic 35mm, cold blue grading";

// 검증 케이스: (1) 9:16 vs 16:9 종횡비, (2) horror(vivid) vs news(natural) 스타일
const cases = [
	{ name: "A_16x9_horror", aspectRatio: "16:9", mood: "horror" },
	{ name: "B_9x16_horror", aspectRatio: "9:16", mood: "horror" },
	{ name: "C_9x16_news", aspectRatio: "9:16", mood: "news" },
];

async function gen({ name, aspectRatio, mood }) {
	const style = styleFor(mood);
	const size = dalleSize(aspectRatio);
	const prompt = `${SCENE_EN}\n\nAvoid: on-screen text, watermark, logo, distorted faces, extra fingers, oversaturation.`;
	const res = await fetch("https://api.openai.com/v1/images/generations", {
		method: "POST",
		headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "dall-e-3",
			prompt,
			n: 1,
			size,
			quality: "hd",
			style,
			response_format: "b64_json",
		}),
	});
	if (!res.ok) {
		console.log(`  ${name}: DALL-E ${res.status} ${(await res.text()).slice(0, 100)}`);
		return;
	}
	const json = await res.json();
	const out = `/tmp/imgverify_${name}.png`;
	writeFileSync(out, Buffer.from(json.data[0].b64_json, "base64"));
	console.log(`  ${name}: size=${size} style=${style} → ${out}`);
}

console.log(`씬: ${SCENE}`);
console.log("기대: A=가로(16:9)·vivid, B=세로(9:16)·vivid, C=세로(9:16)·natural(과채도↓)\n");
for (const c of cases) await gen(c);
console.log("\n완료. /tmp/imgverify_*.png 를 열어 종횡비(세로/가로)·스타일(vivid/natural)을 확인하세요.");
