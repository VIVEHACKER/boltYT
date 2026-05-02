/**
 * AI 에이전트 체인 — OpenMontage 참고
 *
 * 1. Research Director: 주제 리서치 → 팩트/타임라인/인물 수집
 * 2. Scene Director: 씬별 최적 검색 쿼리 생성
 * 3. QC Director: 렌더 품질 검증
 */

import { getApiProxyUrl } from "./proxy";
import { analyzeYouTubePolicyRisk } from "./youtube-policy-risk";

async function callAI(
	system: string,
	user: string,
	temperature = 0.7,
): Promise<string> {
	const proxy = getApiProxyUrl();

	const res = await fetch(`${proxy}/api/openai/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "gpt-4o",
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			temperature,
		}),
		signal: AbortSignal.timeout(60_000),
	});

	if (!res.ok) throw new Error(`AI 오류: ${res.status}`);
	const json = await res.json();
	const content = json.choices?.[0]?.message?.content;
	if (!content) throw new Error("AI 응답에 content가 없습니다");
	return content;
}

function parseJSON<T>(raw: string): T {
	const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
	return JSON.parse(cleaned);
}

// ─── 1. Research Director ───

export interface ResearchBrief {
	summary: string;
	timeline: Array<{ date: string; event: string }>;
	key_figures: Array<{ name: string; role: string }>;
	facts: string[];
	misconceptions: string[];
	search_keywords: string[];
}

/**
 * 주제를 리서치하여 팩트 기반 브리프 생성
 * — 스크립트 생성 전에 호출하면 AI가 사실을 지어내지 않음
 */
export async function researchTopic(title: string): Promise<ResearchBrief> {
	const result = await callAI(
		`당신은 한국 사건/사고/미스테리 전문 리서처입니다.
주어진 주제에 대해 정확한 팩트를 수집하세요.

규칙:
- 확인된 사실만 작성. 추측/루머 금지.
- 날짜, 인물 이름, 장소, 수치는 최대한 구체적으로.
- 대중이 잘못 알고 있는 오해(misconceptions)도 포함.
- search_keywords: 이 주제로 이미지/영상을 검색할 때 좋은 한국어 키워드 10개.
반드시 JSON으로만 응답.`,
		`주제: ${title}

응답 형식:
{
  "summary": "사건 요약 (3-5문장)",
  "timeline": [{"date": "1986.09.15", "event": "1차 사건 발생"}],
  "key_figures": [{"name": "이춘재", "role": "범인"}],
  "facts": ["구체적 팩트 1", "구체적 팩트 2"],
  "misconceptions": ["대중의 오해 1"],
  "search_keywords": ["키워드1", "키워드2"]
}`,
		0.3, // 낮은 temperature — 팩트 정확도 우선
	);

	return parseJSON<ResearchBrief>(result);
}

// ─── 2. Scene Director ───

export interface SceneVisualPlan {
	scenes: Array<{
		index: number;
		search_query_ko: string;
		search_query_en: string;
		visual_mood: string;
		preferred_source: "video" | "image";
	}>;
}

export interface SceneSourceAssignmentPlan {
	scenes: Array<{
		index: number;
		source_index: number;
		event_title?: string;
		event_date?: string;
	}>;
}

/**
 * 씬별 최적 검색 쿼리 생성
 * — 나레이션 텍스트 → 시맨틱하게 맞는 영상/이미지 검색어
 */
export async function planSceneVisuals(
	scenes: Array<{
		narration: string;
		type: string;
		sourceTitle?: string;
		sourceDate?: string;
	}>,
	topicTitle: string,
	researchKeywords: string[],
): Promise<SceneVisualPlan> {
	const sceneList = scenes
		.map((s, i) =>
			[
				`씬${i + 1} [${s.type}]`,
				s.sourceTitle ? `출처 제목: ${s.sourceTitle}` : "",
				s.sourceDate ? `시점: ${s.sourceDate}` : "",
				`나레이션: ${s.narration.slice(0, 100)}`,
			]
				.filter(Boolean)
				.join(" | "),
		)
		.join("\n");

	const result = await callAI(
		`당신은 영상 편집 디렉터입니다. 각 씬의 나레이션을 읽고, 배경에 깔릴 영상/이미지를 검색하기 위한 최적의 검색어를 만들어주세요.

규칙:
- 씬 순서를 절대 바꾸지 말고, 앞 씬 다음에 자연스럽게 이어지는 화면을 상상하세요.
- search_query_ko: 한국어 검색어 (네이버/YouTube 검색용). 주제와 직접 관련된 구체적 키워드.
- search_query_en: 영어 검색어 (Pexels/Pixabay 검색용). 장소+행동 중심. "어두운 분위기" 같은 추상 표현 금지.
- visual_mood: "무드 묘사" 금지. 대신 "장소+인물/대상+행동" 형식으로: "야간 부두에서 우비 입은 형사들이 손전등으로 수색".
- 나레이션 내용을 "그대로" 검색하지 말고, 해당 씬이 다루는 사건/장소/시점에 맞는 화면을 상상하세요.
- preferred_source: 수색·추격·체포·현장·재구성 등 움직임이 있으면 반드시 "video". 문서·증거·인터뷰 등 정적이면 "image".
- 같은 검색어를 두 씬에서 반복하지 마세요.
반드시 JSON으로만 응답.`,
		`주제: ${topicTitle}
관련 키워드: ${researchKeywords.join(", ")}

=== 씬 목록 ===
${sceneList}

응답 형식:
{
  "scenes": [
    {
      "index": 1,
      "search_query_ko": "화성연쇄살인 수사 현장",
      "search_query_en": "dark rural road night investigation",
      "visual_mood": "어둡고 긴장감 있는",
      "preferred_source": "video"
    }
  ]
}`,
		0.5,
	);

	return parseJSON<SceneVisualPlan>(result);
}

export async function planSceneSourceAssignments(
	scenes: Array<{
		narration: string;
		type: string;
		currentSourceIndex?: number;
	}>,
	sources: Array<{
		type: string;
		title: string;
		description?: string;
		bodyText?: string;
		pubDate?: string;
		publisher?: string;
		eventDate?: string;
		eventTitle?: string;
	}>,
): Promise<SceneSourceAssignmentPlan> {
	const sceneList = scenes
		.map(
			(s, i) =>
				`씬${i + 1} [${s.type}] 현재자료:${s.currentSourceIndex ?? -1} | ${s.narration.slice(0, 140)}`,
		)
		.join("\n");
	const sourceList = sources
		.map((source, i) => {
			const excerpt = (source.bodyText || source.description || "").slice(
				0,
				220,
			);
			const meta = [
				source.type,
				source.publisher,
				source.eventDate ? `사건시점 ${source.eventDate}` : "",
				source.pubDate && source.pubDate !== source.eventDate
					? `기사일 ${source.pubDate}`
					: "",
			]
				.filter(Boolean)
				.join(" | ");
			return `[자료${i}] ${meta}\n제목: ${source.eventTitle || source.title}\n요약: ${excerpt}`;
		})
		.join("\n\n");

	const result = await callAI(
		`당신은 사건/다큐 영상의 타임라인 편집자입니다.
주어진 씬 순서는 유지한 채, 각 씬에 가장 맞는 자료를 사건 흐름에 맞게 배치하세요.

규칙:
- 씬 순서는 절대 바꾸지 마세요.
- index와 source_index는 모두 0부터 시작하는 번호를 사용하세요. 맞는 자료가 없으면 source_index는 -1.
- video 씬은 영상 자료를 우선, image/news_overlay 씬은 이미지나 기사 자료를 우선.
- text_emphasis 씬은 보통 -1로 두세요.
- 사건 흐름상 필요하면 같은 자료를 여러 씬에서 재사용해도 됩니다.
- 기사 발행일이 아니라 기사 내용 속 사건 순서를 보고 배치하세요.
- event_title, event_date에는 이 씬이 다루는 사건 순간을 짧게 정리하세요.
반드시 JSON으로만 응답.`,
		`=== 씬 목록 ===
${sceneList}

=== 자료 목록 ===
${sourceList}

응답 형식:
{
  "scenes": [
    {
      "index": 0,
      "source_index": 3,
      "event_title": "실종 당일 마지막 목격",
      "event_date": "1991-01-29"
    }
  ]
}`,
		0.2,
	);

	return parseJSON<SceneSourceAssignmentPlan>(result);
}

// ─── 2b. Scene Director — 촬영 지시 (샷 타입 / 카메라 무브 / BGM 무드) ───

export interface SceneDirective {
	index: number;
	shot_type: "wide" | "medium" | "close_up" | "extreme_close" | "aerial";
	camera_motion:
		| "static"
		| "slow_pan"
		| "zoom_in"
		| "zoom_out"
		| "handheld"
		| "tilt_up"
		| "tilt_down";
	bgm_mood: "tension" | "mysterious" | "sad" | "neutral" | "hopeful" | "horror";
	pacing: "slow" | "normal" | "fast";
	transition_to_next: "cut" | "crossfade" | "whip";
}

/**
 * 씬별 최적 촬영 방식 배정 (샷 타입, 카메라 무브, BGM 무드, 페이싱, 트랜지션)
 * — 나레이션 흐름을 분석하여 영상 연출 방향 결정
 */
export async function planSceneDirectives(
	scenes: Array<{ narration: string; type: string; index: number }>,
	brief: ResearchBrief,
	topicTitle: string,
): Promise<SceneDirective[]> {
	const sceneList = scenes
		.map(
			(s) =>
				`씬${s.index + 1} [${s.type}] 나레이션: ${s.narration.slice(0, 120)}`,
		)
		.join("\n");

	const result = await callAI(
		`당신은 한국 사건/다큐 영상의 촬영감독입니다. 나레이션 흐름을 읽고 씬별 최적 촬영 방식을 지정하세요.

배정 규칙:
- 도입부/충격 사실 → shot_type: wide, camera_motion: zoom_in, bgm_mood: tension
- 인물/증거 클로즈업 → shot_type: close_up, camera_motion: static
- 사건 현장 묘사 → shot_type: medium, camera_motion: slow_pan
- 반전/클라이맥스 → shot_type: extreme_close, camera_motion: handheld, bgm_mood: horror
- 해결/결말/마무리 → shot_type: wide, camera_motion: tilt_up, bgm_mood: hopeful 또는 neutral
- pacing: 나레이션이 빠르고 충격적이면 fast, 감정적·슬프면 slow, 나머지 normal
- transition_to_next: 긴장 상황 전환→cut, 감정 전환→crossfade, 빠른 템포 전환→whip
- aerial은 전체 상황·지형 설명 씬에만 사용

반드시 씬 순서를 유지하고 JSON 배열로만 응답.`,
		`주제: ${topicTitle}
사건 요약: ${brief.summary.slice(0, 200)}

=== 씬 목록 ===
${sceneList}

응답 형식 (배열):
[
  {
    "index": 0,
    "shot_type": "wide",
    "camera_motion": "zoom_in",
    "bgm_mood": "tension",
    "pacing": "fast",
    "transition_to_next": "cut"
  }
]`,
		0.4,
	);

	return parseJSON<SceneDirective[]>(result);
}

// ─── 3. QC Director ───

export interface QCReport {
	passed: boolean;
	overall_score: number;
	issues: Array<{
		scene_index: number;
		severity: "critical" | "warning" | "info";
		message: string;
	}>;
	suggestions: string[];
}

/**
 * 렌더링 품질 검증
 * — 씬 데이터를 분석하여 문제점 자동 감지
 */
export function verifySceneQuality(
	scenes: Array<{
		narration_text: string;
		scene_type: string;
		duration_seconds: number;
		imageUrl?: string;
		videoUrl?: string;
		audioUrl?: string;
		shots?: Array<{
			media_type?: "image" | "video";
			source_url?: string;
			duration_seconds?: number;
			visual_role?: string;
			motion?: string;
			source_confidence?: number;
			quality_score?: number;
			selection_provider?: string;
			rejection_reason?: string;
		}>;
	}>,
): QCReport {
	const issues: QCReport["issues"] = [];
	const suggestions: string[] = [];

	for (let i = 0; i < scenes.length; i++) {
		const s = scenes[i];
		const idx = i + 1;

		if (s.scene_type === "text_emphasis") {
			issues.push({
				scene_index: idx,
				severity: "critical",
				message: `씬 ${idx}: text_emphasis 단독 카드 씬은 금지 — 실제 영상/이미지 샷 위 자막으로 대체하세요`,
			});
		}

		// 비주얼 없는 씬
		if (!s.imageUrl && !s.videoUrl) {
			issues.push({
				scene_index: idx,
				severity: "critical",
				message: `씬 ${idx}: 배경 이미지/영상 없음 — 검은 화면으로 보일 수 있음`,
			});
		}

		const videoShots =
			s.shots?.filter((shot) => (shot.media_type ?? "video") === "video") ?? [];
		const resolvedVideoShots = videoShots.filter((shot) => shot.source_url);

		if (
			s.scene_type === "video" &&
			!s.videoUrl &&
			resolvedVideoShots.length === 0
		) {
			issues.push({
				scene_index: idx,
				severity: "warning",
				message: `씬 ${idx}: video 씬이지만 실제 영상 소스가 없음 — 이미지 슬라이드처럼 보일 수 있음`,
			});
		}

		if (
			videoShots.length > 0 &&
			resolvedVideoShots.length < Math.ceil(videoShots.length * 0.6)
		) {
			issues.push({
				scene_index: idx,
				severity: "warning",
				message: `씬 ${idx}: 영상 샷 ${videoShots.length}개 중 ${resolvedVideoShots.length}개만 연결됨 — 컷 품질 편차 가능`,
			});
		}

		const visualShots = s.shots ?? [];
		const resolvedShots = visualShots.filter((shot) => shot.source_url);
		const lowConfidenceShots = resolvedShots.filter(
			(shot) =>
				typeof shot.source_confidence === "number" &&
				shot.source_confidence < 55,
		);
		if (
			resolvedShots.length >= 3 &&
			lowConfidenceShots.length > resolvedShots.length * 0.3
		) {
			issues.push({
				scene_index: idx,
				severity: "warning",
				message: `씬 ${idx}: 저신뢰 시각 자료 ${lowConfidenceShots.length}/${resolvedShots.length}개 — 주제와 안 맞는 이미지가 섞일 수 있음`,
			});
		}

		const genericStockShots = resolvedShots.filter(
			(shot) =>
				(shot.selection_provider === "pexels" ||
					shot.selection_provider === "pixabay") &&
				shot.visual_role !== "context" &&
				shot.visual_role !== "transition",
		);
		if (genericStockShots.length > Math.max(1, resolvedShots.length * 0.4)) {
			issues.push({
				scene_index: idx,
				severity: "warning",
				message: `씬 ${idx}: 스톡 fallback 비중이 높음 — 기사/아카이브/지도/문서 자료 우선 보강 필요`,
			});
		}

		const reconstructionShots = visualShots.filter(
			(shot) => shot.visual_role === "reconstruction",
		);
		if (
			reconstructionShots.length > 0 &&
			s.scene_type !== "text_emphasis" &&
			reconstructionShots.length >= Math.ceil(visualShots.length * 0.6)
		) {
			issues.push({
				scene_index: idx,
				severity: "info",
				message: `씬 ${idx}: AI 재구성 비중이 높음 — 실제 자료처럼 보이지 않게 스타일/출처 표시 확인`,
			});
		}

		// 오디오 없는 씬
		if (!s.audioUrl) {
			issues.push({
				scene_index: idx,
				severity: "warning",
				message: `씬 ${idx}: TTS 음성 없음 — 무음 구간 발생`,
			});
		}

		// 너무 짧은 씬 (3초 미만)
		if (s.duration_seconds < 3) {
			issues.push({
				scene_index: idx,
				severity: "warning",
				message: `씬 ${idx}: ${s.duration_seconds}초로 너무 짧음 — 시청자가 내용 인식 어려움`,
			});
		}

		// 너무 긴 씬 (30초 초과)
		if (s.duration_seconds > 30) {
			issues.push({
				scene_index: idx,
				severity: "info",
				message: `씬 ${idx}: ${s.duration_seconds}초 — 긴 씬은 분할 고려`,
			});
		}

		// 나레이션 너무 긴 경우 (씬 길이 대비)
		const wordsPerSec = s.narration_text.length / s.duration_seconds;
		if (wordsPerSec > 8) {
			issues.push({
				scene_index: idx,
				severity: "warning",
				message: `씬 ${idx}: 나레이션이 씬 길이에 비해 너무 김 (${Math.round(wordsPerSec)}자/초)`,
			});
		}
	}

	// 전체 영상 분석
	const totalDuration = scenes.reduce((s, sc) => s + sc.duration_seconds, 0);
	if (totalDuration < 30) {
		suggestions.push("영상이 30초 미만 — 시청 유지율이 낮을 수 있음");
	}

	const videoScenes = scenes.filter((s) => {
		const hasVideoShot = s.shots?.some(
			(shot) => (shot.media_type ?? "video") === "video" && shot.source_url,
		);
		return s.videoUrl || hasVideoShot;
	});
	if (videoScenes.length === 0) {
		suggestions.push(
			"실제 영상 클립이 없음 — 모션 자료화면, 지도, 문서 크롭, 콜아웃 밀도로 보강 필요",
		);
	}

	if (scenes.length > 0 && videoScenes.length / scenes.length < 0.45) {
		suggestions.push(
			"실제 영상 소스 비율이 낮음 — 강제 AI 영상보다 훅/반전/엔딩 hero shot만 선택적으로 보강",
		);
	}

	const allShots = scenes.flatMap((scene) => scene.shots ?? []);
	const designedShots = allShots.filter(
		(shot) =>
			shot.source_url &&
			((shot.media_type ?? "video") === "video" ||
				shot.visual_role === "document" ||
				shot.visual_role === "evidence" ||
				shot.visual_role === "archive" ||
				shot.visual_role === "map" ||
				shot.visual_role === "data" ||
				(shot.motion && shot.motion !== "static")),
	);
	if (allShots.length > 0 && designedShots.length / allShots.length < 0.75) {
		suggestions.push(
			"설계된 자료화면 샷이 75% 미만 — 정적 이미지 나열 위험. 약한 샷만 재검색/모션 보강 필요",
		);
	}
	const sourceAnchoredShots = allShots.filter(
		(shot) =>
			shot.source_url &&
			shot.visual_role !== "reconstruction" &&
			(shot.selection_provider === "youtube" ||
				shot.selection_provider === "wikimedia" ||
				shot.selection_provider === "naver" ||
				shot.selection_provider === "direct" ||
				shot.visual_role === "document" ||
				shot.visual_role === "evidence" ||
				shot.visual_role === "archive"),
	);
	if (allShots.length > 0 && sourceAnchoredShots.length / allShots.length < 0.55) {
		suggestions.push(
			"소스 앵커가 있는 샷이 55% 미만 — 랜덤 이미지 나열처럼 보일 수 있음. 약한 샷만 재검색 권장",
		);
	}

	const textScenes = scenes.filter((s) => s.scene_type === "text_emphasis");
	if (textScenes.length > 0) {
		suggestions.push(
			"text_emphasis 단독 씬 금지 — 훅/반전은 영상/이미지 샷, 컷 전환, SFX, 자막 강조로 처리",
		);
	}

	const policyReport = analyzeYouTubePolicyRisk({
		scenes: scenes.map((scene) => ({
			narration_text: scene.narration_text,
			scene_type: scene.scene_type,
			shots: scene.shots,
		})),
	});
	for (const issue of policyReport.issues) {
		issues.push({
			scene_index: issue.sceneIndex ?? 0,
			severity: issue.severity,
			message: `YouTube 정책 리스크: ${issue.message}`,
		});
	}
	suggestions.push(...policyReport.requiredActions);

	const criticals = issues.filter((i) => i.severity === "critical").length;
	const warnings = issues.filter((i) => i.severity === "warning").length;
	const score = Math.max(0, 100 - criticals * 20 - warnings * 5);

	return {
		passed: criticals === 0 && score >= 75,
		overall_score: score,
		issues,
		suggestions,
	};
}

// ─── 3b. QC Director — Vision 업그레이드 ───

interface VisionIssue {
	severity: "critical" | "warning" | "info";
	message: string;
}

interface VisionResult {
	issues: VisionIssue[];
	score: number;
}

/**
 * GPT-4o Vision 기반 QC 검증
 * — 룰 기반 verifySceneQuality를 먼저 실행하고,
 *   imageUrl이 있는 critical/warning 씬만 Vision으로 추가 검증.
 * — Vision API 실패 시 룰 기반 결과만 반환 (graceful fallback).
 */
export async function verifySceneQualityWithVision(
	scenes: Array<{
		narration_text: string;
		scene_type: string;
		duration_seconds: number;
		imageUrl?: string;
		videoUrl?: string;
		audioUrl?: string;
	}>,
): Promise<QCReport> {
	// 1. 룰 기반 먼저 (빠른 체크)
	const ruleReport = verifySceneQuality(scenes);

	// imageUrl이 있는 씬 중 critical/warning이 있는 씬만 Vision 검증 대상
	const problemSceneIndices = new Set(
		ruleReport.issues
			.filter((i) => i.severity === "critical" || i.severity === "warning")
			.map((i) => i.scene_index - 1), // 0-based index
	);

	const visionTargets = scenes
		.map((s, i) => ({ ...s, _idx: i }))
		.filter((s) => s.imageUrl && problemSceneIndices.has(s._idx));

	if (visionTargets.length === 0) {
		return ruleReport;
	}

	const proxy = getApiProxyUrl();
	const visionIssues: QCReport["issues"] = [];

	for (const scene of visionTargets) {
		try {
			const res = await fetch(`${proxy}/api/openai/chat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "gpt-4o",
					messages: [
						{
							role: "user",
							content: [
								{
									type: "image_url",
									image_url: { url: scene.imageUrl },
								},
								{
									type: "text",
									text: `나레이션: ${scene.narration_text}\n\n다음 항목을 체크하고 JSON으로만 응답:\n- 텍스트 가독성 (자막이 배경에 묻히지 않는지)\n- 이미지 품질 (저화질/블러/아티팩트)\n- 나레이션-비주얼 일치도 (내용이 화면과 맞는지)\n- 자막 겹침 여부\n\n응답 형식:\n{"issues": [{"severity": "critical|warning|info", "message": "문제 설명"}], "score": 0-100}`,
								},
							],
						},
					],
					max_tokens: 512,
				}),
				signal: AbortSignal.timeout(30_000),
			});

			if (!res.ok) continue;

			const json = await res.json();
			const content = json.choices?.[0]?.message?.content;
			if (!content) continue;

			const visionResult = parseJSON<VisionResult>(content);
			const sceneIdx = scene._idx + 1; // 1-based for report

			for (const issue of visionResult.issues ?? []) {
				visionIssues.push({
					scene_index: sceneIdx,
					severity: issue.severity,
					message: `[Vision] 씬 ${sceneIdx}: ${issue.message}`,
				});
			}
		} catch {
			// Vision 호출 실패 — 해당 씬 건너뜀 (graceful fallback)
		}
	}

	if (visionIssues.length === 0) {
		return ruleReport;
	}

	// 룰 기반 + Vision 결과 merge
	const mergedIssues = [...ruleReport.issues, ...visionIssues];
	const criticals = mergedIssues.filter(
		(i) => i.severity === "critical",
	).length;
	const warnings = mergedIssues.filter((i) => i.severity === "warning").length;
	const mergedScore = Math.max(0, 100 - criticals * 20 - warnings * 5);

	return {
		passed: criticals === 0,
		overall_score: mergedScore,
		issues: mergedIssues,
		suggestions: ruleReport.suggestions,
	};
}
