import { PSpinner, PText } from "@porsche-design-system/components-react";

interface LoadingViewProps {
	message?: string;
	/** fullPage: min-height 64, inline: 최소 필요 높이만 */
	variant?: "fullPage" | "inline";
}

/**
 * 모든 페이지/섹션에서 공통으로 쓰는 로딩 뷰 — 높이·여백 일관화.
 */
export default function LoadingView({
	message,
	variant = "fullPage",
}: LoadingViewProps) {
	const height = variant === "fullPage" ? "h-64" : "py-static-lg";
	return (
		<div
			className={`flex flex-col items-center justify-center gap-static-sm ${height}`}
		>
			<PSpinner size="medium" />
			{message && (
				<PText size="small" color="contrast-medium">
					{message}
				</PText>
			)}
		</div>
	);
}
