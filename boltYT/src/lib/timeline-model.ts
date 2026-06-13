/**
 * Timeline V2 — 프레임 기반 연속 트랙 모델.
 *
 * V1 (Scene 배열 기반)의 한계:
 *   - 클립 위치 = 선형 누적 (gap/overlap 불가)
 *   - 트랙 고정 3종, 다중 선택 불가, ripple/roll/slip/slide 없음
 *
 * V2 설계:
 *   - Clip = {trackId, startFrame, durationFrames, sourceIn/Out, speed, ...}
 *   - Track = kind/이름/자동화/뮤트/솔로
 *   - 모든 편집 오퍼레이션(ripple, slip, slide, roll, snap)을 pure 함수로
 *
 * 렌더링 시 Scene[] 어댑터(timeline-adapter.ts)로 flatten.
 */

export type ClipKind = "video" | "audio" | "caption" | "title" | "bgm";
export type TrackKind = "video" | "audio" | "subtitle";
export type TransitionKind =
	| "crossfade"
	| "zoom"
	| "slide_left"
	| "slide_right"
	| "glitch"
	| "whip_left"
	| "whip_right"
	| "none";
export type ColorGradePreset =
	| "none"
	| "teal-orange"
	| "warm-film"
	| "cold-noir"
	| "vibrant-pop"
	| "muted-doc"
	| "retro-vhs"
	| "cinematic-bleach"
	| "sunset-glow"
	| "arctic"
	| "k-drama-soft"
	| "true-crime-noir"
	| "nature-doc";

/**
 * Bezier tangent handle (AutomationKeyframe 전용).
 * 정규화 좌표: x 는 0~1 (이 키프레임의 outTangent 는 다음 키프레임 구간에 영향,
 * inTangent 는 이전 구간 끝 쪽에 영향). y 는 (b.value - a.value) 단위 대비 상대 offset (0~1 권장).
 */
export interface BezierTangent {
	x: number;
	y: number;
}

/** 볼륨/팬/Opacity 등 시간축 자동화 (keyframe curve) */
export interface AutomationKeyframe {
	/** 전역 타임라인 프레임 */
	frame: number;
	value: number;
	/** 보간 방식 */
	ease?: "linear" | "hold" | "smooth" | "bezier";
	/** bezier 전용: 이 키프레임 → 다음 키프레임 방향 핸들 */
	outTangent?: BezierTangent;
	/** bezier 전용: 이전 키프레임 → 이 키프레임 방향 핸들 */
	inTangent?: BezierTangent;
}

export interface AutomationCurve {
	/** 기본값 (키프레임 없거나 바깥일 때) */
	default: number;
	keyframes: AutomationKeyframe[];
}

/**
 * Transform 키프레임 — 클립 로컬 프레임 기준 (sourceIn 무관, startFrame 기준 0).
 * 값이 없으면 clip의 static position/scale/rotation/opacity 사용.
 */
export interface TransformKeyframes {
	positionX?: AutomationCurve;
	positionY?: AutomationCurve;
	scale?: AutomationCurve;
	rotation?: AutomationCurve;
	opacity?: AutomationCurve;
}

export type TransformProp =
	| "positionX"
	| "positionY"
	| "scale"
	| "rotation"
	| "opacity";

export interface EffectiveTransform {
	x: number;
	y: number;
	scale: number;
	rotation: number;
	opacity: number;
}

/** 3-way 색보정 (lift/gamma/gain) + 온도/틴트 */
export interface ColorGradeSpec {
	preset?: ColorGradePreset;
	/** -1 ~ 1 각 채널 (shadows) */
	lift?: { r: number; g: number; b: number };
	/** -1 ~ 1 각 채널 (midtones) */
	gamma?: { r: number; g: number; b: number };
	/** -1 ~ 1 각 채널 (highlights) */
	gain?: { r: number; g: number; b: number };
	/** -100 ~ 100 */
	temperature?: number;
	/** -100 ~ 100 */
	tint?: number;
	/** -1 ~ 1 */
	saturation?: number;
	/** 업로드된 LUT 식별자 (ref → WebGL texture cache) */
	lutId?: string;
	/** 0~1 LUT 섞임 강도 */
	lutAmount?: number;
}

export interface TransitionSpec {
	kind: TransitionKind;
	/** 프레임 길이 (0 이상) */
	frames: number;
}

export interface MotionGraphicRef {
	type: string;
	/** Clip 로컬 프레임 (sourceIn 기준 0) */
	startFrame: number;
	duration: number;
	params: Record<string, unknown>;
}

