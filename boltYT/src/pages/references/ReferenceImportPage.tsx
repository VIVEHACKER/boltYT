import {
	PButton,
	PInlineNotification,
	PInputText,
	PSelect,
	PSelectOption,
	PSpinner,
	PText,
} from "@porsche-design-system/components-react";
import {
	ArrowLeft,
	Check,
	CheckCircle2,
	Clock,
	Globe2,
	RefreshCw,
	Search,
	ShieldCheck,
	Sparkles,
	TrendingUp,
	Tv,
	Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	type AnalysisJob,
	type ReferenceAnalysisMode,
	checkAnalyzerHealth,
	cleanupAnalysisJob,
	saveReferenceTemplate,
	startYouTubeAnalysis,
	waitForAnalysis,
} from "../../lib/reference-import";
import {
	REFERENCE_CHANNEL_CATEGORIES,
	buildReferenceTemplateName,
	fetchReferenceChannelCandidates,
	formatCandidateMetric,
	type ReferenceChannelCandidate,
} from "../../lib/reference-channel-scout";
import { supabase } from "../../lib/supabase";
import {
	attachTrendReferenceLearningToAnalysisResult,
	attachTrendReferenceSeedToAnalysisResult,
} from "../../lib/trend-reference-learning";
import type { Channel } from "../../types/database";

const STATUS_LABEL: Record<AnalysisJob["status"], string> = {
	queued: "대기 중",
	downloading: "영상 정보 확인 중...",
	extracting: "구조/프레임/픽셀 정보 추출 중...",
	transcribing: "스크립트 전사 중 (Whisper)...",
	analyzing: "레퍼런스 Production DNA 생성 중...",
	complete: "분석 완료",
	failed: "실패",
};

const ANALYSIS_MODE_LABEL: Record<ReferenceAnalysisMode, string> = {
	auto: "자동 감지",
	shortform: "쇼츠 정밀 분석",
	longform: "롱폼 구조 분석",
	deep: "딥 레퍼런스",
};

const MODE_DETAILS: Record<
	ReferenceAnalysisMode,
	{ eyebrow: string; description: string; badge: string }
> = {
	auto: {
		eyebrow: "권장",
		description: "길이를 보고 쇼츠 정밀 분석과 롱폼 구조 분석을 자동 선택",
		badge: "Auto router",
	},
	shortform: {
		eyebrow: "3분 이하",
		description: "픽셀 프레임, 오디오, 전사 기반으로 제작 DNA를 추출",
		badge: "Pixel + audio",
	},
	longform: {
		eyebrow: "8~20분",
		description: "20분 이하 롱폼의 제목, 챕터, heatmap으로 편집 구조화",
		badge: "Metadata map",
	},
	deep: {
		eyebrow: "고품질",
		description: "긴 영상도 대표 구간을 샘플링해 프레임·오디오 DNA 추출",
		badge: "Sampled pixel",
	},
};

type AutoReferenceStatus = "queued" | "analyzing" | "saving" | "complete" | "failed";

interface AutoReferenceProgress {
	candidateId: string;
	label: string;
	status: AutoReferenceStatus;
	message: string;
	templateId?: string;
}

interface CategoryBatchProgress {
	categoryId: string;
	label: string;
	status: "queued" | "scouting" | "referencing" | "complete" | "failed";
	message: string;
	candidateCount: number;
	savedCount: number;
}

function readAnalysisModeParam(value: string | null): ReferenceAnalysisMode {
	return value === "auto" ||
		value === "shortform" ||
		value === "longform" ||
		value === "deep"
		? value
		: "auto";
}

function splitTrendParam(value: string | null): string[] {
	return (value ?? "")
		.split(" / ")
		.map((item) => item.trim())
		.filter(Boolean)
		.slice(0, 6);
}

