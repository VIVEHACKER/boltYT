import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./proxy", () => ({ getApiProxyUrl: () => "http://localhost:3456" }));
vi.mock("./telemetry-sink", () => ({
	queueTelemetry: vi.fn(),
	installTelemetryFlushers: vi.fn(),
}));

import {
	AUTO_FIX_RULES,
	clearErrors,
	clearServerErrors,
	dispatchOrder,
	getHealth,
	getMetrics,
	getServerErrors,
	listErrors,
	parseOrder,
	reportError,
	runAgent,
	runAutoFixes,
	runServerCommand,
	subscribeErrors,
} from "./diag";

// localStorage stub
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
afterEach(() => {
	clearErrors();
	mockStorage.clear();
	vi.restoreAllMocks();
});

// ─── listErrors / clearErrors / reportError ───────────────────────────────────
describe("reportError / listErrors / clearErrors", () => {
	it("reportError → listErrors에 추가", () => {
		reportError("test error", "detail here");
		const list = listErrors();
		expect(list).toHaveLength(1);
		expect(list[0].message).toBe("test error");
		expect(list[0].detail).toBe("detail here");
		expect(list[0].source).toBe("manual");
	});

	it("reportError extra.source override", () => {
		reportError("fetch error", undefined, { source: "fetch", status: 500 });
		expect(listErrors()[0].source).toBe("fetch");
		expect(listErrors()[0].status).toBe(500);
	});

	it("clearErrors → 빈 배열", () => {
		reportError("err1");
		reportError("err2");
		clearErrors();
		expect(listErrors()).toHaveLength(0);
	});

	it("listErrors는 복사본 반환 (원본 보호)", () => {
		reportError("x");
		const a = listErrors();
		const b = listErrors();
		expect(a).not.toBe(b);
	});
});

// ─── subscribeErrors ──────────────────────────────────────────────────────────
describe("subscribeErrors", () => {
	it("에러 발생 시 콜백 호출", () => {
		const cb = vi.fn();
		subscribeErrors(cb);
		reportError("hello");
		expect(cb).toHaveBeenCalledWith(
			expect.objectContaining({ message: "hello" }),
		);
		// unsubscribe 반환값으로 정리
		// (테스트 격리용 — afterEach에서 clearErrors 호출됨)
	});

	it("unsubscribe 후 콜백 미호출", () => {
		const cb = vi.fn();
		const unsub = subscribeErrors(cb);
		unsub();
		reportError("world");
		expect(cb).not.toHaveBeenCalled();
	});
});

// ─── parseOrder ───────────────────────────────────────────────────────────────
describe("parseOrder", () => {
	it("빈 문자열 → null", () => {
		expect(parseOrder("")).toBeNull();
	});

	it("env reload 명령 인식", () => {
		expect(parseOrder("env 재로드")).toEqual(
			expect.objectContaining({ target: "reload-env" }),
		);
	});

	it("reload env 순서도 인식", () => {
		expect(parseOrder("reload env please")).toEqual(
			expect.objectContaining({ target: "reload-env" }),
		);
	});

	it("캐시 비우기 → clear-cache", () => {
		const r = parseOrder("cache clear");
		expect(r?.target).toBe("clear-cache");
	});

	it("기사 캐시 → target 'article'", () => {
		const r = parseOrder("article cache clear");
		expect(r?.args.target).toBe("article");
	});

	it("검색 캐시 → target 'search'", () => {
		const r = parseOrder("search cache 비우기");
		expect(r?.args.target).toBe("search");
	});

	it("키 확인 → check-keys", () => {
		const r = parseOrder("키 확인");
		expect(r?.target).toBe("check-keys");
	});

	it("key check → check-keys", () => {
		expect(parseOrder("key check")).toEqual(
			expect.objectContaining({ target: "check-keys" }),
		);
	});

	it("서버 ping → ping-servers", () => {
		expect(parseOrder("ping 서버 all")).toEqual(
			expect.objectContaining({ target: "ping-servers" }),
		);
	});

	it("localstorage clear → client:clear-localstorage", () => {
		const r = parseOrder("localstorage clear");
		expect(r?.target).toBe("client:clear-localstorage");
	});

	it("에러 로그 삭제 → client:clear-errors", () => {
		const r = parseOrder("에러 clear");
		expect(r?.target).toBe("client:clear-errors");
	});

	it("인식 불가 → null", () => {
		expect(parseOrder("hello world nothing")).toBeNull();
	});
});

