import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./proxy", () => ({
	getReferenceAnalyzerUrl: () => "http://localhost:3460",
}));

const mocks = vi.hoisted(() => {
	const mockSingle = vi.fn();
	const mockMaybeSingle = vi.fn();
	const mockOrder = vi.fn(() => ({
		data: [] as unknown,
		error: null as unknown,
	}));
	const mockEqSelect = vi.fn(() => ({
		order: mockOrder,
		maybeSingle: mockMaybeSingle,
	}));
	const mockSelect = vi.fn(() => ({ eq: mockEqSelect, single: mockSingle }));
	const mockEqUpdate = vi.fn(() => ({
		data: null as unknown,
		error: null as unknown,
	}));
	const mockUpdate = vi.fn(() => ({ eq: mockEqUpdate }));
	const mockEqDelete = vi.fn(() => ({
		data: null as unknown,
		error: null as unknown,
	}));
	const mockDelete = vi.fn(() => ({ eq: mockEqDelete }));
	const mockInsert = vi.fn(() => ({ select: mockSelect }));
	const mockFrom = vi.fn(() => ({
		insert: mockInsert,
		select: mockSelect,
		update: mockUpdate,
		delete: mockDelete,
	}));
	return {
		mockSingle,
		mockMaybeSingle,
		mockOrder,
		mockEqSelect,
		mockSelect,
		mockEqUpdate,
		mockUpdate,
		mockEqDelete,
		mockDelete,
		mockInsert,
		mockFrom,
	};
});

vi.mock("./supabase", () => ({ supabase: { from: mocks.mockFrom } }));

import {
	type AnalysisJob,
	type AnalysisJobResult,
	checkAnalyzerHealth,
	cleanupAnalysisJob,
	deleteReferenceTemplate,
	fetchAnalysisJob,
	getReferenceTemplate,
	listReferenceTemplates,
	saveReferenceTemplate,
	startYouTubeAnalysis,
	updateReferenceTemplate,
	waitForAnalysis,
} from "./reference-import";
import {
	BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID,
	isBuiltInReference,
	listBuiltInReferenceTemplates,
} from "./reference-template-presets";

function makeJob(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
	return {
		id: "job-1",
		status: "complete",
		progress: 100,
		input: { type: "youtube", url: "https://youtu.be/abc" },
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

function makeResult(): AnalysisJobResult {
	return {
		source_type: "youtube",
		source_url: "https://youtu.be/abc",
		source_title: "Test",
		source_creator: "Creator",
		thumbnail_url: "https://img.example.com/thumb.jpg",
		duration_seconds: 120,
		dominant_colors: ["#000", "#fff"],
		visual_mood: "neutral",
		visual_prompt_template: "dark alley",
		lighting_style: "dark",
		subtitle_position: "bottom",
		subtitle_size_preset: "md",
		subtitle_bg_style: "block",
		subtitle_accent_color: "#ff0000",
		scene_count: 10,
		avg_scene_duration: 3,
		hook_duration: 5,
		transition_style: "hardcut",
		pacing_preset: "medium",
		tts_voice_id: "sage",
		tts_provider: "openai",
		tts_speed: 0.97,
		tts_tone_keywords: ["suspense"],
		bgm_mood: "dark",
		bgm_keywords: ["tense"],
		bgm_tempo: "slow",
		hook_pattern: "question",
		script_structure: [
			{ role: "hook", duration: 5, note: "" },
			{ role: "body", duration: 60, note: "" },
			{ role: "outro", duration: 10, note: "" },
		],
		transcript: "Hello world",
		frame_urls: [],
		raw_analysis: {},
	};
}

afterEach(() => vi.restoreAllMocks());

// ─── startYouTubeAnalysis ─────────────────────────────────────────────────────
describe("startYouTubeAnalysis", () => {
	it("성공 → job 반환", async () => {
		const job = makeJob({ status: "queued" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		const result = await startYouTubeAnalysis("https://youtu.be/abc");
		expect(result.id).toBe("job-1");
		const call = vi.mocked(fetch).mock.calls[0];
		expect(call[0] as string).toContain("/api/reference/analyze");
		expect((call[1] as RequestInit).method).toBe("POST");
		expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
			type: "youtube",
			url: "https://youtu.be/abc",
			mode: "auto",
		});
	});

	it("분석 모드 지정 → request body에 포함", async () => {
		const job = makeJob({ status: "queued" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		await startYouTubeAnalysis("https://youtu.be/abc", { mode: "longform" });
		const call = vi.mocked(fetch).mock.calls[0];
		expect(JSON.parse(String((call[1] as RequestInit).body)).mode).toBe(
			"longform",
		);
	});

	it("딥 레퍼런스 모드 지정 → request body에 포함", async () => {
		const job = makeJob({ status: "queued" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		await startYouTubeAnalysis("https://youtu.be/abc", { mode: "deep" });
		const call = vi.mocked(fetch).mock.calls[0];
		expect(JSON.parse(String((call[1] as RequestInit).body)).mode).toBe(
			"deep",
		);
	});

	it("HTTP 오류 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				text: () => Promise.resolve("Internal Error"),
			}),
		);
		await expect(startYouTubeAnalysis("https://youtu.be/abc")).rejects.toThrow(
			"500",
		);
	});
});

// ─── fetchAnalysisJob ─────────────────────────────────────────────────────────
describe("fetchAnalysisJob", () => {
	it("성공 → job 반환", async () => {
		const job = makeJob();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		const result = await fetchAnalysisJob("job-1");
		expect(result.id).toBe("job-1");
		expect(vi.mocked(fetch).mock.calls[0][0] as string).toContain(
			"/api/reference/job/job-1",
		);
	});

	it("HTTP 오류 → throw", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 404 }),
		);
		await expect(fetchAnalysisJob("no-such")).rejects.toThrow("404");
	});
});

