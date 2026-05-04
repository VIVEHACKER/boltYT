import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	deleteReferenceTemplate,
	listReferenceTemplates,
} from "../../lib/reference-import";
import {
	calculateGeneratedReferenceTemplateCoverage,
	formatReferenceOutputFormats,
	getReferenceTemplateQuality,
	getReferenceTemplateMethodDescription,
	getReferenceTemplateMethodLabel,
	getReferenceTemplateReadiness,
	getReferenceTemplateRecommendedMode,
	isBuiltInReference,
} from "../../lib/reference-template-presets";
import { supabase } from "../../lib/supabase";
import type { Channel, ReferenceTemplate } from "../../types/database";

type TemplateTone = {
	accent: string;
	accentSoft: string;
	aura: string;
	label: string;
};

const TEMPLATE_TONES: TemplateTone[] = [
	{
		accent: "#f1c75b",
		accentSoft: "rgba(241, 199, 91, 0.14)",
		aura: "radial-gradient(circle at 28% 18%, rgba(241,199,91,.48), transparent 34%), linear-gradient(145deg, #17120a, #101316 58%, #07080a)",
		label: "clip system",
	},
	{
		accent: "#8fd6c8",
		accentSoft: "rgba(143, 214, 200, 0.14)",
		aura: "radial-gradient(circle at 70% 20%, rgba(143,214,200,.42), transparent 32%), linear-gradient(145deg, #071716, #121415 62%, #07080a)",
		label: "mystery map",
	},
	{
		accent: "#d6a6ff",
		accentSoft: "rgba(214, 166, 255, 0.14)",
		aura: "radial-gradient(circle at 36% 16%, rgba(214,166,255,.38), transparent 30%), linear-gradient(145deg, #17101d, #111418 64%, #07080a)",
		label: "story cuts",
	},
	{
		accent: "#ff9f6e",
		accentSoft: "rgba(255, 159, 110, 0.14)",
		aura: "radial-gradient(circle at 72% 26%, rgba(255,159,110,.38), transparent 33%), linear-gradient(145deg, #1b100c, #111418 64%, #07080a)",
		label: "news edit",
	},
	{
		accent: "#e6b35a",
		accentSoft: "rgba(230, 179, 90, 0.14)",
		aura: "radial-gradient(circle at 28% 18%, rgba(230,179,90,.42), transparent 30%), radial-gradient(circle at 78% 16%, rgba(59,130,246,.26), transparent 36%), linear-gradient(145deg, #16100b, #121722 62%, #07080a)",
		label: "feature recap",
	},
];

function getTone(template: ReferenceTemplate, index: number): TemplateTone {
	const fingerprint = `${template.name} ${template.visual_mood}`.toLowerCase();
	if (fingerprint.includes("social") || fingerprint.includes("소셜")) {
		return TEMPLATE_TONES[0];
	}
	if (fingerprint.includes("mystery") || fingerprint.includes("미스터리")) {
		return TEMPLATE_TONES[1];
	}
	if (fingerprint.includes("news") || fingerprint.includes("뉴스")) {
		return TEMPLATE_TONES[3];
	}
	if (
		fingerprint.includes("drama") ||
		fingerprint.includes("movie") ||
		fingerprint.includes("드라마") ||
		fingerprint.includes("영화") ||
		fingerprint.includes("몰아보기")
	) {
		return TEMPLATE_TONES[4];
	}
	return TEMPLATE_TONES[index % TEMPLATE_TONES.length];
}

function cardSpan(index: number): string {
	if (index === 0) return "xl:col-span-7";
	if (index === 1) return "xl:col-span-5";
	return "xl:col-span-6";
}

function moodLabel(mood: ReferenceTemplate["visual_mood"]): string {
	const labels: Record<ReferenceTemplate["visual_mood"], string> = {
		horror: "호러",
		mystery: "미스터리",
		news: "뉴스",
		neutral: "뉴트럴",
		warm: "웜톤",
	};
	return labels[mood] ?? mood;
}

function pacingLabel(pacing: ReferenceTemplate["pacing_preset"]): string {
	const labels: Record<ReferenceTemplate["pacing_preset"], string> = {
		fast: "빠른 컷",
		medium: "중간 템포",
		slow: "느린 호흡",
	};
	return labels[pacing] ?? pacing;
}

