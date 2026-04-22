import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PSpinner,
	PText,
} from "@porsche-design-system/components-react";
import {
	ChartBar as BarChart3,
	Eye,
	MessageSquare,
	ThumbsUp,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import StatCard from "../components/StatCard";
import { supabase } from "../lib/supabase";

interface UploadWithAnalytics {
	id: string;
	title: string;
	status: string;
	published_at: string | null;
	analytics: {
		views: number;
		ctr: number;
		avg_watch_duration: number;
		likes: number;
		comments: number;
		subscribers_gained: number;
	}[];
}

export default function AnalyticsPage() {
	const [uploads, setUploads] = useState<UploadWithAnalytics[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadUploads = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const { data, error: fetchError } = await supabase
				.from("uploads")
				.select("id, title, status, published_at, analytics(*)")
				.eq("status", "published")
				.order("published_at", { ascending: false });
			if (fetchError) throw fetchError;
			setUploads((data ?? []) as unknown as UploadWithAnalytics[]);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "성과 데이터를 불러오지 못했습니다.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadUploads();
	}, [loadUploads]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	const totalViews = uploads.reduce(
		(sum, u) => sum + (u.analytics?.[0]?.views ?? 0),
		0,
	);
	const totalLikes = uploads.reduce(
		(sum, u) => sum + (u.analytics?.[0]?.likes ?? 0),
		0,
	);
	const totalComments = uploads.reduce(
		(sum, u) => sum + (u.analytics?.[0]?.comments ?? 0),
		0,
	);
	const totalSubs = uploads.reduce(
		(sum, u) => sum + (u.analytics?.[0]?.subscribers_gained ?? 0),
		0,
	);

	return (
		<div className="max-w-4xl">
			<div className="mb-fluid-md">
				<PHeading size="x-large" tag="h1">
					성과 분석
				</PHeading>
				<PText color="contrast-medium">
					게시된 콘텐츠의 성과를 확인하세요.
				</PText>
			</div>

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
						onClick={loadUploads}
					>
						다시 시도
					</PButton>
				</PInlineNotification>
			)}

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-static-md mb-fluid-md">
				<StatCard
					label="총 조회수"
					value={totalViews.toLocaleString()}
					icon={<Eye size={20} />}
				/>
				<StatCard
					label="총 좋아요"
					value={totalLikes.toLocaleString()}
					icon={<ThumbsUp size={20} />}
				/>
				<StatCard
					label="총 댓글"
					value={totalComments.toLocaleString()}
					icon={<MessageSquare size={20} />}
				/>
				<StatCard
					label="구독자 증가"
					value={totalSubs.toLocaleString()}
					icon={<Users size={20} />}
				/>
			</div>

			<PDivider className="mb-fluid-md" />

			{uploads.length === 0 ? (
				<div className="bg-surface rounded-[8px] p-fluid-lg text-center">
					<div className="flex justify-center mb-static-md">
						<BarChart3 size={48} className="text-contrast-medium" />
					</div>
					<PHeading size="small" tag="h2">
						성과 데이터가 없습니다
					</PHeading>
					<PText color="contrast-medium" className="mt-static-sm">
						콘텐츠를 게시하면 성과 데이터가 여기에 표시됩니다.
					</PText>
				</div>
			) : (
				<div className="flex flex-col gap-static-md">
					{uploads.map((upload) => {
						const a = upload.analytics?.[0];
						return (
							<div
								key={upload.id}
								className="bg-surface rounded-[8px] p-static-lg"
							>
								<div className="flex items-center justify-between mb-static-md">
									<PText weight="semi-bold">{upload.title}</PText>
									<PText size="x-small" color="contrast-medium">
										{upload.published_at
											? new Date(upload.published_at).toLocaleDateString(
													"ko-KR",
												)
											: "--"}
									</PText>
								</div>
								{a ? (
									<div className="grid grid-cols-3 sm:grid-cols-6 gap-static-sm">
										<div className="text-center">
											<PText size="x-small" color="contrast-medium">
												조회수
											</PText>
											<PText weight="semi-bold">
												{a.views.toLocaleString()}
											</PText>
										</div>
										<div className="text-center">
											<PText size="x-small" color="contrast-medium">
												CTR
											</PText>
											<PText weight="semi-bold">{a.ctr}%</PText>
										</div>
										<div className="text-center">
											<PText size="x-small" color="contrast-medium">
												평균 시청
											</PText>
											<PText weight="semi-bold">{a.avg_watch_duration}초</PText>
										</div>
										<div className="text-center">
											<PText size="x-small" color="contrast-medium">
												좋아요
											</PText>
											<PText weight="semi-bold">{a.likes}</PText>
										</div>
										<div className="text-center">
											<PText size="x-small" color="contrast-medium">
												댓글
											</PText>
											<PText weight="semi-bold">{a.comments}</PText>
										</div>
										<div className="text-center">
											<PText size="x-small" color="contrast-medium">
												구독+
											</PText>
											<PText weight="semi-bold">{a.subscribers_gained}</PText>
										</div>
									</div>
								) : (
									<PText size="small" color="contrast-medium">
										아직 수집된 데이터가 없습니다.
									</PText>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