export interface TimelineClip {
	id: string;
	/** 원본 Scene id (어댑터용, nullable for derived clips) */
	sceneId?: string;
	trackId: string;
	kind: ClipKind;

	/** 전역 타임라인 위치 (프레임) */
	startFrame: number;
	/** 타임라인상 길이 (프레임, 트림 후) */
	durationFrames: number;

	/** 미디어 소스 내 In/Out (프레임, 원본 시간) */
	sourceIn: number;
	sourceOut: number;

	/** 미디어 URL */
	mediaUrl?: string;
	imageUrl?: string;
	videoUrl?: string;
	audioUrl?: string;

	/**
	 * 원본 파일 경로 (로컬 file:// 또는 /media/ 경로).
	 * blob: URL 은 탭 재시작 시 무효화되므로 영속 경로를 별도 보관.
	 * blob: / data: src 일 때는 undefined. 재오픈 시 blob 재발급에 사용.
	 */
	storagePath?: string;

	/** 내용 */
	text?: string;
	narration?: string;

	/** 속도 (1.0 = 정상, 0.5 = slow-mo, 2.0 = fast) */
	speed: number;
	reverse: boolean;

	/** 트랜지션 */
	transitionIn?: TransitionSpec;
	transitionOut?: TransitionSpec;

	/** 색보정 */
	colorGrade?: ColorGradeSpec;
	/** 노드 그래프 색보정 (Phase 20) — CSS filter / WebGL shader 로 적용 */
	colorGraph?: import("./color-graph").ColorGraph;

	/** 모션 그래픽 */
	motionGraphics?: MotionGraphicRef[];

	/** Transform */
	opacity: number;
	position: { x: number; y: number };
	scale: number;
	rotation: number;
	/** 프레임별 보간 (Phase 6) — 없으면 static */
	transformKeyframes?: TransformKeyframes;

	/** Audio */
	volume: number;
	muted: boolean;
	/** Clip별 볼륨 엔벨로프 (Phase 2) */
	volumeEnvelope?: AutomationCurve;
	/** Pan -1(L) ~ 1(R) */
	pan?: number;
	panEnvelope?: AutomationCurve;
	/** 오디오 이펙트 체인 (Phase 18) — FX_ORDER 순으로 적용, OfflineAudioContext 렌더 */
	audioEffects?: import("./audio-effects").AudioEffect[];

	/** 멀티캠 바인딩 (Phase 19) — 같은 groupId 내 angle 이 다른 클립은 스위처로 교체 */
	multicam?: import("./multicam").ClipMulticamRef;

	/** 편집자 편의 */
	label?: string;
	color?: string;
	locked: boolean;
	selected: boolean;

	/** v1 호환: scene_type, news_* 등 */
	meta: Record<string, unknown>;
}

export interface TimelineTrack {
	id: string;
	kind: TrackKind;
	name: string;
	/** UI 표시 높이 (px) */
	height: number;

	muted: boolean;
	solo: boolean;
	visible: boolean;
	locked: boolean;

	/** 마스터 볼륨 0~1 (audio 트랙) */
	volume: number;
	/** -1 ~ 1 (audio 트랙) */
	pan: number;
	/** 트랙 레벨 자동화 (Phase 2) */
	volumeAutomation?: AutomationCurve;
	panAutomation?: AutomationCurve;

	/** 트랙 정렬 순서 (낮을수록 위) */
	order: number;
}

export interface TimelineMarker {
	id: string;
	frame: number;
	label: string;
	color?: string;
}

export interface TimelineProject {
	id: string;
	scriptId: string;
	fps: number;
	width: number;
	height: number;

	tracks: TimelineTrack[];
	clips: TimelineClip[];
	markers: TimelineMarker[];

	/** 전역 오디오 */
	bgmUrl?: string;
	/** 미지정·true는 BGM 반복(기존 동작 — 짧은 트랙이 영상 길이를 채움). false일 때만 1회 재생. */
	bgmLoop?: boolean;
	bgmVolume: number;
	narrationUrl?: string;

	/** 비트 그리드 (BGM 분석) */
	bpm: number;
	beats: number[];

	/** 멀티캠 그룹 테이블 (Phase 19) — 클립이 multicam.groupId 로 참조 */
	multicamGroups?: import("./multicam").MulticamGroup[];
}

// ──────────────────────────────────────────────
// Pure edit operations — store에서 호출
// ──────────────────────────────────────────────

export const DEFAULT_FPS = 30;

