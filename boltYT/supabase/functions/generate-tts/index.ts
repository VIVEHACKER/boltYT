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

		const { scene_id, narration_text, voice } = await req.json();
		if (!scene_id || !narration_text) {
			return errorResponse("scene_id and narration_text are required");
		}

		const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${openaiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "tts-1",
				input: narration_text,
				voice: voice || "nova",
				response_format: "mp3",
				speed: 1.0,
			}),
		});

		if (!ttsRes.ok) {
			const errText = await ttsRes.text();
			throw new Error(`TTS error: ${ttsRes.status} ${errText}`);
		}

		const audioBuffer = await ttsRes.arrayBuffer();
		const bytes = new Uint8Array(audioBuffer);

		const storagePath = `scenes/${scene_id}/tts.mp3`;

		const { error: uploadError } = await supabase.storage
			.from("media")
			.upload(storagePath, bytes, {
				contentType: "audio/mpeg",
				upsert: true,
			});

		if (uploadError) {
			throw new Error(`Storage upload error: ${uploadError.message}`);
		}

		const {
			data: { publicUrl },
		} = supabase.storage.from("media").getPublicUrl(storagePath);

		// Upsert media_asset for TTS audio
		const { data: existing } = await supabase
			.from("media_assets")
			.select("id")
			.eq("scene_id", scene_id)
			.eq("type", "tts_audio")
			.limit(1)
			.maybeSingle();

		if (existing) {
			await supabase
				.from("media_assets")
				.update({ storage_path: storagePath, status: "complete" })
				.eq("id", existing.id);
		} else {
			await supabase.from("media_assets").insert({
				scene_id,
				type: "tts_audio",
				storage_path: storagePath,
				status: "complete",
			});
		}

		return jsonResponse({
			url: publicUrl,
			storage_path: storagePath,
			duration_estimate: Math.ceil(narration_text.length / 15),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		return errorResponse(message, 500);
	}
});
