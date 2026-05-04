import {
	PButton,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import {
	AlertTriangle,
	ArrowUpRight,
	BarChart3,
	CheckCircle,
	FlaskConical,
	Gauge,
	Megaphone,
	MessageSquare,
	RefreshCw,
	Rocket,
	ShieldCheck,
	Target,
	TrendingUp,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	buildGrowthCommandCenter,
	type GrowthCommandCenter,
	type GrowthDecisionKind,
	type GrowthDistributionTask,
	type GrowthExperiment,
	type GrowthHealth,
	type GrowthKpi,
	type GrowthLoopStage,
	type GrowthMissingData,
	type GrowthRiskControl,
	type GrowthScaleDecision,
} from "../lib/growth-command-center";
import {
	buildGrowthOperatingSystemPlan,
	type AnalyticsSyncPlan,
	type AutomationRoutine,
	type CommentInsight,
	type GrowthCommentSignal,
	type GrowthExperimentLog,
	type RetentionEditFinding,
	type RightsLedgerItem,
} from "../lib/growth-operating-system";
import type {
	UploadAnalyticsSnapshot,
	UploadRenderSnapshot,
} from "../lib/upload-growth";
import type { UploadListItem } from "../lib/upload-management";
import { supabase } from "../lib/supabase";
import {
	getDeepVideoAnalytics,
	getVideoComments,
	type DeepAnalyticsResult,
	type VideoCommentThread,
} from "../lib/youtube";

export default function GrowthCommandCenterPage() {
	const navigate = useNavigate();
	const [uploads, setUploads] = useState<UploadListItem[]>([]);
	const [analyticsByUploadId, setAnalyticsByUploadId] = useState<
		Record<string, UploadAnalyticsSnapshot>
	>({});
	const [rendersById, setRendersById] = useState<Record<string, UploadRenderSnapshot>>(
		{},
	);
	const [savedExperiments, setSavedExperiments] = useState<GrowthExperimentLog[]>(
		[],
	);
	const [comments, setComments] = useState<GrowthCommentSignal[]>([]);
	const [loading, setLoading] = useState(true);
	const [deepSyncRunning, setDeepSyncRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const loadGrowthData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const { data, error: uploadsError } = await supabase
				.from("uploads")
				.select("*")
				.order("created_at", { ascending: false });
			if (uploadsError) throw uploadsError;

			const rows = ((data ?? []) as UploadListItem[]).filter((row) =>
				Boolean(row.id),
			);
			const uploadIds = rows.map((upload) => upload.id).filter(Boolean);
			const renderIds = rows
				.map((upload) => upload.render_id)
				.filter((id): id is string => Boolean(id));
			const videoIds = rows
				.map((upload) => upload.youtube_video_id)
				.filter((id): id is string => Boolean(id));
			const [analyticsRes, rendersRes, experimentsRes, commentsRes] =
				await Promise.all([
					uploadIds.length
						? supabase
								.from("analytics")
								.select("*")
								.in("upload_id", uploadIds)
								.order("fetched_at", { ascending: false })
						: Promise.resolve({ data: [], error: null }),
					renderIds.length
						? supabase
								.from("renders")
								.select("id, format, duration_seconds")
								.in("id", renderIds)
						: Promise.resolve({ data: [], error: null }),
					supabase
						.from("growth_experiments")
						.select("*")
						.order("created_at", { ascending: false }),
					videoIds.length
						? supabase
								.from("growth_comments")
								.select("*")
								.in("video_id", videoIds)
								.order("published_at", { ascending: false })
						: Promise.resolve({ data: [], error: null }),
				]);
			if (analyticsRes.error) throw analyticsRes.error;
			if (rendersRes.error) throw rendersRes.error;
			if (experimentsRes.error) throw experimentsRes.error;
			if (commentsRes.error) throw commentsRes.error;

			const analyticsMap: Record<string, UploadAnalyticsSnapshot> = {};
			for (const row of (analyticsRes.data ?? []) as UploadAnalyticsSnapshot[]) {
				if (row.upload_id && !analyticsMap[row.upload_id]) {
					analyticsMap[row.upload_id] = row;
				}
			}
			const renderMap: Record<string, UploadRenderSnapshot> = {};
			for (const row of (rendersRes.data ?? []) as UploadRenderSnapshot[]) {
				if (row.id) renderMap[row.id] = row;
			}

			setUploads(rows);
			setAnalyticsByUploadId(analyticsMap);
			setRendersById(renderMap);
			setSavedExperiments((experimentsRes.data ?? []) as GrowthExperimentLog[]);
			setComments((commentsRes.data ?? []) as GrowthCommentSignal[]);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "성장 지휘실 데이터를 불러오지 못했습니다.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadGrowthData();
	}, [loadGrowthData]);

	const commandCenter = useMemo(
		() =>
			buildGrowthCommandCenter({
				uploads,
				analyticsByUploadId,
				rendersById,
			}),
		[analyticsByUploadId, rendersById, uploads],
	);
	const opsPlan = useMemo(
		() =>
			buildGrowthOperatingSystemPlan({
				center: commandCenter,
				uploads,
				analyticsByUploadId,
				rendersById,
				comments,
				savedExperiments,
			}),
		[
			analyticsByUploadId,
			commandCenter,
			comments,
			rendersById,
			savedExperiments,
			uploads,
		],
	);

	const publishedVideoTargets = useMemo(
		() => uploads.filter((upload) => Boolean(upload.youtube_video_id)),
		[uploads],
	);

	async function handleDeepSync() {
		if (publishedVideoTargets.length === 0) {
			setError("YouTube 게시 ID가 있는 업로드가 없어 심화 동기화를 실행할 수 없습니다.");
			return;
		}
		setDeepSyncRunning(true);
		setError(null);
		setNotice(null);
		const warnings: string[] = [];
		let syncedAnalytics = 0;
		let syncedComments = 0;

		for (const upload of publishedVideoTargets) {
			const videoId = upload.youtube_video_id;
			if (!videoId) continue;
			try {
				const deep = await getDeepVideoAnalytics(videoId, 28);
				await supabase.from("analytics").insert(
					analyticsInsertFromDeepResult({
						uploadId: upload.id,
						deep,
					}),
				);
				syncedAnalytics += 1;
				if (deep.warnings?.length) {
					warnings.push(...deep.warnings.map((warning) => `${videoId}: ${warning}`));
				}
			} catch (err) {
				warnings.push(
					`${videoId} 분석 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
				);
			}

			try {
				const result = await getVideoComments(videoId, 100);
				const inserted = await insertNewCommentSignals({
					upload,
					videoId,
					comments: result.comments,
				});
				syncedComments += inserted;
				if (result.warnings?.length) warnings.push(...result.warnings);
			} catch (err) {
				warnings.push(
					`${videoId} 댓글 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
				);
			}
		}

		await loadGrowthData();
		setDeepSyncRunning(false);
		setNotice(
			`심화 동기화 완료: 분석 ${syncedAnalytics}개, 신규 댓글 ${syncedComments}개 저장${
				warnings.length ? ` · 경고 ${warnings.length}건` : ""
			}`,
		);
		if (warnings.length) {
			console.warn("[growth deep sync]", warnings);
		}
	}

	async function handleSaveExperimentBacklog() {
		if (opsPlan.experimentBacklog.length === 0) {
			setNotice("저장할 신규 실험 후보가 없습니다.");
			return;
		}
		await supabase.from("growth_experiments").insert(
			opsPlan.experimentBacklog.map((experiment) => ({
				...experiment,
				upload_id: experiment.upload_id ?? null,
				result_summary: null,
				updated_at: experiment.updated_at ?? new Date().toISOString(),
			})),
		);
		await loadGrowthData();
		setNotice(`${opsPlan.experimentBacklog.length}개 실험 후보를 기록장에 저장했습니다.`);
	}

	function handleSaveAutomationSpec() {
		localStorage.setItem(
			"growth_automation_routines:v1",
			JSON.stringify({
				savedAt: new Date().toISOString(),
				routines: opsPlan.automationRoutines,
			}),
		);
		setNotice("자동 운영 루틴 사양을 로컬에 저장했습니다.");
	}

	if (loading) {
		return (
			<div className="grid min-h-[440px] place-items-center rounded-[34px] bg-[#f6efe1] text-[#1c1711]">
				<div className="text-center">
					<PSpinner size="medium" />
					<PText className="mt-static-sm" color="contrast-medium">
						성장 지휘실 데이터를 조립하는 중입니다.
					</PText>
				</div>
			</div>
		);
	}

	return (
		<div
			className="mx-auto max-w-[1500px] rounded-[38px] bg-[#f6efe1] p-4 text-[#1c1711] shadow-[0_28px_90px_rgba(48,37,23,.14)] sm:p-6 lg:p-8"
			style={{
				fontFamily:
					"'Pretendard', 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
				wordBreak: "keep-all",
			}}
		>
			<header className="relative overflow-hidden rounded-[34px] border border-[#dcc8aa] bg-[#fffaf1] p-5 shadow-[0_20px_60px_rgba(94,70,38,.12)] sm:p-7 lg:p-8">
				<div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[#f2a541]/25 blur-3xl" />
				<div className="pointer-events-none absolute bottom-[-35%] left-[10%] h-64 w-64 rounded-full bg-[#41b3a3]/18 blur-3xl" />
				<div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
					<div>
						<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#ded0b9] bg-[#1d1a15] px-3 py-1 text-[11px] font-black uppercase tracking-[.24em] text-[#f2c166]">
							<Rocket size={14} />
							Growth command center
						</div>
						<PHeading size="x-large" tag="h1">
							생성 이후를 자동으로 굴리는 성장 지휘실
						</PHeading>
						<PText className="mt-static-sm max-w-3xl text-[#6d604f]">
							업로드 대기열, YouTube 분석, 썸네일 준비도, 정책 리스크를 한
							화면에서 연결합니다. 다음 행동은 추정이 아니라 현재 데이터의
							빈칸과 성과 신호를 기준으로 정렬합니다.
						</PText>
						<div className="mt-5 flex flex-wrap gap-2">
							<PButton compact onClick={() => navigate("/uploads")}>
								<span className="inline-flex items-center gap-1">
									<Upload size={14} />
									업로드 관리
								</span>
							</PButton>
							<PButton
								compact
								variant="secondary"
								onClick={() => navigate("/analytics")}
							>
								<span className="inline-flex items-center gap-1">
									<BarChart3 size={14} />
									성과 분석
								</span>
							</PButton>
							<PButton
								compact
								variant="secondary"
								onClick={() => navigate("/references")}
							>
								레퍼런스 보기
							</PButton>
						</div>
					</div>
					<CommandScoreCard center={commandCenter} onRefresh={loadGrowthData} />
				</div>
			</header>

			{error && (
				<PInlineNotification
					state="error"
					heading="성장 데이터 로드 실패"
					description={error}
					className="mt-5"
					dismissButton={true}
					onDismiss={() => setError(null)}
				/>
			)}

			{notice && (
				<PInlineNotification
					state="success"
					className="mt-5"
					dismissButton={true}
					onDismiss={() => setNotice(null)}
				>
					{notice}
				</PInlineNotification>
			)}

			<section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{commandCenter.kpis.map((kpi) => (
					<KpiCard key={kpi.id} kpi={kpi} />
				))}
			</section>

			<DeepSyncPanel
				syncPlan={opsPlan.analyticsSync}
				targetCount={publishedVideoTargets.length}
				running={deepSyncRunning}
				onRun={handleDeepSync}
			/>

			<section className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
				<div className="grid gap-5">
					<LoopPanel loop={commandCenter.loop} />
					<ExperimentPanel
						experiments={commandCenter.experiments}
						backlog={opsPlan.experimentBacklog}
						savedCount={savedExperiments.length}
						onSaveBacklog={handleSaveExperimentBacklog}
					/>
				</div>
				<div className="grid gap-5">
					<DistributionPanel tasks={commandCenter.distributionTasks} />
					<DecisionPanel decisions={commandCenter.scaleDecisions} />
				</div>
			</section>

			<section className="mt-5 grid gap-5 2xl:grid-cols-[1fr_1fr]">
				<RetentionPanel findings={opsPlan.retentionFindings} />
				<CommentInsightPanel insights={opsPlan.commentInsights} />
			</section>

			<section className="mt-5 grid gap-5 xl:grid-cols-[1fr_.9fr]">
				<RiskPanel risks={commandCenter.riskControls} />
				<RightsLedgerPanel items={opsPlan.rightsLedger} />
			</section>

			<section className="mt-5 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
				<MissingDataPanel missingData={commandCenter.missingData} />
				<AutomationRoutinePanel
					routines={opsPlan.automationRoutines}
					onSave={handleSaveAutomationSpec}
				/>
			</section>

			<EvidencePanel center={commandCenter} />
		</div>
	);
}

function analyticsInsertFromDeepResult(params: {
	uploadId: string;
	deep: DeepAnalyticsResult;
}) {
	const { uploadId, deep } = params;
	return {
		upload_id: uploadId,
		views: deep.views,
		likes: deep.likes,
		comments: deep.comments,
		ctr: deep.impressionCtr ?? 0,
		avg_watch_duration: deep.averageViewDuration ?? 0,
		avg_view_percentage: deep.averageViewPercentage ?? null,
		estimated_minutes_watched: deep.estimatedMinutesWatched ?? null,
		shares: deep.shares ?? null,
		subscribers_gained: deep.subscribersGained ?? 0,
		subscribers_lost: deep.subscribersLost ?? null,
		traffic_sources: deep.trafficSources ?? null,
		retention_curve: deep.retentionCurve ?? null,
		daily_rows: deep.dailyRows ?? null,
		sync_warnings: deep.warnings ?? null,
		fetched_at: new Date().toISOString(),
	};
}

async function insertNewCommentSignals(params: {
	upload: UploadListItem;
	videoId: string;
	comments: VideoCommentThread[];
}): Promise<number> {
	const { upload, videoId, comments } = params;
	if (comments.length === 0) return 0;
	const existingRes = await supabase
		.from("growth_comments")
		.select("id")
		.eq("video_id", videoId);
	const existingIds = new Set(
		((existingRes.data ?? []) as Array<{ id?: string }>).map((row) => row.id),
	);
	const rows = comments
		.filter((comment) => comment.id && !existingIds.has(comment.id))
		.map((comment) => ({
			id: comment.id,
			video_id: videoId,
			upload_id: upload.id,
			author: comment.author,
			text: comment.text,
			like_count: comment.likeCount,
			published_at: comment.publishedAt,
			created_at: new Date().toISOString(),
		}));
	if (rows.length === 0) return 0;
	await supabase.from("growth_comments").insert(rows);
	return rows.length;
}

function CommandScoreCard({
	center,
	onRefresh,
}: {
	center: GrowthCommandCenter;
	onRefresh: () => void;
}) {
	return (
		<div className="rounded-[30px] border border-[#221b12]/10 bg-[#1d1a15] p-5 text-[#fff8ec] shadow-[inset_0_1px_0_rgba(255,255,255,.1)]">
			<div className="flex items-start justify-between gap-4">
				<div>
					<div className="text-[10px] font-black uppercase tracking-[.2em] text-[#b9ad9c]">
						current objective
					</div>
					<div className="mt-2 text-[22px] font-black leading-tight tracking-[-.035em]">
						{center.primaryObjective}
					</div>
				</div>
				<PTag color={confidenceColor(center.confidence)}>
					{confidenceLabel(center.confidence)}
				</PTag>
			</div>

			<div className="mt-6 grid grid-cols-[120px_1fr] gap-4">
				<div className="grid aspect-square place-items-center rounded-[28px] bg-[#f2c166] text-[#1d1a15] shadow-[0_20px_50px_rgba(242,193,102,.25)]">
					<div className="text-center">
						<div className="text-[42px] font-black leading-none tabular-nums">
							{center.commandScore}
						</div>
						<div className="text-[10px] font-black uppercase tracking-[.16em]">
							score
						</div>
					</div>
				</div>
				<div className="min-w-0">
					<div className="mb-2 flex items-center gap-2 text-[12px] font-black text-[#f2c166]">
						<Gauge size={15} />
						폐쇄 루프 운영 준비도
					</div>
					<div className="h-3 overflow-hidden rounded-full bg-white/10">
						<div
							className="h-full rounded-full bg-gradient-to-r from-[#f2c166] via-[#41b3a3] to-[#90cdf4]"
							style={{ width: `${center.commandScore}%` }}
						/>
					</div>
					<p className="mt-3 text-[12px] leading-5 text-[#cfc5b5]">
						생성물 자체보다 업로드 후 데이터 회수, 실험, 수정, 증폭까지
						돌아가는지를 봅니다.
					</p>
					<PButton className="mt-4" compact variant="secondary" onClick={onRefresh}>
						<span className="inline-flex items-center gap-1">
							<RefreshCw size={14} />
							다시 계산
						</span>
					</PButton>
				</div>
			</div>

			<div className="mt-5 text-[11px] font-bold text-[#8f8373]">
				마지막 계산 {formatDateTime(center.generatedAt)}
			</div>
		</div>
	);
}

function KpiCard({ kpi }: { kpi: GrowthKpi }) {
	return (
		<article className="rounded-[26px] border border-[#dcc8aa] bg-white/75 p-4 shadow-[0_12px_36px_rgba(81,61,34,.08)]">
			<div className="mb-4 flex items-start justify-between gap-3">
				<div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#1d1a15] text-[#f2c166]">
					{kpiIcon(kpi.id)}
				</div>
				<PTag color={healthColor(kpi.health)}>{healthLabel(kpi.health)}</PTag>
			</div>
			<div className="text-[34px] font-black leading-none tracking-[-.05em] text-[#1d1a15]">
				{kpi.value}
			</div>
			<div className="mt-2 text-[13px] font-black uppercase tracking-[.12em] text-[#5f523f]">
				{kpi.label}
			</div>
			<p className="mt-2 text-[12px] leading-5 text-[#746756]">{kpi.detail}</p>
		</article>
	);
}

function DeepSyncPanel({
	syncPlan,
	targetCount,
	running,
	onRun,
}: {
	syncPlan: AnalyticsSyncPlan[];
	targetCount: number;
	running: boolean;
	onRun: () => void;
}) {
	return (
		<PanelShell
			kicker="deep sync"
			title="Analytics 심화 동기화"
			description="YouTube Analytics API와 댓글 API를 사용해 CTR 맥락, 평균 시청, 트래픽 소스, 리텐션, 댓글 반응을 회수합니다."
			icon={<RefreshCw size={17} />}
		>
			<div className="grid gap-3 lg:grid-cols-[1fr_220px]">
				<div className="grid gap-3 md:grid-cols-2">
					{syncPlan.map((item) => (
						<div
							key={item.id}
							className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4"
						>
							<div className="mb-2 flex items-start justify-between gap-3">
								<div>
									<div className="text-[15px] font-black text-[#1d1a15]">
										{item.label}
									</div>
									<div className="mt-1 text-[11px] font-black uppercase tracking-[.12em] text-[#9b7a3c]">
										{item.endpoint}
									</div>
								</div>
								<PTag color={syncStatusColor(item.status)}>
									{syncStatusLabel(item.status)}
								</PTag>
							</div>
							<p className="text-[12px] leading-5 text-[#716452]">
								{item.reason}
							</p>
							<div className="mt-3 flex flex-wrap gap-1.5">
								{item.metrics.slice(0, 4).map((metric) => (
									<span
										key={metric}
										className="rounded-full bg-[#f3eadc] px-2.5 py-1 text-[10px] font-black text-[#6f5735]"
									>
										{metric}
									</span>
								))}
							</div>
						</div>
					))}
				</div>
				<div className="rounded-[24px] bg-[#1d1a15] p-4 text-[#fff8ec]">
					<div className="text-[10px] font-black uppercase tracking-[.18em] text-[#b9ad9c]">
						sync target
					</div>
					<div className="mt-2 text-[34px] font-black tracking-[-.05em]">
						{targetCount}개
					</div>
					<p className="mt-2 text-[12px] leading-5 text-[#cfc5b5]">
						게시 ID가 있는 영상만 동기화합니다. 권한이 부족한 지표는 경고로
						남기고 기본 통계는 계속 저장합니다.
					</p>
					<PButton
						className="mt-4"
						compact
						loading={running}
						disabled={running || targetCount === 0}
						onClick={onRun}
					>
						심화 동기화 실행
					</PButton>
				</div>
			</div>
		</PanelShell>
	);
}

function LoopPanel({ loop }: { loop: GrowthLoopStage[] }) {
	return (
		<PanelShell
			kicker="closed loop"
			title="성과 회수 → 진단 → 실험 → 증폭"
			description="자동화 툴의 핵심은 영상을 많이 만드는 것이 아니라 다음 업로드가 더 나아지도록 루프를 닫는 것입니다."
			icon={<TrendingUp size={17} />}
		>
			<div className="grid gap-3 lg:grid-cols-4">
				{loop.map((stage, index) => (
					<div
						key={stage.id}
						className="relative rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4"
					>
						<div className="mb-3 flex items-center justify-between gap-2">
							<div className="grid h-9 w-9 place-items-center rounded-xl bg-[#1d1a15] text-[#f2c166]">
								{index + 1}
							</div>
							<PTag color={loopStatusColor(stage.status)}>
								{loopStatusLabel(stage.status)}
							</PTag>
						</div>
						<div className="text-[17px] font-black text-[#1d1a15]">
							{stage.label}
						</div>
						<div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8dccb]">
							<div
								className="h-full rounded-full bg-[#41b3a3]"
								style={{ width: `${stage.score}%` }}
							/>
						</div>
						<p className="mt-3 text-[12px] leading-5 text-[#716452]">
							{stage.description}
						</p>
						<div className="mt-3 rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-bold leading-5 text-[#5b4932]">
							{stage.nextStep}
						</div>
					</div>
				))}
			</div>
		</PanelShell>
	);
}

