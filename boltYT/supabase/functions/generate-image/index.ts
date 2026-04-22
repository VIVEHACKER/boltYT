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

		const openaiKey = Deno.env.get("OPENAI_API_KEY") || "";
		if (!openaiKey) {
			return errorResponse("OpenAI API key not configured", 500);
		}

		const { scene_id, visual_prompt } = await req.json();
		if (!scene_id || !visual_prompt) {
			return errorResponse("scene_id and visual_prompt are required");
		}

		const dalleRes = await fetch(
			"https://api.openai.com/v1/images/generations",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${openaiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "dall-e-3",
					prompt: `YouTube video scene illustration, high quality, cinematic: ${visual_prompt}`,
					n: 1,
					size: "1792x1024",
					response_format: "b64_json",
				}),
			},
		);

		if (!dalleRes.ok) {
			const errText = await dalleRes.text();
			throw new Error(`DALL-E error: ${dalleRes.status} ${errText}`);
		}

		const dalleData = await dalleRes.json();
		const b64 = dalleData.data[0].b64_json;

		const binaryStr = atob(b64);
		const bytes = new Uint8Array(binaryStr.length);
		for (let i = 0; i < binaryStr.length; i++) {
			bytes[i] = binaryStr.charCodeAt(i);
		}

		const storagePath = `scenes/${scene_id}/visual.png`;

		const { error: uploadError } = await supabase.storage
			.from("media")
			.upload(storagePath, bytes, {
				contentType: "image/png",
				upsert: true,
			});

		if (uploadError) {
			throw new Error(`Storage upload error: ${uploadError.message}`);
		}

		const {
			data: { publicUrl },
		} = supabase.storage.from("media").getPublicUrl(storagePath);

		await supabase
			.from("media_assets")
			.update({ storage_path: storagePath, status: "complete" })
			.eq("scene_id", scene_id)
			.eq("type", "image");

		return jsonResponse({ url: publicUrl, storage_path: storagePath });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return errorResponse(message, 500);
	}
});
