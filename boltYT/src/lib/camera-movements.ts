/**
 * 카메라 무빙 프롬프트 모듈 — aicameramovements.com 표준 45+개 무빙.
 *
 * 원천: docs/camera-movements-source.md (id|카테고리|이름|영문 표준 프롬프트 전문).
 * 용도:
 *  1) i2vPrompt — i2v(이미지→영상) 생성 시 그대로 붙이는 표준 무빙 문장.
 *  2) remotionMotion — 정지컷 렌더러(Remotion)가 표현 가능한 SceneShotMotion 근사 매핑.
 *  3) assignCameraMoves — 컷 목록에 결정적(시드 PRNG)으로 무빙 배정.
 *
 * 순수 로직 — 부수효과/외부의존 없음(테스트 가능). Math.random/Date 사용 금지.
 */

import type { SceneShotMotion } from "./scene-shot-types";

export type CameraMoveCategory =
	| "pan-tilt"
	| "zoom"
	| "dolly"
	| "physical"
	| "human"
	| "drone"
	| "special";

export interface CameraMove {
	id: string;
	category: CameraMoveCategory;
	name: string;
	/** i2v 생성용 영문 표준 프롬프트 전문(Movement/Speed/Framing/End 구조). */
	i2vPrompt: string;
	/** 정지컷 렌더러 근사 매핑 — 기존 SceneShotMotion union 값만 사용(확장 금지). */
	remotionMotion: SceneShotMotion;
}

