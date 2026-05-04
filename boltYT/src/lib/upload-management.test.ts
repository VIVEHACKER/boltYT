import { describe, expect, it } from "vitest";
import {
	deriveUploadReadiness,
	hasPublishedToPlatform,
	normalizeUploadStatus,
	summarizeUploads,
} from "./upload-management";

describe("upload-management", () => {
	it("업로드 상태를 안전한 운영 상태로 정규화", () => {
		expect(normalizeUploadStatus("queued")).toBe("queued");
		expect(normalizeUploadStatus("published")).toBe("published");
		expect(normalizeUploadStatus("archived")).toBe("unknown");
		expect(normalizeUploadStatus(null)).toBe("unknown");
	});

	it("대기열 요약과 지난 예약을 계산", () => {
		const now = new Date("2026-05-04T12:00:00.000Z");
		const summary = summarizeUploads(
			[
				{ id: "1", status: "queued", scheduled_at: "2026-05-04T11:00:00.000Z" },
				{ id: "2", status: "failed" },
				{ id: "3", status: "published", scheduled_at: "2026-05-04T10:00:00.000Z" },
				{ id: "4", status: "uploading" },
			],
			now,
		);

		expect(summary).toMatchObject({
			total: 4,
			queued: 1,
			failed: 1,
			published: 1,
			uploading: 1,
			overdue: 1,
			readyToUpload: 2,
		});
	});

	it("플랫폼별 게시 여부를 분리", () => {
		const upload = {
			id: "1",
			status: "published",
			youtube_video_id: "yt-1",
			tiktok_video_id: null,
			instagram_media_id: "ig-1",
		};

		expect(hasPublishedToPlatform(upload, "youtube")).toBe(true);
		expect(hasPublishedToPlatform(upload, "tiktok")).toBe(false);
		expect(hasPublishedToPlatform(upload, "instagram")).toBe(true);
	});

	it("연결/정책/메타데이터 기준으로 업로드 준비도를 차단", () => {
		const readiness = deriveUploadReadiness({
			upload: { id: "1", title: "", status: "queued" },
			platform: "youtube",
			connection: { ready: false },
			hasCriticalPolicyIssue: true,
		});

		expect(readiness.ok).toBe(false);
		expect(readiness.level).toBe("blocked");
		expect(readiness.blockers).toHaveLength(3);
	});

	it("설명 누락은 차단이 아니라 주의로 분류", () => {
		const readiness = deriveUploadReadiness({
			upload: { id: "1", title: "업로드 제목", status: "queued", description: "" },
			platform: "youtube",
			connection: { ready: true },
		});

		expect(readiness.ok).toBe(true);
		expect(readiness.level).toBe("warning");
		expect(readiness.warnings[0]).toContain("설명");
	});

	it("YouTube 업로드는 썸네일 파일 누락을 준비도 경고로 표시", () => {
		const readiness = deriveUploadReadiness({
			upload: {
				id: "1",
				title: "업로드 제목",
				status: "queued",
				description: "자료 기반 설명입니다.",
			},
			platform: "youtube",
			connection: { ready: true },
		});

		expect(readiness.level).toBe("warning");
		expect(readiness.warnings.join(" ")).toContain("썸네일");
	});
});
