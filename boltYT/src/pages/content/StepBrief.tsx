import {
	PButton,
	PHeading,
	PInlineNotification,
	PInputText,
	PSpinner,
	PTag,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useState } from "react";
import { generateBrief } from "../../lib/ai";
import { supabase } from "../../lib/supabase";

interface StepBriefProps {
	topicId: string;
	onNext: (briefId: string) => void;
	onBack: () => void;
}

export default function StepBrief({ topicId, onNext, onBack }: StepBriefProps) {
	const [coreMessage, setCoreMessage] = useState("");
	const [targetAudience, setTargetAudience] = useState("");
	const [cautions, setCautions] = useState("");
	const [shortsHooks, setShortsHooks] = useState("");
	const [longformOutline, setLongformOutline] = useState("");
	const [loading, setLoading] = useState(false);
	const [generating, setGenerating] = useState(true);
	const [topicTitle, setTopicTitle] = useState("");
	const [genError, setGenError] = useState("");
	const [submitError, setSubmitError] = useState("");

	const doBriefGeneration = useCallback(async () => {
		setGenerating(true);
		setGenError("");
		try {
			const brief = await generateBrief(topicId);
			setCoreMessage(brief.core_message);
			setTargetAudience(brief.target_audience);
			setCautions(brief.cautions);
			setShortsHooks(brief.shorts_hooks.join("\n"));
			setLongformOutline(brief.longform_outline.join("\n"));
		} catch (err) {
			setGenError(
				err instanceof Error ? err.message : "브리프 생성에 실패했습니다.",
			);
		} finally {
			setGenerating(false);
		}
	}, [topicId]);

	useEffect(() => {
		async function loadAndGenerate() {
			const { data } = await supabase
				.from("topics")
				.select("title")
				.eq("id", topicId)
				.maybeSingle();

			const title = data?.title ?? "";
			setTopicTitle(title);
			await doBriefGeneration();
		}
		void loadAndGenerate();
	}, [topicId, doBriefGeneration]);

	async function handleSubmit() {
		setLoading(true);
		setSubmitError("");

		const { data, error } = await supabase
			.from("briefs")
			.insert({
				topic_id: topicId,
				core_message: coreMessage,
				target_audience: targetAudience,
				cautions,
				shorts_hooks: shortsHooks.split("\n").filter(Boolean),
				longform_outline: longformOutline
					.split("\n")
					.filter(Boolean)
					.map((item, i) => ({
						order: i,
						text: item,
					})),
			})
			.select()
			.maybeSingle();

		if (error || !data) {
			setSubmitError(
				error?.message ?? "브리프 저장에 실패했습니다. 다시 시도해주세요.",
			);
			setLoading(false);
			return;
		}

		onNext(data.id);
	}

	if (generating) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg text-center py-fluid-lg">
				<PSpinner size="medium" />
				<PText className="mt-static-md" color="contrast-medium">
					"{topicTitle}" 브리프를 AI가 생성 중입니다...
				</PText>
				<PText size="x-small" color="contrast-medium" className="mt-static-xs">
					채널 정보를 분석하여 최적의 콘텐츠 브리프를 작성합니다
				</PText>
			</div>
		);
	}

	if (genError) {
		return (
			<div className="bg-surface rounded-[8px] p-static-lg">
				<PInlineNotification
					heading="브리프 생성 실패"
					description={genError}
					state="error"
					dismissButton={false}
				/>
				<div className="flex gap-static-sm mt-static-lg">
					<PButton variant="secondary" onClick={onBack}>
						이전
					</PButton>
					<PButton onClick={() => doBriefGeneration()}>다시 시도</PButton>
				</div>
			</div>
		);
	}

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<div className="flex items-center gap-static-sm mb-static-sm">
				<PHeading size="medium" tag="h2">
					2단계: 콘텐츠 브리프
				</PHeading>
				<PTag color="background-frosted" icon="ai-spark">
					AI 생성
				</PTag>
			</div>
			<PText size="small" color="contrast-medium" className="mb-static-lg">
				AI가 생성한 브리프를 검토하고 필요시 수정하세요.
			</PText>

			<div className="flex flex-col gap-static-lg">
				<PTextarea
					name="coreMessage"
					label="핵심 메시지"
					value={coreMessage}
					rows={3}
					onInput={(e) =>
						setCoreMessage((e.target as HTMLTextAreaElement).value)
					}
				/>

				<PInputText
					name="targetAudience"
					label="타겟 시청자"
					value={targetAudience}
					onInput={(e) =>
						setTargetAudience((e.target as HTMLInputElement).value)
					}
				/>

				<PTextarea
					name="cautions"
					label="주의사항"
					value={cautions}
					rows={2}
					onInput={(e) => setCautions((e.target as HTMLTextAreaElement).value)}
				/>

				<PTextarea
					name="shortsHooks"
					label="쇼츠용 훅 (줄바꿈으로 구분)"
					value={shortsHooks}
					rows={3}
					onInput={(e) =>
						setShortsHooks((e.target as HTMLTextAreaElement).value)
					}
				/>

				<PTextarea
					name="longformOutline"
					label="롱폼 목차 (줄바꿈으로 구분)"
					value={longformOutline}
					rows={6}
					onInput={(e) =>
						setLongformOutline((e.target as HTMLTextAreaElement).value)
					}
				/>

				{submitError && (
					<PInlineNotification
						state="error"
						heading="저장 실패"
						description={submitError}
						dismissButton={false}
					/>
				)}

				<div className="flex justify-between">
					<PButton variant="secondary" onClick={onBack}>
						이전
					</PButton>
					<div className="flex gap-static-sm">
						<PButton
							variant="secondary"
							icon="ai-spark"
							onClick={() => doBriefGeneration()}
						>
							다시 생성
						</PButton>
						<PButton loading={loading} onClick={handleSubmit}>
							다음: 스크립트 생성
						</PButton>
					</div>
				</div>
			</div>
		</div>
	);
}
