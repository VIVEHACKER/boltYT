/**
 * 무료 로컬 Remotion 렌더 — make-vlog 산출물(씬별 이미지 + 내레이션 오디오 + 텍스트)을
 * 앱의 실제 프로덕션 컴포지션(YouTubeVideo / YouTubeShorts)으로 렌더한다.
 *
 * 이게 ffmpeg 슬라이드쇼와 다른 점(= "일반적인 AI 영상" 수준에 도달하는 이유):
 *   - 동적 자막(chunked, narration → generateWordTimings 자동) — React 렌더라 libass 불필요
 *   - 씬 전환(crossfade/slide/zoom/light_leak) + Ken Burns(SceneView 내장)
 *   - BGM 덕킹(나레이션 구간 자동 -, public/sfx/dark-ambient.mp3 기본)
 *   - Supabase 불필요(render-video.ts와 달리 로컬 파일만 사용)
 *
 * 에셋 전달: programmatic bundle()의 publicDir 서빙이 불안정해 404 가 나므로,
 * 임시 정적 HTTP 서버로 에셋·BGM 을 직접 서빙하고 http URL 로 컴포지션에 주입한다
 * (render-video.ts 가 Supabase publicUrl 을 쓰는 것과 동일 원리). 렌더 후 정리.
 */
import {
	copyFileSync,
	createReadStream,
	mkdtempSync,
	rmSync,
	statSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { resolveMemoryRenderOptions } from "../src/lib/render-options.ts";
import type {
	SceneShot,
	SceneShotMotion,
} from "../src/lib/scene-shot-types.ts";
import type { SubtitleBgStyle } from "../src/remotion/Composition.tsx";
import { getOverlapFrames } from "../src/remotion/timing.ts";
import type { RemotionScene, TransitionType } from "../src/remotion/types.ts";
import { floatEnv, freeComfy, posIntEnv } from "./vlog-shared.ts";

const FPS = 30;
// 중간 프레임 JPEG 품질(기본 100). Remotion 기본 80 은 h264 인코딩 전 이중 압축이라
// 그라데이션/텍스트 디테일이 손실된다(레버 C). 100 은 속도 거의 그대로 손실만 제거.
const JPEG_QUALITY = Math.min(100, posIntEnv("JPEG_QUALITY", 100));
// 렌더 배율(기본 1). RENDER_SCALE=2 → 1920x1080 컴포지션을 4K 로 업샘플 렌더(레버 D, 렌더 시간↑).
const RENDER_SCALE = Math.min(4, floatEnv("RENDER_SCALE", 1));
/**
 * 씬 최소 프레임(1.5s). 두 가지를 동시에 보장한다:
 *  1) make-vlog 의 ffprobe dur() 하한(1.5s)과 일치 → 자연스러운 내레이션 최소 길이.
 *  2) BGM edgeFade inputRange [0,30,fadeOutStart,lastFrame] 가 단조 증가하려면
 *     총 프레임 ≥ 33 이어야 함(VideoComposition). 단일 씬도 45 ≥ 33 으로 안전.
 */
const MIN_SCENE_FRAMES = 45;
/** 씬마다 다른 전환으로 단조로움 제거(첫 씬은 전환 없음). */
const TRANSITION_ROTATION: TransitionType[] = [
	"crossfade",
	"slide_left",
	"zoom",
	"light_leak",
	"push_left",
	"crossfade",
];

const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
};

export interface VlogSceneInput {
	/** 로컬 절대 파일 경로 또는 http URL */
	imageUrl: string;
	/** i2v 모션 클립(mp4) 로컬 경로/URL. 있으면 정지컷 대신 이 클립을 씬에 렌더(Scene.tsx hasVideo 분기).
	 *  생성원은 자유(fal.ai i2v / 로컬 AnimateDiff·Wan). 미지정 씬은 기존 정지컷 그대로 — 혼용 자동. */
	videoUrl?: string;
	audioUrl: string;
	narration: string;
	durationSec: number;
	/** 컷별 카메라무빙(shot-plan 배정 → camera-movements remotionMotionFor 근사값).
	 *  있으면 씬 전체를 커버하는 단일 SceneShot 으로 배선 — Scene.tsx computeShotMotion 이
	 *  shot.motion 을 쓰고, Ken Burns 자동 휴리스틱(!shot 폴백)은 진입 불가가 된다(이중 적용 방지).
	 *  미지정 씬은 기존 KB 휴리스틱 그대로 — 혼용 자동. */
	cameraMove?: SceneShotMotion;
}