// ─── dispatchOrder ────────────────────────────────────────────────────────────
describe("dispatchOrder", () => {
	it("client:clear-localstorage → localStorage 초기화", async () => {
		mockStorage.setItem("key1", "val1");
		const result = await dispatchOrder({
			target: "client:clear-localstorage",
			args: {},
			label: "clear",
		});
		expect(result.ok).toBe(true);
		expect(mockStorage.getItem("key1")).toBeNull();
	});

	it("client:clear-localstorage → localStorage.clear 실패 시 ok:false", async () => {
		vi.stubGlobal("localStorage", {
			clear: () => {
				throw new Error("storage locked");
			},
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
		});
		const result = await dispatchOrder({
			target: "client:clear-localstorage",
			args: {},
			label: "clear",
		});
		expect(result.ok).toBe(false);
		expect(result.message).toContain("storage locked");
		vi.stubGlobal("localStorage", mockStorage);
	});

	it("client:clear-errors → errors 비움", async () => {
		reportError("to be cleared");
		const result = await dispatchOrder({
			target: "client:clear-errors",
			args: {},
			label: "clear",
		});
		expect(result.ok).toBe(true);
		expect(listErrors()).toHaveLength(0);
	});

	it("server command → fetch 호출", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ ok: true, message: "done" }),
			}),
		);
		const result = await dispatchOrder({
			target: "reload-env",
			args: {},
			label: "reload",
		});
		expect(result.ok).toBe(true);
	});
});

// ─── getHealth / getMetrics ───────────────────────────────────────────────────
describe("getHealth", () => {
	it("성공 → 데이터 반환", async () => {
		const data = { timestamp: "2026-01-01", servers: [] };
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) }),
		);
		const result = await getHealth();
		expect(result).toEqual(data);
	});

	it("HTTP 오류 → null", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 503 }),
		);
		expect(await getHealth()).toBeNull();
	});

	it("네트워크 오류 → null", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
		expect(await getHealth()).toBeNull();
	});
});

describe("getMetrics", () => {
	it("성공 → 데이터 반환", async () => {
		const data = { ts: 1, counters: [], histograms: [], gauges: [] };
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue({ ok: true, json: () => Promise.resolve(data) }),
		);
		expect(await getMetrics()).toEqual(data);
	});

	it("실패 → null", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		expect(await getMetrics()).toBeNull();
	});

	it("네트워크 오류 → null", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
		expect(await getMetrics()).toBeNull();
	});
});

// ─── getServerErrors ──────────────────────────────────────────────────────────
describe("getServerErrors", () => {
	it("성공 → errors 배열 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ errors: [{ id: "e1" }] }),
			}),
		);
		const errs = await getServerErrors();
		expect(errs).toHaveLength(1);
	});

	it("errors 없으면 빈 배열", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }),
		);
		expect(await getServerErrors()).toEqual([]);
	});

	it("HTTP 오류 → 빈 배열", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		expect(await getServerErrors()).toEqual([]);
	});

	it("네트워크 오류 → 빈 배열", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net fail")));
		expect(await getServerErrors()).toEqual([]);
	});

	it("쿼리 파라미터 전달", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ errors: [] }),
			}),
		);
		await getServerErrors({ service: "proxy", level: "error", limit: 10 });
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain("service=proxy");
		expect(url).toContain("level=error");
		expect(url).toContain("limit=10");
	});
});

describe("clearServerErrors", () => {
	it("성공 → true", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		expect(await clearServerErrors()).toBe(true);
	});

	it("오류 → false", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		expect(await clearServerErrors()).toBe(false);
	});

	it("네트워크 오류 → false", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net fail")));
		expect(await clearServerErrors()).toBe(false);
	});
});

// ─── runServerCommand ─────────────────────────────────────────────────────────
describe("runServerCommand", () => {
	it("성공 → 결과 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ ok: true, message: "done" }),
			}),
		);
		const r = await runServerCommand("reload-env");
		expect(r.ok).toBe(true);
	});

	it("네트워크 오류 → ok:false 반환", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net fail")));
		const r = await runServerCommand("cmd");
		expect(r.ok).toBe(false);
		expect(r.message).toContain("net fail");
	});
});

// ─── runAgent ─────────────────────────────────────────────────────────────────
describe("runAgent", () => {
	it("성공 응답 → AgentResult 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						goal: "test",
						resolved: true,
						summary: "done",
						trace: [],
						iterations: 1,
					}),
			}),
		);
		const r = await runAgent("test goal");
		expect((r as { resolved: boolean }).resolved).toBe(true);
	});

	it("HTTP 오류 → { error } 반환", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				text: () => Promise.resolve("server error"),
			}),
		);
		const r = await runAgent("test goal");
		expect((r as { error: string }).error).toContain("HTTP 500");
	});

	it("네트워크 오류 → { error } 반환", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("agent fail")));
		const r = await runAgent("test goal");
		expect((r as { error: string }).error).toContain("agent fail");
	});
});

