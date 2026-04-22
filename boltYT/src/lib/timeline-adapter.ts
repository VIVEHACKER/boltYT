/**
 * Scene[] ↔ TimelineProject 어댑터.
 *
 * Auto-generation 흐름은 Scene 배열을 만든다.
 * Timeline V2 에디터는 TimelineProject 를 편집한다.
 * 렌더링(Remotion)은 Scene 배열을 소비한다.
 *
 *   fromScenes: Scene[] → TimelineProject (에디터 로드 시)
 *   toScenes:   TimelineProject → Scene[] (렌더/저장 시)
 */

import type { RemotionScene } from "../remotion/types";
import type { Scene } from "../types/database";
import { compileColorGraphToCss } from "./color-graph-css";
import type { TimelineScene } from "./editor-store";
import {
	type AutomationCurve,
	clipsOnTrack,
	createEmptyProject,
	newClipId,
	type TimelineClip,
	type TimelineProject,
	type TransformKeyframes,
} from "./timeline-model";

const FPS = 30;

/** 재발급 가능한 로컬 서버 경로 여부 (blob/data/http 제외) */
function localServerPath(url?: string): string | undefined {
	if (!url) return undefined;
	if (
		url.startsWith("blob:") ||
		url.startsWith("data:") ||
		url.startsWith("http")
	)
		return undefined;
	return url;
}

function secondsToFrames(seconds: number): number {
	return Math.max(1, Math.round(seconds * FPS));
}

function framesToSeconds(frames: number): number {
	return Number((frames / FPS).toFixed(3));
}

function defaultTransitionFrames(transition?: string): number {
	switch (transition) {
		case "crossfade":
			return 15;
		case "zoom":
			return 20;
		case "slide_left":
		case "slide_right":
			return 15;
		case "glitch":
			return 8;
		case "whip_left":
		case "whip_right":
			return 5;
		default:
			return 0;
	}
}

/**
 * TimelineScene[] (기존 스토어 타입) → TimelineProject.
 * start_frame 이 명시돼 있으면 존중, 아니면 순차 배치.
 */
