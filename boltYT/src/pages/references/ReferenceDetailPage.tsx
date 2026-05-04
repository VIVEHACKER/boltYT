import {
	PButton,
	PInlineNotification,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PTextarea,
} from "@porsche-design-system/components-react";
import {
	ArrowLeft,
	BarChart3,
	Clock3,
	Database,
	Hash,
	Image as ImageIcon,
	LineChart,
	RefreshCw,
	Rocket,
	Save,
	ShieldCheck,
	Sparkles,
	Target,
	Trash2,
	Trophy,
	Tv,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
	buildChannelStrategyPlan,
	CHANNEL_STRATEGY_REFRESH_INTERVAL_MS,
	type ChannelEvidenceSource,
	type ChannelStrategyPlan,
	type RankedChannelStrategy,
} from "../../lib/channel-strategy-ranker";
import { buildReferenceKnowledgeProfile } from "../../lib/knowledge-system";
import {
	finalizeReferenceThumbnailDna,
	type ReferenceThumbnailDna,
} from "../../lib/thumbnail-intelligence";
import {
	buildTrendReferenceLearningPlan,
	type TrendReferenceLearningPlan,
	type TrendReferenceTarget,
} from "../../lib/trend-reference-learning";
import {
	fetchReferenceChannelCandidates,
	REFERENCE_CHANNEL_CATEGORIES,
	type ReferenceChannelCandidate,
} from "../../lib/reference-channel-scout";
import {
	deleteReferenceTemplate,
	getReferenceTemplate,
	updateReferenceTemplate,
} from "../../lib/reference-import";
import {
	buildReferenceTopicContentUrl,
	buildReferenceTopicPlan,
	type ReferenceTopicIdea,
} from "../../lib/reference-topic-planner";
import {
	formatReferenceOutputFormats,
	getReferenceTemplateMethodDescription,
	getReferenceTemplateMethodLabel,
	getReferenceTemplateMethodRules,
	getReferenceTemplateQuality,
	getReferenceTemplateReadiness,
	getReferenceTemplateRecommendedMode,
	isBuiltInReference,
} from "../../lib/reference-template-presets";
import type { ReferenceTemplate } from "../../types/database";

const VISUAL_MOODS: ReferenceTemplate["visual_mood"][] = [
	"horror",
	"mystery",
	"news",
	"neutral",
	"warm",
];
const SUBTITLE_POSITIONS: ReferenceTemplate["subtitle_position"][] = [
	"top",
	"center",
	"bottom",
	"dynamic",
];
const SUBTITLE_SIZES: ReferenceTemplate["subtitle_size_preset"][] = [
	"xs",
	"sm",
	"md",
	"lg",
	"xl",
];
const SUBTITLE_BG_STYLES: ReferenceTemplate["subtitle_bg_style"][] = [
	"none",
	"pill",
	"block",
	"stroke",
	"glow",
];
const TRANSITION_STYLES: ReferenceTemplate["transition_style"][] = [
	"hardcut",
	"crossfade",
	"zoom",
	"mixed",
];
const PACINGS: ReferenceTemplate["pacing_preset"][] = [
	"fast",
	"medium",
	"slow",
];
const BGM_TEMPOS: ReferenceTemplate["bgm_tempo"][] = ["slow", "mid", "fast"];
const HOOK_PATTERNS: ReferenceTemplate["hook_pattern"][] = [
	"question",
	"shock",
	"claim",
	"story",
	"",
];
const LIGHTING_STYLES: ReferenceTemplate["lighting_style"][] = [
	"dark",
	"natural",
	"bright",
	"mixed",
];

type ReferenceDetailTab = "growth" | "channel" | "dna";

const CHANNEL_CANDIDATE_CACHE_KEY =
	"reference-channel-strategy:candidates:v1";

interface ChannelCandidateCache {
	fetchedAt: string;
	candidatesByCategory: Record<string, ReferenceChannelCandidate[]>;
}

interface ChannelCandidateLoadResult extends ChannelCandidateCache {
	errorMessage: string | null;
}

function readChannelCandidateCache(): ChannelCandidateCache | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(CHANNEL_CANDIDATE_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<ChannelCandidateCache>;
		if (
			typeof parsed.fetchedAt !== "string" ||
			!parsed.candidatesByCategory ||
			typeof parsed.candidatesByCategory !== "object"
		) {
			return null;
		}
		return {
			fetchedAt: parsed.fetchedAt,
			candidatesByCategory:
				parsed.candidatesByCategory as Record<
					string,
					ReferenceChannelCandidate[]
				>,
		};
	} catch {
		return null;
	}
}

function writeChannelCandidateCache(cache: ChannelCandidateCache) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(CHANNEL_CANDIDATE_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// Cache is an optimization; quota/privacy failures should not block ranking.
	}
}

function isChannelCandidateCacheFresh(fetchedAt: string, now = Date.now()) {
	const fetched = Date.parse(fetchedAt);
	return (
		Number.isFinite(fetched) &&
		fetched <= now &&
		now - fetched < CHANNEL_STRATEGY_REFRESH_INTERVAL_MS
	);
}

function getChannelNextRefreshAt(fetchedAt: string) {
	const fetched = Date.parse(fetchedAt);
	if (!Number.isFinite(fetched)) return null;
	return new Date(fetched + CHANNEL_STRATEGY_REFRESH_INTERVAL_MS).toISOString();
}

function hasChannelCandidates(
	candidatesByCategory: Record<string, ReferenceChannelCandidate[]>,
) {
	return Object.values(candidatesByCategory).some(
		(candidates) => candidates.length > 0,
	);
}

function persistChannelScoutResult(result: ChannelCandidateLoadResult) {
	if (hasChannelCandidates(result.candidatesByCategory) || !result.errorMessage) {
		writeChannelCandidateCache({
			fetchedAt: result.fetchedAt,
			candidatesByCategory: result.candidatesByCategory,
		});
	}
}

async function loadChannelCandidateMap(): Promise<ChannelCandidateLoadResult> {
	const settled = await Promise.allSettled(
		REFERENCE_CHANNEL_CATEGORIES.map(async (category) => ({
			categoryId: category.id,
			candidates: await fetchReferenceChannelCandidates(category, {
				maxChannels: 4,
				resultsPerQuery: 6,
				daysBack: 365,
				order: "viewCount",
				format: "auto",
			}),
		})),
	);
	const candidatesByCategory: Record<string, ReferenceChannelCandidate[]> = {};
	const errors: string[] = [];
	for (const result of settled) {
		if (result.status === "fulfilled") {
			candidatesByCategory[result.value.categoryId] = result.value.candidates;
		} else {
			errors.push(
				result.reason instanceof Error
					? result.reason.message
					: "YouTube 후보 채널 검색 실패",
			);
		}
	}
	return {
		fetchedAt: new Date().toISOString(),
		candidatesByCategory,
		errorMessage:
			errors.length > 0
				? `일부 실측 데이터 수집 실패: ${[...new Set(errors)].slice(0, 2).join(" / ")}`
				: null,
	};
}

