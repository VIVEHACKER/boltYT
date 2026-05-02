import { describe, expect, it } from "vitest";
import {
	applyLongformVideoRules,
	applyShortsVideoRules,
	buildSceneShots,
	ensureSceneShots,
	intensifyHookScenes,
	isSourceCompatible,
	rebalanceScenesForMotion,
	syncSceneMetadataFromSource,
} from "./scene-shots";

describe("scene-shots", () => {
	it("plans multiple shots that preserve total scene duration", () => {
		const shots = buildSceneShots(
			{
				narration: "실종 신고 이후 수사가 본격화됐다.",
				type: "image",
				visualPrompt: "detective board and apartment exterior at dusk",
				duration: 9,
				sourceIndex: 0,
				newsTitle: "실종 신고 접수",
				newsDate: "1991-01-29",
			},
			[
				{
					type: "image",
					title: "현장 사진",
					url: "https://example.com/scene.jpg",
					eventTitle: "실종 신고 접수",
					eventDate: "1991-01-29",
				},
			],
		);

		expect(shots.length).toBeGreaterThanOrEqual(3);
		expect(
			shots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
		).toBeCloseTo(9, 1);
		expect(shots[0].source_url).toBe("https://example.com/scene.jpg");
	});

	it("샷마다 시각 역할과 품질 검색 메타데이터를 만든다", () => {
		const shots = buildSceneShots(
			{
				narration: "결정적 문서가 공개되며 사건의 흐름이 바뀌었다.",
				type: "image",
				visualPrompt: "official record close up",
				duration: 6,
				sourceIndex: 0,
				newsTitle: "결정적 문서 공개",
				newsDate: "1991-02-01",
			},
			[
				{
					type: "article",
					title: "문서 공개 기사",
					eventTitle: "결정적 문서 공개",
					eventDate: "1991-02-01",
					description: "공개된 문서가 수사의 핵심 단서가 됐다.",
				},
			],
		);

		expect(shots.every((shot) => shot.visual_role)).toBe(true);
		expect(shots.every((shot) => shot.search_terms?.length)).toBe(true);
		expect(shots.every((shot) => shot.reject_terms?.includes("logo"))).toBe(
			true,
		);
		expect(
			shots.some(
				(shot) =>
					shot.visual_role === "document" &&
					typeof shot.source_confidence === "number" &&
					shot.source_confidence >= 80,
			),
		).toBe(true);
	});

	it("video scenes keep video shots with trims", () => {
		const shots = buildSceneShots(
			{
				narration: "현장 영상이 공개되며 수사 방향이 바뀌었다.",
				type: "video",
				visualPrompt: "night road investigation footage",
				duration: 8,
				sourceIndex: 1,
			},
			[
				{ type: "image", title: "기사", url: "https://example.com/a.jpg" },
				{ type: "video", title: "현장 영상", eventTitle: "현장 수색" },
			],
		);

		const videoShots = shots.filter((shot) => shot.media_type === "video");
		expect(videoShots.length).toBeGreaterThan(0);
		expect(
			videoShots.every((shot) => typeof shot.trim_start === "number"),
		).toBe(true);
		expect(videoShots.every((shot) => typeof shot.trim_end === "number")).toBe(
			true,
		);
	});

	it("video scenes can mix image evidence shots with video shots", () => {
		const shots = buildSceneShots(
			{
				narration:
					"수사팀은 현장 영상과 함께 협박 편지, 통화 녹취를 교차 검토했다.",
				type: "video",
				visualPrompt: "night road investigation footage",
				duration: 10,
				sourceIndex: 2,
				newsTitle: "현장 영상과 협박 편지 분석",
				newsDate: "1991-02-03",
			},
			[
				{
					type: "article",
					title: "수사 기사",
					eventTitle: "현장 영상과 협박 편지 분석",
					eventDate: "1991-02-03",
					description: "편지와 녹취 내용이 새로운 단서로 떠올랐다.",
				},
				{
					type: "image",
					title: "증거 사진",
					url: "https://example.com/evidence.jpg",
					eventTitle: "현장 영상과 협박 편지 분석",
					eventDate: "1991-02-03",
				},
				{
					type: "video",
					title: "현장 영상",
					eventTitle: "현장 영상과 협박 편지 분석",
					eventDate: "1991-02-03",
				},
			],
		);

		expect(shots.some((shot) => shot.media_type === "video")).toBe(true);
		expect(shots.some((shot) => shot.media_type === "image")).toBe(true);
		expect(
			shots.some(
				(shot) =>
					shot.kind === "evidence" &&
					shot.media_type === "image" &&
					shot.source_url === "https://example.com/evidence.jpg",
			),
		).toBe(true);
	});

	it("image scenes can mix video shots when video sources exist", () => {
		const shots = buildSceneShots(
			{
				narration:
					"현장 검증 영상과 CCTV 장면이 교차로 공개되며 사건 흐름이 더 또렷해졌다.",
				type: "image",
				visualPrompt: "crime scene reconstruction and surveillance review",
				duration: 9,
				sourceIndex: 0,
				newsTitle: "현장 검증과 CCTV 공개",
				newsDate: "1991-02-05",
			},
			[
				{
					type: "video",
					title: "현장 검증 영상",
					url: "https://example.com/reconstruction.mp4",
					eventTitle: "현장 검증과 CCTV 공개",
					eventDate: "1991-02-05",
				},
				{
					type: "article",
					title: "수사 기사",
					eventTitle: "현장 검증과 CCTV 공개",
					description: "수사팀은 CCTV와 현장 검증을 교차 분석했다.",
				},
			],
		);

		expect(shots.some((shot) => shot.media_type === "video")).toBe(true);
		expect(shots.some((shot) => shot.media_type === "image")).toBe(true);
		expect(
			shots
				.filter((shot) => shot.media_type === "video")
				.every((shot) => typeof shot.trim_start === "number"),
		).toBe(true);
	});

	it("edit-first planner creates dense mixed cuts from video, image, and article sources", () => {
		const shots = buildSceneShots(
			{
				narration:
					"CCTV 공개 직후 기사 원문과 현장 사진이 교차 검증되며 사건 흐름이 바뀌었다.",
				type: "image",
				visualPrompt: "surveillance review with newspaper source and scene photo",
				duration: 6.2,
				sourceIndex: 0,
				newsTitle: "CCTV 공개와 기사 원문 대조",
				newsDate: "1991-02-08",
			},
			[
				{
					type: "video",
					title: "CCTV 원본",
					url: "https://example.com/cctv.mp4",
					eventTitle: "CCTV 공개와 기사 원문 대조",
					eventDate: "1991-02-08",
				},
				{
					type: "image",
					title: "현장 사진",
					url: "https://example.com/scene.jpg",
					eventTitle: "CCTV 공개와 기사 원문 대조",
					eventDate: "1991-02-08",
				},
				{
					type: "article",
					title: "기사 원문",
					eventTitle: "CCTV 공개와 기사 원문 대조",
					eventDate: "1991-02-08",
					description: "기사 원문과 현장 사진이 같은 시간대를 가리켰다.",
				},
			],
		);

		expect(shots.length).toBeGreaterThanOrEqual(5);
		expect(shots.some((shot) => shot.media_type === "video")).toBe(true);
		expect(shots.some((shot) => shot.media_type === "image")).toBe(true);
		expect(
			shots.some(
				(shot) =>
					shot.source_index === 2 &&
					(shot.visual_role === "document" ||
						shot.visual_role === "evidence"),
			),
		).toBe(true);
		expect(
			shots
				.filter((shot) => shot.media_type === "video")
				.every(
					(shot) =>
						typeof shot.trim_start === "number" &&
						typeof shot.trim_end === "number",
				),
		).toBe(true);
	});

	it("고모션 이미지 씬은 정확히 맞는 영상 소스를 우선 사용한다", () => {
		const shots = buildSceneShots(
			{
				narration:
					"CCTV와 현장 영상이 공개되며 도주 경로와 추격 장면이 다시 분석됐다.",
				type: "image",
				visualPrompt: "surveillance reveal and pursuit reconstruction",
				duration: 4.2,
				sourceIndex: 0,
				newsTitle: "도주 경로 CCTV 공개",
				newsDate: "1991-02-06",
			},
			[
				{
					type: "video",
					title: "도주 경로 CCTV",
					url: "https://example.com/escape-cctv.mp4",
					eventTitle: "도주 경로 CCTV 공개",
					eventDate: "1991-02-06",
				},
				{
					type: "article",
					title: "수사 기사",
					eventTitle: "도주 경로 CCTV 공개",
					eventDate: "1991-02-06",
				},
			],
		);

		expect(shots[0]?.media_type).toBe("video");
		expect(shots[0]?.source_url).toBe("https://example.com/escape-cctv.mp4");
	});

	it("CCTV 중심 컨텍스트 씬은 context/evidence 샷도 영상으로 유지할 수 있다", () => {
		const shots = buildSceneShots(
			{
				narration:
					"공개된 CCTV 영상 속 추적 장면과 현장 재구성 영상이 사건 순서를 다시 보여줬다.",
				type: "image",
				visualPrompt: "cctv pursuit timeline reconstruction",
				duration: 5,
				sourceIndex: 0,
				newsTitle: "추적 장면 CCTV 공개",
				newsDate: "1991-02-07",
			},
			[
				{
					type: "video",
					title: "추적 장면 CCTV",
					url: "https://example.com/chase-cctv.mp4",
					eventTitle: "추적 장면 CCTV 공개",
					eventDate: "1991-02-07",
				},
				{
					type: "article",
					title: "재구성 기사",
					eventTitle: "추적 장면 CCTV 공개",
					eventDate: "1991-02-07",
					description: "영상 속 동선과 시간 순서가 다시 정리됐다.",
				},
			],
		);

		expect(
			shots.some(
				(shot) =>
					(shot.kind === "context" || shot.kind === "evidence") &&
					shot.media_type === "video",
			),
		).toBe(true);
	});

	it("plans evidence-heavy scenes with article-driven evidence shots", () => {
		const shots = buildSceneShots(
			{
				narration:
					"범인의 협박 전화 녹취와 몸값 요구 메모가 결정적 증거가 됐다.",
				type: "image",
				visualPrompt: "crime desk with cassette recorder and ransom note",
				duration: 10,
				sourceIndex: 1,
				newsTitle: "협박 전화와 메모 확보",
				newsExcerpt: "통화 녹취와 메모 필체가 수사의 핵심 단서가 됐다.",
			},
			[
				{
					type: "image",
					title: "현장 탁자",
					url: "https://example.com/desk.jpg",
				},
				{
					type: "article",
					title: "수사 기사",
					eventTitle: "협박 전화와 메모 확보",
					description: "수사팀은 협박 전화 녹취와 메모를 집중 분석했다.",
				},
			],
		);

		expect(shots.map((shot) => shot.kind)).toContain("evidence");
		expect(shots.some((shot) => shot.overlay === "evidence")).toBe(true);
		expect(
			shots.some(
				(shot) =>
					shot.kind === "evidence" &&
					shot.source_index === 1 &&
					shot.visual_prompt?.includes("forensic evidence"),
			),
		).toBe(true);
	});

	it("plans witness scenes with quote-led prompts", () => {
		const shots = buildSceneShots(
			{
				narration:
					"목격자는 그날 밤 골목 끝에서 아이를 데리고 가는 남자를 봤다고 진술했다.",
				type: "image",
				visualPrompt: "narrow alley at night with a single streetlight",
				duration: 9,
				sourceIndex: 0,
				newsTitle: "목격자 진술 확보",
				newsExcerpt:
					"목격자는 남자의 옷차림과 동선을 비교적 선명하게 기억했다.",
			},
			[
				{
					type: "article",
					title: "목격자 기사",
					eventTitle: "목격자 진술 확보",
					description: "목격자 증언이 공개되며 수사선이 좁혀졌다.",
				},
			],
		);

		const quoteShot = shots.find((shot) => shot.kind === "quote");
		expect(quoteShot).toBeTruthy();
		expect(quoteShot?.overlay).toBe("quote");
		expect(quoteShot?.visual_prompt).toContain("witness statement tension");
	});

	it("keeps existing shots but normalizes durations", () => {
		const shots = ensureSceneShots(
			{
				narration: "같은 증거를 여러 번 보여준다.",
				type: "image",
				visualPrompt: "",
				duration: 6,
				shots: [
					{
						id: "a",
						kind: "detail",
						duration_seconds: 1,
					},
					{
						id: "b",
						kind: "evidence",
						duration_seconds: 1,
					},
				],
			},
			[],
		);

		expect(shots).toHaveLength(2);
		expect(
			shots.reduce((sum, shot) => sum + shot.duration_seconds, 0),
		).toBeCloseTo(6, 1);
	});

	it("syncs scene metadata to the newly assigned source", () => {
		const scene = syncSceneMetadataFromSource(
			{
				narration: "장면",
				type: "image",
				visualPrompt: "",
				duration: 5,
				newsTitle: "예전 제목",
				newsSource: "예전 출처",
				newsDate: "1990-01-01",
				newsExcerpt: "예전 발췌",
			},
			{
				type: "article",
				title: "기사 제목",
				eventTitle: "새 사건 시점",
				eventDate: "1991-01-29",
				publisher: "연합뉴스",
				description: "새 발췌",
			},
		);

		expect(scene.newsTitle).toBe("새 사건 시점");
		expect(scene.newsSource).toBe("연합뉴스");
		expect(scene.newsDate).toBe("1991-01-29");
		expect(scene.newsExcerpt).toBe("새 발췌");
	});

	it("filters source compatibility by scene type", () => {
		expect(isSourceCompatible("video", "video")).toBe(true);
		expect(isSourceCompatible("video", "article")).toBe(false);
		expect(isSourceCompatible("image", "video")).toBe(true);
		expect(isSourceCompatible("news_overlay", "article")).toBe(true);
	});

	it("rebalances scenes toward video-heavy output", () => {
		const rebalanced = rebalanceScenesForMotion(
			[
				{
					narration: "현장 CCTV가 공개되며 수사 방향이 바뀌었다.",
					type: "image",
					visualPrompt: "surveillance camera reveal",
					duration: 4,
				},
				{
					narration: "형사들은 밤새 현장을 수색했다.",
					type: "image",
					visualPrompt: "police search operation at night",
					duration: 5,
				},
				{
					narration: "협박 편지의 문구가 결정적 단서가 됐다.",
					type: "image",
					visualPrompt: "ransom note close-up",
					duration: 5,
				},
			],
			[
				{
					type: "video",
					title: "현장 CCTV",
					url: "https://example.com/cctv.mp4",
				},
				{
					type: "video",
					title: "수색 영상",
					url: "https://example.com/search.mp4",
				},
				{ type: "article", title: "협박 편지 기사" },
			],
		);

		const videoCount = rebalanced.filter(
			(scene) => (scene.type as string) === "video",
		).length;
		expect(videoCount).toBeGreaterThanOrEqual(2);
	});

	it("keeps the first 10 seconds mostly video-heavy", () => {
		const rebalanced = rebalanceScenesForMotion(
			[
				{
					narration: "현장 CCTV가 처음 공개됐다.",
					type: "image",
					visualPrompt: "surveillance reveal",
					duration: 4,
				},
				{
					narration: "수사팀이 골목을 재수색했다.",
					type: "image",
					visualPrompt: "police search in alley",
					duration: 3,
				},
				{
					narration: "도주 장면이 다시 분석됐다.",
					type: "image",
					visualPrompt: "escape route review",
					duration: 3,
				},
				{
					narration: "협박 편지의 문구가 단서가 됐다.",
					type: "image",
					visualPrompt: "ransom note close-up",
					duration: 5,
				},
			],
			[
				{
					type: "video",
					title: "현장 CCTV",
					url: "https://example.com/cctv.mp4",
				},
				{
					type: "video",
					title: "수색 영상",
					url: "https://example.com/search.mp4",
				},
				{
					type: "video",
					title: "도주 경로 영상",
					url: "https://example.com/escape.mp4",
				},
				{ type: "article", title: "협박 편지 기사" },
			],
		);

		let elapsed = 0;
		let hookTotal = 0;
		let hookVideo = 0;
		for (const scene of rebalanced) {
			if (elapsed >= 10) break;
			hookTotal += scene.duration;
			if ((scene.type as string) === "video") hookVideo += scene.duration;
			elapsed += scene.duration;
		}

		expect(hookVideo / hookTotal).toBeGreaterThanOrEqual(0.8);
	});

	it("intensifies hook scenes with harder transitions", () => {
		const intensified = intensifyHookScenes([
			{
				narration: "첫 장면",
				type: "video",
				visualPrompt: "opening footage",
				duration: 4,
				transition: "crossfade",
				mood: "neutral",
			},
			{
				narration: "둘째 장면",
				type: "video",
				visualPrompt: "second footage",
				duration: 3,
				transition: "crossfade",
				mood: "neutral",
			},
			{
				narration: "셋째 장면",
				type: "image",
				visualPrompt: "third footage",
				duration: 3,
				transition: "crossfade",
				mood: "neutral",
			},
			{
				narration: "넷째 장면",
				type: "image",
				visualPrompt: "later scene",
				duration: 6,
				transition: "crossfade",
				mood: "neutral",
			},
		]);

		expect(intensified[0].transition).toBe("none");
		expect(intensified[1].transition).toBe("none");
		expect(["whip_left", "whip_right"]).toContain(
			intensified[2].transition as string,
		);
		expect(intensified[0].mood).toBe("mystery");
		expect(intensified[3].transition).toBe("crossfade");
	});

	it("applies common shorts rules to pacing and transition hardness", () => {
		const adjusted = applyShortsVideoRules(
			[
				{
					narration: "첫 장면에서 사건 핵심을 바로 던진다.",
					type: "image",
					visualPrompt: "opening alley footage",
					duration: 5.2,
					transition: "crossfade",
					mood: "neutral",
				},
				{
					narration: "CCTV가 공개되며 수사 방향이 뒤집혔다.",
					type: "image",
					visualPrompt: "cctv reveal",
					duration: 4.8,
					transition: "crossfade",
					mood: "neutral",
				},
				{
					narration: "형사들은 밤새 골목을 다시 수색했다.",
					type: "image",
					visualPrompt: "night search operation",
					duration: 4.6,
					transition: "crossfade",
					mood: "neutral",
				},
				{
					narration: "결정적 메모 한 장이 반전을 만들었다.",
					type: "text_emphasis",
					visualPrompt: "ransom note text emphasis",
					duration: 3.4,
					transition: "crossfade",
					mood: "neutral",
					textEffect: "none",
				},
				{
					narration: "마지막으로 남은 질문은 단 하나였다.",
					type: "image",
					visualPrompt: "final question close up",
					duration: 5.1,
					transition: "crossfade",
					mood: "neutral",
				},
			],
			[
				{
					type: "video",
					title: "현장 CCTV",
					url: "https://example.com/cctv.mp4",
				},
				{
					type: "video",
					title: "수색 영상",
					url: "https://example.com/search.mp4",
				},
				{
					type: "video",
					title: "현장 재구성",
					url: "https://example.com/rebuild.mp4",
				},
				{ type: "article", title: "메모 기사" },
			],
		);

		expect(adjusted[0].duration).toBeLessThanOrEqual(2.4);
		expect(adjusted[adjusted.length - 1].duration).toBeLessThanOrEqual(2.8);

		const nonTextScenes = adjusted.filter(
			(scene) =>
				(scene.type as string) !== "text_emphasis" &&
				(scene.type as string) !== "news_overlay",
		);
		const videoCount = nonTextScenes.filter(
			(scene) => (scene.type as string) === "video",
		).length;
		expect(videoCount).toBeGreaterThanOrEqual(
			Math.ceil(nonTextScenes.length * 0.75),
		);

		const transitions = adjusted.slice(1).map((scene) => scene.transition);
		const hardCount = transitions.filter((transition) =>
			["none", "whip_left", "whip_right", "glitch"].includes(
				transition as string,
			),
		).length;
		expect(hardCount / transitions.length).toBeGreaterThanOrEqual(0.7);
		expect(adjusted[3].transition).toBe("glitch");
	});

	it("uses edit-first visual interrupts instead of standalone punch cards", () => {
		const adjusted = applyShortsVideoRules(
			[
				{
					narration: "첫 단서는 폐가 안에서 발견된 오래된 메모였다.",
					type: "video",
					visualPrompt: "abandoned house exterior",
					duration: 2.4,
					transition: "none",
					mood: "mystery",
				},
				{
					narration: "그 메모에는 사라진 아이의 이름과 날짜가 적혀 있었다.",
					type: "video",
					visualPrompt: "old memo close up",
					duration: 3.4,
					transition: "crossfade",
					mood: "neutral",
				},
				{
					narration: "그런데 메모가 작성된 시점에는 이미 아이가 실종된 뒤였다.",
					type: "video",
					visualPrompt: "timeline board",
					duration: 3.8,
					transition: "crossfade",
					mood: "neutral",
				},
				{
					narration: "형사들은 같은 이름이 적힌 또 다른 문서를 찾아냈다.",
					type: "video",
					visualPrompt: "detectives searching documents",
					duration: 3.6,
					transition: "crossfade",
					mood: "neutral",
				},
				{
					narration: "마지막 문장은 사건이 아직 끝나지 않았다는 뜻처럼 보였다.",
					type: "video",
					visualPrompt: "final clue close up",
					duration: 3.5,
					transition: "crossfade",
					mood: "neutral",
				},
			],
			[
				{
					type: "video",
					title: "폐가 영상",
					url: "https://example.com/house.mp4",
				},
				{
					type: "video",
					title: "문서 영상",
					url: "https://example.com/doc.mp4",
				},
			],
		);

		const interruptScenes = adjusted.filter(
			(scene) =>
				scene.transition === "glitch" &&
				(scene.type as string) !== "text_emphasis",
		);
		expect(adjusted.some((scene) => (scene.type as string) === "text_emphasis")).toBe(
			false,
		);
		expect(interruptScenes.length).toBeGreaterThanOrEqual(1);
		expect(interruptScenes.every((scene) => scene.duration <= 2.2)).toBe(true);
		expect(
			interruptScenes.every((scene) =>
				scene.visualPrompt.includes("subtitle-safe lower third area"),
			),
		).toBe(true);
	});

	it("applyShortsVideoRules 후 훅 10초 구간 video 비중이 60% 이상이다", () => {
		const sources = [
			{
				type: "video" as const,
				title: "현장 영상",
				url: "https://example.com/v.mp4",
			},
			{
				type: "image" as const,
				title: "현장 사진",
				url: "https://example.com/i.jpg",
			},
			{
				type: "article" as const,
				title: "기사",
				url: "https://example.com/a",
				bodyText: "사건 내용",
			},
		];
		const scenes = [
			{
				narration: "충격적인 사건이 발생했다.",
				type: "image" as const,
				visualPrompt: "crime scene footage",
				duration: 2.0,
			},
			{
				narration: "형사들이 현장에 도착했다.",
				type: "image" as const,
				visualPrompt: "detective investigation",
				duration: 2.5,
			},
			{
				narration: "CCTV 영상이 공개됐다.",
				type: "image" as const,
				visualPrompt: "surveillance footage",
				duration: 2.5,
			},
			{
				narration: "용의자의 정체가 밝혀지기 시작했다.",
				type: "image" as const,
				visualPrompt: "suspect profile",
				duration: 3.0,
			},
			{
				narration: "결정적 증거가 발견됐다.",
				type: "image" as const,
				visualPrompt: "forensic evidence",
				duration: 3.0,
			},
		];

		const result = applyShortsVideoRules(scenes, sources);

		let hookDuration = 0;
		let hookVideoDuration = 0;
		let cursor = 0;
		for (const scene of result) {
			if (cursor < 10) {
				const overlap = Math.min(scene.duration, 10 - cursor);
				hookDuration += overlap;
				if ((scene as { type: string }).type === "video") {
					hookVideoDuration += overlap;
				}
			}
			cursor += scene.duration;
		}

		expect(hookDuration).toBeGreaterThan(0);
		expect(hookVideoDuration / hookDuration).toBeGreaterThanOrEqual(0.6);
	});

	it("applyShortsVideoRules transition에서 hard 전환이 crossfade보다 많다", () => {
		const sources = [
			{
				type: "video" as const,
				title: "영상",
				url: "https://example.com/v.mp4",
			},
		];
		const scenes = Array.from({ length: 10 }, (_, i) => ({
			narration: `씬 ${i + 1}번 나레이션`,
			type: "image" as const,
			visualPrompt: "test scene documentary",
			duration: 3.0,
		}));

		const result = applyShortsVideoRules(scenes, sources);

		const transitions = result
			.map((s) => (s as { transition?: string }).transition)
			.filter(Boolean);
		const crossfadeCount = transitions.filter((t) => t === "crossfade").length;
		const hardCount = transitions.filter(
			(t) =>
				t === "none" ||
				t === "whip_left" ||
				t === "whip_right" ||
				t === "glitch",
		).length;

		expect(hardCount).toBeGreaterThan(crossfadeCount);
	});

	it("intensifyHookScenes는 첫 10초 씬에 whip/none 전환만 배정한다", () => {
		const hookScenes = [
			{
				narration: "훅",
				type: "video" as const,
				visualPrompt: "hook",
				duration: 2.0,
			},
			{
				narration: "두번째",
				type: "video" as const,
				visualPrompt: "second",
				duration: 2.5,
			},
			{
				narration: "세번째",
				type: "image" as const,
				visualPrompt: "third",
				duration: 2.5,
			},
			{
				narration: "네번째",
				type: "image" as const,
				visualPrompt: "fourth",
				duration: 2.5,
			},
			{
				narration: "다섯번째 — 훅 영역 밖",
				type: "image" as const,
				visualPrompt: "fifth out of hook",
				duration: 8.0,
			},
		];

		const result = intensifyHookScenes(hookScenes);

		// 첫 4개 씬은 hook 10초 안 (누적 2+2.5+2.5+2.5=9.5s)
		for (const scene of result.slice(0, 4)) {
			const t = (scene as { transition?: string }).transition ?? "none";
			expect(["none", "whip_left", "whip_right"]).toContain(t);
		}
	});
});