function ExperimentPanel({
	experiments,
	backlog,
	savedCount,
	onSaveBacklog,
}: {
	experiments: GrowthExperiment[];
	backlog: GrowthExperimentLog[];
	savedCount: number;
	onSaveBacklog: () => void;
}) {
	return (
		<PanelShell
			kicker="experiment queue"
			title="이번 주 실험 큐"
			description="제목, 썸네일, 시간대, 리텐션을 동시에 뒤섞지 않고 하나씩 원인 분리합니다."
			icon={<FlaskConical size={17} />}
		>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] px-4 py-3">
				<div className="text-[12px] font-bold text-[#716452]">
					저장된 실험 {savedCount}개 · 신규 후보 {backlog.length}개
				</div>
				<PButton
					compact
					variant="secondary"
					disabled={backlog.length === 0}
					onClick={onSaveBacklog}
				>
					추천 실험 기록장에 저장
				</PButton>
			</div>
			{experiments.length === 0 ? (
				<EmptyPanelMessage text="실험을 만들 업로드 대기열이 없습니다. 콘텐츠 생성 또는 레퍼런스 주제 추천에서 파일럿을 먼저 만드세요." />
			) : (
				<div className="grid gap-3">
					{experiments.map((experiment) => (
						<ExperimentCard key={experiment.id} experiment={experiment} />
					))}
				</div>
			)}
		</PanelShell>
	);
}