/**
 * cameraMove → 씬 전체 단일 SceneShot 변환.
 * 단일 샷은 buildShotTimeline(shot-timing.ts) 의 sequentialTimeline 이 [0, durationInFrames)
 * 를 빈틈없이 커버 → useActiveShot 이 모든 프레임에서 shot 을 반환 → computeShotMotion 의
 * KB 폴백 분기(Scene.tsx `if (!shot)`)에 절대 진입하지 않는다 = KB 스킵 구조적 보장.
 */
function cameraMoveShot(
	motion: SceneShotMotion,
	sceneIndex: number,
	durationSec: number,
): SceneShot {
	return {
		id: `cam-${sceneIndex}`,
		// "context" = micro-edit(kindPulseParams/kindMicroTransform) 중립 default 분기 —
		// 카메라무빙 외 펄스/이펙트 파라미터를 바꾸지 않는다.
		kind: "context",
		// 단일 샷은 scaledShotDurations 가 어차피 씬 전체로 스케일 — 값은 문서용(씬 오디오 길이).
		duration_seconds: Math.max(1.5, durationSec),
		motion,
		// "full" = getShotScale default(baseScale 그대로, 추가 줌 없음). 정지컷 경로는
		// objectFit "cover" 하드코딩(Scene.tsx DefaultSceneView)이라 레터박스 부작용도 없음.
		crop: "full",
	};
}

/**
 * 순수 매핑: VlogSceneInput[] → RemotionScene[].
 * (렌더 부수효과와 분리해 단위 테스트 가능하게 둔다.)
 *
 * 전환 오버랩 보정(Codex P1): VideoComposition 은 인접 씬을 transition 만큼 오버랩하고,
 * getSceneAudioWindow 가 내레이션을 seam(오버랩 중간점)으로 클램프한다. 씬 길이를 오디오와
 * 같게 두면 내레이션 꼬리가 잘리고(≈오버랩 절반) 총 길이가 Σ오버랩만큼 짧아져 .srt 가 어긋난다.
 * → 각 씬을 incoming/outgoing 반오버랩만큼 패딩하면:
 *   (a) 오디오 윈도 == 원본 오디오 길이 → 내레이션 무클립,
 *   (b) 총 길이 == Σ(오디오 프레임) → make-vlog 의 누적초 .srt 와 동기.
 */
export function buildVlogRemotionScenes(
	inputs: VlogSceneInput[],
): RemotionScene[] {
	// 1) 베이스 씬 — durationInFrames 는 우선 오디오 길이(패딩 전). 오버랩 계산에 transition 필요.
	const scenes: RemotionScene[] = inputs.map((s, i) => ({
		imageUrl: s.imageUrl,
		// i2v 클립 있으면 통과 + type="video" → SceneView 가 VideoSceneView(scene.videoUrl)로 렌더.
		// (type 안 바꾸면 DefaultSceneView 가 정지컷만 그려 클립이 무시됨 — Codex.) durationInFrames 는
		// 오디오 길이 그대로라 .srt/오버랩 동기 무변경(클립이 짧으면 Remotion 이 루프/홀드).
		videoUrl: s.videoUrl,
		// 카메라무빙 배선 — cameraMove 미지정이면 키 자체를 만들지 않아 기존 출력 형태 100% 불변.
		...(s.cameraMove
			? { shots: [cameraMoveShot(s.cameraMove, i, s.durationSec)] }
			: {}),
		audioUrl: s.audioUrl,
		narration: s.narration,
		durationInFrames: Math.max(
			MIN_SCENE_FRAMES,
			Math.ceil(s.durationSec * FPS),
		),
		type: (s.videoUrl ? "video" : "image") as "video" | "image",
		transition: (i === 0
			? "none"
			: TRANSITION_ROTATION[i % TRANSITION_ROTATION.length]) as TransitionType,
		mood: "neutral" as const,
		hookBoost: i === 0,
		colorGrade: "warm-film" as const,
	}));
	// 2) 전환 오버랩 패딩. inOverlap=getOverlapFrames(현재 씬), outOverlap=getOverlapFrames(다음 씬)
	//    — VideoComposition/getSceneAudioWindow 가 쓰는 것과 동일한 함수라 계산이 정확히 일치한다.
	return scenes.map((scene, i) => {
		const inOverlap = getOverlapFrames(scene);
		const outOverlap =
			i < scenes.length - 1 ? getOverlapFrames(scenes[i + 1]) : 0;
		return {
			...scene,
			durationInFrames:
				scene.durationInFrames +
				Math.ceil(inOverlap / 2) +
				Math.floor(outOverlap / 2),
		};
	});
}