export function createEmptyProject(
	scriptId: string,
	opts: { fps?: number; width?: number; height?: number } = {},
): TimelineProject {
	return {
		id: `proj-${scriptId}`,
		scriptId,
		fps: opts.fps ?? DEFAULT_FPS,
		width: opts.width ?? 1080,
		height: opts.height ?? 1920,
		tracks: [
			{
				id: "v1",
				kind: "video",
				name: "Video 1",
				height: 70,
				muted: false,
				solo: false,
				visible: true,
				locked: false,
				volume: 1,
				pan: 0,
				order: 0,
			},
			{
				id: "a1",
				kind: "audio",
				name: "Audio 1",
				height: 60,
				muted: false,
				solo: false,
				visible: true,
				locked: false,
				volume: 1,
				pan: 0,
				order: 10,
			},
			{
				id: "s1",
				kind: "subtitle",
				name: "Subtitle",
				height: 36,
				muted: false,
				solo: false,
				visible: true,
				locked: false,
				volume: 1,
				pan: 0,
				order: 20,
			},
		],
		clips: [],
		markers: [],
		bgmVolume: 0.28,
		bpm: 0,
		beats: [],
	};
}

export function endFrameOf(clip: TimelineClip): number {
	return clip.startFrame + clip.durationFrames;
}

export function clipsOnTrack(
	project: TimelineProject,
	trackId: string,
): TimelineClip[] {
	return project.clips
		.filter((c) => c.trackId === trackId)
		.sort((a, b) => a.startFrame - b.startFrame);
}

export function totalDurationFrames(project: TimelineProject): number {
	let max = 0;
	for (const c of project.clips) {
		const end = endFrameOf(c);
		if (end > max) max = end;
	}
	return max;
}

/** 두 클립이 동일 트랙에서 시간 겹치는지 */
export function clipsOverlap(a: TimelineClip, b: TimelineClip): boolean {
	if (a.trackId !== b.trackId) return false;
	return a.startFrame < endFrameOf(b) && b.startFrame < endFrameOf(a);
}

// ──────────────────────────────────────────────
// Magnetic Snap
// ──────────────────────────────────────────────

export interface SnapTargets {
	/** 프레임 좌표 목록 */
	frames: number[];
	/** 스냅 허용 거리 (프레임) */
	threshold: number;
}

export function buildSnapTargets(
	project: TimelineProject,
	opts: {
		includePlayhead?: boolean;
		playhead?: number;
		includeBeats?: boolean;
		includeMarkers?: boolean;
		excludeClipId?: string;
	} = {},
): number[] {
	const targets = new Set<number>();
	// 클립 경계
	for (const c of project.clips) {
		if (opts.excludeClipId && c.id === opts.excludeClipId) continue;
		targets.add(c.startFrame);
		targets.add(endFrameOf(c));
	}
	// 플레이헤드
	if (opts.includePlayhead && opts.playhead !== undefined) {
		targets.add(opts.playhead);
	}
	// 비트 그리드
	if (opts.includeBeats) {
		for (const sec of project.beats) {
			targets.add(Math.round(sec * project.fps));
		}
	}
	// 마커
	if (opts.includeMarkers) {
		for (const m of project.markers) targets.add(m.frame);
	}
	// 0 지점
	targets.add(0);
	return Array.from(targets).sort((a, b) => a - b);
}

export function applySnap(
	frame: number,
	targets: number[],
	threshold: number,
): { frame: number; snapped: boolean; target?: number } {
	if (targets.length === 0) return { frame, snapped: false };
	let best = -1;
	let bestDelta = Number.POSITIVE_INFINITY;
	for (const t of targets) {
		const d = Math.abs(t - frame);
		if (d < bestDelta) {
			bestDelta = d;
			best = t;
		}
	}
	if (best >= 0 && bestDelta <= threshold) {
		return { frame: best, snapped: true, target: best };
	}
	return { frame, snapped: false };
}

// ──────────────────────────────────────────────
// Edit operations (pure — 반환값은 새 project 또는 새 clips[])
// ──────────────────────────────────────────────

function cloneProject(p: TimelineProject): TimelineProject {
	return {
		...p,
		tracks: p.tracks.map((t) => ({ ...t })),
		clips: p.clips.map((c) => ({
			...c,
			position: { ...c.position },
			meta: { ...c.meta },
		})),
		markers: p.markers.map((m) => ({ ...m })),
	};
}

function replaceClip(
	p: TimelineProject,
	clipId: string,
	patch: Partial<TimelineClip>,
): TimelineProject {
	const next = cloneProject(p);
	next.clips = next.clips.map((c) =>
		c.id === clipId ? { ...c, ...patch } : c,
	);
	return next;
}

