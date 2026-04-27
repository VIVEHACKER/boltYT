/**
 * Curated BGM Library — mood별 자주 쓰는 BGM 카탈로그
 *
 * 전략:
 * 1. LOCAL_PRESETS: `public/bgm/<mood>/default.mp3` 파일 존재 시 최우선 사용
 *    — 사용자가 가장 자주 쓰는 BGM을 이 경로에 드롭해두면 자동 선택됨
 * 2. PIXABAY_QUERIES: mood별로 "인기 트랙"을 잘 뽑아오는 검증된 검색어
 *    — Pixabay에서 order=popular + editors_choice로 상위 1개 자동 선택
 *
 * 확장: 사용자가 BGM 업로드하면 `custom_bgm_<mood>` 로컬스토리지에 저장해
 *       LOCAL_PRESETS보다 우선 사용 (getUserDefaultBgm 참고)
 */

import type { BgmMood } from "./bgm";

/** 로컬 프리셋 경로 (public/bgm/ 기준, Vite staticFile 처리) */
export const LOCAL_PRESETS: Record<BgmMood, string> = {
	dark: "/bgm/dark/default.mp3",
	tense: "/bgm/tense/default.mp3",
	mysterious: "/bgm/mysterious/default.mp3",
	dramatic: "/bgm/dramatic/default.mp3",
	calm: "/bgm/calm/default.mp3",
	upbeat: "/bgm/upbeat/default.mp3",
	epic: "/bgm/epic/default.mp3",
	sad: "/bgm/sad/default.mp3",
};

/**
 * Mood별 "정말 많이 쓰이는 느낌"의 Pixabay 검색어.
 * 제목에 자주 등장하는 키워드 조합으로 대표 트랙이 상위 노출되도록 튜닝.
 */
export const PIXABAY_QUERIES: Record<BgmMood, string[]> = {
	dark: [
		"dark horror ambient",
		"creepy suspense",
		"scary atmospheric",
		"haunted dark",
		"ambient dark drone",
	],
	tense: [
		"tension suspense thriller",
		"heartbeat intense",
		"pulse action tension",
		"dark trailer tension",
	],
	mysterious: [
		"mystery detective investigation",
		"mysterious piano cinematic",
		"dark mystery puzzle",
		"suspense mystery ambient",
	],
	dramatic: [
		"dramatic cinematic epic",
		"emotional orchestra trailer",
		"powerful cinematic",
		"dramatic strings",
	],
	calm: [
		"calm peaceful ambient",
		"relaxing meditation",
		"soft piano calm",
		"peaceful acoustic",
		"lo-fi chill study",
		"warm acoustic guitar calm",
	],
	upbeat: [
		"upbeat energetic pop",
		"happy motivation",
		"positive corporate",
		"uplifting inspiring",
		"urban beat hip hop",
		"funky energetic pop",
	],
	epic: [
		"epic cinematic trailer",
		"hero epic orchestra",
		"epic battle",
		"powerful epic",
		"cinematic epic build",
		"epic orchestral hero",
	],
	sad: [
		"sad emotional piano",
		"melancholy ambient",
		"sad cinematic",
		"lonely",
		"lo-fi chill emotional",
		"introspective ambient",
	],
};

/** 사용자가 즐겨 쓰는 BGM을 mood별로 저장 (파일 업로드 시) */
export function getUserDefaultBgm(mood: BgmMood): {
	path: string;
	url: string;
} | null {
	if (typeof localStorage === "undefined") return null;
	const path = localStorage.getItem(`custom_bgm_path_${mood}`);
	const url = localStorage.getItem(`custom_bgm_url_${mood}`);
	if (!path || !url) return null;
	return { path, url };
}

export function setUserDefaultBgm(
	mood: BgmMood,
	path: string,
	url: string,
): void {
	if (typeof localStorage === "undefined") return;
	localStorage.setItem(`custom_bgm_path_${mood}`, path);
	localStorage.setItem(`custom_bgm_url_${mood}`, url);
}

export function clearUserDefaultBgm(mood: BgmMood): void {
	if (typeof localStorage === "undefined") return;
	localStorage.removeItem(`custom_bgm_path_${mood}`);
	localStorage.removeItem(`custom_bgm_url_${mood}`);
}

/** 로컬 프리셋 파일 존재 여부 확인 (HEAD 요청) */
export async function checkLocalPresetExists(mood: BgmMood): Promise<boolean> {
	const path = LOCAL_PRESETS[mood];
	try {
		const res = await fetch(path, {
			method: "HEAD",
			signal: AbortSignal.timeout(2000),
		});
		return res.ok;
	} catch {
		return false;
	}
}
