// 주제 충실도 A/B 실측 — 개선 전(A) vs 개선 후(B) 프롬프트를 실제 gpt-4o로 호출해 비교.
// 시크릿은 .env에서 로드만 하고 절대 출력하지 않는다.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
	readFileSync(new URL("../.env", import.meta.url), "utf8")
		.split("\n")
		.map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/))
		.filter(Boolean)
		.map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);
const KEY = env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY missing");

// 고유명사가 분명한 주제 — gpt-4o가 사전지식으로 도망갈 수 없게(=주제 충실도 측정용)
const TOPIC = "강원도 인제 빙어호에서 하룻밤 사이 사라진 낚시꾼 7명의 미스터리";
const TOPIC_TOKENS = ["인제", "빙어호", "낚시꾼", "강원도", "7명"];

const SCRIPT_RULES = `형식: shorts
쇼츠: 7~10개 씬, 30~50초. 첫 씬은 스크롤을 멈출 강한 사실 1개로 시작. 씬당 1~2문장.
각 씬은 image 또는 video 중에서만 선택. text_emphasis/news_overlay 사용 금지.
visual_prompt는 영어로.
응답 형식(JSON): {"shorts_script":"...","longform_scenes":[{"narration":"...","type":"image","visual_prompt":"...","duration":4,"mood":"mystery"}]}`;

// 레퍼런스 스타일 지시(둘 다 동일 — 변수 격리). 일부러 '드라마/영화 해설' 같은 잡음도 넣어
// 모델이 스타일에 끌려 주제를 겉돌게 만드는 현실 조건 재현.
const REFERENCE_BLOCK = `=== 레퍼런스 제작 지시서 ===
선택 레퍼런스: 미스터리 다큐 (호흡: 빠른 컷, 어두운 톤)
트렌드 신호: 질문형 훅 / 증거 컷 / 후속 시리즈화
1순위 대본 구조: 첫 장면에서 결론처럼 보이는 단서를 제시하고 마지막에 가장 강한 가설을 남김
1순위 훅: 왜 지금 다시 봐야 할까요?`;

// ── A: 개선 전 — 주제는 한 줄, 재진술/앵커 없음
const A_SYSTEM = `당신은 한국 유튜브 미스테리/공포 채널의 스크립트 작성 전문가입니다.
참고 채널 "편집중", "까마귀의 밤" 스타일. 반드시 JSON으로만 응답하세요.`;
const A_USER = `주제: ${TOPIC}
${REFERENCE_BLOCK}
${SCRIPT_RULES}`;

// ── B: 개선 후 — 시스템 원칙0(주제 키워드 강제) + 유저 프롬프트 끝 주제 충실도 재진술 + topic-anchor
const B_SYSTEM = `당신은 한국 유튜브 미스테리/공포 채널의 스크립트 작성 전문가입니다.
참고 채널 "편집중", "까마귀의 밤" 스타일.

핵심 원칙:
0. 이 영상의 주제는 "${TOPIC}"이다. 주제의 핵심 키워드/고유명사가 최소 첫 2개 씬과 마지막 씬 나레이션에 명시적으로 등장해야 하며, 레퍼런스 스타일에 맞추려고 주제를 일반화하지 마세요.
반드시 JSON으로만 응답하세요.`;
const B_USER = `주제: ${TOPIC}
${REFERENCE_BLOCK}
- [critical] 주제 고정: 이 대본은 "${TOPIC}"의 구체적 사실·고유명사·핵심 질문을 모든 씬에서 직접 다룬다. 레퍼런스 구조에 맞추려고 주제를 일반론으로 치환하지 말 것
${SCRIPT_RULES}

=== 절대 준수: 주제 충실도 (최우선) ===
이 영상의 주제는 "${TOPIC}"이다. 모든 씬의 나레이션은 이 주제의 구체적 대상/사건/인물/숫자를 직접 다뤄야 하며, 레퍼런스 스타일 규칙은 표현 방식일 뿐 주제를 대체하지 않는다. 주제와 무관한 일반론·다른 사건으로 새지 마라.`;

async function call(system, user, useImproved) {
	const body = {
		model: "gpt-4o",
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		// A=개선 전(기본), B=개선 후(jsonMode+max_tokens+temp 0.7)
		temperature: useImproved ? 0.7 : 0.8,
		...(useImproved
			? { max_tokens: 4096, response_format: { type: "json_object" } }
			: {}),
	};
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const json = await res.json();
	const raw = json.choices[0].message.content.replace(/```json\n?|\n?```/g, "").trim();
	return JSON.parse(raw);
}

function analyze(label, script) {
	const scenes = script.longform_scenes ?? [];
	const narrations = scenes.map((s) => s.narration ?? "");
	const allText = (script.shorts_script ?? "") + " " + narrations.join(" ");
	const tokenHits = Object.fromEntries(
		TOPIC_TOKENS.map((t) => [t, (allText.match(new RegExp(t, "g")) ?? []).length]),
	);
	const scenesOnTopic = narrations.filter((n) =>
		TOPIC_TOKENS.some((t) => n.includes(t)),
	).length;
	const totalNarrationChars = narrations.join("").length;
	console.log(`\n========== ${label} ==========`);
	console.log(`씬 수: ${scenes.length}`);
	console.log(`주제 토큰 등장: ${JSON.stringify(tokenHits)}`);
	console.log(
		`주제 키워드 포함 씬: ${scenesOnTopic}/${scenes.length} (${Math.round((scenesOnTopic / Math.max(1, scenes.length)) * 100)}%)`,
	);
	console.log(`나레이션 총 길이: ${totalNarrationChars}자`);
	console.log(`shorts_script: ${(script.shorts_script ?? "").slice(0, 160)}`);
	console.log(`-- 첫 3개 씬 나레이션 --`);
	narrations.slice(0, 3).forEach((n, i) => console.log(`  씬${i + 1}: ${n}`));
	return { scenesOnTopic, scenes: scenes.length, tokenHits, totalNarrationChars };
}

console.log(`주제: ${TOPIC}`);
console.log(`측정 토큰: ${TOPIC_TOKENS.join(", ")}`);
const [a, b] = await Promise.all([
	call(A_SYSTEM, A_USER, false),
	call(B_SYSTEM, B_USER, true),
]);
const ra = analyze("A: 개선 전 프롬프트", a);
const rb = analyze("B: 개선 후 프롬프트", b);
console.log(`\n========== 요약 ==========`);
const pct = (r) => Math.round((r.scenesOnTopic / Math.max(1, r.scenes)) * 100);
console.log(`주제 키워드 포함 씬 비율:  A=${pct(ra)}%   →   B=${pct(rb)}%`);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
console.log(`주제 토큰 총 등장 수:      A=${sum(ra.tokenHits)}   →   B=${sum(rb.tokenHits)}`);
