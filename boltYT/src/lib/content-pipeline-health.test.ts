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
});
