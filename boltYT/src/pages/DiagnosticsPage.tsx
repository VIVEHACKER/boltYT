import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PInputText,
	PSpinner,
	PTag,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiKeys } from "../lib/api-keys-context";
import {
	type AgentResult,
	clearErrors,
	clearServerErrors,
	type CommandResult,
	type DiagError,
	type DiagHealthReport,
	dispatchOrder,
	getHealth,
	getMetrics,
	getServerErrors,
	listErrors,
	type MetricsSnapshot,
	parseOrder,
	runAgent,
	runAutoFixes,
	runServerCommand,
	type ServerErrorRecord,
	subscribeErrors,
} from "../lib/diag";

interface LogEntry {
	id: string;
	ts: number;
	label: string;
	result: CommandResult;
}

export default function DiagnosticsPage() {
	const { refresh: refreshKeys } = useApiKeys();
	const [health, setHealth] = useState<DiagHealthReport | null>(null);
	const [loadingHealth, setLoadingHealth] = useState(false);
	const [errors, setErrors] = useState<DiagError[]>(listErrors());
	const [input, setInput] = useState("");
	const [log, setLog] = useState<LogEntry[]>([]);
	const [busy, setBusy] = useState(false);
	const [autoFix, setAutoFix] = useState(true);
	const logEndRef = useRef<HTMLDivElement | null>(null);

	// ─── Agent 상태 ───
	const [agentGoal, setAgentGoal] = useState("");
	const [agentRunning, setAgentRunning] = useState(false);
	const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
	const [agentError, setAgentError] = useState("");

	// ─── 관측 상태 ───
	const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
	const [serverErrors, setServerErrors] = useState<ServerErrorRecord[]>([]);

	const loadObservability = useCallback(async () => {
		const [m, e] = await Promise.all([
			getMetrics(),
			getServerErrors({ limit: 50 }),
		]);
		setMetrics(m);
		setServerErrors(e);
	}, []);

	const appendLog = useCallback((label: string, result: CommandResult) => {
		setLog((prev) => [
			...prev,
			{ id: crypto.randomUUID(), ts: Date.now(), label, result },
		]);
	}, []);

	const loadHealth = useCallback(
		async (autofix = autoFix) => {
			setLoadingHealth(true);
			const report = await getHealth();
			setHealth(report);
			setLoadingHealth(false);
			if (report && autofix) {
				const applied = await runAutoFixes(report);
				for (const { rule, results } of applied) {
					for (const r of results) {
						appendLog(`🔧 자동 fix: ${rule.description}`, r);
					}
				}
				if (applied.length > 0) {
					// fix 이후 상태 새로고침
					const next = await getHealth();
					setHealth(next);
					await refreshKeys();
				}
			}
		},
		[autoFix, appendLog, refreshKeys],
	);

	useEffect(() => {
		// 최초 마운트 + interval — setState 는 비동기 fetch 이후 발생
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadHealth();
		void loadObservability();
		const unsub = subscribeErrors(() => setErrors(listErrors()));
		const id = setInterval(() => {
			void loadObservability();
		}, 10_000);
		return () => {
			unsub();
			clearInterval(id);
		};
	}, [loadHealth, loadObservability]);

	useEffect(() => {
		logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
	}, []);

	async function handleSubmit() {
		const text = input.trim();
		if (!text || busy) return;
		const parsed = parseOrder(text);
		if (!parsed) {
			appendLog(`"${text}"`, {
				ok: false,
				message:
					"명령을 해석할 수 없습니다. 예: 'env reload', 'cache clear', 'ping servers', 'localstorage clear', '키 확인'",
			});
			setInput("");
			return;
		}
		setBusy(true);
		const result = await dispatchOrder(parsed);
		appendLog(parsed.label, result);
		setInput("");
		setBusy(false);
		// 서버 상태 영향 줄 수 있는 명령은 health 재조회
		if (["reload-env", "clear-cache", "check-keys"].includes(parsed.target)) {
			void loadHealth(false);
			await refreshKeys();
		}
	}

	async function handleAgent() {
		const goal = agentGoal.trim();
		if (!goal || agentRunning) return;
		setAgentRunning(true);
		setAgentError("");
		setAgentResult(null);
		const res = await runAgent(goal, 5);
		if ("error" in res) {
			setAgentError(res.error);
		} else {
			setAgentResult(res);
			appendLog(`🤖 Agent: ${goal}`, {
				ok: res.resolved,
				message: res.summary,
			});
			// 에이전트가 상태 변경 도구를 썼을 가능성 → 새로고침
			void loadHealth(false);
			await refreshKeys();
		}
		setAgentRunning(false);
	}

	async function quickRun(
		label: string,
		target: string,
		args: Record<string, unknown> = {},
	) {
		setBusy(true);
		const result = await runServerCommand(target, args);
		appendLog(label, result);
		setBusy(false);
		void loadHealth(false);
		await refreshKeys();
	}

	const healthIssues = health
		? [
				...health.keys.missing.map((k) => `키 누락: ${k}`),
				...health.servers
					.filter((s) => !s.ok)
					.map((s) => `서버 다운: ${s.name} (:${s.port})`),
			]
		: [];

	return (
		<div className="max-w-4xl">
			<PHeading size="x-large" tag="h1" className="mb-static-sm">
				Diagnostics
			</PHeading>
			<PText color="contrast-medium" className="mb-fluid-md">
				앱 상태를 확인하고, 문제를 자동으로 해결하거나 명령을 내립니다.
			</PText>

			{/* 시스템 상태 카드 */}
			<section className="bg-surface rounded-[8px] p-static-lg mb-static-md">
				<div className="flex items-center justify-between mb-static-md">
					<PHeading size="medium" tag="h2">
						시스템 상태
					</PHeading>
					<div className="flex items-center gap-static-sm">
						<label className="flex items-center gap-static-xs text-[12px] cursor-pointer">
							<input
								type="checkbox"
								checked={autoFix}
								onChange={(e) => setAutoFix(e.target.checked)}
							/>
							<span>자동 수정</span>
						</label>
						<PButton
							compact
							variant="secondary"
							onClick={() => loadHealth()}
							loading={loadingHealth}
						>
							새로고침
						</PButton>
					</div>
				</div>

				{loadingHealth && !health && <PSpinner size="small" />}

				{health && (
					<div className="flex flex-col gap-static-sm">
						{/* 키 상태 */}
						<div>
							<PText size="small" weight="semi-bold" className="mb-static-xs">
								API 키 ({health.keys.configured.length}/
								{health.keys.configured.length + health.keys.missing.length})
							</PText>
							<div className="flex flex-wrap gap-static-xs">
								{health.keys.configured.map((k) => (
									<PTag key={k} color="notification-success-soft">
										{k}
									</PTag>
								))}
								{health.keys.missing.map((k) => (
									<PTag key={k} color="notification-error-soft">
										{k} 없음
									</PTag>
								))}
							</div>
						</div>

						<PDivider />

						{/* 서버 상태 */}
						<div>
							<PText size="small" weight="semi-bold" className="mb-static-xs">
								서버
							</PText>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-static-xs">
								{health.servers.map((s) => (
									<div
										key={s.port}
										className="bg-canvas rounded-[4px] p-static-sm"
									>
										<div className="flex items-center gap-static-xs">
											<span
												className={`inline-block w-2 h-2 rounded-full ${
													s.ok ? "bg-[#1bb96b]" : "bg-[#d5001c]"
												}`}
											/>
											<PText size="small" weight="semi-bold">
												{s.name}
											</PText>
										</div>
										<PText size="x-small" color="contrast-medium">
											:{s.port}
											{s.latencyMs !== undefined ? ` · ${s.latencyMs}ms` : ""}
										</PText>
										{!s.ok && s.error && (
											<PText size="x-small" color="notification-error">
												{s.error}
											</PText>
										)}
									</div>
								))}
							</div>
						</div>

						<PDivider />

						{/* 캐시 */}
						<div className="flex items-center gap-static-md">
							<PText size="small" weight="semi-bold">
								캐시:
							</PText>
							{Object.entries(health.caches).map(([name, stats]) => (
								<PText key={name} size="x-small" color="contrast-medium">
									{name}: {stats.size ?? 0}개
								</PText>
							))}
							<PText size="x-small" color="contrast-medium">
								· uptime {health.apiProxy.uptimeSeconds}s
							</PText>
						</div>

						{healthIssues.length > 0 && (
							<PInlineNotification
								state="warning"
								dismissButton={false}
								className="mt-static-sm"
							>
								{healthIssues.length}개 이슈 감지: {healthIssues.join(" · ")}
							</PInlineNotification>
						)}
					</div>
				)}

				{!loadingHealth && !health && (
					<PInlineNotification state="error" dismissButton={false}>
						api-proxy(:3459)에 연결할 수 없습니다. 서버 실행 여부를 확인하세요.
					</PInlineNotification>
				)}
			</section>

			{/* AI 에이전트 */}
			<section className="bg-surface rounded-[8px] p-static-lg mb-static-md">
				<div className="flex items-center gap-static-sm mb-static-sm">
					<PHeading size="medium" tag="h2">
						AI 에이전트
					</PHeading>
					<PTag color="background-frosted" icon="ai-spark">
						beta
					</PTag>
				</div>
				<PText size="x-small" color="contrast-medium" className="mb-static-sm">
					자연어로 목표를 말하면 GPT-4o-mini가 현재 시스템 상태를 보고 필요한
					도구(`reload-env`, `clear-cache`, `ping-servers`, `check-keys`,
					`get-health`)를 스스로 호출해 해결을 시도합니다. 최대 5 반복.
				</PText>

				<PTextarea
					name="agentGoal"
					label="목표"
					hideLabel
					placeholder="예: '네이버 검색이 안 된다. 이유를 찾아내서 고쳐줘' / '.env 방금 수정했는데 반영됐는지 확인' / '4개 서버 중 죽은 거 있으면 리포트해'"
					value={agentGoal}
					rows={3}
					onInput={(e) => setAgentGoal((e.target as HTMLTextAreaElement).value)}
				/>
				<div className="mt-static-sm flex justify-end">
					<PButton
						onClick={handleAgent}
						loading={agentRunning}
						disabled={!agentGoal.trim() || agentRunning}
					>
						에이전트 실행
					</PButton>
				</div>

				{agentError && (
					<PInlineNotification
						state="error"
						dismissButton={false}
						className="mt-static-md"
					>
						{agentError}
					</PInlineNotification>
				)}

				{agentResult && (
					<div className="mt-static-md flex flex-col gap-static-sm">
						<div className="flex items-center gap-static-xs">
							<PTag
								color={
									agentResult.resolved
										? "notification-success-soft"
										: "notification-warning-soft"
								}
							>
								{agentResult.resolved ? "RESOLVED" : "UNRESOLVED"}
							</PTag>
							<PText size="x-small" color="contrast-medium">
								{agentResult.iterations} 반복
							</PText>
						</div>
						<PText size="small">{agentResult.summary}</PText>
						<details className="bg-canvas rounded-[4px] p-static-sm">
							<summary className="cursor-pointer text-[12px] text-contrast-medium">
								추론 trace ({agentResult.trace.length} 단계)
							</summary>
							<div className="mt-static-sm flex flex-col gap-static-xs max-h-[400px] overflow-y-auto">
								{agentResult.trace.map((step, i) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: trace는 append-only 시퀀스라 index가 안정적 식별자
										key={`step-${i}-${step.kind}`}
										className="border-l-2 border-contrast-low pl-static-sm"
									>
										{step.kind === "think" && (
											<div>
												<PTag color="background-frosted">think</PTag>
												<PText size="x-small" className="mt-static-xs">
													{step.content}
												</PText>
											</div>
										)}
										{step.kind === "tool" && (
											<div>
												<div className="flex items-center gap-static-xs">
													<PTag color="notification-info-soft">
														tool: {step.name}
													</PTag>
													{"ok" in step.result && (
														<PTag
															color={
																step.result.ok
																	? "notification-success-soft"
																	: "notification-error-soft"
															}
														>
															{step.result.ok ? "OK" : "ERR"}
														</PTag>
													)}
												</div>
												<PText
													size="x-small"
													color="contrast-medium"
													className="mt-static-xs"
												>
													args: {JSON.stringify(step.args)}
												</PText>
												<PText size="x-small" className="mt-static-xs">
													{"message" in step.result
														? step.result.message
														: `health snapshot (uptime ${step.result.apiProxy.uptimeSeconds}s, ${step.result.keys.configured.length} keys)`}
												</PText>
											</div>
										)}
										{step.kind === "finish" && (
											<div>
												<PTag
													color={
														step.resolved
															? "notification-success-soft"
															: "notification-warning-soft"
													}
												>
													finish
												</PTag>
												<PText size="x-small" className="mt-static-xs">
													{step.summary}
												</PText>
												<PText size="x-small" color="contrast-medium">
													{step.reason}
												</PText>
											</div>
										)}
									</div>
								))}
							</div>
						</details>
					</div>
				)}
			</section>

			{/* 빠른 명령 */}
			<section className="bg-surface rounded-[8px] p-static-lg mb-static-md">
				<PHeading size="medium" tag="h2" className="mb-static-sm">
					빠른 명령
				</PHeading>
				<div className="flex flex-wrap gap-static-xs">
					<PButton
						compact
						variant="secondary"
						disabled={busy}
						onClick={() => quickRun(".env 재로드", "reload-env")}
					>
						.env 재로드
					</PButton>
					<PButton
						compact
						variant="secondary"
						disabled={busy}
						onClick={() => quickRun("키 재확인", "check-keys")}
					>
						키 재확인
					</PButton>
					<PButton
						compact
						variant="secondary"
						disabled={busy}
						onClick={() => quickRun("서버 ping", "ping-servers")}
					>
						서버 ping
					</PButton>
					<PButton
						compact
						variant="secondary"
						disabled={busy}
						onClick={() => quickRun("캐시 비우기", "clear-cache")}
					>
						캐시 비우기
					</PButton>
					<PButton
						compact
						variant="secondary"
						disabled={busy}
						onClick={async () => {
							localStorage.clear();
							appendLog("localStorage 초기화", {
								ok: true,
								message: "localStorage 전체 삭제. 새로고침 권장.",
							});
							await refreshKeys();
						}}
					>
						localStorage 초기화
					</PButton>
				</div>
			</section>

			{/* 명령 입력 */}
			<section className="bg-surface rounded-[8px] p-static-lg mb-static-md">
				<PHeading size="medium" tag="h2" className="mb-static-sm">
					오더
				</PHeading>
				<PText size="x-small" color="contrast-medium" className="mb-static-sm">
					예: "env reload", "cache clear", "ping servers", "localstorage clear",
					"키 확인"
				</PText>
				<div className="flex gap-static-sm">
					<div className="flex-1">
						<PInputText
							name="order"
							label="명령"
							hideLabel
							placeholder="자연어로 명령을 입력하세요..."
							value={input}
							onInput={(e) => setInput((e.target as HTMLInputElement).value)}
							onKeyDown={(e) => {
								if ((e as unknown as KeyboardEvent).key === "Enter") {
									void handleSubmit();
								}
							}}
						/>
					</div>
					<PButton
						compact
						onClick={handleSubmit}
						loading={busy}
						disabled={!input.trim()}
					>
						실행
					</PButton>
				</div>

				{log.length > 0 && (
					<div className="mt-static-md flex flex-col gap-static-xs max-h-[300px] overflow-y-auto">
						{log.map((entry) => (
							<div
								key={entry.id}
								className="bg-canvas rounded-[4px] p-static-sm"
							>
								<div className="flex items-center gap-static-xs">
									<PTag
										color={
											entry.result.ok
												? "notification-success-soft"
												: "notification-error-soft"
										}
									>
										{entry.result.ok ? "OK" : "ERR"}
									</PTag>
									<PText size="small" weight="semi-bold">
										{entry.label}
									</PText>
									<PText size="x-small" color="contrast-medium">
										{new Date(entry.ts).toLocaleTimeString("ko-KR")}
									</PText>
								</div>
								<PText size="x-small" color="contrast-medium">
									{entry.result.message}
								</PText>
							</div>
						))}
						<div ref={logEndRef} />
					</div>
				)}
			</section>

			{/* 서버 메트릭 */}
			<section className="bg-surface rounded-[8px] p-static-lg mb-static-md">
				<div className="flex items-center justify-between mb-static-sm">
					<PHeading size="medium" tag="h2">
						서버 메트릭
					</PHeading>
					<PButton
						compact
						variant="secondary"
						onClick={() => void loadObservability()}
					>
						새로고침
					</PButton>
				</div>
				{metrics ? (
					<div className="flex flex-col gap-static-sm">
						<PText size="x-small" color="contrast-medium">
							updated {new Date(metrics.ts).toLocaleTimeString("ko-KR")} · 10초
							자동 갱신
						</PText>
						{metrics.histograms.length === 0 &&
						metrics.counters.length === 0 ? (
							<PText size="small" color="contrast-medium">
								아직 수집된 샘플이 없습니다. API를 호출하면 집계됩니다.
							</PText>
						) : (
							<>
								{metrics.histograms.length > 0 && (
									<div>
										<PText
											size="small"
											weight="semi-bold"
											className="mb-static-xs"
										>
											레이턴시 (ms)
										</PText>
										<div className="overflow-x-auto">
											<table className="w-full text-[12px]">
												<thead>
													<tr className="text-left text-contrast-medium">
														<th className="py-static-xs pr-static-sm">key</th>
														<th className="py-static-xs pr-static-sm text-right">
															n
														</th>
														<th className="py-static-xs pr-static-sm text-right">
															mean
														</th>
														<th className="py-static-xs pr-static-sm text-right">
															p50
														</th>
														<th className="py-static-xs pr-static-sm text-right">
															p95
														</th>
														<th className="py-static-xs pr-static-sm text-right">
															p99
														</th>
													</tr>
												</thead>
												<tbody>
													{metrics.histograms.slice(0, 12).map((h) => (
														<tr
															key={h.key}
															className="border-t border-contrast-low"
														>
															<td className="py-static-xs pr-static-sm font-mono truncate max-w-[360px]">
																{h.key}
															</td>
															<td className="py-static-xs pr-static-sm text-right">
																{h.count}
															</td>
															<td className="py-static-xs pr-static-sm text-right">
																{h.mean.toFixed(1)}
															</td>
															<td className="py-static-xs pr-static-sm text-right">
																{h.p50.toFixed(0)}
															</td>
															<td className="py-static-xs pr-static-sm text-right">
																{h.p95.toFixed(0)}
															</td>
															<td className="py-static-xs pr-static-sm text-right">
																{h.p99.toFixed(0)}
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</div>
								)}
								{metrics.counters.length > 0 && (
									<div>
										<PText
											size="small"
											weight="semi-bold"
											className="mb-static-xs"
										>
											카운터
										</PText>
										<div className="flex flex-wrap gap-static-xs">
											{metrics.counters.slice(0, 24).map((c) => (
												<PTag key={c.key} color="background-frosted">
													{c.key} · {c.value}
												</PTag>
											))}
										</div>
									</div>
								)}
							</>
						)}
					</div>
				) : (
					<PText size="small" color="contrast-medium">
						메트릭을 불러올 수 없습니다 (api-proxy :3459 확인).
					</PText>
				)}
			</section>

			{/* 서버 에러 (클라 telemetry + 서버 log.error/warn 통합) */}
			<section className="bg-surface rounded-[8px] p-static-lg mb-static-md">
				<div className="flex items-center justify-between mb-static-sm">
					<PHeading size="medium" tag="h2">
						서버 에러 ({serverErrors.length})
					</PHeading>
					{serverErrors.length > 0 && (
						<PButton
							compact
							variant="tertiary"
							onClick={async () => {
								await clearServerErrors();
								void loadObservability();
							}}
						>
							서버 버퍼 비우기
						</PButton>
					)}
				</div>
				{serverErrors.length === 0 ? (
					<PText size="small" color="contrast-medium">
						서버 측에서 캡처된 에러/경고가 없습니다.
					</PText>
				) : (
					<div className="flex flex-col gap-static-xs max-h-[360px] overflow-y-auto">
						{serverErrors.map((e) => (
							<div key={e.id} className="bg-canvas rounded-[4px] p-static-sm">
								<div className="flex items-center gap-static-xs flex-wrap">
									<PTag
										color={
											e.level === "error"
												? "notification-error-soft"
												: "notification-warning-soft"
										}
									>
										{e.level}
									</PTag>
									<PTag color="background-frosted">{e.source}</PTag>
									<PTag color="background-frosted">{e.service}</PTag>
									{e.status !== undefined && (
										<PTag color="notification-info-soft">{e.status}</PTag>
									)}
									<PText size="x-small" color="contrast-medium">
										{new Date(e.ts).toLocaleTimeString("ko-KR")}
									</PText>
								</div>
								<PText size="small">{e.message}</PText>
								{e.url && (
									<PText size="x-small" color="contrast-medium" ellipsis>
										{e.url}
									</PText>
								)}
							</div>
						))}
					</div>
				)}
			</section>

			{/* 클라 에러 로그 (in-memory, 현재 탭 한정) */}
			<section className="bg-surface rounded-[8px] p-static-lg mb-static-md">
				<div className="flex items-center justify-between mb-static-sm">
					<PHeading size="medium" tag="h2">
						클라 에러 로그 ({errors.length})
					</PHeading>
					{errors.length > 0 && (
						<PButton
							compact
							variant="tertiary"
							onClick={() => {
								clearErrors();
								setErrors([]);
							}}
						>
							비우기
						</PButton>
					)}
				</div>

				{errors.length === 0 ? (
					<PText size="small" color="contrast-medium">
						캡처된 에러가 없습니다.
					</PText>
				) : (
					<div className="flex flex-col gap-static-xs max-h-[400px] overflow-y-auto">
						{errors.map((e) => (
							<div key={e.id} className="bg-canvas rounded-[4px] p-static-sm">
								<div className="flex items-center gap-static-xs">
									<PTag
										color={
											e.source === "fetch"
												? "notification-warning-soft"
												: "notification-error-soft"
										}
									>
										{e.source}
										{e.status ? ` ${e.status}` : ""}
									</PTag>
									<PText size="x-small" color="contrast-medium">
										{new Date(e.timestamp).toLocaleTimeString("ko-KR")}
									</PText>
								</div>
								<PText size="small">{e.message}</PText>
								{e.url && (
									<PText size="x-small" color="contrast-medium" ellipsis>
										{e.url}
									</PText>
								)}
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