/** 원천 데이터 전수 등록(누락 없이). 순서는 원천 문서와 동일. */
export const CAMERA_MOVES: CameraMove[] = [
	// ── Pan/Tilt ──────────────────────────────────────────────────────────────
	{
		id: "static",
		category: "pan-tilt",
		name: "Static shot",
		i2vPrompt:
			"locked-off static shot. Movement: hold one fixed camera position for the full clip. Speed: still and steady. Framing: keep the same angle, height, lens distance and composition. End: finish with the same framing and camera position.",
		remotionMotion: "static",
	},
	{
		id: "pan-right",
		category: "pan-tilt",
		name: "Pan right",
		i2vPrompt:
			"pan right. Movement: rotate the camera horizontally from left to right from one fixed point. Speed: smooth constant rotation. Framing: keep the horizon level while new space enters from the right side of the frame. End: settle on a clear final composition.",
		remotionMotion: "pan_right",
	},
	{
		id: "pan-left",
		category: "pan-tilt",
		name: "Pan left",
		i2vPrompt:
			"pan left. Movement: rotate the camera horizontally from right to left from one fixed point. Speed: smooth constant rotation. Framing: keep the horizon level while new space enters from the left side of the frame. End: settle on a clear final composition.",
		remotionMotion: "pan_left",
	},
	{
		id: "whip-pan-right",
		category: "pan-tilt",
		name: "Whip pan right",
		i2vPrompt:
			"whip pan right. Movement: rotate rapidly from the starting direction toward a new target on the right. Speed: fast snap with brief motion blur during the rotation. Framing: begin on one readable composition and land on a second readable target. End: settle into a sharp final frame.",
		remotionMotion: "pan_right",
	},
	{
		id: "whip-pan-left",
		category: "pan-tilt",
		name: "Whip pan left",
		i2vPrompt:
			"whip pan left. Movement: rotate rapidly from the starting direction toward a new target on the left. Speed: fast snap with brief motion blur during the rotation. Framing: begin on one readable composition and land on a second readable target. End: settle into a sharp final frame.",
		remotionMotion: "pan_left",
	},
	{
		id: "tilt-up",
		category: "pan-tilt",
		name: "Tilt up",
		i2vPrompt:
			"tilt up. Movement: rotate the camera upward from one fixed point. Speed: smooth constant tilt. Framing: keep the vertical subject or architecture centered as the frame travels upward. End: land on the upper target.",
		remotionMotion: "drift",
	},
	{
		id: "tilt-down",
		category: "pan-tilt",
		name: "Tilt down",
		i2vPrompt:
			"tilt down. Movement: rotate the camera downward from one fixed point. Speed: smooth constant tilt. Framing: keep the vertical subject or architecture centered as the frame travels downward. End: land on the lower target.",
		remotionMotion: "drift",
	},
	// ── Zoom/Lens ────────────────────────────────────────────────────────────
	{
		id: "slow-zoom-in",
		category: "zoom",
		name: "Slow zoom in",
		i2vPrompt:
			"slow zoom in. Movement: slowly increase lens focal length toward a tighter frame. Speed: gradual and even. Framing: keep the main visual target readable as it becomes larger in frame. End: finish on a stable tighter composition.",
		remotionMotion: "slow_zoom_in",
	},
	{
		id: "slow-zoom-out",
		category: "zoom",
		name: "Slow zoom out",
		i2vPrompt:
			"slow zoom out. Movement: slowly decrease lens focal length toward a wider frame. Speed: gradual and even. Framing: keep the main visual target readable as more surrounding space appears. End: finish on a stable wider composition.",
		remotionMotion: "slow_zoom_out",
	},
	{
		id: "fast-zoom-in",
		category: "zoom",
		name: "Fast zoom in",
		i2vPrompt:
			"fast zoom in. Movement: quickly increase lens focal length toward the main visual target. Speed: quick decisive zoom. Framing: keep the target centered or clearly readable during the scale change. End: finish on a stable tighter composition.",
		remotionMotion: "push_in",
	},
	{
		id: "fast-zoom-out",
		category: "zoom",
		name: "Fast zoom out",
		i2vPrompt:
			"fast zoom out. Movement: quickly decrease lens focal length away from the main visual target. Speed: quick decisive zoom. Framing: keep the target readable as the surrounding space appears. End: finish on a stable wider composition.",
		remotionMotion: "slow_zoom_out",
	},
	{
		id: "crash-zoom-in",
		category: "zoom",
		name: "Crash zoom in",
		i2vPrompt:
			"crash zoom in. Movement: snap the lens rapidly toward the main visual target. Speed: very fast and punchy. Framing: keep the target readable through the sudden scale change. End: land on a bold tighter composition.",
		remotionMotion: "push_in",
	},
	{
		id: "crash-zoom-out",
		category: "zoom",
		name: "Crash zoom out",
		i2vPrompt:
			"crash zoom out. Movement: snap the lens rapidly away from the main visual target. Speed: very fast and punchy. Framing: keep the target readable as the surrounding space appears. End: land on a bold wider composition.",
		remotionMotion: "slow_zoom_out",
	},
	// ── Dolly/Track ──────────────────────────────────────────────────────────
	{
		id: "dolly-in",
		category: "dolly",
		name: "Dolly in",
		i2vPrompt:
			"dolly in. Movement: move the camera physically forward in a straight line toward the main subject. Speed: smooth controlled push. Framing: keep camera height, lens direction and subject position consistent while distance closes. End: finish in a tighter composition.",
		remotionMotion: "push_in",
	},
	{
		id: "dolly-out",
		category: "dolly",
		name: "Dolly out",
		i2vPrompt:
			"dolly out. Movement: move the camera physically backward in a straight line away from the main subject. Speed: smooth controlled retreat. Framing: keep lens direction and camera height consistent while more environment enters frame. End: finish in a wider composition.",
		remotionMotion: "slow_zoom_out",
	},
	{
		id: "tracking",
		category: "dolly",
		name: "Tracking shot",
		i2vPrompt:
			"tracking shot. Movement: move through the scene with the main subject. Speed: match the subject's pace. Framing: keep the subject consistently readable while the environment moves around them. End: maintain a clear moving composition.",
		remotionMotion: "pan_right",
	},
	{
		id: "follow-behind",
		category: "dolly",
		name: "Follow shot",
		i2vPrompt:
			"follow shot from behind. Movement: move behind the subject along their route at shoulder height. Speed: match the subject's pace. Framing: keep the back, shoulder or head as the foreground guide while the route ahead stays readable. End: continue following with the subject leading the frame.",
		remotionMotion: "push_in",
	},
	{
		id: "reverse-tracking",
		category: "dolly",
		name: "Reverse tracking",
		i2vPrompt:
			"reverse tracking shot. Movement: move backward in front of the walking subject. Speed: match the subject's forward pace. Framing: keep front-facing face and body framing stable as the background moves behind them. End: hold a clear front-facing moving composition.",
		remotionMotion: "slow_zoom_out",
	},
	{
		id: "side-tracking",
		category: "dolly",
		name: "Side tracking",
		i2vPrompt:
			"side tracking shot. Movement: move parallel beside the subject along their direction of travel. Speed: match the subject's motion. Framing: keep the subject in side profile or three-quarter profile at a stable distance. End: continue the parallel movement with clear horizontal motion.",
		remotionMotion: "pan_right",
	},
	{
		id: "low-tracking",
		category: "dolly",
		name: "Low tracking",
		i2vPrompt:
			"low tracking shot. Movement: move at ground or below-waist height alongside the subject's movement path. Speed: match the subject, footsteps or wheels. Framing: keep the low detail readable while the ground plane moves through frame. End: finish with the low perspective clearly maintained.",
		remotionMotion: "pan_right",
	},
	{
		id: "vehicle-tracking",
		category: "dolly",
		name: "Vehicle tracking",
		i2vPrompt:
			"vehicle tracking shot. Movement: move with the vehicle along its route. Speed: match the vehicle's pace. Framing: keep the vehicle stable in frame while the road or environment moves past. End: maintain a clear moving vehicle composition.",
		remotionMotion: "pan_right",
	},
	{
		id: "chase",
		category: "dolly",
		name: "Chase shot",
		i2vPrompt:
			"chase shot. Movement: follow a moving subject quickly along the action route. Speed: fast, reactive and physically close. Framing: keep the subject visible while allowing energetic reframing. End: stay connected to the subject in motion.",
		remotionMotion: "push_in",
	},
	// ── Physical Moves ───────────────────────────────────────────────────────
	{
		id: "truck-right",
		category: "physical",
		name: "Truck right",
		i2vPrompt:
			"truck right. Movement: move the camera physically to the right on a straight horizontal path. Speed: smooth constant lateral travel. Framing: keep the lens facing the same direction while the scene slides across frame. End: finish on a clean lateral composition.",
		remotionMotion: "pan_right",
	},
	{
		id: "truck-left",
		category: "physical",
		name: "Truck left",
		i2vPrompt:
			"truck left. Movement: move the camera physically to the left on a straight horizontal path. Speed: smooth constant lateral travel. Framing: keep the lens facing the same direction while the scene slides across frame. End: finish on a clean lateral composition.",
		remotionMotion: "pan_left",
	},
	{
		id: "pedestal-up",
		category: "physical",
		name: "Pedestal up",
		i2vPrompt:
			"pedestal up. Movement: move the entire camera vertically upward in a straight line. Speed: smooth constant lift. Framing: keep the lens level and pointed in the same direction during the vertical move. End: finish with the higher framing clearly readable.",
		remotionMotion: "drift",
	},
	{
		id: "pedestal-down",
		category: "physical",
		name: "Pedestal down",
		i2vPrompt:
			"pedestal down. Movement: move the entire camera vertically downward in a straight line. Speed: smooth constant descent. Framing: keep the lens level and pointed in the same direction during the vertical move. End: finish with the lower framing clearly readable.",
		remotionMotion: "drift",
	},
	{
		id: "slider-right",
		category: "physical",
		name: "Slider right",
		i2vPrompt:
			"slider right. Movement: slide the camera a small distance to the right. Speed: slow controlled constant motion. Framing: keep foreground, subject and background layers readable as parallax shifts. End: finish on a refined composition with the new right-side angle visible.",
		remotionMotion: "pan_right",
	},
	{
		id: "slider-left",
		category: "physical",
		name: "Slider left",
		i2vPrompt:
			"slider left. Movement: slide the camera a small distance to the left. Speed: slow controlled constant motion. Framing: keep foreground, subject and background layers readable as parallax shifts. End: finish on a refined composition with the new left-side angle visible.",
		remotionMotion: "pan_left",
	},
	{
		id: "push-past",
		category: "physical",
		name: "Push past",
		i2vPrompt:
			"push past. Movement: move forward past a visible foreground object, edge or opening. Speed: smooth forward glide. Framing: let the foreground pass close to the lens while the space beyond becomes clearer. End: arrive inside or beyond the foreground layer.",
		remotionMotion: "push_in",
	},
	{
		id: "arc-right",
		category: "physical",
		name: "Arc right",
		i2vPrompt:
			"arc right. Movement: move on a shallow curved path around the main subject toward the right side. Speed: smooth measured curve. Framing: keep distance, height and subject readability consistent while the angle changes. End: finish from a new right-side angle.",
		remotionMotion: "pan_right",
	},
	{
		id: "arc-left",
		category: "physical",
		name: "Arc left",
		i2vPrompt:
			"arc left. Movement: move on a shallow curved path around the main subject toward the left side. Speed: smooth measured curve. Framing: keep distance, height and subject readability consistent while the angle changes. End: finish from a new left-side angle.",
		remotionMotion: "pan_left",
	},
	{
		id: "orbit-cw",
		category: "physical",
		name: "Orbit clockwise",
		i2vPrompt:
			"clockwise orbit. Movement: circle clockwise around the main subject at a consistent radius. Speed: smooth controlled orbit. Framing: keep the subject centered while the background rotates around them. End: complete the intended arc or full circle with stable framing.",
		remotionMotion: "pan_right",
	},
	{
		id: "orbit-ccw",
		category: "physical",
		name: "Orbit counterclockwise",
		i2vPrompt:
			"counterclockwise orbit. Movement: circle counterclockwise around the main subject at a consistent radius. Speed: smooth controlled orbit. Framing: keep the subject centered while the background rotates around them. End: complete the intended arc or full circle with stable framing.",
		remotionMotion: "pan_left",
	},
	// ── Human Camera ─────────────────────────────────────────────────────────
	{
		id: "handheld",
		category: "human",
		name: "Handheld",
		i2vPrompt:
			"handheld shot. Movement: hold the camera at human operator height with natural body movement. Speed: responsive and organic. Framing: keep the subject readable while the frame has subtle sway and micro-adjustments. End: finish with a natural handheld composition.",
		remotionMotion: "drift",
	},
	{
		id: "snorricam",
		category: "human",
		name: "Snorricam",
		i2vPrompt:
			"body-mounted Snorricam. Movement: keep the camera fixed relative to the subject's torso or face while the subject moves. Speed: match the subject's body motion. Framing: keep the subject close, centered and facing the camera as the background moves around them. End: finish with the subject still locked in frame.",
		remotionMotion: "drift",
	},
	// ── Drone/Crane ──────────────────────────────────────────────────────────
	{
		id: "crane-up",
		category: "drone",
		name: "Crane up",
		i2vPrompt:
			"crane up. Movement: travel smoothly upward through open space. Speed: slow controlled vertical lift. Framing: keep the subject or location readable as the camera rises. End: finish with the higher scale clearly visible.",
		remotionMotion: "drift",
	},
	{
		id: "crane-down",
		category: "drone",
		name: "Crane down",
		i2vPrompt:
			"crane down. Movement: travel smoothly downward through open space. Speed: slow controlled vertical descent. Framing: keep the subject or location readable as the camera descends. End: finish with the lower subject or destination clearly visible.",
		remotionMotion: "drift",
	},
	{
		id: "drone-push-in",
		category: "drone",
		name: "Drone push in",
		i2vPrompt:
			"drone push in. Movement: fly smoothly forward through open space toward the subject or destination. Speed: controlled aerial glide. Framing: keep the route and destination readable as the camera approaches. End: arrive at a closer aerial composition.",
		remotionMotion: "push_in",
	},
	{
		id: "drone-pull-back",
		category: "drone",
		name: "Drone pull back",
		i2vPrompt:
			"drone pull back. Movement: fly smoothly backward away from the subject or destination. Speed: controlled aerial retreat. Framing: keep the subject readable as more landscape appears. End: finish on a wider aerial composition.",
		remotionMotion: "slow_zoom_out",
	},
	{
		id: "helicopter",
		category: "drone",
		name: "Helicopter shot",
		i2vPrompt:
			"helicopter-style aerial shot. Movement: move from high altitude along a broad gradual flight path. Speed: steady controlled aerial motion. Framing: keep the landscape or distant moving subject readable at wide scale. End: finish on a stable high-altitude composition.",
		remotionMotion: "drift",
	},
	// ── Specials ─────────────────────────────────────────────────────────────
	{
		id: "fpv",
		category: "special",
		name: "First-person view",
		i2vPrompt:
			"first-person view. Movement: move forward at human eye height from the character's perspective. Speed: natural walking or reaching pace. Framing: use visible hands, arms or body edges as the viewer's physical reference. End: arrive at the next point of action from the same point of view.",
		remotionMotion: "push_in",
	},
	{
		id: "tilt-shift",
		category: "special",
		name: "Tilt-shift",
		i2vPrompt:
			"tilt-shift miniature view. Movement: hold or glide from a high angled view over the scene. Speed: small precise movement. Framing: keep a narrow band of sharp focus across the key subject area with soft blur above and below. End: finish with the miniature-scale view intact.",
		remotionMotion: "static",
	},
	{
		id: "infinite-zoom",
		category: "special",
		name: "Infinite zoom",
		i2vPrompt:
			"infinite zoom. Movement: zoom continuously inward toward the exact center target. Speed: smooth accelerating zoom. Framing: keep the circular target centered as it expands. End: finish when the next visual world fills the frame.",
		remotionMotion: "slow_zoom_in",
	},
	{
		id: "earth-zoom-out",
		category: "special",
		name: "Earth zoom out",
		i2vPrompt:
			"earth zoom out. Movement: pull upward from the starting point through street, city, landscape and planet scale. Speed: rapid expanding zoom out. Framing: keep the original location centered as scale grows. End: finish on a planet-scale view with the starting point still implied at center.",
		remotionMotion: "slow_zoom_out",
	},
	{
		id: "time-lapse",
		category: "special",
		name: "Time-lapse",
		i2vPrompt:
			"locked-camera time-lapse. Movement: hold one fixed camera position while time moves rapidly forward. Speed: fast time compression with a stable camera. Framing: keep the same composition and horizon as motion passes through the frame. End: finish from the same camera angle with visible passage of time.",
		remotionMotion: "static",
	},
	{
		id: "pass-through",
		category: "special",
		name: "Pass-through",
		i2vPrompt:
			"pass-through movement. Movement: move forward toward a visible object, surface or barrier and continue into the space beyond. Speed: smooth centered glide. Framing: keep the opening or surface centered as the transition point. End: arrive inside the revealed space beyond.",
		remotionMotion: "push_in",
	},
];