function transitionLabel(
	transition: ReferenceTemplate["transition_style"],
): string {
	const labels: Record<ReferenceTemplate["transition_style"], string> = {
		hardcut: "하드컷",
		crossfade: "크로스페이드",
		zoom: "줌",
		mixed: "혼합 전환",
	};
	return labels[transition] ?? transition;
}

function isGeneratedReference(template: ReferenceTemplate): boolean {
	const raw = template.raw_analysis;
	return Boolean(
		raw &&
			typeof raw === "object" &&
			!Array.isArray(raw) &&
			(raw as { generated_reference?: unknown }).generated_reference === true,
	);
}

export default function ReferenceListPage() {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const channelParam = searchParams.get("channel") ?? "";

	const [channels, setChannels] = useState<Channel[]>([]);
	const [selectedChannelId, setSelectedChannelId] = useState(channelParam);
	const [templates, setTemplates] = useState<ReferenceTemplate[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		supabase
			.from("channels")
			.select("*")
			.order("name")
			.then(({ data }) => {
				const list = (data ?? []) as Channel[];
				setChannels(list);
				if (!selectedChannelId && list.length > 0) {
					setSelectedChannelId(list[0].id);
				}
			});
	}, [selectedChannelId]);

	const loadTemplates = useCallback(async () => {
		if (!selectedChannelId) {
			setTemplates([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const list = await listReferenceTemplates(selectedChannelId);
			setTemplates(list);
		} catch (e) {
			setError(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.");
		} finally {
			setLoading(false);
		}
	}, [selectedChannelId]);

	useEffect(() => {
		void loadTemplates();
	}, [loadTemplates]);

	const stats = useMemo(() => {
		const builtInCount = templates.filter(isBuiltInReference).length;
		const generatedCoverage = calculateGeneratedReferenceTemplateCoverage(
			templates.filter(isGeneratedReference),
		);
		const avgScenes =
			templates.length > 0
				? Math.round(
						templates.reduce((sum, template) => sum + template.scene_count, 0) /
							templates.length,
					)
				: 0;
		const avgQuality =
			templates.length > 0
				? Math.round(
						templates.reduce(
							(sum, template) => sum + getReferenceTemplateQuality(template).score,
							0,
						) / templates.length,
					)
				: 0;
		return {
			total: templates.length,
			builtInCount,
			savedCount: Math.max(0, templates.length - builtInCount),
			avgScenes,
			avgQuality,
			generatedCoverage,
		};
	}, [templates]);

	function handleChannelChange(id: string) {
		setSelectedChannelId(id);
		setSearchParams((params) => {
			params.set("channel", id);
			return params;
		});
	}

	async function handleDelete(id: string, name: string) {
		if (!confirm(`"${name || "(이름 없음)"}" 템플릿을 삭제할까요?`)) return;
		try {
			await deleteReferenceTemplate(id);
			setTemplates((prev) => prev.filter((t) => t.id !== id));
		} catch (e) {
			setError(e instanceof Error ? e.message : "삭제 실패");
		}
	}

	function contentUrlFor(template: ReferenceTemplate) {
		const params = new URLSearchParams({
			template: template.id,
			mode: getReferenceTemplateRecommendedMode(template),
		});
		if (selectedChannelId) params.set("channel", selectedChannelId);
		return `/content/new?${params.toString()}`;
	}

	return (
		<div
			className="relative mx-auto w-full max-w-[1440px] overflow-hidden rounded-[36px] bg-[#07090c] px-4 py-5 text-[#f7f2e8] shadow-[0_32px_120px_rgba(0,0,0,.35)] sm:px-6 sm:py-7 lg:px-8"
			style={{
				fontFamily:
					"'Pretendard', 'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
				wordBreak: "keep-all",
			}}
		>
			<div className="pointer-events-none absolute inset-0 opacity-80">
				<div className="absolute -top-40 left-1/4 h-80 w-80 rounded-full bg-[#f1c75b]/20 blur-3xl" />
				<div className="absolute right-[-10%] top-24 h-[28rem] w-[28rem] rounded-full bg-[#5dc7b0]/12 blur-3xl" />
				<div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] bg-[size:44px_44px] opacity-25" />
			</div>

			<div className="relative">
				<header className="grid gap-5 rounded-[30px] border border-white/10 bg-white/[0.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] sm:p-7 lg:grid-cols-[1.25fr_.75fr] lg:p-9">
					<div>
						<div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[.24em] text-[#f1c75b]">
							<span className="h-1.5 w-1.5 rounded-full bg-[#f1c75b]" />
							Reference vault
						</div>
						<h1 className="max-w-4xl text-balance text-[42px] font-black leading-[1.04] tracking-[-.065em] text-[#fffaf0] sm:text-[58px] lg:text-[72px]">
							검증한 영상 방식을 바로 꺼내 쓰는 제작 보관함
						</h1>
						<p className="mt-5 max-w-2xl text-[15px] leading-7 text-[#bcb4a5] sm:text-[16px]">
							레퍼런스는 단순 저장이 아니라 제작 규칙입니다. 포맷, 페이싱,
							컷 구조, 실제 영상 슬롯까지 고정해두고 다음 영상에서는 주제만
							바꿔 시작합니다.
						</p>
						<div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
							<button
								type="button"
								onClick={() =>
									navigate(
										`/references/import${selectedChannelId ? `?channel=${selectedChannelId}` : ""}`,
									)
								}
								className="group inline-flex w-full items-center justify-between rounded-full bg-[#f1c75b] px-5 py-3 text-[14px] font-black text-[#11100c] shadow-[0_16px_42px_rgba(241,199,91,.22)] transition-all duration-500 ease-[cubic-bezier(.22,1,.36,1)] hover:-translate-y-0.5 hover:bg-[#ffd76d] active:scale-[.98] sm:w-auto"
							>
								새 레퍼런스 분석
								<span className="ml-4 grid h-8 w-8 place-items-center rounded-full bg-[#11100c]/10 transition-transform duration-500 group-hover:translate-x-1">
									+
								</span>
							</button>
							<div className="text-[12px] font-medium text-[#8d877c]">
								내장 {stats.builtInCount}개 · 저장 {stats.savedCount}개 · 평균{" "}
								{stats.avgScenes || 0}씬 · Q{stats.avgQuality || 0}
							</div>
						</div>
					</div>

					<aside className="rounded-[26px] border border-white/10 bg-[#0d1116]/85 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.08)] sm:p-5">
						<div className="flex items-center justify-between gap-3">
							<div>
								<div className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#8d877c]">
									active channel
								</div>
								<div className="mt-1 text-[18px] font-black text-[#fffaf0]">
									{channels.find((channel) => channel.id === selectedChannelId)
										?.name ?? "채널 선택"}
								</div>
							</div>
							<div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f1c75b]/15 text-[20px] font-black text-[#f1c75b]">
								{stats.total}
							</div>
						</div>
						<label className="mt-5 block text-[12px] font-semibold text-[#bcb4a5]">
							채널
							<select
								name="channel"
								value={selectedChannelId}
								onChange={(event) => handleChannelChange(event.target.value)}
								className="mt-2 w-full rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-[14px] font-semibold text-[#fffaf0] outline-none transition-all duration-500 ease-[cubic-bezier(.22,1,.36,1)] focus:border-[#f1c75b]/70 focus:ring-4 focus:ring-[#f1c75b]/10"
							>
								{channels.map((ch) => (
									<option key={ch.id} value={ch.id} className="bg-[#111418]">
										{ch.name}
									</option>
								))}
							</select>
						</label>
						<div className="mt-5 grid grid-cols-3 gap-2">
							<Metric value={String(stats.total)} label="전체" />
							<Metric value={String(stats.builtInCount)} label="내장" />
							<Metric value={`Q${stats.avgQuality || 0}`} label="평균 품질" />
						</div>
						<GeneratedCoveragePanel coverage={stats.generatedCoverage} />
					</aside>
				</header>

				{error && (
					<div className="mt-5 rounded-3xl border border-[#ff7878]/30 bg-[#331111]/80 px-5 py-4 text-[14px] font-semibold text-[#ffd5d5]">
						{error}
					</div>
				)}

				{loading ? (
					<div className="mt-7 grid grid-cols-1 gap-5 xl:grid-cols-12">
						{Array.from({ length: 4 }).map((_, index) => (
							<SkeletonCard key={index} className={cardSpan(index)} />
						))}
					</div>
				) : templates.length === 0 ? (
					<EmptyState selectedChannelId={selectedChannelId} />
				) : (
					<section className="mt-7 grid grid-cols-1 gap-5 xl:grid-cols-12">
						{templates.map((template, index) => (
							<TemplateCard
								key={template.id}
								template={template}
								index={index}
								className={cardSpan(index)}
								onOpen={() => navigate(`/references/${template.id}`)}
								onCreate={() => navigate(contentUrlFor(template))}
								onDelete={() => void handleDelete(template.id, template.name)}
							/>
						))}
					</section>
				)}
			</div>
		</div>
	);
}

function GeneratedCoveragePanel({
	coverage,
}: {
	coverage: ReturnType<typeof calculateGeneratedReferenceTemplateCoverage>;
}) {
	return (
		<div
			className="mt-4 rounded-[22px] border border-[#f1c75b]/20 bg-[#f1c75b]/10 p-3"
			data-testid="generated-reference-coverage"
		>
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="text-[10px] font-black uppercase tracking-[.18em] text-[#f1c75b]">
						auto references
					</div>
						<div className="mt-1 text-[13px] font-black text-[#fffaf0]">
							자동 생성 레퍼런스 {coverage.total}개 · Q{coverage.qualityAvg} · K
							{coverage.knowledgeAvg}
					</div>
				</div>
				<div className="rounded-full bg-[#f1c75b] px-3 py-1 text-[11px] font-black text-[#11100c]">
					{coverage.deep}/{coverage.total} deep
				</div>
				<div className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-black text-[#fffaf0]">
					{coverage.categories.filter((category) => category.count >= 22).length}/
					{coverage.categories.length} 완료
				</div>
				</div>
				<div className="mt-3 grid grid-cols-3 gap-2">
					<MiniMetric value={`${coverage.shorts}`} label="쇼츠" />
					<MiniMetric value={`${coverage.longform}`} label="롱폼" />
					<MiniMetric value={`${coverage.over20}`} label="20분초과" />
				</div>
				<div className="mt-2 grid grid-cols-3 gap-2">
					<MiniMetric value={`${coverage.ready}`} label="즉시 사용" />
					<MiniMetric value={`${coverage.review}`} label="보강 검토" />
					<MiniMetric
						value={`${coverage.outcomeCalibrated}`}
						label="성과 반영"
					/>
				</div>
				<div className="mt-3 grid gap-2">
					{coverage.categories.map((category) => (
						<div
							key={category.id}
							className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 rounded-full bg-black/18 px-3 py-1.5 text-[11px]"
						>
							<span className="font-bold text-[#d8d0c2]">{category.label}</span>
							<span className="font-black tabular-nums text-[#f1c75b]">
								{category.deep}/{category.count}
							</span>
							<span className="font-black tabular-nums text-[#9de2d3]">
								Q{category.qualityAvg}
							</span>
							<span className="font-black tabular-nums text-[#fffaf0]">
								K{category.knowledgeAvg}
							</span>
						</div>
					))}
				</div>
		</div>
	);
}

function MiniMetric({ value, label }: { value: string; label: string }) {
	return (
		<div className="rounded-2xl bg-black/18 px-3 py-2">
			<div className="text-[15px] font-black tabular-nums text-[#fffaf0]">
				{value}
			</div>
			<div className="text-[10px] font-bold text-[#8d877c]">{label}</div>
		</div>
	);
}

function Metric({ value, label }: { value: string; label: string }) {
	return (
		<div className="rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-3">
			<div className="text-[20px] font-black tabular-nums text-[#fffaf0]">
				{value}
			</div>
			<div className="mt-0.5 text-[11px] font-semibold text-[#8d877c]">
				{label}
			</div>
		</div>
	);
}

function TemplateCard({
	template,
	index,
	className,
	onOpen,
	onCreate,
	onDelete,
}: {
	template: ReferenceTemplate;
	index: number;
	className: string;
	onOpen: () => void;
	onCreate: () => void;
	onDelete: () => void;
}) {
	const builtIn = isBuiltInReference(template);
	const methodLabel = getReferenceTemplateMethodLabel(template);
	const methodDescription = getReferenceTemplateMethodDescription(template);
	const quality = getReferenceTemplateQuality(template);
	const readiness = getReferenceTemplateReadiness(template);
	const tone = getTone(template, index);

	function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			onOpen();
		}
	}

	return (
		<article
			className={`${className} group relative rounded-[32px] bg-white/[0.08] p-[1px] shadow-[0_24px_80px_rgba(0,0,0,.28)] transition-all duration-700 ease-[cubic-bezier(.22,1,.36,1)] hover:-translate-y-1 hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f1c75b]/25`}
			onClick={onOpen}
			onKeyDown={handleKeyDown}
			role="button"
			tabIndex={0}
		>
			<div className="relative flex h-full min-h-[390px] flex-col overflow-hidden rounded-[31px] bg-[#101316] shadow-[inset_0_1px_0_rgba(255,255,255,.08)]">
				<TemplatePoster template={template} tone={tone} />

				<div className="flex flex-1 flex-col p-5 sm:p-6">
					<div className="mb-4 flex flex-wrap gap-2">
						{builtIn && <Tag>내장</Tag>}
							<Tag>Q{quality.score}</Tag>
							<Tag>{quality.grade}</Tag>
							<Tag>{readiness.label}</Tag>
							<Tag>{formatReferenceOutputFormats(template)}</Tag>
						<Tag>{moodLabel(template.visual_mood)}</Tag>
						<Tag>{pacingLabel(template.pacing_preset)}</Tag>
					</div>

					<div className="flex-1">
						<div
							className="mb-3 inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[.16em]"
							style={{ color: tone.accent, background: tone.accentSoft }}
						>
							{methodLabel || tone.label}
						</div>
						<h2 className="text-balance text-[25px] font-black leading-[1.12] tracking-[-.04em] text-[#fffaf0] sm:text-[29px]">
							{template.name || template.source_title || "이름 없는 템플릿"}
						</h2>
						<p className="mt-3 line-clamp-3 text-[14px] leading-6 text-[#a9a194]">
							{methodDescription ||
								template.source_title ||
								"분석한 제작 방식으로 새 영상을 구성합니다."}
						</p>
					</div>

					<div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
						<CardMetric
							value={`${Math.round(template.duration_seconds)}초`}
							label="기본 길이"
						/>
						<CardMetric value={`${template.scene_count}`} label="씬" />
						<CardMetric
							value={quality.deep ? "deep" : transitionLabel(template.transition_style)}
							label="분석"
						/>
						</div>
						<div className="mt-3 flex flex-wrap gap-1.5">
							{quality.strengths.slice(0, 3).map((strength) => (
							<span
								key={strength}
								className="rounded-full bg-[#8fd6c8]/10 px-2.5 py-1 text-[10px] font-black text-[#8fd6c8]"
							>
									{strength}
								</span>
							))}
							{quality.gaps.slice(0, 2).map((gap) => (
								<span
									key={gap}
									className="rounded-full bg-[#f1c75b]/10 px-2.5 py-1 text-[10px] font-black text-[#f1c75b]"
								>
									보강: {gap}
								</span>
							))}
						</div>

					<div className="mt-5 flex items-center justify-between gap-3">
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onCreate();
							}}
							className="group/cta inline-flex items-center rounded-full bg-[#fffaf0] py-2 pl-4 pr-2 text-[13px] font-black text-[#11100c] transition-all duration-500 ease-[cubic-bezier(.22,1,.36,1)] hover:bg-[#f1c75b] active:scale-[.98]"
						>
							바로 제작
							<span className="ml-3 grid h-8 w-8 place-items-center rounded-full bg-[#11100c] text-[#fffaf0] transition-transform duration-500 group-hover/cta:translate-x-0.5">
								↗
							</span>
						</button>

						{builtIn ? (
							<span className="text-[12px] font-semibold text-[#7f786d]">
								읽기 전용
							</span>
						) : (
							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									onDelete();
								}}
								className="rounded-full px-3 py-2 text-[12px] font-bold text-[#a9a194] transition-colors duration-300 hover:bg-[#ff6b6b]/10 hover:text-[#ff9a9a] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ff6b6b]/20"
								aria-label="템플릿 삭제"
							>
								삭제
							</button>
						)}
					</div>
				</div>
			</div>
		</article>
	);
}