// ─── waitForAnalysis ──────────────────────────────────────────────────────────
describe("waitForAnalysis", () => {
	it("complete 즉시 → job 반환", async () => {
		const job = makeJob({ status: "complete" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		const result = await waitForAnalysis("job-1", undefined, { intervalMs: 0 });
		expect(result.status).toBe("complete");
	});

	it("failed → job 반환 (throw 없음)", async () => {
		const job = makeJob({ status: "failed", error: "처리 실패" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		const result = await waitForAnalysis("job-1", undefined, { intervalMs: 0 });
		expect(result.status).toBe("failed");
	});

	it("onProgress 콜백 호출", async () => {
		const progress = vi.fn();
		const job = makeJob({ status: "complete" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		await waitForAnalysis("job-1", progress, { intervalMs: 0 });
		expect(progress).toHaveBeenCalledWith(job);
	});

	it("timeout → throw", async () => {
		const job = makeJob({ status: "analyzing" });
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ job }),
			}),
		);
		await expect(
			waitForAnalysis("job-1", undefined, { intervalMs: 0, timeoutMs: 1 }),
		).rejects.toThrow("시간 초과");
	});
});

// ─── cleanupAnalysisJob ───────────────────────────────────────────────────────
describe("cleanupAnalysisJob", () => {
	it("성공 → no throw", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		await expect(cleanupAnalysisJob("job-1")).resolves.toBeUndefined();
		expect(vi.mocked(fetch).mock.calls[0][0] as string).toContain("/cleanup");
	});

	it("네트워크 오류 → silently 무시 (no throw)", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
		await expect(cleanupAnalysisJob("job-1")).resolves.toBeUndefined();
	});
});

// ─── checkAnalyzerHealth ──────────────────────────────────────────────────────
describe("checkAnalyzerHealth", () => {
	it("ok → true", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
		expect(await checkAnalyzerHealth()).toBe(true);
	});

	it("ok:false → false", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
		expect(await checkAnalyzerHealth()).toBe(false);
	});

	it("네트워크 오류 → false", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
		expect(await checkAnalyzerHealth()).toBe(false);
	});
});

// ─── saveReferenceTemplate ────────────────────────────────────────────────────
describe("saveReferenceTemplate", () => {
	beforeEach(() => {
		mocks.mockFrom.mockClear();
		mocks.mockInsert.mockClear();
		mocks.mockSelect.mockClear();
		mocks.mockSingle.mockClear();
	});

	it("성공 → ReferenceTemplate 반환", async () => {
		const template = { id: "ref-1", name: "Test" };
		mocks.mockSingle.mockResolvedValue({ data: template, error: null });
		const result = await saveReferenceTemplate("ch-1", "Test", makeResult());
		expect(result).toEqual(template);
		expect(mocks.mockFrom).toHaveBeenCalledWith("reference_templates");
		expect(mocks.mockInsert).toHaveBeenCalled();
	});

	it("supabase 오류 → throw", async () => {
		mocks.mockSingle.mockResolvedValue({
			data: null,
			error: { message: "insert failed" },
		});
		await expect(
			saveReferenceTemplate("ch-1", "T", makeResult()),
		).rejects.toThrow("저장 실패");
	});
});