function replaceClips(
	p: TimelineProject,
	updater: (c: TimelineClip) => TimelineClip,
): TimelineProject {
	const next = cloneProject(p);
	next.clips = next.clips.map(updater);
	return next;
}

/** 클립 이동 — 다른 트랙 가능, 충돌 시 '밀어내기' 없음 (ripple은 별도) */
export function moveClip(
	p: TimelineProject,
	clipId: string,
	toStartFrame: number,
	toTrackId?: string,
): TimelineProject {
	const clip = p.clips.find((c) => c.id === clipId);
	if (!clip) return p;
	return replaceClip(p, clipId, {
		startFrame: Math.max(0, Math.round(toStartFrame)),
		trackId: toTrackId ?? clip.trackId,
	});
}

/** 오른쪽 트림 (out-point 당기기) — durationFrames 줄어듦 */
export function trimRight(
	p: TimelineProject,
	clipId: string,
	deltaFrames: number,
	minFrames = 2,
): TimelineProject {
	const clip = p.clips.find((c) => c.id === clipId);
	if (!clip) return p;
	const newDur = Math.max(minFrames, clip.durationFrames + deltaFrames);
	const newSourceOut = clip.sourceIn + newDur / clip.speed;
	return replaceClip(p, clipId, {
		durationFrames: newDur,
		sourceOut: newSourceOut,
	});
}

/** 왼쪽 트림 (in-point 당기기) — startFrame + sourceIn 동시 변경 */
export function trimLeft(
	p: TimelineProject,
	clipId: string,
	deltaFrames: number,
	minFrames = 2,
): TimelineProject {
	const clip = p.clips.find((c) => c.id === clipId);
	if (!clip) return p;
	// deltaFrames > 0 = 시작을 오른쪽으로 이동 (클립 짧아짐)
	const newDur = Math.max(minFrames, clip.durationFrames - deltaFrames);
	const appliedDelta = clip.durationFrames - newDur;
	const newStart = Math.max(0, clip.startFrame + appliedDelta);
	const newSourceIn = clip.sourceIn + appliedDelta / clip.speed;
	return replaceClip(p, clipId, {
		startFrame: newStart,
		durationFrames: newDur,
		sourceIn: newSourceIn,
	});
}

/** 플레이헤드(전역 프레임)에서 클립 분할 */
export function splitClipAt(
	p: TimelineProject,
	clipId: string,
	atFrame: number,
	genId: () => string = defaultId,
): TimelineProject {
	const clip = p.clips.find((c) => c.id === clipId);
	if (!clip) return p;
	const local = atFrame - clip.startFrame;
	if (local <= 1 || local >= clip.durationFrames - 1) return p;

	const leftDur = local;
	const rightDur = clip.durationFrames - local;
	const sourceSplit = clip.sourceIn + local / clip.speed;

	const left: TimelineClip = {
		...clip,
		durationFrames: leftDur,
		sourceOut: sourceSplit,
	};
	const right: TimelineClip = {
		...clip,
		id: genId(),
		// 새 클립은 새 씬 정체성을 가져야 한다. 그렇지 않으면
		// (a) adapter/preview 가 같은 오디오/씬을 두 곳에서 참조하고
		// (b) 저장 시 동일 scenes.id 에 두 번 UPDATE 되어 뒤 것이 앞 것을 덮는다.
		sceneId: undefined,
		startFrame: clip.startFrame + local,
		durationFrames: rightDur,
		sourceIn: sourceSplit,
		selected: false,
		meta: { ...clip.meta, split_from: clip.sceneId ?? clip.id },
	};
	const next = cloneProject(p);
	next.clips = next.clips.filter((c) => c.id !== clipId).concat(left, right);
	return next;
}

/** 클립 삭제 — gap 유지 */
export function deleteClip(
	p: TimelineProject,
	clipId: string,
): TimelineProject {
	const next = cloneProject(p);
	next.clips = next.clips.filter((c) => c.id !== clipId);
	return next;
}

/** Ripple 삭제 — 뒤따르는 동일 트랙 클립들 좌측 이동 */
export function rippleDelete(
	p: TimelineProject,
	clipId: string,
): TimelineProject {
	const clip = p.clips.find((c) => c.id === clipId);
	if (!clip) return p;
	const shift = clip.durationFrames;
	const trackId = clip.trackId;
	const deleteEnd = endFrameOf(clip);
	const next = cloneProject(p);
	next.clips = next.clips
		.filter((c) => c.id !== clipId)
		.map((c) =>
			c.trackId === trackId && c.startFrame >= deleteEnd
				? { ...c, startFrame: Math.max(0, c.startFrame - shift) }
				: c,
		);
	return next;
}