// ─── AUTO_FIX_RULES / runAutoFixes ────────────────────────────────────────────
describe("AUTO_FIX_RULES", () => {
	it("missing-openai 규칙 존재", () => {
		const rule = AUTO_FIX_RULES.find((r) => r.id === "missing-openai");
		expect(rule).toBeDefined();
	});

	it("missing-openai matches OpenAI 키 누락 리포트", () => {
		const rule = AUTO_FIX_RULES.find((r) => r.id === "missing-openai");
		if (!rule) throw new Error("rule not found");
		const report = {
			timestamp: "",
			apiProxy: { uptimeSeconds: 0, startedAt: "" },
			keys: { configured: [], missing: ["openai"] },
			servers: [],
			caches: {},
		};
		expect(rule.matches(report)).toBe(true);
	});

	it("missing-openai not matched if openai present", () => {
		const rule = AUTO_FIX_RULES.find((r) => r.id === "missing-openai");
		if (!rule) throw new Error("rule not found");
		const report = {
			timestamp: "",
			apiProxy: { uptimeSeconds: 0, startedAt: "" },
			keys: { configured: ["openai"], missing: [] },
			servers: [],
			caches: {},
		};
		expect(rule.matches(report)).toBe(false);
	});
});

// ─── installErrorSink ─────────────────────────────────────────────────────────
import { installErrorSink } from "./diag";
import { installTelemetryFlushers, queueTelemetry } from "./telemetry-sink";

describe("installErrorSink", () => {
	it("error 이벤트 → window source로 listErrors에 추가 (reportError mock)", () => {
		clearErrors();
		reportError("window error sim", "stack trace", { source: "window" });
		const list = listErrors();
		expect(list.some((e) => e.source === "window")).toBe(true);
	});

	it("unhandledrejection source → detail 있음", () => {
		clearErrors();
		reportError("unhandled", "some detail", { source: "unhandledrejection" });
		expect(listErrors()[0].source).toBe("unhandledrejection");
		expect(listErrors()[0].detail).toBe("some detail");
	});

	it("fetch source + status 없음 → queueTelemetry level=warn", () => {
		const qt = vi.mocked(queueTelemetry);
		clearErrors();
		reportError("fetch warn", undefined, { source: "fetch" }); // status undefined
		expect(qt).toHaveBeenCalledWith(expect.objectContaining({ level: "warn" }));
	});

	it("fetch source + status 있음 → queueTelemetry level=error", () => {
		const qt = vi.mocked(queueTelemetry);
		clearErrors();
		reportError("fetch error", undefined, { source: "fetch", status: 500 });
		expect(qt).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
	});

	it("MAX_ERRORS 초과 시 배열 크기 제한", () => {
		clearErrors();
		for (let i = 0; i < 210; i++) {
			reportError(`error-${i}`);
		}
		expect(listErrors().length).toBeLessThanOrEqual(200);
	});

	it("두 번 호출해도 idempotent (window stub)", () => {
		// window 스텁으로 첫 번째 설치 성공, 두 번째는 early return
		const mockWindow = {
			addEventListener: vi.fn(),
			fetch: vi.fn().mockResolvedValue({ ok: true }),
		};
		vi.stubGlobal("window", mockWindow);

		const flushers = vi.mocked(installTelemetryFlushers);
		const callsBefore = flushers.mock.calls.length;
		installErrorSink(); // 첫 번째 or already installed → early return
		installErrorSink(); // 두 번째 → early return
		// installed 후에는 flushers 추가 호출 없음
		expect(flushers.mock.calls.length).toBeLessThanOrEqual(callsBefore + 1);

		vi.stubGlobal("window", undefined);
	});
});

describe("runAutoFixes", () => {
	it("규칙 매칭 시 runServerCommand 호출", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ ok: true, message: "env reloaded" }),
			}),
		);
		const report = {
			timestamp: "",
			apiProxy: { uptimeSeconds: 0, startedAt: "" },
			keys: { configured: [], missing: ["openai"] },
			servers: [],
			caches: {},
		};
		const results = await runAutoFixes(report);
		expect(results).toHaveLength(1);
		expect(results[0].rule.id).toBe("missing-openai");
		expect(results[0].results[0].ok).toBe(true);
	});

	it("매칭 없으면 빈 배열", async () => {
		const report = {
			timestamp: "",
			apiProxy: { uptimeSeconds: 0, startedAt: "" },
			keys: { configured: ["openai"], missing: [] },
			servers: [],
			caches: {},
		};
		expect(await runAutoFixes(report)).toEqual([]);
	});
});