export function fromScenes(
	scenes: TimelineScene[],
	opts: {
		scriptId: string;
		fps?: number;
		width?: number;
		height?: number;
		bpm?: number;
		beats?: number[];
		bgmUrl?: string;
	},
): TimelineProject {
	const project = createEmptyProject(opts.scriptId, {
		fps: opts.fps ?? FPS,
		width: opts.width,
		height: opts.height,
	});
	project.bpm = opts.bpm ?? 0;
	project.beats = opts.beats ?? [];
	project.bgmUrl = opts.bgmUrl;

	const clips: TimelineClip[] = [];
	let running = 0;

	for (let i = 0; i < scenes.length; i++) {
		const s = scenes[i];
		const explicitStart =
			typeof s.start_frame === "number" && s.start_frame > 0
				? (s.start_frame as number)
				: running;
		const duration = secondsToFrames(s.duration_seconds);

		const ek = s.edit_keyframes ?? {};
		const transformKeyframes = (ek.transformKeyframes ?? undefined) as
			| TransformKeyframes
			| undefined;
		const volumeEnvelope = (ek.volumeEnvelope ?? undefined) as
			| AutomationCurve
			| undefined;

		// Video clip (이미지/영상/텍스트 강조)
		const videoClip: TimelineClip = {
			id: newClipId(),
			sceneId: s.id,
			trackId: "v1",
			kind: "video",
			startFrame: explicitStart,
			durationFrames: duration,
			sourceIn: ek.sourceIn ?? 0,
			sourceOut: ek.sourceOut ?? duration,
			imageUrl: s.imageUrl,
			videoUrl: s.videoUrl,
			storagePath: localServerPath(s.videoUrl) ?? localServerPath(s.imageUrl),
			narration: s.narration_text,
			speed: ek.speed ?? 1,
			reverse: false,
			transitionIn:
				s.transition && s.transition !== "none"
					? {
							kind: s.transition as TimelineClip["transitionIn"] extends infer T
								? T extends { kind: infer K }
									? K
									: never
								: never,
							frames: defaultTransitionFrames(s.transition),
						}
					: undefined,
			colorGrade: s.color_grade
				? {
						preset: s.color_grade as
							| "none"
							| "teal-orange"
							| "warm-film"
							| "cold-noir"
							| "vibrant-pop"
							| "muted-doc"
							| "retro-vhs",
					}
				: undefined,
			motionGraphics: Array.isArray(s.motion_graphics)
				? (s.motion_graphics as TimelineClip["motionGraphics"])
				: undefined,
			opacity: ek.opacity ?? 1,
			position: { x: 0, y: 0 },
			scale: ek.scale ?? 1,
			rotation: 0,
			transformKeyframes,
			volume: ek.volume ?? 1,
			muted: false,
			volumeEnvelope,
			locked: false,
			selected: false,
			label: s.narration_text?.slice(0, 30),
			meta: {
				scene_type: s.scene_type,
				source_index: s.source_index,
				source_url: s.source_url,
				news_title: s.news_title,
				news_source: s.news_source,
				news_excerpt: s.news_excerpt,
				news_date: s.news_date,
				mood: s.mood,
				text_effect: s.text_effect,
				word_timings: s.word_timings,
				shots: s.shots,
				order_index: s.order_index,
			},
		};
		clips.push(videoClip);

		// Audio clip (narration)
		if (s.audioUrl) {
			clips.push({
				id: newClipId(),
				sceneId: s.id,
				trackId: "a1",
				kind: "audio",
				startFrame: explicitStart,
				durationFrames: duration,
				sourceIn: 0,
				sourceOut: duration,
				audioUrl: s.audioUrl,
				storagePath: localServerPath(s.audioUrl),
				narration: s.narration_text,
				speed: 1,
				reverse: false,
				opacity: 1,
				position: { x: 0, y: 0 },
				scale: 1,
				rotation: 0,
				volume: 1,
				muted: false,
				locked: false,
				selected: false,
				label: s.narration_text?.slice(0, 30),
				meta: { narration_for_scene: s.id },
			});
		}

		// Subtitle clip
		if (s.narration_text) {
			clips.push({
				id: newClipId(),
				sceneId: s.id,
				trackId: "s1",
				kind: "caption",
				startFrame: explicitStart,
				durationFrames: duration,
				sourceIn: 0,
				sourceOut: duration,
				text: s.narration_text,
				speed: 1,
				reverse: false,
				opacity: 1,
				position: { x: 0, y: 0 },
				scale: 1,
				rotation: 0,
				volume: 1,
				muted: false,
				locked: false,
				selected: false,
				meta: { word_timings: s.word_timings },
			});
		}

		running = explicitStart + duration;
	}

	project.clips = clips;
	return project;
}

export interface SceneRecordPlan {
	/** DB 에 존재하던 씬(사용자가 새로 추가하지 않은) → UPDATE 대상 */
	update: Partial<Scene>[];
	/** 신규 생성/분할로 만들어진 씬(sceneId 없음) → INSERT 대상 */
	insert: Partial<Scene>[];
}

/**
 * TimelineProject → Scene DML 플랜 (update / insert).
 *
 * 규칙:
 *   - video 트랙(v1) 클립 하나 = Scene 레코드 하나
 *   - sceneId 있음 → update (기존 DB 행 갱신)
 *   - sceneId 없음 → insert (split/add 로 새로 생긴 씬)
 *   - audio/subtitle 은 video 와 sceneId 로 연동되나 저장은 scenes 테이블만
 */