export default function ReferenceDetailPage() {
	const { id = "" } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const [template, setTemplate] = useState<ReferenceTemplate | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<ReferenceDetailTab>("growth");
	const [topicSeed, setTopicSeed] = useState("");
	const [channelCandidatesByCategory, setChannelCandidatesByCategory] = useState<
		Record<string, ReferenceChannelCandidate[]>
	>({});
	const [channelScoutLoading, setChannelScoutLoading] = useState(false);
	const [channelScoutAttempted, setChannelScoutAttempted] = useState(false);
	const [channelScoutError, setChannelScoutError] = useState<string | null>(null);
	const [channelLastCheckedAt, setChannelLastCheckedAt] = useState<string | null>(
		null,
	);
	const [channelNextRefreshAt, setChannelNextRefreshAt] = useState<string | null>(
		null,
	);
	const channelIdFromUrl = searchParams.get("channel") ?? undefined;

	useEffect(() => {
		if (!id) return;
		setLoading(true);
		getReferenceTemplate(id)
			.then((t) => {
				setTemplate(t);
				if (!t) setError("템플릿을 찾을 수 없습니다.");
			})
			.catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"))
			.finally(() => setLoading(false));
	}, [id]);

	function update<K extends keyof ReferenceTemplate>(
		field: K,
		value: ReferenceTemplate[K],
	) {
		setTemplate((prev) => (prev ? { ...prev, [field]: value } : prev));
	}

	async function handleSave() {
		if (!template) return;
		setSaving(true);
		setError(null);
		setMessage(null);
		try {
			await updateReferenceTemplate(template.id, {
				name: template.name,
				visual_mood: template.visual_mood,
				visual_prompt_template: template.visual_prompt_template,
				lighting_style: template.lighting_style,
				subtitle_position: template.subtitle_position,
				subtitle_size_preset: template.subtitle_size_preset,
				subtitle_bg_style: template.subtitle_bg_style,
				subtitle_accent_color: template.subtitle_accent_color,
				scene_count: template.scene_count,
				avg_scene_duration: template.avg_scene_duration,
				hook_duration: template.hook_duration,
				transition_style: template.transition_style,
				pacing_preset: template.pacing_preset,
				tts_voice_id: template.tts_voice_id,
				tts_speed: template.tts_speed,
				tts_tone_keywords: template.tts_tone_keywords,
				bgm_mood: template.bgm_mood,
				bgm_keywords: template.bgm_keywords,
				bgm_tempo: template.bgm_tempo,
				hook_pattern: template.hook_pattern,
			});
			setMessage("저장되었습니다.");
		} catch (e) {
			setError(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!template) return;
		if (!confirm(`"${template.name}"을(를) 삭제할까요?`)) return;
		try {
			await deleteReferenceTemplate(template.id);
			navigate("/references");
		} catch (e) {
			setError(e instanceof Error ? e.message : "삭제 실패");
		}
	}

	function contentUrlFor(target: ReferenceTemplate, topic = "") {
		if (topic.trim()) {
			return buildReferenceTopicContentUrl({
				template: target,
				topic,
				channelId: channelIdFromUrl,
			});
		}
		const params = new URLSearchParams({
			template: target.id,
			mode: getReferenceTemplateRecommendedMode(target),
		});
		if (channelIdFromUrl) {
			params.set("channel", channelIdFromUrl);
		} else if (!isBuiltInReference(target) && target.channel_id) {
			params.set("channel", target.channel_id);
		}
		return `/content/new?${params.toString()}`;
	}

	const topicPlan = useMemo(
		() => (template ? buildReferenceTopicPlan(template, topicSeed) : null),
		[template, topicSeed],
	);
	const channelStrategyPlan = useMemo(
		() =>
			template
				? buildChannelStrategyPlan(template, channelCandidatesByCategory)
				: null,
		[template, channelCandidatesByCategory],
	);
	const trendLearningPlan = useMemo(
		() =>
			template && channelStrategyPlan
				? buildTrendReferenceLearningPlan({
						template,
						strategyPlan: channelStrategyPlan,
						candidatesByCategory: channelCandidatesByCategory,
					})
				: null,
		[template, channelStrategyPlan, channelCandidatesByCategory],
	);

	useEffect(() => {
		if (activeTab !== "channel" || channelScoutAttempted) return;
		let cancelled = false;
		setChannelScoutAttempted(true);
		const cached = readChannelCandidateCache();
		if (cached) {
			setChannelCandidatesByCategory(cached.candidatesByCategory);
			setChannelLastCheckedAt(cached.fetchedAt);
			setChannelNextRefreshAt(getChannelNextRefreshAt(cached.fetchedAt));
			if (isChannelCandidateCacheFresh(cached.fetchedAt)) {
				return () => {
					cancelled = true;
				};
			}
		}
		if (!cached) setChannelScoutLoading(true);
		const startedAt = new Date().toISOString();
		setChannelLastCheckedAt(startedAt);
		setChannelNextRefreshAt(getChannelNextRefreshAt(startedAt));
		setChannelScoutError(null);
		loadChannelCandidateMap()
			.then((result) => {
				if (cancelled) return;
				setChannelCandidatesByCategory(result.candidatesByCategory);
				setChannelScoutError(result.errorMessage);
				setChannelLastCheckedAt(result.fetchedAt);
				setChannelNextRefreshAt(getChannelNextRefreshAt(result.fetchedAt));
				persistChannelScoutResult(result);
			})
			.catch((e) => {
				if (cancelled) return;
				setChannelScoutError(
					e instanceof Error ? e.message : "YouTube 후보 채널 검색 실패",
				);
			})
			.finally(() => {
				if (!cancelled && !cached) setChannelScoutLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeTab, channelScoutAttempted]);

	useEffect(() => {
		if (activeTab !== "channel" || typeof window === "undefined") return;
		let cancelled = false;
		const timer = window.setInterval(() => {
			setChannelScoutAttempted(true);
			const startedAt = new Date().toISOString();
			setChannelLastCheckedAt(startedAt);
			setChannelNextRefreshAt(getChannelNextRefreshAt(startedAt));
			setChannelScoutError(null);
			loadChannelCandidateMap()
				.then((result) => {
					if (cancelled) return;
					setChannelCandidatesByCategory(result.candidatesByCategory);
					setChannelScoutError(result.errorMessage);
					setChannelLastCheckedAt(result.fetchedAt);
					setChannelNextRefreshAt(getChannelNextRefreshAt(result.fetchedAt));
					persistChannelScoutResult(result);
				})
				.catch((e) => {
					if (cancelled) return;
					setChannelScoutError(
						e instanceof Error ? e.message : "YouTube 후보 채널 검색 실패",
					);
				});
		}, CHANNEL_STRATEGY_REFRESH_INTERVAL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [activeTab]);

	async function handleRefreshChannelScout() {
		setChannelScoutAttempted(true);
		setChannelScoutLoading(true);
		const startedAt = new Date().toISOString();
		setChannelLastCheckedAt(startedAt);
		setChannelNextRefreshAt(getChannelNextRefreshAt(startedAt));
		setChannelScoutError(null);
		try {
			const result = await loadChannelCandidateMap();
			setChannelCandidatesByCategory(result.candidatesByCategory);
			setChannelScoutError(result.errorMessage);
			setChannelLastCheckedAt(result.fetchedAt);
			setChannelNextRefreshAt(getChannelNextRefreshAt(result.fetchedAt));
			persistChannelScoutResult(result);
		} catch (e) {
			setChannelScoutError(
				e instanceof Error ? e.message : "YouTube 후보 채널 검색 실패",
			);
		} finally {
			setChannelScoutLoading(false);
		}
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (!template) {
		return (
			<div className="max-w-3xl">
				<PInlineNotification
					state="error"
					heading="찾을 수 없음"
					description={error ?? ""}
					dismissButton={false}
				/>
			</div>
		);
	}

	const builtIn = isBuiltInReference(template);
	const methodLabel = getReferenceTemplateMethodLabel(template);
	const methodDescription = getReferenceTemplateMethodDescription(template);
	const methodRules = getReferenceTemplateMethodRules(template);
	const quality = getReferenceTemplateQuality(template);
	const readiness = getReferenceTemplateReadiness(template);
	const knowledge = buildReferenceKnowledgeProfile(template);
	const thumbnailDna = finalizeReferenceThumbnailDna(template);

	return (
		<div
			className="relative mx-auto w-full max-w-[1460px] overflow-hidden rounded-[38px] border border-[#efd8aa]/10 bg-[#090604] px-4 py-5 text-[#fbf4e8] shadow-[0_34px_120px_rgba(34,22,8,.38)] sm:px-6 sm:py-7 lg:px-8"
			style={{
				fontFamily:
					"'Pretendard Variable', 'Pretendard', 'SUIT', 'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
				fontFeatureSettings: '"ss05" 1, "kern" 1',
				wordBreak: "keep-all",
				backgroundImage:
					"radial-gradient(circle at 12% 0%, rgba(241,199,91,.20), transparent 32%), radial-gradient(circle at 88% 10%, rgba(197,94,47,.15), transparent 30%), linear-gradient(135deg, #170c06 0%, #070504 48%, #1d1209 100%)",
			}}
		>
			<div className="pointer-events-none absolute inset-0 opacity-[.11] [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:46px_46px]" />
			<div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f1c75b]/70 to-transparent" />
			<div className="relative space-y-6">
				<button
					type="button"
					onClick={() => navigate("/references")}
					className="group inline-flex items-center gap-2 rounded-full border border-[#efd8aa]/15 bg-[#17100a]/80 px-3 py-2 text-[12px] font-black uppercase tracking-[.14em] text-[#d9c7aa] transition-[transform,background-color,border-color,color] duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] hover:border-[#f1c75b]/45 hover:bg-[#21170d] hover:text-[#fff7e8] active:scale-[.98]"
				>
					<ArrowLeft
						size={14}
						className="transition-transform duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] group-hover:-translate-x-0.5"
					/>
					목록
				</button>

				<header className="rounded-[34px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.05] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]">
					<div className="relative overflow-hidden rounded-[28px] bg-[#100905]/95 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.12)] sm:p-7 lg:p-8">
						<div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[#f1c75b]/18 blur-3xl" />
						<div className="pointer-events-none absolute -bottom-32 left-16 h-72 w-72 rounded-full bg-[#58c6a6]/12 blur-3xl" />
						<div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
							<div>
								<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f1c75b]/20 bg-[#f1c75b]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[.22em] text-[#f1c75b]">
									{template.source_type === "youtube" && <Tv size={13} />}
									Reference Operating System
								</div>
								<h1 className="max-w-5xl text-balance text-[clamp(32px,4.55vw,62px)] font-black leading-[1.01] tracking-[-.052em] text-[#fff7e8] drop-shadow-[0_10px_26px_rgba(0,0,0,.32)]">
									{template.name || template.source_title}
								</h1>
								<div className="mt-5 flex flex-wrap items-center gap-2">
									{template.source_creator && (
										<span className="rounded-full border border-[#efd8aa]/15 bg-white/[.055] px-3 py-1.5 text-[12px] font-bold text-[#dac8aa]">
											{template.source_creator}
										</span>
									)}
									{template.source_url && !builtIn && (
										<a
											href={template.source_url}
											target="_blank"
											rel="noopener noreferrer"
											className="rounded-full border border-[#efd8aa]/15 bg-white/[.055] px-3 py-1.5 text-[12px] font-bold text-[#dac8aa] transition hover:border-[#f1c75b]/45 hover:text-[#fff7e8]"
										>
											원본 영상
										</a>
									)}
									<span className="rounded-full border border-[#efd8aa]/15 bg-white/[.055] px-3 py-1.5 text-[12px] font-bold text-[#dac8aa]">
										{template.scene_count}씬 · {template.pacing_preset}
									</span>
								</div>
							</div>
							{template.thumbnail_url && (
								<div className="rounded-[28px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.07] p-1.5 shadow-[0_24px_70px_rgba(0,0,0,.28)]">
									<img
										src={template.thumbnail_url}
										alt=""
										className="h-36 w-full rounded-[22px] object-cover shadow-[inset_0_1px_1px_rgba(255,255,255,.16)] sm:h-40 lg:h-36"
									/>
								</div>
							)}
						</div>
					</div>
				</header>

				{message && (
					<PInlineNotification
						state="success"
						heading="저장 완료"
						description={message}
						onDismiss={() => setMessage(null)}
					/>
				)}
				{error && (
					<PInlineNotification
						state="error"
						heading="오류"
						description={error}
						onDismiss={() => setError(null)}
					/>
				)}
				{builtIn && (
					<PInlineNotification
						state="info"
						heading="내장 제작 방식"
						description="삭제/수정하지 않고 그대로 재사용하는 템플릿입니다. 아래 버튼으로 내용만 바꿔 새 콘텐츠를 만들 수 있습니다."
						dismissButton={false}
					/>
				)}
				<PInlineNotification
					state={readiness.state}
					heading={`레퍼런스 품질: ${readiness.label}`}
					description={`${readiness.summary}. ${readiness.action}`}
					dismissButton={false}
				/>

				<ReferenceDetailTabs activeTab={activeTab} onChange={setActiveTab} />

				{activeTab === "growth" && topicPlan && (
					<ReferenceGrowthTab
						template={template}
						plan={topicPlan}
						topicSeed={topicSeed}
						onTopicSeedChange={setTopicSeed}
						onCreate={(topic) => navigate(contentUrlFor(template, topic))}
					/>
				)}

				{activeTab === "channel" && channelStrategyPlan && (
						<ChannelStrategyTab
							plan={channelStrategyPlan}
							loading={channelScoutLoading}
							error={channelScoutError}
								lastCheckedAt={channelLastCheckedAt}
								nextRefreshAt={channelNextRefreshAt}
								refreshIntervalMs={CHANNEL_STRATEGY_REFRESH_INTERVAL_MS}
								trendLearningPlan={trendLearningPlan}
								channelId={channelIdFromUrl ?? (!builtIn ? template.channel_id : undefined)}
								onRefresh={handleRefreshChannelScout}
							/>
					)}

				{activeTab === "dna" && (
					<>
						<Section title="품질 진단">
							<div className="grid gap-3 md:grid-cols-3">
								<QualityMetric label="점수" value={`Q${quality.score}`} />
								<QualityMetric label="등급" value={quality.grade} />
								<QualityMetric
									label="분석 깊이"
									value={quality.deep ? "deep" : "basic"}
								/>
							</div>
							<div className="grid gap-3 md:grid-cols-4">
								<QualityMetric
									label="지식 점수"
									value={`K${knowledge.score}`}
								/>
								<QualityMetric
									label="명시지"
									value={`${knowledge.explicit.length}`}
								/>
								<QualityMetric
									label="암묵지"
									value={`${knowledge.tacit.length}`}
								/>
								<QualityMetric
									label="성과지"
									value={`${knowledge.performance.length}`}
								/>
							</div>
							<div className="grid gap-4 md:grid-cols-2">
								<div className="rounded-[20px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-4">
									<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#d8c7a8]">
										강점
									</div>
									<div className="mt-2 flex flex-wrap gap-2">
										{quality.strengths.map((strength) => (
											<SoftPill key={strength}>{strength}</SoftPill>
										))}
									</div>
								</div>
								<div className="rounded-[20px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-4">
									<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#d8c7a8]">
										보강 지점
									</div>
									<div className="mt-2 flex flex-wrap gap-2">
										{quality.gaps.length > 0 ? (
											quality.gaps.map((gap) => (
												<SoftPill key={gap}>{gap}</SoftPill>
											))
										) : (
											<SoftPill>즉시 사용 가능</SoftPill>
										)}
									</div>
								</div>
							</div>
							{knowledge.nextActions.length > 0 && (
								<div className="rounded-[20px] border border-[#58c6a6]/15 bg-[#58c6a6]/[.055] p-4">
									<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#8fe1c8]">
										다음 학습 액션
									</div>
									<div className="mt-2 space-y-1">
										{knowledge.nextActions.slice(0, 3).map((action) => (
											<p
												key={action}
												className="text-sm leading-relaxed text-[#d8d0c1]"
											>
												- {action}
											</p>
										))}
									</div>
								</div>
							)}
						</Section>
						<ThumbnailDnaSection dna={thumbnailDna} />
						{methodLabel && (
							<Section title="제작 방식">
								<div className="flex flex-wrap gap-2">
									<SoftPill>{methodLabel}</SoftPill>
									<SoftPill>{formatReferenceOutputFormats(template)}</SoftPill>
								</div>
								{methodDescription && (
									<p className="max-w-3xl text-sm leading-relaxed text-[#d8d0c1]">
										{methodDescription}
									</p>
								)}
								{methodRules.length > 0 && (
									<div className="grid gap-2 md:grid-cols-2">
										{methodRules.map((rule) => (
											<div
												key={rule}
												className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.04] p-3"
											>
												<p className="text-sm leading-relaxed text-[#d8d0c1]">
													{rule}
												</p>
											</div>
										))}
									</div>
								)}
							</Section>
						)}

						{/* 기본 */}
						<Section title="기본">
							<PInputText
								name="name"
								label="별칭"
								value={template.name}
								onInput={(e) =>
									update("name", (e.target as HTMLInputElement).value)
								}
							/>
						</Section>

						{/* 시각 */}
						<Section title="시각 스타일">
							<div className="grid gap-4 md:grid-cols-2">
								<PSelect
									name="visual_mood"
									label="무드"
									value={template.visual_mood}
									onUpdate={(e) =>
										update(
											"visual_mood",
											String(
												e.detail.value ?? "neutral",
											) as ReferenceTemplate["visual_mood"],
										)
									}
								>
									{VISUAL_MOODS.map((m) => (
										<PSelectOption key={m} value={m}>
											{m}
										</PSelectOption>
									))}
								</PSelect>

								<PSelect
									name="lighting"
									label="조명"
									value={template.lighting_style}
									onUpdate={(e) =>
										update(
											"lighting_style",
											String(
												e.detail.value ?? "natural",
											) as ReferenceTemplate["lighting_style"],
										)
									}
								>
									{LIGHTING_STYLES.map((l) => (
										<PSelectOption key={l} value={l}>
											{l}
										</PSelectOption>
									))}
								</PSelect>
							</div>

							<PTextarea
								name="visual_prompt"
								label="이미지 생성 프롬프트 템플릿"
								description="AI가 이 영상 느낌으로 이미지를 만들 때 쓸 영문 프롬프트"
								value={template.visual_prompt_template}
								onInput={(e) =>
									update(
										"visual_prompt_template",
										(e.target as HTMLTextAreaElement).value,
									)
								}
								rows={3}
							/>

							{template.dominant_colors.length > 0 && (
								<div>
									<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#d8c7a8]">
										도미넌트 컬러
									</div>
									<div className="mt-2 flex flex-wrap gap-2">
										{template.dominant_colors.map((c) => (
											<div
												key={c}
												className="flex items-center gap-2 rounded-full border border-[#efd8aa]/12 bg-[#fff7e8]/[.055] px-2 py-1 text-[#e6d9bf]"
											>
												<div
													className="w-6 h-6 rounded"
													style={{ backgroundColor: c }}
												/>
												<span className="text-xs font-mono">{c}</span>
											</div>
										))}
									</div>
								</div>
							)}
						</Section>

						{/* 레이아웃 */}
						<Section title="자막 레이아웃">
							<div className="grid gap-4 md:grid-cols-2">
								<PSelect
									name="subtitle_position"
									label="위치"
									value={template.subtitle_position}
									onUpdate={(e) =>
										update(
											"subtitle_position",
											String(
												e.detail.value ?? "bottom",
											) as ReferenceTemplate["subtitle_position"],
										)
									}
								>
									{SUBTITLE_POSITIONS.map((p) => (
										<PSelectOption key={p} value={p}>
											{p}
										</PSelectOption>
									))}
								</PSelect>

								<PSelect
									name="subtitle_size"
									label="크기"
									value={template.subtitle_size_preset}
									onUpdate={(e) =>
										update(
											"subtitle_size_preset",
											String(
												e.detail.value ?? "lg",
											) as ReferenceTemplate["subtitle_size_preset"],
										)
									}
								>
									{SUBTITLE_SIZES.map((s) => (
										<PSelectOption key={s} value={s}>
											{s}
										</PSelectOption>
									))}
								</PSelect>

								<PSelect
									name="subtitle_bg"
									label="배경 스타일"
									value={template.subtitle_bg_style}
									onUpdate={(e) =>
										update(
											"subtitle_bg_style",
											String(
												e.detail.value ?? "pill",
											) as ReferenceTemplate["subtitle_bg_style"],
										)
									}
								>
									{SUBTITLE_BG_STYLES.map((s) => (
										<PSelectOption key={s} value={s}>
											{s}
										</PSelectOption>
									))}
								</PSelect>

								<PInputText
									name="accent_color"
									label="강조 색상 (hex)"
									value={template.subtitle_accent_color}
									onInput={(e) =>
										update(
											"subtitle_accent_color",
											(e.target as HTMLInputElement).value,
										)
									}
								/>
							</div>
						</Section>

						{/* 페이싱 */}
						<Section title="페이싱 / 훅">
							<div className="grid gap-4 md:grid-cols-3">
								<PInputText
									name="scene_count"
									label="씬 수"
									value={String(template.scene_count)}
									onInput={(e) =>
										update(
											"scene_count",
											Number((e.target as HTMLInputElement).value) || 0,
										)
									}
								/>
								<PInputText
									name="avg_duration"
									label="평균 씬 길이 (초)"
									value={String(template.avg_scene_duration)}
									onInput={(e) =>
										update(
											"avg_scene_duration",
											Number((e.target as HTMLInputElement).value) || 0,
										)
									}
								/>
								<PInputText
									name="hook_duration"
									label="훅 길이 (초)"
									value={String(template.hook_duration)}
									onInput={(e) =>
										update(
											"hook_duration",
											Number((e.target as HTMLInputElement).value) || 0,
										)
									}
								/>
							</div>
							<div className="mt-4 grid gap-4 md:grid-cols-3">
								<PSelect
									name="transition"
									label="전환 스타일"
									value={template.transition_style}
									onUpdate={(e) =>
										update(
											"transition_style",
											String(
												e.detail.value ?? "mixed",
											) as ReferenceTemplate["transition_style"],
										)
									}
								>
									{TRANSITION_STYLES.map((t) => (
										<PSelectOption key={t} value={t}>
											{t}
										</PSelectOption>
									))}
								</PSelect>

								<PSelect
									name="pacing"
									label="페이싱"
									value={template.pacing_preset}
									onUpdate={(e) =>
										update(
											"pacing_preset",
											String(
												e.detail.value ?? "medium",
											) as ReferenceTemplate["pacing_preset"],
										)
									}
								>
									{PACINGS.map((p) => (
										<PSelectOption key={p} value={p}>
											{p}
										</PSelectOption>
									))}
								</PSelect>

								<PSelect
									name="hook_pattern"
									label="훅 패턴"
									value={template.hook_pattern}
									onUpdate={(e) =>
										update(
											"hook_pattern",
											String(
												e.detail.value ?? "",
											) as ReferenceTemplate["hook_pattern"],
										)
									}
								>
									{HOOK_PATTERNS.map((h) => (
										<PSelectOption key={h || "_empty"} value={h}>
											{h || "(없음)"}
										</PSelectOption>
									))}
								</PSelect>
							</div>
						</Section>

						{/* 음성 */}
						<Section title="음성 (TTS)">
							<div className="grid gap-4 md:grid-cols-3">
								<PInputText
									name="tts_voice"
									label="Voice ID (선택)"
									description="OpenAI: alloy/nova/echo 등"
									value={template.tts_voice_id}
									onInput={(e) =>
										update("tts_voice_id", (e.target as HTMLInputElement).value)
									}
								/>
								<PInputText
									name="tts_speed"
									label="속도"
									value={String(template.tts_speed)}
									onInput={(e) =>
										update(
											"tts_speed",
											Number((e.target as HTMLInputElement).value) || 1.0,
										)
									}
								/>
								<PInputText
									name="tts_tone"
									label="톤 키워드 (쉼표 구분)"
									value={template.tts_tone_keywords.join(", ")}
									onInput={(e) =>
										update(
											"tts_tone_keywords",
											(e.target as HTMLInputElement).value
												.split(",")
												.map((s) => s.trim())
												.filter(Boolean),
										)
									}
								/>
							</div>
						</Section>

						{/* BGM */}
						<Section title="BGM">
							<div className="grid gap-4 md:grid-cols-3">
								<PInputText
									name="bgm_mood"
									label="무드"
									value={template.bgm_mood}
									onInput={(e) =>
										update("bgm_mood", (e.target as HTMLInputElement).value)
									}
								/>
								<PInputText
									name="bgm_keywords"
									label="검색 키워드 (쉼표)"
									value={template.bgm_keywords.join(", ")}
									onInput={(e) =>
										update(
											"bgm_keywords",
											(e.target as HTMLInputElement).value
												.split(",")
												.map((s) => s.trim())
												.filter(Boolean),
										)
									}
								/>
								<PSelect
									name="bgm_tempo"
									label="템포"
									value={template.bgm_tempo}
									onUpdate={(e) =>
										update(
											"bgm_tempo",
											String(
												e.detail.value ?? "mid",
											) as ReferenceTemplate["bgm_tempo"],
										)
									}
								>
									{BGM_TEMPOS.map((t) => (
										<PSelectOption key={t} value={t}>
											{t}
										</PSelectOption>
									))}
								</PSelect>
							</div>
						</Section>

						{template.transcript && (
							<Section title="전사 스크립트">
								<p className="whitespace-pre-wrap text-sm leading-relaxed text-[#d8d0c1]">
									{template.transcript}
								</p>
							</Section>
						)}

						{template.script_structure.length > 0 && (
							<Section title="씬 구조 (레퍼런스)">
								<div className="space-y-2">
									{template.script_structure.map((row, i) => (
										<div
											key={`${row.role}-${i}`}
											className="flex items-center gap-3 text-sm"
										>
											<SoftPill>{row.role}</SoftPill>
											<span className="text-[#a99a82]">{row.duration}초</span>
											<span className="text-[#d8d0c1]">{row.note}</span>
										</div>
									))}
								</div>
							</Section>
						)}
					</>
				)}

				<div className="flex flex-col justify-between gap-3 border-t border-[#efd8aa]/10 pt-5 sm:flex-row">
					{builtIn ? (
						<div />
					) : (
						<PButton
							variant="secondary"
							icon="delete"
							onClick={handleDelete}
							aria-label="삭제"
						>
							<Trash2 size={14} className="mr-1 inline" /> 삭제
						</PButton>
					)}
					<div className="flex flex-wrap gap-2">
						<PButton
							variant="secondary"
							onClick={() => navigate(contentUrlFor(template))}
						>
							이 템플릿으로 콘텐츠 만들기
						</PButton>
						{!builtIn && (
							<PButton onClick={handleSave} loading={saving}>
								<Save size={14} className="mr-1 inline" /> 저장
							</PButton>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function ReferenceDetailTabs({
	activeTab,
	onChange,
}: {
	activeTab: ReferenceDetailTab;
	onChange: (tab: ReferenceDetailTab) => void;
}) {
	const tabs: Array<{ id: ReferenceDetailTab; label: string; desc: string }> = [
		{
			id: "growth",
			label: "주제/성장 추천",
			desc: "주제만 바꿔 제작",
		},
		{
			id: "channel",
			label: "채널 전략",
			desc: "데이터 기반 순위",
		},
		{
			id: "dna",
			label: "템플릿 DNA",
			desc: "편집 문법 점검",
		},
	];
	return (
		<div className="rounded-[28px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
			<div className="grid gap-1.5 rounded-[22px] bg-[#0f0a05]/80 p-1.5 sm:grid-cols-3">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => onChange(tab.id)}
						className={`rounded-[18px] px-4 py-3 text-left transition-[transform,background-color,color,box-shadow] duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] active:scale-[.99] ${
							activeTab === tab.id
								? "bg-[#f1c75b] text-[#15120c] shadow-[0_18px_45px_rgba(241,199,91,.2)]"
								: "bg-transparent text-[#d8d0c1] hover:bg-[#fff7e8]/[.06] hover:text-[#fff7e8]"
						}`}
					>
						<div className="text-[15px] font-black tracking-[-.02em]">
							{tab.label}
						</div>
						<div className="mt-0.5 text-[11px] font-black uppercase tracking-[.12em] opacity-65">
							{tab.desc}
						</div>
					</button>
				))}
			</div>
		</div>
	);
}

function ReferenceGrowthTab({
	template,
	plan,
	topicSeed,
	onTopicSeedChange,
	onCreate,
}: {
	template: ReferenceTemplate;
	plan: ReturnType<typeof buildReferenceTopicPlan>;
	topicSeed: string;
	onTopicSeedChange: (topic: string) => void;
	onCreate: (topic: string) => void;
}) {
	const topicToCreate = topicSeed.trim() || plan.defaultTopic;
	return (
		<div className="space-y-5">
			<section className="relative overflow-hidden rounded-[34px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
				<div className="relative overflow-hidden rounded-[28px] bg-[#15100a]/95 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.1)] sm:p-6 lg:p-7">
					<div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#f1c75b]/20 blur-3xl" />
					<div className="pointer-events-none absolute bottom-[-45%] left-[8%] h-72 w-72 rounded-full bg-[#58c6a6]/10 blur-3xl" />
					<div className="relative grid gap-6 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
						<div>
							<div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#f1c75b]/20 bg-[#f1c75b]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[.18em] text-[#f1c75b]">
								<Rocket size={14} />
								Topic launcher
							</div>
							<h2 className="max-w-3xl text-balance text-[clamp(28px,3vw,48px)] font-black leading-[1.02] tracking-[-.045em] text-[#fff7e8]">
								주제만 바꿔서 이 편집 문법으로 제작
							</h2>
							<p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#d8d0c1]">
								영상 원본을 복제하는 게 아니라 컷 리듬, 훅, 자막, 장면 배치만
								레퍼런스합니다. 아래 주제를 넣으면 콘텐츠 생성 단계로 바로
								넘어가고, 다음 단계에서 스토리와 씬을 다시 편집할 수 있습니다.
							</p>
							<div className="mt-4 flex flex-wrap gap-2">
								<SoftPill>{plan.recommendedMode}</SoftPill>
								<SoftPill>
									{template.scene_count}씬 · 평균 {template.avg_scene_duration}
									초
								</SoftPill>
								<SoftPill>{template.pacing_preset}</SoftPill>
							</div>
						</div>

						<div className="rounded-[26px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.06] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]">
							<PInputText
								name="reference-topic-seed"
								label="바꿀 주제"
								value={topicSeed}
								placeholder={plan.inputPlaceholder}
								onInput={(event) =>
									onTopicSeedChange((event.target as HTMLInputElement).value)
								}
							/>
							<div className="mt-3 flex flex-wrap gap-2">
								<PButton onClick={() => onCreate(topicToCreate)}>
									이 주제로 제작 시작
								</PButton>
								<PButton
									variant="secondary"
									onClick={() => onTopicSeedChange(plan.defaultTopic)}
								>
									추천 주제 채우기
								</PButton>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
				<div className="rounded-[30px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
					<div className="h-full rounded-[24px] bg-[#120d07]/90 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.08)]">
						<div className="mb-3 flex items-center gap-2 text-[#f1c75b]">
							<BarChart3 size={17} />
							<div className="text-[15px] font-black tracking-[-.02em] text-[#fff7e8]">
								성장 운영 기준
							</div>
						</div>
						<div className="space-y-3">
							{plan.strategy.map((item) => (
								<p
									key={item}
									className="text-sm leading-relaxed text-[#d8d0c1]"
								>
									- {item}
								</p>
							))}
						</div>
						<div className="mt-4 rounded-[20px] border border-[#58c6a6]/14 bg-[#58c6a6]/[.055] p-4">
							<div className="mb-3 flex items-center gap-2 text-[13px] font-black text-[#b7f0dc]">
								<Target size={14} />
								계정 삭제/트렌드 도메인 지식
							</div>
							<div className="grid gap-2">
								{plan.domainKnowledge.enforcementSummary.slice(0, 3).map((item) => (
									<p
										key={item}
										className="text-xs leading-relaxed text-[#c9ddcf]"
									>
										{item}
									</p>
								))}
							</div>
							<div className="mt-3 flex flex-wrap gap-2">
								{plan.domainKnowledge.trendSummary.map((item) => (
									<SoftPill key={item} tone="mint">
										{item}
									</SoftPill>
								))}
							</div>
						</div>
						<div className="mt-4 grid gap-2">
							{plan.weeklyPlan.map((item) => (
								<div
									key={item.slot}
									className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]"
								>
									<div className="mb-1 flex items-center gap-2">
										<Clock3 size={13} className="text-[#f1c75b]" />
										<span className="text-[12px] font-black text-[#f1c75b]">
											{item.slot}
										</span>
									</div>
									<p className="text-sm font-bold leading-snug text-[#fff7e8]">
										{item.action}
									</p>
									<p className="mt-1 text-xs leading-relaxed text-[#b9ab90]">
										{item.reason}
									</p>
								</div>
							))}
						</div>
					</div>
				</div>

				<div className="rounded-[30px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
					<div className="h-full rounded-[24px] bg-[#120d07]/90 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.08)]">
						<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
							<div className="flex items-center gap-2 text-[#f1c75b]">
								<Sparkles size={17} />
								<div className="text-[15px] font-black tracking-[-.02em] text-[#fff7e8]">
									자동 추천 영상
								</div>
							</div>
							<SoftPill tone="mint">빠른 구독자 성장 실험</SoftPill>
						</div>
						<div className="grid gap-3">
							{plan.ideas.map((idea) => (
								<TopicIdeaCard key={idea.id} idea={idea} onCreate={onCreate} />
							))}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}

function ChannelStrategyTab({
	plan,
	loading,
	error,
	lastCheckedAt,
	nextRefreshAt,
	refreshIntervalMs,
	trendLearningPlan,
	channelId,
	onRefresh,
}: {
	plan: ChannelStrategyPlan;
	loading: boolean;
	error: string | null;
	lastCheckedAt: string | null;
	nextRefreshAt: string | null;
	refreshIntervalMs: number;
	trendLearningPlan: TrendReferenceLearningPlan | null;
	channelId?: string;
	onRefresh: () => void;
}) {
	const top = plan.rankings[0];
	return (
		<div className="space-y-5">
			<section className="relative overflow-hidden rounded-[34px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
				<div className="relative overflow-hidden rounded-[28px] bg-[#15100a]/95 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.1)] sm:p-6 lg:p-7">
					<div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#58c6a6]/18 blur-3xl" />
					<div className="pointer-events-none absolute bottom-[-45%] left-[8%] h-72 w-72 rounded-full bg-[#f1c75b]/12 blur-3xl" />
					<div className="relative grid gap-5 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
						<div>
							<div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#58c6a6]/20 bg-[#58c6a6]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[.18em] text-[#b7f0dc]">
								<Database size={14} />
								Data-only channel ranking
							</div>
							<h2 className="max-w-4xl text-balance text-[clamp(30px,3.4vw,52px)] font-black leading-[1.02] tracking-[-.05em] text-[#fff7e8]">
								어떤 채널을 먼저 만들지 점수로 결정
							</h2>
							<p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#d8d0c1]">
								현재 레퍼런스 카테고리, 공개 YouTube 트렌드, 정책 리스크,
								실시간 후보 채널 성과가 있으면 그 데이터를 합산합니다. 감이나
								취향 대신 아래 가중치와 증거만으로 순위를 매깁니다.
							</p>
							<div className="mt-4 flex flex-wrap gap-2">
								<SoftPill tone="mint">
									현재 레퍼런스: {plan.currentTemplateCategory}
								</SoftPill>
								<SoftPill>
									{top
										? `1순위 ${top.label} · S${top.score}`
										: "순위 계산 전"}
								</SoftPill>
									<SoftPill>{new Date(plan.generatedAt).toLocaleDateString("ko-KR")}</SoftPill>
									<SoftPill tone="mint">
										자동 갱신 {formatRefreshInterval(refreshIntervalMs)}
									</SoftPill>
								</div>
							</div>
							<div className="rounded-[26px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.06] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]">
							<div className="mb-3 flex items-center justify-between gap-3">
								<div>
									<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#d8c7a8]">
										실측 데이터
									</div>
									<p className="mt-1 text-xs leading-relaxed text-[#b9ab90]">
										YouTube API 후보 채널을 가져오면 실측 성과 36%를 반영합니다.
									</p>
								</div>
								<PButton
									compact
									variant="secondary"
									loading={loading}
									onClick={onRefresh}
								>
									<RefreshCw size={13} className="mr-1 inline" />
									재계산
								</PButton>
							</div>
								<div className="grid gap-2">
									{plan.sourceNotes.map((note) => (
										<p key={note} className="text-xs leading-relaxed text-[#d8d0c1]">
											- {note}
										</p>
									))}
								</div>
								<div className="mt-4 grid gap-2 sm:grid-cols-3">
									<RefreshStatus
										label="마지막 확인"
										value={formatDateTime(lastCheckedAt)}
									/>
									<RefreshStatus
										label="다음 자동 확인"
										value={formatDateTime(nextRefreshAt)}
									/>
									<RefreshStatus
										label="자동 갱신"
										value={`${formatRefreshInterval(refreshIntervalMs)} 주기`}
									/>
								</div>
								{error && (
									<div className="mt-3 rounded-[18px] border border-[#e76f51]/20 bg-[#e76f51]/10 px-3 py-2 text-xs leading-relaxed text-[#ffd4c2]">
										{error}
								</div>
							)}
						</div>
					</div>
				</div>
			</section>

			{trendLearningPlan && (
				<TrendReferenceLearningPanel
					plan={trendLearningPlan}
					channelId={channelId}
				/>
			)}

			<section className="grid gap-4 xl:grid-cols-[.8fr_1.2fr]">
				<div className="rounded-[30px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
					<div className="h-full rounded-[24px] bg-[#120d07]/90 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.08)]">
						<div className="mb-4 flex items-center gap-2 text-[#f1c75b]">
							<LineChart size={17} />
							<div className="text-[15px] font-black tracking-[-.02em] text-[#fff7e8]">
								점수 공식
							</div>
						</div>
							<div className="grid gap-2">
								{plan.weights.map((weight) => (
								<div
									key={weight.key}
									className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-3"
								>
									<div className="flex items-center justify-between gap-3">
										<div className="text-sm font-black text-[#fff7e8]">
											{weight.label}
										</div>
										<SoftPill>
											{Math.round(weight.liveWeight * 100)}% /{" "}
											{Math.round(weight.fallbackWeight * 100)}%
										</SoftPill>
									</div>
									<p className="mt-1 text-xs leading-relaxed text-[#b9ab90]">
										실측 있음 / 실측 없음 기준 가중치
									</p>
									</div>
								))}
							</div>
							<div className="mt-4 rounded-[20px] border border-[#58c6a6]/15 bg-[#58c6a6]/[.055] p-4">
								<div className="mb-2 text-[12px] font-black uppercase tracking-[.16em] text-[#b7f0dc]">
									근거 소스
								</div>
								<EvidenceSourceList sources={plan.evidenceSources} />
							</div>
						</div>
					</div>

				<div className="grid gap-3">
					{plan.rankings.map((strategy) => (
						<ChannelStrategyCard key={strategy.categoryId} strategy={strategy} />
					))}
				</div>
			</section>
		</div>
		);
		}

function TrendReferenceLearningPanel({
	plan,
	channelId,
}: {
	plan: TrendReferenceLearningPlan;
	channelId?: string;
}) {
	const topTargets = [...plan.videoTargets, ...plan.styleTargets].slice(0, 5);
	return (
		<section className="rounded-[30px] border border-[#58c6a6]/15 bg-[#58c6a6]/[.055] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
			<div className="rounded-[24px] bg-[#10120b]/92 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.08)] sm:p-6">
				<div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#58c6a6]/20 bg-[#58c6a6]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[.18em] text-[#b7f0dc]">
							<Sparkles size={14} />
							Trend reference learning
						</div>
						<h3 className="text-[26px] font-black leading-tight tracking-[-.045em] text-[#fff7e8]">
							트렌드 발견 시 별도 레퍼런스화하고 학습
						</h3>
						<p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#c9ddcf]">
							{plan.qualityLiftSummary} 저장된 트렌드 레퍼런스는 원본을 복제하지
							않고 컷 호흡, 자막/썸네일 배치, BGM 에너지, 화면 전환 암묵지만 다음
							생성에 반영합니다.
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<SoftPill tone="mint">영상 {plan.videoTargets.length}</SoftPill>
						<SoftPill>스타일 {plan.styleTargets.length}</SoftPill>
					</div>
				</div>

				<div className="grid gap-3 lg:grid-cols-[.75fr_1.25fr]">
					<div className="rounded-[20px] border border-[#efd8aa]/10 bg-black/20 p-4">
						<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#b7f0dc]">
							자동 처리 규칙
						</div>
						<div className="mt-3 space-y-2">
							{plan.autoReferencePolicy.map((rule) => (
								<p key={rule} className="text-xs leading-relaxed text-[#c9ddcf]">
									- {rule}
								</p>
							))}
						</div>
					</div>

					<div className="grid gap-3">
						{topTargets.length === 0 ? (
							<div className="rounded-[20px] border border-dashed border-[#58c6a6]/25 bg-black/20 p-4 text-sm text-[#c9ddcf]">
								실측 후보가 충분히 강해지면 이곳에 별도 레퍼런스 큐가 자동으로
								생깁니다. 재계산을 누르면 최신 후보를 다시 확인합니다.
							</div>
						) : (
							topTargets.map((target) => (
								<TrendReferenceTargetCard
									key={target.id}
									target={target}
									channelId={channelId}
								/>
							))
						)}
					</div>
				</div>
			</div>
		</section>
	);
}

function TrendReferenceTargetCard({
	target,
	channelId,
}: {
	target: TrendReferenceTarget;
	channelId?: string;
}) {
	const importUrl = target.sourceUrl
		? buildTrendReferenceImportUrl(target, channelId)
		: "";
	return (
		<article className="rounded-[20px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div className="mb-2 flex flex-wrap gap-2">
						<SoftPill tone={target.kind === "video" ? "mint" : "warm"}>
							{target.kind === "video" ? "트렌드 영상" : "스타일 신호"}
						</SoftPill>
						<SoftPill>S{target.score}</SoftPill>
						<SoftPill>{target.suggestedMode}</SoftPill>
					</div>
					<h4 className="text-[17px] font-black leading-snug tracking-[-.025em] text-[#fff7e8]">
						{target.label}
					</h4>
					<p className="mt-2 text-xs leading-relaxed text-[#c9ddcf]">
						{target.expectedQualityLift}
					</p>
				</div>
				{importUrl ? (
					<a
						href={importUrl}
						className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#58c6a6]/30 bg-[#58c6a6]/15 px-4 py-2 text-[12px] font-black text-[#b7f0dc] transition hover:border-[#b7f0dc]/60 hover:bg-[#58c6a6]/25"
					>
						deep 레퍼런스 진행
					</a>
				) : (
					<span className="inline-flex shrink-0 items-center justify-center rounded-full border border-[#efd8aa]/14 bg-black/20 px-4 py-2 text-[12px] font-black text-[#d8c7a8]">
						후보 검색 필요
					</span>
				)}
			</div>
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<div>
					<div className="text-[11px] font-black uppercase tracking-[.14em] text-[#b7f0dc]">
						발견 근거
					</div>
					<p className="mt-1 text-xs leading-relaxed text-[#c9ddcf]">
						{target.evidence.slice(0, 3).join(" / ")}
					</p>
				</div>
				<div>
					<div className="text-[11px] font-black uppercase tracking-[.14em] text-[#d8c7a8]">
						학습할 스타일
					</div>
					<p className="mt-1 text-xs leading-relaxed text-[#d8d0c1]">
						{target.styleSignals.slice(0, 3).join(" / ")}
					</p>
				</div>
			</div>
		</article>
	);
}

function buildTrendReferenceImportUrl(
	target: TrendReferenceTarget,
	channelId?: string,
): string {
	const params = new URLSearchParams({
		url: target.sourceUrl ?? "",
		name: target.importName ?? target.label,
		mode: target.suggestedMode,
		trendReference: "1",
		trendCategory: target.categoryId,
		trendEvidence: target.evidence.slice(0, 2).join(" / "),
		trendStyle: target.styleSignals.slice(0, 2).join(" / "),
	});
	if (channelId) params.set("channel", channelId);
	return `/references/import?${params.toString()}`;
}

function RefreshStatus({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[16px] border border-[#efd8aa]/10 bg-black/20 px-3 py-2">
			<div className="text-[10px] font-black uppercase tracking-[.14em] text-[#b9ab90]">
				{label}
			</div>
			<div className="mt-1 text-[12px] font-black leading-snug text-[#fff7e8]">
				{value}
			</div>
		</div>
	);
}

function EvidenceSourceList({
	sources,
	compact = false,
}: {
	sources: ChannelEvidenceSource[];
	compact?: boolean;
}) {
	return (
		<div className={compact ? "space-y-1.5" : "space-y-2"}>
			{sources.map((source) => {
				const isExternal = source.url.startsWith("http");
				const kindLabel =
					source.kind === "official"
						? "공식"
						: source.kind === "live_api"
							? "실측"
							: "내부";
				return (
					<div
						key={`${source.kind}:${source.url}`}
						className="rounded-[14px] border border-white/[.07] bg-black/20 px-3 py-2"
					>
						<div className="flex flex-wrap items-center gap-2">
							<span className="rounded-full bg-[#fff7e8]/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[.12em] text-[#b7f0dc]">
								{kindLabel}
							</span>
							{isExternal ? (
								<a
									href={source.url}
									target="_blank"
									rel="noopener noreferrer"
									className="text-[12px] font-black text-[#fff7e8] underline decoration-[#58c6a6]/45 underline-offset-4 transition hover:text-[#b7f0dc]"
								>
									{source.label}
								</a>
							) : (
								<span className="text-[12px] font-black text-[#fff7e8]">
									{source.label}
								</span>
							)}
						</div>
						<p className="mt-1 text-[11px] leading-relaxed text-[#c9ddcf]">
							{source.usedFor}
						</p>
					</div>
				);
			})}
		</div>
	);
}

	function ChannelStrategyCard({
		strategy,
	}: {
	strategy: RankedChannelStrategy;
}) {
	return (
		<article className="rounded-[30px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
			<div className="rounded-[24px] bg-[#120d07]/90 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.08)]">
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
					<div>
						<div className="mb-3 flex flex-wrap items-center gap-2">
							<SoftPill tone={strategy.rank === 1 ? "mint" : "warm"}>
								#{strategy.rank}
							</SoftPill>
							<SoftPill>S{strategy.score}</SoftPill>
							<SoftPill>{formatStrategyFormat(strategy.recommendedFormat)}</SoftPill>
							<SoftPill>{confidenceLabel(strategy.confidence)}</SoftPill>
						</div>
						<div className="flex items-start gap-3">
							<div className="mt-1 rounded-2xl border border-[#f1c75b]/20 bg-[#f1c75b]/10 p-2 text-[#f1c75b]">
								{strategy.rank === 1 ? <Trophy size={18} /> : <BarChart3 size={18} />}
							</div>
							<div className="min-w-0">
								<h3 className="text-[24px] font-black leading-[1.08] tracking-[-.04em] text-[#fff7e8]">
									{strategy.label}
								</h3>
								<p className="mt-1 text-sm leading-relaxed text-[#d8d0c1]">
									{strategy.channelConcept}
								</p>
								<p className="mt-2 text-xs leading-relaxed text-[#b9ab90]">
									첫 콘텐츠 축: {strategy.firstContentPillar}
								</p>
							</div>
						</div>

						<div className="mt-4 grid gap-2 md:grid-cols-2">
							{strategy.scoreFactors.map((factor) => (
								<div
									key={factor.key}
									className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-3"
								>
									<div className="flex items-center justify-between gap-2">
										<div className="text-[12px] font-black uppercase tracking-[.12em] text-[#f1c75b]">
											{factor.label}
										</div>
										<span className="text-sm font-black text-[#fff7e8]">
											{factor.score} · {Math.round(factor.weight * 100)}%
										</span>
									</div>
									<p className="mt-1 text-xs leading-relaxed text-[#b9ab90]">
										{factor.evidence}
									</p>
								</div>
							))}
						</div>
					</div>

					<div className="grid gap-3">
						<div className="rounded-[20px] border border-[#58c6a6]/15 bg-[#58c6a6]/[.055] p-4">
							<div className="mb-2 flex items-center gap-2 text-[12px] font-black uppercase tracking-[.14em] text-[#b7f0dc]">
								<Hash size={14} />
								채널명 후보
							</div>
							<div className="grid gap-2">
								{strategy.nameCandidates.slice(0, 3).map((candidate) => (
									<div
										key={candidate.name}
										className="rounded-[16px] bg-black/20 px-3 py-2"
									>
										<div className="flex items-center justify-between gap-2">
											<div className="text-sm font-black text-[#fff7e8]">
												{candidate.name}
											</div>
											<span className="text-[11px] font-black text-[#b7f0dc]">
												N{candidate.score}
											</span>
										</div>
										<p className="mt-1 text-[11px] leading-relaxed text-[#c9ddcf]">
											{candidate.rationale}
										</p>
									</div>
								))}
							</div>
						</div>
						<div className="rounded-[20px] border border-[#e76f51]/15 bg-[#e76f51]/[.06] p-4">
							<div className="mb-2 flex items-center gap-2 text-[12px] font-black uppercase tracking-[.14em] text-[#ffd4c2]">
								<ShieldCheck size={14} />
								리스크 제어
							</div>
							<div className="space-y-1">
								{strategy.riskControls.slice(0, 3).map((risk) => (
									<p
										key={risk}
										className="text-[11px] leading-relaxed text-[#ffd4c2]"
									>
										- {risk}
									</p>
								))}
							</div>
						</div>
					</div>
				</div>

					<div className="mt-4 grid gap-3 lg:grid-cols-3">
						<div className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.04] p-3">
							<div className="text-[11px] font-black uppercase tracking-[.14em] text-[#d8c7a8]">
								트렌드 근거
						</div>
						<p className="mt-1 text-xs leading-relaxed text-[#d8d0c1]">
							{strategy.trendClusters
								.map((cluster) => `${cluster.label} S${cluster.score}`)
								.join(" / ")}
						</p>
					</div>
					<div className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.04] p-3">
						<div className="text-[11px] font-black uppercase tracking-[.14em] text-[#d8c7a8]">
							실측 후보
						</div>
						<p className="mt-1 text-xs leading-relaxed text-[#d8d0c1]">
							{strategy.liveEvidence.slice(0, 2).join(" / ")}
						</p>
					</div>
					<div className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.04] p-3">
						<div className="text-[11px] font-black uppercase tracking-[.14em] text-[#d8c7a8]">
							파일럿
						</div>
						<p className="mt-1 text-xs leading-relaxed text-[#d8d0c1]">
							{strategy.pilotPlan.slice(0, 2).join(" / ")}
							</p>
						</div>
					</div>
					<div className="mt-3 grid gap-3 lg:grid-cols-2">
						<div className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.04] p-3">
							<div className="text-[11px] font-black uppercase tracking-[.14em] text-[#d8c7a8]">
								근거 데이터
							</div>
							<div className="mt-2 space-y-1">
								{strategy.dataBasis.slice(0, 4).map((basis) => (
									<p
										key={basis}
										className="text-xs leading-relaxed text-[#d8d0c1]"
									>
										- {basis}
									</p>
								))}
							</div>
						</div>
						<div className="rounded-[18px] border border-[#58c6a6]/15 bg-[#58c6a6]/[.045] p-3">
							<div className="text-[11px] font-black uppercase tracking-[.14em] text-[#b7f0dc]">
								판단 근거 소스
							</div>
							<div className="mt-2">
								<EvidenceSourceList sources={strategy.evidenceSources} compact />
							</div>
						</div>
					</div>
				</div>
			</article>
		);
	}

function ThumbnailDnaSection({ dna }: { dna: ReferenceThumbnailDna }) {
	return (
		<Section title="썸네일 DNA">
			<div className="grid gap-4 lg:grid-cols-[360px_1fr]">
				<div className="overflow-hidden rounded-[24px] border border-[#efd8aa]/10 bg-[#0d0905] shadow-[inset_0_1px_0_rgba(255,255,255,.08)]">
					<div className="relative aspect-video bg-[#17100a]">
						{dna.source.thumbnailUrl ? (
							<img
								src={dna.source.thumbnailUrl}
								alt=""
								className="h-full w-full object-cover"
							/>
						) : (
							<div className="grid h-full place-items-center text-[#f1c75b]">
								<ImageIcon size={34} />
							</div>
						)}
						<div className="absolute left-3 top-3 rounded-full bg-[#f1c75b] px-3 py-1 text-[11px] font-black uppercase tracking-[.12em] text-[#17100a]">
							{dna.generation.badgeText}
						</div>
						<div className="absolute inset-x-0 bottom-0 h-1.5" style={{ backgroundColor: dna.color.accentColor }} />
					</div>
					<div className="p-4">
						<div className="flex flex-wrap gap-2">
							<SoftPill tone="mint">Q{dna.quality.score}</SoftPill>
							<SoftPill>{dna.analysisDepth}</SoftPill>
							<SoftPill>{dna.format.assetMode}</SoftPill>
						</div>
						<p className="mt-3 text-sm leading-relaxed text-[#d8d0c1]">
							{dna.clickPackaging.titleThumbnailRelationship}
						</p>
					</div>
				</div>

				<div className="grid gap-3">
					<div className="grid gap-3 md:grid-cols-3">
						<QualityMetric label="문구 전략" value={dna.text.strategy} />
						<QualityMetric label="텍스트 영역" value={dna.layout.textZone} />
						<QualityMetric label="대비" value={dna.color.contrast} />
					</div>
					<div className="grid gap-3 md:grid-cols-2">
						<div className="rounded-[20px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-4">
							<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#d8c7a8]">
								생성 공식
							</div>
							<p className="mt-2 text-sm leading-relaxed text-[#d8d0c1]">
								{dna.text.titleFormula}
							</p>
							<p className="mt-1 text-sm leading-relaxed text-[#b9ab90]">
								{dna.text.subtitleFormula}
							</p>
						</div>
						<div className="rounded-[20px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.045] p-4">
							<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#d8c7a8]">
								클릭 감정
							</div>
							<p className="mt-2 text-sm leading-relaxed text-[#d8d0c1]">
								{dna.clickPackaging.emotion}
							</p>
							<p className="mt-1 text-sm leading-relaxed text-[#b9ab90]">
								{dna.clickPackaging.curiosityGap}
							</p>
						</div>
					</div>
					<div className="grid gap-2 md:grid-cols-3">
						{dna.generation.variants.map((variant) => (
							<div
								key={variant.id}
								className="rounded-[18px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.04] p-3"
							>
								<div className="text-sm font-black text-[#fff7e8]">
									{variant.titlePattern}
								</div>
								<p className="mt-1 text-xs leading-relaxed text-[#b9ab90]">
									{variant.testGoal}
								</p>
							</div>
						))}
					</div>
					{dna.quality.requiredActions.length > 0 && (
						<div className="flex flex-wrap gap-2">
							{dna.quality.requiredActions.map((action) => (
								<SoftPill key={action}>{action}</SoftPill>
							))}
						</div>
					)}
				</div>
			</div>
		</Section>
	);
}

function TopicIdeaCard({
	idea,
	onCreate,
}: {
	idea: ReferenceTopicIdea;
	onCreate: (topic: string) => void;
}) {
	return (
		<article className="group rounded-[24px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.055] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.07)] transition-[transform,border-color,background-color,box-shadow] duration-300 [transition-timing-function:cubic-bezier(.2,.8,.2,1)] hover:-translate-y-0.5 hover:border-[#f1c75b]/30 hover:bg-[#fff7e8]/[.075] hover:shadow-[0_18px_48px_rgba(0,0,0,.22),inset_0_1px_0_rgba(255,255,255,.09)]">
			<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="mb-2 flex flex-wrap gap-2">
						<SoftPill>{idea.format}</SoftPill>
						<SoftPill>{goalLabel(idea.goal)}</SoftPill>
						<SoftPill tone="mint">S{idea.score}</SoftPill>
						<SoftPill>{idea.durationRange}</SoftPill>
					</div>
					<div className="text-[18px] font-black leading-[1.18] tracking-[-.03em] text-[#fff7e8]">
						{idea.title}
					</div>
					<p className="mt-1 text-sm leading-relaxed text-[#d8d0c1]">
						{idea.angle}
					</p>
				</div>
				<PButton compact onClick={() => onCreate(idea.title)}>
					제작
				</PButton>
			</div>

			<div className="grid gap-2 md:grid-cols-2">
				<IdeaDetail icon={<Target size={13} />} label="훅" value={idea.hook} />
				<IdeaDetail
					icon={<Sparkles size={13} />}
					label="썸네일"
					value={idea.thumbnailText}
				/>
				<IdeaDetail
					icon={<Clock3 size={13} />}
					label="길이/구성"
					value={idea.durationPlan.slice(0, 2).join(" / ")}
				/>
				<IdeaDetail
					icon={<BarChart3 size={13} />}
					label="트렌드"
					value={`${idea.trendCluster}: ${idea.domainSignals.slice(0, 2).join(" / ")}`}
				/>
			</div>
			<div className="mt-3 rounded-[18px] border border-[#58c6a6]/12 bg-[#58c6a6]/[.05] p-3">
				<p className="text-xs leading-relaxed text-[#c9ddcf]">{idea.whyNow}</p>
				<p className="mt-1 text-xs leading-relaxed text-[#b9c9bd]">
					자료: {idea.sourcePlan.join(" · ")}
				</p>
				<p className="mt-1 text-xs leading-relaxed text-[#b9c9bd]">
					리스크: {idea.riskControl}
				</p>
			</div>
		</article>
	);
}

function IdeaDetail({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
}) {
	return (
		<div className="rounded-[18px] border border-[#efd8aa]/10 bg-[#0d0905]/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,.06)]">
			<div className="mb-1 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[.12em] text-[#f1c75b]">
				{icon}
				{label}
			</div>
			<p className="text-sm leading-relaxed text-[#d8d0c1]">{value}</p>
		</div>
	);
}

function SoftPill({
	children,
	tone = "warm",
}: {
	children: React.ReactNode;
	tone?: "warm" | "mint";
}) {
	const toneClass =
		tone === "mint"
			? "border-[#58c6a6]/20 bg-[#58c6a6]/10 text-[#b7f0dc]"
			: "border-[#efd8aa]/14 bg-[#fff7e8]/[.06] text-[#e6d9bf]";

	return (
		<span
			className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-[.08em] ${toneClass}`}
		>
			{children}
		</span>
	);
}

function goalLabel(goal: ReferenceTopicIdea["goal"]): string {
	if (goal === "new_viewers") return "신규 유입";
	if (goal === "subscriber_conversion") return "구독 전환";
	return "재방문";
}

function formatDateTime(value: string | null): string {
	if (!value) return "아직 없음";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "시간 미확인";
	return date.toLocaleString("ko-KR", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatRefreshInterval(ms: number): string {
	const hours = Math.round(ms / (60 * 60 * 1000));
	return hours >= 1 ? `${hours}시간` : `${Math.round(ms / 60000)}분`;
}

function formatStrategyFormat(
	format: RankedChannelStrategy["recommendedFormat"],
): string {
	if (format === "hybrid") return "쇼츠+롱폼";
	if (format === "longform") return "롱폼";
	return "쇼츠";
}

function confidenceLabel(
	confidence: RankedChannelStrategy["confidence"],
): string {
	if (confidence === "live") return "실측 반영";
	if (confidence === "modeled") return "부분 실측";
	return "모델 기준";
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-[30px] border border-[#efd8aa]/10 bg-[#f8efe0]/[.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
			<div className="rounded-[24px] bg-[#120d07]/90 p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,.08)] sm:p-6">
				<div className="mb-4 flex items-center justify-between gap-3 border-b border-[#efd8aa]/10 pb-3">
					<div className="text-[12px] font-black uppercase tracking-[.2em] text-[#f1c75b]">
						{title}
					</div>
					<div className="h-px flex-1 bg-gradient-to-r from-[#f1c75b]/30 to-transparent" />
				</div>
				<div className="space-y-4">{children}</div>
			</div>
		</section>
	);
}

function QualityMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[22px] border border-[#efd8aa]/10 bg-[#fff7e8]/[.055] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,.07)]">
			<div className="text-[12px] font-black uppercase tracking-[.16em] text-[#d8c7a8]">
				{label}
			</div>
			<div className="mt-1 text-[clamp(24px,3vw,34px)] font-black leading-none tracking-[-.055em] text-[#fff7e8]">
				{value}
			</div>
		</div>
	);
}
