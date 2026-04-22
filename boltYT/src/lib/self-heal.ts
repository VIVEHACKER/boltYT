/**
 * Self-Healing 미디어 파이프라인
 *
 * 영상 생성 과정에서 실패한 단계를 자동 감지하고 복구합니다.
 *
 * 복구 전략:
 * 1. 이미지 생성 실패 → 다른 provider로 재시도 → 기본 그라데이션 fallback
 * 2. TTS 실패 → 다른 voice로 재시도 → 다른 provider로 재시도
 * 3. 영상 다운로드 실패 → 이미지로 대체
 * 4. 전체 파이프라인 → 실패 씬만 재시도 (완료된 씬 보존)
 */

export type HealAction =
	| { type: "retry_same"; message: string }
	| { type: "retry_alternative"; message: string; alternative: string }
	| { type: "skip"; message: string }
	| { type: "fallback"; message: string; fallbackValue: string };

export interface HealResult {
	healed: boolean;
	action: HealAction;
}

/**
 * 에러를 분석하여 복구 전략 결정
 */
export function diagnose(
	step: "image" | "tts" | "video" | "search" | "script",
	error: Error,
): HealAction {
	const msg = error.message.toLowerCase();

	// ─── Rate Limit ───
	if (msg.includes("429") || msg.includes("rate")) {
		return {
			type: "retry_same",
			message: "API 요청 한도 초과 — 30초 후 자동 재시도",
		};
	}

	// ─── 인증/키 문제 ───
	if (
		msg.includes("401") ||
		msg.includes("403") ||
		msg.includes("키가 서버에 설정되지")
	) {
		return {
			type: "skip",
			message: "API 키 미설정 — 이 단계를 건너뜁니다",
		};
	}

	// ─── 서버 오류 ───
	if (msg.includes("500") || msg.includes("502") || msg.includes("503")) {
		return {
			type: "retry_same",
			message: "서버 일시 오류 — 자동 재시도",
		};
	}

	// ─── 네트워크 ───
	if (
		msg.includes("network") ||
		msg.includes("fetch") ||
		msg.includes("timeout")
	) {
		return {
			type: "retry_same",
			message: "네트워크 오류 — 자동 재시도",
		};
	}

	// ─── 이미지 생성 실패 ───
	if (step === "image") {
		if (msg.includes("comfyui") || msg.includes("a1111")) {
			return {
				type: "retry_alternative",
				message: "로컬 모델 오류 — DALL-E로 전환",
				alternative: "dalle",
			};
		}
		if (msg.includes("dall-e") || msg.includes("dalle")) {
			return {
				type: "fallback",
				message: "이미지 생성 실패 — 기본 배경 사용",
				fallbackValue: "",
			};
		}
	}

	// ─── TTS 실패 ───
	if (step === "tts") {
		if (msg.includes("elevenlabs")) {
			return {
				type: "retry_alternative",
				message: "ElevenLabs 오류 — OpenAI TTS로 전환",
				alternative: "openai",
			};
		}
		return {
			type: "retry_same",
			message: "TTS 오류 — 재시도",
		};
	}

	// ─── 영상 다운로드 실패 ───
	if (step === "video") {
		return {
			type: "retry_alternative",
			message: "영상 다운로드 실패 — 이미지로 대체",
			alternative: "image",
		};
	}

	// ─── 기본 ───
	return {
		type: "retry_same",
		message: `오류 발생 — 재시도 (${error.message.slice(0, 80)})`,
	};
}

/**
 * 자동 복구 실행기
 *
 * @param step 실패한 단계
 * @param error 발생한 에러
 * @param retryFn 같은 작업 재시도 함수
 * @param alternativeFn 대안 작업 함수 (provider/방식 변경)
 * @param maxRetries 최대 재시도 (기본 2)
 */
export async function autoHeal<T>(
	step: "image" | "tts" | "video" | "search" | "script",
	error: Error,
	retryFn: () => Promise<T>,
	alternativeFn?: (alt: string) => Promise<T>,
	maxRetries = 2,
): Promise<{ result: T | null; actions: HealAction[] }> {
	const actions: HealAction[] = [];
	let attempts = 0;

	const action = diagnose(step, error);
	actions.push(action);

	while (attempts < maxRetries) {
		attempts++;

		try {
			if (action.type === "retry_same") {
				// 재시도 전 대기 (rate limit은 더 오래)
				const delay = action.message.includes("한도") ? 30000 : 3000;
				await new Promise((r) => setTimeout(r, delay));
				const result = await retryFn();
				return { result, actions };
			}

			if (action.type === "retry_alternative" && alternativeFn) {
				const result = await alternativeFn(action.alternative);
				return { result, actions };
			}

			if (action.type === "fallback") {
				return { result: action.fallbackValue as unknown as T, actions };
			}

			if (action.type === "skip") {
				return { result: null, actions };
			}
		} catch (retryErr) {
			const newAction = diagnose(
				step,
				retryErr instanceof Error ? retryErr : new Error(String(retryErr)),
			);
			actions.push(newAction);

			// skip이면 더 이상 시도하지 않음
			if (newAction.type === "skip") {
				return { result: null, actions };
			}
		}
	}

	return { result: null, actions };
}

/**
 * 파이프라인 체크포인트 — 완료된 씬 상태를 localStorage에 저장
 * 페이지 새로고침/오류 후 재개 가능
 */
export function saveCheckpoint(scriptId: string, completedScenes: Set<string>) {
	localStorage.setItem(
		`pipeline_checkpoint_${scriptId}`,
		JSON.stringify([...completedScenes]),
	);
}

export function loadCheckpoint(scriptId: string): Set<string> {
	const raw = localStorage.getItem(`pipeline_checkpoint_${scriptId}`);
	if (!raw) return new Set();
	try {
		return new Set(JSON.parse(raw) as string[]);
	} catch {
		return new Set();
	}
}

export function clearCheckpoint(scriptId: string) {
	localStorage.removeItem(`pipeline_checkpoint_${scriptId}`);
}
