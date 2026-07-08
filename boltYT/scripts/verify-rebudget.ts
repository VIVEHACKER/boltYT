/**
 * rebudget 실측 검증(일회성) — 실제 LLM(api-proxy) 재작성 + accept-if-better 가드 확인.
 * TTS/ComfyUI 불필요. make-vlog 의 rewriteNarration 과 동일한 프롬프트/가드를 재현해 동작만 확인한다.
 * 실행: npx tsx scripts/verify-rebudget.ts   (api-proxy 3459 + LLM 백엔드 필요)
 */
import { estimateSpeakingSeconds, planRebudget } from "../src/lib/shot-plan.ts";

const PROXY = process.env.API_PROXY_URL ?? "http://localhost:3459";

async function rewrite(
	narration: string,
	targetChars: number,
	direction: "expand" | "trim",
	subjectKo: string,
): Promise<string> {
	const guide =
		direction === "expand"
			? "기존 내용만 더 생생하게 풀어 써라(새 사실·고유명사·연도를 지어내지 마라)"
			: "군더더기만 덜어 핵심 의미·사실을 보존하라";
	const cr = await fetch(`${PROXY}/api/openai/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			messages: [
				{
					role: "system",
					content: "한국 유튜브 시간여행 역사 브이로그 작가. JSON만 출력.",
				},
				{
					role: "user",
					content: `${subjectKo} 1인칭 브이로그 내레이션을 의미·톤 유지하며 약 ${targetChars}자(±15%)로 다시 써라. ${guide}. 원문 문장 수(1~2문장) 유지, 생생·몰입·한국어. JSON: {"narration":"..."}\n원문: ${narration}`,
				},
			],
			response_format: { type: "json_object" },
		}),
	});
	if (!cr.ok) throw new Error(`rebudget ${cr.status}`);
	const parsed = JSON.parse((await cr.json()).choices[0].message.content);
	const out =
		typeof parsed.narration === "string" ? parsed.narration.trim() : "";
	return out || narration;
}

const SUBJECT = "고대 로마";
const narrations = [
	"와, 여기가 로마라니!", // 짧음 → expand
	"지금 제 눈앞에 펼쳐진 이 거대한 콜로세움은 상상 이상으로 웅장하고, 수만 관중의 함성과 검투사들의 발소리가 뒤섞여 온몸에 소름이 돋을 만큼 압도적인 광경을 만들어내고 있습니다", // 김 → trim
	"콜로세움 한가운데 서니 함성이 귀를 때리고 모래 냄새가 코를 찌릅니다", // 적정 → 스킵 기대
];
const targets = [8, 8, 8];

async function main(): Promise<void> {
	const plan = planRebudget(narrations, targets, { tolerance: 0.35 });
	console.log(
		`목표 8s/컷 · 선별 ${plan.length}/${narrations.length}컷\n${"─".repeat(60)}`,
	);
	for (let i = 0; i < narrations.length; i++) {
		const p = plan.find((x) => x.index === i);
		const cur = estimateSpeakingSeconds(narrations[i]);
		if (!p) {
			console.log(
				`컷${i + 1} [스킵] ${cur}s (허용범위) — "${narrations[i].slice(0, 22)}…"\n`,
			);
			continue;
		}
		const rewritten = await rewrite(
			narrations[i],
			p.targetChars,
			p.direction,
			SUBJECT,
		);
		const before = Math.abs(
			estimateSpeakingSeconds(narrations[i]) - p.targetSec,
		);
		const after = Math.abs(estimateSpeakingSeconds(rewritten) - p.targetSec);
		const accepted = after <= before;
		console.log(
			`컷${i + 1} [${p.direction}] ${cur}s→${estimateSpeakingSeconds(rewritten)}s (목표 ${p.targetSec}s/${p.targetChars}자) ${accepted ? "✅채택" : "❌거부(더 어긋남)"} Δ${before.toFixed(1)}→${after.toFixed(1)}`,
		);
		console.log(`  원문 : ${narrations[i]}`);
		console.log(`  재작성: ${rewritten}\n`);
	}
}

main().catch((e) => {
	console.error("❌", e?.message ?? e);
	process.exit(1);
});