/** Ripple 삽입 — 삽입 지점 이후 클립들 우측 이동 후 새 클립 추가 */
export function rippleInsert(
	p: TimelineProject,
	newClip: TimelineClip,
): TimelineProject {
	const shift = newClip.durationFrames;
	const next = cloneProject(p);
	next.clips = next.clips.map((c) =>
		c.trackId === newClip.trackId && c.startFrame >= newClip.startFrame
			? { ...c, startFrame: c.startFrame + shift }
			: c,
	);
	next.clips.push(newClip);
	return next;
}

/**
 * Roll 편집 — 두 인접 클립의 공유 경계를 이동.
 * leftClip의 out-point 이동 = rightClip의 in-point 이동.
 */
export function rollEdit(
	p: TimelineProject,
	leftClipId: string,
	rightClipId: string,
	deltaFrames: number,
): TimelineProject {
	const left = p.clips.find((c) => c.id === leftClipId);
	const right = p.clips.find((c) => c.id === rightClipId);
	if (!left || !right) return p;
	if (left.trackId !== right.trackId) return p;
	if (endFrameOf(left) !== right.startFrame) return p; // 인접 아님

	const leftNewDur = Math.max(2, left.durationFrames + deltaFrames);
	const rightNewStart = left.startFrame + leftNewDur;
	const rightNewDur = Math.max(
		2,
		right.durationFrames - (rightNewStart - right.startFrame),
	);

	return replaceClips(p, (c) => {
		if (c.id === leftClipId) {
			return {
				...c,
				durationFrames: leftNewDur,
				sourceOut: c.sourceIn + leftNewDur / c.speed,
			};
		}
		if (c.id === rightClipId) {
			const appliedShift = rightNewStart - right.startFrame;
			return {
				...c,
				startFrame: rightNewStart,
				sourceIn: c.sourceIn + appliedShift / c.speed,
				durationFrames: rightNewDur,
			};
		}
		return c;
	});
}

/**
 * Slip 편집 — 클립 위치/길이 고정, sourceIn/Out만 이동.
 * 소스 미디어 내에서 "어느 구간을 쓸지"만 변경.
 */
export function slipClip(
	p: TimelineProject,
	clipId: string,
	deltaFrames: number,
): TimelineProject {
	const clip = p.clips.find((c) => c.id === clipId);
	if (!clip) return p;
	const d = deltaFrames / clip.speed;
	return replaceClip(p, clipId, {
		sourceIn: Math.max(0, clip.sourceIn + d),
		sourceOut: clip.sourceOut + d,
	});
}

/**
 * Slide 편집 — 클립 이동, 인접 클립들의 길이가 흡수.
 * 동일 트랙에서 이 클립 좌/우 인접 클립이 있어야 함.
 */
export function slideClip(
	p: TimelineProject,
	clipId: string,
	deltaFrames: number,
): TimelineProject {
	const clip = p.clips.find((c) => c.id === clipId);
	if (!clip) return p;
	const trackClips = clipsOnTrack(p, clip.trackId);
	const idx = trackClips.findIndex((c) => c.id === clipId);
	if (idx < 0) return p;
	const prev = trackClips[idx - 1];
	const next = trackClips[idx + 1];

	let applied = deltaFrames;
	if (applied < 0 && prev) {
		// 좌측 최대치 = prev의 2프레임 남을 때까지
		const headroom = -(prev.durationFrames - 2);
		applied = Math.max(headroom, applied);
	}
	if (applied > 0 && next) {
		const headroom = next.durationFrames - 2;
		applied = Math.min(headroom, applied);
	}
	if (applied === 0) return p;

	return replaceClips(p, (c) => {
		if (c.id === clipId) return { ...c, startFrame: c.startFrame + applied };
		if (prev && c.id === prev.id) {
			const newDur = c.durationFrames + applied;
			return {
				...c,
				durationFrames: newDur,
				sourceOut: c.sourceIn + newDur / c.speed,
			};
		}
		if (next && c.id === next.id) {
			const newDur = c.durationFrames - applied;
			return {
				...c,
				startFrame: c.startFrame + applied,
				sourceIn: c.sourceIn + applied / c.speed,
				durationFrames: newDur,
			};
		}
		return c;
	});
}

