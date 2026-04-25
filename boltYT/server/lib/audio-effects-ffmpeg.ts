/**
 * CLI 렌더 오디오 이펙트 전처리 — ffmpeg 필터 체인.
 *
 * 브라우저의 OfflineAudioContext 구현(audio-effects-web.ts)과 동일한
 * FX_ORDER(eq3→gain→delay→reverb)를 ffmpeg 필터로 근사.
 *
 * Remotion CLI 렌더 전에 호출해 audioEffects 있는 클립의 오디오를
 * 전처리된 파일로 교체. 렌더 완료 후 호출자가 tempDir 삭제.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AudioEffect } from "../../src/lib/audio-effects.js";
import type { TimelineProject } from "../../src/lib/timeline-model.js";

const execFileAsync = promisify(execFile);

// 브라우저 구현과 동일한 순서
const FX_ORDER: Record<string, number> = {
	eq3: 0,
	gain: 1,
	delay: 2,
	reverb: 3,
};

function orderEffects(effects: AudioEffect[]): AudioEffect[] {
	return [...effects].sort(
		(a, b) => (FX_ORDER[a.kind] ?? 0) - (FX_ORDER[b.kind] ?? 0),
	);
}

function clampDecay(v: number): string {
	return Math.max(0.05, v).toFixed(3);
}

function effectToFilter(effect: AudioEffect): string {
	switch (effect.kind) {
		case "eq3": {
			const { low, mid, high, midFreq = 1000 } = effect;
			const parts: string[] = [];
			if (low !== 0)
				parts.push(`equalizer=f=320:width_type=h:width=200:g=${low}`);
			if (mid !== 0)
				parts.push(`equalizer=f=${midFreq}:width_type=q:width=0.8:g=${mid}`);
			if (high !== 0)
				parts.push(`equalizer=f=3200:width_type=h:width=200:g=${high}`);
			return parts.join(",");
		}
		case "gain":
			return `volume=${effect.db}dB`;
		case "delay": {
			const ms = Math.round(effect.time * 1000);
			return `aecho=in_gain=0.8:out_gain=${effect.wet.toFixed(3)}:delays=${ms}:decays=${effect.feedback.toFixed(3)}`;
		}
		case "reverb": {
			const wet = effect.wet.toFixed(3);
			const d = Math.min(0.98, effect.decay / 10);
			const PRESETS: Record<string, string> = {
				room: `aecho=in_gain=0.8:out_gain=${wet}:delays=20|40|60:decays=${clampDecay(d)}|${clampDecay(d - 0.1)}|${clampDecay(d - 0.2)}`,
				hall: `aecho=in_gain=0.8:out_gain=${wet}:delays=30|80|150:decays=${clampDecay(d)}|${clampDecay(d)}|${clampDecay(d - 0.1)}`,
				plate: `aecho=in_gain=0.8:out_gain=${wet}:delays=10|25|45:decays=${clampDecay(d - 0.1)}|${clampDecay(d - 0.2)}|${clampDecay(d - 0.3)}`,
			};
			return PRESETS[effect.preset] ?? PRESETS.room;
		}
	}
}

/** AudioEffect[] → ffmpeg -af 문자열. 비어있으면 빈 문자열. */
export function buildAudioFilterChain(effects: AudioEffect[]): string {
	return orderEffects(effects)
		.map((e) => effectToFilter(e))
		.filter(Boolean)
		.join(",");
}

/**
 * 단일 오디오 파일에 ffmpeg 이펙트 적용 → outPath 에 저장.
 * HTTP URL 직접 입력 가능 (ffmpeg -i http://...).
 * ffmpeg 미설치 또는 실패 시 false 반환 (caller가 원본 URL 유지).
 */
export async function applyEffectsToAudioUrl(
	audioUrl: string,
	effects: AudioEffect[],
	outPath: string,
): Promise<boolean> {
	const filter = buildAudioFilterChain(effects);
	if (!filter) return false;

	try {
		await execFileAsync(
			"ffmpeg",
			[
				"-y",
				"-i",
				audioUrl,
				"-af",
				filter,
				"-c:a",
				"libmp3lame",
				"-q:a",
				"2", // VBR ~190kbps
				outPath,
			],
			{ timeout: 60_000 },
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * TimelineProject 내 audioEffects 있는 클립을 전처리.
 * 성공한 클립의 audioUrl → serveBaseUrl + 파일명 교체.
 *
 * @param project 원본 프로젝트
 * @param assetDir  전처리 파일 저장 디렉토리 (렌더 큐의 RENDER_ASSET_DIR 하위)
 * @param subDir    assetDir 내 서브 디렉토리명 (jobId 등)
 * @param serveBaseUrl  Remotion에서 접근 가능한 HTTP base URL
 * @returns 업데이트된 project (클립 audioUrl 교체됨)
 */
export async function preprocessProjectAudio(
	project: TimelineProject,
	assetDir: string,
	subDir: string,
	serveBaseUrl: string,
): Promise<TimelineProject> {
	const outDir = join(assetDir, subDir);
	if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

	const updatedClips = await Promise.all(
		project.clips.map(async (clip, idx) => {
			if (!clip.audioUrl || !clip.audioEffects?.length) return clip;

			const filename = `clip-${idx}.mp3`;
			const outPath = join(outDir, filename);
			const ok = await applyEffectsToAudioUrl(
				clip.audioUrl,
				clip.audioEffects,
				outPath,
			);
			if (!ok) return clip;

			const servedUrl = `${serveBaseUrl}/${encodeURIComponent(subDir)}/${encodeURIComponent(filename)}`;
			return { ...clip, audioUrl: servedUrl };
		}),
	);

	return { ...project, clips: updatedClips };
}
