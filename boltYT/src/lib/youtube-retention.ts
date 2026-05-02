import { detectHookPattern } from "./hook-detector";

export type RetentionSeverity = "critical" | "warning" | "info";

export interface RetentionIssue {
	severity: RetentionSeverity;
	code: string;
	message: string;
}

export interface RetentionSceneInput {
	narration?: string;
	narration_text?: string;
	type?: string;
	scene_type?: string;
	duration?: number;
	duration_seconds?: number;
	newsTitle?: string;
	news_title?: string;
	shots?: Array<{
		media_type?: string;
		motion?: string;
		kind?: string;
	}>;
}

export interface OpeningRetentionReport {
	passed: boolean;
	score: number;
	issues: RetentionIssue[];
	requiredActions: string[];
	firstTenSeconds: {
		sceneCount: number;
		videoSeconds: number;
		motionShotCount: number;
		hasStrongHook: boolean;
		hasGenericIntro: boolean;
		titleOverlap: number;
	};
}

const GENERIC_OPENING_PATTERNS = [
	/안녕하세요/,
	/오늘은/,
	/이번\s*영상/,
	/지금부터/,
	/알아보겠/,
	/알아봅니다/,
	/소개하겠/,
	/시작하겠/,
	/구독/,
	/좋아요/,
];

const STOPWORDS = new Set([
	"그리고",
	"하지만",
	"이번",
	"영상",
	"오늘",
	"사건",
	"분석",
	"타임라인",
	"자료",
	"기반",
	"확인",
]);

function normalizeText(value?: string): string {
	return (value ?? "").replace(/\s+/g, " ").trim();
}

function narrationOf(scene: RetentionSceneInput): string {
	return normalizeText(scene.narration_text ?? scene.narration);
}

function typeOf(scene: RetentionSceneInput): string {
	return scene.scene_type ?? scene.type ?? "";
}

function durationOf(scene: RetentionSceneInput): number {
	return Number(scene.duration_seconds ?? scene.duration ?? 0);
}

function tokenize(value: string): string[] {
	return normalizeText(value)
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(
			(token) =>
				token.length >= 2 &&
				!STOPWORDS.has(token) &&
				!/^[0-9]+$/.test(token),
		);
}

function overlapRatio(a: string, b: string): number {
	const aTokens = new Set(tokenize(a));
	const bTokens = new Set(tokenize(b));
	if (aTokens.size === 0 || bTokens.size === 0) return 0;
	let overlap = 0;
	for (const token of aTokens) {
		if (bTokens.has(token)) overlap += 1;
	}
	return overlap / aTokens.size;
}

function hasGenericIntro(text: string): boolean {
	return GENERIC_OPENING_PATTERNS.some((pattern) => pattern.test(text));
}

function firstWindow(scenes: RetentionSceneInput[], seconds: number) {
	const windowScenes: Array<{ scene: RetentionSceneInput; seconds: number }> = [];
	let cursor = 0;
	for (const scene of scenes) {
		if (cursor >= seconds) break;
		const duration = Math.max(0, durationOf(scene));
		if (duration <= 0) continue;
		const used = Math.min(duration, seconds - cursor);
		windowScenes.push({ scene, seconds: used });
		cursor += duration;
	}
	return windowScenes;
}

function countMotionShots(scenes: Array<{ scene: RetentionSceneInput }>): number {
	return scenes.reduce(
		(sum, item) =>
			sum +
			(item.scene.shots?.filter(
				(shot) => shot.motion && shot.motion !== "static",
			).length ?? 0),
		0,
	);
}

function buildIssue(
	severity: RetentionSeverity,
	code: string,
	message: string,
): RetentionIssue {
	return { severity, code, message };
}

