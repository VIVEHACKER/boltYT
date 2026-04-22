import {
	PButton,
	PHeading,
	PInlineNotification,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { Tv } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import type { Channel } from "../../types/database";

export default function ChannelListPage() {
	const navigate = useNavigate();
	const [channels, setChannels] = useState<Channel[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadChannels = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const { data, error: fetchError } = await supabase
				.from("channels")
				.select("*")
				.order("created_at", { ascending: false });
			if (fetchError) throw fetchError;
			setChannels(data ?? []);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "채널 목록을 불러오지 못했습니다.",
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadChannels();
	}, [loadChannels]);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<PSpinner size="medium" />
			</div>
		);
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
						onClick={loadChannels}
					>
						다시 시도
					</PButton>
				</PInlineNotification>
			)}
			<div className="flex items-center justify-between mb-fluid-md">
				<div>
					<PHeading size="x-large" tag="h1">
						채널 관리
					</PHeading>
					<PText color="contrast-medium">
						유튜브 채널을 생성하고 관리하세요.
					</PText>
				</div>
				<PButton icon="add" onClick={() => navigate("/channels/new")}>
					새 채널
				</PButton>
			</div>

			{channels.length === 0 ? (
				<div className="bg-surface rounded-[8px] p-fluid-lg text-center">
					<div className="flex justify-center mb-static-md">
						<Tv size={48} className="text-contrast-medium" />
					</div>
					<PHeading size="small" tag="h2">
						아직 채널이 없습니다
					</PHeading>
					<PText color="contrast-medium" className="mt-static-sm">
						첫 번째 유튜브 채널을 등록해서 자동화를 시작하세요.
					</PText>
					<PButton
						className="mt-static-lg"
						onClick={() => navigate("/channels/new")}
					>
						채널 만들기
					</PButton>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-static-md">
					{channels.map((ch) => (
						<button
							type="button"
							key={ch.id}
							className="bg-surface rounded-[8px] p-static-lg cursor-pointer hover:shadow-[0px_4px_16px_rgba(0,0,0,.16)] transition-shadow w-full text-left bg-transparent border-0"
							onClick={() => navigate(`/channels/${ch.id}`)}
						>
							<div className="flex items-start justify-between mb-static-sm">
								<PHeading size="small" tag="h3">
									{ch.name}
								</PHeading>
								<PTag color="background-surface">
									{ch.language.toUpperCase()}
								</PTag>
							</div>
							<PText
								size="small"
								color="contrast-medium"
								className="mb-static-md"
							>
								{ch.description || "설명 없음"}
							</PText>
							<div className="flex gap-static-xs flex-wrap">
								{ch.category && (
									<PTag color="notification-info-soft">{ch.category}</PTag>
								)}
								<PTag color="background-surface">{ch.visibility_policy}</PTag>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
