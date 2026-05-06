import { describe, expect, it } from "vitest";
import {
	checkContentPipelineHealth,
	summarizeContentPipelineHealth,
	type PipelineServiceHealth,
	type PipelineServiceProbe,
} from "./content-pipeline-health";

const probes: PipelineServiceProbe[] = [
	{
		id: "api-proxy",
		label: "API Proxy",
		role: "generation",
		url: "http://local/api/health",
		requiredFor: ["topic", "script", "media"],
	},
	{
		id: "render-queue",
		label: "Render Queue",
		role: "render",
		url: "http://local/render/health",
		requiredFor: ["render"],
	},
];

describe("content-pipeline-health", () => {
	it("api/render가 모두 정상이면 ready", async () => {
		const fetchImpl = async () =>
			new Response(JSON.stringify({ ok: true, configured: ["openai"] }), {
				status: 200,
			});
		const report = await checkContentPipelineHealth({
			services: probes,
			fetchImpl,
		});
		expect(report.overall).toBe("ready");
		expect(report.blockers).toHaveLength(0);
	});

	it("api-proxy가 꺼져 있으면 blocked", () => {
		const services: PipelineServiceHealth[] = [
			{
				...probes[0],
				ok: false,
				status: "offline",
				message: "down",
			},
			{
				...probes[1],
				ok: true,
				status: "online",
				message: "ok",
			},
		];
		const report = summarizeContentPipelineHealth(services, "now");
		expect(report.overall).toBe("blocked");
		expect(report.blockers.join(" ")).toContain("api-proxy");
	});

	it("api-proxy가 quota 대기 중이면 blocked가 아니라 degraded", async () => {
		const fetchImpl = async (url: string | URL | Request) =>
			new Response(
				JSON.stringify(
					String(url).includes("api")
						? {
								ok: true,
								configured: ["openai"],
								openaiRuntime: {
									quotaBlocked: true,
									quotaBlockedUntil: "2026-05-07T00:00:00.000Z",
								},
							}
						: { ok: true },
				),
				{ status: 200 },
			);
		const report = await checkContentPipelineHealth({
			services: probes,
			fetchImpl,
		});
		expect(report.overall).toBe("degraded");
		expect(report.blockers).toHaveLength(0);
		expect(report.warnings.join(" ")).toContain("OpenAI");
		expect(report.services[0].status).toBe("degraded");
	});

	it("최근 quota 실패 후 정상 응답이 없으면 cooldown이 끝나도 degraded", async () => {
		const fetchImpl = async (url: string | URL | Request) =>
			new Response(
				JSON.stringify(
					String(url).includes("api")
						? {
								ok: true,
								configured: ["openai"],
								openaiRuntime: {
									quotaBlocked: false,
									lastQuotaAt: "2026-05-07T00:10:00.000Z",
									lastOkAt: "2026-05-07T00:00:00.000Z",
								},
							}
						: { ok: true },
				),
				{ status: 200 },
			);
		const report = await checkContentPipelineHealth({
			services: probes,
			fetchImpl,
		});
		expect(report.overall).toBe("degraded");
		expect(report.services[0].message).toContain("정상 응답");
	});
});
