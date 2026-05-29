import { PText } from "@porsche-design-system/components-react";

interface StepIndicatorProps {
	steps: string[];
	currentStep: number;
}

export default function StepIndicator({
	steps,
	currentStep,
}: StepIndicatorProps) {
	return (
		<div
			aria-label="콘텐츠 생성 단계"
			className="-mx-static-xs flex items-center gap-static-xs overflow-x-auto px-static-xs pb-static-xs"
		>
			{steps.map((label, i) => (
				<div key={label} className="flex shrink-0 items-center gap-static-xs">
					<div className="flex items-center gap-static-xs rounded-full bg-canvas px-static-xs py-[3px]">
						<div
							aria-current={i === currentStep ? "step" : undefined}
							className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 ${
								i <= currentStep
									? "bg-primary text-[#fff]"
									: "bg-contrast-low text-contrast-high"
							}`}
						>
							{i + 1}
						</div>
						<PText
							size="x-small"
							weight={i === currentStep ? "semi-bold" : "regular"}
							color={i <= currentStep ? "primary" : "contrast-medium"}
							className="whitespace-nowrap"
						>
							{label}
						</PText>
					</div>
					{i < steps.length - 1 && (
						<div
							className={`h-[2px] w-4 shrink-0 sm:w-6 ${
								i < currentStep ? "bg-primary" : "bg-contrast-low"
							}`}
						/>
					)}
				</div>
			))}
		</div>
	);
}
