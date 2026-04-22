import { PTag } from "@porsche-design-system/components-react";

const statusConfig: Record<
	string,
	{
		color:
			| "background-surface"
			| "notification-success-soft"
			| "notification-warning-soft"
			| "notification-error-soft"
			| "notification-info-soft";
		label: string;
	}
> = {
	draft: { color: "background-surface", label: "초안" },
	approved: { color: "notification-success-soft", label: "승인됨" },
	rejected: { color: "notification-error-soft", label: "반려됨" },
	pending: { color: "notification-warning-soft", label: "대기 중" },
	rendering: { color: "notification-info-soft", label: "렌더링 중" },
	complete: { color: "notification-success-soft", label: "완료" },
	failed: { color: "notification-error-soft", label: "실패" },
	queued: { color: "notification-warning-soft", label: "대기열" },
	uploading: { color: "notification-info-soft", label: "업로드 중" },
	published: { color: "notification-success-soft", label: "게시됨" },
};

export default function ContentStatusBadge({ status }: { status: string }) {
	const config = statusConfig[status] ?? {
		color: "background-surface" as const,
		label: status,
	};
	return <PTag color={config.color}>{config.label}</PTag>;
}
