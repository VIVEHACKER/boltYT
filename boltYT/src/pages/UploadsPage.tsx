import {
	PButton,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import {
	AlertCircle,
	Calendar,
	CheckCircle,
	Clock,
	ExternalLink,
	MonitorPlay,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ContentStatusBadge from "../components/ContentStatusBadge";
import LicenseAuditPanel from "../components/LicenseAuditPanel";
import {
	checkInstagramServer,
	getIgAuthStatus,
	uploadToInstagram,
} from "../lib/instagram";
import type { MediaSource } from "../lib/media-license";
import { supabase } from "../lib/supabase";
import {
	checkTikTokServer,
	getTikTokAuthStatus,
	uploadToTikTok,
} from "../lib/tiktok";
import {
	checkYouTubeServer,
	getAuthStatus,
	getVideoAnalytics,
	uploadVideo,
} from "../lib/youtube";

type Platform = "youtube" | "tiktok" | "instagram";

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
}

interface UploadState {
	uploading: string | null;
	error: string | null;
	scheduling: string | null;
}

export default function UploadsPage() {
	const [uploads, setUploads] = useState<UploadRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [ytReady, setYtReady] = useState(false);
	const [ytChannel, setYtChannel] = useState<string | null>(null);
	const [tkReady, setTkReady] = useState(false);
	const [tkUser, setTkUser] = useState<string | null>(null);
	const [igReady, setIgReady] = useState(false);
	const [igUser, setIgUser] = useState<string | null>(null);
	const [selectedPlatforms, setSelectedPlatforms] = useState<
		Record<string, Platform>
	>({});
	const [state, setState] = useState<UploadState>({
		uploading: null,
		error: null,
		scheduling: null,
	});
	const [scheduledInputs, setScheduledInputs] = useState<
		Record<string, string>
	>({});

	const loadUploads = useCallback(async () => {
		const { data } = await supabase
			.from("uploads")
			.select("*")
			.order("created_at", { ascending: false });
		setUploads((data as UploadRow[]) ?? []);
		setLoading(false);
	}, []);

	useEffect(() => {
		loadUploads();

		checkYouTubeServer().then(async (health) => {
			if (health.ok && health.authenticated) {
				setYtReady(true);
				const status = await getAuthStatus();
				setYtChannel(status.channel?.title ?? null);
			}
		});
		checkTikTokServer().then(async (health) => {
			if (health.ok && health.authenticated) {
				setTkReady(true);
				const status = await getTikTokAuthStatus();
				setTkUser(status.user?.displayName ?? null);
			}
		});
		checkInstagramServer().then(async (health) => {
			if (health.ok && health.authenticated) {
				setIgReady(true);
				const status = await getIgAuthStatus();
				setIgUser(status.user?.username ?? null);
			}
		});
	}, [loadUploads]);

	async function handleUpload(upload: UploadRow) {
		if (!ytReady) {
			setState((s) => ({
				...s,
				error: "설정에서 YouTube 계정을 먼저 연결하세요.",
			}));
			return;
		}

		setState({ uploading: upload.id, error: null, scheduling: null });

		// 상태를 uploading으로 변경
		await supabase
			.from("uploads")
			.update({ status: "uploading" })
			.eq("id", upload.id);
		setUploads((prev) =>
			prev.map((u) => (u.id === upload.id ? { ...u, status: "uploading" } : u)),
		);

		try {
			// 렌더 파일 경로 조회: render-queue 서버에서 outputPath 우선, DB fallback
			let storagePath = "";

			try {
				const rqRes = await fetch(
					`http://localhost:3458/render/${upload.render_id}`,
				);
				if (rqRes.ok) {
					const rqData = await rqRes.json();
					storagePath = rqData.job?.outputPath ?? "";
				}
			} catch {
				// render-queue 서버 미실행 시 fallback
			}

			if (!storagePath) {
				const { data: render } = await supabase
					.from("renders")
					.select("storage_path")
					.eq("id", upload.render_id)
					.maybeSingle();
				storagePath = (render as { storage_path?: string })?.storage_path ?? "";
			}

			if (!storagePath) {
				throw new Error("렌더 파일 경로를 찾을 수 없습니다.");
			}

			const result = await uploadVideo({
				filePath: storagePath,
				title: upload.title,
				description: upload.description,
				tags: upload.tags,
				privacyStatus: upload.scheduled_at ? "private" : "public",
				scheduledAt: upload.scheduled_at ?? undefined,
			});

			// 성공: DB 업데이트 — 예약 업로드는 "scheduled" 상태
			const isScheduled = Boolean(upload.scheduled_at);
			const newStatus = isScheduled ? "scheduled" : "published";
			const updateFields: Record<string, unknown> = {
				status: newStatus,
				youtube_video_id: result.videoId,
			};
			if (!isScheduled) {
				updateFields.published_at = new Date().toISOString();
			}

			await supabase.from("uploads").update(updateFields).eq("id", upload.id);

			setUploads((prev) =>
				prev.map((u) =>
					u.id === upload.id
						? {
								...u,
								status: newStatus,
								youtube_video_id: result.videoId,
								published_at: isScheduled
									? u.published_at
									: new Date().toISOString(),
							}
						: u,
				),
			);

			setState({ uploading: null, error: null, scheduling: null });
		} catch (e) {
			const msg = e instanceof Error ? e.message : "업로드 실패";

			// 실패: 상태 복원
			await supabase
				.from("uploads")
				.update({ status: "failed" })
				.eq("id", upload.id);

			setUploads((prev) =>
				prev.map((u) => (u.id === upload.id ? { ...u, status: "failed" } : u)),
			);

			setState({ uploading: null, error: msg, scheduling: null });
		}
	}

	async function handleTikTokUpload(upload: UploadRow) {
		if (!tkReady) {
			setState((s) => ({
				...s,
				error: "설정에서 TikTok 계정을 먼저 연결하세요.",
			}));
			return;
		}
		setState({ uploading: upload.id, error: null, scheduling: null });
		await supabase
			.from("uploads")
			.update({ status: "uploading" })
			.eq("id", upload.id);
		setUploads((prev) =>
			prev.map((u) => (u.id === upload.id ? { ...u, status: "uploading" } : u)),
		);
		try {
			let storagePath = "";
			try {
				const rqRes = await fetch(
					`http://localhost:3458/render/${upload.render_id}`,
				);
				if (rqRes.ok) {
					const d = await rqRes.json();
					storagePath = d.job?.outputPath ?? "";
				}
			} catch {
				/* fallback */
			}
			if (!storagePath) {
				const { data: render } = await supabase
					.from("renders")
					.select("storage_path")
					.eq("id", upload.render_id)
					.maybeSingle();
				storagePath = (render as { storage_path?: string })?.storage_path ?? "";
			}
			if (!storagePath) throw new Error("렌더 파일 경로를 찾을 수 없습니다.");
			const result = await uploadToTikTok({
				filePath: storagePath,
				title: upload.title,
				privacyLevel: "PUBLIC_TO_EVERYONE",
			});
			await supabase
				.from("uploads")
				.update({
					status: "published",
					tiktok_video_id: result.publishId,
					published_at: new Date().toISOString(),
				})
				.eq("id", upload.id);
			setUploads((prev) =>
				prev.map((u) =>
					u.id === upload.id
						? {
								...u,
								status: "published",
								tiktok_video_id: result.publishId,
								published_at: new Date().toISOString(),
							}
						: u,
				),
			);
			setState({ uploading: null, error: null, scheduling: null });
		} catch (e) {
			const msg = e instanceof Error ? e.message : "TikTok 업로드 실패";
			await supabase
				.from("uploads")
				.update({ status: "failed" })
				.eq("id", upload.id);
			setUploads((prev) =>
				prev.map((u) => (u.id === upload.id ? { ...u, status: "failed" } : u)),
			);
			setState({ uploading: null, error: msg, scheduling: null });
		}
	}

	async function handleInstagramUpload(upload: UploadRow) {
		if (!igReady) {
			setState((s) => ({
				...s,
				error: "설정에서 Instagram 계정을 먼저 연결하세요.",
			}));
			return;
		}
		setState({ uploading: upload.id, error: null, scheduling: null });
		await supabase
			.from("uploads")
			.update({ status: "uploading" })
			.eq("id", upload.id);
		setUploads((prev) =>
			prev.map((u) => (u.id === upload.id ? { ...u, status: "uploading" } : u)),
		);
		try {
			const { data: render } = await supabase
				.from("renders")
				.select("storage_path, public_url")
				.eq("id", upload.render_id)
				.maybeSingle();
			const videoUrl = (render as { public_url?: string })?.public_url ?? "";
			if (!videoUrl)
				throw new Error(
					"Instagram은 공개 URL이 필요합니다. Supabase Storage 공개 URL을 설정하세요.",
				);
			const result = await uploadToInstagram({
				videoUrl,
				caption: `${upload.title}\n\n${upload.tags?.map((t) => `#${t}`).join(" ")}`,
			});
			await supabase
				.from("uploads")
				.update({
					status: "published",
					instagram_media_id: result.mediaId,
					published_at: new Date().toISOString(),
				})
				.eq("id", upload.id);
			setUploads((prev) =>
				prev.map((u) =>
					u.id === upload.id
						? {
								...u,
								status: "published",
								instagram_media_id: result.mediaId,
								published_at: new Date().toISOString(),
							}
						: u,
				),
			);
			setState({ uploading: null, error: null, scheduling: null });
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Instagram 업로드 실패";
			await supabase
				.from("uploads")
				.update({ status: "failed" })
				.eq("id", upload.id);
			setUploads((prev) =>
				prev.map((u) => (u.id === upload.id ? { ...u, status: "failed" } : u)),
			);
			setState({ uploading: null, error: msg, scheduling: null });
		}
	}

	async function handleRetry(upload: UploadRow) {
		await supabase
			.from("uploads")
			.update({ status: "queued" })
			.eq("id", upload.id);

		setUploads((prev) =>
			prev.map((u) => (u.id === upload.id ? { ...u, status: "queued" } : u)),
		);
	}

	async function handleSchedule(upload: UploadRow) {
		const dateStr = scheduledInputs[upload.id];
		if (!dateStr) return;

		setState((s) => ({ ...s, scheduling: upload.id }));

		const scheduledAt = new Date(dateStr).toISOString();

		await supabase
			.from("uploads")
			.update({ scheduled_at: scheduledAt })
			.eq("id", upload.id);

		setUploads((prev) =>
			prev.map((u) =>
				u.id === upload.id ? { ...u, scheduled_at: scheduledAt } : u,
			),
		);

		setState((s) => ({ ...s, scheduling: null }));
	}

	async function handleSyncAnalytics(upload: UploadRow) {
		if (!upload.youtube_video_id) return;

		try {
			const analytics = await getVideoAnalytics(upload.youtube_video_id);

			await supabase.from("analytics").insert({
				upload_id: upload.id,
				views: analytics.views,
				likes: analytics.likes,
				comments: analytics.comments,
				ctr: 0,
				avg_watch_duration: 0,
				subscribers_gained: 0,
			});
		} catch {
			// 분석 싱크 실패는 무시
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	return (
		<div className="max-w-4xl">
			<div className="mb-fluid-md">
				<PHeading size="x-large" tag="h1">
					업로드 관리
				</PHeading>
				<div className="flex items-center gap-static-sm mt-static-xs flex-wrap">
					<PText color="contrast-medium">
						승인된 콘텐츠의 업로드 상태를 관리하세요.
					</PText>
					{ytReady ? (
						<PTag color="notification-success-soft">
							<span className="flex items-center gap-1">
								<MonitorPlay size={12} />
								YT: {ytChannel ?? "연결됨"}
							</span>
						</PTag>
					) : (
						<PTag color="notification-warning-soft">YouTube 미연결</PTag>
					)}
					{tkReady ? (
						<PTag color="notification-success-soft">
							TikTok: {tkUser ?? "연결됨"}
						</PTag>
					) : (
						<PTag color="notification-warning-soft">TikTok 미연결</PTag>
					)}
					{igReady ? (
						<PTag color="notification-success-soft">
							IG: @{igUser ?? "연결됨"}
						</PTag>
					) : (
						<PTag color="notification-warning-soft">Instagram 미연결</PTag>
					)}
				</div>
			</div>

			{/* YouTube 업로드 = 상업/공개 배포 — 사용 소스의 라이선스를 감사 */}
			<LicenseAuditPanel
				sources={Array.from(
					new Set<MediaSource>(
						uploads.flatMap(
							() => ["pexels", "pixabay", "dalle"] as MediaSource[],
						),
					),
				)}
				usage="commercial"
				className="mb-fluid-md"
			/>

			{state.error && (
				<PInlineNotification
					state="error"
					className="mb-static-md"
					dismissButton={true}
					onDismiss={() => setState((s) => ({ ...s, error: null }))}
				>
					{state.error}
				</PInlineNotification>
			)}

			{uploads.length === 0 ? (
				<div className="bg-surface rounded-[8px] p-fluid-lg text-center">
					<div className="flex justify-center mb-static-md">
						<Upload size={48} className="text-contrast-medium" />
					</div>
					<PHeading size="small" tag="h2">
						대기 중인 업로드가 없습니다
					</PHeading>
					<PText color="contrast-medium" className="mt-static-sm">
						콘텐츠�� 생성하고 승인하면 여기에 나타납니다.
					</PText>
				</div>
			) : (
				<div className="flex flex-col gap-static-md">
					{uploads.map((upload) => (
						<div
							key={upload.id}
							className="bg-surface rounded-[8px] p-static-lg"
						>
							<div className="flex items-start justify-between">
								<div className="flex-1 min-w-0">
									{/* 제목 + 상태 */}
									<div className="flex items-center gap-static-sm mb-static-xs">
										<PText weight="semi-bold">
											{upload.title || "제목 없음"}
										</PText>
										<ContentStatusBadge status={upload.status} />
										{upload.status === "uploading" && <PSpinner size="small" />}
									</div>

									{/* 태��� */}
									<div className="flex gap-static-xs flex-wrap mb-static-sm">
										{upload.tags?.map((tag) => (
											<PTag key={tag} color="background-surface">
												{tag}
											</PTag>
										))}
									</div>

									{/* 날짜 정보 */}
									<div className="flex items-center gap-static-md">
										<PText size="x-small" color="contrast-medium">
											<span className="flex items-center gap-1">
												<Clock size={12} />
												{new Date(upload.created_at).toLocaleString("ko-KR")}
											</span>
										</PText>
										{upload.scheduled_at && (
											<PText size="x-small" color="contrast-medium">
												<span className="flex items-center gap-1">
													<Calendar size={12} />
													예약:{" "}
													{new Date(upload.scheduled_at).toLocaleString(
														"ko-KR",
													)}
												</span>
											</PText>
										)}
									</div>

									{/* YouTube 링크 */}
									{upload.youtube_video_id && (
										<div className="mt-static-sm">
											<a
												href={`https://youtu.be/${upload.youtube_video_id}`}
												target="_blank"
												rel="noopener noreferrer"
												className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
											>
												<ExternalLink size={14} />
												youtu.be/{upload.youtube_video_id}
											</a>
										</div>
									)}
								</div>

								{/* 액션 버튼 */}
								<div className="shrink-0 ml-static-md flex flex-col gap-static-xs">
									{/* 대기 중 → 플랫폼 선택 + 업로드 + 예약 */}
									{upload.status === "queued" && (
										<>
											<div className="flex gap-static-xs mb-static-xs">
												{(["youtube", "tiktok", "instagram"] as Platform[]).map(
													(p) => (
														<PButton
															key={p}
															variant={
																(selectedPlatforms[upload.id] ?? "youtube") ===
																p
																	? "primary"
																	: "secondary"
															}
															compact
															onClick={() =>
																setSelectedPlatforms((prev) => ({
																	...prev,
																	[upload.id]: p,
																}))
															}
														>
															{p === "youtube"
																? "YT"
																: p === "tiktok"
																	? "TK"
																	: "IG"}
														</PButton>
													),
												)}
											</div>
											<PButton
												compact
												loading={state.uploading === upload.id}
												onClick={() => {
													const p = selectedPlatforms[upload.id] ?? "youtube";
													if (p === "youtube") return handleUpload(upload);
													if (p === "tiktok") return handleTikTokUpload(upload);
													return handleInstagramUpload(upload);
												}}
											>
												<span className="flex items-center gap-1">
													<Upload size={14} />
													업로드
												</span>
											</PButton>
											<div className="flex flex-col gap-static-xs">
												<input
													type="datetime-local"
													value={scheduledInputs[upload.id] ?? ""}
													min={new Date().toISOString().slice(0, 16)}
													onChange={(e) =>
														setScheduledInputs((prev) => ({
															...prev,
															[upload.id]: e.target.value,
														}))
													}
													className="text-[12px] px-2 py-1 rounded border border-contrast-low bg-canvas focus:border-primary outline-none"
												/>
												<PButton
													variant="secondary"
													compact
													disabled={!scheduledInputs[upload.id]}
													onClick={() => handleSchedule(upload)}
												>
													<span className="flex items-center gap-1">
														<Calendar size={14} />
														예약 확정
													</span>
												</PButton>
											</div>
										</>
									)}

									{/* 실패 → 재시도 */}
									{upload.status === "failed" && (
										<PButton compact onClick={() => handleRetry(upload)}>
											<span className="flex items-center gap-1">
												<AlertCircle size={14} />
												재시도
											</span>
										</PButton>
									)}

									{/* 게시 완료 → 링크 + 분석 싱크 */}
									{upload.status === "published" && (
										<div className="flex flex-col items-end gap-static-xs">
											<PTag color="notification-success-soft">
												<span className="flex items-center gap-1">
													<CheckCircle size={12} />
													게시 완료
												</span>
											</PTag>
											{upload.youtube_video_id && (
												<>
													<a
														href={`https://youtu.be/${upload.youtube_video_id}`}
														target="_blank"
														rel="noopener noreferrer"
														className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
													>
														<ExternalLink size={12} />
														YouTube
													</a>
													<PButton
														variant="tertiary"
														compact
														onClick={() => handleSyncAnalytics(upload)}
													>
														분석 동기화
													</PButton>
												</>
											)}
											{upload.tiktok_video_id && (
												<PTag color="notification-success-soft">
													<span className="flex items-center gap-1">
														<CheckCircle size={12} />
														TikTok 게시됨
													</span>
												</PTag>
											)}
											{upload.instagram_media_id && (
												<PTag color="notification-success-soft">
													<span className="flex items-center gap-1">
														<CheckCircle size={12} />
														Instagram 게시됨
													</span>
												</PTag>
											)}
										</div>
									)}
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
