/**
 * Diagnostic Agent — LLM tool-use 기반 자동 복구
 *
 * 루프: goal → (health + tools) → GPT-4o-mini → tool_call → execute → feedback → ... → finish
 * 보안: 서버측 화이트리스트 도구만 호출 가능. OpenAI 키는 서버가 보유.
 */

import type {
	CommandContext,
	CommandResult,
	DiagHealthReport,
} from "./diag.ts";
import { createCommandRegistry, runCommand } from "./diag.ts";

// ─── Debug logger ───
const DEBUG = process.env.DIAG_AGENT_DEBUG !== "0"; // 기본 켜짐
function agentLog(tag: string, data?: unknown) {
	if (!DEBUG) return;
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[diag-agent ${ts}] ${tag}`, data !== undefined ? data : "");
}

// ─── Tool schemas (OpenAI function-calling) ───

export const AGENT_TOOLS = [
	{
		type: "function" as const,
		function: {
			name: "get_health",
			description:
				"Fetch current health report: server uptime, which keys are configured, which servers are up, cache sizes.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "reload_env",
			description:
				"Reread .env file and refresh in-memory API keys. Use when keys appear stale or after user edited .env.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "check_keys",
			description: "Re-validate API keys against process.env. Cheap read-only.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "clear_cache",
			description:
				"Clear in-memory server caches. Target 'search' for search API cache, 'article' for article body cache, omit for all.",
			parameters: {
				type: "object",
				properties: {
					target: { type: "string", enum: ["search", "article"] },
				},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "ping_servers",
			description:
				"Probe all 4 backend servers (api-proxy, video-proxy, youtube-upload, render-queue) over HTTP.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "finish",
			description:
				"Terminate the loop. Call this when the goal is achieved OR when further tools won't help.",
			parameters: {
				type: "object",
				properties: {
					resolved: {
						type: "boolean",
						description: "True if the user's issue is resolved.",
					},
					summary: {
						type: "string",
						description:
							"One-paragraph explanation of what was diagnosed, what was done, and current state. Korean ok.",
					},
				},
				required: ["resolved", "summary"],
				additionalProperties: false,
			},
		},
	},
];

const TOOL_NAME_MAP: Record<string, string> = {
	reload_env: "reload-env",
	check_keys: "check-keys",
	clear_cache: "clear-cache",
	ping_servers: "ping-servers",
};

// ─── OpenAI chat 호출 (서버 내부, /api/openai/chat 경유 없음) ───

interface OpenAIMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | null;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: { name: string; arguments: string };
	}>;
	tool_call_id?: string;
	name?: string;
}

async function callOpenAIChat(
	apiKey: string,
	messages: OpenAIMessage[],
	tools: typeof AGENT_TOOLS,
	signal?: AbortSignal,
): Promise<OpenAIMessage> {
	const bodyPayload = {
		model: "gpt-4o-mini",
		messages,
		tools,
		tool_choice: "auto",
		temperature: 0.2,
		parallel_tool_calls: false,
	};
	agentLog("OPENAI_REQUEST", {
		model: bodyPayload.model,
		messageCount: messages.length,
		lastRole: messages[messages.length - 1]?.role,
	});

	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(bodyPayload),
		signal,
	});
	if (!res.ok) {
		const err = await res.text();
		agentLog("OPENAI_HTTP_ERROR", {
			status: res.status,
			body: err.slice(0, 300),
		});
		throw new Error(`OpenAI ${res.status}: ${err}`);
	}
	const json = (await res.json()) as {
		choices: Array<{ message: OpenAIMessage; finish_reason?: string }>;
		usage?: {
			prompt_tokens: number;
			completion_tokens: number;
			total_tokens: number;
		};
	};
	agentLog("OPENAI_RESPONSE", {
		finishReason: json.choices[0]?.finish_reason,
		usage: json.usage,
		hasToolCalls: Boolean(json.choices[0]?.message?.tool_calls?.length),
	});
	return json.choices[0].message;
}

// ─── Agent trace ───

export type AgentTraceStep =
	| { kind: "think"; content: string }
	| {
			kind: "tool";
			name: string;
			args: Record<string, unknown>;
			result: CommandResult | DiagHealthReport;
	  }
	| { kind: "finish"; resolved: boolean; summary: string; reason: string };

export interface AgentResult {
	goal: string;
	resolved: boolean;
	summary: string;
	trace: AgentTraceStep[];
	iterations: number;
}

// ─── Agent loop ───

export async function runAgent(params: {
	goal: string;
	apiKey: string;
	ctx: CommandContext;
	getHealth: () => Promise<DiagHealthReport>;
	maxIterations?: number;
	signal?: AbortSignal;
}): Promise<AgentResult> {
	const { goal, apiKey, ctx, getHealth, maxIterations = 5, signal } = params;
	const trace: AgentTraceStep[] = [];
	const registry = createCommandRegistry();

	agentLog("START", {
		goal,
		maxIterations,
		hasApiKey: Boolean(apiKey),
	});

	// 초기 컨텍스트 — health 1회 주입해서 모델이 즉시 판단 가능
	let initialHealth: DiagHealthReport;
	try {
		initialHealth = await getHealth();
		agentLog("HEALTH_OK", {
			keys: initialHealth.keys,
			serverCount: initialHealth.servers.length,
		});
	} catch (err) {
		agentLog("HEALTH_FAIL", {
			error: err instanceof Error ? err.message : err,
		});
		throw new Error(
			`getHealth() 실패: ${err instanceof Error ? err.message : "unknown"}`,
		);
	}

	const systemPrompt = `당신은 boltYT 앱의 진단/복구 에이전트입니다.

역할:
- 사용자의 목표(goal)를 해결하기 위해 제공된 도구(tools)만 사용하세요.
- 필요한 정보를 먼저 수집한 뒤 수정 조치를 취하세요.
- 작업이 끝나거나 더 이상 개선할 수 없으면 반드시 \`finish\` 도구를 호출하세요.
- 최대 ${maxIterations} 반복 안에 끝내세요. 같은 도구를 2회 초과 호출하지 마세요.
- 조치 후에는 \`get_health\`로 상태 변화를 확인한 뒤 마무리 판단을 내리세요.
- 한국어로 답하세요.

현재 시스템 상태:
${JSON.stringify(initialHealth, null, 2)}`;

	const messages: OpenAIMessage[] = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: goal },
	];

	let iteration = 0;
	for (; iteration < maxIterations; iteration++) {
		agentLog(`ITER_${iteration}`, { messageCount: messages.length });

		let assistant: OpenAIMessage;
		try {
			assistant = await callOpenAIChat(apiKey, messages, AGENT_TOOLS, signal);
			agentLog(`ITER_${iteration}_RESPONSE`, {
				hasContent: Boolean(assistant.content),
				contentPreview: assistant.content?.slice(0, 100),
				toolCallCount: assistant.tool_calls?.length ?? 0,
				toolNames: assistant.tool_calls?.map((c) => c.function.name),
			});
		} catch (err) {
			agentLog(`ITER_${iteration}_OPENAI_ERROR`, {
				error: err instanceof Error ? err.message : err,
				stack:
					err instanceof Error ? err.stack?.split("\n").slice(0, 3) : undefined,
			});
			throw err;
		}
		messages.push(assistant);

		if (assistant.content) {
			trace.push({ kind: "think", content: assistant.content });
		}

		const toolCalls = assistant.tool_calls ?? [];
		if (toolCalls.length === 0) {
			agentLog(`ITER_${iteration}_NO_TOOLS`, {
				content: assistant.content?.slice(0, 200),
			});
			// 모델이 도구 없이 텍스트만 반환 → 종료
			trace.push({
				kind: "finish",
				resolved: false,
				summary: assistant.content ?? "(응답 없음)",
				reason: "모델이 finish 도구를 호출하지 않고 종료했습니다.",
			});
			return {
				goal,
				resolved: false,
				summary: assistant.content ?? "(응답 없음)",
				trace,
				iterations: iteration + 1,
			};
		}

		for (const call of toolCalls) {
			const toolName = call.function.name;
			let parsedArgs: Record<string, unknown> = {};
			try {
				parsedArgs = JSON.parse(call.function.arguments || "{}");
			} catch (parseErr) {
				agentLog(`ITER_${iteration}_ARG_PARSE_FAIL`, {
					toolName,
					rawArgs: call.function.arguments,
					error: parseErr instanceof Error ? parseErr.message : parseErr,
				});
				parsedArgs = {};
			}

			agentLog(`ITER_${iteration}_TOOL_CALL`, { toolName, args: parsedArgs });

			if (toolName === "finish") {
				const resolved = Boolean(parsedArgs.resolved);
				const summary = String(parsedArgs.summary ?? "");
				agentLog("FINISH", { resolved, summary });
				trace.push({
					kind: "finish",
					resolved,
					summary,
					reason: "agent finish()",
				});
				return {
					goal,
					resolved,
					summary,
					trace,
					iterations: iteration + 1,
				};
			}

			let result: CommandResult | DiagHealthReport;
			try {
				if (toolName === "get_health") {
					result = await getHealth();
				} else {
					const mapped = TOOL_NAME_MAP[toolName];
					if (!mapped) {
						agentLog(`ITER_${iteration}_UNKNOWN_TOOL`, {
							toolName,
							knownTools: Object.keys(TOOL_NAME_MAP),
						});
						result = { ok: false, message: `unknown tool: ${toolName}` };
					} else {
						result = await runCommand(registry, mapped, parsedArgs, ctx);
					}
				}
				agentLog(`ITER_${iteration}_TOOL_RESULT`, {
					toolName,
					ok: "ok" in result ? result.ok : "health",
					messagePreview:
						"message" in result
							? (result as CommandResult).message?.slice(0, 100)
							: "health snapshot",
				});
			} catch (toolErr) {
				agentLog(`ITER_${iteration}_TOOL_EXEC_ERROR`, {
					toolName,
					error: toolErr instanceof Error ? toolErr.message : toolErr,
				});
				result = {
					ok: false,
					message: `tool execution error: ${toolErr instanceof Error ? toolErr.message : "unknown"}`,
				};
			}

			trace.push({
				kind: "tool",
				name: toolName,
				args: parsedArgs,
				result,
			});
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: JSON.stringify(result).slice(0, 4000),
			});
		}
	}

	agentLog("MAX_ITERATIONS", { maxIterations, traceLength: trace.length });
	trace.push({
		kind: "finish",
		resolved: false,
		summary: `최대 반복(${maxIterations}) 도달. 에이전트가 finish()를 호출하지 않았습니다.`,
		reason: "max iterations",
	});
	return {
		goal,
		resolved: false,
		summary: `최대 반복(${maxIterations}) 도달`,
		trace,
		iterations: iteration,
	};
}
