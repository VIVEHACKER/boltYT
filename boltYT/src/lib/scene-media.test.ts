import { describe, expect, it } from "vitest";
import {
	buildSceneImagePrompt,
	buildSceneSearchQueries,
	buildShotImagePrompt,
	buildShotSearchQueries,
	isDirectImageUrl,
	isDirectVideoUrl,
} from "./scene-media";

describe("scene-media helpers", () => {
	it("기사 메타데이터를 한국어 검색어 우선순위로 사용한다", () => {
		const queries = buildSceneSearchQueries({
			narration_text: "경찰은 새벽 수색 끝에 결정적인 흔적을 발견했습니다.",
			scene_type: "image",
			visual_prompt: "dark crime scene evidence board",
			news_title: "이형호 유괴 살인 사건 수사 재조명",
			news_source: "연합뉴스",
			searchQueryKo: "",
			searchQueryEn: "",
			locale: "ko",
		});

		expect(queries.queryKo).toContain("이형호 유괴 살인 사건");
		expect(queries.queryEn).toBe("dark crime scene evidence board");
	});

	it("Scene Director가 준 검색어를 최우선으로 사용한다", () => {
		const queries = buildSceneSearchQueries({
			narration_text: "용의자는 마지막으로 강변 도로에서 목격됐습니다.",
			scene_type: "video",
			visual_prompt: "riverside road at night",
			searchQueryKo: "강변 도로 수사 현장",
			searchQueryEn: "night riverside investigation footage",
			locale: "ko",
		});

		expect(queries.queryKo).toBe("강변 도로 수사 현장");
		expect(queries.queryEn).toBe("night riverside investigation footage");
	});

	it("AI 이미지 프롬프트는 기존 visual_prompt를 그대로 살린다", () => {
		const prompt = buildSceneImagePrompt({
			narration_text: "피해자는 집 앞에서 마지막으로 목격됐습니다.",
			scene_type: "image",
			visual_prompt: "cinematic apartment alley at dusk, detective tape",
		});

		expect(prompt).toBe("cinematic apartment alley at dusk, detective tape");
	});

	it("샷 검색어는 shot.visual_prompt와 caption을 우선 사용한다", () => {
		const queries = buildShotSearchQueries(
			{
				narration_text: "수사팀은 통화 녹취를 다시 분석했습니다.",
				scene_type: "image",
				visual_prompt: "detective office at night",
				news_title: "재수사 시작",
				news_date: "1991-02-03",
				searchQueryKo: "이형호 사건 재수사",
				searchQueryEn: "cold case reinvestigation",
				locale: "ko",
			},
			{
				visual_prompt:
					"forensic evidence board with cassette tape and ransom note",
				caption: "협박 전화 녹취와 몸값 요구 메모",
				source_title: "핵심 증거",
			},
		);

		expect(queries.queryEn).toBe(
			"forensic evidence board with cassette tape and ransom note",
		);
		expect(queries.queryKo).toContain("협박 전화");
	});

	it("샷 이미지 프롬프트는 shot.visual_prompt를 우선 사용한다", () => {
		const prompt = buildShotImagePrompt(
			{
				narration_text: "범행 직전의 정황이 다시 조명됐습니다.",
				scene_type: "image",
				visual_prompt: "night apartment exterior",
			},
			{
				visual_prompt:
					"close-up forensic document on desk, dramatic overhead light",
				caption: "증거 문서",
			},
		);

		expect(prompt).toBe(
			"close-up forensic document on desk, dramatic overhead light",
		);
	});

	it("직접 이미지 URL과 영상 URL을 구분한다", () => {
		expect(isDirectImageUrl("https://example.com/frame.jpg")).toBe(true);
		expect(isDirectImageUrl("https://example.com/watch?v=123")).toBe(false);
		expect(isDirectVideoUrl("https://youtu.be/abc123")).toBe(true);
		expect(isDirectVideoUrl("https://example.com/clip.mp4")).toBe(true);
		expect(isDirectVideoUrl("https://example.com/frame.png")).toBe(false);
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("scene-media 추가 분기", () => {
	// ─── buildSceneImagePrompt: visual_prompt 없는 경우 ──────────────────────
	it("visual_prompt 없으면 news_title + news_date + narration 조합", () => {
		const prompt = buildSceneImagePrompt({
			narration_text: "나레이션 텍스트",
			scene_type: "image",
			visual_prompt: "",
			news_title: "뉴스 제목",
			news_date: "2024-01-01",
		});
		expect(prompt).toContain("뉴스 제목");
		expect(prompt).toContain("나레이션 텍스트");
	});

	it("모든 필드 없으면 빈 문자열", () => {
		const prompt = buildSceneImagePrompt({
			narration_text: "",
			scene_type: "image",
			visual_prompt: "",
			source_url: undefined,
			news_title: undefined,
			news_source: undefined,
			news_date: undefined,
		});
		expect(prompt).toBe("");
	});

	// ─── buildShotImagePrompt: shot.visual_prompt 없는 경우 ──────────────────
	it("shot.visual_prompt 없으면 source_title + caption + scene 프롬프트 조합", () => {
		const prompt = buildShotImagePrompt(
			{
				narration_text: "나레이션",
				scene_type: "image",
				visual_prompt: "scene visual prompt",
			},
			{
				visual_prompt: "",
				caption: "샷 캡션",
				source_title: "소스 제목",
			},
		);
		expect(prompt).toContain("소스 제목");
		expect(prompt).toContain("샷 캡션");
	});

	it("shot 없으면 buildSceneImagePrompt 결과 사용", () => {
		const prompt = buildShotImagePrompt({
			narration_text: "나레이션",
			scene_type: "image",
			visual_prompt: "cinematic scene",
		});
		expect(prompt).toBe("cinematic scene");
	});

	// ─── buildShotSearchQueries: looksEnglish 분기 ───────────────────────────
	it("shot.visual_prompt가 영어면 queryEn 우선 사용", () => {
		const queries = buildShotSearchQueries(
			{
				narration_text: "나레이션",
				scene_type: "image",
				visual_prompt: "dark forest",
				searchQueryKo: "어두운 숲",
				searchQueryEn: "dark forest night",
				locale: "ko",
			},
			{
				visual_prompt: "detective walking in rain",
				caption: "",
				source_title: "",
			},
		);
		// 영어 shotPrompt → queryEn에 우선 사용
		expect(queries.queryEn).toBe("detective walking in rain");
	});

	it("shot.visual_prompt가 한국어면 queryKo 우선 사용", () => {
		const queries = buildShotSearchQueries(
			{
				narration_text: "나레이션",
				scene_type: "image",
				visual_prompt: "dark forest",
				searchQueryKo: "어두운 숲",
				searchQueryEn: "dark forest",
				locale: "ko",
			},
			{
				visual_prompt: "형사 비 속에서 걷기",
				caption: "",
				source_title: "",
			},
		);
		expect(queries.queryKo).toBe("형사 비 속에서 걷기");
	});

	it("shot.source_title + caption → shotHeadline에 포함", () => {
		const queries = buildShotSearchQueries(
			{
				narration_text: "나레이션",
				scene_type: "image",
				visual_prompt: "",
				news_date: "2024-01-01",
				searchQueryKo: "",
				searchQueryEn: "",
				locale: "ko",
			},
			{
				visual_prompt: "",
				caption: "샷 설명",
				source_title: "소스 타이틀",
			},
		);
		// shotHeadline = [news_date, source_title, caption].join(" ")
		expect(queries.queryKo).toContain("소스 타이틀");
	});

	// ─── buildSceneSearchQueries: 다양한 locale 분기 ─────────────────────────
	it("locale en → queryEn 우선", () => {
		const queries = buildSceneSearchQueries({
			narration_text: "narration",
			scene_type: "image",
			visual_prompt: "dark scene",
			locale: "en",
		});
		expect(queries.locale).toBe("en");
	});
});

// ─── 추가 엣지 케이스 ─────────────────────────────────────────────────────────
describe("scene-media 추가 엣지 케이스", () => {
	// ─── isDirectVideoUrl: undefined → false ────────────────────────────
	it("isDirectVideoUrl undefined → false", () => {
		expect(isDirectVideoUrl(undefined)).toBe(false);
	});

	it("isDirectVideoUrl empty string → false", () => {
		expect(isDirectVideoUrl("")).toBe(false);
	});

	// ─── buildSceneSearchQueries: visual_prompt 영어, searchQueryKo 없음 ─
	it("visual_prompt가 영어이고 searchQueryKo 없음 → queryKo는 sourceHeadline 사용", () => {
		const queries = buildSceneSearchQueries({
			narration_text: "나레이션",
			scene_type: "image",
			visual_prompt: "dark forest at night",
			news_title: "사건 제목",
			searchQueryKo: "",
			searchQueryEn: "",
			locale: "ko",
		});
		// looksEnglish(visualPrompt)=true → queryKo는 "" → sourceHeadline 사용
		expect(queries.queryKo).toContain("사건 제목");
	});

	it("visual_prompt가 영어이고 searchQueryEn 없음 → queryEn은 visual_prompt 사용", () => {
		const queries = buildSceneSearchQueries({
			narration_text: "나레이션",
			scene_type: "image",
			visual_prompt: "detective noir scene",
			searchQueryKo: "",
			searchQueryEn: "",
			locale: "ko",
		});
		expect(queries.queryEn).toBe("detective noir scene");
	});

	it("buildSceneSearchQueries에서 news_source와 news_date 포함한 sourceHeadline", () => {
		const queries = buildSceneSearchQueries({
			narration_text: "",
			scene_type: "image",
			visual_prompt: "",
			news_title: "뉴스 제목",
			news_date: "2024-01-01",
			news_source: "연합뉴스",
			searchQueryKo: "",
			searchQueryEn: "",
			locale: "ko",
		});
		expect(queries.queryKo).toContain("뉴스 제목");
	});

	// ─── buildShotSearchQueries: looksEnglish on scene.visual_prompt ────
	it("scene.visual_prompt가 영어이고 shot.visual_prompt 없음 → scene visual_prompt를 queryEn에 사용", () => {
		const queries = buildShotSearchQueries(
			{
				narration_text: "나레이션",
				scene_type: "image",
				visual_prompt: "dark alley scene",
				searchQueryKo: "",
				searchQueryEn: "",
				locale: "ko",
			},
			{
				visual_prompt: "",
				caption: "",
				source_title: "",
			},
		);
		expect(queries.queryEn).toBe("dark alley scene");
	});

	// ─── firstNonEmpty: 모두 빈 문자열 → "" 반환 ───────────────────────
	it("buildSceneSearchQueries 모든 필드 없음 → queryKo/queryEn 빈 문자열", () => {
		const queries = buildSceneSearchQueries({
			narration_text: "",
			scene_type: "image",
			visual_prompt: "",
			searchQueryKo: "",
			searchQueryEn: "",
		});
		expect(queries.queryKo).toBe("");
		expect(queries.queryEn).toBe("");
	});
});
