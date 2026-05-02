/**
 * BGM 라이브러리 — Pixabay Music API + 무료 음원 검색 + Curated Library
 *
 * Pixabay Music: 무료, CC0 라이선스, 속성 표시 불필요
 */

import { storeLocalFile } from "./local-db";
import { getApiProxyUrl } from "./proxy";
import {
	pickProfessionalBgmTrack,
	rankBgmTracks,
	type ScoredBgmTrack,
} from "./bgm-quality";

// ─── 타입 ───

export interface BgmTrack {
	id: string;
	title: string;
	artist: string;
	duration: number;
	/** 미리듣기 URL */
	previewUrl: string;
	/** 다운로드 URL */
	downloadUrl: string;
	tags: string[];
	source: "pixabay" | "builtin";
	qualityScore?: number;
	qualityReasons?: string[];
	qualityWarnings?: string[];
}

export type BgmMood =
	| "dark"
	| "tense"
	| "mysterious"
	| "dramatic"
	| "calm"
	| "upbeat"
	| "epic"
	| "sad";

/**
 * 외부 mood 키워드 → BgmMood 정규화.
 * 레퍼런스 템플릿이나 Scene.bgm_mood 가 다양한 표현을 사용해도 일관된 매칭.
 */
export function normalizeMood(input?: string): BgmMood {
	if (!input) return "calm";
	const m = input.toLowerCase().trim();
	if (/horror|scary|creepy|haunt/.test(m)) return "dark";
	if (/tense|tension|thriller|suspense|pulse/.test(m)) return "tense";
	if (/mystery|mysterious|detective|investigat/.test(m)) return "mysterious";
	if (/drama|emotional|powerful|grand/.test(m)) return "dramatic";
	if (/calm|peace|relax|chill|quiet|ambient/.test(m)) return "calm";
	if (/upbeat|happy|cheerful|positive|fun|energy|energetic/.test(m))
		return "upbeat";
	if (/epic|cinematic|trailer|hero|battle/.test(m)) return "epic";
	if (/sad|melancholy|lonely|sorrow/.test(m)) return "sad";
	if (/hopeful/.test(m)) return "calm";
	if (/neutral/.test(m)) return "calm";
	return "calm";
}

/** 장르/분위기별 검색 키워드 매핑 */
const MOOD_QUERIES: Record<BgmMood, string> = {
	dark: "dark ambient horror",
	tense: "tension suspense thriller",
	mysterious: "mystery detective investigation",
	dramatic: "dramatic cinematic orchestra",
	calm: "calm peaceful ambient",
	upbeat: "upbeat energetic pop",
	epic: "epic cinematic trailer",
	sad: "sad emotional piano",
};

// ─── 내장 무료 트랙 (Pixabay 인기 트랙 — 다운로드 시 API 호출) ───

const BUILTIN_TRACKS: BgmTrack[] = [
	{
		id: "builtin-dark-ambient",
		title: "Dark Ambient Background",
		artist: "Pixabay",
		duration: 180,
		previewUrl: "",
		downloadUrl: "",
		tags: ["dark", "ambient", "horror", "mystery"],
		source: "builtin",
	},
	{
		id: "builtin-tension",
		title: "Suspense Tension",
		artist: "Pixabay",
		duration: 120,
		previewUrl: "",
		downloadUrl: "",
		tags: ["tense", "suspense", "thriller"],
		source: "builtin",
	},
	{
		id: "builtin-cinematic",
		title: "Cinematic Epic",
		artist: "Pixabay",
		duration: 150,
		previewUrl: "",
		downloadUrl: "",
		tags: ["dramatic", "cinematic", "epic"],
		source: "builtin",
	},
];

// ─── Pixabay Music API ───

interface PixabayMusicHit {
	id: number;
	title: string;
	user: string;
	duration: number;
	audio_url: string;
	tags: string;
}

/**
 * Pixabay Music 검색 (프록시 경유)
 */