function ExperimentCard({ experiment }: { experiment: GrowthExperiment }) {
	return (
		<article className="rounded-[24px] border border-[#eadcc8] bg-[#fffaf1] p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="mb-2 text-[10px] font-black uppercase tracking-[.18em] text-[#9b7a3c]">
						{experiment.type.replaceAll("_", " ")}
					</div>
					<div className="text-[18px] font-black leading-tight tracking-[-.02em] text-[#1d1a15]">
						{experiment.title}
					</div>
				</div>
				<PTag color={experiment.priority >= 90 ? "notification-warning-soft" : "notification-info-soft"}>
					P{experiment.priority}
				</PTag>
			</div>
			<p className="mt-3 text-[13px] leading-6 text-[#675a49]">
				{experiment.hypothesis}
			</p>
			<div className="mt-3 grid gap-2 lg:grid-cols-[1fr_220px]">
				<div className="grid gap-2">
					{experiment.actions.slice(0, 3).map((action) => (
						<div
							key={action}
							className="rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-semibold leading-5 text-[#5b4932]"
						>
							{action}
						</div>
					))}
				</div>
				<div className="rounded-2xl bg-[#1d1a15] px-3 py-3 text-[#fff8ec]">
					<div className="text-[10px] font-black uppercase tracking-[.16em] text-[#b9ad9c]">
						metric
					</div>
					<div className="mt-1 text-[12px] font-bold leading-5 text-[#f2c166]">
						{experiment.metric}
					</div>
					<div className="mt-3 text-[11px] leading-5 text-[#cfc5b5]">
						{experiment.successCriteria}
					</div>
				</div>
			</div>
		</article>
	);
}

function DistributionPanel({ tasks }: { tasks: GrowthDistributionTask[] }) {
	return (
		<PanelShell
			kicker="marketing ops"
			title="배포/마케팅 액션"
			description="업로드 버튼을 누른 뒤 7일 동안 무엇을 확인하고 어디를 고칠지 시간순으로 정리합니다."
			icon={<Megaphone size={17} />}
		>
			<div className="grid gap-3">
				{tasks.map((task) => (
					<div
						key={task.id}
						className="grid gap-3 rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4 sm:grid-cols-[86px_1fr]"
					>
						<div className="rounded-2xl bg-[#1d1a15] px-3 py-2 text-center text-[#fff8ec]">
							<div className="text-[10px] font-black uppercase tracking-[.12em] text-[#b9ad9c]">
								when
							</div>
							<div className="mt-1 text-[13px] font-black">{task.when}</div>
						</div>
						<div>
							<div className="flex flex-wrap items-center gap-2">
								<PTag color="background-surface">{task.channel}</PTag>
								<div className="text-[15px] font-black text-[#1d1a15]">
									{task.title}
								</div>
							</div>
							<p className="mt-2 text-[12px] leading-5 text-[#716452]">
								{task.reason}
							</p>
						</div>
					</div>
				))}
			</div>
		</PanelShell>
	);
}

function DecisionPanel({ decisions }: { decisions: GrowthScaleDecision[] }) {
	return (
		<PanelShell
			kicker="scale or fix"
			title="스케일/수정 판단"
			description="조회수만 보지 않고 CTR, 평균 시청, 구독 전환을 합쳐 다음 행동을 나눕니다."
			icon={<Target size={17} />}
		>
			{decisions.length === 0 ? (
				<EmptyPanelMessage text="게시 영상 성과 데이터가 부족합니다. 먼저 업로드 관리에서 분석 동기화를 실행하세요." />
			) : (
				<div className="grid gap-3">
					{decisions.map((decision) => (
						<DecisionCard key={decision.uploadId} decision={decision} />
					))}
				</div>
			)}
		</PanelShell>
	);
}

function DecisionCard({ decision }: { decision: GrowthScaleDecision }) {
	return (
		<div className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="mb-2 flex flex-wrap items-center gap-2">
						<PTag color={decisionColor(decision.kind)}>
							{decisionLabel(decision.kind)}
						</PTag>
						<span className="text-[12px] font-black text-[#9b7a3c]">
							S{decision.score}
						</span>
					</div>
					<div className="text-[15px] font-black leading-tight text-[#1d1a15]">
						{decision.title}
					</div>
				</div>
				<ArrowUpRight size={18} className="shrink-0 text-[#8b6b34]" />
			</div>
			<p className="mt-3 text-[12px] leading-5 text-[#716452]">
				{decision.reason}
			</p>
			<div className="mt-2 rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-bold leading-5 text-[#5b4932]">
				{decision.action}
			</div>
		</div>
	);
}

function RetentionPanel({ findings }: { findings: RetentionEditFinding[] }) {
	return (
		<PanelShell
			kicker="retention editing"
			title="리텐션 커브 기반 편집 피드백"
			description="평균 시청과 리텐션 급락 구간을 씬 전환/자막/자료 투입 타이밍으로 되돌립니다."
			icon={<Gauge size={17} />}
		>
			{findings.length === 0 ? (
				<EmptyPanelMessage text="리텐션 경고가 없습니다. 심화 동기화 후 급락 구간이 있으면 여기서 편집 액션으로 표시됩니다." />
			) : (
				<div className="grid gap-3">
					{findings.map((finding) => (
						<div
							key={finding.id}
							className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4"
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<div className="mb-2 flex flex-wrap items-center gap-2">
										<PTag color={healthColor(finding.severity)}>
											{healthLabel(finding.severity)}
										</PTag>
										<span className="text-[12px] font-black text-[#9b7a3c]">
											{finding.dropAtLabel}
										</span>
									</div>
									<div className="text-[16px] font-black leading-tight text-[#1d1a15]">
										{finding.title}
									</div>
								</div>
							</div>
							<p className="mt-3 text-[12px] leading-5 text-[#716452]">
								{finding.issue} · {finding.evidence}
							</p>
							<div className="mt-3 rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-bold leading-5 text-[#5b4932]">
								{finding.action}
							</div>
						</div>
					))}
				</div>
			)}
		</PanelShell>
	);
}

function CommentInsightPanel({ insights }: { insights: CommentInsight[] }) {
	return (
		<PanelShell
			kicker="audience mining"
			title="댓글/시청자 반응 채굴"
			description="반복 질문, 요청, 불만, 긍정 반응을 다음 주제와 고정 댓글 액션으로 바꿉니다."
			icon={<MessageSquare size={17} />}
		>
			{insights.length === 0 ? (
				<EmptyPanelMessage text="저장된 댓글 신호가 없습니다. 심화 동기화를 실행하면 댓글 질문과 요청을 주제 후보로 군집화합니다." />
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{insights.map((insight) => (
						<div
							key={insight.id}
							className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4"
						>
							<div className="mb-2 flex items-start justify-between gap-3">
								<div>
									<div className="text-[16px] font-black text-[#1d1a15]">
										{insight.label}
									</div>
									<div className="mt-1 text-[11px] font-black uppercase tracking-[.14em] text-[#9b7a3c]">
										{insight.sentiment}
									</div>
								</div>
								<PTag color="notification-info-soft">{insight.count}회</PTag>
							</div>
							<p className="line-clamp-2 text-[12px] leading-5 text-[#716452]">
								{insight.example}
							</p>
							<div className="mt-3 rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-bold leading-5 text-[#5b4932]">
								{insight.recommendedAction}
							</div>
							<div className="mt-2 text-[11px] font-semibold text-[#8b7658]">
								주제 후보: {insight.topicSeed}
							</div>
						</div>
					))}
				</div>
			)}
		</PanelShell>
	);
}

function RiskPanel({ risks }: { risks: GrowthRiskControl[] }) {
	return (
		<PanelShell
			kicker="risk controls"
			title="성장 전에 막아야 할 리스크"
			description="채널 삭제/노출 제한 리스크는 영상 품질보다 먼저 해결해야 합니다."
			icon={<ShieldCheck size={17} />}
		>
			{risks.length === 0 ? (
				<EmptyPanelMessage text="현재 critical 리스크는 없습니다. 단, 업로드 직전 제목/설명/썸네일 일치 여부는 계속 확인하세요." />
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{risks.map((risk) => (
						<RiskCard key={risk.id} risk={risk} />
					))}
				</div>
			)}
		</PanelShell>
	);
}

function RiskCard({ risk }: { risk: GrowthRiskControl }) {
	return (
		<div className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4">
			<div className="mb-3 flex items-start justify-between gap-3">
				<div className="flex items-center gap-2">
					<AlertTriangle
						size={17}
						className={risk.severity === "blocked" ? "text-[#b44332]" : "text-[#a57928]"}
					/>
					<div className="text-[15px] font-black text-[#1d1a15]">
						{risk.title}
					</div>
				</div>
				<PTag color={healthColor(risk.severity)}>{healthLabel(risk.severity)}</PTag>
			</div>
			<p className="text-[12px] leading-5 text-[#716452]">{risk.detail}</p>
			<div className="mt-3 rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-bold leading-5 text-[#5b4932]">
				{risk.action}
			</div>
		</div>
	);
}

function RightsLedgerPanel({ items }: { items: RightsLedgerItem[] }) {
	return (
		<PanelShell
			kicker="rights ledger"
			title="저작권/재사용/반복 콘텐츠 방어 장부"
			description="외부 영상·뉴스·이미지·음악을 쓸 때 출처, 변형 정도, 해설 가치가 남아야 채널 단위 리스크를 낮출 수 있습니다."
			icon={<ShieldCheck size={17} />}
		>
			{items.length === 0 ? (
				<EmptyPanelMessage text="업로드 후보가 없습니다. 후보가 생기면 출처/변형/반복 리스크를 자동 장부화합니다." />
			) : (
				<div className="grid max-h-[560px] gap-3 overflow-auto pr-1">
					{items.map((item) => (
						<div
							key={item.id}
							className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4"
						>
							<div className="mb-3 flex items-start justify-between gap-3">
								<div>
									<div className="text-[15px] font-black leading-tight text-[#1d1a15]">
										{item.title}
									</div>
									<div className="mt-1 text-[11px] font-black uppercase tracking-[.14em] text-[#9b7a3c]">
										{item.reuseRisk}
									</div>
								</div>
								<PTag color={healthColor(item.severity)}>
									{healthLabel(item.severity)}
								</PTag>
							</div>
							<div className="grid gap-2 sm:grid-cols-2">
								<GrowthMetric
									label="출처 커버리지"
									value={`${item.sourceCoverage}점`}
									detail="설명/자료/링크/공식 출처 신호"
								/>
								<GrowthMetric
									label="변형 점수"
									value={`${item.transformScore}점`}
									detail="해설/분석/반론/결론 추가 신호"
								/>
							</div>
							<div className="mt-3 grid gap-2">
								{item.requiredActions.slice(0, 3).map((action) => (
									<div
										key={action}
										className="rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-bold leading-5 text-[#5b4932]"
									>
										{action}
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			)}
		</PanelShell>
	);
}

function MissingDataPanel({ missingData }: { missingData: GrowthMissingData[] }) {
	return (
		<PanelShell
			kicker="data debt"
			title="추천 신뢰도를 낮추는 빈칸"
			description="데이터가 없으면 자동 추천은 강해질 수 없습니다. 먼저 어떤 데이터가 비었는지 보여줍니다."
			icon={<Gauge size={17} />}
		>
			{missingData.length === 0 ? (
				<EmptyPanelMessage text="핵심 데이터 빈칸이 없습니다. 이제 실험 결과를 누적해 승자 포맷을 찾으면 됩니다." />
			) : (
				<div className="grid gap-3">
					{missingData.map((item) => (
						<div
							key={item.id}
							className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4"
						>
							<div className="flex items-start justify-between gap-3">
								<div>
									<div className="text-[15px] font-black text-[#1d1a15]">
										{item.label}
									</div>
									<p className="mt-1 text-[12px] leading-5 text-[#716452]">
										{item.impact}
									</p>
								</div>
								<PTag color="notification-warning-soft">{item.count}개</PTag>
							</div>
							<div className="mt-3 rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-bold leading-5 text-[#5b4932]">
								{item.action}
							</div>
						</div>
					))}
				</div>
			)}
		</PanelShell>
	);
}

function AutomationRoutinePanel({
	routines,
	onSave,
}: {
	routines: AutomationRoutine[];
	onSave: () => void;
}) {
	return (
		<PanelShell
			kicker="automation routines"
			title="주기 자동 루틴"
			description="당장 배포 자동 실행보다 먼저, 어떤 작업이 어떤 주기로 돌아야 하는지 사양을 저장해 다음 세션에서도 이어지게 합니다."
			icon={<Rocket size={17} />}
		>
			<div className="mb-3 flex justify-end">
				<PButton compact variant="secondary" onClick={onSave}>
					자동 루틴 사양 저장
				</PButton>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				{routines.map((routine) => (
					<div
						key={routine.id}
						className="rounded-[22px] border border-[#eadcc8] bg-[#fffaf1] p-4"
					>
						<div className="mb-3 flex items-start justify-between gap-3">
							<div>
								<div className="text-[16px] font-black text-[#1d1a15]">
									{routine.label}
								</div>
								<div className="mt-1 text-[11px] font-black uppercase tracking-[.14em] text-[#9b7a3c]">
									{routine.frequency}
								</div>
							</div>
							<PTag
								color={
									routine.enabledByDefault
										? "notification-success-soft"
										: "background-surface"
								}
							>
								{routine.enabledByDefault ? "기본 ON" : "대기"}
							</PTag>
						</div>
						<p className="text-[12px] leading-5 text-[#716452]">
							{routine.nextRunHint}
						</p>
						<div className="mt-3 grid gap-1.5">
							{routine.actions.slice(0, 3).map((action) => (
								<div
									key={action}
									className="rounded-2xl bg-[#f3eadc] px-3 py-2 text-[12px] font-semibold leading-5 text-[#5b4932]"
								>
									{action}
								</div>
							))}
						</div>
						<div className="mt-3 text-[11px] font-semibold text-[#8b7658]">
							필요 데이터: {routine.dataRequired.join(" · ")}
						</div>
					</div>
				))}
			</div>
		</PanelShell>
	);
}

function EvidencePanel({ center }: { center: GrowthCommandCenter }) {
	return (
		<section className="mt-5 rounded-[28px] border border-[#dcc8aa] bg-[#1d1a15] p-4 text-[#fff8ec] shadow-[0_18px_54px_rgba(31,24,17,.12)] sm:p-5">
			<div className="grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
				<div>
					<div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[.18em] text-[#f2c166]">
						<CheckCircle size={13} />
						Evidence
					</div>
					<h2 className="text-[24px] font-black tracking-[-.035em]">
						판단 근거
					</h2>
					<p className="mt-2 text-[13px] leading-6 text-[#cfc5b5]">
						이 화면은 외부 감이 아니라 저장된 업로드/분석/렌더/정책/레퍼런스
						신호를 합쳐 다음 액션을 냅니다.
					</p>
				</div>
				<div className="grid gap-2 md:grid-cols-2">
					{center.evidence.map((item) => (
						<div
							key={item}
							className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] font-semibold leading-5 text-[#e6dccd]"
						>
							{item}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function PanelShell({
	kicker,
	title,
	description,
	icon,
	children,
}: {
	kicker: string;
	title: string;
	description: string;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-[30px] border border-[#dcc8aa] bg-white/70 p-4 shadow-[0_16px_44px_rgba(81,61,34,.08)] sm:p-5">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#1d1a15] px-3 py-1 text-[10px] font-black uppercase tracking-[.18em] text-[#f2c166]">
						{icon}
						{kicker}
					</div>
					<h2 className="text-[24px] font-black leading-tight tracking-[-.035em] text-[#1d1a15]">
						{title}
					</h2>
					<p className="mt-1 max-w-3xl text-[13px] leading-6 text-[#716452]">
						{description}
					</p>
				</div>
			</div>
			{children}
		</section>
	);
}

function EmptyPanelMessage({ text }: { text: string }) {
	return (
		<div className="rounded-[22px] border border-dashed border-[#dcc8aa] bg-[#fffaf1] px-4 py-8 text-center text-[13px] font-semibold leading-6 text-[#716452]">
			{text}
		</div>
	);
}

function GrowthMetric({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-2xl bg-[#f3eadc] px-3 py-2">
			<div className="text-[10px] font-black uppercase tracking-[.14em] text-[#8b7658]">
				{label}
			</div>
			<div className="mt-1 text-[15px] font-black text-[#1d1a15]">{value}</div>
			<div className="mt-0.5 text-[11px] leading-5 text-[#716452]">{detail}</div>
		</div>
	);
}

function kpiIcon(id: string) {
	if (id === "command-score") return <Gauge size={20} />;
	if (id === "content-pipeline") return <Upload size={20} />;
	if (id === "analytics-loop") return <BarChart3 size={20} />;
	if (id === "thumbnail-readiness") return <Target size={20} />;
	if (id === "view-signal") return <TrendingUp size={20} />;
	return <ShieldCheck size={20} />;
}

function healthColor(health: GrowthHealth) {
	if (health === "good") return "notification-success-soft";
	if (health === "watch") return "notification-info-soft";
	if (health === "risk") return "notification-warning-soft";
	return "notification-error-soft";
}

function healthLabel(health: GrowthHealth) {
	if (health === "good") return "정상";
	if (health === "watch") return "관찰";
	if (health === "risk") return "위험";
	return "차단";
}

function syncStatusColor(status: AnalyticsSyncPlan["status"]) {
	if (status === "ready") return "notification-success-soft";
	if (status === "partial") return "notification-info-soft";
	return "notification-warning-soft";
}

function syncStatusLabel(status: AnalyticsSyncPlan["status"]) {
	if (status === "ready") return "준비";
	if (status === "partial") return "부분";
	return "대기";
}

function confidenceColor(confidence: GrowthCommandCenter["confidence"]) {
	if (confidence === "high") return "notification-success-soft";
	if (confidence === "medium") return "notification-info-soft";
	return "notification-warning-soft";
}

function confidenceLabel(confidence: GrowthCommandCenter["confidence"]) {
	if (confidence === "high") return "성과 기반";
	if (confidence === "medium") return "중간 신뢰";
	return "데이터 부족";
}

function loopStatusColor(status: GrowthLoopStage["status"]) {
	if (status === "complete") return "notification-success-soft";
	if (status === "active") return "notification-info-soft";
	return "notification-warning-soft";
}

function loopStatusLabel(status: GrowthLoopStage["status"]) {
	if (status === "complete") return "완료";
	if (status === "active") return "진행";
	return "대기";
}

function decisionColor(kind: GrowthDecisionKind) {
	if (kind === "scale") return "notification-success-soft";
	if (kind === "fix_packaging") return "notification-warning-soft";
	if (kind === "fix_retention") return "notification-info-soft";
	return "background-surface";
}

function decisionLabel(kind: GrowthDecisionKind) {
	if (kind === "scale") return "증폭";
	if (kind === "fix_packaging") return "패키징 수정";
	if (kind === "fix_retention") return "리텐션 수정";
	return "관찰";
}

function formatDateTime(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "-";
	return date.toLocaleString("ko-KR", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
