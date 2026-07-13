import { describe, expect, it } from "vitest";
import { buildShotTimeline } from "../src/remotion/shot-timing.ts";
import {
	buildSceneTimeline,
	getOverlapFrames,
} from "../src/remotion/timing.ts";
import {
	buildVlogRemotionScenes,
	resolveStaticAssetPath,
} from "./remotion-vlog-render.ts";

const FPS = 30;
const MIN_SCENE_FRAMES = 45;
/** 패딩 전 "오디오 프레임" — buildVlogRemotionScenes 의 베이스 길이와 동일 규칙. */
const audioFrames = (d: number) =>
	Math.max(MIN_SCENE_FRAMES, Math.ceil(d * FPS));

/** calculateTotalFrames(Composition) 와 동일: Σdur − Σ(i≥1) 오버랩. */
const totalFrames = (scenes: ReturnType<typeof buildVlogRemotionScenes>) => {
	let overlap = 0;
	for (let i = 1; i < scenes.length; i++)
		overlap += getOverlapFrames(scenes[i]);
	return scenes.reduce((s, sc) => s + sc.durationInFrames, 0) - overlap;
};

describe("buildVlogRemotionScenes", () => {
	const inputs = [
		{ imageUrl: "a.png", audioUrl: "a.mp3", narration: "씬1", durationSec: 3 },
		{
			imageUrl: "b.png",
			audioUrl: "b.mp3",
			narration: "씬2",
			durationSec: 4.5,
		},
		{ imageUrl: "c.png", audioUrl: "c.mp3", narration: "씬3", durationSec: 2 },
	];

	it("패딩은 오디오 길이를 절대 줄이지 않는다(durationInFrames ≥ 오디오 프레임)", () => {
		const out = buildVlogRemotionScenes(inputs);
		out.forEach((s, i) => {
			expect(s.durationInFrames).toBeGreaterThanOrEqual(
				audioFrames(inputs[i].durationSec),
			);
		});
	});

	it("i2v videoUrl 통과 — 모션 씬만 videoUrl, 정지컷 씬은 undefined(혼용)", () => {
		const out = buildVlogRemotionScenes([
			{
				imageUrl: "a.png",
				audioUrl: "a.mp3",
				narration: "씬1",
				durationSec: 3,
				videoUrl: "a.mp4",
			},
			{
				imageUrl: "b.png",
				audioUrl: "b.mp3",
				narration: "씬2",
				durationSec: 2,
			},
		]);
		expect(out[0].videoUrl).toBe("a.mp4"); // 모션 씬
		expect(out[0].type).toBe("video"); // → VideoSceneView 렌더(type 안 바꾸면 정지컷만, Codex)
		expect(out[1].videoUrl).toBeUndefined(); // 정지컷 씬 무영향
		expect(out[1].type).toBe("image");
		// videoUrl 이 durationInFrames(오디오 동기)에 영향 주지 않음
		expect(out[0].durationInFrames).toBeGreaterThanOrEqual(audioFrames(3));
	});

	it("최소 씬 프레임 45(1.5s) — 0초·짧은 씬도 클램프", () => {
		const out = buildVlogRemotionScenes([
			{ imageUrl: "x.png", audioUrl: "x.mp3", narration: "x", durationSec: 0 },
		]);
		// 단일 씬은 오버랩 없음 → 패딩 0 → 정확히 floor
		expect(out[0].durationInFrames).toBe(MIN_SCENE_FRAMES);
	});

	it("P2: 단일 짧은 씬도 총 프레임 ≥ 33 (BGM edgeFade inputRange 단조 보장)", () => {
		const out = buildVlogRemotionScenes([
			{
				imageUrl: "x.png",
				audioUrl: "x.mp3",
				narration: "x",
				durationSec: 0.2,
			},
		]);
		expect(totalFrames(out)).toBeGreaterThanOrEqual(33);
	});

	it("P1-동기: 총 영상 길이 == Σ(오디오 프레임) → .srt(누적초)와 동기", () => {
		const out = buildVlogRemotionScenes(inputs);
		const expected = inputs.reduce((s, i) => s + audioFrames(i.durationSec), 0);
		expect(totalFrames(out)).toBe(expected);
	});

	it("P1-무클립: 각 씬 오디오 윈도 == 원본 오디오 길이(내레이션 꼬리 안 잘림)", () => {
		const out = buildVlogRemotionScenes(inputs);
		const timeline = buildSceneTimeline(out, 0, totalFrames(out));
		timeline.forEach((seg, i) => {
			expect(seg.audioTo - seg.audioFrom).toBe(
				audioFrames(inputs[i].durationSec),
			);
		});
	});

	it("첫 씬은 전환 없음+hookBoost, 이후 씬은 전환 부여", () => {
		const out = buildVlogRemotionScenes(inputs);
		expect(out[0].transition).toBe("none");
		expect(out[0].hookBoost).toBe(true);
		expect(out[1].transition).not.toBe("none");
		expect(out[2].transition).not.toBe("none");
		expect(out[1].hookBoost).toBe(false);
	});

	it("이미지/오디오/내레이션을 그대로 매핑하고 type=image", () => {
		const out = buildVlogRemotionScenes(inputs);
		expect(out[0].imageUrl).toBe("a.png");
		expect(out[0].audioUrl).toBe("a.mp3");
		expect(out[0].narration).toBe("씬1");
		expect(out.every((s) => s.type === "image")).toBe(true);
	});

	it("빈 입력은 빈 배열", () => {
		expect(buildVlogRemotionScenes([])).toEqual([]);
	});

	it("cameraMove 통과 — 지정 씬만 shots:[{motion, crop:'full'}], 미지정 씬은 undefined(혼용)", () => {
		const out = buildVlogRemotionScenes([
			{
				imageUrl: "a.png",
				audioUrl: "a.mp3",
				narration: "씬1",
				durationSec: 3,
				cameraMove: "pan_left",
			},
			{
				imageUrl: "b.png",
				audioUrl: "b.mp3",
				narration: "씬2",
				durationSec: 2,
			},
		]);
		expect(out[0].shots).toHaveLength(1);
		expect(out[0].shots?.[0].motion).toBe("pan_left"); // 카메라무빙 씬
		expect(out[0].shots?.[0].crop).toBe("full"); // 추가 줌 없음(getShotScale default)
		expect(out[1].shots).toBeUndefined(); // 미지정 씬 무영향(KB 휴리스틱 유지)
		// cameraMove 가 durationInFrames(오디오 동기)에 영향 주지 않음
		expect(out[0].durationInFrames).toBeGreaterThanOrEqual(audioFrames(3));
	});

	it("KB 스킵 — 단일 샷이 씬 전 프레임을 빈틈없이 커버(computeShotMotion !shot 폴백 진입 불가)", () => {
		const out = buildVlogRemotionScenes([
			{
				imageUrl: "a.png",
				audioUrl: "a.mp3",
				narration: "씬1",
				durationSec: 3,
				cameraMove: "slow_zoom_in",
			},
		]);
		// Scene.tsx useActiveShot 과 동일 함수/입력으로 타임라인 재구성 — 렌더 경로 등가 검증.
		const timeline = buildShotTimeline(out[0].shots, out[0].durationInFrames);
		expect(timeline).toHaveLength(1);
		expect(timeline[0].from).toBe(0);
		// 전 프레임 커버 → 모든 프레임에서 shot 반환 → Ken Burns 폴백(!shot 분기) 이중 적용 불가
		expect(timeline[0].durationInFrames).toBe(out[0].durationInFrames);
	});

	it("cameraMove 미지정 시 기존 출력 완전 불변 — shots 키 자체가 없음(스냅샷 동형)", () => {
		const out = buildVlogRemotionScenes(inputs);
		for (const s of out) {
			expect("shots" in s).toBe(false); // 키 부재 = deep-equal 스냅샷까지 불변
		}
	});
});

describe("resolveStaticAssetPath", () => {
	it("정적 루트 안의 정상 자산만 해석", () => {
		expect(resolveStaticAssetPath("/tmp/vlog-assets", "/scene0.png")).toBe(
			"/tmp/vlog-assets/scene0.png",
		);
	});

	it("상위 디렉터리와 prefix 유사 경로 탈출을 차단", () => {
		expect(
			resolveStaticAssetPath("/tmp/vlog-assets", "/../vlog-assets2/key.txt"),
		).toBeNull();
		expect(
			resolveStaticAssetPath("/tmp/vlog-assets", "/../../etc/passwd"),
		).toBeNull();
	});
});
