import {
	PButton,
	PHeading,
	PText,
} from "@porsche-design-system/components-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { markOnboardingSeen, ONBOARDING_STEPS } from "../lib/onboarding";
import { queueTelemetry } from "../lib/telemetry-sink";

interface OnboardingBannerProps {
	/** 외부가 상태 소유 시: 사용자가 배너를 닫았을 때 콜백 */
	onDismiss?: () => void;
}

/**
 * 대시보드 상단 다단계 온보딩 배너.
 * - Step 네비게이션 (prev/next/skip)
 * - CTA 버튼 클릭 시 해당 경로로 이동하고 onboarding 완료 처리
 * - "건너뛰기" 도 완료 처리
 */
export default function OnboardingBanner({ onDismiss }: OnboardingBannerProps) {
	const navigate = useNavigate();
	const [stepIdx, setStepIdx] = useState(0);

	const step = ONBOARDING_STEPS[stepIdx];
	const isLast = stepIdx === ONBOARDING_STEPS.length - 1;
	const isFirst = stepIdx === 0;

	function complete(outcome: "skip" | "finish" | "cta") {
		markOnboardingSeen();
		queueTelemetry({
			service: "onboarding",
			level: "warn",
			message: `onboarding ${outcome} at step ${stepIdx + 1}/${ONBOARDING_STEPS.length}:${step.id}`,
		});
		onDismiss?.();
	}

	function handleCta() {
		if (step.cta) {
			complete("cta");
			navigate(step.cta.to);
		} else if (isLast) {
			complete("finish");
		} else {
			setStepIdx((i) => i + 1);
		}
	}

	return (
		<section
			className="bg-surface rounded-[8px] p-static-lg mb-fluid-md border border-contrast-low"
			aria-label="온보딩 안내"
		>
			<div className="flex items-start justify-between gap-static-md mb-static-sm">
				<div className="flex-1 min-w-0">
					<PText
						size="x-small"
						color="contrast-medium"
						className="mb-static-xs"
					>
						{stepIdx + 1} / {ONBOARDING_STEPS.length}
					</PText>
					<PHeading size="medium" tag="h2" className="mb-static-xs">
						{step.title}
					</PHeading>
					<PText color="contrast-medium">{step.description}</PText>
				</div>
				<PButton
					variant="tertiary"
					compact
					onClick={() => complete("skip")}
					aria-label="온보딩 건너뛰기"
				>
					건너뛰기
				</PButton>
			</div>

			{/* step progress dots */}
			<div className="flex gap-static-xs mb-static-md">
				{ONBOARDING_STEPS.map((s, i) => (
					<span
						key={s.id}
						className={`h-1 flex-1 rounded-full transition-colors ${
							i <= stepIdx ? "bg-primary" : "bg-contrast-low"
						}`}
					/>
				))}
			</div>

			<div className="flex justify-between gap-static-sm">
				<PButton
					variant="secondary"
					compact
					disabled={isFirst}
					onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
				>
					이전
				</PButton>
				<div className="flex gap-static-sm">
					{step.cta ? (
						<PButton compact onClick={handleCta}>
							{step.cta.label}
						</PButton>
					) : (
						<PButton compact onClick={handleCta}>
							{isLast ? "시작하기" : "다음"}
						</PButton>
					)}
					{!step.cta && !isLast && (
						<PButton
							variant="ghost"
							compact
							onClick={() => setStepIdx((i) => i + 1)}
						>
							다음
						</PButton>
					)}
				</div>
			</div>
		</section>
	);
}
