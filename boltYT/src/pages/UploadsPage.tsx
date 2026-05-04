import {
	PButton,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import {
	BarChart3,
	Calendar,
	CheckCircle,
	CheckSquare,
	Clock,
	ExternalLink,
	FileVideo,
	Hash,
	Image as ImageIcon,
	ListFilter,
	MonitorPlay,
	RefreshCw,
	RotateCcw,
	Search,
	ShieldCheck,
	Target,
	Timer,
	TrendingUp,
	Square,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import ContentStatusBadge from "../components/ContentStatusBadge";
import LicenseAuditPanel from "../components/LicenseAuditPanel";
import { getHealth } from "../lib/diag";
import { getIgAuthStatus, uploadToInstagram } from "../lib/instagram";
import { loadLocalFileUrl } from "../lib/local-db";
import type { MediaSource } from "../lib/media-license";
import { supabase } from "../lib/supabase";
import { getTikTokAuthStatus, uploadToTikTok } from "../lib/tiktok";
import { assessThumbnailReadiness } from "../lib/thumbnail-intelligence";
import {
	buildUploadGrowthPlan,
	type GrowthPlan,
	type UploadAnalyticsSnapshot,
	type UploadRenderSnapshot,
} from "../lib/upload-growth";
import {
	deriveUploadReadiness,
	hasPublishedToPlatform,
	normalizeUploadStatus,
	platformLabel,
	platformVideoId,
	summarizeUploads,
	UPLOAD_PLATFORMS,
	type PlatformConnections,
	type UploadPlatform,
	type UploadStatusKind,
} from "../lib/upload-management";
import {
	getAuthStatus,
	getDeepVideoAnalytics,
	getVideoAnalytics,
	uploadVideo,
} from "../lib/youtube";
import { analyzeYouTubePolicyRisk } from "../lib/youtube-policy-risk";

interface UploadRow {
	id: string;
	render_id: string;
	title: string;
	description: string;
	status: string;
	tags: string[];
	youtube_video_id: string;
	tiktok_video_id: string | null;
	instagram_media_id: string | null;
	scheduled_at: string | null;
	published_at: string | null;
	created_at: string;
	thumbnail_path?: string;
}

interface UploadState {
	uploading: string | null;
	error: string | null;
	scheduling: string | null;
	bulkRunning: boolean;
}

type StatusFilter = "all" | UploadStatusKind;
type PlatformFilter = "all" | UploadPlatform;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
	{ id: "all", label: "전체" },
	{ id: "queued", label: "대기" },
	{ id: "scheduled", label: "예약" },
	{ id: "uploading", label: "진행" },
	{ id: "published", label: "게시" },
	{ id: "failed", label: "실패" },
];

async function blobUrlToDataUrl(url: string): Promise<string> {
	const res = await fetch(url);
	if (!res.ok) return "";
	const blob = await res.blob();
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () =>
			resolve(typeof reader.result === "string" ? reader.result : "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

async function loadThumbnailDataUrl(upload: UploadRow): Promise<string> {
	if (!upload.thumbnail_path) return "";
	const blobUrl = await loadLocalFileUrl(upload.thumbnail_path, "image/jpeg");
	if (!blobUrl) return "";
	return blobUrlToDataUrl(blobUrl);
}

async function resolveRenderStoragePath(renderId: string): Promise<string> {
	try {
		const rqRes = await fetch(`http://localhost:3458/render/${renderId}`);
		if (rqRes.ok) {
			const rqData = (await rqRes.json()) as { job?: { outputPath?: string } };
			if (rqData.job?.outputPath) return rqData.job.outputPath;
		}
	} catch {
		// render-queue 서버가 꺼져 있으면 DB fallback으로 간다.
	}

	const { data: render } = await supabase
		.from("renders")
		.select("storage_path")
		.eq("id", renderId)
		.maybeSingle();
	return (render as { storage_path?: string } | null)?.storage_path ?? "";
}

async function resolveRenderPublicUrl(renderId: string): Promise<string> {
	const { data: render } = await supabase
		.from("renders")
		.select("public_url")
		.eq("id", renderId)
		.maybeSingle();
	return (render as { public_url?: string } | null)?.public_url ?? "";
}

function formatDate(value?: string | null): string {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "-";
	return date.toLocaleString("ko-KR", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function shortId(value: string): string {
	if (!value) return "";
	return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function readinessColor(level: "ready" | "warning" | "blocked") {
	if (level === "ready") return "notification-success-soft";
	if (level === "warning") return "notification-warning-soft";
	return "notification-error-soft";
}

function statusLabel(status: UploadStatusKind) {
	const labels: Record<UploadStatusKind, string> = {
		queued: "업로드 대기",
		uploading: "업로드 중",
		scheduled: "예약됨",
		published: "게시됨",
		failed: "실패",
		unknown: "확인 필요",
	};
	return labels[status];
}

export default function UploadsPage() {
	const [uploads, setUploads] = useState<UploadRow[]>([]);
	const [analyticsByUploadId, setAnalyticsByUploadId] = useState<
		Record<string, UploadAnalyticsSnapshot>
	>({});
	const [rendersById, setRendersById] = useState<
		Record<string, UploadRenderSnapshot>
	>({});
	const [loading, setLoading] = useState(true);
	const [healthLoading, setHealthLoading] = useState(false);
	const [connections, setConnections] = useState<PlatformConnections>({
		youtube: { ready: false },
		tiktok: { ready: false },
		instagram: { ready: false },
	});
	const [selectedPlatforms, setSelectedPlatforms] = useState<
		Record<string, UploadPlatform>
	>({});
	const [selectedUploadIds, setSelectedUploadIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [state, setState] = useState<UploadState>({
		uploading: null,
		error: null,
		scheduling: null,
		bulkRunning: false,
	});
	const [scheduledInputs, setScheduledInputs] = useState<Record<string, string>>(
		{},
	);
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");

	const loadUploads = useCallback(async () => {
		setLoading(true);
		const { data, error } = await supabase
			.from("uploads")
			.select("*")
			.order("created_at", { ascending: false });
		if (error) {
			setState((s) => ({ ...s, error: error.message }));
			setUploads([]);
			setAnalyticsByUploadId({});
			setRendersById({});
		} else {
			const rows = (data as UploadRow[]) ?? [];
			setUploads(rows);
			const uploadIds = rows.map((upload) => upload.id).filter(Boolean);
			const renderIds = rows.map((upload) => upload.render_id).filter(Boolean);
			const [analyticsRes, rendersRes] = await Promise.all([
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
			]);
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
			setAnalyticsByUploadId(analyticsMap);
			setRendersById(renderMap);
		}
		setLoading(false);
	}, []);

	const refreshConnections = useCallback(async () => {
		setHealthLoading(true);
		const health = await getHealth();
		const serverOk = (name: string) =>
			Boolean(health?.servers.find((server) => server.name === name)?.ok);
		const ytOk = serverOk("youtube-upload");
		const tkOk = serverOk("tiktok-upload");
		const igOk = serverOk("instagram-upload");

		const [ytStatus, tkStatus, igStatus] = await Promise.all([
			ytOk ? getAuthStatus().catch(() => null) : null,
			tkOk ? getTikTokAuthStatus().catch(() => null) : null,
			igOk ? getIgAuthStatus().catch(() => null) : null,
		]);

		setConnections({
			youtube: {
				ready: Boolean(ytOk && ytStatus?.authenticated),
				accountLabel: ytStatus?.channel?.title ?? null,
			},
			tiktok: {
				ready: Boolean(tkOk && tkStatus?.authenticated),
				accountLabel: tkStatus?.user?.displayName ?? null,
			},
			instagram: {
				ready: Boolean(igOk && igStatus?.authenticated),
				accountLabel: igStatus?.user?.username
					? `@${igStatus.user.username}`
					: null,
			},
		});
		setHealthLoading(false);
	}, []);

	const refreshAll = useCallback(async () => {
		await Promise.all([loadUploads(), refreshConnections()]);
	}, [loadUploads, refreshConnections]);

	useEffect(() => {
		void refreshAll();
	}, [refreshAll]);

	const summary = useMemo(() => summarizeUploads(uploads), [uploads]);
	const growthPlan = useMemo(
		() =>
			buildUploadGrowthPlan({
				uploads,
				analyticsByUploadId,
				rendersById,
			}),
		[analyticsByUploadId, rendersById, uploads],
	);

	const filteredUploads = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		return uploads.filter((upload) => {
			const status = normalizeUploadStatus(upload.status);
			if (statusFilter !== "all" && status !== statusFilter) return false;
			if (
				platformFilter !== "all" &&
				!hasPublishedToPlatform(upload, platformFilter)
			) {
				return false;
			}
			if (!query) return true;
			return [
				upload.title,
				upload.description,
				...(upload.tags ?? []),
				upload.youtube_video_id,
				upload.tiktok_video_id,
				upload.instagram_media_id,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase()
				.includes(query);
		});
	}, [platformFilter, searchQuery, statusFilter, uploads]);

	const selectedUploads = useMemo(
		() => filteredUploads.filter((upload) => selectedUploadIds.has(upload.id)),
		[filteredUploads, selectedUploadIds],
	);

	function selectedPlatform(upload: UploadRow): UploadPlatform {
		return selectedPlatforms[upload.id] ?? "youtube";
	}

	function setSelectedPlatform(uploadId: string, platform: UploadPlatform) {
		setSelectedPlatforms((prev) => ({ ...prev, [uploadId]: platform }));
	}

	function toggleSelected(uploadId: string) {
		setSelectedUploadIds((prev) => {
			const next = new Set(prev);
			if (next.has(uploadId)) next.delete(uploadId);
			else next.add(uploadId);
			return next;
		});
	}

	function toggleAllFiltered() {
		setSelectedUploadIds((prev) => {
			const allSelected = filteredUploads.every((upload) => prev.has(upload.id));
			if (allSelected) return new Set();
			return new Set(filteredUploads.map((upload) => upload.id));
		});
	}

	async function updateUploadRow(
		uploadId: string,
		patch: Partial<UploadRow> & Record<string, unknown>,
	) {
		const { error } = await supabase.from("uploads").update(patch).eq("id", uploadId);
		if (error) throw new Error(error.message);
		setUploads((prev) =>
			prev.map((upload) =>
				upload.id === uploadId ? { ...upload, ...patch } : upload,
			),
		);
	}

	function criticalPolicyIssue(upload: UploadRow) {
		return analyzeYouTubePolicyRisk({
			title: upload.title,
			description: upload.description,
			scenes: [],
		}).issues.find((issue) => issue.severity === "critical");
	}

	async function handleUploadToPlatform(
		upload: UploadRow,
		platform: UploadPlatform,
	) {
		const policyIssue =
			platform === "youtube" ? criticalPolicyIssue(upload) : undefined;
		const readiness = deriveUploadReadiness({
			upload,
			platform,
			connection: connections[platform],
			hasCriticalPolicyIssue: Boolean(policyIssue),
		});
		if (!readiness.ok) {
			setState((s) => ({
				...s,
				error: readiness.blockers.join(" "),
			}));
			return;
		}

		setState({ uploading: upload.id, error: null, scheduling: null, bulkRunning: false });
		await updateUploadRow(upload.id, { status: "uploading" });

		try {
			if (platform === "youtube") {
				const storagePath = await resolveRenderStoragePath(upload.render_id);
				if (!storagePath) throw new Error("렌더 파일 경로를 찾을 수 없습니다.");
				const thumbnailDataUrl = await loadThumbnailDataUrl(upload);
				const result = await uploadVideo({
					filePath: storagePath,
					title: upload.title,
					description: upload.description,
					tags: upload.tags,
					thumbnailDataUrl: thumbnailDataUrl || undefined,
					privacyStatus: upload.scheduled_at ? "private" : "public",
					scheduledAt: upload.scheduled_at ?? undefined,
				});
				await updateUploadRow(upload.id, {
					status: upload.scheduled_at ? "scheduled" : "published",
					platform: "youtube",
					youtube_video_id: result.videoId,
					published_at: upload.scheduled_at ? upload.published_at : new Date().toISOString(),
				});
			}

			if (platform === "tiktok") {
				const storagePath = await resolveRenderStoragePath(upload.render_id);
				if (!storagePath) throw new Error("렌더 파일 경로를 찾을 수 없습니다.");
				const result = await uploadToTikTok({
					filePath: storagePath,
					title: upload.title,
					privacyLevel: "PUBLIC_TO_EVERYONE",
				});
				await updateUploadRow(upload.id, {
					status: "published",
					platform: "tiktok",
					tiktok_video_id: result.publishId,
					published_at: new Date().toISOString(),
				});
			}

			if (platform === "instagram") {
				const videoUrl = await resolveRenderPublicUrl(upload.render_id);
				if (!videoUrl) {
					throw new Error(
						"Instagram은 공개 URL이 필요합니다. Supabase Storage 공개 URL을 설정하세요.",
					);
				}
				const result = await uploadToInstagram({
					videoUrl,
					caption: `${upload.title}\n\n${upload.tags?.map((t) => `#${t}`).join(" ")}`,
				});
				await updateUploadRow(upload.id, {
					status: "published",
					platform: "instagram",
					instagram_media_id: result.mediaId,
					published_at: new Date().toISOString(),
				});
			}

			setState({ uploading: null, error: null, scheduling: null, bulkRunning: false });
			setSelectedUploadIds((prev) => {
				const next = new Set(prev);
				next.delete(upload.id);
				return next;
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "업로드 실패";
			await updateUploadRow(upload.id, { status: "failed" }).catch(() => null);
			setState({ uploading: null, error: message, scheduling: null, bulkRunning: false });
		}
	}

	async function handleRetry(upload: UploadRow) {
		await updateUploadRow(upload.id, { status: "queued" });
	}

	async function handleSchedule(upload: UploadRow) {
		const dateStr = scheduledInputs[upload.id];
		if (!dateStr) return;
		setState((s) => ({ ...s, scheduling: upload.id }));
		const scheduledAt = new Date(dateStr).toISOString();
		await updateUploadRow(upload.id, {
			status: "scheduled",
			scheduled_at: scheduledAt,
		});
		setState((s) => ({ ...s, scheduling: null }));
	}

	async function handleSyncAnalytics(upload: UploadRow) {
		if (!upload.youtube_video_id) return;
		try {
			const analytics = await getDeepVideoAnalytics(upload.youtube_video_id, 28).catch(
				() => getVideoAnalytics(upload.youtube_video_id),
			);
			await supabase.from("analytics").insert({
				upload_id: upload.id,
				views: analytics.views,
				likes: analytics.likes,
				comments: analytics.comments,
				ctr: "impressionCtr" in analytics ? (analytics.impressionCtr ?? 0) : 0,
				avg_watch_duration:
					"averageViewDuration" in analytics
						? (analytics.averageViewDuration ?? 0)
						: 0,
				avg_view_percentage:
					"averageViewPercentage" in analytics
						? (analytics.averageViewPercentage ?? null)
						: null,
				estimated_minutes_watched:
					"estimatedMinutesWatched" in analytics
						? (analytics.estimatedMinutesWatched ?? null)
						: null,
				shares: "shares" in analytics ? (analytics.shares ?? null) : null,
				subscribers_gained:
					"subscribersGained" in analytics
						? (analytics.subscribersGained ?? 0)
						: 0,
				subscribers_lost:
					"subscribersLost" in analytics
						? (analytics.subscribersLost ?? null)
						: null,
				traffic_sources:
					"trafficSources" in analytics ? (analytics.trafficSources ?? null) : null,
				retention_curve:
					"retentionCurve" in analytics ? (analytics.retentionCurve ?? null) : null,
				daily_rows: "dailyRows" in analytics ? (analytics.dailyRows ?? null) : null,
				sync_warnings:
					"warnings" in analytics ? (analytics.warnings ?? null) : null,
			});
		} catch {
			setState((s) => ({
				...s,
				error: "분석 동기화에 실패했습니다. YouTube 인증 상태를 확인하세요.",
			}));
		}
	}

	async function handleBulkUpload() {
		setState((s) => ({ ...s, error: null, bulkRunning: true }));
		for (const upload of selectedUploads) {
			await handleUploadToPlatform(upload, selectedPlatform(upload));
		}
		setState((s) => ({ ...s, bulkRunning: false }));
	}

	if (loading) {
		return (
			<div className="grid min-h-[420px] place-items-center rounded-[28px] bg-[#0f1217] text-[#f8f3e8]">
				<div className="text-center">
					<PSpinner size="medium" />
					<PText className="mt-static-sm" color="contrast-medium">
						업로드 대기열을 불러오는 중입니다.
					</PText>
				</div>
			</div>
		);
	}

	return (
		<div
			className="mx-auto max-w-[1420px] rounded-[34px] bg-[#f5f0e6] p-4 text-[#161411] shadow-[0_28px_90px_rgba(48,37,23,.16)] sm:p-6 lg:p-8"
			style={{
				fontFamily:
					"'Pretendard', 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
				wordBreak: "keep-all",
			}}
		>
			<header className="relative overflow-hidden rounded-[30px] border border-[#dacdb9] bg-[#171411] p-5 text-[#fff9ed] shadow-[inset_0_1px_0_rgba(255,255,255,.1)] sm:p-7 lg:p-8">
				<div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#f0b957]/25 blur-3xl" />
				<div className="pointer-events-none absolute bottom-[-30%] left-[18%] h-60 w-60 rounded-full bg-[#5eead4]/15 blur-3xl" />
				<div className="relative grid gap-6 lg:grid-cols-[1.2fr_.8fr] lg:items-end">
					<div>
						<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] font-black uppercase tracking-[.22em] text-[#f0b957]">
							<Upload size={13} />
							Upload control room
						</div>
						<PHeading size="x-large" tag="h1">
							업로드 대기열을 운영 가능한 배포 보드로 관리
						</PHeading>
						<PText className="mt-static-sm max-w-3xl text-[#cfc5b5]">
							플랫폼 연결, 예약, 정책 리스크, 실패 재시도, 게시 ID를 한 번에
							확인합니다. 업로드 전 차단 사유가 있으면 카드에서 바로 드러나게
							했습니다.
						</PText>
					</div>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						<SummaryTile label="전체" value={summary.total} />
						<SummaryTile label="업로드 가능" value={summary.readyToUpload} />
						<SummaryTile label="예약" value={summary.scheduled} />
						<SummaryTile label="실패" value={summary.failed} danger={summary.failed > 0} />
					</div>
				</div>
			</header>

			<section className="mt-5 grid gap-3 lg:grid-cols-3">
				{UPLOAD_PLATFORMS.map((platform) => (
					<PlatformHealthCard
						key={platform.id}
						platform={platform.id}
						ready={connections[platform.id].ready}
						account={connections[platform.id].accountLabel}
						loading={healthLoading}
					/>
				))}
			</section>

			<GrowthPlanPanel plan={growthPlan} />

			<section className="mt-5 rounded-[26px] border border-[#dacdb9] bg-white/75 p-4 shadow-sm">
				<div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
					<div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
						<label className="relative block">
							<Search
								size={16}
								className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a7e6f]"
							/>
							<input
								type="search"
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder="제목, 설명, 태그, 게시 ID 검색"
								className="h-11 w-full rounded-2xl border border-[#d8c9b5] bg-[#fffaf2] pl-10 pr-4 text-[14px] font-semibold outline-none transition focus:border-[#9b6b2f] focus:ring-4 focus:ring-[#d69a3a]/15"
							/>
						</label>
						<SelectBox
							icon={<ListFilter size={15} />}
							value={statusFilter}
							onChange={(value) => setStatusFilter(value as StatusFilter)}
							options={STATUS_FILTERS}
						/>
						<SelectBox
							icon={<MonitorPlay size={15} />}
							value={platformFilter}
							onChange={(value) => setPlatformFilter(value as PlatformFilter)}
							options={[
								{ id: "all", label: "모든 플랫폼" },
								...UPLOAD_PLATFORMS.map((platform) => ({
									id: platform.id,
									label: platform.label,
								})),
							]}
						/>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<PButton compact variant="secondary" onClick={refreshAll}>
							<span className="inline-flex items-center gap-1">
								<RefreshCw size={14} />
								새로고침
							</span>
						</PButton>
						<PButton
							compact
							disabled={selectedUploads.length === 0 || state.bulkRunning}
							loading={state.bulkRunning}
							onClick={handleBulkUpload}
						>
							선택 {selectedUploads.length}개 업로드
						</PButton>
					</div>
				</div>
			</section>

			<LicenseAuditPanel
				sources={Array.from(
					new Set<MediaSource>(
						uploads.flatMap(
							() => ["pexels", "pixabay", "dalle"] as MediaSource[],
						),
					),
				)}
				usage="commercial"
				className="mt-5"
			/>

			{state.error && (
				<PInlineNotification
					state="error"
					className="mt-5"
					dismissButton={true}
					onDismiss={() => setState((s) => ({ ...s, error: null }))}
				>
					{state.error}
				</PInlineNotification>
			)}

			<section className="mt-5">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
					<PText size="small" color="contrast-medium">
						표시 {filteredUploads.length}개 · 지난 예약 {summary.overdue}개
					</PText>
					<button
						type="button"
						onClick={toggleAllFiltered}
						className="inline-flex items-center gap-2 rounded-full border border-[#d8c9b5] bg-white/80 px-3 py-2 text-[12px] font-black text-[#3b3328] transition hover:bg-[#fffaf2]"
					>
						{filteredUploads.every((upload) => selectedUploadIds.has(upload.id)) &&
						filteredUploads.length > 0 ? (
							<CheckSquare size={15} />
						) : (
							<Square size={15} />
						)}
						전체 선택
					</button>
				</div>

				{filteredUploads.length === 0 ? (
					<EmptyState />
				) : (
					<div className="grid gap-4">
						{filteredUploads.map((upload) => (
							<UploadCard
								key={upload.id}
								upload={upload}
								platform={selectedPlatform(upload)}
								connections={connections}
								selected={selectedUploadIds.has(upload.id)}
								scheduledInput={scheduledInputs[upload.id] ?? ""}
								busy={state.uploading === upload.id}
								scheduling={state.scheduling === upload.id}
								onToggleSelected={() => toggleSelected(upload.id)}
								onPlatformChange={(platform) =>
									setSelectedPlatform(upload.id, platform)
								}
								onScheduleInput={(value) =>
									setScheduledInputs((prev) => ({
										...prev,
										[upload.id]: value,
									}))
								}
								onUpload={() => handleUploadToPlatform(upload, selectedPlatform(upload))}
								onRetry={() => handleRetry(upload)}
								onSchedule={() => handleSchedule(upload)}
								onSyncAnalytics={() => handleSyncAnalytics(upload)}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	);
}

function GrowthPlanPanel({ plan }: { plan: GrowthPlan }) {
	const confidenceLabel = {
		low: "데이터 부족",
		medium: "중간 신뢰",
		high: "성과 기반",
	}[plan.confidence];

	return (
		<section className="mt-5 rounded-[28px] border border-[#d6c7b3] bg-[#1d1a15] p-4 text-[#fff9ed] shadow-[0_18px_54px_rgba(31,24,17,.14)] sm:p-5">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[.18em] text-[#f0b957]">
						<TrendingUp size={13} />
						Distribution growth
					</div>
					<h2 className="text-[25px] font-black leading-tight tracking-[-.035em]">
						배포 성장 추천
					</h2>
					<p className="mt-1 max-w-3xl text-[13px] leading-6 text-[#cfc5b5]">
						공식 기준상 제목/설명/썸네일이 발견성의 중심이고 태그는 보조
						신호입니다. 시간대는 실제 성과가 쌓이면 히스토리 기준으로,
						부족하면 기본 실험 슬롯으로 제안합니다.
					</p>
				</div>
				<PTag
					color={
						plan.confidence === "high"
							? "notification-success-soft"
							: plan.confidence === "medium"
								? "notification-info-soft"
								: "notification-warning-soft"
					}
				>
					{confidenceLabel}
				</PTag>
			</div>

			<div className="mb-3 grid gap-3 lg:grid-cols-[1.05fr_.95fr]">
				<div className="rounded-[22px] border border-[#e76f51]/20 bg-[#e76f51]/10 p-4">
					<div className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#ffbd9f]">
						<ShieldCheck size={16} />
						계정 삭제/정책 리스크 수치
					</div>
					<div className="grid gap-2 md:grid-cols-2">
						{plan.domainMetrics.slice(0, 4).map((metric) => (
							<div
								key={metric.label}
								className="rounded-2xl bg-black/20 px-3 py-2"
							>
								<div className="text-[11px] font-black text-[#fff9ed]">
									{metric.label} · {metric.displayValue}
								</div>
								<div className="mt-1 text-[11px] leading-5 text-[#ffd4c2]">
									{metric.implication}
								</div>
							</div>
						))}
					</div>
					<div className="mt-3 grid gap-2">
						{plan.domainActions.slice(0, 3).map((action) => (
							<div
								key={action}
								className="rounded-2xl bg-black/20 px-3 py-2 text-[12px] font-bold leading-5 text-[#ffe4d6]"
							>
								{action}
							</div>
						))}
					</div>
				</div>

				<div className="rounded-[22px] border border-[#58c6a6]/20 bg-[#58c6a6]/10 p-4">
					<div className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#b7f0dc]">
						<BarChart3 size={16} />
						트렌드 클러스터
					</div>
					<div className="grid gap-2">
						{plan.trendSignals.map((signal) => (
							<div
								key={signal.label}
								className="rounded-2xl bg-black/20 px-3 py-2"
							>
								<div className="flex items-center justify-between gap-2">
									<div className="text-[13px] font-black text-[#fff9ed]">
										{signal.label}
									</div>
									<PTag
										color={
											signal.risk === "high"
												? "notification-warning-soft"
												: "notification-success-soft"
										}
									>
										S{signal.score}
									</PTag>
								</div>
								<div className="mt-1 text-[11px] leading-5 text-[#c9ddcf]">
									{signal.examples.join(" · ")}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
				<div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
					<div className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#f0b957]">
						<Hash size={16} />
						노출 키워드
					</div>
					{plan.keywords.length === 0 ? (
						<p className="text-[13px] leading-6 text-[#cfc5b5]">
							성과 키워드가 아직 부족합니다. 다음 3개 업로드에서 제목 첫 줄과
							설명 첫 2줄 키워드를 통일해 데이터를 쌓으세요.
						</p>
					) : (
						<div className="flex flex-wrap gap-2">
							{plan.keywords.slice(0, 10).map((item) => (
								<span
									key={item.keyword}
									title={item.reason}
									className="rounded-full bg-[#f0b957]/15 px-3 py-1.5 text-[12px] font-black text-[#ffd98b]"
								>
									#{item.keyword} · {item.score}
								</span>
							))}
						</div>
					)}
					<div className="mt-4 grid gap-2 md:grid-cols-2">
						{plan.metadataActions.slice(0, 4).map((action) => (
							<div
								key={action}
								className="rounded-2xl bg-black/20 px-3 py-2 text-[12px] leading-5 text-[#d7cbb8]"
							>
								{action}
							</div>
						))}
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
					<div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
						<div className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#f0b957]">
							<ImageIcon size={16} />
							썸네일 패키지
						</div>
						<div className="grid gap-2">
							{plan.thumbnailActions.slice(0, 3).map((action) => (
								<div
									key={action}
									className="rounded-2xl bg-black/20 px-3 py-2 text-[12px] leading-5 text-[#d7cbb8]"
								>
									{action}
								</div>
							))}
						</div>
					</div>

					<div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
						<div className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#f0b957]">
							<Timer size={16} />
							추천 시간대
						</div>
						<div className="grid gap-2">
							{plan.publishWindows.map((window) => (
								<div
									key={`${window.weekday}-${window.hour}-${window.source}`}
									className="flex items-start justify-between gap-3 rounded-2xl bg-black/20 px-3 py-2"
								>
									<div>
										<div className="text-[13px] font-black text-[#fff9ed]">
											{window.label}
										</div>
										<div className="text-[11px] leading-5 text-[#b9ad9c]">
											{window.reason}
										</div>
									</div>
									<PTag
										color={
											window.source === "history"
												? "notification-success-soft"
												: "notification-warning-soft"
										}
									>
										{window.source === "history" ? "성과" : "실험"}
									</PTag>
								</div>
							))}
						</div>
					</div>

					<div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4">
						<div className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#f0b957]">
							<Target size={16} />
							갯수/길이
						</div>
						<div className="grid gap-2">
							<GrowthMetric
								label="주간 목표"
								value={`${plan.cadence.targetPerWeek}개`}
								detail={`최근 7일 게시 ${plan.cadence.publishedLast7Days}개 · 예약 ${plan.cadence.scheduledNext7Days}개`}
							/>
							<GrowthMetric
								label="쇼츠 길이"
								value={plan.length.shortsTarget}
								detail={
									plan.length.currentShortsMedianSeconds
										? `현재 중앙값 ${formatSeconds(plan.length.currentShortsMedianSeconds)}`
										: "아직 렌더 길이 데이터 부족"
								}
							/>
							<GrowthMetric
								label="롱폼 길이"
								value={plan.length.longformTarget}
								detail={
									plan.length.currentLongformMedianSeconds
										? `현재 중앙값 ${formatSeconds(plan.length.currentLongformMedianSeconds)}`
										: "20분 초과 금지 기준 유지"
								}
							/>
						</div>
					</div>
				</div>
			</div>

			<div className="mt-3 grid gap-2 lg:grid-cols-2">
				{plan.nextActions.slice(0, 4).map((action) => (
					<div
						key={action}
						className="rounded-2xl border border-[#f0b957]/20 bg-[#f0b957]/10 px-3 py-2 text-[12px] font-bold leading-5 text-[#ffe1a3]"
					>
						{action}
					</div>
				))}
			</div>
		</section>
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
		<div className="rounded-2xl bg-black/20 px-3 py-2">
			<div className="text-[10px] font-black uppercase tracking-[.14em] text-[#b9ad9c]">
				{label}
			</div>
			<div className="mt-1 text-[13px] font-black text-[#fff9ed]">{value}</div>
			<div className="mt-0.5 text-[11px] leading-5 text-[#b9ad9c]">{detail}</div>
		</div>
	);
}

function formatSeconds(seconds: number): string {
	if (seconds >= 60) {
		const minutes = Math.floor(seconds / 60);
		const rest = seconds % 60;
		return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
	}
	return `${seconds}초`;
}

function SummaryTile({
	label,
	value,
	danger = false,
}: {
	label: string;
	value: number;
	danger?: boolean;
}) {
	return (
		<div className="rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3">
			<div
				className={`text-[26px] font-black tabular-nums ${danger ? "text-[#ff9b8f]" : "text-[#fff9ed]"}`}
			>
				{value}
			</div>
			<div className="text-[11px] font-bold uppercase tracking-[.16em] text-[#b9ad9c]">
				{label}
			</div>
		</div>
	);
}

function PlatformHealthCard({
	platform,
	ready,
	account,
	loading,
}: {
	platform: UploadPlatform;
	ready: boolean;
	account?: string | null;
	loading: boolean;
}) {
	const meta = UPLOAD_PLATFORMS.find((item) => item.id === platform)!;
	return (
		<div className="rounded-[24px] border border-[#dacdb9] bg-white/75 p-4 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<span
							className="h-2.5 w-2.5 rounded-full"
							style={{ backgroundColor: ready ? meta.accent : "#b7aa98" }}
						/>
						<PText weight="semi-bold">{meta.label}</PText>
					</div>
					<PText size="x-small" color="contrast-medium" className="mt-1">
						{ready
							? account || "연결됨"
							: "서버 또는 계정 인증이 필요합니다."}
					</PText>
				</div>
				<PTag
					color={ready ? "notification-success-soft" : "notification-warning-soft"}
				>
					{loading ? "확인 중" : ready ? "준비" : "미연결"}
				</PTag>
			</div>
		</div>
	);
}

function SelectBox({
	icon,
	value,
	options,
	onChange,
}: {
	icon: React.ReactNode;
	value: string;
	options: Array<{ id: string; label: string }>;
	onChange: (value: string) => void;
}) {
	return (
		<label className="relative block">
			<span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a7e6f]">
				{icon}
			</span>
			<select
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-11 w-full appearance-none rounded-2xl border border-[#d8c9b5] bg-[#fffaf2] pl-10 pr-4 text-[14px] font-black text-[#30271d] outline-none transition focus:border-[#9b6b2f] focus:ring-4 focus:ring-[#d69a3a]/15"
			>
				{options.map((option) => (
					<option key={option.id} value={option.id}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}

function EmptyState() {
	return (
		<div className="rounded-[28px] border border-dashed border-[#d8c9b5] bg-white/60 px-6 py-14 text-center">
			<div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-[#171411] text-[#f0b957]">
				<FileVideo size={30} />
			</div>
			<PHeading size="small" tag="h2">
				조건에 맞는 업로드가 없습니다
			</PHeading>
			<PText color="contrast-medium" className="mt-static-xs">
				콘텐츠를 승인하면 업로드 대기열에 추가됩니다. 필터를 바꾸면 숨겨진
				항목을 다시 볼 수 있습니다.
			</PText>
		</div>
	);
}

function UploadCard({
	upload,
	platform,
	connections,
	selected,
	scheduledInput,
	busy,
	scheduling,
	onToggleSelected,
	onPlatformChange,
	onScheduleInput,
	onUpload,
	onRetry,
	onSchedule,
	onSyncAnalytics,
}: {
	upload: UploadRow;
	platform: UploadPlatform;
	connections: PlatformConnections;
	selected: boolean;
	scheduledInput: string;
	busy: boolean;
	scheduling: boolean;
	onToggleSelected: () => void;
	onPlatformChange: (platform: UploadPlatform) => void;
	onScheduleInput: (value: string) => void;
	onUpload: () => void;
	onRetry: () => void;
	onSchedule: () => void;
	onSyncAnalytics: () => void;
}) {
	const status = normalizeUploadStatus(upload.status);
	const policyReport = analyzeYouTubePolicyRisk({
		title: upload.title,
		description: upload.description,
		scenes: [],
	});
	const criticalPolicyIssue = policyReport.issues.find(
		(issue) => issue.severity === "critical",
	);
	const visiblePolicyIssue = policyReport.issues.find(
		(issue) => issue.severity === "critical" || issue.severity === "warning",
	);
	const readiness = deriveUploadReadiness({
		upload,
		platform,
		connection: connections[platform],
		hasCriticalPolicyIssue: platform === "youtube" && Boolean(criticalPolicyIssue),
	});
	const activePlatformMeta = UPLOAD_PLATFORMS.find((item) => item.id === platform)!;
	const canSyncAnalytics = Boolean(upload.youtube_video_id);

	return (
		<article className="overflow-hidden rounded-[28px] border border-[#d8c9b5] bg-white shadow-[0_16px_50px_rgba(73,56,36,.08)]">
			<div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
				<div className="p-4 sm:p-5">
					<div className="flex items-start gap-3">
						<button
							type="button"
							onClick={onToggleSelected}
							className="mt-1 rounded-lg p-1 text-[#6f6254] transition hover:bg-[#f4eadb] hover:text-[#201811]"
							aria-label={selected ? "선택 해제" : "업로드 선택"}
						>
							{selected ? <CheckSquare size={19} /> : <Square size={19} />}
						</button>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-center gap-2">
								<PTag color={readinessColor(readiness.level)}>
									{readiness.label}
								</PTag>
								<ContentStatusBadge status={upload.status} />
								{busy && <PSpinner size="small" />}
								<PTag color="background-surface">{statusLabel(status)}</PTag>
							</div>
							<h2 className="mt-3 text-balance text-[24px] font-black leading-tight tracking-[-.035em] text-[#1f1a14]">
								{upload.title || "제목 없음"}
							</h2>
							<p className="mt-2 line-clamp-2 text-[13px] leading-6 text-[#74695c]">
								{upload.description || "설명이 없습니다. 업로드 전 설명을 보강하세요."}
							</p>
							<div className="mt-3 flex flex-wrap gap-1.5">
								{upload.tags?.slice(0, 8).map((tag) => (
									<span
										key={tag}
										className="rounded-full bg-[#f1e6d6] px-2.5 py-1 text-[11px] font-bold text-[#6a5742]"
									>
										#{tag}
									</span>
								))}
								{(upload.tags?.length ?? 0) > 8 && (
									<span className="rounded-full bg-[#f1e6d6] px-2.5 py-1 text-[11px] font-bold text-[#6a5742]">
										+{(upload.tags?.length ?? 0) - 8}
									</span>
								)}
							</div>
							<ThumbnailPreview upload={upload} />
						</div>
					</div>

					<div className="mt-5 grid gap-3 md:grid-cols-3">
						<InfoCell
							icon={<Clock size={14} />}
							label="생성"
							value={formatDate(upload.created_at)}
						/>
						<InfoCell
							icon={<Calendar size={14} />}
							label="예약"
							value={formatDate(upload.scheduled_at)}
						/>
						<InfoCell
							icon={<CheckCircle size={14} />}
							label="게시"
							value={formatDate(upload.published_at)}
						/>
					</div>

					<div className="mt-4 grid gap-2 sm:grid-cols-3">
						{UPLOAD_PLATFORMS.map((item) => {
							const id = platformVideoId(upload, item.id);
							return (
								<div
									key={item.id}
									className="rounded-2xl border border-[#eadfce] bg-[#fbf6ee] p-3"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="text-[11px] font-black uppercase tracking-[.14em] text-[#8a7e6f]">
											{item.label}
										</span>
										<span
											className="h-2 w-2 rounded-full"
											style={{
												backgroundColor: id ? item.accent : "#c9bdad",
											}}
										/>
									</div>
									<div className="mt-1 text-[12px] font-black text-[#30271d]">
										{id ? shortId(id) : "미게시"}
									</div>
								</div>
							);
						})}
					</div>

					{visiblePolicyIssue && (
						<PInlineNotification
							state={
								visiblePolicyIssue.severity === "critical" ? "error" : "warning"
							}
							className="mt-4"
							dismissButton={false}
						>
							<PText size="x-small" weight="semi-bold">
								YouTube 정책 체크
							</PText>
							<PText size="x-small" color="contrast-medium">
								{visiblePolicyIssue.message}
							</PText>
							{policyReport.requiredActions[0] && (
								<PText size="x-small" color="contrast-medium">
									{policyReport.requiredActions[0]}
								</PText>
							)}
						</PInlineNotification>
					)}

					{(readiness.blockers.length > 0 || readiness.warnings.length > 0) && (
						<div className="mt-4 rounded-2xl border border-[#eadfce] bg-[#fffaf2] p-3">
							<div className="mb-2 flex items-center gap-2 text-[12px] font-black text-[#4a3e30]">
								<ShieldCheck size={14} />
								업로드 준비도
							</div>
							{[...readiness.blockers, ...readiness.warnings].map((item) => (
								<div key={item} className="text-[12px] leading-5 text-[#766958]">
									- {item}
								</div>
							))}
						</div>
					)}
				</div>

				<aside className="border-t border-[#eadfce] bg-[#171411] p-4 text-[#fff9ed] lg:border-l lg:border-t-0">
					<div className="mb-4 flex items-center justify-between gap-3">
						<div>
							<div className="text-[10px] font-black uppercase tracking-[.18em] text-[#b9ad9c]">
								target platform
							</div>
							<div className="mt-1 text-[18px] font-black">
								{activePlatformMeta.label}
							</div>
						</div>
						<span
							className="h-10 w-10 rounded-2xl"
							style={{
								background: `radial-gradient(circle at 30% 30%, ${activePlatformMeta.accent}, #2a2218)`,
							}}
						/>
					</div>

					<div className="mb-4 grid grid-cols-3 gap-2">
						{UPLOAD_PLATFORMS.map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => onPlatformChange(item.id)}
								className={`rounded-2xl border px-3 py-2 text-[12px] font-black transition ${
									platform === item.id
										? "border-white/30 bg-white text-[#171411]"
										: "border-white/10 bg-white/8 text-[#d8cab8] hover:bg-white/15"
								}`}
							>
								{item.shortLabel}
							</button>
						))}
					</div>

					<div className="space-y-2">
						<PButton
							compact
							loading={busy}
							disabled={busy || !readiness.ok}
							onClick={onUpload}
						>
							<span className="inline-flex items-center gap-1">
								<Upload size={14} />
								{platformLabel(platform)} 업로드
							</span>
						</PButton>

						{status === "failed" && (
							<PButton compact variant="secondary" onClick={onRetry}>
								<span className="inline-flex items-center gap-1">
									<RotateCcw size={14} />
									재시도 대기열로
								</span>
							</PButton>
						)}

						{canSyncAnalytics && (
							<PButton compact variant="secondary" onClick={onSyncAnalytics}>
								<span className="inline-flex items-center gap-1">
									<BarChart3 size={14} />
									분석 동기화
								</span>
							</PButton>
						)}
					</div>

					<div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.06] p-3">
						<div className="mb-2 text-[11px] font-black uppercase tracking-[.16em] text-[#b9ad9c]">
							YouTube 예약
						</div>
						<input
							type="datetime-local"
							value={scheduledInput}
							min={new Date().toISOString().slice(0, 16)}
							onChange={(event) => onScheduleInput(event.target.value)}
							className="h-10 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-[13px] font-semibold text-[#fff9ed] outline-none focus:border-[#f0b957]"
						/>
						<PButton
							className="mt-2"
							variant="secondary"
							compact
							loading={scheduling}
							disabled={!scheduledInput || scheduling}
							onClick={onSchedule}
						>
							예약 저장
						</PButton>
					</div>

					{upload.youtube_video_id && (
						<a
							href={`https://youtu.be/${upload.youtube_video_id}`}
							target="_blank"
							rel="noopener noreferrer"
							className="mt-4 inline-flex items-center gap-1 text-[12px] font-bold text-[#f0b957] hover:text-[#ffd17a]"
						>
							<ExternalLink size={13} />
							YouTube 열기
						</a>
					)}
				</aside>
			</div>
		</article>
	);
}

function ThumbnailPreview({ upload }: { upload: UploadRow }) {
	const thumbnailPath = upload.thumbnail_path ?? "";
	const [preview, setPreview] = useState({ path: "", url: "" });
	const previewUrl = preview.path === thumbnailPath ? preview.url : "";
	const readiness = assessThumbnailReadiness({
		title: upload.title,
		description: upload.description,
		thumbnailPath,
		requirePlan: false,
	});

	useEffect(() => {
		let cancelled = false;
		if (!thumbnailPath) return;
		loadLocalFileUrl(thumbnailPath, "image/jpeg")
			.then((url) => {
				if (!cancelled) setPreview({ path: thumbnailPath, url: url ?? "" });
			})
			.catch(() => {
				if (!cancelled) setPreview({ path: thumbnailPath, url: "" });
			});
		return () => {
			cancelled = true;
		};
	}, [thumbnailPath]);

	return (
		<div className="mt-4 grid gap-3 rounded-2xl border border-[#eadfce] bg-[#fffaf2] p-3 md:grid-cols-[168px_1fr]">
			<div className="relative aspect-video overflow-hidden rounded-xl bg-[#211a13]">
				{previewUrl ? (
					<img
						src={previewUrl}
						alt=""
						className="h-full w-full object-cover"
						loading="lazy"
					/>
				) : (
					<div className="grid h-full place-items-center text-[#f0b957]">
						<ImageIcon size={28} />
					</div>
				)}
			</div>
			<div className="min-w-0">
				<div className="mb-1 flex flex-wrap items-center gap-2">
					<span className="text-[12px] font-black text-[#4a3e30]">
						썸네일 준비도
					</span>
					<PTag color={readinessColor(readiness.level)}>
						{readiness.score}점
					</PTag>
				</div>
				<p className="text-[12px] leading-5 text-[#766958]">
					{upload.thumbnail_path
						? "업로드 시 YouTube 커스텀 썸네일로 함께 전송됩니다."
						: "썸네일 파일이 없어 클릭 패키징이 약합니다."}
				</p>
				{readiness.requiredActions.slice(0, 2).map((action) => (
					<div key={action} className="mt-1 text-[12px] leading-5 text-[#8a5c24]">
						- {action}
					</div>
				))}
			</div>
		</div>
	);
}

function InfoCell({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="rounded-2xl bg-[#fbf6ee] p-3">
			<div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.14em] text-[#8a7e6f]">
				{icon}
				{label}
			</div>
			<div className="mt-1 text-[12px] font-black text-[#30271d]">{value}</div>
		</div>
	);
}
