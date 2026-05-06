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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	buildDeterministicTopicSuggestions,
	fetchTopicSuggestions,
} from "../../lib/ai";
import { type ApiKeysStatus, useApiKeys } from "../../lib/api-keys-context";
import {
	buildContentRecommendationPlan,
	type ContentPerformanceSample,
} from "../../lib/content-recommendation-ranker";
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
	onNext: (topicId: string, topicTitle: string) => void;
	initialTitle?: string;
	source?: string;
	nicheHandoff?: NicheResearchHandoff | null;
	performanceHistory?: ContentPerformanceSample[];
}

function hasUnrecoveredOpenAiQuota(status: ApiKeysStatus) {
	const runtime = status.openaiRuntime;
	if (!runtime?.lastQuotaAt) return false;
	const quotaAt = Date.parse(runtime.lastQuotaAt);
	const okAt = runtime.lastOkAt ? Date.parse(runtime.lastOkAt) : 0;
	return Number.isFinite(quotaAt) && quotaAt > (Number.isFinite(okAt) ? okAt : 0);
}

export default function StepTopic({
	channels,
	selectedChannelId,
	onChannelChange,
	onNext,
	initialTitle = "",
	source = "manual",
	nicheHandoff,
	performanceHistory = [],
}: StepTopicProps) {
	const [title, setTitle] = useState(initialTitle);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [loadingSuggestions, setLoadingSuggestions] = useState(false);
	const [suggestionsError, setSuggestionsError] = useState("");
	const [suggestionsMode, setSuggestionsMode] = useState<"ai" | "rules">("ai");
	const { status: apiStatus, loaded: apiStatusLoaded } = useApiKeys();
	const suggestionRequestId = useRef(0);
	const recommendationPlan = useMemo(
		() =>
			buildContentRecommendationPlan({
				topicTitle: title,
				nicheHandoff,
				performanceHistory,
			}),
		[title, nicheHandoff, performanceHistory],
	);

	const loadSuggestions = useCallback(
		async (channelId: string, seedTopic = "") => {
			const requestId = suggestionRequestId.current + 1;
			suggestionRequestId.current = requestId;
			const isCurrentRequest = () => suggestionRequestId.current === requestId;
			const selectedChannel =
				channels.find((channel) => channel.id === channelId) ?? null;
			const fallback = () =>
				buildDeterministicTopicSuggestions(
					selectedChannel
						? {
								name: selectedChannel.name,
								category: String(selectedChannel.category ?? ""),
								description: String(selectedChannel.description ?? ""),
							}
						: null,
					seedTopic,
					);
			const applyFallback = (message: string) => {
				if (!isCurrentRequest()) return;
				setSuggestionsMode("rules");
				setSuggestions(fallback());
				setSuggestionsError(message);
			};

			setLoadingSuggestions(true);
			setSuggestionsError("");
			setSuggestions([]);
			try {
				if (!apiStatus.openai) {
					applyFallback("OpenAI 키가 없어 룰 기반 추천을 사용합니다.");
					return;
				}
				if (
					apiStatus.openaiRuntime?.quotaBlocked ||
					hasUnrecoveredOpenAiQuota(apiStatus)
				) {
					applyFallback("OpenAI 쿼터 대기 중이라 룰 기반 추천을 사용합니다.");
					return;
				}
				const result = await fetchTopicSuggestions(channelId, seedTopic);
				if (!isCurrentRequest()) return;
				setSuggestionsMode("ai");
				setSuggestions(result);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : "추천 주제를 불러올 수 없습니다.";
				if (/429|quota|쿼터|OpenAI API 오류/i.test(message)) {
					applyFallback("AI 추천이 제한되어 룰 기반 추천으로 전환했습니다.");
				} else if (isCurrentRequest()) {
					setSuggestionsError(message);
				}
			} finally {
				if (isCurrentRequest()) setLoadingSuggestions(false);
			}
		},
		[apiStatus, channels],
	);

	useEffect(() => {
		if (!selectedChannelId || !apiStatusLoaded) return;
		loadSuggestions(selectedChannelId, initialTitle);
	}, [selectedChannelId, initialTitle, apiStatusLoaded, loadSuggestions]);

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

		onNext(data.id, title.trim());
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

				{title.trim().length > 0 && (
					<div className="rounded-[12px] bg-[#f7f3ea] border border-[#d8c8aa] p-static-md">
						<div className="flex items-center justify-between gap-static-sm mb-static-sm">
							<div>
								<PText size="small" weight="semi-bold">
									이 주제로 추천되는 대본 방향
								</PText>
								<PText size="x-small" color="contrast-medium">
									카테고리 {recommendationPlan.categoryLabel} · 신뢰도{" "}
									{recommendationPlan.confidence}
									{recommendationPlan.performanceFeedback.sampleCount > 0
										? ` · 성과 ${recommendationPlan.performanceFeedback.sampleCount}개 반영`
										: ""}
								</PText>
							</div>
							<PTag color="notification-info-soft">순위화</PTag>
						</div>
						<div className="grid grid-cols-1 md:grid-cols-3 gap-static-sm">
							{recommendationPlan.scripts.slice(0, 3).map((script) => (
								<div
									key={script.id}
									className="rounded-[10px] bg-[#fffaf0] border border-[#ead9bd] p-static-sm"
								>
									<div className="flex items-center justify-between mb-1">
										<PText size="x-small" weight="semi-bold">
											#{script.rank} {script.title}
										</PText>
										<PTag color="background-surface">{script.score}점</PTag>
									</div>
									<PText size="x-small" color="contrast-medium">
										{script.hook}
									</PText>
								</div>
							))}
						</div>
					</div>
				)}

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
							{suggestionsMode === "ai" ? "AI" : "룰 기반"}
						</PTag>
						{!loadingSuggestions && suggestions.length > 0 && (
							<button
								type="button"
								className="text-[12px] text-contrast-medium hover:text-primary transition-colors cursor-pointer underline"
								onClick={() => loadSuggestions(selectedChannelId, title)}
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
						<PText
							size="small"
							color={
								suggestionsMode === "rules"
									? "contrast-medium"
									: "notification-error"
							}
						>
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