/** 여러 클립 일괄 이동 */
export function moveClips(
	p: TimelineProject,
	ids: string[],
	deltaFrames: number,
	deltaTrackOffset = 0,
): TimelineProject {
	const idSet = new Set(ids);
	// 트랙 인덱스 맵
	const sortedTracks = [...p.tracks].sort((a, b) => a.order - b.order);
	const trackIndex = new Map(sortedTracks.map((t, i) => [t.id, i]));
	return replaceClips(p, (c) => {
		if (!idSet.has(c.id)) return c;
		const curIdx = trackIndex.get(c.trackId) ?? 0;
		const newIdx = Math.max(
			0,
			Math.min(sortedTracks.length - 1, curIdx + deltaTrackOffset),
		);
		const newTrack = sortedTracks[newIdx];
		// 트랙 종류가 다르면 종류 유지 안 될 수 있음 — 호환 트랙만 이동
		const targetTrackId =
			newTrack.kind === kindToTrackKind(c.kind) ? newTrack.id : c.trackId;
		return {
			...c,
			startFrame: Math.max(0, c.startFrame + deltaFrames),
			trackId: targetTrackId,
		};
	});
}

function kindToTrackKind(kind: ClipKind): TrackKind {
	if (kind === "audio" || kind === "bgm") return "audio";
	if (kind === "caption") return "subtitle";
	return "video";
}

export function toggleSelect(
	p: TimelineProject,
	clipId: string,
	additive = false,
): TimelineProject {
	return replaceClips(p, (c) => {
		if (c.id === clipId) return { ...c, selected: !c.selected };
		if (additive) return c;
		return c.selected ? { ...c, selected: false } : c;
	});
}

export function setSelection(
	p: TimelineProject,
	ids: string[],
): TimelineProject {
	const idSet = new Set(ids);
	return replaceClips(p, (c) =>
		c.selected === idSet.has(c.id) ? c : { ...c, selected: idSet.has(c.id) },
	);
}

export function getSelected(p: TimelineProject): TimelineClip[] {
	return p.clips.filter((c) => c.selected);
}

/**
 * CSS cubic-bezier(x1,y1,x2,y2) 스타일: 시간 t(0-1) → progress (0-1).
 * Newton-Raphson 6회 반복 후 이분법 2회로 역함수 근사.
 */
function cubicBezierProgress(
	t: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;
	const bezX = (u: number) => ((ax * u + bx) * u + cx) * u;
	const bezDX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
	// Newton
	let u = t;
	for (let i = 0; i < 6; i++) {
		const dx = bezX(u) - t;
		const d = bezDX(u);
		if (Math.abs(d) < 1e-6) break;
		u -= dx / d;
	}
	// bisect clamp
	u = Math.max(0, Math.min(1, u));
	return ((ay * u + by) * u + cy) * u;
}

/** 자동화 커브에서 프레임 시점의 값 계산 */
export function evaluateCurve(curve: AutomationCurve, frame: number): number {
	const ks = curve.keyframes;
	if (ks.length === 0) return curve.default;
	if (frame <= ks[0].frame) return ks[0].value;
	if (frame >= ks[ks.length - 1].frame) return ks[ks.length - 1].value;
	for (let i = 0; i < ks.length - 1; i++) {
		const a = ks[i];
		const b = ks[i + 1];
		if (frame >= a.frame && frame <= b.frame) {
			if (a.ease === "hold") return a.value;
			const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
			if (a.ease === "smooth") {
				const s = t * t * (3 - 2 * t);
				return a.value + (b.value - a.value) * s;
			}
			if (a.ease === "bezier") {
				const out = a.outTangent ?? { x: 0.42, y: 0 };
				const inTan = b.inTangent ?? { x: 0.42, y: 0 };
				// P2 = 1 - inTangent (b 기준의 왼쪽 핸들)
				const x1 = Math.max(0, Math.min(1, out.x));
				const y1 = out.y;
				const x2 = Math.max(0, Math.min(1, 1 - inTan.x));
				const y2 = 1 - inTan.y;
				const progress = cubicBezierProgress(t, x1, y1, x2, y2);
				return a.value + (b.value - a.value) * progress;
			}
			return a.value + (b.value - a.value) * t;
		}
	}
	return curve.default;
}

/** 자동화 커브에 키프레임 추가/갱신 */
export function setKeyframe(
	curve: AutomationCurve,
	frame: number,
	value: number,
	ease: AutomationKeyframe["ease"] = "linear",
): AutomationCurve {
	const kfs = curve.keyframes.filter((k) => k.frame !== frame);
	kfs.push({ frame, value, ease });
	kfs.sort((a, b) => a.frame - b.frame);
	return { ...curve, keyframes: kfs };
}