export function toScenes(project: TimelineProject): SceneRecordPlan {
	const videoClips = clipsOnTrack(project, "v1");
	const update: Partial<Scene>[] = [];
	const insert: Partial<Scene>[] = [];
	for (let i = 0; i < videoClips.length; i++) {
		const c = videoClips[i];
		const record: Partial<Scene> = {
			script_id: project.scriptId,
			order_index: i,
			narration_text: (c.narration ?? c.text ?? "") as string,
			scene_type: (c.meta.scene_type as Scene["scene_type"]) ?? "image",
			visual_prompt: "",
			duration_seconds: framesToSeconds(c.durationFrames),
			start_frame: c.startFrame,
			source_index: c.meta.source_index as number | undefined,
			source_url: c.meta.source_url as string | undefined,
			news_title: c.meta.news_title as string | undefined,
			news_source: c.meta.news_source as string | undefined,
			news_excerpt: c.meta.news_excerpt as string | undefined,
			news_date: c.meta.news_date as string | undefined,
			word_timings: c.meta.word_timings as Scene["word_timings"],
			shots: c.meta.shots as Scene["shots"],
			motion_graphics: c.motionGraphics as Scene["motion_graphics"],
			color_grade: (c.colorGrade?.preset ?? "none") as Scene["color_grade"],
			transition: (c.transitionIn?.kind ?? "crossfade") as Scene["transition"],
			mood: c.meta.mood as Scene["mood"],
			text_effect: c.meta.text_effect as Scene["text_effect"],
			edit_keyframes: {
				sourceIn: c.sourceIn,
				sourceOut: c.sourceOut,
				speed: c.speed,
				volume: c.volume,
				opacity: c.opacity,
				scale: c.scale,
				volumeEnvelope: c.volumeEnvelope,
				transformKeyframes: c.transformKeyframes,
			},
		};
		if (c.sceneId) {
			update.push({ id: c.sceneId, ...record });
		} else {
			insert.push(record);
		}
	}
	return { update, insert };
}

/** 현재 프로젝트에 살아있는 sceneId 집합 — 삭제 대상 계산에 사용 */
export function existingSceneIds(project: TimelineProject): string[] {
	const videoClips = clipsOnTrack(project, "v1");
	return videoClips
		.map((c) => c.sceneId)
		.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * TimelineProject → RemotionScene[] (렌더링용).
 *
 * 이미 있던 Remotion Composition 은 Scene 배열을 기대한다.
 * 타임라인 갭은 검은 씬으로 채워 렌더 일관성 유지.
 */
export function toRemotionScenes(project: TimelineProject): RemotionScene[] {
	const videoClips = clipsOnTrack(project, "v1");
	if (videoClips.length === 0) return [];

	const audioByScene = new Map<string, TimelineClip>();
	for (const c of project.clips) {
		if (c.kind === "audio" && c.sceneId) audioByScene.set(c.sceneId, c);
	}

	const result: RemotionScene[] = [];
	let lastEnd = 0;
	for (const c of videoClips) {
		// 갭 = 검은 Scene 삽입
		if (c.startFrame > lastEnd) {
			const gap = c.startFrame - lastEnd;
			result.push({
				imageUrl: "",
				audioUrl: "",
				narration: "",
				durationInFrames: gap,
				type: "text_emphasis",
				transition: "none",
			});
		}
		const aud = c.sceneId ? audioByScene.get(c.sceneId) : undefined;
		result.push({
			imageUrl: c.imageUrl ?? "",
			videoUrl: c.videoUrl,
			audioUrl: aud?.audioUrl ?? "",
			narration: (c.narration ?? c.text ?? "") as string,
			durationInFrames: c.durationFrames,
			type: ((c.meta.scene_type as RemotionScene["type"]) ??
				"image") as RemotionScene["type"],
			newsTitle: c.meta.news_title as string | undefined,
			newsSource: c.meta.news_source as string | undefined,
			newsExcerpt: c.meta.news_excerpt as string | undefined,
			newsDate: c.meta.news_date as string | undefined,
			transition: (c.transitionIn?.kind ??
				"crossfade") as RemotionScene["transition"],
			mood: c.meta.mood as RemotionScene["mood"],
			textEffect: c.meta.text_effect as RemotionScene["textEffect"],
			wordTimings: c.meta.word_timings as RemotionScene["wordTimings"],
			shots: c.meta.shots as RemotionScene["shots"],
			motionGraphics: c.motionGraphics as RemotionScene["motionGraphics"],
			colorGrade: c.colorGrade?.preset as RemotionScene["colorGrade"],
			colorGraphCss: c.colorGraph
				? compileColorGraphToCss(c.colorGraph).css
				: undefined,
			transformKeyframes: c.transformKeyframes,
		});
		lastEnd = c.startFrame + c.durationFrames;
	}
	return result;
}
