import {
	PButton,
	PDivider,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTabsBar,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ChannelMembersPanel from "../../components/ChannelMembersPanel";
import { supabase } from "../../lib/supabase";
import type { Channel } from "../../types/database";

export default function ChannelDetailPage() {
	const navigate = useNavigate();
	const { id } = useParams();
	const [channel, setChannel] = useState<Channel | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState<"settings" | "members">(
		"settings",
	);

	const loadChannel = useCallback(async () => {
		if (!id) return;
		setLoading(true);
		setError(null);
		try {
			const { data, error: fetchError } = await supabase
				.from("channels")
				.select("*")
				.eq("id", id)
				.maybeSingle();
			if (fetchError) throw fetchError;
			setChannel(data);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "채널 정보를 불러오지 못했습니다.",
			);
		} finally {
			setLoading(false);
		}
	}, [id]);

	useEffect(() => {
		void loadChannel();
	}, [loadChannel]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="max-w-3xl">
				<PInlineNotification
					state="error"
					heading="불러오기 실패"
					description={error}
					dismissButton={false}
				>
					<PButton
						slot="action"
						variant="secondary"
						compact
						onClick={loadChannel}
					>
						다시 시도
					</PButton>
				</PInlineNotification>
			</div>
		);
	}

	if (!channel) {
		return (
			<div className="text-center py-fluid-lg">
				<PText>채널을 찾을 수 없습니다.</PText>
				<PButton
					variant="secondary"
					className="mt-static-md"
					onClick={() => navigate("/channels")}
				>
					돌아가기
				</PButton>
			</div>
		);
	}

	return (
		<div className="max-w-3xl">
			<div className="flex items-center justify-between mb-fluid-md">
				<div>
					<PHeading size="x-large" tag="h1">
						{channel.name}
					</PHeading>
					<PText color="contrast-medium">
						{channel.description || "설명 없음"}
					</PText>
				</div>
				<div className="flex gap-static-sm">
					<PButton
						variant="secondary"
						onClick={() => navigate(`/channels/${id}/edit`)}
					>
						수정
					</PButton>
					<PButton onClick={() => navigate(`/style-bible?channel=${id}`)}>
						스타일 바이블
					</PButton>
				</div>
			</div>

			<PTabsBar
				activeTabIndex={activeTab === "settings" ? 0 : 1}
				onUpdate={(e) =>
					setActiveTab(e.detail.activeTabIndex === 0 ? "settings" : "members")
				}
				className="mb-static-lg"
			>
				<button type="button">채널 설정</button>
				<button type="button">팀 멤버</button>
			</PTabsBar>

			{activeTab === "settings" && (
				<div className="bg-surface rounded-[8px] p-static-lg">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-static-lg">
						<div>
							<PText size="x-small" color="contrast-medium">
								언어
							</PText>
							<PText weight="semi-bold">{channel.language.toUpperCase()}</PText>
						</div>
						<div>
							<PText size="x-small" color="contrast-medium">
								카테고리
							</PText>
							<PText weight="semi-bold">{channel.category || "--"}</PText>
						</div>
						<div>
							<PText size="x-small" color="contrast-medium">
								톤앤매너
							</PText>
							<PText weight="semi-bold">{channel.tone || "--"}</PText>
						</div>
						<div>
							<PText size="x-small" color="contrast-medium">
								공개 정책
							</PText>
							<PText weight="semi-bold">{channel.visibility_policy}</PText>
						</div>
						<div>
							<PText size="x-small" color="contrast-medium">
								기본 CTA
							</PText>
							<PText weight="semi-bold">{channel.default_cta || "--"}</PText>
						</div>
						<div>
							<PText size="x-small" color="contrast-medium">
								금지어
							</PText>
							<div className="flex gap-static-xs flex-wrap mt-static-xs">
								{channel.forbidden_words.length > 0 ? (
									channel.forbidden_words.map((w) => (
										<PTag key={w} color="notification-error-soft">
											{w}
										</PTag>
									))
								) : (
									<PText size="small" color="contrast-medium">
										없음
									</PText>
								)}
							</div>
						</div>
					</div>
				</div>
			)}

			{activeTab === "members" && id && (
				<div className="bg-surface rounded-[8px] p-static-lg">
					<ChannelMembersPanel channelId={id} />
				</div>
			)}

			<PDivider className="my-fluid-md" />

			<div className="flex gap-static-md">
				<PButton onClick={() => navigate(`/content/new?channel=${id}`)}>
					이 채널로 콘텐츠 만들기
				</PButton>
				<PButton variant="secondary" onClick={() => navigate("/channels")}>
					채널 목록
				</PButton>
			</div>
		</div>
	);
}