export function removeKeyframe(
	curve: AutomationCurve,
	frame: number,
): AutomationCurve {
	return {
		...curve,
		keyframes: curve.keyframes.filter((k) => k.frame !== frame),
	};
}

// ──────────────────────────────────────────────
// Transform 키프레임 (Phase 6)
// ──────────────────────────────────────────────

function baseValueFor(clip: TimelineClip, prop: TransformProp): number {
	switch (prop) {
		case "positionX":
			return clip.position.x;
		case "positionY":
			return clip.position.y;
		case "scale":
			return clip.scale;
		case "rotation":
			return clip.rotation;
		case "opacity":
			return clip.opacity;
	}
}

/**
 * 저수준: TransformKeyframes + 로컬 프레임 → effective.
 * Scene.tsx 등 TimelineClip 모르는 렌더러가 쓰는 경로.
 * base 가 주어지면 해당 prop에 키프레임이 없을 때 base 값 사용, 없으면 identity.
 */
export function evaluateTransformKeyframes(
	tk: TransformKeyframes | undefined,
	localFrame: number,
	base?: Partial<EffectiveTransform>,
): EffectiveTransform {
	return {
		x: tk?.positionX ? evaluateCurve(tk.positionX, localFrame) : (base?.x ?? 0),
		y: tk?.positionY ? evaluateCurve(tk.positionY, localFrame) : (base?.y ?? 0),
		scale: tk?.scale ? evaluateCurve(tk.scale, localFrame) : (base?.scale ?? 1),
		rotation: tk?.rotation
			? evaluateCurve(tk.rotation, localFrame)
			: (base?.rotation ?? 0),
		opacity: tk?.opacity
			? evaluateCurve(tk.opacity, localFrame)
			: (base?.opacity ?? 1),
	};
}

/** 클립의 프레임별 effective transform 반환. 키프레임 없는 prop은 static 값. */
export function evaluateTransform(
	clip: TimelineClip,
	globalFrame: number,
): EffectiveTransform {
	const local = globalFrame - clip.startFrame;
	return evaluateTransformKeyframes(clip.transformKeyframes, local, {
		x: clip.position.x,
		y: clip.position.y,
		scale: clip.scale,
		rotation: clip.rotation,
		opacity: clip.opacity,
	});
}

/**
 * prop에 키프레임 추가/갱신.
 * 첫 키프레임이고 localFrame > 0 이면 frame 0 에도 base 값을 시딩해서
 * 앞구간이 base 로 유지되도록 한다 (없으면 evaluateCurve 가 첫 키프레임 값으로 clamp).
 */
export function setTransformKeyframe(
	clip: TimelineClip,
	prop: TransformProp,
	localFrame: number,
	value: number,
	ease: AutomationKeyframe["ease"] = "linear",
): TransformKeyframes {
	const tk = clip.transformKeyframes ?? {};
	const base = baseValueFor(clip, prop);
	let curve = tk[prop] ?? { default: base, keyframes: [] };
	if (curve.keyframes.length === 0 && localFrame > 0) {
		curve = setKeyframe(curve, 0, base, ease);
	}
	return { ...tk, [prop]: setKeyframe(curve, localFrame, value, ease) };
}

/** prop의 특정 프레임 키프레임 삭제. 모든 키프레임이 사라지면 해당 prop 커브 제거. */
export function removeTransformKeyframe(
	clip: TimelineClip,
	prop: TransformProp,
	localFrame: number,
): TransformKeyframes | undefined {
	const tk = clip.transformKeyframes;
	if (!tk?.[prop]) return tk;
	const next = removeKeyframe(tk[prop], localFrame);
	if (next.keyframes.length === 0) {
		const rest: TransformKeyframes = { ...tk };
		delete rest[prop];
		return Object.keys(rest).length ? rest : undefined;
	}
	return { ...tk, [prop]: next };
}

/** prop의 모든 키프레임 제거 (reset). */
export function clearTransformProp(
	clip: TimelineClip,
	prop: TransformProp,
): TransformKeyframes | undefined {
	const tk = clip.transformKeyframes;
	if (!tk?.[prop]) return tk;
	const rest: TransformKeyframes = { ...tk };
	delete rest[prop];
	return Object.keys(rest).length ? rest : undefined;
}

/**
 * Motion path (Phase 9) — positionX+Y 동시 키프레임 조작.
 * x, y 커브의 frame 합집합을 "motion knot" 으로 취급. 하나의 knot 드래그 시
 * 같은 frame 의 두 커브가 동시에 갱신.
 */
