import { staticFile } from "remotion";
import type { RemotionScene } from "../remotion/types";
import { VIDEO_FPS } from "../remotion/types";
import type { SceneShot } from "./scene-shot-types";

export const DEMO_CHANNELS = [
	{
		id: "ch-1",
		user_id: "demo-user",
		name: "그놈 목소리",
		description: "한국 미제사건과 미스테리를 팩트 기반으로 파헤치는 채널",
		language: "ko",
		category: "미스테리",
		tone: "긴장감 있고 몰입감 있는",
		forbidden_words: [],
		default_cta: "구독과 좋아요로 응원해주세요!",
		visibility_policy: "public",
		created_at: "2026-04-01T00:00:00Z",
		updated_at: "2026-04-01T00:00:00Z",
	},
];

interface DemoScene {
	id: string;
	script_id: string;
	order_index: number;
	narration_text: string;
	scene_type: "image" | "text_emphasis" | "video" | "news_overlay";
	audio_duration: number;
	source_attribution?: string;
}

// 3개 씬 × ~20초 = 60초 Shorts
export const DEMO_SCENES: DemoScene[] = [
	{
		id: "scene-1",
		script_id: "script-1",
		order_index: 0,
		narration_text:
			"1991년, 서울에서 9살 이형호 군이 유괴되는 사건이 발생했습니다. 당시 이형호의 아버지는 아들의 안전을 위해 필사적으로 노력했지만, 범인의 악랄함은 상상을 초월했습니다. 이 사건은 대한민국을 충격에 빠뜨린 비극적 사건으로 기억되고 있습니다.",
		scene_type: "video",
		audio_duration: 21.5,
		source_attribution: "이투데이",
	},
	{
		id: "scene-3",
		script_id: "script-1",
		order_index: 1,
		narration_text:
			"범인은 돈가방을 양화대교 배전판에 올려두라고 지시했습니다. 아버지는 그 지시를 따랐지만, 범인은 결국 잡히지 않았습니다. 이형호 군의 아버지는 '내가 죄인 같다'며 자신의 심정을 고백하기도 했습니다.",
		scene_type: "video",
		audio_duration: 16.97,
		source_attribution: "이투데이",
	},
	{
		id: "scene-6",
		script_id: "script-1",
		order_index: 2,
		narration_text:
			"최근에는 AI 기반 음성 분석 기술과 유전자 추적을 활용한 새로운 수사 가능성에 대한 논의가 이어지고 있습니다. 과거의 상처를 딛고 범인을 찾을 수 있을지, 많은 이들이 주목하고 있습니다. '꼬꼬무'는 이 사건의 진실을 찾기 위한 시청자들의 관심을 요청했습니다.",
		scene_type: "video",
		audio_duration: 21.65,
		source_attribution: "이투데이",
	},
];

const VID2 = "generated/video_2.mp4"; // 그알 캐비닛 (협박 장면) — 30s
const VID1 = "generated/video_1.mp4"; // 꼬꼬무 SBS (아버지 출연) — 30s

