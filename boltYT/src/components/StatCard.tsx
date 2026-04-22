import { PHeading, PText } from "@porsche-design-system/components-react";
import type { ReactNode } from "react";

interface StatCardProps {
	label: string;
	value: string | number;
	icon: ReactNode;
	trend?: string;
}

export default function StatCard({ label, value, icon, trend }: StatCardProps) {
	return (
		<div className="bg-surface rounded-[8px] p-static-lg flex items-start gap-static-md">
			<div className="w-10 h-10 rounded-[4px] bg-canvas flex items-center justify-center shrink-0">
				{icon}
			</div>
			<div className="flex-1 min-w-0">
				<PText size="small" color="contrast-medium">
					{label}
				</PText>
				<PHeading size="medium" tag="h3">
					{String(value)}
				</PHeading>
				{trend && (
					<PText size="x-small" color="notification-success">
						{trend}
					</PText>
				)}
			</div>
		</div>
	);
}
