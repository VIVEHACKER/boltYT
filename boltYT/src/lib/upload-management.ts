import { assessThumbnailReadiness } from "./thumbnail-intelligence";

export type UploadPlatform = "youtube" | "tiktok" | "instagram";

export type UploadStatusKind =
	| "queued"
	| "uploading"
	| "scheduled"
	| "published"
	| "failed"
	| "unknown";

export interface UploadListItem {
	id: string;
	title?: string | null;
	description?: string | null;
	status?: string | null;
	tags?: string[] | null;
	render_id?: string | null;
	youtube_video_id?: string | null;
	tiktok_video_id?: string | null;
	instagram_media_id?: string | null;
	thumbnail_path?: string | null;
	scheduled_at?: string | null;
	published_at?: string | null;
	created_at?: string | null;
}

export interface PlatformConnection {
	ready: boolean;
	accountLabel?: string | null;
}

export type PlatformConnections = Record<UploadPlatform, PlatformConnection>;

export interface UploadSummary {
	total: number;
	queued: number;
	uploading: number;
	scheduled: number;
	published: number;
	failed: number;
	overdue: number;
	readyToUpload: number;
}

export interface UploadReadiness {
	ok: boolean;
	level: "ready" | "warning" | "blocked";
	label: string;
	blockers: string[];
	warnings: string[];
}

export const UPLOAD_PLATFORMS: Array<{
	id: UploadPlatform;
	label: string;
	shortLabel: string;
	accent: string;
}> = [
	{ id: "youtube", label: "YouTube", shortLabel: "YT", accent: "#ff5b5b" },
	{ id: "tiktok", label: "TikTok", shortLabel: "TK", accent: "#5eead4" },
	{ id: "instagram", label: "Instagram", shortLabel: "IG", accent: "#f0abfc" },
];

export function normalizeUploadStatus(status?: string | null): UploadStatusKind {
	if (status === "queued") return "queued";
	if (status === "uploading") return "uploading";
	if (status === "scheduled") return "scheduled";
	if (status === "published") return "published";
	if (status === "failed") return "failed";
	return "unknown";
}

export function platformVideoId(
	upload: UploadListItem,
	platform: UploadPlatform,
): string {
	if (platform === "youtube") return upload.youtube_video_id ?? "";
	if (platform === "tiktok") return upload.tiktok_video_id ?? "";
	return upload.instagram_media_id ?? "";
}

export function hasPublishedToPlatform(
	upload: UploadListItem,
	platform: UploadPlatform,
): boolean {
	return Boolean(platformVideoId(upload, platform));
}

export function isScheduledInPast(
	upload: UploadListItem,
	now = new Date(),
): boolean {
	if (!upload.scheduled_at) return false;
	const scheduledAt = new Date(upload.scheduled_at).getTime();
	return Number.isFinite(scheduledAt) && scheduledAt < now.getTime();
}

export function summarizeUploads(
	uploads: UploadListItem[],
	now = new Date(),
): UploadSummary {
	const summary: UploadSummary = {
		total: uploads.length,
		queued: 0,
		uploading: 0,
		scheduled: 0,
		published: 0,
		failed: 0,
		overdue: 0,
		readyToUpload: 0,
	};

	for (const upload of uploads) {
		const status = normalizeUploadStatus(upload.status);
		if (status === "queued") summary.queued += 1;
		if (status === "uploading") summary.uploading += 1;
		if (status === "scheduled") summary.scheduled += 1;
		if (status === "published") summary.published += 1;
		if (status === "failed") summary.failed += 1;
		if (isScheduledInPast(upload, now) && status !== "published") {
			summary.overdue += 1;
		}
		if (status === "queued" || status === "failed") summary.readyToUpload += 1;
	}

	return summary;
}

export function deriveUploadReadiness(params: {
	upload: UploadListItem;
	platform: UploadPlatform;
	connection: PlatformConnection;
	hasCriticalPolicyIssue?: boolean;
	now?: Date;
}): UploadReadiness {
	const { upload, platform, connection, hasCriticalPolicyIssue = false } = params;
	const now = params.now ?? new Date();
	const status = normalizeUploadStatus(upload.status);
	const blockers: string[] = [];
	const warnings: string[] = [];

	if (!connection.ready) {
		blockers.push(`${platformLabel(platform)} 계정 또는 서버가 연결되지 않았습니다.`);
	}
	if (!upload.title?.trim()) {
		blockers.push("업로드 제목이 없습니다.");
	}
	if (status === "uploading") {
		blockers.push("이미 업로드가 진행 중입니다.");
	}
	if (status === "published" && hasPublishedToPlatform(upload, platform)) {
		blockers.push(`${platformLabel(platform)}에 이미 게시된 항목입니다.`);
	}
	if (platform === "youtube" && hasCriticalPolicyIssue) {
		blockers.push("YouTube 정책 리스크가 critical이라 업로드를 차단했습니다.");
	}
	if (status === "scheduled" && platform !== "youtube") {
		warnings.push("예약 업로드는 현재 YouTube 중심으로 처리됩니다.");
	}
	if (isScheduledInPast(upload, now) && status !== "published") {
		warnings.push("예약 시간이 이미 지났습니다. 시간을 갱신하거나 즉시 업로드하세요.");
	}
	if (!upload.description?.trim()) {
		warnings.push("설명이 비어 있어 검색/노출 품질이 낮아질 수 있습니다.");
	}
	if (platform === "youtube") {
		const thumbnailReadiness = assessThumbnailReadiness({
			title: upload.title,
			description: upload.description,
			thumbnailPath: upload.thumbnail_path,
			requirePlan: false,
		});
		warnings.push(...thumbnailReadiness.warnings.slice(0, 2));
	}

	if (blockers.length > 0) {
		return {
			ok: false,
			level: "blocked",
			label: "업로드 차단",
			blockers,
			warnings,
		};
	}
	if (warnings.length > 0) {
		return {
			ok: true,
			level: "warning",
			label: "주의 후 업로드",
			blockers,
			warnings,
		};
	}
	return {
		ok: true,
		level: "ready",
		label: "업로드 가능",
		blockers,
		warnings,
	};
}

export function platformLabel(platform: UploadPlatform): string {
	return UPLOAD_PLATFORMS.find((item) => item.id === platform)?.label ?? platform;
}