export interface MotionKnot {
	/** 클립 로컬 프레임 */
	frame: number;
	x: number;
	y: number;
	ease: AutomationKeyframe["ease"];
}

/** 클립의 positionX + positionY 키프레임 frame 합집합을 하나의 MotionKnot 배열로 */
export function getMotionKnots(clip: TimelineClip): MotionKnot[] {
	const tk = clip.transformKeyframes;
	const xKfs = tk?.positionX?.keyframes ?? [];
	const yKfs = tk?.positionY?.keyframes ?? [];
	const frames = new Set<number>();
	for (const k of xKfs) frames.add(k.frame);
	for (const k of yKfs) frames.add(k.frame);
	const sorted = Array.from(frames).sort((a, b) => a - b);
	return sorted.map((f) => ({
		frame: f,
		x: tk?.positionX ? evaluateCurve(tk.positionX, f) : clip.position.x,
		y: tk?.positionY ? evaluateCurve(tk.positionY, f) : clip.position.y,
		ease:
			xKfs.find((k) => k.frame === f)?.ease ??
			yKfs.find((k) => k.frame === f)?.ease ??
			"linear",
	}));
}

/** 특정 localFrame 에 x,y 쌍 키프레임 설정 (둘 다 커브 생성/갱신) */
export function setMotionKnot(
	clip: TimelineClip,
	localFrame: number,
	x: number,
	y: number,
	ease: AutomationKeyframe["ease"] = "linear",
): TransformKeyframes {
	let tk = clip.transformKeyframes ?? {};
	let tempClip = { ...clip, transformKeyframes: tk };
	tk = setTransformKeyframe(tempClip, "positionX", localFrame, x, ease);
	tempClip = { ...tempClip, transformKeyframes: tk };
	tk = setTransformKeyframe(tempClip, "positionY", localFrame, y, ease);
	return tk;
}

/** motion knot 삭제 — x, y 양쪽 커브의 해당 frame 삭제 */
export function removeMotionKnot(
	clip: TimelineClip,
	localFrame: number,
): TransformKeyframes | undefined {
	let tk = clip.transformKeyframes;
	if (!tk) return tk;
	let tempClip = { ...clip, transformKeyframes: tk };
	tk = removeTransformKeyframe(tempClip, "positionX", localFrame) ?? {};
	tempClip = { ...tempClip, transformKeyframes: tk };
	tk = removeTransformKeyframe(tempClip, "positionY", localFrame) ?? {};
	return Object.keys(tk).length ? tk : undefined;
}

/**
 * motion knot 의 bezier tangent 핸들 설정.
 * inTangent / outTangent 는 정규화 오프셋 (0~1 범위 권장).
 * positionX 와 positionY 커브의 해당 frame 키프레임 양쪽에 동시 적용.
 * 해당 frame 의 키프레임이 없으면 no-op.
 */
export function setMotionKnotTangent(
	clip: TimelineClip,
	localFrame: number,
	tangent: { in?: BezierTangent; out?: BezierTangent },
): TransformKeyframes | null {
	const tk = clip.transformKeyframes;
	if (!tk) return null;

	function patchCurve(
		curve: AutomationCurve | undefined,
	): AutomationCurve | undefined {
		if (!curve) return curve;
		const kfIdx = curve.keyframes.findIndex((k) => k.frame === localFrame);
		if (kfIdx < 0) return curve;
		const kf = curve.keyframes[kfIdx];
		const patched: AutomationKeyframe = {
			...kf,
			...(tangent.in !== undefined ? { inTangent: tangent.in } : {}),
			...(tangent.out !== undefined ? { outTangent: tangent.out } : {}),
		};
		const kfs = [...curve.keyframes];
		kfs[kfIdx] = patched;
		return { ...curve, keyframes: kfs };
	}

	const nextX = patchCurve(tk.positionX);
	const nextY = patchCurve(tk.positionY);
	// 양쪽 커브 모두 해당 frame 없으면 변경 없음
	if (nextX === tk.positionX && nextY === tk.positionY) return null;
	return {
		...tk,
		...(nextX !== tk.positionX ? { positionX: nextX } : {}),
		...(nextY !== tk.positionY ? { positionY: nextY } : {}),
	};
}

let _idCounter = 0;
function defaultId(): string {
	_idCounter += 1;
	return `clip-${Date.now()}-${_idCounter}`;
}

export function newClipId(): string {
	return defaultId();
}