export default function ReferenceImportPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const channelParam = searchParams.get("channel") ?? "";
	const trendReferenceImport = searchParams.get("trendReference") === "1";

	const [channels, setChannels] = useState<Channel[]>([]);
	const [channelId, setChannelId] = useState(channelParam);
	const [url, setUrl] = useState(searchParams.get("url") ?? "");
	const [name, setName] = useState(searchParams.get("name") ?? "");
	const [analysisMode, setAnalysisMode] =
		useState<ReferenceAnalysisMode>(readAnalysisModeParam(searchParams.get("mode")));

	const [analyzerReady, setAnalyzerReady] = useState<boolean | null>(null);
	const [job, setJob] = useState<AnalysisJob | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selectedCategoryId, setSelectedCategoryId] = useState(
		REFERENCE_CHANNEL_CATEGORIES[0]?.id ?? "",
	);
	const [channelCandidates, setChannelCandidates] = useState<
		ReferenceChannelCandidate[]
	>([]);
	const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
	const [scouting, setScouting] = useState(false);
	const [scoutError, setScoutError] = useState<string | null>(null);
	const [autoReferencing, setAutoReferencing] = useState(false);
	const [autoProgress, setAutoProgress] = useState<AutoReferenceProgress[]>([]);
	const [allCategoryReferencing, setAllCategoryReferencing] = useState(false);
	const [allCategoryProgress, setAllCategoryProgress] = useState<
		CategoryBatchProgress[]
	>([]);

	useEffect(() => {
		void checkAnalyzerHealth().then(setAnalyzerReady);
		supabase
			.from("channels")
			.select("*")
			.order("name")
			.then(({ data }) => {
				const list = (data ?? []) as Channel[];
				setChannels(list);
				if (!channelId && list.length > 0) setChannelId(list[0].id);
			});
	}, [channelId]);

	async function handleAnalyze() {
		if (!url.trim()) {
			setError("URL을 입력하세요.");
			return;
		}
		if (!channelId) {
			setError("채널을 선택하세요.");
			return;
		}
		setError(null);
		setJob(null);

		try {
			const started = await startYouTubeAnalysis(url.trim(), {
				mode: analysisMode,
			});
			setJob(started);
				const final = await waitForAnalysis(started.id, (j) => setJob(j), {
					timeoutMs:
						analysisMode === "deep"
							? 20 * 60 * 1000
							: analysisMode === "longform"
								? 3 * 60 * 1000
								: 10 * 60 * 1000,
				});
			setJob(final);
			if (final.status === "failed") {
				setError(final.error ?? "분석 실패");
				void cleanupAnalysisJob(final.id);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "분석 시작 실패");
		}
	}

	async function handleSave() {
		if (!job?.result) return;
		setSaving(true);
		setError(null);
			try {
				const resultToSave = trendReferenceImport
					? attachTrendReferenceSeedToAnalysisResult(job.result, {
							label: name.trim() || job.result.source_title || "트렌드 레퍼런스",
							sourceUrl: url.trim() || job.result.source_url,
							categoryId: searchParams.get("trendCategory") ?? undefined,
							evidence: splitTrendParam(searchParams.get("trendEvidence")),
							styleSignals: splitTrendParam(searchParams.get("trendStyle")),
						})
					: job.result;
				const saved = await saveReferenceTemplate(
					channelId,
					name.trim() || job.result.source_title || "이름 없음",
					resultToSave,
				);
			void cleanupAnalysisJob(job.id);
			navigate(`/references/${saved.id}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "저장 실패");
		} finally {
			setSaving(false);
		}
	}

	async function handleScoutCategory() {
		const category = selectedCategory;
		if (!category) return;
		setScouting(true);
		setScoutError(null);
		setAutoProgress([]);
		try {
			const candidates = await fetchReferenceChannelCandidates(category, {
				maxChannels: 6,
				resultsPerQuery: 10,
				daysBack: 730,
				order: "viewCount",
			});
			setChannelCandidates(candidates);
			setSelectedCandidateIds(candidates.slice(0, 3).map((candidate) => candidate.id));
			if (candidates.length === 0) {
				setScoutError("해당 카테고리에서 충분한 인기 채널 후보를 찾지 못했습니다.");
			}
		} catch (e) {
			setChannelCandidates([]);
			setSelectedCandidateIds([]);
			setScoutError(
				e instanceof Error
					? e.message
					: "카테고리 인기 채널을 불러오지 못했습니다.",
			);
		} finally {
			setScouting(false);
		}
	}

	function toggleCandidate(candidateId: string) {
		setSelectedCandidateIds((prev) =>
			prev.includes(candidateId)
				? prev.filter((id) => id !== candidateId)
				: [...prev, candidateId].slice(0, 4),
		);
	}

	async function handleAutoReferenceSelected() {
		if (!channelId) {
			setScoutError("저장할 채널을 먼저 선택하세요.");
			return;
		}
		const selected = channelCandidates.filter((candidate) =>
			selectedCandidateIds.includes(candidate.id),
		);
		if (selected.length === 0) {
			setScoutError("자동 레퍼런스화할 후보를 선택하세요.");
			return;
		}
		setAutoReferencing(true);
		setScoutError(null);
		setAutoProgress(
			selected.map((candidate) => ({
				candidateId: candidate.id,
				label: candidate.channelTitle,
				status: "queued",
				message: "대기 중",
			})),
		);

		for (const candidate of selected) {
			try {
					updateAutoProgress(candidate.id, {
						status: "analyzing",
						message: "대표 영상 deep 분석 중",
					});
					updateAutoProgress(candidate.id, {
						status: "saving",
						message: "deep 분석 후 템플릿 저장 중",
					});
				const saved = await analyzeAndSaveCandidate(candidate);
				updateAutoProgress(candidate.id, {
					status: "complete",
					message: saved.skipped ? "이미 저장됨" : "저장 완료",
					templateId: saved.id,
				});
			} catch (e) {
				updateAutoProgress(candidate.id, {
					status: "failed",
					message: e instanceof Error ? e.message : "자동 레퍼런스 실패",
				});
			}
		}

		setAutoReferencing(false);
	}

	async function handleAutoReferenceAllCategories() {
		if (!channelId) {
			setScoutError("저장할 채널을 먼저 선택하세요.");
			return;
		}
		setScoutError(null);
		setAllCategoryReferencing(true);
		setAllCategoryProgress(
			REFERENCE_CHANNEL_CATEGORIES.map((category) => ({
				categoryId: category.id,
				label: category.label,
				status: "queued",
				message: "대기 중",
				candidateCount: 0,
				savedCount: 0,
			})),
		);

		for (const category of REFERENCE_CHANNEL_CATEGORIES) {
			try {
				updateAllCategoryProgress(category.id, {
					status: "scouting",
					message: "인기 채널 검색 중",
					candidateCount: 0,
					savedCount: 0,
				});
				const candidates = await fetchReferenceChannelCandidates(category, {
					maxChannels: 6,
					resultsPerQuery: 10,
					daysBack: 730,
					order: "viewCount",
				});
				const candidatePool = candidates.slice(0, 6);
				const targetCount = Math.min(3, candidatePool.length);
				if (candidatePool.length === 0) {
					updateAllCategoryProgress(category.id, {
						status: "failed",
						message: "충분한 후보 없음",
						candidateCount: 0,
						savedCount: 0,
					});
					continue;
				}

				updateAllCategoryProgress(category.id, {
					status: "referencing",
					message: `상위 후보에서 ${targetCount}개 레퍼런스화 시작`,
					candidateCount: targetCount,
					savedCount: 0,
				});

				let savedCount = 0;
				let failedCount = 0;
				for (const [index, candidate] of candidatePool.entries()) {
					if (savedCount >= targetCount) break;
						updateAllCategoryProgress(category.id, {
							status: "referencing",
							message: `${index + 1}/${candidatePool.length} ${candidate.channelTitle} deep 분석·저장 중`,
							candidateCount: targetCount,
							savedCount,
						});
					try {
						await analyzeAndSaveCandidate(candidate);
						savedCount += 1;
						updateAllCategoryProgress(category.id, {
							status: "referencing",
							message: `${savedCount}/${targetCount} 저장 완료`,
							candidateCount: targetCount,
							savedCount,
						});
					} catch (candidateError) {
						failedCount += 1;
						updateAllCategoryProgress(category.id, {
							status: "referencing",
							message:
								candidateError instanceof Error
									? `${candidate.channelTitle} 실패: ${candidateError.message}`
									: `${candidate.channelTitle} 실패`,
							candidateCount: targetCount,
							savedCount,
						});
					}
				}

				updateAllCategoryProgress(category.id, {
					status: savedCount > 0 ? "complete" : "failed",
					message:
						failedCount > 0
							? `${savedCount}개 저장 완료 · ${failedCount}개 실패/건너뜀`
							: `${savedCount}개 저장 완료`,
					candidateCount: targetCount,
					savedCount,
				});
			} catch (e) {
				updateAllCategoryProgress(category.id, {
					status: "failed",
					message: e instanceof Error ? e.message : "일괄 레퍼런스 실패",
				});
			}
		}

		setAllCategoryReferencing(false);
	}

	async function analyzeAndSaveCandidate(candidate: ReferenceChannelCandidate): Promise<{
		id: string;
		skipped: boolean;
	}> {
		const existing = await findExistingReferenceTemplate(
			candidate.representativeUrl,
		);
		if (existing) return { id: existing.id, skipped: true };

			const analysisMode: ReferenceAnalysisMode = "deep";
			const started = await startYouTubeAnalysis(candidate.representativeUrl, {
				mode: analysisMode,
			});
			const final = await waitForAnalysis(started.id, undefined, {
				timeoutMs: 20 * 60 * 1000,
			});
		if (final.status === "failed" || !final.result) {
			throw new Error(final.error ?? "분석 실패");
		}
			const saved = await saveReferenceTemplate(
				channelId,
				buildReferenceTemplateName(candidate),
				attachTrendReferenceLearningToAnalysisResult(final.result, candidate),
			);
		void cleanupAnalysisJob(final.id);
		return { id: saved.id, skipped: false };
	}

	async function findExistingReferenceTemplate(
		sourceUrl: string,
	): Promise<{ id: string } | null> {
		const { data } = await supabase
			.from("reference_templates")
			.select("*")
			.eq("channel_id", channelId)
			.eq("source_url", sourceUrl)
			.maybeSingle();
		if (!data || typeof data.id !== "string") return null;
		return { id: data.id };
	}

	function updateAutoProgress(
		candidateId: string,
		patch: Partial<AutoReferenceProgress>,
	) {
		setAutoProgress((prev) =>
			prev.map((item) =>
				item.candidateId === candidateId ? { ...item, ...patch } : item,
			),
		);
	}

	function updateAllCategoryProgress(
		categoryId: string,
		patch: Partial<CategoryBatchProgress>,
	) {
		setAllCategoryProgress((prev) =>
			prev.map((item) =>
				item.categoryId === categoryId ? { ...item, ...patch } : item,
			),
		);
	}

	const selectedCategory =
		REFERENCE_CHANNEL_CATEGORIES.find(
			(category) => category.id === selectedCategoryId,
		) ?? REFERENCE_CHANNEL_CATEGORIES[0];
	const inProgress =
		job?.status && job.status !== "complete" && job.status !== "failed";
	const isLongformReference = Boolean(
		job?.result?.raw_analysis?.longform_reference,
	);

	return (
		<div
			className="relative mx-auto w-full max-w-[1180px] overflow-hidden rounded-[34px] border border-[#eadfce] bg-[#f7f0e4] p-4 text-[#191510] shadow-[0_28px_90px_rgba(54,39,20,.12)] sm:p-6 lg:p-8"
			style={{
				fontFamily:
					"'Pretendard', 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
				wordBreak: "keep-all",
			}}
		>
			<div className="pointer-events-none absolute inset-0">
				<div className="absolute left-[-10%] top-[-18%] h-80 w-80 rounded-full bg-[#e6b35a]/25 blur-3xl" />
				<div className="absolute right-[-12%] top-24 h-[28rem] w-[28rem] rounded-full bg-[#7aa8a0]/18 blur-3xl" />
				<div className="absolute inset-0 bg-[linear-gradient(rgba(25,21,16,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(25,21,16,.035)_1px,transparent_1px)] bg-[size:42px_42px] opacity-35" />
			</div>

			<div className="relative">
				<button
					type="button"
					onClick={() => navigate("/references")}
					className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#d9cbb7] bg-white/60 px-4 py-2 text-[13px] font-bold text-[#5b4b37] shadow-sm transition hover:-translate-y-0.5 hover:border-[#c7b28f] hover:bg-white"
				>
					<ArrowLeft size={14} /> 목록으로
				</button>

				<section className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
					<header className="rounded-[30px] border border-white/70 bg-[#fffaf1]/88 p-6 shadow-[0_24px_80px_rgba(85,64,34,.10)] sm:p-8">
						<div className="mb-5 inline-flex items-center gap-2 rounded-full bg-[#1f1a13] px-3 py-1.5 text-[10px] font-black uppercase tracking-[.22em] text-[#f2c96d]">
							<Sparkles size={13} />
							Reference intake
						</div>
						<h1 className="max-w-3xl text-balance text-[38px] font-black leading-[1.02] tracking-[-.055em] text-[#191510] sm:text-[54px]">
							긴 영상도 바로 제작 규칙으로 바꾸는 분석 작업대
						</h1>
						<p className="mt-5 max-w-2xl text-[15px] leading-7 text-[#6f6251]">
							쇼츠는 프레임과 오디오를 정밀하게 보고, 롱폼은 원본을
							통째로 복사하지 않고 구조, 길이, 챕터, 인기 구간을 템플릿으로
							변환합니다.
						</p>
					</header>

					<aside className="rounded-[30px] border border-[#ddceb9] bg-[#fff6e8]/92 p-6 text-[#1d1710] shadow-[0_24px_70px_rgba(85,64,34,.10)] sm:p-7">
						<div className="flex items-center gap-3">
							<div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#241f18] text-[#f2c96d]">
								<ShieldCheck size={22} />
							</div>
							<div>
								<p className="text-[11px] font-black uppercase tracking-[.22em] text-[#9a7a42]">
									사용 원칙
								</p>
								<h2 className="text-[24px] font-black tracking-[-.04em]">
									복사는 금지, 구조만 추출
								</h2>
							</div>
						</div>
						<div className="mt-6 grid gap-3 text-[13px] leading-6 text-[#6f6251]">
							<p>원본 프레임, 음악, 대사는 결과물에 직접 재사용하지 않습니다.</p>
							<p>저장되는 것은 컷 호흡, 자막 톤, BGM 방향, 대본 구조입니다.</p>
							<p>롱폼은 저장 후 콘텐츠 생성에서 주제만 바꿔 재사용합니다.</p>
						</div>
					</aside>
				</section>

				<CategoryScoutPanel
					selectedCategoryId={selectedCategoryId}
					onSelectCategory={(id) => {
						setSelectedCategoryId(id);
						setChannelCandidates([]);
						setSelectedCandidateIds([]);
						setScoutError(null);
						setAutoProgress([]);
					}}
					candidates={channelCandidates}
					selectedCandidateIds={selectedCandidateIds}
					scouting={scouting}
					scoutError={scoutError}
					autoReferencing={autoReferencing}
					autoProgress={autoProgress}
					allCategoryReferencing={allCategoryReferencing}
					allCategoryProgress={allCategoryProgress}
					analyzerReady={analyzerReady}
					onScout={handleScoutCategory}
					onToggleCandidate={toggleCandidate}
					onAutoReference={handleAutoReferenceSelected}
					onAutoReferenceAll={handleAutoReferenceAllCategories}
				/>

				<div className="mt-5 grid gap-5 xl:grid-cols-[.96fr_1.04fr]">
					<section className="rounded-[30px] border border-[#ddceb9] bg-[#fffaf1]/92 p-5 shadow-[0_22px_70px_rgba(85,64,34,.10)] sm:p-7">
						<div className="mb-6 flex items-center justify-between gap-4">
							<div>
								<p className="text-[11px] font-black uppercase tracking-[.22em] text-[#9a7a42]">
									01 Source
								</p>
								<h2 className="text-[26px] font-black tracking-[-.04em] text-[#1d1710]">
									분석할 영상 연결
								</h2>
							</div>
							<div className="hidden rounded-full bg-[#f1e5d2] px-3 py-1 text-[11px] font-bold text-[#6a5430] sm:block">
								{analyzerReady === false
									? "서버 대기"
									: analyzerReady === true
										? "분석 서버 연결됨"
										: "서버 확인 중"}
							</div>
						</div>

							{analyzerReady === false && (
								<PInlineNotification
									state="warning"
									heading="분석 서버가 꺼져 있습니다"
									description="터미널에서 npm run reference-analyzer 실행 후 새로고침하세요."
									dismissButton={false}
									className="mb-static-md"
								/>
							)}
							{trendReferenceImport && (
								<PInlineNotification
									state="info"
									heading="트렌드 레퍼런스 학습 모드"
									description="이 영상은 추천 순위에서 발견된 트렌드 후보입니다. 저장 시 별도 학습 메타데이터를 남겨 다음 제작의 명시지/암묵지에 반영합니다."
									dismissButton={false}
									className="mb-static-md"
								/>
							)}

							<div className="space-y-5">
							<PSelect
								name="channel"
								label="채널"
								value={channelId}
								onUpdate={(e) => setChannelId(String(e.detail.value ?? ""))}
							>
								{channels.map((ch) => (
									<PSelectOption key={ch.id} value={ch.id}>
										{ch.name}
									</PSelectOption>
								))}
							</PSelect>

							<PInputText
								name="url"
								label="YouTube URL"
								description="shorts, watch URL 모두 가능. 롱폼 레퍼런스는 최대 20분까지만 허용합니다."
								value={url}
								onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
								disabled={Boolean(inProgress)}
							>
								<span slot="start">
									<Tv size={16} className="text-[#80643b]" />
								</span>
							</PInputText>

							<div>
								<div className="mb-3 flex items-end justify-between gap-3">
									<div>
										<p className="text-[13px] font-black text-[#2b241b]">
											분석 방식
										</p>
										<p className="mt-1 text-[12px] leading-5 text-[#766853]">
											자동 감지가 기본값입니다. 특정 품질 확인이 필요할 때만 직접
											고르세요.
										</p>
									</div>
									<p className="hidden text-[11px] font-bold uppercase tracking-[.18em] text-[#a98a50] sm:block">
										{ANALYSIS_MODE_LABEL[analysisMode]}
									</p>
								</div>
									<div className="grid gap-3 md:grid-cols-4">
										{(["auto", "shortform", "longform", "deep"] as const).map((mode) => (
											<ModeButton
											key={mode}
											mode={mode}
											active={analysisMode === mode}
											disabled={Boolean(inProgress)}
											onClick={() => setAnalysisMode(mode)}
										/>
									))}
								</div>
							</div>

							<PInputText
								name="name"
								label="별칭 (선택)"
								description="없으면 영상 제목을 그대로 사용합니다."
								value={name}
								onInput={(e) => setName((e.target as HTMLInputElement).value)}
								disabled={Boolean(inProgress)}
							/>

							<div className="flex flex-col gap-3 border-t border-[#eadfce] pt-5 sm:flex-row sm:items-center sm:justify-between">
								<p className="text-[12px] leading-5 text-[#806f58]">
									저장 전까지는 템플릿으로 확정되지 않습니다.
								</p>
								<PButton
									onClick={handleAnalyze}
									loading={Boolean(inProgress)}
									disabled={!url.trim() || !channelId || analyzerReady === false}
								>
									분석 시작
								</PButton>
							</div>
						</div>
					</section>

					<section className="rounded-[30px] border border-[#ddceb9] bg-[#fdf6ea] p-5 shadow-[0_22px_70px_rgba(85,64,34,.09)] sm:p-7">
						<div className="mb-6 flex items-center gap-3">
							<div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#e6b35a] text-[#21180d]">
								<Clock size={21} />
							</div>
							<div>
								<p className="text-[11px] font-black uppercase tracking-[.22em] text-[#9a7a42]">
									02 Output
								</p>
								<h2 className="text-[26px] font-black tracking-[-.04em] text-[#1d1710]">
									결과 미리보기
								</h2>
							</div>
						</div>

						{error && (
							<PInlineNotification
								state="error"
								heading="오류"
								description={error}
								dismissButton={false}
								className="mb-static-md"
							/>
						)}

						{!job ? (
							<EmptyPreview />
						) : (
							<ResultPreview
								job={job}
								inProgress={Boolean(inProgress)}
								isLongformReference={isLongformReference}
								saving={saving}
								onReset={() => setJob(null)}
								onSave={handleSave}
							/>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}

function CategoryScoutPanel({
	selectedCategoryId,
	onSelectCategory,
	candidates,
	selectedCandidateIds,
	scouting,
	scoutError,
	autoReferencing,
	autoProgress,
	allCategoryReferencing,
	allCategoryProgress,
	analyzerReady,
	onScout,
	onToggleCandidate,
	onAutoReference,
	onAutoReferenceAll,
}: {
	selectedCategoryId: string;
	onSelectCategory: (id: string) => void;
	candidates: ReferenceChannelCandidate[];
	selectedCandidateIds: string[];
	scouting: boolean;
	scoutError: string | null;
	autoReferencing: boolean;
	autoProgress: AutoReferenceProgress[];
	allCategoryReferencing: boolean;
	allCategoryProgress: CategoryBatchProgress[];
	analyzerReady: boolean | null;
	onScout: () => void;
	onToggleCandidate: (id: string) => void;
	onAutoReference: () => void;
	onAutoReferenceAll: () => void;
}) {
	const selectedCategory =
		REFERENCE_CHANNEL_CATEGORIES.find(
			(category) => category.id === selectedCategoryId,
		) ?? REFERENCE_CHANNEL_CATEGORIES[0];
	const selectedCount = selectedCandidateIds.length;

	return (
		<section className="mt-5 rounded-[30px] border border-[#ddceb9] bg-[#fffaf1]/92 p-5 shadow-[0_22px_70px_rgba(85,64,34,.10)] sm:p-7">
			<div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<p className="text-[11px] font-black uppercase tracking-[.22em] text-[#9a7a42]">
						00 Auto scout
					</p>
					<h2 className="mt-1 text-[28px] font-black tracking-[-.045em] text-[#1d1710]">
						카테고리별 인기 채널 자동 레퍼런스
					</h2>
					<p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#766853]">
						카테고리를 고르면 YouTube 인기 영상 데이터를 모아 채널 단위로
						정리하고, 대표 영상을 기존 레퍼런스 분석기로 순차 저장합니다.
					</p>
				</div>
				<div className="flex flex-col gap-2 sm:flex-row">
					<PButton
						icon="search"
						onClick={onScout}
						loading={scouting}
						disabled={scouting || autoReferencing || allCategoryReferencing}
					>
						인기 채널 찾기
					</PButton>
					<PButton
						variant="secondary"
						icon="download"
						onClick={onAutoReferenceAll}
						loading={allCategoryReferencing}
						disabled={
							allCategoryReferencing ||
							autoReferencing ||
							scouting ||
							analyzerReady === false
						}
					>
						모든 카테고리 자동 템플릿화
					</PButton>
				</div>
			</div>

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
				{REFERENCE_CHANNEL_CATEGORIES.map((category) => (
					<CategoryButton
						key={category.id}
						category={category}
						active={category.id === selectedCategoryId}
						disabled={scouting || autoReferencing}
						onClick={() => onSelectCategory(category.id)}
					/>
				))}
			</div>

			{allCategoryProgress.length > 0 && (
				<div className="mt-5 rounded-[24px] border border-[#d9c2a2] bg-[#241f18] p-4 text-[#fff5df]">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p className="text-[10px] font-black uppercase tracking-[.22em] text-[#f2c96d]">
								Batch reference
							</p>
							<h3 className="mt-1 text-[18px] font-black tracking-[-.035em]">
								전체 카테고리 일괄 템플릿화
							</h3>
						</div>
						<span className="rounded-full bg-[#f2c96d] px-3 py-1 text-[11px] font-black text-[#21180d]">
							{
								allCategoryProgress.filter((item) => item.status === "complete")
									.length
							}
							/{allCategoryProgress.length} 완료
						</span>
					</div>
					<div className="mt-4 grid gap-2">
						{allCategoryProgress.map((item) => (
							<CategoryBatchProgressRow key={item.categoryId} item={item} />
						))}
					</div>
				</div>
			)}

			<div className="mt-5 rounded-[24px] border border-[#eadfce] bg-white/64 p-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div className="inline-flex items-center gap-2 rounded-full bg-[#f1e5d2] px-3 py-1 text-[11px] font-black text-[#7a5a22]">
							<Globe2 size={13} />
							{selectedCategory?.label}
						</div>
						<p className="mt-2 text-[13px] leading-6 text-[#6f6251]">
							{selectedCategory?.description}
						</p>
					</div>
					<div className="text-[12px] font-bold text-[#8b7657]">
						선택 {selectedCount}개 / 최대 4개
					</div>
				</div>

				{scoutError && (
					<PInlineNotification
						state="error"
						heading="카테고리 스캔 오류"
						description={scoutError}
						dismissButton={false}
						className="mt-static-md"
					/>
				)}

				{candidates.length === 0 ? (
					<div className="mt-4 grid min-h-[160px] place-items-center rounded-[22px] border border-dashed border-[#d7c4a8] bg-[#fffaf1]/70 p-5 text-center">
						<div>
							<Search className="mx-auto text-[#9a7a42]" size={24} />
							<p className="mt-3 text-[15px] font-black text-[#21180d]">
								아직 후보가 없습니다
							</p>
							<p className="mt-1 text-[12px] text-[#766853]">
								카테고리를 선택하고 인기 채널 찾기를 실행하세요.
							</p>
						</div>
					</div>
				) : (
					<div className="mt-4 grid gap-3 lg:grid-cols-2">
						{candidates.map((candidate) => (
							<CandidateCard
								key={candidate.id}
								candidate={candidate}
								selected={selectedCandidateIds.includes(candidate.id)}
								disabled={autoReferencing}
								onToggle={() => onToggleCandidate(candidate.id)}
							/>
						))}
					</div>
				)}

				<div className="mt-5 flex flex-col gap-3 border-t border-[#eadfce] pt-4 lg:flex-row lg:items-center lg:justify-between">
					<p className="text-[12px] leading-5 text-[#806f58]">
						자동 레퍼런스는 선택 후보의 대표 영상 URL을 분석하고 현재 채널에
						템플릿으로 저장합니다.
					</p>
					<PButton
						icon="download"
						onClick={onAutoReference}
						loading={autoReferencing}
						disabled={
							selectedCount === 0 ||
							autoReferencing ||
							scouting ||
							analyzerReady === false
						}
					>
						선택 후보 자동 레퍼런스 생성
					</PButton>
				</div>

				{autoProgress.length > 0 && (
					<div className="mt-4 grid gap-2">
						{autoProgress.map((item) => (
							<AutoProgressRow key={item.candidateId} item={item} />
						))}
					</div>
				)}
			</div>
		</section>
	);
}

function CategoryButton({
	category,
	active,
	disabled,
	onClick,
}: {
	category: (typeof REFERENCE_CHANNEL_CATEGORIES)[number];
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			aria-pressed={active}
			className={`min-h-[128px] rounded-[22px] border p-4 text-left transition duration-300 ${
				active
					? "border-[#b8831f] bg-[#241f18] text-[#fff5df] shadow-[0_18px_42px_rgba(36,31,24,.18)]"
					: "border-[#e2d4bf] bg-white/66 text-[#21180d] hover:-translate-y-0.5 hover:border-[#c6a66c] hover:bg-white"
			} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
		>
			<div className="flex items-center justify-between gap-2">
				<span
					className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[.14em] ${
						active ? "bg-[#f2c96d] text-[#21180d]" : "bg-[#f2e6d2] text-[#8a6831]"
					}`}
				>
					{category.modeHint}
				</span>
				<TrendingUp
					size={16}
					className={active ? "text-[#f2c96d]" : "text-[#9a7a42]"}
				/>
			</div>
			<div className="mt-4 text-[15px] font-black tracking-[-.03em]">
				{category.label}
			</div>
			<p
				className={`mt-2 text-[12px] leading-5 ${
					active ? "text-[#e8dac2]" : "text-[#766853]"
				}`}
			>
				{category.description}
			</p>
		</button>
	);
}

function CandidateCard({
	candidate,
	selected,
	disabled,
	onToggle,
}: {
	candidate: ReferenceChannelCandidate;
	selected: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			disabled={disabled}
			aria-pressed={selected}
			className={`rounded-[22px] border p-4 text-left transition duration-300 ${
				selected
					? "border-[#b8831f] bg-[#fff3d7] shadow-[0_16px_34px_rgba(167,115,26,.14)]"
					: "border-[#e3d5c0] bg-white/76 hover:-translate-y-0.5 hover:border-[#c6a66c]"
			} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2">
						<div
							className={`grid h-7 w-7 place-items-center rounded-full ${
								selected ? "bg-[#241f18] text-[#f2c96d]" : "bg-[#f1e5d2] text-[#7a5a22]"
							}`}
						>
							{selected ? <Check size={15} /> : <Users size={15} />}
						</div>
						<p className="text-[15px] font-black tracking-[-.03em] text-[#1d1710]">
							{candidate.channelTitle}
						</p>
					</div>
					<p className="mt-2 line-clamp-2 text-[13px] leading-5 text-[#5f523f]">
						{candidate.representativeVideo.title}
					</p>
				</div>
				<span className="rounded-full bg-[#241f18] px-2.5 py-1 text-[11px] font-black text-[#f2c96d]">
					{candidate.score}
				</span>
			</div>

			<div className="mt-4 grid gap-2 text-[12px] text-[#6f6251] sm:grid-cols-2">
				<span>{formatCandidateMetric(candidate)}</span>
				<span>
					영상 {candidate.videoCount}개 · 롱폼{" "}
					{Math.round(candidate.longformShare * 100)}%
				</span>
			</div>
				<div className="mt-3 flex flex-wrap gap-2">
					<span className="rounded-full bg-[#f1e5d2] px-2.5 py-1 text-[11px] font-bold text-[#7a5a22]">
						deep 실행 · 추천 {candidate.suggestedMode}
					</span>
				{candidate.sourceQueries.slice(0, 2).map((query) => (
					<span
						key={query}
						className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#8b7657]"
					>
						{query}
					</span>
				))}
			</div>
		</button>
	);
}

function AutoProgressRow({ item }: { item: AutoReferenceProgress }) {
	const isComplete = item.status === "complete";
	const isFailed = item.status === "failed";
	return (
		<div
			className={`flex items-center justify-between gap-3 rounded-[16px] border px-3 py-2 text-[12px] ${
				isFailed
					? "border-[#f1b7a8] bg-[#fff0eb] text-[#8b2f1d]"
					: isComplete
						? "border-[#b8d8bd] bg-[#effaf0] text-[#23552b]"
						: "border-[#eadfce] bg-[#fffaf1] text-[#6f6251]"
			}`}
		>
			<span className="font-bold">{item.label}</span>
			<span className="flex items-center gap-2">
				{item.status === "analyzing" || item.status === "saving" ? (
					<RefreshCw size={13} className="animate-spin" />
				) : null}
				{item.message}
			</span>
		</div>
	);
}

function CategoryBatchProgressRow({ item }: { item: CategoryBatchProgress }) {
	const isComplete = item.status === "complete";
	const isFailed = item.status === "failed";
	const isActive = item.status === "scouting" || item.status === "referencing";
	return (
		<div
			className={`flex flex-col gap-2 rounded-[16px] border px-3 py-3 text-[12px] sm:flex-row sm:items-center sm:justify-between ${
				isFailed
					? "border-[#ffb09d]/40 bg-[#5b2016] text-[#ffd7cc]"
					: isComplete
						? "border-[#bfe0a8]/30 bg-[#173d20] text-[#dff7d7]"
						: "border-white/10 bg-white/[.06] text-[#eadcc6]"
			}`}
		>
			<div className="flex items-center gap-2">
				{isActive ? <RefreshCw size={13} className="animate-spin" /> : null}
				<span className="font-black text-[#fff5df]">{item.label}</span>
				<span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold">
					{item.savedCount}/{item.candidateCount || "-"}
				</span>
			</div>
			<span className="leading-5">{item.message}</span>
		</div>
	);
}

function ModeButton({
	mode,
	active,
	disabled,
	onClick,
}: {
	mode: ReferenceAnalysisMode;
	active: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	const detail = MODE_DETAILS[mode];
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className={`group min-h-[142px] rounded-[24px] border p-4 text-left transition duration-300 ${
				active
					? "border-[#b8831f] bg-gradient-to-br from-[#f3ce74] to-[#f2e2c4] text-[#21180d] shadow-[0_18px_42px_rgba(167,115,26,.18)]"
					: "border-[#e2d4bf] bg-white/70 text-[#2b241b] hover:-translate-y-0.5 hover:border-[#c6a66c] hover:bg-white"
			} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
			aria-pressed={active}
		>
			<div className="flex items-center justify-between gap-3">
				<span
					className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.18em] ${
						active ? "bg-[#21180d] text-[#f3ce74]" : "bg-[#f2e6d2] text-[#8a6831]"
					}`}
				>
					{detail.eyebrow}
				</span>
				<span
					className={`text-[10px] font-bold uppercase tracking-[.16em] ${
						active ? "text-[#6b5430]" : "text-[#a69782]"
					}`}
				>
					{detail.badge}
				</span>
			</div>
			<div className="mt-5 text-[17px] font-black tracking-[-.03em]">
				{ANALYSIS_MODE_LABEL[mode]}
			</div>
			<p
				className={`mt-2 text-[12px] leading-5 ${
					active ? "text-[#5b4b37]" : "text-[#766853]"
				}`}
			>
				{detail.description}
			</p>
		</button>
	);
}

function EmptyPreview() {
	return (
		<div className="grid min-h-[420px] place-items-center rounded-[26px] border border-dashed border-[#d7c4a8] bg-[#fffaf1]/75 p-7 text-center">
			<div>
				<div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#241f18] text-[#f2c96d] shadow-[0_18px_50px_rgba(36,31,24,.18)]">
					<Sparkles size={24} />
				</div>
				<h3 className="mt-5 text-[24px] font-black tracking-[-.04em] text-[#21180d]">
					분석 결과가 여기에 쌓입니다
				</h3>
				<p className="mx-auto mt-3 max-w-sm text-[14px] leading-6 text-[#766853]">
					URL을 넣고 분석을 시작하면 길이, 씬 수, 훅, 자막, BGM, TTS 톤을
					한 번에 확인할 수 있습니다.
				</p>
			</div>
		</div>
	);
}

function ResultPreview({
	job,
	inProgress,
	isLongformReference,
	saving,
	onReset,
	onSave,
}: {
	job: AnalysisJob;
	inProgress: boolean;
	isLongformReference: boolean;
	saving: boolean;
	onReset: () => void;
	onSave: () => void;
}) {
	const productionDna = productionDnaFromRawAnalysis(job.result?.raw_analysis);

	return (
		<div className="rounded-[26px] border border-[#e3d5c0] bg-white/72 p-4 sm:p-5">
			<div className="flex items-center gap-3">
				<div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#241f18] text-[#f2c96d]">
					{inProgress ? (
						<PSpinner size="small" />
					) : job.status === "complete" ? (
						<CheckCircle2 size={21} />
					) : (
						<Clock size={20} />
					)}
				</div>
				<div>
					<PText className="font-semibold">{STATUS_LABEL[job.status]}</PText>
					<PText size="x-small" color="neutral-contrast-medium">
						진행률 {job.progress}%
					</PText>
				</div>
			</div>

			<div className="mt-5 h-2.5 w-full overflow-hidden rounded-full bg-[#eadfce]">
				<div
					className="h-full rounded-full bg-gradient-to-r from-[#1f1a13] via-[#9a6a17] to-[#e6b35a] transition-all duration-500"
					style={{ width: `${job.progress}%` }}
				/>
			</div>

			{job.result && (
				<div className="mt-6 space-y-5 border-t border-[#eadfce] pt-5">
					{isLongformReference && (
						<PInlineNotification
							state="info"
							heading="롱폼 자동 레퍼런스"
							description="원본을 다운로드하거나 복사하지 않고 제목, 설명, 챕터, 길이, 인기 구간으로 대본·TTS·BGM·편집 규칙을 만들었습니다."
							dismissButton={false}
						/>
					)}

					<div>
						<p className="text-[11px] font-black uppercase tracking-[.2em] text-[#9a7a42]">
							Reference DNA
						</p>
						<h3 className="mt-2 text-[22px] font-black leading-tight tracking-[-.04em] text-[#1d1710]">
							{job.result.source_title || "제목 없음"}
						</h3>
						<p className="mt-2 text-[13px] text-[#766853]">
							{job.result.source_creator || "제작자 정보 없음"}
						</p>
					</div>

					<div className="grid grid-cols-2 gap-3 text-sm">
						<Stat
							label="길이"
							value={`${Math.round(job.result.duration_seconds)}초`}
						/>
						<Stat
							label="씬 수 / 평균 길이"
							value={`${job.result.scene_count}개 / ${job.result.avg_scene_duration.toFixed(1)}초`}
						/>
						<Stat label="무드" value={job.result.visual_mood} />
						<Stat label="페이싱" value={job.result.pacing_preset} />
						<Stat
							label="자막 위치/크기"
							value={`${job.result.subtitle_position} / ${job.result.subtitle_size_preset}`}
						/>
						<Stat label="전환 스타일" value={job.result.transition_style} />
						<Stat label="BGM 무드" value={job.result.bgm_mood} />
						<Stat label="훅 패턴" value={job.result.hook_pattern} />
					</div>

					{productionDna && <ProductionDnaPanel dna={productionDna} />}

					{job.result.dominant_colors.length > 0 && (
						<div>
							<p className="text-[12px] font-black text-[#2b241b]">
								도미넌트 컬러
							</p>
							<div className="mt-2 flex gap-2">
								{job.result.dominant_colors.slice(0, 6).map((c) => (
									<div
										key={c}
										className="h-9 w-9 rounded-full border border-[#cbb99e] shadow-sm"
										style={{ backgroundColor: c }}
										title={c}
									/>
								))}
							</div>
						</div>
					)}

					{job.result.visual_prompt_template && (
						<PreviewText
							label="시각 프롬프트 템플릿"
							value={job.result.visual_prompt_template}
						/>
					)}

					{job.result.transcript && (
						<PreviewText label="전사/메타데이터 발췌" value={job.result.transcript} />
					)}

					<div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
						<PButton variant="secondary" onClick={onReset}>
							다시 분석
						</PButton>
						<PButton onClick={onSave} loading={saving}>
							템플릿으로 저장
						</PButton>
					</div>
				</div>
			)}
		</div>
	);
}

function ProductionDnaPanel({ dna }: { dna: Record<string, unknown> }) {
	const camera = nestedRecord(dna, "camera");
	const layout = nestedRecord(dna, "layout");
	const transitions = nestedRecord(dna, "transitions");
	const subtitles = nestedRecord(dna, "subtitles");
	const audio = nestedRecord(dna, "audio");
	const color = nestedRecord(dna, "color");
	const rules = stringArray(transitions?.rules).slice(0, 3);
	const cutDensity =
		typeof camera?.cutDensityPerMinute === "number"
			? `${camera.cutDensityPerMinute}컷/분`
			: "-";

	return (
		<div className="rounded-[24px] border border-[#d9c2a2] bg-[#241f18] p-4 text-[#fff5df] shadow-[0_18px_48px_rgba(36,31,24,.16)]">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="text-[10px] font-black uppercase tracking-[.22em] text-[#f2c96d]">
						Production DNA
					</p>
					<h4 className="mt-1 text-[18px] font-black tracking-[-.035em]">
						픽셀·오디오·편집 분석
					</h4>
				</div>
				<span className="rounded-full bg-[#f2c96d] px-3 py-1 text-[11px] font-black text-[#21180d]">
					{stringField(dna.analysisDepth) || "style map"}
				</span>
			</div>

			<div className="mt-4 grid grid-cols-2 gap-2 text-[12px] lg:grid-cols-3">
				<DnaStat label="카메라" value={stringField(camera?.mode) || "-"} />
				<DnaStat label="컷 밀도" value={cutDensity} />
				<DnaStat
					label="화면 배치"
					value={stringField(layout?.compositionPattern) || "-"}
				/>
				<DnaStat
					label="피사체 위치"
					value={stringField(layout?.subjectZone) || "-"}
				/>
				<DnaStat
					label="자막 위험"
					value={stringField(subtitles?.collisionRisk) || "-"}
				/>
				<DnaStat
					label="색 온도"
					value={stringField(color?.temperature) || "-"}
				/>
				<DnaStat
					label="BGM"
					value={`${stringField(audio?.bgmMood) || "-"} / ${stringField(audio?.bgmTempo) || "-"}`}
				/>
				<DnaStat
					label="음량"
					value={
						typeof audio?.integratedLufs === "number"
							? `${audio.integratedLufs} LUFS`
							: "-"
					}
				/>
				<DnaStat
					label="전환"
					value={`${stringField(transitions?.style) || "-"} / ${stringField(transitions?.density) || "-"}`}
				/>
			</div>

			{rules.length > 0 && (
				<div className="mt-4 rounded-[18px] border border-white/10 bg-white/[.06] p-3">
					<p className="text-[11px] font-black text-[#f2c96d]">전환 규칙</p>
					<div className="mt-2 grid gap-1.5 text-[12px] leading-5 text-[#eadcc6]">
						{rules.map((rule) => (
							<p key={rule}>{rule}</p>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function DnaStat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[16px] border border-white/10 bg-white/[.06] p-3">
			<p className="text-[10px] font-black uppercase tracking-[.12em] text-[#d7b46a]">
				{label}
			</p>
			<p className="mt-1 truncate text-[12px] font-bold text-[#fff5df]">
				{value || "-"}
			</p>
		</div>
	);
}

function PreviewText({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[20px] border border-[#eadfce] bg-[#fffaf1] p-4">
			<p className="text-[12px] font-black text-[#2b241b]">{label}</p>
			<p className="mt-2 line-clamp-4 text-[13px] leading-6 text-[#675947]">
				{value}
			</p>
		</div>
	);
}

function productionDnaFromRawAnalysis(
	raw: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const dna = raw?.production_dna;
	return dna && typeof dna === "object" && !Array.isArray(dna)
		? (dna as Record<string, unknown>)
		: undefined;
}

function nestedRecord(
	record: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	const value = record?.[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[18px] border border-[#eadfce] bg-[#fffaf1] p-3">
			<PText size="x-small" color="neutral-contrast-medium">
				{label}
			</PText>
			<PText size="small" className="font-semibold">
				{value || "-"}
			</PText>
		</div>
	);
}
