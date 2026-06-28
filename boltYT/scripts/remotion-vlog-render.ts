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
import { extname, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { getOverlapFrames } from "../src/remotion/timing.ts";
import type { RemotionScene, TransitionType } from "../src/remotion/types.ts";
import { floatEnv, posIntEnv } from "./vlog-shared.ts";

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
	audioUrl: string;
	narration: string;
	durationSec: number;
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
		audioUrl: s.audioUrl,
		narration: s.narration,
		durationInFrames: Math.max(
			MIN_SCENE_FRAMES,
			Math.ceil(s.durationSec * FPS),
		),
		type: "image" as const,
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

/** 단일 디렉토리를 정적 서빙하는 throwaway HTTP 서버(127.0.0.1, 랜덤 포트). */
function startStaticServer(
	rootDir: string,
): Promise<{ origin: string; close: () => Promise<void> }> {
	const server = createServer((req, res) => {
		const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
		const file = join(rootDir, rel);
		if (!file.startsWith(rootDir)) {
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
			return {
				...s,
				imageUrl: `${server.origin}/scene${i}.png`,
				audioUrl: `${server.origin}/scene${i}.mp3`,
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
			captionStyle: "chunked" as const,
			subtitlePosition: "bottom" as const,
			subtitleBgStyle: "pill" as const,
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
