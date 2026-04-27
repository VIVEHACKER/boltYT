/**
 * 훅 패턴 감지 — 나레이션 텍스트에서 질문/충격/주장/스토리 유형 자동 판별.
 * 쇼츠 첫 씬의 SFX·전환·자막 강화에 사용.
 */

export type HookPattern = "question" | "shock" | "claim" | "story" | "";

interface HookResult {
	pattern: HookPattern;
	/** 0-1, 감지 신뢰도 */
	confidence: number;
}

const QUESTION_PATTERNS = [
	/[?？]$/,
	/[나까죠요]\s*[?？]?$/,
	/할까[요]?/,
	/인가[요]?/,
	/일까[요]?/,
	/^(왜|어떻게|무엇|언제|누가|어디서|얼마나)/,
	/알고\s*(계|있)셨/,
	/혹시/,
];

const SHOCK_PATTERNS = [
	/충격/,
	/경악/,
	/믿기\s*지\s*않/,
	/놀라운/,
	/충격적/,
	/사실은/,
	/알고\s*보면/,
	/반전/,
	/실제로는/,
	/이런\s*일이/,
	/상상도\s*못/,
	/충격\s*실화/,
	/폭로/,
	/숨겨진/,
	/감춰진/,
	/은폐/,
	/실화/,
	/믿을\s*수\s*없/,
	/놀랍게도/,
	/놀랍지만/,
	/세상에/,
	/대박/,
	/소름/,
	/끔찍/,
	/경이로운/,
	/단\s*하나/,
	/(처음|최초)\s*공개/,
];

const CLAIM_PATTERNS = [
	/^(사실|진실|비밀|이유|방법|핵심)/,
	/입니다[.。]?\s*$/,
	/이다[.。]?\s*$/,
	/해야\s*(합|한다)/,
	/(절대|반드시|무조건|꼭)\s/,
	/이것이\s*(바로|진짜)/,
	/핵심은/,
	/알아야\s*(할|하는)/,
	/^(\d+\s*가지|\d+\s*개|\d+\s*명)/,
	/단\s*(\d+\s*초|\d+\s*분)/,
	/(\d+\s*%|\d+\s*억|\d+\s*만\s*명)/,
	/유일하게/,
	/오직/,
	/전\s*세계/,
	/(역대\s*최|사상\s*최)/,
];

const STORY_PATTERNS = [
	/^(한\s*번은|어느\s*날|그\s*때|그\s*날|예전에)/,
	/이야기/,
	/에피소드/,
	/경험/,
	/~했는데/,
	/겪었/,
];

function countMatches(text: string, patterns: RegExp[]): number {
	return patterns.filter((p) => p.test(text)).length;
}

/**
 * 나레이션 텍스트에서 훅 패턴을 감지합니다.
 * 여러 씬이 있으면 첫 씬만 전달하는 것을 권장합니다.
 */
export function detectHookPattern(narration: string): HookResult {
	if (!narration || narration.trim().length === 0) {
		return { pattern: "", confidence: 0 };
	}

	const text = narration.trim();

	const scores = {
		question: countMatches(text, QUESTION_PATTERNS),
		shock: countMatches(text, SHOCK_PATTERNS),
		claim: countMatches(text, CLAIM_PATTERNS),
		story: countMatches(text, STORY_PATTERNS),
	};

	const maxScore = Math.max(...Object.values(scores));
	if (maxScore === 0) return { pattern: "", confidence: 0 };

	const winner = (Object.entries(scores) as [HookPattern, number][]).reduce(
		(a, b) => (b[1] > a[1] ? b : a),
	);

	// 첫 신호 1개=0.4, 2개=0.7, 3개+=1.0 (calibration 강화)
	const raw = winner[1];
	const confidence = raw >= 3 ? 1 : raw === 2 ? 0.7 : 0.4;
	return { pattern: winner[0], confidence };
}

/**
 * 씬 배열의 훅 구간(초 기준)을 분석하여 hookBoost 배열 생성.
 * - 첫 10초는 시간 기반 boost
 * - 첫 씬이 question/shock 패턴이면 hookBoost + isStrongHook 마킹
 */
export function buildHookFlags(
	scenes: Array<{ duration_seconds: number; narration?: string }>,
	hookWindowSeconds = 10,
): Array<{ hookBoost: boolean; hookPattern: HookPattern }> {
	let elapsed = 0;
	return scenes.map((scene, idx) => {
		const inTimeWindow = elapsed < hookWindowSeconds;
		elapsed += Number(scene.duration_seconds);

		if (idx === 0) {
			const { pattern, confidence } = detectHookPattern(scene.narration ?? "");
			const contentBoost = confidence >= 0.34;
			return {
				hookBoost: inTimeWindow || contentBoost,
				hookPattern: pattern,
			};
		}

		return {
			hookBoost: inTimeWindow,
			hookPattern: "",
		};
	});
}
