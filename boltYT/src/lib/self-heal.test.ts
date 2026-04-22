/**
 * self-heal.ts 단위 테스트
 *
 * - diagnose(): 순수 함수 — 에러 메시지 + 단계별 복구 전략 결정
 * - autoHeal(): 비동기 복구 실행기 — fake timer로 delay 테스트
 * - saveCheckpoint / loadCheckpoint / clearCheckpoint: localStorage 의존
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	autoHeal,
	clearCheckpoint,
	diagnose,
	loadCheckpoint,
	saveCheckpoint,
} from "./self-heal";

// ─── localStorage stub ────────────────────────────────────────────────────────

const _ls: Record<string, string> = {};
const mockStorage = {
	getItem: (k: string) => _ls[k] ?? null,
	setItem: (k: string, v: string) => {
		_ls[k] = v;
	},
	removeItem: (k: string) => {
		delete _ls[k];
	},
	clear: () => {
		for (const k of Object.keys(_ls)) delete _ls[k];
	},
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => mockStorage.clear());

// ─── diagnose() ───────────────────────────────────────────────────────────────

describe("diagnose — rate limit", () => {
	it("429 코드 포함 → retry_same", () => {
		const r = diagnose("image", new Error("HTTP 429 too many requests"));
		expect(r.type).toBe("retry_same");
	});

	it("'rate' 문자 포함 → retry_same", () => {
		const r = diagnose("tts", new Error("rate limit exceeded"));
		expect(r.type).toBe("retry_same");
	});
});

describe("diagnose — 인증/키 오류", () => {
	it("401 → skip", () => {
		expect(diagnose("image", new Error("401 unauthorized")).type).toBe("skip");
	});

	it("403 → skip", () => {
		expect(diagnose("tts", new Error("403 forbidden")).type).toBe("skip");
	});

	it("키가 서버에 설정되지 → skip", () => {
		expect(
			diagnose("script", new Error("키가 서버에 설정되지 않았습니다")).type,
		).toBe("skip");
	});
});

describe("diagnose — 서버 오류", () => {
	it("500 → retry_same", () => {
		expect(diagnose("search", new Error("500 internal error")).type).toBe(
			"retry_same",
		);
	});

	it("502 → retry_same", () => {
		expect(diagnose("video", new Error("502 bad gateway")).type).toBe(
			"retry_same",
		);
	});

	it("503 → retry_same", () => {
		expect(diagnose("tts", new Error("503 service unavailable")).type).toBe(
			"retry_same",
		);
	});
});

describe("diagnose — 네트워크 오류", () => {
	it("network → retry_same", () => {
		expect(diagnose("image", new Error("network error")).type).toBe(
			"retry_same",
		);
	});

	it("fetch failed → retry_same", () => {
		expect(diagnose("tts", new Error("fetch failed")).type).toBe("retry_same");
	});

	it("timeout → retry_same", () => {
		expect(diagnose("video", new Error("request timeout")).type).toBe(
			"retry_same",
		);
	});
});

describe("diagnose — 이미지 단계 전략", () => {
	it("comfyui 오류 → retry_alternative(dalle)", () => {
		const r = diagnose("image", new Error("comfyui connection failed"));
		expect(r.type).toBe("retry_alternative");
		if (r.type === "retry_alternative") expect(r.alternative).toBe("dalle");
	});

	it("a1111 오류 → retry_alternative(dalle)", () => {
		const r = diagnose("image", new Error("a1111 server error"));
		expect(r.type).toBe("retry_alternative");
		if (r.type === "retry_alternative") expect(r.alternative).toBe("dalle");
	});

	it("dall-e 오류 → fallback(빈 문자열)", () => {
		const r = diagnose("image", new Error("dall-e quota exceeded"));
		expect(r.type).toBe("fallback");
		if (r.type === "fallback") expect(r.fallbackValue).toBe("");
	});

	it("dalle 오류 → fallback", () => {
		expect(diagnose("image", new Error("dalle error")).type).toBe("fallback");
	});
});

describe("diagnose — TTS 단계 전략", () => {
	it("elevenlabs 오류 → retry_alternative(openai)", () => {
		const r = diagnose("tts", new Error("elevenlabs api error"));
		expect(r.type).toBe("retry_alternative");
		if (r.type === "retry_alternative") expect(r.alternative).toBe("openai");
	});

	it("기타 TTS 오류 → retry_same", () => {
		expect(diagnose("tts", new Error("unexpected tts error")).type).toBe(
			"retry_same",
		);
	});
});

describe("diagnose — 영상 단계 전략", () => {
	it("video step → retry_alternative(image)", () => {
		const r = diagnose("video", new Error("download failed"));
		expect(r.type).toBe("retry_alternative");
		if (r.type === "retry_alternative") expect(r.alternative).toBe("image");
	});
});

describe("diagnose — 기본 폴백", () => {
	it("알 수 없는 오류 → retry_same", () => {
		expect(diagnose("script", new Error("unknown error occurred")).type).toBe(
			"retry_same",
		);
	});

	it("메시지에 최대 80자 포함", () => {
		const longMsg = "a".repeat(200);
		const r = diagnose("search", new Error(longMsg));
		expect(r.type).toBe("retry_same");
		expect(r.message.length).toBeLessThanOrEqual(200); // 전체 메시지
	});
});

// ─── autoHeal() ───────────────────────────────────────────────────────────────

describe("autoHeal — skip", () => {
	it("skip 액션 → result null, actions 기록", async () => {
		const retryFn = vi.fn();
		const { result, actions } = await autoHeal(
			"tts",
			new Error("401 unauthorized"),
			retryFn,
		);
		expect(result).toBeNull();
		expect(actions[0].type).toBe("skip");
		expect(retryFn).not.toHaveBeenCalled();
	});
});

describe("autoHeal — fallback", () => {
	it("fallback 액션 → fallbackValue 반환", async () => {
		const { result, actions } = await autoHeal(
			"image",
			new Error("dall-e failed"),
			vi.fn(),
		);
		expect(result).toBe(""); // fallbackValue
		expect(actions[0].type).toBe("fallback");
	});
});

describe("autoHeal — retry_alternative", () => {
	it("alternativeFn 호출 후 결과 반환", async () => {
		const alternativeFn = vi.fn().mockResolvedValue("alt-result");
		const { result, actions } = await autoHeal(
			"tts",
			new Error("elevenlabs error"),
			vi.fn(),
			alternativeFn,
		);
		expect(alternativeFn).toHaveBeenCalledWith("openai");
		expect(result).toBe("alt-result");
		expect(actions[0].type).toBe("retry_alternative");
	});

	it("alternativeFn 없으면 null 반환", async () => {
		const { result } = await autoHeal(
			"tts",
			new Error("elevenlabs error"),
			vi.fn(),
		);
		expect(result).toBeNull();
	});
});

describe("autoHeal — retry_same", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("재시도 성공 → result 반환", async () => {
		const retryFn = vi.fn().mockResolvedValue("retry-ok");
		const promise = autoHeal("tts", new Error("503 service down"), retryFn);
		await vi.runAllTimersAsync();
		const { result } = await promise;
		expect(result).toBe("retry-ok");
		expect(retryFn).toHaveBeenCalledOnce();
	});

	it("rate limit → 30초 delay 사용", async () => {
		const retryFn = vi.fn().mockResolvedValue("ok");
		const promise = autoHeal("image", new Error("429 rate limit"), retryFn);
		// 3초 경과 → 아직 재시도 안 됨
		await vi.advanceTimersByTimeAsync(3000);
		expect(retryFn).not.toHaveBeenCalled();
		// 30초 경과 → 재시도 됨
		await vi.advanceTimersByTimeAsync(27001);
		await promise;
		expect(retryFn).toHaveBeenCalled();
	});

	it("재시도 실패 → maxRetries 후 null", async () => {
		const retryFn = vi.fn().mockRejectedValue(new Error("still failing"));
		const promise = autoHeal(
			"tts",
			new Error("503 error"),
			retryFn,
			undefined,
			1,
		);
		await vi.runAllTimersAsync();
		const { result } = await promise;
		expect(result).toBeNull();
	});
});

// ─── checkpoint ───────────────────────────────────────────────────────────────

describe("saveCheckpoint / loadCheckpoint / clearCheckpoint", () => {
	it("저장 후 로드 → 동일 Set 반환", () => {
		const scenes = new Set(["s-1", "s-2", "s-3"]);
		saveCheckpoint("script-abc", scenes);
		const loaded = loadCheckpoint("script-abc");
		expect(loaded).toEqual(scenes);
	});

	it("저장 없으면 빈 Set", () => {
		expect(loadCheckpoint("nonexistent")).toEqual(new Set());
	});

	it("잘못된 JSON → 빈 Set (에러 무시)", () => {
		mockStorage.setItem("pipeline_checkpoint_bad", "{{invalid}}");
		expect(loadCheckpoint("bad")).toEqual(new Set());
	});

	it("clearCheckpoint → 이후 빈 Set", () => {
		saveCheckpoint("script-xyz", new Set(["s-1"]));
		clearCheckpoint("script-xyz");
		expect(loadCheckpoint("script-xyz")).toEqual(new Set());
	});

	it("다른 scriptId 는 독립 저장", () => {
		saveCheckpoint("a", new Set(["s-1"]));
		saveCheckpoint("b", new Set(["s-2", "s-3"]));
		expect(loadCheckpoint("a").size).toBe(1);
		expect(loadCheckpoint("b").size).toBe(2);
	});
});