export async function searchBgm(
	query: string,
	options?: {
		mood?: BgmMood;
		minDuration?: number;
		maxDuration?: number;
		/** 'popular' | 'latest' — 인기 자동 선택용 */
		order?: "popular" | "latest";
		/** Pixabay Editor's Choice 만 — 검증된 큐레이션 */
		editorsChoice?: boolean;
	},
): Promise<BgmTrack[]> {
	const proxy = getApiProxyUrl();

	const searchQuery = options?.mood
		? `${query} ${MOOD_QUERIES[options.mood]}`
		: query;

	const params = new URLSearchParams({
		q: searchQuery,
		per_page: "20",
	});

	if (options?.minDuration) {
		params.set("min_duration", String(options.minDuration));
	}
	if (options?.maxDuration) {
		params.set("max_duration", String(options.maxDuration));
	}
	if (options?.order) {
		params.set("order", options.order);
	}
	if (options?.editorsChoice) {
		params.set("editors_choice", "true");
	}

	const res = await fetch(`${proxy}/api/pixabay/music?${params.toString()}`);

	if (!res.ok) return [];

	const data = await res.json();
	const hits = (data.hits ?? []) as PixabayMusicHit[];

	return hits.map((hit) => ({
		id: `pixabay-${hit.id}`,
		title: hit.title,
		artist: hit.user,
		duration: hit.duration,
		previewUrl: hit.audio_url,
		downloadUrl: hit.audio_url,
		tags: hit.tags.split(",").map((t: string) => t.trim()),
		source: "pixabay" as const,
	}));
}

/** 분위기별 추천 트랙 */
export async function getRecommendedBgm(mood: BgmMood): Promise<BgmTrack[]> {
	const query = MOOD_QUERIES[mood];
	const apiTracks = await searchBgm(query, { mood });

	// 내장 트랙 중 매칭되는 것 추가
	const builtinMatches = BUILTIN_TRACKS.filter((t) =>
		t.tags.some((tag) => mood.includes(tag) || tag.includes(mood)),
	);

	return [...apiTracks, ...builtinMatches];
}

/**
 * 레퍼런스 프리셋 기반 BGM 검색.
 * preset.bgm.keywords + mood를 결합해 Pixabay에서 최적 매칭.
 */
export async function searchBgmFromPreset(preset: {
	mood: BgmMood | "";
	keywords: string[];
	tempo: "slow" | "mid" | "fast";
}): Promise<BgmTrack[]> {
	const keywordQuery = preset.keywords.filter(Boolean).join(" ").trim();
	const query = keywordQuery || (preset.mood ? MOOD_QUERIES[preset.mood] : "");

	if (!query) return [];

	// 템포를 duration 힌트로 대략 매핑
	const durationHint: Record<
		"slow" | "mid" | "fast",
		{ min: number; max: number }
	> = {
		slow: { min: 120, max: 300 },
		mid: { min: 60, max: 240 },
		fast: { min: 45, max: 180 },
	};
	const dur = durationHint[preset.tempo];

	const tracks = await searchBgm(query, {
		mood: preset.mood || undefined,
		minDuration: dur.min,
		maxDuration: dur.max,
		order: "popular",
		editorsChoice: true,
	});
	return rankBgmTracks(tracks, preset);
}

/** BGM 다운로드 → IndexedDB 저장 */
export async function downloadBgm(
	track: BgmTrack,
	scriptId: string,
): Promise<string> {
	if (!track.downloadUrl) {
		throw new Error("다운로드 URL이 없습니다.");
	}

	const res = await fetch(track.downloadUrl);
	if (!res.ok) throw new Error(`BGM 다운로드 실패: ${res.status}`);

	const buffer = await res.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const storagePath = `scripts/${scriptId}/bgm.mp3`;
	return storeLocalFile(storagePath, bytes, "audio/mpeg");
}

