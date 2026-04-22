/**
 * 저해상도 프록시 생성 유틸.
 *
 * 용도: 4K/1080p 원본 → 720p proxy (에디터 프리뷰 반응성 ↑).
 * 규약: 원본 `<dir>/<name>.<ext>` 옆에 `<dir>/<name>.proxy.mp4` 로 저장.
 * 풀해상도 렌더 시에는 원본을 사용 — proxy 는 프리뷰 전용.
 */

import { existsSync, statSync } from "node:fs";
import { dirname, extname, join, sep } from "node:path";

export interface ProxyOptions {
	/** 짧은 변 기준 목표 해상도 (기본 720) */
	height?: number;
	/** 오디오 제거 (프리뷰 전용) */
	mute?: boolean;
	/** CRF (품질 낮춰도 OK, 기본 30) */
	crf?: number;
	/** preset (기본 veryfast — proxy 는 속도 우선) */
	preset?:
		| "ultrafast"
		| "superfast"
		| "veryfast"
		| "faster"
		| "fast"
		| "medium";
}

export const DEFAULT_PROXY_OPTIONS: Required<ProxyOptions> = {
	height: 720,
	mute: false,
	crf: 30,
	preset: "veryfast",
};

/** 원본 경로 → proxy 경로 (같은 디렉토리, `.proxy.mp4` suffix). */
export function proxyPathFor(originalPath: string): string {
	const dir = dirname(originalPath);
	const ext = extname(originalPath);
	const base = originalPath.slice(
		dir.length + 1,
		originalPath.length - ext.length,
	);
	return join(dir, `${base}.proxy.mp4`);
}

/** 파일 존재 + 크기 > 0 검사 (빈 파일이면 실패한 프록시로 간주). */
export function hasValidProxy(originalPath: string): boolean {
	const p = proxyPathFor(originalPath);
	if (!existsSync(p)) return false;
	try {
		return statSync(p).size > 0;
	} catch {
		return false;
	}
}

/**
 * 경로 allowlist 검사 — realpath 해소된 경로가 허용 루트 중 하나의 직계 하위인지 확인.
 * 정확한 경계 체크: root === path 이거나 path 가 root + sep 으로 시작해야 OK.
 * (`/foo/barx` 가 `/foo/bar` 를 prefix 하는 우회 차단)
 */
export function isPathInAllowedRoots(
	realPath: string,
	allowedRoots: string[],
): boolean {
	for (const root of allowedRoots) {
		if (realPath === root) return true;
		if (realPath.startsWith(root + sep)) return true;
	}
	return false;
}

/**
 * ffmpeg 인자 조립 (순수). execFile 은 호출자가 수행.
 * - 짧은 변이 target 이하면 원본 유지 (filter 는 min(iw,ih,height))
 * - h264 (VideoToolbox/NVENC 는 proxy 목적상 품질 이득 작아 software 고정)
 */
export function buildProxyArgs(
	inputPath: string,
	outputPath: string,
	opts: ProxyOptions = {},
): string[] {
	const o = { ...DEFAULT_PROXY_OPTIONS, ...opts };
	const args: string[] = [
		"-y",
		"-i",
		inputPath,
		"-vf",
		`scale=-2:'min(${o.height},ih)':flags=lanczos`,
		"-c:v",
		"libx264",
		"-preset",
		o.preset,
		"-crf",
		String(o.crf),
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
	];
	if (o.mute) {
		args.push("-an");
	} else {
		args.push("-c:a", "aac", "-b:a", "96k");
	}
	args.push(outputPath);
	return args;
}
