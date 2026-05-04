/**
 * YouTube API 클라이언트 — 로컬 서버(3457)와 통신
 */

function getYtServer() {
	if (typeof localStorage !== "undefined") {
		return (
			localStorage.getItem("youtube_server_url") ?? "http://localhost:3457"
		);
	}
	return "http://localhost:3457";
}

interface HealthResponse {
	ok: boolean;
	configured: boolean;
	authenticated: boolean;
}

interface AuthStatus {
	authenticated: boolean;
	expired?: boolean;
	channel?: {
		id: string;
		title: string;
		thumbnail: string;
	} | null;
}

interface UploadResult {
	ok: boolean;
	videoId: string;
	url: string;
	thumbnailSet?: boolean;
	thumbnailError?: string;
}

interface AnalyticsResult {
	videoId: string;
	title: string;
	views: number;
	likes: number;
	comments: number;
	favorites: number;
}

export interface DeepAnalyticsResult extends AnalyticsResult {
	estimatedMinutesWatched?: number;
	averageViewDuration?: number;
	averageViewPercentage?: number;
	subscribersGained?: number;
	subscribersLost?: number;
	shares?: number;
	impressions?: number | null;
	impressionCtr?: number | null;
	trafficSources?: Array<{
		source: string;
		views: number;
		estimatedMinutesWatched?: number;
		averageViewDuration?: number;
	}>;
	retentionCurve?: Array<{
		elapsedVideoTimeRatio: number;
		audienceWatchRatio: number;
		relativeRetentionPerformance?: number | null;
	}>;
	dailyRows?: Array<{
		day: string;
		views: number;
		estimatedMinutesWatched?: number;
		averageViewDuration?: number;
		averageViewPercentage?: number;
		subscribersGained?: number;
		subscribersLost?: number;
		likes?: number;
		comments?: number;
		shares?: number;
	}>;
	warnings?: string[];
}

export interface VideoCommentThread {
	id: string;
	videoId: string;
	author: string;
	text: string;
	likeCount: number;
	publishedAt: string;
	updatedAt?: string;
	replyCount?: number;
}

interface ChannelVideo {
	videoId: string;
	title: string;
	thumbnail: string;
	publishedAt: string;
}

async function fetchYT<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${getYtServer()}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});

	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
	}

	return res.json() as Promise<T>;
}

/** 서버 상태 확인 */
export async function checkYouTubeServer(): Promise<HealthResponse> {
	try {
		return await fetchYT<HealthResponse>("/health");
	} catch {
		return { ok: false, configured: false, authenticated: false };
	}
}

/** OAuth 인증 URL 가져오기 */
export async function getAuthUrl(): Promise<string> {
	const { url } = await fetchYT<{ url: string }>("/auth/url");
	return url;
}

/** 인증 상태 확인 */
export async function getAuthStatus(): Promise<AuthStatus> {
	return fetchYT<AuthStatus>("/auth/status");
}

/** YouTube 연동 해제 */
export async function revokeAuth(): Promise<void> {
	await fetchYT("/auth/revoke", { method: "POST" });
}

/** OAuth 팝업 열기 — 인증 완료 시 resolve */
export async function openAuthPopup(): Promise<boolean> {
	try {
		const url = await getAuthUrl();
		return new Promise<boolean>((resolve) => {
			const popup = window.open(url, "youtube-auth", "width=600,height=700");

			const handleMessage = (event: MessageEvent) => {
				if (
					event.origin === window.location.origin &&
					event.data?.type === "youtube-auth-success"
				) {
					window.removeEventListener("message", handleMessage);
					resolve(true);
				}
			};

			window.addEventListener("message", handleMessage);

			// 팝업이 닫히면 체크
			const interval = setInterval(() => {
				if (popup?.closed) {
					clearInterval(interval);
					window.removeEventListener("message", handleMessage);
					// 팝업 닫힌 후 상태 확인
					getAuthStatus().then((status) => resolve(status.authenticated));
				}
			}, 500);
		});
	} catch {
		return false;
	}
}

/** 영상 업로드 */
export async function uploadVideo(params: {
	filePath: string;
	title: string;
	description: string;
	tags: string[];
	thumbnailDataUrl?: string;
	privacyStatus?: "public" | "unlisted" | "private";
	scheduledAt?: string;
}): Promise<UploadResult> {
	return fetchYT<UploadResult>("/upload", {
		method: "POST",
		body: JSON.stringify({
			filePath: params.filePath,
			title: params.title,
			description: params.description,
			tags: params.tags.join(","),
			thumbnailDataUrl: params.thumbnailDataUrl,
			privacyStatus: params.privacyStatus ?? "private",
			scheduledAt: params.scheduledAt,
		}),
	});
}

/** 예약 발행 설정 */
export async function scheduleVideo(
	videoId: string,
	scheduledAt: string,
): Promise<void> {
	await fetchYT("/upload/schedule", {
		method: "POST",
		body: JSON.stringify({ videoId, scheduledAt }),
	});
}

/** 분석 데이터 조회 */
export async function getVideoAnalytics(
	videoId: string,
): Promise<AnalyticsResult> {
	return fetchYT<AnalyticsResult>(`/analytics/${videoId}`);
}

/** 심화 분석 데이터 조회 — Analytics API 권한이 없으면 서버가 기본 통계와 warnings를 반환 */
export async function getDeepVideoAnalytics(
	videoId: string,
	days = 28,
): Promise<DeepAnalyticsResult> {
	return fetchYT<DeepAnalyticsResult>(`/analytics/deep/${videoId}?days=${days}`);
}

/** 영상 댓글/반응 조회 */
export async function getVideoComments(
	videoId: string,
	maxResults = 100,
): Promise<{ videoId: string; comments: VideoCommentThread[]; warnings?: string[] }> {
	return fetchYT<{ videoId: string; comments: VideoCommentThread[]; warnings?: string[] }>(
		`/comments/${videoId}?maxResults=${maxResults}`,
	);
}

/** 채널 영상 목록 */
export async function getChannelVideos(): Promise<ChannelVideo[]> {
	const { videos } = await fetchYT<{ videos: ChannelVideo[] }>("/videos");
	return videos;
}
