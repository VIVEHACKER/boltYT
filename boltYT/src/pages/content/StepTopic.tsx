import {
	PButton,
	PHeading,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useState } from "react";
import { fetchTopicSuggestions } from "../../lib/ai";
import {
	attachNicheHandoffToTopic,
	formatCompactNumber,
	type NicheResearchHandoff,
} from "../../lib/niche-research";
import { supabase } from "../../lib/supabase";
import type { Channel } from "../../types/database";

interface StepTopicProps {
	channels: Channel[];
	selectedChannelId: string;
	onChannelChange: (id: string) => void;
	onNext: (topicId: string) => void;
	initialTitle?: string;
	source?: string;
	nicheHandoff?: NicheResearchHandoff | null;
}

export default function StepTopic({
	channels,
	selectedChannelId,
	onChannelChange,
	onNext,
	initialTitle = "",
	source = "manual",
	nicheHandoff,
}: StepTopicProps) {
	const [title, setTitle] = useState(initialTitle);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [loadingSuggestions, setLoadingSuggestions] = useState(false);
	const [suggestionsError, setSuggestionsError] = useState("");

	const loadSuggestions = useCallback(async (channelId: string) => {
		setLoadingSuggestions(true);
		setSuggestionsError("");
		setSuggestions([]);
		try {
			const result = await fetchTopicSuggestions(channelId);
			setSuggestions(result);
		} catch (err) {
			setSuggestionsError(
				err instanceof Error ? err.message : "추천 주제를 불러올 수 없습니다.",
			);
		} finally {
			setLoadingSuggestions(false);
		}
	}, []);

	useEffect(() => {
		if (!selectedChannelId) return;
		loadSuggestions(selectedChannelId);
	}, [selectedChannelId, loadSuggestions]);

	useEffect(() => {
		if (!initialTitle.trim()) return;
		setTitle((current) => current || initialTitle);
	}, [initialTitle]);

	async function handleSubmit() {
		if (!title.trim()) {
			setError("주제를 입력해주세요.");
			return;
		}
		setLoading(true);
		setError("");

		const { data, error: insertError } = await supabase
			.from("topics")
			.insert({
				channel_id: selectedChannelId,
				title: title.trim(),
				status: "active",
				source,
			})
			.select()
			.maybeSingle();

		if (insertError || !data) {
			setError(insertError?.message ?? "주제 저장에 실패했습니다.");
			setLoading(false);
			return;
		}

		if (nicheHandoff) {
			attachNicheHandoffToTopic(data.id, nicheHandoff.id);
		}

		onNext(data.id);
	}

	return (
		<div className="bg-surface rounded-[8px] p-static-lg">
			<PHeading size="medium" tag="h2" className="mb-static-md">
				1단계: 주제 입력
			</PHeading>

			<div className="flex flex-col gap-static-lg">
				<PSelect
					name="channel"
					label="채널 선택"
					value={selectedChannelId}
					onChange={(e) => onChannelChange(e.detail.value)}
				>
					{channels.map((ch) => (
						<PSelectOption key={ch.id} value={ch.id}>
							{ch.name}
						</PSelectOption>
					))}
				</PSelect>

				<PInputText
					name="topic"
					label="콘텐츠 주제"
					placeholder="예: AI가 바꿀 미래 직업 TOP 10"
					value={title}
					onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
					state={error ? "error" : "none"}
					message={error}
				/>

				{nicheHandoff && (
					<div className="rounded-[8px] bg-canvas p-static-md border border-contrast-low">
						<div className="flex items-center gap-static-sm mb-static-xs">
							<PTag color="notification-info-soft">니치 리서치 연결됨</PTag>
							<PText size="small" weight="semi-bold">
								{nicheHandoff.summary.query}
							</PText>
						</div>
						<PText size="small" color="contrast-medium">
							{nicheHandoff.playbook.headline}
						</PText>
						<div className="mt-static-sm flex flex-wrap gap-static-xs">
							<PTag color="background-surface">
								{nicheHandoff.playbook.score}점
							</PTag>
							{nicheHandoff.playbook.analysisQuality && (
								<PTag color="background-surface">
									신뢰도 {nicheHandoff.playbook.analysisQuality.score}점
								</PTag>
							)}
							<PTag color="background-surface">
								중앙 조회수{" "}
								{formatCompactNumber(nicheHandoff.summary.medianViews)}
							</PTag>
							<PTag color="background-surface">
								일평균{" "}
								{formatCompactNumber(nicheHandoff.summary.medianViewsPerDay)}/일
							</PTag>
						</div>
					</div>
				)}

				<div>
					<div className="flex items-center gap-static-sm mb-static-sm">
						<PText size="small" color="contrast-medium">
							AI 추천 주제
						</PText>
						<PTag color="background-frosted" icon="ai-spark">
							AI
						</PTag>
						{!loadingSuggestions && suggestions.length > 0 && (
							<button
								type="button"
								className="text-[12px] text-contrast-medium hover:text-primary transition-colors cursor-pointer underline"
								onClick={() => loadSuggestions(selectedChannelId)}
							>
								새로고침
							</button>
						)}
					</div>

					{loadingSuggestions && (
						<div className="flex items-center gap-static-sm py-static-sm">
							<PSpinner size="small" />
							<PText size="small" color="contrast-medium">
								채널에 맞는 주제를 추천 중...
							</PText>
						</div>
					)}

					{suggestionsError && (
						<PText size="small" color="notification-error">
							{suggestionsError}
						</PText>
					)}

					{!loadingSuggestions && suggestions.length > 0 && (
						<div className="flex flex-col gap-static-xs">
							{suggestions.map((topic) => (
								<button
									key={topic}
									type="button"
									className="px-static-md py-static-sm text-[14px] text-left rounded-[4px] bg-canvas text-primary border border-contrast-low hover:bg-contrast-low transition-colors cursor-pointer w-full"
									onClick={() => setTitle(topic)}
								>
									{topic}
								</button>
							))}
						</div>
					)}
				</div>

				<div className="flex justify-end">
					<PButton loading={loading} onClick={handleSubmit}>
						다음: 브리프 생성
					</PButton>
				</div>
			</div>
		</div>
	);
}
