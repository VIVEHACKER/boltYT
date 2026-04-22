import {
	PHeading,
	PInlineNotification,
	PText,
} from "@porsche-design-system/components-react";
import {
	auditSources,
	type MediaSource,
	type UsageKind,
} from "../lib/media-license";
import MediaSourceBadge from "./MediaSourceBadge";

interface LicenseAuditPanelProps {
	sources: MediaSource[];
	usage: UsageKind;
	className?: string;
}

/**
 * 업로드 전/공개 전 라이선스 감사 패널.
 * blockers 있으면 경고 notification. attribution 필요 소스는 목록에 표시.
 */
export default function LicenseAuditPanel({
	sources,
	usage,
	className,
}: LicenseAuditPanelProps) {
	const { blockers, warnings, attributions } = auditSources(sources, usage);
	const unique = Array.from(new Set(sources));

	if (sources.length === 0) return null;

	return (
		<section
			className={`bg-surface rounded-[8px] p-static-lg ${className ?? ""}`}
		>
			<PHeading size="small" tag="h3" className="mb-static-sm">
				라이선스 감사 ({usage === "commercial" ? "상업 사용" : "개인 사용"})
			</PHeading>
			<div className="flex flex-wrap gap-static-xs mb-static-sm">
				{unique.map((s) => (
					<MediaSourceBadge key={s} source={s} showLicense />
				))}
			</div>

			{blockers.length > 0 && (
				<PInlineNotification
					state="error"
					heading={`${blockers.length}개 블로커 — 공개 업로드 금지`}
					dismissButton={false}
					className="mt-static-sm"
				>
					<ul className="list-disc pl-static-md">
						{blockers.map((b) => (
							<li key={b}>
								<PText size="small">{b}</PText>
							</li>
						))}
					</ul>
				</PInlineNotification>
			)}

			{warnings.length > 0 && (
				<PInlineNotification
					state="warning"
					heading="주의"
					dismissButton={false}
					className="mt-static-sm"
				>
					<ul className="list-disc pl-static-md">
						{warnings.map((w) => (
							<li key={w}>
								<PText size="small">{w}</PText>
							</li>
						))}
					</ul>
				</PInlineNotification>
			)}

			{attributions.length > 0 && (
				<PText size="x-small" color="contrast-medium" className="mt-static-sm">
					필수 출처 표기: {attributions.join(", ")} (렌더 시 자막/크레딧에 자동
					삽입)
				</PText>
			)}
		</section>
	);
}