// ─── 추가 분기 커버리지 ────────────────────────────────────────────────────────
describe("scene-shots 추가 분기", () => {
	it("applyShortsVideoRules: news_overlay 씬 → maxDuration 3.2 cap", () => {
		const scenes = [
			{
				narration: "뉴스 오버레이",
				type: "news_overlay" as const,
				visualPrompt: "",
				duration: 5.0,
			},
			{
				narration: "일반",
				type: "image" as const,
				visualPrompt: "",
				duration: 3.0,
			},
		];
		const result = applyShortsVideoRules(scenes, []);
		// news_overlay 씬 duration은 3.2 이하
		expect(result[0].duration).toBeLessThanOrEqual(3.2);
	});

	it("applyShortsVideoRules: text_emphasis는 카드가 아닌 edit-first 이미지 씬으로 변환한다", () => {
		const scenes = [
			{
				narration: "텍스트 강조",
				type: "text_emphasis" as const,
				visualPrompt: "",
				duration: 2.0,
			},
			{
				narration: "뉴스 오버레이",
				type: "news_overlay" as const,
				visualPrompt: "",
				duration: 2.0,
			},
			{
				narration: "일반 이미지",
				type: "image" as const,
				visualPrompt: "scene",
				duration: 2.0,
			},
		];
		const sources = [
			{
				type: "video" as const,
				url: "https://video.example.com/v.mp4",
				title: "test",
				width: 1920,
				height: 1080,
				duration: 30,
			},
		];
		const result = applyShortsVideoRules(scenes, sources);
		expect(result[0].type).not.toBe("text_emphasis");
		expect(["image", "video"]).toContain(result[0].type);
		const converted = result[0] as (typeof result)[number] & {
			sourceIndex?: number;
			visualPrompt: string;
		};
		expect(converted.sourceIndex).toBe(0);
		expect(converted.visualPrompt).toContain("subtitle-safe lower third area");
		expect(result[1].type).toBe("news_overlay");
	});

	it("intensifyHookScenes: hook 범위 내 text_emphasis 씬 → textEffect와 mood 업데이트", () => {
		const scenes = [
			{
				narration: "훅 텍스트",
				type: "text_emphasis" as const,
				visualPrompt: "",
				duration: 2.0,
				textEffect: "none",
				mood: "neutral",
				transition: "none" as const,
			},
		];
		const result = intensifyHookScenes(scenes);
		const s = result[0];
		expect(s.transition).toBe("none"); // 첫 번째 씬
		expect(s.textEffect).toBe("glitch");
		expect(s.mood).toBe("mystery");
	});

	it("intensifyHookScenes: hook 범위 내 news_overlay → 변경 없이 반환", () => {
		const scenes = [
			{
				narration: "뉴스 오버레이",
				type: "news_overlay" as const,
				visualPrompt: "",
				duration: 2.0,
				transition: "crossfade",
				mood: "neutral",
			},
		];
		const result = intensifyHookScenes(scenes);
		const s = result[0] as (typeof scenes)[0];
		expect(s.type).toBe("news_overlay");
	});

	it("applyLongformVideoRules: 롱폼은 쇼츠처럼 video 75%로 몰지 않는다", () => {
		const scenes = Array.from({ length: 10 }, (_, index) => ({
			narration: `롱폼 씬 ${index + 1} 나레이션`,
			type: "image" as const,
			visualPrompt:
				index % 2 === 0
					? "detective searches street footage"
					: "official document evidence",
			duration: 14,
		}));
		const sources = [
			{ type: "video" as const, title: "현장 영상", url: "https://v.com/a" },
			{ type: "video" as const, title: "수색 영상", url: "https://v.com/b" },
			{ type: "article" as const, title: "기사", url: "https://n.com/a" },
		];

		const result = applyLongformVideoRules(scenes, sources);
		const videoCount = result.filter(
			(scene) => (scene as { type: string }).type === "video",
		).length;

		expect(videoCount).toBeGreaterThanOrEqual(4);
		expect(videoCount).toBeLessThanOrEqual(6);
		expect(result.every((scene) => scene.duration >= 10)).toBe(true);
		expect(result.reduce((sum, scene) => sum + scene.duration, 0)).toBeGreaterThanOrEqual(359);
	});

	it("applyLongformVideoRules: 롱폼 전환은 crossfade/slide/zoom 중심이다", () => {
		const scenes = Array.from({ length: 8 }, (_, index) => ({
			narration: `롱폼 씬 ${index + 1}`,
			type: index === 4 ? ("text_emphasis" as const) : ("image" as const),
			visualPrompt: "documentary scene",
			duration: index === 4 ? 4 : 18,
			transition: "glitch",
		}));

		const result = applyLongformVideoRules(scenes, []);
		const transitions = result.map((scene) => scene.transition);

		expect(transitions.every((transition) => transition !== "whip_left")).toBe(
			true,
		);
		expect(transitions.every((transition) => transition !== "whip_right")).toBe(
			true,
		);
		expect(transitions.filter((transition) => transition === "crossfade").length)
			.toBeGreaterThanOrEqual(4);
	});

	it("applyLongformVideoRules: 영상 소스가 없어도 기존 video 씬은 검색 기회를 보존한다", () => {
		const scenes = [
			{
				narration: "현장 동선을 영상으로 보여준다.",
				type: "video" as const,
				visualPrompt: "street search operation footage",
				duration: 16,
			},
			{
				narration: "공식 문서를 근거로 정리한다.",
				type: "image" as const,
				visualPrompt: "official document close up",
				duration: 16,
			},
			{
				narration: "남은 의문을 차분히 정리한다.",
				type: "image" as const,
				visualPrompt: "quiet documentary ending",
				duration: 16,
			},
			{
				narration: "수사 흐름을 이어서 설명한다.",
				type: "image" as const,
				visualPrompt: "case timeline board",
				duration: 16,
			},
			{
				narration: "핵심 반전을 짚는다.",
				type: "text_emphasis" as const,
				visualPrompt: "key question text",
				duration: 4,
			},
			{
				narration: "현재 상황을 정리한다.",
				type: "image" as const,
				visualPrompt: "news archive desk",
				duration: 16,
			},
		];

		const result = applyLongformVideoRules(scenes, []);

		expect((result[0] as { type: string }).type).toBe("video");
	});

	it("applyLongformVideoRules: 장편 레퍼런스 목표 길이면 6분 고정으로 줄이지 않는다", () => {
		const scenes = Array.from({ length: 64 }, (_, index) => ({
			narration: `장편 몰아보기 씬 ${index + 1}`,
			type: index % 5 === 0 ? ("video" as const) : ("image" as const),
			visualPrompt: "drama recap character relationship and plot turn",
			duration: 24,
		}));

		const result = applyLongformVideoRules(scenes, [], {
			targetTotalSeconds: 5160,
		});
		const total = result.reduce((sum, scene) => sum + scene.duration, 0);

		expect(total).toBeGreaterThanOrEqual(5000);
		expect(result.every((scene) => scene.duration <= 180)).toBe(true);
		expect((result[0] as { transition?: string }).transition).toBe("none");
	});
});