/** id → CameraMove 인덱스(모듈 로드 시 1회 구축). */
const MOVE_BY_ID: ReadonlyMap<string, CameraMove> = new Map(
	CAMERA_MOVES.map((m) => [m.id, m]),
);

export function getCameraMove(id: string): CameraMove | undefined {
	return MOVE_BY_ID.get(id);
}

/** 미지 id → static 프롬프트 폴백(파이프라인 무중단). */
export function i2vPromptFor(id: string): string {
	return (MOVE_BY_ID.get(id) ?? (MOVE_BY_ID.get("static") as CameraMove))
		.i2vPrompt;
}

/** 미지 id → "static" 모션 폴백. */
export function remotionMotionFor(id: string): SceneShotMotion {
	return MOVE_BY_ID.get(id)?.remotionMotion ?? "static";
}

// ── 결정적 배정(assignCameraMoves) ───────────────────────────────────────────

/** 훅 컷용 punchy 계열 — 시선을 붙잡는 급격한 인/스냅. */
const PUNCHY_POOL = [
	"crash-zoom-in",
	"fast-zoom-in",
	"whip-pan-right",
	"whip-pan-left",
] as const;

/** 8초+ a-roll(긴 설명 구간)용 — 느린 zoom/pan 계열(시청 피로 최소). */
const SLOW_POOL = [
	"slow-zoom-in",
	"slow-zoom-out",
	"pan-right",
	"pan-left",
] as const;

