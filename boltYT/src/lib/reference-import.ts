/**
 * Reference Template Client API
 *
 * 레퍼런스 영상(YouTube URL 등) 분석 요청 → 폴링 → Supabase 저장.
 * 분석 서버(server/reference-analyzer.ts)와 통신.
 */

import type { ReferenceTemplate } from "../types/database";
import { getReferenceAnalyzerUrl } from "./proxy";
import { supabase } from "./supabase";

export interface AnalysisJobResult {
	source_type: "youtube" | "file";
	source_url: string;
	source_title: string;
	source_creator: string;
	thumbnail_url: string;
	duration_seconds: number;
	dominant_colors: string[];
	visual_mood: ReferenceTemplate["visual_mood"];
	visual_prompt_template: string;
	lighting_style: ReferenceTemplate["lighting_style"];
	subtitle_position: ReferenceTemplate["subtitle_position"];
	subtitle_size_preset: ReferenceTemplate["subtitle_size_preset"];
	subtitle_bg_style: ReferenceTemplate["subtitle_bg_style"];
	subtitle_accent_color: string;
	scene_count: number;
	avg_scene_duration: number;
	hook_duration: number;
	transition_style: ReferenceTemplate["transition_style"];
	pacing_preset: ReferenceTemplate["pacing_preset"];
	tts_voice_id: string;
	tts_provider: ReferenceTemplate["tts_provider"];
	tts_speed: number;
	tts_tone_keywords: string[];
	bgm_mood: string;
	bgm_keywords: string[];
	bgm_tempo: ReferenceTemplate["bgm_tempo"];
	hook_pattern: ReferenceTemplate["hook_pattern"];
	script_structure: ReferenceTemplate["script_structure"];
	transcript: string;
	frame_urls: string[];
	raw_analysis: Record<string, unknown>;
}

export interface AnalysisJob {
	id: string;
	status:
		| "queued"
		| "downloading"
		| "extracting"
		| "transcribing"
		| "analyzing"
		| "complete"
		| "failed";
	progress: number;
	input: { type: "youtube" | "file"; url?: string; filePath?: string };
	result?: AnalysisJobResult;
	error?: string;
	createdAt: string;
	completedAt?: string;
}

/** 분석 시작 (YouTube URL) */
export async function startYouTubeAnalysis(url: string): Promise<AnalysisJob> {
	const base = getReferenceAnalyzerUrl();
	const res = await fetch(`${base}/api/reference/analyze`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ type: "youtube", url }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`분석 서버 오류 ${res.status}: ${text}`);
	}
	const data = (await res.json()) as { job: AnalysisJob };
	return data.job;
}

/** 잡 상태 조회 */
export async function fetchAnalysisJob(jobId: string): Promise<AnalysisJob> {
	const base = getReferenceAnalyzerUrl();
	const res = await fetch(`${base}/api/reference/job/${jobId}`);
	if (!res.ok) throw new Error(`잡 조회 실패: ${res.status}`);
	const data = (await res.json()) as { job: AnalysisJob };
	return data.job;
}

/**
 * 잡 완료까지 폴링 (2초 간격, 최대 10분).
 * onProgress로 중간 상태 알림.
 */
export async function waitForAnalysis(
	jobId: string,
	onProgress?: (job: AnalysisJob) => void,
	opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<AnalysisJob> {
	const interval = opts?.intervalMs ?? 2000;
	const timeout = opts?.timeoutMs ?? 10 * 60 * 1000;
	const start = Date.now();

	while (Date.now() - start < timeout) {
		const job = await fetchAnalysisJob(jobId);
		onProgress?.(job);
		if (job.status === "complete" || job.status === "failed") return job;
		await new Promise((r) => setTimeout(r, interval));
	}

	throw new Error("분석 시간 초과");
}

/** 분석기 작업 디렉토리 정리 (디스크 절약) */
export async function cleanupAnalysisJob(jobId: string): Promise<void> {
	try {
		const base = getReferenceAnalyzerUrl();
		await fetch(`${base}/api/reference/job/${jobId}/cleanup`, {
			method: "POST",
		});
	} catch {
		// 정리 실패해도 사용자 플로우를 막지 않는다
	}
}

/** 분석 서버 헬스체크 */
export async function checkAnalyzerHealth(): Promise<boolean> {
	try {
		const base = getReferenceAnalyzerUrl();
		const res = await fetch(`${base}/health`, {
			signal: AbortSignal.timeout(3000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

// ─── Supabase CRUD ───

export async function saveReferenceTemplate(
	channelId: string,
	name: string,
	result: AnalysisJobResult,
): Promise<ReferenceTemplate> {
	const payload = {
		channel_id: channelId,
		name,
		source_type: result.source_type,
		source_url: result.source_url,
		source_title: result.source_title,
		source_creator: result.source_creator,
		thumbnail_url: result.thumbnail_url,
		duration_seconds: result.duration_seconds,

		dominant_colors: result.dominant_colors,
		visual_mood: result.visual_mood,
		visual_prompt_template: result.visual_prompt_template,
		lighting_style: result.lighting_style,

		subtitle_position: result.subtitle_position,
		subtitle_size_preset: result.subtitle_size_preset,
		subtitle_bg_style: result.subtitle_bg_style,
		subtitle_accent_color: result.subtitle_accent_color,

		scene_count: result.scene_count,
		avg_scene_duration: result.avg_scene_duration,
		hook_duration: result.hook_duration,
		transition_style: result.transition_style,
		pacing_preset: result.pacing_preset,

		tts_voice_id: result.tts_voice_id,
		tts_provider: result.tts_provider,
		tts_speed: result.tts_speed,
		tts_tone_keywords: result.tts_tone_keywords,

		bgm_mood: result.bgm_mood,
		bgm_keywords: result.bgm_keywords,
		bgm_tempo: result.bgm_tempo,

		hook_pattern: result.hook_pattern,
		script_structure: result.script_structure,

		transcript: result.transcript,
		frame_urls: result.frame_urls,
		raw_analysis: result.raw_analysis,

		analysis_status: "complete" as const,
	};

	const { data, error } = await supabase
		.from("reference_templates")
		.insert(payload)
		.select()
		.single();

	if (error) throw new Error(`저장 실패: ${error.message}`);
	return data as ReferenceTemplate;
}

export async function listReferenceTemplates(
	channelId: string,
): Promise<ReferenceTemplate[]> {
	const { data, error } = await supabase
		.from("reference_templates")
		.select("*")
		.eq("channel_id", channelId)
		.order("created_at", { ascending: false });
	if (error) throw new Error(error.message);
	return (data ?? []) as ReferenceTemplate[];
}

export async function getReferenceTemplate(
	id: string,
): Promise<ReferenceTemplate | null> {
	const { data, error } = await supabase
		.from("reference_templates")
		.select("*")
		.eq("id", id)
		.maybeSingle();
	if (error) throw new Error(error.message);
	return (data as ReferenceTemplate | null) ?? null;
}

export async function updateReferenceTemplate(
	id: string,
	patch: Partial<ReferenceTemplate>,
): Promise<void> {
	const { error } = await supabase
		.from("reference_templates")
		.update({ ...patch, updated_at: new Date().toISOString() })
		.eq("id", id);
	if (error) throw new Error(error.message);
}

export async function deleteReferenceTemplate(id: string): Promise<void> {
	const { error } = await supabase
		.from("reference_templates")
		.delete()
		.eq("id", id);
	if (error) throw new Error(error.message);
}