function TemplatePoster({
	template,
	tone,
}: {
	template: ReferenceTemplate;
	tone: TemplateTone;
}) {
	if (template.thumbnail_url) {
		return (
			<div className="relative h-52 overflow-hidden bg-black">
				<img
					src={template.thumbnail_url}
					alt={template.source_title || template.name}
					className="h-full w-full object-cover opacity-90 transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.035]"
					loading="lazy"
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-[#101316] via-transparent to-transparent" />
			</div>
		);
	}

	return (
		<div
			className="relative h-52 overflow-hidden"
			style={{ background: tone.aura }}
		>
			<div className="absolute inset-5 rounded-[26px] border border-white/10 bg-black/20 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" />
			<div className="absolute left-8 top-8 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[.2em] text-white/70">
				{tone.label}
			</div>
			<div className="absolute bottom-8 left-8 right-8">
				<div className="mb-4 flex items-end gap-2">
					{[44, 72, 52, 96, 64].map((height, index) => (
						<div
							key={height}
							className="w-full rounded-full bg-white/70"
							style={{
								height,
								opacity: 0.22 + index * 0.09,
								background:
									index === 3
										? tone.accent
										: "linear-gradient(180deg, rgba(255,255,255,.7), rgba(255,255,255,.18))",
							}}
						/>
					))}
				</div>
				<div className="grid grid-cols-5 gap-2">
					{Array.from({ length: 10 }).map((_, index) => (
						<div
							key={index}
							className="h-2 rounded-full bg-white/15"
							style={{
								backgroundColor: index === 1 || index === 6 ? tone.accent : "",
								opacity: index === 1 || index === 6 ? 0.86 : undefined,
							}}
						/>
					))}
				</div>
			</div>
			<div className="absolute right-7 top-7 grid h-14 w-14 place-items-center rounded-2xl bg-black/30 text-[22px] font-black text-white/80">
				{template.scene_count}
			</div>
		</div>
	);
}

function Tag({ children }: { children: React.ReactNode }) {
	return (
		<span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1 text-[11px] font-bold text-[#d5cec0]">
			{children}
		</span>
	);
}

function CardMetric({ value, label }: { value: string; label: string }) {
	return (
		<div>
			<div className="truncate text-[13px] font-black text-[#fffaf0]">
				{value}
			</div>
			<div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[#7f786d]">
				{label}
			</div>
		</div>
	);
}

function SkeletonCard({ className }: { className: string }) {
	return (
		<div
			className={`${className} min-h-[390px] animate-pulse rounded-[32px] bg-white/[0.06] p-[1px]`}
		>
			<div className="h-full rounded-[31px] bg-[#101316]">
				<div className="h-52 rounded-t-[31px] bg-white/[0.05]" />
				<div className="space-y-4 p-6">
					<div className="h-4 w-24 rounded-full bg-white/[0.08]" />
					<div className="h-8 w-3/4 rounded-full bg-white/[0.08]" />
					<div className="h-4 w-full rounded-full bg-white/[0.06]" />
					<div className="h-4 w-2/3 rounded-full bg-white/[0.06]" />
				</div>
			</div>
		</div>
	);
}

function EmptyState({ selectedChannelId }: { selectedChannelId: string }) {
	return (
		<div className="mt-7 rounded-[32px] border border-dashed border-white/15 bg-white/[0.045] px-6 py-14 text-center">
			<div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl bg-[#f1c75b]/15 text-[24px] font-black text-[#f1c75b]">
				0
			</div>
			<h2 className="text-[28px] font-black tracking-[-.04em] text-[#fffaf0]">
				{selectedChannelId
					? "아직 저장된 레퍼런스가 없습니다"
					: "먼저 채널을 선택하세요"}
			</h2>
			<p className="mx-auto mt-3 max-w-md text-[14px] leading-6 text-[#a9a194]">
				좋은 영상을 분석하거나 내장 제작 방식을 선택하면 다음 제작에서 바로
				재사용할 수 있습니다.
			</p>
		</div>
	);
}