// ─── listReferenceTemplates ───────────────────────────────────────────────────
describe("listReferenceTemplates", () => {
	beforeEach(() => {
		mocks.mockFrom.mockClear();
		mocks.mockOrder.mockClear();
	});

	it("성공 → 배열 반환", async () => {
		const rows = [{ id: "r1" }, { id: "r2" }];
		mocks.mockOrder.mockReturnValue({ data: rows, error: null });
		const result = await listReferenceTemplates("ch-1");
		expect(result).toHaveLength(listBuiltInReferenceTemplates().length + 2);
		expect(result[0].channel_id).toBe("ch-1");
		expect(isBuiltInReference(result[0])).toBe(true);
		expect(result.at(-1)).toEqual(rows[1]);
	});

	it("data null → 내장 템플릿만 반환", async () => {
		mocks.mockOrder.mockReturnValue({ data: null, error: null });
		const result = await listReferenceTemplates("ch-1");
		expect(result).toHaveLength(listBuiltInReferenceTemplates().length);
		expect(result.every((row) => row.channel_id === "ch-1")).toBe(true);
	});

	it("오류 → throw", async () => {
		mocks.mockOrder.mockReturnValue({
			data: null,
			error: { message: "DB error" },
		});
		await expect(listReferenceTemplates("ch-1")).rejects.toThrow("DB error");
	});
});

// ─── getReferenceTemplate ─────────────────────────────────────────────────────
describe("getReferenceTemplate", () => {
	beforeEach(() => {
		mocks.mockMaybeSingle.mockClear();
	});

	it("존재 → 반환", async () => {
		const row = { id: "r1", name: "My Template" };
		mocks.mockMaybeSingle.mockResolvedValue({ data: row, error: null });
		const result = await getReferenceTemplate("r1");
		expect(result).toEqual(row);
	});

	it("내장 템플릿 ID → Supabase 조회 없이 반환", async () => {
		mocks.mockMaybeSingle.mockClear();
		const result = await getReferenceTemplate("builtin-social-clip-real-video");
		expect(result?.id).toBe("builtin-social-clip-real-video");
		expect(result?.channel_id).toBe(BUILT_IN_REFERENCE_TEMPLATE_CHANNEL_ID);
		expect(isBuiltInReference(result)).toBe(true);
		expect(mocks.mockMaybeSingle).not.toHaveBeenCalled();
	});

	it("없음 → null", async () => {
		mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });
		const result = await getReferenceTemplate("nonexistent");
		expect(result).toBeNull();
	});

	it("오류 → throw", async () => {
		mocks.mockMaybeSingle.mockResolvedValue({
			data: null,
			error: { message: "query failed" },
		});
		await expect(getReferenceTemplate("r1")).rejects.toThrow("query failed");
	});
});

// ─── updateReferenceTemplate ──────────────────────────────────────────────────
describe("updateReferenceTemplate", () => {
	beforeEach(() => {
		mocks.mockUpdate.mockClear();
		mocks.mockEqUpdate.mockClear();
	});

	it("성공 → no throw", async () => {
		mocks.mockEqUpdate.mockReturnValue({ data: null, error: null });
		await expect(
			updateReferenceTemplate("r1", { name: "New" }),
		).resolves.toBeUndefined();
		expect(mocks.mockUpdate).toHaveBeenCalled();
	});

	it("오류 → throw", async () => {
		mocks.mockEqUpdate.mockReturnValue({
			data: null,
			error: { message: "update failed" },
		});
		await expect(updateReferenceTemplate("r1", {})).rejects.toThrow(
			"update failed",
		);
	});

	it("내장 템플릿 수정 → throw", async () => {
		await expect(
			updateReferenceTemplate("builtin-social-clip-real-video", {
				name: "Changed",
			}),
		).rejects.toThrow("내장 레퍼런스");
	});
});

// ─── deleteReferenceTemplate ──────────────────────────────────────────────────
describe("deleteReferenceTemplate", () => {
	beforeEach(() => {
		mocks.mockDelete.mockClear();
		mocks.mockEqDelete.mockClear();
	});

	it("성공 → no throw", async () => {
		mocks.mockEqDelete.mockReturnValue({ data: null, error: null });
		await expect(deleteReferenceTemplate("r1")).resolves.toBeUndefined();
		expect(mocks.mockDelete).toHaveBeenCalled();
	});

	it("오류 → throw", async () => {
		mocks.mockEqDelete.mockReturnValue({
			data: null,
			error: { message: "delete failed" },
		});
		await expect(deleteReferenceTemplate("r1")).rejects.toThrow(
			"delete failed",
		);
	});

	it("내장 템플릿 삭제 → throw", async () => {
		await expect(
			deleteReferenceTemplate("builtin-social-clip-real-video"),
		).rejects.toThrow("내장 레퍼런스");
	});
});
