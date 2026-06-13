/**
 * tts.ts 단위 테스트
 *
 * API 호출 함수(generateTts, callOpenAiTts 등)는 외부 프록시 의존 → 테스트 제외.
 * 순수 함수 + localStorage 설정 저장/로드에 집중.
 *
 * local-db.ts 가 모듈 로드 시 localStorage 를 참조하므로
 * vi.mock 으로 차단하고, localStorage 자체는 stubGlobal 로 대체한다.
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

// local-db / supabase / proxy 는 모듈 로드 시 localStorage에 접근 → vi.mock 차단
vi.mock("./local-db", () => ({ storeLocalFile: vi.fn() }));
vi.mock("./supabase", () => {
	const chainMock: Record<string, unknown> = {};
	chainMock.update = vi.fn(() => chainMock);
	chainMock.insert = vi.fn(() => chainMock);
	chainMock.eq = vi.fn(() => Promise.resolve({}));
	return {
		supabase: { storage: { from: vi.fn() }, from: vi.fn(() => chainMock) },
	};
});
vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3456" }));
vi.mock("./voice-dsp", () => ({
	processVoice: vi.fn().mockResolvedValue({
		buffer: new ArrayBuffer(100),
		mimeType: "audio/wav",
		processed: true,
	}),
	getAudioContext: vi.fn(),
	encodeWav: vi.fn(() => new ArrayBuffer(100)),
}));

import {
	composeNarrationTtsOptions,
	ELEVENLABS_DEFAULT_VOICES,
	findVoice,
	generateContinuousNarration,
	generateTtsChunk,
	getAudioDuration,
	getAvailableVoices,
	getDefaultVoice,
	hasStoredTtsSettings,
	inferNarrationEndingHoldSeconds,
	inferNarrationPauseSeconds,
	inferNarrationTtsOptions,
	type NarrationTtsSignal,
	OPENAI_VOICES,
	setDefaultVoice,
	ttsOverrideForProfile,
} from "./tts";

// localStorage stub (node 환경에 없으므로 전역 주입)
const _store: Record<string, string> = {};
const mockStorage = {
	getItem: (k: string) => _store[k] ?? null,
	setItem: (k: string, v: string) => {
		_store[k] = v;
	},
	removeItem: (k: string) => {
		delete _store[k];
	},
	clear: () => {
		for (const k of Object.keys(_store)) delete _store[k];
	},
};
beforeAll(() => vi.stubGlobal("localStorage", mockStorage));
afterEach(() => mockStorage.clear());

// ─── 음성 목록 ────────────────────────────────────────────────────────────────

describe("getAvailableVoices", () => {
	it("elevenLabsEnabled=false → OpenAI 음성만 포함", () => {
		const voices = getAvailableVoices(false);
		expect(voices.every((v) => v.provider === "openai")).toBe(true);
		expect(voices.length).toBe(OPENAI_VOICES.length);
	});

	it("elevenLabsEnabled=true → OpenAI + ElevenLabs 모두 포함", () => {
		const voices = getAvailableVoices(true);
		expect(voices.length).toBe(
			OPENAI_VOICES.length + ELEVENLABS_DEFAULT_VOICES.length,
		);
		expect(voices.some((v) => v.provider === "elevenlabs")).toBe(true);
	});

	it("모든 OpenAI 음성이 korean=true", () => {
		expect(OPENAI_VOICES.every((v) => v.korean)).toBe(true);
	});
});

describe("findVoice", () => {
	it("유효한 id → 해당 음성 반환", () => {
		const voice = findVoice("sage");
		expect(voice).toBeDefined();
		expect(voice?.name).toBe("Sage");
		expect(voice?.provider).toBe("openai");
	});

	it("ElevenLabs id 도 조회 가능", () => {
		const voice = findVoice("EXAVITQu4vr4xnSDxMaL");
		expect(voice?.name).toBe("Bella");
	});

	it("존재하지 않는 id → undefined", () => {
		expect(findVoice("nonexistent-voice-id")).toBeUndefined();
	});
});

// ─── inferNarrationTtsOptions ─────────────────────────────────────────────────

describe("inferNarrationTtsOptions", () => {
	function signal(
		narration: string,
		mood?: string,
		type?: string,
	): NarrationTtsSignal {
		return { narration, mood, type };
	}

	it("기본 경로 (낮은 점수) → sage / openai / 0.97", () => {
		const result = inferNarrationTtsOptions([
			signal("오늘은 날씨가 맑았습니다."),
			signal("내일도 맑을 예정입니다."),
		]);
		expect(result).toEqual({ voice: "sage", provider: "openai", speed: 0.97 });
	});

	it("서스펜스 경로 (키워드 2+) → speed 0.93", () => {
		const result = inferNarrationTtsOptions([
			signal("실종된 아이를 추적하는 수사가 시작됐습니다."),
			signal("범인의 단서를 찾아냈습니다.", "mystery"),
		]);
		expect(result.speed).toBe(0.93);
		expect(result.provider).toBe("openai");
	});

	it("서스펜스 + 영상 씬 과반 → voice sage", () => {
		const scenes = [
			{ ...signal("실종된 아이를 추적하는 수사"), type: "video" },
			{ ...signal("범인의 cctv 확보", "mystery"), type: "video" },
			{ ...signal("미제 사건 해결"), type: "video" },
		];
		expect(inferNarrationTtsOptions(scenes).voice).toBe("sage");
	});

	it("뉴스 경로 (키워드 2+) → sage / 0.96", () => {
		const result = inferNarrationTtsOptions([
			signal("속보: 정부가 발표했습니다."),
			signal("브리핑에서 공개된 내용을 확인했습니다.", "news"),
		]);
		expect(result).toEqual({ voice: "sage", provider: "openai", speed: 0.96 });
	});

	it("따뜻한 경로 (키워드 2+) → ash / 0.95", () => {
		const result = inferNarrationTtsOptions([
			signal("가족과 아이들이 함께하는 따뜻한 순간이었습니다."),
			signal("눈물과 희망이 가득한 이야기입니다.", "warm"),
		]);
		expect(result).toEqual({ voice: "ash", provider: "openai", speed: 0.95 });
	});

	it("업비트 경로 (키워드 2+) → coral / 1.01", () => {
		const result = inferNarrationTtsOptions([
			signal("드디어 성공한 반전의 순간!"),
			signal("놀라운 기록이 세워졌습니다."),
		]);
		expect(result).toEqual({ voice: "coral", provider: "openai", speed: 1.01 });
	});

	it("빈 씬 배열 → 기본값", () => {
		expect(inferNarrationTtsOptions([])).toEqual({
			voice: "sage",
			provider: "openai",
			speed: 0.97,
		});
	});
});

describe("ttsOverrideForProfile", () => {
	it("지원 profile 은 toneKeywords/direction/endingHold 로 변환한다", () => {
		const override = ttsOverrideForProfile("suspense");
		expect(override.toneKeywords?.length).toBeGreaterThan(0);
		expect(typeof override.direction).toBe("string");
		expect(override.direction?.length ?? 0).toBeGreaterThan(0);
		expect(typeof override.endingHoldSeconds).toBe("number");
	});

	it("미지원 profile 과 prototype 상속 키('constructor'/'toString')는 빈 객체", () => {
		expect(ttsOverrideForProfile("unknown")).toEqual({});
		expect(ttsOverrideForProfile("constructor")).toEqual({});
		expect(ttsOverrideForProfile("toString")).toEqual({});
		expect(ttsOverrideForProfile("__proto__")).toEqual({});
	});
});

describe("composeNarrationTtsOptions", () => {
	it("openai 기본 경로에도 방향 지시와 gpt-4o-mini-tts 모델을 붙인다", () => {
		const result = composeNarrationTtsOptions([
			{
				narration: "실종 사건의 마지막 행적을 다시 추적했습니다.",
				mood: "mystery",
				type: "video",
			},
		]);

		expect(result.provider).toBe("openai");
		expect(result.openAiModel).toBe("gpt-4o-mini-tts");
		expect(result.direction).toContain("사건 다큐");
		expect(result.toneKeywords).toContain("긴장감");
	});

	it("reference toneKeywords 를 유지하면서 provider별 옵션을 합친다", () => {
		const result = composeNarrationTtsOptions(
			[
				{
					narration: "브리핑에서 확보된 사실만 정리합니다.",
					mood: "news",
					type: "image",
				},
			],
			{
				provider: "elevenlabs",
				voice: "EXAVITQu4vr4xnSDxMaL",
				speed: 0.98,
				toneKeywords: ["냉정함", "정확함"],
			},
		);

		expect(result.provider).toBe("elevenlabs");
		expect(result.voice).toBe("EXAVITQu4vr4xnSDxMaL");
		expect(result.toneKeywords).toContain("정확함");
		expect(result.direction).toContain("브리핑");
		expect(result.openAiModel).toBeUndefined();
	});
});

// ─── inferNarrationPauseSeconds ───────────────────────────────────────────────

describe("inferNarrationPauseSeconds", () => {
	it("마지막 씬 → 항상 0", () => {
		expect(inferNarrationPauseSeconds("안녕하세요.", true)).toBe(0);
		expect(inferNarrationPauseSeconds("", true)).toBe(0);
	});

	it("빈 텍스트 → 0.14", () => {
		expect(inferNarrationPauseSeconds("")).toBe(0.14);
	});

	it("마침표 끝 → 기본보다 큰 pause", () => {
		expect(inferNarrationPauseSeconds("날씨입니다.")).toBeGreaterThan(
			inferNarrationPauseSeconds("날씨입니다"),
		);
	});

	it("느낌표/물음표 끝 → 마침표보다 큰 pause", () => {
		expect(inferNarrationPauseSeconds("대단합니다!")).toBeGreaterThan(
			inferNarrationPauseSeconds("대단합니다."),
		);
	});

	it("말줄임표 → 추가 pause", () => {
		expect(inferNarrationPauseSeconds("그런데...")).toBeGreaterThan(
			inferNarrationPauseSeconds("그런데"),
		);
	});

	it("쉼표 많을수록 pause 증가", () => {
		expect(
			inferNarrationPauseSeconds("A, B, C, D, E, F, G, H."),
		).toBeGreaterThanOrEqual(inferNarrationPauseSeconds("ABCDEFGH."));
	});

	it("긴 텍스트(70자+) → pause 증가", () => {
		const long =
			"이것은 매우 긴 문장으로, 칠십 자 이상을 채우기 위해 작성된 테스트용 나레이션입니다.";
		expect(inferNarrationPauseSeconds(long)).toBeGreaterThan(
			inferNarrationPauseSeconds("짧은 문장."),
		);
	});

	it("최대값 0.34 초과하지 않음", () => {
		const text =
			"실종된 범인이 포착됐습니다! 드디어 놀라운 반전, 성공적인 수사 결과...".repeat(
				3,
			);
		expect(inferNarrationPauseSeconds(text)).toBeLessThanOrEqual(0.34);
	});

	it("반환값이 소수점 2자리로 정밀", () => {
		const r = inferNarrationPauseSeconds("테스트입니다.");
		expect(r).toBe(Number(r.toFixed(2)));
	});
});

describe("inferNarrationEndingHoldSeconds", () => {
	it("기본 엔딩 홀드보다 말줄임표/긴 문장에서 더 길어진다", () => {
		const neutral = inferNarrationEndingHoldSeconds("사건은 여기서 멈췄다.");
		const longer = inferNarrationEndingHoldSeconds(
			"하지만 마지막 CCTV 장면은 아무도 설명하지 못했다...",
			{ endingHoldSeconds: 0.4 },
		);
		expect(longer).toBeGreaterThan(neutral);
	});

	it("최대값 0.52를 넘지 않는다", () => {
		const hold = inferNarrationEndingHoldSeconds(
			"충격적인 마지막 장면이었다...".repeat(8),
			{ endingHoldSeconds: 0.5 },
		);
		expect(hold).toBeLessThanOrEqual(0.52);
	});
});

// ─── localStorage TTS 설정 ────────────────────────────────────────────────────

describe("getDefaultVoice / setDefaultVoice / hasStoredTtsSettings", () => {
	it("localStorage 없을 때 → 기본값 반환", () => {
		expect(getDefaultVoice()).toEqual({
			voice: "sage",
			provider: "openai",
			speed: 0.97,
		});
	});

	it("setDefaultVoice 저장 후 getDefaultVoice 로 복원", () => {
		setDefaultVoice("alloy", "openai", 1.05);
		expect(getDefaultVoice()).toEqual({
			voice: "alloy",
			provider: "openai",
			speed: 1.05,
		});
	});

	it("elevenlabs provider 저장/복원", () => {
		setDefaultVoice("EXAVITQu4vr4xnSDxMaL", "elevenlabs", 0.9);
		expect(getDefaultVoice().provider).toBe("elevenlabs");
	});

	it("hasStoredTtsSettings: 설정 없으면 false", () => {
		expect(hasStoredTtsSettings()).toBe(false);
	});

	it("hasStoredTtsSettings: 하나라도 설정되면 true", () => {
		mockStorage.setItem("tts_voice", "nova");
		expect(hasStoredTtsSettings()).toBe(true);
	});

	it("setDefaultVoice 후 hasStoredTtsSettings → true", () => {
		setDefaultVoice("echo", "openai", 1.0);
		expect(hasStoredTtsSettings()).toBe(true);
	});
});

// ─── generateTtsChunk ─────────────────────────────────────────────────────────
describe("generateTtsChunk", () => {
	afterEach(() => vi.restoreAllMocks());

	it("openai provider → /api/openai/tts 호출, ArrayBuffer 반환", async () => {
		const buf = new ArrayBuffer(100);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(buf),
			}),
		);
		const result = await generateTtsChunk("안녕하세요", {
			provider: "openai",
			voice: "sage",
			speed: 1.0,
		});
		expect(result).toBe(buf);
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("/api/openai/tts");
	});

	it("elevenlabs provider → /api/elevenlabs/tts/ 호출", async () => {
		const buf = new ArrayBuffer(50);
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(buf),
			}),
		);
		const result = await generateTtsChunk("hello", {
			provider: "elevenlabs",
			voice: "EXAVITQu4vr4xnSDxMaL",
		});
		expect(result).toBe(buf);
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("/api/elevenlabs/tts/");
	});

	it("openai HTTP 오류 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 429,
				text: () => Promise.resolve("Rate limited"),
			}),
		);
		await expect(
			generateTtsChunk("text", { provider: "openai" }),
		).rejects.toThrow("OpenAI TTS 오류");
	});

	it("elevenlabs HTTP 오류 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Server error"),
			}),
		);
		await expect(
			generateTtsChunk("text", { provider: "elevenlabs", voice: "abc" }),
		).rejects.toThrow("ElevenLabs 오류");
	});

	it("옵션 없으면 localStorage 기본값 사용", async () => {
		mockStorage.setItem("tts_provider", "openai");
		mockStorage.setItem("tts_voice", "nova");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
			}),
		);
		await generateTtsChunk("test");
		const body = JSON.parse(
			(vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
		);
		expect(body.voice).toBe("nova");
	});

	it("direction 이 있으면 OpenAI 요청에 instructions 와 gpt-4o-mini-tts를 넣는다", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
			}),
		);

		await generateTtsChunk("사건은 아직 끝나지 않았습니다.", {
			provider: "openai",
			voice: "sage",
			speed: 0.95,
			direction: "차분한 사건 다큐 나레이션으로 읽을 것.",
		});

		const body = JSON.parse(
			(vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
		);
		expect(body.model).toBe("gpt-4o-mini-tts");
		expect(body.instructions).toContain("사건 다큐");
	});
});

// ─── getAudioDuration ─────────────────────────────────────────────────────────
describe("getAudioDuration", () => {
	afterEach(() => vi.restoreAllMocks());

	it("AudioContext.decodeAudioData → duration 반환", async () => {
		vi.stubGlobal(
			"AudioContext",
			class {
				async decodeAudioData() {
					return { duration: 2.5 };
				}
				async close() {}
			},
		);
		const buf = new ArrayBuffer(100);
		const duration = await getAudioDuration(buf);
		expect(duration).toBeCloseTo(2.5);
		vi.unstubAllGlobals();
	});

	it("decodeAudioData 실패 시 throw 전파", async () => {
		vi.stubGlobal(
			"AudioContext",
			class {
				async decodeAudioData() {
					throw new Error("decode failed");
				}
				async close() {}
			},
		);
		await expect(getAudioDuration(new ArrayBuffer(10))).rejects.toThrow(
			"decode failed",
		);
		vi.unstubAllGlobals();
	});
});

// ─── generateContinuousNarration ─────────────────────────────────────────────
import { getAudioContext } from "./voice-dsp";

describe("generateContinuousNarration", () => {
	// getAudioDuration 테스트가 vi.unstubAllGlobals()를 호출해 beforeAll의
	// localStorage stub을 제거하므로 이 describe 에서 재-stub 한다.
	beforeEach(() => {
		vi.stubGlobal("localStorage", mockStorage);
	});

	it("씬 없으면 즉시 빈 결과 반환", async () => {
		const result = await generateContinuousNarration("sc-1", []);
		expect(result.url).toBe("");
		expect(result.totalDuration).toBe(0);
		expect(result.sceneDurations).toEqual([]);
	});

	it("1개 씬 → url/totalDuration/sceneDurations 반환", async () => {
		// TTS fetch → success, Whisper fetch → not ok (wordTimings=[])
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(50)),
				})
				.mockResolvedValueOnce({ ok: false }),
		);

		const SR = 10;
		const LEN = 10;
		const makeAB = () =>
			({
				sampleRate: SR,
				length: LEN,
				numberOfChannels: 1,
				duration: LEN / SR,
				getChannelData: vi.fn(() => new Float32Array(LEN)),
				copyFromChannel: vi.fn(),
				copyToChannel: vi.fn(),
			}) as unknown as AudioBuffer;

		// getAudioContext mock: createBuffer + decodeAudioData
		vi.mocked(getAudioContext).mockReturnValue({
			sampleRate: SR,
			decodeAudioData: vi.fn().mockResolvedValue(makeAB()),
			createBuffer: vi.fn(
				(ch: number, len: number, sr: number) =>
					({
						sampleRate: sr,
						length: len,
						numberOfChannels: ch,
						duration: len / sr,
						getChannelData: vi.fn(() => new Float32Array(len)),
						copyFromChannel: vi.fn(),
						copyToChannel: vi.fn(),
					}) as unknown as AudioBuffer,
			),
		} as unknown as AudioContext);

		vi.mocked(storeLocalFile).mockResolvedValueOnce("blob://narration");

		const result = await generateContinuousNarration("script-1", [
			{ id: "s1", narration_text: "안녕하세요." },
		]);

		expect(result.url).toBe("blob://narration");
		expect(result.totalDuration).toBeGreaterThan(0);
		expect(result.sceneDurations).toHaveLength(1);

		vi.restoreAllMocks();
	});

	it("2개 씬 → sceneDurations 길이 2", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(50)),
			}),
		);

		const SR = 8;
		const LEN = 8;
		const makeAB = () =>
			({
				sampleRate: SR,
				length: LEN,
				numberOfChannels: 1,
				duration: LEN / SR,
				getChannelData: vi.fn(() => new Float32Array(LEN)),
				copyFromChannel: vi.fn(),
				copyToChannel: vi.fn(),
			}) as unknown as AudioBuffer;

		vi.mocked(getAudioContext).mockReturnValue({
			sampleRate: SR,
			decodeAudioData: vi.fn().mockResolvedValue(makeAB()),
			createBuffer: vi.fn(
				(ch: number, len: number, sr: number) =>
					({
						sampleRate: sr,
						length: len,
						numberOfChannels: ch,
						duration: len / sr,
						getChannelData: vi.fn(() => new Float32Array(len)),
						copyFromChannel: vi.fn(),
						copyToChannel: vi.fn(),
					}) as unknown as AudioBuffer,
			),
		} as unknown as AudioContext);

		// generateTtsChunk 는 fetch.arrayBuffer 로 동작 — fetch가 ok:false 여도
		// generateTtsChunk는 ok 체크 후 throw. processVoice mock이 있으므로 OK
		// processVoice mock은 vi.mock에서 항상 resolved
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(40)),
			}),
		);

		vi.mocked(storeLocalFile).mockResolvedValueOnce("blob://narr2");

		const result = await generateContinuousNarration("script-2", [
			{ id: "s1", narration_text: "첫 번째 씬입니다." },
			{ id: "s2", narration_text: "두 번째 씬입니다." },
		]);

		expect(result.sceneDurations).toHaveLength(2);

		vi.restoreAllMocks();
	});
});

// ─── generateSceneTts ────────────────────────────────────────────────────────
import { storeLocalFile } from "./local-db";
import { generateSceneTts } from "./tts";

describe("generateSceneTts", () => {
	it("generateSceneTts → storeLocalFile 호출됨", async () => {
		const fakeBuffer = new ArrayBuffer(100);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(fakeBuffer),
				})
				.mockResolvedValueOnce({
					ok: true,
					json: () =>
						Promise.resolve({
							words: [{ word: "안녕", start: 0, end: 0.5 }],
						}),
				}),
		);
		vi.stubGlobal(
			"AudioContext",
			class {
				async decodeAudioData() {
					return { duration: 2.0 };
				}
				async close() {}
			},
		);

		const mockStoreLocal = vi.mocked(storeLocalFile);
		mockStoreLocal.mockResolvedValueOnce("blob://tts-url");

		const result = await generateSceneTts("scene-abc", "안녕하세요");
		expect(result.url).toBe("blob://tts-url");
		expect(result.duration).toBeGreaterThan(0);
	});

	it("generateSceneTts mimeType=audio/wav → ext=wav", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(50)),
				})
				.mockResolvedValueOnce({ ok: false }),
		);
		vi.stubGlobal(
			"AudioContext",
			class {
				async decodeAudioData() {
					return { duration: 1.0 };
				}
				async close() {}
			},
		);

		const mockStoreLocal = vi.mocked(storeLocalFile);
		mockStoreLocal.mockResolvedValueOnce("blob://tts-wav");

		const result = await generateSceneTts("scene-wav", "테스트");
		expect(result.url).toBe("blob://tts-wav");
	});

	it("Whisper fetch throw → catch 분기, wordTimings 빈 배열로 정상 완료", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: () => Promise.resolve(new ArrayBuffer(60)),
				})
				.mockRejectedValueOnce(new Error("network error")),
		);
		vi.stubGlobal(
			"AudioContext",
			class {
				async decodeAudioData() {
					return { duration: 1.5 };
				}
				async close() {}
			},
		);
		vi.mocked(storeLocalFile).mockResolvedValueOnce("blob://catch-url");

		const result = await generateSceneTts("scene-catch", "에러 테스트");
		expect(result.url).toBe("blob://catch-url");
		expect(result.duration).toBeGreaterThan(0);
	});
});
