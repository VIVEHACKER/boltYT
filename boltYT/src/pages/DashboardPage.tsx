import {
	PButton,
	PDivider,
	PHeading,
	PText,
} from "@porsche-design-system/components-react";
import { ChartBar as BarChart3, FilePlus, Tv, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ContentStatusBadge from "../components/ContentStatusBadge";
import EmptyState from "../components/EmptyState";
import LoadingView from "../components/LoadingView";
import OnboardingBanner from "../components/OnboardingBanner";
import StatCard from "../components/StatCard";
import { DEMO_CHANNELS } from "../lib/demo-data";
import { hasSeenOnboarding } from "../lib/onboarding";
import { DEMO_MODE, supabase } from "../lib/supabase";
import type { Channel, Topic } from "../types/database";

export default function DashboardPage() {
	const navigate = useNavigate();
	const [channels, setChannels] = useState<Channel[]>(
		DEMO_MODE ? (DEMO_CHANNELS as Channel[]) : [],
	);
	const [recentTopics, setRecentTopics] = useState<
		(Topic & { channel_name?: string })[]
	>([]);
	const [loading, setLoading] = useState(!DEMO_MODE);
	const [stats, setStats] = useState(
		DEMO_MODE
			? { channels: 1, topics: 0, uploads: 0 }
			: { channels: 0, topics: 0, uploads: 0 },
	);
	const [showOnboarding, setShowOnboarding] = useState(
		() => !hasSeenOnboarding(),
	);

	useEffect(() => {
		if (DEMO_MODE) return;

		async function loadDashboard() {
			const [channelsRes, topicsRes, uploadsRes] = await Promise.all([
				supabase
					.from("channels")
					.select("*")
					.order("created_at", { ascending: false }),
				supabase
					.from("topics")
					.select("*, channels(name)")
					.order("created_at", { ascending: false })
					.limit(5),
				supabase.from("uploads").select("id", { count: "exact", head: true }),
			]);

			const ch = channelsRes.data ?? [];
			setChannels(ch);

			const tp = (topicsRes.data ?? []).map((t: Record<string, unknown>) => ({
				...t,
				channel_name: (t.channels as { name?: string })?.name ?? "",
			})) as (Topic & { channel_name?: string })[];
			setRecentTopics(tp);

			setStats({
				channels: ch.length,
				topics: tp.length,
				uploads: uploadsRes.count ?? 0,
			});

			setLoading(false);
		}

		loadDashboard();
	}, []);

	if (loading) {
		return <LoadingView message="대시보드 불러오는 중..." />;
	}

	return (
		<div className="max-w-5xl">
			{showOnboarding && (
				<OnboardingBanner onDismiss={() => setShowOnboarding(false)} />
			)}
			<div className="flex items-center justify-between mb-fluid-md">
				<div>
					<PHeading size="x-large" tag="h1">
						대시보드
					</PHeading>
					<PText color="contrast-medium">유튜브 자동화 플랫폼 운영 현황</PText>
				</div>
				<PButton icon="add" onClick={() => navigate("/content/new")}>
					새 콘텐츠
				</PButton>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-static-md mb-fluid-md">
				<StatCard
					label="채널 수"
					value={stats.channels}
					icon={<Tv size={20} />}
				/>
				<StatCard
					label="콘텐츠 주제"
					value={stats.topics}
					icon={<FilePlus size={20} />}
				/>
				<StatCard
					label="업로드"
					value={stats.uploads}
					icon={<Upload size={20} />}
				/>
				<StatCard
					label="이번 주 조회수"
					value="--"
					icon={<BarChart3 size={20} />}
				/>
			</div>

			<PDivider className="mb-fluid-md" />

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-fluid-md">
				<div className="bg-surface rounded-[8px] p-static-lg">
					<div className="flex items-center justify-between mb-static-md">
						<PHeading size="small" tag="h2">
							내 채널
						</PHeading>
						<PButton
							variant="ghost"
							compact
							onClick={() => navigate("/channels")}
						>
							전체 보기
						</PButton>
					</div>
					{channels.length === 0 ? (
						<EmptyState
							icon={<Tv size={28} />}
							title="등록된 채널이 없습니다"
							description="채널은 영상의 톤/언어/화자를 고정합니다. 먼저 채널을 하나 만들어 주세요."
							primaryAction={{
								label: "채널 만들기",
								onClick: () => navigate("/channels/new"),
							}}
						/>
					) : (
						<div className="flex flex-col gap-static-sm">
							{channels.slice(0, 3).map((ch) => (
								<button
									type="button"
									key={ch.id}
									className="flex items-center justify-between p-static-sm rounded-[4px] hover:bg-canvas transition-colors cursor-pointer w-full text-left bg-transparent border-0"
									onClick={() => navigate(`/channels/${ch.id}`)}
									onKeyDown={(e) => {
										if (e.key === "Enter") navigate(`/channels/${ch.id}`);
									}}
								>
									<div>
										<PText weight="semi-bold">{ch.name}</PText>
										<PText size="x-small" color="contrast-medium">
											{ch.category} / {ch.language}
										</PText>
									</div>
									<ContentStatusBadge status="complete" />
								</button>
							))}
						</div>
					)}
				</div>

				<div className="bg-surface rounded-[8px] p-static-lg">
					<div className="flex items-center justify-between mb-static-md">
						<PHeading size="small" tag="h2">
							최근 콘텐츠
						</PHeading>
						<PButton
							variant="ghost"
							compact
							onClick={() => navigate("/content")}
						>
							전체 보기
						</PButton>
					</div>
					{recentTopics.length === 0 ? (
						<EmptyState
							icon={<FilePlus size={28} />}
							title="아직 생성된 콘텐츠가 없습니다"
							description="주제를 하나만 입력하면 스크립트·이미지·TTS까지 자동으로 조립됩니다."
							primaryAction={{
								label: "첫 콘텐츠 만들기",
								onClick: () => navigate("/content/new"),
							}}
							secondaryAction={{
								label: "레퍼런스 스타일로 시작",
								onClick: () => navigate("/references/import"),
							}}
						/>
					) : (
						<div className="flex flex-col gap-static-sm">
							{recentTopics.map((t) => (
								<button
									type="button"
									key={t.id}
									className="flex items-center justify-between p-static-sm rounded-[4px] hover:bg-canvas transition-colors cursor-pointer w-full text-left bg-transparent border-0"
									onClick={() => navigate(`/content/${t.id}`)}
								>
									<div>
										<PText weight="semi-bold">{t.title}</PText>
										<PText size="x-small" color="contrast-medium">
											{t.channel_name}
										</PText>
									</div>
									<ContentStatusBadge status={t.status} />
								</button>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
