import {
	PButton,
	PHeading,
	PText,
} from "@porsche-design-system/components-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
	icon?: ReactNode;
	title: string;
	description?: string;
	primaryAction?: { label: string; onClick: () => void; icon?: string };
	secondaryAction?: { label: string; onClick: () => void };
	className?: string;
}

/**
 * 재사용 가능한 빈 상태 — 목록/검색 결과/필터 비었을 때.
 * Porsche 디자인 토큰 준수 (DESIGN.md): bg-surface, rounded 8px, border만.
 */
export default function EmptyState({
	icon,
	title,
	description,
	primaryAction,
	secondaryAction,
	className,
}: EmptyStateProps) {
	return (
		<div
			className={`bg-surface rounded-[8px] p-fluid-lg text-center flex flex-col items-center gap-static-sm ${className ?? ""}`}
		>
			{icon && (
				<div className="text-contrast-medium opacity-80 mb-static-xs">
					{icon}
				</div>
			)}
			<PHeading size="medium" tag="h3">
				{title}
			</PHeading>
			{description && (
				<PText color="contrast-medium" align="center" className="max-w-md">
					{description}
				</PText>
			)}
			{(primaryAction || secondaryAction) && (
				<div className="flex gap-static-sm mt-static-md flex-wrap justify-center">
					{primaryAction && (
						<PButton
							onClick={primaryAction.onClick}
							icon={primaryAction.icon as never}
						>
							{primaryAction.label}
						</PButton>
					)}
					{secondaryAction && (
						<PButton variant="secondary" onClick={secondaryAction.onClick}>
							{secondaryAction.label}
						</PButton>
					)}
				</div>
			)}
		</div>
	);
}
