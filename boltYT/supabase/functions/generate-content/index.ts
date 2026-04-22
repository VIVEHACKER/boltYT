import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.103.0";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders, "Content-Type": "application/json" },
	});
}

function errorResponse(message: string, status = 400) {
	return jsonResponse({ error: message }, status);
}

async function callOpenAI(
	apiKey: string,
	systemPrompt: string,
	userPrompt: string,
): Promise<string> {
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "gpt-4o-mini",
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			temperature: 0.8,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenAI API error: ${res.status} ${err}`);
	}

	const json = await res.json();
	return json.choices[0].message.content;
}

async function getChannelContext(
	supabase: ReturnType<typeof createClient>,
	channelId: string,
) {
	const { data: channel } = await supabase
		.from("channels")
		.select("*")
		.eq("id", channelId)
		.maybeSingle();

	const { data: styleBible } = await supabase
		.from("style_bibles")
		.select("*")
		.eq("channel_id", channelId)
		.maybeSingle();

	return { channel, styleBible };
}

async function handleSuggestions(
	apiKey: string,
	supabase: ReturnType<typeof createClient>,
	body: { channel_id: string },
) {
	const { channel, styleBible } = await getChannelContext(
		supabase,
		body.channel_id,
	);
	if (!channel) return errorResponse("Channel not found", 404);

	const channelContext = `채널명: ${channel.name}
카테고리: ${channel.category}
톤: ${channel.tone}
언어: ${channel.language}
설명: ${channel.description}
${styleBible ? `캐릭터: ${styleBible.character_name}` : ""}`;

	const systemPrompt = `당신은 유튜브 콘텐츠 기획 전문가입니다. 주어진 채널 정보를 바탕으로 시청자의 관심을 끌 수 있는 유튜브 콘텐츠 주제를 추천합니다. 반드시 JSON 배열로만 응답하세요. 다른 텍스트는 포함하지 마세요.`;

	const userPrompt = `다음 채널에 어울리는 유튜브 콘텐츠 주제 5개를 추천해주세요.

${channelContext}

응답 형식 (JSON 배열만):
["주제1", "주제2", "주제3", "주제4", "주제5"]`;

	const result = await callOpenAI(apiKey, systemPrompt, userPrompt);
	const cleaned = result.replace(/```json\n?|\n?```/g, "").trim();
	const suggestions = JSON.parse(cleaned);

	return jsonResponse({ suggestions });
}

async function handleBrief(
	apiKey: string,
	supabase: ReturnType<typeof createClient>,
	body: { topic_id: string },
) {
	const { data: topic } = await supabase
		.from("topics")
		.select("*, channels(*)")
		.eq("id", body.topic_id)
		.maybeSingle();

	if (!topic) return errorResponse("Topic not found", 404);

	const channel = topic.channels;
	const { styleBible } = await getChannelContext(supabase, channel.id);

	const channelContext = `채널명: ${channel.name}
카테고리: ${channel.category}
톤: ${channel.tone}
금지어: ${(channel.forbidden_words || []).join(", ")}
CTA: ${channel.default_cta}
${styleBible ? `캐릭터: ${styleBible.character_name}, 비주얼 스타일: ${styleBible.appearance_description}` : ""}`;

	const systemPrompt = `당신은 유튜브 콘텐츠 브리프 작성 전문가입니다. 주어진 주제와 채널 정보를 바탕으로 상세한 콘텐츠 브리프를 작성합니다. 반드시 지정된 JSON 형식으로만 응답하세요.`;

	const userPrompt = `다음 주제에 대한 유튜브 콘텐츠 브리프를 작성해주세요.

주제: ${topic.title}

채널 정보:
${channelContext}

응답 형식 (JSON만):
{
  "core_message": "이 콘텐츠의 핵심 메시지 (2-3문장)",
  "target_audience": "타겟 시청자 설명",
  "cautions": "콘텐츠 제작 시 주의사항",
  "shorts_hooks": ["쇼츠 훅 문장1", "쇼츠 훅 문장2", "쇼츠 훅 문장3"],
  "longform_outline": ["1. 도입: ...", "2. ...", "3. ...", "4. ...", "5. ...", "6. 마무리: ..."]
}`;

	const result = await callOpenAI(apiKey, systemPrompt, userPrompt);
	const cleaned = result.replace(/```json\n?|\n?```/g, "").trim();
	const brief = JSON.parse(cleaned);

	return jsonResponse({ brief });
}

async function handleScript(
	apiKey: string,
	supabase: ReturnType<typeof createClient>,
	body: { brief_id: string; format: string },
) {
	const { data: brief } = await supabase
		.from("briefs")
		.select("*, topics(*, channels(*))")
		.eq("id", body.brief_id)
		.maybeSingle();

	if (!brief) return errorResponse("Brief not found", 404);

	const topic = brief.topics;
	const channel = topic.channels;
	const { styleBible } = await getChannelContext(supabase, channel.id);

	const briefContext = `주제: ${topic.title}
핵심 메시지: ${brief.core_message}
타겟 시청자: ${brief.target_audience}
주의사항: ${brief.cautions}
쇼츠 훅: ${(brief.shorts_hooks || []).join(" / ")}
롱폼 목차: ${(brief.longform_outline || []).map((o: { text: string }) => o.text).join(" / ")}`;

	const channelContext = `채널 톤: ${channel.tone}
금지어: ${(channel.forbidden_words || []).join(", ")}
CTA: ${channel.default_cta}
${styleBible ? `캐릭터: ${styleBible.character_name}` : ""}`;

	const systemPrompt = `당신은 유튜브 영상 스크립트 작성 전문가입니다. 브리프를 바탕으로 실제 촬영/제작에 사용할 수 있는 스크립트를 작성합니다. 반드시 지정된 JSON 형식으로만 응답하세요.`;

	const format = body.format || "both";

	const userPrompt = `다음 브리프를 바탕으로 유튜브 스크립트를 작성해주세요.

${briefContext}

채널 정보:
${channelContext}

생성할 형식: ${format === "both" ? "쇼츠 + 롱폼" : format === "shorts" ? "쇼츠만" : "롱폼만"}

응답 형식 (JSON만):
{
  "shorts_script": "쇼츠 스크립트 전체 (60초 이내, [훅], [본론], [CTA] 구분)",
  "longform_scenes": [
    {
      "narration": "씬 나레이션 텍스트",
      "type": "image 또는 video 또는 text_emphasis",
      "visual_prompt": "이 씬의 시각적 설명 (이미지 생성용)",
      "duration": 8
    }
  ]
}

롱폼 씬은 6-8개로 구성하고, 총 영상 길이가 3-5분이 되도록 하세요.
각 씬의 나레이션은 자연스럽고 구어체로 작성하세요.
visual_prompt는 영어로 작성하세요.`;

	const result = await callOpenAI(apiKey, systemPrompt, userPrompt);
	const cleaned = result.replace(/```json\n?|\n?```/g, "").trim();
	const script = JSON.parse(cleaned);

	return jsonResponse({ script });
}

Deno.serve(async (req: Request) => {
	if (req.method === "OPTIONS") {
		return new Response(null, { status: 200, headers: corsHeaders });
	}

	try {
		const supabase = createClient(
			Deno.env.get("SUPABASE_URL") ?? "",
			Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
		);

		const authHeader = req.headers.get("Authorization");
		if (!authHeader) return errorResponse("Missing Authorization header", 401);

		const token = authHeader.replace("Bearer ", "");
		const {
			data: { user },
		} = await supabase.auth.getUser(token);
		if (!user) return errorResponse("Invalid token", 401);

		const url = new URL(req.url);
		const action = url.searchParams.get("action");
		const body = await req.json();

		const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
		if (!openaiKey) {
			return errorResponse(
				"OpenAI API 키가 설정되지 않았습니다. 설정 페이지에서 API 키를 등록해주세요.",
				500,
			);
		}

		switch (action) {
			case "suggestions":
				return await handleSuggestions(openaiKey, supabase, body);
			case "brief":
				return await handleBrief(openaiKey, supabase, body);
			case "script":
				return await handleScript(openaiKey, supabase, body);
			default:
				return errorResponse(`Unknown action: ${action}`, 400);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return errorResponse(message, 500);
	}
});