/** 사용 가능한 분위기 목록 */
export const BGM_MOODS: Array<{ id: BgmMood; label: string; emoji: string }> = [
	{ id: "dark", label: "어둡고 무거운", emoji: "🌑" },
	{ id: "tense", label: "긴장감 있는", emoji: "⚡" },
	{ id: "mysterious", label: "미스터리한", emoji: "🔍" },
	{ id: "dramatic", label: "드라마틱한", emoji: "🎭" },
	{ id: "calm", label: "차분하고 평화로운", emoji: "🌊" },
	{ id: "upbeat", label: "밝고 에너지틱한", emoji: "🎵" },
	{ id: "epic", label: "웅장하고 서사적인", emoji: "🏔️" },
	{ id: "sad", label: "슬프고 감성적인", emoji: "🌧️" },
];

/** 직접 URL로 BGM 설정 */
export async function setBgmFromUrl(
	url: string,
	scriptId: string,
): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`BGM 다운로드 실패: ${res.status}`);

	const buffer = await res.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const storagePath = `scripts/${scriptId}/bgm.mp3`;
	const localUrl = await storeLocalFile(storagePath, bytes, "audio/mpeg");
	localStorage.setItem(`bgm_path_${scriptId}`, storagePath);
	return localUrl;
}

/**
 * 로컬 음악 파일 업로드 → IndexedDB에 저장
 * — 사용자가 직접 가진 MP3/WAV/M4A 파일을 BGM으로 사용
 */
export async function setBgmFromFile(
	file: File,
	scriptId: string,
): Promise<string> {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const ext = file.name.split(".").pop() ?? "mp3";
	const mimeMap: Record<string, string> = {
		mp3: "audio/mpeg",
		wav: "audio/wav",
		m4a: "audio/mp4",
		ogg: "audio/ogg",
		flac: "audio/flac",
	};
	const storagePath = `scripts/${scriptId}/bgm.${ext}`;
	const localUrl = await storeLocalFile(
		storagePath,
		bytes,
		mimeMap[ext] ?? "audio/mpeg",
	);
	localStorage.setItem(`bgm_path_${scriptId}`, storagePath);
	return localUrl;
}

// ─── 자동 BGM 선택 (레퍼런스 템플릿 기반) ───

import {
	checkLocalPresetExists,
	getUserDefaultBgm,
	LOCAL_PRESETS,
	PIXABAY_QUERIES,
} from "./bgm-library";

export interface AutoPickResult {
	/** 로컬 blob URL 또는 public static 경로 */
	url: string;
	storagePath: string;
	source: "user_default" | "local_preset" | "curated_pixabay" | "search";
	track?: BgmTrack;
	qualityScore?: number;
	qualityWarnings?: string[];
}

export interface AutoBgmSceneHint {
	mood?: "horror" | "mystery" | "news" | "neutral" | "warm";
	durationSeconds?: number;
	sceneType?: "image" | "video" | "text_emphasis" | "news_overlay";
}

