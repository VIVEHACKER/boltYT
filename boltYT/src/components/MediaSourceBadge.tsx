import { PTag } from "@porsche-design-system/components-react";
import { licenseOf, type MediaSource } from "../lib/media-license";

interface MediaSourceBadgeProps {
	source: MediaSource;
	showLicense?: boolean;
}

const COLOR_BY_RISK: Record<
	string,
	| "background-frosted"
	| "notification-success-soft"
	| "notification-warning-soft"
	| "notification-error-soft"
> = {
	yes: "notification-success-soft",
	"with-license": "notification-warning-soft",
	no: "notification-error-soft",
};

/**
 * 미디어 소스와 재배포 허용 여부를 색 코딩으로 보여주는 배지.
 * 목록/상세 UI에 간단히 삽입.
 */
export default function MediaSourceBadge({
	source,
	showLicense,
}: MediaSourceBadgeProps) {
	const p = licenseOf(source);
	const color = COLOR_BY_RISK[p.allowsRedistribution] ?? "background-frosted";
	const label = showLicense ? `${p.label} · ${p.licenseName}` : p.label;
	return (
		<PTag color={color} title={p.warning ?? p.licenseName}>
			{label}
		</PTag>
	);
}