/** 요청 경로가 정적 루트 밖으로 탈출하지 않을 때만 절대 경로를 반환한다. */
export function resolveStaticAssetPath(
	rootDir: string,
	requestPath: string,
): string | null {
	const root = resolve(rootDir);
	const relative = requestPath.replace(/^\/+/, "");
	const candidate = resolve(root, relative);
	return candidate === root || candidate.startsWith(`${root}${sep}`)
		? candidate
		: null;
}

/** 단일 디렉토리를 정적 서빙하는 throwaway HTTP 서버(127.0.0.1, 랜덤 포트). */
function startStaticServer(
	rootDir: string,
): Promise<{ origin: string; close: () => Promise<void> }> {
	const server = createServer((req, res) => {
		let rel = "";
		try {
			rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
		} catch {
			res.writeHead(400);
			res.end("bad request");
			return;
		}
		const file = resolveStaticAssetPath(rootDir, rel);
		if (!file) {
			res.writeHead(403);
			res.end();
			return;
		}
		try {
			const st = statSync(file);
			if (!st.isFile()) throw new Error("not file");
			res.writeHead(200, {
				"Content-Type": MIME[extname(file)] ?? "application/octet-stream",
				"Content-Length": String(st.size),
			});
			createReadStream(file).pipe(res);
		} catch {
			res.writeHead(404);
			res.end("not found");
		}
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			resolve({
				origin: `http://127.0.0.1:${port}`,
				close: () => new Promise<void>((r) => server.close(() => r())),
			});
		});
	});
}

export interface RenderVlogOpts {
	/** imageUrl/audioUrl = 로컬 절대 파일 경로 */
	scenes: VlogSceneInput[];
	outPath: string;
	/** boltYT 루트(src/remotion/index.ts + public/ 포함) */
	projectRoot: string;
	compositionId?: "YouTubeVideo" | "YouTubeShorts";
	/** public 기준 BGM 경로. 기본 무료 번들 트랙. */
	bgmRelPath?: string;
	/** 임시 서빙 디렉토리 prefix 식별용 */
	runId: string;
	onProgress?: (pct: number) => void;
	/** 인트로 타이틀 카드(롱폼). backgroundUrl 은 첫 씬 이미지로 자동 설정. */
	intro?: { title: string; subtitle?: string; channelName?: string };
	/** 아웃트로 엔드 카드(롱폼). */
	outro?: { channelName?: string; ctaText?: string };
	/** 자막 배경 스타일. 기본은 기존 동작 유지(pill). */
	subtitleBgStyle?: SubtitleBgStyle;
	/** 자막(내레이션 오버레이) 끄기. 텍스트가 이미 이미지에 구워진 카드형 씬용(senior-money).
	 *  기본 false — 기존 파이프라인(스톡/일러스트 씬)은 자막 그대로. .srt 사이드카는 무관. */
	noSubtitle?: boolean;
}

