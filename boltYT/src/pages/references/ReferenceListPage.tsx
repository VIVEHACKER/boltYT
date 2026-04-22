import {
	PButton,
	PHeading,
	PInlineNotification,
	PSelect,
	PSelectOption,
	PSpinner,
	PTag,
	PText,
} from "@porsche-design-system/components-react";
import { Film, Trash2, Tv } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	deleteReferenceTemplate,
	listReferenceTemplates,
} from "../../lib/reference-import";
import { supabase } from "../../lib/supabase";
import type { Channel, ReferenceTemplate } from "../../types/database";

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

	return (
		<div className="max-w-5xl">
			<div className="flex items-center justify-between mb-static-lg">
				<div>
					<PHeading tag="h1" size="large">
						레퍼런스 템플릿
					</PHeading>
					<PText size="small" color="neutral-contrast-medium">
						마음에 드는 영상을 분석해 스타일 프리셋을 만드세요.
					</PText>
				</div>
				<PButton
					icon="add"
					onClick={() =>
						navigate(
							`/references/import${selectedChannelId ? `?channel=${selectedChannelId}` : ""}`,
						)
					}
				>
					새 레퍼런스 분석
				</PButton>
			</div>

			<div className="mb-static-md">
				<PSelect
					name="channel"
					label="채널"
					value={selectedChannelId}
					onUpdate={(e) => handleChannelChange(String(e.detail.value ?? ""))}
				>
					{channels.map((ch) => (
						<PSelectOption key={ch.id} value={ch.id}>
							{ch.name}
						</PSelectOption>
					))}
				</PSelect>
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

			{loading ? (
				<div className="flex items-center justify-center h-64">
					<PSpinner size="medium" />
				</div>
			) : templates.length === 0 ? (
				<div className="text-center py-16 border border-dashed border-[#3a3a3a] rounded-lg">
					<Film className="mx-auto mb-4 opacity-40" size={48} />
					<PText color="neutral-contrast-medium">
						{selectedChannelId
							? "아직 저장된 레퍼런스 템플릿이 없습니다."
							: "먼저 채널을 선택하세요."}
					</PText>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{templates.map((t) => (
						<div
							key={t.id}
							className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden hover:border-[#4a4a4a] transition-colors cursor-pointer"
							onClick={() => navigate(`/references/${t.id}`)}
							onKeyDown={(e) => {
								if (e.key === "Enter") navigate(`/references/${t.id}`);
							}}
							role="button"
							tabIndex={0}
						>
							{t.thumbnail_url ? (
								<img
									src={t.thumbnail_url}
									alt={t.source_title}
									className="w-full h-40 object-cover bg-black"
									loading="lazy"
								/>
							) : (
								<div className="w-full h-40 bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] flex items-center justify-center">
									<Film size={48} className="opacity-30" />
								</div>
							)}
							<div className="p-4">
								<div className="flex items-center gap-2 mb-2">
									{t.source_type === "youtube" && (
										<Tv size={14} className="text-red-500" />
									)}
									<PTag color="background-base">{t.visual_mood}</PTag>
									<PTag color="background-base">{t.pacing_preset}</PTag>
								</div>
								<PText size="small" className="font-semibold line-clamp-2 mb-1">
									{t.name || t.source_title || "이름 없는 템플릿"}
								</PText>
								{t.source_creator && (
									<PText size="x-small" color="neutral-contrast-medium">
										{t.source_creator}
									</PText>
								)}
								<div className="flex items-center gap-3 mt-3 text-xs opacity-70">
									<span>{Math.round(t.duration_seconds)}초</span>
									<span>씬 {t.scene_count}</span>
									<span className="capitalize">{t.transition_style}</span>
								</div>
								<div className="flex justify-between items-center mt-3 pt-3 border-t border-[#2a2a2a]">
									<PText size="x-small" color="neutral-contrast-medium">
										{new Date(t.created_at).toLocaleDateString("ko-KR")}
									</PText>
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											void handleDelete(t.id, t.name);
										}}
										className="opacity-50 hover:opacity-100 hover:text-red-500"
										aria-label="삭제"
									>
										<Trash2 size={14} />
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