/** b-roll용 — pan/truck/tilt/slider 로 좌우·상하 다양화. */
const BROLL_POOL = [
	"pan-right",
	"pan-left",
	"truck-right",
	"truck-left",
	"tilt-up",
	"tilt-down",
	"slider-right",
	"slider-left",
] as const;

/** 짧은 a-roll용 일반 풀 — 전진감 위주 + 좌우 변화. */
const AROLL_SHORT_POOL = [
	"dolly-in",
	"slow-zoom-in",
	"fast-zoom-in",
	"push-past",
	"pan-right",
	"pan-left",
	"arc-right",
	"arc-left",
	"handheld",
] as const;

/** drone/special 양념 풀 — 전체의 ~10% 이하로만 등장. */
const ACCENT_POOL = [
	"crane-up",
	"crane-down",
	"drone-push-in",
	"drone-pull-back",
	"helicopter",
	"fpv",
	"tilt-shift",
	"infinite-zoom",
	"earth-zoom-out",
	"time-lapse",
	"pass-through",
] as const;

/** 양념(drone/special) 허용 비율 상한. */
const ACCENT_RATIO = 0.1;

/** 문자열 seed → 32bit 해시(xmur3 축약형). */
function hashSeed(seed: string): number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	h = Math.imul(h ^ (h >>> 16), 2246822507);
	h = Math.imul(h ^ (h >>> 13), 3266489909);
	return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 시드 PRNG — 동일 seed → 동일 수열(결정성). */