export function analyzeOpeningRetention(input: {
	title?: string;
	format?: "shorts" | "longform" | "both" | string;
	scenes: RetentionSceneInput[];
}): OpeningRetentionReport {
	const issues: RetentionIssue[] = [];
	const actions: string[] = [];
	const isShorts = input.format === "shorts";
	const first = input.scenes[0];
	const firstNarration = narrationOf(first ?? {});
	const firstTen = firstWindow(input.scenes, 10);
	const firstTenNarration = firstTen
		.map((item) => narrationOf(item.scene))
		.join(" ");
	const hook = detectHookPattern(firstNarration);
	const hasStrongHook = hook.confidence >= 0.34;
	const hasGeneric = hasGenericIntro(firstNarration);
	const videoSeconds = firstTen.reduce(
		(sum, item) => sum + (typeOf(item.scene) === "video" ? item.seconds : 0),
		0,
	);
	const motionShotCount = countMotionShots(firstTen);
	const titleOverlap = overlapRatio(input.title ?? "", firstTenNarration);

	if (input.scenes.length === 0) {
		issues.push(
			buildIssue(
				"critical",
				"no_scenes",
				"검증할 씬이 없어 초반 유지율을 판단할 수 없습니다.",
			),
		);
		actions.push("스크립트와 씬을 먼저 생성하세요.");
	}

	if (first && !hasStrongHook) {
		issues.push(
			buildIssue(
				isShorts ? "critical" : "warning",
				"weak_opening_hook",
				"첫 문장이 질문, 반전, 핵심 주장 없이 설명형으로 시작합니다.",
			),
		);
		actions.push("첫 문장을 사건의 핵심 질문 또는 확인된 강한 사실로 바꾸세요.");
	}

	if (hasGeneric) {
		issues.push(
			buildIssue(
				"critical",
				"generic_intro",
				"초반에 인사말/소개형 문구가 감지되어 이탈 가능성이 큽니다.",
			),
		);
		actions.push("인사말과 '오늘은 알아봅니다'를 제거하고 바로 사건 비트로 시작하세요.");
	}

	if (isShorts && firstTen.length < 3) {
		issues.push(
			buildIssue(
				"warning",
				"low_hook_cut_density",
				"쇼츠 첫 10초의 컷 수가 부족합니다.",
			),
		);
		actions.push("첫 10초 안에 최소 3개 비주얼 비트를 배치하세요.");
	}

	if (isShorts && videoSeconds < 5.5) {
		issues.push(
			buildIssue(
				"warning",
				"low_hook_motion_ratio",
				"쇼츠 첫 10초가 영상/모션보다 정적인 이미지에 치우쳐 있습니다.",
			),
		);
		actions.push("첫 10초에는 영상 컷 또는 강한 모션 샷을 우선 배치하세요.");
	}

	if (!isShorts && first && durationOf(first) > 18) {
		issues.push(
			buildIssue(
				"warning",
				"long_opening_scene",
				"롱폼 첫 씬이 너무 길어 초반 질문이 늦게 풀립니다.",
			),
		);
		actions.push("첫 씬은 8~18초 안에서 질문과 방향을 제시하세요.");
	}

	if (motionShotCount === 0 && videoSeconds === 0 && firstTen.length > 0) {
		issues.push(
			buildIssue(
				"warning",
				"static_opening_visuals",
				"첫 10초에 모션 샷이나 영상 컷이 없습니다.",
			),
		);
		actions.push("첫 장면 샷에 push-in, pan, slow zoom 같은 모션을 넣으세요.");
	}

	if ((input.title ?? "").trim() && titleOverlap < 0.18) {
		issues.push(
			buildIssue(
				"warning",
				"title_opening_mismatch",
				"제목의 핵심어가 초반 나레이션과 충분히 맞지 않습니다.",
			),
		);
		actions.push("제목 핵심어를 첫 10초 나레이션에도 자연스럽게 포함하세요.");
	}

	const criticals = issues.filter((issue) => issue.severity === "critical").length;
	const warnings = issues.filter((issue) => issue.severity === "warning").length;
	const score = Math.max(0, 100 - criticals * 32 - warnings * 11);

	return {
		passed: criticals === 0 && score >= (isShorts ? 68 : 62),
		score,
		issues,
		requiredActions: [...new Set(actions)],
		firstTenSeconds: {
			sceneCount: firstTen.length,
			videoSeconds: Number(videoSeconds.toFixed(2)),
			motionShotCount,
			hasStrongHook,
			hasGenericIntro: hasGeneric,
			titleOverlap: Number(titleOverlap.toFixed(2)),
		},
	};
}

function stripGenericOpening(text: string): string {
	let next = normalizeText(text);
	for (const pattern of GENERIC_OPENING_PATTERNS) {
		next = next.replace(pattern, "").trim();
	}
	return next.replace(/^[,.!?\s]+/, "").trim();
}

function openingAnchor<T extends RetentionSceneInput>(
	scene: T,
	topicTitle?: string,
): string {
	const anchor =
		normalizeText(scene.news_title ?? scene.newsTitle) ||
		normalizeText(topicTitle) ||
		normalizeText(scene.narration_text ?? scene.narration).slice(0, 24);
	return anchor || "이 사건";
}

export function strengthenOpeningRetention<
	T extends RetentionSceneInput & { narration?: string },
>(
	scenes: T[],
	options: {
		topicTitle?: string;
		format?: "shorts" | "longform" | "both" | string;
	} = {},
): T[] {
	if (scenes.length === 0) return scenes;
	const first = scenes[0];
	const current = narrationOf(first);
	const hook = detectHookPattern(current);
	if (hook.confidence >= 0.34 && !hasGenericIntro(current)) return scenes;

	const anchor = openingAnchor(first, options.topicTitle);
	const cleaned = stripGenericOpening(current);
	const prefix =
		options.format === "shorts"
			? `왜 ${anchor} 한 장면이 사건의 흐름을 바꿨을까요?`
			: `${anchor}. 이 사건은 여기서부터 단순하게 설명되지 않습니다.`;
	const narration = normalizeText(`${prefix} ${cleaned}`).slice(0, 420);

	return scenes.map((scene, index) =>
		index === 0
			? {
					...scene,
					narration,
				}
			: scene,
	);
}