export function inferAutoBgmPreset(scenes: AutoBgmSceneHint[]): {
	mood: BgmMood | "";
	keywords: string[];
	tempo: "slow" | "mid" | "fast";
} {
	const moodCounts = new Map<BgmMood, number>();
	const moodMap: Record<NonNullable<AutoBgmSceneHint["mood"]>, BgmMood> = {
		horror: "dark",
		mystery: "mysterious",
		news: "dramatic",
		neutral: "dramatic",
		warm: "calm",
	};

	for (const scene of scenes) {
		if (!scene.mood) continue;
		const mappedMood = moodMap[scene.mood];
		moodCounts.set(mappedMood, (moodCounts.get(mappedMood) ?? 0) + 1);
		if (scene.sceneType === "video" && mappedMood === "dramatic") {
			moodCounts.set("tense", (moodCounts.get("tense") ?? 0) + 1);
		}
	}

	const avgDuration =
		scenes.length > 0
			? scenes.reduce((sum, scene) => sum + (scene.durationSeconds ?? 0), 0) /
				scenes.length
			: 0;
	const tempo: "slow" | "mid" | "fast" =
		avgDuration > 0 && avgDuration <= 2.5
			? "fast"
			: avgDuration > 0 && avgDuration <= 5
				? "mid"
				: "slow";

	const mood =
		[...moodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "dramatic";

	return {
		mood,
		keywords: [],
		tempo,
	};
}

/**
 * 레퍼런스 템플릿 기반 BGM 자동 선택 + 다운로드.
 *
 * 우선순위:
 *  1. 사용자 기본 BGM (mood별로 `setUserDefaultBgm`으로 저장한 파일)
 *  2. 로컬 프리셋 (`public/bgm/<mood>/default.mp3` 가 있으면)
 *  3. Curated Pixabay 검색 (유명 트랙 순 = order=popular + editors_choice)
 *  4. Fallback: 일반 키워드 검색 인기순
 */
export async function autoPickBgm(
	scriptId: string,
	preset: {
		mood: BgmMood | "";
		keywords: string[];
		tempo: "slow" | "mid" | "fast";
	},
): Promise<AutoPickResult | null> {
	const mood = preset.mood;
	if (!mood) {
		// mood 없으면 키워드 검색만
		const tracks = await searchBgmFromPreset(preset);
		if (tracks.length === 0) return null;
		const picked = pickProfessionalBgmTrack(tracks, preset);
		if (!picked) return null;
		return downloadAndStore(picked, scriptId, "search");
	}

	// 1. 사용자 기본 BGM
	const userDefault = getUserDefaultBgm(mood);
	if (userDefault) {
		localStorage.setItem(`bgm_path_${scriptId}`, userDefault.path);
		return {
			url: userDefault.url,
			storagePath: userDefault.path,
			source: "user_default",
		};
	}

	// 2. 로컬 프리셋 (public/bgm/<mood>/default.mp3)
	if (await checkLocalPresetExists(mood)) {
		const staticUrl = LOCAL_PRESETS[mood];
		localStorage.setItem(`bgm_path_${scriptId}`, staticUrl);
		return {
			url: staticUrl,
			storagePath: staticUrl,
			source: "local_preset",
		};
	}

	// 3. Curated Pixabay 검색 — mood별 검증된 쿼리 × editors_choice + popular
	const queries = PIXABAY_QUERIES[mood];
	for (const q of queries) {
		const tracks = await searchBgm(q, {
			mood,
			order: "popular",
			editorsChoice: true,
			minDuration: 60,
			maxDuration: 300,
		});
		const picked = pickProfessionalBgmTrack(tracks, {
			...preset,
			keywords: [...preset.keywords, q],
		});
		if (picked) {
			return downloadAndStore(picked, scriptId, "curated_pixabay");
		}
	}

	// 4. Fallback: 일반 키워드 검색
	const fallback = await searchBgmFromPreset(preset);
	if (fallback.length > 0) {
		const picked = pickProfessionalBgmTrack(fallback, preset);
		if (picked) return downloadAndStore(picked, scriptId, "search");
	}

	return null;
}

async function downloadAndStore(
	track: BgmTrack | ScoredBgmTrack,
	scriptId: string,
	source: AutoPickResult["source"],
): Promise<AutoPickResult> {
	const url = await downloadBgm(track, scriptId);
	const storagePath = `scripts/${scriptId}/bgm.mp3`;
	localStorage.setItem(`bgm_path_${scriptId}`, storagePath);
	const scored =
		typeof track.qualityScore === "number"
			? track
			: rankBgmTracks([track], {})[0];
	localStorage.setItem(
		`bgm_selection_${scriptId}`,
		JSON.stringify({
			source,
			trackId: track.id,
			title: track.title,
			artist: track.artist,
			qualityScore: scored.qualityScore,
			qualityWarnings: scored.qualityWarnings,
		}),
	);

	// 비동기 BPM 분석 — 실패해도 main flow는 진행
	void (async () => {
		try {
			const { analyzeBgmFromUrl } = await import("./bgm-analyze");
			const analysis = await analyzeBgmFromUrl(url);
			if (analysis.bpm > 0) {
				localStorage.setItem(
					`bgm_analysis_${scriptId}`,
					JSON.stringify(analysis),
				);
			}
		} catch {
			/* silent — analysis is optional */
		}
	})();

	return {
		url,
		storagePath,
		source,
		track,
		qualityScore: scored.qualityScore,
		qualityWarnings: scored.qualityWarnings,
	};
}