function mulberry32(a: number): () => number {
	let state = a >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface AssignCut {
	purpose: "a-roll" | "b-roll";
	expectedSec: number;
}

export interface AssignCameraMovesOpts {
	/** 결정성 시드 — 동일 seed+cuts → 항상 동일 배정. */
	seed: string;
	/** 훅 컷 index(punchy 계열 강제). */
	hookIndex?: number;
}

/**
 * 컷 목록 → 무빙 id 배열(컷당 정확히 1개).
 * 규칙: 연속 동일 무빙 금지 / hookIndex=punchy / 8초+ a-roll=slow 계열 /
 *       b-roll=pan·truck·tilt·slider 다양화 / drone·special=~10% 이하 양념 / 후보 없으면 "static".
 */
export function assignCameraMoves(
	cuts: AssignCut[],
	opts: AssignCameraMovesOpts,
): string[] {
	const result: string[] = [];
	// 양념 상한: floor(n×10%) — n<10 이면 0개(저빈도 보장)
	let accentBudget = Math.floor(cuts.length * ACCENT_RATIO);

	for (let i = 0; i < cuts.length; i++) {
		const cut = cuts[i];
		const prev = result[i - 1];
		// 컷별 독립 RNG(seed:index) — 한 컷의 길이/분기 변화가 다른 컷 배정을 흔들지 않게(재생성 국소성).
		// 단일 스트림이면 앞 컷 expectedSec 이 8s 경계를 넘나들 때 뒤 컷 전부 재추첨됨(Codex 적대 리뷰).
		const rand = mulberry32(hashSeed(`${opts.seed}:${i}`));
		let pool: readonly string[];

		if (i === opts.hookIndex) {
			pool = PUNCHY_POOL;
		} else if (cut.purpose === "a-roll" && cut.expectedSec >= 8) {
			pool = SLOW_POOL;
		} else if (accentBudget > 0 && rand() < ACCENT_RATIO) {
			pool = ACCENT_POOL;
			accentBudget--;
		} else {
			pool = cut.purpose === "b-roll" ? BROLL_POOL : AROLL_SHORT_POOL;
		}

		// 연속 중복 금지 — 직전 컷과 같은 id 제외
		const candidates = pool.filter((id) => id !== prev);
		let pick: string;
		if (candidates.length > 0) {
			pick = candidates[Math.floor(rand() * candidates.length)];
		} else {
			// 후보 없음 → static 폴백(직전이 static 이면 slow-zoom-in 으로 중복 회피)
			pick = prev === "static" ? "slow-zoom-in" : "static";
		}
		result.push(pick);
	}
	return result;
}