export async function renderVlogRemotion(
	opts: RenderVlogOpts,
): Promise<string> {
	const { scenes, outPath, projectRoot, runId } = opts;
	const compositionId = opts.compositionId ?? "YouTubeVideo";
	const bgmRelPath = opts.bgmRelPath ?? "sfx/dark-ambient.mp3";

	// 1) 에셋 + BGM 을 임시 디렉토리로 모아 정적 서빙
	const serveDir = mkdtempSync(join(tmpdir(), `vlog-${runId}-`));
	const server = await startStaticServer(serveDir);

	try {
		const served: VlogSceneInput[] = scenes.map((s, i) => {
			copyFileSync(s.imageUrl, join(serveDir, `scene${i}.png`));
			copyFileSync(s.audioUrl, join(serveDir, `scene${i}.mp3`));
			// i2v 클립: 원격 URL(fal.ai 등 http/https)은 그대로 통과(Remotion 이 직접 로드),
			// 로컬 파일만 임시 HTTP 경로로 서빙(publicDir 404 회피, MIME .mp4 존재). copyFileSync 를
			// 원격 URL 에 쓰면 throw 하므로 분기(Codex).
			let videoUrl: string | undefined;
			if (s.videoUrl) {
				if (/^https?:\/\//i.test(s.videoUrl)) {
					videoUrl = s.videoUrl;
				} else {
					copyFileSync(s.videoUrl, join(serveDir, `scene${i}.mp4`));
					videoUrl = `${server.origin}/scene${i}.mp4`;
				}
			}
			return {
				...s,
				imageUrl: `${server.origin}/scene${i}.png`,
				audioUrl: `${server.origin}/scene${i}.mp3`,
				videoUrl,
			};
		});

		let bgmUrl: string | undefined;
		const bgmSrc = join(projectRoot, "public", bgmRelPath);
		try {
			copyFileSync(bgmSrc, join(serveDir, "bgm.mp3"));
			bgmUrl = `${server.origin}/bgm.mp3`;
		} catch {
			bgmUrl = undefined; // BGM 없으면 음성만(렌더는 계속)
		}

		const remotionScenes = buildVlogRemotionScenes(served);
		const inputProps = {
			scenes: remotionScenes,
			captionStyle: (opts.noSubtitle ? "none" : "chunked") as
				| "none"
				| "chunked",
			subtitlePosition: "bottom" as const,
			subtitleBgStyle: opts.subtitleBgStyle ?? ("pill" as const),
			subtitleAccentColor: "#FFD700",
			bgmUrl,
			bgmLoop: true,
			// 카드는 롱폼(YouTubeVideo) 전용. Shorts 컴포지션은 calculateTotalFrames(scenes)로
			// scene-only 총프레임을 잡으므로 카드가 들어가면 길이 불일치로 잘린다(Codex P2) → 무시.
			// 제공 시 calculateTotalFrames 가 인트로/아웃트로 길이를 자동 가산.
			intro:
				compositionId === "YouTubeVideo" && opts.intro
					? { ...opts.intro, backgroundUrl: served[0]?.imageUrl }
					: undefined,
			outro: compositionId === "YouTubeVideo" ? opts.outro : undefined,
		};

		// SDXL/IPAdapter(ComfyUI) 상주 RAM 을 렌더 전에 회수 — 확산 모델과 Remotion 렌더러가
		// 한 프로세스에서 동시 상주("몰아서")하지 않도록 단계 분리. best-effort(서버 없으면 무시).
		await freeComfy();

		// 2) 번들 + 컴포지션 선택(calculateMetadata 가 총 프레임 계산)
		const bundled = await bundle({
			entryPoint: join(projectRoot, "src/remotion/index.ts"),
			webpackOverride: (c) => c,
		});
		const composition = await selectComposition({
			serveUrl: bundled,
			id: compositionId,
			inputProps,
		});

		// 3) 렌더(자막은 React 로 그려지므로 libass 불필요)
		await renderMedia({
			// RAM 상한(concurrency / offthread·media 캐시) — 렌더 단계 피크 메모리 억제.
			...resolveMemoryRenderOptions(),
			composition,
			serveUrl: bundled,
			codec: "h264",
			crf: 18,
			jpegQuality: JPEG_QUALITY,
			scale: RENDER_SCALE,
			outputLocation: outPath,
			inputProps,
			onProgress: ({ progress }) =>
				opts.onProgress?.(Math.round(progress * 100)),
		});
		return outPath;
	} finally {
		await server.close();
		rmSync(serveDir, { recursive: true, force: true });
	}
}
