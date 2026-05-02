import {
	PButton,
	PHeading,
	PInlineNotification,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PTag,
	PText,
	PTextarea,
} from "@porsche-design-system/components-react";
import {
	AlertTriangle,
	Check,
	Clipboard,
	FilePlus,
	ExternalLink,
	Gauge,
	History,
	Radar,
	RefreshCw,
	Search,
	ScanSearch,
	ShieldCheck,
	TrendingUp,
	Tv,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatCard from "../components/StatCard";
import {
	analyzeNicheResearch,
	assessNicheAnalysisQuality,
	buildNichePlaybook,
	fetchNicheFormatAnalysis,
	fetchNicheResearch,
	findRecentNicheResearchSnapshot,
	formatCompactNumber,
	formatDuration,
	loadNicheResearchHistory,
	persistNicheResearchHandoff,
	persistNicheResearchSnapshot,
	type NicheAnalysisQuality,
	type NicheAnalysisQualityFactor,
	type NicheCandidateSummary,
	type NicheFormatAnalysis,
	type NichePlaybook,
	type NicheResearchOptions,
	type NicheResearchSnapshot,
} from "../lib/niche-research";

const DEFAULT_QUERIES = [
	"미스터리 역사 다큐",
	"AI 비즈니스 자동화",
	"부자 심리 돈 공부",
].join("\n");

function parseQueries(value: string): string[] {
	return [
		...new Set(
			value
				.split(/\n|,/)
				.map((query) => query.trim())
				.filter(Boolean),
		),
	].slice(0, 8);
}

function numericOption(value: string, fallback: number, min: number, max: number) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

function scoreTone(score: number) {
	if (score >= 72) return "notification-success-soft";
	if (score >= 55) return "notification-warning-soft";
	return "notification-error-soft";
}

function qualityTone(score: number) {
	if (score >= 75) return "notification-success-soft";
	if (score >= 55) return "notification-warning-soft";
	return "notification-error-soft";
}

function snapshotBestScore(snapshot: NicheResearchSnapshot) {
	return snapshot.summaries.reduce(
		(max, summary) => Math.max(max, summary.score),
		0,
	);
}

export default function NicheResearchPage() {
	const navigate = useNavigate();
	const [queriesInput, setQueriesInput] = useState(DEFAULT_QUERIES);
	const [maxResultsInput, setMaxResultsInput] = useState("12");
	const [daysBackInput, setDaysBackInput] = useState("365");
	const [order, setOrder] = useState<NicheResearchOptions["order"]>("viewCount");
	const [summaries, setSummaries] = useState<NicheCandidateSummary[]>([]);
	const [formatAnalyses, setFormatAnalyses] = useState<
		Record<string, NicheFormatAnalysis>
	>({});
	const [formatLoadingQuery, setFormatLoadingQuery] = useState("");
	const [loadingQuery, setLoadingQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [formatError, setFormatError] = useState<string | null>(null);
	const [history, setHistory] = useState<NicheResearchSnapshot[]>([]);
	const [activeSnapshotId, setActiveSnapshotId] = useState("");
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		setHistory(loadNicheResearchHistory());
	}, []);

	const sortedSummaries = useMemo(
		() => [...summaries].sort((a, b) => b.score - a.score),
		[summaries],
	);
	const best = sortedSummaries[0];
	const avgScore = sortedSummaries.length
		? Math.round(
				sortedSummaries.reduce((sum, item) => sum + item.score, 0) /
					sortedSummaries.length,
			)
		: 0;
	const totalSamples = sortedSummaries.reduce(
		(sum, item) => sum + item.sampleSize,
		0,
	);
	const topVelocity = sortedSummaries.reduce(
		(max, item) => Math.max(max, item.medianViewsPerDay),
		0,
	);

	async function handleAnalyze(ignoreCache = false) {
		const queries = parseQueries(queriesInput);
		if (queries.length === 0) {
			setError("분석할 니치 후보를 입력하세요.");
			return;
		}

		setError(null);
		setFormatError(null);
		setNotice(null);
		setSummaries([]);
		setFormatAnalyses({});
		setActiveSnapshotId("");
		const options: NicheResearchOptions = {
			maxResults: numericOption(maxResultsInput, 12, 5, 25),
			daysBack: numericOption(daysBackInput, 365, 7, 3650),
			order,
		};
		const cached = ignoreCache
			? null
			: findRecentNicheResearchSnapshot(queries, options);
		if (cached) {
			hydrateSnapshot(cached);
			setNotice(
				"최근 6시간 안에 같은 조건으로 저장된 분석을 불러왔습니다.",
			);
			return;
		}

		try {
			const nextSummaries: NicheCandidateSummary[] = [];
			for (const query of queries) {
				setLoadingQuery(query);
				const result = await fetchNicheResearch(query, options);
				const summary = analyzeNicheResearch(result);
				nextSummaries.push(summary);
				setSummaries((prev) => [...prev, summary]);
			}
			const snapshot = persistNicheResearchSnapshot({
				queries,
				options,
				summaries: nextSummaries,
				formatAnalyses: {},
			});
			setActiveSnapshotId(snapshot.id);
			setHistory(loadNicheResearchHistory());
			setNotice("분석 결과를 히스토리에 저장했습니다.");
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "니치 리서치 데이터를 불러오지 못했습니다.",
			);
		} finally {
			setLoadingQuery("");
		}
	}

	function applyPreset(value: string) {
		setQueriesInput(value);
	}

	function hydrateSnapshot(snapshot: NicheResearchSnapshot) {
		setQueriesInput(snapshot.queries.join("\n"));
		setMaxResultsInput(String(snapshot.options.maxResults));
		setDaysBackInput(String(snapshot.options.daysBack));
		setOrder(snapshot.options.order);
		setSummaries(snapshot.summaries);
		setFormatAnalyses(snapshot.formatAnalyses);
		setActiveSnapshotId(snapshot.id);
	}

	async function handleAnalyzeFormat(summary: NicheCandidateSummary) {
		setFormatError(null);
		setFormatLoadingQuery(summary.query);
		try {
			const analysis = await fetchNicheFormatAnalysis({
				query: summary.query,
				sampleSeconds: 90,
				videos: summary.topVideos.slice(0, 3).map((video) => ({
					videoId: video.videoId,
					title: video.title,
					durationSeconds: video.durationSeconds,
					viewCount: video.viewCount,
				})),
			});
			const nextAnalyses = { ...formatAnalyses, [summary.query]: analysis };
			setFormatAnalyses(nextAnalyses);
			if (activeSnapshotId) {
				persistNicheResearchSnapshot({
					id: activeSnapshotId,
					createdAt:
						history.find((snapshot) => snapshot.id === activeSnapshotId)
							?.createdAt ?? new Date().toISOString(),
					queries: parseQueries(queriesInput),
					options: {
						maxResults: numericOption(maxResultsInput, 12, 5, 25),
						daysBack: numericOption(daysBackInput, 365, 7, 3650),
						order,
					},
					summaries,
					formatAnalyses: nextAnalyses,
				});
				setHistory(loadNicheResearchHistory());
			}
		} catch (err) {
			setFormatError(
				err instanceof Error
					? err.message
					: "포맷 법칙 분석을 완료하지 못했습니다.",
			);
		} finally {
			setFormatLoadingQuery("");
		}
	}

	function handleCreatePilotTopic(
		topic: string,
		summary: NicheCandidateSummary,
		playbook: NichePlaybook,
		formatAnalysis?: NicheFormatAnalysis,
	) {
		const handoff = persistNicheResearchHandoff({
			topic,
			sourceSnapshotId: activeSnapshotId || undefined,
			summary,
			playbook,
			formatAnalysis,
		});
		const params = new URLSearchParams({
			mode: "research",
			source: "niche_research",
			title: topic,
			nicheHandoff: handoff.id,
		});
		navigate(`/content/new?${params.toString()}`);
	}

	return (
		<div className="max-w-6xl">
			<div className="mb-fluid-md flex flex-col gap-static-sm">
				<div className="flex items-center gap-static-sm">
					<Radar size={28} />
					<PHeading size="x-large" tag="h1">
						니치 리서치
					</PHeading>
				</div>
				<PText color="contrast-medium">
					YouTube 공개 데이터를 기준으로 롱폼 후보 니치의 성과 신호를
					비교합니다.
				</PText>
			</div>

			<div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-static-lg">
				<section className="bg-surface rounded-[8px] p-static-lg h-fit">
					<PHeading size="small" tag="h2" className="mb-static-md">
						후보 입력
					</PHeading>

					<div className="flex flex-col gap-static-md">
						<PTextarea
							name="queries"
							label="니치 후보"
							value={queriesInput}
							rows={7}
							onInput={(e) =>
								setQueriesInput((e.target as HTMLTextAreaElement).value)
							}
						/>

						<div className="grid grid-cols-2 gap-static-sm">
							<PInputText
								name="maxResults"
								label="후보당 영상 수"
								value={maxResultsInput}
								onInput={(e) =>
									setMaxResultsInput((e.target as HTMLInputElement).value)
								}
							/>
							<PInputText
								name="daysBack"
								label="최근 일수"
								value={daysBackInput}
								onInput={(e) =>
									setDaysBackInput((e.target as HTMLInputElement).value)
								}
							/>
						</div>

						<PSelect
							name="order"
							label="정렬 기준"
							value={order}
							onUpdate={(e) =>
								setOrder(
									String(e.detail.value ?? "viewCount") as NicheResearchOptions["order"],
								)
							}
						>
							<PSelectOption value="viewCount">조회수 우선</PSelectOption>
							<PSelectOption value="date">최신 우선</PSelectOption>
							<PSelectOption value="relevance">관련도 우선</PSelectOption>
						</PSelect>

						<div className="flex flex-wrap gap-static-xs">
							<PButton
								variant="ghost"
								compact
								onClick={() =>
									applyPreset(
										[
											"미스터리 역사 다큐",
											"세계사 전쟁 이야기",
											"실화 범죄 다큐",
										].join("\n"),
									)
								}
							>
								다큐
							</PButton>
							<PButton
								variant="ghost"
								compact
								onClick={() =>
									applyPreset(
										[
											"AI 비즈니스 자동화",
											"1인 창업 자동화",
											"유튜브 자동화 수익",
										].join("\n"),
									)
								}
							>
								자동화
							</PButton>
							<PButton
								variant="ghost"
								compact
								onClick={() =>
									applyPreset(
										[
											"부자 심리 돈 공부",
											"투자 실수 사례",
											"경제 위기 해설",
										].join("\n"),
									)
								}
							>
								머니
							</PButton>
						</div>

						<PButton
							icon="search"
							onClick={() => handleAnalyze(false)}
							disabled={Boolean(loadingQuery)}
						>
							{loadingQuery ? "분석 중" : "분석 실행"}
						</PButton>
						<PButton
							variant="secondary"
							compact
							onClick={() => handleAnalyze(true)}
							disabled={Boolean(loadingQuery)}
						>
							<span className="inline-flex items-center gap-static-xs">
								<RefreshCw size={14} />
								캐시 무시 재분석
							</span>
						</PButton>

						{history.length > 0 && (
							<div className="rounded-[8px] bg-canvas p-static-sm">
								<div className="flex items-center gap-static-xs mb-static-xs">
									<History size={16} />
									<PText size="small" weight="semi-bold">
										최근 분석
									</PText>
								</div>
								<div className="flex flex-col gap-static-xs">
									{history.slice(0, 5).map((snapshot) => (
										<button
											type="button"
											key={snapshot.id}
											className="rounded-[4px] border border-contrast-low bg-surface px-static-sm py-static-xs text-left hover:bg-contrast-low transition-colors cursor-pointer"
											onClick={() => {
												hydrateSnapshot(snapshot);
												setNotice("저장된 분석을 불러왔습니다.");
											}}
										>
											<span className="block text-[12px] font-semibold text-primary truncate">
												{snapshot.queries.join(", ")}
											</span>
											<span className="block text-[11px] text-contrast-medium">
												{new Date(snapshot.createdAt).toLocaleString("ko-KR")} ·{" "}
												최고 {snapshotBestScore(snapshot)}점
											</span>
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				</section>

				<section className="flex flex-col gap-static-lg min-w-0">
					{error && (
						<PInlineNotification
							state="error"
							heading="분석 실패"
							description={error}
							dismissButton={false}
						/>
					)}

					{formatError && (
						<PInlineNotification
							state="error"
							heading="포맷 분석 실패"
							description={formatError}
							dismissButton={false}
						/>
					)}

					{notice && (
						<PInlineNotification
							state="info"
							heading="니치 리서치 저장소"
							description={notice}
							onDismiss={() => setNotice(null)}
						/>
					)}

					{loadingQuery && (
						<div className="bg-surface rounded-[8px] p-static-lg flex items-center gap-static-md">
							<PSpinner size="small" />
							<PText>
								{loadingQuery} 데이터를 수집하는 중입니다.
							</PText>
						</div>
					)}

					<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-static-md">
						<StatCard
							label="최고 후보"
							value={best?.query ?? "--"}
							icon={<TrendingUp size={20} />}
							trend={best ? `${best.score}점` : undefined}
						/>
						<StatCard
							label="평균 점수"
							value={sortedSummaries.length ? `${avgScore}점` : "--"}
							icon={<Gauge size={20} />}
						/>
						<StatCard
							label="분석 영상"
							value={totalSamples ? totalSamples.toLocaleString() : "--"}
							icon={<Tv size={20} />}
						/>
						<StatCard
							label="최고 조회 속도"
							value={
								topVelocity ? `${formatCompactNumber(topVelocity)}/일` : "--"
							}
							icon={<Search size={20} />}
						/>
					</div>

					{sortedSummaries.length === 0 && !loadingQuery ? (
						<div className="bg-surface rounded-[8px] p-fluid-lg text-center">
							<div className="flex justify-center mb-static-md">
								<Radar size={44} className="text-contrast-medium" />
							</div>
							<PHeading size="small" tag="h2">
								아직 분석 결과가 없습니다
							</PHeading>
							<PText color="contrast-medium" className="mt-static-sm">
								후보 니치를 입력하고 분석을 실행하세요.
							</PText>
						</div>
					) : (
						<div className="flex flex-col gap-static-md">
							{sortedSummaries.map((summary) => (
								<NicheSummaryCard
									key={summary.query}
									summary={summary}
									formatAnalysis={formatAnalyses[summary.query]}
									formatLoading={formatLoadingQuery === summary.query}
									onAnalyzeFormat={() => handleAnalyzeFormat(summary)}
									onCreatePilotTopic={handleCreatePilotTopic}
								/>
							))}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}

function NicheSummaryCard({
	summary,
	formatAnalysis,
	formatLoading,
	onAnalyzeFormat,
	onCreatePilotTopic,
}: {
	summary: NicheCandidateSummary;
	formatAnalysis?: NicheFormatAnalysis;
	formatLoading: boolean;
	onAnalyzeFormat: () => void;
	onCreatePilotTopic: (
		topic: string,
		summary: NicheCandidateSummary,
		playbook: NichePlaybook,
		formatAnalysis?: NicheFormatAnalysis,
	) => void;
}) {
	const [copied, setCopied] = useState(false);
	const playbook = useMemo(
		() => buildNichePlaybook(summary, formatAnalysis),
		[summary, formatAnalysis],
	);
	const analysisQuality = useMemo(
		() => assessNicheAnalysisQuality(summary, formatAnalysis),
		[summary, formatAnalysis],
	);

	async function handleCopyPlaybook() {
		await navigator.clipboard.writeText(playbook.prompt);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	}

	return (
		<article className="bg-surface rounded-[8px] p-static-lg min-w-0">
			<div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-static-md mb-static-lg">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-static-sm">
						<PHeading size="medium" tag="h2">
							{summary.query}
						</PHeading>
						<PTag color={scoreTone(summary.score)}>{summary.score}점</PTag>
						<PTag color={qualityTone(analysisQuality.score)}>
							신뢰도 {analysisQuality.score}점
						</PTag>
					</div>
					<PText size="small" color="contrast-medium" className="mt-static-xs">
						표본 {summary.sampleSize}개 · 채널 {summary.uniqueChannelCount}개 ·
						롱폼 {Math.round(summary.longformShare * 100)}%
					</PText>
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-5 gap-static-sm lg:min-w-[620px]">
					<MiniMetric
						label="분석 신뢰도"
						value={`${analysisQuality.score}점`}
					/>
					<MiniMetric
						label="중앙 조회수"
						value={formatCompactNumber(summary.medianViews)}
					/>
					<MiniMetric
						label="일평균 조회"
						value={`${formatCompactNumber(summary.medianViewsPerDay)}/일`}
					/>
					<MiniMetric
						label="중앙 길이"
						value={formatDuration(summary.medianDurationSeconds)}
					/>
					<MiniMetric
						label="구독자 비공개"
						value={`${Math.round(summary.hiddenSubscriberShare * 100)}%`}
					/>
				</div>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-static-md mb-static-lg">
				<FlagList title="강한 신호" flags={summary.greenFlags} positive />
				<FlagList title="주의 신호" flags={summary.redFlags} />
			</div>

			<AnalysisQualityPanel quality={analysisQuality} />

			<div className="rounded-[8px] bg-canvas p-static-md mb-static-lg">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-static-sm">
					<div className="flex items-center gap-static-sm">
						<ScanSearch size={18} />
						<div>
							<PText weight="semi-bold">포맷 법칙</PText>
							<PText size="x-small" color="contrast-medium">
								상위 3개 영상의 앞 90초 훅, 컷 밀도, 제목 회수율을 봅니다.
							</PText>
						</div>
					</div>
					<PButton
						variant="secondary"
						compact
						onClick={onAnalyzeFormat}
						disabled={formatLoading || summary.topVideos.length === 0}
					>
						{formatLoading ? "분석 중" : "법칙 분석"}
					</PButton>
				</div>

				{formatLoading && (
					<div className="mt-static-md flex items-center gap-static-sm">
						<PSpinner size="small" />
						<PText size="small" color="contrast-medium">
							상위 영상 앞부분을 내려받아 컷과 자막을 분석 중입니다.
						</PText>
					</div>
				)}

				{formatAnalysis && <FormatAnalysisPanel analysis={formatAnalysis} />}
			</div>

			<PlaybookPanel
				playbook={playbook}
				copied={copied}
				onCopy={handleCopyPlaybook}
				onCreatePilotTopic={(topic) =>
					onCreatePilotTopic(topic, summary, playbook, formatAnalysis)
				}
			/>

			<div className="flex flex-col gap-static-sm">
				{summary.topVideos.map((video) => (
					<a
						key={video.videoId}
						href={`https://www.youtube.com/watch?v=${video.videoId}`}
						target="_blank"
						rel="noreferrer"
						className="group grid grid-cols-[96px_1fr] sm:grid-cols-[132px_1fr_auto] gap-static-sm items-center p-static-sm rounded-[8px] no-underline text-primary hover:bg-canvas"
					>
						<img
							src={video.thumbnail}
							alt=""
							className="w-full aspect-video object-cover rounded-[4px] bg-canvas"
							loading="lazy"
						/>
						<div className="min-w-0">
							<PText weight="semi-bold" className="line-clamp-2">
								{video.title}
							</PText>
							<PText size="x-small" color="contrast-medium">
								{video.channelTitle} · {formatDuration(video.durationSeconds)} ·{" "}
								{formatCompactNumber(video.viewCount)}회
							</PText>
						</div>
						<div className="hidden sm:flex items-center gap-static-sm">
							<PTag color={scoreTone(video.score)}>{video.score}점</PTag>
							<ExternalLink size={16} className="text-contrast-medium" />
						</div>
					</a>
				))}
			</div>
		</article>
	);
}

function PlaybookPanel({
	playbook,
	copied,
	onCopy,
	onCreatePilotTopic,
}: {
	playbook: NichePlaybook;
	copied: boolean;
	onCopy: () => void;
	onCreatePilotTopic: (topic: string) => void;
}) {
	return (
		<div className="rounded-[8px] bg-canvas p-static-md mb-static-lg">
			<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-static-sm mb-static-md">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-static-sm">
						<PText weight="semi-bold">제작 플레이북</PText>
						<PTag color={decisionColor(playbook.decision)}>
							{decisionLabel(playbook.decision)}
						</PTag>
					</div>
					<PText size="small" color="contrast-medium" className="mt-static-xs">
						{playbook.headline}
					</PText>
				</div>
				<PButton variant="secondary" compact onClick={onCopy}>
					<span className="inline-flex items-center gap-static-xs">
						{copied ? <Check size={14} /> : <Clipboard size={14} />}
						{copied ? "복사됨" : "프롬프트 복사"}
					</span>
				</PButton>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-4 gap-static-sm">
				<PlaybookList title="핵심 규칙" items={playbook.rules} />
				<PlaybookList title="오프닝 공식" items={playbook.openingFormula} />
				<PlaybookList
					title="영상 QC 목표"
					items={(playbook.videoQualityTargets ?? []).map(
						(target) => `${target.label}: ${target.target}`,
					)}
				/>
				<PlaybookList title="10개 파일럿" items={playbook.pilotPlan} />
			</div>

			<div className="mt-static-md rounded-[8px] bg-surface p-static-sm">
				<PText size="small" weight="semi-bold" className="mb-static-xs">
					파일럿 주제팩
				</PText>
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-static-xs">
					{playbook.pilotTopics.map((topic) => (
						<button
							type="button"
							key={topic}
							className="flex items-center justify-between gap-static-sm rounded-[4px] border border-contrast-low bg-canvas px-static-sm py-static-xs text-left text-primary hover:bg-contrast-low transition-colors cursor-pointer"
							onClick={() => onCreatePilotTopic(topic)}
						>
							<span className="text-[12px] leading-[1.45]">{topic}</span>
							<FilePlus size={14} className="shrink-0" />
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

function AnalysisQualityPanel({ quality }: { quality: NicheAnalysisQuality }) {
	return (
		<div className="rounded-[8px] bg-canvas p-static-md mb-static-lg">
			<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-static-sm mb-static-md">
				<div className="flex items-center gap-static-sm">
					<ShieldCheck size={18} />
					<div>
						<PText weight="semi-bold">분석 품질</PText>
						<PText size="x-small" color="contrast-medium">
							표본 편향과 포맷 분석 성공률을 반영한 신뢰도입니다.
						</PText>
					</div>
				</div>
				<PTag color={qualityTone(quality.score)}>
					{quality.score}점 · {quality.label}
				</PTag>
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-3 gap-static-xs">
				{quality.factors.map((factor) => (
					<QualityFactorCard key={factor.key} factor={factor} />
				))}
			</div>

			{quality.warnings.length > 0 && (
				<div className="mt-static-sm flex flex-wrap gap-static-xs">
					{quality.warnings.map((warning) => (
						<PTag key={warning} color="notification-warning-soft">
							{warning}
						</PTag>
					))}
				</div>
			)}
		</div>
	);
}

function QualityFactorCard({
	factor,
}: {
	factor: NicheAnalysisQualityFactor;
}) {
	const color =
		factor.status === "good"
			? "notification-success-soft"
			: factor.status === "warn"
				? "notification-warning-soft"
				: "notification-error-soft";
	return (
		<div className="rounded-[6px] bg-surface p-static-sm min-w-0">
			<div className="flex items-center justify-between gap-static-xs">
				<PText size="x-small" color="contrast-medium">
					{factor.label}
				</PText>
				<PTag color={color}>{factor.score}점</PTag>
			</div>
			<PText size="x-small" className="mt-static-xs truncate">
				{factor.detail}
			</PText>
		</div>
	);
}

function PlaybookList({ title, items }: { title: string; items: string[] }) {
	return (
		<div className="rounded-[8px] bg-surface p-static-sm min-w-0">
			<PText size="small" weight="semi-bold" className="mb-static-xs">
				{title}
			</PText>
			<div className="flex flex-col gap-static-xs">
				{items.slice(0, 5).map((item) => (
					<PText key={item} size="x-small" color="contrast-medium">
						{item}
					</PText>
				))}
			</div>
		</div>
	);
}

function decisionColor(decision: NichePlaybook["decision"]) {
	if (decision === "scale") return "notification-success-soft";
	if (decision === "test") return "notification-warning-soft";
	return "notification-error-soft";
}

function decisionLabel(decision: NichePlaybook["decision"]) {
	if (decision === "scale") return "증폭 후보";
	if (decision === "test") return "파일럿 후보";
	return "보류";
}

function FormatAnalysisPanel({ analysis }: { analysis: NicheFormatAnalysis }) {
	const summary = analysis.summary;
	return (
		<div className="mt-static-md flex flex-col gap-static-md">
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-static-sm">
				<MiniMetric
					label="대표 훅"
					value={
						summary.medianHookSeconds === null
							? "--"
							: `${summary.medianHookSeconds.toFixed(1)}초`
					}
				/>
				<MiniMetric
					label="첫 컷"
					value={
						summary.medianFirstCutSeconds === null
							? "--"
							: `${summary.medianFirstCutSeconds.toFixed(1)}초`
					}
				/>
				<MiniMetric
					label="첫 10초 컷"
					value={`${summary.medianCutsFirst10}개`}
				/>
				<MiniMetric
					label="제목 회수율"
					value={`${Math.round(summary.medianTitleOpeningOverlap * 100)}%`}
				/>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-static-sm">
				<FlagList title="반복 법칙" flags={summary.rules} positive />
				<FlagList title="분석 한계" flags={summary.warnings} />
			</div>

			<div className="flex flex-col gap-static-xs">
				{analysis.videos.map((video) => (
					<div
						key={video.videoId}
						className="rounded-[8px] bg-surface p-static-sm"
					>
						<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-static-sm">
							<div className="min-w-0">
								<PText size="small" weight="semi-bold" className="line-clamp-1">
									{video.title}
								</PText>
								<PText size="x-small" color="contrast-medium">
									훅{" "}
									{video.hookDurationSeconds === null
										? "--"
										: `${video.hookDurationSeconds.toFixed(1)}초`}{" "}
									· 첫 컷{" "}
									{video.firstCutSeconds === null
										? "--"
										: `${video.firstCutSeconds.toFixed(1)}초`}{" "}
									· 10초 컷 {video.cutsFirst10}개
								</PText>
							</div>
							<PTag color="notification-info-soft">
								{hookPatternLabel(video.hookPattern)}
							</PTag>
						</div>
						{video.openingText && (
							<PText size="x-small" color="contrast-medium" className="mt-static-xs">
								{video.openingText}
							</PText>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function hookPatternLabel(
	pattern: NicheFormatAnalysis["summary"]["commonHookPattern"],
) {
	const labels: Record<
		NicheFormatAnalysis["summary"]["commonHookPattern"],
		string
	> = {
		question: "질문형",
		shock: "충격/미스터리형",
		claim: "주장/법칙형",
		story: "스토리형",
		unknown: "미확인",
	};
	return labels[pattern];
}

function MiniMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[8px] bg-canvas p-static-sm min-w-0">
			<PText size="x-small" color="contrast-medium">
				{label}
			</PText>
			<PText weight="semi-bold" className="truncate">
				{value}
			</PText>
		</div>
	);
}

function FlagList({
	title,
	flags,
	positive = false,
}: {
	title: string;
	flags: string[];
	positive?: boolean;
}) {
	const visibleFlags = flags.length ? flags : ["판단할 신호가 부족함"];
	return (
		<div className="rounded-[8px] bg-canvas p-static-md">
			<div className="flex items-center gap-static-xs mb-static-sm">
				{positive ? <TrendingUp size={16} /> : <AlertTriangle size={16} />}
				<PText size="small" weight="semi-bold">
					{title}
				</PText>
			</div>
			<div className="flex flex-wrap gap-static-xs">
				{visibleFlags.map((flag) => (
					<PTag
						key={flag}
						color={
							positive
								? "notification-success-soft"
								: "notification-warning-soft"
						}
					>
						{flag}
					</PTag>
				))}
			</div>
		</div>
	);
}