// 각 씬: 동일 소스 영상을 trim_start/trim_end로 3등분 → 다른 구간 재생
// trim_start/trim_end 는 씬 durationInFrames 기준 정규화 (0.0~1.0)
const DEMO_SHOTS: SceneShot[][] = [
	// 씬1: 첫 6초 안에 3개 이상의 실질 비주얼 비트가 나오도록 자료 컷 선배치
	[
		{
			id: "1a",
			kind: "establishing",
			duration_seconds: 2.1,
			media_type: "image",
			source_url: "demo/scene1.jpg",
			motion: "slow_zoom_in",
			crop: "full",
		},
		{
			id: "1b",
			kind: "context",
			duration_seconds: 2.1,
			media_type: "image",
			source_url: "demo/scene2.jpg",
			motion: "pan_left",
			crop: "medium",
		},
		{
			id: "1c",
			kind: "evidence",
			duration_seconds: 2.1,
			media_type: "image",
			source_url: "demo/scene3.jpg",
			motion: "pan_right",
			crop: "close",
		},
		{
			id: "1d",
			kind: "punch",
			duration_seconds: 15.2,
			media_type: "video",
			trim_start: 0.66,
			trim_end: 1.0,
			motion: "push_in",
			crop: "close",
		},
	],
	// 씬3 (17s, video_1): 3컷 — 0~5.5s / 5.5~11s / 11~17s
	[
		{
			id: "3a",
			kind: "establishing",
			duration_seconds: 5.5,
			media_type: "video",
			trim_start: 0.0,
			trim_end: 0.33,
			motion: "slow_zoom_out",
			crop: "wide",
		},
		{
			id: "3b",
			kind: "evidence",
			duration_seconds: 5.5,
			media_type: "video",
			trim_start: 0.33,
			trim_end: 0.66,
			motion: "pan_right",
			crop: "medium",
		},
		{
			id: "3c",
			kind: "punch",
			duration_seconds: 6,
			media_type: "video",
			trim_start: 0.66,
			trim_end: 1.0,
			motion: "push_in",
			crop: "close",
		},
	],
	// 씬6 (21.7s, video_2 후반부): 4컷 — 8~14s / 14~20s / 20~26s / 26~30s
	[
		{
			id: "6a",
			kind: "establishing",
			duration_seconds: 5,
			media_type: "video",
			trim_start: 0.27,
			trim_end: 0.47,
			motion: "drift",
			crop: "wide",
		},
		{
			id: "6b",
			kind: "context",
			duration_seconds: 6,
			media_type: "video",
			trim_start: 0.47,
			trim_end: 0.67,
			motion: "pan_left",
			crop: "medium",
		},
		{
			id: "6c",
			kind: "detail",
			duration_seconds: 6,
			media_type: "video",
			trim_start: 0.67,
			trim_end: 0.87,
			motion: "slow_zoom_in",
			crop: "close",
		},
		{
			id: "6d",
			kind: "punch",
			duration_seconds: 4.7,
			media_type: "video",
			trim_start: 0.87,
			trim_end: 1.0,
			motion: "push_in",
			crop: "detail",
		},
	],
];

const VIDEOS = [VID2, VID1, VID2];

const AUDIOS = [
	staticFile("demo/narration.mp3"),
	staticFile("demo/narration.mp3"),
	staticFile("demo/narration.mp3"),
];

export const DEMO_BGM_URL = staticFile("sfx/dark-ambient.mp3");

export function getDemoRemotionScenes(): RemotionScene[] {
	const transitions: RemotionScene["transition"][] = [
		"crossfade",
		"crossfade",
		"crossfade",
	];
	const colorGrades: RemotionScene["colorGrade"][] = [
		"cold-noir",
		"cold-noir",
		"cold-noir",
	];
	const enterSfx = ["reveal-1.mp3", "tension-rise.mp3", "impact-1.mp3"];
	const transitionSfx = ["whoosh-1.mp3", "whoosh-1.mp3", "whoosh-2.mp3"];
	// 데모 BGM(dark-ambient) 절대 비트 그리드 — 0.5s 간격(120bpm). beat-pulse 시연/검증용.
	const demoBeatTimes = Array.from({ length: 40 }, (_, k) => 0.5 + k * 0.5);

	return DEMO_SCENES.map((s, i) => ({
		imageUrl: "",
		videoUrl: VIDEOS[i],
		audioUrl: AUDIOS[i],
		narration: s.narration_text,
		durationInFrames: Math.ceil((s.audio_duration + 0.5) * VIDEO_FPS),
		type: s.scene_type,
		sourceAttribution: s.source_attribution,
		isNewsPhoto: false,
		transition: transitions[i],
		mood: "mystery" as const,
		colorGrade: colorGrades[i],
		shots: DEMO_SHOTS[i],
		enterSfxFile: enterSfx[i],
		transitionSfxFile: transitionSfx[i],
		beatTimes: demoBeatTimes,
	}));
}
