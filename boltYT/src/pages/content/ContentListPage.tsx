import {
	PButton,
	PHeading,
	PInlineNotification,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { FilePlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ContentStatusBadge from "../../components/ContentStatusBadge";
import EmptyState from "../../components/EmptyState";
import LoadingView from "../../components/LoadingView";
import { supabase } from "../../lib/supabase";

interface ContentItem {
	id: string;
	title: string;
	status: string;
	source: string;
	created_at: string;
	channel_name: string;
	brief_id: string | null;
	script_id: string | null;
	scene_count: number;
}

export default function ContentListPage() {
	const navigate = useNavigate();
	const [items, setItems] = useState<ContentItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadItems = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const { data: topics, error: fetchError } = await supabase
				.from("topics")
				.select(`
          id, title, status, source, created_at,
          channels(name),
          briefs(id, scripts(id, scenes(id)))
        `)
				.order("created_at", { ascending: false });

			if (fetchError) throw fetchError;

			const mapped = (topics ?? []).map((t: Record<string, unknown>) => {
				const channel = t.channels as { name: string } | null;
				const briefs = (t.briefs ?? []) as {
					id: string;
					scripts: { id: string; scenes: { id: string }[] }[];
				}[];
				const firstBrief = briefs[0] ?? null;
				const firstScript = firstBrief?.scripts?.[0] ?? null;
				const sceneCount = firstScript?.scenes?.length ?? 0;

				return {
					id: t.id as string,
					title: t.title as string,
					status: t.status as string,
					source: t.source as string,
					created_at: t.created_at as string,
					channel_name: channel?.name ?? "",
					brief_id: firstBrief?.id ?? null,
					script_id: firstScript?.id ?? null,
					scene_count: sceneCount,
				};
			});

			setItems(mapped);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "콘텐츠 목록을 불러오지 못했습니다.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadItems();
	}, [loadItems]);

	if (loading) {
		return <LoadingView message="콘텐츠 목록 불러오는 중..." />;
	}

	return (
		<div className="max-w-4xl">
			{error && (
				<PInlineNotification
					state="error"
					heading="불러오기 실패"
					description={error}
					dismissButton={false}
					className="mb-static-md"
				>
					<PButton
						slot="action"
						variant="secondary"
						compact
						onClick={loadItems}
					>
						다시 시도
					</PButton>
				</PInlineNotification>
			)}
			<div className="flex items-center justify-between mb-fluid-md">
				<div>
					<PHeading size="x-large" tag="h1">
						내 콘텐츠
					</PHeading>
					<PText color="contrast-medium">
						생성한 모든 콘텐츠를 확인하고 관리하세요.
					</PText>
				</div>
				<PButton icon="add" onClick={() => navigate("/content/new")}>
					새 콘텐츠
				</PButton>
			</div>

			{items.length === 0 ? (
				<EmptyState
					icon={<FilePlus size={28} />}
					title="아직 생성된 콘텐츠가 없습니다"
					description="주제/레퍼런스/샘플 프리셋 중 하나로 시작할 수 있습니다."
					primaryAction={{
						label: "새 콘텐츠",
						onClick: () => navigate("/content/new"),
					}}
					secondaryAction={{
						label: "레퍼런스 임포트",
						onClick: () => navigate("/references/import"),
					}}
				/>
			) : (
				<div className="flex flex-col gap-static-sm">
					{items.map((item) => (
						<button
							type="button"
							key={item.id}
							className="bg-surface rounded-[8px] p-static-lg flex items-center gap-static-md cursor-pointer hover:ring-1 hover:ring-contrast-low transition-all w-full text-left bg-transparent border-0"
							onClick={() => navigate(`/content/${item.id}`)}
						>
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-static-sm mb-static-xs">
									<PText weight="semi-bold" ellipsis>
										{item.title}
									</PText>
									<ContentStatusBadge status={item.status} />
								</div>
								<div className="flex items-center gap-static-sm">
									<PText size="x-small" color="contrast-medium">
										{item.channel_name}
									</PText>
									<PText size="x-small" color="contrast-medium">
										{new Date(item.created_at).toLocaleDateString("ko-KR")}
									</PText>
									{item.scene_count > 0 && (
										<PTag color="background-surface">
											{item.scene_count}개 씬
										</PTag>
									)}
								</div>
							</div>

							<div className="flex items-center gap-static-sm shrink-0">
								{item.script_id ? (
									<PTag color="notification-success-soft">스크립트 완료</PTag>
								) : item.brief_id ? (
									<PTag color="notification-info-soft">브리프 완료</PTag>
								) : (
									<PTag color="background-surface">주제만</PTag>
								)}
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
